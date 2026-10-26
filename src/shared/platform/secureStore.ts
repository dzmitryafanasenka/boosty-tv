import { NativeModules } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { STORAGE_TYPE } from 'react-native-keychain';
import { logger as appLogger, type Logger } from '../services/logger';

/**
 * `SecureStore` port over react-native-keychain 10.0.0 (pinned,
 * `KeystoreAESGCM_NoAuth`, Android Keystore) with the ADR 0006 recovery.
 * One store per keychain service; each holds one string value.
 *
 * Error classification (ADR 0006):
 * - storage unreadable (androidx `CorruptionException`): the native helper
 *   deletes the DataStore file, then reset → `wiped` («Войдите снова»);
 * - value undecryptable (`CryptoFailedException`,
 *   `KeyPermanentlyInvalidatedException`): reset → `wiped`;
 * - anything else: the data is kept; a read is retried once, then reported
 *   as `unavailable` (recoverable, never a sign-out).
 *
 * File-level recovery deletes the whole shared DataStore file, so it wipes
 * every service of this library. Only data that may be lost together
 * (session tokens, the stored phone) lives here.
 *
 * Logs only result kinds and an error label (rejection code + known class
 * name); never a value or a native message.
 */

/** The subset of react-native-keychain this adapter uses (a test seam). */
export type KeychainLike = {
  getGenericPassword(options: {
    service: string;
  }): Promise<false | { password: string }>;
  setGenericPassword(
    username: string,
    password: string,
    options: { service: string; storage?: STORAGE_TYPE },
  ): Promise<false | { storage: string }>;
  resetGenericPassword(options: { service: string }): Promise<boolean>;
};

export type StorageResetHelper = {
  /** Resolves true when the keychain DataStore file no longer exists. */
  deleteKeychainStorage(): Promise<boolean>;
};

export type StoreErrorKind =
  | 'storage-unreadable'
  | 'value-undecryptable'
  | 'other';

export type ReadResult =
  | { kind: 'value'; value: string }
  | { kind: 'empty' }
  /** The store was unusable and has been reset; nothing is stored now. */
  | { kind: 'wiped'; cause: Exclude<StoreErrorKind, 'other'> }
  /**
   * A transient error after one retry (the stored data is kept), or an
   * unusable store that could not be recovered.
   */
  | { kind: 'unavailable' };

/** A failed write or clear. The message is the kind only. */
export class SecureStoreError extends Error {
  readonly kind: StoreErrorKind | 'returned-false';

  constructor(kind: StoreErrorKind | 'returned-false') {
    super(kind);
    this.name = 'SecureStoreError';
    this.kind = kind;
  }
}

export type SecureStore = {
  read(): Promise<ReadResult>;
  /** Rejects with `SecureStoreError` when the value is not stored. */
  write(value: string): Promise<void>;
  /** Removes the value. Rejects with `SecureStoreError` on failure. */
  clear(): Promise<void>;
};

const CORRUPTION = /CorruptionException/;
const UNDECRYPTABLE =
  /CryptoFailedException|KeyPermanentlyInvalidatedException/;
const KNOWN_CLASS =
  /CorruptionException|CryptoFailedException|KeyPermanentlyInvalidatedException|KeyStoreAccessException/;

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function errorHaystack(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; message?: unknown; code?: unknown };
    return [e.name, e.code, e.message]
      .filter(part => typeof part === 'string')
      .join(' ');
  }
  return typeof error === 'string' ? error : '';
}

export function classifyStoreError(error: unknown): StoreErrorKind {
  const haystack = errorHaystack(error);
  if (CORRUPTION.test(haystack)) {
    return 'storage-unreadable';
  }
  if (errorCode(error) === 'E_CRYPTO_FAILED' || UNDECRYPTABLE.test(haystack)) {
    return 'value-undecryptable';
  }
  return 'other';
}

/**
 * A short label for logs: the rejection code plus a known exception class
 * name. Never the free-form message, so no stored data can leak.
 */
export function errorLabel(error: unknown): string {
  const known = errorHaystack(error).match(KNOWN_CLASS)?.[0];
  const name =
    error instanceof Error && error.name !== 'Error' ? error.name : undefined;
  return `${errorCode(error) ?? 'no-code'} ${known ?? name ?? 'Error'}`;
}

export type SecureStoreDeps = {
  service: string;
  keychain: KeychainLike;
  helper: StorageResetHelper;
  logger?: Logger;
};

/** The username slot is unused; the value lives in the password slot. */
const USERNAME = 'boostytv';

