import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { blockEnd, e8Accessible, e8Locked, paragraph, postDetail, text } from '../../../../test/postFixtures';
import { spacing, typography } from '../../../ui/tokens';
import { mapPost } from '../mapPost';
import {
  PARAGRAPH_STOP_MAX_CHARS,
  blockKey,
  listItemTexts,
  postBodyItems,
  splitParagraph,
} from '../postBody';
import type { Block, Post } from '../types';

const mapped = (raw: unknown) => mapPost(raw, createLogger()) as Post;
/** As the Post body of an accessible post: videos with an id are MediaRows. */
const body = (data: unknown[]) =>
  postBodyItems(mapped(postDetail('b', 'p', data as never)).blocks, { videoRows: true });

describe('postBodyItems (Story 3.4)', () => {
  it('merges text fragments until BLOCK_END into one paragraph; blank paragraphs are dropped', () => {
    expect(body([text('Hello, '), text('world'), blockEnd(), blockEnd(), ...paragraph('Second')])).toEqual([
      { kind: 'paragraph', key: 'text@0', text: 'Hello, world' },
      { kind: 'paragraph', key: 'text@4', text: 'Second' },
    ]);
  });

  it('mixed blocks: one placeholder each, in order, text between them; a standalone link is a paragraph', () => {
    const items = body([
      { type: 'ok_video', id: 'v1', title: 'x' },
      ...paragraph('A'),
      { type: 'image', id: 'i1' },
      { type: 'link', content: '["L","unstyled",[]]' },
      { type: 'file', id: 'f1' },
      { type: 'audio_file', id: 'a1' },
      { type: 'poll', id: 7 },
      { type: 'something_new' },
      ...paragraph('B'),
    ]);
    // The video is a MediaRow (Story 3.5): not in the body.
    expect(items).toEqual([
      { kind: 'paragraph', key: 'text@1', text: 'A' },
      { kind: 'placeholder', key: 'image:i1', block: 'image' },
      { kind: 'paragraph', key: 'link@4', text: 'L' },
      { kind: 'placeholder', key: 'file:f1', block: 'file' },
      { kind: 'placeholder', key: 'audio_file:a1', block: 'audio' },
      { kind: 'placeholder', key: 'poll:7', block: 'poll' },
      { kind: 'placeholder', key: 'something_new@8', block: 'unknown' },
      { kind: 'paragraph', key: 'text@9', text: 'B' },
    ]);
  });

  it('an inline link joins its paragraph as plain text (owner decision: «Inline link»)', () => {
    const link = (s: string) => ({ type: 'link', content: JSON.stringify([s, 'unstyled', []]), url: 'https://example.invalid/link' });
    expect(body([text('Смотрите '), link('здесь'), text(' и дальше'), blockEnd()])).toEqual([
      { kind: 'paragraph', key: 'text@0', text: 'Смотрите здесь и дальше' },
    ]);
  });

  it('a link-only paragraph is a paragraph keyed by the link', () => {
    const link = { type: 'link', content: '["Только ссылка","unstyled",[]]' };
    expect(body([...paragraph('A'), link, blockEnd()])).toEqual([
      { kind: 'paragraph', key: 'text@0', text: 'A' },
      { kind: 'paragraph', key: 'link@2', text: 'Только ссылка' },
    ]);
  });

  it('a link without text is skipped (no placeholder, the paragraph goes on)', () => {
    expect(body([text('A'), { type: 'link', content: '' }, { type: 'link' }, text('B'), blockEnd()])).toEqual([
      { kind: 'paragraph', key: 'text@0', text: 'AB' },
    ]);
    expect(body([{ type: 'link', content: '["","unstyled",[]]' }, blockEnd()])).toEqual([]);
  });

  it('link fragments in list items merge into the item text', () => {
    const list = {
      type: 'list',
      items: [{ data: [text('См. '), { type: 'link', content: '["тут","unstyled",[]]' }], items: [] }],
    };
    expect(body([list])).toEqual([{ kind: 'paragraph', key: 'list@0', text: 'См. тут' }]);
  });

  it('malformed blocks: a placeholder or plain text, never a throw', () => {
    const items = body([
      { content: 'no type' },
      { type: 'text', content: 42 },
      { type: 'image', id: 5 },
      { type: 'ok_video' },
      null,
      'string',
      { type: 'text', content: 'raw text, not JSON', modificator: 'BLOCK_END' },
    ]);
    // The number content is no text: a blank paragraph, dropped.
    expect(items.map(i => i.kind)).toEqual([
      'placeholder',
      'placeholder',
      'placeholder',
      'placeholder',
      'placeholder',
      'paragraph',
    ]);
    expect(items[1]).toMatchObject({ key: 'image@2', block: 'image' });
    expect(items[items.length - 1]).toMatchObject({ text: 'raw text, not JSON' });
  });

  it('a list is one stop per item (nested items after their parent); a list without text is a placeholder', () => {
    const list = {
      type: 'list',
      items: [
        { data: [text('One')], items: [{ data: [text('One.a')], items: [] }] },
        { data: [text('Two')], items: [] },
      ],
    };
    expect(body([list, { type: 'list', items: [] }])).toEqual([
      { kind: 'paragraph', key: 'list@0', text: 'One' },
      { kind: 'paragraph', key: 'list@0#1', text: 'One.a' },
      { kind: 'paragraph', key: 'list@0#2', text: 'Two' },
      { kind: 'placeholder', key: 'list@1', block: 'unknown' },
    ]);
  });

  it('keys are unique: a repeated block id falls back to the index', () => {
    const items = body([{ type: 'image', id: 'same' }, { type: 'image', id: 'same' }]);
    expect(items.map(i => i.key)).toEqual(['image:same', 'image@1']);
  });

  it('the live accessible E8: its video is a MediaRow, the body is paragraphs only (inline links merged)', () => {
    const items = postBodyItems(mapped(e8Accessible()).blocks, { videoRows: true });
    expect(items.filter(i => i.kind === 'paragraph').length).toBeGreaterThan(10);
    expect(items.filter(i => i.kind === 'placeholder')).toHaveLength(0);
    expect(items.every(i => i.kind === 'paragraph' && /^(Sample text)+$/.test(i.text))).toBe(true);
    expect(new Set(items.map(i => i.key)).size).toBe(items.length);
    // Without rows (the default, e.g. a teaser) the video stays the Story 3.4 placeholder.
    expect(postBodyItems(mapped(e8Accessible()).blocks)[0]).toEqual({
      kind: 'placeholder',
      key: 'ok_video:synthetic-id-7',
      block: 'video',
    });
  });

  it('the live locked E8: no blocks; the teaser is one image placeholder', () => {
    const post = mapped(e8Locked());
    expect(post.hasAccess).toBe(false);
    expect(postBodyItems(post.blocks)).toEqual([]);
    expect(postBodyItems(post.teaser)).toEqual([
      { kind: 'placeholder', key: 'image:synthetic-id-107', block: 'image' },
    ]);
  });
});

