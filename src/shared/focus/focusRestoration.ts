/**
 * FocusRestoration (AD-12, docs/focus-map.md §1.6): the single store of the
 * return target `{focusId, scrollOffset}` per route key + section id, so each
 * sidebar section keeps its own memory. Only this store decides the return
 * focus; other code may only point it elsewhere with `setReturnFocus`.
 *
 * Pure TypeScript: no React, no native calls. Screens use
 * `resolveRestoreTarget` to apply the fallback chain to their current data,
 * then scroll and focus (see `useFocusRestoration`).
 */

/** Section id for routes without sidebar sections (Post, Player, dev). */
export const MAIN_SECTION = 'main';

export type RestorationEntry = {
  focusId: string;
  scrollOffset: number;
  /** Index of the item in its list when remembered (neighbor fallback). */
  index?: number;
};

const SEP = '\u0000';

function keyOf(routeKey: string, sectionId: string): string {
  return `${routeKey}${SEP}${sectionId}`;
}

export type FocusRestorationStore = {
  /** Remember the focused element of a route section (on focus / before navigating). */
  remember(
    routeKey: string,
    sectionId: string,
    focusId: string,
    scrollOffset: number,
    index?: number,
  ): void;
  /**
   * Point the next return to `routeKey` at `focusId` (e.g. the player
   * pointing at the next unfinished MediaRow). One-shot: the next `restore`
   * of any section of that route returns it once, with the remembered scroll.
   */
  setReturnFocus(routeKey: string, focusId: string): void;
  /**
   * The return target, or undefined when nothing was remembered. Consumes a
   * pending `setReturnFocus` override.
   */
  restore(routeKey: string, sectionId: string): RestorationEntry | undefined;
  /** Like `restore`, but leaves a pending override in place. */
  peek(routeKey: string, sectionId: string): RestorationEntry | undefined;
  /** Remove one route (every section), e.g. when the route is gone. */
  forget(routeKey: string): void;
  /** Remove everything (sign-out, account switch: Stories 2.7, 2.8). */
  clear(): void;
};

export function createFocusRestoration(): FocusRestorationStore {
  const entries = new Map<string, RestorationEntry>();
  const overrides = new Map<string, string>();

  function read(routeKey: string, sectionId: string): RestorationEntry | undefined {
    const entry = entries.get(keyOf(routeKey, sectionId));
    const override = overrides.get(routeKey);
    if (override !== undefined) {
      // The override names a different element: its index is unknown.
      return { focusId: override, scrollOffset: entry?.scrollOffset ?? 0 };
    }
    return entry ? { ...entry } : undefined;
  }

  return {
    remember(routeKey, sectionId, focusId, scrollOffset, index) {
      entries.set(keyOf(routeKey, sectionId), {
        focusId,
        scrollOffset: Number.isFinite(scrollOffset) ? Math.max(0, scrollOffset) : 0,
        ...(index !== undefined && Number.isInteger(index) && index >= 0 ? { index } : {}),
      });
    },
    setReturnFocus(routeKey, focusId) {
      overrides.set(routeKey, focusId);
    },
    restore(routeKey, sectionId) {
      const result = read(routeKey, sectionId);
      overrides.delete(routeKey);
      return result;
    },
    peek: read,
    forget(routeKey) {
      overrides.delete(routeKey);
      for (const key of [...entries.keys()]) {
        if (key.startsWith(`${routeKey}${SEP}`)) {
          entries.delete(key);
        }
      }
    },
    clear() {
      entries.clear();
      overrides.clear();
    },
  };
}

/** The app-wide store. */
export const focusRestoration = createFocusRestoration();

/**
 * Where focus goes on return, after the fallback chain (§1.6):
 * - `item`: the remembered id at its current index, or the neighbor by the
 *   remembered index (clamped to the list), or the first item of the zone;
 * - `above`: the list is empty, so the nearest action above (given by the
 *   screen);
 * - `none`: nothing was remembered (the screen applies its initial focus).
 */
export type RestoreTarget =
  | { kind: 'item'; id: string; index: number; fallback: 'none' | 'neighbor' | 'first' }
  | { kind: 'above' }
  | { kind: 'none' };

export function resolveRestoreTarget(
  entry: RestorationEntry | undefined,
  ids: readonly string[],
): RestoreTarget {
  if (!entry) {
    return { kind: 'none' };
  }
  const found = ids.indexOf(entry.focusId);
  if (found >= 0) {
    return { kind: 'item', id: entry.focusId, index: found, fallback: 'none' };
  }
  if (ids.length === 0) {
    return { kind: 'above' };
  }
  if (entry.index !== undefined) {
    const index = Math.min(entry.index, ids.length - 1);
    return { kind: 'item', id: ids[index], index, fallback: 'neighbor' };
  }
  return { kind: 'item', id: ids[0], index: 0, fallback: 'first' };
}
