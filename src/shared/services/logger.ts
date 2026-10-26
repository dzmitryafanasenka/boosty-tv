import { defineAccountScoped } from '../account/defineAccountScoped';

/**
 * App logger (epic 2 "Logger"). Every message and field value passes
 * `redact()` before it is stored or printed, so the in-memory ring never
 * holds a raw phone number, challenge, code, token or signed URL.
 *
 * Callers still never pass response bodies, the phone, the challenge or the
 * code on purpose: redaction is the safety net, not the policy.
 * Story 2.2 scope: the ring and `console` output in `__DEV__` only. The capped
 * file and the adb export are Story 8.3.
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
};

export const LOG_RING_CAPACITY = 200;

const URL_WITH_QUERY = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>?#]*\?[^\s"'<>]*/gi;
const BEARER = /\bBearer\s+[^\s"',;]+/gi;
const SECRET_PARAM = /\b(sms_code|code|phone)=[^&\s"'<>]*/gi;
const SECRET_JSON = /"(sms_code|code|phone)"\s*:\s*"[^"]*"/gi;
/** `+` and at least 7 digits, up to two separators (space, dash, dot, brackets) between digits. */
const E164_LIKE = /\+\s?\d(?:[\s().-]{0,2}\d){6,}/g;
const DIGIT_RUN = /\d{7,}/g;
/** Tokens, challenges, signatures: 32+ characters of an opaque alphabet. */
const OPAQUE_RUN = /[A-Za-z0-9._~+/=-]{32,}/g;

/**
 * Replaces secrets in free text: URLs with a query, `Bearer` values,
 * `code=` / `sms_code=` / `phone=` values (also as JSON keys), E.164-like
 * numbers, runs of 7+ digits and opaque runs of 32+ characters.
 */
export function redact(text: string): string {
  return text
    .replace(URL_WITH_QUERY, '<url>')
    .replace(BEARER, 'Bearer <redacted>')
    .replace(SECRET_PARAM, '$1=<redacted>')
    .replace(SECRET_JSON, '"$1":"<redacted>"')
    .replace(E164_LIKE, '<phone>')
    .replace(DIGIT_RUN, '<digits>')
    .replace(OPAQUE_RUN, '<redacted>');
}

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
    if (toConsole) {
      const line = `[${entry.scope}] ${entry.message}`;
      const sink =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : console.log;
      if (entry.fields) {
        sink(line, entry.fields);
      } else {
        sink(line);
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
