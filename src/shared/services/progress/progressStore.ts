import { z } from 'zod';
import { accountScope as appAccountScope, type AccountScope } from '../../account/accountScope';
import { defineAccountScoped } from '../../account/defineAccountScoped';
import type { MediaRef } from '../../entities/post/types';
import { asyncKeyValueStore } from '../../platform/asyncKeyValueStore';
import type { KeyValueStore } from '../../platform/keyValueStore';
import { logger as appLogger, type Logger } from '../logger';

/**
 * The account-scoped local progress store (Story 4.2, AD-10, ADR 0004),
 * owned by `ProgressRepository` (the only writer):
 *
 * - One entry per media id `{ref, positionSec, durationSec, updatedAt, meta}`;
 *   at most `MAX_PROGRESS_ENTRIES` (the oldest `updatedAt` is dropped). The
 *   meta is what the Continue view (Story 4.7) shows; never a signed URL.
 * - The server `timeCode` of each video seen on an E8 (memory only, never
 *   persisted, never logged): the resume point when no local entry exists.
 * - Memory first (`put` applies at once and notifies), the disk (the
 *   `account` KeyValueStore, one JSON value) debounced by
 *   `DISK_DEBOUNCE_MS`, or at once with `flush`.
 * - Cleared by AccountScope (`progressAccountStore`): memory, the server
 *   values and the disk. An async disk write re-checks the generation after
 *   it landed and undoes itself when a reset happened meanwhile (the
 *   AccountScope contract for async writers); a load that lands after a
 *   reset is dropped.
 * - Logs outcomes only: no ids, no positions.
 */

export const PROGRESS_STORAGE_KEY = 'progress.v1';
export const MAX_PROGRESS_ENTRIES = 200;
export const DISK_DEBOUNCE_MS = 2_000;

/** What `begin` knows about the video (for the Continue view, Story 4.7). */
export type ProgressMeta = {
  title: string;
  postTitle: string;
  authorName: string;
  /**
   * The preview image URL as the post gives it; never a media URL. Kept on
   * disk only when it has no query (`persistablePreviewUrl`, Story 4.7).
   */
  previewUrl: string | null;
  durationSec: number | null;
};

export type ProgressEntry = {
  ref: MediaRef;
  positionSec: number;
  durationSec: number | null;
  /** Epoch ms of the last local update. */
  updatedAt: number;
  meta: ProgressMeta;
};

/** What the UI reads for one video (`useProgress`). */
export type ProgressSnapshot = {
  positionSec: number;
  /** The local entry's duration; null for a server value (the row's own duration applies). */
  durationSec: number | null;
  source: 'local' | 'server';
};

export type ProgressStore = {
  /** Loads the disk once (later calls share it). Never rejects. */
  ready(): Promise<void>;
  /** The disk has been read (or failed to be). */
  isReady(): boolean;
  get(mediaId: string): ProgressEntry | undefined;
  /** Memory now; disk debounced, or at once with `flush`. */
  put(entry: ProgressEntry, options?: { flush?: boolean }): void;
  /** Every entry, newest first (Story 4.7). */
  entries(): ProgressEntry[];
  /**
   * Drops one video's local entry and server value (Story 4.7: its post is
   * locked or gone). Memory now; disk debounced.
   */
  remove(mediaId: string): void;
  serverPosition(mediaId: string): number | undefined;
  setServerPosition(mediaId: string, positionSec: number): void;
  /** The local entry, else the server value, else null. Stable until it changes. */
  snapshot(mediaId: string): ProgressSnapshot | null;
  subscribe(listener: () => void): () => void;
  /** Called after every reset (the repository drops its held writes). */
  onReset(listener: () => void): () => void;
  /** Writes a pending debounced change now. Never rejects. */
  flush(): Promise<void>;
  /** Wipes memory, the server values and the disk. Rejects when the disk clear failed. */
  reset(): Promise<void>;
};

export type ProgressStoreDeps = {
  /** The `account` KeyValueStore, read on use. */
  kv: () => KeyValueStore;
  scope?: Pick<AccountScope, 'generation'>;
  logger?: Logger;
  debounceMs?: number;
};

