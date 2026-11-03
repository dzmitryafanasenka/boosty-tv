import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { focusSoon } from '../../shared/focus';
import { motion, type HostView } from '../../shared/ui';
import { CHAPTER_ITEM_PREFIX } from './ChapterStrip';
import {
  PLAYER_CONTROL_IDS,
  PLAYER_PLAYPAUSE_ID,
  PLAYER_SETTINGS_ID,
  PLAYER_SLEEP_EXTEND_ID,
  PLAYER_TIMELINE_ID,
} from './PlayerOverlay';
import type { PlaybackMode } from './playbackMode';
import type { ErrorTarget, Phase } from './playerPhase';
import type { EntryGuard } from './usePlayerKeys';

/** Focus ids (docs/focus-map.md §1.5). */
export const PLAYER_SURFACE_ID = 'player/surface';
export const PLAYER_RETRY_ID = 'player/error/retry';
export const PLAYER_BACK_ID = 'player/error/back';

/** The overlay hides after this long without input, only while playing. */
export const OVERLAY_HIDE_MS = motion['overlay-hide'].delay;
/** Buffering shows the spinner only after this long. */
export const BUFFER_SPINNER_MS = motion['buffer-delay'].delay;

/**
 * The overlay's timing: the spinner after 500 ms of buffering; the
 * auto-hide after 5 s without input, only while playing (never paused,
 * seeking, on error, with the settings sheet open or, Story 14.2, during
 * the sleep timer's warning); no overlay outside
 * playing. Returns whether the spinner shows.
 */
export function useOverlayTimers({
  playing,
  buffering,
  overlay,
  paused,
  seeking,
  sheetOpen,
  stripOpen = false,
  sleepWarning = false,
  interaction,
  hideOverlay,
}: {
  playing: boolean;
  buffering: boolean;
  overlay: boolean;
  paused: boolean;
  seeking: boolean;
  sheetOpen: boolean;
  /** Story 10.1: the chapter strip is open (the overlay does not auto-hide). */
  stripOpen?: boolean;
  /** Story 14.2: the sleep timer's last-minute warning (the overlay does not auto-hide). */
  sleepWarning?: boolean;
  /** Bumped on every input that shows the overlay: restarts the auto-hide. */
  interaction: number;
  hideOverlay: () => void;
}): boolean {
  const [spinner, setSpinner] = useState(false);
  // Spinner only after 500 ms of buffering.
  const buffered = playing && buffering;
  useEffect(() => {
    if (!buffered) {
      setSpinner(false);
      return;
    }
    const timer = setTimeout(() => setSpinner(true), BUFFER_SPINNER_MS);
    return () => clearTimeout(timer);
  }, [buffered]);

  // Auto-hide: only while playing, never paused, seeking or on error.
  const mayHide = overlay && playing && !paused && !seeking && !sheetOpen && !stripOpen && !sleepWarning;
  useEffect(() => {
    if (!mayHide) {
      return;
    }
    const timer = setTimeout(() => hideOverlay(), OVERLAY_HIDE_MS);
    return () => clearTimeout(timer);
  }, [mayHide, interaction, hideOverlay]);

  // The overlay exists only while playing.
  useEffect(() => {
    if (!playing) {
      hideOverlay();
    }
  }, [playing, hideOverlay]);
  return spinner;
}

export type PlayerFocus = {
  surfaceView: RefObject<HostView | null>;
  timelineView: RefObject<HostView | null>;
  playPauseView: RefObject<HostView | null>;
  retryView: RefObject<HostView | null>;
  backView: RefObject<HostView | null>;
  /** Story 10.1: the chapter strip's initial item. */
  stripView: RefObject<HostView | null>;
  /** Story 14.2: «Ещё 15 мин». */
  extendView: RefObject<HostView | null>;
  /** The focused player element (raw ← → seek only off the controls). */
  focused: RefObject<string | null>;
  /**
   * Story 10.1: when focus last came onto the timeline from a control (↑
   * from the controls row); 0 otherwise. The key up of that ↑ must not open
   * the chapter strip.
   */
  timelineFromControlsAt: RefObject<number>;
  /** The surface takes focus (loading, recovering, playing with the overlay hidden). */
  surfaceFocusable: boolean;
  onSurfaceFocus: () => void;
  onTimelineFocus: () => void;
  onPlayPauseFocus: () => void;
  onRetryFocus: () => void;
  onBackFocus: () => void;
  onSettingsFocus: () => void;
  onControlFocus: (id: string) => void;
  /** Story 10.1: focus arrived on a chapter strip item (its id). */
  onStripItemFocus: (id: string) => void;
  onExtendFocus: () => void;
  /** Story 14.2: move focus to «Ещё 15 мин» (↑ on the timeline during the warning). */
  focusExtend: () => void;
};

/**
 * Where focus goes for each phase and overlay state (focus-map §4 G). The
 * element that had focus can disappear in the same commit (the surface
 * turning non-focusable under the overlay, the overlay unmounting, the error
 * panel replacing the surface): Android then moves focus to the first
 * focusable view of the window, on a covered screen. So the request is
 * repeated two frames later unless focus already arrived (as the modal host
 * does; on the device only the late request stuck); both requests only while
 * the player is still the focused route (a locked E8's session check can
 * end in A11 within those frames: Epic 3 retro A6). The settings sheet owns
 * focus while open; closing it returns focus to «Настройки» (the modal
 * host), not to this target.
 */
