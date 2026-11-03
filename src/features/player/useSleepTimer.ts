import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { t, tf } from '../../shared/i18n';
import { useLatestRef } from '../../shared/focus';
import { playerClockNow } from '../../shared/services/perfMark';

/**
 * Story 14.2 (our improvement IMP-08, FR-64): the sleep timer. Owner
 * decisions 2026-11-03: «Выкл» (default), 15, 30, 60, 90 minutes of real
 * time from the pick (also while paused), and «До конца видео» (VOD with a
 * known duration only). Elapsed time is measured on the monotonic clock
 * (`sleepClockNow`), so a device clock change (NTP, manual) never moves it.
 */

/** The sleep timer's clock: monotonic milliseconds (`performance.now()`), not the device date. */
export const sleepClockNow = (): number => playerClockNow();
export const SLEEP_MINUTES = [15, 30, 60, 90] as const;
export type SleepMinutes = (typeof SLEEP_MINUTES)[number];
export type SleepChoice = 'off' | SleepMinutes | 'end';

/** The submenu's rows in order; `end` only where it is offered. */
export function sleepChoices(endOffered: boolean): readonly SleepChoice[] {
  return endOffered ? ['off', ...SLEEP_MINUTES, 'end'] : ['off', ...SLEEP_MINUTES];
}

/** «Выкл», «15 мин», «До конца видео». */
export function sleepChoiceLabel(choice: SleepChoice): string {
  if (choice === 'off') {
    return t('player.sleep.off');
  }
  if (choice === 'end') {
    return t('player.sleep.end');
  }
  return tf('player.sleep.minutes', { minutes: String(choice) });
}

/** What the overlay shows while a timer runs: the fixed deadline (`sleepClockNow` ms) or «до конца». */
export type SleepIndicator = { kind: 'deadline'; deadlineAt: number } | { kind: 'end' };

/**
 * The fixed timer is checked at least this often, so a late or throttled JS
 * timer fires at the next check after the deadline.
 */
export const SLEEP_CHECK_MS = 1_000;

