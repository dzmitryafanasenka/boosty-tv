import {
  classifyStoreError,
  createSpikeSecureStore,
  errorLabel,
  SpikeSimulatedError,
  type KeychainLike,
} from '../spikeSecureStore';

const SECRET = 'secret-token-value-123';

/** Mirrors how RN rejects a native promise: Error + code. */
function nativeError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

const corruption = () =>
  nativeError(
    'E_UNKNOWN_ERROR',
    'androidx.datastore.core.CorruptionException: Unable to parse preferences proto.',
  );
const crypto = () =>
  nativeError(
    'E_CRYPTO_FAILED',
    'Decryption failed: Authentication tag verification failed.',
  );
const keystore = () =>
  nativeError('E_KEYSTORE_ACCESS_ERROR', 'Keystore not ready');

function setup() {
  let stored: string | null = null;
  const keychain = {
    getGenericPassword: jest.fn(async () =>
      stored === null ? (false as const) : { password: stored },
    ),
    setGenericPassword: jest.fn(async (_u: string, password: string) => {
      stored = password;
      return { storage: 'KeystoreAESGCM_NoAuth' };
    }),
    resetGenericPassword: jest.fn(async () => {
      stored = null;
      return true;
    }),
  } satisfies KeychainLike;
  const helper = { deleteKeychainStorage: jest.fn(async () => true) };
  const lines: string[] = [];
  const store = createSpikeSecureStore({
    service: 'svc',
    keychain,
    helper,
    log: line => lines.push(line),
  });
  return { keychain, helper, store, lines, peek: () => stored };
}

describe('classifyStoreError', () => {
  test.each([
    [corruption(), 'storage-unreadable'],
    [crypto(), 'value-undecryptable'],
    [
      nativeError(
        'E_UNKNOWN_ERROR',
        'android.security.keystore.KeyPermanentlyInvalidatedException: Key permanently invalidated',
      ),
      'value-undecryptable',
    ],
    [keystore(), 'other'],
    [new Error('Network'), 'other'],
    ['string error', 'other'],
    [undefined, 'other'],
  ])('%p → %s', (error, kind) => {
    expect(classifyStoreError(error)).toBe(kind);
  });

  test('labels never include free-form message text', () => {
    const error = nativeError('E_UNKNOWN_ERROR', `something ${SECRET}`);
    expect(errorLabel(error)).toBe('E_UNKNOWN_ERROR Error');
    expect(errorLabel(corruption())).toBe(
      'E_UNKNOWN_ERROR CorruptionException',
    );
  });
});

