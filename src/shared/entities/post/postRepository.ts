import { AppError, isAppError } from '../../api/appError';
import { blogPostsPageDtoSchema, feedPageDtoSchema } from '../../api/dto/feed';
import { blockTypeDtoSchema, okVideoTimeCodeDtoSchema } from '../../api/dto/post';
import { blogUrlSchema } from '../../api/dto/subscriptions';
import type { HttpClient } from '../../api/httpClient';
import type { Filter } from '../../filters/filter';
import { logger as appLogger, type Logger } from '../../services/logger';
import { mapPost } from './mapPost';
import type { MediaRef, Post, PostPage, PostResult, ServerProgressSink } from './types';
import { videoSourcesOf, type VideoSourcesResult } from './videoSources';

/**
 * PostRepository (AD-1, AD-8): the only caller of the post endpoints. The
 * HttpClient is passed in by the caller (the active session's, via props),
 * never imported as a singleton (Epic 2 retro, items 1–2).
 */

/** E5 page size (api-contract §3, §5). */
export const FEED_PAGE_SIZE = 10;

/**
 * E5 access params (Story 5.3, FILTER-01, the reference's `FeedRepository`):
 * «Доступные мне» → `only_allowed=true&only_bought=false`, «Все посты» →
 * both `false`, «Только купленные» → `only_allowed=false&only_bought=true`.
 * Always sent, so the default is explicit (api-contract §3 E5).
 */
function feedAccessParams(filter: Filter): string {
  const onlyAllowed = filter.access === 'allowed';
  const onlyBought = filter.access === 'bought';
  return `only_allowed=${onlyAllowed}&only_bought=${onlyBought}`;
}

/**
 * E5 path. Comments are always off (`comments_limit=0&reply_limit=0`); the
 * Filter's access params follow. The opaque cursor goes back verbatim,
 * URL-encoded (api-contract §5).
 */
export function feedPath(cursor: string | null, filter: Filter): string {
  const base = `/v1/feed/post/?limit=${FEED_PAGE_SIZE}&comments_limit=0&reply_limit=0&${feedAccessParams(filter)}`;
  return cursor === null ? base : `${base}&offset=${encodeURIComponent(cursor)}`;
}

/** Append, then dedupe by `post.id`, keeping the first occurrence. */
export function mergePosts(...lists: ReadonlyArray<readonly Post[]>): Post[] {
  const seen = new Set<string>();
  const out: Post[] = [];
  for (const list of lists) {
    for (const post of list) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        out.push(post);
      }
    }
  }
  return out;
}

/** E4 page size (api-contract §3, the reference's `limit`). */
export const BLOG_POSTS_PAGE_SIZE = 20;

/**
 * E4 path. `blogUrl` already passed `blogUrlSchema` (no `/`, `?`, `#`, `%`,
 * `..`) and is still encoded as a path segment. Comments are always off; the
 * opaque cursor goes back verbatim, URL-encoded (api-contract §5). No
 * filter, tag or date parameter (Epic 5).
 */
export function blogPostsPath(blogUrl: string, cursor: string | null): string {
  const base = `/v1/blog/${encodeURIComponent(blogUrl)}/post/?limit=${BLOG_POSTS_PAGE_SIZE}&comments_limit=0&reply_limit=0`;
  return cursor === null ? base : `${base}&offset=${encodeURIComponent(cursor)}`;
}

/** Maps raw posts (dropping malformed ones) and reads the next cursor. */
function toPage(
  raw: readonly unknown[],
  extra: { offset?: string | null; isLast?: boolean | null } | null | undefined,
  logger: Logger,
): PostPage {
  const posts = mergePosts(
    raw.map(item => mapPost(item, logger)).filter((p): p is Post => p !== null),
  );
  const offset = extra?.offset;
  const nextCursor = extra && extra.isLast !== true && offset ? offset : null;
  return { posts, nextCursor };
}

/**
 * One E5 page with the Filter's params (Story 5.3). Rejects with `AppError`
 * (from HttpClient; `Parse` when the page shape is wrong). A malformed post
 * is dropped by the mapper; the page never fails for one post. Paging stops
 * on `isLast` or a missing `extra`/`offset`.
 */
async function feedPage(
  http: HttpClient,
  cursor: string | null,
  filter: Filter,
  logger: Logger = appLogger,
): Promise<PostPage> {
  const { body } = await http.get(feedPath(cursor, filter), feedPageDtoSchema);
  return toPage(body.data.posts, body.extra, logger);
}

/**
 * One E4 page of a blog's posts (Story 3.3). Same rules as `feedPage`: a
 * malformed post is dropped and logged (post id only), the page never fails
 * for one post, and paging stops on `isLast` or a missing `extra`/`offset`.
 */
async function blogPage(
  http: HttpClient,
  blogUrl: string,
  cursor: string | null,
  logger: Logger = appLogger,
): Promise<PostPage> {
  const { body } = await http.get(blogPostsPath(blogUrl, cursor), blogPostsPageDtoSchema);
  return toPage(body.data, body.extra, logger);
}

/**
 * E8 path (Story 3.4). Comments are always off. `blogUrl` must pass
 * `blogUrlSchema` and `postId` must be a plain segment (not `.` or `..`);
 * both are encoded as path segments. Anything else throws `AppError('Client')`
 * before a request is sent.
 */
