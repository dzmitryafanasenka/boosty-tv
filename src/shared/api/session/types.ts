import type { AppErrorKind } from '../appError';
import type { AuthApiClient } from '../authApiClient';
import type { HttpClient } from '../httpClient';

/**
 * SessionManager's public contract (ADR 0009, C1). A leaf: imports nothing
 * from `session/` or the facade; `sessionManager.ts` re-exports it unchanged.
 */

export type SessionStatus = 'signedOut' | 'signedIn' | 'expired';

export type RestoreResult =
  | { status: 'signedIn' }
  /**
   * The last session was rejected (refresh 400 `invalid_grant`): only the
   * stored expiry marker means this. The status is `expired`, so the A11
   * prefill can read the phone; the app opens A11.
   */
  | { status: 'expired'; reason: 'expired' }
  | {
      status: 'signedOut';
      /**
       * `none`: nothing stored. `wiped`: the store was corrupted and reset
       * («Войдите снова»). `unavailable`: a transient storage error; the
       * data is kept and the next start reads it again.
       */
      reason: 'none' | 'wiped' | 'unavailable';
    };

/** The outcome of a successful sign-in. */
export type SignInResult = {
  /**
   * The E1 id differs from the previous account id (or there was none). The
   * account-switch hook already wiped the previous account's data (Story
   * 2.8); callers only read it.
   */
  accountChanged: boolean;
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
  signIn(args: SignInArgs): Promise<SignInResult>;
  /**
   * The stored phone (E.164) for the A11 → A2 prefill, or null. Readable
   * only while the status is `expired`; null in any other status, when
   * nothing is stored or the store fails. Never rejects.
   */
  getExpiredPhone(): Promise<string | null>;
  /**
   * Local sign-out (no server call): clears SecureStore first (the phone,
   * then the session or expiry marker), then memory. Rejects with the
   * store's error when a clear fails; the in-memory session and status are
   * then kept, and so is the stored session entry (the phone goes first, so
   * a phone failure changes nothing; a later session failure leaves only the
   * re-login prefill gone). Works from `signedIn`
   * and `expired` (the marker and the phone); drops the account id and the
   * previous account id. The app calls it only through `AccountScope.reset()`
   * (the `session` store, Story 2.7).
   */
  signOut(): Promise<void>;
  /**
   * Sets the account-switch hook (Story 2.8), once, from `app/bootstrap.ts`:
   * the app's `AccountScope.reset()`. `signIn` awaits it when the E1 id
   * differs from the previous account id (or there is none), before the new
   * phone and session are written. A rejection, or no hook set, fails the
   * sign-in as spent and stores nothing.
   */
  setAccountSwitchHook(hook: AccountSwitchHook): void;
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
   * This manager's phone send/resend for A2/A5, and nothing else: confirm and
   * refresh stay behind `signIn` and the refresh coordinator. Screens take it
   * from the active session (`src/app/session.ts`), so a demo run sends
   * nothing to Boosty.
   */
  readonly authApi: Pick<AuthApiClient, 'sendCode' | 'resendCode'>;
  /**
   * Debug builds only (undefined in release): replaces the in-memory access
   * token with a corrupted one of the same length, then runs `validate()`,
   * so E1 → 401 → one real refresh → retry. Storage is not touched.
   */
  readonly debugCorruptAccessToken?: () => Promise<ValidateResult>;
  /**
   * Debug builds only (undefined in release, Story 2.6): sets the status to
   * `expired` in memory only, as a real expiry would, but writes nothing to
   * SecureStore and sends nothing. The next cold start reads the stored
   * session again.
   */
  readonly debugExpireInMemory?: () => void;
};

export const CURRENT_USER_PATH = '/v1/user/current';

/** Wipes every account-scoped store (the app's `AccountScope.reset()`). */
export type AccountSwitchHook = () => Promise<void>;