export function usePlayerFocus({
  phase,
  overlay,
  errorTarget,
  overlayFocus,
  isActive,
  sheetOpenRef,
  entryGuard,
  stripOpen = false,
  warnFocus = false,
}: {
  phase: Phase;
  overlay: boolean;
  errorTarget: ErrorTarget;
  overlayFocus: PlaybackMode['overlayFocus'];
  isActive: () => boolean;
  sheetOpenRef: RefObject<boolean>;
  entryGuard: EntryGuard;
  /** Story 10.1: the chapter strip is open: focus on its initial item; closing it → the timeline. */
  stripOpen?: boolean;
  /**
   * Story 14.2: the sleep timer's warning just started: focus on «Ещё 15 мин»
   * while the overlay shows (cleared by the caller when the overlay hides, so
   * Back never brings it back).
   */
  warnFocus?: boolean;
}): PlayerFocus {
  const playing = phase === 'playing';
  const surfaceView = useRef<HostView | null>(null);
  const timelineView = useRef<HostView | null>(null);
  const playPauseView = useRef<HostView | null>(null);
  const retryView = useRef<HostView | null>(null);
  const backView = useRef<HostView | null>(null);
  const stripView = useRef<HostView | null>(null);
  const extendView = useRef<HostView | null>(null);
  const focused = useRef<string | null>(null);
  const timelineFromControlsAt = useRef(0);

  const onSurfaceFocus = useCallback(() => {
    focused.current = PLAYER_SURFACE_ID;
    entryGuard.landed();
  }, [entryGuard]);
  const onTimelineFocus = useCallback(() => {
    // From the controls row below (an ↑); «Ещё 15 мин» (Story 14.2) is above the timeline.
    timelineFromControlsAt.current =
      focused.current !== null && PLAYER_CONTROL_IDS.has(focused.current) && focused.current !== PLAYER_SLEEP_EXTEND_ID
        ? Date.now()
        : 0;
    focused.current = PLAYER_TIMELINE_ID;
  }, []);
  const onPlayPauseFocus = useCallback(() => {
    focused.current = PLAYER_PLAYPAUSE_ID;
  }, []);
  const onRetryFocus = useCallback(() => {
    focused.current = PLAYER_RETRY_ID;
  }, []);
  const onBackFocus = useCallback(() => {
    focused.current = PLAYER_BACK_ID;
  }, []);
  const onSettingsFocus = useCallback(() => {
    focused.current = PLAYER_SETTINGS_ID;
  }, []);
  const onControlFocus = useCallback((id: string) => {
    focused.current = id;
  }, []);
  const onStripItemFocus = useCallback((id: string) => {
    focused.current = id;
  }, []);
  const onExtendFocus = useCallback(() => {
    focused.current = PLAYER_SLEEP_EXTEND_ID;
  }, []);
  const focusExtend = useCallback(() => {
    focusSoon(() => extendView.current, { guard: () => focused.current !== PLAYER_SLEEP_EXTEND_ID });
  }, []);

  // «Восстанавливаем воспроизведение…» has no action: focus on the surface (Story 4.4).
  const surfaceFocusable = phase === 'loading' || phase === 'recovering' || (playing && !overlay);
  useEffect(() => {
    const [view, id] =
      errorTarget === 'retry'
        ? [retryView, PLAYER_RETRY_ID]
        : errorTarget === 'back'
          ? [backView, PLAYER_BACK_ID]
          : playing && overlay && stripOpen
            ? [stripView, CHAPTER_ITEM_PREFIX]
            : playing && overlay && warnFocus
            ? [extendView, PLAYER_SLEEP_EXTEND_ID]
            : playing && overlay
            ? overlayFocus === 'playPause'
              ? [playPauseView, PLAYER_PLAYPAUSE_ID]
              : [timelineView, PLAYER_TIMELINE_ID]
            : surfaceFocusable
              ? [surfaceView, PLAYER_SURFACE_ID]
              : [null, null];
    if (view === null || !isActive() || sheetOpenRef.current) {
      return;
    }
    // In the strip, any of its items counts as arrived (the user may have moved already).
    const arrived = () =>
      id === CHAPTER_ITEM_PREFIX ? (focused.current ?? '').startsWith(CHAPTER_ITEM_PREFIX) : focused.current === id;
    return focusSoon(() => view.current, {
      guard: () => !arrived() && isActive() && !sheetOpenRef.current,
    });
  }, [errorTarget, playing, overlay, surfaceFocusable, isActive, overlayFocus, sheetOpenRef, stripOpen, warnFocus]);

  return {
    surfaceView,
    timelineView,
    playPauseView,
    retryView,
    backView,
    stripView,
    extendView,
    focused,
    timelineFromControlsAt,
    surfaceFocusable,
    onSurfaceFocus,
    onTimelineFocus,
    onPlayPauseFocus,
    onRetryFocus,
    onBackFocus,
    onSettingsFocus,
    onControlFocus,
    onStripItemFocus,
    onExtendFocus,
    focusExtend,
  };
}
