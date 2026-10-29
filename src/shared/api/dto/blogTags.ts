import { z } from 'zod';
import { feedTagItemDtoSchema } from './feedTags';

/**
 * 200 body of E14 `GET /v1/blog/{blogUrl}/post/tag/` (docs/api-contract.md
 * §3, «E14 (LIVE)»; sanitized shape in
 * `src/test/fixtures/boosty/e14-blog-tags.json`): `{data[]{id, title}}`, one
 * page, no cursor (the reference's `RemoteBlogTagResponse`).
 *
 * Items stay `unknown`: each is parsed by `blogTagItemDtoSchema` on its own,
 * so one malformed tag is dropped without failing the list. A missing
 * `data` array is a `Parse` error.
 */
export const blogTagsDtoSchema = z.object({
  data: z.array(z.unknown()),
});

export type BlogTagsDto = z.infer<typeof blogTagsDtoSchema>;

/**
 * One E14 item: the E13 `tag` rules (`id` a non-negative integer or a string
 * of digits, never one with a comma; a non-blank `title`, trimmed).
 * Anything else drops the item.
 */
export const blogTagItemDtoSchema = feedTagItemDtoSchema.shape.tag;

export type BlogTagItemDto = z.infer<typeof blogTagItemDtoSchema>;
