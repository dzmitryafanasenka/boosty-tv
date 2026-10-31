import type { ProgressRepository } from '../../shared/services/progress';
import { pickSource, type MediaSourceState, type QualityKey } from './mediaResolver';
import { recoveryTarget, type StartGate } from './recovery';
import { liveQualitySwitch, liveSettingsShown } from './useLivePlayback';

/**
 * Story 4.6: a source older than this (client clock, since its E8) is
 * re-resolved (one fresh E8, the Story 4.4 path) before play: the signed
 * URLs carry `expires` 24 h ahead (api-contract §6); how the CDN answers an
 * expired URL is unverified, so this only avoids the error path.
 */
export const SOURCE_REFRESH_AGE_MS = 23 * 60 * 60 * 1000;

export type PlaybackKind = 'vod' | 'live';

type ReadySource = Extract<MediaSourceState, { kind: 'ready' }>;

/**
 * What a play press does (`usePlaybackSession.setPlaying`):
 * - `liveEdge`: live play after a pause: the engine remounts with the same
 *   source (it starts at the live edge), never a seek to a position;
 * - `refreshSource`: the VOD source is ≥ `SOURCE_REFRESH_AGE_MS` old: one
 *   fresh E8 first (Story 4.6), then play;
 * - `plain`: play or pause the engine as it is.
 */
export type PlayIntent = 'liveEdge' | 'refreshSource' | 'plain';

/**
 * What a quality pick does (`usePlaybackSession.pickQuality`):
 * - `switchSource`: VOD, the pick changes the playing source: store the
 *   preference after `onLoad`, remount at the current position;
 * - `storeOnly`: VOD, the playing source stays: store the preference now;
 * - `liveSwitch`: live, another source of the same E15: replay at the edge
 *   (no position, no stored preference);
 * - `none`: live, nothing changes.
 */
export type QualityIntent = 'switchSource' | 'storeOnly' | 'liveSwitch' | 'none';

/**
 * What the engine's end does: `markEnded` (live: «Стрим завершён», no
 * write, no auto-exit) or `reportEnd` (VOD: the final E9, then leave or stay
 * paused at the end).
 */
export type EndIntent = 'markEnded' | 'reportEnd';

/**
 * Every live/VOD difference of the player in one place (pure data and
 * intents, no mutation). `usePlaybackSession` executes the intents; the
 * other player hooks read the flags.
 */
export type PlaybackMode = {
  kind: PlaybackKind;
  /** ← → , the media seek keys and ±10 s move a seek target (live: overlay only). */
  canSeek: boolean;
  /** A held ← → builds a pending target (live: never). */
  holdSeeks: boolean;
  /** Story 7.3: the viewer heartbeat runs while playing (live only). */
  heartbeat: boolean;
  /** Where focus goes when the overlay shows (live: play/pause, no timeline). */
  overlayFocus: 'timeline' | 'playPause';
  /** The ProgressRepository; null for live (no progress is ever written). */
  progress: ProgressRepository | null;
  /** The media hook whose source plays (both hooks always run). */
  pickMedia<T>(vod: T, live: T): T;
  /** The error state offers «Повторить» (live: only after a failed E15 request). */
  retryable(state: MediaSourceState): boolean;
  /** The overlay shows «Настройки» (live: only with a real quality choice). */
  settingsShown(sources: ReadySource['sources']): boolean;
  /** `sourceAgeMs`: since the ready source was resolved; null without one. */
  playIntent(input: { play: boolean; paused: boolean; sourceAgeMs: number | null }): PlayIntent;
  qualityIntent(current: ReadySource | null, key: QualityKey): QualityIntent;
  endIntent(): EndIntent;
  /** Where the next source continues after an error (live: undefined, the live edge). */
  recoveryTarget(gate: StartGate, pendingSeek: () => number | null, positionSec: number): number | undefined;
};

/** The VOD mode (Stories 4.1–4.7): progress, seeking, quality preference. */
export function createVodMode(progress: ProgressRepository | null): PlaybackMode {
  return {
    kind: 'vod',
    canSeek: true,
    holdSeeks: true,
    heartbeat: false,
    overlayFocus: 'timeline',
    progress,
    pickMedia: vod => vod,
    retryable: () => true,
    settingsShown: () => true,
    playIntent: ({ play, sourceAgeMs }) =>
      play && sourceAgeMs !== null && sourceAgeMs >= SOURCE_REFRESH_AGE_MS ? 'refreshSource' : 'plain',
    qualityIntent: (current, key) => {
      const next = current === null ? null : pickSource(current.sources, { preference: key });
      return current !== null && next !== null && next !== current.source ? 'switchSource' : 'storeOnly';
    },
    endIntent: () => 'reportEnd',
    recoveryTarget: (gate, pendingSeek, positionSec) => recoveryTarget(gate, pendingSeek(), positionSec),
  };
}

/** The live mode (Story 7.2, focus-map G9–G11; details in `useLivePlayback.ts`). */
export function createLiveMode(): PlaybackMode {
  return {
    kind: 'live',
    canSeek: false,
    holdSeeks: false,
    heartbeat: true,
    overlayFocus: 'playPause',
    progress: null,
    pickMedia: (_vod, live) => live,
    retryable: state => state.kind === 'error',
    settingsShown: sources => liveSettingsShown(sources),
    playIntent: ({ play, paused }) => (play && paused ? 'liveEdge' : 'plain'),
    qualityIntent: (current, key) => (liveQualitySwitch(current, key) ? 'liveSwitch' : 'none'),
    endIntent: () => 'markEnded',
    recoveryTarget: () => undefined,
  };
}
