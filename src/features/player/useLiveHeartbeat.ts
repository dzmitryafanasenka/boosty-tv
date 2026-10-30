import { useEffect, useRef, type RefObject } from 'react';
import { accountScope } from '../../shared/account';
import { isAppError, type HttpClient } from '../../shared/api';
import { StreamRepository } from '../../shared/entities/stream';
import { useLatestRef } from '../../shared/focus';
import { logger } from '../../shared/services/logger';

/** The reference's `HEARTBEAT_INTERVAL_MS` (Story 7.3, LIVE-03). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Why the schedule stopped for this playback after a failure (no request storm). */
type Halt = 'unauthorized' | 'rateLimited';

/**
 * A failure that stops the schedule: a 401 (a mutation is never replayed, so
 * it surfaces as `Client` with status 401) or a failed renewal
 * (`SessionExpired`) → unauthorized; a 429 → rate limited. Others: null.
 */
function haltFor(error: unknown): Halt | null {
  if (!isAppError(error)) {
    return null;
  }
  if (error.kind === 'SessionExpired' || error.status === 401) {
    return 'unauthorized';
  }
  return error.kind === 'RateLimited' ? 'rateLimited' : null;
}

type Timer = ReturnType<typeof setInterval>;

function clearTimer(timer: RefObject<Timer | null>) {
  if (timer.current !== null) {
    clearInterval(timer.current);
    timer.current = null;
  }
}

/**
 * Story 7.3 (LIVE-03, FR23, api-contract E16): the live viewer heartbeat.
 *
 * - `watching` (the live player is in phase `playing` and not paused): E16
 *   every 30 s; the first one 30 s after watching starts. Leaving it (a
 *   pause, the background, sleep, audio-focus loss, a recovery, an error,
 *   the end) stops the ticks with no stop; watching again restarts the 30 s
 *   schedule.
 * - The single stop (`?stop=true`) goes out on the first of `ended` or the
 *   unmount (every exit path), only if watching started at least once. It
 *   waits for a heartbeat still in flight, so Boosty never gets the stop
 *   before the last heartbeat (fire-and-forget, also after the unmount).
 * - Account-scoped (AD-4): the generation is captured when watching first
 *   starts; after a sign-out or account switch (a bump) nothing is sent, not
 *   even the stop, and the schedule is cleared.
 * - AD-6: a failure is never retried and never touches playback; it logs a
 *   counts-only warning (the `AppError` kind, no blog, URL or token). After
 *   an unauthorized or rate-limited failure the schedule stops for this
 *   playback (no request storm); the stop is still sent after a rate limit,
 *   not after unauthorized. Other failures: the next tick goes out on
 *   schedule. One heartbeat in flight at a time: a tick while the previous
 *   one runs is skipped.
 *
 * `blogUrl` null (a VOD player) disables the hook.
 */
export function useLiveHeartbeat(http: HttpClient, blogUrl: string | null, watching: boolean, ended: boolean): void {
  /** The generation captured when watching first started; null before. */
  const generation = useRef<number | null>(null);
  const stopped = useRef(false);
  const halted = useRef<Halt | null>(null);
  /** The heartbeat in flight (settles, never rejects); null when none. */
  const pending = useRef<Promise<void> | null>(null);
  const timer = useRef<Timer | null>(null);
  const failures = useRef(0);
  const target = useLatestRef({ http, blogUrl });

  const sameAccount = () => generation.current !== null && generation.current === accountScope.generation();

  const onFailure = (error: unknown, stop: boolean) => {
    failures.current += 1;
    logger.warn('live', 'heartbeat failed', {
      stop,
      failures: failures.current,
      kind: isAppError(error) ? error.kind : 'Client',
    });
  };

  const sendStop = useLatestRef(() => {
    const { http: client, blogUrl: blog } = target.current;
    if (blog === null || generation.current === null || stopped.current) {
      return;
    }
    stopped.current = true;
    clearTimer(timer);
    const send = () => {
      if (!sameAccount() || halted.current === 'unauthorized') {
        return;
      }
      StreamRepository.heartbeat(client, blog, { stop: true }).catch(error => onFailure(error, true));
    };
    const before = pending.current;
    if (before === null) {
      send();
    } else {
      before.then(send);
    }
  });

  const tick = useLatestRef(() => {
    const { http: client, blogUrl: blog } = target.current;
    if (blog === null || stopped.current || halted.current !== null) {
      clearTimer(timer);
      return;
    }
    if (!sameAccount()) {
      clearTimer(timer);
      return;
    }
    if (pending.current !== null) {
      return;
    }
    const request: Promise<void> = StreamRepository.heartbeat(client, blog)
      .catch(error => {
        onFailure(error, false);
        const halt = haltFor(error);
        if (halt !== null) {
          halted.current = halt;
          clearTimer(timer);
        }
      })
      .finally(() => {
        if (pending.current === request) {
          pending.current = null;
        }
      });
    pending.current = request;
  });

  const active = blogUrl !== null && watching && !ended;
  useEffect(() => {
    if (!active || stopped.current || halted.current !== null) {
      return;
    }
    if (generation.current === null) {
      generation.current = accountScope.generation();
    }
    timer.current = setInterval(() => tick.current(), HEARTBEAT_INTERVAL_MS);
    return () => clearTimer(timer);
  }, [active, tick]);

  useEffect(() => {
    if (ended) {
      sendStop.current();
    }
  }, [ended, sendStop]);

  // Unmount (any exit path): the stop, unless the end already sent it.
  useEffect(() => () => sendStop.current(), [sendStop]);
}
