import { getDeviceId } from '../platform/deviceId';
import { logger as appLogger, type Logger } from '../services/logger';
import { errorCode, kindForStatus, type AppErrorKind } from './appError';
import { AuthError, isAuthError, mapConfirmFailure, mapSendCodeFailure } from './authError';
import { sendCodeResponseSchema } from './dto/phoneCode';
import { refreshTokensResponseSchema, tokensResponseSchema } from './dto/tokens';
import { API_ORIGIN, authProfileHeaders, encodeForm } from './profiles';
import { fetchTransport, parseJson, type Transport } from './transport';

/**
 * `AuthApiClient` (ADR 0008 `auth` profile): phone-auth requests and the
 * token refresh. Send (Story 2.2), resend and confirm (Story 2.3), refresh
 * (Story 2.5, called only by SessionManager's refresh coordinator, which
 * owns its single flight).
 *
 * - `credentials: 'omit'`: no cookie is sent or stored in the native jar.
 * - One 30 s timeout per request, covering the device id read and the
 *   request (`AbortController`); never retried.
 * - Non-idempotent: a second call of the same operation with the same
 *   arguments while one is in flight gets the same promise, so held or
 *   repeated OK cannot send twice. Different arguments while one is in
 *   flight are rejected (`Unknown`) without a request, so a call can never
 *   receive another call's result. Send and resend share one slot.
 * - Logs only the operation, the outcome and status; never the phone, the
 *   challenge, the code, the tokens, the device id or a body.
 * - Refresh is never retried: refresh tokens are single-use (api-contract
 *   §2.3), so a resend after a lost response would burn the session.
 */

export const SEND_CODE_URL = `${API_ORIGIN}/auth/phone/verification_code/send`;
export const CONFIRM_CODE_URL = `${API_ORIGIN}/auth/phone/verification_code/confirm`;
export const REFRESH_URL = `${API_ORIGIN}/oauth/token/`;
export const AUTH_REQUEST_TIMEOUT_MS = 30_000;

export type SendCodeResult = {
  /** Opaque challenge for confirm. Memory only; never logged or persisted. */
  challenge: string;
  sentTransport?: string;
  /** Raw value; units unverified (api-contract §2.2). */
  expiresIn?: number;
};

/** @deprecated The shared `Transport`; kept for existing tests. */
export type FetchLike = Transport;

/**
 * The outcome of one refresh request. Only `rejected` (HTTP 400 with
 * `error: "invalid_grant"`, `LIVE` Story 1.4) means the session is over;
 * every `failed` keeps the tokens. `error_description` is never read.
 */
export type RefreshResult =
  | {
      kind: 'ok';
      /** Secrets: handed to SessionManager only; never logged. */
      accessToken: string;
      /** Absent: the server did not rotate it (keep the old one). */
      refreshToken?: string;
      /** Seconds, already validated; absent: keep the previous expiry. */
      expiresIn?: number;
    }
  | { kind: 'rejected' }
  | {
      kind: 'failed';
      /** The kind the triggering request fails with. */
      error: AppErrorKind;
      status?: number;
    };

export type ConfirmCodeResult = {
  /** Secrets: handed to SessionManager only; never logged. */
  accessToken: string;
  refreshToken: string;
  /** Seconds; finite and above 300 (validated). */
  expiresIn: number;
};

export type AuthApiClient = {
  /** First send (no `transport`). `phone` in E.164. Rejects with `AuthError` only. */
  sendCode(phone: string): Promise<SendCodeResult>;
  /** Resend (`transport=gate`). Rejects with `AuthError` only. */
  resendCode(phone: string): Promise<SendCodeResult>;
  /**
   * `challenge` is the send result's `code`; `smsCode` what the user typed.
   * Rejects with `AuthError` only (`WrongCode` for 400 `invalid_sms_code`).
   */
  confirmCode(
    phone: string,
    challenge: string,
    smsCode: string,
  ): Promise<ConfirmCodeResult>;
  /**
   * `POST /oauth/token/` with `grant_type=refresh_token`. Never rejects and
   * is never retried.
   */
  refresh(refreshToken: string): Promise<RefreshResult>;
};

export type AuthApiClientDeps = {
  transport?: Transport;
  /** @deprecated Use `transport`. */
  fetch?: Transport;
  getDeviceId?: () => Promise<string>;
  timeoutMs?: number;
  logger?: Logger;
};

