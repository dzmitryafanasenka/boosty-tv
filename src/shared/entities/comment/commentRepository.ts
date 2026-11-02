import { AppError, isAppError } from '../../api/appError';
import { commentsPageDtoSchema } from '../../api/dto/comments';
import { blogUrlSchema } from '../../api/dto/subscriptions';
import type { HttpClient } from '../../api/httpClient';
import { logger as appLogger, type Logger } from '../../services/logger';
import { mapComments, smallestIntId } from './mapComments';
import type { CommentPageResult } from './types';

/**
 * CommentRepository (Story 11.1, COMM-01, api-contract «E19 (LIVE)»): the
 * only caller of E19 and the only comment request in the app. Read-only:
 * GET only, no posting, replying, liking or deleting. The HttpClient is the
 * active session's, passed in by the caller (never a singleton). A 401 goes
 * through the HttpClient's single-flight refresh (one refresh, one retry);
 * network failures and 5xx get the shared GET retries.
 */

/** E19 page size (the reference's `limit`, live). */
export const COMMENTS_PAGE_SIZE = 20;
/** Inline replies under each comment (the reference's `reply_limit`, live: up to 2 arrive). */
export const COMMENT_INLINE_REPLY_LIMIT = 2;

/**
 * E19 path. `blogUrl` must pass `blogUrlSchema` and `postId` must be a plain
 * segment (not `.` or `..`); both are encoded as path segments. Anything
 * else throws `AppError('Client')` before a request is sent. `cursor` (the
 * `offset`) and `parentIntId` (`parent_id`, the replies of one comment) are
 * the API's ids: positive safe integers. The parsed (trimmed) `blogUrl` is sent.
 */
export function commentsPath(
  blogUrl: string,
  postId: string,
  cursor: string | null,
  parentIntId: number | null = null,
): string {
  const blog = blogUrlSchema.safeParse(blogUrl);
  if (!blog.success || postId.length === 0 || /^\.{1,2}$/.test(postId)) {
    throw new AppError('Client');
  }
  if ((cursor !== null && cursorValue(cursor) === null) || (parentIntId !== null && !isPositiveId(parentIntId))) {
    throw new AppError('Client');
  }
  const base = `/v1/blog/${encodeURIComponent(blog.data)}/post/${encodeURIComponent(postId)}/comment/?limit=${COMMENTS_PAGE_SIZE}&reply_limit=${COMMENT_INLINE_REPLY_LIMIT}&order=top`;
  const offset = cursor === null ? '' : `&offset=${encodeURIComponent(cursor)}`;
  const parent = parentIntId === null ? '' : `&parent_id=${parentIntId}`;
  return `${base}${offset}${parent}`;
}

const isPositiveId = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/** A cursor's `intId`: a positive safe integer written in digits, else null. */
function cursorValue(cursor: string): number | null {
  const value = /^\d+$/.test(cursor) ? Number(cursor) : NaN;
  return isPositiveId(value) ? value : null;
}

/**
 * The next (older) page's cursor. Live: `extra` has no cursor; the next page
 * starts below the smallest `intId` of this one. More pages only when
 * `extra.isLast` is exactly `false`; a cursor that is not strictly below the
 * one sent (a server ignoring `offset`) ends the paging, so it never loops.
 */
function nextCursorOf(
  items: readonly unknown[],
  isLast: boolean | null | undefined,
  sent: string | null,
  logger: Logger,
): string | null {
  if (isLast !== false) {
    return null;
  }
  const smallest = smallestIntId(items);
  if (smallest === null || !isPositiveId(smallest)) {
    logger.warn('comment', 'no cursor', { count: items.length });
    return null;
  }
  const below = sent === null ? null : cursorValue(sent);
  return below !== null && smallest >= below ? null : String(smallest);
}

async function fetchPage(
  http: HttpClient,
  cursor: string | null,
  path: () => string,
  depth: 0 | 1,
  logger: Logger,
): Promise<CommentPageResult> {
  try {
    const { body } = await http.get(path(), commentsPageDtoSchema);
    const comments = mapComments(body.data, depth, logger);
    const nextCursor = nextCursorOf(body.data, body.extra?.isLast, cursor, logger);
    return { kind: 'ok', page: { comments, nextCursor } };
  } catch (error) {
    if (!isAppError(error)) {
      logger.warn('comment', 'unexpected');
      return { kind: 'error', error: new AppError('Client') };
    }
    // Live: a locked post answers 403. Never a session expiry.
    if (error.status === 403) {
      return { kind: 'denied' };
    }
    if (error.kind === 'NotFound') {
      return { kind: 'notFound' };
    }
    return { kind: 'error', error };
  }
}

/**
 * One E19 page of a post's comments. `cursor` null: the newest page; else
 * the previous page's `nextCursor` (older comments, placed before the
 * loaded ones). Never rejects: every failure is an outcome. A malformed
 * comment is dropped and counted, never the page.
 */
function page(
  http: HttpClient,
  blogUrl: string,
  postId: string,
  cursor: string | null,
  logger: Logger = appLogger,
): Promise<CommentPageResult> {
  return fetchPage(http, cursor, () => commentsPath(blogUrl, postId, cursor), 0, logger);
}

/**
 * One E19 page of one comment's replies (`parent_id` = the comment's
 * `intId`). Live: one page returned all 5 replies of a comment with
 * `isLast: true`; paging past one page is unverified, so its cursor follows
 * the comments' rule. The replies carry no replies of their own.
 */
function replies(
  http: HttpClient,
  blogUrl: string,
  postId: string,
  parentIntId: number,
  cursor: string | null,
  logger: Logger = appLogger,
): Promise<CommentPageResult> {
  return fetchPage(http, cursor, () => commentsPath(blogUrl, postId, cursor, parentIntId), 1, logger);
}

export const CommentRepository = { page, replies } as const;
