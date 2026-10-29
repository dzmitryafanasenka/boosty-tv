import type { QueryClient } from '@tanstack/react-query';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  PostRepository,
  refreshPostsHead,
  type PostsHeadRefreshResult,
} from '../../shared/entities/post';
import {
  ACCESS_VALUES,
  ALL_TIME,
  DEFAULT_FILTER,
  PERIOD_PRESET_DAYS,
  type AccessFilter,
  type Filter,
  type Period,
} from '../../shared/filters';
import { logger as appLogger, type Logger } from '../../shared/services/logger';

/**
 * Author posts freshness (owner decision 2026-10-27, option 2,
 * `spec-author-posts-refresh.md`): the head of a blog's cached posts is
 * refreshed with one E4 request (page 1, no cursor) when the cache is at
 * least `staleTime` old, by the same rules as Главная's resume refresh
 * (`refreshPostsHead`). Triggers: the Author page mounting with cached
 * posts (reopen), and a resume E1 `ok` for every Author route in the stack.
 * Story 5.7: always the key and params of the route's active Filter.
 */

const LOG = { scope: 'author', message: 'head refresh failed' };

/** Refresh the head of `blogUrl`'s cached posts under `filter` (failures: the error kind is logged). */
export function refreshAuthorPostsHead(
  client: QueryClient,
  http: HttpClient,
  blogUrl: string,
  filter: Filter,
  now: number,
  logger: Logger = appLogger,
): Promise<PostsHeadRefreshResult> {
  return refreshPostsHead(
    client,
    queryKeys.authorPosts(blogUrl, filter),
    () => PostRepository.blogPage(http, blogUrl, null, filter),
    now,
    logger,
    LOG,
    // A failed page append keeps its «Повторить»; an empty page 1 with more
    // pages keeps the loaded posts (review loop 1); a leading pinned post is
    // not evidence of overlap, and a re-pin drops the old pin (retro A1).
    { skipWhileError: true, keepEmptyWithMore: true, pinnedFirst: true },
  );
}

const isPeriod = (value: unknown): value is Period => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const period = value as { kind?: unknown; days?: unknown; fromDay?: unknown; toDay?: unknown };
  return (
    period.kind === 'all' ||
    (period.kind === 'preset' &&
      PERIOD_PRESET_DAYS.includes(period.days as (typeof PERIOD_PRESET_DAYS)[number])) ||
    (period.kind === 'custom' &&
      typeof period.fromDay === 'string' &&
      typeof period.toDay === 'string')
  );
};

/**
 * The Filter an `authorPosts` key was built from (its third segment:
 * `{access, period, tagIds}`), for the request params only: tag titles are
 * not in the key and never reach a request. Null when the key is not one.
 */
export function filterOfAuthorPostsKey(segment: unknown): Filter | null {
  if (typeof segment !== 'object' || segment === null) {
    return null;
  }
  const { access, period, tagIds } = segment as {
    access?: unknown;
    period?: unknown;
    tagIds?: unknown;
  };
  if (
    !ACCESS_VALUES.includes(access as AccessFilter) ||
    !isPeriod(period) ||
    !Array.isArray(tagIds) ||
    !tagIds.every(id => typeof id === 'string')
  ) {
    return null;
  }
  return {
    access: access as AccessFilter,
    period: period.kind === 'all' ? ALL_TIME : period,
    tags: tagIds.length === 0 ? DEFAULT_FILTER.tags : tagIds.map(id => ({ id, title: '' })),
  };
}

/**
 * Resume: refresh every cached blog's posts that has an observer (an Author
 * route in the stack, covered or not, or Подписки's «Мой блог»), each with
 * the Filter its key holds. Queries without an observer (a popped Author or
 * a Filter left behind, still in the cache) are left alone.
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
    .flatMap(query => {
      const blogUrl = query.queryKey[1];
      const filter = filterOfAuthorPostsKey(query.queryKey[2]);
      return typeof blogUrl === 'string' && filter !== null ? [{ blogUrl, filter }] : [];
    });
  return Promise.all(
    observed.map(({ blogUrl, filter }) =>
      refreshAuthorPostsHead(client, http, blogUrl, filter, now, logger),
    ),
  );
}
