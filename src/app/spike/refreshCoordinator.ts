/**
 * Story 1.4 spike only (branch spike/1-4-refresh-logout). Single-flight token
 * refresh around the Story 1.3 session (api-contract §2.3), used to observe
 * the real API's refresh behavior. Not production auth code.
 *
 * Policy under test:
 * - one shared refresh promise for concurrent callers;
 * - proactive refresh when fewer than 300 s remain before `expiresAt`;
 * - on a 401: at most one refresh per trigger and one retry of the request;
 * - a refresh response matching `isRefreshRejected` → «expired», no retry;
 * - a transport error, 5xx, 429 or unparsable 200 during refresh keeps the
 *   tokens and the signed-in status.
 *
 * Logs only request names, counts, statuses, sanitized shapes and booleans.
 * Tokens and device ids never reach a log line.
 */
import {
  API_BASE,
  encodeForm,
  execute,
  formatSanitized,
  webHeaders,
  type ApiRequest,
  type ExecuteResult,
  type FetchLike,
  type SanitizedResponse,
  type StoredSession,
  decodeSession,
} from './phoneAuthApi';
import type { ReadResult, SaveResult } from './spikeSecureStore';

export const PROACTIVE_WINDOW_S = 300;

export type SessionStoreLike = {
  read(): Promise<ReadResult>;
  save(value: string): Promise<SaveResult>;
};

export type SessionStatus = 'unknown' | 'signed-in' | 'expired' | 'signed-out';

export type RefreshTokens = {
  accessToken: string;
  /** Absent when the server does not rotate (keep the old one). */
  refreshToken?: string;
  expiresIn?: number;
};

export type RefreshOutcome =
  | {
      kind: 'refreshed';
      sanitized: SanitizedResponse;
      tokens: RefreshTokens;
      /** yes: new refresh_token differs; no: same value; absent: not sent. */
      rotated: 'yes' | 'no' | 'absent';
    }
  | { kind: 'rejected'; sanitized: SanitizedResponse }
  | { kind: 'server'; sanitized: SanitizedResponse }
  | { kind: 'parse'; sanitized: SanitizedResponse }
  | { kind: 'network'; error: string };

export type CallResult =
  | {
      kind: 'response';
      sanitized: SanitizedResponse;
      json: unknown;
      refreshed: boolean;
      retried: boolean;
    }
  | { kind: 'expired'; refreshSanitized?: SanitizedResponse }
  | { kind: 'signed-out' }
  | { kind: 'network'; stage: 'refresh' | 'request'; error: string }
  | { kind: 'refresh-failed'; outcome: RefreshOutcome['kind']; status: number }
  | { kind: 'store-error'; error: string };

/**
 * "Refresh rejected" signal observed live in Story 1.4 (S4): HTTP 400 with
 * `error: "invalid_grant"`. Any other failure (other 4xx, 5xx, 429, timeouts)
 * is not a rejection and keeps the tokens.
 */
export function defaultIsRefreshRejected(status: number, json?: unknown): boolean {
  return (
    status === 400 &&
    typeof json === 'object' &&
    json !== null &&
    (json as { error?: unknown }).error === 'invalid_grant'
  );
}

export function buildRefreshRequest(args: {
  refreshToken: string;
  deviceId: string;
}): ApiRequest {
  return {
    name: 'refresh',
    url: `${API_BASE}/oauth/token/`,
    method: 'POST',
    headers: {
      ...webHeaders(),
      'X-From-Id': args.deviceId,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm([
      ['grant_type', 'refresh_token'],
      ['refresh_token', args.refreshToken],
      ['device_id', args.deviceId],
      ['device_os', 'web'],
    ]),
  };
}

export function withBearer(request: ApiRequest, accessToken: string) {
  return {
    ...request,
    headers: { ...request.headers, Authorization: `Bearer ${accessToken}` },
  };
}

export function parseRefreshTokens(json: unknown): RefreshTokens | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return null;
  }
  const o = json as Record<string, unknown>;
  if (typeof o.access_token !== 'string' || o.access_token.length === 0) {
    return null;
  }
  const refresh = o.refresh_token;
  const expiresIn = o.expires_in;
  return {
    accessToken: o.access_token,
    refreshToken:
      typeof refresh === 'string' && refresh.length > 0 ? refresh : undefined,
    expiresIn: typeof expiresIn === 'number' ? expiresIn : undefined,
  };
}

export function sessionAfterRefresh(
  previous: StoredSession,
  tokens: RefreshTokens,
  nowMs: number,
): StoredSession {
  const nowS = Math.floor(nowMs / 1000);
  return {
    v: 1,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? previous.refreshToken,
    expiresAt: tokens.expiresIn === undefined ? null : nowS + tokens.expiresIn,
    savedAt: nowS,
  };
}

