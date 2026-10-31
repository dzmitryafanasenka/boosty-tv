import { defineAccountScoped } from '../account/defineAccountScoped';

/**
 * App logger (epic 2 "Logger"). Every message and field value passes
 * `redact()` before it is stored or printed, so the in-memory ring never
 * holds a raw phone number, challenge, code, token or signed URL.
 *
 * Callers still never pass response bodies, the phone, the challenge or the
 * code on purpose: redaction is the safety net, not the policy.
 * Story 2.2 scope: the ring and `console` output in `__DEV__` only. Story
 * 8.3 adds an optional sink (`setSink`): the capped log file
 * (`./logFileSink`) gets every entry after it was redacted, so the file
 * never holds more than the ring does.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFieldValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogFieldValue>>;

export type LogEntry = {
  /** Epoch milliseconds. */
  time: number;
  level: LogLevel;
  /** Short module tag, for example `auth`. */
  scope: string;
  message: string;
  fields?: Record<string, string | boolean | null>;
};

export type Logger = {
  debug(scope: string, message: string, fields?: LogFields): void;
  info(scope: string, message: string, fields?: LogFields): void;
  warn(scope: string, message: string, fields?: LogFields): void;
  error(scope: string, message: string, fields?: LogFields): void;
  /** A copy of the ring, oldest first. */
  entries(): LogEntry[];
  clear(): void;
  /**
   * Story 8.3: every entry, already redacted, is also handed to `sink`
   * (a copy, after it entered the ring); null detaches it. A throwing sink
   * is ignored: logging never fails because of it.
   */
  setSink(sink: LogSink | null): void;
};

/** Receives each redacted entry (Story 8.3: the log file). */
export type LogSink = (entry: LogEntry) => void;

export const LOG_RING_CAPACITY = 200;

const URL_WITH_QUERY = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>?#]*\?[^\s"'<>]*/gi;
/** Story 8.3: a whole `Cookie:` / `Set-Cookie:` header value, to the end of the line. */
const COOKIE_HEADER = /\b(Set-Cookie|Cookie)\s*:[^\r\n]*/gi;
/** Story 8.3: any `Authorization:` value (Bearer, Basic, a bare token), to the end of the line. */
const AUTHORIZATION_HEADER = /\b(Authorization)\s*:[^\r\n]*/gi;
const BEARER = /\bBearer\s+[^\s"',;]+/gi;
/**
 * Story 8.3: a bare query string (no scheme) that carries a CDN signature
 * or expiry: the whole run around `expires=` / `sig=` goes.
 */
const SIGNED_QUERY_RUN = /[^\s"'<>]*\b(?:expires|sig)=[^\s"'<>]*/gi;
/** Secret parameter and JSON key names (Story 8.3 added the token, signature, cookie and authorization keys). */
const SECRET_KEYS =
  'sms_code|code|phone|access_token|refresh_token|token|signedQuery|sig|signature|authorization|set-cookie|cookie';
/** A secret key, also with a prefix (`id_token`, `csrf_token`, `api_sig`). */
const SECRET_KEY = `(?:\\w*_)?(?:${SECRET_KEYS})`;
const SECRET_PARAM = new RegExp(`\\b(${SECRET_KEY})=[^&\\s"'<>]*`, 'gi');
/** A string value, or a bare one (number, literal) up to `,` `}` `]` or a space. */
const SECRET_JSON = new RegExp(`"(${SECRET_KEY})"\\s*:\\s*(?:"[^"]*"|[^,}\\]\\s]+)`, 'gi');
/** `+` and at least 7 digits, up to two separators (space, dash, dot, brackets) between digits. */
const E164_LIKE = /\+\s?\d(?:[\s().-]{0,2}\d){6,}/g;
const DIGIT_RUN = /\d{7,}/g;
/** Tokens, challenges, signatures: 32+ characters of an opaque alphabet. */
const OPAQUE_RUN = /[A-Za-z0-9._~+/=-]{32,}/g;

/**
 * Replaces secrets in free text: URLs with a query, `Cookie:` /
 * `Set-Cookie:` and `Authorization:` header values, `Bearer` values, bare
 * query strings with `expires=` / `sig=`, the values of secret parameters
 * and JSON keys (`code`, `sms_code`, `phone`, `access_token`,
 * `refresh_token`, `token`, `signedQuery`, `sig`, `signature`), E.164-like
 * numbers, runs of 7+ digits and opaque runs of 32+ characters.
 */
export function redact(text: string): string {
  return text
    .replace(URL_WITH_QUERY, '<url>')
    .replace(COOKIE_HEADER, '$1: <redacted>')
    .replace(AUTHORIZATION_HEADER, '$1: <redacted>')
    .replace(BEARER, 'Bearer <redacted>')
    .replace(SIGNED_QUERY_RUN, '<query>')
    .replace(SECRET_PARAM, '$1=<redacted>')
    .replace(SECRET_JSON, '"$1":"<redacted>"')
    .replace(E164_LIKE, '<phone>')
    .replace(DIGIT_RUN, '<digits>')
    .replace(OPAQUE_RUN, '<redacted>');
}

/**
 * The secret words a field key is checked for (Story 8.3), inside the key
 * with separators removed and lowercased.
 */
const SECRET_KEY_PARTS = ['token', 'cookie', 'authorization', 'signedquery', 'phone', 'challenge'] as const;
/** Words that make a following `code` a one-time or access code (Epic 8 retro A1). */
const CODE_QUALIFIERS = [
  'sms', 'otp', 'auth', 'verification', 'confirm', 'confirmation', 'onetime', 'pin', 'pass', 'access',
  'security', 'login', 'device', 'mfa', '2fa', 'twofactor', 'recovery', 'backup', 'reset', 'activation', 'email',
];
/**
 * A one-time or access code (Epic 8 retro A1), checked on the compact key
 * and on its last dotted segment (`user.code`): `code` or `codes`, `code`
 * followed by verifier/value (`codeVerifier`), or a qualifier followed by
 * `code(s)` at the end (`smsCode`, `sms_code`, `otpCodes`, `recoveryCode`).
 * `versionCode`, `errorCode`, `statusCode`, `countryCode`, `codec` and
 * `decoder` are not secrets. A suffix match also catches the rare
 * `bypassCode` (`pass`): over-redaction there is accepted.
 */
const SECRET_CODE_KEY = new RegExp(`^codes?(?:verifier|value)?$|(?:${CODE_QUALIFIERS.join('|')})codes?$`);
/** Signature words, matched as a whole word or at the end of the compact key (`sig`, `apiSig`, `signature`). */
const SIGNATURE_KEY = /(?:^|[^a-z])sig(?:nature)?(?:$|[^a-z])|sig(?:nature)?$/;

/**
 * Story 8.3: a field key that names a secret (any case): the key, with
 * separators removed and lowercased, contains token, cookie,
 * authorization, signedquery, phone or challenge (so `accessToken`,
 * `accesstoken`, `refresh_token`, `Set-Cookie`, `sessioncookie`,
 * `phoneNumber`, `challengeId`), is a one-time or access code (`code`,
 * `sms_code`, `smscode`, `user.code`; see `SECRET_CODE_KEY`), or it is or
 * ends with `sig` / `signature` (`sig`, `api_sig`, `urlSignature`).
 * `__tests__/loggerFieldKeys.test.js` checks the logger field keys in `src`.
 */
export function isSecretFieldKey(key: string): boolean {
  const lower = key.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, '');
  const lastSegment = (lower.split('.').pop() ?? lower).replace(/[^a-z0-9]/g, '');
  return (
    SECRET_KEY_PARTS.some(part => compact.includes(part)) ||
    SECRET_CODE_KEY.test(compact) ||
    SECRET_CODE_KEY.test(lastSegment) ||
    SIGNATURE_KEY.test(lower) ||
    SIGNATURE_KEY.test(compact)
  );
}

/** The marker that replaces the value of a secret field key. */
export const REDACTED = '<redacted>';

function redactFields(
  fields: LogFields | undefined,
): Record<string, string | boolean | null> | undefined {
  if (!fields) {
    return undefined;
  }
  const out: Record<string, string | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    // Story 8.3: a secret key's value goes whatever it is (null and
    // booleans included: they are not worth the risk of a wrong guess).
    if (isSecretFieldKey(key)) {
      out[redact(key)] = REDACTED;
      continue;
    }
    // Numbers go through redact() too: a phone can arrive as a number.
    out[redact(key)] =
      value === null || typeof value === 'boolean'
        ? value
        : redact(String(value));
  }
  return out;
}

