import { useCallback } from 'react';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  MAX_AUTO_FETCHES,
  PostRepository,
  nextPageCursor,
  usePagedPosts,
  type PagedPosts,
} from '../../shared/entities/post';

/** The paging rules live in `shared/entities/post/usePagedPosts` (also the Author page). */
export const nextFeedCursor = nextPageCursor;
export { MAX_AUTO_FETCHES };

export type SubscriptionFeed = PagedPosts;

/**
 * «Новое в подписках» (Story 3.1): E5 through the shared paged-posts hook
 * with the opaque cursor as the page param. The HttpClient is the active
 * session's, passed in by the Shell (never a singleton). `enabled` is false
 * while Главная shows the offline view.
 */
export function useSubscriptionFeed(http: HttpClient, enabled: boolean): SubscriptionFeed {
  const fetchPage = useCallback(
    (cursor: string | null) => PostRepository.feedPage(http, cursor),
    [http],
  );
  return usePagedPosts({ queryKey: queryKeys.subscriptionFeed(), fetchPage, enabled });
}
