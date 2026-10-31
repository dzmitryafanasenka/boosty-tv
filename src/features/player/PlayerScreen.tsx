import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { HttpClient } from '../../shared/api';
import type { MediaRef } from '../../shared/entities/post';
import type { LiveRef } from '../../shared/entities/stream';
import { useLatestRef } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { PlayerEngineView } from '../../shared/platform/PlayerEngineView';
import { useProgressRepository } from '../../shared/services/progress';
import { Button, Spinner, Text, colors, spacing } from '../../shared/ui';
import { PlayerOverlay } from './PlayerOverlay';
import { createLiveMode, createVodMode } from './playbackMode';
import { errorCopy, errorTarget } from './playerPhase';
import { usePlaybackSession, type PlayerStart } from './usePlaybackSession';
import { useLiveHeartbeat } from './useLiveHeartbeat';
import { liveCopy, splitMediaRef, useLiveUnplayableExit } from './useLivePlayback';
import { PLAYER_BACK_ID, PLAYER_RETRY_ID, PLAYER_SURFACE_ID, useOverlayTimers, usePlayerFocus } from './usePlayerFocus';
import { useEntryGuard, usePlayerKeys } from './usePlayerKeys';
import { usePlayerAccessEnd, usePlayerProgress } from './usePlayerProgress';
import { useSheetOpen, usePlayerSettings } from './usePlayerSettings';
import { usePlayerSource } from './usePlayerSource';

export { BUFFER_SPINNER_MS, OVERLAY_HIDE_MS, PLAYER_BACK_ID, PLAYER_RETRY_ID, PLAYER_SURFACE_ID } from './usePlayerFocus';
export { ENTRY_GUARD_MS, HOLD_REPEAT_MS } from './usePlayerKeys';
export { SKIP_STEP_SEC, type PlayerStart } from './usePlaybackSession';
export { SOURCE_REFRESH_AGE_MS } from './playbackMode';

export type PlayerScreenProps = {
  /** The active session's content client (from the route; never a singleton). */
  http: HttpClient;
  /**
   * The video to play (route params: ids only, AD-9), or a live stream
   * (Story 7.2, `LiveRef {blogUrl}`): the live mode (no progress, no seek).
   */
  mediaRef: MediaRef | LiveRef;
  /** The Player route is the focused route (a closing one ignores the remote). */
  isActive: () => boolean;
  /** Leave the player: the route pops and focus returns to the origin element. */
  onExit: () => void;
  /**
   * Story 4.4: a fresh E8 during a recovery or a retry says locked and the
   * session check confirmed it: leave for the Post, which refetches and shows
   * its own locked notice. Default: `onExit`.
   */
  onNoAccess?: () => void;
  /**
   * Story 4.5: the engine reported the real end (the final position is
   * already reported): leave for the origin, no autoplay. Default: stay
   * paused at the end (a later play starts over from 0).
   */
  onEnded?: () => void;
  /**
   * Story 4.2: `resume` (default) starts at the resume point, `beginning` at
   * 0; Story 6.3: `{atSec}` at that second (a timestamp link).
   */
  start?: PlayerStart;
  /**
   * Story 7.2 (live only): the fresh E15 says the stream is live but not
   * playable here (`hasAccess: false` or no live-edge URL): leave, so the
   * origin shows the stream page's QR. Default: `onExit`.
   */
  onLiveUnplayable?: () => void;
  /** Story 8.1: `phaseFlags.speed` (from the route): the «Скорость» row for recordings (live ignores it). */
  speedEnabled: boolean;
  /**
   * Story 8.2: a hint in the overlay's top band («Внешний плеер не найден»
   * after a system-player fallback). The overlay shows once when playback
   * starts, so the hint is seen; it then hides by the usual rules. Nothing
   * else changes.
   */
  notice?: string;
};

/**
 * G Плеер (Story 4.1, docs/focus-map.md §4 G): full screen, no sidebar.
 *
 * - A fresh E8 (MediaResolver) picks the source: HLS, else DASH, else the
 *   highest progressive within the device cap. A locked post on that E8 →
 *   «Нет доступа к этому видео» + «Назад»; no usable URL or an E8 failure
 *   → «Не удалось воспроизвести видео» + «Повторить» (one fresh E8) /
 *   «Назад».
 * - Recovery (Story 4.4): the first engine error (also before `onLoad`)
 *   shows «Восстанавливаем воспроизведение…» (no action, focus on the
 *   surface, Back exits, other keys ignored) and sends one fresh E8 that
 *   keeps the quality key and continues at the broken source's position
 *   through the start gate; the progress session continues. A second error
 *   before the recovered source played 30 s, or a failed recovery E8, shows
 *   the error state; its «Повторить» continues the same way, but drops a
 *   non-`auto` quality for this run. A locked fresh E8 after playback
 *   (session checked) leaves for the Post (`onNoAccess`).
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
 * - Settings (Story 4.3): «Настройки» (right of play/pause) and the Menu /
 *   Info keys open the settings sheet (`PlayerSettingsSheet`, the one modal
 *   host, a right side sheet). While it is open the overlay never hides, the
 *   player ignores the remote (the sheet owns it) and playback continues.
 *   A quality pick stores the device preference, remounts the engine with
 *   that source of the same E8 (no new request) and seeks to the current
 *   (or pending) position through the start gate (no `begin`, no t=0); the
 *   sheet closes with focus on «Настройки». The stored preference feeds
 *   `pickSource` on every open.
 * - No autoplay of the next video (Story 4.5).
 * - Live (Story 7.2, `LiveRef`, focus-map G9–G11) and the Story 7.3
 *   heartbeat: see `useLivePlayback.ts`.
 *
 * Structure (the live/VOD split before Epic 8): this screen only wires and
 * renders. Every live/VOD decision is a `PlaybackMode` (`playbackMode.ts`);
 * `usePlaybackSession` owns the engine state and refs and executes the
 * mode's intents; `playerPhase.ts` derives the phase, the error target and
 * copy; `usePlayerSource`, `usePlayerSettings`, `usePlayerFocus`,
 * `usePlayerProgress` and `usePlayerKeys` hold the other concerns. The hook
 * call order below is the effect order and must be kept.
 */