describe('read', () => {
  test('value and empty', async () => {
    const { store } = setup();
    await expect(store.read()).resolves.toEqual({ kind: 'empty' });
    await store.save(SECRET);
    await expect(store.read()).resolves.toEqual({
      kind: 'value',
      value: SECRET,
    });
  });

  test('storage unreadable: helper deletes file, reset, signed-out; save+read works after', async () => {
    const { store, keychain, helper, peek } = setup();
    await store.save(SECRET);
    keychain.getGenericPassword.mockRejectedValueOnce(corruption());
    const result = await store.read();
    expect(result).toEqual({
      kind: 'signed-out',
      cause: 'storage-unreadable',
      error: 'E_UNKNOWN_ERROR CorruptionException',
      recovery: { fileDeleted: true, resetOk: true },
    });
    expect(helper.deleteKeychainStorage).toHaveBeenCalledTimes(1);
    expect(keychain.resetGenericPassword).toHaveBeenCalledTimes(1);
    expect(peek()).toBeNull();
    await store.save('again');
    await expect(store.read()).resolves.toEqual({
      kind: 'value',
      value: 'again',
    });
  });

  test('helper and reset failures still end signed-out without throwing', async () => {
    const { store, keychain, helper } = setup();
    keychain.getGenericPassword.mockRejectedValueOnce(corruption());
    helper.deleteKeychainStorage.mockRejectedValueOnce(new Error('io'));
    keychain.resetGenericPassword.mockRejectedValueOnce(corruption());
    await expect(store.read()).resolves.toMatchObject({
      kind: 'signed-out',
      recovery: { fileDeleted: false, resetOk: false },
    });
  });

  test('value undecryptable: reset without the helper, signed-out', async () => {
    const { store, keychain, helper, peek } = setup();
    await store.save(SECRET);
    keychain.getGenericPassword.mockRejectedValueOnce(crypto());
    await expect(store.read()).resolves.toEqual({
      kind: 'signed-out',
      cause: 'value-undecryptable',
      error: 'E_CRYPTO_FAILED Error',
      recovery: { resetOk: true },
    });
    expect(helper.deleteKeychainStorage).not.toHaveBeenCalled();
    expect(peek()).toBeNull();
  });

  test('other error: data kept, recoverable, one retry, never signed out', async () => {
    const { store, keychain, helper, peek } = setup();
    await store.save(SECRET);
    keychain.getGenericPassword
      .mockRejectedValueOnce(keystore())
      .mockRejectedValueOnce(keystore());
    await expect(store.read()).resolves.toEqual({
      kind: 'recoverable-error',
      error: 'E_KEYSTORE_ACCESS_ERROR Error',
      retriesLeft: 1,
    });
    await expect(store.read()).resolves.toMatchObject({
      kind: 'recoverable-error',
      retriesLeft: 0,
    });
    expect(peek()).toBe(SECRET);
    expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
    expect(helper.deleteKeychainStorage).not.toHaveBeenCalled();
    // A later success resets the retry budget.
    await expect(store.read()).resolves.toEqual({
      kind: 'value',
      value: SECRET,
    });
    keychain.getGenericPassword.mockRejectedValueOnce(keystore());
    await expect(store.read()).resolves.toMatchObject({ retriesLeft: 1 });
  });

  test('injected spike error is classified as other and is one-shot', async () => {
    const { store } = setup();
    await store.save(SECRET);
    store.injectNextReadError(new SpikeSimulatedError());
    await expect(store.read()).resolves.toEqual({
      kind: 'recoverable-error',
      error: 'no-code SpikeSimulatedError',
      retriesLeft: 1,
    });
    await expect(store.read()).resolves.toEqual({
      kind: 'value',
      value: SECRET,
    });
  });

  test('logs never contain the stored value', async () => {
    const { store, keychain, lines } = setup();
    await store.save(SECRET);
    await store.read();
    keychain.getGenericPassword.mockRejectedValueOnce(corruption());
    await store.read();
    expect(lines.join('\n')).not.toContain(SECRET);
  });
});

describe('save', () => {
  test('corruption on save: recover once, then one retry succeeds', async () => {
    const { store, keychain, helper } = setup();
    keychain.setGenericPassword.mockRejectedValueOnce(corruption());
    await expect(store.save(SECRET)).resolves.toEqual({
      kind: 'saved',
      storage: 'KeystoreAESGCM_NoAuth',
      afterRecovery: true,
    });
    expect(helper.deleteKeychainStorage).toHaveBeenCalledTimes(1);
    expect(keychain.setGenericPassword).toHaveBeenCalledTimes(2);
  });

  test('corruption persisting after recovery: fails, no loop', async () => {
    const { store, keychain } = setup();
    keychain.setGenericPassword.mockRejectedValue(corruption());
    await expect(store.save(SECRET)).resolves.toMatchObject({
      kind: 'failed',
      errorKind: 'storage-unreadable',
    });
    expect(keychain.setGenericPassword).toHaveBeenCalledTimes(2);
  });

  test('other error on save: no recovery, no retry', async () => {
    const { store, keychain, helper } = setup();
    keychain.setGenericPassword.mockRejectedValueOnce(keystore());
    await expect(store.save(SECRET)).resolves.toMatchObject({
      kind: 'failed',
      errorKind: 'other',
    });
    expect(keychain.setGenericPassword).toHaveBeenCalledTimes(1);
    expect(helper.deleteKeychainStorage).not.toHaveBeenCalled();
  });
});

describe('clear', () => {
  test('corrupted storage is recovered on clear', async () => {
    const { store, keychain, helper } = setup();
    keychain.resetGenericPassword.mockRejectedValueOnce(corruption());
    await expect(store.clear()).resolves.toEqual({
      kind: 'cleared',
      recovery: { fileDeleted: true, resetOk: true },
    });
    expect(helper.deleteKeychainStorage).toHaveBeenCalledTimes(1);
  });
});
