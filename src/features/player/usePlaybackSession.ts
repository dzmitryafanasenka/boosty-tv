import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MediaRef } from '../../shared/entities/post';
import { useLatestRef } from '../../shared/focus';
import { playbackArbiter } from '../../shared/platform/playbackArbiter';
import type { PlayerEngineHandle } from '../../shared/platform/playerEngine';
import { logger } from '../../shared/services/logger';
import type { ProgressEvent, ProgressMeta } from '../../shared/services/progress';
import { qualityOf, type MediaSourceState, type QualityKey } from './mediaResolver';
import type { PlaybackMode } from './playbackMode';
import { derivePhase, isRecovering, type Phase } from './playerPhase';
import { qualityPreference } from './qualityPreference';
import { countPlayback, createRecoveryBudget, takeRecovery, type StartGate } from './recovery';
import { createSeekController, type SeekController, type SeekDirection } from './seekController';
import { speedPreference, type PlaybackSpeed } from './speedPreference';
import type { PlayerSource } from './usePlayerSource';

/** The ±10 s controls' step (Story 4.3 owner decision). */
export const SKIP_STEP_SEC = 10;

/**
 * Where playback starts (Story 4.2): the resume point, or 0 («С начала»);
 * Story 6.3 (owner decision 2026-10-29, option b): a timestamp link's
 * second (`{atSec}`, clamped into the video).
 */
export type PlayerStart = 'resume' | 'beginning' | { atSec: number };

/**
 * Where a source that broke was (Story 4.4), for the recovery and a manual
 * retry: `target` is the explicit start of the next source (undefined: the
 * pending start, i.e. the resume point or 0 for «С начала», when the error
 * came before the start was reached); `key` the quality to keep; `byQuality`
 * whether a non-`auto` quality had chosen it; `paused` whether playback was
 * paused at the error (the next source keeps it).
 */
type Failure = { target: number | undefined; key: QualityKey; byQuality: boolean; paused: boolean };

type ReadySource = Extract<MediaSourceState, { kind: 'ready' }>;

export type PlaybackSessionInput = {
  mode: PlaybackMode;
  source: PlayerSource;
  vodRef: MediaRef | null;
  start: PlayerStart;
  /** Story 4.5: leave after the real end (VOD); undefined: stay paused at the end. */
  onEnded: (() => void) | undefined;
};

type Report = (event: ProgressEvent, positionOverride?: number) => void;

/** The engine view's props (spread onto `PlayerEngineView`; its `key` stays with the screen). */
export type EngineProps = {
  ref: RefObject<PlayerEngineHandle | null>;
  paused: boolean;
  /** Story 8.1: `PlaybackMode.rate` of the stored speed; a change never remounts the engine. */
  rate: PlaybackSpeed;
  onLoad: (event: { durationSec: number }) => void;
  onProgress: (sec: number) => void;
  onBuffering: (buffering: boolean) => void;
  onSeekDone: (sec: number) => void;
  onEnd: () => void;
  onError: () => void;
  onResolution: (height: number | null) => void;
  onAudioFocusLost: () => void;
};

/** What the render and the presentation hooks read. */
export type SessionView = {
  paused: boolean;
  positionSec: number;
  durationSec: number;
  buffering: boolean;
  /** The adaptive source's track height as the engine reports it (Story 4.3); null before a report. */
  autoHeight: number | null;
  overlay: boolean;
  /** Bumped on every input that shows the overlay: restarts the auto-hide. */
  interaction: number;
  seeking: boolean;
  seekTarget: number | null;
  /** Story 8.1: the engine's rate (the overlay's «N×» label while it is not 1). */
  rate: PlaybackSpeed;
};

/** The session's commands (every one stable unless noted). */
export type SessionCommands = {
  /** Shows the overlay and restarts its auto-hide. */
  showOverlay: () => void;
  hideOverlay: () => void;
  /** A quality pick; the caller closes the sheet. */
  pickQuality: (key: QualityKey) => void;
  /** Story 8.1: a speed pick (applies at once, stored device-scoped); the caller closes the sheet. */
  pickSpeed: (speed: PlaybackSpeed) => void;
  /** Changes with `media` on every render (as before the split). */
  setPlaying: (play: boolean) => void;
  /** Changes with `setPlaying`. */
  togglePause: () => void;
  /** OK on the timeline or play/pause: commit a pending seek, else toggle. */
  onOk: () => void;
  seekBy: (direction: SeekDirection) => void;
  onSkip: (direction: SeekDirection) => void;
  onRetry: () => void;
  /**
   * Story 4.6, background (device sleep included): a forced write (best
   * effort; the app may be stopped), then the player pauses itself, so
   * react-native-video's `onHostResume` does not restart playback; a pending
   * seek target is dropped without seeking, `closeSheet(false)` closes the
   * settings sheet, the overlay hides (the foreground's overlay is then a
   * change: focus → the timeline). Every phase: a source still loading or
   * recovering starts paused too.
   */
  background: (closeSheet: (restoreFocus: boolean) => void) => void;
  /** Story 4.6, foreground: paused, the overlay shown (focus → the timeline). */
  foreground: () => void;
};

