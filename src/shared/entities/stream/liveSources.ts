import { blockTypeDtoSchema, playerUrlDtoSchema } from '../../api/dto/post';
import { okStreamSourcesDtoSchema } from '../../api/dto/stream';
import { safeHttpUrl } from '../externalUrls';
import { videoSourceOf, type VideoSource } from '../post/videoSources';

/**
 * Player-only live sources (Story 7.2, LIVE-02, api-contract «E15 (LIVE)»):
 * the live-edge `playerUrls` of a raw E15 body's `ok_stream` blocks. The
 * Stream entity never carries them (it keeps a `hasLiveSources` flag only).
 * The URLs are signed CDN URLs: memory only, never in a route, a query key,
 * storage, a log or a fixture.
 *
 * Candidates (epic-7-context «Watching»):
 * - `ok_stream` blocks only (an `ok_video` in a stream body is a recording);
 * - the live-edge types `live_hls` and `live_dash` only: `live_playback_*`
 *   is the DVR window and `live_ondemand_hls` an on-demand copy, so neither
 *   plays at the live edge; `live_cmaf` and every progressive or unknown
 *   type are not used (api-contract §6);
 * - empty URLs and anything but an absolute http(s) URL (`safeHttpUrl`:
 *   `file:`, relative, `javascript:`, …) are skipped: the shape is
 *   reference-only and the URL goes to the native engine;
 * - HLS first, then DASH, each in the API's order.
 */
export const LIVE_EDGE_TYPES: ReadonlySet<string> = new Set(['live_hls', 'live_dash']);

export function liveSourcesOf(rawData: readonly unknown[] | null | undefined): VideoSource[] {
  const hls: VideoSource[] = [];
  const dash: VideoSource[] = [];
  for (const raw of rawData ?? []) {
    const typed = blockTypeDtoSchema.safeParse(raw);
    if (!typed.success || typed.data.type !== 'ok_stream') {
      continue;
    }
    const block = okStreamSourcesDtoSchema.safeParse(raw);
    if (!block.success) {
      continue;
    }
    for (const rawEntry of block.data.playerUrls ?? []) {
      const entry = playerUrlDtoSchema.safeParse(rawEntry);
      if (!entry.success || !LIVE_EDGE_TYPES.has(entry.data.type)) {
        continue;
      }
      const source = videoSourceOf(entry.data.type, safeHttpUrl(entry.data.url));
      if (source?.format === 'hls') {
        hls.push(source);
      } else if (source?.format === 'dash') {
        dash.push(source);
      }
    }
  }
  return [...hls, ...dash];
}

/**
 * The live source to play: the first candidate (HLS before DASH, as
 * `liveSourcesOf` orders them), or the candidate of the chosen quality row.
 * Every live candidate is adaptive, so the quality rows are «Авто» only;
 * the picker stays separate from the VOD `pickSource` on purpose.
 */
export function pickLiveSource(sources: readonly VideoSource[]): VideoSource | null {
  return sources[0] ?? null;
}
