import { useCallback, useEffect, useState } from 'react';
import { asyncKeyValueStore } from '../platform/asyncKeyValueStore';
import type { KeyValueStore } from '../platform/keyValueStore';
import { logger as appLogger, type Logger } from '../services/logger';

/**
 * A device-scoped preference (AD-4, Epic 8 retro A3): one KeyValueStore key
 * in the `device` store. It survives sign-out and is never registered with
 * AccountScope. The quality, speed, «Системный видеоплеер» and «Запись
 * логов» values are definitions on top of this factory.
 *
 * - Read once per app run, then kept in memory; concurrent reads share one
 *   store read. A pick made while the read runs wins.
 * - `write` updates memory at once and stores in the background.
 * - A failed read or write, or a `kv()` that throws synchronously, only
 *   logs a warning (`<label> not read` / `<label> not stored`), never the
 *   value. An unreadable or junk value is the fallback. A throwing
 *   `onValue` logs `<label> not applied`; nothing escapes.
 * - `remember` (memory only) exists only with `rememberable: true`.
 * - `forget()` (tests only) drops memory, never the store.
 */

export type DevicePreferenceDefinition<T, D> = {
  key: string;
  /** A stored string → the value; anything it does not know → null (the fallback). */
  parse(raw: string | null): T | null;
  serialize(value: T): string;
  /** No value stored, an unreadable or a junk one. */
  fallback: D;
  /** The logger scope and the label of the warnings. */
  scope: string;
  label: string;
  /** Defaults to the app's device store (`setDevicePreferenceKeyValueStore`). */
  kv?: () => KeyValueStore;
  logger?: Logger;
  /** Called whenever memory takes a value (a finished read or a write), before it is stored; never on `remember`. */
  onValue?(value: T | D): void;
  /** Adds `remember` (memory only, no `onValue`). */
  rememberable?: boolean;
};

export type DevicePreference<T, D = T> = {
  readonly fallback: D;
  /** The value in memory; `undefined` until the first read finished. */
  peek(): T | D | undefined;
  /** The value (read from the store once; the fallback when none or unreadable). */
  read(): Promise<T | D>;
  /** Memory at once, the store in the background (a failed write is only logged). */
  write(value: T): void;
  /** Tests: forget the memory copy (the store is untouched). */
  forget(): void;
};

export type RememberablePreference<T, D = T> = DevicePreference<T, D> & {
  /** This run's value, in memory only (not stored). */
  remember(value: T): void;
};

/** Where device preferences persist: the `device` KeyValueStore, unless the app replaced it. */
let deviceKeyValueStore: () => KeyValueStore = () => asyncKeyValueStore('device');

/**
 * Replaces the device preferences' KeyValueStore before first use. Only the
 * debug-only demo calls it (`src/app/session.ts`): its values stay in memory
 * and never touch the owner's real `boostytv-device` database.
 */
export function setDevicePreferenceKeyValueStore(kv: KeyValueStore): void {
  deviceKeyValueStore = () => kv;
}

/** Tests only: back to the app's `device` KeyValueStore. */
export function resetDevicePreferenceKeyValueStore(): void {
  deviceKeyValueStore = () => asyncKeyValueStore('device');
}

export function createDevicePreference<T, D = T>(
  definition: DevicePreferenceDefinition<T, D> & { rememberable: true },
): RememberablePreference<T, D>;
export function createDevicePreference<T, D = T>(definition: DevicePreferenceDefinition<T, D>): DevicePreference<T, D>;
export function createDevicePreference<T, D = T>(
  definition: DevicePreferenceDefinition<T, D>,
): DevicePreference<T, D> | RememberablePreference<T, D> {
  const { key, parse, serialize, fallback, scope, label, onValue } = definition;
  const kv = definition.kv ?? (() => deviceKeyValueStore());
  const logger = definition.logger ?? appLogger;
  let value: T | D | undefined;
  let reading: Promise<T | D> | null = null;
  const apply = (next: T | D) => {
    try {
      onValue?.(next);
    } catch {
      logger.warn(scope, `${label} not applied`);
    }
  };
  const getStored = (): Promise<string | null> => {
    try {
      return kv().get(key);
    } catch (error) {
      // Opening the store threw: the same outcome as a failed read.
      return Promise.reject(error);
    }
  };
  const store: DevicePreference<T, D> = {
    fallback,
    peek: () => value,
    read() {
      if (value !== undefined) {
        return Promise.resolve(value);
      }
      if (reading === null) {
        reading = getStored()
          .then(
            raw => parse(raw) ?? fallback,
            () => {
              logger.warn(scope, `${label} not read`);
              return fallback;
            },
          )
          .then(parsed => {
            reading = null;
            // A pick while the read ran wins (and was applied already).
            if (value === undefined) {
              value = parsed;
              apply(parsed);
            }
            return value;
          });
      }
      return reading;
    },
    write(next) {
      value = next;
      apply(next);
      try {
        kv()
          .set(key, serialize(next))
          .catch(() => logger.warn(scope, `${label} not stored`));
      } catch {
        // The store itself threw (not only its promise): the same outcome.
        logger.warn(scope, `${label} not stored`);
      }
    },
    forget() {
      value = undefined;
      reading = null;
    },
  };
  if (!definition.rememberable) {
    return store;
  }
  return {
    ...store,
    remember(next: T) {
      value = next;
    },
  };
}

type Readable<T, D> = Pick<DevicePreference<T, D>, 'fallback' | 'peek' | 'read' | 'write'>;

/**
 * A preference for one screen: `undefined` until the first read finished (a
 * rejected read is the fallback), then the value; `write` stores it and
 * updates the screen at once. `enabled` false: never read.
 *
 * A single-consumer snapshot, not a subscription: it copies the store's
 * value at mount (and again when `store` changes) and then follows only its
 * own reads and writes. A write elsewhere is not seen until it remounts.
 */
export function usePreference<T, D>(
  store: Readable<T, D>,
  enabled: boolean,
): { value: T | D | undefined; write: (next: T) => void } {
  const [value, setValue] = useState<T | D | undefined>(() => store.peek());
  const [seen, setSeen] = useState(store);
  if (seen !== store) {
    // Another store: start again from its snapshot (adjusting state during render).
    setSeen(store);
    setValue(store.peek());
  }
  useEffect(() => {
    if (!enabled || value !== undefined) {
      return;
    }
    let alive = true;
    store
      .read()
      .catch(() => store.fallback)
      .then(next => {
        if (alive) {
          setValue(next);
        }
      });
    return () => {
      alive = false;
    };
  }, [store, enabled, value]);
  const write = useCallback(
    (next: T) => {
      store.write(next);
      setValue(next);
    },
    [store],
  );
  return { value, write };
}
