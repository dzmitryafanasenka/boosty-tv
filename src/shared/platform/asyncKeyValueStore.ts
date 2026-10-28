import { createAsyncStorage, type AsyncStorage } from '@react-native-async-storage/async-storage';
import type { KeyValueScope, KeyValueStore } from './keyValueStore';

/**
 * The Android adapter of the `KeyValueStore` port over
 * `@react-native-async-storage/async-storage` 3.1.1 (exact pin, Story 4.2):
 * one database per scope (`createAsyncStorage`), so clearing the account
 * scope never touches the device scope. The native module is opened lazily,
 * on first use. Errors propagate as they are; callers log only an outcome
 * (an async-storage error message can hold a key, never a value we wrote
 * that is secret: nothing secret is stored here).
 */

const DATABASES: Readonly<Record<KeyValueScope, string>> = {
  device: 'boostytv-device',
  account: 'boostytv-account',
};

const opened = new Map<KeyValueScope, AsyncStorage>();

function database(scope: KeyValueScope): AsyncStorage {
  let db = opened.get(scope);
  if (db === undefined) {
    db = createAsyncStorage(DATABASES[scope]);
    opened.set(scope, db);
  }
  return db;
}

/** The store of one scope. */
export function asyncKeyValueStore(scope: KeyValueScope): KeyValueStore {
  return {
    get: key => database(scope).getItem(key),
    set: (key, value) => database(scope).setItem(key, value),
    remove: key => database(scope).removeItem(key),
    clear: () => database(scope).clear(),
  };
}
