/**
 * Story 2.5 integration: SessionManager + refresh coordinator + the real
 * HttpClient and AuthApiClient over one FixtureTransport, with in-memory
 * secure stores. Covers the spec matrix rows Cold start … Sign-out race and
 * the Story 1.4 spike scenarios. Fake values only.
 */
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import e1Unauthorized from '../src/test/fixtures/boosty/e1-no-token.json';
import refreshOkFixture from '../src/test/fixtures/boosty/refresh-ok.json';
import refreshRejectedFixture from '../src/test/fixtures/boosty/refresh-invalid-grant.json';
import type { ReadResult, SecureStore } from '../src/shared/platform/secureStore';
import { createLogger } from '../src/shared/services/logger';
import { AppError } from '../src/shared/api/appError';
import { createAuthApiClient } from '../src/shared/api/authApiClient';
import {
  createFixtureTransport,
  fixtureReply,
  type FixtureReply,
  type FixtureRequest,
} from '../src/shared/api/fixtureTransport';
import { createHttpClient } from '../src/shared/api/httpClient';
import { PROACTIVE_WINDOW_MS } from '../src/shared/api/refreshCoordinator';
import { createSessionManager, type SessionStatus } from '../src/shared/api/sessionManager';

const NOW = 1_800_000_000_000;
const DEVICE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OLD_ACCESS = 'a'.repeat(64);
const OLD_REFRESH = 'r'.repeat(64);
const NEW_ACCESS = 'n'.repeat(64);
const NEW_REFRESH = 'm'.repeat(64);
const SECRETS = [OLD_ACCESS, OLD_REFRESH, NEW_ACCESS, NEW_REFRESH, DEVICE];
const E1 = '/v1/user/current';
const TOKEN = '/oauth/token/';
const THIRTY_DAYS_S = 2_592_000;

/** The sanitized refresh-ok fixture with this test's fake tokens. */
const refreshOk = (overrides: Record<string, unknown> = {}): FixtureReply => ({
  status: refreshOkFixture.status,
  body: { ...refreshOkFixture.body, access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, ...overrides },
});
const refreshRejected = fixtureReply(refreshRejectedFixture);
const e1ByToken = (req: FixtureRequest): FixtureReply =>
  req.headers.Authorization === `Bearer ${NEW_ACCESS}` ? fixtureReply(e1Ok) : fixtureReply(e1Unauthorized);

type Stored = { v: 1; accessToken: string; refreshToken: string; expiresAt: number; accountId: string };

function stored(overrides: Partial<Stored> = {}): Stored {
  return {
    v: 1,
    accessToken: OLD_ACCESS,
    refreshToken: OLD_REFRESH,
    expiresAt: NOW + 3600_000,
    accountId: '1001',
    ...overrides,
  };
}

function memoryStore(events: string[], name: string) {
  const store = {
    value: null as string | null,
    read: jest.fn(async (): Promise<ReadResult> =>
      store.value === null ? { kind: 'empty' } : { kind: 'value', value: store.value },
    ),
    write: jest.fn(async (value: string) => {
      events.push(`${name}.write`);
      store.value = value;
    }),
    clear: jest.fn(async () => {
      events.push(`${name}.clear`);
      store.value = null;
    }),
  };
  return store as typeof store & SecureStore;
}

