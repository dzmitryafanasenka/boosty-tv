import { logger as appLogger, type Logger } from '../services/logger';
import { AppError, type AppErrorKind } from './appError';
import type { RefreshResult } from './authApiClient';
import type { AccessGrant, AccessTokenSource } from './httpClient';

/**
 * The single-flight refresh coordinator (AD-3; docs/api-contract.md §2.3
 * «Production refresh-coordinator requirements», binding). Ported from the
 * Story 1.4 spike (`spike/1-4-refresh-logout`), with its gaps fixed:
 * persist before adopt, a timeout on every request (in the clients), a
 * session generation guard and an expiry in epoch milliseconds.
 *
 * - One refresh at a time per session generation; concurrent callers share it.
 * - Proactive: a request starts a refresh when < 300 s remain (also when
 *   `expiresAt` is already in the past, e.g. after a long time off).
 * - After a 401: refresh only if the failed request used the token that is
 *   still current; otherwise the caller retries with the current one.
 * - Only `rejected` (refresh 400 `invalid_grant`) expires the session. Any
 *   other failure keeps the tokens and the request fails with its kind.
 * - Rotation: the new pair is persisted **before** it is adopted. A failed
 *   save keeps the old state (memory and storage) and is its own outcome.
 * - A result from an older generation (sign-out, reload, sign-in since the
 *   refresh started) is dropped and logged; it never changes the status.
 * - After a `failed` refresh, requests that need one fail at once with the
 *   same kind for `REFRESH_COOLDOWN_MS` (401 renewals too); a proactive
 *   refresh that failed while the access token is not past `expiresAt`
 *   sends the request with the current token instead. A new generation
 *   resets the cooldown.
 *
 * Never logs a token, a body or the device id.
 */

/** Proactive refresh window: 300 s before `expiresAt`. */
export const PROACTIVE_WINDOW_MS = 300_000;
/**
 * After a `failed` refresh no new refresh starts for 30 s in the same
 * session generation (owner decision: no sequential refresh storm).
 */
export const REFRESH_COOLDOWN_MS = 30_000;

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

export type RefreshOutcome =
  | { kind: 'refreshed'; accessToken: string }
  /** Refresh 400 `invalid_grant`: the session is `expired`. */
  | { kind: 'rejected' }
  /** Tokens kept, still signed in; the request fails with `error`. */
  | { kind: 'failed'; error: AppErrorKind }
  /** The new pair could not be stored: the old state is kept. */
  | { kind: 'saveFailed' }
  /** The session changed while the refresh ran: the result was dropped. */
  | { kind: 'stale' };

/** SessionManager's state, as the coordinator sees it. */
export type RefreshHost<S extends SessionTokens> = {
  /** The signed-in session and its generation; null when not signed in. */
  current(): { session: S; generation: number } | null;
  isExpired(): boolean;
  isCurrent(generation: number): boolean;
  /**
   * Writes `next` to SecureStore if `generation` is still current when the
   * write runs ('stale' otherwise). Rejects when the write fails.
   */
  persist(next: S, generation: number): Promise<'saved' | 'stale'>;
  /** Makes `next` the in-memory session. False when stale. */
  adopt(next: S, generation: number): boolean;
  /** `signedIn` → `expired`. False when stale or not signed in. */
  expire(generation: number): boolean;
};

/**
 * The session after a successful refresh. A missing refresh token keeps the
 * old one; a missing `expiresIn` (already validated, seconds) keeps the
 * previous expiry.
 */
export function sessionAfterRefresh<S extends SessionTokens>(
  previous: S,
  result: { accessToken: string; refreshToken?: string; expiresIn?: number },
  nowMs: number,
): S {
  return {
    ...previous,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken ?? previous.refreshToken,
    expiresAt:
      result.expiresIn === undefined
        ? previous.expiresAt
        : nowMs + result.expiresIn * 1000,
  };
}

export type RefreshCoordinatorDeps<S extends SessionTokens> = {
  host: RefreshHost<S>;
  refresh(refreshToken: string): Promise<RefreshResult>;
  now?: () => number;
  logger?: Logger;
};

export type RefreshCoordinator = AccessTokenSource;

