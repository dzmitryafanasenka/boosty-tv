/**
 * The network layer of `HttpClient` and `AuthApiClient`: a `fetch`-shaped
 * function. Production uses the global `fetch`; integration tests and the
 * debug demo mode pass `FixtureTransport` instead (the one seam, epic 2
 * "FixtureTransport"). Nothing else is swapped: headers, timeouts, error
 * mapping and the refresh coordinator run unchanged over a fixture.
 */

export type TransportInit = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  credentials: 'omit';
  signal: AbortSignal;
};

export type TransportResponse = { status: number; text(): Promise<string> };

export type Transport = (
  url: string,
  init: TransportInit,
) => Promise<TransportResponse>;

/** The global `fetch`, looked up at call time. */
export const fetchTransport: Transport = (url, init) => fetch(url, init);

/** Parsed JSON, or undefined when the body is empty or not JSON. */
export function parseJson(text: string): unknown {
  try {
    return text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The fixed words of the API paths this client calls. Story 8.3 review:
 * every other segment (a blog slug, a post, media or poll id) reveals the
 * account's subscriptions or viewing history, and http lines now reach the
 * diagnostics file, so it is masked.
 */
const API_WORDS: ReadonlySet<string> = new Set([
  'v1',
  'blog',
  'post',
  'feed',
  'user',
  'current',
  'subscriptions',
  'search',
  'tag',
  'video_stream',
  'poll',
  'vote',
  'notification',
  'standalone',
  'event',
  'viewstat',
  'video',
  'timecode',
  'oauth',
  'token',
]);

/**
 * The path only, for logs: no host, query or fragment, and every variable
 * segment masked: the one after `/v1/blog/` is `<blog>` (whatever it spells), any
 * other word outside `API_WORDS` is `<seg>`. `/v1/feed/post/` and
 * `/v1/user/current` stay as they are.
 */
export function logPath(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]*/i, '').replace(/[?#].*$/, '');
  const parts = path.split('/');
  return parts
    .map((part, index) => {
      if (part === '') {
        return part;
      }
      if (index > 1 && parts[index - 1] === 'blog' && parts[index - 2] === 'v1') {
        return '<blog>';
      }
      return API_WORDS.has(part) ? part : '<seg>';
    })
    .join('/');
}
