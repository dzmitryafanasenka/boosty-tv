import { useQuery } from '@tanstack/react-query';
import { queryKeys, useHeldError, type HttpClient } from '../api';
import { TagRepository, type Tag } from '../entities/tag';
import type { FeedTags } from './useFeedTags';

const NO_TAGS: Tag[] = [];
/** The disabled query's key segment (never fetched: `enabled` is false). */
const NO_BLOG = '';

/**
 * A blog's tags for the filter sheet (Story 5.7, FILTER-03, Автор scope):
 * E14 through one `useQuery` (`queryKeys.blogTags`, account-scoped like
 * every key), one page: no «Загрузить ещё» (`hasNextPage` is always false).
 * The same shape as `useFeedTags`, so `TagList` renders either source.
 * `blogUrl` null: disabled (the feed's tags are shown). No query-level retry
 * (HttpClient owns AD-6); `refetchOnMount: false`: reopening the level
 * within the cache's life sends nothing.
 */
export function useBlogTags(http: HttpClient, blogUrl: string | null): FeedTags {
  const query = useQuery({
    queryKey: queryKeys.blogTags(blogUrl ?? NO_BLOG),
    queryFn: () => TagRepository.blogTags(http, blogUrl ?? NO_BLOG),
    enabled: blogUrl !== null,
    refetchOnMount: false,
    retry: false,
  });
  const { data, status, error, isFetching } = query;
  const firstPageError = useHeldError({ empty: data === undefined, status, error, isFetching });
  return {
    tags: data ?? NO_TAGS,
    isPending: firstPageError === null && data === undefined,
    firstPageFailed: firstPageError !== null,
    loadMoreFailed: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
    retry: () => {
      query.refetch().catch(() => {});
    },
  };
}
