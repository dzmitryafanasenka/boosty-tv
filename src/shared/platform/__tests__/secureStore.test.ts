import { createLogger } from '../../services/logger';
import { NativeModules } from 'react-native';
import {
  classifyStoreError,
  keychainStorageReset,
  createSecureStore,
  errorLabel,
  SecureStoreError,
  type KeychainLike,
} from '../secureStore';

const SECRET = 'secret-token-value-1234567890-abcdefghijkl';

/** Mirrors how RN rejects a native promise: Error + code. */
function nativeError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

/** The device shapes from Story 1.2/1.3 (ADR 0006 gate). */
const corruption = () =>
  nativeError(
    'E_UNKNOWN_ERROR',
    'androidx.datastore.core.CorruptionException: Unable to parse preferences proto.',
  );
const crypto = () =>
  nativeError('E_CRYPTO_FAILED', 'Decryption failed: Authentication tag verification failed.');
const invalidated = () =>
  nativeError(
    'E_UNKNOWN_ERROR',
    'android.security.keystore.KeyPermanentlyInvalidatedException: Key permanently invalidated',
  );
const transient = () => nativeError('E_KEYSTORE_ACCESS_ERROR', `Keystore not ready ${SECRET}`);

function setup() {
  let stored: string | null = null;
  const fail: Partial<Record<keyof KeychainLike, unknown[]>> = {};
  const next = (method: keyof KeychainLike) => fail[method]?.shift();
  const keychain = {
    getGenericPassword: jest.fn(async () => {
      const error = next('getGenericPassword');
      if (error) {
        throw error;
      }
      return stored === null ? (false as const) : { password: stored };
    }),
    setGenericPassword: jest.fn(async (_u: string, password: string) => {
      const error = next('setGenericPassword');
      if (error) {
        throw error;
      }
      stored = password;
      return { storage: 'KeystoreAESGCM_NoAuth' };
    }),
    resetGenericPassword: jest.fn(async () => {
      const error = next('resetGenericPassword');
      if (error) {
        throw error;
      }
      stored = null;
      return true;
    }),
  } satisfies KeychainLike;
  const helper = { deleteKeychainStorage: jest.fn(async () => true) };
  const logger = createLogger();
  const store = createSecureStore({ service: 'boostytv.session', keychain, helper, logger });
  return {
    keychain,
    helper,
    store,
    logger,
    peek: () => stored,
    seed: (value: string) => {
      stored = value;
    },
    failNext: (method: keyof KeychainLike, ...errors: unknown[]) => {
      fail[method] = [...(fail[method] ?? []), ...errors];
    },
  };
}

describe('classifyStoreError (ADR 0006)', () => {
  test.each([
    ['CorruptionException', corruption(), 'storage-unreadable'],
    ['CryptoFailedException', crypto(), 'value-undecryptable'],
    ['KeyPermanentlyInvalidatedException', invalidated(), 'value-undecryptable'],
    ['Keystore access', transient(), 'other'],
    ['plain Error', new Error('Network'), 'other'],
    ['string', 'string error', 'other'],
    ['undefined', undefined, 'other'],
  ])('%s → %s', (_name, error, kind) => {
    expect(classifyStoreError(error)).toBe(kind);
  });

  test('labels never include the free-form message', () => {
    expect(errorLabel(transient())).toBe('E_KEYSTORE_ACCESS_ERROR Error');
    expect(errorLabel(corruption())).toBe('E_UNKNOWN_ERROR CorruptionException');
    expect(errorLabel(transient())).not.toContain(SECRET);
  });
});

