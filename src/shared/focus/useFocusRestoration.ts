import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { HostView } from '../ui/FocusableSurface';
import { requestHostFocus } from '../ui/requestHostFocus';
import {
  MAIN_SECTION,
  focusRestoration,
  resolveRestoreTarget,
  type RestoreTarget,
} from './focusRestoration';

/** The FlatList methods restoration needs (a FlatList ref satisfies it). */
export type RestorableList = {
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
  scrollToIndex(params: {
    index: number;
    animated?: boolean;
    viewPosition?: number;
  }): void;
};

export type FocusRestorationOptions = {
  routeKey: string;
  sectionId?: string;
  /** Stable ids of the list's current data, in order. */
  ids: readonly string[];
  /**
   * The list. It must provide `getItemLayout`: `restore` may call
   * `scrollToIndex` for an item that is not mounted, which VirtualizedList
   * only supports with known item layouts.
   */
  listRef: RefObject<RestorableList | null>;
  /** The nearest action above the list (the last fallback). */
  focusAbove: () => void;
  /** Frames to wait for a scrolled-to item to mount (default 30). */
  maxFrames?: number;
};

export type ListRestoration = {
  /** Item `onFocus`: remember the id, its index and the scroll offset. */
  onItemFocus(id: string, index: number): void;
  /** List `onScroll`: keeps the remembered offset current. */
  onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void;
  /** Item `ref`: the mounted host view per id. */
  itemRef(id: string): (view: HostView | null) => void;
  /**
   * On return (the route is focused again): restore the scroll; if the
   * target's current index differs from the remembered one, scroll it into
   * view by that index; then focus it once it is mounted. Returns what it
   * did; `none` means nothing was remembered.
   */
  restore(): RestoreTarget;
  /** Stop a pending focus attempt (screen blur, unmount). */
  cancel(): void;
  /** Initial focus: the first item, or the action above when the list is empty. */
  focusInitial(): void;
};

/**
 * FocusRestoration for a virtualized list (AD-12, docs/focus-map.md §1.6),
 * with the fallback chain neighbor by index → first item → the nearest
 * action above. Android's fallback focus is never relied on.
 */
export function useFocusRestoration({
  routeKey,
  sectionId = MAIN_SECTION,
  ids,
  listRef,
  focusAbove,
  maxFrames = 30,
}: FocusRestorationOptions): ListRestoration {
  const views = useRef(new Map<string, HostView>());
  const refCallbacks = useRef(
    new Map<string, (view: HostView | null) => void>(),
  );
  const offset = useRef(0);
  const focused = useRef<{ id: string; index: number } | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const focusAboveRef = useRef(focusAbove);
  focusAboveRef.current = focusAbove;
  /** Bumped by every restore, cancel, unmount and user move, so a pending focus loop stops. */
  const attempt = useRef(0);
  /** The id a pending focus loop is waiting for. */
  const pending = useRef<string | null>(null);

  const cancel = useCallback(() => {
    attempt.current += 1;
    pending.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onItemFocus = useCallback(
    (id: string, index: number) => {
      if (pending.current !== null && pending.current !== id) {
        // The user moved focus during the wait: do not steal it back.
        cancel();
      }
      focused.current = { id, index };
      focusRestoration.remember(routeKey, sectionId, id, offset.current, index);
    },
    [routeKey, sectionId, cancel],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
      const current = focused.current;
      if (current) {
        focusRestoration.remember(
          routeKey,
          sectionId,
          current.id,
          offset.current,
          current.index,
        );
      }
    },
    [routeKey, sectionId],
  );

  const itemRef = useCallback((id: string) => {
    let callback = refCallbacks.current.get(id);
    if (!callback) {
      callback = (view: HostView | null) => {
        if (view) {
          views.current.set(id, view);
        } else if (views.current.has(id)) {
          views.current.delete(id);
        }
      };
      refCallbacks.current.set(id, callback);
    }
    return callback;
  }, []);

  const restore = useCallback((): RestoreTarget => {
    const entry = focusRestoration.restore(routeKey, sectionId);
    const target = resolveRestoreTarget(entry, idsRef.current);
    cancel();
    if (target.kind === 'none') {
      return target;
    }
    if (target.kind === 'above') {
      focused.current = null;
      focusAboveRef.current();
      return target;
    }
    const list = listRef.current;
    list?.scrollToOffset({ offset: entry?.scrollOffset ?? 0, animated: false });
    // Unchanged index: the restored offset already shows the item, keep it.
    if (target.index !== entry?.index) {
      list?.scrollToIndex({
        index: target.index,
        animated: false,
        viewPosition: 0.5,
      });
    }

    pending.current = target.id;
    const mine = attempt.current;
    let frames = 0;
    const tryFocus = () => {
      if (mine !== attempt.current) {
        return;
      }
      const view = views.current.get(target.id);
      if (view) {
        pending.current = null;
        requestHostFocus(view);
        return;
      }
      frames += 1;
      if (frames < maxFrames) {
        requestAnimationFrame(tryFocus);
      } else {
        pending.current = null;
        focusAboveRef.current();
      }
    };
    tryFocus();
    return target;
  }, [routeKey, sectionId, listRef, maxFrames, cancel]);

  const focusInitial = useCallback(() => {
    const first = idsRef.current[0];
    const view = first === undefined ? undefined : views.current.get(first);
    if (view) {
      requestHostFocus(view);
    } else {
      focusAboveRef.current();
    }
  }, []);

  return useMemo(
    () => ({ onItemFocus, onScroll, itemRef, restore, cancel, focusInitial }),
    [onItemFocus, onScroll, itemRef, restore, cancel, focusInitial],
  );
}
