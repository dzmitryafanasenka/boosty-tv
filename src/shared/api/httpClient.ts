import { logger as appLogger, type Logger } from '../services/logger';
import { API_ORIGIN, contentProfileHeaders, isBoostyApiUrl } from './profiles';

/**
 * `HttpClient` (ADR 0008 `content` profile), minimal for Story 2.3: one GET
 * with the content headers and `Authorization: Bearer` for `api.boosty.to`
 * only, a 30 s timeout (`AbortController`) and no retry. Story 2.5 adds the
 * error taxonomy, retries, the refresh coordinator and `FixtureTransport`.
 *
 * - The token is passed by the caller (SessionManager); this module never
 *   stores it.
 * - Hosts other than `api.boosty.to` get no Boosty header and never
 *   `Authorization` (AD-11).
 * - `credentials: 'omit'`: no cookie is sent or stored in the native jar.
 * - Logs only the path and the status; never a token, a query or a body.
 */

export const CONTENT_REQUEST_TIMEOUT_MS = 30_000;

export type HttpFetchLike = (
  url: string,
  init: {
    method: 'GET';
    headers: Record<string, string>;
    credentials: 'omit';
    signal: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export type HttpResponse = {
  status: number;
  /** Parsed JSON, or undefined when the body is empty or not JSON. */
  body: unknown;
};

/** Transport failure or timeout; the message carries no request detail. */
export class HttpTransportError extends Error {
  constructor() {
    super('transport');
    this.name = 'HttpTransportError';
  }
}

export type HttpClient = {
  /**
   * `pathOrUrl`: an API path (`/v1/user/current`) or an absolute URL.
   * Resolves with any HTTP status; rejects with `HttpTransportError` only.
   */
  get(pathOrUrl: string, accessToken: string | null): Promise<HttpResponse>;
};

export type HttpClientDeps = {
  fetch?: HttpFetchLike;
  timeoutMs?: number;
  logger?: Logger;
};

function parseJson(text: string): unknown {
  try {
    return text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** The path only, for logs: no host, query or fragment. */
function logPath(url: string): string {
  return url.replace(/^https?:\/\/[^/]*/i, '').replace(/[?#].*$/, '');
}

export function createHttpClient({
  fetch: fetchImpl = (url, init) => fetch(url, init),
  timeoutMs = CONTENT_REQUEST_TIMEOUT_MS,
  logger = appLogger,
}: HttpClientDeps = {}): HttpClient {
  return {
    async get(pathOrUrl, accessToken) {
      const url = pathOrUrl.startsWith('/') ? `${API_ORIGIN}${pathOrUrl}` : pathOrUrl;
      const headers = isBoostyApiUrl(url)
        ? contentProfileHeaders(url, accessToken)
        : {};
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers,
          credentials: 'omit',
          signal: controller.signal,
        });
        const text = await response.text();
        logger.info('http', 'GET', { path: logPath(url), status: response.status });
        return { status: response.status, body: parseJson(text) };
      } catch {
        logger.warn('http', 'GET failed', { path: logPath(url) });
        throw new HttpTransportError();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** The app's client over the global `fetch`. */
export const httpClient: HttpClient = createHttpClient();
