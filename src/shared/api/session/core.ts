import type { ReadResult, SecureStore } from '../../platform/secureStore';
import type { Logger } from '../../services/logger';
import { encode, type StoredSession } from './codec';
import type { SessionStatus } from './types';

/**
 * SessionCore (ADR 0009, C4): the only holder of session state (`status`,
 * `session`, `previousAccountId`, `generation`, `signingOut`, the listeners)
 * and the only module that touches a `SecureStore`. Every state change is a
 * named transition; the other session modules call these methods and keep
 * no copy of these values.
 *
 * Every SecureStore write and clear runs in one queue, so a sign-out's clear
 * always lands after a refresh's write that started before it. Reads are not
 * queued.
 *
 * Never logs the phone, tokens or a stored value.
 */
export type SessionCore = {
  getStatus(): SessionStatus;
  /** Called on every status change. Returns the unsubscribe function. */
  subscribe(listener: (status: SessionStatus) => void): () => void;
  /** The signed-in session in memory, or null. */
  current(): StoredSession | null;
  /**
   * The account id of the session that expired (memory, or the stored
   * marker); null when there is none. Compared with E1 on the next sign-in.
   */
  previousAccountId(): string | null;
  generation(): number;
  isCurrent(generation: number): boolean;
  /** Sign-out has started: the coordinator sees no session. */
  isSigningOut(): boolean;

  /** Deduped; notifies a snapshot of the listeners and logs the status. */
  setStatus(next: SessionStatus): void;
  /** A late refresh result of an older generation is dropped. */
  bumpGeneration(): void;
  /** A new generation with no session and no previous account id. */
  resetForRestore(): void;
  /** A new sign-in: the session, no previous account id, `signedIn`. */
  adoptSignedIn(next: StoredSession): void;
  /** The stored session: `signedIn`. */
  restoreSignedIn(session: StoredSession): void;
  /** The stored expiry marker: its account id, `expired`. */
  restoreExpired(accountId: string): void;
  /**
   * Makes a refreshed session the in-memory one; false when `generation` is
   * stale, the status is not `signedIn` or sign-out has started.
   */
  adoptRefreshed(next: StoredSession, generation: number): boolean;
  /**
   * Drops the session, keeps its account id as the previous one and sets
   * `expired`. Returns that account id (null when there was no session).
   */
  markExpired(): string | null;
  /** No session and no previous account id; the status is not changed. */
  clearMemory(): void;
  beginSignOut(): void;
  endSignOut(): void;
  /** Rewrites the in-memory access token (debug only); storage is untouched. */
  replaceAccessToken(token: string): void;

  /**
   * Queued: runs `guard()` inside the queued op, before the write, and
   * resolves 'stale' without writing when it fails. Rejects when the write
   * fails.
   */
  writeSessionIf(next: StoredSession, guard: () => boolean): Promise<'saved' | 'stale'>;
  /** Queued write of the session entry (a session or an expiry marker). */
  writeSession(raw: string): Promise<void>;
  /** Queued clear of the session entry. */
  clearSession(): Promise<void>;
  /** Queued write of the stored phone. */
  writePhone(phone: string): Promise<void>;
  /** Queued clear of the stored phone. */
  clearPhone(): Promise<void>;
  /** Unqueued read of the session entry. */
  readSession(): Promise<ReadResult>;
  /** Unqueued read of the stored phone. */
  readPhone(): Promise<ReadResult>;
};

export type SessionCoreDeps = {
  sessionStore: SecureStore;
  phoneStore: SecureStore;
  logger: Logger;
};

export function createSessionCore({
  sessionStore,
  phoneStore,
  logger,
}: SessionCoreDeps): SessionCore {
  let status: SessionStatus = 'signedOut';
  /** The signed-in session; memory only besides SecureStore. */
  let session: StoredSession | null = null;
  let previousAccountId: string | null = null;
  /** Bumped by restore, sign-in and sign-out. */
  let generation = 0;
  const listeners = new Set<(next: SessionStatus) => void>();
  let signingOut = false;
  /** Serializes every SecureStore write and clear of this manager. */
  let storeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = storeQueue.then(op, op);
    storeQueue = result.catch(() => undefined);
    return result;
  }

  const setStatus = (next: SessionStatus) => {
    if (next === status) {
      return;
    }
    status = next;
    logger.info('session', 'status', { status: next });
    for (const listener of [...listeners]) {
      listener(next);
    }
  };

  return {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current: () => session,
    previousAccountId: () => previousAccountId,
    generation: () => generation,
    isCurrent: g => g === generation,
    isSigningOut: () => signingOut,

    setStatus,
    bumpGeneration() {
      generation += 1;
    },
    resetForRestore() {
      generation += 1;
      session = null;
      previousAccountId = null;
    },
    adoptSignedIn(next) {
      session = next;
      previousAccountId = null;
      setStatus('signedIn');
    },
    restoreSignedIn(next) {
      session = next;
      setStatus('signedIn');
    },
    restoreExpired(accountId) {
      previousAccountId = accountId;
      setStatus('expired');
    },
    adoptRefreshed(next, g) {
      if (g !== generation || status !== 'signedIn' || signingOut) {
        return false;
      }
      session = next;
      return true;
    },
    markExpired() {
      const accountId = session?.accountId ?? null;
      previousAccountId = accountId;
      session = null;
      setStatus('expired');
      return accountId;
    },
    clearMemory() {
      session = null;
      previousAccountId = null;
    },
    beginSignOut() {
      signingOut = true;
    },
    endSignOut() {
      signingOut = false;
    },
    replaceAccessToken(token) {
      if (session) {
        session = { ...session, accessToken: token };
      }
    },

    writeSessionIf: (next, guard) =>
      enqueue(async () => {
        if (!guard()) {
          return 'stale' as const;
        }
        await sessionStore.write(encode(next));
        return 'saved' as const;
      }),
    writeSession: raw => enqueue(() => sessionStore.write(raw)),
    clearSession: () => enqueue(() => sessionStore.clear()),
    writePhone: phone => enqueue(() => phoneStore.write(phone)),
    clearPhone: () => enqueue(() => phoneStore.clear()),
    readSession: () => sessionStore.read(),
    readPhone: () => phoneStore.read(),
  };
}
