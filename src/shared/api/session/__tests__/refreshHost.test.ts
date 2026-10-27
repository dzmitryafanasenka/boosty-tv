import { SecureStoreError, type ReadResult, type SecureStore } from '../../../platform/secureStore';
import { createLogger } from '../../../services/logger';
import type { StoredSession } from '../codec';
import { createSessionCore } from '../core';
import { createRefreshHost } from '../refreshHost';

const SESSION: StoredSession = {
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 1_800_000_000_000,
  accountId: '1001',
};
const NEXT: StoredSession = { ...SESSION, accessToken: 'n'.repeat(64), refreshToken: 'm'.repeat(64) };

function memoryStore() {
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
  return store as SecureStore & typeof store;
}

function setup() {
  const sessionStore = memoryStore();
  const phoneStore = memoryStore();
  const logger = createLogger();
  const core = createSessionCore({ sessionStore, phoneStore, logger });
  const host = createRefreshHost(core, logger);
  return { core, host, sessionStore, phoneStore, logger };
}

function signedIn() {
  const t = setup();
  t.core.bumpGeneration();
  t.core.adoptSignedIn(SESSION);
  return { ...t, g: t.core.generation() };
}

describe('current', () => {
  test('the session and its generation while signed in', () => {
    const { host, g } = signedIn();
    expect(host.current()).toEqual({ session: SESSION, generation: g });
  });

  test('null when signed out, expired or while sign-out runs', () => {
    const { core, host } = signedIn();
    core.beginSignOut();
    expect(host.current()).toBeNull();
    core.endSignOut();
    core.markExpired();
    expect(host.current()).toBeNull();
    expect(host.isExpired()).toBe(true);
    expect(setup().host.current()).toBeNull();
  });
});

describe('persist', () => {
  test('writes the pair when the generation is current', async () => {
    const { host, sessionStore, g } = signedIn();
    await expect(host.persist(NEXT, g)).resolves.toBe('saved');
    expect(sessionStore.value).toBe(JSON.stringify(NEXT));
  });

  test("'stale' and nothing written for an older generation", async () => {
    const { core, host, sessionStore, g } = signedIn();
    core.bumpGeneration();
    await expect(host.persist(NEXT, g)).resolves.toBe('stale');
    expect(sessionStore.write).not.toHaveBeenCalled();
  });

  test("'stale' when sign-out starts while the write waits in the queue", async () => {
    const { core, host, sessionStore, g } = signedIn();
    let release = () => {};
    sessionStore.clear.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    const earlier = core.clearSession();
    const persisted = host.persist(NEXT, g);
    core.beginSignOut();
    await new Promise<void>(resolve => setImmediate(() => resolve()));
    release();
    await earlier;
    await expect(persisted).resolves.toBe('stale');
    expect(sessionStore.write).not.toHaveBeenCalled();
  });

  test('rejects when the write fails', async () => {
    const { host, sessionStore, g } = signedIn();
    sessionStore.write.mockRejectedValueOnce(new SecureStoreError('other'));
    await expect(host.persist(NEXT, g)).rejects.toBeInstanceOf(SecureStoreError);
  });
});

describe('adopt', () => {
  test('makes the pair current for the current generation', () => {
    const { core, host, g } = signedIn();
    expect(host.adopt(NEXT, g)).toBe(true);
    expect(core.current()).toBe(NEXT);
  });

  test('false and the session kept when stale, signing out or not signed in', () => {
    const { core, host, g } = signedIn();
    expect(host.adopt(NEXT, g - 1)).toBe(false);
    core.beginSignOut();
    expect(host.adopt(NEXT, g)).toBe(false);
    core.endSignOut();
    expect(core.current()).toBe(SESSION);
    core.markExpired();
    expect(host.adopt(NEXT, g)).toBe(false);
    expect(core.current()).toBeNull();
  });
});

describe('expire', () => {
  test('expired, the session replaced by the marker, the phone kept', async () => {
    const { core, host, sessionStore, phoneStore, g } = signedIn();
    phoneStore.value = '+375291234567';
    expect(host.expire(g)).toBe(true);
    expect(core.getStatus()).toBe('expired');
    expect(core.previousAccountId()).toBe('1001');
    await core.writePhone('+375291234567'); // drains the queue
    expect(JSON.parse(sessionStore.value ?? 'null')).toEqual({ v: 1, expired: true, accountId: '1001' });
    expect(phoneStore.clear).not.toHaveBeenCalled();
  });

  test('a late rejection of an older generation is dropped and logged', () => {
    const { core, host, sessionStore, logger, g } = signedIn();
    core.bumpGeneration();
    expect(host.expire(g)).toBe(false);
    expect(core.getStatus()).toBe('signedIn');
    expect(sessionStore.write).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.entries())).toContain('late rejection dropped');
  });

  test('never turns signedOut into expired', () => {
    const { core, host } = setup();
    expect(host.expire(core.generation())).toBe(false);
    expect(core.getStatus()).toBe('signedOut');
  });

  test('a failed marker write is logged and keeps expired', async () => {
    const { core, host, sessionStore, logger, g } = signedIn();
    sessionStore.write.mockRejectedValueOnce(new SecureStoreError('other'));
    expect(host.expire(g)).toBe(true);
    await core.clearPhone(); // drains the queue
    await new Promise<void>(resolve => setImmediate(() => resolve()));
    expect(core.getStatus()).toBe('expired');
    expect(
      logger.entries().some(e => e.level === 'error' && e.message === 'expiry marker not saved'),
    ).toBe(true);
  });
});
