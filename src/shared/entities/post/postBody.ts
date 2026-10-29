import type { Block, ListItem, TextSpan } from './types';

/**
 * The Post screen's body (Story 3.4): the blocks as paragraphs and neutral
 * placeholders, in order. Images are Story 6.2; links as chips, files,
 * audio and polls are later Epic 6 stories.
 *
 * - `text` fragments are merged until a `BLOCK_END` fragment ends the
 *   paragraph. A `link` block is a fragment too (owner decision 2026-10-27,
 *   inline links): its text joins the paragraph in progress (or starts one)
 *   as inline text, never a placeholder; a link without text is skipped.
 *   A `smile` block (Story 6.1) is a fragment too: an inline emoji; one
 *   without an image URL is skipped (it takes no space). Any other block
 *   ends the paragraph in progress (its text stays a paragraph before the
 *   placeholder). Blank paragraphs are dropped.
 * - Story 6.1: a paragraph is styled `segments` (text runs with bold, italic
 *   and underline flags, and inline emoji). Live, a fragment's style range
 *   counts from the paragraph start (UTF-16), so each fragment's ranges are
 *   placed at its offset in the paragraph and clamped to the fragment (a
 *   range never styles another fragment's text). A `smile` counts as one
 *   offset unit, as in the reference (unverified live: no emoji was seen). Its `text` is the plain text
 *   (emoji left out, trimmed) for accessibility labels and plain callers.
 * - A `list` block is one stop per item with text (items in order, nested
 *   items after their parent); a list without text is a placeholder.
 * - A stop longer than `PARAGRAPH_STOP_MAX_CHARS` is split into consecutive
 *   stops (`splitParagraph`), so ↓ walks through the text (owner decision
 *   2026-10-27, option A, kept by owner decision 2026-10-29, Q1 a: no
 *   collapse): Android scrolls a focused view only to its top, so a stop
 *   taller than the column would hide its rest. The cut is made on the
 *   plain text (an emoji counts as one character) and mapped back to the
 *   segments: a styled run that crosses a cut continues in the next stop.
 * - An `ok_video` block with an id is a MediaRow above the body (Story
 *   3.5, `videoRowsOf`), so it leaves the body when the caller passes
 *   `videoRows: true` (the Post body of an accessible post; default off, so a
 *   teaser or any other caller keeps its videos as placeholders). A video
 *   without an id stays a `video` placeholder: an `ok_video` block whose id
 *   is `''` (the type allows it; the DTO normally rejects it), or the
 *   mapper's `Block.Unknown` with raw type `ok_video` (id missing).
 * - With `images` (`true`: a locked post's teaser, Story 3.6; `'stops'`:
 *   an accessible post, Story 6.2), an `image` block with a URL is an
 *   `image` item; otherwise every other block (image, file, audio, poll,
 *   unknown or malformed) is one placeholder.
 *
 * Keys (focus-map §1.5, block keys): `<type>:<id>` when the block has an
 * id, else `<type>@<index in data[]>`; a paragraph uses its first fragment's
 * key; the parts after the first of a split stop (or of a list's items)
 * are `<key>#<n>` (n from 1). Pure and total: no block shape throws.
 */

/**
 * The longest ParagraphStop, in characters. The Post column's text is
 * capped at `spacing['text-measure']` (600 dp, owner decision 2026-10-27,
 * header on top): 600 − 18 paragraph padding and bar ≈ 582 dp ≈ 75
 * Cyrillic characters per line at `typography.body` (14 sp, ≈ 7.7 dp per
 * character), 22 dp per line. 600 characters ≈ 8 lines ≈ 190 dp with the
 * padding, well under the column's ≈ 470 dp viewport (540 − 2 × 27 safe
 * area − 12 headroom), even with the wider glyphs of all-caps or emoji
 * lines. (In the former two-column layout the text was ≈ 422 dp wide and
 * the budget 400.)
 */
export const PARAGRAPH_STOP_MAX_CHARS = 600;

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

/** `[start, end)` of `text.slice(start, end).trim()` within `text` (start = end when blank). */
function trimmedBounds(text: string, start: number, end: number): [number, number] {
  let a = start;
  let b = end;
  while (a < b && /\s/.test(text[a])) {
    a += 1;
  }
  while (b > a && /\s/.test(text[b - 1])) {
    b -= 1;
  }
  return [a, b];
}

/**
 * The `[start, end)` ranges of `splitParagraph(text, max)` within `text`:
 * each part trimmed, blank parts dropped.
 */
function splitRanges(text: string, max: number): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0;
  while (start < text.length) {
    const cut = text.length - start <= max ? text.length : cutAt(text, start, max);
    const [a, b] = trimmedBounds(text, start, cut);
    if (b > a) {
      ranges.push([a, b]);
    }
    start = cut;
  }
  return ranges;
}

/**
 * A paragraph as consecutive stops of at most `max` characters, cut at line,
 * sentence or word boundaries (never mid-word); parts are trimmed and blank
 * ones dropped. Order and text are preserved (up to the whitespace at cuts).
 */
