import { useCallback, useEffect, useState } from 'react';
import { asyncKeyValueStore } from '../../shared/platform/asyncKeyValueStore';
import type { KeyValueStore } from '../../shared/platform/keyValueStore';
import { logger } from '../../shared/services/logger';

/**
 * The «Системный видеоплеер» preference (Story 8.2, PLAY-13, SET-02):
 * device-scoped (owner decision 2026-10-31), like the quality and speed
 * preferences: it survives sign-out and is not registered with
 * AccountScope. One KeyValueStore key holding `on` or `off`; default off.
 *
 * Read once per app run, then kept in memory; a toggle updates memory at
 * once and stores it in the background (a failed write is only logged, the
 * UI still flips). A value that cannot be read or is unknown means off.
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

export type ExternalPlayerPreferenceStore = {
  /** The value in memory; `undefined` until the first read finished. */
  peek(): boolean | undefined;
  /** The value (read from the store once; off when none or unreadable). */
  read(): Promise<boolean>;
  /** Store a value: memory at once, the store in the background (a failed write is only logged). */
  write(on: boolean): void;
  /** Tests: forget the memory copy (the store is untouched). */
  forget(): void;
};

/** `kv().get`, with a synchronous throw (opening the store) turned into a rejection. */
function getStored(kv: () => KeyValueStore): Promise<string | null> {
  try {
    return kv().get(EXTERNAL_PLAYER_PREFERENCE_KEY);
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createExternalPlayerPreferenceStore(kv: () => KeyValueStore): ExternalPlayerPreferenceStore {
  let value: boolean | undefined;
  let reading: Promise<boolean> | null = null;
  return {
    peek: () => value,
    read() {
      if (value !== undefined) {
        return Promise.resolve(value);
      }
      if (reading === null) {
        reading = getStored(kv)
          .then(
            raw => parseExternalPlayer(raw) ?? false,
            () => {
              logger.warn('player', 'external player preference not read');
              return false;
            },
          )
          .then(parsed => {
            // A toggle while the read ran wins.
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
      try {
        kv()
          .set(EXTERNAL_PLAYER_PREFERENCE_KEY, serializeExternalPlayer(next))
          .catch(() => logger.warn('player', 'external player preference not stored'));
      } catch {
        // The store itself threw (not only its promise): the same outcome.
        logger.warn('player', 'external player preference not stored');
      }
    },
    forget() {
      value = undefined;
      reading = null;
    },
  };
}

/** Where the app's value persists: the `device` KeyValueStore, unless the app replaced it. */
let appKeyValueStore: () => KeyValueStore = () => asyncKeyValueStore('device');

/**
 * Replaces the preference's KeyValueStore before first use. Only the
 * debug-only demo calls it (`src/app/session.ts`): its value stays in
 * memory and never touches the owner's real `boostytv-device` database.
 */
export function setExternalPlayerPreferenceKeyValueStore(kv: KeyValueStore): void {
  appKeyValueStore = () => kv;
}

/** The app's «Системный видеоплеер» preference. */
export const externalPlayerPreference: ExternalPlayerPreferenceStore = createExternalPlayerPreferenceStore(() =>
  appKeyValueStore(),
);

/**
 * The value for a screen: `undefined` until the first read finished, then
 * on / off; `toggle` flips it at once and stores it in the background.
 * `enabled` false (the phase flag off): never read.
 */
export function useExternalPlayerPreference(enabled: boolean): { on: boolean | undefined; toggle: () => void } {
  const [on, setOn] = useState<boolean | undefined>(() => externalPlayerPreference.peek());
  useEffect(() => {
    if (!enabled || on !== undefined) {
      return;
    }
    let alive = true;
    externalPlayerPreference.read().then(value => {
      if (alive) {
        setOn(value);
      }
    });
    return () => {
      alive = false;
    };
  }, [enabled, on]);
  const toggle = useCallback(() => {
    const next = !(externalPlayerPreference.peek() ?? false);
    externalPlayerPreference.write(next);
    setOn(next);
  }, []);
  return { on, toggle };
}
