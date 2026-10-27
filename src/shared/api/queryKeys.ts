/**
 * TanStack Query keys (AD-7): the only place that builds them. The query
 * cache is account-scoped (cleared by AccountScope on sign-out and account
 * switch), so keys carry no account id. Never put a signed value, a URL or
 * a cursor in a key: an infinite query keeps its cursors as page params.
 */
export const queryKeys = {
  /** E5 «Новое в подписках» (Story 3.1), an infinite query. */
  subscriptionFeed: () => ['feed', 'subscriptions'] as const,
  /** E2 the subscribed authors (Story 3.2), one request, no paging. */
  subscriptions: () => ['subscriptions'] as const,
  /**
   * E3 a blog's header (Story 3.3). `blogUrl` is the blog's identity (AD-9),
   * not a URL. Separate roots for E3 and E4, so one never prefix-matches
   * the other.
   */
  author: (blogUrl: string) => ['author', blogUrl] as const,
  /** E4 a blog's posts (Story 3.3), an infinite query (cursors are page params). */
  authorPosts: (blogUrl: string) => ['authorPosts', blogUrl] as const,
  /** Every blog's E4 posts query (a prefix of `authorPosts`): the resume refresh. */
  allAuthorPosts: () => ['authorPosts'] as const,
  /**
   * E8 one post (Story 3.4), by its identity `{blogUrl, postId}` (AD-9); no
   * URL or signed value. Its own root: never a prefix of a list key.
   */
  post: (blogUrl: string, postId: string) => ['post', blogUrl, postId] as const,
  /**
   * The player's fresh E8 for one video (Story 4.1), by its `MediaRef` ids
   * only (AD-9). The cached value holds signed URLs in memory: the query
   * uses a short `gcTime` and is never persisted. Its own root: never a
   * prefix of `post`.
   */
  mediaSource: (blogUrl: string, postId: string, mediaId: string) =>
    ['mediaSource', blogUrl, postId, mediaId] as const,
} as const;

/**
 * Server-state freshness (AD-7, ADR 0010): the app client's `staleTime`, and
 * the age at which a resume refreshes the feed head. Here (not in
 * `src/app`) so features can read it.
 */
export const QUERY_STALE_TIME_MS = 60_000;
