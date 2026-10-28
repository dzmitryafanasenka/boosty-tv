import { QueryClient } from '@tanstack/react-query';
import { AppError, queryKeys, type HttpClient } from '../../../shared/api';
import { PostRepository, type Post, type PostPage } from '../../../shared/entities/post';
import { createLogger } from '../../../shared/services/logger';
import { manualRefreshFeed, mergeFeedHead, refreshFeedHead, type FeedData } from '../feedRefresh';
import { DEFAULT_FILTER } from '../../../shared/filters';

const F = DEFAULT_FILTER;

const STALE = 60_000;
const KEY = queryKeys.subscriptionFeed(DEFAULT_FILTER);
const http = {} as HttpClient;

const post = (id: string) => ({ id }) as Post;
const page = (ids: string[], nextCursor: string | null): PostPage => ({
  posts: ids.map(post),
  nextCursor,
});
const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => `p${from + i}`);

/** Two loaded pages: p0–p9 (cursor c10), p10–p19 (cursor c20). */
const twoPages = (): FeedData => ({
  pages: [page(range(0, 10), 'c10'), page(range(10, 20), 'c20')],
  pageParams: [null, 'c10'],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let client: QueryClient;
let feedPage: jest.SpyInstance;
const T0 = 1_000_000;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: STALE, retry: false } } });
  feedPage = jest.spyOn(PostRepository, 'feedPage');
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

const seed = (data: FeedData = twoPages(), updatedAt = T0) =>
  client.setQueryData<FeedData>(KEY, data, { updatedAt });
const cached = () => client.getQueryData<FeedData>(KEY);
const ids = (data: FeedData | undefined) => data?.pages.flatMap(p => p.posts.map(x => x.id));

describe('mergeFeedHead', () => {
  it('2 new + 8 known: collapsed into page 1; page count, params and cursors unchanged', () => {
    const cache = twoPages();
    const fresh = page(['n1', 'n2', ...range(0, 8)], 'c8');
    const { kind, data } = mergeFeedHead(cache, fresh);
    expect(kind).toBe('prepended');
    expect(data.pages).toHaveLength(2);
    expect(data.pages[0].posts.map(p => p.id)).toEqual(['n1', 'n2', ...range(0, 10)]);
    expect(data.pages[0].nextCursor).toBe('c10');
    expect(data.pages[1]).toBe(cache.pages[1]);
    expect(data.pageParams).toBe(cache.pageParams);
  });

  it('nothing new: the fresh copies of the shared posts are written (locked → unlocked)', () => {
    const cache = twoPages();
    cache.pages[0].posts[0] = { id: 'p0', hasAccess: false } as unknown as Post;
    const unlocked = { id: 'p0', hasAccess: true } as unknown as Post;
    const fresh: PostPage = { posts: [unlocked, ...range(1, 10).map(post)], nextCursor: 'c10' };
    const { kind, data } = mergeFeedHead(cache, fresh);
    expect(kind).toBe('unchanged');
    expect(data.pages[0].posts[0]).toBe(unlocked);
    expect(ids(data)).toEqual(ids(cache));
    expect(data.pages).toHaveLength(2);
    expect(data.pageParams).toBe(cache.pageParams);
  });

  it('a gap (no shared id): page 1 alone replaces the cache', () => {
    const fresh = page(range(100, 110), 'c110');
    const { kind, data } = mergeFeedHead(twoPages(), fresh);
    expect(kind).toBe('replaced');
    expect(data).toEqual({ pages: [fresh], pageParams: [null] });
  });

  it('an empty page 1 with a next cursor keeps the cache; an empty last page replaces it (Epic 3 retro A3)', () => {
    const cache = twoPages();
    expect(mergeFeedHead(cache, page([], 'c0'))).toEqual({ kind: 'unchanged', data: cache });
    expect(mergeFeedHead(cache, page([], 'c0')).data).toBe(cache);
    expect(mergeFeedHead(cache, page([], null))).toEqual({
      kind: 'replaced',
      data: { pages: [page([], null)], pageParams: [null] },
    });
  });
});

