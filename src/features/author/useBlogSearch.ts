import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  PostRepository,
  trimPostsToFirstPage,
  usePagedPosts,
  type PagedPosts,
} from '../../shared/entities/post';
import type { Filter } from '../../shared/filters';

/**
 * «Поиск в блоге» results (Story 5.7): E7 through the shared paged-posts
 * hook, keyed by the blog, the submitted (trimmed) query and the route's
 * author Filter (`queryKeys.blogSearch`, its own `search`/`blog` root).
 * `query` null (no submitted query): nothing is requested.
 *
 * - E7 ignores the access params (live, api-contract §3 «E7 (LIVE)»): under
 *   «Доступные мне» a result with `hasAccess: false` is dropped here
 *   (owner decision 2026-10-29, B a). A page left empty with a next cursor
 *   goes through the shared auto-fetch rule (at most 3 in a row).
 * - No session check, no background head refresh (Story 5.6's rules): the
 *   results are a snapshot until the next «Готово» (`submitBlogSearch`).
 * - The query or the Filter changed: the list left behind keeps its first
 *   page only (`trimPostsToFirstPage`).
 */
export function useBlogSearch(
  http: HttpClient,
  blogUrl: string,
  query: string | null,
  filter: Filter,
): PagedPosts {
  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const page = await PostRepository.blogSearchPage(http, blogUrl, query ?? '', cursor, filter);
      return filter.access === 'allowed'
        ? { ...page, posts: page.posts.filter(post => post.hasAccess) }
        : page;
    },
    [http, blogUrl, query, filter],
  );
  const key = queryKeys.blogSearch(blogUrl, query ?? '', filter);
  const results = usePagedPosts({ queryKey: key, fetchPage, enabled: query !== null });
  const client = useQueryClient();
  const shownKey = useRef(JSON.stringify(key));
  const shownRaw = useRef(key);
  useEffect(() => {
    const next = JSON.stringify(key);
    if (next !== shownKey.current) {
      trimPostsToFirstPage(client, shownRaw.current).catch(() => {});
      shownKey.current = next;
      shownRaw.current = key;
    }
  });
  return results;
}

/**
 * «Готово» with a non-empty trimmed query: that query's results under the
 * current Filter start again from page 1 (as Поиск, `submitFeedSearch`).
 */
export function submitBlogSearch(
  client: QueryClient,
  blogUrl: string,
  query: string,
  filter: Filter,
): Promise<void> {
  return client.resetQueries({ queryKey: queryKeys.blogSearch(blogUrl, query, filter), exact: true });
}
