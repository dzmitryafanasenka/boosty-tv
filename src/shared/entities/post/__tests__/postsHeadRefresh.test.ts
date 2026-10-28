import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { AppError, QUERY_STALE_TIME_MS, queryKeys } from '../../../api';
import { createLogger } from '../../../services/logger';
import {
  mergePostsHead,
  refreshPostsHead,
  trimPostsToFirstPage,
  type PostsData,
} from '../postsHeadRefresh';
import type { Post, PostPage } from '../types';

const KEY_A = queryKeys.authorPosts('blog-a');
const KEY_B = queryKeys.authorPosts('blog-b');
const T0 = 1_000_000;

const post = (id: string) => ({ id }) as Post;
const pinnedPost = (id: string) => ({ id, pinned: true }) as Post;
const page = (ids: string[], nextCursor: string | null): PostPage => ({
  posts: ids.map(post),
  nextCursor,
});
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `p${from + i}`);
const twoPages = (): PostsData => ({
  pages: [page(range(0, 20), 'c20'), page(range(20, 40), 'c40')],
  pageParams: [null, 'c20'],
});
const ids = (data: PostsData | undefined) => data?.pages.flatMap(p => p.posts.map(x => x.id));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => client.clear());

const seed = (key: readonly unknown[], data: PostsData = twoPages(), updatedAt = T0) =>
  client.setQueryData<PostsData>(key, data, { updatedAt });

describe('mergePostsHead', () => {
  it('collapses page 1 into the cached head; a gap replaces the cache', () => {
    const cache = twoPages();
    const merged = mergePostsHead(cache, page(['n1', 'n2', ...range(0, 18)], 'c18'));
    expect(merged.kind).toBe('prepended');
    expect(ids(merged.data)?.slice(0, 3)).toEqual(['n1', 'n2', 'p0']);
    expect(merged.data.pages[0].nextCursor).toBe('c20');
    expect(merged.data.pages[1]).toBe(cache.pages[1]);
    expect(mergePostsHead(cache, page(range(0, 20), 'c20')).kind).toBe('unchanged');
    // Default (no option): an empty page 1 is a gap, with or without a next cursor.
    expect(mergePostsHead(cache, page([], 'c0'))).toEqual({
      kind: 'replaced',
      data: { pages: [page([], 'c0')], pageParams: [null] },
    });
    expect(mergePostsHead(cache, page([], null)).kind).toBe('replaced');
    // keepEmptyWithMore (Автор, Главная): empty with a next cursor keeps the cache
    // object; an empty last page still replaces it.
    const keep = { keepEmptyWithMore: true };
    expect(mergePostsHead(cache, page([], 'c0'), keep)).toEqual({ kind: 'unchanged', data: cache });
    expect(mergePostsHead(cache, page([], 'c0'), keep).data).toBe(cache);
    expect(mergePostsHead(cache, page([], null), keep)).toEqual({
      kind: 'replaced',
      data: { pages: [page([], null)], pageParams: [null] },
    });
    const gap = page(['x1', 'x2'], 'cx');
    expect(mergePostsHead(cache, gap)).toEqual({
      kind: 'replaced',
      data: { pages: [gap], pageParams: [null] },
    });
  });
});

