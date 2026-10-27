import { z } from 'zod';

/**
 * The stored-session and expiry-marker shapes (ADR 0009, C2). Pure: no
 * state, no store access.
 */

/** The session value in the `boostytv.session` keychain service. */
export const storedSessionSchema = z.object({
  v: z.literal(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Epoch milliseconds, from `expires_in` read as seconds. */
  expiresAt: z.number(),
  /** E1 `id`, as a string. */
  accountId: z.string().min(1),
});

export type StoredSession = z.infer<typeof storedSessionSchema>;

/**
 * The expiry marker that replaces the session on refresh 400
 * `invalid_grant` (Story 2.6): no token, only the account id for the
 * same-account check after a restart.
 */
export const expiryMarkerSchema = z.object({
  v: z.literal(1),
  expired: z.literal(true),
  accountId: z.string().min(1),
});

export type ExpiryMarker = z.infer<typeof expiryMarkerSchema>;

export type Decoded =
  | { kind: 'session'; session: StoredSession }
  | { kind: 'expired'; accountId: string };

/** The stored value, or null when it is neither a session nor a marker. */
export function decodeSession(raw: string): Decoded | null {
  try {
    const value: unknown = JSON.parse(raw);
    const session = storedSessionSchema.safeParse(value);
    if (session.success) {
      return { kind: 'session', session: session.data };
    }
    const marker = expiryMarkerSchema.safeParse(value);
    return marker.success ? { kind: 'expired', accountId: marker.data.accountId } : null;
  } catch {
    return null;
  }
}

/** The stored form of a session or an expiry marker. */
export function encode(value: StoredSession | ExpiryMarker): string {
  return JSON.stringify(value);
}