export function createSecureStore({
  service,
  keychain,
  helper,
  logger = appLogger,
}: SecureStoreDeps): SecureStore {
  const options = { service };
  const log = (message: string, fields?: Record<string, string | boolean>) =>
    logger.info('secureStore', message, { service, ...fields });

  async function safeReset(): Promise<boolean> {
    try {
      await keychain.resetGenericPassword(options);
      return true;
    } catch (error) {
      log('reset failed', { error: errorLabel(error) });
      return false;
    }
  }

  /**
   * ADR 0006 recovery for a store that cannot be used as it is. Resolves
   * false when nothing worked (no file deleted and the reset failed): the
   * unusable data may still be there.
   */
  async function recover(kind: Exclude<StoreErrorKind, 'other'>): Promise<boolean> {
    let fileDeleted = false;
    if (kind === 'storage-unreadable') {
      try {
        fileDeleted = await helper.deleteKeychainStorage();
      } catch (error) {
        log('storage helper failed', { error: errorLabel(error) });
      }
      log('storage file deleted', { fileDeleted });
    }
    const resetOk = await safeReset();
    const recovered = fileDeleted || resetOk;
    log('recovered', { cause: kind, resetOk, recovered });
    return recovered;
  }

  async function readOnce(): Promise<
    { ok: true; result: ReadResult } | { ok: false; error: unknown }
  > {
    try {
      const credentials = await keychain.getGenericPassword(options);
      if (!credentials) {
        return { ok: true, result: { kind: 'empty' } };
      }
      return { ok: true, result: { kind: 'value', value: credentials.password } };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async function read(): Promise<ReadResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await readOnce();
      if (outcome.ok) {
        log(`read: ${outcome.result.kind}`);
        return outcome.result;
      }
      const kind = classifyStoreError(outcome.error);
      log('read error', { kind, error: errorLabel(outcome.error) });
      if (kind !== 'other') {
        // Not recovered: report a recoverable error, never «Войдите снова»
        // over a store that still cannot save.
        return (await recover(kind))
          ? { kind: 'wiped', cause: kind }
          : { kind: 'unavailable' };
      }
      // `other`: keep the data; one retry, then report it as recoverable.
    }
    return { kind: 'unavailable' };
  }

  async function trySave(value: string): Promise<unknown | null> {
    try {
      const result = await keychain.setGenericPassword(USERNAME, value, {
        service,
        storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
      });
      return result ? null : new SecureStoreError('returned-false');
    } catch (error) {
      return error ?? new SecureStoreError('other');
    }
  }

  async function write(value: string): Promise<void> {
    const first = await trySave(value);
    if (first === null) {
      log('saved');
      return;
    }
    if (first instanceof SecureStoreError) {
      log('save failed', { kind: first.kind });
      throw first;
    }
    const kind = classifyStoreError(first);
    log('save error', { kind, error: errorLabel(first) });
    if (kind === 'other') {
      throw new SecureStoreError(kind);
    }
    // The storage or the old value is unusable: recover once, retry once.
    await recover(kind);
    const second = await trySave(value);
    if (second === null) {
      log('saved after recovery');
      return;
    }
    const secondKind =
      second instanceof SecureStoreError ? second.kind : classifyStoreError(second);
    log('save after recovery failed', { kind: secondKind });
    throw new SecureStoreError(secondKind);
  }

  async function clear(): Promise<void> {
    try {
      await keychain.resetGenericPassword(options);
      log('cleared');
    } catch (error) {
      const kind = classifyStoreError(error);
      log('clear error', { kind, error: errorLabel(error) });
      if (kind === 'other') {
        throw new SecureStoreError(kind);
      }
      if (!(await recover(kind))) {
        throw new SecureStoreError(kind);
      }
    }
  }

  return { read, write, clear };
}

type KeychainStorageResetNative = { deleteKeychainStorage(): Promise<boolean> };

/** The app-local native helper (android/.../KeychainStorageResetModule.kt). */
export const keychainStorageReset: StorageResetHelper = {
  deleteKeychainStorage() {
    const native = (
      NativeModules as { KeychainStorageReset?: KeychainStorageResetNative }
    ).KeychainStorageReset;
    if (!native) {
      return Promise.reject(new Error('KeychainStorageReset not linked'));
    }
    return native.deleteKeychainStorage();
  },
};

/** Keychain services (not the Story 1.3 spike's names). */
export const SESSION_SERVICE = 'boostytv.session';
export const PHONE_SERVICE = 'boostytv.phone';

/** Session tokens and account id. Read and written only by SessionManager. */
export const sessionSecureStore: SecureStore = createSecureStore({
  service: SESSION_SERVICE,
  keychain: Keychain,
  helper: keychainStorageReset,
});

/** The signed-in phone (E.164), for re-login prefill. SessionManager only. */
export const phoneSecureStore: SecureStore = createSecureStore({
  service: PHONE_SERVICE,
  keychain: Keychain,
  helper: keychainStorageReset,
});
