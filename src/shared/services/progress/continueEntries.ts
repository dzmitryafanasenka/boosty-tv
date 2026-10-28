import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { isFinished } from './finished';
import type { ProgressEntry, ProgressStore } from './progressStore';
import { useProgressRepository } from './useProgress';

/** At most this many «Продолжить просмотр» cards (Story 4.7). */
export const MAX_CONTINUE_ENTRIES = 20;

/** The duration an entry is judged by: the engine's, else the post's. */
export function entryDurationSec(entry: ProgressEntry): number | null {
  return entry.durationSec !== null && entry.durationSec > 0 ? entry.durationSec : entry.meta.durationSec;
}

/**
 * The Continue view (Story 4.7, FR15) from the local entries (newest
 * first, one per media id): unfinished (the ADR 0004 rule) with a position
 * > 0, at most `MAX_CONTINUE_ENTRIES`. A started video without a known
 * duration counts as unfinished.
 */
export function continueEntries(entries: readonly ProgressEntry[]): ProgressEntry[] {
  const seen = new Set<string>();
  const result: ProgressEntry[] = [];
  for (const entry of entries) {
    if (result.length >= MAX_CONTINUE_ENTRIES) {
      break;
    }
    const id = entry.ref.mediaId;
    if (seen.has(id) || entry.positionSec <= 0 || isFinished(entry.positionSec, entryDurationSec(entry))) {
      continue;
    }
    seen.add(id);
    result.push(entry);
  }
  return result;
}

export type ContinueView = {
  /** The local store has been read (always true without a repository). */
  ready: boolean;
  entries: readonly ProgressEntry[];
};

const NONE: ContinueView = { ready: true, entries: [] };
const NO_SUBSCRIPTION = () => () => {};

function sameEntries(a: readonly ProgressEntry[], b: readonly ProgressEntry[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/**
 * The Continue view for the UI (`useSyncExternalStore` over the
 * repository's store): stable until an entry of it changes, the store is
 * read from disk, or reset. Loads the local store on first use and after
 * a reset.
 */
export function useContinueEntries(): ContinueView {
  const store: ProgressStore | null = useProgressRepository()?.store ?? null;
  const last = useRef<ContinueView>(NONE);
  const getSnapshot = useCallback(() => {
    if (store === null) {
      return NONE;
    }
    const next = { ready: store.isReady(), entries: continueEntries(store.entries()) };
    const prev = last.current;
    if (prev.ready === next.ready && sameEntries(prev.entries, next.entries)) {
      return prev;
    }
    last.current = next;
    return next;
  }, [store]);
  const view = useSyncExternalStore(store === null ? NO_SUBSCRIPTION : store.subscribe, getSnapshot);
  // Also after a reset (the next account reads its own, now empty, disk).
  useEffect(() => {
    if (!view.ready) {
      store?.ready().catch(() => {});
    }
  }, [store, view.ready]);
  return view;
}