/** Whole seconds left until `deadlineAt` (both `sleepClockNow` ms; rounded up, never negative). */
export function sleepLeftSec(deadlineAt: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

/** Story 14.2 (owner decision 2026-11-03, after review): the warning starts this long before a fixed timer fires. */
export const SLEEP_WARN_MS = 60_000;
/** «Ещё 15 мин» adds this much to the deadline. */
export const SLEEP_EXTEND_MS = 15 * 60_000;
/** A warning that could not start (paused, the sheet or the chapter strip open) may still start until this much is left. */
export const SLEEP_WARN_LATEST_MS = 10_000;

type State = {
  choice: SleepChoice;
  deadlineAt: number | null;
  /** The «Пауза через 0:59» warning is showing. */
  warning: boolean;
  /** The warning was shown for this deadline: never again for it. */
  warned: boolean;
};
const OFF: State = { choice: 'off', deadlineAt: null, warning: false, warned: false };

export type SleepTimer = {
  choice: SleepChoice;
  /** Null while «Выкл». */
  indicator: SleepIndicator | null;
  /** A pick from the submenu: a fixed duration starts counting now; «Выкл» cancels. */
  pick: (choice: SleepChoice) => void;
  /** The last minute of a fixed timer: «Пауза через 0:59» with «Ещё 15 мин». */
  warning: boolean;
  /** «Ещё 15 мин»: the deadline moves 15 min later and the warning ends. */
  extend: () => void;
  /** The timer paused playback (a fire or the «До конца видео» hold): true until playback resumes. */
  pausedByTimer: boolean;
};

/**
 * The player session's sleep timer (never persisted: every mount starts at
 * «Выкл»; unmount cancels it; a new `resetKey`, i.e. another video, cancels
 * it too). A fixed timer fires after its real time (also while paused or in
 * the background): it goes back to «Выкл» and calls `onFire`, which pauses
 * only a playing video (true: it paused or held the next start paused).
 * From one minute before until `SLEEP_WARN_LATEST_MS` before, the first check
 * where `canWarn()` holds (playing; the sheet and the chapter strip closed)
 * starts the warning and `onWarn` runs (the overlay and focus on «Ещё 15
 * мин»), once per deadline; a manual pause ends it, the timer keeps running. «До конца видео» is
 * consumed by `holdAtEnd` (the session's `onEnd` asks it): true once, then
 * «Выкл»; it has no warning.
 */
export function useSleepTimer({
  resetKey,
  paused,
  onFire,
  canWarn,
  onWarn,
  holdAtEnd,
}: {
  resetKey: string;
  /** The player is paused (a manual pause ends the warning; playing again clears `pausedByTimer`). */
  paused: boolean;
  onFire: () => boolean;
  canWarn: () => boolean;
  onWarn: () => void;
  /** Set to this timer's end check while mounted (the session's `onEnd` reads it). */
  holdAtEnd: RefObject<(() => boolean) | null>;
}): SleepTimer {
  const [state, setStateRaw] = useState<State>(OFF);
  const stateRef = useRef(state);
  stateRef.current = state;
  const setState = useCallback((next: State) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);
  const [pausedByTimer, setPausedByTimer] = useState(false);
  const callbacks = useLatestRef({ onFire, canWarn, onWarn });

  // Another video (or a remount) cancels the timer.
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setStateRaw(OFF);
    setPausedByTimer(false);
  }

  const pick = useCallback(
    (choice: SleepChoice) => {
      setState(
        choice === 'off' || choice === 'end'
          ? { ...OFF, choice }
          : { ...OFF, choice, deadlineAt: sleepClockNow() + choice * 60_000 },
      );
    },
    [setState],
  );

  const extend = useCallback(() => {
    const current = stateRef.current;
    if (current.deadlineAt === null) {
      return;
    }
    setState({ ...current, deadlineAt: current.deadlineAt + SLEEP_EXTEND_MS, warning: false, warned: false });
  }, [setState]);

  useEffect(() => {
    holdAtEnd.current = () => {
      if (stateRef.current.choice !== 'end') {
        return false;
      }
      setState(OFF);
      setPausedByTimer(true);
      return true;
    };
    return () => {
      holdAtEnd.current = null;
    };
  }, [holdAtEnd, setState]);

  // A manual pause during the warning ends it (nothing to warn about); the timer keeps running.
  useEffect(() => {
    if (paused && stateRef.current.warning) {
      setState({ ...stateRef.current, warning: false });
    }
  }, [paused, setState]);
  // Playing again: the «Пауза по таймеру сна» notice goes.
  useEffect(() => {
    if (!paused) {
      setPausedByTimer(false);
    }
  }, [paused]);

  const deadlineAt = state.deadlineAt;
  useEffect(() => {
    if (deadlineAt === null) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const left = deadlineAt - sleepClockNow();
      if (left > 0) {
        const current = stateRef.current;
        if (left <= SLEEP_WARN_MS && left > SLEEP_WARN_LATEST_MS && !current.warned && callbacks.current.canWarn()) {
          setState({ ...current, warning: true, warned: true });
          callbacks.current.onWarn();
        }
        timer = setTimeout(check, Math.min(left, SLEEP_CHECK_MS));
        return;
      }
      timer = null;
      setState(OFF);
      if (callbacks.current.onFire()) {
        setPausedByTimer(true);
      }
    };
    check();
    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [deadlineAt, callbacks, setState]);

  const indicator = useMemo<SleepIndicator | null>(
    () =>
      state.choice === 'off'
        ? null
        : state.choice === 'end' || state.deadlineAt === null
          ? { kind: 'end' }
          : { kind: 'deadline', deadlineAt: state.deadlineAt },
    [state.choice, state.deadlineAt],
  );
  return { choice: state.choice, indicator, pick, warning: state.warning, extend, pausedByTimer };
}
