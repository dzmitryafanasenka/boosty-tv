import {
  buildConfirmRequest,
  buildCurrentUserRequest,
  buildSendCodeRequest,
  decodeSession,
  describeShape,
  encodeForm,
  execute,
  formatSanitized,
  maskPhone,
  normalizePhone,
  normalizeSmsCode,
  parseSendCode,
  parseTokens,
  sanitizeResponse,
  describeRateLimit,
  formatRateLimit,
  rateLimitSummary,
  sessionFromTokens,
  type FetchLike,
} from '../phoneAuthApi';

// Fake values only; never real data.
const PHONE = '+375291234567';
const DEVICE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CHALLENGE = 'challenge-abcdef';
const SMS = '481516';
const ACCESS = 'eyJfakeaccesstoken0000000000';
const REFRESH = 'fakerefreshtoken1111111111';
const SECRETS = [PHONE, '291234567', CHALLENGE, SMS, ACCESS, REFRESH];

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) {
    expect(text).not.toContain(secret);
  }
}

describe('normalizePhone', () => {
  test.each([
    ['+375291234567', '+375291234567'],
    ['375291234567', '+375291234567'],
    ['+375 (29) 123-45-67', '+375291234567'],
    ['+79990000000', '+79990000000'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  test.each([
    '',
    '9990000000', // 10 digits: national format is not guessed
    '+3752912345678901', // > 15 digits
    '+0123456789012',
    '37529+1234567',
    '++375291234567',
    '+37529abc4567',
  ])('rejects %p', input => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('maskPhone', () => {
  test('matrix example', () => {
    expect(maskPhone('+375291234567')).toBe('+375 •• ••• 45 67');
  });
  test('one-digit country code', () => {
    expect(maskPhone('+79990001234')).toBe('+7 ••• ••• 12 34');
  });
  test('two-digit country code', () => {
    expect(maskPhone('+48123456789')).toBe('+48 •• ••• 67 89');
  });
  test('never contains the hidden digits', () => {
    expect(maskPhone(PHONE)).not.toContain('291234');
  });
  test('invalid input → empty', () => {
    expect(maskPhone('375291234567')).toBe('');
  });
});

test('normalizeSmsCode', () => {
  expect(normalizeSmsCode(' 48 15 16 ')).toBe('481516');
  expect(normalizeSmsCode('12')).toBeNull();
  expect(normalizeSmsCode('12a4')).toBeNull();
});

test('encodeForm encodes "+" and spaces like a browser form', () => {
  expect(
    encodeForm([
      ['phone', '+375 29'],
      ['a&b', 'c=d'],
    ]),
  ).toBe('phone=%2B375+29&a%26b=c%3Dd');
});

describe('request building', () => {
  test('send: form fields, no transport, web headers + X-From-Id, no Bearer', () => {
    const r = buildSendCodeRequest({ phone: PHONE, deviceId: DEVICE });
    expect(r).toMatchObject({
      name: 'send',
      method: 'POST',
      url: 'https://api.boosty.to/auth/phone/verification_code/send',
    });
    expect(r.body).toBe(
      `phone=%2B375291234567&device_os=web&device_id=${DEVICE}`,
    );
    expect(r.headers).toEqual({
      'X-App': 'web',
      'X-Locale': 'ru_RU',
      Referer: 'https://boosty.to/',
      Origin: 'https://boosty.to',
      Accept: 'application/json, text/plain, */*',
      'User-Agent': expect.stringContaining('Chrome/'),
      'X-From-Id': DEVICE,
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(r.headers.Authorization).toBeUndefined();
  });

  test('resend adds transport=gate', () => {
    const r = buildSendCodeRequest({
      phone: PHONE,
      deviceId: DEVICE,
      transport: 'gate',
    });
    expect(r.name).toBe('resend');
    expect(r.body).toBe(
      `phone=%2B375291234567&device_os=web&device_id=${DEVICE}&transport=gate`,
    );
  });

  test('confirm: PUT with phone, challenge code, sms_code', () => {
    const r = buildConfirmRequest({
      phone: PHONE,
      challenge: CHALLENGE,
      smsCode: SMS,
      deviceId: DEVICE,
    });
    expect(r).toMatchObject({
      name: 'confirm',
      method: 'PUT',
      url: 'https://api.boosty.to/auth/phone/verification_code/confirm',
    });
    expect(r.body).toBe(
      `phone=%2B375291234567&code=${CHALLENGE}&sms_code=${SMS}&device_os=web&device_id=${DEVICE}`,
    );
    expect(r.headers['X-From-Id']).toBe(DEVICE);
    expect(r.headers.Authorization).toBeUndefined();
  });

  test('E1: GET /v1/user/current with Bearer and no body', () => {
    const r = buildCurrentUserRequest(ACCESS);
    expect(r).toMatchObject({
      name: 'E1',
      method: 'GET',
      url: 'https://api.boosty.to/v1/user/current',
    });
    expect(r.headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(r.body).toBeUndefined();
  });
});

describe('sanitizers', () => {
  const sendBody = {
    data: {
      phoneCode: {
        code: CHALLENGE,
        sentTransport: 'sms',
        expiresIn: 300000,
        phone: PHONE,
      },
    },
  };

  test('send shape keeps keys, types, enums and expiresIn only', () => {
    expect(describeShape(sendBody)).toEqual([
      '<root>: object',
      'data: object',
      'data.phoneCode: object',
      'data.phoneCode.code: string (len 16)',
      'data.phoneCode.sentTransport: string = sms',
      'data.phoneCode.expiresIn: number = 300000',
      'data.phoneCode.phone: string (len 13)',
    ]);
    expectNoSecrets(describeShape(sendBody));
  });

  test('token shape hides tokens, keeps expires_in', () => {
    const shape = describeShape({
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 86400,
    });
    expect(shape).toContain('expires_in: number = 86400');
    expectNoSecrets(shape);
  });

  test('enum keys with digit-bearing or odd values are not echoed', () => {
    const shape = describeShape({ error: SMS, type: PHONE, status: 'a b' });
    expectNoSecrets(shape);
    expect(shape).toContain('status: string (len 3)');
  });

  test('identifying key names are redacted; arrays use the first element', () => {
    const shape = describeShape({
      [PHONE]: 1,
      errors: [{ error: 'invalid_code', message: 'Неверный код' }],
    });
    expect(shape).toEqual([
      '<root>: object',
      '<redacted-key>: number',
      'errors: array(1)',
      'errors[0]: object',
      'errors[0].error: string = invalid_code',
      'errors[0].message: string (len 12)',
    ]);
  });

  test('sanitizeResponse: non-JSON, captcha flag, safe headers only', () => {
    const { sanitized, json } = sanitizeResponse({
      request: 'send',
      status: 403,
      contentType: 'text/html; charset=utf-8',
      retryAfter: '60',
      rawText: `<html>captcha required for ${PHONE}</html>`,
    });
    expect(json).toBeUndefined();
    expect(sanitized).toEqual({
      request: 'send',
      status: 403,
      contentType: 'text/html',
      isJson: false,
      shape: [expect.stringMatching(/^<non-JSON body> \(len \d+\)$/)],
      captchaMentioned: true,
      retryAfter: '60',
    });
    expectNoSecrets(sanitized);
    expectNoSecrets(formatSanitized(sanitized));
  });

  test('sanitizeResponse: JSON body is returned for parsing but not in the sanitized part', () => {
    const { sanitized, json } = sanitizeResponse({
      request: 'send',
      status: 200,
      contentType: 'application/json',
      retryAfter: null,
      rawText: JSON.stringify(sendBody),
    });
    expect(json).toEqual(sendBody);
    expect(sanitized.captchaMentioned).toBe(false);
    expect(sanitized.retryAfter).toBeUndefined();
    expectNoSecrets(sanitized);
  });
});

describe('parsing', () => {
  test('parseSendCode', () => {
    expect(
      parseSendCode({
        data: { phoneCode: { code: CHALLENGE, sentTransport: 'sms' } },
      }),
    ).toEqual({
      challenge: CHALLENGE,
      sentTransport: 'sms',
      expiresIn: undefined,
    });
    expect(parseSendCode({ data: {} })).toBeNull();
    expect(parseSendCode({ data: { phoneCode: { code: '' } } })).toBeNull();
    expect(parseSendCode(null)).toBeNull();
  });

  test('parseTokens', () => {
    expect(
      parseTokens({
        access_token: ACCESS,
        refresh_token: REFRESH,
        expires_in: 100,
      }),
    ).toEqual({ accessToken: ACCESS, refreshToken: REFRESH, expiresIn: 100 });
    expect(parseTokens({ access_token: ACCESS })).toBeNull();
    expect(
      parseTokens({ accessToken: ACCESS, refreshToken: REFRESH }),
    ).toBeNull();
  });

  test('session round-trip; expires_in read as seconds', () => {
    const session = sessionFromTokens(
      { accessToken: ACCESS, refreshToken: REFRESH, expiresIn: 3600 },
      1_700_000_000_500,
    );
    expect(session).toEqual({
      v: 1,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: 1_700_003_600,
      savedAt: 1_700_000_000,
    });
    expect(decodeSession(JSON.stringify(session))).toEqual(session);
    expect(decodeSession('not json')).toBeNull();
    expect(decodeSession('{"v":2}')).toBeNull();
  });
});

describe('execute', () => {
  test('429: enumerates response headers into rateLimit, never header values except limit ones', async () => {
    const all: Array<[string, string]> = [
      ['content-type', 'application/json'],
      ['retry-after', '120'],
      ['set-cookie', 'session=secretvalue'],
    ];
    const fetchImpl: FetchLike = async () => ({
      status: 429,
      headers: {
        get: (n: string) =>
          all.find(([k]) => k === n.toLowerCase())?.[1] ?? null,
        forEach: (cb: (value: string, name: string) => void) =>
          all.forEach(([k, v]) => cb(v, k)),
      },
      text: async () =>
        '{"error":"sms_gate_ratelimit","error_description":"wait"}',
    });
    const result = await execute(buildCurrentUserRequest(ACCESS), fetchImpl);
    if (result.kind !== 'response') {
      throw new Error('expected a response');
    }
    expect(result.sanitized.rateLimit).toMatchObject({
      limitHeaders: [['retry-after', '120']],
      headerNames: ['content-type', 'retry-after', 'set-cookie'],
      description: 'wait',
    });
    expect(JSON.stringify(result.sanitized)).not.toContain('secretvalue');
  });

  function response(
    status: number,
    body: string,
    contentType = 'application/json',
  ) {
    return {
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? contentType : null,
      },
      text: async () => body,
    };
  }

  test('sends once with credentials omitted, returns sanitized + json', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(
      async () => response(401, '{"error":"unauthorized"}'),
    );
    const request = buildCurrentUserRequest(ACCESS);
    const result = await execute(request, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'omit',
    });
    expect(result).toMatchObject({
      kind: 'response',
      sanitized: {
        status: 401,
        shape: ['<root>: object', 'error: string = unauthorized'],
      },
      json: { error: 'unauthorized' },
    });
  });

  test('network failure: error name only, no retry', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError(`Network request failed ${PHONE}`);
    });
    const result = await execute(
      buildSendCodeRequest({ phone: PHONE, deviceId: DEVICE }),
      fetchImpl,
    );
    expect(result).toEqual({
      kind: 'network',
      request: 'send',
      error: 'TypeError',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('timeout aborts and reports Timeout', async () => {
    jest.useFakeTimers();
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    const pending = execute(buildCurrentUserRequest(ACCESS), fetchImpl, 1000);
    jest.advanceTimersByTime(1000);
    await expect(pending).resolves.toEqual({
      kind: 'network',
      request: 'E1',
      error: 'Timeout',
    });
    jest.useRealTimers();
  });

  describe('429 rate-limit details', () => {
    const headers: Array<[string, string]> = [
      ['Content-Type', 'application/json'],
      ['X-RateLimit-Reset', '3600'],
      ['Set-Cookie', 'session=secretvalue'],
    ];

    test('safe description, limit header values, all header names without values', () => {
      const info = describeRateLimit(headers, {
        error: 'sms_gate_ratelimit',
        error_description: 'Too many attempts, try again later',
      });
      expect(info.limitHeaders).toEqual([['x-ratelimit-reset', '3600']]);
      expect(info.headerNames).toEqual([
        'content-type',
        'set-cookie',
        'x-ratelimit-reset',
      ]);
      expect(info.description).toBe(
        'Too many attempts, try again later',
      );
      const text = formatRateLimit(info).join('\n');
      expect(text).not.toContain('secretvalue');
      expect(rateLimitSummary(info)).toContain('try again later');
    });

    test('description with any digit or "@" is hidden; only length and digit count kept', () => {
      for (const text of [
        'Phone +7 999 123-45-67 blocked',
        'Code 1234 rejected, wait 30 min',
        'a@b.c',
      ]) {
        const info = describeRateLimit([], { error_description: text });
        expect(info.description).toBeUndefined();
        const out = formatRateLimit(info).join('\n') + rateLimitSummary(info);
        expect(out).not.toMatch(/999|123-|1234|wait 30|@b|Phone|Code/);
      }
      expect(
        describeRateLimit([], { error_description: 'Code 1234' })
          .descriptionDigits,
      ).toBe(4);
    });

    test('unsafe limit header value is replaced by its length', () => {
      const info = describeRateLimit([['Retry-After', 'x'.repeat(100)]], {});
      expect(info.limitHeaders).toEqual([['retry-after', '<unsafe, len 100>']]);
      expect(rateLimitSummary(describeRateLimit([], {}))).toBe(
        'сервер не указал, когда можно повторить',
      );
    });

    test('sanitizeResponse attaches rateLimit only for 429', () => {
      const body = JSON.stringify({
        error: 'sms_gate_ratelimit',
        error_description: 'wait',
      });
      const args = {
        request: 'send' as const,
        contentType: 'application/json',
        retryAfter: null,
        rawText: body,
        headers,
      };
      expect(
        sanitizeResponse({ ...args, status: 429 }).sanitized.rateLimit
          ?.description,
      ).toBe('wait');
      expect(
        sanitizeResponse({ ...args, status: 400 }).sanitized.rateLimit,
      ).toBeUndefined();
    });
  });
});
