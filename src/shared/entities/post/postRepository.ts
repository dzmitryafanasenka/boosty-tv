import { AppError, isAppError } from '../../api/appError';
import {
  blogPostsPageDtoSchema,
  feedPageDtoSchema,
  feedSearchItemDtoSchema,
  feedSearchPageDtoSchema,
} from '../../api/dto/feed';
import { blockTypeDtoSchema, okVideoTimeCodeDtoSchema } from '../../api/dto/post';
import { blogUrlSchema } from '../../api/dto/subscriptions';
import type { HttpClient } from '../../api/httpClient';
import { periodBounds, tagIdsKey, type Filter } from '../../filters/filter';
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
 * E5 period params (Story 5.4, FILTER-02, api-contract §3 «E5 period»):
 * none for «За всё время», else `from_ts`/`to_ts` in epoch seconds,
 * resolved here at request time from the symbolic period (local start of
 * the first day, 23:59:59 of the last day).
 */
function feedPeriodParams(filter: Filter, nowMs: number): string {
  const bounds = periodBounds(filter.period, nowMs);
  return bounds === null ? '' : `&from_ts=${bounds.fromTs}&to_ts=${bounds.toTs}`;
}

/**
 * E5 tag param (Story 5.5, FILTER-03, api-contract §3 «E5 tags»): none
 * without tags, else `tags_ids` = the sorted ids, each URL-encoded,
 * comma-joined.
 */
function feedTagParams(filter: Filter): string {
  const ids = tagIdsKey(filter);
  return ids.length === 0 ? '' : `&tags_ids=${ids.map(encodeURIComponent).join(',')}`;
}

/**
 * E5 path. Comments are always off (`comments_limit=0&reply_limit=0`); the
 * Filter's access params follow, then its period params (`nowMs` resolves
 * a preset), then its tags. The opaque cursor goes back verbatim,
 * URL-encoded (api-contract §5).
 */
export function feedPath(cursor: string | null, filter: Filter, nowMs: number = Date.now()): string {
  const base = `/v1/feed/post/?limit=${FEED_PAGE_SIZE}&comments_limit=0&reply_limit=0&${feedAccessParams(filter)}${feedPeriodParams(filter, nowMs)}${feedTagParams(filter)}`;
  return cursor === null ? base : `${base}&offset=${encodeURIComponent(cursor)}`;
}

/** E6 page size (the reference's `FeedRepository.searchData`, `limit = 10`). */
export const FEED_SEARCH_PAGE_SIZE = 10;

/**
 * E6 path (Story 5.6, api-contract §3 «E6 (LIVE)»): E5's params (comments
 * off, the `search` Filter's access, period and tag params) plus
 * `search_query` = the query, URL-encoded (Cyrillic, `&`, `#`, spaces), then
 * the opaque cursor, verbatim and URL-encoded. The caller passes the trimmed
 * query. Never logged: it is user input.
 */
