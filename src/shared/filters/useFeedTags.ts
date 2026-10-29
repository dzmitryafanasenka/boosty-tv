import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys, useHeldError, type HttpClient } from '../api';
import { TagRepository, mergeTags, type Tag, type TagPage } from '../entities/tag';

export type FeedTags = {
  /** Every loaded page's tags, in server order, deduped by id (first kept). */
  tags: Tag[];
  /** No page yet and none failed: the loading row. */
  isPending: boolean;
  /**
   * The first page failed and none is loaded: the «Повторить» row. Held
   * while its retry runs (`useHeldError`), so the row and its focus stay.
   */
  firstPageFailed: boolean;
  /** A later page failed: «Повторить» replaces «Загрузить ещё». */
  loadMoreFailed: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** The next page (also the retry of a failed one). */
  fetchNextPage: () => void;
  /** Reload from the first page (the first-page «Повторить»). */
  retry: () => void;
};

/** The next cursor, or null at the end or on a cursor already used (no loop). */
function nextTagCursor(last: TagPage, used: ReadonlyArray<string | null>): string | null {
  return last.nextCursor !== null && !used.includes(last.nextCursor) ? last.nextCursor : null;
}

/**
 * The feed's tags for the filter sheet (Story 5.5, FILTER-03): E13 through
 * `useInfiniteQuery` (`queryKeys.feedTags`, account-scoped like every key:
 * the cache is cleared on sign-out and account switch), the opaque cursor as
 * the page param. Pages load only on an explicit «Загрузить ещё» (no
 * auto-load on scroll). `refetchOnMount: false` (a refetch reloads every
 * loaded page) and no query-level retry (HttpClient owns AD-6). Mounted
 * only while the tag level is open: the first open sends page 1. `enabled`
 * false (Story 5.7, an Author scope shows its blog's tags): no request.
 */
export function useFeedTags(http: HttpClient, enabled: boolean = true): FeedTags {
  const query = useInfiniteQuery({
    queryKey: queryKeys.feedTags(),
    queryFn: ({ pageParam }): Promise<TagPage> => TagRepository.feedTagsPage(http, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last, _all, _lastParam, allParams) => nextTagCursor(last, allParams),
    refetchOnMount: false,
    retry: false,
    enabled,
  });
  const { data, status, error, isFetching } = query;
  const tags = useMemo(() => (data ? mergeTags(...data.pages.map(page => page.tags)) : []), [data]);
  const noPage = data === undefined || data.pages.length === 0;
  const firstPageError = useHeldError({ empty: noPage, status, error, isFetching });
  return {
    tags,
    isPending: firstPageError === null && noPage,
    firstPageFailed: firstPageError !== null,
    loadMoreFailed: query.isFetchNextPageError,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => {
      query.fetchNextPage({ cancelRefetch: false }).catch(() => {});
    },
    retry: () => {
      query.refetch().catch(() => {});
    },
  };
}
