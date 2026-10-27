import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { isAppError, queryKeys, useHeldError, type AppErrorKind, type HttpClient } from '../../shared/api';
import {
  PostRepository,
  type MediaRef,
  type VideoSource,
} from '../../shared/entities/post';
import { postCardTitle } from '../../shared/ui';

/**
 * MediaResolver (Story 4.1): a fresh E8 for the video to play
 * (`PostRepository.videoSources`, content profile: ADR 0008, the signed
 * URLs follow the fetching client) and the source to play.
 *
 * Signed URLs stay in memory inside the player feature: the query key holds
 * ids only (`queryKeys.mediaSource`), `gcTime` is short (the entry is
 * dropped right after the player unmounts, so the next open sends a fresh
 * E8), nothing is persisted, and nothing here logs a URL.
 */

/**
 * The tallest progressive file the player picks (Story 4.1): the pinned
 * device's decoder failed once on 1440p AVC High (api-contract §6), so
 * progressive selection stops at 1080p unless nothing at or below it exists.
 */
export const PROGRESSIVE_MAX_HEIGHT = 1080;

/** The player's E8 entry lives this long after the player unmounts. */
export const MEDIA_SOURCE_GC_TIME_MS = 1_000;

export type PickOptions = {
  /** The stored preferred quality (Story 4.3); none in 4.1. */
  preferredType?: string | null;
  maxProgressiveHeight?: number;
};

/**
 * The source to play (api-contract §6, epic-4-context): the preferred
 * quality (its `type`) when it exists, else HLS, else DASH, else the highest
 * progressive at or below the device cap (else the lowest progressive
 * above it). Among adaptive sources of one format, a non-live type wins
 * (`hls` over `live_hls`). Null when nothing is usable.
 */
export function pickSource(
  sources: readonly VideoSource[],
  { preferredType = null, maxProgressiveHeight = PROGRESSIVE_MAX_HEIGHT }: PickOptions = {},
): VideoSource | null {
  if (preferredType !== null) {
    const preferred = sources.find(source => source.type === preferredType);
    if (preferred) {
      return preferred;
    }
  }
  for (const format of ['hls', 'dash'] as const) {
    const adaptive = sources.filter(source => source.format === format);
    const pick = adaptive.find(source => !source.type.startsWith('live')) ?? adaptive[0];
    if (pick) {
      return pick;
    }
  }
  let best: (VideoSource & { format: 'progressive' }) | null = null;
  let lowestAbove: (VideoSource & { format: 'progressive' }) | null = null;
  for (const source of sources) {
    if (source.format !== 'progressive') {
      continue;
    }
    if (source.height <= maxProgressiveHeight) {
      if (best === null || source.height > best.height) {
        best = source;
      }
    } else if (lowestAbove === null || source.height < lowestAbove.height) {
      lowestAbove = source;
    }
  }
  return best ?? lowestAbove;
}

/** The overlay's top band (DESIGN.md Player overlay). */
export type PlayerMeta = {
  authorName: string;
  authorAvatarUrl: string | null;
  postTitle: string;
  /** Empty when the video has no title. */
  videoTitle: string;
};

export type MediaSourceState =
  | { kind: 'loading' }
  /** A playable source; `resolution` changes with every fresh E8 (engine reload). */
  | { kind: 'ready'; source: VideoSource; meta: PlayerMeta; resolution: number }
  /** The fresh E8 says the post is locked: «Нет доступа к этому видео», no retry. */
  | { kind: 'locked' }
  /** E8 404 or the video is gone from the post: «Видео недоступно», no retry. */
  | { kind: 'unavailable' }
  /** No usable URL (all empty or unknown): «Не удалось воспроизвести видео» + «Повторить». */
  | { kind: 'noSource' }
  /** E8 failed: the error state + «Повторить» (kept, busy, while the retry runs). */
  | { kind: 'error'; error: AppErrorKind };

export type MediaSource = {
  state: MediaSourceState;
  /** An E8 is in flight (the first one or a retry). */
  isFetching: boolean;
  /** One fresh E8 («Повторить»). */
  retry: () => void;
};

/**
 * The player's source for `ref` via TanStack Query: a fresh E8 on every
 * player mount, never refetched by itself while the player shows (no stale
 * refetch: a new URL would reload the video), only by `retry()`.
 */
export function useMediaSource(http: HttpClient, ref: MediaRef): MediaSource {
  const query = useQuery({
    queryKey: queryKeys.mediaSource(ref.blogUrl, ref.postId, ref.mediaId),
    queryFn: () => PostRepository.videoSources(http, ref),
    staleTime: Infinity,
    gcTime: MEDIA_SOURCE_GC_TIME_MS,
    retry: false,
    refetchOnMount: 'always',
    // Every E8 is a new resolution, even with equal data (a new source object).
    structuralSharing: false,
  });
  const { error, isFetching, refetch, status, isFetchedAfterMount } = query;
  // Data from before this mount (a reopen within `gcTime`) is never played:
  // until this mount's own E8 has landed, the player is loading. Otherwise
  // the cached URL would start and restart when the fresh E8 arrives.
  const data = isFetchedAfterMount ? query.data : undefined;
  // Counts the resolutions (each fresh E8 result is a new object).
  const resolutions = useRef<{ data: unknown; count: number }>({ data: undefined, count: 0 });
  if (data !== undefined && data !== resolutions.current.data) {
    resolutions.current = { data, count: resolutions.current.count + 1 };
  }
  const resolution = resolutions.current.count;
  // A retry of a failed E8 (no data) puts the query back to `pending`: the
  // error stays shown, its «Повторить» busy (focus kept).
  const heldError = useHeldError({ empty: data === undefined, status, error, isFetching });
  // A failed E8 with older data (a retry after a start failure): its own
  // error kind, not the generic copy; kept (busy) while another retry runs.
  const dataError: AppErrorKind | null =
    isFetchedAfterMount && status === 'error' && data !== undefined
      ? isAppError(error)
        ? error.kind
        : 'Client'
      : null;

  const state = useMemo<MediaSourceState>(() => {
    if (heldError !== null) {
      return { kind: 'error', error: heldError };
    }
    if (dataError !== null) {
      return { kind: 'error', error: dataError };
    }
    if (data === undefined) {
      return { kind: 'loading' };
    }
    if (data.kind === 'locked' || data.kind === 'unavailable') {
      return { kind: data.kind };
    }
    const source = pickSource(data.sources);
    if (source === null) {
      return { kind: 'noSource' };
    }
    return {
      kind: 'ready',
      source,
      meta: {
        authorName: data.post.author.name,
        authorAvatarUrl: data.post.author.avatarUrl,
        postTitle: postCardTitle(data.post),
        videoTitle: data.videoTitle,
      },
      resolution,
    };
  }, [data, heldError, dataError, resolution]);

  return {
    state,
    isFetching,
    retry: () => {
      refetch().catch(() => {});
    },
  };
}
