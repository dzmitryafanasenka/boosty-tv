import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { BackHandler, useTVEventHandler } from 'react-native';
import { useLatestRef } from '../../shared/focus';
import { subscribeSeekKeys, type SeekKeyEvent } from '../../shared/platform/seekKeys';
import { PLAYER_CONTROL_IDS } from './PlayerOverlay';
import type { Phase } from './playerPhase';
import type { SeekController, SeekDirection } from './seekController';

/**
 * The first key up arriving this soon after focus landed on the player is
 * ignored: it belongs to the press that moved focus here (device: Story
 * 1.6, focus-map §1.1).
 */
export const ENTRY_GUARD_MS = 500;
/** A held ← → seeks at most this often (Android repeats a held key every ≈ 50 ms). */
export const HOLD_REPEAT_MS = 200;

type HWEvent = Parameters<Parameters<typeof useTVEventHandler>[0]>[0];

/** Android KeyEvent.ACTION_UP: raw keys act on key up only (device: Story 1.6). */
const KEY_UP = 1;

/** The raw keys the player acts on (`select` is the surfaces' own OK). */
const REMOTE_KEYS: ReadonlySet<string> = new Set([
  'left',
  'right',
  'up',
  'down',
  'playPause',
  'play',
  'pause',
  'fastForward',
  'next',
  'rewind',
  'previous',
  'stop',
  'menu',
  'info',
]);

/**
 * The entry guard: the first input right after focus landed on the player
 * is ignored (used up once). The window starts when the player mounts and
 * again when focus first lands on the surface.
 */
export type EntryGuard = {
  /** Focus landed on the surface (only the first time counts). */
  landed(): void;
  /** True for the first input within `ENTRY_GUARD_MS` of the landing; uses the guard up. */
  guarded(): boolean;
};

export function createEntryGuard(now: () => number): EntryGuard {
  let entry = { at: now(), used: false };
  let first = true;
  return {
    landed: () => {
      if (first) {
        first = false;
        entry = { at: now(), used: false };
      }
    },
    guarded: () => {
      if (entry.used) {
        return false;
      }
      entry.used = true;
      return now() - entry.at <= ENTRY_GUARD_MS;
    },
  };
}

/** One entry guard per player mount (created at the first render). */
export function useEntryGuard(): EntryGuard {
  const [guard] = useState(() => createEntryGuard(() => Date.now()));
  return guard;
}

/**
 * The player's remote (focus-map §4 G, §1.1): React Native key ups
 * (`useTVEventHandler`), the native seek keys (`seekKeys`: hold-to-seek) and
 * Back. The settings sheet owns the remote while it is open.
 *
 * - ← → seek (off the controls), ↑ ↓ show the overlay, OK and the
 *   play/pause keys toggle (a pending seek commits first), FF/Next forward,
 *   Rew/Prev back, Stop exits, Menu/Info open the settings.
 * - Hold-to-seek (native `seekKey` events, owner decision): each key down
 *   seeks (a held key repeats, at most every `HOLD_REPEAT_MS`, the step
 *   growing as for quick presses); after a hold the target stays pending
 *   (owner decision 2026-10-27): OK or Play/Pause commits it, Back or 5 s
 *   without input cancels it. The React Native key up of a press handled
 *   natively is swallowed, so the key up that ends a hold never counts as
 *   one more press. A live stream never builds a held target.
 * - Back: the sheet's levels first, then a held target (cancel), then the
 *   overlay (hide it), then exit.
 *
 * Returns the surface's OK handler (overlay hidden: pause, or commit a
 * pending seek).
 */
