import type { Block, ListItem } from './types';

/**
 * The Post screen's body (Story 3.4): the blocks as plain paragraphs and
 * neutral placeholders, in order. Styles, emoji, links, images, files,
 * audio and polls are Epic 6; video rows are Story 3.5.
 *
 * - `text` fragments are merged until a `BLOCK_END` fragment ends the
 *   paragraph. A `link` block is a fragment too (owner decision 2026-10-27,
 *   inline links): its text joins the paragraph in progress (or starts one)
 *   as plain text, never a placeholder; a link without text is skipped.
 *   Any other block ends the paragraph in progress (its text stays a
 *   paragraph before the placeholder). Blank paragraphs are dropped.
 * - A `list` block is one stop per item with text (items in order, nested
 *   items after their parent); a list without text is a placeholder.
 * - A stop longer than `PARAGRAPH_STOP_MAX_CHARS` is split into consecutive
 *   stops (`splitParagraph`), so ↓ walks through the text (owner decision
 *   2026-10-27, option A): Android scrolls a focused view only to its top,
 *   so a stop taller than the column would hide its rest.
 * - Every other block (video, image, file, audio, poll, unknown or
 *   malformed) is one placeholder.
 * - Every other block (video, image, file, audio, poll, unknown or
 *   malformed) is one placeholder.
 *
 * Keys (focus-map §1.5, block keys): `<type>:<id>` when the block has an
 * id, else `<type>@<index in data[]>`; a paragraph uses its first fragment's
 * key; the parts after the first of a split stop (or of a list's items)
 * are `<key>#<n>` (n from 1). Pure and total: no block shape throws.
 */

/**
 * The longest ParagraphStop, in characters. The right column's text is
 * about 422 dp wide (720 content − 232 left column − 24 gap − 2 × 12
 * headroom − 18 paragraph padding and bar): ≈ 55 Cyrillic characters per
 * line at `typography.body` (14 sp, ≈ 7.7 dp per character), 22 dp per
 * line. 400 characters ≈ 8 lines ≈ 190 dp with the padding, well under
 * the column's ≈ 470 dp viewport (540 − 2 × 27 safe area − 12 headroom),
 * even with the wider glyphs of all-caps or emoji lines.
 */
export const PARAGRAPH_STOP_MAX_CHARS = 400;

/**
 * The cut position for a part that starts at `start` (`text.length - start`
 * > `max`): the last line break, else sentence end, else space within the
 * budget (in that order, each only past a third of the budget so parts do
 * not get tiny), else any of them within the budget, else the first space
 * after it (a word longer than the budget stays whole: never mid-word).
 */
function cutAt(text: string, start: number, max: number): number {
  const end = start + max;
  const window = text.slice(start, end + 1);
  const kinds = [/\n/g, /[.!?…»)]\s/g, /\s/g];
  const positions = kinds.map(re => {
    const found: number[] = [];
    for (const m of window.matchAll(re)) {
      found.push(start + (m.index ?? 0) + m[0].length);
    }
    return found.filter(p => p > start && p <= end);
  });
  for (const found of positions) {
    const good = found.filter(p => p - start >= max / 3);
    if (good.length > 0) {
      return good[good.length - 1];
    }
  }
  for (const found of positions) {
    if (found.length > 0) {
      return found[found.length - 1];
    }
  }
  const next = text.slice(end).search(/\s/);
  return next < 0 ? text.length : end + next + 1;
}

/**
 * A paragraph as consecutive stops of at most `max` characters, cut at line,
 * sentence or word boundaries (never mid-word); parts are trimmed and blank
 * ones dropped. Order and text are preserved (up to the whitespace at cuts).
 */
export function splitParagraph(text: string, max: number = PARAGRAPH_STOP_MAX_CHARS): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    const cut = text.length - start <= max ? text.length : cutAt(text, start, max);
    const part = text.slice(start, cut).trim();
    if (part.length > 0) {
      parts.push(part);
    }
    start = cut;
  }
  return parts;
}