const metaSchema = z.object({
  title: z.string().catch(''),
  postTitle: z.string().catch(''),
  authorName: z.string().catch(''),
  previewUrl: z.string().nullable().catch(null),
  durationSec: z.number().int().positive().nullable().catch(null),
});

const entrySchema = z.object({
  ref: z.object({
    blogUrl: z.string().min(1),
    postId: z.string().min(1),
    mediaId: z.string().min(1),
  }),
  positionSec: z.number().int().nonnegative(),
  durationSec: z.number().int().positive().nullable().catch(null),
  updatedAt: z.number(),
  meta: metaSchema,
});

const diskSchema = z.object({ v: z.literal(1), entries: z.array(z.unknown()) });

/**
 * Story 4.7 preview check (debug build on the pinned device, 2026-10-28,
 * query parameter names only): `ok_video.preview` URLs carry no query, but
 * the `defaultPreview` fallback carries `tkn` (a CDN token). A preview URL
 * with any query (or fragment) is therefore never written to disk (nor read back from
 * it); it lives in memory only, and the Continue card falls back to the
 * in-memory post data, else a neutral plate.
 */
export function persistablePreviewUrl(url: string | null): string | null {
  return url !== null && !url.includes('?') && !url.includes('#') ? url : null;
}

/** The disk form of an entry: no preview URL with a query. */
function diskEntry(entry: ProgressEntry): ProgressEntry {
  const previewUrl = persistablePreviewUrl(entry.meta.previewUrl);
  return previewUrl === entry.meta.previewUrl ? entry : { ...entry, meta: { ...entry.meta, previewUrl } };
}

/** Newest first, at most `MAX_PROGRESS_ENTRIES`. */
function capped(entries: Iterable<ProgressEntry>): ProgressEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROGRESS_ENTRIES);
}

