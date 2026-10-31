import { useCallback, useState } from 'react';
import { useLatestRef } from './screenFocus';

/** What `PendingConfirm.press` did: armed the key (1st OK) or found it armed (2nd OK). */
export type PendingPress = 'armed' | 'confirm';

export type PendingConfirm<K extends string> = {
  /** The armed key, or null. */
  pending: K | null;
  /**
   * OK on `key`: `'confirm'` when `key` is already armed (the caller sends
   * now and calls `cancel()` once the send is accepted), else arms `key`
   * (replacing any other armed key) and returns `'armed'`. Reads the latest
   * render's state, so it is stable and safe in memoized callbacks.
   */
  press(key: K): PendingPress;
  /** Disarms: any armed key, or only `key` when given (that stop blurred). Safe during render. */
  cancel(key?: K): void;
};

/**
 * The two-OK confirm (Stories 6.6, 6.7; our improvement over the reference's
 * one-click vote): the 1st OK arms a key (the caller draws the pending
 * outline and hint), a 2nd OK on the same key confirms, and a blur or a mode
 * change disarms it. Local state only: nothing is persisted.
 *
 * The caller decides when to disarm: the single-choice poll cancels on the
 * option's blur, the multiple-choice action control on its blur and when
 * the poll changes mode (a render-phase `cancel()`).
 */
export function usePendingConfirm<K extends string>(): PendingConfirm<K> {
  const [pending, setPending] = useState<K | null>(null);
  const latest = useLatestRef(pending);
  const press = useCallback(
    (key: K): PendingPress => {
      if (latest.current === key) {
        return 'confirm';
      }
      // Armed at once: a second press in the same tick (before the
      // re-render) already confirms. The next render writes the same value.
      latest.current = key;
      setPending(key);
      return 'armed';
    },
    [latest],
  );
  const cancel = useCallback(
    (key?: K) => {
      if (key === undefined || latest.current === key) {
        latest.current = null;
      }
      setPending(prev => (key === undefined || prev === key ? null : prev));
    },
    [latest],
  );
  return { pending, press, cancel };
}