export function splitParagraph(text: string, max: number = PARAGRAPH_STOP_MAX_CHARS): string[] {
  return splitRanges(text, max).map(([a, b]) => text.slice(a, b));
}

/**
 * One piece of a paragraph (Story 6.1): a text run with its styles, or an
 * inline emoji (a plain `{uri}` image with no auth headers; `key` is unique
 * within the paragraph).
 */
export type Segment =
  | { kind: 'text'; text: string; bold: boolean; italic: boolean; underline: boolean }
  | { kind: 'emoji'; key: string; url: string };

/** What a placeholder stands for (its label in the `ru` catalog). */
export type PlaceholderKind = 'video' | 'image' | 'file' | 'audio' | 'poll' | 'unknown';

export type PostBodyItem =
  | {
      kind: 'paragraph';
      key: string;
      /** The plain text (emoji left out, trimmed): accessibility labels and plain callers. */
      text: string;
      /** The styled text runs and inline emoji, in order (Story 6.1). */
      segments: Segment[];
    }
  | { kind: 'placeholder'; key: string; block: PlaceholderKind }
  /**
   * An image with a URL (only with `images`): a locked post's teaser
   * (Story 3.6, owner decision 2026-10-27, option A; not a stop) or, with
   * `images: 'stops'`, an image of an accessible post (Story 6.2: a focus
   * stop). `width`/`height` are positive or null.
   */
  | {
      kind: 'image';
      key: string;
      url: string;
      width: number | null;
      height: number | null;
      /** A focus stop (an accessible post's image, Story 6.2). */
      stop: boolean;
    };

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
    case 'unknown':
      // An `ok_video` without an id: no MediaRef, a neutral video placeholder.
      return block.rawType === 'ok_video' ? 'video' : 'unknown';
    default:
      return 'unknown';
  }
}

/**
 * The plain-text stand-in of an emoji in a paragraph's text: one character
 * of the split budget, not whitespace (a cut never falls on it).
 */
const EMOJI_CHAR = '\uFFFC';

/**
 * A paragraph being built: its segments, their plain text (an emoji is
 * `EMOJI_CHAR`) and the style-range offset of the next fragment (every
 * fragment's text plus one per `smile`, shown or not).
 */
type Line = { segments: Segment[]; plain: string; offset: number };

const emptyLine = (): Line => ({ segments: [], plain: '', offset: 0 });

const sameStyle = (
  a: Segment & { kind: 'text' },
  b: Pick<Segment & { kind: 'text' }, 'bold' | 'italic' | 'underline'>,
) => a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;

/** Appends a text run, merged into the previous run when the styles match. */
function appendText(line: Line, run: Segment & { kind: 'text' }): void {
  if (run.text.length === 0) {
    return;
  }
  const last = line.segments[line.segments.length - 1];
  if (last !== undefined && last.kind === 'text' && sameStyle(last, run)) {
    line.segments[line.segments.length - 1] = { ...last, text: last.text + run.text };
  } else {
    line.segments.push(run);
  }
  line.plain += run.text;
}

/**
 * A `text`/`link` fragment's runs: its ranges are placed at the paragraph
 * offset (live: `from` counts from the paragraph start) and clamped to the
 * fragment; the text is cut at every range edge, each run with the styles
 * covering it.
 */
function appendFragment(line: Line, text: string, spans: readonly TextSpan[]): void {
  const base = line.offset;
  line.offset += text.length;
  const local = spans
    .map(span => ({
      style: span.style,
      start: Math.max(0, span.from - base),
      end: Math.min(text.length, span.from + span.len - base),
    }))
    .filter(span => span.end > span.start);
  const edges = new Set<number>([0, text.length]);
  for (const span of local) {
    edges.add(span.start);
    edges.add(span.end);
  }
  const cuts = [...edges].sort((x, y) => x - y);
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const covers = (style: TextSpan['style']) =>
      local.some(span => span.style === style && span.start <= a && span.end >= b);
    appendText(line, {
      kind: 'text',
      text: text.slice(a, b),
      bold: covers('bold'),
      italic: covers('italic'),
      underline: covers('underline'),
    });
  }
}

/**
 * Appends an inline fragment (`text`, `link`, `smile`) to `line`; false for
 * any other block. A `smile` without an image URL adds nothing.
 */
function appendInline(line: Line, block: Block, index: number): boolean {
  switch (block.type) {
    case 'text':
    case 'link':
      appendFragment(line, block.text, block.spans);
      return true;
    case 'smile':
      // One offset unit per smile, as the reference's inline content (unverified live).
      line.offset += 1;
      if (block.url !== null) {
        line.segments.push({ kind: 'emoji', key: blockKey(block, index), url: block.url });
        line.plain += EMOJI_CHAR;
      }
      return true;
    default:
      return false;
  }
}

