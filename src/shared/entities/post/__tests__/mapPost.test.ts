import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e5Posts, feedPost, lockedPost } from '../../../../test/feedFixtures';
import { firstText, kindOf, mapPost, previewOf, textOf } from '../mapPost';
import type { Block, Post } from '../types';

const quiet = () => createLogger();

function mapped(raw: unknown): Post {
  const post = mapPost(raw, quiet());
  if (!post) {
    throw new Error('expected a post');
  }
  return post;
}

describe('mapPost: the live E5 posts', () => {
  it('maps every live post of the E5 fixture', () => {
    const posts = e5Posts().map(raw => mapPost(raw, quiet()));
    expect(posts.every(p => p !== null)).toBe(true);
    expect(posts.map(p => p?.id)).toEqual(e5Posts().map(p => p.id));
  });

  it('a single-video post: kind video, its duration and preview, no signed or progress fields', () => {
    const post = mapped(e5Posts()[1]);
    expect(post.kind).toEqual({ kind: 'video' });
    expect(post.durationSec).toBe(3960);
    expect(post.previewUrl).toBe('https://example.invalid/preview');
    expect(post.hasAccess).toBe(true);
    expect(post.author).toEqual({
      name: 'redacted',
      blogUrl: 'synthetic-blog-1',
      avatarUrl: 'https://example.invalid/avatar',
    });
    expect(post.intId).toBe(1010);
    const json = JSON.stringify(post);
    for (const field of ['timeCode', 'playerUrls', 'signedQuery', 'sig=', 'comments', 'currencyPrices']) {
      expect(json).not.toContain(field);
    }
    const video = post.blocks.find(b => b.type === 'ok_video');
    expect(video).toEqual({
      type: 'ok_video',
      id: 'synthetic-id-7',
      title: 'redacted',
      durationSec: 3960,
      previewUrl: 'https://example.invalid/preview',
    });
  });

  it('a text and image post: kind text, the image is the preview, no duration', () => {
    const post = mapped(e5Posts()[0]);
    expect(post.kind).toEqual({ kind: 'text' });
    expect(post.previewUrl).toBe('https://example.invalid/image');
    expect(post.durationSec).toBeNull();
    expect(post.blocks[0]).toEqual({ type: 'text', text: 'Sample text', paragraphEnd: false });
    expect(post.blocks[1]).toEqual({ type: 'text', text: '', paragraphEnd: true });
  });

  it('publishedAt is publishTime, else createdAt', () => {
    expect(mapped(feedPost(0, { publishTime: 1_700_003_600 })).publishedAt).toBe(1_700_003_600);
    const noPublish = feedPost(0);
    delete noPublish.publishTime;
    expect(mapped({ ...noPublish, createdAt: 1_700_007_200 }).publishedAt).toBe(1_700_007_200);
  });

  it('the level name only when the post carries one; never a price', () => {
    expect(mapped(e5Posts()[2]).levelName).toBe('redacted');
    expect(mapped(e5Posts()[0]).levelName).toBeNull();
  });
});

describe('mapPost: defensive parsing (matrix «Malformed post»)', () => {
  it.each([
    ['id', (p: Record<string, unknown>) => delete p.id],
    ['createdAt', (p: Record<string, unknown>) => delete p.createdAt],
    ['int_id', (p: Record<string, unknown>) => delete p.int_id],
    ['user.name', (p: Record<string, unknown>) => delete (p.user as Record<string, unknown>).name],
    ['user.blogUrl', (p: Record<string, unknown>) => delete (p.user as Record<string, unknown>).blogUrl],
  ])('drops a post without %s and logs only its id and the field names', (field, strip) => {
    const raw = feedPost(3);
    strip(raw);
    const logger = createLogger();
    expect(mapPost(raw, logger)).toBeNull();
    const entries = logger.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'warn', scope: 'post', message: 'dropped' });
    expect(entries[0].fields?.fields).toContain(field);
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain('Post 3');
    expect(logged).not.toContain('example.invalid');
    expect(logged).not.toContain('redacted"');
  });

  it('non-objects are dropped, never thrown', () => {
    for (const raw of [null, undefined, 42, 'post', []]) {
      expect(mapPost(raw, quiet())).toBeNull();
    }
  });

  it('wrong optional types fall back instead of dropping the post', () => {
    const post = mapped(
      feedPost(1, { title: 42, hasAccess: 'yes', publishTime: 'x', teaser: 'nope', subscriptionLevel: 7 }),
    );
    expect(post.title).toBe('');
    expect(post.hasAccess).toBe(true);
    expect(post.publishedAt).toBe(1_700_000_000 - 3600);
    expect(post.teaser).toEqual([]);
    expect(post.levelName).toBeNull();
  });

  it('an unknown block type becomes Block.Unknown and the post still maps', () => {
    const raw = feedPost(2);
    (raw.data as unknown[]).push({ type: 'foo', anything: 1 }, { notAType: true }, 'junk');
    const post = mapped(raw);
    expect(post.blocks.slice(-3)).toEqual([
      { type: 'unknown', rawType: 'foo' },
      { type: 'unknown', rawType: '' },
      { type: 'unknown', rawType: '' },
    ]);
    expect(post.kind).toEqual({ kind: 'video' });
  });

  it('a malformed known block (ok_video without id) becomes Unknown', () => {
    const post = mapped(feedPost(4, { data: [{ type: 'ok_video', title: 'x' }] }));
    expect(post.blocks).toEqual([{ type: 'unknown', rawType: 'ok_video' }]);
    expect(post.kind).toEqual({ kind: 'text' });
  });
});