export function createAuthApiClient({
  transport,
  fetch: legacyFetch,
  getDeviceId: deviceId = getDeviceId,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
  logger = appLogger,
}: AuthApiClientDeps = {}): AuthApiClient {
  const fetchImpl: Transport = transport ?? legacyFetch ?? fetchTransport;
  type Op = 'sendCode' | 'resendCode' | 'confirmCode' | 'refresh';

  const fail = (op: Op, kind: AuthError['kind'], status?: number): never => {
    logger.warn('auth', `${op} failed`, { kind, status });
    throw new AuthError(kind);
  };

  /**
   * One form request with the auth profile. Resolves with the status and the
   * parsed body (undefined when not JSON); rejects with `AuthError`
   * (`Unknown` without a device id, `Network` on transport failure/timeout).
   */
  async function request(
    op: Op,
    method: 'POST' | 'PUT',
    url: string,
    fields: (id: string) => ReadonlyArray<readonly [string, string]>,
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let id: string;
    try {
      // A hung native read must not leave the request pending forever.
      id = await new Promise<string>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new Error('timeout'));
          return;
        }
        controller.signal.addEventListener('abort', () =>
          reject(new Error('timeout')),
        );
        deviceId().then(resolve, reject);
      });
    } catch {
      clearTimeout(timer);
      logger.error('auth', `${op}: no device id`);
      throw new AuthError('Unknown');
    }
    let status: number;
    let text: string;
    try {
      const response = await fetchImpl(url, {
        method,
        headers: authProfileHeaders(url, id),
        body: encodeForm(fields(id)),
        credentials: 'omit',
        signal: controller.signal,
      });
      status = response.status;
      text = await response.text();
    } catch {
      // Abort (timeout) or transport failure. The error text can echo the
      // request, so it is not logged.
      return fail(op, 'Network');
    } finally {
      clearTimeout(timer);
    }
    return { status, body: parseJson(text) };
  }

  async function send(op: 'sendCode' | 'resendCode', phone: string) {
    const { status, body } = await request(op, 'POST', SEND_CODE_URL, id => [
      ['phone', phone],
      ...(op === 'resendCode' ? [['transport', 'gate'] as const] : []),
      ['device_os', 'web'],
      ['device_id', id],
    ]);
    if (status < 200 || status > 299) {
      return fail(op, mapSendCodeFailure(status, body), status);
    }
    const parsed = sendCodeResponseSchema.safeParse(body);
    if (!parsed.success) {
      return fail(op, 'Unknown', status);
    }
    const { code, sentTransport, expiresIn } = parsed.data.data.phoneCode;
    logger.info('auth', `${op} ok`, { status });
    const result: SendCodeResult = { challenge: code, sentTransport, expiresIn };
    return result;
  }

  async function confirm(
    phone: string,
    challenge: string,
    smsCode: string,
  ): Promise<ConfirmCodeResult> {
    const op = 'confirmCode';
    const { status, body } = await request(op, 'PUT', CONFIRM_CODE_URL, id => [
      ['phone', phone],
      ['code', challenge],
      ['sms_code', smsCode],
      ['device_os', 'web'],
      ['device_id', id],
    ]);
    if (status < 200 || status > 299) {
      return fail(op, mapConfirmFailure(status, body), status);
    }
    const parsed = tokensResponseSchema.safeParse(body);
    if (!parsed.success) {
      return fail(op, 'Unknown', status);
    }
    logger.info('auth', `${op} ok`, { status });
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresIn: parsed.data.expires_in,
    };
  }

  async function refresh(refreshToken: string): Promise<RefreshResult> {
    const op = 'refresh';
    let response: { status: number; body: unknown };
    try {
      response = await request(op, 'POST', REFRESH_URL, id => [
        ['grant_type', 'refresh_token'],
        ['refresh_token', refreshToken],
        ['device_id', id],
        ['device_os', 'web'],
      ]);
    } catch (error) {
      // `request` already logged it: Network (transport, timeout) or no device id.
      const network = isAuthError(error) && error.kind === 'Network';
      return { kind: 'failed', error: network ? 'Network' : 'Client' };
    }
    const { status, body } = response;
    if (status === 400 && errorCode(body) === 'invalid_grant') {
      logger.warn('auth', 'refresh rejected', { status });
      return { kind: 'rejected' };
    }
    if (status < 200 || status > 299) {
      const error = kindForStatus(status);
      logger.warn('auth', 'refresh failed', { kind: error, status });
      return { kind: 'failed', error, status };
    }
    const parsed = refreshTokensResponseSchema.safeParse(body);
    if (!parsed.success) {
      // The server may have spent the refresh token: keep state, no retry.
      logger.warn('auth', 'refresh failed', { kind: 'Parse', status });
      return { kind: 'failed', error: 'Parse', status };
    }
    const { access_token, refresh_token, expires_in } = parsed.data;
    logger.info('auth', 'refresh ok', {
      status,
      rotated: refresh_token !== undefined,
      expiresIn: expires_in !== undefined,
    });
    return {
      kind: 'ok',
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
    };
  }

  /** Same-arguments single-flight for one non-idempotent operation slot. */
  function singleFlight<T>(label: string) {
    let inFlight: { key: string; promise: Promise<T> } | null = null;
    return (key: string, run: () => Promise<T>): Promise<T> => {
      if (inFlight) {
        if (inFlight.key === key) {
          return inFlight.promise;
        }
        logger.warn('auth', `${label} rejected: another request in flight`);
        return Promise.reject(new AuthError('Unknown'));
      }
      const promise = run().finally(() => {
        inFlight = null;
      });
      inFlight = { key, promise };
      return promise;
    };
  }

  // The key never leaves this closure and is never logged.
  const sendSlot = singleFlight<SendCodeResult>('send');
  const confirmSlot = singleFlight<ConfirmCodeResult>('confirmCode');

  return {
    sendCode(phone) {
      return sendSlot(`send\n${phone}`, () => send('sendCode', phone));
    },
    resendCode(phone) {
      return sendSlot(`resend\n${phone}`, () => send('resendCode', phone));
    },
    confirmCode(phone, challenge, smsCode) {
      return confirmSlot(`${phone}\n${challenge}\n${smsCode}`, () =>
        confirm(phone, challenge, smsCode),
      );
    },
    refresh,
  };
}

/** The app's client over the global `fetch` and the native device id. */
export const authApiClient: AuthApiClient = createAuthApiClient();
