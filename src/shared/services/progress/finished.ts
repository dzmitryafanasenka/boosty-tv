/**
 * The finished rule (ADR 0004, FR-44): a video counts as watched at ≥ 95 %
 * or with less than 30 s left. Playback is never interrupted at the
 * threshold; the rule only picks the resume point (0) and the status.
 * Positions and durations are integer seconds.
 */

export const FINISHED_RATIO = 0.95;
export const FINISHED_TAIL_SEC = 30;

/**
 * True when `positionSec` of `durationSec` counts as finished. A position of
 * 0 is never finished (a video shorter than 30 s is not watched before it
 * started); an unknown duration (null or ≤ 0) is never finished.
 */
export function isFinished(positionSec: number, durationSec: number | null | undefined): boolean {
  if (durationSec === null || durationSec === undefined || durationSec <= 0 || positionSec <= 0) {
    return false;
  }
  return positionSec >= durationSec * FINISHED_RATIO || durationSec - positionSec < FINISHED_TAIL_SEC;
}

/** Whole minutes left, rounded up (at least 1): «Осталось N мин». */
export function remainingMinutes(positionSec: number, durationSec: number): number {
  return Math.max(1, Math.ceil(Math.max(0, durationSec - positionSec) / 60));
}

/** What a MediaRow shows (DESIGN.md MediaRow). */
export type ProgressStatus =
  /** No progress (or 0): «Не начато», no line. */
  | { kind: 'notStarted' }
  /** Started, duration known: «Осталось N мин» and the line at `fraction`. */
  | { kind: 'inProgress'; minutesLeft: number; fraction: number }
  /** Finished: «Просмотрено», a full line. */
  | { kind: 'watched' }
  /** Started, but no known duration: no status, no line (never a fake one). */
  | { kind: 'unknown' };

/** The status of a position against a duration (null: unknown). */
export function progressStatus(positionSec: number | null, durationSec: number | null): ProgressStatus {
  if (positionSec === null || positionSec <= 0) {
    return { kind: 'notStarted' };
  }
  if (durationSec === null || durationSec <= 0) {
    return { kind: 'unknown' };
  }
  if (isFinished(positionSec, durationSec)) {
    return { kind: 'watched' };
  }
  return {
    kind: 'inProgress',
    minutesLeft: remainingMinutes(positionSec, durationSec),
    fraction: Math.min(1, positionSec / durationSec),
  };
}
