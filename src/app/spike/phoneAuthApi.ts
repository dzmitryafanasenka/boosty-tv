/**
 * Story 1.3 spike only (branch spike/1-3-phone-auth). The phone sign-in
 * requests from docs/api-contract.md §2.2 plus E1 (`GET /v1/user/current`),
 * and sanitizers that reduce every response to its status and shape.
 *
 * Secrets (phone, challenge code, SMS code, tokens) only live in memory and in
 * secure storage. Nothing here logs; callers log only `SanitizedResponse`.
 */

export const API_BASE = 'https://api.boosty.to';

export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

export const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------- phone ----

/**
 * E.164 from user input: digits only, with a country code, 11..15 digits.
 * A leading "+" is optional. No national-format guessing.
 */
export function normalizePhone(raw: string): string | null {
  if (/[^\d\s+()-]/.test(raw)) {
    return null;
  }
  if (raw.indexOf('+') > 0 || (raw.match(/\+/g) ?? []).length > 1) {
    return null;
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 11 || digits.length > 15 || digits.startsWith('0')) {
    return null;
  }
  return `+${digits}`;
}

// ITU-T E.164 country codes of length 1 and 2; everything else is 3 digits.
const ONE_DIGIT_CC = ['1', '7'];
const TWO_DIGIT_CC = new Set([
  '20',
  '27',
  '30',
  '31',
  '32',
  '33',
  '34',
  '36',
  '39',
  '40',
  '41',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '81',
  '82',
  '84',
  '86',
  '90',
  '91',
  '92',
  '93',
  '94',
  '95',
  '98',
]);

function countryCodeLength(digits: string): number {
  if (ONE_DIGIT_CC.includes(digits[0])) {
    return 1;
  }
  return TWO_DIGIT_CC.has(digits.slice(0, 2)) ? 2 : 3;
}

/**
 * Masked hint: country code and the last four digits only, for example
 * `+375291234567` → `+375 •• ••• 45 67`. Returns '' for invalid input.
 */
export function maskPhone(e164: string): string {
  if (!/^\+\d{11,15}$/.test(e164)) {
    return '';
  }
  const digits = e164.slice(1);
  const cc = digits.slice(0, countryCodeLength(digits));
  const national = digits.slice(cc.length);
  const tail = national.slice(-4);
  const hidden = national.length - 4;
  const groups =
    hidden > 3 ? [hidden - 3, 3] : hidden > 0 ? [hidden] : ([] as number[]);
  return [
    `+${cc}`,
    ...groups.map(n => '•'.repeat(n)),
    tail.slice(0, 2),
    tail.slice(2),
  ].join(' ');
}

/** Only digits, 4..8 of them. Returns null otherwise. */
export function normalizeSmsCode(raw: string): string | null {
  const trimmed = raw.replace(/\s/g, '');
  return /^\d{4,8}$/.test(trimmed) ? trimmed : null;
}

// ------------------------------------------------------------- requests ----

export type ApiRequest = {
  name: 'send' | 'resend' | 'confirm' | 'E1' | 'refresh';
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body?: string;
};

/** application/x-www-form-urlencoded, spaces as "+", "+" as %2B. */
export function encodeForm(pairs: ReadonlyArray<readonly [string, string]>) {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
  return pairs.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}

export function webHeaders(): Record<string, string> {
  return {
    'X-App': 'web',
    'X-Locale': 'ru_RU',
    Referer: 'https://boosty.to/',
    Origin: 'https://boosty.to',
    Accept: 'application/json, text/plain, */*',
    'User-Agent': DESKTOP_USER_AGENT,
  };
}

