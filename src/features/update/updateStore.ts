import { useSyncExternalStore } from 'react';
import { createDevicePreference, type DevicePreference } from '../../shared/storage/devicePreference';
import { parseStoredRelease, type KnownRelease } from './releaseInfo';

/**
 * Update state (Story 9.2):
 *
 * - `updatePreference`: the persisted part, device-scoped (it survives
 *   sign-out and is not registered with AccountScope): when the last
 *   automatic check ran and the last newer release it found. The checker
 *   drops the release once the installed version is equal or higher.
 * - `UpdateStore`: the in-memory part the UI follows: the known newer
 *   release («Версия» hint, the dialog) and the plaque to show once
 *   (an automatic check found a newer release).
 */

export const UPDATE_PREFERENCE_KEY = 'update.state.v1';

export type UpdateState = {
  /** Epoch ms of the last automatic check; null: never. */
  lastCheckAt: number | null;
  release: KnownRelease | null;
};

export const EMPTY_UPDATE_STATE: UpdateState = { lastCheckAt: null, release: null };

/** A stored string → the state; junk or an old shape → null (the empty state). */
export function parseUpdateState(raw: string | null): UpdateState | null {
  if (raw === null) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { lastCheckAt, release } = value as { lastCheckAt?: unknown; release?: unknown };
  return {
    lastCheckAt: typeof lastCheckAt === 'number' && Number.isFinite(lastCheckAt) ? lastCheckAt : null,
    release: release === null || release === undefined ? null : parseStoredRelease(release),
  };
}

export function serializeUpdateState(state: UpdateState): string {
  return JSON.stringify(state);
}

export function createUpdatePreference(): DevicePreference<UpdateState> {
  return createDevicePreference({
    key: UPDATE_PREFERENCE_KEY,
    parse: parseUpdateState,
    serialize: serializeUpdateState,
    fallback: EMPTY_UPDATE_STATE,
    scope: 'update',
    label: 'update state',
  });
}

export type UpdateSnapshot = {
  /** A release newer than the installed version; null: none known. */
  known: KnownRelease | null;
  /** The plaque to show (once); null: none. */
  plaque: KnownRelease | null;
};

export type UpdateStore = {
  get(): UpdateSnapshot;
  subscribe(listener: () => void): () => void;
  setKnown(release: KnownRelease | null): void;
  showPlaque(release: KnownRelease): void;
  hidePlaque(): void;
};

export function createUpdateStore(): UpdateStore {
  let snapshot: UpdateSnapshot = { known: null, plaque: null };
  const listeners = new Set<() => void>();
  const set = (next: UpdateSnapshot) => {
    if (next.known === snapshot.known && next.plaque === snapshot.plaque) {
      return;
    }
    snapshot = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setKnown: release => set({ known: release, plaque: release === null ? null : snapshot.plaque }),
    showPlaque: release => set({ ...snapshot, plaque: release }),
    hidePlaque: () => set({ ...snapshot, plaque: null }),
  };
}

/** The store's snapshot for a component (re-renders on change). */
export function useUpdateSnapshot(store: UpdateStore): UpdateSnapshot {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
