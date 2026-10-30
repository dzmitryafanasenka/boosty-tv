/* eslint-disable no-script-url -- Story 6.3: unsafe URLs are inputs the code must reject */
import { boostyPostRef, boostyStreamUrl, fileTarget, timestampRef, safeHttpUrl, youtubeId, youtubeThumbnail } from '../externalUrls';

describe('safeHttpUrl (Story 6.3)', () => {
  it('keeps absolute http(s) URLs with a host (trimmed)', () => {
    expect(safeHttpUrl('https://example.invalid/a?b=1#c')).toBe('https://example.invalid/a?b=1#c');
    expect(safeHttpUrl('http://example.invalid')).toBe('http://example.invalid');
    expect(safeHttpUrl('  HTTPS://Example.invalid/x  ')).toBe('HTTPS://Example.invalid/x');
    expect(safeHttpUrl('https://example.invalid:8443/x')).toBe('https://example.invalid:8443/x');
  });

  it('rejects anything else: empty, relative, other schemes, no host, whitespace or control characters inside', () => {
    for (const bad of [
      null,
      undefined,
      '',
      '   ',
      '/relative/path',
      'example.invalid/a',
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,x',
      'intent://scan#Intent;end',
      'ftp://example.invalid/f',
      'mailto:a@example.invalid',
      'https://',
      'https:///path',
      'https://exa mple.invalid',
      'https://example.invalid/a\nb',
      'https://user@example.invalid/',
      'https://:80/x',
      'https://:/x',
    ]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });
});

describe('youtubeId / youtubeThumbnail (Story 6.3)', () => {
  const ID = 'dQw4w9WgXcQ';
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `http://www.youtube.com/watch?v=${ID}#t=1`,
  ])('%s → the id', url => {
    expect(youtubeId(url)).toBe(ID);
  });

  it.each([
    'https://example.invalid/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?x=dQw4w9WgXcQ',
    'https://www.youtube.com/channel/dQw4w9WgXcQ',
    'https://www.youtube.com/',
    'https://youtu.be/',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.example.invalid/watch?v=dQw4w9WgXcQ',
    'javascript:youtu.be/dQw4w9WgXcQ',
    '',
  ])('%s → null', url => {
    expect(youtubeId(url)).toBeNull();
  });

  it('the thumbnail is the plain hqdefault image URL', () => {
    expect(youtubeThumbnail(ID)).toBe(`https://img.youtube.com/vi/${ID}/hqdefault.jpg`);
  });
});

describe('fileTarget (Story 6.3: url + signedQuery)', () => {
  const U = 'https://example.invalid/file/1';
  it('joins with ? or &, dropping a leading ? or & of the query', () => {
    expect(fileTarget(U, '?a=1&b=2')).toBe(`${U}?a=1&b=2`);
    expect(fileTarget(U, 'a=1')).toBe(`${U}?a=1`);
    expect(fileTarget(U, '&a=1')).toBe(`${U}?a=1`);
    expect(fileTarget(`${U}?x=0`, '?a=1')).toBe(`${U}?x=0&a=1`);
    expect(fileTarget(`${U}?x=0&`, '?a=1')).toBe(`${U}?x=0&a=1`);
    expect(fileTarget(`${U}?`, 'a=1')).toBe(`${U}?a=1`);
  });

  it('a fragment of the URL is dropped (it would swallow the query)', () => {
    expect(fileTarget(`${U}#frag`, '?a=1')).toBe(`${U}?a=1`);
  });

  it('an empty or missing query gives the URL as is', () => {
    expect(fileTarget(U, '')).toBe(U);
    expect(fileTarget(U, '?')).toBe(U);
    expect(fileTarget(U, null)).toBe(U);
  });

  it('an unsafe or missing URL gives no target', () => {
    expect(fileTarget('javascript:alert(1)', '?a=1')).toBeNull();
    expect(fileTarget('', '?a=1')).toBeNull();
    expect(fileTarget(null, '?a=1')).toBeNull();
  });
});

