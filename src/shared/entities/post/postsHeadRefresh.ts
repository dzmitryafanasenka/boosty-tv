import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import { isAppError } from '../../api/appError';
import { QUERY_STALE_TIME_MS } from '../../api/queryKeys';
import { logger as appLogger, type Logger } from '../../services/logger';
import { mergePosts } from './postRepository';
import type { PostPage } from './types';

/**
 * Head refresh of a cached paged post list (AD-7): «Новое в подписках» on
 * resume (owner decision 2026-10-26, `spec-feed-refresh-on-resume.md`) and
 * an author's posts on resume and on reopen (owner decision 2026-10-27,
 * `spec-author-posts-refresh.md`). One first-page request, merged into the
 * cached head; loaded pages are kept (a refetch of the infinite query would
 * reload every one of them).
 */

export type PostsData = InfiniteData<PostPage, string | null>;

export type PostsHeadRefreshResult = 'skipped' | 'unchanged' | 'prepended' | 'replaced' | 'failed';

/** Where a failed refresh is logged (the error kind only, never content). */
export type PostsHeadRefreshLog = { scope: string; message: string };

const DEFAULT_LOG: PostsHeadRefreshLog = { scope: 'post', message: 'head refresh failed' };

export type PostsHeadRefreshOptions = {
  /**
   * Skip while the query is in an error state (a failed page append): a
   * write would clear the error and unmount a focused load-more «Повторить»
   * (Автор, spec-author-posts-refresh review loop 1). Off for Главная, whose
   * behaviour is pinned by its tests (spec-feed-refresh-on-resume).
   */
  skipWhileError?: boolean;
  /**
   * An empty page 1 with a next cursor keeps the cached data (written back
   * with `updatedAt: now`, so the next trigger waits a staleTime); an empty
   * last page still replaces the cache (a truly empty list). Автор only;
   * Главная treats every empty page 1 as a gap, as before.
   */
  keepEmptyWithMore?: boolean;
};

/**
 * Merge a fresh first page into the cached list:
 * - (`keepEmptyWithMore`) it is empty but has a next cursor: the cache stays
 *   as it is (`unchanged`, the same `cached` object); such an answer is no
 *   evidence of a gap and must not wipe the loaded pages. Without the
 *   option (Главная), or without a next cursor, an empty page is a gap;
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
export function mergePostsHead(
  cached: PostsData,
  fresh: PostPage,
  { keepEmptyWithMore = false }: { keepEmptyWithMore?: boolean } = {},
): { kind: 'unchanged' | 'prepended' | 'replaced'; data: PostsData } {
  if (keepEmptyWithMore && fresh.posts.length === 0 && fresh.nextCursor !== null) {
    return { kind: 'unchanged', data: cached };
  }
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

/** One refresh at a time per client and query (by its hash). */
const running = new WeakMap<QueryClient, Set<string>>();

/**
 * Refresh the head of the paged list cached under `queryKey` (see the module
 * comment). Sends nothing when nothing is cached, the cache is younger than
 * `QUERY_STALE_TIME_MS` (measured from the last write, `dataUpdatedAt`,
 * which page appends move too), a refresh of the same query is already
 * running, the query is fetching (a page append would overwrite the
 * merge), or (`skipWhileError`) the query is in an error state.
 * A failure is silent: the cache stays and only the error kind is logged
 * (no content). A response that arrives after the cache was reset
 * (sign-out, account switch, re-login), while a fetch of the query started
 * or (`skipWhileError`) after the query entered an error state is dropped.
 * The merged data is written with `updatedAt: now`.
 */
export async function refreshPostsHead(
  client: QueryClient,
  queryKey: QueryKey,
  fetchFirstPage: () => Promise<PostPage>,
  now: number,
  logger: Logger = appLogger,
  log: PostsHeadRefreshLog = DEFAULT_LOG,
  { skipWhileError = false, keepEmptyWithMore = false }: PostsHeadRefreshOptions = {},
): Promise<PostsHeadRefreshResult> {
  const query = client.getQueryCache().find<PostsData>({ queryKey, exact: true });
  let inFlight = running.get(client);
  if (
    !query ||
    inFlight?.has(query.queryHash) ||
    query.state.data === undefined ||
    query.state.data.pages.length === 0 ||
    query.state.fetchStatus !== 'idle' ||
    (skipWhileError && query.state.status === 'error') ||
    now - query.state.dataUpdatedAt < QUERY_STALE_TIME_MS
  ) {
    return 'skipped';
  }

  if (!inFlight) {
    inFlight = new Set();
    running.set(client, inFlight);
  }
  const hash = query.queryHash;
  inFlight.add(hash);
  try {
    const fresh = await fetchFirstPage();
    // Reset meanwhile (a new query instance or none), or a fetch started:
    // drop the response.
    const current = client.getQueryCache().find<PostsData>({ queryKey, exact: true });
    const cached = current?.state.data;
    if (
      current !== query ||
      cached === undefined ||
      current.state.fetchStatus !== 'idle' ||
      (skipWhileError && current.state.status === 'error')
    ) {
      return 'skipped';
    }
    const merged = mergePostsHead(cached, fresh, { keepEmptyWithMore });
    client.setQueryData<PostsData>(queryKey, merged.data, { updatedAt: now });
    return merged.kind;
  } catch (error) {
    logger.warn(log.scope, log.message, {
      kind: isAppError(error) ? error.kind : 'Unknown',
    });
    return 'failed';
  } finally {
    inFlight.delete(hash);
  }
}
