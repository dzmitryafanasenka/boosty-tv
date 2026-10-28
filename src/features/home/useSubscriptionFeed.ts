import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  trimPostsToFirstPage,
  usePagedPosts,
  type PagedPosts,
} from '../../shared/entities/post';
import type { Filter } from '../../shared/filters';

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
 * The `feed` Filter (Story 5.3) picks the E5 params and the query key: a
 * Filter change is another query (its own cache, page 1 first).
 *
 * A fetched page 1 with posts, every one locked, asks the SessionCheck port
 * (Epic 3 retro A6): a dead token makes the whole feed look locked
 * (api-contract §7). The cards stay shown meanwhile; `refetch` reloads the
 * feed once, `expired` opens A11 through the app's status listener. Only
 * under «Доступные мне» (Story 5.3): under «Все посты» or «Только
 * купленные» an all-locked page is legitimate. A page 1 with one accessible
 * post, an empty one, later pages and the resume head refresh send no
 * check. The Author page has no such check: a blog whose posts are all
 * locked is ordinary there.
 */
export function useSubscriptionFeed(
  http: HttpClient,
  enabled: boolean,
  filter: Filter,
): SubscriptionFeed {
  const refetchRef = useRef<() => void>(() => {});
  const checkLocked = useLockedSessionCheck(SESSION_CHECK_KEYS.feed, () => refetchRef.current());
  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const page = await PostRepository.feedPage(http, cursor, filter);
      if (
        filter.access === 'allowed' &&
        cursor === null &&
        page.posts.length > 0 &&
        page.posts.every(post => !post.hasAccess)
      ) {
        checkLocked();
      }
      return page;
    },
    [http, checkLocked, filter],
  );
  const feed = usePagedPosts({ queryKey: queryKeys.subscriptionFeed(filter), fetchPage, enabled });
  // The Filter changed (Story 5.3): the feed left behind keeps its first
  // page only, so switching back to it while stale sends one E5 request,
  // not one per page it had loaded.
  const client = useQueryClient();
  const shownFilter = useRef(filter);
  useEffect(() => {
    const previous = shownFilter.current;
    shownFilter.current = filter;
    const previousKey = queryKeys.subscriptionFeed(previous);
    if (JSON.stringify(previousKey) !== JSON.stringify(queryKeys.subscriptionFeed(filter))) {
      trimPostsToFirstPage(client, previousKey).catch(() => {});
    }
  }, [client, filter]);
  refetchRef.current = feed.refetch;
  return feed;
}