describe('read', () => {
  test('empty, then the saved value; saved with KeystoreAESGCM_NoAuth under the service', async () => {
    const { store, keychain } = setup();
    expect(await store.read()).toEqual({ kind: 'empty' });
    await store.write(SECRET);
    expect(keychain.setGenericPassword).toHaveBeenCalledWith('boostytv', SECRET, {
      service: 'boostytv.session',
      storage: 'KeystoreAESGCM_NoAuth',
    });
    expect(await store.read()).toEqual({ kind: 'value', value: SECRET });
  });

  test('corruption: helper deletes the file, reset, wiped; then save and read work', async () => {
    const { store, keychain, helper, failNext, seed } = setup();
    seed(SECRET);
    failNext('getGenericPassword', corruption());
    expect(await store.read()).toEqual({ kind: 'wiped', cause: 'storage-unreadable' });
    expect(helper.deleteKeychainStorage).toHaveBeenCalledTimes(1);
    expect(keychain.resetGenericPassword).toHaveBeenCalledTimes(1);
    expect(helper.deleteKeychainStorage.mock.invocationCallOrder[0]).toBeLessThan(
      keychain.resetGenericPassword.mock.invocationCallOrder[0],
    );
    await store.write('new');
    expect(await store.read()).toEqual({ kind: 'value', value: 'new' });
  });

  test('corruption with a failing helper and a failing reset: unavailable (not wiped), no throw, no loop', async () => {
    const { store, keychain, helper, failNext } = setup();
    failNext('getGenericPassword', corruption());
    helper.deleteKeychainStorage.mockRejectedValueOnce(nativeError('E_DELETE_FAILED', 'delete returned false'));
    failNext('resetGenericPassword', corruption());
    expect(await store.read()).toEqual({ kind: 'unavailable' });
    expect(keychain.getGenericPassword).toHaveBeenCalledTimes(1);
  });

  test('corruption with a helper that returns false and a failing reset: unavailable', async () => {
    const { store, helper, failNext } = setup();
    failNext('getGenericPassword', corruption());
    helper.deleteKeychainStorage.mockResolvedValueOnce(false);
    failNext('resetGenericPassword', corruption());
    expect(await store.read()).toEqual({ kind: 'unavailable' });
  });

  test('corruption with a failing helper but a working reset: wiped', async () => {
    const { store, helper, failNext } = setup();
    failNext('getGenericPassword', corruption());
    helper.deleteKeychainStorage.mockRejectedValueOnce(nativeError('E_DELETE_FAILED', 'x'));
    expect(await store.read()).toEqual({ kind: 'wiped', cause: 'storage-unreadable' });
  });

  test('undecryptable value and a failing reset: unavailable', async () => {
    const { store, failNext } = setup();
    failNext('getGenericPassword', crypto());
    failNext('resetGenericPassword', crypto());
    expect(await store.read()).toEqual({ kind: 'unavailable' });
  });

  test.each([
    ['CryptoFailedException', crypto],
    ['KeyPermanentlyInvalidatedException', invalidated],
  ])('%s: reset without the file helper, wiped', async (_name, make) => {
    const { store, helper, keychain, failNext, seed, peek } = setup();
    seed(SECRET);
    failNext('getGenericPassword', make());
    expect(await store.read()).toEqual({ kind: 'wiped', cause: 'value-undecryptable' });
    expect(helper.deleteKeychainStorage).not.toHaveBeenCalled();
    expect(keychain.resetGenericPassword).toHaveBeenCalledTimes(1);
    expect(peek()).toBeNull();
  });

  test('transient error: one retry, the data is kept', async () => {
    const { store, keychain, failNext, seed, peek } = setup();
    seed(SECRET);
    failNext('getGenericPassword', transient());
    expect(await store.read()).toEqual({ kind: 'value', value: SECRET });
    expect(keychain.getGenericPassword).toHaveBeenCalledTimes(2);
    expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
    expect(peek()).toBe(SECRET);
  });

  test('transient error twice: unavailable, data kept, no reset, no third read', async () => {
    const { store, keychain, helper, failNext, seed, peek } = setup();
    seed(SECRET);
    failNext('getGenericPassword', transient(), transient());
    expect(await store.read()).toEqual({ kind: 'unavailable' });
    expect(keychain.getGenericPassword).toHaveBeenCalledTimes(2);
    expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
    expect(helper.deleteKeychainStorage).not.toHaveBeenCalled();
    expect(peek()).toBe(SECRET);
  });
});

