import { blockTypeDtoSchema, okVideoSourcesDtoSchema, playerUrlDtoSchema } from '../../api/dto/post';
import type { Post } from './types';

/**
 * Player-only media sources (Story 4.1, api-contract §6). An `ok_video`'s
 * signed `playerUrls`, mapped to a format and, for progressive files, a
 * height. Read only by the player's media resolver from a fresh E8
 * (`PostRepository.videoSources`); the Post entity never carries them
 * (AD-9). The URLs are signed for 24 h and bound to the fetching client:
 * memory only, never in a route, a query key of the post, storage, a log or
 * a fixture.
 */

export type VideoSourceFormat = 'hls' | 'dash' | 'progressive';

export type VideoSource =
  | {
      format: 'hls' | 'dash';
      /** The Boosty `playerUrls[].type` (e.g. `hls`), for a later re-pick of the same type. */
      type: string;
      url: string;
    }
  | {
      format: 'progressive';
      type: string;
      /** 144 … 2160 (api-contract §6). */
      height: number;
      url: string;
    };

/** api-contract §6: progressive `type` values → height. */
const PROGRESSIVE_HEIGHT: Readonly<Record<string, number>> = {
  tiny: 144,
  mobile: 144,
  lowest: 240,
  low: 360,
  sd: 480,
  medium: 480,
  hd: 720,
  high: 720,
  full: 1080,
  full_hd: 1080,
  fullhd: 1080,
  quad: 1440,
  quad_hd: 1440,
  quadhd: 1440,
  ultra: 2160,
  ultra_hd: 2160,
  ultrahd: 2160,
};

/** api-contract §6: adaptive `type` values. */
const HLS_TYPES: ReadonlySet<string> = new Set([
  'hls',
  'live_hls',
  'live_playback_hls',
  'live_ondemand_hls',
  'ondemand_hls',
  'ondemand_hls_live',
]);
const DASH_TYPES: ReadonlySet<string> = new Set([
  'dash',
  'dash_uni',
  'dash_sep',
  'live_dash',
  'live_playback_dash',
  'ondemand_dash',
  'ondemand_dash_live',
]);

/**
 * One `playerUrls` entry → a source, or null for an empty URL or a type the
 * mapping table does not use (`mp4`, `webm`, `av1`, `webrtc`, `rtmp`,
 * `live_cmaf`, anything unknown).
 */
export function videoSourceOf(type: string, url: string | null | undefined): VideoSource | null {
  if (!url) {
    return null;
  }
  if (HLS_TYPES.has(type)) {
    return { format: 'hls', type, url };
  }
  if (DASH_TYPES.has(type)) {
    return { format: 'dash', type, url };
  }
  const height = PROGRESSIVE_HEIGHT[type];
  return height !== undefined ? { format: 'progressive', type, height, url } : null;
}

/**
 * The sources of one `ok_video` (by media id) in a raw post's `data[]`, in
 * the API's order; empty and unknown entries skipped. Null when no
 * `ok_video` block has this id (the video is gone from the post).
 */
export function videoSourcesOf(rawData: readonly unknown[], mediaId: string): VideoSource[] | null {
  for (const raw of rawData) {
    const typed = blockTypeDtoSchema.safeParse(raw);
    if (!typed.success || typed.data.type !== 'ok_video') {
      continue;
    }
    const block = okVideoSourcesDtoSchema.safeParse(raw);
    if (!block.success || block.data.id !== mediaId) {
      continue;
    }
    const sources: VideoSource[] = [];
    for (const rawEntry of block.data.playerUrls ?? []) {
      const entry = playerUrlDtoSchema.safeParse(rawEntry);
      const source = entry.success ? videoSourceOf(entry.data.type, entry.data.url) : null;
      if (source !== null) {
        sources.push(source);
      }
    }
    return sources;
  }
  return null;
}

/**
 * E8 for the player (`PostRepository.videoSources`): the post (the
 * overlay's author and titles), the video's title and its sources; `locked`
 * when the fresh E8 says `hasAccess=false` (or empty `data`); `unavailable`
 * for E8 404 or a video that is no longer in the post.
 */
export type VideoSourcesResult =
  | { kind: 'ok'; post: Post; videoTitle: string; sources: VideoSource[] }
  | { kind: 'locked'; post: Post }
  | { kind: 'unavailable' };
