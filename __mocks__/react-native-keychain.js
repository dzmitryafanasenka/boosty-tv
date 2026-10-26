/**
 * Jest manual mock of react-native-keychain (used automatically for the
 * node module). An in-memory store per service; tests can inspect it and
 * make the next calls reject with `__failNext(method, error)`.
 */
const values = new Map();
const failures = { getGenericPassword: [], setGenericPassword: [], resetGenericPassword: [] };

function nextFailure(method) {
  return failures[method].shift();
}

module.exports = {
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  getGenericPassword: jest.fn(async ({ service }) => {
    const failure = nextFailure('getGenericPassword');
    if (failure) {
      throw failure;
    }
    return values.has(service)
      ? { service, username: 'boostytv', password: values.get(service), storage: 'KeystoreAESGCM_NoAuth' }
      : false;
  }),
  setGenericPassword: jest.fn(async (_username, password, { service }) => {
    const failure = nextFailure('setGenericPassword');
    if (failure) {
      throw failure;
    }
    values.set(service, password);
    return { service, storage: 'KeystoreAESGCM_NoAuth' };
  }),
  resetGenericPassword: jest.fn(async ({ service }) => {
    const failure = nextFailure('resetGenericPassword');
    if (failure) {
      throw failure;
    }
    values.delete(service);
    return true;
  }),
  /** Test-only. */
  __values: values,
  __failNext(method, error) {
    failures[method].push(error);
  },
  __reset() {
    values.clear();
    for (const key of Object.keys(failures)) {
      failures[key].length = 0;
    }
  },
};
