import { z } from 'zod';
import {
  phoneSecureStore,
  sessionSecureStore,
  type ReadResult,
  type SecureStore,
} from '../platform/secureStore';
import { logger as appLogger, type Logger } from '../services/logger';
import { isAppError, type AppErrorKind } from './appError';
import { authApiClient, type AuthApiClient } from './authApiClient';
import { AuthError, isAuthError } from './authError';
import { userCurrentSchema } from './dto/userCurrent';
import {
  createHttpClient,
  fixedAccessToken,
  type AccessTokenSource,
  type HttpClient,
} from './httpClient';
import { createRefreshCoordinator, type RefreshHost } from './refreshCoordinator';

/**
 * SessionManager (AD-3): the only reader and writer of tokens. The UI sees
 * only `status` (`signedOut | signedIn | expired`); `HttpClient` gets the
 * token through this manager's `AccessTokenSource`, never from callers.
 *
 * - `restore()` reads the stored session once and keeps it in memory.
 * - Requests refresh through the single-flight coordinator
 *   (`refreshCoordinator.ts`, api-contract §2.3): proactively when < 300 s
 *   remain, once after a 401. Only refresh 400 `invalid_grant` sets
 *   `expired` and clears the stored session entry (the phone is kept for
 *   re-login), so the next start opens A1 «Войдите снова».
 * - `validate()` runs E1 `GET /v1/user/current` (single-flight): at cold
 *   start and on every return to the foreground (`onAppStateChange`),
 *   because content endpoints answer 200 as anonymous for a bad token
 *   (api-contract §7) and never trigger the 401 path.
 * - Every SecureStore write and clear of the session runs in one queue, so a
 *   sign-out's clear always lands after a refresh's write that started
 *   before it. Sign-in, restore and sign-out bump a generation; a late
 *   refresh result of an older generation is dropped.
 *
 * Sign-in order: confirm (AuthApiClient) → E1 (content profile, with the new
 * token) → save the phone, then the session, to SecureStore → `signedIn`.
 * The phone is written first and its failure is not fatal; if E1 or the
 * session save fails, the tokens are dropped, nothing is kept and the call
 * rejects with `AuthError('Unknown')` marked `challengeSpent` (confirm
 * succeeded, so the code cannot be reused).
 *
 * Never logs the phone, the challenge, the code, tokens or the E1 body.
 */

export type SessionStatus = 'signedOut' | 'signedIn' | 'expired';

export type RestoreResult =
  | { status: 'signedIn' }
  | {
      status: 'signedOut';
      /**
       * `none`: nothing stored. `wiped`: the store was corrupted and reset
       * («Войдите снова»). `unavailable`: a transient storage error; the
       * data is kept and the next start reads it again. `expired`: no
       * session but the phone is kept, i.e. the last session was rejected
       * (refresh 400 `invalid_grant`) — «Войдите снова».
       */
      reason: 'none' | 'wiped' | 'unavailable' | 'expired';
    };

/** The outcome of one E1 session check. */
export type ValidateResult =
  | { kind: 'ok' }
  /** Not signed in: nothing was sent. */
  | { kind: 'skipped' }
  /** The refresh was rejected: the status is now `expired`. */
  | { kind: 'expired' }
  /** The session is kept; `error` after the AD-6 retries. */
  | { kind: 'failed'; error: AppErrorKind };

export type SignInArgs = {
  /** E.164, the phone the challenge was sent to. */
  phone: string;
  /** The send result's `code`. */
  challenge: string;
  /** What the user typed. */
  smsCode: string;
};

export type SessionManager = {
  getStatus(): SessionStatus;
  /** Called on every status change. Returns the unsubscribe function. */
  subscribe(listener: (status: SessionStatus) => void): () => void;
  /** Reads the stored session (again) and keeps it in memory. Never rejects. */
  restore(): Promise<RestoreResult>;
  /** Rejects with `AuthError` only. */
  signIn(args: SignInArgs): Promise<void>;
  /**
   * Local sign-out (no server call): clears SecureStore first (session, then
   * phone), then memory. Rejects with the store's error when a clear fails;
   * the in-memory session is then kept. The UI is Story 2.7.
   */
  signOut(): Promise<void>;
  /** E1 session check, single-flight. Never rejects; never moves focus. */
  validate(): Promise<ValidateResult>;
  /**
   * Lifecycle hook (`AppState` change): runs `validate()` on every change to
   * `active` and returns its result; null for any other change.
   */
  onAppStateChange(state: string): Promise<ValidateResult> | null;
  /** The content `HttpClient`, with this manager as its token source. */
  readonly http: HttpClient;
  /**
   * Debug builds only (undefined in release): replaces the in-memory access
   * token with a corrupted one of the same length, then runs `validate()`,
   * so E1 → 401 → one real refresh → retry. Storage is not touched.
   */
  readonly debugCorruptAccessToken?: () => Promise<ValidateResult>;
};

