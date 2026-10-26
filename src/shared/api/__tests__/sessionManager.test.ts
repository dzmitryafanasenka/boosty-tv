import { createSecureStore, type ReadResult, type SecureStore } from '../../platform/secureStore';
import { createLogger } from '../../services/logger';
import type { AuthApiClient, ConfirmCodeResult } from '../authApiClient';
import { AuthError } from '../authError';
import { HttpTransportError, type HttpClient } from '../httpClient';
import { createSessionManager } from '../sessionManager';

const PHONE = '+375291234567';
const CHALLENGE = 'c'.repeat(64);
const SMS_CODE = '482193';
const ACCESS = 'a'.repeat(64);
const REFRESH = 'r'.repeat(64);
const NOW = 1_800_000_000_000;
const TOKENS: ConfirmCodeResult = { accessToken: ACCESS, refreshToken: REFRESH, expiresIn: 2592000 };
const ARGS = { phone: PHONE, challenge: CHALLENGE, smsCode: SMS_CODE };

function memoryStore(): SecureStore & { value: string | null; write: jest.Mock; clear: jest.Mock; read: jest.Mock } {
  const store = {
    value: null as string | null,
    read: jest.fn(async (): Promise<ReadResult> =>
      store.value === null ? { kind: 'empty' } : { kind: 'value', value: store.value },
    ),
    write: jest.fn(async (value: string) => {
      store.value = value;
    }),
    clear: jest.fn(async () => {
      store.value = null;
    }),
  };
  return store;
}

function setup({
  confirm = () => Promise.resolve(TOKENS),
  e1 = () => Promise.resolve({ status: 200, body: { id: 1001, flags: {} } }),
}: {
  confirm?: () => Promise<ConfirmCodeResult>;
  e1?: HttpClient['get'];
} = {}) {
  const authApi = {
    sendCode: jest.fn(),
    resendCode: jest.fn(),
    confirmCode: jest.fn(confirm),
  } as unknown as AuthApiClient & { confirmCode: jest.Mock };
  const http = { get: jest.fn(e1) };
  const sessionStore = memoryStore();
  const phoneStore = memoryStore();
  const logger = createLogger();
  const manager = createSessionManager({
    authApi,
    http,
    sessionStore,
    phoneStore,
    now: () => NOW,
    logger,
  });
  return { manager, authApi, http, sessionStore, phoneStore, logger };
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    return (error as AuthError).kind;
  }
  throw new Error('expected a rejection');
}

