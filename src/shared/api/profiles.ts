/**
 * The two API request profiles (ADR 0008). A client picks its profile; call
 * sites never pick headers. Only `api.boosty.to` gets either profile: other
 * hosts (CDN, audio/file hosts, GitHub) never get Boosty headers or
 * `Authorization` (AD-11).
 */

export const API_ORIGIN = 'https://api.boosty.to';
const API_HOST = 'api.boosty.to';

/**
 * `auth` profile UA: desktop Chrome, as the phone-auth and refresh calls
 * proven in Stories 1.3–1.4. Changing it needs a device sign-in check.
 */
export const AUTH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

/**
 * `content` profile UA: the reference client's mobile Android Chrome UA
 * (BoostBuddy `HttpClient.kt` `USER_AGENT`). It decides the CDN signature
 * (`srcAg` = `CHROME_ANDROID`) of every played URL (api-contract §6).
 * Changing it needs a device playback check.
 */
export const CONTENT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const ACCEPT = 'application/json, text/plain, */*';

export type Headers = Record<string, string>;

/**
 * True only for `https://api.boosty.to/...`: https, the exact host, no
 * explicit port and no user info.
 */
export function isBoostyApiUrl(url: string): boolean {
  const match = /^https:\/\/([^/?#]*)(?:[/?#]|$)/i.exec(url);
  return match !== null && match[1].toLowerCase() === API_HOST;
}

function requireBoostyApiUrl(url: string): void {
  if (!isBoostyApiUrl(url)) {
    throw new Error('Boosty API headers requested for a non-API host');
  }
}

/**
 * `auth` profile (`AuthApiClient`: send, confirm, refresh). Form-encoded
 * bodies; no `Authorization`.
 */
export function authProfileHeaders(url: string, deviceId: string): Headers {
  requireBoostyApiUrl(url);
  return {
    'User-Agent': AUTH_USER_AGENT,
    'X-App': 'web',
    'X-Locale': 'ru_RU',
    Referer: 'https://boosty.to/',
    Origin: 'https://boosty.to',
    Accept: ACCEPT,
    'X-From-Id': deviceId,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

/**
 * `content` profile (`HttpClient`, Story 2.5: every other API call,
 * including E1). No web headers, no `X-From-Id`.
 */
export function contentProfileHeaders(
  url: string,
  accessToken: string | null,
): Headers {
  requireBoostyApiUrl(url);
  const headers: Headers = {
    'User-Agent': CONTENT_USER_AGENT,
    Accept: ACCEPT,
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

/** `application/x-www-form-urlencoded`: spaces as `+`, `+` as `%2B`. */
export function encodeForm(
  pairs: ReadonlyArray<readonly [string, string]>,
): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
  return pairs.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}