export function createRefreshCoordinator<S extends SessionTokens>({
  host,
  refresh: sendRefresh,
  now = Date.now,
  logger = appLogger,
}: RefreshCoordinatorDeps<S>): RefreshCoordinator {
  let inFlight: {
    generation: number;
    promise: Promise<RefreshOutcome>;
  } | null = null;
  /** The last `failed` refresh, per generation (the cooldown). */
  let lastFailure: {
    generation: number;
    at: number;
    error: AppErrorKind;
  } | null = null;

  async function run(session: S, generation: number): Promise<RefreshOutcome> {
    let result: RefreshResult;
    try {
      result = await sendRefresh(session.refreshToken);
    } catch {
      result = { kind: 'failed', error: 'Client' };
    }
    if (!host.isCurrent(generation)) {
      logger.info('session', 'refresh result dropped: session changed', {
        result: result.kind,
      });
      return { kind: 'stale' };
    }
    if (result.kind === 'rejected') {
      host.expire(generation);
      return { kind: 'rejected' };
    }
    if (result.kind === 'failed') {
      logger.warn('session', 'refresh failed; tokens kept', {
        kind: result.error,
      });
      return { kind: 'failed', error: result.error };
    }
    const next = sessionAfterRefresh(session, result, now());
    let saved: 'saved' | 'stale';
    try {
      saved = await host.persist(next, generation);
    } catch {
      logger.error('session', 'refreshed session not saved; old session kept');
      return { kind: 'saveFailed' };
    }
    if (saved === 'stale' || !host.adopt(next, generation)) {
      logger.info('session', 'refresh result dropped: session changed', {
        result: 'ok',
      });
      return { kind: 'stale' };
    }
    logger.info('session', 'refreshed');
    return { kind: 'refreshed', accessToken: next.accessToken };
  }

  function refreshFor(session: S, generation: number): Promise<RefreshOutcome> {
    if (inFlight && inFlight.generation === generation) {
      return inFlight.promise;
    }
    if (
      lastFailure &&
      lastFailure.generation === generation &&
      now() - lastFailure.at < REFRESH_COOLDOWN_MS
    ) {
      return Promise.resolve({ kind: 'failed', error: lastFailure.error });
    }
    const promise = run(session, generation)
      .then(outcome => {
        if (outcome.kind === 'failed') {
          lastFailure = { generation, at: now(), error: outcome.error };
        }
        return outcome;
      })
      .finally(() => {
        if (inFlight?.promise === promise) {
          inFlight = null;
        }
      });
    inFlight = { generation, promise };
    return promise;
  }

  /** The error a request fails with when the refresh did not give a token. */
  function failure(
    outcome: Exclude<RefreshOutcome, { kind: 'refreshed' }>,
  ): AppError {
    switch (outcome.kind) {
      case 'rejected':
        return new AppError('SessionExpired');
      case 'failed':
        return new AppError(outcome.error);
      case 'saveFailed':
      case 'stale':
        return new AppError('Client');
    }
  }

  async function getAccessToken(): Promise<AccessGrant | null> {
    if (host.isExpired()) {
      throw new AppError('SessionExpired');
    }
    const current = host.current();
    if (!current) {
      return null;
    }
    const { session, generation } = current;
    if (session.expiresAt - now() >= PROACTIVE_WINDOW_MS) {
      return { token: session.accessToken, refreshed: false };
    }
    const outcome = await refreshFor(session, generation);
    if (outcome.kind === 'refreshed') {
      return { token: outcome.accessToken, refreshed: true };
    }
    if (outcome.kind === 'failed' && session.expiresAt > now()) {
      // Not expired yet: the request goes with the current token.
      return { token: session.accessToken, refreshed: false };
    }
    throw failure(outcome);
  }

  async function renewAfterUnauthorized(
    usedToken: string,
  ): Promise<string | null> {
    if (host.isExpired()) {
      throw new AppError('SessionExpired');
    }
    const current = host.current();
    if (!current) {
      return null;
    }
    const { session, generation } = current;
    if (session.accessToken !== usedToken) {
      // Another call's refresh already replaced the token: retry with it.
      return session.accessToken;
    }
    const outcome = await refreshFor(session, generation);
    if (outcome.kind === 'refreshed') {
      return outcome.accessToken;
    }
    if (outcome.kind === 'stale') {
      return null;
    }
    throw failure(outcome);
  }

  return { getAccessToken, renewAfterUnauthorized };
}