function setup({
  session = stored(),
  route,
  timeoutMs = 1_000,
}: {
  session?: Stored | null;
  route: (req: FixtureRequest) => FixtureReply | Promise<FixtureReply> | undefined;
  timeoutMs?: number;
}) {
  const events: string[] = [];
  const transport = createFixtureTransport(req => {
    events.push(`${req.method} ${req.path} ${req.headers.Authorization === `Bearer ${NEW_ACCESS}` ? 'new' : req.path === E1 ? 'old' : '-'}`);
    return route(req);
  });
  const logger = createLogger();
  const sessionStore = memoryStore(events, 'session');
  const phoneStore = memoryStore(events, 'phone');
  sessionStore.value = session ? JSON.stringify(session) : null;
  phoneStore.value = '+375291234567';
  const sleep = jest.fn(() => Promise.resolve());
  const clock = { now: NOW };
  const manager = createSessionManager({
    authApi: createAuthApiClient({ transport, getDeviceId: async () => DEVICE, timeoutMs, logger }),
    createHttp: tokens => createHttpClient({ transport, tokens, timeoutMs, logger, sleep }),
    sessionStore,
    phoneStore,
    now: () => clock.now,
    logger,
  });
  const statuses: SessionStatus[] = [];
  manager.subscribe(s => statuses.push(s));
  return {
    manager,
    clock,
    transport,
    events,
    logger,
    sessionStore,
    phoneStore,
    statuses,
    sleep,
    refreshCalls: () => transport.callsTo(TOKEN),
    e1Calls: () => transport.callsTo(E1),
    storedSession: () => (sessionStore.value === null ? null : (JSON.parse(sessionStore.value) as Stored)),
  };
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).kind;
  }
  throw new Error('expected a rejection');
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

function expectNoSecrets(logger: ReturnType<typeof createLogger>) {
  const dump = JSON.stringify(logger.entries());
  for (const secret of SECRETS) {
    expect(dump).not.toContain(secret);
  }
  expect(dump).not.toMatch(/Bearer /);
}

test('cold start: restore keeps the session in memory; E1 200 → ok, no refresh, signedIn', async () => {
  const t = setup({ route: () => fixtureReply(e1Ok) });
  await expect(t.manager.restore()).resolves.toEqual({ status: 'signedIn' });
  await expect(t.manager.validate()).resolves.toEqual({ kind: 'ok' });
  expect(t.e1Calls()).toHaveLength(1);
  expect(t.e1Calls()[0].headers.Authorization).toBe(`Bearer ${OLD_ACCESS}`);
  expect(t.refreshCalls()).toHaveLength(0);
  expect(t.manager.getStatus()).toBe('signedIn');
  expect(t.sessionStore.write).not.toHaveBeenCalled();
});

test('validate is single-flight and skipped when not signed in', async () => {
  const t = setup({ route: () => fixtureReply(e1Ok) });
  await expect(t.manager.validate()).resolves.toEqual({ kind: 'skipped' });
  expect(t.transport.calls).toHaveLength(0);
  await t.manager.restore();
  const [a, b] = await Promise.all([t.manager.validate(), t.manager.validate()]);
  expect(a).toEqual({ kind: 'ok' });
  expect(b).toEqual({ kind: 'ok' });
  expect(t.e1Calls()).toHaveLength(1);
});

test('onAppStateChange: E1 on every change to active, not on repeated active', async () => {
  const t = setup({ route: () => fixtureReply(e1Ok) });
  await t.manager.restore();
  t.manager.onAppStateChange('active');
  await flush();
  expect(t.e1Calls()).toHaveLength(0);
  t.manager.onAppStateChange('background');
  t.manager.onAppStateChange('active');
  await flush();
  expect(t.e1Calls()).toHaveLength(1);
  t.manager.onAppStateChange('inactive');
  t.manager.onAppStateChange('active');
  await flush();
  expect(t.e1Calls()).toHaveLength(2);
});

