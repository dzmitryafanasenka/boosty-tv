import { tagIdsKey, type Filter } from '../filters/filter';

/**
 * TanStack Query keys (AD-7): the only place that builds them. The query
 * cache is account-scoped (cleared by AccountScope on sign-out and account
 * switch), so keys carry no account id. Never put a signed value, a URL or
 * a cursor in a key: an infinite query keeps its cursors as page params.
 */
export const queryKeys = {
  /**
   * E5 «Новое в подписках» (Story 3.1), an infinite query, one per Filter
   * (Story 5.3, AD-18: the symbolic Filter, never request params). Every
   * feed path (page loads, the resume head refresh, «Обновить») uses the
   * active `feed` Filter's key. Story 5.5: the tags as their sorted ids
   * (`tagIdsKey`), never their titles or selection order, so A+B and B+A
   * (or a renamed tag) are one query.
   */
  subscriptionFeed: (filter: Filter) =>
    [
      'feed',
      'subscriptions',
      { access: filter.access, period: filter.period, tagIds: tagIdsKey(filter) },
    ] as const,
  /** Every Filter's E5 feed query (a prefix of `subscriptionFeed`). */
  allSubscriptionFeeds: () => ['feed', 'subscriptions'] as const,
  /**
   * E6 «Поиск по подпискам» (Story 5.6), an infinite query per submitted
   * query and `search` Filter (the trimmed query, the symbolic Filter as in
   * `subscriptionFeed`; never request params, a cursor or a URL). Its own
   * root `search`: never a prefix of a feed or author key (AD-7). Story
   * 5.7's blog search is `['search', 'blog', blogUrl, …]` (`blogSearch`).
   */
  feedSearch: (query: string, filter: Filter) =>
    [
      'search',
      'feed',
      { query, access: filter.access, period: filter.period, tagIds: tagIdsKey(filter) },
    ] as const,
  /** Every E6 search query (a prefix of `feedSearch`). */
  allFeedSearches: () => ['search', 'feed'] as const,
  /**
   * E7 «Поиск в блоге» (Story 5.7), an infinite query per blog, submitted
   * (trimmed) query and the route's author Filter (symbolic, as in
   * `authorPosts`). Under the `search` root but its own `blog` segment:
   * never a prefix of a feed search, feed, author or author-posts key.
   */
  blogSearch: (blogUrl: string, query: string, filter: Filter) =>
    [
      'search',
      'blog',
      blogUrl,
      { query, access: filter.access, period: filter.period, tagIds: tagIdsKey(filter) },
    ] as const,
  /** Every E7 search query (a prefix of `blogSearch`). */
  allBlogSearches: () => ['search', 'blog'] as const,
  /**
   * E13 the feed's tags for the filter sheet (Story 5.5), an infinite query
   * (the opaque cursors are page params). Its own root: never a prefix of a
   * feed key.
   */
  feedTags: () => ['feedTags'] as const,
  /**
   * E14 a blog's tags for the filter sheet (Story 5.7), one request, no
   * paging. Its own root: never a prefix of `feedTags` or a posts key.
   */
  blogTags: (blogUrl: string) => ['blogTags', blogUrl] as const,
  /** E2 the subscribed authors (Story 3.2), one request, no paging. */
  subscriptions: () => ['subscriptions'] as const,
  /**
   * E1 the account's profile (Story 5.2, `UserRepository.current`: «Мой
   * блог»). Separate from the session's own E1 (validate), which is not a
   * query. Account-scoped like every key (the cache is cleared on sign-out).
   */
  me: () => ['me'] as const,
  /**
   * E3 a blog's header (Story 3.3). `blogUrl` is the blog's identity (AD-9),
   * not a URL. Separate roots for E3 and E4, so one never prefix-matches
   * the other.
   */
  author: (blogUrl: string) => ['author', blogUrl] as const,
  /**
   * E4 a blog's posts (Story 3.3), an infinite query (cursors are page
   * params), one per Filter (Story 5.7: the symbolic Filter as in
   * `subscriptionFeed`; the tags as their sorted ids). The resume refresh
   * rebuilds the request params from the third segment.
   */
  authorPosts: (blogUrl: string, filter: Filter) =>
    [
      'authorPosts',
      blogUrl,
      { access: filter.access, period: filter.period, tagIds: tagIdsKey(filter) },
    ] as const,
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
  /**
   * E15 a blog's active or scheduled live stream (Story 7.1,
   * `entities/stream`), or null for none. `blogUrl` is the blog's identity
   * (AD-9); the cached Stream holds no URL or signed value. Its own root:
   * never a prefix of `author` or `authorPosts`.
   */
  stream: (blogUrl: string) => ['stream', blogUrl] as const,
  /** Every blog's E15 query (a prefix of `stream`): the resume refresh. */
  allStreams: () => ['stream'] as const,
} as const;

/**
 * Server-state freshness (AD-7, ADR 0010): the app client's `staleTime`, and
 * the age at which a resume refreshes the feed head. Here (not in
 * `src/app`) so features can read it.
 */
export const QUERY_STALE_TIME_MS = 60_000;
