import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import {
  queryKeys,
  useHeldError,
  type AppErrorKind,
  type HttpClient,
} from '../../shared/api';
import {
  AuthorRepository,
  SUBSCRIPTIONS_LIMIT,
  type Author,
} from '../../shared/entities/author';
import { PostRepository, usePagedPosts } from '../../shared/entities/post';
import { UserRepository } from '../../shared/entities/user';

export type Subscriptions = {
  authors: Author[];
  /** No list yet and none failed: the skeleton. */
  isPending: boolean;
  /** The load failed and nothing is loaded: the error StateView. */
  error: AppErrorKind | null;
  /** Any fetch is running («Повторить» shows busy). */
  isFetching: boolean;
  /**
   * The response reached the E2 limit (30 raw items) and the server reports
   * more (`total > 30`): «Показаны первые N». `total` alone is not enough:
   * the live account returned `total` 5 with 3 items. Paging beyond 30 is
   * unverified, so none is offered.
   */
  truncated: boolean;
  /** Reload («Повторить»). */
  refetch: () => void;
};

const EMPTY: Author[] = [];

/**
 * Подписки (Story 3.2): E2 through `useQuery`, one request per load. The
 * HttpClient is the active session's, passed in by the Shell (never a
 * singleton). The cache is account-scoped (ADR 0010); a remount after
 * `staleTime` refetches the single request in the background.
 */
export function useSubscriptions(http: HttpClient): Subscriptions {
  const query = useQuery({
    queryKey: queryKeys.subscriptions(),
    queryFn: () => AuthorRepository.subscriptions(http),
  });
  const { data, error, status, isFetching, refetch } = query;
  const authors = data?.authors ?? EMPTY;

  // The error StateView keeps its busy «Повторить» during a retry.
  const shownError = useHeldError({ empty: data === undefined, status, error, isFetching });

  return {
    authors,
    isPending: shownError === null && data === undefined,
    error: shownError,
    isFetching,
    truncated:
      data !== undefined &&
      data.received >= SUBSCRIPTIONS_LIMIT &&
      data.total !== null &&
      data.total > SUBSCRIPTIONS_LIMIT,
    refetch: () => {
      refetch().catch(() => {});
    },
  };
}

export type MyBlog = {
  /** The account's own blog with at least one post; null: no tile. */
  author: Author | null;
  /**
   * The check has not settled yet (E1, then E3 and E4 page 1, with no answer
   * so far): Подписки keeps its skeleton, so a shown tile is the initial
   * focus. False once any step answers no blog, no post or fails.
   */
  isPending: boolean;
};

const NO_MY_BLOG: MyBlog = { author: null, isPending: false };
/** The disabled queries' key segment (never fetched: `enabled` is false). */
const NO_BLOG = '';

/**
 * «Мой блог» (Story 5.2, SUB-02): E1 (`UserRepository.current`, the `me`
 * key), then, when the account has a `blogUrl`, E3 and E4 page 1 through
 * the Author page's own queries (`queryKeys.author`, `queryKeys.authorPosts`
 * via the shared paged posts hook, 20 per page): opening «Мой блог» then
 * finds both cached. The reference asks E4 with `limit=1`; reusing the
 * Author page's page 1 is our choice (one request either way, and no extra
 * request when Автор opens).
 *
 * A tile only when E3 is `ok` and E4 has at least one post; no `blogUrl`,
 * an unavailable blog, no post or any failure → no tile and no error. The
 * tile shows E3's header with the E1 `blogUrl` (the route). Off (`enabled`
 * false, the `myBlog` phase flag): no request. A failed step is not asked
 * again when Подписки mounts again (`retryOnMount: false`); the Author page's
 * own observers still retry on their mount.
 */
export function useMyBlog(http: HttpClient, enabled: boolean): MyBlog {
  const me = useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => UserRepository.current(http),
    retry: false,
    // A failed check is settled («no tile»): a later visit does not ask
    // again on mount (no skeleton hold, no request storm).
    retryOnMount: false,
    enabled,
  });
  const blogUrl = enabled ? (me.data?.blogUrl ?? null) : null;
  const header = useQuery({
    queryKey: queryKeys.author(blogUrl ?? NO_BLOG),
    queryFn: () => AuthorRepository.blog(http, blogUrl ?? NO_BLOG),
    retry: false,
    retryOnMount: false,
    enabled: blogUrl !== null,
  });
  const fetchPage = useCallback(
    (cursor: string | null) => PostRepository.blogPage(http, blogUrl ?? NO_BLOG, cursor),
    [http, blogUrl],
  );
  const posts = usePagedPosts({
    queryKey: queryKeys.authorPosts(blogUrl ?? NO_BLOG),
    fetchPage,
    enabled: blogUrl !== null,
    retryOnMount: false,
  });

  const author = useMemo(
    () =>
      blogUrl !== null && header.data?.kind === 'ok' ? { ...header.data.author, blogUrl } : null,
    [blogUrl, header.data],
  );

  if (!enabled) {
    return NO_MY_BLOG;
  }
  if (me.data === undefined) {
    return { author: null, isPending: me.status === 'pending' };
  }
  if (blogUrl === null) {
    return NO_MY_BLOG;
  }
  const headerPending = header.data === undefined && header.status === 'pending';
  const hasPost = posts.posts.length > 0;
  if (author !== null && hasPost) {
    return { author, isPending: false };
  }
  // Settled «no»: E3 failed or unavailable, or E4 failed or has no post.
  const headerNo = header.status === 'error' || header.data?.kind === 'unavailable';
  const postsNo = posts.firstPageError !== null || (!posts.isPending && !hasPost);
  return { author: null, isPending: !headerNo && !postsNo && (headerPending || posts.isPending) };
}