/** Network-level failure used to simulate a lost connection (S4). */
export class SimulatedNetworkError extends Error {
  constructor() {
    super('Simulated network failure');
    this.name = 'TypeError';
  }
}

export type RefreshCoordinator = ReturnType<typeof createRefreshCoordinator>;

export function createRefreshCoordinator({
  store,
  fetchImpl,
  getDeviceId,
  log = () => {},
  now = () => Date.now(),
  isRefreshRejected = defaultIsRefreshRejected,
}: {
  store: SessionStoreLike;
  fetchImpl: FetchLike;
  getDeviceId: () => Promise<string>;
  log?: (line: string) => void;
  now?: () => number;
  isRefreshRejected?: (status: number, json: unknown) => boolean;
}) {
  let session: StoredSession | null = null;
  let status: SessionStatus = 'unknown';
  let loading: Promise<void> | null = null;
  let inflight: Promise<RefreshOutcome> | null = null;
  let failNextRefreshTransport = false;
  const counts = { refresh: 0, api: 0 };

  async function loadFromStore(): Promise<void> {
    const result = await store.read();
    if (result.kind === 'value') {
      session = decodeSession(result.value);
      status = session ? 'signed-in' : 'signed-out';
      log(session ? 'session loaded' : 'session: stored value malformed');
      return;
    }
    session = null;
    status = 'signed-out';
    log(`session: store ${result.kind}`);
  }

  function ensureLoaded(): Promise<void> {
    if (status !== 'unknown') {
      return Promise.resolve();
    }
    if (!loading) {
      loading = loadFromStore().finally(() => {
        loading = null;
      });
    }
    return loading;
  }

  /** Re-reads the stored copy (after the spike altered it on purpose). */
  async function reload(): Promise<SessionStatus> {
    status = 'unknown';
    session = null;
    await ensureLoaded();
    return status;
  }

  // Wrapper so a spike-simulated transport failure never touches the network.
  const guardedFetch: FetchLike = (url, init) => {
    if (failNextRefreshTransport) {
      failNextRefreshTransport = false;
      log('refresh: simulated transport failure (no request sent)');
      return Promise.reject(new SimulatedNetworkError());
    }
    return fetchImpl(url, init);
  };

  /** One refresh request with explicit inputs; does not touch the session. */
  async function sendRefresh(args: {
    refreshToken: string;
    deviceId: string;
    label: string;
  }): Promise<RefreshOutcome> {
    counts.refresh += 1;
    log(`refresh #${counts.refresh} (${args.label}): attempt`);
    const result: ExecuteResult = await execute(
      buildRefreshRequest(args),
      guardedFetch,
    );
    if (result.kind === 'network') {
      log(`refresh #${counts.refresh} → network error (${result.error})`);
      return { kind: 'network', error: result.error };
    }
    const s = result.sanitized;
    for (const line of formatSanitized(s)) {
      log(line);
    }
    if (s.status === 200) {
      const tokens = parseRefreshTokens(result.json);
      if (!tokens) {
        return { kind: 'parse', sanitized: s };
      }
      const rotated =
        tokens.refreshToken === undefined
          ? 'absent'
          : tokens.refreshToken === args.refreshToken
          ? 'no'
          : 'yes';
      log(
        `refresh #${counts.refresh}: rotated=${rotated} ` +
          `expires_in=${tokens.expiresIn ?? '—'} ` +
          `newAccess=${tokens.accessToken !== session?.accessToken}`,
      );
      return { kind: 'refreshed', sanitized: s, tokens, rotated };
    }
    if (isRefreshRejected(s.status, result.json)) {
      return { kind: 'rejected', sanitized: s };
    }
    return { kind: 'server', sanitized: s };
  }

  /** Stores refreshed tokens as the current session (memory + store). */
  async function adopt(tokens: RefreshTokens): Promise<void> {
    if (!session) {
      return;
    }
    session = sessionAfterRefresh(session, tokens, now());
    status = 'signed-in';
    const saved = await store.save(JSON.stringify(session));
    log(
      saved.kind === 'saved'
        ? 'refreshed session saved'
        : `refreshed session NOT saved (${saved.errorKind}); kept in memory`,
    );
  }

  async function runRefresh(): Promise<RefreshOutcome> {
    const current = session;
    if (!current) {
      return { kind: 'network', error: 'NoSession' };
    }
    let deviceId: string;
    try {
      deviceId = await getDeviceId();
    } catch {
      return { kind: 'network', error: 'NoDeviceId' };
    }
    const outcome = await sendRefresh({
      refreshToken: current.refreshToken,
      deviceId,
      label: 'single-flight',
    });
    if (outcome.kind === 'refreshed') {
      await adopt(outcome.tokens);
    } else if (outcome.kind === 'rejected') {
      // «expired»: drop the in-memory session. The stored copy is left for the
      // caller (the spike restores it; production would clear it).
      session = null;
      status = 'expired';
      log('refresh rejected → status expired');
    } else {
      log(`refresh failed (${outcome.kind}) → tokens kept, still signed-in`);
    }
    return outcome;
  }

  /** Single-flight: concurrent callers share one refresh promise. */
  function refresh(): Promise<RefreshOutcome> {
    if (!inflight) {
      inflight = runRefresh().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  function needsProactive(s: StoredSession): boolean {
    return (
      s.expiresAt !== null &&
      s.expiresAt - Math.floor(now() / 1000) < PROACTIVE_WINDOW_S
    );
  }

  function refreshFailure(outcome: RefreshOutcome): CallResult {
    switch (outcome.kind) {
      case 'rejected':
        return { kind: 'expired', refreshSanitized: outcome.sanitized };
      case 'network':
        return { kind: 'network', stage: 'refresh', error: outcome.error };
      case 'server':
      case 'parse':
        return {
          kind: 'refresh-failed',
          outcome: outcome.kind,
          status: outcome.sanitized.status,
        };
      case 'refreshed':
        throw new Error('not a failure');
    }
  }

  /**
   * Runs `build()` with the current Bearer token. Proactive refresh first if
   * needed; on a 401 one refresh (shared) and one retry.
   */
  async function callWithSession(build: () => ApiRequest): Promise<CallResult> {
    await ensureLoaded();
    if (status === 'expired') {
      return { kind: 'expired' };
    }
    if (!session) {
      return { kind: 'signed-out' };
    }
    let refreshed = false;
    if (needsProactive(session)) {
      const outcome = await refresh();
      if (outcome.kind !== 'refreshed') {
        return refreshFailure(outcome);
      }
      refreshed = true;
    }
    const send = async (accessToken: string) => {
      counts.api += 1;
      const n = counts.api;
      const request = withBearer(build(), accessToken);
      const result = await execute(request, fetchImpl);
      if (result.kind === 'response') {
        log(`${request.name} #${n} → HTTP ${result.sanitized.status}`);
        if (result.sanitized.status !== 200) {
          for (const line of formatSanitized(result.sanitized)) {
            log(line);
          }
        }
      } else {
        log(`${request.name} #${n} → network (${result.error})`);
      }
      return result;
    };
    const usedToken: string = (session as StoredSession).accessToken;
    const first = await send(usedToken);
    if (first.kind === 'network') {
      return { kind: 'network', stage: 'request', error: first.error };
    }
    if (first.sanitized.status !== 401) {
      return {
        kind: 'response',
        sanitized: first.sanitized,
        json: first.json,
        refreshed,
        retried: false,
      };
    }
    // 401: refresh once unless another caller already replaced the token.
    if (session === null) {
      return (status as SessionStatus) === 'expired'
        ? { kind: 'expired' }
        : { kind: 'signed-out' };
    }
    if (session.accessToken === usedToken) {
      if (refreshed) {
        // A fresh token was already rejected: no second refresh.
        log('401 right after a refresh → no second refresh');
        return {
          kind: 'response',
          sanitized: first.sanitized,
          json: first.json,
          refreshed,
          retried: false,
        };
      }
      const outcome = await refresh();
      if (outcome.kind !== 'refreshed') {
        return refreshFailure(outcome);
      }
      refreshed = true;
    }
    if (!session) {
      return { kind: 'signed-out' };
    }
    const retry = await send(session.accessToken);
    if (retry.kind === 'network') {
      return { kind: 'network', stage: 'request', error: retry.error };
    }
    return {
      kind: 'response',
      sanitized: retry.sanitized,
      json: retry.json,
      refreshed,
      retried: true,
    };
  }

  /** Clears the stored and in-memory session. No server call (§2.4). */
  async function signOut(clear: () => Promise<{ kind: string }>) {
    session = null;
    status = 'signed-out';
    const result = await clear();
    log(`sign-out: store ${result.kind}, memory cleared`);
    return result;
  }

  return {
    callWithSession,
    refresh,
    sendRefresh,
    adopt,
    reload,
    signOut,
    /** Spike only: the next refresh fails at the transport level. */
    failNextRefreshTransport() {
      failNextRefreshTransport = true;
    },
    getStatus: () => status,
    /** Spike only: the screen keeps a restore copy of the valid session. */
    getSession: (): StoredSession | null => (session ? { ...session } : null),
    getCounts: () => ({ ...counts }),
  };
}
