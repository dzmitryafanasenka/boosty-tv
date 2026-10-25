import { z } from 'zod';

/**
 * 200 body of `POST /auth/phone/verification_code/send` (api-contract §2.2,
 * `LIVE` Story 1.3): `data.phoneCode{code, expiresIn, phone, sentTransport}`.
 * Only `code` (the challenge) is required; an odd optional field is dropped,
 * never a reason to fail a sent code. `phone` is not read. `expiresIn` units
 * are unverified.
 */
export const sendCodeResponseSchema = z.object({
  data: z.object({
    phoneCode: z.object({
      code: z.string().min(1),
      sentTransport: z.string().optional().catch(undefined),
      expiresIn: z.number().optional().catch(undefined),
    }),
  }),
});

export type SendCodeResponseDto = z.infer<typeof sendCodeResponseSchema>;
