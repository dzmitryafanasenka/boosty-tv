/**
 * Story 9.3: the time-to-first-frame mark. The press that opens the Player
 * (a post's video row or «Смотреть», a «Продолжить» card, a timestamp chip,
 * a live card) records when it happened and where it came from; the Player
 * takes it once when it mounts and logs one `first frame` line at the first
 * rendered frame of that opening. Module-level and in memory only: it holds
 * a timestamp and an origin tag, never an id, a URL or account data.
 */

/** Where the Player was opened from (the `origin` field of the `first frame` line). */
export type PlayerOpenOrigin = 'post' | 'continue' | 'timestamp' | 'live';

export type PlayerOpenMark = {
  origin: PlayerOpenOrigin;
  /** Monotonic milliseconds of the opening press (`performance.now()`). */
  at: number;
};

/** Hermes' `performance` global (the app's TypeScript libs do not declare it). */
declare const performance: { now(): number };

let pending: PlayerOpenMark | null = null;

/** The monotonic clock of the mark and the first frame (not the wall clock, which can jump). */
export function playerClockNow(): number {
  return performance.now();
}

export const playerOpenMark = {
  /** The opening press; a later press replaces an untaken mark. */
  mark(origin: PlayerOpenOrigin, at: number = playerClockNow()): void {
    pending = { origin, at };
  },
  /** The pending mark, cleared: a second take returns null. */
  take(): PlayerOpenMark | null {
    const mark = pending;
    pending = null;
    return mark;
  },
};
