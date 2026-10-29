import { DEFAULT_FILTER } from '../../filters';
import { queryKeys } from '../queryKeys';

describe('queryKeys (Story 3.3 author keys)', () => {
  it('E3 carries the blogUrl only; E4 the blogUrl and the symbolic Filter (no cursor, URL or signed value)', () => {
    expect(queryKeys.author('synthetic-blog-1')).toEqual(['author', 'synthetic-blog-1']);
    expect(queryKeys.authorPosts('synthetic-blog-1', DEFAULT_FILTER)).toEqual([
      'authorPosts',
      'synthetic-blog-1',
      { access: 'allowed', period: { kind: 'all' }, tagIds: [] },
    ]);
  });

  it('E3 and E4 keys never prefix-match each other or another blog', () => {
    const header = queryKeys.author('a');
    const posts = queryKeys.authorPosts('a', DEFAULT_FILTER);
    expect(posts.slice(0, header.length)).not.toEqual(header);
    expect(queryKeys.author('b')).not.toEqual(header);
  });
});

describe('queryKeys.post (Story 3.4)', () => {
  it('carries the post identity only; never a prefix of a list or author key', () => {
    expect(queryKeys.post('b', 'p')).toEqual(['post', 'b', 'p']);
    expect(queryKeys.post('b', 'p')[0]).not.toBe(queryKeys.author('b')[0]);
    expect(queryKeys.post('b', 'p')[0]).not.toBe(queryKeys.authorPosts('b', DEFAULT_FILTER)[0]);
  });
});

describe('queryKeys.me (Story 5.2)', () => {
  it('its own root, never a prefix of another key', () => {
    expect(queryKeys.me()).toEqual(['me']);
    for (const key of [
      queryKeys.subscriptions(),
      queryKeys.subscriptionFeed(DEFAULT_FILTER),
      queryKeys.author('me'),
      queryKeys.authorPosts('me', DEFAULT_FILTER),
    ]) {
      expect(key[0]).not.toBe('me');
    }
  });
});

describe('queryKeys.subscriptionFeed (Story 5.3)', () => {
  const ALL_TIME = { kind: 'all' } as const;
  it('carries the symbolic Filter, one key per access value, under one prefix', () => {
    expect(queryKeys.subscriptionFeed({ access: 'allowed', period: ALL_TIME, tags: [] })).toEqual([
      'feed',
      'subscriptions',
      { access: 'allowed', period: { kind: 'all' }, tagIds: [] },
    ]);
    const keys = (['allowed', 'all', 'bought'] as const).map(access =>
      JSON.stringify(queryKeys.subscriptionFeed({ access, period: ALL_TIME, tags: [] })),
    );
    expect(new Set(keys).size).toBe(3);
    const prefix = queryKeys.allSubscriptionFeeds();
    expect(queryKeys.subscriptionFeed({ access: 'bought', period: ALL_TIME, tags: [] }).slice(0, prefix.length)).toEqual(
      prefix,
    );
  });
});

