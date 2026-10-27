import type { QueryClient } from '@tanstack/react-query';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  PostRepository,
  mergePostsHead,
  refreshPostsHead,
  type PostPage,
  type PostsData,
  type PostsHeadRefreshResult,
} from '../../shared/entities/post';
import { logger as appLogger, type Logger } from '../../shared/services/logger';

/**
 * Feed freshness on resume (AD-7, owner decision 2026-10-26,
 * `spec-feed-refresh-on-resume.md`): after a successful resume E1, the head
 * of «Новое в подписках» is refreshed with one E5 request (page 1, no
 * cursor) when the cached feed is at least `staleTime` old. Thin wrappers
 * over the shared head refresh (`shared/entities/post/postsHeadRefresh.ts`,
 * also used by the Author page).
 */

export type FeedData = PostsData;

export type FeedRefreshResult = PostsHeadRefreshResult;

/**
 * Главная's head refresh options (Epic 3 retro A3, the Author page's
 * rules): skipped while the feed query is in an error state (a focused
 * load-more «Повторить» stays), and an empty page 1 with a next cursor
 * keeps the cached feed (written back as fresh); an empty last page still
 * replaces it.
 */
const FEED_HEAD_OPTIONS = { skipWhileError: true, keepEmptyWithMore: true } as const;

/**
 * `mergePostsHead` (see there) with Главная's options: page 1 collapsed into
 * the cached head, a gap → page 1 alone, an empty page 1 with more pages →
 * the cache unchanged.
 */
export function mergeFeedHead(
  cached: FeedData,
  fresh: PostPage,
): { kind: 'unchanged' | 'prepended' | 'replaced'; data: FeedData } {
  return mergePostsHead(cached, fresh, { keepEmptyWithMore: FEED_HEAD_OPTIONS.keepEmptyWithMore });
}

/**
 * Refresh the feed head (`refreshPostsHead` on the feed key with E5 page 1;
 * failures logged as `feed` / `resume refresh failed`, the kind only).
 * The caller runs it only after the resume `validate()` returned `ok`.
 */
export function refreshFeedHead(
  client: QueryClient,
  http: HttpClient,
  now: number,
  logger: Logger = appLogger,
): Promise<FeedRefreshResult> {
  return refreshPostsHead(
    client,
    queryKeys.subscriptionFeed(),
    () => PostRepository.feedPage(http, null),
    now,
    logger,
    { scope: 'feed', message: 'resume refresh failed' },
    FEED_HEAD_OPTIONS,
  );
}