/** The progress wiring (`usePlayerProgress`, `usePlayerAccessEnd`, the exit). */
export type SessionProgress = {
  /** One progress report, only once the start position was reached. */
  report: Report;
  reportRef: RefObject<Report>;
  /** The latest ready source's progress meta (what `begin` gets). */
  readyProgressRef: RefObject<ProgressMeta | null>;
};

export type PlaybackSession = {
  phase: Phase;
  state: MediaSourceState;
  ready: ReadySource | null;
  /** The ready source's resolution is the one that failed. */
  failed: boolean;
  /** A source of this opening was ready once (read during render). */
  everReady: RefObject<boolean>;
  readyResolution: number | null;
  playing: boolean;
  seek: SeekController;
  view: SessionView;
  engineProps: EngineProps;
  commands: SessionCommands;
  progress: SessionProgress;
};

/**
 * The player's engine session (Stories 4.1–4.7, 7.2): the engine state and
 * the refs native callbacks read synchronously (the start gate, the
 * lifecycle hold, the next start, the recovery budget), the seek
 * controller, the recovery, the progress reports and the engine callbacks.
 * Every mutation of that state lives here; the live/VOD decisions come from
 * the `PlaybackMode` intents, executed with a `switch`.
 *
 * Its effects are, in order: the seek controller's reset on unmount, the new
 * resolution, the recovery end and the PlaybackArbiter claim. `PlayerScreen`
 * calls it right after `usePlayerSource` (effect order).
 */
