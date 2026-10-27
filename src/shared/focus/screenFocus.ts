import { useEffect, useRef, type RefObject } from 'react';
import type { RestoreTarget } from './focusRestoration';
import type { ListRestoration } from './useFocusRestoration';

/** What a screen knows about focus on its route (the Shell or a stack route). */
export type ScreenFocusGate = {
  /** The screen's route is the focused one (not covered or closing). */
  isActive(): boolean;
  /** The route's last focused element id, or null before any. */
  current(): string | null;
  /** The sidebar's current item id. */
  sectionItemId: string;
};

/**
 * The may-take-focus gate (docs/focus-map.md §1.6 skeleton rule): the
 * route is active and the user has not moved focus away from where the
 * screen may take it — nothing focused yet, the sidebar's current item, or
 * the screen's own StateView action (`stateActionId`, its view replaced).
 */
export function mayTakeScreenFocus(info: ScreenFocusGate, stateActionId: string): boolean {
  if (!info.isActive()) {
    return false;
  }
  const current = info.current();
  return current === null || current === info.sectionItemId || current === stateActionId;
}

/**
 * Restore the remembered list item (FocusRestoration, fallback chain), else
 * focus the list's first item. `beforeFirst` runs right before the first
 * item is focused (e.g. recording it as an automatic focus). Returns the
 * restore target.
 */
export function restoreElseFirst(
  restoration: Pick<ListRestoration, 'restore' | 'focusInitial'>,
  beforeFirst?: () => void,
): RestoreTarget {
  const target = restoration.restore();
  if (target.kind === 'none') {
    beforeFirst?.();
    restoration.focusInitial();
  }
  return target;
}

/** A ref that always holds the latest render's value (read by callbacks and effects). */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Runs `onChange(phase, previous)` in an effect whenever the screen's phase
 * differs from the one of the previous run (`previous` is null on the
 * first run). The latest `onChange` is used; it is not a dependency.
 */
export function usePhaseChange<P>(phase: P, onChange: (phase: P, previous: P | null) => void): void {
  const onChangeRef = useLatestRef(onChange);
  const lastPhase = useRef<P | null>(null);
  useEffect(() => {
    const previous = lastPhase.current;
    lastPhase.current = phase;
    if (previous === phase) {
      return;
    }
    onChangeRef.current(phase, previous);
  }, [phase, onChangeRef]);
}