describe('queryKeys.subscriptionFeed: every section is in the key (Stories 5.3–5.5)', () => {
  it('two Filters that differ in any section give different keys; equal Filters the same key', () => {
    const base = { access: 'all', period: { kind: 'all' }, tags: [] } as const;
    const tagged = { ...base, tags: [{ id: '1', title: 'A' }] };
    expect(JSON.stringify(queryKeys.subscriptionFeed(tagged))).not.toBe(
      JSON.stringify(queryKeys.subscriptionFeed(base)),
    );
    expect(JSON.stringify(queryKeys.subscriptionFeed({ ...base, access: 'bought' }))).not.toBe(
      JSON.stringify(queryKeys.subscriptionFeed(base)),
    );
    expect(JSON.stringify(queryKeys.subscriptionFeed({ access: 'all', period: { kind: 'all' }, tags: [] }))).toBe(
      JSON.stringify(queryKeys.subscriptionFeed(base)),
    );
  });

  it('the period is symbolic (Story 5.4): one key per preset and range, no time in it', () => {
    const week = { access: 'allowed', period: { kind: 'preset', days: 7 }, tags: [] } as const;
    const custom = {
      access: 'allowed',
      period: { kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' },
      tags: [],
    } as const;
    const keys = [
      { access: 'allowed', period: { kind: 'all' }, tags: [] } as const,
      week,
      { access: 'allowed', period: { kind: 'preset', days: 30 }, tags: [] } as const,
      custom,
    ].map(filter => JSON.stringify(queryKeys.subscriptionFeed(filter)));
    expect(new Set(keys).size).toBe(4);
    expect(JSON.stringify(queryKeys.subscriptionFeed(week))).toBe(
      '["feed","subscriptions",{"access":"allowed","period":{"kind":"preset","days":7},"tagIds":[]}]',
    );
  });
});

describe('queryKeys.subscriptionFeed: tags (Story 5.5)', () => {
  const ALL_TIME = { kind: 'all' } as const;
  const a = { id: '12', title: 'Выпечка' };
  const b = { id: '3', title: 'Супы' };
  it('the sorted ids only: A+B and B+A are one key; titles are not in it', () => {
    const ab = queryKeys.subscriptionFeed({ access: 'allowed', period: ALL_TIME, tags: [a, b] });
    const ba = queryKeys.subscriptionFeed({ access: 'allowed', period: ALL_TIME, tags: [b, a] });
    expect(JSON.stringify(ab)).toBe(JSON.stringify(ba));
    expect(ab[2]).toEqual({ access: 'allowed', period: { kind: 'all' }, tagIds: ['12', '3'] });
    expect(JSON.stringify(ab)).not.toContain('Выпечка');
    const renamed = queryKeys.subscriptionFeed({
      access: 'allowed',
      period: ALL_TIME,
      tags: [{ ...a, title: 'Другое' }, b],
    });
    expect(JSON.stringify(renamed)).toBe(JSON.stringify(ab));
  });

  it('one tag differs from two and from none', () => {
    const keys = [[], [a], [a, b]].map(tags =>
      JSON.stringify(queryKeys.subscriptionFeed({ access: 'allowed', period: ALL_TIME, tags })),
    );
    expect(new Set(keys).size).toBe(3);
  });
});

describe('queryKeys.feedTags (Story 5.5)', () => {
  it('its own root, never a prefix of a feed key', () => {
    expect(queryKeys.feedTags()).toEqual(['feedTags']);
    expect(queryKeys.allSubscriptionFeeds()[0]).not.toBe('feedTags');
    expect(queryKeys.subscriptions()[0]).not.toBe('feedTags');
  });
});

describe('queryKeys.feedSearch (Story 5.6)', () => {
  const ALL_TIME = { kind: 'all' } as const;
  const base = { access: 'allowed', period: ALL_TIME, tags: [] } as const;

  it('the query and the symbolic Filter (sorted tag ids, no titles) under the `search` root', () => {
    expect(queryKeys.feedSearch('капуста', base)).toEqual([
      'search',
      'feed',
      { query: 'капуста', access: 'allowed', period: { kind: 'all' }, tagIds: [] },
    ]);
    const tagged = queryKeys.feedSearch('q', {
      ...base,
      tags: [
        { id: '12', title: 'Выпечка' },
        { id: '3', title: 'Супы' },
      ],
    });
    expect(tagged[2].tagIds).toEqual(['12', '3']);
    expect(JSON.stringify(tagged)).not.toContain('Выпечка');
    const prefix = queryKeys.allFeedSearches();
    expect(tagged.slice(0, prefix.length)).toEqual(prefix);
  });

  it('another query or any other Filter section is another key', () => {
    const keys = [
      queryKeys.feedSearch('a', base),
      queryKeys.feedSearch('b', base),
      queryKeys.feedSearch('a', { ...base, access: 'all' }),
      queryKeys.feedSearch('a', { ...base, period: { kind: 'preset', days: 7 } }),
      queryKeys.feedSearch('a', { ...base, tags: [{ id: '1', title: 'x' }] }),
    ].map(key => JSON.stringify(key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never collides with or prefix-matches a feed or author key, with the same Filter', () => {
    const search = queryKeys.feedSearch('q', base);
    const others = [
      queryKeys.subscriptionFeed(base),
      queryKeys.allSubscriptionFeeds(),
      queryKeys.authorPosts('search', base),
      queryKeys.allAuthorPosts(),
      queryKeys.author('search'),
      queryKeys.feedTags(),
      queryKeys.post('search', 'feed'),
    ];
    for (const other of others) {
      expect(other[0]).not.toBe(search[0]);
      expect(search.slice(0, other.length)).not.toEqual(other);
      expect(other.slice(0, queryKeys.allFeedSearches().length)).not.toEqual(
        queryKeys.allFeedSearches(),
      );
    }
  });
});

describe('Story 5.7: author posts, blog search and blog tags keys', () => {
  const base = DEFAULT_FILTER;

  it('authorPosts: one key per Filter (tags as sorted ids, no titles), under the allAuthorPosts prefix', () => {
    const keys = [
      queryKeys.authorPosts('b', base),
      queryKeys.authorPosts('b', { ...base, access: 'all' }),
      queryKeys.authorPosts('b', { ...base, period: { kind: 'preset', days: 7 } }),
      queryKeys.authorPosts('b', { ...base, tags: [{ id: '2', title: 'x' }] }),
      queryKeys.authorPosts('c', base),
    ].map(key => JSON.stringify(key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      queryKeys.authorPosts('b', {
        ...base,
        tags: [
          { id: '9', title: 'z' },
          { id: '10', title: 'y' },
        ],
      }),
    ).toEqual(queryKeys.authorPosts('b', { ...base, tags: [{ id: '10', title: 'other' }, { id: '9', title: '' }] }));
    const prefix = queryKeys.allAuthorPosts();
    expect(queryKeys.authorPosts('b', base).slice(0, prefix.length)).toEqual(prefix);
  });

  it('blogSearch: blog, query and Filter in the key; its own search/blog prefix', () => {
    expect(queryKeys.blogSearch('b', 'q', base)).toEqual([
      'search',
      'blog',
      'b',
      { query: 'q', access: 'allowed', period: { kind: 'all' }, tagIds: [] },
    ]);
    const keys = [
      queryKeys.blogSearch('b', 'q', base),
      queryKeys.blogSearch('b', 'r', base),
      queryKeys.blogSearch('c', 'q', base),
      queryKeys.blogSearch('b', 'q', { ...base, access: 'all' }),
    ].map(key => JSON.stringify(key));
    expect(new Set(keys).size).toBe(keys.length);
    const prefix = queryKeys.allBlogSearches();
    expect(queryKeys.blogSearch('b', 'q', base).slice(0, prefix.length)).toEqual(prefix);
  });

  it('feed, Поиск, author posts and blog search keys never collide or prefix-match each other', () => {
    const keys = [
      queryKeys.subscriptionFeed(base),
      queryKeys.feedSearch('q', base),
      queryKeys.authorPosts('q', base),
      queryKeys.blogSearch('q', 'q', base),
      queryKeys.author('q'),
      queryKeys.feedTags(),
      queryKeys.blogTags('q'),
    ];
    const prefixes = [
      queryKeys.allSubscriptionFeeds(),
      queryKeys.allFeedSearches(),
      queryKeys.allAuthorPosts(),
      queryKeys.allBlogSearches(),
    ];
    keys.forEach((a, i) =>
      keys.forEach((b, j) => {
        if (i !== j) {
          expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
          expect(JSON.stringify(a.slice(0, b.length))).not.toBe(JSON.stringify(b));
        }
      }),
    );
    // Each list prefix matches its own keys only.
    prefixes.forEach((prefix, i) => {
      const own = [keys[0], keys[1], keys[2], keys[3]][i];
      for (const key of keys) {
        const matches = JSON.stringify(key.slice(0, prefix.length)) === JSON.stringify(prefix);
        expect(matches).toBe(key === own);
      }
    });
  });

  it('blogTags: its own root, never a prefix of feedTags', () => {
    expect(queryKeys.blogTags('b')).toEqual(['blogTags', 'b']);
    expect(queryKeys.feedTags()[0]).not.toBe(queryKeys.blogTags('b')[0]);
  });
});
