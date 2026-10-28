import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import {
  SESSION_CHECK_KEYS,
  isAppError,
  queryKeys,
  useHeldError,
  useLockedSessionCheck,
  type AppErrorKind,
  type HttpClient,
} from '../../shared/api';
import {
  PostRepository,
  type MediaRef,
  type ServerProgressSink,
  type VideoSource,
} from '../../shared/entities/post';
import type { ProgressMeta } from '../../shared/services/progress';
import { postCardTitle } from '../../shared/ui';
import type * as DebugBreakModule from './debugBreakSource';

/**
 * Debug builds only (Story 4.4 device check): `__DEV__` is a constant in
 * Metro bundles, so in release the require is folded away and the module is
 * not bundled. Keep this a local, unexported binding (as `sessionManager`'s
 * debug hooks; __tests__/releaseBundle.test.js).
 */
const debugBreak: typeof DebugBreakModule | null = __DEV__ ? require('./debugBreakSource') : null;

/**
 * Debug builds only: the next source resolution the player plays gets a
 * corrupted URL (one engine error → the automatic recovery). A no-op in
 * release.
 */
export function debugBreakNextVideoSource(): void {
  debugBreak?.armBreakNextSource();
}

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

/**
 * A quality choice (Story 4.3): `auto` (the adaptive source: HLS, else DASH)
 * or a progressive height in pixels. Never a URL or a Boosty `type`; this is
 * what the device-scoped preference stores (`qualityPreference.ts`).
 */
export type QualityKey = 'auto' | number;

export type PickOptions = {
  /** The stored quality preference (Story 4.3); null or `auto`: the default order. */
  preference?: QualityKey | null;
  maxProgressiveHeight?: number;
};

/**
 * The source to play (api-contract §6, epic-4-context): the preferred
 * height's progressive source when this video has it (the first of that
 * height in the API's order), else HLS, else DASH, else the highest
 * progressive at or below the device cap (else the lowest progressive
 * above it). Among adaptive sources of one format, a non-live type wins
 * (`hls` over `live_hls`). A preferred height the video lacks falls back to
 * the default order (no error; the preference is kept). Null when nothing
 * is usable.
 */
