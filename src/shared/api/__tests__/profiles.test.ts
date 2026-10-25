import {
  AUTH_USER_AGENT,
  CONTENT_USER_AGENT,
  authProfileHeaders,
  contentProfileHeaders,
  encodeForm,
  isBoostyApiUrl,
} from '../profiles';

const URL = 'https://api.boosty.to/auth/phone/verification_code/send';

test('auth profile: the exact ADR 0008 header set, no Authorization', () => {
  expect(authProfileHeaders(URL, 'dev-1')).toEqual({
    'User-Agent': AUTH_USER_AGENT,
    'X-App': 'web',
    'X-Locale': 'ru_RU',
    Referer: 'https://boosty.to/',
    Origin: 'https://boosty.to',
    Accept: 'application/json, text/plain, */*',
    'X-From-Id': 'dev-1',
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  expect(AUTH_USER_AGENT).toContain('Macintosh');
});

test('content profile: mobile UA, Accept and Bearer only', () => {
  expect(contentProfileHeaders('https://api.boosty.to/v1/user/current', 'tok')).toEqual({
    'User-Agent': CONTENT_USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    Authorization: 'Bearer tok',
  });
  expect(contentProfileHeaders('https://api.boosty.to/v1/blog/x', null)).not.toHaveProperty(
    'Authorization',
  );
  expect(CONTENT_USER_AGENT).toContain('Android');
});

test('no profile headers for hosts other than api.boosty.to', () => {
  for (const url of [
    'https://cdn.boosty.to/video.m3u8',
    'https://api.boosty.to.evil.example/x',
    'http://api.boosty.to/x',
    'https://github.com/x',
    'https://api.boosty.to:8443/x',
    'https://api.boosty.to:443/x',
    'https://user@api.boosty.to/x',
  ]) {
    expect(isBoostyApiUrl(url)).toBe(false);
    expect(() => authProfileHeaders(url, 'd')).toThrow();
    expect(() => contentProfileHeaders(url, 'tok')).toThrow();
  }
  expect(isBoostyApiUrl('https://api.boosty.to')).toBe(true);
  expect(isBoostyApiUrl('https://API.boosty.to/v1?x=1')).toBe(true);
});

test('form encoding: + as %2B, spaces as +', () => {
  expect(encodeForm([['phone', '+375291234567'], ['a b', 'c d']])).toBe(
    'phone=%2B375291234567&a+b=c+d',
  );
});
