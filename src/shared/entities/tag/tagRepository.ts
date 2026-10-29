import { feedTagItemDtoSchema, feedTagsPageDtoSchema } from '../../api/dto/feedTags';
import type { HttpClient } from '../../api/httpClient';
import { logger as appLogger, type Logger } from '../../services/logger';
import type { Tag, TagPage } from './types';

/**
 * TagRepository (AD-1, AD-8, Story 5.5): the only caller of the tag
 * endpoints. The HttpClient is the active session's, passed in by the caller
 * (never a singleton; Epic 2 retro, items 1–2). Blog tags (E14) come with
 * Story 5.7.
 */

/** E13 page size (api-contract §3, the reference's `limit`). */
export const FEED_TAGS_PAGE_SIZE = 100;

/** E13 path; the opaque cursor goes back verbatim, URL-encoded (api-contract §5). */
export function feedTagsPath(cursor: string | null): string {
  const base = `/v1/search/feed/tag/?limit=${FEED_TAGS_PAGE_SIZE}`;
  return cursor === null ? base : `${base}&offset=${encodeURIComponent(cursor)}`;
}

/** Append, then dedupe by `tag.id`, keeping the first occurrence. */
export function mergeTags(...lists: ReadonlyArray<readonly Tag[]>): Tag[] {
  const seen = new Set<string>();
  const out: Tag[] = [];
  for (const list of lists) {
    for (const tag of list) {
      if (!seen.has(tag.id)) {
        seen.add(tag.id);
        out.push(tag);
      }
    }
  }
  return out;
}

/**
 * One E13 page (Story 5.5). Rejects with `AppError` (from HttpClient;
 * `Parse` when the page shape is wrong). A malformed tag is dropped and
 * counted in the log (no id or title is logged); the page never fails for
 * one tag. Paging stops on `isLast` or a missing `extra`/`offset`.
 */
async function feedTagsPage(
  http: HttpClient,
  cursor: string | null,
  logger: Logger = appLogger,
): Promise<TagPage> {
  const { body } = await http.get(feedTagsPath(cursor), feedTagsPageDtoSchema);
  const tags: Tag[] = [];
  let dropped = 0;
  for (const raw of body.data.searchTags) {
    const item = feedTagItemDtoSchema.safeParse(raw);
    if (item.success) {
      tags.push({ id: String(item.data.tag.id), title: item.data.tag.title });
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    logger.warn('tags', 'dropped', { count: dropped });
  }
  const offset = body.extra?.offset;
  const nextCursor = body.extra && body.extra.isLast !== true && offset ? offset : null;
  return { tags: mergeTags(tags), nextCursor };
}

export const TagRepository = { feedTagsPage } as const;