export function PlayerScreen({
  http,
  mediaRef,
  isActive,
  onExit,
  onNoAccess,
  onEnded,
  start = 'resume',
  onLiveUnplayable,
  speedEnabled,
  notice,
}: PlayerScreenProps) {
  // Story 7.2: the ref kind is fixed for a mounted player (route params).
  const { liveRef, vodRef } = splitMediaRef(mediaRef);
  const isLive = liveRef !== null;
  const progressRepository = useProgressRepository();
  // Every live/VOD decision (playbackMode.ts); no progress is ever written for live.
  const mode = useMemo(
    () => (isLive ? createLiveMode() : createVodMode(progressRepository, { speed: speedEnabled })),
    [isLive, progressRepository, speedEnabled],
  );
  // Hook order is effect order: source, session, heartbeat, overlay timers,
  // settings, focus, progress and lifecycle, remote, access endings, live exit.
  const source = usePlayerSource(http, mode, liveRef, vodRef);
  const session = usePlaybackSession({ mode, source, vodRef, start, onEnded });
  const { phase, state, ready, failed, playing, seek, view, commands } = session;
  const { paused, overlay } = view;

  // Story 7.3: the live viewer heartbeat (E16 every 30 s while watching; one
  // stop on the end or the unmount). VOD: disabled (no blog).
  useLiveHeartbeat(http, liveRef?.blogUrl ?? null, mode.heartbeat && playing && !paused, phase === 'ended');

  const sheet = useSheetOpen();
  const spinner = useOverlayTimers({
    playing,
    buffering: view.buffering,
    overlay,
    paused,
    seeking: view.seeking,
    sheetOpen: sheet.sheetOpen,
    interaction: view.interaction,
    hideOverlay: commands.hideOverlay,
  });

  /** Story 7.2 (owner decision 2026-10-30): live shows the gear only with a real quality choice. */
  const settingsShown = ready !== null && mode.settingsShown(ready.sources);
  const settings = usePlayerSettings({
    sheet,
    ready,
    autoHeight: view.autoHeight,
    phase,
    settingsShown,
    showOverlay: commands.showOverlay,
    pickQuality: commands.pickQuality,
    speed: mode.speedShown ? source.speed : null,
    pickSpeed: commands.pickSpeed,
  });

  // Live (Story 7.2): only a failed E15 request offers «Повторить»; a broken
  // live source after its one recovery shows «Назад» only.
  const retryable = phase === 'error' && mode.retryable(state);
  const target = errorTarget(phase, retryable);
  const entryGuard = useEntryGuard();
  const focus = usePlayerFocus({
    phase,
    overlay,
    errorTarget: target,
    overlayFocus: mode.overlayFocus,
    isActive,
    sheetOpenRef: sheet.sheetOpenRef,
    entryGuard,
  });

  usePlayerProgress({
    progress: mode.progress,
    vodRef,
    readyResolution: session.readyResolution,
    readyProgressRef: session.progress.readyProgressRef,
    reportRef: session.progress.reportRef,
    // Story 4.6: the session pauses itself; the settings sheet closes in between.
    onBackground: () => commands.background(settings.closeSheet),
    onForeground: commands.foreground,
  });

  // Story 8.2: show the overlay once when playback starts, so the notice is
  // read. Epic 8 retro A5: the notice goes when that overlay hides while the
  // video plays (the auto-hide, or Back); a hide caused by an error, a
  // recovery or leaving playback keeps it for the next show.
  const noticeShown = useRef(false);
  const [noticeDone, setNoticeDone] = useState(false);
  const showOverlayRef = useLatestRef(commands.showOverlay);
  useEffect(() => {
    if (notice && playing && !noticeShown.current) {
      noticeShown.current = true;
      showOverlayRef.current();
    }
  }, [notice, playing, showOverlayRef]);
  const noticeOverlayOpen = useRef(false);
  useEffect(() => {
    if (!noticeShown.current) {
      return;
    }
    if (overlay) {
      noticeOverlayOpen.current = true;
    } else if (noticeOverlayOpen.current) {
      // Hidden while playing: read. Hidden by an error or a recovery: not
      // yet, so the next show (of a playing video) counts again.
      noticeOverlayOpen.current = false;
      if (playing) {
        setNoticeDone(true);
      }
    }
  }, [overlay, playing]);
  const shownNotice = noticeDone ? undefined : notice;

  /** Exit (Back, Stop, «Назад»): report, then leave. */
  const onExitRef = useLatestRef(onExit);
  const report = session.progress.report;
  const exitPlayer = useCallback(() => {
    report('exit');
    onExitRef.current();
  }, [report, onExitRef]);

  const { onSurfacePress } = usePlayerKeys({
    phase,
    overlay,
    isActive,
    canSeek: mode.canSeek,
    seek,
    focused: focus.focused,
    sheetOpenRef: sheet.sheetOpenRef,
    entryGuard,
    hideOverlay: commands.hideOverlay,
    showOverlay: commands.showOverlay,
    seekBy: commands.seekBy,
    togglePause: commands.togglePause,
    setPlaying: commands.setPlaying,
    exitPlayer,
    openSettings: settings.openSettings,
  });

  usePlayerAccessEnd({
    state,
    everReady: session.everReady,
    isActive,
    reportRef: session.progress.reportRef,
    onNoAccess: onNoAccess ?? onExit,
    progress: mode.progress,
    vodMediaId: vodRef?.mediaId ?? null,
  });

  // Story 7.2: live but not playable here (no access, no live-edge URL):
  // leave at once, so the origin shows the stream page's QR.
  useLiveUnplayableExit(source.liveUnplayable, onLiveUnplayable ?? onExit);

  // --------------------------------------------------------------- render

  // Story 7.2: `ended` is live only; live copy comes from `liveCopy`.
  const liveText = isLive ? liveCopy({ ended: phase === 'ended', loading: phase === 'loading', state }) : null;
  const copy = errorCopy(phase, state, liveText?.state ?? null);

  return (
    <View testID="player/page" style={styles.root}>
      <Pressable
        ref={focus.surfaceView}
        testID={PLAYER_SURFACE_ID}
        focusable={focus.surfaceFocusable}
        accessibilityLabel={liveText?.surfaceLabel ?? (phase === 'loading' ? t('player.loading') : t('player.surface'))}
        onFocus={focus.onSurfaceFocus}
        onPress={onSurfacePress}
        style={styles.surface}
      >
        {ready !== null && !failed && phase !== 'ended' && source.progressReady && source.preferenceReady ? (
          <PlayerEngineView
            // A new E8 or a quality switch (Story 4.3) remounts the engine;
            // so does a live play after a pause (Story 7.2: the live edge).
            key={`${ready.resolution}:${ready.source.type}:${source.epoch}`}
            {...session.engineProps}
            testID="player/engine"
            source={{ uri: ready.source.url, format: ready.source.format }}
          />
        ) : null}
      </Pressable>
      {phase === 'loading' || phase === 'recovering' || spinner ? (
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
          positionSec={view.positionSec}
          durationSec={view.durationSec}
          seekTargetSec={view.seekTarget}
          rate={view.rate}
          onTogglePause={commands.onOk}
          onTimelineFocus={focus.onTimelineFocus}
          onPlayPauseFocus={focus.onPlayPauseFocus}
          onSkip={commands.onSkip}
          onControlFocus={focus.onControlFocus}
          onOpenSettings={settings.openSettings}
          onSettingsFocus={focus.onSettingsFocus}
          timelineRef={focus.timelineView}
          playPauseRef={focus.playPauseView}
          settingsRef={settings.settingsView}
          live={ready.live}
          showSettings={settingsShown}
          notice={shownNotice}
        />
      ) : null}
      {phase === 'recovering' ? (
        <View testID="player/state/recovering" style={styles.recovering} pointerEvents="none">
          <Text variant="title-m" accessibilityRole="header" accessibilityLiveRegion="polite">
            {t('player.recovering')}
          </Text>
        </View>
      ) : null}
      {target !== null ? (
        <View testID={`player/state/${phase}`} style={styles.state}>
          <Text variant="title-l" accessibilityRole="header">
            {copy.title}
          </Text>
          <Text variant="body-s" color="text-secondary" style={styles.stateBody}>
            {copy.body}
          </Text>
          <View style={styles.actions}>
            {retryable ? (
              <Button
                ref={focus.retryView}
                testID={PLAYER_RETRY_ID}
                kind="primary"
                label={t('common.retry')}
                // A locked answer whose session check still runs is not
                // done yet: «Повторить» stays busy until it exits or stays.
                busy={source.media.isFetching || (state.kind === 'locked' && !state.confirmed)}
                onPress={commands.onRetry}
                onFocus={focus.onRetryFocus}
                style={styles.action}
              />
            ) : null}
            <Button
              ref={focus.backView}
              testID={PLAYER_BACK_ID}
              kind="secondary"
              label={t('common.back')}
              onPress={exitPlayer}
              onFocus={focus.onBackFocus}
              style={styles.action}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

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
  recovering: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    // Under the centered spinner.
    paddingTop: spacing['safe-x'] * 3,
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
