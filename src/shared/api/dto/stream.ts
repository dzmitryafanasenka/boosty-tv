import { z } from 'zod';

/**
 * Lenient Zod schema for the E15 live stream body (Story 7.1,
 * docs/api-contract.md «E15 (LIVE)»). The 200 shape comes from the
 * reference only (no live 200 was ever observed): only the fields the
 * LiveCard reads are parsed; `signedQuery` and `currencyPrices` are not
 * read here (prices are never shown). Story 7.4: `isLiked` is read
 * leniently (`unknown`; the mapper keeps only a literal `true`). The `ok_stream` player URLs
 * are parsed only by the player-only `liveSourcesOf` (Story 7.2,
 * `okStreamSourcesDtoSchema`).
 *
 * - Required, with these types: `id` (a non-empty string or a finite
 *   number), `isOnline` and `hasAccess` (booleans). A missing one or a
 *   wrong type fails the parse: the mapper drops the stream (no card).
 * - Every other field is optional, and a wrong type falls back (`catch`).
 */

const optionalString = z.string().nullish().catch(undefined);
const optionalNumber = z.number().nullish().catch(undefined);
const optionalCount = z.number().int().nonnegative().nullish().catch(undefined);

export const streamDtoSchema = z.object({
  id: z.union([z.string().min(1), z.number().finite()]),
  title: optionalString,
  isOnline: z.boolean(),
  /** A scheduled stream (the reference's `isTemplate`); missing → false. */
  isTemplate: z.boolean().nullish().catch(undefined),
  hasAccess: z.boolean(),
  /** Epoch seconds. */
  startTime: optionalNumber,
  /** Story 7.4: the account liked the stream; anything but `true` reads as not liked. */
  isLiked: z.unknown().optional(),
  /** Content blocks; only an image `url` or a video `preview` is read, for the cover. */
  data: z.array(z.unknown()).nullish().catch(undefined),
  teaser: z.array(z.unknown()).nullish().catch(undefined),
  count: z
    .object({ viewers: optionalCount, likes: optionalCount })
    .nullish()
    .catch(undefined),
  /** Only `name` is read; never a price. */
  subscriptionLevel: z.object({ name: optionalString }).nullish().catch(undefined),
});

export type StreamDto = z.infer<typeof streamDtoSchema>;

/** A block with a possible cover: `{type, url?, preview?, defaultPreview?}`. */
export const streamCoverBlockDtoSchema = z.object({
  type: z.string(),
  url: optionalString,
  preview: optionalString,
  defaultPreview: optionalString,
});

/**
 * Story 7.2: an `ok_stream` block's `playerUrls` (as `okVideoSourcesDtoSchema`
 * in `dto/post.ts`): each entry is parsed on its own (`playerUrlDtoSchema`),
 * so one bad entry never drops the others. Read only by the player-only
 * `liveSourcesOf`; never logged.
 */
export const okStreamSourcesDtoSchema = z.object({
  type: z.literal('ok_stream'),
  playerUrls: z.array(z.unknown()).nullish().catch(undefined),
});
