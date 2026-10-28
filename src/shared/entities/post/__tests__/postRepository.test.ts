import { AppError } from '../../../api/appError';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { cursorFor, e5Page, feedPost, syntheticFeed } from '../../../../test/feedFixtures';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { blogPost, e4Page, syntheticBlogPosts } from '../../../../test/authorFixtures';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e8Accessible, e8Locked, e8MissingReply } from '../../../../test/postFixtures';
import { PostRepository, blogPostsPath, feedPath, mergePosts, postPath } from '../postRepository';
import { mapPost } from '../mapPost';
import type { Post } from '../types';
import { ALL_TIME, DEFAULT_FILTER } from '../../../filters';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e5OnlyBought from '../../../../test/fixtures/boosty/e5-feed-only-bought.json';

function client(handler: FixtureHandler) {
  const transport = createFixtureTransport(handler);
  const http = createHttpClient({
    transport,
    tokens: fixedAccessToken('t'.repeat(64)),
    sleep: () => Promise.resolve(),
    logger: createLogger(),
  });
  return { http, transport };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const post = (n: number) => mapPost(feedPost(n), createLogger()) as Post;

describe('feedPath', () => {
  const BASE = '/v1/feed/post/?limit=10&comments_limit=0&reply_limit=0';

  it('E5 with comments off, the default access params and no offset on the first page', () => {
    expect(feedPath(null, DEFAULT_FILTER)).toBe(`${BASE}&only_allowed=true&only_bought=false`);
  });

  it('Story 5.3: each access value maps to the reference params («Все посты»: both false)', () => {
    expect(feedPath(null, { access: 'allowed', period: ALL_TIME })).toBe(`${BASE}&only_allowed=true&only_bought=false`);
    expect(feedPath(null, { access: 'all', period: ALL_TIME })).toBe(`${BASE}&only_allowed=false&only_bought=false`);
    expect(feedPath(null, { access: 'bought', period: ALL_TIME })).toBe(`${BASE}&only_allowed=false&only_bought=true`);
  });

  it('passes the opaque cursor back verbatim, URL-encoded, after the access params', () => {
    expect(feedPath('a b&c=d/é:1', { access: 'all', period: ALL_TIME })).toBe(
      `${BASE}&only_allowed=false&only_bought=false&offset=a%20b%26c%3Dd%2F%C3%A9%3A1`,
    );
  });

  describe('Story 5.4: the period resolved at request time', () => {
    const NOW = new Date(2026, 9, 28, 14, 30).getTime();
    const sec = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
      Math.floor(new Date(y, m - 1, d, h, min, s).getTime() / 1000);

    it('«За всё время» sends no period params', () => {
      expect(feedPath(null, DEFAULT_FILTER, NOW)).toBe(`${BASE}&only_allowed=true&only_bought=false`);
    });

    it('a preset: from_ts = local 00:00 of today − 6, to_ts = today 23:59:59 (epoch seconds), before the offset', () => {
      const path = feedPath('c1', { access: 'allowed', period: { kind: 'preset', days: 7 } }, NOW);
      expect(path).toBe(
        `${BASE}&only_allowed=true&only_bought=false&from_ts=${sec(2026, 10, 22)}&to_ts=${sec(2026, 10, 28, 23, 59, 59)}&offset=c1`,
      );
    });

    it('a custom range: 1 Aug 00:00:00 – 25 Sep 23:59:59 local', () => {
      const path = feedPath(
        null,
        { access: 'all', period: { kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' } },
        NOW,
      );
      expect(path).toContain(`&from_ts=${sec(2026, 8, 1)}&to_ts=${sec(2026, 9, 25, 23, 59, 59)}`);
    });

    it('feedPage reads the clock only when it sends (Date.now() by default)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
      try {
        const { http, transport } = client(() => ({ status: 200, body: e5Page() }));
        await PostRepository.feedPage(http, null, { access: 'allowed', period: { kind: 'preset', days: 30 } });
        expect(transport.calls[0].url).toContain(`from_ts=${sec(2026, 9, 29)}&to_ts=${sec(2026, 10, 28, 23, 59, 59)}`);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

describe('PostRepository.feedPage', () => {
  it('sends E5 with the content profile and maps the live page', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e5Page({ isLast: false, offset: 'redacted' }) }));
    const page = await PostRepository.feedPage(http, null, DEFAULT_FILTER);
    expect(page.posts).toHaveLength(10);
    expect(page.nextCursor).toBe('redacted');
    const [call] = transport.calls;
    expect(call.url).toBe(
      'https://api.boosty.to/v1/feed/post/?limit=10&comments_limit=0&reply_limit=0&only_allowed=true&only_bought=false',
    );
    expect(call.headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
    expect(call.headers['X-App']).toBeUndefined();
    expect(call.headers['X-From-Id']).toBeUndefined();
    // No comment request, ever.
    expect(transport.calls.every(c => !c.path.includes('comment'))).toBe(true);
  });

  it('Story 5.3: «Только купленные» sends its params; a one-post last page (the live shape) ends the paging', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e5OnlyBought.body }));
    const page = await PostRepository.feedPage(http, null, { access: 'bought', period: ALL_TIME });
    expect(transport.calls[0].url).toContain('&only_allowed=false&only_bought=true');
    expect(page.posts).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('the next request carries the cursor of the previous page', async () => {
    const { http, transport } = client(syntheticFeed({ total: 25 }));
    const first = await PostRepository.feedPage(http, null, DEFAULT_FILTER);
    expect(first.nextCursor).toBe(cursorFor(10));
    const second = await PostRepository.feedPage(http, first.nextCursor, DEFAULT_FILTER);
    expect(second.posts.map(p => p.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `feed-post-${10 + i}`),
    );
    expect(transport.calls[1].url).toContain('&offset=cursor%3A10');
    const third = await PostRepository.feedPage(http, second.nextCursor, DEFAULT_FILTER);
    expect(third.posts).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
  });

  it.each([
    ['isLast=true', { offset: 'x', isLast: true }],
    ['no extra', undefined],
    ['extra without offset', { isLast: false }],
    ['an empty offset', { offset: '', isLast: false }],
    ['a non-string offset', { offset: 7, isLast: false }],
  ])('stops paging on %s', async (_name, extra) => {
    const body: Record<string, unknown> = { data: { posts: [feedPost(0)] } };
    if (extra !== undefined) {
      body.extra = extra;
    }
    const { http } = client(() => ({ status: 200, body }));
    expect((await PostRepository.feedPage(http, null, DEFAULT_FILTER)).nextCursor).toBeNull();
  });

  it('drops a malformed post and keeps the page', async () => {
    const bad = feedPost(1);
    delete (bad.user as Record<string, unknown>).name;
    const { http } = client(() => ({
      status: 200,
      body: { data: { posts: [feedPost(0), bad, feedPost(2)] }, extra: { offset: 'c', isLast: false } },
    }));
    const page = await PostRepository.feedPage(http, null, DEFAULT_FILTER);
    expect(page.posts.map(p => p.id)).toEqual(['feed-post-0', 'feed-post-2']);
  });

  it('dedupes inside one page', async () => {
    const { http } = client(() => ({
      status: 200,
      body: { data: { posts: [feedPost(0), feedPost(0), feedPost(1)] }, extra: { isLast: true } },
    }));
    expect((await PostRepository.feedPage(http, null, DEFAULT_FILTER)).posts.map(p => p.id)).toEqual([
      'feed-post-0',
      'feed-post-1',
    ]);
  });

  it('an empty feed is an empty last page', async () => {
    const { http } = client(() => ({ status: 200, body: { data: { posts: [] }, extra: { isLast: true } } }));
    expect(await PostRepository.feedPage(http, null, DEFAULT_FILTER)).toEqual({ posts: [], nextCursor: null });
  });

  it.each([
    ['no data.posts', { status: 200, body: { data: {} } }, 'Parse'],
    ['a non-JSON 200', { status: 200, body: undefined }, 'Parse'],
    ['404', { status: 404, body: { error: 'not_found' } }, 'NotFound'],
    ['403 (never a session problem)', { status: 403, body: {} }, 'Client'],
    ['503', { status: 503, body: {} }, 'Server'],
  ])('a page with %s rejects with AppError', async (_name, reply, kind) => {
    const { http } = client(() => reply);
    await expect(PostRepository.feedPage(http, null, DEFAULT_FILTER)).rejects.toEqual(new AppError(kind as never));
  });

  it('a network failure rejects with Network after the HttpClient retries', async () => {
    const { http, transport } = client(() => ({ network: true }));
    await expect(PostRepository.feedPage(http, null, DEFAULT_FILTER)).rejects.toMatchObject({ kind: 'Network' });
    expect(transport.calls).toHaveLength(3);
  });
});

describe('mergePosts', () => {
  it('appends pages and dedupes by post.id, keeping the first occurrence', () => {
    const a = [post(0), post(1), post(2)];
    const dup = { ...post(2), title: 'later copy' };
    const b = [dup, post(3)];
    const merged = mergePosts(a, b);
    expect(merged.map(p => p.id)).toEqual(['feed-post-0', 'feed-post-1', 'feed-post-2', 'feed-post-3']);
    expect(merged[2].title).toBe('Post 2');
  });

  it('empty input', () => {
    expect(mergePosts()).toEqual([]);
    expect(mergePosts([], [])).toEqual([]);
  });
});

describe('blogPostsPath (E4)', () => {
  it('limit 20, comments off, no offset on the first page; no filter parameter', () => {
    expect(blogPostsPath('synthetic-blog-1', null)).toBe(
      '/v1/blog/synthetic-blog-1/post/?limit=20&comments_limit=0&reply_limit=0',
    );
  });

  it('encodes the blogUrl as a path segment and the cursor verbatim', () => {
    expect(blogPostsPath('a:b', 'x y&z')).toBe(
      '/v1/blog/a%3Ab/post/?limit=20&comments_limit=0&reply_limit=0&offset=x%20y%26z',
    );
  });
});

describe('PostRepository.blogPage (E4)', () => {
  it('sends E4 with the content profile and maps the live page', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e4Page(1) }));
    const page = await PostRepository.blogPage(http, 'synthetic-blog-1', null);
    expect(page.posts).toHaveLength(20);
    expect(page.nextCursor).toBe('redacted');
    const [call] = transport.calls;
    expect(call.url).toBe(
      'https://api.boosty.to/v1/blog/synthetic-blog-1/post/?limit=20&comments_limit=0&reply_limit=0',
    );
    expect(call.headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
    expect(call.headers['X-App']).toBeUndefined();
    expect(call.headers['X-From-Id']).toBeUndefined();
  });

  it('maps the locked live posts as locked (hasAccess false), never an error', async () => {
    const { http } = client(() => ({ status: 200, body: e4Page(2, { isLast: true }) }));
    const page = await PostRepository.blogPage(http, 'synthetic-blog-2', 'redacted');
    expect(page.nextCursor).toBeNull();
    expect(page.posts.some(p => !p.hasAccess)).toBe(true);
    expect(page.posts.some(p => p.hasAccess)).toBe(true);
  });

  it('pages by the cursor of the previous page', async () => {
    const { http, transport } = client(syntheticBlogPosts({ blogUrl: 'b', total: 45 }));
    const first = await PostRepository.blogPage(http, 'b', null);
    expect(first.posts).toHaveLength(20);
    expect(first.nextCursor).toBe(cursorFor(20));
    const second = await PostRepository.blogPage(http, 'b', first.nextCursor);
    expect(transport.calls[1].url).toContain('&offset=cursor%3A20');
    const third = await PostRepository.blogPage(http, 'b', second.nextCursor);
    expect(third.posts).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
  });

  it.each([
    ['isLast=true', { offset: 'x', isLast: true }],
    ['no extra', undefined],
    ['extra without offset', { isLast: false }],
  ])('stops on %s', async (_name, extra) => {
    const { http } = client(() => ({ status: 200, body: { data: [blogPost('b', 0)], extra } }));
    expect((await PostRepository.blogPage(http, 'b', null)).nextCursor).toBeNull();
  });

  it('drops a malformed post (logged by id only) and keeps the page', async () => {
    const logger = createLogger();
    const { http } = client(() => ({
      status: 200,
      body: { data: [blogPost('b', 0), { id: 'broken' }, blogPost('b', 1)], extra: { isLast: true } },
    }));
    const page = await PostRepository.blogPage(http, 'b', null, logger);
    expect(page.posts.map(p => p.id)).toEqual(['blog-post-0', 'blog-post-1']);
    expect(logger.entries().filter(e => e.scope === 'post')).toHaveLength(1);
  });

  it('empty data: an empty last page', async () => {
    const { http } = client(() => ({ status: 200, body: { data: [], extra: { isLast: true } } }));
    expect(await PostRepository.blogPage(http, 'b', null)).toEqual({ posts: [], nextCursor: null });
  });

  it('a body without `data` is a Parse error', async () => {
    const { http } = client(() => ({ status: 200, body: { extra: { isLast: true } } }));
    await expect(PostRepository.blogPage(http, 'b', null)).rejects.toEqual(new AppError('Parse'));
  });
});

describe('PostRepository.post (E8, Story 3.4)', () => {
  it('sends E8 with comments off and the content profile; maps the live post with its like count', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e8Accessible() }));
    const result = await PostRepository.post(http, 'synthetic-blog-1', 'synthetic-id-4');
    expect(result.kind).toBe('ok');
    const one = result.kind === 'ok' ? result.post : null;
    expect(one?.id).toBe('synthetic-id-4');
    expect(one?.likeCount).toBe(5);
    expect(one?.hasAccess).toBe(true);
    const [call] = transport.calls;
    expect(call.url).toBe(
      'https://api.boosty.to/v1/blog/synthetic-blog-1/post/synthetic-id-4?comments_limit=0&reply_limit=0',
    );
    expect(call.headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
    expect(call.headers['X-App']).toBeUndefined();
    expect(transport.calls).toHaveLength(1);
    // No signed or progress value in the domain.
    const json = JSON.stringify(one);
    for (const field of ['timeCode', 'playerUrls', 'signedQuery', 'sig=', 'comments', 'reactions']) {
      expect(json).not.toContain(field);
    }
  });

  it('a locked post is an ok result (never a session problem)', async () => {
    const { http } = client(() => ({ status: 200, body: e8Locked() }));
    const result = await PostRepository.post(http, 'synthetic-blog-2', 'synthetic-id-106');
    expect(result.kind === 'ok' && result.post.hasAccess).toBe(false);
  });

  it('404 not_found → unavailable (no retry)', async () => {
    const { http, transport } = client(() => e8MissingReply());
    expect(await PostRepository.post(http, 'b', 'p')).toEqual({ kind: 'unavailable' });
    expect(transport.calls).toHaveLength(1);
  });

  it('a body the mapper rejects is Parse; other failures keep their kind', async () => {
    const { http } = client(() => ({ status: 200, body: { id: 'p' } }));
    await expect(PostRepository.post(http, 'b', 'p')).rejects.toEqual(new AppError('Parse'));
    const failing = client(() => ({ status: 400, body: { error: 'bad_request' } }));
    await expect(PostRepository.post(failing.http, 'b', 'p')).rejects.toEqual(new AppError('Client'));
  });

  it('postPath encodes the segments and refuses unsafe ones before any request', () => {
    expect(postPath('b', 'a b')).toBe('/v1/blog/b/post/a%20b?comments_limit=0&reply_limit=0');
    for (const [blogUrl, postId] of [['a/b', 'p'], ['..', 'p'], ['b', '..'], ['b', '.'], ['b', '']]) {
      expect(() => postPath(blogUrl, postId)).toThrow(new AppError('Client'));
    }
  });
});
