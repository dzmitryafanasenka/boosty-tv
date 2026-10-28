/**
 * Jest manual mock of @react-native-async-storage/async-storage 3.1.1 (used
 * automatically for the node module; Story 4.2). One in-memory database per
 * `createAsyncStorage(name)`, like the package's own `./jest` mock (which is
 * ESM and not transformed here). Tests can inspect `__databases` and make
 * the next call of a method reject with `__failNext(method, error)`.
 */
const databases = new Map();
const failures = [];

function failure(method) {
  const index = failures.findIndex(f => f.method === method);
  if (index < 0) {
    return undefined;
  }
  return failures.splice(index, 1)[0].error;
}

function database(name) {
  let db = databases.get(name);
  if (!db) {
    db = new Map();
    databases.set(name, db);
  }
  return db;
}

function createAsyncStorage(name) {
  const call = (method, fn) =>
    jest.fn(async (...args) => {
      const error = failure(method);
      if (error) {
        throw error;
      }
      return fn(...args);
    });
  return {
    getItem: call('getItem', async key => database(name).get(key) ?? null),
    setItem: call('setItem', async (key, value) => {
      database(name).set(key, value);
    }),
    removeItem: call('removeItem', async key => {
      database(name).delete(key);
    }),
    getMany: call('getMany', async keys =>
      Object.fromEntries(keys.map(key => [key, database(name).get(key) ?? null])),
    ),
    setMany: call('setMany', async entries => {
      for (const [key, value] of Object.entries(entries)) {
        database(name).set(key, value);
      }
    }),
    removeMany: call('removeMany', async keys => {
      for (const key of keys) {
        database(name).delete(key);
      }
    }),
    getAllKeys: call('getAllKeys', async () => [...database(name).keys()]),
    clear: call('clear', async () => {
      database(name).clear();
    }),
  };
}

class AsyncStorageError extends Error {}

module.exports = {
  __esModule: true,
  createAsyncStorage,
  AsyncStorageError,
  default: createAsyncStorage('legacy'),
  /** Test-only. */
  __databases: databases,
  __failNext(method, error) {
    failures.push({ method, error });
  },
  __reset() {
    databases.clear();
    failures.length = 0;
  },
};
