import { AppError } from '../../../api/appError';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { cursorFor, e5Page, feedPost, syntheticFeed } from '../../../../test/feedFixtures';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { blogPost, e4Page, syntheticBlogPosts } from '../../../../test/authorFixtures';
import { PostRepository, blogPostsPath, feedPath, mergePosts } from '../postRepository';
import { mapPost } from '../mapPost';
import type { Post } from '../types';

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
  it('E5 with comments off and no offset on the first page', () => {
    expect(feedPath(null)).toBe('/v1/feed/post/?limit=10&comments_limit=0&reply_limit=0');
  });

  it('passes the opaque cursor back verbatim, URL-encoded', () => {
    expect(feedPath('a b&c=d/é:1')).toBe(
      '/v1/feed/post/?limit=10&comments_limit=0&reply_limit=0&offset=a%20b%26c%3Dd%2F%C3%A9%3A1',
    );
  });
});

describe('PostRepository.feedPage', () => {
  it('sends E5 with the content profile and maps the live page', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e5Page({ isLast: false, offset: 'redacted' }) }));
    const page = await PostRepository.feedPage(http, null);
    expect(page.posts).toHaveLength(10);
    expect(page.nextCursor).toBe('redacted');
    const [call] = transport.calls;
    expect(call.url).toBe(
      'https://api.boosty.to/v1/feed/post/?limit=10&comments_limit=0&reply_limit=0',
    );
    expect(call.headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
    expect(call.headers['X-App']).toBeUndefined();
    expect(call.headers['X-From-Id']).toBeUndefined();
    // No comment request, ever.
    expect(transport.calls.every(c => !c.path.includes('comment'))).toBe(true);
  });

  it('the next request carries the cursor of the previous page', async () => {
    const { http, transport } = client(syntheticFeed({ total: 25 }));
    const first = await PostRepository.feedPage(http, null);
    expect(first.nextCursor).toBe(cursorFor(10));
    const second = await PostRepository.feedPage(http, first.nextCursor);
    expect(second.posts.map(p => p.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `feed-post-${10 + i}`),
    );
    expect(transport.calls[1].url).toContain('&offset=cursor%3A10');
    const third = await PostRepository.feedPage(http, second.nextCursor);
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
    expect((await PostRepository.feedPage(http, null)).nextCursor).toBeNull();
  });

  it('drops a malformed post and keeps the page', async () => {
    const bad = feedPost(1);
    delete (bad.user as Record<string, unknown>).name;
    const { http } = client(() => ({
      status: 200,
      body: { data: { posts: [feedPost(0), bad, feedPost(2)] }, extra: { offset: 'c', isLast: false } },
    }));
    const page = await PostRepository.feedPage(http, null);
    expect(page.posts.map(p => p.id)).toEqual(['feed-post-0', 'feed-post-2']);
  });

  it('dedupes inside one page', async () => {
    const { http } = client(() => ({
      status: 200,
      body: { data: { posts: [feedPost(0), feedPost(0), feedPost(1)] }, extra: { isLast: true } },
    }));
    expect((await PostRepository.feedPage(http, null)).posts.map(p => p.id)).toEqual([
      'feed-post-0',
      'feed-post-1',
    ]);
  });

  it('an empty feed is an empty last page', async () => {
    const { http } = client(() => ({ status: 200, body: { data: { posts: [] }, extra: { isLast: true } } }));
    expect(await PostRepository.feedPage(http, null)).toEqual({ posts: [], nextCursor: null });
  });

  it.each([
    ['no data.posts', { status: 200, body: { data: {} } }, 'Parse'],
    ['a non-JSON 200', { status: 200, body: undefined }, 'Parse'],
    ['404', { status: 404, body: { error: 'not_found' } }, 'NotFound'],
    ['403 (never a session problem)', { status: 403, body: {} }, 'Client'],
    ['503', { status: 503, body: {} }, 'Server'],
  ])('a page with %s rejects with AppError', async (_name, reply, kind) => {
    const { http } = client(() => reply);
    await expect(PostRepository.feedPage(http, null)).rejects.toEqual(new AppError(kind as never));
  });

  it('a network failure rejects with Network after the HttpClient retries', async () => {
    const { http, transport } = client(() => ({ network: true }));
    await expect(PostRepository.feedPage(http, null)).rejects.toMatchObject({ kind: 'Network' });
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
