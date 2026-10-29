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

/**
 * 200 body of E4 `GET /v1/blog/{blogUrl}/post/` (docs/api-contract.md §3,
 * live shape in `src/test/fixtures/boosty/e4-blog-posts-1.json`):
 * `{data: Post[], extra{offset, isLast}}`. As E5: posts stay `unknown` (one
 * malformed post is dropped, never the page), a missing `data` is a `Parse`
 * error, and the opaque `extra.offset` is passed back verbatim.
 */
export const blogPostsPageDtoSchema = z.object({
  data: z.array(z.unknown()),
  extra: feedPageDtoSchema.shape.extra,
});

export type BlogPostsPageDto = z.infer<typeof blogPostsPageDtoSchema>;

/**
 * 200 body of E6 `GET /v1/search/feed/post/` (docs/api-contract.md §3
 * «E6 (LIVE)», Story 5.6; sanitized shape in
 * `src/test/fixtures/boosty/e6-feed-search-1.json`):
 * `{data{searchPosts[]{post: Post}}, extra{offset, isLast}}`.
 *
 * Items stay `unknown`: each is read by `feedSearchItemDtoSchema` and its
 * `post` by the one post mapper, so a malformed item is dropped without
 * failing the page. A missing `data.searchPosts` is a `Parse` error for the
 * page. `extra` is the feed's (an opaque `offset` passed back verbatim; a
 * missing one ends the paging).
 */
export const feedSearchPageDtoSchema = z.object({
  data: z.object({
    searchPosts: z.array(z.unknown()),
  }),
  extra: feedPageDtoSchema.shape.extra,
});

export type FeedSearchPageDto = z.infer<typeof feedSearchPageDtoSchema>;

/**
 * One E6 item: an object with a `post` object. Anything else drops the item
 * (the post itself is validated by `postDtoSchema` in the mapper).
 */
export const feedSearchItemDtoSchema = z.object({
  post: z.record(z.string(), z.unknown()),
});

export type FeedSearchItemDto = z.infer<typeof feedSearchItemDtoSchema>;
