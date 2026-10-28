import { motion } from '../../shared/ui';

/**
 * Remote seeking (Story 4.1, docs/focus-map.md §4 G). Pure logic over the
 * global timers (fake timers in tests).
 *
 * - Each press moves a pending target; the bubble shows it. The seek is
 *   committed once, `SEEK_COMMIT_MS` (600 ms) after the last press.
 * - A press builds on the pending target, else on the target of a seek
 *   still in flight (committed, not reported done), else on the position:
 *   never on the stale position while a seek runs (device: Story 1.6).
 * - Acceleration (spec decision): the pinned remote's D-pad reaches JS as
 *   key up only (Story 1.6), so a held key cannot be told from quick
 *   presses. Each press within the bubble window (a target is still
 *   pending) grows the step along `SEEK_STEPS_SEC`: 5, 5, 10, 10, 20, 30 s,
 *   then 30 s. A direction change starts over at 5 s.
 * - Targets are whole seconds, clamped to [0, duration − 1] when the
 *   duration is known.
 * - A held key (owner decision 2026-10-27, device check): `markHeld()` turns
 *   the pending target into a held one. It is never committed by a timer:
 *   OK commits it (`commitNow`), Back cancels it (`cancel`), and
 *   `HELD_TARGET_IDLE_MS` without a press cancels it. Further presses build
 *   on it and restart that timeout. Cancelling never commits.
 */

export const SEEK_COMMIT_MS = motion['seek-commit'].delay;
export const SEEK_STEPS_SEC = [5, 5, 10, 10, 20, 30] as const;
/** A held target (owner decision 2026-10-27) is cancelled after this long without input. */
export const HELD_TARGET_IDLE_MS = 5_000;
/** A committed seek that never reports done stops counting as in flight after this. */
export const SEEK_IN_FLIGHT_TIMEOUT_MS = 5_000;

/** A seek report this close to the in-flight target ends it. */
export const SEEK_DONE_TOLERANCE_SEC = 1;

export type SeekDirection = 1 | -1;

export type SeekControllerOptions = {
  /** Commit the seek (the engine's `seek`). */
  onCommit: (targetSec: number) => void;
  /** The pending or in-flight target changed (re-render the bubble). */
  onChange: () => void;
  /** A held scrub started (`markHeld` on a pending target). */
  onHeldStart?: () => void;
  /** A held scrub ended: committed (OK) or cancelled (Back, 5 s idle). Not on `reset`. */
  onHeldEnd?: (committed: boolean) => void;
};

export type SeekController = {
  /**
   * One press: the new pending target. `positionSec` is the playback
   * position, `durationSec` 0 or null when unknown. `stepSec` fixes the step
   * (the ±10 s controls, Story 4.3 owner decision: exactly 10 s per OK,
   * no acceleration); without it the step grows along `SEEK_STEPS_SEC`.
   */
  press(direction: SeekDirection, positionSec: number, durationSec: number | null, stepSec?: number): number;
  /** The bubble's target: pending, else in flight; null when not seeking. */
  target(): number | null;
  /** A target is pending or a committed seek is in flight. */
  isSeeking(): boolean;
  /**
   * Commit a pending target now (OK or Play/Pause during the bubble window).
   * True when a target was pending.
   */
  commitNow(): boolean;
  /**
   * The engine reported a finished seek at `positionSec`. Only a report
   * matching the in-flight target (±1 s) ends it: a late report of an
   * earlier seek must not clear a newer target.
   */
  seekDone(positionSec: number): void;
  /**
   * A key is held (a repeat arrived): the pending target stays until OK,
   * Back or `HELD_TARGET_IDLE_MS` without a press. No-op without a target.
   */
  markHeld(): void;
  /** A held target is pending (Back cancels it first). */
  isHeld(): boolean;
  /** Drop the pending target without committing it. */
  cancel(): void;
  /** Drop everything (a new source, unmount). */
  reset(): void;
};

export function createSeekController({
  onCommit,
  onChange,
  onHeldStart,
  onHeldEnd,
}: SeekControllerOptions): SeekController {
  let pending: number | null = null;
  let inFlight: number | null = null;
  let streak = 0;
  let lastDirection: SeekDirection | null = null;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  let flightTimer: ReturnType<typeof setTimeout> | null = null;
  let held = false;

  /** The next timer for the pending target: commit (600 ms), or for a held one, cancel (5 s). */
  const schedule = () => {
    if (commitTimer !== null) {
      clearTimeout(commitTimer);
    }
    commitTimer = held
      ? setTimeout(() => {
          commitTimer = null;
          cancelPending();
        }, HELD_TARGET_IDLE_MS)
      : setTimeout(commit, SEEK_COMMIT_MS);
  };

  const cancelPending = () => {
    if (commitTimer !== null) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
    const had = pending !== null;
    const wasHeld = held;
    pending = null;
    held = false;
    if (had) {
      onChange();
    }
    if (wasHeld) {
      onHeldEnd?.(false);
    }
  };

  const clearTimers = () => {
    if (commitTimer !== null) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
    if (flightTimer !== null) {
      clearTimeout(flightTimer);
      flightTimer = null;
    }
  };

  const commit = () => {
    commitTimer = null;
    const wasHeld = held;
    held = false;
    if (pending === null) {
      return;
    }
    inFlight = pending;
    pending = null;
    if (flightTimer !== null) {
      clearTimeout(flightTimer);
    }
    flightTimer = setTimeout(() => {
      flightTimer = null;
      inFlight = null;
      onChange();
    }, SEEK_IN_FLIGHT_TIMEOUT_MS);
    onCommit(inFlight);
    onChange();
    if (wasHeld) {
      onHeldEnd?.(true);
    }
  };

  return {
    press(direction, positionSec, durationSec, stepSec) {
      const withinWindow = pending !== null && lastDirection === direction;
      streak = withinWindow ? streak + 1 : 0;
      lastDirection = direction;
      const step = stepSec ?? SEEK_STEPS_SEC[Math.min(streak, SEEK_STEPS_SEC.length - 1)];
      const base = pending ?? inFlight ?? positionSec;
      const max = durationSec !== null && durationSec > 0 ? durationSec - 1 : Infinity;
      pending = Math.max(0, Math.min(max, Math.round(base + direction * step)));
      schedule();
      onChange();
      return pending;
    },
    target: () => pending ?? inFlight,
    isSeeking: () => pending !== null || inFlight !== null,
    commitNow() {
      if (pending === null) {
        return false;
      }
      if (commitTimer !== null) {
        clearTimeout(commitTimer);
      }
      commit();
      return true;
    },
    seekDone(positionSec) {
      if (inFlight === null || Math.abs(positionSec - inFlight) > SEEK_DONE_TOLERANCE_SEC) {
        return;
      }
      inFlight = null;
      if (flightTimer !== null) {
        clearTimeout(flightTimer);
        flightTimer = null;
      }
      onChange();
    },
    markHeld() {
      if (pending === null || held) {
        return;
      }
      held = true;
      schedule();
      onHeldStart?.();
    },
    isHeld: () => held && pending !== null,
    cancel: cancelPending,
    reset() {
      clearTimers();
      held = false;
      pending = null;
      inFlight = null;
      streak = 0;
      lastDirection = null;
    },
  };
}
