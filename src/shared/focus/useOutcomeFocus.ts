import { useCallback, useEffect, useRef } from 'react';
import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useLatestRef } from './screenFocus';

/** Frames the no-fetch outcome settle waits for the render and the cache. */
export const OUTCOME_FRAME_TRIES = 30;

export type OutcomeFocusOptions<P> = {
  client: QueryClient;
  /** The screen's current phase. */
  phase: P;
  /** The shown list is fetching (this render). */
  isFetching: boolean;
  /** The shown list's query key (this render). */
  shownKey: QueryKey;
  /**
   * The user has not moved off the element that started the wait (and the
   * route is active, no modal is open); false: the outcome settles without
   * moving focus.
   */
  mayTakeFocus: () => boolean;
  /** Phases that keep the outcome waiting (e.g. the skeleton). */
  waitPhases: readonly P[];
  /** Phases that drop a pending outcome without focus (e.g. Поиск's hint). */
  dropPhases?: readonly P[];
  /** Moves focus for the settled outcome on `phase` (the screen's rules). */
  onOutcome: (phase: P) => void;
};

export type OutcomeFocus = {
  /**
   * An action (submit, retry, reset) waits for its outcome on the list
   * `awaited`: settled by the next phase change (`resolve`), the end of a
   * fetching cycle, or, when no fetch follows, on a later frame.
   */
  awaitOutcome(awaited: QueryKey): void;
  /** Drops a pending outcome (no focus): clears the flags and cancels a scheduled frame. */
  cancel(): void;
  /**
   * Settles a pending outcome on the current phase; true when it did (the
   * focus is handled, moved or deliberately left), false when nothing was
   * pending, the phase waits, or a drop phase cleared it.
   */
  resolve(): boolean;
};

/**
 * The outcome focus of a search-like screen (Поиск, Автор «Поиск в блоге»;
 * docs/focus-map.md §4 D/E): after «Готово», a «Повторить» or «Сбросить
 * фильтры», focus goes to the outcome once the list settles (the screen's
 * `onOutcome`), only while the user has not moved (`mayTakeFocus`).
 *
 * The screen calls `resolve()` from its own phase-change handler
 * (`usePhaseChange`). The hook settles by itself when the awaited fetch
 * ends with the phase unchanged (a held error through a failed retry), and,
 * when no fetch follows at all (an action onto a cached list), on a next
 * frame: not while the awaited list is fetching per the cache or the render
 * has not reached its key yet (a slow device: TanStack's batched notify can
 * come after the frame); then again next frame, at most OUTCOME_FRAME_TRIES
 * times (a longer fetch settles through the fetching cycle or the phase
 * change). Every value is read from the latest render.
 */
export function useOutcomeFocus<P>({
  client,
  phase,
  isFetching,
  shownKey,
  mayTakeFocus,
  waitPhases,
  dropPhases,
  onOutcome,
}: OutcomeFocusOptions<P>): OutcomeFocus {
  const pending = useRef(false);
  /** The awaited fetch has started (so its end can settle the outcome). */
  const fetchSeen = useRef(false);
  const frame = useRef<number | null>(null);
  const phaseRef = useLatestRef(phase);
  const fetchingRef = useLatestRef(isFetching);
  /** The shown list's key (hashed), as last rendered. */
  const shownKeyRef = useLatestRef(hashKey(shownKey));
  const mayTakeFocusRef = useLatestRef(mayTakeFocus);
  const waitPhasesRef = useLatestRef(waitPhases);
  const dropPhasesRef = useLatestRef(dropPhases);
  const onOutcomeRef = useLatestRef(onOutcome);

  useEffect(
    () => () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    },
    [],
  );

  const resolve = useCallback((): boolean => {
    const current = phaseRef.current;
    if (dropPhasesRef.current?.includes(current)) {
      pending.current = false;
      return false;
    }
    if (!pending.current || waitPhasesRef.current.includes(current)) {
      return false;
    }
    pending.current = false;
    if (!mayTakeFocusRef.current()) {
      return true;
    }
    onOutcomeRef.current(current);
    return true;
  }, [phaseRef, dropPhasesRef, waitPhasesRef, mayTakeFocusRef, onOutcomeRef]);

  const awaitOutcome = useCallback(
    (awaited: QueryKey) => {
      pending.current = true;
      fetchSeen.current = false;
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
      const awaitedHash = hashKey(awaited);
      let tries = 0;
      const check = () => {
        frame.current = null;
        if (!pending.current || fetchSeen.current) {
          return;
        }
        const busy =
          fetchingRef.current ||
          shownKeyRef.current !== awaitedHash ||
          client.isFetching({ queryKey: awaited, exact: true }) > 0;
        if (!busy) {
          resolve();
        } else if (++tries < OUTCOME_FRAME_TRIES) {
          frame.current = requestAnimationFrame(check);
        }
      };
      frame.current = requestAnimationFrame(check);
    },
    [fetchingRef, shownKeyRef, client, resolve],
  );

  const cancel = useCallback(() => {
    pending.current = false;
    fetchSeen.current = false;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  // The awaited fetch settled with the phase unchanged: settle the outcome too.
  useEffect(() => {
    if (!pending.current) {
      return;
    }
    if (isFetching) {
      fetchSeen.current = true;
    } else if (fetchSeen.current) {
      fetchSeen.current = false;
      resolve();
    }
  }, [isFetching, resolve]);

  return { awaitOutcome, cancel, resolve };
}
