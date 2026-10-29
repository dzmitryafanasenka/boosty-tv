import { DEFAULT_FILTER } from '../../filters';
import { queryKeys } from '../queryKeys';

describe('queryKeys (Story 3.3 author keys)', () => {
  it('E3 and E4 keys carry the blogUrl only (no cursor, URL or signed value)', () => {
    expect(queryKeys.author('synthetic-blog-1')).toEqual(['author', 'synthetic-blog-1']);
    expect(queryKeys.authorPosts('synthetic-blog-1')).toEqual(['authorPosts', 'synthetic-blog-1']);
  });

  it('E3 and E4 keys never prefix-match each other or another blog', () => {
    const header = queryKeys.author('a');
    const posts = queryKeys.authorPosts('a');
    expect(posts.slice(0, header.length)).not.toEqual(header);
    expect(queryKeys.author('b')).not.toEqual(header);
  });
});

describe('queryKeys.post (Story 3.4)', () => {
  it('carries the post identity only; never a prefix of a list or author key', () => {
    expect(queryKeys.post('b', 'p')).toEqual(['post', 'b', 'p']);
    expect(queryKeys.post('b', 'p')[0]).not.toBe(queryKeys.author('b')[0]);
    expect(queryKeys.post('b', 'p')[0]).not.toBe(queryKeys.authorPosts('b')[0]);
  });
});

describe('queryKeys.me (Story 5.2)', () => {
  it('its own root, never a prefix of another key', () => {
    expect(queryKeys.me()).toEqual(['me']);
    for (const key of [
      queryKeys.subscriptions(),
      queryKeys.subscriptionFeed(DEFAULT_FILTER),
      queryKeys.author('me'),
      queryKeys.authorPosts('me'),
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
