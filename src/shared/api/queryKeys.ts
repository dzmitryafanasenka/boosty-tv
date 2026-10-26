/**
 * TanStack Query keys (AD-7): the only place that builds them. The query
 * cache is account-scoped (cleared by AccountScope on sign-out and account
 * switch), so keys carry no account id. Never put a signed value, a URL or
 * a cursor in a key: an infinite query keeps its cursors as page params.
 */
export const queryKeys = {
  /** E5 «Новое в подписках» (Story 3.1), an infinite query. */
  subscriptionFeed: () => ['feed', 'subscriptions'] as const,
} as const;