describe('signIn', () => {
  test('success: confirm → E1 with the new token → the phone saved, then the session → signedIn', async () => {
    const { manager, authApi, http, sessionStore, phoneStore } = setup();
    const statuses: string[] = [];
    manager.subscribe(s => statuses.push(s));
    expect(manager.getStatus()).toBe('signedOut');

    await manager.signIn(ARGS);

    expect(authApi.confirmCode).toHaveBeenCalledWith(PHONE, CHALLENGE, SMS_CODE);
    expect(http.get).toHaveBeenCalledWith('/v1/user/current', ACCESS);
    expect(JSON.parse(sessionStore.value ?? '')).toEqual({
      v: 1,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: NOW + 2592000 * 1000,
      accountId: '1001',
    });
    expect(phoneStore.value).toBe(PHONE);
    expect(authApi.confirmCode.mock.invocationCallOrder[0]).toBeLessThan(http.get.mock.invocationCallOrder[0]);
    expect(http.get.mock.invocationCallOrder[0]).toBeLessThan(sessionStore.write.mock.invocationCallOrder[0]);
    expect(phoneStore.write.mock.invocationCallOrder[0]).toBeLessThan(sessionStore.write.mock.invocationCallOrder[0]);
    expect(manager.getStatus()).toBe('signedIn');
    expect(statuses).toEqual(['signedIn']);
  });

  test('a string E1 id is kept as is', async () => {
    const { manager, sessionStore } = setup({
      e1: () => Promise.resolve({ status: 200, body: { id: 'u-1001' } }),
    });
    await manager.signIn(ARGS);
    expect(JSON.parse(sessionStore.value ?? '').accountId).toBe('u-1001');
  });

  test('wrong code: WrongCode (challenge not spent), no E1, nothing saved', async () => {
    const { manager, http, sessionStore, phoneStore } = setup({
      confirm: () => Promise.reject(new AuthError('WrongCode')),
    });
    await expect(manager.signIn(ARGS)).rejects.toMatchObject({ kind: 'WrongCode', challengeSpent: false });
    expect(http.get).not.toHaveBeenCalled();
    expect(sessionStore.write).not.toHaveBeenCalled();
    expect(phoneStore.write).not.toHaveBeenCalled();
    expect(manager.getStatus()).toBe('signedOut');
  });

  test('confirm Network stays Network', async () => {
    const { manager } = setup({ confirm: () => Promise.reject(new AuthError('Network')) });
    expect(await kindOf(manager.signIn(ARGS))).toBe('Network');
  });

  test.each([
    ['E1 401', () => Promise.resolve({ status: 401, body: { error: 'unauthorized' } })],
    ['E1 500', () => Promise.resolve({ status: 500, body: undefined })],
    ['E1 network', () => Promise.reject(new HttpTransportError())],
    ['E1 200 without id', () => Promise.resolve({ status: 200, body: { flags: {} } })],
    ['E1 200 not JSON', () => Promise.resolve({ status: 200, body: undefined })],
  ])('%s: Unknown (challenge spent), nothing saved, tokens dropped, still signedOut', async (_name, e1) => {
    const { manager, sessionStore, phoneStore } = setup({ e1 });
    await expect(manager.signIn(ARGS)).rejects.toMatchObject({ kind: 'Unknown', challengeSpent: true });
    expect(sessionStore.write).not.toHaveBeenCalled();
    expect(phoneStore.write).not.toHaveBeenCalled();
    expect(sessionStore.value).toBeNull();
    expect(manager.getStatus()).toBe('signedOut');
  });

  test('session save fails: Unknown (challenge spent), nothing kept', async () => {
    const { manager, sessionStore, phoneStore } = setup();
    sessionStore.write.mockRejectedValueOnce(new Error('keychain'));
    await expect(manager.signIn(ARGS)).rejects.toMatchObject({ kind: 'Unknown', challengeSpent: true });
    expect(sessionStore.value).toBeNull();
    expect(phoneStore.value).toBeNull();
    expect(manager.getStatus()).toBe('signedOut');
  });

  test('phone save fails: not fatal, the session is saved, signedIn', async () => {
    const { manager, sessionStore, phoneStore, logger } = setup();
    phoneStore.write.mockRejectedValueOnce(new Error('keychain'));
    await manager.signIn(ARGS);
    expect(JSON.parse(sessionStore.value ?? '').accessToken).toBe(ACCESS);
    expect(phoneStore.value).toBeNull();
    expect(manager.getStatus()).toBe('signedIn');
    expect(JSON.stringify(logger.entries())).toContain('phone not saved');
  });

  test('corruption recovery during the phone write (shared file deleted): the session is still stored', async () => {
    // One keychain DataStore file for both services, as on the device.
    const file = new Map<string, string>();
    let corruptNextSet = true;
    const keychain = {
      getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
        file.has(service) ? { password: file.get(service) as string } : (false as const),
      ),
      setGenericPassword: jest.fn(async (_u: string, password: string, { service }: { service: string }) => {
        if (corruptNextSet) {
          corruptNextSet = false;
          throw Object.assign(new Error('androidx.datastore.core.CorruptionException'), { code: 'E_UNKNOWN_ERROR' });
        }
        file.set(service, password);
        return { storage: 'KeystoreAESGCM_NoAuth' };
      }),
      resetGenericPassword: jest.fn(async ({ service }: { service: string }) => {
        file.delete(service);
        return true;
      }),
    };
    const helper = {
      deleteKeychainStorage: jest.fn(async () => {
        file.clear();
        return true;
      }),
    };
    const logger = createLogger();
    const manager = createSessionManager({
      authApi: { sendCode: jest.fn(), resendCode: jest.fn(), confirmCode: jest.fn(async () => TOKENS) },
      http: { get: jest.fn(async () => ({ status: 200, body: { id: 1001 } })) },
      sessionStore: createSecureStore({ service: 'boostytv.session', keychain, helper, logger }),
      phoneStore: createSecureStore({ service: 'boostytv.phone', keychain, helper, logger }),
      now: () => NOW,
      logger,
    });
    await manager.signIn(ARGS);
    expect(helper.deleteKeychainStorage).toHaveBeenCalledTimes(1);
    expect(file.get('boostytv.phone')).toBe(PHONE);
    expect(JSON.parse(file.get('boostytv.session') ?? '{}').accessToken).toBe(ACCESS);
    expect(manager.getStatus()).toBe('signedIn');
  });

  test('double submit while in flight: one confirm; other arguments are rejected', async () => {
    let release: (value: ConfirmCodeResult) => void = () => {};
    const { manager, authApi } = setup({
      confirm: () => new Promise(resolve => {
        release = resolve;
      }),
    });
    const first = manager.signIn(ARGS);
    const second = manager.signIn(ARGS);
    expect(await kindOf(manager.signIn({ ...ARGS, smsCode: '000000' }))).toBe('Unknown');
    release(TOKENS);
    await first;
    await second;
    expect(authApi.confirmCode).toHaveBeenCalledTimes(1);
  });

  test('logs never contain the phone, challenge, code, tokens or the E1 body', async () => {
    const { manager, logger } = setup({
      e1: () => Promise.resolve({ status: 200, body: { id: 1001, email: 'owner@example.invalid' } }),
    });
    await manager.signIn(ARGS);
    const dump = JSON.stringify(logger.entries());
    for (const secret of [PHONE, CHALLENGE, SMS_CODE, ACCESS, REFRESH, 'owner@example.invalid', '1001']) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe('restore', () => {
  const stored = JSON.stringify({ v: 1, accessToken: ACCESS, refreshToken: REFRESH, expiresAt: NOW, accountId: '1001' });

  test('a stored session → signedIn', async () => {
    const { manager, sessionStore } = setup();
    sessionStore.value = stored;
    await expect(manager.restore()).resolves.toEqual({ status: 'signedIn' });
    expect(manager.getStatus()).toBe('signedIn');
  });

  test('nothing stored → signedOut (none)', async () => {
    const { manager } = setup();
    await expect(manager.restore()).resolves.toEqual({ status: 'signedOut', reason: 'none' });
  });

  test('a wiped store (corruption) → signedOut (wiped)', async () => {
    const { manager, sessionStore } = setup();
    sessionStore.read.mockResolvedValueOnce({ kind: 'wiped', cause: 'storage-unreadable' });
    await expect(manager.restore()).resolves.toEqual({ status: 'signedOut', reason: 'wiped' });
  });

  test('a transient error → signedOut (unavailable), the data is not cleared', async () => {
    const { manager, sessionStore } = setup();
    sessionStore.value = stored;
    sessionStore.read.mockResolvedValueOnce({ kind: 'unavailable' });
    await expect(manager.restore()).resolves.toEqual({ status: 'signedOut', reason: 'unavailable' });
    expect(sessionStore.clear).not.toHaveBeenCalled();
    expect(sessionStore.value).toBe(stored);
  });

  test.each([
    ['not JSON', 'garbage'],
    ['wrong version', JSON.stringify({ v: 2, accessToken: ACCESS, refreshToken: REFRESH, expiresAt: NOW, accountId: '1' })],
    ['no refresh token', JSON.stringify({ v: 1, accessToken: ACCESS, expiresAt: NOW, accountId: '1' })],
  ])('an unreadable value (%s) → cleared, signedOut (wiped)', async (_name, value) => {
    const { manager, sessionStore } = setup();
    sessionStore.value = value;
    await expect(manager.restore()).resolves.toEqual({ status: 'signedOut', reason: 'wiped' });
    expect(sessionStore.clear).toHaveBeenCalled();
    expect(manager.getStatus()).toBe('signedOut');
  });

  test('a store that rejects → signedOut (unavailable), never throws', async () => {
    const { manager, sessionStore } = setup();
    sessionStore.read.mockRejectedValueOnce(new Error('boom'));
    await expect(manager.restore()).resolves.toEqual({ status: 'signedOut', reason: 'unavailable' });
  });
});
