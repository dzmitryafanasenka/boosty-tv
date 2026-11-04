import { z } from 'zod';
import { blogUrlSchema } from './subscriptions';

/**
 * 200 body of E1 `GET /v1/user/current` (api-contract §3). Only `id` is
 * required (the account id). `blogUrl` (Story 5.2, «Мой блог») is the
 * account's own blog: optional, and a missing, blank or unsafe value (one
 * that fails `blogUrlSchema`) is absent, never a parse failure, so the
 * session check never fails on it. `name` (Story 15.2, the account's
 * display name for Настройки, IMP-10) is optional too: a missing or
 * non-string value is absent, never a parse failure; `UserRepository`
 * trims it and drops blank or phone-like values. The session's own E1
 * reads only `id`. Everything else in this large object,
 * including the many `flags.*` fields, is ignored and never logged.
 */
export const userCurrentSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
  blogUrl: blogUrlSchema.optional().catch(undefined),
  name: z.string().optional().catch(undefined),
});

export type UserCurrentDto = z.infer<typeof userCurrentSchema>;
