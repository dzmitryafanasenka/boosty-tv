import {
  buildRefreshRequest,
  createRefreshCoordinator,
  defaultIsRefreshRejected,
  parseRefreshTokens,
} from '../refreshCoordinator';
import { buildCurrentUserRequest, type StoredSession } from '../phoneAuthApi';
import type { ReadResult } from '../spikeSecureStore';

/**
 * Story 1.4 spike: single-flight, proactive, reactive, rejected (no loop) and
 * network (tokens kept) with a mocked fetch and an in-memory store. Fake
 * values only; asserts no token reaches a log line.
 */

const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const DEVICE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OLD_ACCESS =
  'fake-access-old-000000000000000000000000000000000000000000000';
const OLD_REFRESH =
  'fake-refresh-old-11111111111111111111111111111111111111111111';
const NEW_ACCESS =
  'fake-access-new-222222222222222222222222222222222222222222222';
const NEW_REFRESH =
  'fake-refresh-new-3333333333333333333333333333333333333333333';
const SECRETS = [OLD_ACCESS, OLD_REFRESH, NEW_ACCESS, NEW_REFRESH, DEVICE];

type Reply = { status: number; body?: unknown } | 'throw';

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    v: 1,
    accessToken: OLD_ACCESS,
    refreshToken: OLD_REFRESH,
    expiresAt: NOW_S + 3600,
    savedAt: NOW_S - 100,
    ...overrides,
  };
}

function setup(opts: {
  stored?: StoredSession | null;
  route: (
    url: string,
    init: { body?: string; headers: Record<string, string> },
  ) => Reply;
}) {
  let stored: string | null =
    opts.stored === null ? null : JSON.stringify(opts.stored ?? session());
  const store = {
    read: jest.fn(
      async (): Promise<ReadResult> =>
        stored === null ? { kind: 'empty' } : { kind: 'value', value: stored },
    ),
    save: jest.fn(async (value: string) => {
      stored = value;
      return {
        kind: 'saved' as const,
        storage: 'KeystoreAESGCM_NoAuth',
        afterRecovery: false,
      };
    }),
  };
  const calls: Array<{ url: string; body?: string; auth?: string }> = [];
  const fetchImpl = jest.fn(
    async (
      url: string,
      init: { body?: string; headers: Record<string, string> },
    ) => {
      calls.push({ url, body: init.body, auth: init.headers.Authorization });
      // Let concurrent callers interleave before replying.
      await new Promise<void>(resolve => setTimeout(resolve, 5));
      const reply = opts.route(url, init);
      if (reply === 'throw') {
        throw new TypeError('Network request failed');
      }
      return {
        status: reply.status,
        headers: {
          get: (name: string) =>
            name === 'content-type' ? 'application/json' : null,
        },
        text: async () =>
          reply.body === undefined ? '' : JSON.stringify(reply.body),
      };
    },
  );
  const lines: string[] = [];
  const coordinator = createRefreshCoordinator({
    store,
    fetchImpl,
    getDeviceId: async () => DEVICE,
    log: line => lines.push(line),
    now: () => NOW_MS,
  });
  return {
    coordinator,
    calls,
    lines,
    store,
    stored: () =>
      stored === null ? null : (JSON.parse(stored) as StoredSession),
    refreshCalls: () => calls.filter(c => c.url.endsWith('/oauth/token/')),
    apiCalls: () => calls.filter(c => c.url.endsWith('/v1/user/current')),
  };
}

const E1 = () => buildCurrentUserRequest('placeholder');

const refreshOk = {
  status: 200,
  body: {
    access_token: NEW_ACCESS,
    refresh_token: NEW_REFRESH,
    expires_in: 2_592_000,
  },
};

function e1ByToken(init: { headers: Record<string, string> }): Reply {
  return init.headers.Authorization === `Bearer ${NEW_ACCESS}`
    ? { status: 200, body: { id: 1 } }
    : { status: 401, body: { error: 'unauthorized' } };
}

function expectNoSecrets(lines: string[]) {
  const text = lines.join('\n');
  for (const secret of SECRETS) {
    expect(text).not.toContain(secret);
  }
  expect(text).not.toMatch(/Bearer /);
}

describe('buildRefreshRequest', () => {
  it('posts the §2.3 form with web headers and X-From-Id', () => {
    const r = buildRefreshRequest({
      refreshToken: OLD_REFRESH,
      deviceId: DEVICE,
    });
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.boosty.to/oauth/token/');
    expect(r.headers['X-From-Id']).toBe(DEVICE);
    expect(r.headers['X-App']).toBe('web');
    expect(r.headers.Authorization).toBeUndefined();
    expect(r.body).toBe(
      `grant_type=refresh_token&refresh_token=${OLD_REFRESH}` +
        `&device_id=${DEVICE}&device_os=web`,
    );
  });
});

