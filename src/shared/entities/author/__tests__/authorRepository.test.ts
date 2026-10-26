import { AppError } from '../../../api/appError';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
import {
  E2_URL,
  e2Body,
  subscription,
  subscriptionsBody,
  // eslint-disable-next-line boundaries/dependencies -- test-only fixtures
} from '../../../../test/subscriptionFixtures';
import { AuthorRepository, SUBSCRIPTIONS_PATH } from '../authorRepository';
import { mapSubscription } from '../mapAuthor';

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

describe('mapSubscription', () => {
  it('maps the live item: title, blogUrl, owner name and avatar; nothing else', () => {
    const author = mapSubscription(e2Body().data[0], createLogger());
    expect(author).toEqual({
      blogUrl: 'synthetic-blog-1',
      title: 'redacted',
      ownerName: 'redacted',
      avatarUrl: 'https://example.invalid/avatar',
    });
    // No price, currency, level or payment field reaches the domain.
    expect(Object.keys(author ?? {}).sort()).toEqual(['avatarUrl', 'blogUrl', 'ownerName', 'title']);
  });

  it.each([
    ['no blogUrl', { blogUrl: undefined }, 'blog.blogUrl'],
    ['empty blogUrl', { blogUrl: '' }, 'blog.blogUrl'],
    ['a blank blogUrl', { blogUrl: '   ' }, 'blog.blogUrl'],
    ['a numeric blogUrl', { blogUrl: 5 }, 'blog.blogUrl'],
    ['a blogUrl with a space', { blogUrl: 'a b' }, 'blog.blogUrl'],
    ['a blogUrl with /', { blogUrl: 'a/b' }, 'blog.blogUrl'],
    ['a blogUrl with ?', { blogUrl: 'a?b' }, 'blog.blogUrl'],
    ['a blogUrl with #', { blogUrl: 'a#b' }, 'blog.blogUrl'],
    ['a blogUrl with %', { blogUrl: 'a%2Fb' }, 'blog.blogUrl'],
    ['a blogUrl with ..', { blogUrl: 'a..b' }, 'blog.blogUrl'],
  ])('drops and logs an item with %s (field names only)', (_name, blog, field) => {
    const logger = createLogger();
    expect(mapSubscription(subscription(7, blog), logger)).toBeNull();
    const [entry] = logger.entries();
    expect(entry).toMatchObject({ level: 'warn', scope: 'author', message: 'dropped' });
    expect(entry.fields?.fields).toBe(field);
    expect(JSON.stringify(entry)).not.toContain('Owner 7');
  });

  it('drops an item without a blog, and a non-object (logged as `<root>`)', () => {
    expect(mapSubscription({ id: 1001 }, createLogger())).toBeNull();
    const logger = createLogger();
    expect(mapSubscription(null, logger)).toBeNull();
    expect(mapSubscription('x', logger)).toBeNull();
    expect(logger.entries().map(e => e.fields?.fields)).toEqual(['<root>', '<root>']);
  });

  it.each([
    ['no title', { title: undefined }],
    ['a blank title', { title: '   ' }],
    ['a numeric title', { title: 5 }],
  ])('keeps an item with %s: empty title (the card shows the fallback)', (_name, blog) => {
    const logger = createLogger();
    expect(mapSubscription(subscription(7, blog), logger)).toMatchObject({
      blogUrl: 'synthetic-blog-7',
      title: '',
    });
    expect(logger.entries()).toHaveLength(0);
  });

  it('trims a blogUrl with surrounding spaces', () => {
    expect(mapSubscription(subscription(1, { blogUrl: ' abc ' }), createLogger())?.blogUrl).toBe(
      'abc',
    );
  });

  it('owner missing or empty: no owner name, no avatar', () => {
    expect(mapSubscription(subscription(1, { owner: undefined }), createLogger())).toMatchObject({
      ownerName: null,
      avatarUrl: null,
    });
    expect(mapSubscription(subscription(1, { owner: null }), createLogger())).toMatchObject({
      ownerName: null,
      avatarUrl: null,
    });
    expect(
      mapSubscription(subscription(1, { owner: { name: '  ', avatarUrl: '' } }), createLogger()),
    ).toMatchObject({ ownerName: null, avatarUrl: null });
  });

  it('`hasAvatar: false` or a wrong-typed avatar: the placeholder (null)', () => {
    expect(
      mapSubscription(
        subscription(1, { owner: { name: 'A', avatarUrl: 'https://example.invalid/avatar', hasAvatar: false } }),
        createLogger(),
      )?.avatarUrl,
    ).toBeNull();
    expect(
      mapSubscription(subscription(1, { owner: { name: 'A', avatarUrl: 5 } }), createLogger())
        ?.avatarUrl,
    ).toBeNull();
  });

  it('trims the title', () => {
    expect(mapSubscription(subscription(1, { title: '  Кухня  ' }), createLogger())?.title).toBe(
      'Кухня',
    );
  });
});