describe('refreshFeedHead', () => {
  it('no feed cached: nothing sent', async () => {
    expect(await refreshFeedHead(client, http, F, T0 + STALE)).toBe('skipped');
    expect(feedPage).not.toHaveBeenCalled();
  });

  it('younger than staleTime: nothing sent', async () => {
    seed();
    expect(await refreshFeedHead(client, http, F, T0 + STALE - 1)).toBe('skipped');
    expect(feedPage).not.toHaveBeenCalled();
  });

  it('stale: one page-1 request (no cursor); merged on top; updatedAt = now', async () => {
    seed();
    feedPage.mockResolvedValue(page(['n1', 'n2', ...range(0, 8)], 'c8'));
    expect(await refreshFeedHead(client, http, F, T0 + STALE)).toBe('prepended');
    expect(feedPage).toHaveBeenCalledTimes(1);
    expect(feedPage).toHaveBeenCalledWith(http, null, DEFAULT_FILTER);
    expect(ids(cached())?.slice(0, 3)).toEqual(['n1', 'n2', 'p0']);
    expect(cached()?.pages).toHaveLength(2);
    expect(cached()?.pageParams).toEqual([null, 'c10']);
    const state = client.getQueryCache().find({ queryKey: KEY })!.state;
    expect(state.dataUpdatedAt).toBe(T0 + STALE);
    // Fresh now: an immediate second resume sends nothing.
    expect(await refreshFeedHead(client, http, F, state.dataUpdatedAt + 1)).toBe('skipped');
    expect(feedPage).toHaveBeenCalledTimes(1);
  });

  it('a gap: the cache becomes page 1 alone', async () => {
    seed();
    feedPage.mockResolvedValue(page(range(100, 110), 'c110'));
    expect(await refreshFeedHead(client, http, F, T0 + STALE)).toBe('replaced');
    expect(ids(cached())).toEqual(range(100, 110));
    expect(cached()?.pageParams).toEqual([null]);
  });

  it('nothing new: same posts, pages and params; the fresh copies written', async () => {
    const data = twoPages();
    seed(data);
    const fresh = page(range(0, 10), 'c10');
    const edited = { id: 'p0', title: 'Edited' } as unknown as Post;
    fresh.posts[0] = edited;
    feedPage.mockResolvedValue(fresh);
    expect(await refreshFeedHead(client, http, F, T0 + STALE)).toBe('unchanged');
    expect(ids(cached())).toEqual(ids(data));
    expect(cached()?.pages).toHaveLength(2);
    expect(cached()?.pageParams).toEqual([null, 'c10']);
    expect(cached()?.pages[0].posts[0]).toEqual(edited);
  });

  it('a failure is silent: the cache stays; only the error kind is logged', async () => {
    const data = twoPages();
    seed(data);
    const logger = createLogger({ console: false });
    feedPage.mockRejectedValue(new AppError('Network'));
    expect(await refreshFeedHead(client, http, F, T0 + STALE, logger)).toBe('failed');
    expect(cached()).toBe(data);
    expect(logger.entries()).toEqual([
      expect.objectContaining({
        level: 'warn',
        scope: 'feed',
        message: 'resume refresh failed',
        fields: { kind: 'Network' },
      }),
    ]);
  });

  it('one at a time: a second call while one runs sends nothing', async () => {
    seed();
    const reply = deferred<PostPage>();
    feedPage.mockReturnValue(reply.promise);
    const first = refreshFeedHead(client, http, F, T0 + STALE);
    expect(await refreshFeedHead(client, http, F, T0 + STALE)).toBe('skipped');
    reply.resolve(page(['n1', ...range(0, 9)], 'c9'));
    expect(await first).toBe('prepended');
    expect(feedPage).toHaveBeenCalledTimes(1);
  });

  it('the feed query is fetching (a page append): nothing sent', async () => {
    seed();
    client.getQueryCache().find({ queryKey: KEY })!.setState({ fetchStatus: 'fetching' });
    expect(await refreshFeedHead(client, http, F, T0 + STALE)).toBe('skipped');
    expect(feedPage).not.toHaveBeenCalled();
  });

  it('a feed fetch started while page 1 was in flight: the reply is dropped', async () => {
    const data = twoPages();
    seed(data);
    const reply = deferred<PostPage>();
    feedPage.mockReturnValue(reply.promise);
    const run = refreshFeedHead(client, http, F, T0 + STALE);
    const query = client.getQueryCache().find({ queryKey: KEY })!;
    query.setState({ fetchStatus: 'fetching' });
    reply.resolve(page(['n1', ...range(0, 9)], 'c9'));
    expect(await run).toBe('skipped');
    expect(cached()).toBe(data);
    expect(query.state.dataUpdatedAt).toBe(T0);
  });

  // Epic 3 retro A3: Главная uses the Author page's options.
  it('an empty page 1 with a next cursor: the cached feed stays, written back as fresh', async () => {
    const data = twoPages();
    seed(data);
    feedPage.mockResolvedValue(page([], 'c0'));
    expect(await refreshFeedHead(client, http, F, T0 + STALE)).toBe('unchanged');
    expect(ids(cached())).toEqual(ids(data));
    expect(client.getQueryState(KEY)?.dataUpdatedAt).toBe(T0 + STALE);
    // Fresh now: the next resume within a staleTime sends nothing.
    expect(await refreshFeedHead(client, http, F, T0 + STALE + 1)).toBe('skipped');
    expect(feedPage).toHaveBeenCalledTimes(1);
  });

  it('an empty last page 1 (no next cursor): the cache is replaced (a truly empty feed)', async () => {
    seed();
    feedPage.mockResolvedValue(page([], null));
    expect(await refreshFeedHead(client, http, F, T0 + STALE)).toBe('replaced');
    expect(cached()).toEqual({ pages: [page([], null)], pageParams: [null] });
  });

  it('the feed query is in an error state (a failed page append): nothing sent; a reply after it entered one is dropped', async () => {
    const data = twoPages();
    seed(data);
    const query = client.getQueryCache().find({ queryKey: KEY })!;
    query.setState({ status: 'error', error: new AppError('Network') });
    expect(await refreshFeedHead(client, http, F, T0 + STALE)).toBe('skipped');
    expect(feedPage).not.toHaveBeenCalled();

    query.setState({ status: 'success', error: null });
    const reply = deferred<PostPage>();
    feedPage.mockReturnValue(reply.promise);
    const run = refreshFeedHead(client, http, F, T0 + STALE);
    query.setState({ status: 'error', error: new AppError('Network') });
    reply.resolve(page(['n1', ...range(0, 9)], 'c9'));
    expect(await run).toBe('skipped');
    expect(cached()).toBe(data);
  });

  it('the cache was reset meanwhile (sign-out, re-login, account switch): the reply is dropped', async () => {
    seed();
    const reply = deferred<PostPage>();
    feedPage.mockReturnValue(reply.promise);
    const run = refreshFeedHead(client, http, F, T0 + STALE);
    client.clear();
    // A new account's feed arrives first.
    seed({ pages: [page(['other'], null)], pageParams: [null] }, T0 + STALE);
    reply.resolve(page(['n1', ...range(0, 9)], 'c9'));
    expect(await run).toBe('skipped');
    expect(ids(cached())).toEqual(['other']);
  });
});

