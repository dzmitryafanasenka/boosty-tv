import { z } from 'zod';
import { blogUrlSchema } from './subscriptions';

/**
 * Lenient Zod schemas for the Boosty `Post` object and its content blocks
 * (docs/api-contract.md §4, §4.1). One schema per DTO (AD-8); only
 * `shared/entities/post` maps them.
 *
 * - A post is parsed on its own (`postDtoSchema.safeParse`), so one bad post
 *   never fails its page. Required, as in the reference: `id`, `createdAt`,
 *   `int_id` and `user.name`; also `user.blogUrl`, because a post is routed
 *   and keyed by `{blogUrl, postId}` (AD-9): it must pass `blogUrlSchema`
 *   (safe as a path segment, a focus id and a key; Story 3.4 routes it).
 * - Every other field is optional, and a wrong type falls back (`catch`)
 *   instead of dropping the post.
 * - Blocks stay `unknown` here: each block is parsed by its own schema in
 *   the mapper, and an unknown `type` becomes `Block.Unknown`.
 * - Of `count`, only `likes` is read (Story 3.4, the read-only like count);
 *   a missing or invalid value is no like line.
 * - Never parsed into the post: `signedQuery` (Story 6.3 reads it beside
 *   the mapper for a file's QR, Story 6.4 for an audio source,
 *   `signedQueryDtoSchema`), `playerUrls`, `timeCode`,
 *   `comments`, `count.comments`, reactions, prices. They are not part of
 *   the domain (AD-9; comments are excluded). `playerUrls` (Story 4.1) and
 *   `timeCode` (Story 4.2) have their own schemas below, read beside the
 *   mapper for the player and the ProgressRepository only.
 */

const optionalString = z.string().nullish().catch(undefined);
const optionalNumber = z.number().nullish().catch(undefined);

export const postUserDtoSchema = z.object({
  name: z.string().min(1),
  blogUrl: blogUrlSchema,
  avatarUrl: optionalString,
});

export const postDtoSchema = z.object({
  id: z.string().min(1),
  int_id: z.number().int(),
  createdAt: z.number(),
  publishTime: optionalNumber,
  title: optionalString,
  /** Missing: true (reference default). */
  hasAccess: z.boolean().nullish().catch(undefined),
  user: postUserDtoSchema,
  data: z.array(z.unknown()).nullish().catch(undefined),
  teaser: z.array(z.unknown()).nullish().catch(undefined),
  /** Only `likes` (a non-negative integer); anything else is ignored. */
  count: z
    .object({ likes: z.number().int().nonnegative().nullish().catch(undefined) })
    .nullish()
    .catch(undefined),
  /** E4: the author's pinned post comes first (Boosty's order); a wrong type → not pinned. */
  isPinned: z.boolean().nullish().catch(undefined),
  /**
   * Story 6.5: the post's poll (live: top-level, never a `poll` block;
   * api-contract §4.2 «Polls (LIVE)»). Kept `unknown` here: `pollDtoSchema`
   * parses it in `entities/poll`, so a malformed poll never drops the post.
   */
  poll: z.unknown().optional(),
  /** Present only as a key in live posts; only `name` is read. */
  subscriptionLevel: z
    .object({ name: optionalString })
    .nullish()
    .catch(undefined),
});

export type PostDto = z.infer<typeof postDtoSchema>;

/** Any block: only the `type` discriminator is required. */
export const blockTypeDtoSchema = z.object({ type: z.string() });

/** `text`: `content` is a JSON string `[text, style, ranges]` or raw text. */
export const textBlockDtoSchema = z.object({
  type: z.literal('text'),
  content: optionalString,
  modificator: optionalString,
});

export const linkBlockDtoSchema = z.object({
  type: z.literal('link'),
  content: optionalString,
  url: optionalString,
});

/**
 * `smile` (Story 6.1): an inline emoji. Only the name and the image URLs are
 * read; every field is optional (a wrong type falls back).
 */
export const smileBlockDtoSchema = z.object({
  type: z.literal('smile'),
  name: optionalString,
  smallUrl: optionalString,
  mediumUrl: optionalString,
  largeUrl: optionalString,
});

export const imageBlockDtoSchema = z.object({
  type: z.literal('image'),
  id: optionalString,
  url: optionalString,
  width: optionalNumber,
  height: optionalNumber,
});

/** `ok_video`: `id` is the media identity (AD-9). No URLs, no `timeCode`. */
export const okVideoBlockDtoSchema = z.object({
  type: z.literal('ok_video'),
  id: z.string().min(1),
  title: optionalString,
  /** Seconds (api-contract §3 «Live evidence (Story 1.5)»). */
  duration: optionalNumber,
  preview: optionalString,
  defaultPreview: optionalString,
});

export const audioBlockDtoSchema = z.object({
  type: z.literal('audio_file'),
  id: optionalString,
  title: optionalString,
  duration: optionalNumber,
});

export const fileBlockDtoSchema = z.object({
  type: z.literal('file'),
  id: optionalString,
  title: optionalString,
  size: optionalNumber,
});

/**
 * File-QR-only (Story 6.3): a `file` block's `url` (api-contract §4.1
 * «File and video blocks (LIVE)»). Parsed only by `PostRepository.fileTarget`
 * from a fresh E8 when the QR opens; never part of the Post entity, a query
 * cache, a route, storage or a log (with `Post.signedQuery` it is a personal,
 * signed link).
 */
export const fileUrlDtoSchema = z.object({
  type: z.literal('file'),
  id: optionalString,
  title: optionalString,
  url: optionalString,
});