describe('write', () => {
  test('a transient save error rejects with SecureStoreError(other), nothing reset', async () => {
    const { store, keychain, failNext } = setup();
    failNext('setGenericPassword', transient());
    await expect(store.write(SECRET)).rejects.toEqual(new SecureStoreError('other'));
    expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
    expect(keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  });

  test('false from the library rejects (returned-false)', async () => {
    const { store, keychain } = setup();
    keychain.setGenericPassword.mockResolvedValueOnce(false as never);
    await expect(store.write(SECRET)).rejects.toMatchObject({ kind: 'returned-false' });
  });

  test('corruption on save: recover once, one retry succeeds', async () => {
    const { store, keychain, helper, failNext, peek } = setup();
    failNext('setGenericPassword', corruption());
    await store.write(SECRET);
    expect(helper.deleteKeychainStorage).toHaveBeenCalledTimes(1);
    expect(keychain.setGenericPassword).toHaveBeenCalledTimes(2);
    expect(peek()).toBe(SECRET);
  });

  test('corruption on save and on the retry: rejects, no third attempt', async () => {
    const { store, keychain, failNext } = setup();
    failNext('setGenericPassword', corruption(), corruption());
    await expect(store.write(SECRET)).rejects.toMatchObject({ kind: 'storage-unreadable' });
    expect(keychain.setGenericPassword).toHaveBeenCalledTimes(2);
  });
});

describe('clear', () => {
  test('clears the value', async () => {
    const { store, seed, peek } = setup();
    seed(SECRET);
    await store.clear();
    expect(peek()).toBeNull();
  });

  test('a corrupted file on clear: helper + reset, resolves', async () => {
    const { store, helper, failNext } = setup();
    failNext('resetGenericPassword', corruption());
    await store.clear();
    expect(helper.deleteKeychainStorage).toHaveBeenCalledTimes(1);
  });

  test('a corrupted file on clear that cannot be recovered: rejects', async () => {
    const { store, helper, failNext } = setup();
    failNext('resetGenericPassword', corruption(), corruption());
    helper.deleteKeychainStorage.mockResolvedValueOnce(false);
    await expect(store.clear()).rejects.toMatchObject({ kind: 'storage-unreadable' });
  });

  test('a transient clear error rejects', async () => {
    const { store, failNext } = setup();
    failNext('resetGenericPassword', transient());
    await expect(store.clear()).rejects.toMatchObject({ kind: 'other' });
  });
});

test('logs never contain the stored value or a native message', async () => {
  const { store, logger, failNext, seed } = setup();
  seed(SECRET);
  failNext('getGenericPassword', transient(), transient());
  await store.read();
  failNext('getGenericPassword', corruption());
  await store.read();
  await store.write(SECRET);
  await store.read();
  const dump = JSON.stringify(logger.entries());
  expect(logger.entries().length).toBeGreaterThan(0);
  expect(dump).not.toContain(SECRET);
  expect(dump).not.toContain('Keystore not ready');
  expect(dump).not.toContain('Unable to parse');
});

describe('keychainStorageReset (native bridge)', () => {
  const native = NativeModules as { KeychainStorageReset?: { deleteKeychainStorage: jest.Mock } };

  afterEach(() => {
    delete native.KeychainStorageReset;
  });

  test('calls the native deleteKeychainStorage and returns its result', async () => {
    native.KeychainStorageReset = { deleteKeychainStorage: jest.fn().mockResolvedValue(true) };
    await expect(keychainStorageReset.deleteKeychainStorage()).resolves.toBe(true);
    expect(native.KeychainStorageReset.deleteKeychainStorage).toHaveBeenCalledTimes(1);
  });

  test('passes a native rejection through', async () => {
    native.KeychainStorageReset = {
      deleteKeychainStorage: jest.fn().mockRejectedValue(nativeError('E_DELETE_FAILED', 'delete returned false')),
    };
    await expect(keychainStorageReset.deleteKeychainStorage()).rejects.toMatchObject({ code: 'E_DELETE_FAILED' });
  });

  test('rejects when the module is not linked', async () => {
    await expect(keychainStorageReset.deleteKeychainStorage()).rejects.toThrow('not linked');
  });
});
