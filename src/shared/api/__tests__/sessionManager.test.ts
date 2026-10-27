import { createSecureStore, type ReadResult, type SecureStore } from '../../platform/secureStore';
import { createLogger } from '../../services/logger';
import type { AuthApiClient, ConfirmCodeResult } from '../authApiClient';
import { AuthError } from '../authError';
import { createFixtureTransport, type FixtureReply } from '../fixtureTransport';
import { createHttpClient } from '../httpClient';
import { createSessionManager } from '../sessionManager';
// eslint-disable-next-line boundaries/dependencies -- a test under src/shared may use the src/test harness
import { deferred, flush } from '../../../test/async';

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
  e1 = () => ({ status: 200, body: { id: 1001, flags: {} } }),
  onAccountSwitch = () => Promise.resolve(),
}: {
  confirm?: () => Promise<ConfirmCodeResult>;
  e1?: () => FixtureReply;
  /** null: no hook set (a wiring bug). */
  onAccountSwitch?: (() => Promise<void>) | null;
} = {}) {
  const authApi = {
    sendCode: jest.fn(),
    resendCode: jest.fn(),
    confirmCode: jest.fn(confirm),
    refresh: jest.fn(),
  } as unknown as AuthApiClient & { confirmCode: jest.Mock };
  const e1Mock = jest.fn(e1);
  const transport = createFixtureTransport(req => (req.path === '/v1/user/current' ? e1Mock() : undefined));
  const http = { get: e1Mock, calls: transport.calls };
  const sessionStore = memoryStore();
  const phoneStore = memoryStore();
  const logger = createLogger();
  const manager = createSessionManager({
    authApi,
    createHttp: tokens => createHttpClient({ transport, tokens, logger, sleep: () => Promise.resolve() }),
    sessionStore,
    phoneStore,
    now: () => NOW,
    logger,
    onAccountSwitch: onAccountSwitch ?? undefined,
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
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].path).toBe('/v1/user/current');
    expect(http.calls[0].headers.Authorization).toBe(`Bearer ${ACCESS}`);
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
      e1: () => ({ status: 200, body: { id: 'u-1001' } }),
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
    ['E1 401', (): FixtureReply => ({ status: 401, body: { error: 'unauthorized' } })],
    ['E1 500', (): FixtureReply => ({ status: 500 })],
    ['E1 network', (): FixtureReply => ({ network: true })],
    ['E1 200 without id', (): FixtureReply => ({ status: 200, body: { flags: {} } })],
    ['E1 200 not JSON', (): FixtureReply => ({ status: 200 })],
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
      authApi: { sendCode: jest.fn(), resendCode: jest.fn(), confirmCode: jest.fn(async () => TOKENS), refresh: jest.fn() },
      createHttp: tokens =>
        createHttpClient({ transport: createFixtureTransport(() => ({ status: 200, body: { id: 1001 } })), tokens, logger }),
      sessionStore: createSecureStore({ service: 'boostytv.session', keychain, helper, logger }),
      phoneStore: createSecureStore({ service: 'boostytv.phone', keychain, helper, logger }),
      now: () => NOW,
      logger,
      onAccountSwitch: () => Promise.resolve(),
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
      e1: () => ({ status: 200, body: { id: 1001, email: 'owner@example.invalid' } }),
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

describe('expiry marker, re-login and the phone accessor (Story 2.6)', () => {
  const marker = (accountId: string) => JSON.stringify({ v: 1, expired: true, accountId });
  const session = JSON.stringify({ v: 1, accessToken: ACCESS, refreshToken: REFRESH, expiresAt: NOW + 3600_000, accountId: '1001' });

  test('restore: the marker → expired (reason expired); no token in memory, nothing sent', async () => {
    const { manager, sessionStore, http } = setup();
    sessionStore.value = marker('1001');
    await expect(manager.restore()).resolves.toEqual({ status: 'expired', reason: 'expired' });
    expect(manager.getStatus()).toBe('expired');
    await expect(manager.validate()).resolves.toEqual({ kind: 'skipped' });
    expect(http.calls).toHaveLength(0);
    expect(sessionStore.clear).not.toHaveBeenCalled();
  });

  test('restore: a kept phone without a session (e.g. a sign-in killed between the two writes) → signedOut (none)', async () => {
    const { manager, phoneStore } = setup();
    phoneStore.value = PHONE;
    await expect(manager.restore()).resolves.toEqual({ status: 'signedOut', reason: 'none' });
    expect(manager.getStatus()).toBe('signedOut');
    await expect(manager.getExpiredPhone()).resolves.toBeNull();
  });

  test.each([
    ['marker without accountId', JSON.stringify({ v: 1, expired: true })],
    ['marker with expired:false', JSON.stringify({ v: 1, expired: false, accountId: '1001' })],
    ['marker of another version', JSON.stringify({ v: 2, expired: true, accountId: '1001' })],
  ])('an invalid marker (%s) → wiped, as any unreadable value', async (_name, value) => {
    const { manager, sessionStore } = setup();
    sessionStore.value = value;
    await expect(manager.restore()).resolves.toEqual({ status: 'signedOut', reason: 'wiped' });
  });

  test('getExpiredPhone: the stored phone only while expired', async () => {
    const { manager, sessionStore, phoneStore } = setup();
    phoneStore.value = PHONE;
    // signedOut (nothing restored yet)
    await expect(manager.getExpiredPhone()).resolves.toBeNull();
    sessionStore.value = session;
    await manager.restore();
    expect(manager.getStatus()).toBe('signedIn');
    await expect(manager.getExpiredPhone()).resolves.toBeNull();
    sessionStore.value = marker('1001');
    await manager.restore();
    await expect(manager.getExpiredPhone()).resolves.toBe(PHONE);
  });

  test('getExpiredPhone: no phone or a failing store → null, never rejects', async () => {
    const { manager, sessionStore, phoneStore } = setup();
    sessionStore.value = marker('1001');
    await manager.restore();
    await expect(manager.getExpiredPhone()).resolves.toBeNull();
    phoneStore.value = PHONE;
    phoneStore.read.mockRejectedValueOnce(new Error('keychain'));
    await expect(manager.getExpiredPhone()).resolves.toBeNull();
    phoneStore.read.mockResolvedValueOnce({ kind: 'unavailable' });
    await expect(manager.getExpiredPhone()).resolves.toBeNull();
  });

  test('re-login with the same account id (marker) → accountChanged false; the marker is overwritten; the phone stays', async () => {
    const { manager, sessionStore, phoneStore } = setup();
    sessionStore.value = marker('1001');
    phoneStore.value = PHONE;
    await manager.restore();
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: false });
    expect(JSON.parse(sessionStore.value ?? '')).toMatchObject({ v: 1, accessToken: ACCESS, accountId: '1001' });
    expect(JSON.parse(sessionStore.value ?? '')).not.toHaveProperty('expired');
    expect(phoneStore.value).toBe(PHONE);
    expect(manager.getStatus()).toBe('signedIn');
    // Signed in again: the phone is no longer readable.
    await expect(manager.getExpiredPhone()).resolves.toBeNull();
  });

  test('re-login with another account id → accountChanged true', async () => {
    const { manager, sessionStore } = setup();
    sessionStore.value = marker('2002');
    await manager.restore();
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: true });
  });

  test('no previous account id (nothing stored, or only a kept phone) → accountChanged true', async () => {
    const first = setup();
    await first.manager.restore();
    await expect(first.manager.signIn(ARGS)).resolves.toEqual({ accountChanged: true });
    const legacy = setup();
    legacy.phoneStore.value = PHONE;
    await legacy.manager.restore();
    await expect(legacy.manager.signIn(ARGS)).resolves.toEqual({ accountChanged: true });
  });

  test('a second sign-in in the same run compares with the in-memory session', async () => {
    const { manager } = setup();
    await manager.signIn(ARGS);
    await expect(manager.signIn({ ...ARGS, smsCode: '111111' })).resolves.toEqual({ accountChanged: false });
  });

  test('debugExpireInMemory: expired, the previous id kept, SecureStore untouched, nothing sent', async () => {
    const { manager, sessionStore, phoneStore, http, logger } = setup();
    sessionStore.value = session;
    phoneStore.value = PHONE;
    await manager.restore();
    const statuses: string[] = [];
    manager.subscribe(s => statuses.push(s));
    manager.debugExpireInMemory?.();
    expect(statuses).toEqual(['expired']);
    expect(manager.getStatus()).toBe('expired');
    expect(sessionStore.write).not.toHaveBeenCalled();
    expect(sessionStore.clear).not.toHaveBeenCalled();
    expect(sessionStore.value).toBe(session);
    expect(http.calls).toHaveLength(0);
    await expect(manager.getExpiredPhone()).resolves.toBe(PHONE);
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: false });
    // A restart reads the stored session again.
    sessionStore.value = session;
    await expect(manager.restore()).resolves.toEqual({ status: 'signedIn' });
    expect(JSON.stringify(logger.entries())).toContain('debug: expired in memory');
  });

  test('sign-out forgets the previous account id', async () => {
    const { manager, sessionStore } = setup();
    sessionStore.value = marker('1001');
    await manager.restore();
    await manager.signOut();
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: true });
  });

  test('signOut from expired (Story 2.7): the phone, then the marker, cleared; then signedOut, nothing sent', async () => {
    const { manager, sessionStore, phoneStore, http } = setup();
    sessionStore.value = marker('1001');
    phoneStore.value = PHONE;
    await manager.restore();
    expect(manager.getStatus()).toBe('expired');
    const order: string[] = [];
    sessionStore.clear.mockImplementationOnce(async () => {
      order.push('session');
      sessionStore.value = null;
    });
    phoneStore.clear.mockImplementationOnce(async () => {
      order.push('phone');
      phoneStore.value = null;
    });
    const statuses: string[] = [];
    manager.subscribe(s => statuses.push(s));
    await manager.signOut();
    expect(order).toEqual(['phone', 'session']);
    expect(sessionStore.value).toBeNull();
    expect(phoneStore.value).toBeNull();
    expect(statuses).toEqual(['signedOut']);
    expect(http.calls).toHaveLength(0);
    await expect(manager.getExpiredPhone()).resolves.toBeNull();
    // The previous account id is gone too.
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: true });
  });

  test('signOut from expired: a failed phone clear rejects and keeps expired, the marker and the phone', async () => {
    const { manager, sessionStore, phoneStore } = setup();
    sessionStore.value = marker('1001');
    phoneStore.value = PHONE;
    await manager.restore();
    phoneStore.clear.mockRejectedValueOnce(new Error('keychain'));
    await expect(manager.signOut()).rejects.toThrow('keychain');
    expect(manager.getStatus()).toBe('expired');
    expect(sessionStore.value).toBe(marker('1001'));
    expect(phoneStore.value).toBe(PHONE);
    await expect(manager.getExpiredPhone()).resolves.toBe(PHONE);
  });

  test('signOut while signedIn: a failed phone clear rejects; the session entry and memory are kept, signedIn', async () => {
    const { manager, sessionStore, phoneStore } = setup();
    sessionStore.value = session;
    phoneStore.value = PHONE;
    await manager.restore();
    expect(manager.getStatus()).toBe('signedIn');
    phoneStore.clear.mockRejectedValueOnce(new Error('keychain'));
    await expect(manager.signOut()).rejects.toThrow('keychain');
    expect(sessionStore.clear).not.toHaveBeenCalled();
    expect(sessionStore.value).toBe(session);
    expect(phoneStore.value).toBe(PHONE);
    expect(manager.getStatus()).toBe('signedIn');
    // Memory kept: a second sign-in compares with the same account.
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: false });
  });

  test('getExpiredPhone resolves null when the status changes mid-read (sign-out)', async () => {
    const { manager, sessionStore, phoneStore } = setup();
    sessionStore.value = marker('1001');
    phoneStore.value = PHONE;
    await manager.restore();
    let release!: () => void;
    phoneStore.read.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () => resolve({ kind: 'value', value: PHONE });
        }),
    );
    const pending = manager.getExpiredPhone();
    await manager.signOut();
    expect(manager.getStatus()).toBe('signedOut');
    release();
    await expect(pending).resolves.toBeNull();
  });

  test('logs never contain the phone or the account id', async () => {
    const { manager, sessionStore, phoneStore, logger } = setup();
    sessionStore.value = marker('1001');
    phoneStore.value = PHONE;
    await manager.restore();
    await manager.getExpiredPhone();
    await manager.signIn(ARGS);
    manager.debugExpireInMemory?.();
    const dump = JSON.stringify(logger.entries());
    for (const secret of [PHONE, '1001', ACCESS, REFRESH, CHALLENGE, SMS_CODE]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe('account-switch hook (Story 2.8)', () => {
  const marker = (accountId: string) => JSON.stringify({ v: 1, expired: true, accountId });

  function withHook(impl?: (manager: ReturnType<typeof setup>['manager']) => Promise<void>) {
    const order: string[] = [];
    const hook = jest.fn(async () => {
      order.push('hook');
      await impl?.(ctx.manager);
    });
    const ctx = setup({ onAccountSwitch: hook });
    ctx.phoneStore.write.mockImplementation(async (value: string) => {
      order.push('phone');
      ctx.phoneStore.value = value;
    });
    ctx.sessionStore.write.mockImplementation(async (value: string) => {
      order.push('session');
      ctx.sessionStore.value = value;
    });
    return { ...ctx, hook, order };
  }

  test('another account id: E1 → hook → phone write → session write → signedIn', async () => {
    const { manager, sessionStore, hook, order, http } = withHook();
    sessionStore.value = marker('2002');
    await manager.restore();
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: true });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(http.get.mock.invocationCallOrder[0]).toBeLessThan(hook.mock.invocationCallOrder[0]);
    expect(order).toEqual(['hook', 'phone', 'session']);
    expect(manager.getStatus()).toBe('signedIn');
  });

  test('no previous account id: the hook runs too', async () => {
    const { manager, hook, order } = withHook();
    await manager.restore();
    await manager.signIn(ARGS);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['hook', 'phone', 'session']);
  });

  test('the same account id: no hook', async () => {
    const { manager, sessionStore, hook, order } = withHook();
    sessionStore.value = marker('1001');
    await manager.restore();
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: false });
    expect(hook).not.toHaveBeenCalled();
    expect(order).toEqual(['phone', 'session']);
  });

  test('the gate (signOut) inside the hook: old phone and marker cleared, then the new ones written; signedOut → signedIn', async () => {
    const { manager, sessionStore, phoneStore, order } = withHook(m => m.signOut());
    sessionStore.value = marker('2002');
    phoneStore.value = '+79990000000';
    await manager.restore();
    const statuses: string[] = [];
    manager.subscribe(s => statuses.push(s));
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: true });
    expect(order).toEqual(['hook', 'phone', 'session']);
    expect(phoneStore.clear).toHaveBeenCalledTimes(1);
    expect(sessionStore.clear).toHaveBeenCalledTimes(1);
    expect(phoneStore.clear.mock.invocationCallOrder[0]).toBeLessThan(phoneStore.write.mock.invocationCallOrder[0]);
    expect(sessionStore.clear.mock.invocationCallOrder[0]).toBeLessThan(sessionStore.write.mock.invocationCallOrder[0]);
    expect(phoneStore.value).toBe(PHONE);
    expect(JSON.parse(sessionStore.value ?? '')).toMatchObject({ accessToken: ACCESS, accountId: '1001' });
    expect(statuses).toEqual(['signedOut', 'signedIn']);
    expect(manager.getStatus()).toBe('signedIn');
    // The new session is the live one: E1 goes out with the new token.
    await expect(manager.validate()).resolves.toEqual({ kind: 'ok' });
  });

  test('the hook rejects: spent, nothing of the new account written, the old data kept', async () => {
    const { manager, sessionStore, phoneStore, order } = withHook(() => Promise.reject(new Error('keychain')));
    sessionStore.value = marker('2002');
    phoneStore.value = '+79990000000';
    await manager.restore();
    let failure: unknown;
    try {
      await manager.signIn(ARGS);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AuthError);
    expect(failure).toMatchObject({ kind: 'Unknown', challengeSpent: true });
    expect(order).toEqual(['hook']);
    expect(phoneStore.write).not.toHaveBeenCalled();
    expect(sessionStore.write).not.toHaveBeenCalled();
    expect(sessionStore.value).toBe(marker('2002'));
    expect(phoneStore.value).toBe('+79990000000');
    expect(manager.getStatus()).toBe('expired');
  });

  test('no hook set and the account changed: spent, nothing written (fail closed)', async () => {
    const { manager, sessionStore, phoneStore } = setup({ onAccountSwitch: null });
    sessionStore.value = marker('2002');
    phoneStore.value = '+79990000000';
    await manager.restore();
    await expect(manager.signIn(ARGS)).rejects.toMatchObject({ kind: 'Unknown', challengeSpent: true });
    expect(phoneStore.write).not.toHaveBeenCalled();
    expect(sessionStore.write).not.toHaveBeenCalled();
    expect(sessionStore.value).toBe(marker('2002'));
    expect(manager.getStatus()).toBe('expired');
  });

  test('no hook set and the same account: signs in (nothing to wipe)', async () => {
    const { manager, sessionStore } = setup({ onAccountSwitch: null });
    sessionStore.value = marker('1001');
    await manager.restore();
    await expect(manager.signIn(ARGS)).resolves.toEqual({ accountChanged: false });
  });

  test('setAccountSwitchHook replaces the hook', async () => {
    const { manager } = setup({ onAccountSwitch: null });
    const hook = jest.fn(() => Promise.resolve());
    manager.setAccountSwitchHook(hook);
    await manager.signIn(ARGS);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  test('logs the accountChanged line after the hook (which clears the ring); never the phone or an account id', async () => {
    let logger!: ReturnType<typeof setup>['logger'];
    const ctx = withHook(async m => {
      await m.signOut();
      // As the app's reset: the log ring is cleared by the hook.
      logger.clear();
    });
    logger = ctx.logger;
    ctx.sessionStore.value = marker('2002');
    await ctx.manager.restore();
    await ctx.manager.signIn(ARGS);
    expect(logger.entries().filter(e => e.scope === 'session' && e.message === 'accountChanged')).toHaveLength(1);
    const dump = JSON.stringify(logger.entries());
    for (const secret of [PHONE, '1001', '2002', ACCESS, REFRESH, CHALLENGE, SMS_CODE]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe('session robustness (spec-session-robustness)', () => {
  const marker = (accountId: string) => JSON.stringify({ v: 1, expired: true, accountId });

  test.each([
    ['an expiry marker', marker('1001')],
    ['a corrupted value', 'garbage'],
  ])('restore vs sign-in: a read (%s) that resolves after the sign-in writes no state', async (_name, value) => {
    const { manager, sessionStore } = setup();
    const reading = deferred<ReadResult>();
    sessionStore.read.mockImplementationOnce(() => reading.promise);
    const statuses: string[] = [];
    manager.subscribe(s => statuses.push(s));
    const restoring = manager.restore();
    await flush();
    await manager.signIn(ARGS);
    const signedIn = sessionStore.value;
    reading.resolve({ kind: 'value', value });
    await expect(restoring).resolves.toEqual({ status: 'signedIn' });
    expect(manager.getStatus()).toBe('signedIn');
    expect(statuses).toEqual(['signedIn']);
    expect(sessionStore.clear).not.toHaveBeenCalled();
    expect(sessionStore.value).toBe(signedIn);
    expect(JSON.parse(signedIn ?? '')).toMatchObject({ accessToken: ACCESS, accountId: '1001' });
  });

  test('restore vs sign-in: a read that rejects after the sign-in writes no state', async () => {
    const { manager, sessionStore } = setup();
    const reading = deferred<ReadResult>();
    sessionStore.read.mockImplementationOnce(() => reading.promise);
    const restoring = manager.restore();
    await flush();
    await manager.signIn(ARGS);
    reading.reject(new Error('keychain'));
    await expect(restoring).resolves.toEqual({ status: 'signedIn' });
    expect(manager.getStatus()).toBe('signedIn');
  });

  test('a failed same-account re-login write keeps the marker and the phone; a restart opens A11', async () => {
    const { manager, sessionStore, phoneStore } = setup();
    sessionStore.value = marker('1001');
    phoneStore.value = PHONE;
    await manager.restore();
    // As an ADR 0006 recovery: the failed write took the stored entry with it.
    sessionStore.write.mockImplementationOnce(async () => {
      sessionStore.value = null;
      throw new Error('keychain');
    });
    await expect(manager.signIn(ARGS)).rejects.toMatchObject({ kind: 'Unknown', challengeSpent: true });
    expect(sessionStore.value).toBe(marker('1001'));
    expect(phoneStore.value).toBe(PHONE);
    expect(phoneStore.clear).not.toHaveBeenCalled();
    expect(manager.getStatus()).toBe('expired');
    await expect(manager.getExpiredPhone()).resolves.toBe(PHONE);
    await expect(manager.restore()).resolves.toEqual({ status: 'expired', reason: 'expired' });
    await expect(manager.getExpiredPhone()).resolves.toBe(PHONE);
  });

  test('a failed new-account re-login write discards the marker and the phone', async () => {
    const { manager, sessionStore, phoneStore } = setup();
    sessionStore.value = marker('2002');
    phoneStore.value = PHONE;
    await manager.restore();
    sessionStore.write.mockRejectedValueOnce(new Error('keychain'));
    await expect(manager.signIn(ARGS)).rejects.toMatchObject({ kind: 'Unknown', challengeSpent: true });
    expect(sessionStore.value).toBeNull();
    expect(phoneStore.value).toBeNull();
  });
});