/** What a placeholder stands for (its label in the `ru` catalog). */
export type PlaceholderKind = 'video' | 'image' | 'file' | 'audio' | 'poll' | 'unknown';

export type PostBodyItem =
  | { kind: 'paragraph'; key: string; text: string }
  | { kind: 'placeholder'; key: string; block: PlaceholderKind };

const MAX_LIST_DEPTH = 8;

function idOf(block: Block): string | null {
  switch (block.type) {
    case 'ok_video':
      return block.id.length > 0 ? block.id : null;
    case 'image':
    case 'audio_file':
    case 'file':
    case 'poll':
      return block.id;
    default:
      return null;
  }
}

/** `<type>:<id>`, else `<type>@<index>`. Unknown blocks use their raw type. */
export function blockKey(block: Block, index: number): string {
  const type = block.type === 'unknown' ? block.rawType || 'unknown' : block.type;
  const id = idOf(block);
  return id !== null ? `${type}:${id}` : `${type}@${index}`;
}

function placeholderKind(block: Block): PlaceholderKind {
  switch (block.type) {
    case 'ok_video':
      return 'video';
    case 'image':
      return 'image';
    case 'file':
      return 'file';
    case 'audio_file':
      return 'audio';
    case 'poll':
      return 'poll';
    default:
      return 'unknown';
  }
}

/** The text of a list item's own blocks (text and link fragments, merged). */
function itemText(blocks: readonly Block[]): string {
  return blocks
    .map(block => (block.type === 'text' || block.type === 'link' ? block.text : ''))
    .join('')
    .trim();
}

/** A list's item texts in order (nested items after their parent), blank ones dropped. */
export function listItemTexts(items: readonly ListItem[]): string[] {
  const lines: string[] = [];
  listLines(items, 0, lines);
  return lines;
}

function listLines(items: readonly ListItem[], depth: number, out: string[]): void {
  if (depth > MAX_LIST_DEPTH) {
    return;
  }
  for (const item of items) {
    const line = itemText(item.blocks);
    if (line.length > 0) {
      out.push(line);
    }
    listLines(item.items, depth + 1, out);
  }
}

export function postBodyItems(blocks: readonly Block[]): PostBodyItem[] {
  const items: PostBodyItem[] = [];
  const used = new Set<string>();
  /** Keys are unique within the body: a repeated id falls back to the index. */
  const push = (item: PostBodyItem, index: number) => {
    let unique = item.key;
    if (used.has(unique)) {
      unique = `${unique.split(':')[0]}@${index}`;
    }
    used.add(unique);
    items.push({ ...item, key: unique });
  };
  /** Stops for `texts` (each split by the budget): `key`, then `key#1`, `key#2`, … */
  const pushStops = (base: string, texts: readonly string[], index: number) => {
    texts
      .flatMap(t => splitParagraph(t))
      .forEach((part, n) =>
        push({ kind: 'paragraph', key: n === 0 ? base : `${base}#${n}`, text: part }, index),
      );
  };
  let text = '';
  let key: string | null = null;
  let start = 0;
  const flush = () => {
    const trimmed = text.trim();
    if (key !== null && trimmed.length > 0) {
      pushStops(key, [trimmed], start);
    }
    text = '';
    key = null;
  };
  blocks.forEach((block, index) => {
    if (block.type === 'link' && block.text.length === 0) {
      return;
    }
    if (block.type === 'text' || block.type === 'link') {
      if (key === null) {
        key = blockKey(block, index);
        start = index;
      }
      text += block.text;
      if (block.type === 'text' && block.paragraphEnd) {
        flush();
      }
      return;
    }
    flush();
    if (block.type === 'list') {
      const lines = listItemTexts(block.items);
      if (lines.length > 0) {
        pushStops(blockKey(block, index), lines, index);
      } else {
        push({ kind: 'placeholder', key: blockKey(block, index), block: 'unknown' }, index);
      }
      return;
    }
    push({ kind: 'placeholder', key: blockKey(block, index), block: placeholderKind(block) }, index);
  });
  flush();
  return items;
}