describe('manualRefreshFeed (Story 5.1, «Обновить»)', () => {
  const SUBS = queryKeys.subscriptions();
  /** A cached subscriptions query with a query function and no observer. */
  async function seedSubscriptions(fn: jest.Mock) {
    await client.prefetchQuery({ queryKey: SUBS, queryFn: fn });
    fn.mockClear();
  }

  it('a fresh cache: one E5 page 1 merged (no staleness check) and one E2 refetch', async () => {
    seed(twoPages(), T0);
    const subs = jest.fn().mockResolvedValue(['blog']);
    await seedSubscriptions(subs);
    feedPage.mockResolvedValue(page(['n1', ...range(0, 9)], 'c9'));
    expect(await manualRefreshFeed(client, http, F, T0 + 1)).toBe('prepended');
    expect(feedPage).toHaveBeenCalledTimes(1);
    expect(feedPage).toHaveBeenCalledWith(http, null, DEFAULT_FILTER);
    expect(subs).toHaveBeenCalledTimes(1);
    expect(ids(cached())?.slice(0, 2)).toEqual(['n1', 'p0']);
    expect(cached()?.pages).toHaveLength(2);
  });

  it('single-flight: a second call while one runs shares it (one E5, one E2)', async () => {
    seed();
    const subs = jest.fn().mockResolvedValue([]);
    await seedSubscriptions(subs);
    const reply = deferred<PostPage>();
    feedPage.mockReturnValue(reply.promise);
    const first = manualRefreshFeed(client, http, F, T0);
    const second = manualRefreshFeed(client, http, F, T0);
    expect(second).toBe(first);
    reply.resolve(page(range(0, 10), 'c10'));
    expect(await first).toBe('unchanged');
    expect(feedPage).toHaveBeenCalledTimes(1);
    expect(subs).toHaveBeenCalledTimes(1);
  });

  it('a resume refresh already running is joined, not duplicated', async () => {
    seed();
    const reply = deferred<PostPage>();
    feedPage.mockReturnValue(reply.promise);
    const resume = refreshFeedHead(client, http, F, T0 + STALE);
    const manual = manualRefreshFeed(client, http, F, T0 + STALE);
    reply.resolve(page(['n1', ...range(0, 9)], 'c9'));
    expect(await resume).toBe('prepended');
    expect(await manual).toBe('prepended');
    expect(feedPage).toHaveBeenCalledTimes(1);
  });

  it('E5 fails: failed, the cache stays, logged by kind only; E2 failing is not this result', async () => {
    const data = twoPages();
    seed(data);
    const subs = jest.fn().mockResolvedValue([]);
    await seedSubscriptions(subs);
    subs.mockRejectedValue(new AppError('Server'));
    const logger = createLogger();
    feedPage.mockRejectedValue(new AppError('Network'));
    expect(await manualRefreshFeed(client, http, F, T0, logger)).toBe('failed');
    expect(cached()).toBe(data);
    expect(logger.entries()).toEqual([
      expect.objectContaining({ scope: 'feed', message: 'manual refresh failed', fields: { kind: 'Network' } }),
    ]);
    feedPage.mockResolvedValue(page(range(0, 10), 'c10'));
    expect(await manualRefreshFeed(client, http, F, T0, logger)).toBe('unchanged');
  });

  it('a next-page fetch is running: waits for it, then one E5', async () => {
    seed();
    const query = client.getQueryCache().find({ queryKey: KEY })!;
    query.setState({ fetchStatus: 'fetching' });
    feedPage.mockResolvedValue(page(['n1', ...range(0, 9)], 'c9'));
    const run = manualRefreshFeed(client, http, F, T0);
    await Promise.resolve();
    expect(feedPage).not.toHaveBeenCalled();
    query.setState({ fetchStatus: 'idle' });
    expect(await run).toBe('prepended');
    expect(feedPage).toHaveBeenCalledTimes(1);
    expect(ids(cached())?.[0]).toBe('n1');
  });

  it('the feed query is in an error state (a failed page append): one E5, merged', async () => {
    seed();
    const query = client.getQueryCache().find({ queryKey: KEY })!;
    query.setState({ status: 'error', error: new AppError('Network') });
    feedPage.mockResolvedValue(page(['n1', ...range(0, 9)], 'c9'));
    expect(await manualRefreshFeed(client, http, F, T0)).toBe('prepended');
    expect(feedPage).toHaveBeenCalledTimes(1);
    expect(ids(cached())?.[0]).toBe('n1');
  });

  it('an empty page 1 with a next cursor: the cached feed stays', async () => {
    const data = twoPages();
    seed(data);
    feedPage.mockResolvedValue(page([], 'c0'));
    expect(await manualRefreshFeed(client, http, F, T0)).toBe('unchanged');
    expect(cached()).toBe(data);
  });

  it('E2 is not awaited and only the exact subscriptions key refetches', async () => {
    seed();
    const subs = jest.fn().mockResolvedValue([]);
    await seedSubscriptions(subs);
    const other = jest.fn().mockResolvedValue([]);
    await client.prefetchQuery({ queryKey: [...SUBS, 'other'], queryFn: other });
    other.mockClear();
    const e2 = deferred<string[]>();
    subs.mockReturnValue(e2.promise);
    feedPage.mockResolvedValue(page(range(0, 10), 'c10'));
    // Resolves while E2 is still pending.
    expect(await manualRefreshFeed(client, http, F, T0)).toBe('unchanged');
    expect(subs).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    e2.resolve([]);
  });

  it('no subscriptions cached: no E2 request', async () => {
    seed();
    feedPage.mockResolvedValue(page(range(0, 10), 'c10'));
    expect(await manualRefreshFeed(client, http, F, T0)).toBe('unchanged');
    expect(client.getQueryState(SUBS)).toBeUndefined();
  });
});