function formHeaders(deviceId: string): Record<string, string> {
  return {
    ...webHeaders(),
    'X-From-Id': deviceId,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

/** `POST /auth/phone/verification_code/send`; `transport` only on resend. */
export function buildSendCodeRequest(args: {
  phone: string;
  deviceId: string;
  transport?: 'gate';
}): ApiRequest {
  const pairs: Array<[string, string]> = [
    ['phone', args.phone],
    ['device_os', 'web'],
    ['device_id', args.deviceId],
  ];
  if (args.transport) {
    pairs.push(['transport', args.transport]);
  }
  return {
    name: args.transport ? 'resend' : 'send',
    url: `${API_BASE}/auth/phone/verification_code/send`,
    method: 'POST',
    headers: formHeaders(args.deviceId),
    body: encodeForm(pairs),
  };
}

/** `PUT /auth/phone/verification_code/confirm`. */
export function buildConfirmRequest(args: {
  phone: string;
  challenge: string;
  smsCode: string;
  deviceId: string;
}): ApiRequest {
  return {
    name: 'confirm',
    url: `${API_BASE}/auth/phone/verification_code/confirm`,
    method: 'PUT',
    headers: formHeaders(args.deviceId),
    body: encodeForm([
      ['phone', args.phone],
      ['code', args.challenge],
      ['sms_code', args.smsCode],
      ['device_os', 'web'],
      ['device_id', args.deviceId],
    ]),
  };
}

/** E1 `GET /v1/user/current` with the Bearer token. */
export function buildCurrentUserRequest(accessToken: string): ApiRequest {
  return {
    name: 'E1',
    url: `${API_BASE}/v1/user/current`,
    method: 'GET',
    headers: { ...webHeaders(), Authorization: `Bearer ${accessToken}` },
  };
}

// ----------------------------------------------------------- sanitizing ----

/** Keys whose short, letters-only string values are non-identifying enums. */
const ENUM_KEYS = new Set([
  'sentTransport',
  'error',
  'error_code',
  'errorCode',
  'type',
  'status',
]);
/** Keys whose numeric values are recorded (units / expiry). */
const NUMBER_KEYS = new Set([
  'expiresIn',
  'expires_in',
  'status',
  'statusCode',
  'retryAfter',
]);
const ENUM_VALUE = /^[A-Za-z_.-]{1,40}$/;
const MAX_DEPTH = 6;
const MAX_LINES = 60;

function typeOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  return typeof value;
}

function safeKey(key: string): string {
  return key.length > 40 || /\d{5,}/.test(key) || /[^\w$.-]/.test(key)
    ? '<redacted-key>'
    : key;
}

/**
 * Structural description: one `path: type` line per field, never values,
 * except allowlisted enums and numbers (see ENUM_KEYS, NUMBER_KEYS).
 */
export function describeShape(json: unknown): string[] {
  const lines: string[] = [];
  const walk = (value: unknown, path: string, key: string, depth: number) => {
    if (lines.length >= MAX_LINES) {
      return;
    }
    let line = `${path || '<root>'}: ${typeOf(value)}`;
    if (typeof value === 'string' && ENUM_KEYS.has(key)) {
      line += ENUM_VALUE.test(value) ? ` = ${value}` : ` (len ${value.length})`;
    } else if (typeof value === 'number' && NUMBER_KEYS.has(key)) {
      line += ` = ${value}`;
    } else if (typeof value === 'string') {
      line += ` (len ${value.length})`;
    }
    lines.push(line);
    if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0) {
        walk(value[0], `${path}[0]`, key, depth + 1);
      }
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const name = safeKey(k);
      walk(v, path ? `${path}.${name}` : name, k, depth + 1);
    }
  };
  walk(json, '', '', 0);
  if (lines.length >= MAX_LINES) {
    lines.push('… truncated');
  }
  return lines;
}

export type SanitizedResponse = {
  request: ApiRequest['name'];
  status: number;
  contentType: string;
  isJson: boolean;
  /** `describeShape` output, or a non-JSON body length. */
  shape: string[];
  /** The raw body mentions a captcha. Only the boolean leaves this module. */
  captchaMentioned: boolean;
  retryAfter?: string;
};

const SAFE_CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+/;
const SAFE_RETRY_AFTER = /^[\w :,-]{1,40}$/;

export function sanitizeResponse(args: {
  request: ApiRequest['name'];
  status: number;
  contentType: string | null;
  retryAfter: string | null;
  rawText: string;
}): { sanitized: SanitizedResponse; json: unknown } {
  let json: unknown;
  let isJson = false;
  try {
    json = args.rawText.length > 0 ? JSON.parse(args.rawText) : undefined;
    isJson = json !== undefined;
  } catch {
    json = undefined;
  }
  const contentType = args.contentType?.match(SAFE_CONTENT_TYPE)?.[0] ?? 'none';
  const sanitized: SanitizedResponse = {
    request: args.request,
    status: args.status,
    contentType,
    isJson,
    shape: isJson
      ? describeShape(json)
      : [`<non-JSON body> (len ${args.rawText.length})`],
    captchaMentioned: /captcha|капч/i.test(args.rawText),
  };
  if (args.retryAfter && SAFE_RETRY_AFTER.test(args.retryAfter)) {
    sanitized.retryAfter = args.retryAfter;
  }
  return { sanitized, json };
}