describe('postBodyItems: teaser images (Story 3.6)', () => {
  const teaser = (blocks: unknown[]) =>
    postBodyItems(mapped({ ...e8Locked(), teaser: blocks }).teaser, { images: true });

  it('the live locked teaser: one image item with its URL and size', () => {
    expect(postBodyItems(mapped(e8Locked()).teaser, { images: true })).toEqual([
      {
        kind: 'image',
        key: 'image:synthetic-id-107',
        url: 'https://example.invalid/image',
        width: 1111,
        height: 625,
      },
    ]);
  });

  it('no URL → placeholder; a missing or non-positive size is null; text and videos as without the option', () => {
    expect(
      teaser([
        { type: 'image', id: 'a' },
        { type: 'image', id: 'b', url: 'https://example.invalid/b', width: 0, height: -1 },
        { type: 'image', url: 'https://example.invalid/c' },
        ...paragraph('T'),
        { type: 'ok_video', id: 'v' },
      ]),
    ).toEqual([
      { kind: 'placeholder', key: 'image:a', block: 'image' },
      { kind: 'image', key: 'image:b', url: 'https://example.invalid/b', width: null, height: null },
      { kind: 'image', key: 'image@2', url: 'https://example.invalid/c', width: null, height: null },
      { kind: 'paragraph', key: 'text@3', text: 'T' },
      { kind: 'placeholder', key: 'ok_video:v', block: 'video' },
    ]);
  });

  it('off by default: images stay placeholders (accessible posts, Story 6.2)', () => {
    expect(body([{ type: 'image', id: 'i', url: 'https://example.invalid/i' }])).toEqual([
      { kind: 'placeholder', key: 'image:i', block: 'image' },
    ]);
  });
});

describe('postBodyItems: videos (Story 3.5)', () => {
  it('videos with an id leave the body (also duplicates); the text keeps its paragraphs and keys', () => {
    expect(
      body([
        text('Before'),
        { type: 'ok_video', id: 'v1', title: 'x' },
        text('After'),
        blockEnd(),
        { type: 'ok_video', id: 'v1', title: 'dup' },
        ...paragraph('Tail'),
      ]),
    ).toEqual([
      { kind: 'paragraph', key: 'text@0', text: 'Before' },
      { kind: 'paragraph', key: 'text@2', text: 'After' },
      { kind: 'paragraph', key: 'text@5', text: 'Tail' },
    ]);
  });

  it('paragraph keys around a removed video match the keys without rows', () => {
    const data = [
      ...paragraph('Intro'),
      text('Before'),
      { type: 'ok_video', id: 'v1', title: 'x' },
      text('After'),
      blockEnd(),
      { type: 'ok_video', id: 'v2' },
      ...paragraph('Tail'),
    ];
    const blocks = mapped(postDetail('b', 'p', data as never)).blocks;
    const withRows = postBodyItems(blocks, { videoRows: true });
    const without = postBodyItems(blocks).filter(i => i.kind === 'paragraph');
    expect(withRows.every(i => i.kind === 'paragraph')).toBe(true);
    expect(withRows).toEqual(without);
    expect(withRows.map(i => i.key)).toEqual(['text@0', 'text@2', 'text@4', 'text@7']);
  });

  it('the default (no rows, e.g. a teaser) keeps every video as a placeholder', () => {
    const blocks = mapped(postDetail('b', 'p', [{ type: 'ok_video', id: 'v1' }, ...paragraph('A')] as never)).blocks;
    expect(postBodyItems(blocks)).toEqual([
      { kind: 'placeholder', key: 'ok_video:v1', block: 'video' },
      { kind: 'paragraph', key: 'text@1', text: 'A' },
    ]);
  });

  it('a video without an id (no MediaRef) stays a neutral video placeholder', () => {
    expect(body([{ type: 'ok_video', title: 'No id' }, { type: 'ok_video', id: '' }, ...paragraph('A')])).toEqual([
      { kind: 'placeholder', key: 'ok_video@0', block: 'video' },
      { kind: 'placeholder', key: 'ok_video@1', block: 'video' },
      { kind: 'paragraph', key: 'text@2', text: 'A' },
    ]);
  });
});