describe('boostyPostRef (Story 6.3, owner decision 2026-10-29)', () => {
  it.each([
    ['https://boosty.to/blog-1/posts/0b1c-2d3e', { blogUrl: 'blog-1', postId: '0b1c-2d3e' }],
    ['https://www.boosty.to/blog_2/posts/id?share=post_link', { blogUrl: 'blog_2', postId: 'id' }],
    ['https://BOOSTY.TO/blog/posts/id#comments', { blogUrl: 'blog', postId: 'id' }],
    ['https://boosty.to/blog/posts/id/', { blogUrl: 'blog', postId: 'id' }],
  ])('%s → the post', (url, ref) => {
    expect(boostyPostRef(url)).toEqual(ref);
  });

  it.each([
    'https://boosty.to/blog',
    'https://boosty.to/blog/posts',
    'https://boosty.to/blog/posts/',
    'https://boosty.to/blog/purchase/123',
    'https://boosty.to/blog/posts/id/extra',
    'https://boosty.to/posts/id',
    'https://boosty.to/a..b/posts/id',
    'https://boosty.to/a%20b/posts/id',
    'https://boosty.to/blog/posts/..',
    'https://boosty.to/blog/posts/a%2Fb',
    'https://boosty.to/blog/posts/%E0%A4%A',
    'http://boosty.to/blog/posts/id',
    'https://boosty.to:8443/blog/posts/id',
    'https://api.boosty.to/blog/posts/id',
    'https://boosty.to.example.invalid/blog/posts/id',
    'https://example.invalid/blog/posts/id',
    'javascript:boosty.to/blog/posts/id',
    '',
    null,
  ])('%s → null', url => {
    expect(boostyPostRef(url)).toBeNull();
  });
});

describe('timestampRef (Story 6.3, owner decision 2026-10-29, option b; live format)', () => {
  const POST = { blogUrl: 'blog', postId: 'p1', mediaIds: ['v1', 'v2'] };
  it.each([
    ['https://boosty.to/blog/posts/p1?t=225&tmid=v2', { mediaId: 'v2', seconds: 225 }],
    ['https://boosty.to/blog/posts/p1?tmid=v1&t=0', { mediaId: 'v1', seconds: 0 }],
    ['https://www.boosty.to/Blog/posts/p1?share=x&t=61&tmid=v1#c', { mediaId: 'v1', seconds: 61 }],
  ])('%s → the video and second', (url, ref) => {
    expect(timestampRef(url, POST)).toEqual(ref);
  });

  it.each([
    'https://boosty.to/blog/posts/p1?t=225',
    'https://boosty.to/blog/posts/p1?tmid=v1',
    'https://boosty.to/blog/posts/p1?t=225&tmid=v9',
    'https://boosty.to/blog/posts/other?t=225&tmid=v1',
    'https://boosty.to/other-blog/posts/p1?t=225&tmid=v1',
    'https://boosty.to/blog/posts/p1?t=1m2s&tmid=v1',
    'https://boosty.to/blog/posts/p1?t=-1&tmid=v1',
    'https://boosty.to/blog/posts/p1?t=1.5&tmid=v1',
    'https://boosty.to/blog/posts/p1?t=&tmid=v1',
    'https://boosty.to/blog/posts/p1#t=225&tmid=v1',
    'https://boosty.to/blog/posts/p1?t=225&tmid=%E0%A4%A',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=225',
    '',
    null,
  ])('%s → null', url => {
    expect(timestampRef(url, POST)).toBeNull();
  });
});

describe('boostyStreamUrl (Story 7.2)', () => {
  it('the stream page of a valid blog, the blog encoded as one segment', () => {
    expect(boostyStreamUrl('synthetic-blog')).toBe('https://boosty.to/synthetic-blog/streams/video_stream');
  });

  it('an invalid blog is null', () => {
    expect(boostyStreamUrl('')).toBeNull();
    expect(boostyStreamUrl('a/b')).toBeNull();
    expect(boostyStreamUrl('..')).toBeNull();
  });
});