export function createProgressStore({
  kv,
  scope = appAccountScope,
  logger = appLogger,
  debounceMs = DISK_DEBOUNCE_MS,
}: ProgressStoreDeps): ProgressStore {
  let local = new Map<string, ProgressEntry>();
  let server = new Map<string, number>();
  const snapshots = new Map<string, ProgressSnapshot | null>();
  const listeners = new Set<() => void>();
  const resetListeners = new Set<() => void>();
  let loading: Promise<void> | null = null;
  let loaded = false;
  /** Bumped by every reset: a load or write that started before is stale. */
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let writing: Promise<void> | null = null;

  function notify(mediaId: string | null) {
    if (mediaId === null) {
      snapshots.clear();
    } else {
      snapshots.delete(mediaId);
    }
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function trim() {
    if (local.size > MAX_PROGRESS_ENTRIES) {
      const kept = capped(local.values());
      local = new Map(kept.map(entry => [entry.ref.mediaId, entry]));
      snapshots.clear();
    }
  }

  async function load(): Promise<void> {
    const started = epoch;
    try {
      const raw = await kv().get(PROGRESS_STORAGE_KEY);
      if (started !== epoch || raw === null) {
        return;
      }
      const disk = diskSchema.safeParse(JSON.parse(raw));
      if (!disk.success) {
        logger.warn('progress', 'load', { outcome: 'invalid' });
        return;
      }
      let sanitized = false;
      for (const item of disk.data.entries) {
        const entry = entrySchema.safeParse(item);
        // Memory wins: an entry written before the load landed is newer.
        if (entry.success && !local.has(entry.data.ref.mediaId)) {
          // A preview with a query written before Story 4.7 is not trusted.
          const clean = diskEntry(entry.data);
          sanitized ||= clean !== entry.data;
          local.set(entry.data.ref.mediaId, clean);
        }
      }
      trim();
      if (sanitized) {
        // Rewrite the disk at once: the token must not stay there.
        schedule(true);
      }
    } catch {
      logger.warn('progress', 'load', { outcome: 'failed' });
    } finally {
      if (started === epoch) {
        loaded = true;
        // Also for an empty disk: readers of `isReady` (the Continue view) update.
        notify(null);
      }
    }
  }

  /** One disk write of the current memory; undone when a reset ran meanwhile. */
  async function writeOnce(): Promise<void> {
    const started = epoch;
    const generation = scope.generation();
    const value = JSON.stringify({ v: 1, entries: capped(local.values()).map(diskEntry) });
    try {
      await kv().set(PROGRESS_STORAGE_KEY, value);
      if (started !== epoch || generation !== scope.generation()) {
        // A reset ran while this was written: undo it (AccountScope contract).
        await kv().remove(PROGRESS_STORAGE_KEY);
        logger.info('progress', 'stale write undone');
      }
    } catch {
      logger.warn('progress', 'save', { outcome: 'failed' });
    }
  }

  /**
   * Writes until nothing is dirty: one disk write at a time, and a change
   * made meanwhile (also after a reset) is written after it. The promise is
   * the whole chain, so `flush()` waits for the follow-up writes too.
   */
  function writeDisk(): Promise<void> {
    dirty = true;
    if (writing === null) {
      writing = (async () => {
        while (dirty) {
          dirty = false;
          await writeOnce();
        }
      })().finally(() => {
        writing = null;
      });
    }
    return writing;
  }

  function schedule(now: boolean) {
    dirty = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (now) {
      writeDisk().catch(() => {});
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      writeDisk().catch(() => {});
    }, debounceMs);
  }

  return {
    ready() {
      if (loading === null) {
        loading = load();
      }
      return loading;
    },
    isReady: () => loaded,
    get: mediaId => local.get(mediaId),
    put(entry, { flush = false } = {}) {
      local.set(entry.ref.mediaId, entry);
      trim();
      notify(entry.ref.mediaId);
      schedule(flush);
    },
    entries: () => capped(local.values()),
    remove(mediaId) {
      const hadLocal = local.delete(mediaId);
      const hadServer = server.delete(mediaId);
      if (!hadLocal && !hadServer) {
        return;
      }
      notify(mediaId);
      if (hadLocal) {
        // At once: a kill or sleep must not bring the forgotten card back.
        schedule(true);
      }
    },
    serverPosition: mediaId => server.get(mediaId),
    setServerPosition(mediaId, positionSec) {
      if (server.get(mediaId) === positionSec) {
        return;
      }
      server.set(mediaId, positionSec);
      if (!local.has(mediaId)) {
        notify(mediaId);
      }
    },
    snapshot(mediaId) {
      if (snapshots.has(mediaId)) {
        return snapshots.get(mediaId) ?? null;
      }
      const entry = local.get(mediaId);
      const serverSec = server.get(mediaId);
      const snap: ProgressSnapshot | null = entry
        ? { positionSec: entry.positionSec, durationSec: entry.durationSec, source: 'local' }
        : serverSec !== undefined
          ? { positionSec: serverSec, durationSec: null, source: 'server' }
          : null;
      snapshots.set(mediaId, snap);
      return snap;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onReset(listener) {
      resetListeners.add(listener);
      return () => {
        resetListeners.delete(listener);
      };
    },
    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (dirty) {
        await writeDisk();
      } else if (writing) {
        await writing;
      }
    },
    async reset() {
      epoch += 1;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      dirty = false;
      local = new Map();
      server = new Map();
      // The next account loads the (now empty) disk again.
      loading = null;
      loaded = false;
      notify(null);
      for (const listener of [...resetListeners]) {
        listener();
      }
      await kv().clear();
    },
  };
}

/** Where the app's store persists: the `account` KeyValueStore (async-storage), unless the app replaced it. */
let appKeyValueStore: () => KeyValueStore = () => asyncKeyValueStore('account');

/**
 * Replaces the app store's KeyValueStore before first use. Only the
 * debug-only demo calls it (`src/app/session.ts`): its progress stays in
 * memory, so a demo sign-out never clears the owner's real local progress
 * and demo entries never mix into it.
 */
export function setProgressKeyValueStore(kv: KeyValueStore): void {
  appKeyValueStore = () => kv;
}

/** The app's store (AccountScope-registered as `progressAccountStore`). */
export const progressStore: ProgressStore = createProgressStore({
  kv: () => appKeyValueStore(),
});

/** AD-4: local progress, the server values and held writes go with the account. */
export const progressAccountStore = defineAccountScoped('progress', () => progressStore.reset());
