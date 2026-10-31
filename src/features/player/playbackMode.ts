import type { ProgressRepository } from '../../shared/services/progress';
import { pickSource, type MediaSourceState, type QualityKey } from './mediaResolver';
import { recoveryTarget, type StartGate } from './recovery';
import { liveQualitySwitch, liveSettingsShown } from './livePolicy';

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
  /**
   * The one seek gate (live: false): ← →, the media seek keys and ±10 s
   * move a seek target, and a held ← → builds a pending target. Off, they
   * only show the overlay. There is no mode that seeks but cannot hold.
   */
  canSeek: boolean;
  /**
   * The stream can end (live): the engine's end (`liveEnded`) or E15 «no
   * live stream» (`unavailable`) is the `ended` phase («Стрим завершён»),
   * not «Видео недоступно».
   */
  streamEnds: boolean;
  /**
   * `noSource` means «not playable here» (live: no access or no live-edge
   * URL): the `loading` phase while the player leaves for the origin's QR,
   * not the error state.
   */
  noSourceLeaves: boolean;
  /** Story 7.3: the viewer heartbeat runs while playing (live only). */
  heartbeat: boolean;
  /** Where focus goes when the overlay shows (live: play/pause, no timeline). */
  overlayFocus: 'timeline' | 'playPause';
  /**
   * The ProgressRepository, or null: no progress writes at all (no `begin`,
   * report, `resumePoint` or `forget`). Null for live, and also for a VOD
   * opened without a repository. The session's `progress === null` paths
   * are keyed on this, not on liveness; code that means «is live» reads
   * `kind` or a flag above.
   */
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
    streamEnds: false,
    noSourceLeaves: false,
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
    streamEnds: true,
    noSourceLeaves: true,
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
