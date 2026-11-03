/**
 * Story 14.1 (FR-65): the wall-clock time left in a VOD at a playback speed,
 * and the clock time it ends. Shared with the sleep timer «До конца видео»
 * (Story 14.2). Whole media seconds in, milliseconds out.
 */

/** Wall-clock milliseconds until the end at `rate`; null without a known duration or a positive rate. */
export function remainingWallMs(positionSec: number, durationSec: number, rate: number): number | null {
  if (!(durationSec > 0) || !(rate > 0)) {
    return null;
  }
  return (Math.max(0, durationSec - positionSec) / rate) * 1000;
}

/** The clock time (epoch ms) the VOD ends: now plus `remainingWallMs`. */
export function endTimeMs(nowMs: number, positionSec: number, durationSec: number, rate: number): number | null {
  const left = remainingWallMs(positionSec, durationSec, rate);
  return left === null ? null : nowMs + left;
}

/**
 * The shown end time only moves when the new value differs by more than this:
 * the position ticks in whole seconds while the clock runs on, so the raw value
 * wobbles by about a second and would flip «21:49» ↔ «21:50» at a minute edge.
 */
export const END_TIME_HYSTERESIS_MS = 20_000;

/** The end time to show, given the one shown before (hysteresis, see above). */
export function stableEndTime(previousMs: number | null, nextMs: number | null): number | null {
  if (nextMs === null || previousMs === null) {
    return nextMs;
  }
  return Math.abs(nextMs - previousMs) <= END_TIME_HYSTERESIS_MS ? previousMs : nextMs;
}
