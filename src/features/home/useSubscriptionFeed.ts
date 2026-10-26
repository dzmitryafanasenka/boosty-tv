import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAppError, queryKeys, type AppErrorKind, type HttpClient } from '../../shared/api';
import { PostRepository, mergePosts, type Post, type PostPage } from '../../shared/entities/post';

/**
 * The page param after `last`: its cursor, or null at the end. A cursor
 * already used for a page (an immediate repeat or a cycle such as
 * A → B → A) also ends the paging, so a broken cursor cannot loop.
 */
export function nextFeedCursor(
  last: PostPage,
  usedCursors: ReadonlyArray<string | null>,
): string | null {
  return last.nextCursor !== null && !usedCursors.includes(last.nextCursor)
    ? last.nextCursor
    : null;
}

/**
 * Consecutive automatic page fetches (a page that showed nothing new) before
 * the auto-paging stops: a server that keeps issuing fresh cursors while
 * every post is dropped would otherwise walk the whole feed behind a
 * skeleton. A user fetch (focus, scroll, «Повторить», «Обновить») resets it.
 */
export const MAX_AUTO_FETCHES = 3;

export type SubscriptionFeed = {
  /** Every loaded page, appended and deduped by `post.id` (first kept). */
  posts: Post[];
  /**
   * No card yet, none failed, and more may come (no page yet, or pages that
   * added no card but have a next cursor): the skeleton.
   */
  isPending: boolean;
  /** The first page failed and nothing is loaded: the full-error StateView. */
  firstPageError: AppErrorKind | null;
  /** A later page failed: the inline «Повторить» row; loaded cards stay. */
  loadMoreFailed: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Any fetch is running (StateView actions show busy). */
  isFetching: boolean;
  /** Next page (also the retry of a failed one: it reloads only that page). */
  fetchNextPage: () => void;
  /** Reload from the first page (full-error «Повторить», empty «Обновить»). */
  refetch: () => void;
  /**
   * An automatic next page (a page that showed nothing new). Counts toward
   * `MAX_AUTO_FETCHES`; false when the cap stopped it.
   */
  autoFetchNext: () => boolean;
};

/**
 * «Новое в подписках» (Story 3.1): E5 through `useInfiniteQuery` with the
 * opaque cursor as the page param. The HttpClient is the active session's,
 * passed in by the Shell (never a singleton). `enabled` is false while
 * Главная shows the offline view.
 */
export function useSubscriptionFeed(http: HttpClient, enabled: boolean): SubscriptionFeed {
  const query = useInfiniteQuery({
    queryKey: queryKeys.subscriptionFeed(),
    queryFn: ({ pageParam }): Promise<PostPage> => PostRepository.feedPage(http, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last, _all, _lastParam, allParams) => nextFeedCursor(last, allParams),
    // A remount after `staleTime` would refetch every loaded page in a row
    // (31 requests for a 300-post feed). The feed refreshes only by explicit
    // action (ADR 0010).
    refetchOnMount: false,
    enabled,
  });

  const { data, error, status, fetchNextPage, refetch } = query;
  const posts = useMemo(
    () => (data ? mergePosts(...data.pages.map(page => page.posts)) : []),
    [data],
  );

  // A failure while no card is loaded is the full error (also a failed
  // «Обновить» on the empty feed). A retry of a failed first page puts the
  // query back to `pending`: keep reporting the last error meanwhile, so the
  // error StateView stays with its busy «Повторить» (focus kept) instead of
  // the skeleton.
  const noCards = posts.length === 0;
  const lastError = useRef<AppErrorKind | null>(null);
  if (status === 'error' && noCards) {
    lastError.current = isAppError(error) ? error.kind : 'Client';
  } else if (!noCards || !query.isFetching) {
    lastError.current = null;
  }
  const firstPageError: AppErrorKind | null =
    noCards && (status === 'error' || query.isFetching) ? lastError.current : null;

  // A page that added no new card (all dropped or duplicates) but has a next
  // cursor: fetch the next one, or paging would stall (nothing new to focus
  // or scroll to). Bounded by `nextFeedCursor` (a used cursor ends it).
  const pages = data?.pages;
  const lastPageAddedNothing = useMemo(
    () =>
      pages !== undefined &&
      pages.length > 0 &&
      mergePosts(...pages.slice(0, -1).map(page => page.posts)).length === posts.length,
    [pages, posts],
  );
  const autoFetches = useRef(0);
  const [autoStopped, setAutoStopped] = useState(false);
  const autoFetchNext = useCallback(() => {
    if (autoFetches.current >= MAX_AUTO_FETCHES) {
      setAutoStopped(true);
      return false;
    }
    autoFetches.current += 1;
    fetchNextPage({ cancelRefetch: false }).catch(() => {});
    return true;
  }, [fetchNextPage]);
  const userFetch = useCallback(() => {
    autoFetches.current = 0;
    setAutoStopped(false);
  }, []);

  const stalled =
    lastPageAddedNothing &&
    query.hasNextPage &&
    !query.isFetching &&
    status !== 'error';
  useEffect(() => {
    if (stalled) {
      autoFetchNext();
    }
  }, [stalled, pages, autoFetchNext]);

  return {
    posts,
    // After the cap, no card and more pages: the empty StateView («Обновить»).
    isPending:
      firstPageError === null &&
      noCards &&
      (status === 'pending' || (query.hasNextPage && !autoStopped)),
    firstPageError,
    loadMoreFailed: query.isFetchNextPageError,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetching: query.isFetching,
    fetchNextPage: () => {
      userFetch();
      fetchNextPage({ cancelRefetch: false }).catch(() => {});
    },
    refetch: () => {
      userFetch();
      refetch().catch(() => {});
    },
    autoFetchNext,
  };
}