describe('mapPost: entitlement (matrix «Locked post»)', () => {
  it('hasAccess=false: locked, no blocks, the teaser image is the preview', () => {
    const post = mapped(lockedPost());
    expect(post.hasAccess).toBe(false);
    expect(post.kind).toEqual({ kind: 'locked' });
    expect(post.blocks).toEqual([]);
    expect(post.previewUrl).toBe('https://example.invalid/image');
    expect(post.durationSec).toBeNull();
  });

  it('empty data is locked even with hasAccess=true', () => {
    expect(mapped(feedPost(5, { data: [], hasAccess: true })).kind).toEqual({ kind: 'locked' });
  });

  it('a missing hasAccess with content is accessible', () => {
    const raw = feedPost(6);
    delete raw.hasAccess;
    expect(mapped(raw).hasAccess).toBe(true);
  });
});

describe('blocks and kinds', () => {
  const video = (id: string): Block => ({
    type: 'ok_video',
    id,
    title: '',
    durationSec: 60,
    previewUrl: null,
  });

  it('kindOf: locked, N videos, video, audio, poll, file, text', () => {
    expect(kindOf(false, [video('a')])).toEqual({ kind: 'locked' });
    expect(kindOf(true, [video('a'), video('b'), video('c')])).toEqual({ kind: 'videos', count: 3 });
    expect(kindOf(true, [video('a')])).toEqual({ kind: 'video' });
    expect(kindOf(true, [{ type: 'audio_file', id: null, title: '', durationSec: null }])).toEqual({ kind: 'audio' });
    expect(kindOf(true, [{ type: 'poll', id: '1' }])).toEqual({ kind: 'poll' });
    expect(kindOf(true, [{ type: 'file', id: null, title: '', sizeBytes: null }])).toEqual({ kind: 'file' });
    expect(kindOf(true, [{ type: 'text', text: 'a', paragraphEnd: false }])).toEqual({ kind: 'text' });
  });

  it('several videos: kind videos with the count and no single duration', () => {
    const raw = feedPost(7);
    const first = (raw.data as Record<string, unknown>[])[0];
    raw.data = [first, { ...first, id: 'synthetic-id-99' }];
    const post = mapped(raw);
    expect(post.kind).toEqual({ kind: 'videos', count: 2 });
    expect(post.durationSec).toBeNull();
  });

  it('previewOf: first video preview → first image → teaser image → none', () => {
    const image: Block = { type: 'image', id: null, url: 'img', width: null, height: null };
    const teaser: Block = { type: 'image', id: null, url: 'teaser', width: null, height: null };
    const withPreview: Block = { ...video('v'), previewUrl: 'prev' } as Block;
    expect(previewOf([image, withPreview], [teaser])).toBe('prev');
    expect(previewOf([video('v'), image], [teaser])).toBe('img');
    expect(previewOf([], [teaser])).toBe('teaser');
    expect(previewOf([], [])).toBeNull();
  });

  it('textOf: the JSON content format, raw text and empty values', () => {
    expect(textOf('["Hello","unstyled",[[0,0,5]]]')).toBe('Hello');
    expect(textOf('plain text')).toBe('plain text');
    expect(textOf('[not json')).toBe('[not json');
    expect(textOf('[1,2]')).toBe('');
    expect(textOf('')).toBe('');
    expect(textOf(null)).toBe('');
  });

  it('a list block keeps its nested text blocks', () => {
    const post = mapped(
      feedPost(8, {
        data: [
          {
            type: 'list',
            items: [
              { data: [{ type: 'text', content: '["Item","unstyled",[]]', modificator: '' }], items: [] },
              { data: [{ type: 'bar' }], items: [{ data: [], items: [] }] },
            ],
          },
        ],
      }),
    );
    expect(post.blocks).toEqual([
      {
        type: 'list',
        items: [
          { blocks: [{ type: 'text', text: 'Item', paragraphEnd: false }], items: [] },
          { blocks: [{ type: 'unknown', rawType: 'bar' }], items: [{ blocks: [], items: [] }] },
        ],
      },
    ]);
  });

  it('firstText: the first non-empty text or link', () => {
    expect(firstText([{ type: 'text', text: '  ', paragraphEnd: true }, { type: 'link', text: ' Go ', url: null }])).toBe('Go');
    expect(firstText([])).toBe('');
  });
});

describe('mapPost: like count (Story 3.4)', () => {
  it('reads count.likes only; missing or invalid → null', () => {
    expect(mapped({ ...feedPost(1), count: { likes: 5, comments: 9, reactions: { like: 5 } } }).likeCount).toBe(5);
    expect(mapped({ ...feedPost(1), count: { likes: 0 } }).likeCount).toBe(0);
    expect(mapped({ ...feedPost(1), count: undefined }).likeCount).toBeNull();
    expect(mapped({ ...feedPost(1), count: { likes: -1 } }).likeCount).toBeNull();
    expect(mapped({ ...feedPost(1), count: { likes: 1.5 } }).likeCount).toBeNull();
    expect(mapped({ ...feedPost(1), count: 'x' }).likeCount).toBeNull();
    expect(lockedPost()).toBeDefined();
  });

  it('a post whose user.blogUrl is not route-safe is dropped', () => {
    expect(mapPost({ ...feedPost(1), user: { name: 'n', blogUrl: 'a/b' } }, quiet())).toBeNull();
    expect(mapPost({ ...feedPost(1), user: { name: 'n', blogUrl: '..' } }, quiet())).toBeNull();
  });
});
