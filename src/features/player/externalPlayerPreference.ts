import { useCallback } from 'react';
import type { KeyValueStore } from '../../shared/platform/keyValueStore';
import { createDevicePreference, usePreference, type DevicePreference } from '../../shared/storage/devicePreference';

/**
 * The «Системный видеоплеер» preference (Story 8.2, PLAY-13, SET-02):
 * device-scoped (owner decision 2026-10-31), like the quality and speed
 * preferences: it survives sign-out and is not registered with
 * AccountScope. One KeyValueStore key holding `on` or `off`; default off.
 *
 * A `createDevicePreference` definition: a toggle updates memory at once
 * and stores it in the background (a failed write is only logged, the UI
 * still flips). A value that cannot be read or is unknown means off.
 */

export const EXTERNAL_PLAYER_PREFERENCE_KEY = 'player.external.v1';

/** A stored string → on / off; anything else (empty, junk, `true`) → null. */
export function parseExternalPlayer(raw: string | null | undefined): boolean | null {
  if (raw === 'on') {
    return true;
  }
  if (raw === 'off') {
    return false;
  }
  return null;
}

/** On / off → the stored string. */
export function serializeExternalPlayer(on: boolean): string {
  return on ? 'on' : 'off';
}

export type ExternalPlayerPreferenceStore = Omit<DevicePreference<boolean>, 'remember'>;

export function createExternalPlayerPreferenceStore(kv?: () => KeyValueStore): ExternalPlayerPreferenceStore {
  return createDevicePreference({
    key: EXTERNAL_PLAYER_PREFERENCE_KEY,
    parse: parseExternalPlayer,
    serialize: serializeExternalPlayer,
    fallback: false,
    scope: 'player',
    label: 'external player preference',
    kv,
  });
}

/** The app's «Системный видеоплеер» preference (the device store, `setDevicePreferenceKeyValueStore`). */
export const externalPlayerPreference: ExternalPlayerPreferenceStore = createExternalPlayerPreferenceStore();

/**
 * The value for a screen: `undefined` until the first read finished, then
 * on / off; `toggle` flips it at once and stores it in the background.
 * `enabled` false (the phase flag off): never read.
 */
export function useExternalPlayerPreference(enabled: boolean): { on: boolean | undefined; toggle: () => void } {
  const { value: on, write } = usePreference(externalPlayerPreference, enabled);
  const toggle = useCallback(() => write(!(externalPlayerPreference.peek() ?? false)), [write]);
  return { on, toggle };
}