export function formatSanitized(s: SanitizedResponse): string[] {
  return [
    `${s.request} → HTTP ${s.status} (${s.contentType})` +
      (s.captchaMentioned ? ' CAPTCHA MENTIONED' : '') +
      (s.retryAfter ? ` retry-after=${s.retryAfter}` : ''),
    ...s.shape.map(line => `  ${line}`),
  ];
}

// -------------------------------------------------------------- parsing ----

export type Challenge = {
  challenge: string;
  sentTransport?: string;
  expiresIn?: number;
};

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `data.phoneCode{code, sentTransport?, expiresIn?}` or null. */
export function parseSendCode(json: unknown): Challenge | null {
  const phoneCode = obj(obj(obj(json)?.data)?.phoneCode);
  const code = phoneCode?.code;
  if (typeof code !== 'string' || code.length === 0) {
    return null;
  }
  const sentTransport = phoneCode?.sentTransport;
  const expiresIn = phoneCode?.expiresIn;
  return {
    challenge: code,
    sentTransport:
      typeof sentTransport === 'string' ? sentTransport : undefined,
    expiresIn: typeof expiresIn === 'number' ? expiresIn : undefined,
  };
}

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  /** Raw `expires_in` (seconds per the reference; unverified). */
  expiresIn?: number;
};

export function parseTokens(json: unknown): Tokens | null {
  const o = obj(json);
  const access = o?.access_token;
  const refresh = o?.refresh_token;
  if (
    typeof access !== 'string' ||
    access.length === 0 ||
    typeof refresh !== 'string' ||
    refresh.length === 0
  ) {
    return null;
  }
  const expiresIn = o?.expires_in;
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresIn: typeof expiresIn === 'number' ? expiresIn : undefined,
  };
}

// ------------------------------------------------------------- session ----

export type StoredSession = {
  v: 1;
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds, from `expires_in` read as seconds; null when absent. */
  expiresAt: number | null;
  savedAt: number;
};

export function sessionFromTokens(
  tokens: Tokens,
  nowMs: number,
): StoredSession {
  const nowS = Math.floor(nowMs / 1000);
  return {
    v: 1,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresIn === undefined ? null : nowS + tokens.expiresIn,
    savedAt: nowS,
  };
}

export function decodeSession(raw: string): StoredSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = obj(parsed);
  if (
    o?.v !== 1 ||
    typeof o.accessToken !== 'string' ||
    typeof o.refreshToken !== 'string' ||
    !(o.expiresAt === null || typeof o.expiresAt === 'number') ||
    typeof o.savedAt !== 'number'
  ) {
    return null;
  }
  return o as unknown as StoredSession;
}

// ------------------------------------------------------------ execution ----

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    credentials: 'omit';
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type ExecuteResult =
  | { kind: 'response'; sanitized: SanitizedResponse; json: unknown }
  | { kind: 'network'; request: ApiRequest['name']; error: string };

/**
 * One request, never retried. `credentials: 'omit'` keeps any Set-Cookie out
 * of the shared native cookie jar (the WebView cookie store, plain storage).
 */
export async function execute(
  request: ApiRequest,
  fetchImpl: FetchLike,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<ExecuteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      credentials: 'omit',
      signal: controller.signal,
    });
    const rawText = await response.text();
    const { sanitized, json } = sanitizeResponse({
      request: request.name,
      status: response.status,
      contentType: response.headers.get('content-type'),
      retryAfter: response.headers.get('retry-after'),
      rawText,
    });
    return { kind: 'response', sanitized, json };
  } catch (error) {
    // Error names only: messages can echo the URL, never the body.
    const name =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'Timeout'
          : error.name
        : 'Unknown';
    return { kind: 'network', request: request.name, error: name };
  } finally {
    clearTimeout(timer);
  }
}
