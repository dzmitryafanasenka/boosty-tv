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
