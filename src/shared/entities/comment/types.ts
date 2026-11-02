import type { AppError } from '../../api/appError';
import type { Block } from '../post/types';

/**
 * The Comment entity (Story 11.1, COMM-01, api-contract «E19 (LIVE)»):
 * read-only. Portable domain types, no raw DTO fields. Identity is
 * `comment.id`, never an index. Comment text, names and avatars are
 * personal data: never logged or persisted (the query cache is
 * account-scoped and cleared on sign-out and account switch).
 */

export type CommentAuthor = {
  /** The name as the API gives it (possibly empty). */
  name: string;
  /** An http(s) avatar; null when none (or `hasAvatar: false`). */
  avatarUrl: string | null;
};

export type Comment = {
  /** The comment's id (a string): its identity for keys, merge and focus. */
  id: string;
  /**
   * The API's numeric id: the paging cursor (`offset`) and the replies'
   * `parent_id`. Never an identity for keys or focus.
   */
  intId: number;
  author: CommentAuthor;
  /** On a reply: the user it answers (live `replyToUser`); null otherwise. */
  replyTo: { name: string } | null;
  /** The content through the shared post block mapper (unknown blocks are `{type: 'unknown'}`). */
  blocks: Block[];
  /** Epoch seconds. */
  createdAt: number;
  /** The number of replies the API reports (never below the inline replies). */
  replyCount: number;
  /** The inline replies (up to `reply_limit`), in server order; always empty on a reply. */
  replies: Comment[];
  /** More replies than the inline ones exist (load them with `CommentRepository.replies`). */
  hasMoreReplies: boolean;
};

export type CommentPage = {
  /** In server order (live: `intId` ascending, oldest to newest within the page). */
  comments: Comment[];
  /**
   * The next (older) page's cursor: the smallest `intId` of this page, as a
   * string; null on the last page (`extra.isLast`, or no `extra`).
   */
  nextCursor: string | null;
};

/**
 * One E19 page's outcome. `denied`: HTTP 403 (live: a locked post), never a
 * session expiry. `notFound`: HTTP 404. `error`: every other failure as its
 * `AppError` (`Parse` for a shape change, `Network` after the shared GET
 * retries, …).
 */
export type CommentPageResult =
  | { kind: 'ok'; page: CommentPage }
  | { kind: 'denied' }
  | { kind: 'notFound' }
  | { kind: 'error'; error: AppError };
