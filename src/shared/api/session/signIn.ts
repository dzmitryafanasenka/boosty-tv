import type { Logger } from '../../services/logger';
import { isAppError } from '../appError';
import type { AuthApiClient } from '../authApiClient';
import { AuthError, isAuthError } from '../authError';
import { userCurrentSchema } from '../dto/userCurrent';
import { fixedAccessToken, type AccessTokenSource, type HttpClient } from '../httpClient';
import { encode, type StoredSession } from './codec';
import type { SessionCore } from './core';
import {
  CURRENT_USER_PATH,
  type AccountSwitchHook,
  type SignInArgs,
  type SignInResult,
} from './types';

export type SessionSignIn = {
  /** Rejects with `AuthError` only. */
  signIn(args: SignInArgs): Promise<SignInResult>;
  setAccountSwitchHook(hook: AccountSwitchHook): void;
};

/**
 * Sign-in (ADR 0009, C8 and C9). Order: confirm (AuthApiClient) → E1
 * (content profile, with the new token) → compare the account id → on a
 * change (or no previous id) await the account-switch hook → save the
 * phone, then the session → `signedIn`. After confirm succeeded, every
 * failure is `AuthError('Unknown')` marked `challengeSpent`. Single-flight:
 * the same phone/challenge/code returns the running promise; a different
 * concurrent sign-in rejects.
 *
 * Never logs the phone, the challenge, the code, tokens or the E1 body.
 */
export function createSignIn({
  core,
  authApi,
  createHttp,
  now,
  logger,
  onAccountSwitch,
}: {
  core: SessionCore;
  authApi: AuthApiClient;
  createHttp: (tokens: AccessTokenSource) => HttpClient;
  now: () => number;
  logger: Logger;
  onAccountSwitch?: AccountSwitchHook;
}): SessionSignIn {
  let accountSwitchHook: AccountSwitchHook | null = onAccountSwitch ?? null;
  let signingIn: { key: string; promise: Promise<SignInResult> } | null = null;

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

  return {
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
    setAccountSwitchHook(hook) {
      accountSwitchHook = hook;
    },
  };
}
