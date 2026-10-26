import type { z } from 'zod';
import { logger as appLogger, type Logger } from '../services/logger';
import { AppError, kindForStatus, retriesFor, type AppErrorKind } from './appError';
import {
  API_ORIGIN,
  contentProfileHeaders,
  encodeForm,
  isBoostyApiUrl,
} from './profiles';
import {
  fetchTransport,
  logPath,
  parseJson,
  type Transport,
} from './transport';

/**
 * `HttpClient` (ADR 0008 `content` profile): every `api.boosty.to` call
 * except phone auth and refresh, including E1.
 *
 * - The token comes only from the injected `AccessTokenSource`
 *   (SessionManager, AD-3); callers never pass one. It may refresh
 *   proactively before the request.
 * - A 401 from `api.boosty.to` asks the source to renew once (single-flight
 *   refresh, or the newer token another call already got) and a GET is
 *   retried once with it. A 401 after that, or after a token that was just
 *   refreshed, fails with `Client`: no second refresh.
 * - AD-6 retries (GET only): `Network` ≤ 2 with exponential backoff,
 *   `Server` ≤ 1. Mutations are never retried or replayed.
 * - Every attempt has its own timeout (`AbortController`).
 * - Resolves 2xx only; everything else rejects with `AppError`. With a
 *   schema, a 2xx body that does not match is `Parse`.
 * - Hosts other than `api.boosty.to` get no Boosty header, never
 *   `Authorization` and no refresh (AD-11).
 * - `credentials: 'omit'`: no cookie is sent or stored in the native jar.
 * - Logs only the method, the path, the status and the attempt; never a
 *   token, a query or a body.
 */

export const CONTENT_REQUEST_TIMEOUT_MS = 30_000;
/** First backoff delay; doubles per retry (1 s, 2 s). */
export const RETRY_BASE_MS = 1_000;

/** @deprecated The shared `Transport`; kept for existing tests. */
export type HttpFetchLike = Transport;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type AccessGrant = {
  token: string;
  /** True when this token was obtained by a refresh for this request. */
  refreshed: boolean;
};

/** SessionManager's side of the token handshake (AD-3). */
export type AccessTokenSource = {
  /**
   * The token for the next request, after a proactive refresh if needed;
   * null when signed out (the request goes without `Authorization`).
   * Rejects with `AppError` (`SessionExpired`, or the refresh failure's kind).
   */
  getAccessToken(): Promise<AccessGrant | null>;
  /**
   * After a 401 for `usedToken`: the token to retry with (a newer current
   * one, or the result of one shared refresh); null for no retry. Rejects
   * with `AppError`.
   */
  renewAfterUnauthorized(usedToken: string): Promise<string | null>;
};

/** No session: requests go without `Authorization`. */
export const noAccessToken: AccessTokenSource = {
  getAccessToken: () => Promise.resolve(null),
  renewAfterUnauthorized: () => Promise.resolve(null),
};

/** One fixed token, never refreshed (SessionManager's sign-in check). */
export function fixedAccessToken(token: string): AccessTokenSource {
  return {
    getAccessToken: () => Promise.resolve({ token, refreshed: true }),
    renewAfterUnauthorized: () => Promise.resolve(null),
  };
}

export type HttpRequest<T> = {
  method?: HttpMethod;
  /** An API path (`/v1/user/current`) or an absolute URL. */
  path: string;
  /** Form-encoded body for a mutation. */
  form?: ReadonlyArray<readonly [string, string]>;
  /** Validates a 2xx body; a mismatch is `Parse`. */
  schema?: z.ZodType<T>;
  /**
   * False: no AD-6 retries for this GET (the sign-in E1, which api-contract
   * §2.2 sends once). Mutations are never retried either way.
   */
  retry?: boolean;
};

export type HttpResponse<T = unknown> = {
  status: number;
  /** Parsed JSON (validated when a schema was given); undefined when empty. */
  body: T;
};

