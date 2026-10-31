import { useCallback, useRef } from 'react';

/**
 * OK presses on Настройки' «Версия» (Story 8.3): seven presses, each less
 * than 2 s after the previous one, open the hidden Diagnostics. A gap of
 * 2 s or more starts the count again. A single press does nothing visible.
 *
 * Epic 9 binds the single-press update check here: `onFirstPress` runs on
 * the first press of a series only (the press after a gap, or after the
 * gesture fired), never on presses 2–7, so the seven-press gesture can
 * trigger at most one check. Its own 60 s throttle stays with the caller.
 */

export const VERSION_PRESS_COUNT = 7;
/** A press this long (or longer) after the previous one starts a new series. */
export const VERSION_PRESS_GAP_MS = 2000;

export type VersionPressOptions = {
  /** The gesture completed (the seventh press). */
  onGesture: () => void;
  /** The first press of a series (Epic 9: the update check). */
  onFirstPress?: () => void;
  now?: () => number;
};

export type VersionPressCounter = {
  press(): void;
};

export function createVersionPressCounter({
  onGesture,
  onFirstPress,
  now = Date.now,
}: VersionPressOptions): VersionPressCounter {
  let count = 0;
  let last = 0;
  return {
    press() {
      const at = now();
      if (count > 0 && at - last >= VERSION_PRESS_GAP_MS) {
        count = 0;
      }
      last = at;
      count += 1;
      if (count === 1) {
        onFirstPress?.();
      }
      if (count >= VERSION_PRESS_COUNT) {
        count = 0;
        onGesture();
      }
    },
  };
}

/**
 * The «Версия» row's OK handler; `undefined` when there is nothing to open
 * (the `diagnostics` flag off: the row keeps OK doing nothing).
 */
export function useVersionPresses(
  onGesture: (() => void) | undefined,
  onFirstPress?: () => void,
): (() => void) | undefined {
  const gestureRef = useRef(onGesture);
  gestureRef.current = onGesture;
  const firstRef = useRef(onFirstPress);
  firstRef.current = onFirstPress;
  const counter = useRef<VersionPressCounter | null>(null);
  if (counter.current === null) {
    counter.current = createVersionPressCounter({
      onGesture: () => gestureRef.current?.(),
      onFirstPress: () => firstRef.current?.(),
    });
  }
  const press = useCallback(() => counter.current?.press(), []);
  return onGesture || onFirstPress ? press : undefined;
}
