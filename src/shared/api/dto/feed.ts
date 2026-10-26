import { z } from 'zod';

/**
 * 200 body of E5 `GET /v1/feed/post/` (docs/api-contract.md §3, §5):
 * `{data{posts[], blogs, counters}, extra{offset, isLast}}`.
 *
 * Posts stay `unknown`: each one is parsed by `postDtoSchema` on its own, so
 * one malformed post is dropped without failing the page. A missing
 * `data.posts` is a `Parse` error for the whole page. `extra.offset` is an
 * opaque cursor, passed back verbatim; a missing or non-string one ends the
 * paging. `blogs` and `counters` are not read.
 */
export const feedPageDtoSchema = z.object({
  data: z.object({
    posts: z.array(z.unknown()),
  }),
  extra: z
    .object({
      offset: z.string().nullish().catch(undefined),
      isLast: z.boolean().nullish().catch(undefined),
    })
    .nullish()
    .catch(undefined),
});

export type FeedPageDto = z.infer<typeof feedPageDtoSchema>;
