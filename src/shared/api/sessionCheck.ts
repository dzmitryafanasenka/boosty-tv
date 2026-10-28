import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import type { ValidateResult } from './sessionManager';

/**
 * SessionCheck (Epic 3 retro A6): the one place that decides whether a
 * «locked» answer may hide a dead session.
 *
 * With a dead or invalid access token Boosty answers content endpoints (E4,
 * E5, E8) with 200 as an anonymous viewer: paid posts come back
 * `hasAccess: false` with empty `data` (api-contract §7). So before a
 * trigger point shows «locked», it asks this port, which runs the existing
 * E1 validation (`SessionManager.validate()`, generation-keyed single
 * flight):
 *
 * - `expired` (E1 401 → refresh 400 `invalid_grant`): the app's status
 *   listener already opens A11; the caller does nothing more.
 * - `refetch` (E1 200, possibly after a silent token refresh): the caller
 *   refetches its locked query once.
 * - `locked` (E1 200 again within the window, a failure, not signed in):
 *   the locked state stays as it is.
 *
 * Rules, per key (a trigger point, `SESSION_CHECK_KEYS`): at most one E1 per
 * cooldown window (5 min from the start of the check; a clock that moved
 * back ends the window); callers that ask while that E1 runs share it. The
 * window is kept only after `ok` or `expired`: a failed or skipped E1 (a
 * network blip) drops it, so the next locked answer checks again (callers
 * that shared it still get `locked`). `ok` yields `refetch` once per window,
 * to the first caller that can still use it (`canRefetch`); a caller that
 * cannot (unmounted) gets `locked` and leaves it for the next one. Known
 * gap: the window is per trigger point, so a session that dies within
 * 5 min after an `ok` is noticed only after the window (or on resume). A
 * locked post or `hasAccess: false` alone is never treated as an expired
 * session: only E1 decides. Nothing here logs.
 */

/** The trigger points (owner decision 2026-10-27). */
export const SESSION_CHECK_KEYS = {
  /** The player's fresh E8 says locked. */
  player: 'player',
  /** The Post screen's E8 says locked. */
  post: 'post',
  /** Главная's page 1 has posts and every one is locked. */
  feed: 'feed',
} as const;

export type SessionCheckKey =
  (typeof SESSION_CHECK_KEYS)[keyof typeof SESSION_CHECK_KEYS];

export type SessionCheckOutcome = 'expired' | 'refetch' | 'locked';

/** What features see: one check per «locked» answer. Never rejects. */
export type SessionCheck = {
  /**
   * `canRefetch` is read when E1 answers: false (the caller went away) →
   * `locked`, and the window's one `refetch` is kept. Default: true.
   */
  check(key: SessionCheckKey, canRefetch?: () => boolean): Promise<SessionCheckOutcome>;
};

/** The app's side: the port plus `reset()` (every session status change). */
export type SessionCheckController = SessionCheck & {
  /** Forgets every window (a new session starts with none). */
  reset(): void;
};

export const SESSION_CHECK_COOLDOWN_MS = 5 * 60 * 1000;

type Window = {
  startedAt: number;
  result: Promise<ValidateResult>;
  /** `refetch` was already handed out in this window. */
  refetchGiven: boolean;
};

export function createSessionCheck({
  validate,
  now = Date.now,
  cooldownMs = SESSION_CHECK_COOLDOWN_MS,
}: {
  /** `SessionManager.validate()`: never rejects. */
  validate: () => Promise<ValidateResult>;
  now?: () => number;
  cooldownMs?: number;
}): SessionCheckController {
  const windows = new Map<SessionCheckKey, Window>();

  return {
    check(key, canRefetch = () => true) {
      const at = now();
      let window = windows.get(key);
      const elapsed = window === undefined ? 0 : at - window.startedAt;
      if (window === undefined || elapsed < 0 || elapsed >= cooldownMs) {
        const started: Window = {
          startedAt: at,
          result: validate().catch(
            (): ValidateResult => ({ kind: 'failed', error: 'Client' }),
          ),
          refetchGiven: false,
        };
        // Only `ok` and `expired` keep the window: after a failed or skipped
        // E1 the next locked answer checks again.
        started.result.then(result => {
          if (
            result.kind !== 'ok' &&
            result.kind !== 'expired' &&
            windows.get(key) === started
          ) {
            windows.delete(key);
          }
        });
        window = started;
        windows.set(key, window);
      }
      const current = window;
      return current.result.then(result => {
        if (result.kind === 'expired') {
          return 'expired';
        }
        // A window dropped by `reset()` (a new session) gives nothing out.
        if (
          result.kind === 'ok' &&
          !current.refetchGiven &&
          windows.get(key) === current &&
          canRefetch()
        ) {
          current.refetchGiven = true;
          return 'refetch';
        }
        return 'locked';
      });
    },
    reset() {
      windows.clear();
    },
  };
}

/** Outside the app (screens rendered alone): never sends anything. */
const NO_CHECK: SessionCheck = {
  check: () => Promise.resolve<SessionCheckOutcome>('locked'),
};

export const SessionCheckContext = createContext<SessionCheck>(NO_CHECK);

/**
 * A trigger for one trigger point: call it when a fresh answer is locked.
 * On `refetch` it calls the latest `onRefetch` (while still mounted);
 * `expired` and `locked` change nothing here. `onOutcome` (optional, per
 * call) hears the outcome while the caller is still mounted (Story 4.4:
 * the player leaves for the Post once the check says `locked`). Stable
 * across renders.
 */
export function useLockedSessionCheck(
  key: SessionCheckKey,
  onRefetch: () => void,
): (onOutcome?: (outcome: SessionCheckOutcome) => void) => void {
  const port = useContext(SessionCheckContext);
  const portRef = useRef(port);
  portRef.current = port;
  const refetchRef = useRef(onRefetch);
  refetchRef.current = onRefetch;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback((onOutcome?: (outcome: SessionCheckOutcome) => void) => {
    portRef.current
      .check(key, () => mounted.current)
      .then(outcome => {
        if (!mounted.current) {
          return;
        }
        onOutcome?.(outcome);
        if (outcome === 'refetch') {
          refetchRef.current();
        }
      })
      .catch(() => {});
  }, [key]);
}
