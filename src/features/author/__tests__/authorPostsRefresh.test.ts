import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  QUERY_STALE_TIME_MS,
  queryKeys,
  type HttpClient,
} from '../../../shared/api';
import {
  PostRepository,
  type Post,
  type PostPage,
  type PostsData,
} from '../../../shared/entities/post';
import { DEFAULT_FILTER, type Filter } from '../../../shared/filters';
import { createLogger } from '../../../shared/services/logger';
import {
  filterOfAuthorPostsKey,
  refreshAuthorPostsHead,
  refreshAuthorPostsHeads,
} from '../authorPostsRefresh';

const http = {} as HttpClient;
const T0 = 1_000_000;
const page = (ids: string[], nextCursor: string | null): PostPage => ({
  posts: ids.map(id => ({ id } as Post)),
  nextCursor,
});
const cached = (): PostsData => ({
  pages: [page(['p0', 'p1'], 'c2')],
  pageParams: [null],
});
const ALL: Filter = { ...DEFAULT_FILTER, access: 'all' };

let client: QueryClient;
let blogPage: jest.SpyInstance;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  blogPage = jest
    .spyOn(PostRepository, 'blogPage')
    .mockResolvedValue(page(['n1', 'p0', 'p1'], 'c3'));
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

it('one E4 page-1 request (no cursor) for the blog and Filter; failures logged as `author`', async () => {
  client.setQueryData(
    queryKeys.authorPosts('blog-a', DEFAULT_FILTER),
    cached(),
    { updatedAt: T0 },
  );
  const now = T0 + QUERY_STALE_TIME_MS;
  expect(
    await refreshAuthorPostsHead(client, http, 'blog-a', DEFAULT_FILTER, now),
  ).toBe('prepended');
  expect(blogPage).toHaveBeenCalledWith(http, 'blog-a', null, DEFAULT_FILTER);

  client.setQueryData(
    queryKeys.authorPosts('blog-b', DEFAULT_FILTER),
    cached(),
    { updatedAt: T0 },
  );
  blogPage.mockRejectedValueOnce(new Error('boom'));
  const logger = createLogger({ console: false });
  expect(
    await refreshAuthorPostsHead(
      client,
      http,
      'blog-b',
      DEFAULT_FILTER,
      now,
      logger,
    ),
  ).toBe('failed');
  expect(logger.entries()).toEqual([
    expect.objectContaining({
      scope: 'author',
      message: 'head refresh failed',
      fields: { kind: 'Unknown' },
    }),
  ]);
});

it('resume: only posts queries with an observer, each with the Filter its key holds (Story 5.7)', async () => {
  for (const blog of ['open', 'popped']) {
    client.setQueryData(queryKeys.authorPosts(blog, DEFAULT_FILTER), cached(), {
      updatedAt: T0,
    });
  }
  const tagged: Filter = {
    access: 'all',
    period: { kind: 'preset', days: 30 },
    tags: [{ id: '7', title: 'hidden' }],
  };
  client.setQueryData(queryKeys.authorPosts('open', tagged), cached(), {
    updatedAt: T0,
  });
  // The E3 header of an open author is not a posts query.
  client.setQueryData(
    queryKeys.author('open'),
    { title: 'x' },
    { updatedAt: T0 },
  );
  const observer = new QueryObserver(client, {
    queryKey: queryKeys.authorPosts('open', tagged),
    enabled: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  const results = await refreshAuthorPostsHeads(
    client,
    http,
    T0 + QUERY_STALE_TIME_MS,
  );
  unsubscribe();
  expect(results).toEqual(['prepended']);
  expect(blogPage).toHaveBeenCalledTimes(1);
  // The params come from the key: ids only (titles never reach a request).
  expect(blogPage).toHaveBeenCalledWith(http, 'open', null, {
    access: 'all',
    period: { kind: 'preset', days: 30 },
    tags: [{ id: '7', title: '' }],
  });
});

describe('filterOfAuthorPostsKey', () => {
  it('rebuilds the request Filter from the key segment; the key of the result is the same key', () => {
    for (const filter of [
      DEFAULT_FILTER,
      ALL,
      {
        ...DEFAULT_FILTER,
        period: {
          kind: 'custom' as const,
          fromDay: '2026-01-01',
          toDay: '2026-02-01',
        },
      },
    ]) {
      const segment = queryKeys.authorPosts('b', filter)[2];
      const rebuilt = filterOfAuthorPostsKey(segment);
      expect(rebuilt).not.toBeNull();
      expect(queryKeys.authorPosts('b', rebuilt as Filter)).toEqual(
        queryKeys.authorPosts('b', filter),
      );
    }
  });

  it.each([
    ['not an object', 'x'],
    ['unknown access', { access: 'x', period: { kind: 'all' }, tagIds: [] }],
    [
      'bad period',
      { access: 'all', period: { kind: 'preset', days: 5 }, tagIds: [] },
    ],
    ['bad tags', { access: 'all', period: { kind: 'all' }, tagIds: [1] }],
  ])('%s → null (not refreshed)', (_name, segment) => {
    expect(filterOfAuthorPostsKey(segment)).toBeNull();
  });
});
