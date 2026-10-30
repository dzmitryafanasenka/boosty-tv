import { useSyncExternalStore } from 'react';
import { accountScope } from './accountScope';

/**
 * Module-level state keyed by account generation + id (AD-4 exception, Epic
 * 7 retro A2): the single-flight and optimistic entries of `usePollVote`
 * and `useLiveLike`. An entry is never registered with AccountScope; it is
 * keyed by the generation it was made under instead, so after a sign-out or
 * account switch (a bump) the next account never sees or waits on it, and a
 * late result of the old account can only touch its own entry.
 *
 * - `key(id, generation?)`: `<generation>:<id>`, the current generation by default.
 * - `get(id)`: the current generation's entry; `getAt(key)`: by full key.
 * - `set`, `delete`, `deleteIf` (only when the entry is still `expected`,
 *   by identity) and `reset` (test-only: forget all) notify subscribers
 *   once per change; a `deleteIf` or `delete` that removes nothing does not.
 * - `useEntry(id)`: the current generation's entry (null when none), via
 *   `useSyncExternalStore`. A generation bump by itself does not re-render
 *   it (no store change is notified): the next render or notify reads the
 *   new generation. This is the behaviour the hooks had before the move.
 */
export type GenerationKeyedStore<V> = {
  key: (id: string, generation?: number) => string;
  get: (id: string) => V | undefined;
  getAt: (key: string) => V | undefined;
  set: (key: string, value: V) => void;
  delete: (key: string) => void;
  /** Deletes `key` only while it still holds `expected` (identity). True when deleted. */
  deleteIf: (key: string, expected: V) => boolean;
  subscribe: (listener: () => void) => () => void;
  reset: () => void;
  useEntry: (id: string) => V | null;
};

export function createGenerationKeyedStore<V>(): GenerationKeyedStore<V> {
  const entries = new Map<string, V>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  const key = (id: string, generation: number = accountScope.generation()) => `${generation}:${id}`;
  const get = (id: string) => entries.get(key(id));
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    key,
    get,
    getAt: k => entries.get(k),
    set: (k, value) => {
      entries.set(k, value);
      notify();
    },
    delete: k => {
      if (entries.delete(k)) {
        notify();
      }
    },
    deleteIf: (k, expected) => {
      if (!entries.has(k) || entries.get(k) !== expected) {
        return false;
      }
      entries.delete(k);
      notify();
      return true;
    },
    subscribe,
    reset: () => {
      entries.clear();
      notify();
    },
    useEntry: function useEntry(id: string) {
      const snapshot = () => get(id) ?? null;
      return useSyncExternalStore(subscribe, snapshot, snapshot);
    },
  };
}

/** True while no sign-out or account switch (a bump) happened since the capture. */
export type GenerationCheck = (() => boolean) & {
  /** The generation captured (key entries with it: `store.key(id, check.generation)`). */
  readonly generation: number;
};

/** Captures the account generation now (read once). */
export function captureGeneration(): GenerationCheck {
  const generation = accountScope.generation();
  return Object.assign(() => accountScope.generation() === generation, { generation });
}
