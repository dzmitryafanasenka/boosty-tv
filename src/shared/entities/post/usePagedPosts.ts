import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHeldError, type AppErrorKind } from '../../api';
import { mergePosts } from './postRepository';
import type { Post, PostPage } from './types';

/**
 * The page param after `last`: its cursor, or null at the end. A cursor
 * already used for a page (an immediate repeat or a cycle such as
 * A → B → A) also ends the paging, so a broken cursor cannot loop.
 */
export function nextPageCursor(
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
 * every post is dropped would otherwise walk the whole list behind a
 * skeleton. A user fetch (focus, scroll, «Повторить», «Обновить») resets it.
 */
export const MAX_AUTO_FETCHES = 3;

export type PagedPosts = {
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

export type PagedPostsOptions = {
  /** From `queryKeys` only: no cursor, URL or signed value (ADR 0010). */
  queryKey: QueryKey;
  /** One page after `cursor` (null: the first page), from PostRepository. */
  fetchPage: (cursor: string | null) => Promise<PostPage>;
  enabled?: boolean;
};

/**
 * A paged post list (E5 «Новое в подписках», E4 a blog's posts) through
 * `useInfiniteQuery` with the opaque cursor as the page param (api-contract
 * §5): the cursor goes back verbatim; paging stops on `isLast`, a missing
 * `extra`/`offset` or a used cursor; pages merge by `post.id`; a page that
 * adds nothing but has a next cursor fetches the next one, at most
 * `MAX_AUTO_FETCHES` in a row. `refetchOnMount: false` (a refetch reloads
 * every loaded page) and no query-level retry (HttpClient owns AD-6).
 */
export function usePagedPosts({
  queryKey,
  fetchPage,
  enabled = true,
}: PagedPostsOptions): PagedPosts {
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }): Promise<PostPage> => fetchRef.current(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last, _all, _lastParam, allParams) => nextPageCursor(last, allParams),
    // A remount after `staleTime` would refetch every loaded page in a row
    // (31 requests for a 300-post list). Only explicit actions (and, for the
    // feed, the resume refresh of page 1, ADR 0010) update it.
    refetchOnMount: false,
    retry: false,
    enabled,
  });

  const { data, error, status, fetchNextPage, refetch } = query;
  const posts = useMemo(
    () => (data ? mergePosts(...data.pages.map(page => page.posts)) : []),
    [data],
  );

  // A failure while no card is loaded is the full error (also a failed
  // «Обновить» on an empty list); held during a retry of a failed first page
  // (`useHeldError`), so the error StateView keeps its busy «Повторить».
  const noCards = posts.length === 0;
  const firstPageError = useHeldError({
    empty: noCards,
    status,
    error,
    isFetching: query.isFetching,
  });

  // A page that added no new card (all dropped or duplicates) but has a next
  // cursor: fetch the next one, or paging would stall (nothing new to focus
  // or scroll to). Bounded by `nextPageCursor` (a used cursor ends it).
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
    // After the cap, no card and more pages: the empty StateView.
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