describe('proactive refresh', () => {
  test('< 300 s left, 5 concurrent GETs → 1 refresh, then all 5 sent with the new token', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW + PROACTIVE_WINDOW_MS - 1 }),
      route: req => (req.path === TOKEN ? refreshOk() : e1ByToken(req)),
    });
    await t.manager.restore();
    const results = await Promise.all(Array.from({ length: 5 }, () => t.manager.http.get(E1)));
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.e1Calls()).toHaveLength(5);
    expect(t.e1Calls().every(c => c.headers.Authorization === `Bearer ${NEW_ACCESS}`)).toBe(true);
    expect(t.storedSession()).toEqual(
      stored({ accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH, expiresAt: NOW + THIRTY_DAYS_S * 1000 }),
    );
    // Persist before adopt: the write lands before any request with the new token.
    expect(t.events.indexOf('session.write')).toBeGreaterThan(t.events.indexOf(`POST ${TOKEN} -`));
    expect(t.events.indexOf('session.write')).toBeLessThan(t.events.indexOf(`GET ${E1} new`));
    expect(t.refreshCalls()[0].form).toEqual({
      grant_type: 'refresh_token',
      refresh_token: OLD_REFRESH,
      device_id: DEVICE,
      device_os: 'web',
    });
    expectNoSecrets(t.logger);
  });

  test('exactly 300 s left → no refresh', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW + PROACTIVE_WINDOW_MS }),
      route: () => fixtureReply(e1Ok),
    });
    await t.manager.restore();
    await t.manager.http.get(E1);
    expect(t.refreshCalls()).toHaveLength(0);
  });

  test('a past expiresAt after restore → proactive refresh at the first request', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW - 86_400_000 }),
      route: req => (req.path === TOKEN ? refreshOk() : e1ByToken(req)),
    });
    await expect(t.manager.restore()).resolves.toEqual({ status: 'signedIn' });
    expect(t.transport.calls).toHaveLength(0);
    await expect(t.manager.validate()).resolves.toEqual({ kind: 'ok' });
    expect(t.events.filter(e => !e.startsWith('phone'))).toEqual([`POST ${TOKEN} -`, 'session.write', `GET ${E1} new`]);
  });

  test('a proactive refresh then a 401 with the new token: no second refresh → Client', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW - 1 }),
      route: req => (req.path === TOKEN ? refreshOk() : fixtureReply(e1Unauthorized)),
    });
    await t.manager.restore();
    expect(await kindOf(t.manager.http.get(E1))).toBe('Client');
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.e1Calls()).toHaveLength(1);
    expect(t.manager.getStatus()).toBe('signedIn');
  });
});

describe('401', () => {
  test('GET → 401 → 1 refresh, 1 retry → 200', async () => {
    const t = setup({ route: req => (req.path === TOKEN ? refreshOk() : e1ByToken(req)) });
    await t.manager.restore();
    await expect(t.manager.validate()).resolves.toEqual({ kind: 'ok' });
    expect(t.events.filter(e => !e.startsWith('phone'))).toEqual([
      `GET ${E1} old`,
      `POST ${TOKEN} -`,
      'session.write',
      `GET ${E1} new`,
    ]);
    expectNoSecrets(t.logger);
  });

  test('a 401 on the retry → Client, stays signedIn, no second refresh', async () => {
    const t = setup({ route: req => (req.path === TOKEN ? refreshOk() : fixtureReply(e1Unauthorized)) });
    await t.manager.restore();
    await expect(t.manager.validate()).resolves.toEqual({ kind: 'failed', error: 'Client' });
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.e1Calls()).toHaveLength(2);
    expect(t.manager.getStatus()).toBe('signedIn');
  });

  test('concurrent 401s share one refresh', async () => {
    const t = setup({ route: req => (req.path === TOKEN ? refreshOk() : e1ByToken(req)) });
    await t.manager.restore();
    const results = await Promise.all(Array.from({ length: 3 }, () => t.manager.http.get(E1)));
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(t.refreshCalls()).toHaveLength(1);
  });

  test('staggered: a 401 that arrives after another call’s refresh finished → retry with the current token, no refresh', async () => {
    const late = deferred<FixtureReply>();
    let oldTokenCalls = 0;
    const t = setup({
      route: req => {
        if (req.path === TOKEN) {
          return refreshOk();
        }
        if (req.headers.Authorization === `Bearer ${NEW_ACCESS}`) {
          return fixtureReply(e1Ok);
        }
        oldTokenCalls += 1;
        // The first call's 401 is held back until the second call is done.
        return oldTokenCalls === 1 ? late.promise : fixtureReply(e1Unauthorized);
      },
    });
    await t.manager.restore();
    const first = t.manager.http.get(E1);
    await flush();
    await expect(t.manager.http.get(E1)).resolves.toMatchObject({ status: 200 });
    expect(t.refreshCalls()).toHaveLength(1);
    late.resolve(fixtureReply(e1Unauthorized));
    await expect(first).resolves.toMatchObject({ status: 200 });
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.e1Calls().map(c => c.headers.Authorization)).toEqual([
      `Bearer ${OLD_ACCESS}`,
      `Bearer ${OLD_ACCESS}`,
      `Bearer ${NEW_ACCESS}`,
      `Bearer ${NEW_ACCESS}`,
    ]);
  });
});

