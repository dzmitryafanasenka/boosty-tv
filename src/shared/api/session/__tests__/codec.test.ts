import { decodeSession, encode, type ExpiryMarker, type StoredSession } from '../codec';

const SESSION: StoredSession = {
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 1_800_000_000_000,
  accountId: '1001',
};
const MARKER: ExpiryMarker = { v: 1, expired: true, accountId: '1001' };

describe('decodeSession', () => {
  test('a stored session round-trips', () => {
    expect(decodeSession(encode(SESSION))).toEqual({ kind: 'session', session: SESSION });
  });

  test('an expiry marker decodes to its account id only', () => {
    expect(decodeSession(encode(MARKER))).toEqual({ kind: 'expired', accountId: '1001' });
  });

  test('invalid JSON is null, not a throw', () => {
    expect(decodeSession('{not json')).toBeNull();
    expect(decodeSession('')).toBeNull();
  });

  test.each([
    ['a different version', { ...SESSION, v: 2 }],
    ['an empty access token', { ...SESSION, accessToken: '' }],
    ['a missing refresh token', { ...SESSION, refreshToken: undefined }],
    ['a string expiry', { ...SESSION, expiresAt: '1800000000000' }],
    ['an empty account id', { ...SESSION, accountId: '' }],
    ['a marker with expired: false', { ...MARKER, expired: false }],
    ['a marker without an account id', { v: 1, expired: true }],
    ['null', null],
    ['a string', 'session'],
  ])('a wrong shape is null: %s', (_label, value) => {
    expect(decodeSession(JSON.stringify(value))).toBeNull();
  });
});

test('encode is the stored JSON form', () => {
  expect(JSON.parse(encode(SESSION))).toEqual(SESSION);
  expect(JSON.parse(encode(MARKER))).toEqual(MARKER);
});
