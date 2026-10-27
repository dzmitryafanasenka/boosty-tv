import { blogPostsPageDtoSchema, feedPageDtoSchema } from '../../api/dto/feed';
import type { HttpClient } from '../../api/httpClient';
import { logger as appLogger, type Logger } from '../../services/logger';
import { mapPost } from './mapPost';
import type { Post, PostPage } from './types';

/**
 * PostRepository (AD-1, AD-8): the only caller of the post endpoints. The
 * HttpClient is passed in by the caller (the active session's, via props),
 * never imported as a singleton (Epic 2 retro, items 1–2).
 */

/** E5 page size (api-contract §3, §5). */
export const FEED_PAGE_SIZE = 10;

/**
 * E5 path. Comments are always off (`comments_limit=0&reply_limit=0`). The
 * opaque cursor goes back verbatim, URL-encoded (api-contract §5).
 */
export function feedPath(cursor: string | null): string {
  const base = `/v1/feed/post/?limit=${FEED_PAGE_SIZE}&comments_limit=0&reply_limit=0`;
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
 * One E5 page. Rejects with `AppError` (from HttpClient; `Parse` when the
 * page shape is wrong). A malformed post is dropped by the mapper; the
 * page never fails for one post. Paging stops on `isLast` or a missing
 * `extra`/`offset`.
 */
async function feedPage(
  http: HttpClient,
  cursor: string | null,
  logger: Logger = appLogger,
): Promise<PostPage> {
  const { body } = await http.get(feedPath(cursor), feedPageDtoSchema);
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

export const PostRepository = { feedPage, blogPage } as const;
