import { AppError } from '../../api/appError';
import { blogUrlSchema } from '../../api/dto/subscriptions';
import type { HttpClient } from '../../api/httpClient';
import { logger as appLogger, type Logger } from '../../services/logger';
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

export const StreamRepository = { fetchActive } as const;
