/**
 * The Author entity (AD-8, AD-9): a blog the user can open. Portable domain
 * type, no raw DTO fields. Identity is `blogUrl`, never an index. Never part
 * of the domain: prices, currencies, subscription levels and payment state.
 */
export type Author = {
  /** Route and key (`subs/tile/<blogUrl>`, `Author {blogUrl}`). */
  blogUrl: string;
  /** The blog title, trimmed; empty when the API has none (the card shows a fallback). */
  title: string;
  /** The owner's name; null when missing or empty (the card shows no line). */
  ownerName: string | null;
  /** Null when missing, empty or `hasAvatar: false` (the card shows a placeholder). */
  avatarUrl: string | null;
};

/** E2: the authors (deduped by `blogUrl`) and the server's `total`, if given. */
export type SubscriptionList = {
  authors: Author[];
  /** Items in the raw response before drops and dedupe (against the E2 limit). */
  received: number;
  /** All subscriptions on the server; null when the response has none. */
  total: number | null;
};

/**
 * E3: the blog's header, or `unavailable` for a missing blog (404
 * `blog_not_found`: «Автор недоступен», no retry).
 */
export type BlogResult = { kind: 'ok'; author: Author } | { kind: 'unavailable' };