describe('blockKey / listItemTexts', () => {
  it('`<type>:<id>`, else `<type>@<index>`', () => {
    const video: Block = { type: 'ok_video', id: 'v', title: '', durationSec: null, previewUrl: null };
    expect(blockKey(video, 3)).toBe('ok_video:v');
    expect(blockKey({ type: 'text', text: 'x', paragraphEnd: false }, 3)).toBe('text@3');
    expect(blockKey({ type: 'unknown', rawType: '' }, 2)).toBe('unknown@2');
  });

  it('listItemTexts of an empty list is empty', () => {
    expect(listItemTexts([])).toEqual([]);
  });
});

describe('long paragraphs (one stop must stay well under the column)', () => {
  it('the budget fits the single-column text measure: ≈ 8 lines, well under half the viewport', () => {
    // 600 dp measure − 18 dp paragraph padding and bar; ≈ 7.7 dp per Cyrillic character.
    const perLine = Math.floor((spacing['text-measure'] - 18) / 7.7);
    expect(perLine).toBeGreaterThanOrEqual(70);
    expect(perLine).toBeLessThanOrEqual(80);
    const lines = Math.ceil(PARAGRAPH_STOP_MAX_CHARS / perLine);
    const height = lines * typography.body.lineHeight + 2 * spacing['3'];
    // The column's viewport: 540 − 2 × safe-y − focus headroom.
    const viewport = 540 - 2 * spacing['safe-y'] - spacing['focus-headroom'];
    expect(height).toBeLessThan(viewport / 2);
    expect(PARAGRAPH_STOP_MAX_CHARS).toBe(600);
  });

  const words = (value: string) => value.split(/\s+/).filter(Boolean);
  const sentence = (n: number) => `Предложение номер ${n} с несколькими словами для длины.`;

  it('a long paragraph → several stops, each within the budget, order and text preserved', () => {
    const long = Array.from({ length: 45 }, (_, i) => sentence(i)).join(' ');
    expect(long.length).toBeGreaterThan(3 * PARAGRAPH_STOP_MAX_CHARS);
    const items = body([text(long), blockEnd()]);
    expect(items.length).toBeGreaterThan(3);
    expect(items.map(i => i.key)).toEqual(items.map((_, n) => (n === 0 ? 'text@0' : `text@0#${n}`)));
    const texts = items.map(i => (i.kind === 'paragraph' ? i.text : ''));
    for (const part of texts) {
      expect(part.length).toBeLessThanOrEqual(PARAGRAPH_STOP_MAX_CHARS);
      // Cut at sentence ends: every part ends a sentence.
      expect(part.endsWith('.')).toBe(true);
    }
    expect(words(texts.join(' '))).toEqual(words(long));
  });

  it('prefers line breaks; never cuts mid-word; a word longer than the budget stays whole', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Строка ${i} ${'слово '.repeat(8).trim()}`).join('\n');
    const parts = splitParagraph(lines, 120);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.startsWith('Строка')).toBe(true);
    }
    expect(words(parts.join(' '))).toEqual(words(lines));
    const noSentences = 'слово '.repeat(100).trim();
    const byWords = splitParagraph(noSentences, 50);
    expect(byWords.every(p => p.length <= 50 && /^слово( слово)*$/.test(p))).toBe(true);
    const giant = `${'x'.repeat(80)} tail`;
    expect(splitParagraph(giant, 50)).toEqual(['x'.repeat(80), 'tail']);
  });

  it('a short paragraph stays one stop; a long list item is split too', () => {
    expect(splitParagraph('Короткий абзац.')).toEqual(['Короткий абзац.']);
    const item = Array.from({ length: 20 }, (_, i) => sentence(i)).join(' ');
    const items = body([{ type: 'list', items: [{ data: [text(item)], items: [] }, { data: [text('B')], items: [] }] }]);
    expect(items.length).toBeGreaterThan(2);
    expect(items[items.length - 1]).toEqual({ kind: 'paragraph', key: `list@0#${items.length - 1}`, text: 'B' });
  });
});
