import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e5Posts, feedPost, lockedPost } from '../../../../test/feedFixtures';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e4Page } from '../../../../test/authorFixtures';
import { firstText, kindOf, mapPost, previewOf, styledTextOf, textOf } from '../mapPost';
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
    expect(post.blocks[0]).toEqual({ type: 'text', text: 'Sample text', spans: [], paragraphEnd: false });
    expect(post.blocks[1]).toEqual({ type: 'text', text: '', spans: [], paragraphEnd: true });
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

  it('the level name is trimmed; a blank or malformed one is no level (Story 3.6)', () => {
    const withLevel = (level: unknown) => mapped({ ...e5Posts()[2], subscriptionLevel: level });
    expect(withLevel({ name: '  Базовый ' }).levelName).toBe('Базовый');
    expect(withLevel({ name: '   ' }).levelName).toBeNull();
    expect(withLevel({ name: '' }).levelName).toBeNull();
    expect(withLevel({ name: 5 }).levelName).toBeNull();
    expect(withLevel(null).levelName).toBeNull();
    expect(withLevel('junk').levelName).toBeNull();
  });
});

describe('mapPost: pinned (owner decision 2026-10-27)', () => {
  it('the live E4 pinned post is pinned; the others are not', () => {
    const posts = e4Page(2).data.map(raw => mapPost(raw, createLogger()));
    expect(posts.every(post => post !== null)).toBe(true);
    expect((posts as Post[])[0].pinned).toBe(true);
    // It is older than the next post: Boosty keeps it first, the app does not reorder.
    expect((posts as Post[])[0].publishedAt).toBeLessThan((posts as Post[])[1].publishedAt);
    expect((posts as Post[]).slice(1).every(post => !post.pinned)).toBe(true);
  });

  it('missing or a wrong type is not pinned', () => {
    expect((mapPost(feedPost(0), createLogger()) as Post).pinned).toBe(false);
    expect((mapPost(feedPost(0, { isPinned: 'yes' }), createLogger()) as Post).pinned).toBe(false);
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

  it('kindOf counts distinct non-empty video ids, as the Post screen\'s rows (Story 3.5)', () => {
    expect(kindOf(true, [video('a'), video('a')])).toEqual({ kind: 'video' });
    expect(kindOf(true, [video('a'), video(''), video('a')])).toEqual({ kind: 'video' });
    expect(kindOf(true, [video('a'), video('a'), video('b')])).toEqual({ kind: 'videos', count: 2 });
    // Every video id-less: the count of video blocks, as before.
    expect(kindOf(true, [video(''), video('')])).toEqual({ kind: 'videos', count: 2 });
    expect(kindOf(true, [video('')])).toEqual({ kind: 'video' });
  });

  it('kindOf: locked, N videos, video, audio, poll, file, text', () => {
    expect(kindOf(false, [video('a')])).toEqual({ kind: 'locked' });
    expect(kindOf(true, [video('a'), video('b'), video('c')])).toEqual({ kind: 'videos', count: 3 });
    expect(kindOf(true, [video('a')])).toEqual({ kind: 'video' });
    expect(kindOf(true, [{ type: 'audio_file', id: null, title: '', durationSec: null }])).toEqual({ kind: 'audio' });
    expect(kindOf(true, [{ type: 'poll', id: '1' }])).toEqual({ kind: 'poll' });
    // Story 6.5: a top-level poll (live), after audio and before a file.
    expect(kindOf(true, [], true)).toEqual({ kind: 'poll' });
    expect(kindOf(true, [{ type: 'file', id: null, title: '', sizeBytes: null }], true)).toEqual({ kind: 'poll' });
    expect(kindOf(true, [{ type: 'audio_file', id: null, title: '', durationSec: null }], true)).toEqual({
      kind: 'audio',
    });
    expect(kindOf(false, [], true)).toEqual({ kind: 'locked' });
    expect(kindOf(true, [{ type: 'file', id: null, title: '', sizeBytes: null }])).toEqual({ kind: 'file' });
    expect(kindOf(true, [{ type: 'text', text: 'a', spans: [], paragraphEnd: false }])).toEqual({ kind: 'text' });
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
          { blocks: [{ type: 'text', text: 'Item', spans: [], paragraphEnd: false }], items: [] },
          { blocks: [{ type: 'unknown', rawType: 'bar' }], items: [{ blocks: [], items: [] }] },
        ],
      },
    ]);
  });

  it('firstText: the first non-empty text or link', () => {
    expect(firstText([{ type: 'text', text: '  ', spans: [], paragraphEnd: true }, { type: 'link', text: ' Go ', spans: [], url: null }])).toBe('Go');
    expect(firstText([])).toBe('');
  });
});

