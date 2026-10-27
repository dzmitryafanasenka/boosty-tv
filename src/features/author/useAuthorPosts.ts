import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { queryKeys, type HttpClient } from '../../shared/api';
import { PostRepository, usePagedPosts, type PagedPosts } from '../../shared/entities/post';
import { refreshAuthorPostsHead } from './authorPostsRefresh';

/**
 * The author's posts (Story 3.3): E4 pages of 20 through the shared paged
 * posts hook (the E5 rules: opaque cursor, stop on `isLast`/missing
 * `extra`/used cursor, dedupe by `post.id`, at most 3 automatic fetches of
 * empty pages, `refetchOnMount: false`, no query-level retry).
 *
 * Reopen (owner decision 2026-10-27, `spec-author-posts-refresh.md`): when
 * the page mounts with cached posts at least `staleTime` old, the head is
 * refreshed with one E4 page-1 request (`refreshAuthorPostsHead`). A first
 * open without a cache loads normally (the refresh skips a pending query).
 */
export function useAuthorPosts(http: HttpClient, blogUrl: string): PagedPosts {
  const fetchPage = useCallback(
    (cursor: string | null) => PostRepository.blogPage(http, blogUrl, cursor),
    [http, blogUrl],
  );
  const posts = usePagedPosts({ queryKey: queryKeys.authorPosts(blogUrl), fetchPage });
  const client = useQueryClient();
  useEffect(() => {
    refreshAuthorPostsHead(client, http, blogUrl, Date.now()).catch(() => {});
  }, [client, http, blogUrl]);
  return posts;
}