describe('AuthorRepository.subscriptions', () => {
  it('sends exactly E2 with the content profile and maps the live body', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e2Body() }));
    const list = await AuthorRepository.subscriptions(http);
    expect(SUBSCRIPTIONS_PATH).toBe('/v1/user/subscriptions?limit=30&with_follow=true');
    expect(list.authors.map(a => a.blogUrl)).toEqual([
      'synthetic-blog-1',
      'synthetic-blog-2',
      'synthetic-blog-3',
    ]);
    expect(list.total).toBe(5);
    expect(list.received).toBe(3);
    expect(transport.calls).toHaveLength(1);
    const [call] = transport.calls;
    expect(call.method).toBe('GET');
    expect(call.url).toBe(E2_URL);
    expect(call.headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
    expect(call.headers['X-App']).toBeUndefined();
    expect(call.headers['X-From-Id']).toBeUndefined();
  });

  it('drops a malformed item and keeps the others', async () => {
    const body = subscriptionsBody(3);
    (body.data as Array<Record<string, any>>)[1].blog.blogUrl = undefined;
    const logger = createLogger();
    const { http } = client(() => ({ status: 200, body }));
    const list = await AuthorRepository.subscriptions(http, logger);
    expect(list.authors.map(a => a.blogUrl)).toEqual(['synthetic-blog-1', 'synthetic-blog-3']);
    expect(list.received).toBe(3);
    expect(logger.entries().filter(e => e.message === 'dropped')).toHaveLength(1);
  });

  it('dedupes by blogUrl (first kept)', async () => {
    const body = subscriptionsBody(2);
    (body.data as unknown[]).push(subscription(1, { title: 'Again' }));
    const { http } = client(() => ({ status: 200, body }));
    const list = await AuthorRepository.subscriptions(http);
    expect(list.authors.map(a => a.title)).toEqual(['Blog 1', 'Blog 2']);
  });

  it('empty data: no authors; a missing or wrong total is null', async () => {
    const empty = client(() => ({ status: 200, body: { offset: 0, limit: 30, total: 0, data: [] } }));
    expect(await AuthorRepository.subscriptions(empty.http)).toEqual({
      authors: [],
      received: 0,
      total: 0,
    });
    const noTotal = client(() => ({ status: 200, body: { data: [] } }));
    expect((await AuthorRepository.subscriptions(noTotal.http)).total).toBeNull();
    const wrongTotal = client(() => ({ status: 200, body: { total: 'many', data: [] } }));
    expect((await AuthorRepository.subscriptions(wrongTotal.http)).total).toBeNull();
  });

  it('a body without `data` is a Parse error', async () => {
    const { http } = client(() => ({ status: 200, body: { total: 3 } }));
    await expect(AuthorRepository.subscriptions(http)).rejects.toMatchObject({ kind: 'Parse' });
  });

  it('a server error rejects with its AppError kind', async () => {
    const { http } = client(() => ({ status: 500, body: {} }));
    const error = await AuthorRepository.subscriptions(http).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('Server');
  });
});
