import { asyncKeyValueStore } from '../../shared/platform/asyncKeyValueStore';
import type { KeyValueStore } from '../../shared/platform/keyValueStore';
import { logger } from '../../shared/services/logger';
import type { QualityKey } from './mediaResolver';

/**
 * The quality preference (Story 4.3): device-scoped (it survives sign-out
 * and belongs to the TV, not the account), one KeyValueStore key holding
 * `auto` or a progressive height (`720`). Never a URL or a Boosty `type`.
 *
 * Read once per app run, then kept in memory; a pick updates memory at once
 * (`remember`) and the player stores it (`write`) once the picked source
 * loaded. A value that cannot be read or parsed is
 * no preference (the default order). Nothing here logs the value.
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

export type QualityPreferenceStore = {
  /** The preference in memory; `undefined` until the first read finished. */
  peek(): QualityKey | null | undefined;
  /** The preference (read from the store once; null when none or unreadable). */
  read(): Promise<QualityKey | null>;
  /** This run's choice, in memory only (not stored). */
  remember(value: QualityKey): void;
  /** Store a choice: memory at once, the store in the background (a failed write is only logged). */
  write(value: QualityKey): void;
  /** Tests: forget the memory copy (the store is untouched). */
  forget(): void;
};

export function createQualityPreferenceStore(kv: () => KeyValueStore): QualityPreferenceStore {
  let value: QualityKey | null | undefined;
  let reading: Promise<QualityKey | null> | null = null;
  return {
    peek: () => value,
    read() {
      if (value !== undefined) {
        return Promise.resolve(value);
      }
      if (reading === null) {
        const pending = kv()
          .get(QUALITY_PREFERENCE_KEY)
          .then(
            raw => parseQualityPreference(raw),
            () => {
              logger.warn('player', 'quality preference not read');
              return null;
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
        reading = pending;
      }
      return reading;
    },
    remember(next) {
      value = next;
    },
    write(next) {
      value = next;
      kv()
        .set(QUALITY_PREFERENCE_KEY, serializeQualityPreference(next))
        .catch(() => logger.warn('player', 'quality preference not stored'));
    },
    forget() {
      value = undefined;
      reading = null;
    },
  };
}

/** Where the app's preference persists: the `device` KeyValueStore, unless the app replaced it. */
let appKeyValueStore: () => KeyValueStore = () => asyncKeyValueStore('device');

/**
 * Replaces the preference's KeyValueStore before first use. Only the
 * debug-only demo calls it (`src/app/session.ts`): its preference stays in
 * memory and never touches the owner's real `boostytv-device` database.
 */
export function setQualityPreferenceKeyValueStore(kv: KeyValueStore): void {
  appKeyValueStore = () => kv;
}

/** The app's quality preference. */
export const qualityPreference: QualityPreferenceStore = createQualityPreferenceStore(() => appKeyValueStore());
