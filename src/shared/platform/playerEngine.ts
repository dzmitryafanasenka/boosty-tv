import type { Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * The PlayerEngine port (AD-2, Story 4.1): what the player feature needs
 * from a native video player. Features import this port and
 * `PlayerEngineView` (the Android adapter over react-native-video, in
 * `./PlayerEngineView`); they never import `react-native-video`.
 *
 * Every position and duration crossing the port is an integer number of
 * seconds (floored), so the feature never sees fractional native times.
 *
 * The source URL is a signed CDN URL: it lives in memory only. The adapter
 * sends no headers of its own (no `Authorization`, nothing of Boosty's): the
 * player uses its own User-Agent (api-contract §6).
 */

export type EngineSourceFormat = 'hls' | 'dash' | 'progressive';

export type EngineSource = {
  uri: string;
  format: EngineSourceFormat;
};

export type PlayerEngineHandle = {
  /** Seek to an integer second. */
  seek(positionSec: number): void;
};

export type PlayerEngineProps = {
  source: EngineSource;
  paused: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Loaded: the duration in whole seconds (0 when unknown or live). */
  onLoad?: (info: { durationSec: number }) => void;
  /** The playback position in whole seconds, about once a second. */
  onProgress?: (positionSec: number) => void;
  onBuffering?: (buffering: boolean) => void;
  /** A seek finished at this whole second. */
  onSeekDone?: (positionSec: number) => void;
  onEnd?: () => void;
  /**
   * Playback failed (HTTP, decoder, source). `code` is the native error code
   * when it is a short code (never a message: messages can carry the URL).
   */
  onError?: (code: string | null) => void;
  /**
   * Story 4.3: the height in pixels of the video track the engine is
   * playing, reported for adaptive sources (HLS, DASH) when it is known and
   * whenever it changes. Never guessed: no report, no value. The Android
   * adapter reads it from react-native-video's `onBandwidthUpdate`
   * (`reportBandwidth`).
   */
  onResolution?: (heightPx: number) => void;
  /**
   * Story 4.6: another app took audio focus (a full or a transient loss).
   * The Android adapter reads react-native-video's `onAudioFocusChanged`
   * (`hasAudioFocus: false`); react-native-video has already paused natively
   * on a full loss, the player pauses its own state for every loss.
   */
  onAudioFocusLost?: () => void;
  ref?: Ref<PlayerEngineHandle>;
};

/** Integer seconds across the port: floored, never negative, 0 for NaN. */
export function wholeSeconds(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The adaptive cap (Story 4.1). On the pinned Chromecast with Google TV,
 * adaptive HLS once switched to 2560×1440 AVC High (≈ 8 Mbit/s) and the
 * hardware decoder failed (docs/api-contract.md §6, Story 1.6); the first
 * Story 4.1 device run saw the same climb to 1440p. The only adaptive limit
 * react-native-video 6.19.3 exposes on Android is a maximum bitrate, so the
 * adapter turns this height into a bitrate: the highest declared bitrate
 * among the loaded video tracks at or below this height (`adaptiveBitrateCap`).
 */
export const ADAPTIVE_MAX_HEIGHT = 1080;

/** A loaded video track as the engine reports it (height and declared bitrate, when known). */
export type EngineVideoTrack = { height?: number; bitrate?: number };

/**
 * The bitrate cap that keeps adaptive selection at or below `maxHeight`: the
 * highest declared bitrate of a track at or below it. 0 (no cap) when no
 * track is above it, or when the tracks give no usable height or bitrate.
 */
export function adaptiveBitrateCap(
  tracks: readonly EngineVideoTrack[] | null | undefined,
  maxHeight: number = ADAPTIVE_MAX_HEIGHT,
): number {
  let cap = 0;
  let above = false;
  for (const track of tracks ?? []) {
    const height = track.height ?? 0;
    const bitrate = track.bitrate ?? 0;
    if (height <= 0 || bitrate <= 0) {
      continue;
    }
    if (height > maxHeight) {
      above = true;
    } else if (bitrate > cap) {
      cap = bitrate;
    }
  }
  return above ? cap : 0;
}
