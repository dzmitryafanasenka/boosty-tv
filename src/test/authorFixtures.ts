/**
 * E3/E4 fixtures for tests (Story 3.3), built in memory from the sanitized
 * live shapes in `./fixtures/boosty/` (no new fixture files: the fixture
 * check allows only sanitized JSON there). Test-only.
 *
 * - `e3Body(blogUrl)`: the live E3 body with `blogUrl` (and a test title).
 * - `e4Page(n, …)`: the live E4 page `n` (1 or 2, 20 posts each).
 * - `syntheticBlogPosts(total)`: an E4 handler that pages `total` synthetic
 *   posts (`blog-post-<n>`) by a synthetic opaque cursor (`cursor:<n>`).
 */
import type { FixtureReply, FixtureRequest } from '../shared/api/fixtureTransport';
import { cursorFor, cursorOf, feedPost } from './feedFixtures';
import e3Blog from './fixtures/boosty/e3-blog.json';
import e3Missing from './fixtures/boosty/e3-missing-blog.json';
import e4Posts1 from './fixtures/boosty/e4-blog-posts-1.json';
import e4Posts2 from './fixtures/boosty/e4-blog-posts-2.json';

type Json = Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** E3 path of `blogUrl`. */
export const e3Path = (blogUrl: string) => `/v1/blog/${blogUrl}`;
/** E4 path of `blogUrl` (the query is not part of a FixtureRequest path). */
export const e4Path = (blogUrl: string) => `/v1/blog/${blogUrl}/post/`;

/** The live E3 body for `blogUrl`; `title`/`owner` overridable. */
export function e3Body(blogUrl: string, overrides: Json = {}): Json {
  return { ...clone(e3Blog.body as unknown as Json), blogUrl, ...overrides };
}

/** The live E3 404 `blog_not_found`. */
export function e3MissingReply(): FixtureReply {
  return { status: e3Missing.status, body: clone(e3Missing.body) };
}

/** The live E4 page `n` (1 or 2); `extra` overridable. */
export function e4Page(
  n: 1 | 2,
  extra: { offset?: string; isLast?: boolean } = { offset: 'redacted', isLast: false },
): Json & { data: Json[] } {
  const body = clone((n === 1 ? e4Posts1 : e4Posts2).body) as unknown as Json & { data: Json[] };
  body.extra = extra;
  return body;
}

/** Post `n` of `blogUrl`: a live single-video post with id `blog-post-<n>`. */
export function blogPost(blogUrl: string, n: number, overrides: Json = {}): Json {
  const post = feedPost(n);
  return {
    ...post,
    id: `blog-post-${n}`,
    user: { ...(post.user as Json), blogUrl },
    ...overrides,
  };
}

/**
 * An E4 handler over `total` synthetic posts in pages of `pageSize` (20,
 * the E4 page). The page after cursor `n` starts at post `n`.
 */
export function syntheticBlogPosts({
  blogUrl,
  total,
  pageSize = 20,
}: {
  blogUrl: string;
  total: number;
  pageSize?: number;
}): (request: FixtureRequest) => FixtureReply {
  return request => {
    const start = cursorOf(request.url) ?? 0;
    const end = Math.min(start + pageSize, total);
    const data = Array.from({ length: Math.max(0, end - start) }, (_, i) =>
      blogPost(blogUrl, start + i),
    );
    return {
      status: 200,
      body: { data, extra: { offset: cursorFor(end), isLast: end >= total } },
    };
  };
}
