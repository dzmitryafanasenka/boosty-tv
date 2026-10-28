import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  View,
  useTVEventHandler,
} from 'react-native';
import type { HttpClient } from '../../shared/api';
import type { MediaRef } from '../../shared/entities/post';
import { useLatestRef } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { subscribeAppBackground } from '../../shared/platform/appLifecycle';
import { playbackArbiter } from '../../shared/platform/playbackArbiter';
import type { PlayerEngineHandle } from '../../shared/platform/playerEngine';
import { PlayerEngineView } from '../../shared/platform/PlayerEngineView';
import { subscribeSeekKeys, type SeekKeyEvent } from '../../shared/platform/seekKeys';
import { useProgressRepository, type ProgressEvent } from '../../shared/services/progress';
import {
  Button,
  Spinner,
  Text,
  colors,
  motion,
  requestHostFocus,
  spacing,
  type HostView,
} from '../../shared/ui';
import { useMediaSource } from './mediaResolver';
import { PLAYER_PLAYPAUSE_ID, PLAYER_TIMELINE_ID, PlayerOverlay } from './PlayerOverlay';
import { createSeekController, type SeekDirection } from './seekController';

/** Focus ids (docs/focus-map.md §1.5). */
export const PLAYER_SURFACE_ID = 'player/surface';
export const PLAYER_RETRY_ID = 'player/error/retry';
export const PLAYER_BACK_ID = 'player/error/back';

/** The overlay hides after this long without input, only while playing. */
export const OVERLAY_HIDE_MS = motion['overlay-hide'].delay;
/** Buffering shows the spinner only after this long. */
export const BUFFER_SPINNER_MS = motion['buffer-delay'].delay;
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

type Phase = 'loading' | 'playing' | 'error' | 'locked' | 'unavailable';

/** Where playback starts (Story 4.2): the resume point, or 0 («С начала»). */
export type PlayerStart = 'resume' | 'beginning';

/**
 * The start-position gate of one source (Story 4.2): no progress is
 * reported before the start position is reached (never a pre-seek `t=0`).
 * - `load`: waiting for `onLoad` (and the local store);
 * - `seek`: the initial seek to `target` is in flight (until its `onSeekDone`);
 * - `first`: starting at 0, the first progress event starts reporting;
 * - `started`: reports flow.
 */
type StartGate =
  | { kind: 'load' }
  | { kind: 'seek'; target: number }
  | { kind: 'first' }
  | { kind: 'started' };

export type PlayerScreenProps = {
  /** The active session's content client (from the route; never a singleton). */
  http: HttpClient;
  /** The video to play (route params: ids only, AD-9). */
  mediaRef: MediaRef;
  /** The Player route is the focused route (a closing one ignores the remote). */
  isActive: () => boolean;
  /** Leave the player: the route pops and focus returns to the origin element. */
  onExit: () => void;
  /** Story 4.2: `resume` (default) starts at the resume point, `beginning` at 0. */
  start?: PlayerStart;
};

