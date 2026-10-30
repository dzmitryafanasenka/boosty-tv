import { AppError } from '../../api/appError';
import { blogUrlSchema } from '../../api/dto/subscriptions';
import type { HttpClient } from '../../api/httpClient';
import { logger as appLogger, type Logger } from '../../services/logger';
import type { VideoSource } from '../post/videoSources';
import { liveSourcesOf } from './liveSources';
import { mapStream } from './mapStream';
import type { Stream } from './types';

/**
 * StreamRepository (Story 7.1, AD-1, api-contract «E15 (LIVE)»): the only
 * caller of E15. The HttpClient is the active session's, passed in by the
 * caller (never a singleton). Features never call E15 themselves; the
 * Author page reads it through the `['stream', blogUrl]` query.
 */

/**
 * E15 path. `blogUrl` must pass `blogUrlSchema` (as `pollPath`) and is
 * encoded as a path segment; anything else throws `AppError('Client')`
 * before a request is sent.
 */
export function streamPath(blogUrl: string): string {
  if (!blogUrlSchema.safeParse(blogUrl).success) {
    throw new AppError('Client');
  }
  return `/v1/blog/${encodeURIComponent(blogUrl)}/video_stream`;
}

/**
 * E15: the blog's active or scheduled stream, or null for none. A 204 (live:
 * an empty body) or any 2xx with an empty body is no stream; a malformed
 * body is no stream too (the mapper logs counts only). Sent once: no AD-6
 * retry (`retry: false`), since the Author page polls a shown card anyway
 * and a failed first load simply shows no card. Rejects with the
 * HttpClient's `AppError`.
 */
async function fetchActive(
  http: HttpClient,
  blogUrl: string,
  logger: Logger = appLogger,
): Promise<Stream | null> {
  const { status, body } = await http.request({ path: streamPath(blogUrl), retry: false });
  if (status === 204 || body === null || body === undefined) {
    return null;
  }
  return mapStream(body, logger);
}

/**
 * E15 for the live player (Story 7.2): `ok` with the stream and its
 * live-edge sources (`liveSourcesOf`, possibly empty, also for
 * `hasAccess: false`: the caller decides), or `none` when there is no live
 * stream to play (a 204 or empty body, a malformed body, or a stream that is
 * scheduled or no longer online).
 */
export type LiveSourcesResult =
  | { kind: 'ok'; stream: Stream; sources: VideoSource[] }
  | { kind: 'none' };

/**
 * E15 for the player: the same request as `fetchActive` (content profile, no
 * AD-6 retry: the player owns its one automatic re-fetch). The signed URLs
 * stay in the returned value only (memory); nothing here logs them.
 */
async function liveSources(
  http: HttpClient,
  blogUrl: string,
  logger: Logger = appLogger,
): Promise<LiveSourcesResult> {
  const { status, body } = await http.request({ path: streamPath(blogUrl), retry: false });
  if (status === 204 || body === null || body === undefined) {
    return { kind: 'none' };
  }
  const stream = mapStream(body, logger);
  if (stream === null || stream.status !== 'live') {
    return { kind: 'none' };
  }
  const data = (body as { data?: unknown }).data;
  return { kind: 'ok', stream, sources: liveSourcesOf(Array.isArray(data) ? data : []) };
}

export const StreamRepository = { fetchActive, liveSources } as const;
