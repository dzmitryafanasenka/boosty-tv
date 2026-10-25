import { getDeviceId } from '../platform/deviceId';
import { logger as appLogger, type Logger } from '../services/logger';
import { AuthError, mapSendCodeFailure } from './authError';
import { sendCodeResponseSchema } from './dto/phoneCode';
import { API_ORIGIN, authProfileHeaders, encodeForm } from './profiles';

/**
 * `AuthApiClient` (ADR 0008 `auth` profile): phone-auth requests.
 * Story 2.2: send. Confirm and resend are Story 2.3; refresh is Story 2.5.
 *
 * - `credentials: 'omit'`: no cookie is sent or stored in the native jar.
 * - One 30 s timeout per send, covering the device id read and the request
 *   (`AbortController`); never retried.
 * - Non-idempotent: a second `sendCode` for the same phone while one is in
 *   flight gets the same promise, so held or repeated OK cannot send twice.
 *   A different phone while one is in flight is rejected (`Unknown`) without
 *   a request, so it can never receive the other phone's challenge.
 * - Logs only the outcome and status; never the phone, the challenge,
 *   the device id or a body.
 */

export const SEND_CODE_URL = `${API_ORIGIN}/auth/phone/verification_code/send`;
export const AUTH_REQUEST_TIMEOUT_MS = 30_000;

export type SendCodeResult = {
  /** Opaque challenge for confirm. Memory only; never logged or persisted. */
  challenge: string;
  sentTransport?: string;
  /** Raw value; units unverified (api-contract §2.2). */
  expiresIn?: number;
};

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    credentials: 'omit';
    signal: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export type AuthApiClient = {
  /** `phone` in E.164. Rejects with `AuthError` only. */
  sendCode(phone: string): Promise<SendCodeResult>;
};

export type AuthApiClientDeps = {
  fetch?: FetchLike;
  getDeviceId?: () => Promise<string>;
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

export function createAuthApiClient({
  fetch: fetchImpl = (url, init) => fetch(url, init),
  getDeviceId: deviceId = getDeviceId,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
  logger = appLogger,
}: AuthApiClientDeps = {}): AuthApiClient {
  let sendInFlight: { phone: string; promise: Promise<SendCodeResult> } | null =
    null;

  const fail = (kind: AuthError['kind'], status?: number): never => {
    logger.warn('auth', 'sendCode failed', { kind, status });
    throw new AuthError(kind);
  };

  async function send(phone: string): Promise<SendCodeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let id: string;
    try {
      // A hung native read must not leave the send pending forever.
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
      logger.error('auth', 'sendCode: no device id');
      throw new AuthError('Unknown');
    }
    let status: number;
    let text: string;
    try {
      const response = await fetchImpl(SEND_CODE_URL, {
        method: 'POST',
        headers: authProfileHeaders(SEND_CODE_URL, id),
        body: encodeForm([
          ['phone', phone],
          ['device_os', 'web'],
          ['device_id', id],
        ]),
        credentials: 'omit',
        signal: controller.signal,
      });
      status = response.status;
      text = await response.text();
    } catch {
      // Abort (timeout) or transport failure. The error text can echo the
      // request, so it is not logged.
      return fail('Network');
    } finally {
      clearTimeout(timer);
    }

    const body = parseJson(text);
    if (status < 200 || status > 299) {
      return fail(mapSendCodeFailure(status, body), status);
    }
    const parsed = sendCodeResponseSchema.safeParse(body);
    if (!parsed.success) {
      return fail('Unknown', status);
    }
    const { code, sentTransport, expiresIn } = parsed.data.data.phoneCode;
    logger.info('auth', 'sendCode ok', { status });
    return { challenge: code, sentTransport, expiresIn };
  }

  return {
    sendCode(phone) {
      if (sendInFlight) {
        if (sendInFlight.phone === phone) {
          return sendInFlight.promise;
        }
        logger.warn('auth', 'sendCode rejected: another send in flight');
        return Promise.reject(new AuthError('Unknown'));
      }
      const promise = send(phone).finally(() => {
        sendInFlight = null;
      });
      sendInFlight = { phone, promise };
      return promise;
    },
  };
}

/** The app's client over the global `fetch` and the native device id. */
export const authApiClient: AuthApiClient = createAuthApiClient();