describe('styledTextOf / smile (Story 6.1)', () => {
  const block = (raw: unknown) => mapped(feedPost(1, { data: [raw] })).blocks[0];

  it('styles (matrix «Styles»): 0 bold, 2 italic, 4 underline at their offsets', () => {
    expect(styledTextOf('["Привет мир","unstyled",[[0,0,6],[2,7,3]]]')).toEqual({
      text: 'Привет мир',
      spans: [
        { style: 'bold', from: 0, len: 6 },
        { style: 'italic', from: 7, len: 3 },
      ],
    });
    expect(styledTextOf('["abc","unstyled",[[4,1,2]]]').spans).toEqual([{ style: 'underline', from: 1, len: 2 }]);
  });

  it('unknown code (matrix «Unknown code»): no span, normal text', () => {
    expect(styledTextOf('["abc","unstyled",[[7,0,3],[1,0,3],[3,0,3]]]')).toEqual({ text: 'abc', spans: [] });
  });

  it('bad ranges (matrix «Bad ranges»): text intact; empty, negative and malformed ranges ignored', () => {
    expect(styledTextOf('["abc","unstyled",{"not":"an array"}]')).toEqual({ text: 'abc', spans: [] });
    expect(styledTextOf('["abc","unstyled","x"]')).toEqual({ text: 'abc', spans: [] });
    expect(styledTextOf('["abc","unstyled"]')).toEqual({ text: 'abc', spans: [] });
    expect(styledTextOf('["abcdef","unstyled",[[2,-2,4],[2,-5,3],[0,1,0],[0,1,-3],[0,"1",2],[0,1.5,2],null,[0,1],"s",[2,1,2]]]')).toEqual({
      text: 'abcdef',
      spans: [{ style: 'italic', from: 1, len: 2 }],
    });
  });

  it('ranges are kept as given past the fragment: live, from counts from the paragraph start (the builder clamps)', () => {
    expect(styledTextOf('["abc","unstyled",[[4,10,3],[0,1,99]]]').spans).toEqual([
      { style: 'underline', from: 10, len: 3 },
      { style: 'bold', from: 1, len: 99 },
    ]);
  });

  it('non-JSON content (matrix «Non-JSON content»): plain text, no styles', () => {
    expect(styledTextOf('plain')).toEqual({ text: 'plain', spans: [] });
    expect(styledTextOf('[not json')).toEqual({ text: '[not json', spans: [] });
    expect(styledTextOf('{"a":1}')).toEqual({ text: '{"a":1}', spans: [] });
    expect(styledTextOf('[1,2,[]]')).toEqual({ text: '', spans: [] });
    expect(styledTextOf(null)).toEqual({ text: '', spans: [] });
  });

  it('offsets are UTF-16 code units (as the reference\'s Kotlin strings)', () => {
    // «😀» is two code units: the bold range [2, 3) is «b».
    expect(styledTextOf(JSON.stringify(['😀b c', 'unstyled', [[0, 2, 1]]])).spans).toEqual([
      { style: 'bold', from: 2, len: 1 },
    ]);
  });

  it('text and link blocks carry their spans', () => {
    expect(block({ type: 'text', content: '["Hi","unstyled",[[0,0,2]]]', modificator: 'BLOCK_END' })).toEqual({
      type: 'text',
      text: 'Hi',
      spans: [{ style: 'bold', from: 0, len: 2 }],
      paragraphEnd: true,
    });
    expect(block({ type: 'link', content: '["Go","unstyled",[[4,0,2]]]', url: 'https://example.invalid/l' })).toEqual({
      type: 'link',
      text: 'Go',
      spans: [{ style: 'underline', from: 0, len: 2 }],
      url: 'https://example.invalid/l',
    });
  });

  it('smile: mediumUrl, else largeUrl, else smallUrl, else null; a malformed one is Block.Unknown', () => {
    const urls = { smallUrl: 'https://example.invalid/s', mediumUrl: 'https://example.invalid/m', largeUrl: 'https://example.invalid/l' };
    expect(block({ type: 'smile', name: 'smile', ...urls })).toEqual({ type: 'smile', name: 'smile', url: urls.mediumUrl });
    expect(block({ type: 'smile', name: 'x', smallUrl: urls.smallUrl, largeUrl: urls.largeUrl, mediumUrl: '' })).toMatchObject({ url: urls.largeUrl });
    expect(block({ type: 'smile', smallUrl: urls.smallUrl })).toEqual({ type: 'smile', name: '', url: urls.smallUrl });
    expect(block({ type: 'smile', name: 5, mediumUrl: 7 })).toEqual({ type: 'smile', name: '', url: null });
    expect(kindOf(true, [{ type: 'smile', name: '', url: null }])).toEqual({ kind: 'text' });
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

describe('mapPost: poll (Story 6.5)', () => {
  const POLL = {
    counter: 1,
    id: 4,
    isFinished: true,
    isMultiple: false,
    options: [{ id: 1, text: 'A', counter: 1, fraction: 100 }],
    title: ['Q'],
  };

  it('an accessible post with a top-level poll: `poll` mapped, kind poll when there is no video or audio', () => {
    const post = mapped(feedPost(1, { poll: POLL, data: [{ type: 'text', content: 'x' }] }));
    expect(post.poll).toEqual(expect.objectContaining({ id: '4', title: 'Q', isFinished: true }));
    expect(post.pollUnsupported).toBeNull();
    expect(post.kind).toEqual({ kind: 'poll' });
  });

  it('a malformed poll never drops the post: `poll` null, `pollUnsupported`', () => {
    const post = mapped(feedPost(1, { poll: { ...POLL, isMultiple: 'no' }, data: [{ type: 'text', content: 'x' }] }));
    expect(post.poll).toBeNull();
    expect(post.pollUnsupported).toEqual({ id: '4' });
    // One bad option is dropped on its own (owner decision, option a): the poll stays.
    const kept = mapped(
      feedPost(1, {
        poll: { ...POLL, options: [...POLL.options, { id: 2, text: 'B', counter: 0 }] },
        data: [{ type: 'text', content: 'x' }],
      }),
    );
    expect(kept.poll?.options.map(o => o.id)).toEqual(['1']);
    expect(kept.pollUnsupported).toBeNull();
    expect(post.kind).toEqual({ kind: 'poll' });
  });

  it('no poll, or `poll: null`: none', () => {
    for (const extra of [{}, { poll: null }]) {
      const post = mapped(feedPost(1, { ...extra, data: [{ type: 'text', content: 'x' }] }));
      expect(post.poll).toBeNull();
      expect(post.pollUnsupported).toBeNull();
    }
  });

  it('a post whose only content is a usable top-level poll is accessible (api-contract §7, Story 6.5)', () => {
    const post = mapped(feedPost(1, { poll: POLL, data: [] }));
    expect(post.hasAccess).toBe(true);
    expect(post.poll?.id).toBe('4');
    expect(post.kind).toEqual({ kind: 'poll' });
    // A malformed poll is no content: still locked (empty `data`), no poll.
    const broken = mapped(feedPost(1, { poll: { ...POLL, isFinished: undefined }, data: [] }));
    expect(broken.hasAccess).toBe(false);
    expect(broken.poll).toBeNull();
    expect(broken.pollUnsupported).toBeNull();
    // `hasAccess: false` wins over a poll.
    expect(mapped(feedPost(1, { poll: POLL, data: [], hasAccess: false })).hasAccess).toBe(false);
  });

  it('a malformed poll without an id: `pollUnsupported.id` null', () => {
    const post = mapped(feedPost(1, { poll: { ...POLL, id: undefined }, data: [{ type: 'text', content: 'x' }] }));
    expect(post.pollUnsupported).toEqual({ id: null });
  });

  it('a locked post keeps no poll', () => {
    const post = mapped({ ...lockedPost(), poll: POLL });
    expect(post.poll).toBeNull();
    expect(post.pollUnsupported).toBeNull();
  });
});
