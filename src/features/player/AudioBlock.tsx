import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TVFocusGuideView, View, useTVEventHandler } from 'react-native';
import type { AudioSourceResult } from '../../shared/entities/post';
import { useLatestRef, useZoneItem } from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
import { formatDuration } from '../../shared/i18n/format';
import { subscribeAppBackground } from '../../shared/platform/appLifecycle';
import { playbackArbiter } from '../../shared/platform/playbackArbiter';
import type { PlayerEngineHandle } from '../../shared/platform/playerEngine';
import { PlayerEngineView } from '../../shared/platform/PlayerEngineView';
import { seekKeysAvailable, subscribeSeekKeys, type SeekKeyEvent } from '../../shared/platform/seekKeys';
import { logger } from '../../shared/services/logger';
import {
  FocusableSurface,
  Spinner,
  Text,
  colors,
  rounded,
  spacing,
  type HostView,
  type SurfaceState,
} from '../../shared/ui';

/** ← / → on a focused AudioBlock move the position by this much (Story 6.4). */
export const AUDIO_SEEK_STEP_SEC = 10;
/**
 * The first ← / → this soon after focus landed on the block is ignored: it
 * belongs to the press that moved focus here (focus-map §1.1, as the
 * player's `ENTRY_GUARD_MS`).
 */
export const AUDIO_ENTRY_GUARD_MS = 500;
/** A held ← / → seeks at most this often (as the player's hold-to-seek). */
export const AUDIO_HOLD_REPEAT_MS = 200;
/**
 * A source resolved this long ago is resolved again (one fresh E8) before a
 * resume: `signedQuery` carries `expire_time` 24 h ahead (api-contract §4.1);
 * whether the host enforces it is unverified, so this only avoids the error
 * path (as the player's `SOURCE_REFRESH_AGE_MS`).
 */
export const AUDIO_SOURCE_MAX_AGE_MS = 23 * 60 * 60 * 1000;

/** Android KeyEvent.ACTION_UP: raw D-pad keys arrive as key up only (focus-map §1.1). */
const KEY_UP = 1;
/** A progress report this close to a pending seek target ends the seek. */
const SEEK_SETTLE_SEC = 2;

/** A fresh E8 for the audio `audioKey` with the shown `title` (`useAudioSource`). */
export type ResolveAudioSource = (audioKey: string, title: string) => Promise<AudioSourceResult>;

export type AudioBlockProps = {
  /** The focus id `post/<postId>/block/<blockKey>`. */
  id: string;
  /** The block key (`audio_file:<id>`, else `audio_file@<index>`). */
  audioKey: string;
  /** The trimmed title (empty → «Аудио»). */
  title: string;
  /** The block's duration in whole seconds, when the post gives one. */
  durationSec: number | null;
  /** The source on play (a fresh E8); absent → OK does nothing. */
  resolveSource?: ResolveAudioSource;
  /**
   * False while the post is not the focused route (the Player or another
   * Пост on top): a playing track pauses and never resumes by itself.
   */
  active?: boolean;
  /** The host view by focus id (the column guide, initial focus, refetch fallback). */
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
};

type Status = 'idle' | 'resolving' | 'ready' | 'error';

/**
 * H AudioBlock (Story 6.4, FR39, POST-06; DESIGN.md AudioBlock): one focus
 * stop with the play / pause glyph, the title, «position / duration» and a
 * thin progress bar.
 *
 * - OK plays or pauses. The first play sends one fresh E8
 *   (`resolveSource`) and plays `url + signedQuery` through the
 *   PlayerEngine in a 0 × 0 view (never a visible surface). The URI lives
 *   in this component's state and the engine's props only.
 * - ← / → seek ±10 s, clamped to 0…duration, without moving focus: the
 *   block sits in a guide that traps ← →, so it is the one place in the
 *   post where ← does not reach the sidebar (↑ / ↓ leave it first). Keys
 *   come from `SeekKeys` (native key down, a held key repeats at most every
 *   200 ms) while the block has focus, else (no native module) from React
 *   Native's key up. The first ← / → within 500 ms after focus landed here
 *   is ignored (the entry guard).
 * - One playback app-wide (AD-19): the block holds the PlaybackArbiter slot
 *   from the play press until it drops its source. When another holder
 *   (the Player, another AudioBlock) takes it, this one pauses, drops its
 *   source (the engine unmounts) and keeps its shown position.
 * - The app leaving the foreground (sleep included), an audio-focus loss
 *   or the post losing route focus (`active`) pause it; it never resumes
 *   by itself. Unmount (leaving the post) stops it and releases the slot.
 * - An engine error re-resolves once (a fresh E8, same block) and resumes
 *   at the last position; a second error, a failed E8 or no source (an
 *   empty `signedQuery`) shows «Не удалось воспроизвести», OK retries.
 * - The position is never persisted (parity with the reference).
 */
