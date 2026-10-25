/**
 * Sign-in errors (AD-5 `AuthError.kind`). Built only in `shared/api` and
 * mapped only from verified response shapes (docs/api-contract.md §2.2).
 * Screens choose state and copy by kind (`error.<kind>`), never by status.
 */

export type AuthErrorKind =
  | 'InvalidPhone'
  | 'WrongCode'
  | 'CodeExpired'
  | 'TooManyAttempts'
  | 'VerificationRequired'
  /** Transport failure or timeout; the copy is the shared `error.Network`. */
  | 'Network'
  | 'Unknown';

export class AuthError extends Error {
  readonly kind: AuthErrorKind;

  constructor(kind: AuthErrorKind) {
    // The message is the kind only: no status text, body or input.
    super(kind);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}

function errorCode(body: unknown): string | undefined {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const code = (body as Record<string, unknown>).error;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Error kind for a non-2xx response of `POST /auth/phone/verification_code/send`.
 * Verified: 429 `error=sms_gate_ratelimit` (Stories 1.3, 1.5). Everything
 * else, including any captcha hint, is `Unknown`: no captcha shape is
 * verified. `error_description` is never read.
 */
export function mapSendCodeFailure(status: number, body: unknown): AuthErrorKind {
  if (status === 429 && errorCode(body) === 'sms_gate_ratelimit') {
    return 'TooManyAttempts';
  }
  return 'Unknown';
}