describe('rejected refresh', () => {
  test('400 invalid_grant → expired; nothing further sent; no loop', async () => {
    const t = setup({ route: req => (req.path === TOKEN ? refreshRejected : fixtureReply(e1Unauthorized)) });
    await t.manager.restore();
    await expect(t.manager.validate()).resolves.toEqual({ kind: 'expired' });
    expect(t.manager.getStatus()).toBe('expired');
    expect(t.statuses).toEqual(['signedIn', 'expired']);
    expect(t.transport.calls).toHaveLength(2);
    expect(await kindOf(t.manager.http.get(E1))).toBe('SessionExpired');
    await expect(t.manager.validate()).resolves.toEqual({ kind: 'skipped' });
    expect(t.transport.calls).toHaveLength(2);
    // The stored session entry is cleared; the phone stays for re-login.
    await flush();
    expect(t.sessionStore.value).toBeNull();
    expect(t.phoneStore.value).toBe('+375291234567');
    expectNoSecrets(t.logger);
  });

  test('a proactive refresh rejected → SessionExpired, the request is not sent', async () => {
    const t = setup({ session: stored({ expiresAt: NOW }), route: req => (req.path === TOKEN ? refreshRejected : undefined) });
    await t.manager.restore();
    expect(await kindOf(t.manager.http.get(E1))).toBe('SessionExpired');
    expect(t.e1Calls()).toHaveLength(0);
    expect(t.manager.getStatus()).toBe('expired');
  });

  test('restore after expiry: no session, the phone kept → signedOut (expired)', async () => {
    const t = setup({ route: req => (req.path === TOKEN ? refreshRejected : fixtureReply(e1Unauthorized)) });
    await t.manager.restore();
    await t.manager.validate();
    await expect(t.manager.restore()).resolves.toEqual({ status: 'signedOut', reason: 'expired' });
    expect(t.manager.getStatus()).toBe('signedOut');
  });

  test('a failed clear on expiry is logged; the status stays expired', async () => {
    const t = setup({ route: req => (req.path === TOKEN ? refreshRejected : fixtureReply(e1Unauthorized)) });
    await t.manager.restore();
    t.sessionStore.clear.mockRejectedValueOnce(new Error('keychain'));
    await t.manager.validate();
    await flush();
    expect(t.manager.getStatus()).toBe('expired');
    expect(JSON.stringify(t.logger.entries())).toContain('expired session not cleared');
  });
});

describe('recoverable refresh failures keep the tokens and the request fails with its kind', () => {
  test.each<[string, FixtureReply, string]>([
    ['5xx', { status: 502 }, 'Server'],
    ['429', { status: 429, body: { error: 'rate_limited' } }, 'RateLimited'],
    ['400 other error', { status: 400, body: { error: 'invalid_request' } }, 'Client'],
    ['401', { status: 401, body: { error: 'invalid_grant' } }, 'Client'],
    ['403', { status: 403, body: {} }, 'Client'],
    ['network', { network: true }, 'Network'],
    ['timeout', { hang: true }, 'Network'],
    ['unparseable 200', { status: 200, body: { token: 'x' } }, 'Parse'],
  ])('%s', async (_name, reply, kind) => {
    const t = setup({
      session: stored({ expiresAt: NOW }),
      route: req => (req.path === TOKEN ? reply : fixtureReply(e1Ok)),
      timeoutMs: 20,
    });
    await t.manager.restore();
    expect(await kindOf(t.manager.http.get(E1))).toBe(kind);
    expect(t.manager.getStatus()).toBe('signedIn');
    expect(t.storedSession()).toEqual(stored({ expiresAt: NOW }));
    expect(t.sessionStore.write).not.toHaveBeenCalled();
    // Never retried, no loop; the request itself was not sent.
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.e1Calls()).toHaveLength(0);
    // Cooldown: the next request fails at once with the same kind, no refresh.
    expect(await kindOf(t.manager.http.get(E1))).toBe(kind);
    expect(t.refreshCalls()).toHaveLength(1);
    // After 30 s the kept tokens are tried again.
    t.clock.now = NOW + 30_000;
    await kindOf(t.manager.http.get(E1));
    expect(t.refreshCalls()).toHaveLength(2);
    expect(t.refreshCalls()[1].form.refresh_token).toBe(OLD_REFRESH);
  });

  test('after a 401: a recoverable refresh failure keeps the tokens and fails with its kind', async () => {
    const t = setup({ route: req => (req.path === TOKEN ? { status: 503 } : fixtureReply(e1Unauthorized)) });
    await t.manager.restore();
    await expect(t.manager.validate()).resolves.toEqual({ kind: 'failed', error: 'Server' });
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.manager.getStatus()).toBe('signedIn');
  });
});

