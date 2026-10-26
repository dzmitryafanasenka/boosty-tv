import { subscriptionsDtoSchema } from '../../api/dto/subscriptions';
import type { HttpClient } from '../../api/httpClient';
import { logger as appLogger, type Logger } from '../../services/logger';
import { mapSubscription } from './mapAuthor';
import type { Author, SubscriptionList } from './types';

/**
 * AuthorRepository (AD-1, AD-8): the only caller of the author endpoints.
 * The HttpClient is the active session's, passed in by the caller (never a
 * singleton; Epic 2 retro, items 1–2).
 */

/** E2 page size. Paging beyond it is unverified (api-contract §5), so none. */
export const SUBSCRIPTIONS_LIMIT = 30;

/** E2 path, exactly as the reference sends it (api-contract §3). */
export const SUBSCRIPTIONS_PATH = `/v1/user/subscriptions?limit=${SUBSCRIPTIONS_LIMIT}&with_follow=true`;

/** Dedupe by `blogUrl`, keeping the first occurrence. */
function dedupe(authors: readonly Author[]): Author[] {
  const seen = new Set<string>();
  return authors.filter(author => {
    if (seen.has(author.blogUrl)) {
      return false;
    }
    seen.add(author.blogUrl);
    return true;
  });
}

/**
 * E2, one request. Rejects with `AppError` (from HttpClient; `Parse` when
 * the response shape is wrong). A malformed item is dropped and logged; the
 * list never fails for one item.
 */
async function subscriptions(
  http: HttpClient,
  logger: Logger = appLogger,
): Promise<SubscriptionList> {
  const { body } = await http.get(SUBSCRIPTIONS_PATH, subscriptionsDtoSchema);
  const authors = dedupe(
    body.data.map(raw => mapSubscription(raw, logger)).filter((a): a is Author => a !== null),
  );
  return { authors, received: body.data.length, total: body.total ?? null };
}

export const AuthorRepository = { subscriptions } as const;
