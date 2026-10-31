import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import type { HttpClient } from '../../shared/api';
import type { MediaRef } from '../../shared/entities/post';
import { focusSoon, useLatestRef } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { launchExternalPlayer, prepareExternalPlayer } from '../../shared/platform/externalPlayer';
import { logger } from '../../shared/services/logger';
import { Spinner, colors, type HostView } from '../../shared/ui';
import { pickSource, qualityOf, qualityOptions, useMediaSource, type PlayerMeta, type QualityKey } from './mediaResolver';
import { isDistinctVideoTitle } from './PlayerOverlay';
import { QualityMenu } from './PlayerSettingsSheet';
import { qualityPreference } from './qualityPreference';

/** Focus ids (docs/focus-map.md §4 G, the hand-off sheet). */
export const EXTERNAL_SURFACE_ID = 'player/external/surface';
export const EXTERNAL_SHEET_ID = 'player/external/sheet';
export const externalQualityRowId = (key: QualityKey) => `player/external/quality/${key}`;

/**
 * After the route popped, the external player starts this much later: the
 * origin's focus restoration (now and two frames later) lands first, while
 * the app still has window focus (Story 8.2 device run: a restoration sent
 * while the external activity covered the app was lost).
 */
export const EXTERNAL_LAUNCH_DELAY_MS = 300;

/** The title the external player shows: the post title, then the video title when it differs. */
export function externalTitle(meta: PlayerMeta): string {
  return isDistinctVideoTitle(meta.videoTitle, meta.postTitle)
    ? `${meta.postTitle} · ${meta.videoTitle.trim()}`
    : meta.postTitle;
}

export type ExternalHandoffProps = {
  /** The active session's content client (from the route). */
  http: HttpClient;
  /** The recording (ids only). Live never comes here. */
  mediaRef: MediaRef;
  /** The chooser opened: leave the route (focus returns to the origin). */
  onOpened: () => void;
  /** No real player (or the launch failed): play `key` in the built-in player. */
  onFallback: (key: QualityKey) => void;
  /** The fresh E8 is not playable here (locked, unavailable, no source, an error): PlayerScreen owns those states. */
  onNotReady: () => void;
  /** Back: leave the route; nothing is launched or written. */
  onBack: () => void;
};

/**
 * The system-player hand-off (Story 8.2, PLAY-13, docs/focus-map.md §4 G):
 * a fresh E8 through MediaResolver (no progress sink: no ProgressRepository
 * call, no E9, no Continue entry), then the «Качество» list (the player's
 * `QualityMenu`, a right `player` SideSheet) with focus on the quality the
 * device preference picks. OK on a row hands that source's signed URL and
 * the title to the ExternalPlayer port (one real player opens directly,
 * several get the chooser):
 * - `prepare` → `ready`: `onOpened` (the route pops, the origin restores
 *   its focus), then `launch` after `EXTERNAL_LAUNCH_DELAY_MS`; a failed
 *   launch is only logged (the route is gone; no retry once the URL left);
 * - `prepare` → `none` (no player, a failure) → `onFallback(key)`.
 *
 * Focus stays inside the route's screen (trapped on all sides): the
 * loading surface, then only the list's rows. Back (any time but while
 * `prepare` runs) leaves the route. The URL never reaches logs, storage or route
 * params; the log line carries the outcome only.
 */