describe('refresh cooldown and a still-valid token', () => {
  test('N sequential GETs after a 429 → 1 refresh within 30 s, a second after 30 s', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW }),
      route: req => (req.path === TOKEN ? { status: 429 } : fixtureReply(e1Ok)),
    });
    await t.manager.restore();
    for (let i = 0; i < 5; i += 1) {
      t.clock.now = NOW + i * 5_000;
      expect(await kindOf(t.manager.http.get(E1))).toBe('RateLimited');
    }
    expect(t.refreshCalls()).toHaveLength(1);
    t.clock.now = NOW + 30_000;
    await kindOf(t.manager.http.get(E1));
    expect(t.refreshCalls()).toHaveLength(2);
    expect(t.e1Calls()).toHaveLength(0);
  });

  test('a 401 renewal inside the cooldown does not refresh', async () => {
    const t = setup({ route: req => (req.path === TOKEN ? { status: 503 } : fixtureReply(e1Unauthorized)) });
    await t.manager.restore();
    await expect(t.manager.validate()).resolves.toEqual({ kind: 'failed', error: 'Server' });
    await expect(t.manager.validate()).resolves.toEqual({ kind: 'failed', error: 'Server' });
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.e1Calls()).toHaveLength(2);
  });

  test('a new generation (restore) resets the cooldown', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW }),
      route: req => (req.path === TOKEN ? { status: 503 } : fixtureReply(e1Ok)),
    });
    await t.manager.restore();
    await kindOf(t.manager.http.get(E1));
    await t.manager.restore();
    await kindOf(t.manager.http.get(E1));
    expect(t.refreshCalls()).toHaveLength(2);
  });

  test('proactive refresh failed but the token is not past expiresAt → the request goes with it', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW + 100_000 }),
      route: req => (req.path === TOKEN ? { status: 503 } : fixtureReply(e1Ok)),
    });
    await t.manager.restore();
    await expect(t.manager.http.get(E1)).resolves.toMatchObject({ status: 200 });
    expect(t.e1Calls()[0].headers.Authorization).toBe(`Bearer ${OLD_ACCESS}`);
    expect(t.refreshCalls()).toHaveLength(1);
    // Within the cooldown: no refresh, still the current token.
    await expect(t.manager.http.get(E1)).resolves.toMatchObject({ status: 200 });
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.manager.getStatus()).toBe('signedIn');
  });

  test('proactive refresh failed and the token is past expiresAt → the request fails, not sent', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW - 1 }),
      route: req => (req.path === TOKEN ? { status: 503 } : fixtureReply(e1Ok)),
    });
    await t.manager.restore();
    expect(await kindOf(t.manager.http.get(E1))).toBe('Server');
    expect(t.e1Calls()).toHaveLength(0);
  });
});