/** The segments of `line` within `[start, end)` of its plain text, adjacent equal styles merged. */
function sliceLine(line: Line, start: number, end: number): Segment[] {
  const out: Line = emptyLine();
  let pos = 0;
  for (const segment of line.segments) {
    const length = segment.kind === 'text' ? segment.text.length : EMOJI_CHAR.length;
    const [a, b] = [Math.max(start, pos), Math.min(end, pos + length)];
    if (b > a) {
      if (segment.kind === 'text') {
        appendText(out, { ...segment, text: segment.text.slice(a - pos, b - pos) });
      } else {
        out.segments.push(segment);
      }
    }
    pos += length;
  }
  return out.segments;
}

/** The plain text of segments: the text runs joined (emoji left out), trimmed. */
function segmentsText(segments: readonly Segment[]): string {
  return segments
    .map(segment => (segment.kind === 'text' ? segment.text : ''))
    .join('')
    .trim();
}

/**
 * A line as consecutive stops within the budget: trimmed, split on its
 * plain text, each part mapped back to its segments. A blank line gives none.
 */
function lineStops(line: Line): Segment[][] {
  const [s0, e0] = trimmedBounds(line.plain, 0, line.plain.length);
  if (e0 <= s0) {
    return [];
  }
  return splitRanges(line.plain.slice(s0, e0), PARAGRAPH_STOP_MAX_CHARS).map(([a, b]) =>
    sliceLine(line, s0 + a, s0 + b),
  );
}

/** A list item's own blocks (inline fragments, merged) as one line. */
function itemLine(blocks: readonly Block[]): Line {
  const line = emptyLine();
  blocks.forEach((block, index) => {
    appendInline(line, block, index);
  });
  return line;
}

const isBlank = (line: Line) => line.plain.trim().length === 0;

/** A list's item lines in order (nested items after their parent), blank ones dropped. */
function listItemLines(items: readonly ListItem[]): Line[] {
  const lines: Line[] = [];
  listLines(items, 0, lines);
  return lines;
}

function listLines(items: readonly ListItem[], depth: number, out: Line[]): void {
  if (depth > MAX_LIST_DEPTH) {
    return;
  }
  for (const item of items) {
    const line = itemLine(item.blocks);
    if (!isBlank(line)) {
      out.push(line);
    }
    listLines(item.items, depth + 1, out);
  }
}

/**
 * Whether a body item is a focus stop: a paragraph with plain text, or an
 * accessible post's image (Story 6.2). A paragraph (or split part) of emoji
 * only has no text to read or land on, so it is shown as non-focusable
 * content (Story 6.1); a teaser image is never a stop (Story 3.6).
 */
export function isFocusStop(item: PostBodyItem): boolean {
  return (
    (item.kind === 'paragraph' && item.text.length > 0) || (item.kind === 'image' && item.stop)
  );
}

export type PostBodyOptions = {
  /** The post's videos with an id are MediaRows: leave them out (default false). */
  videoRows?: boolean;
  /**
   * Image blocks with a URL are `image` items; without a URL they stay
   * placeholders. `true`: a locked post's teaser (Story 3.6, not stops);
   * `'stops'`: an accessible post's images (Story 6.2, focus stops).
   * Default false (placeholders).
   */
  images?: boolean | 'stops';
};

const positive = (n: number | null): number | null => (n !== null && n > 0 ? n : null);

export function postBodyItems(
  blocks: readonly Block[],
  { videoRows = false, images = false }: PostBodyOptions = {},
): PostBodyItem[] {
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
  /** Stops for `lines` (each split by the budget): `key`, then `key#1`, `key#2`, … */
  const pushStops = (base: string, lines: readonly Line[], index: number) => {
    lines
      .flatMap(lineStops)
      .forEach((segments, n) =>
        push(
          {
            kind: 'paragraph',
            key: n === 0 ? base : `${base}#${n}`,
            text: segmentsText(segments),
            segments,
          },
          index,
        ),
      );
  };
  let line = emptyLine();
  let key: string | null = null;
  let start = 0;
  const flush = () => {
    if (key !== null && !isBlank(line)) {
      pushStops(key, [line], start);
    }
    line = emptyLine();
    key = null;
  };
  blocks.forEach((block, index) => {
    if (block.type === 'link' && block.text.length === 0) {
      return;
    }
    if (block.type === 'smile' && block.url === null) {
      // No image: no space and never a paragraph's key, but it still counts
      // for the style offsets of the fragments after it.
      line.offset += 1;
      return;
    }
    if (videoRows && block.type === 'ok_video' && block.id.length > 0) {
      // A MediaRow above the body. It still ends the paragraph in progress,
      // so the text around it keeps the paragraphs (and keys) it had.
      flush();
      return;
    }
    if (block.type === 'text' || block.type === 'link' || block.type === 'smile') {
      if (key === null) {
        key = blockKey(block, index);
        start = index;
      }
      appendInline(line, block, index);
      if (block.type === 'text' && block.paragraphEnd) {
        flush();
      }
      return;
    }
    flush();
    if (images && block.type === 'image' && block.url !== null) {
      push(
        {
          kind: 'image',
          key: blockKey(block, index),
          url: block.url,
          width: positive(block.width),
          height: positive(block.height),
          stop: images === 'stops',
        },
        index,
      );
      return;
    }
    if (block.type === 'list') {
      const lines = listItemLines(block.items);
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