export function usePlayerKeys({
  phase,
  overlay,
  isActive,
  canSeek,
  seek,
  focused,
  sheetOpenRef,
  entryGuard,
  hideOverlay,
  showOverlay,
  seekBy,
  togglePause,
  setPlaying,
  exitPlayer,
  openSettings,
}: {
  phase: Phase;
  overlay: boolean;
  isActive: () => boolean;
  /** `PlaybackMode.canSeek` (also gates held targets). */
  canSeek: boolean;
  seek: SeekController;
  focused: RefObject<string | null>;
  sheetOpenRef: RefObject<boolean>;
  entryGuard: EntryGuard;
  hideOverlay: () => void;
  showOverlay: () => void;
  seekBy: (direction: SeekDirection) => void;
  togglePause: () => void;
  setPlaying: (play: boolean) => void;
  exitPlayer: () => void;
  openSettings: () => void;
}): { onSurfacePress: () => void } {
  const latest = useLatestRef({ phase, overlay, isActive });
  const entryGuarded = entryGuard.guarded;

  /** OK on the surface (overlay hidden): pause and show the overlay (a pending seek: commit it). */
  const onSurfacePress = useCallback(() => {
    if (latest.current.phase !== 'playing' || entryGuarded()) {
      return;
    }
    if (seek.commitNow()) {
      showOverlay();
      return;
    }
    setPlaying(false);
  }, [latest, seek, showOverlay, entryGuarded, setPlaying]);

  const hold = useRef<{ key: 'left' | 'right' | null; repeats: number; lastAt: number; ignored: boolean }>({
    key: null,
    repeats: 0,
    lastAt: 0,
    ignored: false,
  });
  const swallowUp = useRef({ left: false, right: false });
  const onSeekKey = useCallback(
    (event: SeekKeyEvent) => {
      const { phase: current, isActive: active } = latest.current;
      // The settings sheet owns the remote while it is open. ↑ ↓ (forwarded
      // for the period stepper, Story 5.4) are not seek keys.
      if (event.key === 'up' || event.key === 'down') {
        return;
      }
      if (!active() || current !== 'playing' || sheetOpenRef.current) {
        return;
      }
      const direction: SeekDirection = event.key === 'right' ? 1 : -1;
      const onControls = focused.current !== null && PLAYER_CONTROL_IDS.has(focused.current);
      if (event.action === 'down') {
        swallowUp.current[event.key] = true;
        const now = Date.now();
        if (event.repeat === 0 || hold.current.key !== event.key) {
          const ignored = entryGuarded();
          hold.current = { key: event.key, repeats: 0, lastAt: now, ignored };
          if (ignored) {
            return;
          }
          if (onControls) {
            showOverlay();
          } else {
            seekBy(direction);
          }
          return;
        }
        // Story 7.2: a mode that cannot seek (live) never builds a held target.
        if (hold.current.ignored || onControls || !canSeek) {
          return;
        }
        hold.current.repeats += 1;
        // A held key: the target stays pending until OK, Back or 5 s idle.
        seek.markHeld();
        if (now - hold.current.lastAt >= HOLD_REPEAT_MS) {
          hold.current.lastAt = now;
          seekBy(direction);
        }
        return;
      }
      // Key up: a held target stays pending (owner decision 2026-10-27);
      // a tap keeps the 600 ms window.
      hold.current = { key: null, repeats: 0, lastAt: 0, ignored: false };
    },
    [latest, seek, seekBy, showOverlay, entryGuarded, canSeek, focused, sheetOpenRef],
  );
  useFocusEffect(useCallback(() => subscribeSeekKeys(onSeekKey), [onSeekKey]));

  const onTvEvent = useCallback(
    (event: HWEvent) => {
      const { phase: current, isActive: active } = latest.current;
      if (!active() || current !== 'playing' || Number(event.eventKeyAction) !== KEY_UP) {
        return;
      }
      // The settings sheet owns the remote while it is open (its rows move
      // natively); no seek, no pause behind it.
      if (sheetOpenRef.current) {
        const type = event.eventType;
        if ((type === 'left' || type === 'right') && swallowUp.current[type]) {
          swallowUp.current[type] = false;
        }
        return;
      }
      const type = event.eventType;
      if (!REMOTE_KEYS.has(type)) {
        return;
      }
      // ← → already handled on key down by the native seek keys.
      if ((type === 'left' || type === 'right') && swallowUp.current[type]) {
        swallowUp.current[type] = false;
        return;
      }
      // The key up of the press that brought focus here.
      if (entryGuarded()) {
        return;
      }
      switch (type) {
        case 'left':
        case 'right':
          if (focused.current !== null && PLAYER_CONTROL_IDS.has(focused.current)) {
            // ← → move between the controls natively.
            showOverlay();
          } else {
            seekBy(type === 'right' ? 1 : -1);
          }
          return;
        case 'up':
        case 'down':
          showOverlay();
          return;
        case 'playPause':
        case 'play':
        case 'pause':
          // A held target: these keys act like OK (commit, keep playing).
          if (seek.isHeld()) {
            seek.commitNow();
            showOverlay();
            return;
          }
          // Otherwise an explicit pause key: commit a pending seek first, then play/pause.
          seek.commitNow();
          if (type === 'playPause') {
            togglePause();
          } else {
            setPlaying(type === 'play');
          }
          return;
        case 'fastForward':
        case 'next':
          seekBy(1);
          return;
        case 'rewind':
        case 'previous':
          seekBy(-1);
          return;
        case 'stop':
          exitPlayer();
          return;
        case 'menu':
        case 'info':
          // Story 4.3: react-native-tvos maps only these two (no Settings key).
          openSettings();
          return;
      }
    },
    [latest, seek, seekBy, showOverlay, togglePause, setPlaying, entryGuarded, exitPlayer, openSettings, focused, sheetOpenRef],
  );
  useTVEventHandler(onTvEvent);

  // Back: overlay → hide it; otherwise exit (every phase).
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // The settings sheet's levels come first (the modal host and the sheet).
        if (sheetOpenRef.current) {
          return false;
        }
        // A held seek target is the first Back layer: cancel it, the overlay stays.
        if (seek.isHeld()) {
          seek.cancel();
          return true;
        }
        if (latest.current.overlay && latest.current.phase === 'playing') {
          hideOverlay();
          return true;
        }
        exitPlayer();
        return true;
      });
      return () => sub.remove();
    }, [latest, seek, exitPlayer, sheetOpenRef, hideOverlay]),
  );

  return { onSurfacePress };
}
