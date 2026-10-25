import { createLogger } from '../../services/logger';
import { createAuthApiClient, SEND_CODE_URL, type FetchLike } from '../authApiClient';
import { AuthError } from '../authError';
import { AUTH_USER_AGENT } from '../profiles';

const PHONE = '+375291234567';
const DEVICE_ID = '3f0c2a8e-1b7d-4c3a-9e2f-5a6b7c8d9e0f';
const CHALLENGE = 'c'.repeat(64);

/** The live 200 shape (api-contract §2.2), sanitized. */
const OK_BODY = {
  data: {
    phoneCode: {
      code: CHALLENGE,
      expiresIn: 604800,
      phone: PHONE,
      sentTransport: 'gate',
    },
  },
};

function respond(status: number, body: unknown) {
  return {
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function setup(fetchImpl: FetchLike, timeoutMs?: number) {
  const fetchMock = jest.fn(fetchImpl);
  const log = createLogger();
  const client = createAuthApiClient({
    fetch: fetchMock,
    getDeviceId: () => Promise.resolve(DEVICE_ID),
    timeoutMs,
    logger: log,
  });
  return { client, fetchMock, log };
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

test('send: POST, form body without transport, exact auth headers, cookies omitted', async () => {
  const { client, fetchMock } = setup(() => Promise.resolve(respond(200, OK_BODY)));

  await expect(client.sendCode(PHONE)).resolves.toEqual({
    challenge: CHALLENGE,
    sentTransport: 'gate',
    expiresIn: 604800,
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(SEND_CODE_URL);
  expect(url).toBe('https://api.boosty.to/auth/phone/verification_code/send');
  expect(init.method).toBe('POST');
  expect(init.credentials).toBe('omit');
  expect(init.signal).toBeDefined();
  expect(init.body).toBe(`phone=%2B375291234567&device_os=web&device_id=${DEVICE_ID}`);
  expect(init.body).not.toContain('transport');
  expect(init.headers).toEqual({
    'User-Agent': AUTH_USER_AGENT,
    'X-App': 'web',
    'X-Locale': 'ru_RU',
    Referer: 'https://boosty.to/',
    Origin: 'https://boosty.to',
    Accept: 'application/json, text/plain, */*',
    'X-From-Id': DEVICE_ID,
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  expect(Object.keys(init.headers).map(k => k.toLowerCase())).not.toContain('authorization');
});

test('send: only code is required', async () => {
  const { client } = setup(() =>
    Promise.resolve(respond(200, { data: { phoneCode: { code: 'x', sentTransport: null } } })),
  );
  await expect(client.sendCode(PHONE)).resolves.toEqual({
    challenge: 'x',
    sentTransport: undefined,
    expiresIn: undefined,
  });
});

test('double send while in flight: exactly one request, same result', async () => {
  let release: (value: ReturnType<typeof respond>) => void = () => {};
  const { client, fetchMock } = setup(
    () => new Promise(resolve => {
      release = resolve;
    }),
  );

  const first = client.sendCode(PHONE);
  const second = client.sendCode(PHONE);
  await Promise.resolve();
  await Promise.resolve();
  release(respond(200, OK_BODY));
  await expect(first).resolves.toMatchObject({ challenge: CHALLENGE });
  await expect(second).resolves.toMatchObject({ challenge: CHALLENGE });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // After it settles, a new send is a new request.
  const third = client.sendCode(PHONE);
  await Promise.resolve();
  await Promise.resolve();
  release(respond(200, OK_BODY));
  await third;
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a different phone while a send is in flight: rejected, no request, no foreign challenge', async () => {
  let release: (value: ReturnType<typeof respond>) => void = () => {};
  const { client, fetchMock } = setup(
    () => new Promise(resolve => {
      release = resolve;
    }),
  );
  const first = client.sendCode(PHONE);
  expect(await kindOf(client.sendCode('+79162451807'))).toBe('Unknown');
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  release(respond(200, OK_BODY));
  await expect(first).resolves.toMatchObject({ challenge: CHALLENGE });
});

test('a device id read that never settles → Unknown after 30 s, no request', async () => {
  jest.useFakeTimers();
  try {
    const fetchMock = jest.fn();
    const client = createAuthApiClient({
      fetch: fetchMock,
      getDeviceId: () => new Promise<string>(() => {}),
      logger: createLogger(),
    });
    const result = kindOf(client.sendCode(PHONE));
    jest.advanceTimersByTime(30_000);
    expect(await result).toBe('Unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('429 sms_gate_ratelimit → TooManyAttempts, no retry', async () => {
  const { client, fetchMock } = setup(() =>
    Promise.resolve(
      respond(429, {
        error: 'sms_gate_ratelimit',
        error_description: 'To many attempts to send sms, sms-gate ratelimit',
      }),
    ),
  );
  expect(await kindOf(client.sendCode(PHONE))).toBe('TooManyAttempts');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([
  ['429 with another error', 429, { error: 'other' }],
  ['429 matched only by error_description', 429, { error_description: 'sms_gate_ratelimit' }],
  ['400 with another error', 400, { error: 'invalid_phone' }],
  ['400 that hints at captcha', 400, { error: 'captcha_required' }],
  ['403 captcha HTML', 403, '<html>captcha</html>'],
  ['500', 500, ''],
  ['200 without code', 200, { data: { phoneCode: {} } }],
  ['200 with an empty code', 200, { data: { phoneCode: { code: '' } } }],
  ['200 not JSON', 200, 'ok'],
])('%s → Unknown', async (_name, status, body) => {
  const { client, fetchMock } = setup(() => Promise.resolve(respond(status, body)));
  expect(await kindOf(client.sendCode(PHONE))).toBe('Unknown');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('fetch rejects → Network, no retry', async () => {
  const { client, fetchMock } = setup(() => Promise.reject(new TypeError('Network request failed')));
  expect(await kindOf(client.sendCode(PHONE))).toBe('Network');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('body read fails → Network', async () => {
  const { client } = setup(() =>
    Promise.resolve({ status: 200, text: () => Promise.reject(new Error('reset')) }),
  );
  expect(await kindOf(client.sendCode(PHONE))).toBe('Network');
});

test('timeout aborts the request after 30 s → Network', async () => {
  jest.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const { client } = setup((_url, init) => {
      signal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    });
    const result = kindOf(client.sendCode(PHONE));
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(29_999);
    expect(signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(signal?.aborted).toBe(true);
    expect(await result).toBe('Network');
  } finally {
    jest.useRealTimers();
  }
});

test('device id failure → Unknown, no request', async () => {
  const fetchMock = jest.fn();
  const client = createAuthApiClient({
    fetch: fetchMock,
    getDeviceId: () => Promise.reject(new Error('E_INSTALL_ID')),
    logger: createLogger(),
  });
  expect(await kindOf(client.sendCode(PHONE))).toBe('Unknown');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('logs never contain the phone, the challenge or the device id', async () => {
  const { client, log } = setup(() => Promise.resolve(respond(200, OK_BODY)));
  await client.sendCode(PHONE);
  const failing = setup(() => Promise.resolve(respond(429, { error: 'sms_gate_ratelimit' })));
  await kindOf(failing.client.sendCode(PHONE));

  const dump = JSON.stringify([...log.entries(), ...failing.log.entries()]);
  expect(log.entries().length).toBeGreaterThan(0);
  for (const secret of [PHONE, '375291234567', CHALLENGE, DEVICE_ID, 'sms-gate ratelimit']) {
    expect(dump).not.toContain(secret);
  }
});
