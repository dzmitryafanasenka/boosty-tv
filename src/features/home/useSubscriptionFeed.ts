import { useCallback, useRef } from 'react';
import {
  SESSION_CHECK_KEYS,
  queryKeys,
  useLockedSessionCheck,
  type HttpClient,
} from '../../shared/api';
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
 *
 * A fetched page 1 with posts, every one locked, asks the SessionCheck port
 * (Epic 3 retro A6): a dead token makes the whole feed look locked
 * (api-contract §7). The cards stay shown meanwhile; `refetch` reloads the
 * feed once, `expired` opens A11 through the app's status listener. A page 1
 * with one accessible post, an empty one, later pages and the resume head
 * refresh send no check. The Author page has no such check: a blog whose
 * posts are all locked is ordinary there.
 */
export function useSubscriptionFeed(http: HttpClient, enabled: boolean): SubscriptionFeed {
  const refetchRef = useRef<() => void>(() => {});
  const checkLocked = useLockedSessionCheck(SESSION_CHECK_KEYS.feed, () => refetchRef.current());
  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const page = await PostRepository.feedPage(http, cursor);
      if (cursor === null && page.posts.length > 0 && page.posts.every(post => !post.hasAccess)) {
        checkLocked();
      }
      return page;
    },
    [http, checkLocked],
  );
  const feed = usePagedPosts({ queryKey: queryKeys.subscriptionFeed(), fetchPage, enabled });
  refetchRef.current = feed.refetch;
  return feed;
}
