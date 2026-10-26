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
} as const;

/**
 * Server-state freshness (AD-7, ADR 0010): the app client's `staleTime`, and
 * the age at which a resume refreshes the feed head. Here (not in
 * `src/app`) so features can read it.
 */
export const QUERY_STALE_TIME_MS = 60_000;
