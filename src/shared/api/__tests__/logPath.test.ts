import { logPath } from '../transport';

describe('logPath (Story 8.3 review)', () => {
  it.each([
    ['https://api.boosty.to/v1/feed/post/?limit=20&x=1', '/v1/feed/post/'],
    ['https://api.boosty.to/v1/user/current', '/v1/user/current'],
    ['https://api.boosty.to/v1/user/subscriptions?limit=1', '/v1/user/subscriptions'],
    ['https://api.boosty.to/v1/search/blog/post/?blog_url=author', '/v1/search/blog/post/'],
    ['https://api.boosty.to/v1/blog/some-author', '/v1/blog/<blog>'],
    ['https://api.boosty.to/v1/blog/some-author/post/1a2b-3c?comments_limit=0', '/v1/blog/<blog>/post/<seg>'],
    ['https://api.boosty.to/v1/blog/post/post/', '/v1/blog/<blog>/post/'],
    ['https://api.boosty.to/v1/blog/author/video_stream', '/v1/blog/<blog>/video_stream'],
    ['https://api.boosty.to/v1/blog/author/poll/77', '/v1/blog/<blog>/poll/<seg>'],
    ['https://api.boosty.to/v1/poll/77/vote', '/v1/poll/<seg>/vote'],
    ['https://api.boosty.to/v1/viewstat/video/m-9/timecode/', '/v1/viewstat/video/<seg>/timecode/'],
    ['https://api.boosty.to/oauth/token/', '/oauth/token/'],
    ['/v1/blog/author/post/tag/#frag', '/v1/blog/<blog>/post/tag/'],
  ])('%s → %s', (url, expected) => {
    expect(logPath(url)).toBe(expected);
  });
});