/**
 * G Плеер (Story 4.1, docs/focus-map.md §4 G): full screen, no sidebar.
 *
 * - A fresh E8 (MediaResolver) picks the source: HLS, else DASH, else the
 *   highest progressive within the device cap. A locked post on that E8 →
 *   «Нет доступа к этому видео» + «Назад»; no usable URL, an E8 failure or
 *   a start failure → «Не удалось воспроизвести видео» + «Повторить» (one
 *   fresh E8) / «Назад». Full recovery is Story 4.4.
 * - Playback goes through the PlayerEngine port; the player holds the one
 *   PlaybackArbiter slot while it plays, and unmount releases both.
 * - Remote (`useTVEventHandler`, key up only): ← → seek (`seekController`:
 *   5 s steps, accelerating on quick presses, one commit 600 ms after the
 *   last press, building on the pending target); ↑ ↓ show the overlay; OK
 *   (the surface, the timeline, play/pause) and Play/Pause toggle; FF/Next
 *   forward, Rew/Prev back; Stop exits. The first key up right after focus
 *   lands on the player is ignored (also OK on the surface). ← → also come
 *   natively on key down (`seekKeys`): a held key seeks with a growing step;
 *   after a hold the target stays pending (OK or Play/Pause commits, Back or
 *   5 s idle cancels). Seek presses are ignored until the duration is
 *   known. OK or Play during a pending seek commits it at once. Playing after
 *   the end starts over from 0. Media keys are unverified on the device.
 * - Overlay: shown on OK, arrows, pause and media keys; hides after 5 s
 *   only while playing (never paused, seeking or on error). Focus: the
 *   surface while hidden; the timeline when it shows (↓ play/pause).
 * - Spinner after 500 ms of buffering.
 * - Back: overlay shown → hide it (focus → the surface); otherwise exit.
 * - Progress (Story 4.2, ProgressRepository): `begin` when the source is
 *   ready; after `onLoad` one seek to `resumePoint` (or 0 for «С начала»);
 *   reports only after that seek is done (or, starting at 0, from the first
 *   progress event); then `tick` on progress, `pause` on a user pause (not a
 *   hold-scrub pause), `end`, `background`, `exit` (Stop, Back, «Назад»,
 *   unmount). The repository decides when E9 is written.
 * - No quality sheet or autoplay of the next video (Stories 4.3–4.5).
 */
