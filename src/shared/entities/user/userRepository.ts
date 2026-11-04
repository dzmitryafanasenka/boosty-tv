import { userCurrentSchema } from '../../api/dto/userCurrent';
import type { HttpClient } from '../../api/httpClient';
import type { CurrentUser } from './types';

/**
 * UserRepository (AD-1, AD-8, Story 5.2): the one place that reads the
 * profile fields of E1 (`blogUrl`, and `name` since Story 15.2). The
 * session's own E1 (validate, the sign-in check) stays in SessionManager
 * and reads only the id. The
 * HttpClient is the active session's, passed in by the caller (never a
 * singleton; Epic 2 retro, items 1–2).
 */

/** E1 path (api-contract §3; the session's validate sends the same path). */
export const USER_CURRENT_PATH = '/v1/user/current';

/**
 * Characters a phone number is written with: digits, spaces, `+`, `-`,
 * en and em dashes, brackets, `.`, `/`, and the mask characters `*` and
 * `•` (a masked digit).
 */
const PHONE_LIKE = /^[\d\s+()\-–—./*•]+$/;
/** A mask character (a hidden digit). */
const PHONE_MASK = /[*•]/;
/** An unmasked phone-like value with at least this many digits is not a name. */
const PHONE_MIN_DIGITS = 7;
/** A masked phone-like value with at least this many visible digits is not a name. */
const MASKED_PHONE_MIN_DIGITS = 4;

/**
 * The display name Настройки may show (Story 15.2, IMP-10): E1 `name`
 * trimmed; null when absent, blank or phone-like (only phone characters,
 * with 7+ digits, or with 4+ digits and a mask character `*` / `•`), so a
 * phone number is never shown as the account name.
 */
export function accountDisplayName(raw: string | undefined): string | null {
  const name = raw?.trim() ?? '';
  if (name === '') {
    return null;
  }
  const digits = name.replace(/\D/g, '').length;
  if (!PHONE_LIKE.test(name)) {
    return name;
  }
  const min = PHONE_MASK.test(name) ? MASKED_PHONE_MIN_DIGITS : PHONE_MIN_DIGITS;
  return digits >= min ? null : name;
}

/**
 * E1, one request (content profile, AD-6 retries). Rejects with `AppError`
 * (from HttpClient; `Parse` when the body has no valid `id`). An absent or
 * unsafe `blogUrl` is `null`, never an error; so is an absent, blank or
 * phone-like `name` (`accountDisplayName`).
 */
async function current(http: HttpClient): Promise<CurrentUser> {
  const { body } = await http.get(USER_CURRENT_PATH, userCurrentSchema);
  return {
    id: String(body.id),
    blogUrl: body.blogUrl ?? null,
    name: accountDisplayName(body.name),
  };
}

export const UserRepository = { current } as const;
