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
    expect(queryKeys.subscriptionFeed({ access: 'allowed', period: ALL_TIME })).toEqual([
      'feed',
      'subscriptions',
      { access: 'allowed', period: { kind: 'all' } },
    ]);
    const keys = (['allowed', 'all', 'bought'] as const).map(access =>
      JSON.stringify(queryKeys.subscriptionFeed({ access, period: ALL_TIME })),
    );
    expect(new Set(keys).size).toBe(3);
    const prefix = queryKeys.allSubscriptionFeeds();
    expect(queryKeys.subscriptionFeed({ access: 'bought', period: ALL_TIME }).slice(0, prefix.length)).toEqual(
      prefix,
    );
  });
});

describe('queryKeys.subscriptionFeed: the whole Filter is the key (Stories 5.3–5.4)', () => {
  it('two Filters that differ in any field give different keys; equal Filters the same key', () => {
    const base = { access: 'all', period: { kind: 'all' } } as const;
    const extended = { ...base, tagIds: ['1'] } as unknown as typeof base;
    expect(queryKeys.subscriptionFeed(base)[2]).toBe(base);
    expect(JSON.stringify(queryKeys.subscriptionFeed(extended))).not.toBe(
      JSON.stringify(queryKeys.subscriptionFeed(base)),
    );
    expect(JSON.stringify(queryKeys.subscriptionFeed({ access: 'all', period: { kind: 'all' } }))).toBe(
      JSON.stringify(queryKeys.subscriptionFeed(base)),
    );
  });

  it('the period is symbolic (Story 5.4): one key per preset and range, no time in it', () => {
    const week = { access: 'allowed', period: { kind: 'preset', days: 7 } } as const;
    const custom = {
      access: 'allowed',
      period: { kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' },
    } as const;
    const keys = [
      { access: 'allowed', period: { kind: 'all' } } as const,
      week,
      { access: 'allowed', period: { kind: 'preset', days: 30 } } as const,
      custom,
    ].map(filter => JSON.stringify(queryKeys.subscriptionFeed(filter)));
    expect(new Set(keys).size).toBe(4);
    expect(JSON.stringify(queryKeys.subscriptionFeed(week))).toBe(
      '["feed","subscriptions",{"access":"allowed","period":{"kind":"preset","days":7}}]',
    );
  });
});