describe('refreshPostsHead (any paged post key)', () => {
  it('stale: one first-page request, merged; fresh: nothing sent', async () => {
    seed(KEY_A);
    const fetch = jest.fn().mockResolvedValue(page(['n1', ...range(0, 19)], 'c19'));
    expect(await refreshPostsHead(client, KEY_A, fetch, T0 + QUERY_STALE_TIME_MS - 1)).toBe('skipped');
    expect(fetch).not.toHaveBeenCalled();
    expect(await refreshPostsHead(client, KEY_A, fetch, T0 + QUERY_STALE_TIME_MS)).toBe('prepended');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ids(client.getQueryData<PostsData>(KEY_A))?.[0]).toBe('n1');
    expect(client.getQueryState(KEY_A)?.dataUpdatedAt).toBe(T0 + QUERY_STALE_TIME_MS);
  });

  it('single-flight per key: the same key is skipped while it runs, another key runs', async () => {
    seed(KEY_A);
    seed(KEY_B);
    const replyA = deferred<PostPage>();
    const fetchA = jest.fn().mockReturnValue(replyA.promise);
    const fetchB = jest.fn().mockResolvedValue(page(range(0, 20), 'c20'));
    const now = T0 + QUERY_STALE_TIME_MS;
    const first = refreshPostsHead(client, KEY_A, fetchA, now);
    expect(await refreshPostsHead(client, KEY_A, fetchA, now)).toBe('skipped');
    expect(await refreshPostsHead(client, KEY_B, fetchB, now)).toBe('unchanged');
    replyA.resolve(page(['n1', ...range(0, 19)], 'c19'));
    expect(await first).toBe('prepended');
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it('the query is fetching: nothing sent; a fetch that starts meanwhile drops the reply', async () => {
    seed(KEY_A);
    const query = client.getQueryCache().find({ queryKey: KEY_A })!;
    query.setState({ fetchStatus: 'fetching' });
    const fetch = jest.fn();
    expect(await refreshPostsHead(client, KEY_A, fetch, T0 + QUERY_STALE_TIME_MS)).toBe('skipped');
    expect(fetch).not.toHaveBeenCalled();

    query.setState({ fetchStatus: 'idle' });
    const reply = deferred<PostPage>();
    const run = refreshPostsHead(client, KEY_A, () => reply.promise, T0 + QUERY_STALE_TIME_MS);
    query.setState({ fetchStatus: 'fetching' });
    reply.resolve(page(['n1'], null));
    expect(await run).toBe('skipped');
    expect(ids(client.getQueryData<PostsData>(KEY_A))?.[0]).toBe('p0');
  });

  it('a cache reset meanwhile: the reply is dropped', async () => {
    seed(KEY_A);
    const reply = deferred<PostPage>();
    const run = refreshPostsHead(client, KEY_A, () => reply.promise, T0 + QUERY_STALE_TIME_MS);
    client.clear();
    reply.resolve(page(['n1', ...range(0, 19)], 'c19'));
    expect(await run).toBe('skipped');
    expect(client.getQueryData(KEY_A)).toBeUndefined();
  });

  it('a failure is silent; the kind is logged under the given scope (default `post`)', async () => {
    const data = twoPages();
    seed(KEY_A, data);
    const logger = createLogger({ console: false });
    const failing = () => Promise.reject(new AppError('Server'));
    const now = T0 + QUERY_STALE_TIME_MS;
    expect(await refreshPostsHead(client, KEY_A, failing, now, logger)).toBe('failed');
    expect(
      await refreshPostsHead(client, KEY_A, failing, now, logger, { scope: 'author', message: 'm' }),
    ).toBe('failed');
    expect(client.getQueryData(KEY_A)).toBe(data);
    expect(logger.entries()).toEqual([
      expect.objectContaining({ level: 'warn', scope: 'post', message: 'head refresh failed', fields: { kind: 'Server' } }),
      expect.objectContaining({ level: 'warn', scope: 'author', message: 'm', fields: { kind: 'Server' } }),
    ]);
  });

  it('an empty fresh page 1, default (no option; Автор and Главная set keepEmptyWithMore): the cache is replaced', async () => {
    seed(KEY_A);
    const now = T0 + QUERY_STALE_TIME_MS;
    const fetch = jest.fn().mockResolvedValue(page([], 'c0'));
    expect(await refreshPostsHead(client, KEY_A, fetch, now)).toBe('replaced');
    expect(client.getQueryData(KEY_A)).toEqual({ pages: [page([], 'c0')], pageParams: [null] });
    expect(client.getQueryState(KEY_A)?.dataUpdatedAt).toBe(now);
  });

  it('keepEmptyWithMore, empty page 1 with a next cursor: the cached posts stay, written back with the new age', async () => {
    const data = twoPages();
    seed(KEY_A, data);
    const now = T0 + QUERY_STALE_TIME_MS;
    const opts = { keepEmptyWithMore: true };
    const fetch = jest.fn().mockResolvedValue(page([], 'c0'));
    expect(await refreshPostsHead(client, KEY_A, fetch, now, undefined, undefined, opts)).toBe('unchanged');
    expect(ids(client.getQueryData<PostsData>(KEY_A))).toEqual(ids(data));
    expect(client.getQueryState(KEY_A)?.dataUpdatedAt).toBe(now);
    // Fresh now: the next trigger within a staleTime sends nothing.
    expect(await refreshPostsHead(client, KEY_A, fetch, now + 1, undefined, undefined, opts)).toBe('skipped');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keepEmptyWithMore, empty last page 1: the cache is replaced (a truly empty list)', async () => {
    seed(KEY_A);
    const now = T0 + QUERY_STALE_TIME_MS;
    const fetch = jest.fn().mockResolvedValue(page([], null));
    expect(
      await refreshPostsHead(client, KEY_A, fetch, now, undefined, undefined, { keepEmptyWithMore: true }),
    ).toBe('replaced');
    expect(client.getQueryData(KEY_A)).toEqual({ pages: [page([], null)], pageParams: [null] });
  });

  it('skipWhileError, the query in an error state (a failed page append): nothing sent; a reply after it entered one is dropped', async () => {
    const data = twoPages();
    seed(KEY_A, data);
    const query = client.getQueryCache().find({ queryKey: KEY_A })!;
    query.setState({ status: 'error', error: new AppError('Network') });
    const fetch = jest.fn().mockResolvedValue(page(['n1', ...range(0, 19)], 'c19'));
    const now = T0 + QUERY_STALE_TIME_MS;
    const opts = { skipWhileError: true };
    expect(await refreshPostsHead(client, KEY_A, fetch, now, undefined, undefined, opts)).toBe('skipped');
    expect(fetch).not.toHaveBeenCalled();
    // Without the option, the refresh runs.
    expect(await refreshPostsHead(client, KEY_A, fetch, now)).toBe('prepended');
    expect(fetch).toHaveBeenCalledTimes(1);

    seed(KEY_A, data);
    query.setState({ status: 'success', error: null });
    const reply = deferred<PostPage>();
    const run = refreshPostsHead(client, KEY_A, () => reply.promise, now, undefined, undefined, opts);
    query.setState({ status: 'error', error: new AppError('Network') });
    reply.resolve(page(['n1', ...range(0, 19)], 'c19'));
    expect(await run).toBe('skipped');
    expect(ids(client.getQueryData<PostsData>(KEY_A))).toEqual(ids(twoPages()));
    expect(client.getQueryState(KEY_A)?.status).toBe('error');
  });

  it('single-flight is released after a success and after a failure', async () => {
    const logger = createLogger({ console: false });
    seed(KEY_A);
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(page(['n1', ...range(0, 19)], 'c19'))
      .mockRejectedValueOnce(new AppError('Server'))
      .mockResolvedValueOnce(page(['n2', 'n1', ...range(0, 18)], 'c18'));
    const t1 = T0 + QUERY_STALE_TIME_MS;
    expect(await refreshPostsHead(client, KEY_A, fetch, t1, logger)).toBe('prepended');
    // The success moved the cache's age: the next run is due a staleTime later.
    const t2 = t1 + QUERY_STALE_TIME_MS;
    expect(await refreshPostsHead(client, KEY_A, fetch, t2, logger)).toBe('failed');
    expect(await refreshPostsHead(client, KEY_A, fetch, t2, logger)).toBe('prepended');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(ids(client.getQueryData<PostsData>(KEY_A))?.slice(0, 3)).toEqual(['n2', 'n1', 'p0']);
  });
});

describe('mergePostsHead with pinnedFirst (Автор, Epic 3 retro A1)', () => {
  /** Author cache: the pin first, then p0…p38 over two pages. */
  const authorCache = (): PostsData => ({
    pages: [
      { posts: [pinnedPost('pin'), ...range(0, 19).map(post)], nextCursor: 'c19' },
      page(range(19, 39), 'c39'),
    ],
    pageParams: [null, 'c19'],
  });

  it('20+ new posts: only the pin is shared — a gap, page 1 replaces the cache (no silent loss)', () => {
    const fresh: PostPage = { posts: [pinnedPost('pin'), ...range(100, 119).map(post)], nextCursor: 'n' };
    const merged = mergePostsHead(authorCache(), fresh, { pinnedFirst: true });
    expect(merged.kind).toBe('replaced');
    expect(ids(merged.data)).toEqual(['pin', ...range(100, 119)]);
    // Without the option (Главная) the pin counts as overlap: merged, as before.
    expect(mergePostsHead(authorCache(), fresh).kind).toBe('prepended');
  });

  it('an ordinary refresh with a shared non-pinned post still merges', () => {
    const fresh: PostPage = { posts: [pinnedPost('pin'), post('new'), ...range(0, 18).map(post)], nextCursor: 'n' };
    const merged = mergePostsHead(authorCache(), fresh, { pinnedFirst: true });
    expect(merged.kind).toBe('prepended');
    expect(ids(merged.data)?.slice(0, 3)).toEqual(['pin', 'new', 'p0']);
    expect(ids(merged.data)).toHaveLength(41);
  });

  it('a re-pin: one badge; the old pin leaves the head (no out-of-order card)', () => {
    const fresh: PostPage = { posts: [pinnedPost('p5'), ...range(0, 5).map(post), ...range(6, 18).map(post)], nextCursor: 'n' };
    const merged = mergePostsHead(authorCache(), fresh, { pinnedFirst: true });
    const pinned = merged.data.pages.flatMap(p => p.posts).filter(p => p.pinned).map(p => p.id);
    expect(pinned).toEqual(['p5']);
    expect(ids(merged.data)).not.toContain('pin');
    expect(merged.data.pages[0].posts.map(p => p.id).slice(0, 3)).toEqual(['p5', 'p0', 'p1']);
  });

  it('an unpin (no pin on the fresh page): the old pin leaves the head', () => {
    const fresh = page(range(0, 19), 'n');
    const merged = mergePostsHead(authorCache(), fresh, { pinnedFirst: true });
    expect(merged.data.pages.flatMap(p => p.posts).some(p => p.pinned)).toBe(false);
    expect(ids(merged.data)?.[0]).toBe('p0');
  });

  it('without the option (Главная) pin flags are left as they are', () => {
    const fresh = page(range(0, 19), 'n');
    const merged = mergePostsHead(authorCache(), fresh);
    expect(merged.data.pages.flatMap(p => p.posts).filter(p => p.pinned).map(p => p.id)).toEqual(['pin']);
  });

  it('a page of pins alone proves nothing: merged, not replaced', () => {
    const merged = mergePostsHead(authorCache(), { posts: [pinnedPost('pin')], nextCursor: 'n' }, { pinnedFirst: true });
    expect(merged.kind).toBe('unchanged');
    expect(ids(merged.data)).toHaveLength(40);
  });

  it('refreshPostsHead passes the option through', async () => {
    seed(KEY_A, authorCache());
    const fresh: PostPage = { posts: [pinnedPost('pin'), ...range(100, 119).map(post)], nextCursor: 'n' };
    const result = await refreshPostsHead(client, KEY_A, async () => fresh, T0 + QUERY_STALE_TIME_MS, createLogger(), undefined, {
      pinnedFirst: true,
    });
    expect(result).toBe('replaced');
  });
});

describe('refreshPostsHead force (Story 5.1, «Обновить»)', () => {
  it('no staleness check: a fresh cache is refreshed too', async () => {
    seed(KEY_A);
    const fetch = jest.fn().mockResolvedValue(page(['n1', ...range(0, 19)], 'c19'));
    expect(await refreshPostsHead(client, KEY_A, fetch, T0 + 1, undefined, undefined, { force: true })).toBe(
      'prepended',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(KEY_A)?.dataUpdatedAt).toBe(T0 + 1);
  });

  it('joins a running refresh of the same key (one request, the same result); a plain call still skips', async () => {
    seed(KEY_A);
    const reply = deferred<PostPage>();
    const fetch = jest.fn().mockReturnValue(reply.promise);
    const now = T0 + QUERY_STALE_TIME_MS;
    const resume = refreshPostsHead(client, KEY_A, fetch, now);
    const forced = refreshPostsHead(client, KEY_A, fetch, now, undefined, undefined, { force: true });
    expect(await refreshPostsHead(client, KEY_A, fetch, now)).toBe('skipped');
    reply.resolve(page(['n1', ...range(0, 19)], 'c19'));
    expect(await resume).toBe('prepended');
    expect(await forced).toBe('prepended');
    expect(fetch).toHaveBeenCalledTimes(1);
    // Released: the next forced call sends again.
    fetch.mockResolvedValue(page(range(0, 20), 'c20'));
    expect(await refreshPostsHead(client, KEY_A, fetch, now, undefined, undefined, { force: true })).toBe(
      'unchanged',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('no cache: skipped; a running fetch: waits for it, then sends; an error state: sends anyway', async () => {
    const fetch = jest.fn().mockResolvedValue(page(['n1', ...range(0, 19)], 'c19'));
    const force = { force: true, skipWhileError: true };
    expect(await refreshPostsHead(client, KEY_A, fetch, T0, undefined, undefined, force)).toBe('skipped');
    seed(KEY_A);
    const query = client.getQueryCache().find({ queryKey: KEY_A })!;
    query.setState({ fetchStatus: 'fetching' });
    const run = refreshPostsHead(client, KEY_A, fetch, T0, undefined, undefined, force);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    query.setState({ fetchStatus: 'idle' });
    expect(await run).toBe('prepended');
    expect(fetch).toHaveBeenCalledTimes(1);
    query.setState({ status: 'error', error: new AppError('Network') });
    expect(await refreshPostsHead(client, KEY_A, fetch, T0, undefined, undefined, force)).toBe('unchanged');
    expect(fetch).toHaveBeenCalledTimes(2);
    // A reset while waiting: skipped, nothing sent.
    query.setState({ fetchStatus: 'fetching' });
    const waiting = refreshPostsHead(client, KEY_A, fetch, T0, undefined, undefined, force);
    client.clear();
    expect(await waiting).toBe('skipped');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a synchronous throw of the fetch is a failure and releases the key', async () => {
    seed(KEY_A);
    const fetch = jest.fn().mockImplementationOnce(() => {
      throw new AppError('Network');
    });
    const opts = { force: true };
    expect(await refreshPostsHead(client, KEY_A, fetch, T0, createLogger(), undefined, opts)).toBe('failed');
    fetch.mockResolvedValue(page(range(0, 20), 'c20'));
    expect(await refreshPostsHead(client, KEY_A, fetch, T0, undefined, undefined, opts)).toBe('unchanged');
  });
});

describe('trimPostsToFirstPage (Story 5.3)', () => {
  it('keeps the first page and its cursor, with the original age', async () => {
    seed(KEY_A);
    await trimPostsToFirstPage(client, KEY_A);
    const data = client.getQueryData<PostsData>(KEY_A);
    expect(ids(data)).toEqual(range(0, 20));
    expect(data?.pageParams).toEqual([null]);
    expect(data?.pages[0].nextCursor).toBe('c20');
    expect(client.getQueryState(KEY_A)?.dataUpdatedAt).toBe(T0);
  });

  it('no data, or a single page: nothing changes', async () => {
    await trimPostsToFirstPage(client, KEY_A);
    expect(client.getQueryData(KEY_A)).toBeUndefined();
    const one: PostsData = { pages: [page(range(0, 5), null)], pageParams: [null] };
    seed(KEY_B, one);
    await trimPostsToFirstPage(client, KEY_B);
    expect(client.getQueryData(KEY_B)).toBe(one);
  });

  it('cancels an in-flight next-page fetch first: when it resolves, the cache still has one page', async () => {
    const next = deferred<PostPage>();
    const observer = new InfiniteQueryObserver<PostPage, Error, PostsData, readonly unknown[], string | null>(client, {
      queryKey: KEY_A,
      queryFn: ({ pageParam }) =>
        pageParam === null ? Promise.resolve(page(range(0, 20), 'c20')) : next.promise,
      initialPageParam: null,
      getNextPageParam: last => last.nextCursor,
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    seed(KEY_A, twoPages());
    const fetching = observer.fetchNextPage().catch(() => undefined);
    expect(client.getQueryState(KEY_A)?.fetchStatus).toBe('fetching');
    await trimPostsToFirstPage(client, KEY_A);
    next.resolve(page(range(40, 60), 'c60'));
    await fetching;
    expect(client.getQueryData<PostsData>(KEY_A)?.pages).toHaveLength(1);
    unsubscribe();
  });

  it('only that key', async () => {
    seed(KEY_A);
    seed(KEY_B);
    await trimPostsToFirstPage(client, KEY_A);
    expect(client.getQueryData<PostsData>(KEY_B)?.pages).toHaveLength(2);
  });
});
