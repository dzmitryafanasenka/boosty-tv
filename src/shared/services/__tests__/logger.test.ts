import { createLogger, isSecretFieldKey, LOG_RING_CAPACITY, redact, type LogEntry } from '../logger';

const PHONE = '+375291234567';
const CHALLENGE = 'a'.repeat(20) + 'B9c8D7e6F5g4H3i2J1k0' + 'zZyYxXwWvVuUtTsSrRqQ'; // 60 chars
const TOKEN = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

describe('redact', () => {
  it.each([
    ['E.164 number', `send to ${PHONE} done`, PHONE],
    ['E.164 with separators', 'phone +7 (916) 245-18-07 ok', '245-18-07'],
    ['7+ digit run', 'id 2912345 and 1234567890', '2912345'],
    ['Bearer value', 'Authorization: Bearer abc.def-123', 'abc.def-123'],
    ['32+ opaque run', `challenge ${CHALLENGE}`, CHALLENGE],
    ['64-char token', `token=${TOKEN}`, TOKEN],
    ['URL with a query', 'GET https://cdn.example.com/v/1.m3u8?sig=xyz&expires=1 now', 'sig=xyz'],
    ['code= value', 'body code=abc12&device_os=web', 'abc12'],
    ['sms_code= value', 'sms_code=4821&x=1', '4821'],
    ['phone= value', 'phone=%2B375291234567', '%2B375291234567'],
    ['JSON code key', '{"code":"short-challenge"}', 'short-challenge'],
    // Story 8.3 (FR54, AD-14).
    ['Cookie header', 'Cookie: auth=s3ss10n; _ga=x1', 's3ss10n'],
    ['Set-Cookie header', 'set-cookie: refresh=r3fr; Path=/; HttpOnly', 'r3fr'],
    ['Basic Authorization', 'Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['bare-token Authorization', 'authorization:tok3n-value', 'tok3n-value'],
    ['access_token= value', 'grant access_token=at-123&x=1', 'at-123'],
    ['refresh_token= value', 'refresh_token=rt-456', 'rt-456'],
    ['token= value', 'token=short1', 'short1'],
    ['signedQuery= value', 'signedQuery=sq-789', 'sq-789'],
    ['signature= value', 'signature=sg-1', 'sg-1'],
    ['JSON access_token key', '{"access_token":"at-json"}', 'at-json'],
    ['JSON refresh_token key', '{"refresh_token": "rt-json"}', 'rt-json'],
    ['JSON token key', '{"token":"tk-json"}', 'tk-json'],
    ['JSON signedQuery key', '{"signedQuery":"sq-json"}', 'sq-json'],
    ['JSON sig key', '{"sig":"sg-json"}', 'sg-json'],
    ['JSON signature key', '{"signature":"sig-json"}', 'sig-json'],
    ['JSON numeric code', '{"code":4821}', '4821'],
    ['bare query with expires=', 'src ?expires=1735&acl=/v/*&hmac=ab12 next', 'hmac=ab12'],
    ['bare query with sig=', 'path /v/1.m3u8?sig=zz9&x=1', 'zz9'],
    ['bare query without ?', 'expires=1735&sig=q1w2', 'q1w2'],
  ])('removes %s', (_name, input, secret) => {
    const out = redact(input);
    expect(out).not.toContain(secret);
  });

  it('keeps ordinary text, short numbers and URLs without a query', () => {
    expect(redact('HTTP 429 sms_gate_ratelimit after 30000 ms')).toBe(
      'HTTP 429 sms_gate_ratelimit after 30000 ms',
    );
    expect(redact('see https://api.boosty.to/v1/user/current')).toBe(
      'see https://api.boosty.to/v1/user/current',
    );
  });

  it('Story 8.3: header values are replaced to the end of the line only', () => {
    expect(redact('Cookie: a=1; b=2\nnext line')).toBe('Cookie: <redacted>\nnext line');
    expect(redact('Authorization: Basic xyz')).toBe('Authorization: <redacted>');
    expect(redact('token=t1&page=2')).toBe('token=<redacted>&page=2');
    expect(redact('see ?sig=1 ok')).toBe('see <query> ok');
  });

  it('Story 8.3: ordinary words around the new keys stay', () => {
    expect(redact('retry after 2 s, expires soon')).toBe('retry after 2 s, expires soon');
    expect(redact('tokenless request, cookie jar empty')).toBe('tokenless request, cookie jar empty');
  });

  it('replaces values with stable markers', () => {
    expect(redact(`x ${PHONE} y`)).toBe('x <phone> y');
    expect(redact('Bearer abc')).toBe('Bearer <redacted>');
    expect(redact('code=abc&y=1')).toBe('code=<redacted>&y=1');
    expect(redact('https://h.example/p?q=1')).toBe('<url>');
  });
});

describe('isSecretFieldKey (Story 8.3)', () => {
  it.each([
    'token', 'Token', 'TOKEN', 'accessToken', 'refresh_token', 'idTokens',
    'cookie', 'Cookie', 'setCookie', 'Set-Cookie', 'cookies',
    'authorization', 'Authorization', 'AUTHORIZATION', 'proxyAuthorization',
    'signedQuery', 'signedquery', 'SIGNED_QUERY',
    'phone', 'Phone', 'phoneNumber', 'user.phone',
    'code', 'Code', 'sms_code', 'smsCode', 'statusCode',
  ])('%s is secret', key => {
    expect(isSecretFieldKey(key)).toBe(true);
  });

  it.each(['status', 'decoder', 'encoded', 'store', 'outcome', 'tokenizer', 'url', 'error'])('%s is not', key => {
    expect(isSecretFieldKey(key)).toBe(false);
  });
});

describe('createLogger', () => {
  it('Story 8.3: secret field keys get the marker whatever the value', () => {
    const log = createLogger();
    log.info('auth', 'm', {
      code: '4821',
      smsCode: 4821,
      Phone: 'x',
      accessToken: 'short',
      Cookie: 'a=1',
      Authorization: 'Basic abc',
      signedQuery: 'expires=1',
      token: true,
      status: 401,
    });
    expect(log.entries()[0].fields).toEqual({
      code: '<redacted>',
      smsCode: '<redacted>',
      Phone: '<redacted>',
      accessToken: '<redacted>',
      Cookie: '<redacted>',
      Authorization: '<redacted>',
      signedQuery: '<redacted>',
      token: '<redacted>',
      status: '401',
    });
  });

  it('Story 8.3: the sink gets each redacted entry after the ring; a throwing sink is ignored', () => {
    const log = createLogger({ now: () => 5 });
    const seen: LogEntry[] = [];
    log.setSink(entry => {
      seen.push(entry);
      throw new Error('sink broke');
    });
    log.warn('net', `Cookie: s=${TOKEN}`, { phone: PHONE, status: 500 });
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain(TOKEN);
    expect(JSON.stringify(seen)).not.toContain(PHONE);
    expect(seen[0]).toEqual(log.entries()[0]);
    // A copy: changing it does not change the ring.
    seen[0].message = 'changed';
    expect(log.entries()[0].message).toBe('Cookie: <redacted>');

    log.setSink(null);
    log.info('net', 'after');
    expect(seen).toHaveLength(1);
    expect(log.entries()).toHaveLength(2);
  });

  it('stores only redacted messages and fields in the ring', () => {
    const log = createLogger({ now: () => 1000 });
    log.info('auth', `sent to ${PHONE} with ${CHALLENGE}`, {
      phone: PHONE,
      challenge: CHALLENGE,
      header: `Bearer ${TOKEN}`,
      url: 'https://cdn.example.com/a.mp4?sig=s3cr3t',
      numericPhone: 375291234567,
      status: 200,
      ok: true,
      none: null,
      skipped: undefined,
    });

    const entries = log.entries();
    expect(entries).toHaveLength(1);
    const dump = JSON.stringify(entries);
    for (const secret of [PHONE, '375291234567', CHALLENGE, TOKEN, 's3cr3t']) {
      expect(dump).not.toContain(secret);
    }
    expect(entries[0]).toMatchObject({
      time: 1000,
      level: 'info',
      scope: 'auth',
      fields: { status: '200', ok: true, none: null },
    });
    expect(entries[0].fields).not.toHaveProperty('skipped');
  });

  it('keeps the last 200 entries', () => {
    const log = createLogger();
    for (let i = 0; i < LOG_RING_CAPACITY + 25; i += 1) {
      log.debug('t', `entry ${i}`);
    }
    const entries = log.entries();
    expect(entries).toHaveLength(LOG_RING_CAPACITY);
    expect(entries[0].message).toBe('entry 25');
    expect(entries[entries.length - 1].message).toBe(`entry ${LOG_RING_CAPACITY + 24}`);
  });

  it('records every level and can be cleared', () => {
    const log = createLogger();
    log.debug('s', 'd');
    log.info('s', 'i');
    log.warn('s', 'w');
    log.error('s', 'e');
    expect(log.entries().map(e => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  it('prints to console only when enabled, with redacted text', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      createLogger({ console: false }).info('auth', PHONE);
      expect(spy).not.toHaveBeenCalled();

      createLogger({ console: true }).info('auth', `to ${PHONE}`);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(spy.mock.calls)).not.toContain(PHONE);
    } finally {
      spy.mockRestore();
    }
  });

  it('entries() returns a copy', () => {
    const log = createLogger();
    log.info('s', 'm');
    log.entries().pop();
    expect(log.entries()).toHaveLength(1);
  });
});
