import { commentDtoSchema, commentIntIdDtoSchema } from '../../api/dto/comments';
import { logger as appLogger, type Logger } from '../../services/logger';
import { safeHttpUrl } from '../externalUrls';
import { mapBlocks } from '../post';
import type { Comment } from './types';

/**
 * The one Comment mapper (Story 11.1): the raw E19 items → comments, in
 * server order. Pure and total: nothing here throws.
 *
 * - A malformed comment or reply (no `id`, `intId`, `author.name` or
 *   `createdAt`) is dropped on its own: one warning with the count only.
 * - Content goes through the shared post block mapper (`mapBlocks`): an
 *   unknown block becomes `{type: 'unknown'}` and the comment is kept.
 * - Inline replies are mapped the same way, one level only (a reply carries
 *   no replies).
 * - A repeated id keeps its first occurrence.
 * Never logs a text, a name, a URL, an id or a date.
 */

type Counter = { dropped: number };

function mapOne(raw: unknown, depth: number, counter: Counter): Comment | null {
  const parsed = commentDtoSchema.safeParse(raw);
  if (!parsed.success) {
    counter.dropped += 1;
    return null;
  }
  const dto = parsed.data;
  const replies = depth === 0 ? mapList(dto.replies?.data ?? [], depth + 1, counter) : [];
  const replyCount = Math.max(dto.replyCount ?? 0, replies.length);
  const isLast = dto.replies?.extra?.isLast;
  // Live: `replies.extra.isLast` is false when more replies exist; without
  // it, the count decides.
  const hasMoreReplies =
    depth === 0 && (isLast === false || (isLast !== true && replyCount > replies.length));
  return {
    id: dto.id,
    intId: dto.intId,
    author: {
      name: dto.author.name,
      avatarUrl: dto.author.hasAvatar === false ? null : safeHttpUrl(dto.author.avatarUrl),
    },
    replyTo: dto.replyToUser ? { name: dto.replyToUser.name } : null,
    blocks: mapBlocks(dto.data),
    hidden: dto.isDeleted === true ? 'deleted' : dto.isBlocked === true ? 'blocked' : null,
    createdAt: dto.createdAt,
    replyCount,
    replies,
    hasMoreReplies,
  };
}

function mapList(items: readonly unknown[], depth: number, counter: Counter): Comment[] {
  const seen = new Set<string>();
  const out: Comment[] = [];
  for (const raw of items) {
    const comment = mapOne(raw, depth, counter);
    if (comment !== null && !seen.has(comment.id)) {
      seen.add(comment.id);
      out.push(comment);
    }
  }
  return out;
}

/**
 * `depth` 0: top-level comments (with inline replies); 1: a replies page
 * (`parent_id`), whose items carry no replies.
 */
export function mapComments(items: readonly unknown[], depth: 0 | 1 = 0, logger: Logger = appLogger): Comment[] {
  const counter: Counter = { dropped: 0 };
  const comments = mapList(items, depth, counter);
  if (counter.dropped > 0) {
    logger.warn('comment', 'dropped', { count: counter.dropped });
  }
  return comments;
}

/** The smallest `intId` of the raw items (a dropped one included), or null when none has one. */
export function smallestIntId(items: readonly unknown[]): number | null {
  let min: number | null = null;
  for (const raw of items) {
    const parsed = commentIntIdDtoSchema.safeParse(raw);
    if (parsed.success && (min === null || parsed.data.intId < min)) {
      min = parsed.data.intId;
    }
  }
  return min;
}

/**
 * The loaded comment pages, given in load order (newest page first, as an
 * infinite query holds them), as one list oldest page first: each older page
 * is placed before the loaded ones (live, api-contract «E19 (LIVE)»). Each
 * page keeps its server order; a repeated id keeps its first occurrence in
 * the result order.
 */
export function mergeCommentPages(pagesInLoadOrder: ReadonlyArray<{ readonly comments: readonly Comment[] }>): Comment[] {
  return mergeComments(...[...pagesInLoadOrder].reverse().map(page => page.comments));
}

/** Concatenate in the given order, then dedupe by `comment.id`, keeping the first occurrence. */
export function mergeComments(...lists: ReadonlyArray<readonly Comment[]>): Comment[] {
  const seen = new Set<string>();
  const out: Comment[] = [];
  for (const list of lists) {
    for (const comment of list) {
      if (!seen.has(comment.id)) {
        seen.add(comment.id);
        out.push(comment);
      }
    }
  }
  return out;
}
