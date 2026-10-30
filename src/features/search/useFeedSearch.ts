import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  PostRepository,
  usePagedPosts,
  useTrimOnKeyChange,
  type PagedPosts,
} from '../../shared/entities/post';
import type { Filter } from '../../shared/filters';

/**
 * «Поиск по подпискам» results (Story 5.6): E6 through the shared paged-posts
 * hook, keyed by the submitted (trimmed) query and the `search` Filter
 * (`queryKeys.feedSearch`, its own `search` root). `query` null (no
 * submitted query): nothing is requested.
 *
 * - No session check: an all-locked result page is ordinary.
 * - No background head refresh (owner decision 2026-10-29 Q2 a): the
 *   results are a snapshot until the next «Готово» (`submitFeedSearch`).
 * - The query or the Filter changed: the list left behind keeps its first
 *   page only (`trimPostsToFirstPage`), as on Главная.
 */
export function useFeedSearch(http: HttpClient, query: string | null, filter: Filter): PagedPosts {
  const fetchPage = useCallback(
    (cursor: string | null) => PostRepository.feedSearchPage(http, query ?? '', cursor, filter),
    [http, query, filter],
  );
  const key = queryKeys.feedSearch(query ?? '', filter);
  const results = usePagedPosts({ queryKey: key, fetchPage, enabled: query !== null });
  useTrimOnKeyChange(useQueryClient(), key);
  return results;
}

/**
 * «Готово» with a non-empty trimmed query (owner decision 2026-10-29 Q2 a):
 * the query's results under the current Filter start again from page 1
 * (the cached list, if any, is reset), whether or not it is the query shown.
 * Call before storing the query: an observed query refetches its page 1 at
 * once; an unobserved one fetches it when the screen switches to it.
 */
export function submitFeedSearch(client: QueryClient, query: string, filter: Filter): Promise<void> {
  return client.resetQueries({ queryKey: queryKeys.feedSearch(query, filter), exact: true });
}