describe('rotation and expires_in', () => {
  test.each<[string, Record<string, unknown>, Partial<Stored>]>([
    ['missing refresh_token keeps the old one', { refresh_token: undefined }, { refreshToken: OLD_REFRESH, expiresAt: NOW + THIRTY_DAYS_S * 1000 }],
    ['missing expires_in keeps the previous expiry', { expires_in: undefined }, { expiresAt: NOW + 100_000 }],
    ['expires_in 300 keeps the previous expiry', { expires_in: 300 }, { expiresAt: NOW + 100_000 }],
    ['expires_in NaN-like string keeps the previous expiry', { expires_in: 'NaN' }, { expiresAt: NOW + 100_000 }],
    ['expires_in 301 is accepted', { expires_in: 301 }, { expiresAt: NOW + 301_000 }],
  ])('%s', async (_name, overrides, expected) => {
    const t = setup({
      session: stored({ expiresAt: NOW + 100_000 }),
      route: req => (req.path === TOKEN ? refreshOk(overrides) : e1ByToken(req)),
    });
    await t.manager.restore();
    await t.manager.http.get(E1);
    expect(t.storedSession()).toEqual(
      stored({ accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH, expiresAt: NOW + 100_000, ...expected }),
    );
  });

  test('save fails on adopt: old tokens kept in memory and storage, error logged, request fails', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW }),
      route: req => (req.path === TOKEN ? refreshOk() : e1ByToken(req)),
    });
    await t.manager.restore();
    t.sessionStore.write.mockRejectedValueOnce(new Error('keychain'));
    expect(await kindOf(t.manager.http.get(E1))).toBe('Client');
    expect(t.storedSession()).toEqual(stored({ expiresAt: NOW }));
    expect(t.manager.getStatus()).toBe('signedIn');
    expect(t.e1Calls()).toHaveLength(0);
    expect(t.logger.entries().some(e => e.level === 'error' && e.message.includes('not saved'))).toBe(true);
    // Memory still holds the old pair: the next request refreshes with it.
    await t.manager.http.get(E1);
    expect(t.refreshCalls().map(c => c.form.refresh_token)).toEqual([OLD_REFRESH, OLD_REFRESH]);
  });
});

describe('generation guard', () => {
  test('sign-out while a refresh is in flight: the late success is dropped; storage stays clear; signedOut', async () => {
    const pending = deferred<FixtureReply>();
    const t = setup({
      session: stored({ expiresAt: NOW }),
      route: req => (req.path === TOKEN ? pending.promise : fixtureReply(e1Ok)),
    });
    await t.manager.restore();
    const request = kindOf(t.manager.http.get(E1));
    await flush();
    await t.manager.signOut();
    expect(t.sessionStore.value).toBeNull();
    expect(t.phoneStore.value).toBeNull();
    pending.resolve(refreshOk());
    expect(await request).toBe('Client');
    expect(t.sessionStore.write).not.toHaveBeenCalled();
    expect(t.sessionStore.value).toBeNull();
    expect(t.manager.getStatus()).toBe('signedOut');
    expect(t.e1Calls()).toHaveLength(0);
    expect(JSON.stringify(t.logger.entries())).toContain('dropped');
  });

  test('a late rejection never turns signedOut into expired', async () => {
    const pending = deferred<FixtureReply>();
    const t = setup({
      session: stored({ expiresAt: NOW }),
      route: req => (req.path === TOKEN ? pending.promise : undefined),
    });
    await t.manager.restore();
    const request = kindOf(t.manager.http.get(E1));
    await flush();
    await t.manager.signOut();
    pending.resolve(refreshRejected);
    await request;
    expect(t.manager.getStatus()).toBe('signedOut');
    expect(t.statuses).toEqual(['signedIn', 'signedOut']);
  });

  test('sign-out during the save of a refreshed pair: the clear lands last', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW }),
      route: req => (req.path === TOKEN ? refreshOk() : e1ByToken(req)),
    });
    await t.manager.restore();
    const saving = deferred<void>();
    t.sessionStore.write.mockImplementationOnce(async (value: string) => {
      t.events.push('session.write');
      await saving.promise;
      t.sessionStore.value = value;
    });
    const request = kindOf(t.manager.http.get(E1));
    for (let i = 0; i < 5 && !t.events.includes('session.write'); i += 1) {
      await flush();
    }
    expect(t.events).toContain('session.write');
    const signingOut = t.manager.signOut();
    saving.resolve();
    await signingOut;
    expect(await request).toBe('Client');
    expect(t.sessionStore.value).toBeNull();
    expect(t.manager.getStatus()).toBe('signedOut');
    expect(t.e1Calls()).toHaveLength(0);
  });

  test('a request that needs a refresh after sign-out began: no refresh, storage stays clear, signedOut', async () => {
    const t = setup({
      session: stored({ expiresAt: NOW }),
      route: req => (req.path === TOKEN ? refreshOk() : fixtureReply(e1Ok)),
    });
    await t.manager.restore();
    const clearing = deferred<void>();
    t.sessionStore.clear.mockImplementationOnce(async () => {
      t.events.push('session.clear');
      await clearing.promise;
      t.sessionStore.value = null;
    });
    const signingOut = t.manager.signOut();
    await flush();
    const request = t.manager.http.get(E1).catch(() => undefined);
    await flush();
    clearing.resolve();
    await signingOut;
    await request;
    await flush();
    expect(t.refreshCalls()).toHaveLength(0);
    expect(t.sessionStore.write).not.toHaveBeenCalled();
    expect(t.sessionStore.value).toBeNull();
    expect(t.manager.getStatus()).toBe('signedOut');
  });

  test('reload (restore) while a refresh is in flight: the late result is dropped', async () => {
    const pending = deferred<FixtureReply>();
    const t = setup({
      session: stored({ expiresAt: NOW }),
      route: req => (req.path === TOKEN ? pending.promise : fixtureReply(e1Ok)),
    });
    await t.manager.restore();
    const request = kindOf(t.manager.http.get(E1));
    await flush();
    await t.manager.restore();
    pending.resolve(refreshOk());
    expect(await request).toBe('Client');
    expect(t.sessionStore.write).not.toHaveBeenCalled();
    expect(t.storedSession()).toEqual(stored({ expiresAt: NOW }));
    expect(t.manager.getStatus()).toBe('signedIn');
  });
});