/**
 * AudioBlock-only (Story 6.4): an `audio_file` block's `url` (api-contract
 * §4.1 «Audio blocks (LIVE)»: a `boosty.to` URL that answers 403 bare and
 * 200 `audio/mpeg` with `signedQuery`). Parsed only by
 * `PostRepository.audioSource` from a fresh E8 when playback starts; never
 * part of the Post entity, a query cache, a route, storage or a log.
 */
export const audioUrlDtoSchema = z.object({
  type: z.literal('audio_file'),
  id: optionalString,
  title: optionalString,
  url: optionalString,
});

/** File-QR and audio only (Stories 6.3, 6.4): the post's `signedQuery`, read beside the mapper. */
export const signedQueryDtoSchema = z.object({ signedQuery: optionalString });

/** `video` (`LIVE`, Story 6.3: keys `type`, `url`): an external video page. */
export const videoBlockDtoSchema = z.object({
  type: z.literal('video'),
  url: optionalString,
});

/**
 * `header` (`LIVE`, Story 6.3: keys `type`, `content`, `modificator`;
 * `content` in the `text` format, `modificator` empty). Not in the reference.
 */
export const headerBlockDtoSchema = z.object({
  type: z.literal('header'),
  content: optionalString,
});

export const pollBlockDtoSchema = z.object({
  type: z.literal('poll'),
  id: z.union([z.number(), z.string()]).nullish().catch(undefined),
});

const pollIdSchema = z.union([z.number().finite(), z.string().min(1)]);

/**
 * Story 6.5: one poll option (api-contract §4.2). `id`, `counter` and
 * `fraction` are required (an option without them is dropped on its own;
 * no valid option left makes the poll the «Опрос» placeholder); `text`
 * falls back to empty. `voters` is never read.
 */
export const pollOptionDtoSchema = z.object({
  id: pollIdSchema,
  text: optionalString,
  counter: z.number(),
  fraction: z.number(),
});

/**
 * Story 6.5: the post's top-level `poll` (api-contract §4.2; live keys
 * `counter`, `defaultLang`, `hasOther`, `id`, `isFinished`, `isMultiple`,
 * `options`, `title`; `answer` only after a vote, as in the reference).
 * Required as in the reference: `id`, `isMultiple`, `isFinished`, a
 * non-empty `options`; options are parsed one by one (a bad one dropped) by
 * `pollOptionDtoSchema` in the mapper. `title` is an array of strings
 * (non-strings dropped), `counter` and `answer` are optional.
 * `defaultLang`, `hasOther` and the options' `voters` are never read.
 */
export const pollDtoSchema = z.object({
  id: pollIdSchema,
  title: z.array(z.unknown()).nullish().catch(undefined),
  isMultiple: z.boolean(),
  isFinished: z.boolean(),
  counter: z.number().nullish().catch(undefined),
  answer: z.array(z.unknown()).nullish().catch(undefined),
  options: z.array(z.unknown()).min(1),
});

/**
 * Story 6.6: the E10 envelope (`GET /v1/blog/{blogUrl}/poll/{pollId}`,
 * api-contract §3: `data.poll`, `REF`; the live shape is verified by the
 * orchestrator's read-only probe, see api-contract §4.2 «Polls (LIVE)»).
 * Lenient: any other key is ignored and `poll` stays `unknown` here, so
 * `mapPoll` (one mapper, the same drop rules as the post's poll) decides.
 * A body without `data.poll` is `Parse`, and the caller falls back to
 * refetching the post (E8).
 */
export const pollRefreshDtoSchema = z.object({
  data: z.object({
    poll: z.unknown(),
  }),
});

/** `list` (`LIVE`, Story 1.5): `items[]{data: ContentBlock[], items[]}`. */
export const listBlockDtoSchema = z.object({
  type: z.literal('list'),
  items: z.array(z.unknown()).nullish().catch(undefined),
});

export const listItemDtoSchema = z.object({
  data: z.array(z.unknown()).nullish().catch(undefined),
  items: z.array(z.unknown()).nullish().catch(undefined),
});

/**
 * Player-only (Story 4.1): an `ok_video` block's signed `playerUrls`
 * (api-contract §6). Parsed only for the player's media resolver from a
 * fresh E8 (`PostRepository.videoSources`); never part of the Post entity,
 * a query key of the post, a route, storage or a log. An entry with a
 * missing or wrong-typed `type`/`url` is skipped by the mapper; a missing or
 * malformed `playerUrls` is no source.
 */
export const okVideoSourcesDtoSchema = z.object({
  type: z.literal('ok_video'),
  id: z.string().min(1),
  /** Each entry is parsed on its own (`playerUrlDtoSchema`): one bad entry never drops the others. */
  playerUrls: z.array(z.unknown()).nullish().catch(undefined),
});

/** One `playerUrls[]` entry; a wrong-typed `type` or `url` makes it unusable, not an error. */
export const playerUrlDtoSchema = z.object({
  type: z.string().catch(''),
  url: z.string().nullish().catch(undefined),
});

/**
 * Story 4.2: an `ok_video` block's saved server progress (`timeCode`,
 * seconds; api-contract §3, §6). Parsed from an E8's raw `data[]` only to
 * hand it to the ProgressRepository through the `onServerProgress` sink
 * (`PostRepository`); never part of the Post entity, a query cache value, a
 * route or a log. A missing or wrong-typed `timeCode` is no value.
 */
export const okVideoTimeCodeDtoSchema = z.object({
  type: z.literal('ok_video'),
  id: z.string().min(1),
  timeCode: z.number().nonnegative().nullish().catch(undefined),
});