export function usePlaybackSession({ mode, source, vodRef, start, onEnded }: PlaybackSessionInput): PlaybackSession {
  const { media, markEnded, bumpEpoch, setPreference, setKeepQuality, liveEnded, setSpeed } = source;
  const progress = mode.progress;
  const { state } = media;
  const ready = state.kind === 'ready' ? state : null;
  /** The resolution whose playback failed to start or broke. */
  const [failedResolution, setFailedResolution] = useState<number | null>(null);
  const failed = ready !== null && failedResolution === ready.resolution;
  /**
   * The automatic recovery in progress (Story 4.4): the broken source's
   * resolution; done when the recovered source reached its start position
   * (or the recovery ends in an error, «Видео недоступно» or the no-access
   * exit).
   */
  const [recovery, setRecovery] = useState<{ from: number } | null>(null);
  /** A source of this opening was ready once: a locked E8 after that leaves for the Post. */
  const everReady = useRef(false);
  if (ready !== null) {
    everReady.current = true;
  }
  const recovering = isRecovering({ recovery, state, failed, everReady: everReady.current });
  const phase = derivePhase({ mode, liveEnded, state, recovering, failed, everReady: everReady.current });
  const resolution = ready?.resolution ?? 0;
  const readyResolution = ready?.resolution ?? null;

  const [paused, setPaused] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [autoHeight, setAutoHeight] = useState<number | null>(null);
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

  /** A quality pick waiting for its source's `onLoad` before it is stored (Story 4.3). */
  const pendingPreferenceWrite = useRef<QualityKey | null>(null);
  /** The start-position gate of the current source (Story 4.2). */
  const gate = useRef<StartGate>({ kind: 'load' });
  /** The first source of this player opening starts at `start`; a later one (retry) resumes. */
  const startMode = useRef<PlayerStart>(start);
  /**
   * The next resolution's start (Story 4.4, a recovery or a retry): its
   * `target` goes into the start gate (undefined: the pending start). Null:
   * no broken source to continue from.
   */
  const nextStart = useRef<{ target: number | undefined; paused: boolean } | null>(null);
  /** The last broken source (Story 4.4): what a manual retry continues from. */
  const lastFailure = useRef<Failure | null>(null);
  /**
   * The automatic recovery's budget (Story 4.4): one per error episode; it
   * comes back once the recovered source played `RECOVERY_BUDGET_SEC`
   * (`recovery.ts`).
   */
  const budget = useRef(createRecoveryBudget());
  /**
   * Story 4.6: the app went to the background or another app took audio
   * focus since the user last pressed play: every new source starts paused
   * (react-native-video's `onHostResume` would otherwise start it).
   */
  const heldByLifecycle = useRef(false);
  /** When the current source was resolved (Story 4.6: re-resolve before play when it is ≥ 23 h old). */
  const resolvedAt = useRef(Date.now());

  // A new resolution (a fresh E8) starts the engine over. A recovery or a
  // retry starts at the broken source's position through the start gate.
  useEffect(() => {
    if (readyResolution === null) {
      return;
    }
    resolvedAt.current = Date.now();
    const continued = nextStart.current;
    nextStart.current = null;
    gate.current = { kind: 'load', ...(continued?.target !== undefined ? { target: continued.target } : {}) };
    budget.current.last = null;
    seek.reset();
    scrubWasPlaying.current = false;
    ended.current = false;
    // A recovery or a retry keeps the paused state of the error (Story 4.4).
    setPaused((continued?.paused ?? false) || heldByLifecycle.current);
    setPositionSec(continued?.target ?? 0);
    setDurationSec(0);
    setBuffering(true);
    setAutoHeight(null);
  }, [readyResolution, seek]);

  // The recovery ends with a new source, an error or «Видео недоступно»
  // (a locked answer waits for its session check: see the no-access exit).
  useEffect(() => {
    if (recovery === null) {
      return;
    }
    if (
      (state.kind === 'ready' && state.resolution !== recovery.from && failedResolution === state.resolution) ||
      state.kind === 'error' ||
      state.kind === 'noSource' ||
      state.kind === 'unavailable'
    ) {
      setRecovery(null);
    }
  }, [recovery, state, failedResolution]);

  // The one playback slot (AD-19): claimed while playing, released on
  // leaving that phase and on unmount. Another holder is stopped.
  const playing = phase === 'playing';
  useEffect(() => {
    if (!playing) {
      return;
    }
    return playbackArbiter.claim({ stop: () => setPaused(true) });
  }, [playing]);

  const showOverlay = useCallback(() => {
    setOverlay(true);
    setInteraction(n => n + 1);
  }, []);

  const rate = mode.rate(source.speed);
  const latest = useLatestRef({ phase, overlay, paused, positionSec, durationSec, vodRef, ready });

  const report = useCallback(
    (event: ProgressEvent, positionOverride?: number) => {
      const { positionSec: position, durationSec: duration, vodRef: ref } = latest.current;
      if (progress === null || ref === null || gate.current.kind !== 'started') {
        return;
      }
      progress.report(ref, positionOverride ?? position, event, duration > 0 ? duration : null);
    },
    [progress, latest],
  );
  const reportRef = useLatestRef(report);
  const readyProgressRef = useLatestRef(ready?.progress ?? null);

  const pauseForLifecycle = useCallback(() => {
    heldByLifecycle.current = true;
    scrubWasPlaying.current = false;
    if (nextStart.current !== null) {
      nextStart.current = { ...nextStart.current, paused: true };
    }
    setPaused(true);
  }, []);

  /**
   * A quality pick (Story 4.3): the preference is stored (device scope;
   * «Авто» clears the height); when it changes the playing source, the
   * engine remounts with that source of the same E8 and starts at the
   * current position (or the pending seek target) through the start gate:
   * no report before that seek is done (never t=0), and the progress session
   * continues (no `begin`). The caller closes the sheet.
   */
  const pickQuality = useCallback(
    (key: QualityKey) => {
      const intent = mode.qualityIntent(latest.current.ready, key);
      switch (intent) {
        case 'liveSwitch':
          // Story 7.2 (owner decision 2026-10-30): the chosen live source
          // plays from the live edge (no position, no stored preference).
          setKeepQuality(key);
          gate.current = { kind: 'load' };
          setBuffering(true);
          setAutoHeight(null);
          return;
        case 'none':
          return;
        case 'switchSource':
        case 'storeOnly':
          break;
      }
      setPreference(key);
      // A pick replaces the quality a recovery kept (Story 4.4).
      setKeepQuality(null);
      // This run uses the pick at once; the device store gets it only once
      // the switched source loaded (a pick the decoder cannot play is never
      // stored, so later opens are not broken by it).
      qualityPreference.remember(key);
      if (intent === 'storeOnly') {
        // The playing source stays: it already plays, so the choice is stored.
        pendingPreferenceWrite.current = null;
        qualityPreference.write(key);
        return;
      }
      pendingPreferenceWrite.current = key;
      const startGate = gate.current;
      if (startGate.kind !== 'load') {
        // Before the start position is reached, the pending start stays the
        // start (the resume point, or its in-flight seek); after it, the
        // current position or the pending seek target.
        const target = startGate.kind === 'seek' ? startGate.target : (seek.target() ?? latest.current.positionSec);
        gate.current = { kind: 'load', target };
        setPositionSec(target);
      }
      // A held scrub paused a playing video: it resumes, as its own end would.
      if (seek.isHeld() && scrubWasPlaying.current) {
        setPaused(false);
      }
      seek.reset();
      scrubWasPlaying.current = false;
      ended.current = false;
      setBuffering(true);
      setAutoHeight(null);
    },
    [mode, latest, seek, setPreference, setKeepQuality],
  );

  /**
   * A speed pick (Story 8.1): the engine's `rate` changes from the current
   * position (no remount, no seek, no E8) and the pick is the global
   * preference for the next videos (memory at once; a failed store write is
   * only logged). Ignored where the mode has no speed (live).
   */
  const pickSpeed = useCallback(
    (next: PlaybackSpeed) => {
      if (!mode.speedShown) {
        return;
      }
      logger.info('player', 'playback speed changed', { speed: next });
      setSpeed(next);
      speedPreference.write(next);
    },
    [mode, setSpeed],
  );

  /** Play or pause; playing after the end starts over from 0 (the ended engine never restarts by itself). */
  const setPlaying = useCallback(
    (play: boolean) => {
      const current = latest.current.ready;
      const intent = mode.playIntent({
        play,
        paused: latest.current.paused,
        sourceAgeMs: current === null ? null : Date.now() - resolvedAt.current,
      });
      switch (intent) {
        case 'liveEdge':
          // Story 7.2: play after a pause returns to the live edge: the engine
          // remounts with the same source (it starts at the edge), never a
          // seek to a position.
          heldByLifecycle.current = false;
          gate.current = { kind: 'load' };
          bumpEpoch();
          setBuffering(true);
          setAutoHeight(null);
          setPaused(false);
          showOverlay();
          return;
        case 'refreshSource':
          // Story 4.6: the signed URL is (nearly) expired: one fresh E8 first
          // (the Story 4.4 path, «Восстанавливаем…», same quality, same
          // second), then play. Not an error: the recovery budget is untouched.
          if (current !== null) {
            logger.info('player', 'source is old; re-resolving before play');
            nextStart.current = {
              target: mode.recoveryTarget(gate.current, seek.target, latest.current.positionSec),
              paused: false,
            };
            seek.reset();
            setKeepQuality(qualityOf(current.source));
            setRecovery({ from: current.resolution });
            media.retry();
            return;
          }
          // No ready source to refresh: play as it is (the plain path).
          break;
        case 'plain':
          break;
      }
      if (play) {
        heldByLifecycle.current = false;
      }
      if (play && ended.current) {
        ended.current = false;
        // A replay after the end is a new progress session from 0 (a short
        // visit writes nothing, owner decision 2026-10-28); reports wait for
        // the seek to 0, as for a new source.
        const meta = readyProgressRef.current;
        const ref = latest.current.vodRef;
        if (progress !== null && ref !== null && meta !== null) {
          progress.begin(ref, meta);
          gate.current = { kind: 'seek', target: 0 };
        }
        engine.current?.seek(0);
        setPositionSec(0);
      }
      if (!play && !latest.current.paused) {
        // A user pause (never a hold-scrub pause: that one sets `paused` itself).
        report('pause');
      }
      setPaused(!play);
      showOverlay();
    },
    [showOverlay, report, latest, progress, readyProgressRef, seek, media, mode, bumpEpoch, setKeepQuality],
  );
  const togglePause = useCallback(() => setPlaying(latest.current.paused), [latest, setPlaying]);
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

  /** A seek press; ignored (overlay only) until the duration is known, and on a live stream. */
  const seekBy = useCallback(
    (direction: SeekDirection) => {
      const { positionSec: position, durationSec: duration } = latest.current;
      if (duration > 0 && mode.canSeek) {
        seek.press(direction, position, duration);
      }
      showOverlay();
    },
    [latest, seek, showOverlay, mode],
  );

  /**
   * OK on «−10 с» / «+10 с» (Story 4.3 owner decision 2026-10-28): the seek
   * target moves by exactly 10 s (quick OKs accumulate, one commit 600 ms
   * after the last, the bubble shows it, clamped); ignored (overlay only)
   * until the duration is known.
   */
  const onSkip = useCallback(
    (direction: SeekDirection) => {
      const { positionSec: position, durationSec: duration } = latest.current;
      if (duration > 0 && mode.canSeek) {
        seek.press(direction, position, duration, SKIP_STEP_SEC);
      }
      showOverlay();
    },
    [latest, seek, showOverlay, mode],
  );

  const recoveryRef = useLatestRef(recovery);
  /**
   * The source reached its start position (the gate is `started`). A
   * recovery ends here (Story 4.4): «Восстанавливаем…» goes; a recovery
   * that kept a pause shows the paused player with its overlay.
   */
  const startReached = useCallback(() => {
    gate.current = { kind: 'started' };
    if (recoveryRef.current !== null) {
      setRecovery(null);
      if (pausedRef.current) {
        showOverlay();
      }
    }
  }, [recoveryRef, pausedRef, showOverlay]);

  const onLoad = useCallback(
    ({ durationSec: d }: { durationSec: number }) => {
      setDurationSec(d);
      setBuffering(false);
      // A switched source loaded: its quality is now stored (Story 4.3).
      if (pendingPreferenceWrite.current !== null) {
        qualityPreference.write(pendingPreferenceWrite.current);
        pendingPreferenceWrite.current = null;
      }
      if (gate.current.kind !== 'load') {
        return;
      }
      // A quality switch (Story 4.3): the explicit start, no resume point.
      const explicit = gate.current.target;
      // Story 4.2: the start position, once per source: the resume point
      // (local, else the server `timeCode`; 0 when none or finished), or 0
      // for «С начала». Reports wait until the seek there is done.
      const startAt = startMode.current;
      const target =
        explicit !== undefined
          ? explicit
          : typeof startAt === 'object'
            ? // A timestamp link (Story 6.3): that second, kept inside the video.
              Math.max(0, d > 0 ? Math.min(startAt.atSec, Math.max(0, d - 1)) : startAt.atSec)
            : progress === null || latest.current.vodRef === null || startAt === 'beginning'
              ? 0
              : progress.resumePoint(latest.current.vodRef, d > 0 ? d : null);
      if (explicit === undefined) {
        startMode.current = 'resume';
      }
      if (target > 0) {
        gate.current = { kind: 'seek', target };
        setPositionSec(target);
        engine.current?.seek(target);
      } else if (latest.current.paused) {
        // Starting at 0 while paused (a recovery or retry kept the pause):
        // no progress event comes, and there is no pre-seek t=0 to skip.
        startReached();
      } else {
        gate.current = { kind: 'first' };
      }
    },
    [progress, latest, startReached],
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
        startReached();
      }
      // The recovery budget (Story 4.4) counts playback of the started source.
      countPlayback(budget.current, sec);
      reportRef.current('tick', sec);
    },
    [reportRef, startReached],
  );
  const onSeekDone = useCallback(
    (sec: number) => {
      setPositionSec(sec);
      const current = gate.current;
      // A seek is not playback: the budget counts from here.
      budget.current.last = sec;
      if (current.kind === 'seek') {
        // The initial seek: reporting starts here (its own report is the baseline).
        startReached();
        reportRef.current('tick', sec);
        return;
      }
      seek.seekDone(sec);
    },
    [seek, reportRef, startReached],
  );
  const onEndedRef = useLatestRef(onEnded);
  const onEnd = useCallback(() => {
    switch (mode.endIntent()) {
      case 'markEnded':
        // Story 7.2: «Стрим завершён» (focus on «Назад»): no write, no
        // auto-exit, no restart; the engine unmounts.
        ended.current = true;
        setPaused(true);
        markEnded();
        return;
      case 'reportEnd':
        break;
    }
    // The final position is written (finished). Story 4.5: then leave for
    // the origin (no autoplay); without `onEnded`, stay paused at the end
    // and a later play starts over from 0.
    const { durationSec: d, positionSec: p } = latest.current;
    reportRef.current('end', Math.max(d, p));
    ended.current = true;
    setPaused(true);
    const leave = onEndedRef.current;
    if (leave) {
      leave();
      return;
    }
    showOverlay();
  }, [showOverlay, latest, reportRef, onEndedRef, mode, markEnded]);
  /**
   * An engine error (Story 4.4: an expired signed URL, a CDN or decoder
   * failure, also before the first `onLoad`). With the budget left: the
   * automatic recovery, one fresh E8 (content profile) that keeps the
   * quality and continues at the broken source's position through the start
   * gate («Восстанавливаем воспроизведение…»). Otherwise the error state
   * («Повторить» focused). No E9 for the error itself.
   */
  const onError = useCallback(() => {
    // A switched source that failed before `onLoad` is never stored.
    pendingPreferenceWrite.current = null;
    const current = latest.current.ready;
    // Story 7.2: a live source always continues at the live edge (no position).
    const target = mode.recoveryTarget(gate.current, seek.target, latest.current.positionSec);
    // Paused by the user at the error (a hold-scrub pause of a playing video is not).
    const pausedAtError = latest.current.paused && !(seek.isHeld() && scrubWasPlaying.current);
    seek.reset();
    setFailedResolution(resolution);
    if (current === null) {
      return;
    }
    const failure: Failure = { target, key: qualityOf(current.source), byQuality: current.byQuality, paused: pausedAtError };
    lastFailure.current = failure;
    if (!takeRecovery(budget.current)) {
      logger.info('player', 'playback failed again; waiting for the user');
      return;
    }
    logger.info('player', 'playback failed; recovering');
    nextStart.current = { target, paused: pausedAtError };
    setKeepQuality(failure.key);
    setRecovery({ from: resolution });
    media.retry();
  }, [resolution, seek, latest, media, mode, setKeepQuality]);

  /**
   * «Повторить» (one fresh E8). After a broken source it continues from
   * there like a recovery (Story 4.4): the same position; the same quality,
   * unless a non-`auto` quality had chosen the broken source: then the
   * default order, and this run's choice becomes `auto` (memory only, the
   * stored value is kept). The budget stays used until a source plays 30 s.
   */
  const onRetry = useCallback(() => {
    const failure = lastFailure.current;
    if (failure !== null) {
      if (failure.byQuality) {
        qualityPreference.remember('auto');
        setPreference('auto');
        setKeepQuality(null);
      } else {
        setKeepQuality(failure.key);
      }
      nextStart.current = { target: failure.target, paused: failure.paused };
      budget.current.played = 0;
    }
    media.retry();
  }, [media, setPreference, setKeepQuality]);

  /** Story 4.6: another app took audio focus: a user pause (the 4.2 `pause` write). */
  const onAudioFocusLost = useCallback(() => {
    const wasPlaying = latest.current.phase === 'playing' && (!latest.current.paused || scrubWasPlaying.current);
    if (wasPlaying && !latest.current.paused) {
      // A user pause: the 4.2 `pause` write and the overlay.
      setPlaying(false);
    }
    // Also during a hold-scrub, a load or a recovery: nothing resumes by itself.
    pauseForLifecycle();
    if (wasPlaying) {
      showOverlay();
    }
  }, [latest, setPlaying, pauseForLifecycle, showOverlay]);

  const hideOverlay = useCallback(() => setOverlay(false), []);
  const background = useCallback(
    (closeSheet: (restoreFocus: boolean) => void) => {
      reportRef.current('background');
      pauseForLifecycle();
      seek.reset();
      closeSheet(false);
      setOverlay(false);
    },
    [reportRef, pauseForLifecycle, seek],
  );
  const foreground = useCallback(() => {
    if (latest.current.phase === 'playing') {
      showOverlay();
    }
  }, [latest, showOverlay]);

  return {
    phase,
    state,
    ready,
    failed,
    everReady,
    readyResolution,
    playing,
    seek,
    view: { paused, positionSec, durationSec, buffering, autoHeight, overlay, interaction, seeking, seekTarget, rate },
    engineProps: {
      ref: engine,
      paused,
      rate,
      onLoad,
      onProgress,
      onBuffering: setBuffering,
      onSeekDone,
      onEnd,
      onError,
      onResolution: setAutoHeight,
      onAudioFocusLost,
    },
    commands: {
      showOverlay,
      hideOverlay,
      pickQuality,
      pickSpeed,
      setPlaying,
      togglePause,
      onOk,
      seekBy,
      onSkip,
      onRetry,
      background,
      foreground,
    },
    progress: { report, reportRef, readyProgressRef },
  };
}