describe('sign-out', () => {
  test('SecureStore first (session, phone), then memory; no request', async () => {
    const t = setup({ route: () => fixtureReply(e1Ok) });
    await t.manager.restore();
    await t.manager.signOut();
    expect(t.events).toEqual(['session.clear', 'phone.clear']);
    expect(t.manager.getStatus()).toBe('signedOut');
    expect(t.transport.calls).toHaveLength(0);
  });

  test('a failed clear rejects and keeps the in-memory session', async () => {
    const t = setup({ route: () => fixtureReply(e1Ok) });
    await t.manager.restore();
    t.sessionStore.clear.mockRejectedValueOnce(new Error('keychain'));
    await expect(t.manager.signOut()).rejects.toThrow();
    expect(t.manager.getStatus()).toBe('signedIn');
  });
});

test('offline start: E1 Network after 2 retries → failed Network, the session is kept', async () => {
  const t = setup({ route: () => ({ network: true }) });
  await t.manager.restore();
  await expect(t.manager.validate()).resolves.toEqual({ kind: 'failed', error: 'Network' });
  expect(t.e1Calls()).toHaveLength(3);
  expect(t.sleep).toHaveBeenCalledTimes(2);
  expect(t.manager.getStatus()).toBe('signedIn');
  expect(t.storedSession()).toEqual(stored());
  expect(t.refreshCalls()).toHaveLength(0);
});

test('debug trigger: corrupts the in-memory token only → E1 401 → one real refresh → retry 200', async () => {
  const t = setup({ route: req => (req.path === TOKEN ? refreshOk() : e1ByToken(req)) });
  await t.manager.restore();
  expect(t.manager.debugCorruptAccessToken).toBeDefined();
  await expect(t.manager.debugCorruptAccessToken?.()).resolves.toEqual({ kind: 'ok' });
  const [first, retry] = t.e1Calls();
  expect(first.headers.Authorization).toHaveLength(`Bearer ${OLD_ACCESS}`.length);
  expect(first.headers.Authorization).not.toBe(`Bearer ${OLD_ACCESS}`);
  expect(retry.headers.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
  expect(t.refreshCalls()).toHaveLength(1);
  // Only the rotated pair is ever written; the corrupted token never is.
  expect(t.sessionStore.write).toHaveBeenCalledTimes(1);
  expect(t.storedSession()).toMatchObject({ accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH });
  expectNoSecrets(t.logger);
});
