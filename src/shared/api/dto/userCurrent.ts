import { z } from 'zod';
import { blogUrlSchema } from './subscriptions';

/**
 * 200 body of E1 `GET /v1/user/current` (api-contract §3). Only `id` is
 * required (the account id). `blogUrl` (Story 5.2, «Мой блог») is the
 * account's own blog: optional, and a missing, blank or unsafe value (one
 * that fails `blogUrlSchema`) is absent, never a parse failure, so the
 * session check never fails on it. Everything else in this large object,
 * including the many `flags.*` fields, is ignored and never logged.
 */
export const userCurrentSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
  blogUrl: blogUrlSchema.optional().catch(undefined),
});

export type UserCurrentDto = z.infer<typeof userCurrentSchema>;
