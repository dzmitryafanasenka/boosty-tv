import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { QUERY_STALE_TIME_MS, queryKeys, type HttpClient } from '../../../shared/api';
import { PostRepository, type Post, type PostPage, type PostsData } from '../../../shared/entities/post';
import { createLogger } from '../../../shared/services/logger';
import { refreshAuthorPostsHead, refreshAuthorPostsHeads } from '../authorPostsRefresh';

const http = {} as HttpClient;
const T0 = 1_000_000;
const page = (ids: string[], nextCursor: string | null): PostPage => ({
  posts: ids.map(id => ({ id }) as Post),
  nextCursor,
});
const cached = (): PostsData => ({ pages: [page(['p0', 'p1'], 'c2')], pageParams: [null] });

let client: QueryClient;
let blogPage: jest.SpyInstance;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  blogPage = jest.spyOn(PostRepository, 'blogPage').mockResolvedValue(page(['n1', 'p0', 'p1'], 'c3'));
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

it('one E4 page-1 request (no cursor) for the blog; failures logged as `author`', async () => {
  client.setQueryData(queryKeys.authorPosts('blog-a'), cached(), { updatedAt: T0 });
  const now = T0 + QUERY_STALE_TIME_MS;
  expect(await refreshAuthorPostsHead(client, http, 'blog-a', now)).toBe('prepended');
  expect(blogPage).toHaveBeenCalledWith(http, 'blog-a', null);

  client.setQueryData(queryKeys.authorPosts('blog-b'), cached(), { updatedAt: T0 });
  blogPage.mockRejectedValueOnce(new Error('boom'));
  const logger = createLogger({ console: false });
  expect(await refreshAuthorPostsHead(client, http, 'blog-b', now, logger)).toBe('failed');
  expect(logger.entries()).toEqual([
    expect.objectContaining({ scope: 'author', message: 'head refresh failed', fields: { kind: 'Unknown' } }),
  ]);
});

it('resume: only blogs whose posts query has an observer (an Author route in the stack)', async () => {
  for (const blog of ['open', 'popped']) {
    client.setQueryData(queryKeys.authorPosts(blog), cached(), { updatedAt: T0 });
  }
  // The E3 header of an open author is not a posts query.
  client.setQueryData(queryKeys.author('open'), { title: 'x' }, { updatedAt: T0 });
  const observer = new QueryObserver(client, {
    queryKey: queryKeys.authorPosts('open'),
    enabled: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  const results = await refreshAuthorPostsHeads(client, http, T0 + QUERY_STALE_TIME_MS);
  unsubscribe();
  expect(results).toEqual(['prepended']);
  expect(blogPage).toHaveBeenCalledTimes(1);
  expect(blogPage).toHaveBeenCalledWith(http, 'open', null);
});