export function postPath(blogUrl: string, postId: string): string {
  if (!blogUrlSchema.safeParse(blogUrl).success || postId.length === 0 || /^\.{1,2}$/.test(postId)) {
    throw new AppError('Client');
  }
  return `/v1/blog/${encodeURIComponent(blogUrl)}/post/${encodeURIComponent(postId)}?comments_limit=0&reply_limit=0`;
}

/**
 * E8, one post (Story 3.4), `Post` at the top level (api-contract §3). A
 * missing post is a result, not an error: E8 404 (verified `not_found`,
 * §7) → `unavailable`. HttpClient keeps no 404 body, so every E8 404 maps
 * here (as E3). A body that the one mapper rejects (no `id`, `user.blogUrl`,
 * …) is `Parse`; every other failure rejects with its `AppError`. A locked
 * post (`hasAccess=false`, empty `data`) is an ordinary `ok` result here; a
 * dead token also answers it (200 as anonymous, api-contract §7), so the
 * Post screen asks the SessionCheck port (E1) before it trusts it (Epic 3
 * retro A6). This repository never treats it as a session problem itself.
 */
async function onePost(
  http: HttpClient,
  blogUrl: string,
  postId: string,
  { logger = appLogger, onServerProgress }: E8Options = {},
): Promise<PostResult> {
  const fetched = await fetchPost(http, blogUrl, postId, logger, onServerProgress);
  return fetched === null ? { kind: 'unavailable' } : { kind: 'ok', post: fetched.post };
}

/** E8 options: the logger and the ProgressRepository's `timeCode` sink (Story 4.2). */
export type E8Options = {
  logger?: Logger;
  onServerProgress?: ServerProgressSink;
};

/**
 * Story 4.2: hands each `ok_video`'s `timeCode` (whole seconds) of an
 * accessible post's raw `data[]` to the sink, in block order. Blocks without
 * an id or a usable `timeCode` are skipped. Nothing here logs a value.
 */
function reportServerProgress(rawData: readonly unknown[], sink: ServerProgressSink) {
  for (const raw of rawData) {
    const typed = blockTypeDtoSchema.safeParse(raw);
    if (!typed.success || typed.data.type !== 'ok_video') {
      continue;
    }
    const block = okVideoTimeCodeDtoSchema.safeParse(raw);
    const timeCode = block.success ? block.data.timeCode : undefined;
    if (block.success && typeof timeCode === 'number' && Number.isFinite(timeCode)) {
      sink(block.data.id, Math.floor(timeCode));
    }
  }
}

/**
 * The one E8 request: the mapped post and the raw `data[]` (only the
 * player's `videoSources` reads it), or null for E8 404. A body the mapper
 * rejects is `Parse`; every other failure rejects with its `AppError`. The
 * `timeCode` of an accessible post's videos goes to `onServerProgress`
 * (Story 4.2), never into the post.
 */
async function fetchPost(
  http: HttpClient,
  blogUrl: string,
  postId: string,
  logger: Logger,
  onServerProgress?: ServerProgressSink,
): Promise<{ post: Post; rawData: readonly unknown[] } | null> {
  const path = postPath(blogUrl, postId);
  try {
    const { body } = await http.get(path);
    const mapped = mapPost(body, logger);
    if (mapped === null) {
      throw new AppError('Parse');
    }
    const data = (body as { data?: unknown } | null)?.data;
    const rawData = Array.isArray(data) ? data : [];
    if (onServerProgress && mapped.hasAccess) {
      reportServerProgress(rawData, onServerProgress);
    }
    return { post: mapped, rawData };
  } catch (error) {
    if (isAppError(error) && error.kind === 'NotFound') {
      return null;
    }
    throw error;
  }
}

/**
 * Player-only (Story 4.1): a fresh E8 (content profile, so the signed URLs
 * are bound to the mobile Android client, ADR 0008) and the sources of one
 * video (`MediaRef.mediaId`), for the player's media resolver. The same
 * request and mapping as `post()`; the sources never enter the Post entity.
 * A locked post (`hasAccess=false`) is `locked` (never retried here; the
 * player asks the SessionCheck port, E1, before it trusts it, because a dead
 * token also answers «locked»: api-contract §7, Epic 3 retro A6); E8 404 or
 * a video no longer in the post is `unavailable`; any other failure rejects
 * with its `AppError`.
 */
async function videoSources(
  http: HttpClient,
  ref: MediaRef,
  { logger = appLogger, onServerProgress }: E8Options = {},
): Promise<VideoSourcesResult> {
  const fetched = await fetchPost(http, ref.blogUrl, ref.postId, logger, onServerProgress);
  if (fetched === null) {
    return { kind: 'unavailable' };
  }
  const { post, rawData } = fetched;
  if (!post.hasAccess) {
    return { kind: 'locked', post };
  }
  const sources = videoSourcesOf(rawData, ref.mediaId);
  const block = post.blocks.find(b => b.type === 'ok_video' && b.id === ref.mediaId);
  if (sources === null || block === undefined || block.type !== 'ok_video') {
    return { kind: 'unavailable' };
  }
  return { kind: 'ok', post, videoTitle: block.title.trim(), sources };
}

export const PostRepository = { feedPage, blogPage, post: onePost, videoSources } as const;
