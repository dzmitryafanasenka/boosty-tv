import type { QueryClient } from '@tanstack/react-query';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  PostRepository,
  refreshPostsHead,
  type PostsHeadRefreshResult,
} from '../../shared/entities/post';
import { logger as appLogger, type Logger } from '../../shared/services/logger';

/**
 * Author posts freshness (owner decision 2026-10-27, option 2,
 * `spec-author-posts-refresh.md`): the head of a blog's cached posts is
 * refreshed with one E4 request (page 1, no cursor) when the cache is at
 * least `staleTime` old, by the same rules as Главная's resume refresh
 * (`refreshPostsHead`). Triggers: the Author page mounting with cached
 * posts (reopen), and a resume E1 `ok` for every Author route in the stack.
 */

const LOG = { scope: 'author', message: 'head refresh failed' };

/** Refresh the head of `blogUrl`'s cached posts (failures: the error kind is logged). */
export function refreshAuthorPostsHead(
  client: QueryClient,
  http: HttpClient,
  blogUrl: string,
  now: number,
  logger: Logger = appLogger,
): Promise<PostsHeadRefreshResult> {
  return refreshPostsHead(
    client,
    queryKeys.authorPosts(blogUrl),
    () => PostRepository.blogPage(http, blogUrl, null),
    now,
    logger,
    LOG,
    // A failed page append keeps its «Повторить»; an empty page 1 with more
    // pages keeps the loaded posts (review loop 1); a leading pinned post is
    // not evidence of overlap, and a re-pin drops the old pin (retro A1).
    { skipWhileError: true, keepEmptyWithMore: true, pinnedFirst: true },
  );
}

/**
 * Resume: refresh every cached blog's posts that has an observer (an Author
 * route in the stack, covered or not). Queries without an observer (a popped
 * Author still in the cache) are left alone; they refresh on reopen.
 */
export function refreshAuthorPostsHeads(
  client: QueryClient,
  http: HttpClient,
  now: number,
  logger: Logger = appLogger,
): Promise<PostsHeadRefreshResult[]> {
  const observed = client
    .getQueryCache()
    .findAll({ queryKey: queryKeys.allAuthorPosts() })
    .filter(query => query.getObserversCount() > 0)
    .map(query => query.queryKey[1])
    .filter((blogUrl): blogUrl is string => typeof blogUrl === 'string');
  return Promise.all(
    observed.map(blogUrl => refreshAuthorPostsHead(client, http, blogUrl, now, logger)),
  );
}