export const AudioBlock = memo(function AudioBlockView({
  id,
  audioKey,
  title,
  durationSec: blockDurationSec,
  resolveSource,
  active = true,
  onView,
  onFocus,
}: AudioBlockProps) {
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      onView(id, view);
    },
    [zoneRef, onView, id],
  );

  const [status, setStatus] = useState<Status>('idle');
  /** The signed URI (memory only), while resolved. */
  const [source, setSource] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [positionSec, setPositionSec] = useState(0);
  const [loadedDurationSec, setLoadedDurationSec] = useState(0);
  const [focused, setFocused] = useState(false);
  const durationSec =
    loadedDurationSec > 0 ? loadedDurationSec : blockDurationSec !== null && blockDurationSec > 0 ? blockDurationSec : 0;

  const engine = useRef<PlayerEngineHandle>(null);
  /** Values the callbacks read without re-subscribing. */
  const live = useLatestRef({ status, source, paused, positionSec, durationSec, active });
  /** Each resolve's number: a newer one (or a stop) makes a late answer stale. */
  const generation = useRef(0);
  const mounted = useRef(true);
  /** The engine reported `onLoad` for the current source (seeks go to it, else wait). */
  const loaded = useRef(false);
  /** Where a new source starts, once it loaded. */
  const pendingStart = useRef<number | null>(null);
  /** A seek in flight: progress reports before it lands are stale. */
  const pendingSeek = useRef<number | null>(null);
  /** When the current source was resolved (client clock). */
  const resolvedAt = useRef(0);
  /** The one automatic re-resolve after an engine error, per user play. */
  const recoveryUsed = useRef(false);
  /** The track reached its end: the next play starts over. */
  const ended = useRef(false);
  /** Something paused the block while its source was resolving: start paused. */
  const startPaused = useRef(false);
  /** A resolve is running (set synchronously: a second OK before the re-render sends no second E8). */
  const resolveInFlight = useRef(false);
  /** Why the last play failed: a locked post («Нет доступа к аудио») or anything else. */
  const [failure, setFailure] = useState<'locked' | 'error'>('error');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  /** Drop the source (the engine unmounts) and cancel a pending resolve. */
  const dropSource = useCallback((next: Status) => {
    generation.current += 1;
    resolveInFlight.current = false;
    loaded.current = false;
    pendingStart.current = null;
    pendingSeek.current = null;
    setSource(null);
    setPaused(true);
    setStatus(next);
  }, []);

  /**
   * One fresh E8, then play from `startAt` (also the automatic recovery);
   * `startPausedNow`: the block was paused (by the user, background, a focus loss),
   * so the new source starts paused too: never a resume by itself.
   */
  const resolveAndPlay = useCallback(
    (startAt: number, startPausedNow = false) => {
      if (resolveSource === undefined) {
        return;
      }
      generation.current += 1;
      const gen = generation.current;
      resolveInFlight.current = true;
      loaded.current = false;
      pendingStart.current = null;
      pendingSeek.current = null;
      startPaused.current = startPausedNow;
      setSource(null);
      setPaused(true);
      setStatus('resolving');
      const done = (result: AudioSourceResult | null) => {
        if (!mounted.current || gen !== generation.current) {
          return;
        }
        resolveInFlight.current = false;
        if (result?.kind !== 'ok') {
          // No URI, no position or value logged: only the outcome.
          logger.warn('audio', 'source unavailable', { kind: result?.kind ?? 'error' });
          setFailure(result?.kind === 'locked' ? 'locked' : 'error');
          dropSource('error');
          return;
        }
        resolvedAt.current = Date.now();
        pendingStart.current = startAt > 0 ? startAt : null;
        setSource(result.uri);
        setPaused(startPaused.current || !live.current.active);
        setStatus('ready');
      };
      resolveSource(audioKey, title).then(done, () => done(null));
    },
    [resolveSource, audioKey, title, dropSource, live],
  );

  // The one playback slot (AD-19): held from the play press while a source
  // is resolving or held. Another holder stops this one: pause, drop the
  // source, keep the position.
  const holding = status === 'resolving' || source !== null;
  useEffect(() => {
    if (!holding) {
      return;
    }
    return playbackArbiter.claim({
      stop: () => {
        if (mounted.current) {
          dropSource('idle');
        }
      },
    });
  }, [holding, dropSource]);

  /** Pause without dropping the source (background, focus loss, route blur). */
  const holdPaused = useCallback(() => {
    startPaused.current = true;
    setPaused(true);
  }, []);
  useEffect(() => subscribeAppBackground(holdPaused), [holdPaused]);
  useEffect(() => {
    if (!active) {
      holdPaused();
    }
  }, [active, holdPaused]);

  /** OK: play or pause. */
  const onPress = useCallback(() => {
    const current = live.current;
    if (resolveInFlight.current || current.status === 'resolving' || resolveSource === undefined) {
      return;
    }
    const from = ended.current ? 0 : current.positionSec;
    if (current.source === null || current.status !== 'ready') {
      // A user play: a fresh E8, and the recovery budget again.
      recoveryUsed.current = false;
      ended.current = false;
      if (from !== current.positionSec) {
        setPositionSec(from);
      }
      resolveAndPlay(from);
      return;
    }
    if (!current.paused) {
      startPaused.current = true;
      setPaused(true);
      return;
    }
    if (Date.now() - resolvedAt.current >= AUDIO_SOURCE_MAX_AGE_MS) {
      recoveryUsed.current = false;
      ended.current = false;
      resolveAndPlay(from);
      return;
    }
    if (ended.current) {
      ended.current = false;
      setPositionSec(0);
      if (loaded.current) {
        pendingSeek.current = 0;
        engine.current?.seek(0);
      } else {
        pendingStart.current = null;
      }
    }
    startPaused.current = false;
    setPaused(false);
  }, [live, resolveSource, resolveAndPlay]);

  /** ← (−1) / → (+1): ±10 s, clamped to 0…duration; a pending source starts there. */
  const seekBy = useCallback(
    (direction: 1 | -1) => {
      const current = live.current;
      if (current.status === 'resolving') {
        return;
      }
      // An unknown duration: no forward seek (it could pass the end).
      if (direction === 1 && current.durationSec <= 0) {
        return;
      }
      const max = current.durationSec > 0 ? current.durationSec : Number.POSITIVE_INFINITY;
      const target = Math.min(max, Math.max(0, current.positionSec + direction * AUDIO_SEEK_STEP_SEC));
      if (target === current.positionSec) {
        return;
      }
      ended.current = current.durationSec > 0 && target >= current.durationSec;
      setPositionSec(target);
      if (current.source !== null && loaded.current) {
        pendingSeek.current = target;
        engine.current?.seek(target);
      } else if (current.source !== null) {
        pendingStart.current = target;
      }
    },
    [live],
  );

  // Raw keys (AD-12: the audio block is one of the three places allowed
  // them), only while the block has focus.
  const focusedRef = useRef(false);
  const entry = useRef({ at: 0, used: true });
  const entryGuarded = useCallback(() => {
    if (entry.current.used) {
      return false;
    }
    entry.current.used = true;
    return Date.now() - entry.current.at <= AUDIO_ENTRY_GUARD_MS;
  }, []);
  const hold = useRef<{ key: 'left' | 'right' | null; lastAt: number; ignored: boolean }>({
    key: null,
    lastAt: 0,
    ignored: false,
  });
  const swallowUp = useRef({ left: false, right: false });
  const onSeekKey = useCallback(
    (event: SeekKeyEvent) => {
      if ((event.key !== 'left' && event.key !== 'right') || !focusedRef.current) {
        return;
      }
      const direction = event.key === 'right' ? 1 : -1;
      if (event.action === 'up') {
        hold.current = { key: null, lastAt: 0, ignored: false };
        return;
      }
      swallowUp.current[event.key] = true;
      const now = Date.now();
      if (event.repeat === 0 || hold.current.key !== event.key) {
        const ignored = entryGuarded();
        hold.current = { key: event.key, lastAt: now, ignored };
        if (!ignored) {
          seekBy(direction);
        }
        return;
      }
      if (!hold.current.ignored && now - hold.current.lastAt >= AUDIO_HOLD_REPEAT_MS) {
        hold.current.lastAt = now;
        seekBy(direction);
      }
    },
    [entryGuarded, seekBy],
  );
  useEffect(() => (focused ? subscribeSeekKeys(onSeekKey) : undefined), [focused, onSeekKey]);

  const onTvEvent = useCallback(
    (event: { eventType: string; eventKeyAction?: number | string }) => {
      const type = event.eventType;
      if ((type !== 'left' && type !== 'right') || !focusedRef.current || Number(event.eventKeyAction) !== KEY_UP) {
        return;
      }
      if (swallowUp.current[type]) {
        // The native key down already seeked (or ignored) this press.
        swallowUp.current[type] = false;
        return;
      }
      if (seekKeysAvailable()) {
        // A key up without a native key down: the press that moved focus here.
        return;
      }
      // Fallback (no native module): one seek on key up.
      if (!entryGuarded()) {
        seekBy(type === 'right' ? 1 : -1);
      }
    },
    [entryGuarded, seekBy],
  );
  useTVEventHandler(onTvEvent);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
    entry.current = { at: Date.now(), used: false };
    swallowUp.current = { left: false, right: false };
    setFocused(true);
    zone.onFocus();
    onFocus(id);
  }, [zone, onFocus, id]);
  const handleBlur = useCallback(() => {
    focusedRef.current = false;
    hold.current = { key: null, lastAt: 0, ignored: false };
    setFocused(false);
  }, []);

  // Engine events.
  const onLoad = useCallback(
    ({ durationSec: loadedSec }: { durationSec: number }) => {
      loaded.current = true;
      // A source that loaded gets the automatic re-resolve again for a later error.
      recoveryUsed.current = false;
      if (loadedSec > 0) {
        setLoadedDurationSec(loadedSec);
      }
      // The start never passes the loaded end.
      const pending = pendingStart.current;
      const start = pending !== null && loadedSec > 0 ? Math.min(pending, loadedSec) : pending;
      pendingStart.current = null;
      if (start !== null && start > 0) {
        setPositionSec(start);
        pendingSeek.current = start;
        engine.current?.seek(start);
      }
    },
    [],
  );
  const onProgress = useCallback((sec: number) => {
    const target = pendingSeek.current;
    if (target !== null) {
      if (Math.abs(sec - target) > SEEK_SETTLE_SEC) {
        return;
      }
      pendingSeek.current = null;
    }
    setPositionSec(sec);
  }, []);
  const onSeekDone = useCallback((sec: number) => {
    pendingSeek.current = null;
    setPositionSec(sec);
  }, []);
  const onEnd = useCallback(() => {
    ended.current = true;
    pendingSeek.current = null;
    setPaused(true);
    const duration = live.current.durationSec;
    if (duration > 0) {
      setPositionSec(duration);
    }
  }, [live]);
  const onError = useCallback(
    (code: string | null) => {
      logger.warn('audio', 'engine error', { code: code ?? 'none', recovered: recoveryUsed.current });
      if (!recoveryUsed.current) {
        // One fresh E8 (same block), then on from the last position.
        recoveryUsed.current = true;
        resolveAndPlay(live.current.positionSec, startPaused.current || live.current.paused);
        return;
      }
      dropSource('error');
    },
    [live, resolveAndPlay, dropSource],
  );

  const resolving = status === 'resolving';
  const failed = status === 'error';
  const playing = source !== null && !paused;
  const name = title.length > 0 ? title : t('audio.untitled');
  const time = `${formatDuration(positionSec)} / ${durationSec > 0 ? formatDuration(durationSec) : t('audio.durationUnknown')}`;
  const fraction = durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;
  const action = resolving ? t('audio.loading') : playing ? t('audio.pause') : t('audio.play');
  const errorText = failure === 'locked' ? t('audio.locked') : t('audio.error');
  const label = failed
    ? tf(failure === 'locked' ? 'audio.a11yLocked' : 'audio.a11yFailed', { title: name, time, error: errorText })
    : tf('audio.a11y', { title: name, time, action });

  return (
    <TVFocusGuideView testID={`${id}/guide`} trapFocusLeft trapFocusRight style={styles.guide}>
      <FocusableSurface
        ref={ref}
        testID={id}
        radius={rounded.md}
        // No scale (as the ImageStop): a 600 dp row scaled past the column
        // would overlap the text around it; the ring and the lift mark focus.
        scaleFocus={1}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: resolving }}
        onPress={onPress}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={styles.stop}
        surfaceStyle={({ focused: isFocused }: SurfaceState) => [
          styles.surface,
          { backgroundColor: isFocused ? colors['surface-focus-row'] : colors.surface },
        ]}
      >
        <View style={styles.row}>
          <View style={styles.glyphBox}>
            {resolving ? (
              <Spinner testID={`${id}/busy`} />
            ) : playing ? (
              <View testID={`${id}/pause`} style={styles.pauseGlyph}>
                <View style={styles.pauseBar} />
                <View style={styles.pauseBar} />
              </View>
            ) : (
              <View testID={`${id}/play`} style={styles.playGlyph} />
            )}
          </View>
          <View style={styles.main}>
            <Text variant="button" numberOfLines={1}>
              {name}
            </Text>
            <Text testID={`${id}/time`} variant="body-s" color="text-secondary">
              {time}
            </Text>
          </View>
        </View>
        <View style={styles.track}>
          <View testID={`${id}/bar`} style={[styles.fill, { width: `${fraction * 100}%` }]} />
        </View>
      </FocusableSurface>
      {failed ? (
        <Text
          testID={`${id}/error`}
          accessibilityLiveRegion="polite"
          variant="body-s"
          color="error-text"
          style={styles.error}
        >
          {errorText}
        </Text>
      ) : null}
      {source !== null ? (
        // The engine without a visible surface: 0 × 0, hidden from accessibility.
        <View
          testID={`${id}/engine`}
          style={styles.engineHost}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <PlayerEngineView
            key={source}
            ref={engine}
            testID={`${id}/engine-view`}
            source={{ uri: source, format: 'progressive' }}
            paused={paused}
            onLoad={onLoad}
            onProgress={onProgress}
            onSeekDone={onSeekDone}
            onEnd={onEnd}
            onError={onError}
            onAudioFocusLost={holdPaused}
          />
        </View>
      ) : null}
    </TVFocusGuideView>
  );
});

