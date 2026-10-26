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

/** The path only, for logs: no host, query or fragment. */
export function logPath(url: string): string {
  return url.replace(/^https?:\/\/[^/]*/i, '').replace(/[?#].*$/, '');
}