export function ExternalHandoff({ http, mediaRef, onOpened, onFallback, onNotReady, onBack }: ExternalHandoffProps) {
  // The quality preference picks the initial row (the same order as the built-in player).
  const [preference, setPreference] = useState<QualityKey | null | undefined>(() => qualityPreference.peek());
  useEffect(() => {
    if (preference !== undefined) {
      return;
    }
    let alive = true;
    qualityPreference.read().then(value => {
      if (alive) {
        setPreference(value);
      }
    });
    return () => {
      alive = false;
    };
  }, [preference]);
  const media = useMediaSource(http, mediaRef, undefined, preference ?? null);
  const state = media.state;
  const ready = state.kind === 'ready' && preference !== undefined ? state : null;
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const callbacks = useLatestRef({ onOpened, onFallback, onNotReady, onBack });

  // Not playable here: PlayerScreen resolves E8 again and shows its state.
  const notReady = state.kind !== 'loading' && state.kind !== 'ready';
  useEffect(() => {
    if (notReady) {
      callbacks.current.onNotReady();
    }
  }, [notReady, callbacks]);

  const sheetShown = ready !== null && !launching;
  const surfaceView = useRef<HostView | null>(null);
  const selectedView = useRef<HostView | null>(null);
  /** The route is leaving (popped for the launch, or Back): never pull focus back here. */
  const leaving = useRef(false);
  useEffect(
    () =>
      focusSoon(() => (sheetShown ? selectedView.current : surfaceView.current), {
        guard: () => !leaving.current,
      }),
    [sheetShown],
  );

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // The launch is in flight: its outcome decides (exit or fallback).
        if (!launchingRef.current) {
          leaving.current = true;
          callbacks.current.onBack();
        }
        return true;
      });
      return () => sub.remove();
    }, [callbacks]),
  );

  const onPick = (key: QualityKey) => {
    if (ready === null || launchingRef.current) {
      return;
    }
    const source = pickSource(ready.sources, { preference: key });
    if (source === null) {
      // Nothing to hand over: the built-in player decides (its own E8 and states).
      callbacks.current.onFallback(key);
      return;
    }
    launchingRef.current = true;
    setLaunching(true);
    prepareExternalPlayer({ url: source.url, title: externalTitle(ready.meta), chooserTitle: t('player.external.chooser') })
      .then(prepared => {
        if (!alive.current) {
          return;
        }
        if (prepared === 'none') {
          // Outcome only: never the URL or the title.
          logger.info('player', 'external player hand-off', { outcome: 'none' });
          callbacks.current.onFallback(key);
          return;
        }
        // Pop first, so the origin gets its focus back while the app still
        // has window focus; the player starts once that has landed.
        leaving.current = true;
        callbacks.current.onOpened();
        setTimeout(() => {
          launchExternalPlayer().then(outcome => {
            logger.info('player', 'external player hand-off', { outcome });
            if (outcome !== 'opened') {
              // The route is gone: nothing to fall back to, no retry.
              logger.warn('player', 'external player launch failed');
            }
          });
        }, EXTERNAL_LAUNCH_DELAY_MS);
      })
      .catch(() => {
        // A callback threw: never leave the spinner stuck with Back ignored. No URL, no title.
        logger.warn('player', 'external player hand-off failed');
        launchingRef.current = false;
        if (alive.current) {
          setLaunching(false);
        }
      });
  };

  return (
    <View testID="player/external" style={styles.root}>
      {sheetShown ? (
        <View testID="player/external/scrim" style={styles.scrim}>
          <QualityMenu
            testID={EXTERNAL_SHEET_ID}
            rowId={externalQualityRowId}
            options={qualityOptions(ready.sources)}
            selected={qualityOf(ready.source)}
            autoHeight={null}
            selectedRef={selectedView}
            onPick={onPick}
          />
        </View>
      ) : (
        <HandoffLoading surfaceRef={surfaceView} />
      )}
    </View>
  );
}

/**
 * The hand-off's loading state (the preference read, the fresh E8, the
 * launch): a focusable full-screen surface (focus leaves the origin at
 * once) under a spinner. `surfaceRef` absent: it focuses itself.
 */
export function HandoffLoading({ surfaceRef }: { surfaceRef?: RefObject<HostView | null> }) {
  const own = useRef<HostView | null>(null);
  const view = surfaceRef ?? own;
  useEffect(() => {
    if (surfaceRef === undefined) {
      return focusSoon(() => own.current);
    }
    return undefined;
  }, [surfaceRef]);
  return (
    <>
      <Pressable
        ref={view}
        testID={EXTERNAL_SURFACE_ID}
        focusable
        accessibilityLabel={t('player.loading')}
        style={styles.surface}
      />
      <View testID="player/external/spinner" style={styles.center} pointerEvents="none">
        <View style={styles.spinnerScale}>
          <Spinner />
        </View>
      </View>
    </>
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
  // The list sits on the right edge, like the player's settings sheet.
  scrim: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-end',
  },
});
