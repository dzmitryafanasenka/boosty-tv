import { useCallback, useRef, useState } from 'react';

/**
 * `useState` that starts over when `itemKey` changes, without an extra
 * render. A recycling list (FlashList, ADR 0011) reuses a cell's React
 * instance for another item, so plain state (focus, a failed image) would
 * leak to the next item. Unlike FlashList's `useRecyclingState`, a change
 * here does not ask the list to lay out again (a focus move must stay
 * cheap). Without `itemKey` it behaves like `useState`.
 */
export function useItemState<T>(
  initial: T,
  itemKey?: string,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<{ key: string | undefined; value: T }>({
    key: itemKey,
    value: initial,
  });
  const keyRef = useRef(itemKey);
  keyRef.current = itemKey;
  const value = state.key === itemKey ? state.value : initial;
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState(prev => {
        const base = prev.key === keyRef.current ? prev.value : initial;
        const value_ =
          typeof next === 'function' ? (next as (prev: T) => T)(base) : next;
        return prev.key === keyRef.current && prev.value === value_
          ? prev
          : { key: keyRef.current, value: value_ };
      });
    },
    // `initial` is a constant per call site (false, null).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return [value, set];
}
