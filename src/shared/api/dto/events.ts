import { z } from 'zod';

/**
 * Lenient Zod schemas for E18 `GET /v1/notification/standalone/event/`
 * (Story 7.5, docs/api-contract.md «E18 (LIVE)», live shape in
 * `src/test/fixtures/boosty/e18-events.json`):
 * `{data: {notificationStandalone: {events[], count, updateTime}}}`.
 *
 * The list: a missing `data.notificationStandalone.events` array is a
 * `Parse` error for the whole response. `count` and `updateTime` are not
 * read (no unread badge, no paging: no cursor was ever seen). Items stay
 * `unknown`: each one is parsed by `eventDtoSchema` on its own, so one
 * malformed event is dropped without failing the list.
 */
export const eventsDtoSchema = z.object({
  data: z.object({
    notificationStandalone: z.object({
      events: z.array(z.unknown()),
    }),
  }),
});

export type EventsDto = z.infer<typeof eventsDtoSchema>;

const optionalString = z.string().nullish().catch(undefined);

/**
 * One E18 event. Required, with these types: `id` (a non-empty string or a
 * finite number), `type` (a non-empty string) and `eventTime` (a finite
 * number; the mapper checks the range). A missing one or a wrong type drops
 * the event. Everything else is optional, and a wrong type falls back
 * (`catch`):
 * - `isRead`: anything but a boolean reads as read (no dot);
 * - `author{name, avatarUrl, hasAvatar}`: the row's name and avatar;
 * - `blog{blogUrl}` (documented, not seen live) and `target{bloggerUrl}`
 *   (seen live on `target_new`): the row's blog, validated by the mapper.
 * Never parsed: `aggregation`, target sums and currencies, descriptions.
 */
export const eventDtoSchema = z.object({
  id: z.union([z.string().min(1), z.number().finite()]),
  type: z.string().trim().min(1),
  eventTime: z.number().finite(),
  isRead: z.boolean().nullish().catch(undefined),
  author: z
    .object({
      name: optionalString,
      avatarUrl: optionalString,
      hasAvatar: z.boolean().nullish().catch(undefined),
    })
    .nullish()
    .catch(undefined),
  blog: z.object({ blogUrl: optionalString }).nullish().catch(undefined),
  target: z.object({ bloggerUrl: optionalString }).nullish().catch(undefined),
});

export type EventDto = z.infer<typeof eventDtoSchema>;
