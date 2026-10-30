import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import type { HttpClient } from '../../shared/api';
import type { MediaRef } from '../../shared/entities/post';
import { isLiveRef, type LiveRef } from '../../shared/entities/stream';
import { useLatestRef } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { logger } from '../../shared/services/logger';
import { qualityOf, qualityOptions, useLiveSource, type MediaSource, type MediaSourceState, type QualityKey } from './mediaResolver';

/**
 * Story 7.2: the ref kind is fixed for a mounted player (route params): a
 * `LiveRef` is the live mode, anything else a VOD.
 */
export function splitMediaRef(mediaRef: MediaRef | LiveRef): { liveRef: LiveRef | null; vodRef: MediaRef | null } {
  return isLiveRef(mediaRef) ? { liveRef: mediaRef, vodRef: null } : { liveRef: null, vodRef: mediaRef };
}

export type LivePlayback = {
  /** The live source (a fresh E15); disabled (never fetches) for a VOD. */
  liveMedia: MediaSource;
  /** Story 7.2: the engine reported the end of the live stream. Never reset. */
  liveEnded: boolean;
  /** Marks the live stream ended («Стрим завершён»). */
  markEnded: () => void;
  /**
   * Bumped by a live play after a pause: the engine remounts at the live
   * edge. Always 0 for a VOD. The engine key is `${resolution}:${type}:${epoch}`.
   */
  epoch: number;
  bumpEpoch: () => void;
  /** Live but not playable here (no access, no live-edge URL): the player leaves (the origin's QR). */
  liveUnplayable: boolean;
};

/**
 * The live half of the player's state (Story 7.2, Epic 7 retro A2). Called
 * right after `useMediaSource` (the VOD hook): both media hooks always run,
 * in that order, and the one for the other kind is disabled.
 *
 * The live player (`LiveRef`, focus-map G9–G11), as `PlayerScreen` runs it:
 * - The source is a fresh E15 (`useLiveSource`, live-edge URLs only). No
 *   ProgressRepository at all (no begin, tick, pause, exit or forget), no
 *   seek (← → and the media seek keys only show the overlay), no ±10 s, no
 *   timeline; the overlay shows the LIVE badge and the elapsed time, focus
 *   on play/pause.
 * - Play after a pause remounts the source (`bumpEpoch`: the engine starts
 *   at the live edge).
 * - The gear only when the live quality list has a real choice (owner
 *   decision 2026-10-30); a pick replays at the edge.
 * - The engine's end (`markEnded`), or no live stream at the open or after a
 *   recovery, shows «Стрим завершён» with focus on «Назад» (no auto-exit, no
 *   restart).
 * - The first engine error re-fetches E15 once and replays at the edge; a
 *   second error shows the error state with «Назад» only.
 * - A stream that is live but not playable here leaves through
 *   `onLiveUnplayable` (the origin's QR; `useLiveUnplayableExit`).
 * - Story 7.3: the viewer heartbeat (`useLiveHeartbeat`, E16) while playing
 *   and not paused, and one stop on «Стрим завершён» or the unmount. The
 *   screen declares it before its unmount `exit` report (cleanup order).
 */
export function useLivePlayback(http: HttpClient, liveRef: LiveRef | null, keepQuality: QualityKey | null): LivePlayback {
  const liveMedia = useLiveSource(http, liveRef, { keep: keepQuality });
  const [liveEnded, setLiveEnded] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const markEnded = useCallback(() => setLiveEnded(true), []);
  const bumpEpoch = useCallback(() => setEpoch(n => n + 1), []);
  const liveUnplayable = liveRef !== null && liveMedia.state.kind === 'noSource' && !liveEnded;
  return { liveMedia, liveEnded, markEnded, epoch, bumpEpoch, liveUnplayable };
}

/**
 * Story 7.2: live but not playable here: leave at once, so the origin shows
 * the stream page's QR. A focus effect: an answer that lands while the route
 * is not focused (the push transition, a covering screen) leaves once it is
 * focused. Declared after the player's no-access exit effect.
 */
export function useLiveUnplayableExit(liveUnplayable: boolean, leave: () => void): void {
  const leaveRef = useLatestRef(leave);
  useFocusEffect(
    useCallback(() => {
      if (!liveUnplayable) {
        return;
      }
      logger.info('player', 'live stream not playable here; leaving');
      leaveRef.current();
    }, [liveUnplayable, leaveRef]),
  );
}

/** Story 7.2 (owner decision 2026-10-30): live shows the gear only with a real quality choice. */
export function liveSettingsShown(sources: Parameters<typeof qualityOptions>[0]): boolean {
  return qualityOptions(sources).length > 1;
}

/**
 * Story 7.2 (owner decision 2026-10-30): whether a quality pick switches the
 * live source (true: another source of the same E15 has that quality; false:
 * no ready source, no such quality, or the playing one). The chosen live
 * source plays from the live edge: no position, no stored preference.
 */
export function liveQualitySwitch(
  current: Extract<MediaSourceState, { kind: 'ready' }> | null,
  key: QualityKey,
): boolean {
  const next = current === null ? null : (current.sources.find(source => qualityOf(source) === key) ?? null);
  return current !== null && next !== null && next !== current.source;
}

export type LiveCopy = {
  /** The state panel's copy: «Стрим завершён», or the live error. */
  state: { title: string; body: string };
  /** The surface's accessibility label. */
  surfaceLabel: string;
};

/** The live player's copy and a11y labels (Story 7.2, focus-map G9–G11). */
export function liveCopy({ ended, loading, state }: { ended: boolean; loading: boolean; state: MediaSourceState }): LiveCopy {
  return {
    state: ended
      ? { title: t('player.live.endedTitle'), body: t('player.live.endedBody') }
      : {
          title: t('player.live.errorTitle'),
          body: state.kind === 'error' ? t(`error.${state.error}`) : t('player.live.errorBody'),
        },
    surfaceLabel: loading ? t('player.live.loading') : t('player.live.surface'),
  };
}
