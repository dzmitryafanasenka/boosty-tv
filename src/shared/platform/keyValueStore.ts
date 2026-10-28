/**
 * The `KeyValueStore` port (Story 4.2): non-secret local data (playback
 * progress, later preferences). Never tokens, the phone, a signed URL or
 * anything secret: those live in `SecureStore` (Android Keystore).
 *
 * Two scopes, each its own database, so one can be wiped on its own:
 * - `device`: survives sign-out (the quality preference, Story 4.3);
 * - `account`: belongs to the signed-in account; its owners clear it through
 *   AccountScope (AD-4) on sign-out and on an account switch.
 *
 * The Android adapter is `./asyncKeyValueStore` (async-storage 3.1.1,
 * pinned); tests use an in-memory one.
 */

export type KeyValueScope = 'device' | 'account';

export type KeyValueStore = {
  /** The stored string, or null. Rejects when the store cannot be read. */
  get(key: string): Promise<string | null>;
  /** Rejects when the value is not stored. */
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Wipes every key of this scope. */
  clear(): Promise<void>;
};
