import { logger } from '../../shared/services/logger';

/**
 * Debug builds only (Story 4.4 device check): «Сломать следующую ссылку
 * видео» in Настройки arms a one-shot flag; the next source resolution the
 * player plays gets its URL corrupted in memory (its host becomes
 * `boostytv-debug-broken.invalid`, a reserved name that never resolves, so
 * the engine fails with a network error; an extra path segment was tried on
 * the device first and the CDN still served it),
 * which provokes the automatic recovery over wireless adb (a network toggle
 * would drop adb). Exactly one resolution: the recovery's fresh E8 plays
 * normally. The player loads this module with
 * `__DEV__ ? require('./debugBreakSource') : null` into a local binding, so
 * release bundles do not contain it (`__tests__/releaseBundle.test.js`).
 * Nothing here logs a URL.
 */

/** The host of a corrupted URL (RFC 6761 `.invalid`: never resolves). */
const BROKEN_HOST = 'boostytv-debug-broken.invalid';

let armed = false;
/** The resolution that was broken (stays broken on re-renders of that one only). */
let broken: { owner: object; resolution: number } | null = null;

/** Arm the flag: the next resolution that asks is broken. */
export function armBreakNextSource(): void {
  armed = true;
  logger.info('player', 'debug: next video source will be broken');
}

/**
 * Whether `resolution` of the player instance `owner` plays a broken URL:
 * the first one that asks while armed takes the flag.
 */
export function isBroken(owner: object, resolution: number): boolean {
  if (armed) {
    armed = false;
    broken = { owner, resolution };
  }
  return broken !== null && broken.owner === owner && broken.resolution === resolution;
}

/** The URL with an unresolvable host (memory only, never logged). */
export function breakUrl(url: string): string {
  return url.replace(/^(https?:\/\/)[^/?#]+/, `$1${BROKEN_HOST}`);
}

/** Tests: disarm and forget. */
export function resetBreakSource(): void {
  armed = false;
  broken = null;
}