export function pickSource(
  sources: readonly VideoSource[],
  { preference = null, maxProgressiveHeight = PROGRESSIVE_MAX_HEIGHT }: PickOptions = {},
): VideoSource | null {
  if (typeof preference === 'number') {
    const preferred = sources.find(source => source.format === 'progressive' && source.height === preference);
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

/**
 * The quality list of the settings sheet (Story 4.3, owner decisions
 * 2026-10-28): «Авто» first when the video has HLS or DASH (one row), then
 * every progressive height that exists, highest first, one row per height
 * (two types at one height are one row). Heights above 1080p are listed;
 * only the automatic pick keeps its cap.
 */
export function qualityOptions(sources: readonly VideoSource[]): QualityKey[] {
  const heights = new Set<number>();
  let adaptive = false;
  for (const source of sources) {
    if (source.format === 'progressive') {
      heights.add(source.height);
    } else {
      adaptive = true;
    }
  }
  const sorted = [...heights].sort((a, b) => b - a);
  return adaptive ? ['auto', ...sorted] : sorted;
}

/** The quality row a source belongs to: `auto` for HLS/DASH, else its height. */
export function qualityOf(source: VideoSource): QualityKey {
  return source.format === 'progressive' ? source.height : 'auto';
}

/**
 * The source was chosen by a non-`auto` quality (Story 4.4): `preference`
 * is a height and the source is that height's progressive file. A manual
 * retry after a failed recovery drops such a choice for this run (the
 * default order instead), since the decoder may be what fails on it.
 */
export function chosenByQuality(source: VideoSource, preference: QualityKey | null): boolean {
  return typeof preference === 'number' && source.format === 'progressive' && source.height === preference;
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
  /**
   * A playable source; `resolution` changes with every fresh E8 (engine
   * reload). `progress` is what the ProgressRepository's `begin` gets (no URL
   * but the unsigned preview).
   */
  | {
      kind: 'ready';
      /**
       * The source to play: `pickSource` with the quality key (the kept
       * quality of a recovery, Story 4.4, else the quality preference).
       */
      source: VideoSource;
      /** `source` was chosen by a non-`auto` quality preference (`chosenByQuality`). */
      byQuality: boolean;
      /** Every usable source of this video (the settings sheet's list, Story 4.3). */
      sources: readonly VideoSource[];
      meta: PlayerMeta;
      progress: ProgressMeta;
      resolution: number;
    }
  /**
   * The fresh E8 says the post is locked: «Нет доступа к этому видео», no
   * retry. `confirmed`: the SessionCheck port (A6) is done with this answer
   * and it stays locked (E1 ok or failed; a failed refetch keeps it too);
   * false while E1 or its one refetch runs. `verified` (Story 4.7): E1
   * said the session is fine (not offline), so the post is really locked.
   */
  | { kind: 'locked'; confirmed: boolean; verified: boolean }
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
  /** One fresh E8 («Повторить», or the player's automatic recovery, Story 4.4). */
  retry: () => void;
};

export type MediaSourceOptions = {
  /**
   * The quality to keep (Story 4.4, a recovery or a retry): picked instead of
   * `preference` when set; the default order when this video lacks it.
   */
  keep?: QualityKey | null;
};

/**
 * The player's source for `ref` via TanStack Query: a fresh E8 on every
 * player mount, never refetched by itself while the player shows (no stale
 * refetch: a new URL would reload the video), only by `retry()`.
 *
 * A fresh E8 that says locked asks the SessionCheck port (Epic 3 retro A6):
 * a dead token also answers «locked» (api-contract §7). «Нет доступа к
 * этому видео» stays shown meanwhile; `refetch` sends one more E8 (a
 * silent token refresh made it accessible: the video plays), `expired`
 * opens A11 through the app's status listener.
 */
export function useMediaSource(
  http: HttpClient,
  ref: MediaRef,
  onServerProgress?: ServerProgressSink,
  preference: QualityKey | null = null,
  { keep = null }: MediaSourceOptions = {},
): MediaSource {
  const sinkRef = useRef(onServerProgress);
  sinkRef.current = onServerProgress;
  const refetchRef = useRef<() => void>(() => {});
  const checkLocked = useLockedSessionCheck(SESSION_CHECK_KEYS.player, () => refetchRef.current());
  /** The locked E8 result the session check is done with (Story 4.4). */
  const [confirmedLocked, setConfirmedLocked] = useState<unknown>(null);
  /** The locked E8 result E1 verified (session fine, Story 4.7). */
  const [verifiedLocked, setVerifiedLocked] = useState<unknown>(null);
  const query = useQuery({
    queryKey: queryKeys.mediaSource(ref.blogUrl, ref.postId, ref.mediaId),
    queryFn: async () => {
      // The fresh E8's `timeCode` goes to the ProgressRepository (Story 4.2).
      const result = await PostRepository.videoSources(http, ref, {
        onServerProgress: (mediaId, sec) => sinkRef.current?.(mediaId, sec),
      });
      if (result.kind === 'locked') {
        // `locked` from the check: this answer stays locked (confirmed).
        checkLocked(outcome => {
          if (outcome === 'locked' || outcome === 'unverified') {
            setConfirmedLocked(result);
          }
          if (outcome === 'locked') {
            setVerifiedLocked(result);
          }
        });
      }
      return result;
    },
    staleTime: Infinity,
    gcTime: MEDIA_SOURCE_GC_TIME_MS,
    retry: false,
    refetchOnMount: 'always',
    // Every E8 is a new resolution, even with equal data (a new source object).
    structuralSharing: false,
  });
  const { error, isFetching, refetch, status, isFetchedAfterMount } = query;
  refetchRef.current = () => {
    refetch().catch(() => {});
  };
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
  /** This hook instance, for the debug-only one-shot broken source. */
  const debugOwner = useRef({});
  // A retry of a failed E8 (no data) puts the query back to `pending`: the
  // error stays shown, its «Повторить» busy (focus kept).
  const heldError = useHeldError({ empty: data === undefined, status, error, isFetching });
  // A failed E8 with older data (a retry after a start failure): its own
  // error kind, not the generic copy; kept (busy) while another retry runs.
  // A locked answer has no retry, so its only refetch is the session check's
  // (A6): when that one fails, the locked state stays (never error copy).
  const dataError: AppErrorKind | null =
    isFetchedAfterMount && status === 'error' && data !== undefined && data.kind !== 'locked'
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
    if (data.kind === 'locked') {
      // A failed refetch after E1 ok keeps the locked answer: done as well.
      const failedRefetch = status === 'error' && !isFetching;
      const confirmed = confirmedLocked === data || failedRefetch;
      // A refetch only follows an E1 ok: its failure is verified too.
      return { kind: 'locked', confirmed, verified: verifiedLocked === data || failedRefetch };
    }
    if (data.kind === 'unavailable') {
      return { kind: 'unavailable' };
    }
    const picked = pickSource(data.sources, { preference: keep ?? preference });
    if (picked === null) {
      return { kind: 'noSource' };
    }
    const source =
      debugBreak !== null && debugBreak.isBroken(debugOwner.current, resolution)
        ? { ...picked, url: debugBreak.breakUrl(picked.url) }
        : picked;
    const block = data.post.blocks.find(b => b.type === 'ok_video' && b.id === ref.mediaId);
    const video = block?.type === 'ok_video' ? block : null;
    const postTitle = postCardTitle(data.post);
    return {
      kind: 'ready',
      source,
      byQuality: chosenByQuality(source, preference),
      sources: data.sources,
      meta: {
        authorName: data.post.author.name,
        authorAvatarUrl: data.post.author.avatarUrl,
        postTitle,
        videoTitle: data.videoTitle,
      },
      progress: {
        title: data.videoTitle,
        postTitle,
        authorName: data.post.author.name,
        previewUrl: video?.previewUrl ?? null,
        durationSec: video?.durationSec !== null && video?.durationSec !== undefined && video.durationSec > 0 ? Math.floor(video.durationSec) : null,
      },
      resolution,
    };
  }, [data, heldError, dataError, resolution, ref.mediaId, preference, keep, confirmedLocked, verifiedLocked, status, isFetching]);

  return {
    state,
    isFetching,
    retry: () => {
      refetch().catch(() => {});
    },
  };
}
