/**
 * Story 1.3 spike only (branch spike/1-3-phone-auth). Wraps
 * react-native-keychain with the ADR 0006 error classification and the native
 * storage-reset helper:
 * - storage unreadable (androidx CorruptionException): helper deletes the
 *   DataStore file, reset, «signed-out»;
 * - value undecryptable (CryptoFailedException / key permanently
 *   invalidated): reset, «signed-out»;
 * - anything else: keep the data, report a recoverable error, allow one retry.
 *
 * Logs only result kinds and error class labels, never stored values.
 */

export type KeychainLike = {
  getGenericPassword(options: {
    service: string;
  }): Promise<false | { password: string }>;
  setGenericPassword(
    username: string,
    password: string,
    options: { service: string },
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

export type SignedOutCause = 'storage-unreadable' | 'value-undecryptable';

export type RecoveryReport = {
  /** Native helper ran and the file is gone (file corruption only). */
  fileDeleted?: boolean;
  /** resetGenericPassword resolved without throwing. */
  resetOk: boolean;
};

export type ReadResult =
  | { kind: 'value'; value: string }
  | { kind: 'empty' }
  | {
      kind: 'signed-out';
      cause: SignedOutCause;
      error: string;
      recovery: RecoveryReport;
    }
  | { kind: 'recoverable-error'; error: string; retriesLeft: number };

export type SaveResult =
  | { kind: 'saved'; storage: string; afterRecovery: boolean }
  | {
      kind: 'failed';
      errorKind: StoreErrorKind | 'returned-false';
      error: string;
    };

export type ClearResult =
  | { kind: 'cleared'; recovery?: RecoveryReport }
  | { kind: 'failed'; error: string };

const CORRUPTION = /CorruptionException/;
const UNDECRYPTABLE =
  /CryptoFailedException|KeyPermanentlyInvalidatedException/;

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
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 'E_CRYPTO_FAILED' || UNDECRYPTABLE.test(haystack)) {
    return 'value-undecryptable';
  }
  return 'other';
}

/**
 * A short label for logs: the rejection code plus a known exception class
 * name. Never includes the free-form message, so no stored data can leak.
 */
export function errorLabel(error: unknown): string {
  const haystack = errorHaystack(error);
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  const known = haystack.match(
    /CorruptionException|CryptoFailedException|KeyPermanentlyInvalidatedException|KeyStoreAccessException|SpikeSimulatedError/,
  );
  const name =
    error instanceof Error && error.name !== 'Error' ? error.name : undefined;
  return [
    typeof code === 'string' ? code : 'no-code',
    known?.[0] ?? name ?? 'Error',
  ].join(' ');
}

export type SpikeSecureStore = ReturnType<typeof createSpikeSecureStore>;

export function createSpikeSecureStore({
  service,
  username = 'session',
  keychain,
  helper,
  log = () => {},
}: {
  service: string;
  username?: string;
  keychain: KeychainLike;
  helper: StorageResetHelper;
  log?: (line: string) => void;
}) {
  const options = { service };
  let consecutiveOtherReadErrors = 0;
  let injectedReadError: Error | null = null;

  async function safeReset(): Promise<boolean> {
    try {
      await keychain.resetGenericPassword(options);
      return true;
    } catch (error) {
      log(`reset failed: ${errorLabel(error)}`);
      return false;
    }
  }

  async function recover(kind: SignedOutCause): Promise<RecoveryReport> {
    if (kind === 'value-undecryptable') {
      return { resetOk: await safeReset() };
    }
    let fileDeleted = false;
    try {
      fileDeleted = await helper.deleteKeychainStorage();
    } catch (error) {
      log(`storage helper failed: ${errorLabel(error)}`);
    }
    const resetOk = await safeReset();
    log(`recovered: fileDeleted=${fileDeleted} resetOk=${resetOk}`);
    return { fileDeleted, resetOk };
  }

  async function read(): Promise<ReadResult> {
    try {
      if (injectedReadError) {
        const error = injectedReadError;
        injectedReadError = null;
        throw error;
      }
      const credentials = await keychain.getGenericPassword(options);
      consecutiveOtherReadErrors = 0;
      if (!credentials) {
        log('read: empty');
        return { kind: 'empty' };
      }
      log('read: value present');
      return { kind: 'value', value: credentials.password };
    } catch (error) {
      const kind = classifyStoreError(error);
      const label = errorLabel(error);
      log(`read error: ${kind} (${label})`);
      if (kind === 'other') {
        consecutiveOtherReadErrors += 1;
        return {
          kind: 'recoverable-error',
          error: label,
          retriesLeft: consecutiveOtherReadErrors === 1 ? 1 : 0,
        };
      }
      consecutiveOtherReadErrors = 0;
      const recovery = await recover(kind);
      return { kind: 'signed-out', cause: kind, error: label, recovery };
    }
  }

  async function trySave(
    value: string,
  ): Promise<
    | { ok: true; storage: string }
    | { ok: false; error: unknown; returnedFalse?: boolean }
  > {
    try {
      const result = await keychain.setGenericPassword(
        username,
        value,
        options,
      );
      if (!result) {
        return { ok: false, error: null, returnedFalse: true };
      }
      return { ok: true, storage: result.storage };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async function save(value: string): Promise<SaveResult> {
    const first = await trySave(value);
    if (first.ok) {
      log(`saved: storage=${first.storage}`);
      return { kind: 'saved', storage: first.storage, afterRecovery: false };
    }
    if (first.returnedFalse) {
      log('save: returned false');
      return { kind: 'failed', errorKind: 'returned-false', error: 'false' };
    }
    const kind = classifyStoreError(first.error);
    const label = errorLabel(first.error);
    log(`save error: ${kind} (${label})`);
    if (kind === 'other') {
      return { kind: 'failed', errorKind: kind, error: label };
    }
    // Storage or value is unusable: recover once, then one bounded retry.
    await recover(kind);
    const second = await trySave(value);
    if (second.ok) {
      log(`saved after recovery: storage=${second.storage}`);
      return { kind: 'saved', storage: second.storage, afterRecovery: true };
    }
    const secondLabel = second.returnedFalse
      ? 'false'
      : errorLabel(second.error);
    log(`save after recovery failed: ${secondLabel}`);
    return {
      kind: 'failed',
      errorKind: second.returnedFalse
        ? 'returned-false'
        : classifyStoreError(second.error),
      error: secondLabel,
    };
  }

  async function clear(): Promise<ClearResult> {
    try {
      await keychain.resetGenericPassword(options);
      log('cleared');
      return { kind: 'cleared' };
    } catch (error) {
      const kind = classifyStoreError(error);
      const label = errorLabel(error);
      log(`clear error: ${kind} (${label})`);
      if (kind === 'storage-unreadable') {
        return { kind: 'cleared', recovery: await recover(kind) };
      }
      return { kind: 'failed', error: label };
    }
  }

  /** Spike only: the next read fails with a generic (non-storage) error. */
  function injectNextReadError(error: Error) {
    injectedReadError = error;
  }

  return { read, save, clear, injectNextReadError };
}

export class SpikeSimulatedError extends Error {
  constructor() {
    super('Simulated transient storage error');
    this.name = 'SpikeSimulatedError';
  }
}
