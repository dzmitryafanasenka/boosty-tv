import { z } from 'zod';

/**
 * 200 body of E2 `GET /v1/user/subscriptions?limit=30&with_follow=true`
 * (docs/api-contract.md §3, live shape in
 * `src/test/fixtures/boosty/e2-subscriptions.json`):
 * `{offset, limit, total, data[]}`.
 *
 * Items stay `unknown`: each one is parsed by `subscriptionDtoSchema` on its
 * own, so one malformed item is dropped without failing the list. A missing
 * `data` is a `Parse` error for the whole response. `total` is optional (a
 * wrong type falls back); `offset` and `limit` are not read (no paging).
 * `total` is not the item count: the live account returned `total` 5 with
 * 3 items (api-contract §3, meaning unverified).
 */
export const subscriptionsDtoSchema = z.object({
  total: z.number().int().nonnegative().nullish().catch(undefined),
  data: z.array(z.unknown()),
});

export type SubscriptionsDto = z.infer<typeof subscriptionsDtoSchema>;

const optionalString = z.string().nullish().catch(undefined);

/**
 * A `blogUrl` that is safe as a focus id, a query key and (Story 3.3) a path
 * segment: trimmed, non-empty, without whitespace, `/`, `?`, `#`, `%` or
 * `..`. Anything else drops the item (logged).
 */
export const blogUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(value => !/[\s/?#%]/.test(value) && !value.includes('..'), {
    message: 'unsafe blogUrl',
  });

/**
 * A blog as the API describes it (E2 `data[].blog`; E3 has the same
 * `title`, `blogUrl`, `owner{name, avatarUrl}`). Required: `blogUrl` (route
 * and key, AD-9). A missing or blank `title` keeps the blog (the card shows
 * the «Без названия» fallback). The owner is optional. Never parsed: prices,
 * currencies, the subscription level and its payment fields, flags, cover.
 */
export const blogDtoSchema = z.object({
  title: optionalString,
  blogUrl: blogUrlSchema,
  owner: z
    .object({
      name: optionalString,
      avatarUrl: optionalString,
      hasAvatar: z.boolean().nullish().catch(undefined),
    })
    .nullish()
    .catch(undefined),
});

export type BlogDto = z.infer<typeof blogDtoSchema>;

/** One E2 item: only `blog` is read (the subscription's money fields are not). */
export const subscriptionDtoSchema = z.object({
  blog: blogDtoSchema,
});

export type SubscriptionDto = z.infer<typeof subscriptionDtoSchema>;
