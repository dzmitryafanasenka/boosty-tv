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
import {
  PostRepository,
  blogPostsPath,
  blogSearchPath,
  feedPath,
  feedSearchPath,
  mergePosts,
  postPath,
} from '../postRepository';
import { mapPost } from '../mapPost';
import type { Post } from '../types';
import { ALL_TIME, DEFAULT_FILTER } from '../../../filters';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e5OnlyBought from '../../../../test/fixtures/boosty/e5-feed-only-bought.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e6Search1 from '../../../../test/fixtures/boosty/e6-feed-search-1.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e6Search2 from '../../../../test/fixtures/boosty/e6-feed-search-2.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e7Search1 from '../../../../test/fixtures/boosty/e7-blog-search-1.json';

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
    expect(feedPath(null, { access: 'allowed', period: ALL_TIME, tags: [] })).toBe(`${BASE}&only_allowed=true&only_bought=false`);
    expect(feedPath(null, { access: 'all', period: ALL_TIME, tags: [] })).toBe(`${BASE}&only_allowed=false&only_bought=false`);
    expect(feedPath(null, { access: 'bought', period: ALL_TIME, tags: [] })).toBe(`${BASE}&only_allowed=false&only_bought=true`);
  });

  it('passes the opaque cursor back verbatim, URL-encoded, after the access params', () => {
    expect(feedPath('a b&c=d/é:1', { access: 'all', period: ALL_TIME, tags: [] })).toBe(
      `${BASE}&only_allowed=false&only_bought=false&offset=a%20b%26c%3Dd%2F%C3%A9%3A1`,
    );
  });

  describe('Story 5.5: tags_ids', () => {
    const A = { id: '12', title: 'Выпечка' };
    const B = { id: '3', title: 'Супы' };
    it('no tags: no tags_ids', () => {
      expect(feedPath(null, DEFAULT_FILTER)).not.toContain('tags_ids');
    });

    it('the sorted ids, comma-joined, after the access params and before the offset; titles never sent', () => {
      const path = feedPath('c1', { access: 'all', period: ALL_TIME, tags: [A, B] });
      expect(path).toBe(`${BASE}&only_allowed=false&only_bought=false&tags_ids=12,3&offset=c1`);
      expect(feedPath('c1', { access: 'all', period: ALL_TIME, tags: [B, A] })).toBe(path);
      expect(path).not.toContain('%D0');
    });

    it('after the period params; each id URL-encoded', () => {
      const path = feedPath(
        null,
        { access: 'allowed', period: { kind: 'preset', days: 7 }, tags: [{ id: 'a&b', title: 'x' }] },
        new Date(2026, 9, 28).getTime(),
      );
      expect(path).toMatch(/&to_ts=\d+&tags_ids=a%26b$/);
    });
  });

  describe('Story 5.4: the period resolved at request time', () => {
    const NOW = new Date(2026, 9, 28, 14, 30).getTime();
    const sec = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
      Math.floor(new Date(y, m - 1, d, h, min, s).getTime() / 1000);

    it('«За всё время» sends no period params', () => {
      expect(feedPath(null, DEFAULT_FILTER, NOW)).toBe(`${BASE}&only_allowed=true&only_bought=false`);
    });

    it('a preset: from_ts = local 00:00 of today − 6, to_ts = today 23:59:59 (epoch seconds), before the offset', () => {
      const path = feedPath('c1', { access: 'allowed', period: { kind: 'preset', days: 7 }, tags: [] }, NOW);
      expect(path).toBe(
        `${BASE}&only_allowed=true&only_bought=false&from_ts=${sec(2026, 10, 22)}&to_ts=${sec(2026, 10, 28, 23, 59, 59)}&offset=c1`,
      );
    });

    it('a custom range: 1 Aug 00:00:00 – 25 Sep 23:59:59 local', () => {
      const path = feedPath(
        null,
        { access: 'all', period: { kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' }, tags: [] },
        NOW,
      );
      expect(path).toContain(`&from_ts=${sec(2026, 8, 1)}&to_ts=${sec(2026, 9, 25, 23, 59, 59)}`);
    });

    it('feedPage reads the clock only when it sends (Date.now() by default)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
      try {
        const { http, transport } = client(() => ({ status: 200, body: e5Page() }));
        await PostRepository.feedPage(http, null, { access: 'allowed', period: { kind: 'preset', days: 30 }, tags: [] });
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
    const page = await PostRepository.feedPage(http, null, { access: 'bought', period: ALL_TIME, tags: [] });
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
  const E4_BASE = '/v1/blog/synthetic-blog-1/post/?limit=20&comments_limit=0&reply_limit=0';

  it('limit 20, comments off, the default access params, no offset on the first page', () => {
    expect(blogPostsPath('synthetic-blog-1', null, DEFAULT_FILTER)).toBe(
      `${E4_BASE}&is_only_allowed=true&only_bought=false`,
    );
  });

  it('encodes the blogUrl as a path segment and the cursor verbatim', () => {
    expect(blogPostsPath('a:b', 'x y&z', DEFAULT_FILTER)).toBe(
      '/v1/blog/a%3Ab/post/?limit=20&comments_limit=0&reply_limit=0&is_only_allowed=true&only_bought=false&offset=x%20y%26z',
    );
  });

  it('Story 5.7: «Все посты» → is_only_allowed=false; only_bought is always false (live: ignored by E4)', () => {
    expect(blogPostsPath('synthetic-blog-1', null, { ...DEFAULT_FILTER, access: 'all' })).toBe(
      `${E4_BASE}&is_only_allowed=false&only_bought=false`,
    );
    expect(blogPostsPath('synthetic-blog-1', null, { ...DEFAULT_FILTER, access: 'bought' })).toBe(
      `${E4_BASE}&is_only_allowed=false&only_bought=false`,
    );
  });

  it('Story 5.7: the period (resolved with `now`) and the sorted, encoded tags, before the cursor', () => {
    const now = new Date(2026, 9, 29, 12, 0, 0).getTime();
    const from = Math.floor(new Date(2026, 9, 23, 0, 0, 0).getTime() / 1000);
    const to = Math.floor(new Date(2026, 9, 29, 23, 59, 59).getTime() / 1000);
    const filter = {
      access: 'all' as const,
      period: { kind: 'preset' as const, days: 7 as const },
      tags: [
        { id: '12', title: 'b' },
        { id: '3', title: 'a' },
      ],
    };
    expect(blogPostsPath('synthetic-blog-1', 'c', filter, now)).toBe(
      `${E4_BASE}&is_only_allowed=false&only_bought=false&from_ts=${from}&to_ts=${to}&tags_ids=12,3&offset=c`,
    );
    expect(blogPostsPath('synthetic-blog-1', null, { ...DEFAULT_FILTER, period: ALL_TIME }, now)).not.toContain(
      'from_ts',
    );
  });
});

describe('blogSearchPath (E7, Story 5.7)', () => {
  it('blog_url, limit 20, comments off, the access params, then search_query; the cursor last', () => {
    expect(blogSearchPath('synthetic-blog-1', 'пирог', null, DEFAULT_FILTER)).toBe(
      `/v1/search/blog/post/?blog_url=synthetic-blog-1&limit=20&comments_limit=0&reply_limit=0&is_only_allowed=true&only_bought=false&search_query=${encodeURIComponent('пирог')}`,
    );
    expect(blogSearchPath('synthetic-blog-1', 'q', 'x y', { ...DEFAULT_FILTER, access: 'all' })).toBe(
      '/v1/search/blog/post/?blog_url=synthetic-blog-1&limit=20&comments_limit=0&reply_limit=0&is_only_allowed=false&only_bought=false&search_query=q&offset=x%20y',
    );
  });

  it('encodes the blog and the query (spaces, &, #, =, +, %, /)', () => {
    const path = blogSearchPath('a:b', 'a b&c#d=e+f%g/h', null, DEFAULT_FILTER);
    expect(path).toContain('blog_url=a%3Ab&');
    expect(path).toContain('&search_query=a%20b%26c%23d%3De%2Bf%25g%2Fh');
    expect(path.split('&search_query=')).toHaveLength(2);
  });

  it('the period and tags as E4, before search_query', () => {
    const now = new Date(2026, 9, 29, 12, 0, 0).getTime();
    const path = blogSearchPath(
      'synthetic-blog-1',
      'q',
      null,
      { ...DEFAULT_FILTER, period: { kind: 'preset', days: 30 }, tags: [{ id: '7', title: 't' }] },
      now,
    );
    expect(path).toMatch(/&only_bought=false&from_ts=\d+&to_ts=\d+&tags_ids=7&search_query=q$/);
  });
});

describe('PostRepository.blogSearchPage (E7, Story 5.7)', () => {
  it('maps the fixture page through the one post mapper, locked results kept (hasAccess false)', async () => {
    const { http, transport } = client(() => ({ status: e7Search1.status, body: e7Search1.body }));
    const page = await PostRepository.blogSearchPage(http, 'synthetic-blog-2', 'q', null, DEFAULT_FILTER);
    expect(page.posts.map(p => p.id)).toEqual(['synthetic-id-104', 'synthetic-id-106', 'synthetic-id-108']);
    expect(page.posts.map(p => p.hasAccess)).toEqual([true, false, true]);
    expect(page.nextCursor).toBe('redacted');
    expect(transport.calls[0].url).toContain('/v1/search/blog/post/?blog_url=synthetic-blog-2&');
  });

  it('drops an item without a post (counted, no value logged); a missing searchPosts is Parse', async () => {
    const logger = createLogger();
    const { http } = client(() => ({
      status: 200,
      body: { data: { searchPosts: [{ rank: 1 }, { post: blogPost('b', 0) }] }, extra: { isLast: true } },
    }));
    const page = await PostRepository.blogSearchPage(http, 'b', 'q', null, DEFAULT_FILTER, Date.now(), logger);
    expect(page.posts.map(p => p.id)).toEqual(['blog-post-0']);
    expect(logger.entries().filter(e => e.scope === 'search')).toEqual([
      expect.objectContaining({ message: 'dropped', fields: { count: '1' } }),
    ]);
    const bad = client(() => ({ status: 200, body: { data: {}, extra: { isLast: true } } }));
    await expect(PostRepository.blogSearchPage(bad.http, 'b', 'q', null, DEFAULT_FILTER)).rejects.toEqual(
      new AppError('Parse'),
    );
  });
});

describe('PostRepository.blogPage (E4)', () => {
  it('sends E4 with the content profile and maps the live page', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e4Page(1) }));
    const page = await PostRepository.blogPage(http, 'synthetic-blog-1', null, DEFAULT_FILTER);
    expect(page.posts).toHaveLength(20);
    expect(page.nextCursor).toBe('redacted');
    const [call] = transport.calls;
    expect(call.url).toBe(
      'https://api.boosty.to/v1/blog/synthetic-blog-1/post/?limit=20&comments_limit=0&reply_limit=0&is_only_allowed=true&only_bought=false',
    );
    expect(call.headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
    expect(call.headers['X-App']).toBeUndefined();
    expect(call.headers['X-From-Id']).toBeUndefined();
  });

  it('maps the locked live posts as locked (hasAccess false), never an error', async () => {
    const { http } = client(() => ({ status: 200, body: e4Page(2, { isLast: true }) }));
    const page = await PostRepository.blogPage(http, 'synthetic-blog-2', 'redacted', DEFAULT_FILTER);
    expect(page.nextCursor).toBeNull();
    expect(page.posts.some(p => !p.hasAccess)).toBe(true);
    expect(page.posts.some(p => p.hasAccess)).toBe(true);
  });

  it('pages by the cursor of the previous page', async () => {
    const { http, transport } = client(syntheticBlogPosts({ blogUrl: 'b', total: 45 }));
    const first = await PostRepository.blogPage(http, 'b', null, DEFAULT_FILTER);
    expect(first.posts).toHaveLength(20);
    expect(first.nextCursor).toBe(cursorFor(20));
    const second = await PostRepository.blogPage(http, 'b', first.nextCursor, DEFAULT_FILTER);
    expect(transport.calls[1].url).toContain('&offset=cursor%3A20');
    const third = await PostRepository.blogPage(http, 'b', second.nextCursor, DEFAULT_FILTER);
    expect(third.posts).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
  });

  it.each([
    ['isLast=true', { offset: 'x', isLast: true }],
    ['no extra', undefined],
    ['extra without offset', { isLast: false }],
  ])('stops on %s', async (_name, extra) => {
    const { http } = client(() => ({ status: 200, body: { data: [blogPost('b', 0)], extra } }));
    expect((await PostRepository.blogPage(http, 'b', null, DEFAULT_FILTER)).nextCursor).toBeNull();
  });

  it('drops a malformed post (logged by id only) and keeps the page', async () => {
    const logger = createLogger();
    const { http } = client(() => ({
      status: 200,
      body: { data: [blogPost('b', 0), { id: 'broken' }, blogPost('b', 1)], extra: { isLast: true } },
    }));
    const page = await PostRepository.blogPage(http, 'b', null, DEFAULT_FILTER, Date.now(), logger);
    expect(page.posts.map(p => p.id)).toEqual(['blog-post-0', 'blog-post-1']);
    expect(logger.entries().filter(e => e.scope === 'post')).toHaveLength(1);
  });

  it('empty data: an empty last page', async () => {
    const { http } = client(() => ({ status: 200, body: { data: [], extra: { isLast: true } } }));
    expect(await PostRepository.blogPage(http, 'b', null, DEFAULT_FILTER)).toEqual({ posts: [], nextCursor: null });
  });

  it('a body without `data` is a Parse error', async () => {
    const { http } = client(() => ({ status: 200, body: { extra: { isLast: true } } }));
    await expect(PostRepository.blogPage(http, 'b', null, DEFAULT_FILTER)).rejects.toEqual(new AppError('Parse'));
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

describe('feedSearchPath (E6, Story 5.6)', () => {
  const BASE = '/v1/search/feed/post/?limit=10&comments_limit=0&reply_limit=0';

  it('E5 params, then search_query; no offset on the first page', () => {
    expect(feedSearchPath('капуста', null, DEFAULT_FILTER)).toBe(
      `${BASE}&only_allowed=true&only_bought=false&search_query=%D0%BA%D0%B0%D0%BF%D1%83%D1%81%D1%82%D0%B0`,
    );
  });

  it('encodes Cyrillic, spaces, `&`, `#`, `=`, `+`, `%` and `/` so the query stays one param', () => {
    const path = feedSearchPath('квашеная капуста & #1 a=b+c 50% x/y', null, DEFAULT_FILTER);
    const param = /[?&]search_query=([^&#]*)/.exec(path)?.[1] ?? '';
    expect(decodeURIComponent(param)).toBe('квашеная капуста & #1 a=b+c 50% x/y');
    expect(path).not.toContain('#');
    expect(path.split('&').filter(part => part.startsWith('search_query='))).toHaveLength(1);
    expect(param).toContain('%26');
    expect(param).toContain('%23');
  });

  it('the Filter params as on E5 (access, period resolved at `now`, sorted tags), then the query, then the cursor', () => {
    const now = new Date(2026, 9, 29, 12, 0, 0).getTime();
    const filter = {
      access: 'all' as const,
      period: { kind: 'preset' as const, days: 7 as const },
      tags: [
        { id: '12', title: 'B' },
        { id: '3', title: 'A' },
      ],
    };
    const path = feedSearchPath('q', 'a b&c', filter, now);
    const feed = feedPath(null, filter, now).replace('/v1/feed/post/', '/v1/search/feed/post/');
    expect(path).toBe(`${feed}&search_query=q&offset=a%20b%26c`);
    expect(path).toContain('tags_ids=12,3');
  });
});

describe('PostRepository.feedSearchPage (E6, Story 5.6)', () => {
  it('reads data.searchPosts[].post (the live shape) and the opaque cursor', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e6Search1.body }));
    const page = await PostRepository.feedSearchPage(http, 'капуста', null, DEFAULT_FILTER);
    expect(page.posts.map(p => p.id)).toEqual(
      e6Search1.body.data.searchPosts.map(item => item.post.id),
    );
    expect(page.nextCursor).toBe('redacted');
    expect(transport.calls[0].path).toBe('/v1/search/feed/post/');
    expect(transport.calls[0].url).toContain('search_query=');
    expect(transport.calls.every(c => !c.path.includes('comment'))).toBe(true);
  });

  it('the last page (isLast) ends the paging', async () => {
    const { http } = client(() => ({ status: 200, body: e6Search2.body }));
    const page = await PostRepository.feedSearchPage(http, 'q', 'redacted', DEFAULT_FILTER);
    expect(page.posts).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('drops an item without a post object, and a malformed post, never the page; counts only in the log', async () => {
    const logger = createLogger();
    const warn = jest.spyOn(logger, 'warn');
    const bad = feedPost(2);
    delete (bad.user as Record<string, unknown>).name;
    const { http } = client(() => ({
      status: 200,
      body: {
        data: {
          searchPosts: [
            { post: feedPost(0), rank: 5 },
            { rank: 5 },
            { post: null },
            'junk',
            { post: bad },
            { post: feedPost(1), headline: 'redacted' },
            { post: feedPost(1) },
          ],
        },
        extra: { offset: 'c', isLast: false },
      },
    }));
    const page = await PostRepository.feedSearchPage(http, 'q', null, DEFAULT_FILTER, Date.now(), logger);
    expect(page.posts.map(p => p.id)).toEqual(['feed-post-0', 'feed-post-1']);
    expect(page.nextCursor).toBe('c');
    expect(warn).toHaveBeenCalledWith('search', 'dropped', { count: 3 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('"q"');
  });

  it('empty results: an empty last page', async () => {
    const { http } = client(() => ({
      status: 200,
      body: { data: { blogs: [], searchPosts: [] }, extra: { offset: 'x', isLast: true } },
    }));
    expect(await PostRepository.feedSearchPage(http, 'q', null, DEFAULT_FILTER)).toEqual({
      posts: [],
      nextCursor: null,
    });
  });

  it.each([
    ['no data.searchPosts (an E5 body)', { status: 200, body: { data: { posts: [] } } }, 'Parse'],
    ['searchPosts not an array', { status: 200, body: { data: { searchPosts: {} } } }, 'Parse'],
    ['403', { status: 403, body: {} }, 'Client'],
    ['503', { status: 503, body: {} }, 'Server'],
  ])('a page with %s rejects with AppError', async (_name, reply, kind) => {
    const { http } = client(() => reply);
    await expect(PostRepository.feedSearchPage(http, 'q', null, DEFAULT_FILTER)).rejects.toEqual(
      new AppError(kind as never),
    );
  });
});

/* eslint-disable no-script-url -- Story 6.3: unsafe URLs are inputs the code must reject */
describe('PostRepository.fileTarget (Story 6.3)', () => {
  const SQ = '?sig=REDACTED';
  const withFiles = (data: unknown[], extra: Record<string, unknown> = {}) => ({
    ...e8Accessible(),
    data,
    signedQuery: SQ,
    ...extra,
  });
  const file = (id: string | undefined, url: string) => ({ type: 'file', ...(id ? { id } : {}), title: 'f', url });

  it('a fresh E8 (content profile), then the file by id: url + signedQuery', async () => {
    const { http, transport } = client(() => ({
      status: 200,
      body: withFiles([file('f0', 'https://example.invalid/zero'), file('f1', 'https://example.invalid/file')]),
    }));
    const result = await PostRepository.fileTarget(http, 'synthetic-blog-1', 'synthetic-id-4', 'file:f1');
    expect(result).toEqual({ kind: 'ok', target: 'https://example.invalid/file?sig=REDACTED' });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].url).toBe(
      'https://api.boosty.to/v1/blog/synthetic-blog-1/post/synthetic-id-4?comments_limit=0&reply_limit=0',
    );
  });

  it('a file without an id is found by its index with the shown title; a wrong key, a missing or unsafe URL → unavailable', async () => {
    const body = withFiles([{ type: 'text', content: '' }, file(undefined, 'https://example.invalid/file'), file('bad', 'javascript:x')]);
    const { http } = client(() => ({ status: 200, body }));
    expect(await PostRepository.fileTarget(http, 'b', 'p', 'file@1', { title: 'f' })).toEqual({
      kind: 'ok',
      target: 'https://example.invalid/file?sig=REDACTED',
    });
    expect(await PostRepository.fileTarget(http, 'b', 'p', 'file@0')).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.fileTarget(http, 'b', 'p', 'file:gone')).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.fileTarget(http, 'b', 'p', 'file:bad')).toEqual({ kind: 'unavailable' });
  });

  it('an id-less file whose title changed at that index (an edited post) → unavailable, never another file\'s link', async () => {
    const body = withFiles([{ type: 'text', content: '' }, { type: 'file', title: 'other.zip', url: 'https://example.invalid/other' }]);
    const { http } = client(() => ({ status: 200, body }));
    expect(await PostRepository.fileTarget(http, 'b', 'p', 'file@1', { title: 'report.pdf' })).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.fileTarget(http, 'b', 'p', 'file@1', { title: ' other.zip ' })).toEqual({
      kind: 'ok',
      target: 'https://example.invalid/other?sig=REDACTED',
    });
  });

  it('an empty or missing signedQuery → unavailable (the bare file URL answers 403, live)', async () => {
    for (const extra of [{ signedQuery: '' }, { signedQuery: '?' }, { signedQuery: null }]) {
      const { http } = client(() => ({ status: 200, body: withFiles([file('f1', 'https://example.invalid/file')], extra) }));
      expect(await PostRepository.fileTarget(http, 'b', 'p', 'file:f1')).toEqual({ kind: 'unavailable' });
    }
  });

  it('locked → locked; 404 → unavailable; other failures reject with their kind', async () => {
    expect(await PostRepository.fileTarget(client(() => ({ status: 200, body: e8Locked() })).http, 'b', 'p', 'file:f1')).toEqual({
      kind: 'locked',
    });
    expect(await PostRepository.fileTarget(client(() => e8MissingReply()).http, 'b', 'p', 'file:f1')).toEqual({
      kind: 'unavailable',
    });
    const failing = client(() => ({ status: 400, body: { error: 'bad_request' } }));
    await expect(PostRepository.fileTarget(failing.http, 'b', 'p', 'file:f1')).rejects.toEqual(new AppError('Client'));
  });

  it('logs nothing of the target', async () => {
    const logger = createLogger();
    const { http } = client(() => ({ status: 200, body: withFiles([file('f1', 'https://example.invalid/file')]) }));
    await PostRepository.fileTarget(http, 'b', 'p', 'file:f1', { logger });
    expect(JSON.stringify(logger.entries())).not.toMatch(/REDACTED|example\.invalid\/file/);
  });
});

describe('PostRepository.audioSource (Story 6.4)', () => {
  const SQ = '?sig=REDACTED';
  const withAudio = (data: unknown[], extra: Record<string, unknown> = {}) => ({
    ...e8Accessible(),
    data,
    signedQuery: SQ,
    ...extra,
  });
  const audio = (id: string | undefined, url: string, title = 'a') => ({
    type: 'audio_file',
    ...(id ? { id } : {}),
    title,
    duration: 180,
    url,
  });

  it('a fresh E8 (content profile), then the audio by id: url + signedQuery', async () => {
    const { http, transport } = client(() => ({
      status: 200,
      body: withAudio([audio('a0', 'https://example.invalid/zero'), audio('a1', 'https://example.invalid/audio')]),
    }));
    const result = await PostRepository.audioSource(http, 'synthetic-blog-1', 'synthetic-id-4', 'audio_file:a1');
    expect(result).toEqual({ kind: 'ok', uri: 'https://example.invalid/audio?sig=REDACTED' });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].url).toBe(
      'https://api.boosty.to/v1/blog/synthetic-blog-1/post/synthetic-id-4?comments_limit=0&reply_limit=0',
    );
  });

  it('the live fixture\'s synthetic audio block resolves by id', async () => {
    const { http } = client(() => ({ status: 200, body: e8Accessible() }));
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file:synthetic-id-14')).toEqual({
      kind: 'ok',
      uri: 'https://example.invalid/audio?sig=REDACTED',
    });
  });

  it('an audio without an id is found by its index with the shown title; a wrong key, type, a missing or unsafe URL → unavailable', async () => {
    const body = withAudio([
      { type: 'file', id: 'f1', title: 'a', url: 'https://example.invalid/file' },
      audio(undefined, 'https://example.invalid/audio'),
      audio('bad', 'javascript:x'),
      { type: 'audio_file', id: 'nourl', title: 'a' },
    ]);
    const { http } = client(() => ({ status: 200, body }));
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file@1', { title: 'a' })).toEqual({
      kind: 'ok',
      uri: 'https://example.invalid/audio?sig=REDACTED',
    });
    // A file at that index or with that id is never an audio source.
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file@0', { title: 'a' })).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file:f1')).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.audioSource(http, 'b', 'p', 'file:f1')).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file:gone')).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file:bad')).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file:nourl')).toEqual({ kind: 'unavailable' });
  });

  it('an id-less audio whose title changed at that index (an edited post) → unavailable', async () => {
    const body = withAudio([{ type: 'text', content: '' }, audio(undefined, 'https://example.invalid/other', 'other')]);
    const { http } = client(() => ({ status: 200, body }));
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file@1', { title: 'mine' })).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file@1', { title: ' other ' })).toEqual({
      kind: 'ok',
      uri: 'https://example.invalid/other?sig=REDACTED',
    });
  });

  it('an empty or missing signedQuery → unavailable, never the bare URL (403, live)', async () => {
    for (const extra of [{ signedQuery: '' }, { signedQuery: '?' }, { signedQuery: null }, { signedQuery: undefined }]) {
      const { http } = client(() => ({ status: 200, body: withAudio([audio('a1', 'https://example.invalid/audio')], extra) }));
      expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file:a1')).toEqual({ kind: 'unavailable' });
    }
  });

  it('locked → locked; 404 → unavailable; other failures reject with their kind', async () => {
    expect(
      await PostRepository.audioSource(client(() => ({ status: 200, body: e8Locked() })).http, 'b', 'p', 'audio_file:a1'),
    ).toEqual({ kind: 'locked' });
    expect(await PostRepository.audioSource(client(() => e8MissingReply()).http, 'b', 'p', 'audio_file:a1')).toEqual({
      kind: 'unavailable',
    });
    const failing = client(() => ({ status: 400, body: { error: 'bad_request' } }));
    await expect(PostRepository.audioSource(failing.http, 'b', 'p', 'audio_file:a1')).rejects.toEqual(new AppError('Client'));
  });

  it('a signed target over cleartext http (audio or file) → unavailable: the signedQuery never goes over http', async () => {
    const body = withAudio([
      audio('a1', 'http://example.invalid/audio'),
      { type: 'file', id: 'f1', title: 'f', url: 'http://example.invalid/file' },
    ]);
    const { http } = client(() => ({ status: 200, body }));
    expect(await PostRepository.audioSource(http, 'b', 'p', 'audio_file:a1')).toEqual({ kind: 'unavailable' });
    expect(await PostRepository.fileTarget(http, 'b', 'p', 'file:f1')).toEqual({ kind: 'unavailable' });
  });

  it('logs nothing of the source', async () => {
    const logger = createLogger();
    const { http } = client(() => ({ status: 200, body: withAudio([audio('a1', 'https://example.invalid/audio')]) }));
    await PostRepository.audioSource(http, 'b', 'p', 'audio_file:a1', { logger });
    expect(JSON.stringify(logger.entries())).not.toMatch(/REDACTED|example\.invalid\/audio/);
  });
});