export const CURRENT_USER_PATH = '/v1/user/current';

/** The session value in the `boostytv.session` keychain service. */
const storedSessionSchema = z.object({
  v: z.literal(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Epoch milliseconds, from `expires_in` read as seconds. */
  expiresAt: z.number(),
  /** E1 `id`, as a string. */
  accountId: z.string().min(1),
});

type StoredSession = z.infer<typeof storedSessionSchema>;

function decodeSession(raw: string): StoredSession | null {
  try {
    const parsed = storedSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type SessionManagerDeps = {
  authApi?: AuthApiClient;
  /** Builds the content client over a token source (tests pass a fixture transport). */
  createHttp?: (tokens: AccessTokenSource) => HttpClient;
  sessionStore?: SecureStore;
  phoneStore?: SecureStore;
  now?: () => number;
  logger?: Logger;
};

export function createSessionManager({
  authApi = authApiClient,
  createHttp = tokens => createHttpClient({ tokens }),
  sessionStore = sessionSecureStore,
  phoneStore = phoneSecureStore,
  now = Date.now,
  logger = appLogger,
}: SessionManagerDeps = {}): SessionManager {
  let status: SessionStatus = 'signedOut';
  /** The signed-in session; memory only besides SecureStore. */
  let session: StoredSession | null = null;
  /** Bumped by restore, sign-in and sign-out. */
  let generation = 0;
  const listeners = new Set<(next: SessionStatus) => void>();
  let restoring: Promise<RestoreResult> | null = null;
  let signingIn: { key: string; promise: Promise<void> } | null = null;
  let validating: Promise<ValidateResult> | null = null;
  let appState = 'active';
  /** Sign-out has started: the coordinator sees no session. */
  let signingOut = false;
  /** Serializes every SecureStore write and clear of this manager. */
  let storeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = storeQueue.then(op, op);
    storeQueue = result.catch(() => undefined);
    return result;
  }

  const setStatus = (next: SessionStatus) => {
    if (next === status) {
      return;
    }
    status = next;
    logger.info('session', 'status', { status: next });
    for (const listener of [...listeners]) {
      listener(next);
    }
  };

  const host: RefreshHost<StoredSession> = {
    current: () =>
      status === 'signedIn' && session && !signingOut ? { session, generation } : null,
    isExpired: () => status === 'expired',
    isCurrent: g => g === generation,
    persist: (next, g) =>
      enqueue(async () => {
        if (g !== generation || signingOut) {
          return 'stale' as const;
        }
        await sessionStore.write(JSON.stringify(next));
        return 'saved' as const;
      }),
    adopt(next, g) {
      if (g !== generation || status !== 'signedIn' || signingOut) {
        return false;
      }
      session = next;
      return true;
    },
    expire(g) {
      if (g !== generation || status !== 'signedIn') {
        logger.info('session', 'late rejection dropped');
        return false;
      }
      // Nothing further is sent with these tokens; the stored session entry
      // is cleared (the phone stays for re-login). A failed clear is logged
      // and does not change the status.
      session = null;
      setStatus('expired');
      enqueue(() => sessionStore.clear()).catch(() => {
        logger.error('session', 'expired session not cleared');
      });
      return true;
    },
  };

  const coordinator = createRefreshCoordinator({
    host,
    refresh: refreshToken => authApi.refresh(refreshToken),
    now,
    logger,
  });
  const http = createHttp(coordinator);

  async function readSession(): Promise<RestoreResult> {
    generation += 1;
    session = null;
    const result = await sessionStore.read();
    if (result.kind !== 'value') {
      setStatus('signedOut');
    }
    if (result.kind === 'empty') {
      // A kept phone without a session: the last session expired.
      let phone: ReadResult = { kind: 'empty' };
      try {
        phone = await phoneStore.read();
      } catch {
        // Treated as nothing stored.
      }
      return { status: 'signedOut', reason: phone.kind === 'value' ? 'expired' : 'none' };
    }
    if (result.kind === 'wiped') {
      return { status: 'signedOut', reason: 'wiped' };
    }
    if (result.kind === 'unavailable') {
      return { status: 'signedOut', reason: 'unavailable' };
    }
    const decoded = decodeSession(result.value);
    if (!decoded) {
      // Readable but not a session: treat as corrupted, start clean.
      logger.warn('session', 'stored session unreadable; clearing');
      setStatus('signedOut');
      try {
        await enqueue(() => sessionStore.clear());
      } catch {
        // Logged by the store; the next start tries again.
      }
      return { status: 'signedOut', reason: 'wiped' };
    }
    // A past `expiresAt` is kept as is: the first request refreshes
    // proactively (and E1 runs right after the boot).
    session = decoded;
    setStatus('signedIn');
    return { status: 'signedIn' };
  }

  /** E1 with a token that is not adopted yet (sign-in). */
  async function validateWithE1(accessToken: string): Promise<string> {
    try {
      // Sent once, as in Story 2.3 (api-contract §2.2): no AD-6 retries.
      const response = await createHttp(fixedAccessToken(accessToken)).request({
        path: CURRENT_USER_PATH,
        schema: userCurrentSchema,
        retry: false,
      });
      return String(response.body.id);
    } catch (error) {
      logger.warn('session', 'E1 failed', {
        kind: isAppError(error) ? error.kind : 'unknown',
        status: isAppError(error) ? error.status : undefined,
      });
      throw new AuthError('Unknown');
    }
  }

  async function discardSaved(): Promise<void> {
    for (const store of [sessionStore, phoneStore]) {
      try {
        await enqueue(() => store.clear());
      } catch {
        // Logged by the store.
      }
    }
  }

  async function doSignIn({ phone, challenge, smsCode }: SignInArgs) {
    const tokens = await authApi.confirmCode(phone, challenge, smsCode);
    // From here on the challenge is spent: any failure says so.
    const spent = () => new AuthError('Unknown', { challengeSpent: true });
    const confirmedAt = now();
    let accountId: string;
    try {
      accountId = await validateWithE1(tokens.accessToken);
    } catch {
      throw spent();
    }
    const next: StoredSession = {
      v: 1,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: confirmedAt + tokens.expiresIn * 1000,
      accountId,
    };
    // A new session: any refresh still running for an older one is dropped.
    generation += 1;
    // The phone first and non-fatal (it only prefills re-login): its ADR
    // 0006 recovery may delete the shared keychain file, which must happen
    // before the session is written, never after.
    try {
      await enqueue(() => phoneStore.write(phone));
    } catch {
      logger.warn('session', 'phone not saved');
    }
    try {
      await enqueue(() => sessionStore.write(JSON.stringify(next)));
    } catch {
      logger.error('session', 'save failed; nothing kept');
      await discardSaved();
      throw spent();
    }
    logger.info('session', 'signed in');
    session = next;
    setStatus('signedIn');
  }

  async function doValidate(): Promise<ValidateResult> {
    if (status !== 'signedIn') {
      return { kind: 'skipped' };
    }
    try {
      await http.get(CURRENT_USER_PATH, userCurrentSchema);
      logger.info('session', 'E1 ok');
      return { kind: 'ok' };
    } catch (error) {
      const kind: AppErrorKind = isAppError(error) ? error.kind : 'Client';
      logger.warn('session', 'E1 failed', { kind });
      return kind === 'SessionExpired' ? { kind: 'expired' } : { kind: 'failed', error: kind };
    }
  }

  function validate(): Promise<ValidateResult> {
    if (!validating) {
      validating = doValidate().finally(() => {
        validating = null;
      });
    }
    return validating;
  }

  async function signOut(): Promise<void> {
    generation += 1;
    signingOut = true;
    // SecureStore first, then memory (api-contract §2.3 «Logout order»).
    try {
      await enqueue(() => sessionStore.clear());
      await enqueue(() => phoneStore.clear());
    } finally {
      signingOut = false;
    }
    session = null;
    logger.info('session', 'signed out');
    setStatus('signedOut');
  }

  function corrupt(token: string): string {
    return token.replace(/[A-Za-z0-9]/g, c =>
      /\d/.test(c) ? String((Number(c) + 5) % 10) : c === 'x' || c === 'X' ? 'q' : 'x',
    );
  }

  return {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restore() {
      if (!restoring) {
        restoring = readSession()
          .catch((): RestoreResult => {
            logger.error('session', 'restore failed');
            setStatus('signedOut');
            return { status: 'signedOut', reason: 'unavailable' };
          })
          .finally(() => {
            restoring = null;
          });
      }
      return restoring;
    },
    signIn(args) {
      const key = `${args.phone}\n${args.challenge}\n${args.smsCode}`;
      if (signingIn) {
        if (signingIn.key === key) {
          return signingIn.promise;
        }
        logger.warn('session', 'signIn rejected: another sign-in in flight');
        return Promise.reject(new AuthError('Unknown'));
      }
      const promise = doSignIn(args)
        .catch((error: unknown) => {
          throw isAuthError(error) ? error : new AuthError('Unknown');
        })
        .finally(() => {
          signingIn = null;
        });
      signingIn = { key, promise };
      return promise;
    },
    signOut,
    validate,
    onAppStateChange(next) {
      const previous = appState;
      appState = next;
      return next === 'active' && previous !== 'active' ? validate() : null;
    },
    http,
    debugCorruptAccessToken: __DEV__
      ? () => {
          if (status === 'signedIn' && session) {
            session = { ...session, accessToken: corrupt(session.accessToken) };
            logger.info('session', 'debug: access token corrupted in memory');
          }
          return validate();
        }
      : undefined,
  };
}

/** The app's SessionManager over the real clients and the keychain. */
export const sessionManager: SessionManager = createSessionManager();

/** The app's content client: token from `sessionManager` (AD-3). */
export const httpClient: HttpClient = sessionManager.http;
