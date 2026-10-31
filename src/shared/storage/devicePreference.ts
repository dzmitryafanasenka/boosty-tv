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
 *   value. An unreadable or junk value is the fallback.
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
  /** Called whenever memory takes a value (a finished read or a write), before it is stored. */
  onValue?(value: T | D): void;
};

export type DevicePreference<T, D = T> = {
  readonly fallback: D;
  /** The value in memory; `undefined` until the first read finished. */
  peek(): T | D | undefined;
  /** The value (read from the store once; the fallback when none or unreadable). */
  read(): Promise<T | D>;
  /** Memory at once, the store in the background (a failed write is only logged). */
  write(value: T): void;
  /** This run's value, in memory only (not stored). */
  remember(value: T): void;
  /** Tests: forget the memory copy (the store is untouched). */
  forget(): void;
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

export function createDevicePreference<T, D = T>(definition: DevicePreferenceDefinition<T, D>): DevicePreference<T, D> {
  const { key, parse, serialize, fallback, scope, label, onValue } = definition;
  const kv = definition.kv ?? (() => deviceKeyValueStore());
  const logger = definition.logger ?? appLogger;
  let value: T | D | undefined;
  let reading: Promise<T | D> | null = null;
  const getStored = (): Promise<string | null> => {
    try {
      return kv().get(key);
    } catch (error) {
      // Opening the store threw: the same outcome as a failed read.
      return Promise.reject(error);
    }
  };
  return {
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
            // A pick while the read ran wins (and was applied already).
            if (value === undefined) {
              value = parsed;
              onValue?.(parsed);
            }
            reading = null;
            return value;
          });
      }
      return reading;
    },
    write(next) {
      value = next;
      onValue?.(next);
      try {
        kv()
          .set(key, serialize(next))
          .catch(() => logger.warn(scope, `${label} not stored`));
      } catch {
        // The store itself threw (not only its promise): the same outcome.
        logger.warn(scope, `${label} not stored`);
      }
    },
    remember(next) {
      value = next;
    },
    forget() {
      value = undefined;
      reading = null;
    },
  };
}

type Readable<T, D> = Pick<DevicePreference<T, D>, 'fallback' | 'peek' | 'read' | 'write'>;

/**
 * A preference for a screen: `undefined` until the first read finished (a
 * rejected read is the fallback), then the value; `write` stores it and
 * updates the screen at once. `enabled` false: never read.
 */
export function usePreference<T, D>(
  store: Readable<T, D>,
  enabled: boolean,
): { value: T | D | undefined; write: (next: T) => void } {
  const [value, setValue] = useState<T | D | undefined>(() => store.peek());
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
