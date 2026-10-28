import { useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Video, {
  type OnAudioFocusChangedData,
  type OnBandwidthUpdateData,
  type OnBufferData,
  type OnLoadData,
  type OnProgressData,
  type OnSeekData,
  type OnVideoErrorData,
  type VideoRef,
} from 'react-native-video';
import {
  adaptiveBitrateCap,
  wholeSeconds,
  type EngineSourceFormat,
  type PlayerEngineProps,
} from './playerEngine';

/** react-native-video's source `type` hint: HLS and DASH by format, progressive by extension. */
const TYPE_HINT: Record<EngineSourceFormat, 'm3u8' | 'mpd' | undefined> = {
  hls: 'm3u8',
  dash: 'mpd',
  progressive: undefined,
};

/** A short native error code (e.g. `22004`); anything longer could be a message with the URL. */
const SHORT_CODE = /^[A-Za-z0-9_-]{1,24}$/;

/**
 * The PlayerEngine adapter over react-native-video 6.19.3 (Media3 on
 * Android; pinned exactly, docs/testing.md Story 4.1). Not focusable: the
 * player screen owns focus and the remote. No custom headers: requests go
 * through React Native's shared OkHttp client with the player's own
 * User-Agent and no `Authorization` (verified by the debug-only network log,
 * `android/app/src/debug`). Adaptive selection is capped at
 * `ADAPTIVE_MAX_HEIGHT` once the tracks are known (`onLoad`): the bitrate
 * cap of `adaptiveBitrateCap`. For adaptive sources it reports the playing
 * track's height (`onResolution`, Story 4.3) from `onBandwidthUpdate`
 * (`reportBandwidth`; 0 means unknown and is never reported). It never plays in the background and keeps
 * the system's audio focus handling.
 */
export function PlayerEngineView({
  source,
  paused,
  testID,
  style,
  onLoad,
  onProgress,
  onBuffering,
  onSeekDone,
  onEnd,
  onError,
  onResolution,
  onAudioFocusLost,
  ref,
}: PlayerEngineProps) {
  const video = useRef<VideoRef>(null);
  useImperativeHandle(
    ref,
    () => ({
      seek: (positionSec: number) => video.current?.seek(wholeSeconds(positionSec)),
    }),
    [],
  );
  const adaptive = source.format !== 'progressive';
  /** 0 = no cap, until the loaded tracks show a variant above the height cap. */
  const [bitrateCap, setBitrateCap] = useState(0);
  /** The last reported track height (Story 4.3): reported again only when it changes. */
  const reportedHeight = useRef(0);
  const reportResolution = adaptive && onResolution !== undefined;
  return (
    <Video
      ref={video}
      testID={testID}
      source={{ uri: source.uri, type: TYPE_HINT[source.format] }}
      paused={paused}
      resizeMode="contain"
      focusable={false}
      playInBackground={false}
      progressUpdateInterval={500}
      maxBitRate={adaptive ? bitrateCap : 0}
      reportBandwidth={reportResolution}
      onBandwidthUpdate={
        reportResolution
          ? (e: OnBandwidthUpdateData) => {
              const height = typeof e.height === 'number' && Number.isFinite(e.height) ? Math.floor(e.height) : 0;
              if (height > 0 && height !== reportedHeight.current) {
                reportedHeight.current = height;
                onResolution?.(height);
              }
            }
          : undefined
      }
      style={[styles.video, style]}
      onLoad={(e: OnLoadData) => {
        if (adaptive) {
          setBitrateCap(adaptiveBitrateCap(e.videoTracks));
        }
        onLoad?.({ durationSec: wholeSeconds(e.duration) });
      }}
      onProgress={(e: OnProgressData) => onProgress?.(wholeSeconds(e.currentTime))}
      onBuffer={(e: OnBufferData) => onBuffering?.(e.isBuffering)}
      onSeek={(e: OnSeekData) => onSeekDone?.(wholeSeconds(e.currentTime))}
      onEnd={() => onEnd?.()}
      onAudioFocusChanged={(e: OnAudioFocusChangedData) => {
        if (!e.hasAudioFocus) {
          onAudioFocusLost?.();
        }
      }}
      onError={(e: OnVideoErrorData) => {
        const code = e.error?.errorCode ?? (e.error?.code !== undefined ? String(e.error.code) : null);
        onError?.(code !== null && SHORT_CODE.test(code) ? code : null);
      }}
    />
  );
}

const styles = StyleSheet.create({
  video: {
    ...StyleSheet.absoluteFill,
  },
});
