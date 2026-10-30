import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  PostRepository,
  usePagedPosts,
  useTrimOnKeyChange,
  type PagedPosts,
} from '../../shared/entities/post';
import type { Filter } from '../../shared/filters';
import { refreshAuthorPostsHead } from './authorPostsRefresh';

/**
 * The author's posts (Story 3.3): E4 pages of 20 through the shared paged
 * posts hook (the E5 rules: opaque cursor, stop on `isLast`/missing
 * `extra`/used cursor, dedupe by `post.id`, at most 3 automatic fetches of
 * empty pages, `refetchOnMount: false`, no query-level retry).
 *
 * Story 5.7: the route's Filter picks the E4 params and the query key (a
 * Filter change is another query, page 1 first). The list left behind keeps
 * its first page only (`trimPostsToFirstPage`, as on Главная).
 *
 * Reopen (owner decision 2026-10-27, `spec-author-posts-refresh.md`): when
 * the page mounts (or its Filter changes) with cached posts at least
 * `staleTime` old, the head is refreshed with one E4 page-1 request
 * (`refreshAuthorPostsHead`). A first open without a cache loads normally
 * (the refresh skips a pending query).
 */
export function useAuthorPosts(http: HttpClient, blogUrl: string, filter: Filter): PagedPosts {
  const fetchPage = useCallback(
    (cursor: string | null) => PostRepository.blogPage(http, blogUrl, cursor, filter),
    [http, blogUrl, filter],
  );
  const key = queryKeys.authorPosts(blogUrl, filter);
  const keyString = JSON.stringify(key);
  const posts = usePagedPosts({ queryKey: key, fetchPage });
  const client = useQueryClient();
  const filterRef = useRef(filter);
  filterRef.current = filter;
  useEffect(() => {
    refreshAuthorPostsHead(client, http, blogUrl, filterRef.current, Date.now()).catch(() => {});
  }, [client, http, blogUrl, keyString]);
  // The Filter changed: the list left behind keeps its first page only
  // (after the head refresh above, as before).
  useTrimOnKeyChange(client, key);
  return posts;
}
