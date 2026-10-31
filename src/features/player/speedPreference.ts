import { tf } from '../../shared/i18n';
import type { KeyValueStore } from '../../shared/platform/keyValueStore';
import { createDevicePreference, type DevicePreference } from '../../shared/storage/devicePreference';

/**
 * The playback speed preference (Story 8.1, PLAY-07, SET-04): one global
 * value, device-scoped like the quality preference (it survives sign-out
 * and is not part of the AccountScope wipe), one KeyValueStore key holding
 * one of the presets as a string (`1.5`).
 *
 * A `createDevicePreference` definition (read once, a pick wins, failures
 * only logged). A value that cannot be read or is not a preset means 1×.
 * The speed is not personal data: the player may log the number.
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

export type SpeedPreferenceStore = DevicePreference<PlaybackSpeed>;

export function createSpeedPreferenceStore(kv?: () => KeyValueStore): SpeedPreferenceStore {
  return createDevicePreference({
    key: SPEED_PREFERENCE_KEY,
    parse: parseSpeed,
    serialize: serializeSpeed,
    fallback: DEFAULT_SPEED,
    scope: 'player',
    label: 'speed preference',
    kv,
  });
}

/** The app's speed preference (the device store, `setDevicePreferenceKeyValueStore`). */
export const speedPreference: SpeedPreferenceStore = createSpeedPreferenceStore();