describe('parseRefreshTokens / defaultIsRefreshRejected', () => {
  it('accepts a response without refresh_token', () => {
    expect(parseRefreshTokens({ access_token: 'a' })).toEqual({
      accessToken: 'a',
      refreshToken: undefined,
      expiresIn: undefined,
    });
    expect(parseRefreshTokens({ refresh_token: 'r' })).toBeNull();
    expect(parseRefreshTokens('x')).toBeNull();
  });

  it('treats only 400 invalid_grant as rejection (live signal)', () => {
    expect(defaultIsRefreshRejected(400, { error: 'invalid_grant' })).toBe(true);
    expect(defaultIsRefreshRejected(400, { error: 'invalid_request' })).toBe(false);
    expect(defaultIsRefreshRejected(400)).toBe(false);
    expect(defaultIsRefreshRejected(401, { error: 'invalid_grant' })).toBe(false);
    expect(defaultIsRefreshRejected(429)).toBe(false);
    expect(defaultIsRefreshRejected(500)).toBe(false);
  });
});

describe('refresh coordinator', () => {
  it('proactive: 5 concurrent calls share exactly one refresh', async () => {
    const t = setup({
      stored: session({ expiresAt: NOW_S - 60 }),
      route: (url, init) =>
        url.endsWith('/oauth/token/') ? refreshOk : e1ByToken(init),
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => t.coordinator.callWithSession(E1)),
    );
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.apiCalls()).toHaveLength(5);
    for (const r of results) {
      expect(r).toMatchObject({
        kind: 'response',
        refreshed: true,
        retried: false,
      });
      expect(r.kind === 'response' && r.sanitized.status).toBe(200);
    }
    expect(t.stored()).toMatchObject({
      accessToken: NEW_ACCESS,
      refreshToken: NEW_REFRESH,
      expiresAt: NOW_S + 2_592_000,
    });
    expect(t.coordinator.getCounts()).toEqual({ refresh: 1, api: 5 });
    expect(t.lines.join('\n')).toContain('rotated=yes');
    expectNoSecrets(t.lines);
  });

  it('no refresh while more than 300 s remain', async () => {
    const t = setup({
      route: () => ({ status: 200, body: {} }),
    });
    await t.coordinator.callWithSession(E1);
    expect(t.refreshCalls()).toHaveLength(0);
    expect(t.apiCalls()[0].auth).toBe(`Bearer ${OLD_ACCESS}`);
  });

  it('reactive: 401 → one refresh → one retry → 200', async () => {
    const t = setup({
      route: (url, init) =>
        url.endsWith('/oauth/token/') ? refreshOk : e1ByToken(init),
    });
    const r = await t.coordinator.callWithSession(E1);
    expect(r).toMatchObject({
      kind: 'response',
      refreshed: true,
      retried: true,
    });
    expect(t.calls.map(c => c.url.split('.to')[1])).toEqual([
      '/v1/user/current',
      '/oauth/token/',
      '/v1/user/current',
    ]);
    expectNoSecrets(t.lines);
  });

  it('reactive: concurrent 401s share one refresh', async () => {
    const t = setup({
      route: (url, init) =>
        url.endsWith('/oauth/token/') ? refreshOk : e1ByToken(init),
    });
    const results = await Promise.all(
      Array.from({ length: 3 }, () => t.coordinator.callWithSession(E1)),
    );
    expect(t.refreshCalls()).toHaveLength(1);
    expect(
      results.every(r => r.kind === 'response' && r.sanitized.status === 200),
    ).toBe(true);
  });

  it('reactive: a 401 after the retry does not refresh again', async () => {
    const t = setup({
      route: url =>
        url.endsWith('/oauth/token/') ? refreshOk : { status: 401, body: {} },
    });
    const r = await t.coordinator.callWithSession(E1);
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.apiCalls()).toHaveLength(2);
    expect(r).toMatchObject({ kind: 'response', retried: true });
    expect(r.kind === 'response' && r.sanitized.status).toBe(401);
  });

  it('rejected refresh: one refresh, «expired», no loop, no further request', async () => {
    const t = setup({
      route: url =>
        url.endsWith('/oauth/token/')
          ? {
              status: 400,
              body: { error: 'invalid_grant', error_description: 'x' },
            }
          : { status: 401, body: {} },
    });
    const r = await t.coordinator.callWithSession(E1);
    expect(r.kind).toBe('expired');
    expect(r.kind === 'expired' && r.refreshSanitized?.status).toBe(400);
    expect(t.coordinator.getStatus()).toBe('expired');
    expect(t.calls).toHaveLength(2);
    // Later calls fail fast without any request.
    expect((await t.coordinator.callWithSession(E1)).kind).toBe('expired');
    expect(t.calls).toHaveLength(2);
    expect(t.lines.join('\n')).toContain('error: string = invalid_grant');
    // The stored copy is left for the caller to restore or clear.
    expect(t.stored()?.refreshToken).toBe(OLD_REFRESH);
    expectNoSecrets(t.lines);
  });

  it('reload after a rejected refresh restores signed-in from the store', async () => {
    const t = setup({
      route: url =>
        url.endsWith('/oauth/token/')
          ? { status: 400, body: { error: 'invalid_grant' } }
          : { status: 401 },
    });
    await t.coordinator.callWithSession(E1);
    expect(await t.coordinator.reload()).toBe('signed-in');
  });

  it.each([
    ['400 with another error', 400, { error: 'invalid_request' }],
    ['401 from the refresh endpoint', 401, { error: 'invalid_grant' }],
    ['403', 403, {}],
  ])('%s is not a rejection: tokens are kept', async (_n, status, body) => {
    const t = setup({
      route: url =>
        url.endsWith('/oauth/token/') ? { status, body } : { status: 401 },
    });
    await t.coordinator.callWithSession(E1);
    expect(t.coordinator.getStatus()).not.toBe('expired');
    expect(t.coordinator.getSession()?.refreshToken).toBe(OLD_REFRESH);
  });

  it('proactive refresh then 401 with the new token: no second refresh', async () => {
    const t = setup({
      stored: session({ expiresAt: NOW_S - 60 }),
      route: url =>
        url.endsWith('/oauth/token/')
          ? {
              status: 200,
              body: {
                access_token: NEW_ACCESS,
                refresh_token: NEW_REFRESH,
                expires_in: 2592000,
              },
            }
          : { status: 401, body: {} },
    });
    const r = await t.coordinator.callWithSession(E1);
    expect(t.refreshCalls()).toHaveLength(1);
    expect(t.apiCalls()).toHaveLength(1);
    expect(r.kind === 'response' && r.sanitized.status).toBe(401);
  });

  it('network loss during refresh keeps tokens and the signed-in status', async () => {
    const t = setup({
      stored: session({ expiresAt: NOW_S - 60 }),
      route: () => 'throw',
    });
    const r = await t.coordinator.callWithSession(E1);
    expect(r).toEqual({
      kind: 'network',
      stage: 'refresh',
      error: 'TypeError',
    });
    expect(t.coordinator.getStatus()).toBe('signed-in');
    expect(t.coordinator.getSession()?.refreshToken).toBe(OLD_REFRESH);
    expect(t.stored()?.accessToken).toBe(OLD_ACCESS);
    expect(t.store.save).not.toHaveBeenCalled();
    expect(t.apiCalls()).toHaveLength(0);
  });

  it('simulated transport failure sends nothing and keeps tokens', async () => {
    const t = setup({
      stored: session({ expiresAt: NOW_S - 60 }),
      route: () => ({ status: 500 }),
    });
    t.coordinator.failNextRefreshTransport();
    const r = await t.coordinator.callWithSession(E1);
    expect(r).toMatchObject({ kind: 'network', stage: 'refresh' });
    expect(t.calls).toHaveLength(0);
    expect(t.coordinator.getStatus()).toBe('signed-in');
    expect(t.coordinator.getCounts().refresh).toBe(1);
  });

  it('server error or rate limit during refresh keeps tokens', async () => {
    for (const status of [500, 429]) {
      const t = setup({
        stored: session({ expiresAt: NOW_S - 60 }),
        route: () => ({ status, body: {} }),
      });
      const r = await t.coordinator.callWithSession(E1);
      expect(r).toEqual({ kind: 'refresh-failed', outcome: 'server', status });
      expect(t.coordinator.getStatus()).toBe('signed-in');
    }
  });

  it('keeps the old refresh token when the response does not rotate it', async () => {
    const t = setup({
      stored: session({ expiresAt: NOW_S - 60 }),
      route: (url, init) =>
        url.endsWith('/oauth/token/')
          ? { status: 200, body: { access_token: NEW_ACCESS } }
          : e1ByToken(init),
    });
    await t.coordinator.callWithSession(E1);
    expect(t.stored()).toMatchObject({
      accessToken: NEW_ACCESS,
      refreshToken: OLD_REFRESH,
      expiresAt: null,
    });
    expect(t.lines.join('\n')).toContain('rotated=absent');
  });

  it('signed out: no request at all', async () => {
    const t = setup({ stored: null, route: () => ({ status: 200 }) });
    expect((await t.coordinator.callWithSession(E1)).kind).toBe('signed-out');
    expect(t.calls).toHaveLength(0);
  });

  it('signOut clears memory and calls the store clear', async () => {
    const t = setup({ route: () => ({ status: 200, body: {} }) });
    await t.coordinator.callWithSession(E1);
    const clear = jest.fn(async () => ({ kind: 'cleared' }));
    await t.coordinator.signOut(clear);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(t.coordinator.getSession()).toBeNull();
    expect(t.coordinator.getStatus()).toBe('signed-out');
  });
});
