import { z } from 'zod';
import { createLogger } from '../../services/logger';
import { AppError } from '../appError';
import { createFixtureTransport, type FixtureHandler } from '../fixtureTransport';
import {
  createHttpClient,
  fixedAccessToken,
  type AccessTokenSource,
} from '../httpClient';
import { CONTENT_USER_AGENT } from '../profiles';

const TOKEN = 't'.repeat(64);
const NEW_TOKEN = 'n'.repeat(64);

function setup(handler: FixtureHandler, tokens: AccessTokenSource = fixedSource()) {
  const transport = createFixtureTransport(handler);
  const log = createLogger();
  const sleep = jest.fn(() => Promise.resolve());
  const client = createHttpClient({ transport, tokens, logger: log, sleep });
  return { client, transport, log, sleep };
}

/** A source that never refreshed: a 401 asks `renew`. */
function fixedSource(renew: (used: string) => Promise<string | null> = () => Promise.resolve(null)) {
  return {
    getAccessToken: jest.fn(() => Promise.resolve({ token: TOKEN, refreshed: false })),
    renewAfterUnauthorized: jest.fn(renew),
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

test('API path: GET with exactly the content profile and Bearer (ADR 0008)', async () => {
  const { client, transport } = setup(() => ({ status: 200, body: { id: 1001 } }));
  await expect(client.get('/v1/user/current')).resolves.toEqual({ status: 200, body: { id: 1001 } });
  const [call] = transport.calls;
  expect(call.url).toBe('https://api.boosty.to/v1/user/current');
  expect(call.method).toBe('GET');
  expect(call.headers).toEqual({
    'User-Agent': CONTENT_USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${TOKEN}`,
  });
  for (const name of ['X-App', 'X-Locale', 'Referer', 'Origin', 'X-From-Id']) {
    expect(call.headers).not.toHaveProperty(name);
  }
});

test('credentials omitted and a signal on every request', async () => {
  const fetchMock = jest.fn(async () => ({ status: 200, text: async () => '{}' }));
  const client = createHttpClient({ transport: fetchMock, tokens: fixedAccessToken(TOKEN), logger: createLogger() });
  await client.get('/v1/user/current');
  const init = (fetchMock.mock.calls[0] as unknown[])[1] as { credentials: string; signal: AbortSignal };
  expect(init.credentials).toBe('omit');
  expect(init.signal).toBeDefined();
});

test('signed out (no token): no Authorization', async () => {
  const transport = createFixtureTransport(() => ({ status: 200, body: {} }));
  const client = createHttpClient({ transport, logger: createLogger() });
  await client.get('/v1/user/current');
  expect(transport.calls[0].headers).not.toHaveProperty('Authorization');
});

test.each([
  'https://cdn.example.invalid/v1/user/current',
  'https://api.boosty.to.example.invalid/x',
  'http://api.boosty.to/x',
  'https://api.boosty.to:8443/x',
])('a non-API host (%s) gets no Boosty header, no Authorization and no token lookup', async url => {
  const tokens = fixedSource();
  const { client, transport } = setup(() => ({ status: 401, body: {} }), tokens);
  expect(await kindOf(client.get(url))).toBe('Client');
  expect(transport.calls[0].headers).toEqual({});
  expect(tokens.getAccessToken).not.toHaveBeenCalled();
  expect(tokens.renewAfterUnauthorized).not.toHaveBeenCalled();
});

test('schema: a matching 2xx body is returned parsed; a mismatch is Parse', async () => {
  const schema = z.object({ id: z.number() });
  const ok = setup(() => ({ status: 200, body: { id: 1001, extra: true } }));
  await expect(ok.client.get('/v1/user/current', schema)).resolves.toEqual({ status: 200, body: { id: 1001 } });
  const bad = setup(() => ({ status: 200, body: { name: 'x' } }));
  expect(await kindOf(bad.client.get('/v1/user/current', schema))).toBe('Parse');
  const html = setup(() => ({ status: 200 }));
  expect(await kindOf(html.client.get('/v1/user/current', schema))).toBe('Parse');
});

test.each([
  [404, 'NotFound'],
  [403, 'Client'],
  [400, 'Client'],
  [410, 'Client'],
  [429, 'RateLimited'],
])('HTTP %s → %s, no retry', async (status, kind) => {
  const { client, transport, sleep } = setup(() => ({ status, body: { error: 'x' } }));
  expect(await kindOf(client.get('/v1/blog/x'))).toBe(kind);
  expect(transport.calls).toHaveLength(1);
  expect(sleep).not.toHaveBeenCalled();
});

test('a 403 never asks for a refresh (never expiry)', async () => {
  const tokens = fixedSource();
  const { client } = setup(() => ({ status: 403, body: {} }), tokens);
  expect(await kindOf(client.get('/v1/blog/x'))).toBe('Client');
  expect(tokens.renewAfterUnauthorized).not.toHaveBeenCalled();
});

describe('AD-6 retries', () => {
  test('GET Network: 2 retries with exponential backoff, then Network', async () => {
    const { client, transport, sleep } = setup(() => ({ network: true }));
    expect(await kindOf(client.get('/v1/user/current'))).toBe('Network');
    expect(transport.calls).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  test('GET Network then 200 → 200', async () => {
    let n = 0;
    const { client, transport } = setup(() => (++n === 1 ? { network: true } : { status: 200, body: {} }));
    await expect(client.get('/v1/user/current')).resolves.toMatchObject({ status: 200 });
    expect(transport.calls).toHaveLength(2);
  });

  test('GET Server: 1 retry, then Server', async () => {
    const { client, transport, sleep } = setup(() => ({ status: 503 }));
    expect(await kindOf(client.get('/v1/user/current'))).toBe('Server');
    expect(transport.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test.each(['POST', 'PUT', 'DELETE'] as const)('%s is never retried (Network, Server)', async method => {
    for (const reply of [{ network: true } as const, { status: 500 }]) {
      const { client, transport, sleep } = setup(() => reply);
      const kind = await kindOf(client.request({ method, path: '/v1/poll/1/vote', form: [['answer', '1']] }));
      expect(kind).toBe('network' in reply ? 'Network' : 'Server');
      expect(transport.calls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  test('a mutation sends a form body with Content-Type', async () => {
    const { client, transport } = setup(() => ({ status: 200, body: {} }));
    await client.request({ method: 'POST', path: '/v1/poll/1/vote', form: [['answer', '1,2']] });
    expect(transport.calls[0].body).toBe('answer=1%2C2');
    expect(transport.calls[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  test('every attempt has its own 30 s timeout → Network after the retries', async () => {
    jest.useFakeTimers();
    try {
      const transport = createFixtureTransport(() => ({ hang: true }));
      const client = createHttpClient({
        transport,
        tokens: fixedAccessToken(TOKEN),
        logger: createLogger(),
        sleep: () => Promise.resolve(),
      });
      const result = kindOf(client.get('/v1/user/current'));
      for (let i = 0; i < 3; i += 1) {
        for (let k = 0; k < 10; k += 1) {
          await Promise.resolve();
        }
        jest.advanceTimersByTime(29_999);
        expect(transport.calls).toHaveLength(i + 1);
        jest.advanceTimersByTime(1);
      }
      expect(await result).toBe('Network');
      expect(transport.calls).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('401', () => {
  test('one renew, one retry with the new token → 200', async () => {
    const tokens = fixedSource(() => Promise.resolve(NEW_TOKEN));
    const { client, transport } = setup(
      req => (req.headers.Authorization === `Bearer ${NEW_TOKEN}` ? { status: 200, body: { id: 1 } } : { status: 401 }),
      tokens,
    );
    await expect(client.get('/v1/user/current')).resolves.toMatchObject({ status: 200 });
    expect(tokens.renewAfterUnauthorized).toHaveBeenCalledWith(TOKEN);
    expect(transport.calls.map(c => c.headers.Authorization)).toEqual([`Bearer ${TOKEN}`, `Bearer ${NEW_TOKEN}`]);
  });

  test('a 401 on the retry → Client, no second renew', async () => {
    const tokens = fixedSource(() => Promise.resolve(NEW_TOKEN));
    const { client, transport } = setup(() => ({ status: 401 }), tokens);
    expect(await kindOf(client.get('/v1/user/current'))).toBe('Client');
    expect(tokens.renewAfterUnauthorized).toHaveBeenCalledTimes(1);
    expect(transport.calls).toHaveLength(2);
  });

  test('a 401 with a token just refreshed → Client, no renew', async () => {
    const { client, transport } = setup(() => ({ status: 401 }), fixedAccessToken(TOKEN));
    expect(await kindOf(client.get('/v1/user/current'))).toBe('Client');
    expect(transport.calls).toHaveLength(1);
  });

  test('renew gives no token → Client, no retry', async () => {
    const { client, transport } = setup(() => ({ status: 401 }));
    expect(await kindOf(client.get('/v1/user/current'))).toBe('Client');
    expect(transport.calls).toHaveLength(1);
  });

  test('renew rejects (SessionExpired) → the request fails with it', async () => {
    const tokens = fixedSource(() => Promise.reject(new AppError('SessionExpired')));
    const { client } = setup(() => ({ status: 401 }), tokens);
    expect(await kindOf(client.get('/v1/user/current'))).toBe('SessionExpired');
  });

  test('a mutation is not re-sent after a 401 (renew still runs)', async () => {
    const tokens = fixedSource(() => Promise.resolve(NEW_TOKEN));
    const { client, transport } = setup(() => ({ status: 401 }), tokens);
    expect(await kindOf(client.request({ method: 'POST', path: '/v1/poll/1/vote' }))).toBe('Client');
    expect(tokens.renewAfterUnauthorized).toHaveBeenCalledTimes(1);
    expect(transport.calls).toHaveLength(1);
  });
});

test('getAccessToken rejecting → the request fails with that kind, nothing sent', async () => {
  const tokens: AccessTokenSource = {
    getAccessToken: () => Promise.reject(new AppError('SessionExpired')),
    renewAfterUnauthorized: () => Promise.resolve(null),
  };
  const { client, transport } = setup(() => ({ status: 200 }), tokens);
  expect(await kindOf(client.get('/v1/user/current'))).toBe('SessionExpired');
  expect(transport.calls).toHaveLength(0);
});

test('logs the path and status only', async () => {
  const { client, log } = setup(() => ({ status: 200, body: { id: 1001, email: 'x' } }));
  await client.get(`/v1/user/current?token=${TOKEN}`);
  const dump = JSON.stringify(log.entries());
  expect(dump).toContain('/v1/user/current');
  expect(dump).not.toContain(TOKEN);
  expect(dump).not.toContain('Bearer');
  expect(dump).not.toContain('email');
});

test('retry: false sends a failing GET once', async () => {
  const { client, transport, sleep } = setup(() => ({ network: true }));
  expect(await kindOf(client.request({ path: '/v1/user/current', retry: false }))).toBe('Network');
  expect(transport.calls).toHaveLength(1);
  expect(sleep).not.toHaveBeenCalled();
});
