/**
 * Content and session errors (AD-5 `AppError.kind`). Built only in
 * `shared/api`, mapped only from verified response shapes
 * (docs/api-contract.md §7). Screens choose state and copy by kind
 * (`error.<kind>`), never by status. `AuthError` stays for the sign-in flows.
 *
 * Verified: 401 `unauthorized` on E1 (handled by the refresh path; a 401 that
 * survives it is `Client`), 404 `not_found` / `blog_not_found` → `NotFound`.
 * Unverified for content (status only, never retried): 429 → `RateLimited`,
 * 5xx → `Server`, every other 4xx (including 403) → `Client`. **A 403 is
 * never session expiry**; only refresh 400 `invalid_grant` is
 * (`SessionExpired`). `NoAccess` and `MediaUrlExpired` come from domain
 * mappers in later stories (`hasAccess=false`, a re-resolve that failed),
 * never from a status.
 */

export type AppErrorKind =
  | 'SessionExpired'
  | 'NoAccess'
  | 'MediaUrlExpired'
  | 'NotFound'
  | 'RateLimited'
  | 'Client'
  | 'Server'
  | 'Network'
  | 'Parse';

export class AppError extends Error {
  readonly kind: AppErrorKind;
  /** The HTTP status, when the error came from a response. */
  readonly status?: number;

  constructor(kind: AppErrorKind, status?: number) {
    // The message is the kind only: no status text, body, URL or token.
    super(kind);
    this.name = 'AppError';
    this.kind = kind;
    this.status = status;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** The kind of a non-2xx response from `api.boosty.to`. */
export function kindForStatus(status: number): AppErrorKind {
  if (status === 404) {
    return 'NotFound';
  }
  if (status === 429) {
    return 'RateLimited';
  }
  if (status >= 500 && status <= 599) {
    return 'Server';
  }
  return 'Client';
}

/**
 * AD-6 retries for one request: how many more attempts a failed attempt of
 * this kind gets. GET: `Network` ≤ 2 (exponential backoff), `Server` ≤ 1,
 * nothing else. Mutations: never (a replay can double a vote).
 */
export const GET_RETRY_LIMIT: Readonly<Partial<Record<AppErrorKind, number>>> = {
  Network: 2,
  Server: 1,
};

export function retriesFor(method: string, kind: AppErrorKind): number {
  return method === 'GET' ? GET_RETRY_LIMIT[kind] ?? 0 : 0;
}

/** The `error` enum of a JSON error body (`error_description` is never read). */
export function errorCode(body: unknown): string | undefined {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const code = (body as Record<string, unknown>).error;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
