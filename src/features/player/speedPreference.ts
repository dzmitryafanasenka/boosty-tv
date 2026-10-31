import { tf } from '../../shared/i18n';
import { asyncKeyValueStore } from '../../shared/platform/asyncKeyValueStore';
import type { KeyValueStore } from '../../shared/platform/keyValueStore';
import { logger } from '../../shared/services/logger';

/**
 * The playback speed preference (Story 8.1, PLAY-07, SET-04): one global
 * value, device-scoped like the quality preference (it survives sign-out
 * and is not part of the AccountScope wipe), one KeyValueStore key holding
 * one of the presets as a string (`1.5`).
 *
 * Read once per app run, then kept in memory; a pick updates memory at once
 * and stores it in the background (a failed write is only logged). A value
 * that cannot be read or is not a preset means 1×. The speed is not
 * personal data: the player may log the number.
 */

export const SPEED_PREFERENCE_KEY = 'player.speed.v1';

/** The presets, in menu order (the reference's list, 0.5–3×). */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** No preference, an unreadable or an unknown value. */
export const DEFAULT_SPEED: PlaybackSpeed = 1;

/** The preset → the stored string (`0.75`, `1`, `3`). */
export function serializeSpeed(value: PlaybackSpeed): string {
  return String(value);
}

/** A stored string → the preset; anything else (empty, junk, `9`, ` 1.5`) → null. */
export function parseSpeed(raw: string | null | undefined): PlaybackSpeed | null {
  if (typeof raw !== 'string') {
    return null;
  }
  return PLAYBACK_SPEEDS.find(speed => serializeSpeed(speed) === raw) ?? null;
}

/** «0.5×», «1×», «1.5×» (Q2 a: 1× is «1×» like every other preset). */
export function speedLabel(value: PlaybackSpeed): string {
  return tf('player.speed.value', { speed: serializeSpeed(value) });
}

export type SpeedPreferenceStore = {
  /** The speed in memory; `undefined` until the first read finished. */
  peek(): PlaybackSpeed | undefined;
  /** The speed (read from the store once; 1× when none or unreadable). */
  read(): Promise<PlaybackSpeed>;
  /** Store a pick: memory at once, the store in the background (a failed write is only logged). */
  write(value: PlaybackSpeed): void;
  /** Tests: forget the memory copy (the store is untouched). */
  forget(): void;
};

export function createSpeedPreferenceStore(kv: () => KeyValueStore): SpeedPreferenceStore {
  let value: PlaybackSpeed | undefined;
  let reading: Promise<PlaybackSpeed> | null = null;
  return {
    peek: () => value,
    read() {
      if (value !== undefined) {
        return Promise.resolve(value);
      }
      if (reading === null) {
        reading = kv()
          .get(SPEED_PREFERENCE_KEY)
          .then(
            raw => parseSpeed(raw) ?? DEFAULT_SPEED,
            () => {
              logger.warn('player', 'speed preference not read');
              return DEFAULT_SPEED;
            },
          )
          .then(parsed => {
            // A pick while the read ran wins.
            if (value === undefined) {
              value = parsed;
            }
            reading = null;
            return value;
          });
      }
      return reading;
    },
    write(next) {
      value = next;
      kv()
        .set(SPEED_PREFERENCE_KEY, serializeSpeed(next))
        .catch(() => logger.warn('player', 'speed preference not stored'));
    },
    forget() {
      value = undefined;
      reading = null;
    },
  };
}

/** Where the app's speed persists: the `device` KeyValueStore, unless the app replaced it. */
let appKeyValueStore: () => KeyValueStore = () => asyncKeyValueStore('device');

/**
 * Replaces the speed's KeyValueStore before first use. Only the debug-only
 * demo calls it (`src/app/session.ts`): its speed stays in memory and never
 * touches the owner's real `boostytv-device` database.
 */
export function setSpeedPreferenceKeyValueStore(kv: KeyValueStore): void {
  appKeyValueStore = () => kv;
}

/** The app's speed preference. */
export const speedPreference: SpeedPreferenceStore = createSpeedPreferenceStore(() => appKeyValueStore());
