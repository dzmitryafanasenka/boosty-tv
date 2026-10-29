/**
 * E8 fixtures for tests (Story 3.4), built in memory from the sanitized live
 * shapes in `./fixtures/boosty/` (no new fixture files: the fixture check
 * allows only sanitized JSON there). Test-only.
 *
 * - `e8Accessible()` / `e8Locked()`: the live accessible and locked E8 bodies.
 * - `e8MissingReply()`: the live E8 404 `not_found`.
 * - `postDetail(blogUrl, postId, data, overrides)`: a synthetic E8 body (the
 *   live accessible post with these blocks).
 * - `text(s)`, `paragraph(s)`: `text` fragments in the live shape.
 */
import type { FixtureReply } from '../shared/api/fixtureTransport';
import e8Accessible_ from './fixtures/boosty/e8-post-accessible.json';
import e8Locked_ from './fixtures/boosty/e8-post-locked.json';
import e8Missing from './fixtures/boosty/e8-missing-post.json';

type Json = Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** E8 path of a post (the query is not part of a FixtureRequest path). */
export const e8Path = (blogUrl: string, postId: string) => `/v1/blog/${blogUrl}/post/${postId}`;

/**
 * The live accessible E8 body (one video, many paragraphs, inline links).
 * Story 6.1 additions: sanitized style ranges on its first two fragments
 * (bold is seen live) and one synthetic `smile` block (name
 * `synthetic-key-1`, before the last paragraph end; no emoji was seen live).
 * Story 6.3 additions: three synthetic blocks at the end of `data` in the
 * live key sets (api-contract §4.1 «File and video blocks (LIVE)»): a
 * `header`, a `file` (`synthetic-id-13`, `https://example.invalid/file`,
 * 200 KiB) and a `video` (`https://example.invalid/video`; a real YouTube
 * URL cannot pass `check:fixtures`).
 * Story 6.4 addition: one synthetic `audio_file` block after them, in the
 * live key set (api-contract §4.1 «Audio blocks (LIVE)»): `synthetic-id-14`,
 * `https://example.invalid/audio`, 3:00.
 */
export function e8Accessible(): Json {
  return clone(e8Accessible_.body as unknown as Json);
}

/** The live locked E8 body (`hasAccess=false`, empty `data`, a teaser image). */
export function e8Locked(): Json {
  return clone(e8Locked_.body as unknown as Json);
}

/** The live E8 404 `not_found`. */
export function e8MissingReply(): FixtureReply {
  return { status: e8Missing.status, body: clone(e8Missing.body) };
}

/** A text fragment (no paragraph end). */
export const text = (s: string): Json => ({
  type: 'text',
  content: JSON.stringify([s, 'unstyled', []]),
  modificator: '',
});

/** The live paragraph end. */
export const blockEnd = (): Json => ({ type: 'text', content: '', modificator: 'BLOCK_END' });

/** One paragraph: a fragment and the paragraph end. */
export const paragraph = (s: string): Json[] => [text(s), blockEnd()];

/** A synthetic E8 body: the live accessible post with these blocks and ids. */
export function postDetail(
  blogUrl: string,
  postId: string,
  data: unknown[],
  overrides: Json = {},
): Json {
  const body = e8Accessible();
  return {
    ...body,
    id: postId,
    title: `Title of ${postId}`,
    user: { ...(body.user as Json), blogUrl },
    data,
    ...overrides,
  };
}
