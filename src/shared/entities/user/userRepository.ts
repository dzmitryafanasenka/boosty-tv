import { userCurrentSchema } from '../../api/dto/userCurrent';
import type { HttpClient } from '../../api/httpClient';
import type { CurrentUser } from './types';

/**
 * UserRepository (AD-1, AD-8, Story 5.2): the one place that reads the
 * profile fields of E1 (`blogUrl`). The session's own E1 (validate, the
 * sign-in check) stays in SessionManager and reads only the id. The
 * HttpClient is the active session's, passed in by the caller (never a
 * singleton; Epic 2 retro, items 1–2).
 */

/** E1 path (api-contract §3; the session's validate sends the same path). */
export const USER_CURRENT_PATH = '/v1/user/current';

/**
 * E1, one request (content profile, AD-6 retries). Rejects with `AppError`
 * (from HttpClient; `Parse` when the body has no valid `id`). An absent or
 * unsafe `blogUrl` is `null`, never an error.
 */
async function current(http: HttpClient): Promise<CurrentUser> {
  const { body } = await http.get(USER_CURRENT_PATH, userCurrentSchema);
  return { id: String(body.id), blogUrl: body.blogUrl ?? null };
}

export const UserRepository = { current } as const;
