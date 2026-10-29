import { z } from 'zod';
import { feedPageDtoSchema } from './feed';

/**
 * 200 body of E13 `GET /v1/search/feed/tag/` (docs/api-contract.md §3,
 * «E13 (LIVE)»; sanitized shape in
 * `src/test/fixtures/boosty/e13-feed-tags-1.json`):
 * `{data{searchTags[]{tag{id, title}, rank}}, extra{offset, isLast}}`.
 *
 * Items stay `unknown`: each is parsed by `feedTagItemDtoSchema` on its own,
 * so one malformed tag is dropped without failing the page. A missing
 * `data.searchTags` is a `Parse` error for the page. `extra` is the feed's
 * (an opaque `offset` passed back verbatim; a missing one ends the paging).
 * `rank` is not read.
 */
export const feedTagsPageDtoSchema = z.object({
  data: z.object({
    searchTags: z.array(z.unknown()),
  }),
  extra: feedPageDtoSchema.shape.extra,
});

export type FeedTagsPageDto = z.infer<typeof feedTagsPageDtoSchema>;

/**
 * One E13 item: `tag.id` (a number live; a string of digits is accepted too,
 * never one with a comma: `tags_ids` is comma-joined) and a non-blank
 * `tag.title` (trimmed). Anything else drops the item.
 */
export const feedTagItemDtoSchema = z.object({
  tag: z.object({
    id: z.union([z.number().int().nonnegative(), z.string().trim().regex(/^\d+$/)]),
    title: z.string().trim().min(1),
  }),
});

export type FeedTagItemDto = z.infer<typeof feedTagItemDtoSchema>;