export function feedSearchPath(
  query: string,
  cursor: string | null,
  filter: Filter,
  nowMs: number = Date.now(),
): string {
  const base = `/v1/search/feed/post/?limit=${FEED_SEARCH_PAGE_SIZE}&comments_limit=0&reply_limit=0&${feedAccessParams(filter)}${feedPeriodParams(filter, nowMs)}${feedTagParams(filter)}&search_query=${encodeURIComponent(query)}`;
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
 * E4/E7 access params (Story 5.7, FILTER-01, the reference's
 * `BlogRepository`): a blog uses `is_only_allowed` where the feed uses
 * `only_allowed`. «Доступные мне» → `is_only_allowed=true`, «Все посты» →
 * `false`. `only_bought` is always `false`: E4 and E7 ignore
 * `only_bought=true` (live, api-contract §3 «E4 filters (LIVE)»), so the
 * Author scope never offers «Только купленные» (owner decision 2026-10-29,
 * A a). Always sent, so the default is explicit (owner decision 2026-10-29
 * Q2 a).
 */
function blogAccessParams(filter: Filter): string {
  return `is_only_allowed=${filter.access === 'allowed'}&only_bought=false`;
}

/**
 * E4 path. `blogUrl` already passed `blogUrlSchema` (no `/`, `?`, `#`, `%`,
 * `..`) and is still encoded as a path segment. Comments are always off;
 * the Filter's blog access params follow (Story 5.7), then the shared period
 * params (`nowMs` resolves a preset) and tag param; the opaque cursor goes
 * back verbatim, URL-encoded (api-contract §5).
 */
export function blogPostsPath(
  blogUrl: string,
  cursor: string | null,
  filter: Filter,
  nowMs: number = Date.now(),
): string {
  const base = `/v1/blog/${encodeURIComponent(blogUrl)}/post/?limit=${BLOG_POSTS_PAGE_SIZE}&comments_limit=0&reply_limit=0&${blogAccessParams(filter)}${feedPeriodParams(filter, nowMs)}${feedTagParams(filter)}`;
  return cursor === null ? base : `${base}&offset=${encodeURIComponent(cursor)}`;
}

/** E7 page size (the reference's blog search `limit`, as E4). */
export const BLOG_SEARCH_PAGE_SIZE = 20;

/**
 * E7 path (Story 5.7, api-contract §3 «E7 (LIVE)», the reference's
 * `BoostyApi.blogSearchPosts`): `blog_url` (URL-encoded), comments off, the
 * Filter's E4 params (blog access, period, tags), `search_query` = the
 * trimmed query, URL-encoded, then the opaque cursor, verbatim and
 * URL-encoded. Never logged: the query is user input.
 */
export function blogSearchPath(
  blogUrl: string,
  query: string,
  cursor: string | null,
  filter: Filter,
  nowMs: number = Date.now(),
): string {
  const base = `/v1/search/blog/post/?blog_url=${encodeURIComponent(blogUrl)}&limit=${BLOG_SEARCH_PAGE_SIZE}&comments_limit=0&reply_limit=0&${blogAccessParams(filter)}${feedPeriodParams(filter, nowMs)}${feedTagParams(filter)}&search_query=${encodeURIComponent(query)}`;
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
 * One E5 page with the Filter's params (Stories 5.3–5.4; `now` resolves the
 * period at request time, never earlier). Rejects with `AppError`
 * (from HttpClient; `Parse` when the page shape is wrong). A malformed post
 * is dropped by the mapper; the page never fails for one post. Paging stops
 * on `isLast` or a missing `extra`/`offset`.
 */
async function feedPage(
  http: HttpClient,
  cursor: string | null,
  filter: Filter,
  now: number = Date.now(),
  logger: Logger = appLogger,
): Promise<PostPage> {
  const { body } = await http.get(feedPath(cursor, filter, now), feedPageDtoSchema);
  return toPage(body.data.posts, body.extra, logger);
}

/**
 * One E6 page of «Поиск по подпискам» (Story 5.6) for the trimmed `query`
 * and the `search` Filter (`now` resolves the period at request time). An
 * item without a `post` object is dropped and counted in the log (no value
 * logged); a malformed post is dropped by the mapper; the page never fails
 * for one item. Rejects with `AppError` (`Parse` when `data.searchPosts` is
 * missing). Paging as E5 (`isLast`, a missing `extra`/`offset`).
 */
async function feedSearchPage(
  http: HttpClient,
  query: string,
  cursor: string | null,
  filter: Filter,
  now: number = Date.now(),
  logger: Logger = appLogger,
): Promise<PostPage> {
  return searchPage(http, feedSearchPath(query, cursor, filter, now), logger);
}

/**
 * One E7 page of «Поиск в блоге» (Story 5.7) for the trimmed `query` and
 * the route's author Filter: parsed as E6 (`data.searchPosts[].post` +
 * `extra`, one post mapper; an item without a `post` object dropped and
 * counted, never the page; `Parse` when `data.searchPosts` is missing).
 */
async function blogSearchPage(
  http: HttpClient,
  blogUrl: string,
  query: string,
  cursor: string | null,
  filter: Filter,
  now: number = Date.now(),
  logger: Logger = appLogger,
): Promise<PostPage> {
  return searchPage(http, blogSearchPath(blogUrl, query, cursor, filter, now), logger);
}

/** One E6/E7 page: `data.searchPosts[].post` through the one post mapper. */
async function searchPage(http: HttpClient, path: string, logger: Logger): Promise<PostPage> {
  const { body } = await http.get(path, feedSearchPageDtoSchema);
  const raw: unknown[] = [];
  let dropped = 0;
  for (const item of body.data.searchPosts) {
    const parsed = feedSearchItemDtoSchema.safeParse(item);
    if (parsed.success) {
      raw.push(parsed.data.post);
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    logger.warn('search', 'dropped', { count: dropped });
  }
  return toPage(raw, body.extra, logger);
}

/**
 * One E4 page of a blog's posts (Story 3.3) with the Filter's params (Story
 * 5.7; `now` resolves the period at request time). Same rules as
 * `feedPage`: a malformed post is dropped and logged (post id only), the
 * page never fails for one post, and paging stops on `isLast` or a missing
 * `extra`/`offset`.
 */
async function blogPage(
  http: HttpClient,
  blogUrl: string,
  cursor: string | null,
  filter: Filter,
  now: number = Date.now(),
  logger: Logger = appLogger,
): Promise<PostPage> {
  const { body } = await http.get(blogPostsPath(blogUrl, cursor, filter, now), blogPostsPageDtoSchema);
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

export const PostRepository = {
  feedPage,
  feedSearchPage,
  blogPage,
  blogSearchPage,
  post: onePost,
  videoSources,
} as const;
