import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { blockEnd, e8Accessible, e8Locked, paragraph, postDetail, text } from '../../../../test/postFixtures';
import { spacing, typography } from '../../../ui/tokens';
import { mapPost } from '../mapPost';
import {
  PARAGRAPH_STOP_MAX_CHARS,
  blockKey,
  isFocusStop,
  postBodyItems,
  splitParagraph,
} from '../postBody';
import type { PostBodyItem } from '../postBody';
import type { Block, Post } from '../types';

const mapped = (raw: unknown) => mapPost(raw, createLogger()) as Post;
/** As the Post body of an accessible post: videos with an id are MediaRows. */
const bodyItems = (data: unknown[]) =>
  postBodyItems(mapped(postDetail('b', 'p', data as never)).blocks, { videoRows: true });
/** Paragraphs as `{kind, key, text}` (the Story 3.4 shape; segments are checked in the Story 6.1 tests). */
const plain = (items: readonly PostBodyItem[]) =>
  items.map(i => (i.kind === 'paragraph' ? { kind: i.kind, key: i.key, text: i.text } : i));
const body = (data: unknown[]) => plain(bodyItems(data));
/**
 * The live accessible E8's blocks without the synthetic blocks Stories
 * 6.3–6.4 appended (`header`, `file`, `video`, `audio_file`; tested in
 * «Story 6.3» below).
 */
