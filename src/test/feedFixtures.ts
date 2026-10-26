/**
 * E5 feed fixtures for tests (Story 3.1), built in memory from the sanitized
 * live shapes in `./fixtures/boosty/` (no new fixture files: the fixture
 * check allows only sanitized JSON there). Test-only.
 *
 * - `e5Page()`: the live E5 page (10 posts), as the last page by default.
 * - `feedPost(n)`: post `n` cloned from a live post with a synthetic id.
 * - `syntheticFeed(total)`: an E5 handler that pages `total` posts by a
 *   synthetic opaque cursor (`cursor:<n>`; encoded on the wire).
 */
import type { FixtureReply, FixtureRequest } from '../shared/api/fixtureTransport';
import e5Feed from './fixtures/boosty/e5-feed.json';
import e8Locked from './fixtures/boosty/e8-post-locked.json';

export const E5_PATH = '/v1/feed/post/';

type Json = Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The live E5 posts, in order. */
export function e5Posts(): Json[] {
  return clone((e5Feed.body.data.posts as unknown[]) as Json[]);
}

/** The live E5 body; `isLast` true unless `{ isLast: false, offset }`. */
export function e5Page({
  isLast = true,
  offset = 'redacted',
}: { isLast?: boolean; offset?: string } = {}): Json {
  const body = clone(e5Feed.body) as Json & { extra: Json };
  body.extra = { offset, isLast };
  return body;
}

/** A live locked post (E8 shape, also the E4/E5 post shape). */
export function lockedPost(): Json {
  return clone(e8Locked.body as unknown as Json);
}

/** A single-video live post (`e5Posts()[1]`) as a template. */
const VIDEO_TEMPLATE_INDEX = 1;
const BASE_TIME = 1_700_000_000;

/** Post `n` (0-based): a single-video post with id `feed-post-<n>`, newest first. */
export function feedPost(n: number, overrides: Json = {}): Json {
  const post = e5Posts()[VIDEO_TEMPLATE_INDEX];
  const createdAt = BASE_TIME - n * 3600;
  return {
    ...post,
    id: `feed-post-${n}`,
    int_id: 10_000 + n,
    intId: 10_000 + n,
    title: `Post ${n}`,
    createdAt,
    publishTime: createdAt,
    ...overrides,
  };
}

export const cursorFor = (n: number) => `cursor:${n}`;

/** The cursor `n` from a request URL (null: the first page). */
export function cursorOf(url: string): number | null {
  const match = /[?&]offset=([^&]*)/.exec(url);
  if (!match) {
    return null;
  }
  const value = decodeURIComponent(match[1]);
  return value.startsWith('cursor:') ? Number(value.slice('cursor:'.length)) : NaN;
}

/**
 * An E5 handler over `total` synthetic posts in pages of `pageSize`. The
 * page after cursor `n` starts at post `n`. `overlap` repeats that many
 * posts of the previous page at the start of each next page (dedupe).
 */
export function syntheticFeed({
  total,
  pageSize = 10,
  overlap = 0,
}: {
  total: number;
  pageSize?: number;
  overlap?: number;
}): (request: FixtureRequest) => FixtureReply {
  return request => {
    const cursor = cursorOf(request.url);
    const start = cursor === null ? 0 : Math.max(0, cursor - overlap);
    const end = Math.min((cursor ?? 0) + pageSize, total);
    const posts = Array.from({ length: Math.max(0, end - start) }, (_, i) => feedPost(start + i));
    return {
      status: 200,
      body: {
        data: { posts, blogs: [], counters: {} },
        extra: { offset: cursorFor(end), isLast: end >= total },
      },
    };
  };
}
