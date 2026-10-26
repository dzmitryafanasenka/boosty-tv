import { z } from 'zod';
import {
  phoneSecureStore,
  sessionSecureStore,
  type SecureStore,
} from '../platform/secureStore';
import { logger as appLogger, type Logger } from '../services/logger';
import { authApiClient, type AuthApiClient } from './authApiClient';
import { AuthError, isAuthError } from './authError';
import { userCurrentSchema } from './dto/userCurrent';
import { httpClient, type HttpClient } from './httpClient';

/**
 * SessionManager (AD-3): the only reader and writer of tokens. The UI sees
 * only `status`. Story 2.3 scope: sign-in with the phone code and restore at
 * startup. Refresh, expiry, E1 at startup and on resume are Story 2.5;
 * sign-out and account-switch wipes are Stories 2.7–2.8.
 *
 * Sign-in order: confirm (AuthApiClient) → E1 `GET /v1/user/current`
 * (HttpClient, content profile) → save the phone, then the session, to
 * SecureStore → `signedIn`. The phone is written first and its failure is
 * not fatal; if E1 or the session save fails, the tokens are dropped,
 * nothing is kept and the call rejects with `AuthError('Unknown')` marked
 * `challengeSpent` (confirm succeeded, so the code cannot be reused).
 *
 * Never logs the phone, the challenge, the code, tokens or the E1 body.
 */

export type SessionStatus = 'signedOut' | 'signedIn';

export type RestoreResult =
  | { status: 'signedIn' }
  | {
      status: 'signedOut';
      /**
       * `none`: nothing stored. `wiped`: the store was corrupted and reset
       * («Войдите снова»). `unavailable`: a transient storage error; the
       * data is kept and the next start reads it again.
       */
      reason: 'none' | 'wiped' | 'unavailable';
    };

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
  /** Reads the stored session once. Never rejects. */
  restore(): Promise<RestoreResult>;
  /** Rejects with `AuthError` only. */
  signIn(args: SignInArgs): Promise<void>;
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
  http?: HttpClient;
  sessionStore?: SecureStore;
  phoneStore?: SecureStore;
  now?: () => number;
  logger?: Logger;
};

export function createSessionManager({
  authApi = authApiClient,
  http = httpClient,
  sessionStore = sessionSecureStore,
  phoneStore = phoneSecureStore,
  now = Date.now,
  logger = appLogger,
}: SessionManagerDeps = {}): SessionManager {
  let status: SessionStatus = 'signedOut';
  const listeners = new Set<(next: SessionStatus) => void>();
  let restoring: Promise<RestoreResult> | null = null;
  let signingIn: { key: string; promise: Promise<void> } | null = null;

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

  async function readSession(): Promise<RestoreResult> {
    const result = await sessionStore.read();
    if (result.kind !== 'value') {
      setStatus('signedOut');
    }
    if (result.kind === 'empty') {
      return { status: 'signedOut', reason: 'none' };
    }
    if (result.kind === 'wiped') {
      return { status: 'signedOut', reason: 'wiped' };
    }
    if (result.kind === 'unavailable') {
      return { status: 'signedOut', reason: 'unavailable' };
    }
    if (!decodeSession(result.value)) {
      // Readable but not a session: treat as corrupted, start clean.
      logger.warn('session', 'stored session unreadable; clearing');
      setStatus('signedOut');
      try {
        await sessionStore.clear();
      } catch {
        // Logged by the store; the next start tries again.
      }
      return { status: 'signedOut', reason: 'wiped' };
    }
    // Story 2.5 keeps the decoded session in memory for requests and E1.
    setStatus('signedIn');
    return { status: 'signedIn' };
  }

  async function validateWithE1(accessToken: string): Promise<string> {
    let response;
    try {
      response = await http.get(CURRENT_USER_PATH, accessToken);
    } catch {
      logger.warn('session', 'E1 failed', { reason: 'network' });
      throw new AuthError('Unknown');
    }
    if (response.status !== 200) {
      logger.warn('session', 'E1 failed', { status: response.status });
      throw new AuthError('Unknown');
    }
    const parsed = userCurrentSchema.safeParse(response.body);
    if (!parsed.success) {
      logger.warn('session', 'E1 failed', { reason: 'shape' });
      throw new AuthError('Unknown');
    }
    return String(parsed.data.id);
  }

  async function discardSaved(): Promise<void> {
    for (const store of [sessionStore, phoneStore]) {
      try {
        await store.clear();
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
    // The phone first and non-fatal (it only prefills re-login): its ADR
    // 0006 recovery may delete the shared keychain file, which must happen
    // before the session is written, never after.
    try {
      await phoneStore.write(phone);
    } catch {
      logger.warn('session', 'phone not saved');
    }
    try {
      await sessionStore.write(JSON.stringify(next));
    } catch {
      logger.error('session', 'save failed; nothing kept');
      await discardSaved();
      throw spent();
    }
    logger.info('session', 'signed in');
    setStatus('signedIn');
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
  };
}

/** The app's SessionManager over the real clients and the keychain. */
export const sessionManager: SessionManager = createSessionManager();