export type LoggerOptions = {
  capacity?: number;
  /** Print to `console`; production passes `__DEV__`. */
  console?: boolean;
  now?: () => number;
};

export function createLogger({
  capacity = LOG_RING_CAPACITY,
  console: toConsole = false,
  now = Date.now,
}: LoggerOptions = {}): Logger {
  let ring: LogEntry[] = [];
  let sink: LogSink | null = null;

  const write = (
    level: LogLevel,
    scope: string,
    message: string,
    fields?: LogFields,
  ) => {
    const entry: LogEntry = {
      time: now(),
      level,
      scope: redact(scope),
      message: redact(message),
    };
    const safeFields = redactFields(fields);
    if (safeFields && Object.keys(safeFields).length > 0) {
      entry.fields = safeFields;
    }
    ring.push(entry);
    if (ring.length > capacity) {
      ring = ring.slice(ring.length - capacity);
    }
    if (sink) {
      try {
        sink(entry.fields ? { ...entry, fields: { ...entry.fields } } : { ...entry });
      } catch {
        // The sink's own problem (it reports it itself); logging goes on.
      }
    }
    if (toConsole) {
      const line = `[${entry.scope}] ${entry.message}`;
      const print =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : console.log;
      if (entry.fields) {
        print(line, entry.fields);
      } else {
        print(line);
      }
    }
  };

  return {
    debug: (scope, message, fields) => write('debug', scope, message, fields),
    info: (scope, message, fields) => write('info', scope, message, fields),
    warn: (scope, message, fields) => write('warn', scope, message, fields),
    error: (scope, message, fields) => write('error', scope, message, fields),
    entries: () => ring.map(entry => ({ ...entry })),
    clear: () => {
      ring = [];
    },
    setSink: next => {
      sink = next;
    },
  };
}

/** The app-wide logger. `console` output only in development builds. */
export const logger: Logger = createLogger({
  console: typeof __DEV__ !== 'undefined' && __DEV__,
});

/**
 * The in-memory ring is account-scoped (it may hold account activity):
 * wiped by `AccountScope.reset()`. Imported from the import-free file, not
 * the account index, which itself imports this logger.
 */
export const loggerAccountStore = defineAccountScoped('logger', () => logger.clear());
