import { z } from 'zod';

/**
 * 200 body of `PUT /auth/phone/verification_code/confirm` (api-contract §2.2,
 * `LIVE` Story 1.3): `{access_token, refresh_token, expires_in}`. Tokens are
 * 64-character opaque strings (not JWTs). `expires_in` is read as seconds
 * (2592000 live) and accepted only when finite, above 300 s and at most 10 years (epic 2
 * "Refresh coordinator"). Both tokens are secrets: never logged.
 */
export const MIN_EXPIRES_IN_S = 300;
/** Upper bound (10 years): a larger value would make `expiresAt` overflow. */
export const MAX_EXPIRES_IN_S = 10 * 365 * 24 * 3600;

export const tokensResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().refine(Number.isFinite).gt(MIN_EXPIRES_IN_S).lte(MAX_EXPIRES_IN_S),
});

export type TokensResponseDto = z.infer<typeof tokensResponseSchema>;
