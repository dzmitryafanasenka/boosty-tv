import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import type { MediaRef } from '../../entities/post/types';
import type { ProgressRepository } from './progressRepository';
import type { ProgressSnapshot } from './progressStore';

/**
 * The app's ProgressRepository (created by `src/app` with the active
 * session's client); null outside the app (component tests): no progress,
 * no writes.
 */
export const ProgressContext = createContext<ProgressRepository | null>(null);

export function useProgressRepository(): ProgressRepository | null {
  return useContext(ProgressContext);
}

const NO_SUBSCRIPTION = () => () => {};
const NONE: readonly (ProgressSnapshot | null)[] = [];

/**
 * The progress of videos for the UI (Story 4.2): per video the local entry,
 * else the server `timeCode` seen on an E8, else null. The only way the UI
 * reads progress (`useSyncExternalStore` over the repository's store). One
 * ref gives one snapshot; a list of refs (a post's MediaRows) gives one per
 * ref, in order, as a stable array until one of them changes. Loads the
 * local store on first use, so a cold start shows the persisted entry.
 */
export function useProgress(ref: MediaRef): ProgressSnapshot | null;
export function useProgress(refs: readonly MediaRef[]): readonly (ProgressSnapshot | null)[];
export function useProgress(
  input: MediaRef | readonly MediaRef[],
): ProgressSnapshot | null | readonly (ProgressSnapshot | null)[] {
  const repository = useProgressRepository();
  const store = repository?.store ?? null;
  const single = !Array.isArray(input);
  const ids = (single ? [(input as MediaRef).mediaId] : (input as readonly MediaRef[]).map(r => r.mediaId)).join('\n');
  useEffect(() => {
    store?.ready().catch(() => {});
  }, [store]);
  const last = useRef<readonly (ProgressSnapshot | null)[]>(NONE);
  const getSnapshot = useCallback(() => {
    if (store === null || ids.length === 0) {
      return NONE;
    }
    const next = ids.split('\n').map(id => store.snapshot(id));
    const prev = last.current;
    if (prev.length === next.length && prev.every((snap, i) => snap === next[i])) {
      return prev;
    }
    last.current = next;
    return next;
  }, [store, ids]);
  const snapshots = useSyncExternalStore(store === null ? NO_SUBSCRIPTION : store.subscribe, getSnapshot);
  return single ? snapshots[0] ?? null : snapshots;
}
