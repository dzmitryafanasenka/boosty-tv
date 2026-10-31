import type { QueryClient } from '@tanstack/react-query';
import type { Poll } from './types';

/**
 * Story 6.6 (epic 6 «Poll state»): the poll inside the cached Posts is the
 * only poll state; there is no poll query key. After E10, `applyPoll`
 * writes the fresh poll into every cached post and list page that holds a
 * poll with its id: the E8 `post` queries (`PostResult {kind:'ok', post}`)
 * and the infinite `feed`, `search` (E6, E7) and `authorPosts` queries
 * (`InfiniteData<PostPage>`).
 *
 * - Pure replacement (`withPoll`): any other cache shape, a page without
 *   `posts`, a post without the poll is returned as the same object, so a
 *   query with no match is never written.
 * - Each written query keeps its `dataUpdatedAt`: a vote never makes a list
 *   look fresh, so it never delays the feed-head refresh on resume.
 * - Limit (accepted, Epic 6 retro R3): a list page append or a head refresh
 *   that started before this write and lands after it replaces the page
 *   with the poll it fetched, so the list may keep the pre-vote poll until
 *   its next refetch. Nothing visible depends on it (list cards show no poll
 *   results); the Пост reads its own `post` query, which E10 wrote (and
 *   whose E8 is re-sent when E10 fails).
 */

/** The query-cache roots whose data can hold a Post (queryKeys). */
export const POLL_CACHE_ROOTS = ['post', 'feed', 'search', 'authorPosts'] as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A post (any object with `poll.id`) with the fresh poll, or the same object. */
function postWithPoll(post: unknown, poll: Poll): unknown {
  if (!isObject(post) || !isObject(post.poll) || post.poll.id !== poll.id) {
    return post;
  }
  return { ...post, poll };
}

/** A list page (`{posts: Post[]}`) with the poll replaced, or the same object. */
function pageWithPoll(page: unknown, poll: Poll): unknown {
  if (!isObject(page) || !Array.isArray(page.posts)) {
    return page;
  }
  let changed = false;
  const posts = page.posts.map(post => {
    const next = postWithPoll(post, poll);
    changed = changed || next !== post;
    return next;
  });
  return changed ? { ...page, posts } : page;
}

/**
 * Pure: `data` with every post holding a poll of `poll.id` given `poll`.
 * Knows a `PostResult` (`{kind:'ok', post}`) and an `InfiniteData`
 * (`{pages: [{posts}], pageParams}`); anything else, or no match, is the
 * same object.
 */
export function withPoll<T>(data: T, poll: Poll): T {
  if (!isObject(data)) {
    return data;
  }
  if (data.kind === 'ok' && 'post' in data) {
    const post = postWithPoll(data.post, poll);
    return (post === data.post ? data : { ...data, post }) as T;
  }
  if (Array.isArray(data.pages)) {
    let changed = false;
    const pages = data.pages.map(page => {
      const next = pageWithPoll(page, poll);
      changed = changed || next !== page;
      return next;
    });
    return (changed ? { ...data, pages } : data) as T;
  }
  return data;
}

/**
 * Writes `poll` into every cached post and page holding it (see above).
 * Returns how many queries were written (tests, diagnostics; never logged
 * with an id).
 */
export function applyPoll(client: QueryClient, poll: Poll): number {
  let written = 0;
  const cache = client.getQueryCache();
  for (const root of POLL_CACHE_ROOTS) {
    for (const query of cache.findAll({ queryKey: [root] })) {
      const data = query.state.data;
      if (data === undefined) {
        continue;
      }
      const next = withPoll(data, poll);
      if (next !== data) {
        client.setQueryData(query.queryKey, next, { updatedAt: query.state.dataUpdatedAt });
        written += 1;
      }
    }
  }
  return written;
}
