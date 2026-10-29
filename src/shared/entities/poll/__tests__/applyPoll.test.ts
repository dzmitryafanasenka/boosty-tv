/**
 * Story 6.6: `applyPoll` writes the E10 poll into every cached post and list
 * page holding it (post, feed, search, authorPosts), leaves a miss untouched
 * (the same object, never written) and keeps each query's `dataUpdatedAt`.
 */
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import { DEFAULT_FILTER } from '../../../filters';
import type { Post, PostPage, PostResult } from '../../post/types';
import { POLL_CACHE_ROOTS, applyPoll, withPoll } from '../applyPoll';
import type { Poll } from '../types';

const poll = (overrides: Partial<Poll> = {}): Poll => ({
  id: '9',
  title: 'Q',
  isMultiple: false,
  isFinished: false,
  counter: 1,
  answer: [],
  options: [
    { id: '1', text: 'A', counter: 1, fraction: 100 },
    { id: '2', text: 'B', counter: 0, fraction: 0 },
  ],
  ...overrides,
});
const FRESH = poll({ counter: 2, answer: ['2'], options: [
  { id: '1', text: 'A', counter: 1, fraction: 50 },
  { id: '2', text: 'B', counter: 1, fraction: 50 },
] });

/** A minimal post (only what applyPoll reads matters). */
const post = (id: string, p: Poll | null): Post => ({ id, poll: p }) as unknown as Post;
const pages = (...lists: Post[][]): InfiniteData<PostPage> => ({
  pages: lists.map(posts => ({ posts, nextCursor: null })),
  pageParams: lists.map((_, i) => (i === 0 ? null : `c${i}`)),
});

describe('withPoll (pure)', () => {
  it('replaces the poll of a PostResult whose poll has the id; a miss is the same object', () => {
    const hit: PostResult = { kind: 'ok', post: post('p', poll()) };
    const next = withPoll(hit, FRESH);
    expect(next).not.toBe(hit);
    expect(next.kind === 'ok' && next.post.poll).toBe(FRESH);
    const other: PostResult = { kind: 'ok', post: post('p', poll({ id: '10' })) };
    expect(withPoll(other, FRESH)).toBe(other);
    const none: PostResult = { kind: 'ok', post: post('p', null) };
    expect(withPoll(none, FRESH)).toBe(none);
    const unavailable: PostResult = { kind: 'unavailable' };
    expect(withPoll(unavailable, FRESH)).toBe(unavailable);
  });

  it('replaces it in every page of an InfiniteData, keeping untouched pages and posts as they were', () => {
    const a = post('a', null);
    const b = post('b', poll());
    const c = post('c', poll({ id: '10' }));
    const data = pages([a], [b, c]);
    const next = withPoll(data, FRESH);
    expect(next.pages[0]).toBe(data.pages[0]);
    expect(next.pages[1]).not.toBe(data.pages[1]);
    expect(next.pages[1].posts[0].poll).toBe(FRESH);
    expect(next.pages[1].posts[1]).toBe(c);
    expect(next.pageParams).toBe(data.pageParams);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 3],
    ['an array', [post('a', poll())]],
    ['pages that are not objects', { pages: [null, 1, { posts: 'x' }] }],
    ['a post list item that is not an object', { pages: [{ posts: [null, 2] }] }],
    ['a poll that is not an object', { kind: 'ok', post: { poll: 'x' } }],
  ])('tolerates %s (the same value back)', (_name, data) => {
    expect(withPoll(data, FRESH)).toBe(data);
  });
});

describe('applyPoll (the query cache)', () => {
  const T0 = 1_700_000_000_000;

  const clients: QueryClient[] = [];
  afterEach(() => {
    for (const c of clients.splice(0)) {
      c.clear();
    }
  });

  function seeded() {
    // No gc timers: the test leaves no open handle.
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    clients.push(client);
    const keys = {
      post: queryKeys.post('blog', 'p1'),
      otherPost: queryKeys.post('blog', 'p2'),
      feed: queryKeys.subscriptionFeed(DEFAULT_FILTER),
      search: queryKeys.feedSearch('q', DEFAULT_FILTER),
      blogSearch: queryKeys.blogSearch('blog', 'q', DEFAULT_FILTER),
      author: queryKeys.authorPosts('blog', DEFAULT_FILTER),
      subs: queryKeys.subscriptions(),
    };
    client.setQueryData(keys.post, { kind: 'ok', post: post('p1', poll()) }, { updatedAt: T0 });
    client.setQueryData(keys.otherPost, { kind: 'ok', post: post('p2', null) }, { updatedAt: T0 + 1 });
    client.setQueryData(keys.feed, pages([post('x', null), post('p1', poll())]), { updatedAt: T0 + 2 });
    client.setQueryData(keys.search, pages([post('p1', poll())]), { updatedAt: T0 + 3 });
    client.setQueryData(keys.blogSearch, pages([post('p1', poll())]), { updatedAt: T0 + 4 });
    client.setQueryData(keys.author, pages([], [post('p1', poll())]), { updatedAt: T0 + 5 });
    client.setQueryData(keys.subs, [{ poll: poll() }], { updatedAt: T0 + 6 });
    return { client, keys };
  }

  it('the four roots are post, feed, search and authorPosts', () => {
    expect(POLL_CACHE_ROOTS).toEqual(['post', 'feed', 'search', 'authorPosts']);
  });

  it('writes every post and page holding the poll; a miss and other roots stay the same object; dataUpdatedAt is kept', () => {
    const { client, keys } = seeded();
    const before = Object.fromEntries(
      Object.entries(keys).map(([name, key]) => [name, client.getQueryData(key)]),
    );
    const updatedBefore = Object.fromEntries(
      Object.entries(keys).map(([name, key]) => [name, client.getQueryState(key)?.dataUpdatedAt]),
    );
    expect(applyPoll(client, FRESH)).toBe(5);
    const postData = client.getQueryData<PostResult>(keys.post);
    expect(postData?.kind === 'ok' && postData.post.poll).toEqual(FRESH);
    expect(client.getQueryData<InfiniteData<PostPage>>(keys.feed)?.pages[0].posts[1].poll).toEqual(FRESH);
    expect(client.getQueryData<InfiniteData<PostPage>>(keys.search)?.pages[0].posts[0].poll).toEqual(FRESH);
    expect(client.getQueryData<InfiniteData<PostPage>>(keys.blogSearch)?.pages[0].posts[0].poll).toEqual(FRESH);
    expect(client.getQueryData<InfiniteData<PostPage>>(keys.author)?.pages[1].posts[0].poll).toEqual(FRESH);
    // Untouched: the post without the poll, and a root that is not a post cache.
    expect(client.getQueryData(keys.otherPost)).toBe(before.otherPost);
    expect(client.getQueryData(keys.subs)).toBe(before.subs);
    for (const [name, key] of Object.entries(keys)) {
      expect([name, client.getQueryState(key)?.dataUpdatedAt]).toEqual([name, updatedBefore[name]]);
    }
  });

  it('a poll nobody holds writes nothing', () => {
    const { client } = seeded();
    expect(applyPoll(client, poll({ id: '404' }))).toBe(0);
  });
});