const liveBlocks = () => mapped(e8Accessible()).blocks.slice(0, -4);

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
    const items = postBodyItems(liveBlocks(), { videoRows: true });
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
    plain(postBodyItems(mapped({ ...e8Locked(), teaser: blocks }).teaser, { images: true }));

  it('the live locked teaser: one image item with its URL and size', () => {
    expect(postBodyItems(mapped(e8Locked()).teaser, { images: true })).toEqual([
      {
        kind: 'image',
        key: 'image:synthetic-id-107',
        url: 'https://example.invalid/image',
        width: 1111,
        height: 625,
        stop: false,
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
      { kind: 'image', key: 'image:b', url: 'https://example.invalid/b', width: null, height: null, stop: false },
      { kind: 'image', key: 'image@2', url: 'https://example.invalid/c', width: null, height: null, stop: false },
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
    expect(plain(postBodyItems(blocks))).toEqual([
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

describe('blockKey', () => {
  it('`<type>:<id>`, else `<type>@<index>`', () => {
    const video: Block = { type: 'ok_video', id: 'v', title: '', durationSec: null, previewUrl: null };
    expect(blockKey(video, 3)).toBe('ok_video:v');
    expect(blockKey({ type: 'text', text: 'x', spans: [], paragraphEnd: false }, 3)).toBe('text@3');
    expect(blockKey({ type: 'unknown', rawType: '' }, 2)).toBe('unknown@2');
  });

  it('an empty list and a list of blank items are one placeholder (no stops)', () => {
    expect(body([{ type: 'list', items: [] }, { type: 'list', items: [{ data: [text('  ')], items: [] }] }])).toEqual([
      { kind: 'placeholder', key: 'list@0', block: 'unknown' },
      { kind: 'placeholder', key: 'list@1', block: 'unknown' },
    ]);
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

describe('postBodyItems: styled segments and emoji (Story 6.1)', () => {
  const styled = (s: string, ranges: number[][], modificator = '') => ({
    type: 'text',
    content: JSON.stringify([s, 'unstyled', ranges]),
    modificator,
  });
  const link = (s: string, ranges: number[][]) => ({
    type: 'link',
    content: JSON.stringify([s, 'unstyled', ranges]),
    url: 'https://example.invalid/link',
  });
  const smile = (url: string | null = 'https://example.invalid/emoji') => ({
    type: 'smile',
    name: 'smile',
    ...(url === null ? {} : { mediumUrl: url }),
  });
  const run = (value: string, style: Partial<Record<'bold' | 'italic' | 'underline', boolean>> = {}) => ({
    kind: 'text',
    text: value,
    bold: false,
    italic: false,
    underline: false,
    ...style,
  });
  const paragraphs = (data: unknown[]) =>
    bodyItems(data).filter((i): i is PostBodyItem & { kind: 'paragraph' } => i.kind === 'paragraph');

  it('styles (matrix «Styles»): «Привет» bold, «мир» italic', () => {
    expect(bodyItems([styled('Привет мир', [[0, 0, 6], [2, 7, 3]], 'BLOCK_END')])).toEqual([
      {
        kind: 'paragraph',
        key: 'text@0',
        text: 'Привет мир',
        links: [],
        segments: [run('Привет', { bold: true }), run(' '), run('мир', { italic: true })],
      },
    ]);
  });

  it('overlapping ranges combine; an unknown code is normal text (matrix «Unknown code»)', () => {
    expect(paragraphs([styled('abcdef', [[0, 0, 4], [4, 2, 4]], 'BLOCK_END')])[0].segments).toEqual([
      run('ab', { bold: true }),
      run('cd', { bold: true, underline: true }),
      run('ef', { underline: true }),
    ]);
    expect(paragraphs([styled('abc', [[7, 0, 3]], 'BLOCK_END')])[0].segments).toEqual([run('abc')]);
  });

  it('bad ranges and non-JSON content (matrix «Bad ranges», «Non-JSON content»): the text intact', () => {
    // Past the paragraph's (and the fragment's) end: clamped.
    expect(paragraphs([styled('abc', [[0, 1, 99]], 'BLOCK_END')])[0].segments).toEqual([
      run('a'),
      run('bc', { bold: true }),
    ]);
    const items = paragraphs([
      { type: 'text', content: '["abc","unstyled",{"bad":1}]', modificator: 'BLOCK_END' },
      { type: 'text', content: 'plain', modificator: 'BLOCK_END' },
    ]);
    expect(items.map(i => i.segments)).toEqual([[run('abc')], [run('plain')]]);
  });

  it('merge (matrix «Merge»): text and link fragments until BLOCK_END; ranges count from the paragraph start (live)', () => {
    // «Смотрите » 0–9, «здесь» 9–14, « и дальше» 14–23.
    expect(
      bodyItems([
        styled('Смотрите ', [[0, 0, 8]]),
        link('здесь', [[4, 9, 5]]),
        styled(' и дальше', [[2, 17, 6]]),
        blockEnd(),
      ]),
    ).toEqual([
      {
        kind: 'paragraph',
        key: 'text@0',
        text: 'Смотрите здесь и дальше',
        links: [],
        segments: [
          run('Смотрите', { bold: true }),
          run(' '),
          run('здесь', { underline: true }),
          run(' и '),
          run('дальше', { italic: true }),
        ],
      },
    ]);
  });

  it('a range is clamped to its own fragment: it never styles another fragment, a fragment-relative one past it is dropped', () => {
    expect(
      paragraphs([
        styled('abc', [[0, 1, 10]]),
        // Offsets 3–6: [0, 0, 2] lies in «abc» (another fragment) → dropped; [4, 4, 2] → «ef».
        styled('def', [[0, 0, 2], [4, 4, 2]]),
        blockEnd(),
      ])[0].segments,
    ).toEqual([run('a'), run('bc', { bold: true }), run('d'), run('ef', { underline: true })]);
  });

  it('offsets restart at each paragraph, list item and non-inline block; a smile counts as one', () => {
    const items = paragraphs([
      styled('ab', [[0, 0, 1]]),
      blockEnd(),
      styled('cd', [[0, 1, 1]]),
      { type: 'image', id: 'i' },
      styled('ef', [[0, 0, 1]]),
      smile(),
      styled('gh', [[0, 3, 1]]),
      smile(null),
      styled('ij', [[0, 6, 1]]),
      blockEnd(),
    ]);
    expect(items.map(i => i.segments)).toEqual([
      [run('a', { bold: true }), run('b')],
      [run('c'), run('d', { bold: true })],
      [
        run('e', { bold: true }),
        run('f'),
        { kind: 'emoji', key: 'smile@5', url: 'https://example.invalid/emoji' },
        run('g', { bold: true }),
        run('h'),
        // The image-less smile still counts: «ij» starts at 6.
        run('i', { bold: true }),
        run('j'),
      ],
    ]);
  });

  it('emoji (matrix «Emoji»): text, smile, text, BLOCK_END → one paragraph with the emoji inline', () => {
    expect(bodyItems([text('Привет '), smile(), text(' мир'), blockEnd()])).toEqual([
      {
        kind: 'paragraph',
        key: 'text@0',
        text: 'Привет  мир',
        links: [],
        segments: [
          run('Привет '),
          { kind: 'emoji', key: 'smile@1', url: 'https://example.invalid/emoji' },
          run(' мир'),
        ],
      },
    ]);
  });

  it('a smile without an image takes no space; a smile can start a paragraph (keyed by it)', () => {
    expect(bodyItems([text('A'), smile(null), text('B'), blockEnd()])).toEqual([
      { kind: 'paragraph', key: 'text@0', text: 'AB', segments: [run('AB')], links: [] },
    ]);
    expect(bodyItems([smile(null), blockEnd()])).toEqual([]);
    expect(bodyItems([smile(), blockEnd(), ...paragraph('Next')])).toEqual([
      {
        kind: 'paragraph',
        key: 'smile@0',
        text: '',
        links: [],
        segments: [{ kind: 'emoji', key: 'smile@0', url: 'https://example.invalid/emoji' }],
      },
      { kind: 'paragraph', key: 'text@2', text: 'Next', segments: [run('Next')], links: [] },
    ]);
  });

  it('an emoji-only paragraph (or part) has no plain text and is no focus stop', () => {
    const items = bodyItems([smile(), blockEnd(), ...paragraph('Next')]);
    expect(items.map(isFocusStop)).toEqual([false, true]);
    expect(isFocusStop({ kind: 'placeholder', key: 'x', block: 'unknown' })).toBe(false);
  });

  it('a smile with malformed fields is no emoji and never a placeholder', () => {
    expect(body([text('A'), { type: 'smile', name: 5, mediumUrl: 7 }, text('B'), blockEnd()])).toEqual([
      { kind: 'paragraph', key: 'text@0', text: 'AB' },
    ]);
    expect(body([{ type: 'smile' }, ...paragraph('B')])).toEqual([{ kind: 'paragraph', key: 'text@1', text: 'B' }]);
  });

  it('long styled (matrix «Long styled»): 1500 chars, a bold run across the 600 cut → 3 stops, the run continues', () => {
    const sentence = 'Это предложение ровно для проверки длины абзаца. ';
    const long = sentence.repeat(Math.ceil(1500 / sentence.length)).slice(0, 1500).trim();
    // A bold run from 500 to 760 crosses the first cut (≤ 600).
    const items = paragraphs([styled(long, [[0, 500, 260]], 'BLOCK_END')]);
    expect(items).toHaveLength(3);
    expect(items.map(i => i.key)).toEqual(['text@0', 'text@0#1', 'text@0#2']);
    const first = items[0].segments;
    const second = items[1].segments;
    expect(first[first.length - 1]).toMatchObject({ kind: 'text', bold: true });
    expect(second[0]).toMatchObject({ kind: 'text', bold: true });
    expect(items[2].segments.every(s => s.kind === 'text' && !s.bold)).toBe(true);
    // The bold characters are exactly the range, up to the whitespace at the cut.
    const boldText = items
      .flatMap(i => i.segments)
      .map(s => (s.kind === 'text' && s.bold ? s.text : ''))
      .join('');
    expect(boldText.replace(/\s+/g, '')).toBe(long.slice(500, 760).replace(/\s+/g, ''));
    for (const item of items) {
      expect(item.text.length).toBeLessThanOrEqual(PARAGRAPH_STOP_MAX_CHARS);
      expect(item.text).toBe(item.segments.map(s => (s.kind === 'text' ? s.text : '')).join(''));
    }
    expect(items.map(i => i.text)).toEqual(splitParagraph(long));
  });

  it('an emoji counts as one character in the split budget and is never lost at a cut', () => {
    const word = 'слово ';
    // 570 chars, 10 emoji, 25 chars: 604 after the trim, past the 600 budget only with the emoji counted.
    const data = [text(word.repeat(95)), ...Array.from({ length: 10 }, () => smile()), text(` ${word.repeat(4)}`), blockEnd()];
    const items = paragraphs(data);
    expect(items.length).toBe(2);
    const emoji = items.flatMap(i => i.segments).filter(s => s.kind === 'emoji');
    expect(emoji).toHaveLength(10);
    expect(new Set(emoji.map(e => (e.kind === 'emoji' ? e.key : ''))).size).toBe(10);
    const budget = (i: (typeof items)[number]) =>
      i.segments.reduce((n, s) => n + (s.kind === 'text' ? s.text.length : 1), 0);
    expect(items.every(i => budget(i) <= PARAGRAPH_STOP_MAX_CHARS)).toBe(true);
    // Without the emoji the same text fits in one stop.
    expect(paragraphs([text(word.repeat(95)), text(` ${word.repeat(4)}`), blockEnd()]).length).toBe(1);
  });

  it('list items keep their styles and emoji', () => {
    const list = {
      type: 'list',
      items: [{ data: [styled('Пункт', [[0, 0, 5]]), smile()], items: [] }],
    };
    expect(bodyItems([list])).toEqual([
      {
        kind: 'paragraph',
        key: 'list@0',
        text: 'Пункт',
        links: [],
        segments: [run('Пункт', { bold: true }), { kind: 'emoji', key: 'smile@1', url: 'https://example.invalid/emoji' }],
      },
    ]);
  });

  it('the live accessible E8 (sanitized ranges, a synthetic smile): styles and the emoji, keys unchanged', () => {
    const items = postBodyItems(liveBlocks(), { videoRows: true });
    const paras = items.filter((i): i is PostBodyItem & { kind: 'paragraph' } => i.kind === 'paragraph');
    expect(paras.length).toBe(items.length);
    expect(paras[0]).toMatchObject({ key: 'text@1', text: 'Sample text' });
    expect(paras[0].segments).toEqual([run('Sample', { bold: true }), run(' text')]);
    expect(paras[1].key).toBe('text@3');
    expect(paras[1].segments).toEqual([
      run('Sample', { underline: true }),
      run(' '),
      run('text', { italic: true }),
    ]);
    const withEmoji = paras.filter(p => p.segments.some(s => s.kind === 'emoji'));
    expect(withEmoji).toHaveLength(1);
    expect(withEmoji[0].segments[withEmoji[0].segments.length - 1]).toEqual({
      kind: 'emoji',
      key: 'smile@110',
      url: 'https://example.invalid/emoji',
    });
  });
});

describe('postBodyItems: images of an accessible post (Story 6.2)', () => {
  const blocks = (data: unknown[]) => mapped({ ...e8Locked(), hasAccess: true, data }).blocks;

  it("`images: 'stops'`: an image with a URL is a focus stop; one without a URL stays a placeholder", () => {
    const items = postBodyItems(
      blocks([
        { type: 'image', id: 'a', url: 'https://example.invalid/a', width: 800, height: 600 },
        { type: 'image', id: 'b' },
      ]),
      { images: 'stops' },
    );
    expect(items).toEqual([
      { kind: 'image', key: 'image:a', url: 'https://example.invalid/a', width: 800, height: 600, stop: true },
      { kind: 'placeholder', key: 'image:b', block: 'image' },
    ]);
    expect(items.map(isFocusStop)).toEqual([true, false]);
  });

  it('a teaser image (`images: true`) is never a focus stop', () => {
    const [item] = postBodyItems(
      blocks([{ type: 'image', id: 'a', url: 'https://example.invalid/a' }]),
      { images: true },
    );
    expect(isFocusStop(item)).toBe(false);
  });
});

/* eslint-disable no-script-url -- Story 6.3: unsafe URLs are inputs the code must reject */
describe('postBodyItems: links, files, external videos and headings (Story 6.3)', () => {
  const linkBlock = (s: string, url: unknown) => ({ type: 'link', content: JSON.stringify([s, 'unstyled', []]), url });
  /** As the Post body of an accessible post (Story 6.3: `qr`). */
  const qrItems = (data: unknown[]) =>
    postBodyItems(mapped(postDetail('b', 'p', data as never)).blocks, { videoRows: true, images: 'stops', qr: true });
  const para = (items: PostBodyItem[], i: number) => items[i] as PostBodyItem & { kind: 'paragraph' };

  it('matrix «Link»: a paragraph with 2 links (one repeated) → inline text + 2 chips; a non-http URL → no chip', () => {
    const items = qrItems([
      text('Читайте '),
      linkBlock('тут', 'https://example.invalid/a'),
      text(', '),
      linkBlock('там', 'https://example.invalid/b'),
      text(' и снова '),
      linkBlock('тут ещё', 'https://example.invalid/a'),
      text(' '),
      linkBlock('скрипт', 'javascript:alert(1)'),
      text(' '),
      linkBlock('пусто', ''),
      blockEnd(),
    ]);
    expect(items).toHaveLength(1);
    const p = para(items, 0);
    expect(p.text).toBe('Читайте тут, там и снова тут ещё скрипт пусто');
    expect(p.links).toEqual([
      { key: 'text@0/link/0', text: 'тут', url: 'https://example.invalid/a', post: null, timestamp: null },
      { key: 'text@0/link/1', text: 'там', url: 'https://example.invalid/b', post: null, timestamp: null },
    ]);
  });

  it('matrix «Boosty post link»: a link to another Boosty post carries it; the current post, a blog page or another Boosty URL do not', () => {
    const items = postBodyItems(
      mapped(
        postDetail('b', 'p', [
          text('См. '),
          linkBlock('другой', 'https://boosty.to/other-blog/posts/abc-123?share=1#top'),
          text(' '),
          linkBlock('этот', 'https://www.boosty.to/self-blog/posts/self-id'),
          text(' '),
          linkBlock('этот иначе', 'https://boosty.to/Self-Blog/posts/self-id'),
          text(' '),
          linkBlock('блог', 'https://boosty.to/other-blog'),
          text(' '),
          linkBlock('подписка', 'https://boosty.to/other-blog/purchase/1'),
          blockEnd(),
        ] as never),
      ).blocks,
      { qr: true, selfPost: { blogUrl: 'self-blog', postId: 'self-id' } },
    );
    expect(para(items, 0).links.map(l => [l.text, l.post])).toEqual([
      ['другой', { blogUrl: 'other-blog', postId: 'abc-123' }],
      ['этот', null],
      ['этот иначе', null],
      ['блог', null],
      ['подписка', null],
    ]);
  });

  it('matrix «Timestamp»: a `?t=<s>&tmid=<video id>` link to the current post carries the video and second; another video, post or format does not', () => {
    const self = `https://boosty.to/self-blog/posts/self-id`;
    const items = postBodyItems(
      mapped(
        postDetail('self-blog', 'self-id', [
          { type: 'ok_video', id: 'v1', title: 'x' },
          text('Таймкоды: '),
          linkBlock('0:00', `${self}?t=0&tmid=v1`),
          text(' '),
          linkBlock('3:45', `${self}?t=225&tmid=v1`),
          text(' '),
          linkBlock('чужое', `${self}?t=10&tmid=v9`),
          text(' '),
          linkBlock('формат', `${self}?t=1m2s&tmid=v1`),
          text(' '),
          linkBlock('другой', `https://boosty.to/self-blog/posts/other?t=10&tmid=v1`),
          blockEnd(),
        ] as never),
      ).blocks,
      { videoRows: true, qr: true, selfPost: { blogUrl: 'self-blog', postId: 'self-id' } },
    );
    expect(para(items, 0).links.map(l => [l.text, l.timestamp, l.post])).toEqual([
      ['0:00', { mediaId: 'v1', seconds: 0 }, null],
      ['3:45', { mediaId: 'v1', seconds: 225 }, null],
      ['чужое', null, null],
      ['формат', null, null],
      ['другой', null, { blogUrl: 'self-blog', postId: 'other' }],
    ]);
  });

  it('a link-only paragraph is keyed by the link; links never cross a paragraph end', () => {
    const items = qrItems([
      linkBlock('Ссылка', 'https://example.invalid/a'),
      blockEnd(),
      ...paragraph('Без ссылок'),
      text('Снова '),
      linkBlock('ссылка', 'https://example.invalid/a'),
      blockEnd(),
    ]);
    expect(items.map(i => (i.kind === 'paragraph' ? [i.key, i.links.map(l => l.key)] : i.kind))).toEqual([
      ['link@0', ['link@0/link/0']],
      ['text@2', []],
      ['text@4', ['text@4/link/0']],
    ]);
  });

  it('a split paragraph keeps its chips on the last stop, keyed by the first', () => {
    const long = 'Слово '.repeat(150).trim();
    const items = qrItems([text(long), linkBlock('ссылка', 'https://example.invalid/a'), blockEnd()]);
    expect(items.length).toBeGreaterThan(1);
    expect(items.slice(0, -1).every(i => i.kind === 'paragraph' && i.links.length === 0)).toBe(true);
    expect(para(items, items.length - 1).links.map(l => l.key)).toEqual(['text@0/link/0']);
  });

  it('list items get their own chips', () => {
    const items = qrItems([
      {
        type: 'list',
        items: [{ data: [text('Пункт '), linkBlock('ссылка', 'https://example.invalid/a')], items: [] }],
      },
    ]);
    expect(para(items, 0).links).toEqual([{ key: 'list@0/link/0', text: 'ссылка', url: 'https://example.invalid/a', post: null, timestamp: null }]);
  });

  it('matrix «File»: a file block is a file stop with its title and size (no URL in the domain)', () => {
    const items = qrItems([
      { type: 'file', id: 'f1', title: ' report.pdf ', size: 2048, url: 'https://example.invalid/file' },
      { type: 'file', title: '', url: 'https://example.invalid/file' },
    ]);
    expect(items).toEqual([
      { kind: 'file', key: 'file:f1', title: 'report.pdf', sizeBytes: 2048 },
      { kind: 'file', key: 'file@1', title: '', sizeBytes: null },
    ]);
    expect(JSON.stringify(mapped(postDetail('b', 'p', [{ type: 'file', id: 'f1', url: 'https://example.invalid/file' }] as never)))).not.toContain('example.invalid/file');
    expect(items.every(isFocusStop)).toBe(true);
  });

  it('matrix «YouTube» / «Other video»: a video with an http(s) URL is an externalVideo stop; a YouTube host gives its id', () => {
    const items = qrItems([
      { type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' },
      { type: 'video', url: 'https://example.invalid/video' },
      { type: 'video', url: 'javascript:alert(1)' },
      { type: 'video' },
    ]);
    expect(items).toEqual([
      { kind: 'externalVideo', key: 'video@0', url: 'https://youtu.be/dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ' },
      { kind: 'externalVideo', key: 'video@1', url: 'https://example.invalid/video', youtubeId: null },
      { kind: 'placeholder', key: 'video@2', block: 'video' },
      { kind: 'placeholder', key: 'video@3', block: 'video' },
    ]);
    expect(isFocusStop(items[0])).toBe(true);
    expect(isFocusStop(items[2])).toBe(false);
  });

  it('matrix «Header»: a bold, non-focusable heading that ends the paragraph in progress; an empty one is dropped', () => {
    const items = qrItems([
      text('До'),
      { type: 'header', content: JSON.stringify(['Заголовок', 'unstyled', []]), modificator: '' },
      text('После'),
      blockEnd(),
      { type: 'header', content: JSON.stringify(['  ', 'unstyled', []]), modificator: '' },
      { type: 'header', content: '' },
      { type: 'header', content: 'Сырой' },
    ]);
    expect(plain(items)).toEqual([
      { kind: 'paragraph', key: 'text@0', text: 'До' },
      { kind: 'heading', key: 'header@1', text: 'Заголовок' },
      { kind: 'paragraph', key: 'text@2', text: 'После' },
      { kind: 'heading', key: 'header@6', text: 'Сырой' },
    ]);
    expect(isFocusStop(items[1])).toBe(false);
  });

  it('without `qr` (a locked teaser): no chips; files and videos stay placeholders; headings still show', () => {
    const items = postBodyItems(
      mapped(
        postDetail('b', 'p', [
          text('a '),
          linkBlock('b', 'https://example.invalid/a'),
          blockEnd(),
          { type: 'file', id: 'f1' },
          { type: 'video', url: 'https://example.invalid/video' },
          { type: 'header', content: JSON.stringify(['H', 'unstyled', []]) },
        ] as never),
      ).blocks,
    );
    expect(items.map(i => (i.kind === 'paragraph' ? i.links.length : i.kind === 'placeholder' ? i.block : i.kind))).toEqual([
      0,
      'file',
      'video',
      'heading',
    ]);
  });

  it('the live accessible E8 with its synthetic Story 6.3–6.4 blocks: links chipped (deduped per paragraph), heading, file, video and audio', () => {
    const items = postBodyItems(mapped(e8Accessible()).blocks, { videoRows: true, images: 'stops', qr: true });
    const chips = items.flatMap(i => (i.kind === 'paragraph' ? i.links : []));
    expect(chips.length).toBeGreaterThan(5);
    expect(new Set(chips.map(c => c.key)).size).toBe(chips.length);
    expect(items.slice(-4)).toEqual([
      { kind: 'heading', key: 'header@113', text: 'Sample text' },
      { kind: 'file', key: 'file:synthetic-id-13', title: 'redacted', sizeBytes: 204800 },
      { kind: 'externalVideo', key: 'video@115', url: 'https://example.invalid/video', youtubeId: null },
      { kind: 'audio', key: 'audio_file:synthetic-id-14', title: 'redacted', durationSec: 180 },
    ]);
  });
});

describe('postBodyItems: audio (Story 6.4)', () => {
  const qrItems = (data: unknown[], qr = true) =>
    postBodyItems(mapped(postDetail('b', 'p', data as never)).blocks, { videoRows: true, images: 'stops', qr });

  it('an accessible post\'s audio is an AudioBlock item (a focus stop) with its title and whole-second duration, between paragraphs', () => {
    const items = qrItems([
      ...paragraph('Before'),
      { type: 'audio_file', id: 'a1', title: ' Track ', duration: 192.7, url: 'https://example.invalid/audio' },
      ...paragraph('After'),
    ]);
    expect(plain(items)).toEqual([
      { kind: 'paragraph', key: 'text@0', text: 'Before' },
      { kind: 'audio', key: 'audio_file:a1', title: 'Track', durationSec: 192 },
      { kind: 'paragraph', key: 'text@3', text: 'After' },
    ]);
    expect(items.map(isFocusStop)).toEqual([true, true, true]);
  });

  it('no id → keyed by index; no, zero, negative or malformed duration → null; no title → empty', () => {
    expect(
      qrItems([
        { type: 'audio_file' },
        { type: 'audio_file', id: 'z', duration: 0 },
        { type: 'audio_file', id: 'n', duration: -5 },
        { type: 'audio_file', id: 'm', duration: 'long', title: 5 },
      ]),
    ).toEqual([
      { kind: 'audio', key: 'audio_file@0', title: '', durationSec: null },
      { kind: 'audio', key: 'audio_file:z', title: '', durationSec: null },
      { kind: 'audio', key: 'audio_file:n', title: '', durationSec: null },
      { kind: 'audio', key: 'audio_file:m', title: '', durationSec: null },
    ]);
  });

  it('a repeated id falls back to its index (keys stay unique)', () => {
    expect(qrItems([{ type: 'audio_file', id: 'a' }, { type: 'audio_file', id: 'a' }]).map(i => i.key)).toEqual([
      'audio_file:a',
      'audio_file@1',
    ]);
  });

  it('with `audio: false` (the player capability off) audio stays the neutral placeholder', () => {
    expect(
      postBodyItems(mapped(postDetail('b', 'p', [{ type: 'audio_file', id: 'a1' }] as never)).blocks, {
        qr: true,
        audio: false,
      }),
    ).toEqual([{ kind: 'placeholder', key: 'audio_file:a1', block: 'audio' }]);
  });

  it('without `qr` (a locked post\'s teaser) audio stays the neutral placeholder', () => {
    expect(qrItems([{ type: 'audio_file', id: 'a1', title: 'T', duration: 60 }], false)).toEqual([
      { kind: 'placeholder', key: 'audio_file:a1', block: 'audio' },
    ]);
    expect(isFocusStop({ kind: 'placeholder', key: 'audio_file:a1', block: 'audio' })).toBe(false);
  });
});
