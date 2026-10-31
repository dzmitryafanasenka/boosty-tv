import type { KeyValueStore } from '../../shared/platform/keyValueStore';
import { createDevicePreference, type DevicePreference } from '../../shared/storage/devicePreference';
import type { QualityKey } from './mediaResolver';

/**
 * The quality preference (Story 4.3): device-scoped (it survives sign-out
 * and belongs to the TV, not the account), one KeyValueStore key holding
 * `auto` or a progressive height (`720`). Never a URL or a Boosty `type`.
 *
 * A `createDevicePreference` definition: a pick updates memory at once
 * (`remember`) and the player stores it (`write`) once the picked source
 * loaded. A value that cannot be read or parsed is no preference (null, the
 * default order). Nothing here logs the value.
 */

export const QUALITY_PREFERENCE_KEY = 'player.quality.v1';

/** The tallest height a stored value may hold (api-contract §6 tops out at 2160p; 4320p leaves room). */
const MAX_HEIGHT = 4320;

/** A stored string → the preference; anything else (empty, junk, a URL, a fraction) → null. */
export function parseQualityPreference(raw: string | null | undefined): QualityKey | null {
  if (raw === 'auto') {
    return 'auto';
  }
  if (typeof raw !== 'string' || !/^[1-9]\d{1,3}$/.test(raw)) {
    return null;
  }
  const height = Number(raw);
  return height <= MAX_HEIGHT ? height : null;
}

/** The preference → the stored string. */
export function serializeQualityPreference(value: QualityKey): string {
  return value === 'auto' ? 'auto' : String(Math.floor(value));
}

/** `remember` is this run's choice in memory only; `write` also stores it. */
export type QualityPreferenceStore = DevicePreference<QualityKey, null>;

export function createQualityPreferenceStore(kv?: () => KeyValueStore): QualityPreferenceStore {
  return createDevicePreference<QualityKey, null>({
    key: QUALITY_PREFERENCE_KEY,
    parse: parseQualityPreference,
    serialize: serializeQualityPreference,
    fallback: null,
    scope: 'player',
    label: 'quality preference',
    kv,
  });
}

/** The app's quality preference (the device store, `setDevicePreferenceKeyValueStore`). */
export const qualityPreference: QualityPreferenceStore = createQualityPreferenceStore();
