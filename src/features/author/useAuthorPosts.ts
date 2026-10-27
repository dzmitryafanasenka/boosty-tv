import { useCallback } from 'react';
import { queryKeys, type HttpClient } from '../../shared/api';
import { PostRepository, usePagedPosts, type PagedPosts } from '../../shared/entities/post';

/**
 * The author's posts (Story 3.3): E4 pages of 20 through the shared paged
 * posts hook (the E5 rules: opaque cursor, stop on `isLast`/missing
 * `extra`/used cursor, dedupe by `post.id`, at most 3 automatic fetches of
 * empty pages, `refetchOnMount: false`, no query-level retry).
 */
export function useAuthorPosts(http: HttpClient, blogUrl: string): PagedPosts {
  const fetchPage = useCallback(
    (cursor: string | null) => PostRepository.blogPage(http, blogUrl, cursor),
    [http, blogUrl],
  );
  return usePagedPosts({ queryKey: queryKeys.authorPosts(blogUrl), fetchPage });
}
