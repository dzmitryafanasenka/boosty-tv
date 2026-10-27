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
