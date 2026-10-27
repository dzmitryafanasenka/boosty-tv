import {
  phoneSecureStore,
  sessionSecureStore,
  type SecureStore,
} from '../platform/secureStore';
import { logger as appLogger, type Logger } from '../services/logger';
import { authApiClient, type AuthApiClient } from './authApiClient';
import {
  createHttpClient,
  type AccessTokenSource,
  type HttpClient,
} from './httpClient';
import { createRefreshCoordinator } from './refreshCoordinator';
import { createSessionCore } from './session/core';
import { createLifecycle } from './session/lifecycle';
import { createRefreshHost } from './session/refreshHost';
import { createRestore } from './session/restore';
import { createSignIn } from './session/signIn';
import { createSignOut } from './session/signOut';
import type { AccountSwitchHook, SessionManager } from './session/types';

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
  const core = createSessionCore({ sessionStore, phoneStore, logger });

  const host = createRefreshHost(core, logger);

  const coordinator = createRefreshCoordinator({
    host,
    refresh: refreshToken => authApi.refresh(refreshToken),
    now,
    logger,
  });
  const http = createHttp(coordinator);

  const { restore, getExpiredPhone } = createRestore(core, logger);

  const { signIn, setAccountSwitchHook } = createSignIn({
    core,
    authApi,
    createHttp,
    now,
    logger,
    onAccountSwitch,
  });

  const { validate, onAppStateChange } = createLifecycle({ core, http, logger });

  const signOut = createSignOut(core, logger);

  function corrupt(token: string): string {
    return token.replace(/[A-Za-z0-9]/g, c =>
      /\d/.test(c) ? String((Number(c) + 5) % 10) : c === 'x' || c === 'X' ? 'q' : 'x',
    );
  }

  return {
    getStatus: core.getStatus,
    subscribe: core.subscribe,
    restore,
    signIn,
    getExpiredPhone,
    signOut,
    setAccountSwitchHook,
    validate,
    onAppStateChange,
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
