import {
  phoneSecureStore,
  sessionSecureStore,
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
import { createRefreshCoordinator } from './refreshCoordinator';
import { decodeSession, encode, type StoredSession } from './session/codec';
import { createSessionCore } from './session/core';
import { createRefreshHost } from './session/refreshHost';
import { createSignOut } from './session/signOut';
import {
  CURRENT_USER_PATH,
  type AccountSwitchHook,
  type RestoreResult,
  type SessionManager,
  type SignInArgs,
  type SignInResult,
  type ValidateResult,
} from './session/types';

export {
  CURRENT_USER_PATH,
  type AccountSwitchHook,
  type RestoreResult,
  type SessionManager,
  type SessionStatus,
  type SignInArgs,
  type SignInResult,
  type ValidateResult,
} from './session/types';

/**
 * SessionManager (AD-3): the only reader and writer of tokens. The UI sees
 * only `status` (`signedOut | signedIn | expired`); `HttpClient` gets the
 * token through this manager's `AccessTokenSource`, never from callers.
 *
 * - `restore()` reads the stored session once and keeps it in memory.
 * - Requests refresh through the single-flight coordinator
 *   (`refreshCoordinator.ts`, api-contract §2.3): proactively when < 300 s
 *   remain, once after a 401. Only refresh 400 `invalid_grant` sets
 *   `expired` and replaces the stored session with an expiry marker that
 *   holds no token (`{v:1, expired:true, accountId}`); the phone is kept
 *   for re-login, so the next start opens A11 «Сессия истекла» (Story 2.6).
 * - The stored phone is readable only while the status is `expired`
 *   (`getExpiredPhone`, the A11 → A2 prefill); nothing else hands it out.
 * - `signIn` reports whether the E1 id differs from the previous account
 *   id (the in-memory session or the expiry marker; none counts as changed).
 *   On a change it awaits the injected account-switch hook (Story 2.8, the
 *   app's `AccountScope.reset()`) before anything of the new account is
 *   written; the same account runs no hook.
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
 * token) → compare the account id → on a change (or no previous id) await
 * the account-switch hook → save the phone, then the session, to
 * SecureStore → `signedIn`. The hook's session gate is this manager's own
 * `signOut()`: it clears the old phone, marker and memory, so the status may
 * pass `signedOut` on the way to `signedIn`. The phone is written first and
 * its failure is not fatal; if E1, the hook or the session save fails, the
 * tokens are dropped, nothing of the new account is kept and the call
 * rejects with `AuthError('Unknown')` marked `challengeSpent` (confirm
 * succeeded, so the code cannot be reused).
 *
 * Never logs the phone, the challenge, the code, tokens or the E1 body.
 */

export type SessionManagerDeps = {
  authApi?: AuthApiClient;
  /** Builds the content client over a token source (tests pass a fixture transport). */
  createHttp?: (tokens: AccessTokenSource) => HttpClient;
  sessionStore?: SecureStore;
  phoneStore?: SecureStore;
  now?: () => number;
  logger?: Logger;
  /** The account-switch hook; also settable with `setAccountSwitchHook`. */
  onAccountSwitch?: AccountSwitchHook;
};

export function createSessionManager({
  authApi = authApiClient,
  createHttp = tokens => createHttpClient({ tokens }),
  sessionStore = sessionSecureStore,
  phoneStore = phoneSecureStore,
  now = Date.now,
  logger = appLogger,
  onAccountSwitch,
}: SessionManagerDeps = {}): SessionManager {
  let accountSwitchHook: AccountSwitchHook | null = onAccountSwitch ?? null;
  const core = createSessionCore({ sessionStore, phoneStore, logger });
  let restoring: Promise<RestoreResult> | null = null;
  let signingIn: { key: string; promise: Promise<SignInResult> } | null = null;
  let validating: Promise<ValidateResult> | null = null;
  let appState = 'active';

  const host = createRefreshHost(core, logger);

  const coordinator = createRefreshCoordinator({
    host,
    refresh: refreshToken => authApi.refresh(refreshToken),
    now,
    logger,
  });
  const http = createHttp(coordinator);

  async function readSession(): Promise<RestoreResult> {
    core.resetForRestore();
    const result = await core.readSession();
    if (result.kind === 'empty') {
      // No session, whatever the phone store holds: a kept phone alone may
      // come from a sign-in interrupted between the phone and session writes,
      // so only the expiry marker means `expired`.
      core.setStatus('signedOut');
      return { status: 'signedOut', reason: 'none' };
    }
    if (result.kind !== 'value') {
      core.setStatus('signedOut');
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
      core.setStatus('signedOut');
      try {
        await core.clearSession();
      } catch {
        // Logged by the store; the next start tries again.
      }
      return { status: 'signedOut', reason: 'wiped' };
    }
    if (decoded.kind === 'expired') {
      core.restoreExpired(decoded.accountId);
      return { status: 'expired', reason: 'expired' };
    }
    // A past `expiresAt` is kept as is: the first request refreshes
    // proactively (and E1 runs right after the boot).
    core.restoreSignedIn(decoded.session);
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
    for (const clear of [core.clearSession, core.clearPhone]) {
      try {
        await clear();
      } catch {
        // Logged by the store.
      }
    }
  }

  async function doSignIn({ phone, challenge, smsCode }: SignInArgs): Promise<SignInResult> {
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
    // The previous account: the in-memory session, else the expiry marker.
    const previous = core.current()?.accountId ?? core.previousAccountId();
    const accountChanged = previous === null || previous !== accountId;
    if (accountChanged) {
      // Story 2.8: wipe the previous account before anything of this one is
      // written. The hook's gate is `signOut()` (old phone, marker, memory);
      // it bumps the generation and emits `signedOut`, which navigates
      // nowhere. A failed gate keeps the old data; nothing of this account is
      // stored and the tokens are dropped with this frame. No hook set is
      // a wiring bug: fail closed rather than store B next to A's data.
      if (!accountSwitchHook) {
        logger.error('session', 'no account-switch hook set; nothing kept');
        throw spent();
      }
      try {
        await accountSwitchHook();
      } catch {
        logger.error('session', 'account switch failed; nothing kept');
        throw spent();
      }
      // After the hook: its reset cleared the log ring.
      logger.info('session', 'accountChanged');
    }
    // A new session: any refresh still running for an older one is dropped.
    core.bumpGeneration();
    // The phone first and non-fatal (it only prefills re-login): its ADR
    // 0006 recovery may delete the shared keychain file, which must happen
    // before the session is written, never after.
    try {
      await core.writePhone(phone);
    } catch {
      logger.warn('session', 'phone not saved');
    }
    // Overwrites the expiry marker, if any.
    try {
      await core.writeSession(encode(next));
    } catch {
      logger.error('session', 'save failed; nothing kept');
      await discardSaved();
      throw spent();
    }
    logger.info('session', 'signed in', { accountChanged });
    core.adoptSignedIn(next);
    return { accountChanged };
  }

  async function doValidate(): Promise<ValidateResult> {
    if (core.getStatus() !== 'signedIn') {
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

  const signOut = createSignOut(core, logger);

  function corrupt(token: string): string {
    return token.replace(/[A-Za-z0-9]/g, c =>
      /\d/.test(c) ? String((Number(c) + 5) % 10) : c === 'x' || c === 'X' ? 'q' : 'x',
    );
  }

  return {
    getStatus: core.getStatus,
    subscribe: core.subscribe,
    restore() {
      if (!restoring) {
        restoring = readSession()
          .catch((): RestoreResult => {
            logger.error('session', 'restore failed');
            core.setStatus('signedOut');
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
    async getExpiredPhone() {
      if (core.getStatus() !== 'expired') {
        return null;
      }
      try {
        const phone = await core.readPhone();
        // The status may have changed while reading.
        return core.getStatus() === 'expired' && phone.kind === 'value' ? phone.value : null;
      } catch {
        return null;
      }
    },
    signOut,
    setAccountSwitchHook(hook) {
      accountSwitchHook = hook;
    },
    validate,
    onAppStateChange(next) {
      const previous = appState;
      appState = next;
      return next === 'active' && previous !== 'active' ? validate() : null;
    },
    http,
    authApi: { sendCode: authApi.sendCode, resendCode: authApi.resendCode },
    debugCorruptAccessToken: __DEV__
      ? () => {
          const session = core.current();
          if (core.getStatus() === 'signedIn' && session) {
            core.replaceAccessToken(corrupt(session.accessToken));
            logger.info('session', 'debug: access token corrupted in memory');
          }
          return validate();
        }
      : undefined,
    debugExpireInMemory: __DEV__
      ? () => {
          if (core.getStatus() === 'signedIn' && core.current()) {
            // As `host.expire`, minus the marker write: storage is untouched.
            core.bumpGeneration();
            logger.info('session', 'debug: expired in memory');
            core.markExpired();
          }
        }
      : undefined,
  };
}
