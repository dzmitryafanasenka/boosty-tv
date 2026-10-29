import type { QueryClient } from '@tanstack/react-query';
import { queryKeys, type HttpClient } from '../../shared/api';
import type { BlogResult } from '../../shared/entities/author';
import type { CurrentUser } from '../../shared/entities/user';
import {
  PostRepository,
  mergePostsHead,
  refreshPostsHead,
  trimPostsToFirstPage,
  type PostPage,
  type PostsData,
  type PostsHeadRefreshResult,
} from '../../shared/entities/post';
import { DEFAULT_FILTER, type Filter } from '../../shared/filters';
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
 * Refresh the feed head (`refreshPostsHead` on the key of the active `feed`
 * Filter with that Filter's E5 page 1, Story 5.3; the other Filters'
 * caches are left alone; failures logged as `feed` / `resume refresh
 * failed`, the kind only). The caller runs it only after the resume
 * `validate()` returned `ok`.
 */
export function refreshFeedHead(
  client: QueryClient,
  http: HttpClient,
  filter: Filter,
  now: number,
  logger: Logger = appLogger,
): Promise<FeedRefreshResult> {
  return refreshPostsHead(
    client,
    queryKeys.subscriptionFeed(filter),
    () => PostRepository.feedPage(http, null, filter),
    now,
    logger,
    { scope: 'feed', message: 'resume refresh failed' },
    FEED_HEAD_OPTIONS,
  );
}

/** Refetch exactly one cached query (also with no observer), not awaited. */
function refetchExact(client: QueryClient, queryKey: readonly unknown[]): Promise<void> {
  return client.invalidateQueries({ queryKey, exact: true, refetchType: 'all' });
}

/**
 * «Обновить» re-asks the «Мой блог» steps that ended without a tile (Epic 5
 * retro A3; the tile's own rules stay Подписки's, Story 5.2): from the
 * cache only, with the keys of `useMyBlog` (`features/home` never imports
 * `features/subscriptions`).
 *
 * - `me` (E1) failed, or has no `blogUrl`: refetched; on success the
 *   observers (when Подписки is mounted) run the rest of the chain.
 * - The own blog's header (E3) failed or is `unavailable`: refetched.
 * - Its posts (E4, the default Filter) failed or are empty: refetched.
 *   That list holds page 1 only (Подписки never loads more); a longer
 *   one is trimmed to page 1 first, so one request is sent, never a
 *   page storm.
 * - A step never asked, one in flight, or one that succeeded (a shown
 *   tile): no request. Подписки not visited yet: the `me` query is not in
 *   the cache. With `phaseFlags.myBlog` off, `useMyBlog` never fills the
 *   `me` query, so nothing is re-asked.
 * - Cost: for an account without a blog, every «Обновить» after a visit
 *   to Подписки sends one E1.
 */
function recheckMyBlog(client: QueryClient): void {
  const settled = (state: { status: string; fetchStatus: string } | undefined) =>
    state !== undefined && state.status !== 'pending' && state.fetchStatus !== 'fetching';
  const meKey = queryKeys.me();
  const me = client.getQueryState<CurrentUser>(meKey);
  if (!settled(me)) {
    return;
  }
  const blogUrl = me?.data?.blogUrl ?? null;
  if (blogUrl === null) {
    // Failed, or the account had no blog (yet).
    refetchExact(client, meKey).catch(() => {});
    return;
  }
  const headerKey = queryKeys.author(blogUrl);
  const header = client.getQueryState<BlogResult>(headerKey);
  if (settled(header) && header?.data?.kind !== 'ok') {
    refetchExact(client, headerKey).catch(() => {});
  }
  const postsKey = queryKeys.authorPosts(blogUrl, DEFAULT_FILTER);
  const posts = client.getQueryState<PostsData>(postsKey);
  const hasPost = posts?.data?.pages.some(page => page.posts.length > 0) ?? false;
  if (settled(posts) && !hasPost) {
    trimPostsToFirstPage(client, postsKey)
      .then(() => refetchExact(client, postsKey))
      .catch(() => {});
  }
}

/** One manual refresh at a time per client (its promise). */
const manualRunning = new WeakMap<QueryClient, Promise<FeedRefreshResult>>();

/**
 * Главная's «Обновить» (Story 5.1, FR-16, FEED-03): a forced head refresh
 * (`refreshPostsHead` with `force`: no staleness check, waits for a running
 * page append, also while a page append has failed; one E5 page-1 request
 * merged into the cached feed, loaded pages kept, never a refetch of the
 * infinite query, ADR 0010), and an invalidation of exactly the
 * subscriptions query (E2, refetched once when it is cached, even with no
 * observer; not awaited), plus the «Мой блог» re-check (`recheckMyBlog`,
 * Epic 5 retro A3; not awaited). The feed is the active `feed` Filter's (Story
 * 5.3). Single-flight: a call while one runs returns the
 * same promise; a resume refresh already running is joined, not
 * duplicated. The result is the feed's (`failed`: the cache stays, the kind
 * is logged as `feed` / `manual refresh failed`); an E2 failure is the
 * subscriptions query's own error, not this one's.
 */
export function manualRefreshFeed(
  client: QueryClient,
  http: HttpClient,
  filter: Filter,
  now: number,
  logger: Logger = appLogger,
): Promise<FeedRefreshResult> {
  const running = manualRunning.get(client);
  if (running) {
    return running;
  }
  // E2 is not awaited: the button is busy for the feed only (the
  // subscriptions query shows its own state); its errors are its own.
  client
    .invalidateQueries({ queryKey: queryKeys.subscriptions(), exact: true, refetchType: 'all' })
    .catch(() => {});
  // «Мой блог» steps that ended without a tile (Epic 5 retro A3); not awaited.
  recheckMyBlog(client);
  const run = (async () => {
    try {
      return await refreshPostsHead(
        client,
        queryKeys.subscriptionFeed(filter),
        () => PostRepository.feedPage(http, null, filter),
        now,
        logger,
        { scope: 'feed', message: 'manual refresh failed' },
        { ...FEED_HEAD_OPTIONS, force: true },
      );
    } finally {
      manualRunning.delete(client);
    }
  })();
  manualRunning.set(client, run);
  return run;
}
