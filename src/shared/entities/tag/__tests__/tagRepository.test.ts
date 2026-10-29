import { AppError } from '../../../api/appError';
import { feedTagsPageDtoSchema } from '../../../api/dto/feedTags';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import page1 from '../../../../test/fixtures/boosty/e13-feed-tags-1.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import page2 from '../../../../test/fixtures/boosty/e13-feed-tags-2.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e14 from '../../../../test/fixtures/boosty/e14-blog-tags.json';
import { FEED_TAGS_PAGE_SIZE, TagRepository, blogTagsPath, feedTagsPath, mergeTags } from '..';

function client(handler: FixtureHandler) {
  const transport = createFixtureTransport(handler);
  const logger = createLogger();
  const http = createHttpClient({
    transport,
    tokens: fixedAccessToken('t'.repeat(64)),
    sleep: () => Promise.resolve(),
    logger,
  });
  return { http, transport, logger };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('feedTagsPath (E13)', () => {
  it('limit 100; the opaque cursor goes back verbatim, encoded', () => {
    expect(FEED_TAGS_PAGE_SIZE).toBe(100);
    expect(feedTagsPath(null)).toBe('/v1/search/feed/tag/?limit=100');
    expect(feedTagsPath('a b&c=d')).toBe('/v1/search/feed/tag/?limit=100&offset=a%20b%26c%3Dd');
  });
});

describe('feedTagsPageDtoSchema', () => {
  it('reads the sanitized fixtures', () => {
    expect(feedTagsPageDtoSchema.parse(page1.body).data.searchTags).toHaveLength(3);
    expect(feedTagsPageDtoSchema.parse(page2.body).extra).toEqual({ offset: 'redacted', isLast: true });
  });

  it('a missing searchTags fails the page', () => {
    expect(feedTagsPageDtoSchema.safeParse({ data: {} }).success).toBe(false);
  });
});

describe('TagRepository.feedTagsPage', () => {
  it('page 1: ids as strings, titles, the next cursor; one GET with the content client', async () => {
    const { http, transport } = client(() => ({ status: 200, body: page1.body }));
    const page = await TagRepository.feedTagsPage(http, null);
    expect(page).toEqual({
      tags: [
        { id: '1001', title: 'redacted' },
        { id: '1002', title: 'redacted' },
        { id: '1003', title: 'redacted' },
      ],
      nextCursor: 'redacted',
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].url).toBe('https://api.boosty.to/v1/search/feed/tag/?limit=100');
  });

  it('the last page has no next cursor; nor has a page without extra or offset', async () => {
    const last = client(() => ({ status: 200, body: page2.body }));
    expect((await TagRepository.feedTagsPage(last.http, 'c1')).nextCursor).toBeNull();
    expect(last.transport.calls[0].url).toContain('&offset=c1');
    const noExtra = client(() => ({ status: 200, body: { data: { searchTags: [] } } }));
    expect(await TagRepository.feedTagsPage(noExtra.http, null)).toEqual({ tags: [], nextCursor: null });
    const noOffset = client(() => ({ status: 200, body: { data: { searchTags: [] }, extra: { isLast: false } } }));
    expect((await TagRepository.feedTagsPage(noOffset.http, null)).nextCursor).toBeNull();
  });

  it('a malformed tag is dropped (counted, no value logged), never the page; duplicates deduped', async () => {
    const body = {
      data: {
        searchTags: [
          { tag: { id: 1001, title: ' Выпечка ' }, rank: 5 },
          { tag: { id: 1002 } },
          { tag: { title: 'без id' } },
          { tag: { id: 1003, title: '   ' } },
          { tag: { id: -1, title: 'x' } },
          null,
          'tag',
          { tag: { id: 'abc', title: 'не цифры' } },
          { tag: { id: '1,2', title: 'с запятой' } },
          { tag: { id: ' 77 ', title: 'строковый id' } },
          { tag: { id: 1001, title: 'дубль' } },
        ],
      },
      extra: { offset: 'next', isLast: false },
    };
    const { http, logger } = client(() => ({ status: 200, body }));
    const page = await TagRepository.feedTagsPage(http, null, logger);
    expect(page.tags).toEqual([
      { id: '1001', title: 'Выпечка' },
      { id: '77', title: 'строковый id' },
    ]);
    const entry = logger.entries().find(e => e.scope === 'tags');
    expect(entry?.fields).toEqual({ count: '8' });
    expect(JSON.stringify(logger.entries())).not.toContain('Выпечка');
  });

  it.each([
    ['Parse', { status: 200, body: { data: { posts: [] } } }],
    ['Server', { status: 500, body: {} }],
  ])('rejects with AppError %s', async (kind, reply) => {
    const { http } = client(() => reply);
    const error = await TagRepository.feedTagsPage(http, null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe(kind);
  });
});

describe('mergeTags', () => {
  it('appends and dedupes by id, the first kept', () => {
    expect(
      mergeTags([{ id: '1', title: 'a' }], [{ id: '1', title: 'b' }, { id: '2', title: 'c' }]),
    ).toEqual([
      { id: '1', title: 'a' },
      { id: '2', title: 'c' },
    ]);
  });
});

describe('TagRepository.blogTags (E14, Story 5.7)', () => {
  it('the path encodes the blog as a path segment; no params', () => {
    expect(blogTagsPath('synthetic-blog-1')).toBe('/v1/blog/synthetic-blog-1/post/tag/');
    expect(blogTagsPath('a:b')).toBe('/v1/blog/a%3Ab/post/tag/');
  });

  it('maps the fixture: ids as strings, titles; `count` is not read', async () => {
    const { http, transport } = client(() => ({ status: e14.status, body: e14.body }));
    const tags = await TagRepository.blogTags(http, 'synthetic-blog-1');
    expect(tags).toEqual([
      { id: '2001', title: 'redacted' },
      { id: '2002', title: 'redacted' },
      { id: '2003', title: 'redacted' },
    ]);
    expect(transport.calls[0].url).toBe('https://api.boosty.to/v1/blog/synthetic-blog-1/post/tag/');
  });

  it('drops a malformed tag (counted in the log, no value) and dedupes by id; never fails the list', async () => {
    const { http, logger } = client(() => ({
      status: 200,
      body: {
        data: [
          { id: 1, title: 'A' },
          { id: '1,2', title: 'comma' },
          { id: 2, title: '   ' },
          { title: 'no id' },
          'junk',
          { id: '3', title: ' B ' },
          { id: 1, title: 'again' },
        ],
      },
    }));
    expect(await TagRepository.blogTags(http, 'b', logger)).toEqual([
      { id: '1', title: 'A' },
      { id: '3', title: 'B' },
    ]);
    const warnings = logger.entries().filter(e => e.scope === 'tags');
    expect(warnings).toEqual([expect.objectContaining({ message: 'dropped', fields: { count: '4' } })]);
    expect(JSON.stringify(warnings)).not.toContain('comma');
  });

  it('empty data: no tags; a body without a `data` array is Parse', async () => {
    expect(await TagRepository.blogTags(client(() => ({ status: 200, body: { data: [] } })).http, 'b')).toEqual([]);
    await expect(
      TagRepository.blogTags(client(() => ({ status: 200, body: { data: {} } })).http, 'b'),
    ).rejects.toEqual(new AppError('Parse'));
  });
});
