/**
 * The pure parts of the player's recovery (Story 4.4): where a broken source
 * continues, and the one-per-episode automatic recovery budget.
 */

/**
 * The start-position gate of one source (Story 4.2): no progress is
 * reported before the start position is reached (never a pre-seek `t=0`).
 * - `load`: waiting for `onLoad` (and the local store); `target` is an
 *   explicit start (a quality switch, Story 4.3, or a recovery / retry,
 *   Story 4.4: the broken source's position), else the resume point (or 0
 *   for «С начала»);
 * - `seek`: the initial seek to `target` is in flight (until its `onSeekDone`);
 * - `first`: starting at 0, the first progress event starts reporting;
 * - `started`: reports flow.
 */
export type StartGate =
  | { kind: 'load'; target?: number }
  | { kind: 'seek'; target: number }
  | { kind: 'first' }
  | { kind: 'started' };

/**
 * The start position a broken source had reached: the current position or
 * a pending seek target once started; before that the pending start (an
 * explicit target, the initial seek's target, 0 when starting at 0, else
 * undefined: the resume point, or 0 for «С начала», is computed again at
 * the next `onLoad`).
 */
export function recoveryTarget(
  gate: StartGate,
  pendingSeek: number | null,
  positionSec: number,
): number | undefined {
  switch (gate.kind) {
    case 'load':
    case 'seek':
      return gate.target;
    case 'first':
      return pendingSeek ?? 0;
    case 'started':
      return pendingSeek ?? positionSec;
  }
}

/** The automatic recovery comes back after the recovered source has played this long. */
export const RECOVERY_BUDGET_SEC = 30;
/** A progress step longer than this is a jump (a seek), not playback. */
export const MAX_PLAY_STEP_SEC = 5;

/**
 * One automatic recovery per error episode: `available` until a recovery
 * uses it; it comes back once `played` (playback steps of the started
 * source, from progress seconds; `last` the previous one) reaches
 * `RECOVERY_BUDGET_SEC`.
 */
export type RecoveryBudget = { available: boolean; played: number; last: number | null };

export function createRecoveryBudget(): RecoveryBudget {
  return { available: true, played: 0, last: null };
}

/**
 * A progress second of the started source: a step of 0 < Δ ≤
 * `MAX_PLAY_STEP_SEC` counts as playback while the budget is used; enough of
 * them give it back. Mutates `budget`.
 */
export function countPlayback(budget: RecoveryBudget, sec: number): void {
  if (!budget.available && budget.last !== null) {
    const step = sec - budget.last;
    if (step > 0 && step <= MAX_PLAY_STEP_SEC) {
      budget.played += step;
      if (budget.played >= RECOVERY_BUDGET_SEC) {
        budget.available = true;
        budget.played = 0;
      }
    }
  }
  budget.last = sec;
}

/** A recovery uses the budget: false when it is already used (the error state instead). */
export function takeRecovery(budget: RecoveryBudget): boolean {
  if (!budget.available) {
    return false;
  }
  budget.available = false;
  budget.played = 0;
  budget.last = null;
  return true;
}