export type HttpClient = {
  /** Rejects with `AppError` only. */
  request<T = unknown>(request: HttpRequest<T>): Promise<HttpResponse<T>>;
  /** A GET; rejects with `AppError` only. */
  get<T = unknown>(path: string, schema?: z.ZodType<T>): Promise<HttpResponse<T>>;
};

export type HttpClientDeps = {
  tokens?: AccessTokenSource;
  transport?: Transport;
  /** @deprecated Use `transport`. */
  fetch?: Transport;
  timeoutMs?: number;
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
};

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

type Raw = { status: number; body: unknown };

export function createHttpClient({
  tokens = noAccessToken,
  transport,
  fetch: legacyFetch,
  timeoutMs = CONTENT_REQUEST_TIMEOUT_MS,
  retryBaseMs = RETRY_BASE_MS,
  sleep = defaultSleep,
  logger = appLogger,
}: HttpClientDeps = {}): HttpClient {
  const send: Transport = transport ?? legacyFetch ?? fetchTransport;

  /** One attempt. Rejects with `AppError('Network')` on transport failure or timeout. */
  async function attempt(
    method: HttpMethod,
    url: string,
    token: string | null,
    body: string | undefined,
    n: number,
  ): Promise<Raw> {
    const headers = isBoostyApiUrl(url) ? contentProfileHeaders(url, token) : {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await send(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        credentials: 'omit',
        signal: controller.signal,
      });
      const text = await response.text();
      logger.info('http', method, { path: logPath(url), status: response.status, attempt: n });
      return { status: response.status, body: parseJson(text) };
    } catch {
      // The error text can echo the request, so it is not logged.
      logger.warn('http', `${method} failed`, { path: logPath(url), attempt: n });
      throw new AppError('Network');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Attempts with the AD-6 retries; resolves the last response, if any. */
  async function withRetries(
    method: HttpMethod,
    url: string,
    token: string | null,
    body: string | undefined,
    retry: boolean,
  ): Promise<Raw> {
    const used: Partial<Record<AppErrorKind, number>> = {};
    let retries = 0;
    for (let n = 1; ; n += 1) {
      let kind: AppErrorKind;
      let raw: Raw | undefined;
      try {
        raw = await attempt(method, url, token, body, n);
        if (raw.status < 500 || raw.status > 599) {
          return raw;
        }
        kind = 'Server';
      } catch (error) {
        kind = (error as AppError).kind;
      }
      const count = (used[kind] ?? 0) + 1;
      used[kind] = count;
      if (!retry || count > retriesFor(method, kind)) {
        if (raw) {
          return raw;
        }
        throw new AppError(kind);
      }
      await sleep(retryBaseMs * 2 ** retries);
      retries += 1;
    }
  }

  async function request<T>({
    method = 'GET',
    path,
    form,
    schema,
    retry = true,
  }: HttpRequest<T>): Promise<HttpResponse<T>> {
    const url = path.startsWith('/') ? `${API_ORIGIN}${path}` : path;
    const api = isBoostyApiUrl(url);
    const body = form ? encodeForm(form) : undefined;
    const grant = api ? await tokens.getAccessToken() : null;
    let raw = await withRetries(method, url, grant?.token ?? null, body, retry);
    if (raw.status === 401 && grant && !grant.refreshed) {
      const next = await tokens.renewAfterUnauthorized(grant.token);
      if (next !== null && method === 'GET') {
        raw = await withRetries(method, url, next, body, retry);
      } else if (next !== null) {
        logger.info('http', 'mutation not replayed after 401', { path: logPath(url) });
      }
    }
    if (raw.status < 200 || raw.status > 299) {
      throw new AppError(kindForStatus(raw.status), raw.status);
    }
    if (!schema) {
      return { status: raw.status, body: raw.body as T };
    }
    const parsed = schema.safeParse(raw.body);
    if (!parsed.success) {
      logger.warn('http', 'unexpected shape', { path: logPath(url), status: raw.status });
      throw new AppError('Parse', raw.status);
    }
    return { status: raw.status, body: parsed.data };
  }

  return {
    request,
    get: (path, schema) => request({ method: 'GET', path, schema }),
  };
}
