import { createLogger } from '../../services/logger';
import { createHttpClient, HttpTransportError, type HttpFetchLike } from '../httpClient';
import { CONTENT_USER_AGENT } from '../profiles';

const TOKEN = 't'.repeat(64);

function respond(status: number, body: unknown) {
  return {
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function setup(impl: HttpFetchLike) {
  const fetchMock = jest.fn(impl);
  const log = createLogger();
  return { client: createHttpClient({ fetch: fetchMock, logger: log }), fetchMock, log };
}

test('API path: GET with exactly the content profile and Bearer (ADR 0008)', async () => {
  const { client, fetchMock } = setup(() => Promise.resolve(respond(200, { id: 1001 })));
  await expect(client.get('/v1/user/current', TOKEN)).resolves.toEqual({
    status: 200,
    body: { id: 1001 },
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.boosty.to/v1/user/current');
  expect(init.method).toBe('GET');
  expect(init.credentials).toBe('omit');
  expect(init.headers).toEqual({
    'User-Agent': CONTENT_USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${TOKEN}`,
  });
  // No web headers, no X-From-Id.
  for (const name of ['X-App', 'X-Locale', 'Referer', 'Origin', 'X-From-Id']) {
    expect(init.headers).not.toHaveProperty(name);
  }
});

test('without a token: no Authorization', async () => {
  const { client, fetchMock } = setup(() => Promise.resolve(respond(401, { error: 'unauthorized' })));
  await expect(client.get('/v1/user/current', null)).resolves.toMatchObject({ status: 401 });
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
});

test.each([
  'https://cdn.example.invalid/v1/user/current',
  'https://api.boosty.to.example.invalid/x',
  'http://api.boosty.to/x',
  'https://api.boosty.to:8443/x',
])('a non-API host (%s) gets no Boosty header and no Authorization', async url => {
  const { client, fetchMock } = setup(() => Promise.resolve(respond(200, '')));
  await client.get(url, TOKEN);
  expect(fetchMock.mock.calls[0][1].headers).toEqual({});
});

test('non-JSON body → body undefined, status kept', async () => {
  const { client } = setup(() => Promise.resolve(respond(500, '<html>')));
  await expect(client.get('/v1/user/current', TOKEN)).resolves.toEqual({ status: 500, body: undefined });
});

test('transport failure → HttpTransportError', async () => {
  const { client } = setup(() => Promise.reject(new TypeError(`failed Bearer ${TOKEN}`)));
  await expect(client.get('/v1/user/current', TOKEN)).rejects.toBeInstanceOf(HttpTransportError);
});

test('aborts after 30 s → HttpTransportError', async () => {
  jest.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const { client } = setup((_url, init) => {
      signal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    });
    const result = client.get('/v1/user/current', TOKEN).catch(e => e);
    jest.advanceTimersByTime(29_999);
    expect(signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(await result).toBeInstanceOf(HttpTransportError);
  } finally {
    jest.useRealTimers();
  }
});

test('logs the path and status only', async () => {
  const { client, log } = setup(() => Promise.resolve(respond(200, { id: 1001, email: 'x' })));
  await client.get(`/v1/user/current?token=${TOKEN}`, TOKEN);
  const dump = JSON.stringify(log.entries());
  expect(dump).toContain('/v1/user/current');
  expect(dump).not.toContain(TOKEN);
  expect(dump).not.toContain('email');
});