export function PlayerScreen({ http, mediaRef, isActive, onExit, start = 'resume' }: PlayerScreenProps) {
  const progress = useProgressRepository();
  const media = useMediaSource(http, mediaRef, progress?.onServerProgress);
  // The local store is loaded before the engine starts, so the resume point
  // is known at `onLoad` (a cold start reads the persisted entry).
  const [progressReady, setProgressReady] = useState(() => progress === null || progress.store.isReady());
  useEffect(() => {
    if (progress === null) {
      return;
    }
    let alive = true;
    progress.ready().then(() => {
      if (alive) {
        setProgressReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [progress]);
  const { state } = media;
  const ready = state.kind === 'ready' ? state : null;
  /** The resolution whose playback failed to start or broke. */
  const [failedResolution, setFailedResolution] = useState<number | null>(null);
  const failed = ready !== null && failedResolution === ready.resolution;
  const phase: Phase =
    state.kind === 'loading'
      ? 'loading'
      : state.kind === 'locked'
        ? 'locked'
        : state.kind === 'unavailable'
          ? 'unavailable'
          : state.kind === 'ready' && !failed
            ? 'playing'
            : 'error';
  const resolution = ready?.resolution ?? 0;

  const [paused, setPaused] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [spinner, setSpinner] = useState(false);
  const [overlay, setOverlay] = useState(false);
  /** Bumped on every input that shows the overlay: restarts the auto-hide. */
  const [interaction, setInteraction] = useState(0);
  const [, setSeekTick] = useState(0);

  const engine = useRef<PlayerEngineHandle>(null);
  /** Playback ran when the current hold-scrub started (resume when it ends). */
  const scrubWasPlaying = useRef(false);
  const pausedRef = useLatestRef(paused);
  /** The engine reported the end: the next play starts over from 0. */
  const ended = useRef(false);
  const seek = useMemo(
    () =>
      createSeekController({
        onCommit: target => {
          ended.current = false;
          engine.current?.seek(target);
        },
        onChange: () => setSeekTick(n => n + 1),
        // A hold-scrub pauses playback (owner decision 2026-10-27, like
        // YouTube on Android TV) and resumes it when it ends (OK commits;
        // Back or 5 s idle cancel) if it was playing before the hold. No
        // progress is written for these pauses.
        onHeldStart: () => {
          scrubWasPlaying.current = !pausedRef.current;
          setPaused(true);
        },
        onHeldEnd: () => {
          if (scrubWasPlaying.current) {
            scrubWasPlaying.current = false;
            setPaused(false);
          }
        },
      }),
    [pausedRef],
  );
  useEffect(() => () => seek.reset(), [seek]);
  const seeking = seek.isSeeking();
  const seekTarget = seek.target();

  /** The start-position gate of the current source (Story 4.2). */
  const gate = useRef<StartGate>({ kind: 'load' });
  /** The first source of this player opening starts at `start`; a later one (retry) resumes. */
  const startMode = useRef<PlayerStart>(start);

  // A new resolution (a fresh E8) starts the engine over.
  useEffect(() => {
    gate.current = { kind: 'load' };
    seek.reset();
    scrubWasPlaying.current = false;
    ended.current = false;
    setPaused(false);
    setPositionSec(0);
    setDurationSec(0);
    setBuffering(true);
  }, [resolution, seek]);

  // The one playback slot (AD-19): claimed while playing, released on
  // leaving that phase and on unmount. Another holder is stopped.
  const playing = phase === 'playing';
  useEffect(() => {
    if (!playing) {
      return;
    }
    return playbackArbiter.claim({ stop: () => setPaused(true) });
  }, [playing]);

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
  const mayHide = overlay && playing && !paused && !seeking;
  useEffect(() => {
    if (!mayHide) {
      return;
    }
    const timer = setTimeout(() => setOverlay(false), OVERLAY_HIDE_MS);
    return () => clearTimeout(timer);
  }, [mayHide, interaction]);

  // The overlay exists only while playing.
  useEffect(() => {
    if (!playing) {
      setOverlay(false);
    }
  }, [playing]);

  // ---------------------------------------------------------------- focus

  const surfaceView = useRef<HostView | null>(null);
  const timelineView = useRef<HostView | null>(null);
  const retryView = useRef<HostView | null>(null);
  const backView = useRef<HostView | null>(null);
  /** The focused player element (raw ← → seek only off play/pause). */
  const focused = useRef<string | null>(null);
  /** When focus first landed on the player (the entry guard), and whether a key used it up. */
  const entry = useRef<{ at: number; used: boolean }>({ at: Date.now(), used: false });
  const firstSurfaceFocus = useRef(true);

  const onSurfaceFocus = useCallback(() => {
    focused.current = PLAYER_SURFACE_ID;
    if (firstSurfaceFocus.current) {
      firstSurfaceFocus.current = false;
      entry.current = { at: Date.now(), used: false };
    }
  }, []);
  const onTimelineFocus = useCallback(() => {
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

  // Where focus goes for each phase and overlay state. The element that
  // had focus can disappear in the same commit (the surface turning
  // non-focusable under the overlay, the overlay unmounting, the error panel
  // replacing the surface): Android then moves focus to the first focusable
  // view of the window, on a covered screen. So the request is repeated two
  // frames later unless focus already arrived (as the modal host does; on
  // the device only the late request stuck); both requests only while the
  // player is still the focused route (a locked E8's session check can end in A11
  // within those frames: Epic 3 retro A6).
  const surfaceFocusable = phase === 'loading' || (playing && !overlay);
  const errorTarget = phase === 'error' ? 'retry' : phase === 'locked' || phase === 'unavailable' ? 'back' : null;
  useEffect(() => {
    const [view, id] =
      errorTarget === 'retry'
        ? [retryView, PLAYER_RETRY_ID]
        : errorTarget === 'back'
          ? [backView, PLAYER_BACK_ID]
          : playing && overlay
            ? [timelineView, PLAYER_TIMELINE_ID]
            : surfaceFocusable
              ? [surfaceView, PLAYER_SURFACE_ID]
              : [null, null];
    if (view === null || !isActive()) {
      return;
    }
    requestHostFocus(view.current);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (focused.current !== id && isActive()) {
          requestHostFocus(view.current);
        }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [errorTarget, playing, overlay, surfaceFocusable, isActive]);

  // -------------------------------------------------------------- actions

  const showOverlay = useCallback(() => {
    setOverlay(true);
    setInteraction(n => n + 1);
  }, []);

  const live = useLatestRef({ phase, overlay, paused, positionSec, durationSec, isActive, onExit, mediaRef });

  /**
   * One progress report (Story 4.2), only once the start position was
   * reached; the repository decides whether E9 is written.
   */
  const reportProgress = useCallback(
    (event: ProgressEvent, positionOverride?: number) => {
      if (progress === null || gate.current.kind !== 'started') {
        return;
      }
      const { positionSec: position, durationSec: duration, mediaRef: ref } = live.current;
      progress.report(ref, positionOverride ?? position, event, duration > 0 ? duration : null);
    },
    [progress, live],
  );
  const reportRef = useLatestRef(reportProgress);

  // `begin` once per source (a fresh E8: a new resolution), with the video's meta.
  const readyResolution = ready?.resolution ?? null;
  const readyProgressRef = useLatestRef(ready?.progress ?? null);
  useEffect(() => {
    const meta = readyProgressRef.current;
    if (progress !== null && readyResolution !== null && meta !== null) {
      progress.begin(live.current.mediaRef, meta);
    }
  }, [progress, readyResolution, readyProgressRef, live]);

  // Background: a forced write (best effort; the app may be stopped).
  useEffect(() => subscribeAppBackground(() => reportRef.current('background')), [reportRef]);
  // Unmount (any exit path): a forced write, not awaited.
  useEffect(() => () => reportRef.current('exit'), [reportRef]);

  /** Exit (Back, Stop, «Назад»): report, then leave. */
  const exitPlayer = useCallback(() => {
    reportProgress('exit');
    live.current.onExit();
  }, [reportProgress, live]);

  /** The entry guard: true for the first input right after focus landed here (used up once). */
  const entryGuarded = useCallback(() => {
    if (entry.current.used) {
      return false;
    }
    entry.current.used = true;
    return Date.now() - entry.current.at <= ENTRY_GUARD_MS;
  }, []);

  /** Play or pause; playing after the end starts over from 0 (the ended engine never restarts by itself). */
  const setPlaying = useCallback(
    (play: boolean) => {
      if (play && ended.current) {
        ended.current = false;
        // A replay after the end is a new progress session from 0 (a short
        // visit writes nothing, owner decision 2026-10-28); reports wait for
        // the seek to 0, as for a new source.
        const meta = readyProgressRef.current;
        if (progress !== null && meta !== null) {
          progress.begin(live.current.mediaRef, meta);
          gate.current = { kind: 'seek', target: 0 };
        }
        engine.current?.seek(0);
        setPositionSec(0);
      }
      if (!play && !live.current.paused) {
        // A user pause (never a hold-scrub pause: that one sets `paused` itself).
        reportProgress('pause');
      }
      setPaused(!play);
      showOverlay();
    },
    [showOverlay, reportProgress, live, progress, readyProgressRef],
  );
  const togglePause = useCallback(() => setPlaying(live.current.paused), [live, setPlaying]);
  /**
   * OK on the timeline or play/pause (owner decision, Story 4.1 device
   * check): during a pending seek it commits the target at once and keeps
   * playing; otherwise it toggles play/pause.
   */
  const onOk = useCallback(() => {
    if (seek.commitNow()) {
      showOverlay();
      return;
    }
    togglePause();
  }, [seek, showOverlay, togglePause]);

  /** A seek press; ignored (overlay only) until the duration is known. */
  const seekBy = useCallback(
    (direction: SeekDirection) => {
      const { positionSec: position, durationSec: duration } = live.current;
      if (duration > 0) {
        seek.press(direction, position, duration);
      }
      showOverlay();
    },
    [live, seek, showOverlay],
  );

  /** OK on the surface (overlay hidden): pause and show the overlay (a pending seek: commit it). */
  const onSurfacePress = useCallback(() => {
    if (live.current.phase !== 'playing' || entryGuarded()) {
      return;
    }
    if (seek.commitNow()) {
      showOverlay();
      return;
    }
    setPlaying(false);
  }, [live, seek, showOverlay, entryGuarded, setPlaying]);

  /**
   * Hold-to-seek (native `seekKey` events, owner decision): each key down
   * seeks (a held key repeats, at most every `HOLD_REPEAT_MS`, the step
   * growing as for quick presses); after a hold the target stays pending
   * (owner decision 2026-10-27): OK or Play/Pause commits it, Back or 5 s
   * without input cancels it.
   * The React Native key up of a press handled here is swallowed, so the
   * key up that ends a hold never counts as one more press.
   */
  const hold = useRef<{ key: 'left' | 'right' | null; repeats: number; lastAt: number; ignored: boolean }>({
    key: null,
    repeats: 0,
    lastAt: 0,
    ignored: false,
  });
  const swallowUp = useRef({ left: false, right: false });
  const onSeekKey = useCallback(
    (event: SeekKeyEvent) => {
      const { phase: current, isActive: active } = live.current;
      if (!active() || current !== 'playing') {
        return;
      }
      const direction: SeekDirection = event.key === 'right' ? 1 : -1;
      const onControls = focused.current === PLAYER_PLAYPAUSE_ID;
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
        if (hold.current.ignored || onControls) {
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
    [live, seek, seekBy, showOverlay, entryGuarded],
  );
  useFocusEffect(useCallback(() => subscribeSeekKeys(onSeekKey), [onSeekKey]));

  const onTvEvent = useCallback(
    (event: HWEvent) => {
      const { phase: current, isActive: active } = live.current;
      if (!active() || current !== 'playing' || Number(event.eventKeyAction) !== KEY_UP) {
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
          if (focused.current === PLAYER_PLAYPAUSE_ID) {
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
      }
    },
    [live, seek, seekBy, showOverlay, togglePause, setPlaying, entryGuarded, exitPlayer],
  );
  useTVEventHandler(onTvEvent);

  // Back: overlay → hide it; otherwise exit (every phase).
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // A held seek target is the first Back layer: cancel it, the overlay stays.
        if (seek.isHeld()) {
          seek.cancel();
          return true;
        }
        if (live.current.overlay && live.current.phase === 'playing') {
          setOverlay(false);
          return true;
        }
        exitPlayer();
        return true;
      });
      return () => sub.remove();
    }, [live, seek, exitPlayer]),
  );

  // --------------------------------------------------------------- engine

  const onLoad = useCallback(
    ({ durationSec: d }: { durationSec: number }) => {
      setDurationSec(d);
      setBuffering(false);
      if (gate.current.kind !== 'load') {
        return;
      }
      // Story 4.2: the start position, once per source: the resume point
      // (local, else the server `timeCode`; 0 when none or finished), or 0
      // for «С начала». Reports wait until the seek there is done.
      const target =
        progress === null || startMode.current === 'beginning'
          ? 0
          : progress.resumePoint(live.current.mediaRef, d > 0 ? d : null);
      startMode.current = 'resume';
      if (target > 0) {
        gate.current = { kind: 'seek', target };
        setPositionSec(target);
        engine.current?.seek(target);
      } else {
        gate.current = { kind: 'first' };
      }
    },
    [progress, live],
  );
  const onProgress = useCallback(
    (sec: number) => {
      let current = gate.current;
      if (current.kind === 'seek' && Math.abs(sec - current.target) <= 1) {
        // The engine is at the start position even without its seek report.
        current = { kind: 'first' };
      }
      if (current.kind === 'seek' || current.kind === 'load') {
        // Before the start position: never shown as progress, never written (no pre-seek t=0).
        return;
      }
      setPositionSec(prev => (prev === sec ? prev : sec));
      if (current.kind === 'first') {
        gate.current = { kind: 'started' };
      }
      reportRef.current('tick', sec);
    },
    [reportRef],
  );
  const onSeekDone = useCallback(
    (sec: number) => {
      setPositionSec(sec);
      const current = gate.current;
      if (current.kind === 'seek') {
        // The initial seek: reporting starts here (its own report is the baseline).
        gate.current = { kind: 'started' };
        reportRef.current('tick', sec);
        return;
      }
      seek.seekDone(sec);
    },
    [seek, reportRef],
  );
  const onEnd = useCallback(() => {
    // No autoplay and no Ended flow before Story 4.5: stay paused at the end;
    // a later play starts over from 0. The final position is written (finished).
    const { durationSec: d, positionSec: p } = live.current;
    reportRef.current('end', Math.max(d, p));
    ended.current = true;
    setPaused(true);
    showOverlay();
  }, [showOverlay, live, reportRef]);
  const onError = useCallback(() => {
    seek.reset();
    setFailedResolution(resolution);
  }, [resolution, seek]);

  // --------------------------------------------------------------- render

  const retryable = phase === 'error';
  const errorCopy =
    phase === 'locked'
      ? { title: t('player.noAccessTitle'), body: t('player.noAccessBody') }
      : phase === 'unavailable'
        ? { title: t('player.unavailableTitle'), body: t('player.unavailableBody') }
        : {
            title: t('player.errorTitle'),
            body: state.kind === 'error' ? t(`error.${state.error}`) : t('player.errorBody'),
          };

  return (
    <View testID="player/page" style={styles.root}>
      <Pressable
        ref={surfaceView}
        testID={PLAYER_SURFACE_ID}
        focusable={surfaceFocusable}
        accessibilityLabel={phase === 'loading' ? t('player.loading') : t('player.surface')}
        onFocus={onSurfaceFocus}
        onPress={onSurfacePress}
        style={styles.surface}
      >
        {ready !== null && !failed && progressReady ? (
          <PlayerEngineView
            key={ready.resolution}
            ref={engine}
            testID="player/engine"
            source={{ uri: ready.source.url, format: ready.source.format }}
            paused={paused}
            onLoad={onLoad}
            onProgress={onProgress}
            onBuffering={setBuffering}
            onSeekDone={onSeekDone}
            onEnd={onEnd}
            onError={onError}
          />
        ) : null}
      </Pressable>
      {phase === 'loading' || spinner ? (
        <View testID="player/spinner" style={styles.center} pointerEvents="none">
          <View style={styles.spinnerScale}>
            <Spinner />
          </View>
        </View>
      ) : null}
      {playing && overlay && ready !== null ? (
        <PlayerOverlay
          meta={ready.meta}
          paused={paused}
          positionSec={positionSec}
          durationSec={durationSec}
          seekTargetSec={seekTarget}
          onTogglePause={onOk}
          onTimelineFocus={onTimelineFocus}
          onPlayPauseFocus={onPlayPauseFocus}
          timelineRef={timelineView}
        />
      ) : null}
      {errorTarget !== null ? (
        <View testID={`player/state/${phase}`} style={styles.state}>
          <Text variant="title-l" accessibilityRole="header">
            {errorCopy.title}
          </Text>
          <Text variant="body-s" color="text-secondary" style={styles.stateBody}>
            {errorCopy.body}
          </Text>
          <View style={styles.actions}>
            {retryable ? (
              <Button
                ref={retryView}
                testID={PLAYER_RETRY_ID}
                kind="primary"
                label={t('common.retry')}
                busy={media.isFetching}
                onPress={media.retry}
                onFocus={onRetryFocus}
                style={styles.action}
              />
            ) : null}
            <Button
              ref={backView}
              testID={PLAYER_BACK_ID}
              kind="secondary"
              label={t('common.back')}
              onPress={exitPlayer}
              onFocus={onBackFocus}
              style={styles.action}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

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
]);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  surface: {
    ...StyleSheet.absoluteFill,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerScale: {
    transform: [{ scale: 2 }],
  },
  state: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    paddingHorizontal: spacing['safe-x'] * 2,
    backgroundColor: colors.bg,
  },
  stateBody: {
    marginTop: spacing['6'],
    maxWidth: spacing['text-measure'],
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing['10'],
  },
  action: {
    marginRight: spacing['6'],
  },
});
