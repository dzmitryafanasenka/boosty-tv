import { z } from 'zod';

/**
 * Lenient Zod schemas for E19 `GET /v1/blog/{blogUrl}/post/{postId}/comment/`
 * (Story 11.1, docs/api-contract.md «E19 (LIVE)», sanitized shape in
 * `src/test/fixtures/boosty/e19-comments-1.json`):
 * `{data: Comment[], extra: {isFirst, isLast}}`. Read-only: no comment
 * mutation schema exists.
 *
 * The page: a missing `data` array is a `Parse` error for the whole
 * response. `extra` has no cursor (live): the next cursor is the smallest
 * `intId` of the page, computed by the repository. Items stay `unknown`:
 * each one is parsed by `commentDtoSchema` on its own, so one malformed
 * comment is dropped without failing the page.
 */
const pageExtraSchema = z
  .object({
    isFirst: z.boolean().nullish().catch(undefined),
    isLast: z.boolean().nullish().catch(undefined),
  })
  .nullish()
  .catch(undefined);

export const commentsPageDtoSchema = z.object({
  data: z.array(z.unknown()),
  extra: pageExtraSchema,
});

export type CommentsPageDto = z.infer<typeof commentsPageDtoSchema>;

const optionalString = z.string().nullish().catch(undefined);

/** `author` and `replyToUser` (live: `{id, name, avatarUrl, hasAvatar, isOfficial}`); `id` and `isOfficial` are not read. */
const commentUserDtoSchema = z.object({
  name: z.string(),
  avatarUrl: optionalString,
  hasAvatar: z.boolean().nullish().catch(undefined),
});

/**
 * One E19 comment or reply (live keys, Story 11.1). Required, with these
 * types: `id` (a non-empty string: the identity), `intId` (a finite
 * integer: the paging cursor and the replies' `parent_id`), `author.name`
 * (a string) and `createdAt` (a finite number, epoch seconds). A missing one
 * or a wrong type drops the comment. Everything else is optional, and a
 * wrong type falls back (`catch`):
 * - `data`: the content blocks (the post block shape), mapped by the shared
 *   post block mapper;
 * - `replyCount`: the number of replies;
 * - `replies{data[], extra{isFirst, isLast}}`: the inline replies (up to
 *   `reply_limit`), each parsed on its own;
 * - `replyToUser.name`: on a reply, the user it answers;
 * - `isDeleted`, `isBlocked` (Story 11.2): booleans seen live, only ever
 *   `false`; a `true` hides the content in the row. Missing or a wrong
 *   type: false.
 * Never parsed: `reactions`, `reactionCounters` (no comment likes),
 * `isUpdated`, `post`, `parentId`, `replyId`, ids and `isOfficial` of the
 * users.
 */
export const commentDtoSchema = z.object({
  id: z.string().min(1),
  intId: z.number().int().finite(),
  author: commentUserDtoSchema,
  createdAt: z.number().finite(),
  data: z.array(z.unknown()).nullish().catch(undefined),
  replyCount: z.number().int().nonnegative().nullish().catch(undefined),
  replies: z
    .object({
      data: z.array(z.unknown()).nullish().catch(undefined),
      extra: pageExtraSchema,
    })
    .nullish()
    .catch(undefined),
  replyToUser: commentUserDtoSchema.nullish().catch(undefined),
  isDeleted: z.boolean().nullish().catch(undefined),
  isBlocked: z.boolean().nullish().catch(undefined),
});

export type CommentDto = z.infer<typeof commentDtoSchema>;

/** Only the `intId` of a raw item: the cursor also advances past a dropped comment. */
export const commentIntIdDtoSchema = z.object({ intId: z.number().int().finite() });
