import { createLogger, LOG_RING_CAPACITY, redact } from '../logger';

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

  it('replaces values with stable markers', () => {
    expect(redact(`x ${PHONE} y`)).toBe('x <phone> y');
    expect(redact('Bearer abc')).toBe('Bearer <redacted>');
    expect(redact('code=abc&y=1')).toBe('code=<redacted>&y=1');
    expect(redact('https://h.example/p?q=1')).toBe('<url>');
  });
});

describe('createLogger', () => {
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
