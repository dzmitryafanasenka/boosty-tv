import { useEffect, useState } from 'react';
import type { HttpClient } from '../../shared/api';
import type { MediaRef } from '../../shared/entities/post';
import type { LiveRef } from '../../shared/entities/stream';
import { useMediaSource, type MediaSource, type QualityKey } from './mediaResolver';
import type { PlaybackMode } from './playbackMode';
import { qualityPreference } from './qualityPreference';
import { DEFAULT_SPEED, speedPreference, type PlaybackSpeed } from './speedPreference';
import { useLivePlayback, type LivePlayback } from './useLivePlayback';

export type PlayerSource = Omit<LivePlayback, 'liveMedia'> & {
  /** The playing media (`PlaybackMode.pickMedia`: the VOD or the live hook). */
  media: MediaSource;
  /** The device's quality preference is read, and the speed one where the mode uses it (the engine waits). */
  preferenceReady: boolean;
  setPreference: (key: QualityKey) => void;
  /** Story 8.1: the stored speed (1× until read, when none or unknown); `PlaybackMode.rate` decides whether it applies. */
  speed: PlaybackSpeed;
  setSpeed: (speed: PlaybackSpeed) => void;
  setKeepQuality: (key: QualityKey | null) => void;
  /** The local progress store is loaded (always true for live). */
  progressReady: boolean;
};

/**
 * The player's source (Stories 4.1–4.4, 7.2, 8.1): the quality and speed preferences, the
 * quality a recovery keeps, both media hooks (always both, in this order;
 * the one for the other kind is disabled) and the progress store's
 * readiness. Called first in `PlayerScreen` (effect order).
 */
export function usePlayerSource(
  http: HttpClient,
  mode: PlaybackMode,
  liveRef: LiveRef | null,
  vodRef: MediaRef | null,
): PlayerSource {
  const progress = mode.progress;
  // The device's quality preference (Story 4.3): read once per app run;
  // the engine waits for it, so the first source is the preferred one.
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
  // Story 8.1: the device's speed preference, read like the quality one, so
  // the first engine starts at the stored speed. Only where the mode uses it
  // (live and the flag off neither read nor wait for it).
  const speedUsed = mode.speedShown;
  const [speed, setSpeed] = useState<PlaybackSpeed | undefined>(() => speedPreference.peek());
  useEffect(() => {
    if (speed !== undefined || !speedUsed) {
      return;
    }
    let alive = true;
    speedPreference.read().then(value => {
      if (alive) {
        setSpeed(value);
      }
    });
    return () => {
      alive = false;
    };
  }, [speed, speedUsed]);
  /**
   * The quality a recovery or a retry keeps (Story 4.4): the broken source's
   * key, picked instead of the preference while the video has it. Cleared by
   * a quality pick.
   */
  const [keepQuality, setKeepQuality] = useState<QualityKey | null>(null);
  const vodMedia = useMediaSource(http, vodRef, progress?.onServerProgress, preference ?? null, {
    keep: keepQuality,
  });
  // Story 7.2: the live source, `liveEnded` and the live-edge epoch (useLivePlayback).
  const { liveMedia, ...livePlayback } = useLivePlayback(http, liveRef, keepQuality);
  const media = mode.pickMedia(vodMedia, liveMedia);
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
  return {
    ...livePlayback,
    media,
    preferenceReady: preference !== undefined && (speed !== undefined || !speedUsed),
    setPreference,
    speed: speed ?? DEFAULT_SPEED,
    setSpeed,
    setKeepQuality,
    progressReady,
  };
}