/** DESIGN.md AudioBlock: a 2 dp progress line under the row. */
const BAR_HEIGHT = 2;
const GLYPH_BOX = 32;

const styles = StyleSheet.create({
  guide: {
    alignSelf: 'stretch',
    maxWidth: spacing['text-measure'],
    marginBottom: spacing['3'],
  },
  // Android scrolls a focused view flush with the column's edge (device,
  // Story 6.4): this padding keeps the ring (offset 2 + width 2) inside the
  // scrolled rectangle, so the last block's ring is not cut off.
  stop: {
    paddingVertical: spacing['3'],
  },
  surface: {
    paddingHorizontal: spacing['6'],
    paddingTop: spacing['5'],
    paddingBottom: spacing['5'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['6'],
  },
  glyphBox: {
    width: GLYPH_BOX,
    height: GLYPH_BOX,
    borderRadius: GLYPH_BOX / 2,
    backgroundColor: colors['surface-raised'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
  },
  playGlyph: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 11,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text,
  },
  pauseGlyph: {
    flexDirection: 'row',
    gap: 3,
  },
  pauseBar: {
    width: 3,
    height: 13,
    borderRadius: 1,
    backgroundColor: colors.text,
  },
  track: {
    height: BAR_HEIGHT,
    marginTop: spacing['5'],
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: colors['surface-raised'],
  },
  fill: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: colors.accent,
  },
  error: {
    marginTop: spacing['2'],
  },
  engineHost: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
});
