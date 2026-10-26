import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { QUERY_STALE_TIME_MS, isAppError, queryKeys, type HttpClient } from '../../shared/api';
import { PostRepository, mergePosts, type PostPage } from '../../shared/entities/post';
import { logger as appLogger, type Logger } from '../../shared/services/logger';

/**
 * Feed freshness on resume (AD-7, owner decision 2026-10-26,
 * `spec-feed-refresh-on-resume.md`): after a successful resume E1, the head
 * of «Новое в подписках» is refreshed with one E5 request (page 1, no
 * cursor) when the cached feed is at least `staleTime` old. Loaded pages are
 * kept; a refetch of the infinite query would reload every one of them.
 */

export type FeedData = InfiniteData<PostPage, string | null>;

export type FeedRefreshResult =
  | 'skipped'
  | 'unchanged'
  | 'prepended'
  | 'replaced'
  | 'failed';

/**
 * Merge a fresh first page into the cached feed:
 * - it shares no post id with the cache (a gap larger than a page): page 1
 *   alone replaces the cache (`replaced`);
 * - otherwise page 1 is collapsed into the cached first page: the fresh
 *   posts, then the old first page's posts not among them (deduped by id,
 *   the fresh copy wins, e.g. a post unlocked since), with the old first
 *   page's cursor. `pageParams` and later pages stay as they are, so the
 *   page list never grows and a later refetch walks the same cursor chain.
 *   `prepended` when page 1 brought a post id the cache lacked, else
 *   `unchanged` (the fresh copies are still written).
 */
export function mergeFeedHead(
  cached: FeedData,
  fresh: PostPage,
): { kind: 'unchanged' | 'prepended' | 'replaced'; data: FeedData } {
  const known = new Set<string>();
  for (const page of cached.pages) {
    for (const post of page.posts) {
      known.add(post.id);
    }
  }
  const shared = fresh.posts.filter(post => known.has(post.id)).length;
  if (shared === 0 || cached.pages.length === 0) {
    return { kind: 'replaced', data: { pages: [fresh], pageParams: [null] } };
  }
  const [first, ...rest] = cached.pages;
  return {
    kind: shared === fresh.posts.length ? 'unchanged' : 'prepended',
    data: {
      pages: [{ posts: mergePosts(fresh.posts, first.posts), nextCursor: first.nextCursor }, ...rest],
      pageParams: cached.pageParams,
    },
  };
}

/** One refresh at a time per client (a second resume meanwhile sends nothing). */
const running = new WeakSet<QueryClient>();

/**
 * Refresh the feed head (see the module comment). Sends nothing when no feed
 * is cached, the cache is younger than `QUERY_STALE_TIME_MS` (measured from
 * the last write to the feed, `dataUpdatedAt`, which page appends move too), a
 * refresh is already running, or the feed query is fetching (a page append
 * would overwrite the merge). A failure is silent: the cache stays and only
 * the error kind is logged (no content). A response that arrives after the
 * cache was reset (sign-out, account switch, re-login) is dropped.
 *
 * The caller runs it only after the resume `validate()` returned `ok`.
 */
export async function refreshFeedHead(
  client: QueryClient,
  http: HttpClient,
  now: number,
  logger: Logger = appLogger,
): Promise<FeedRefreshResult> {
  const queryKey = queryKeys.subscriptionFeed();
  const query = client.getQueryCache().find<FeedData>({ queryKey, exact: true });
  if (
    running.has(client) ||
    !query ||
    query.state.data === undefined ||
    query.state.data.pages.length === 0 ||
    query.state.fetchStatus !== 'idle' ||
    now - query.state.dataUpdatedAt < QUERY_STALE_TIME_MS
  ) {
    return 'skipped';
  }

  running.add(client);
  try {
    const fresh = await PostRepository.feedPage(http, null);
    // Reset meanwhile (a new query instance or none), or a fetch started:
    // drop the response.
    const current = client.getQueryCache().find<FeedData>({ queryKey, exact: true });
    const cached = current?.state.data;
    if (current !== query || cached === undefined || current.state.fetchStatus !== 'idle') {
      return 'skipped';
    }
    const merged = mergeFeedHead(cached, fresh);
    client.setQueryData<FeedData>(queryKey, merged.data, { updatedAt: now });
    return merged.kind;
  } catch (error) {
    logger.warn('feed', 'resume refresh failed', {
      kind: isAppError(error) ? error.kind : 'Unknown',
    });
    return 'failed';
  } finally {
    running.delete(client);
  }
}
