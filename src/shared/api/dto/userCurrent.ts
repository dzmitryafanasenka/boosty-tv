import { z } from 'zod';

/**
 * 200 body of E1 `GET /v1/user/current` (api-contract §3). Only `id` is
 * required and read (the account id); everything else in this large object,
 * including the many `flags.*` fields, is ignored and never logged.
 */
export const userCurrentSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
});

export type UserCurrentDto = z.infer<typeof userCurrentSchema>;
