import { formatDuration } from '../../i18n/format';
import { timestampRef } from '../externalUrls';
import type { Block, ListItem, Post } from './types';

/**
 * Story 10.1 (our improvement, not reference parity): a video's chapters
 * from its post's timestamp links.
 *
 * - Only the known timestamp shape counts: a link `timestampRef` recognizes
 *   (this post, `tmid` = one of the post's videos). A timestamp belongs to
 *   the video its `tmid` names; links to another post are ignored. There is
 *   no second parser here.
 * - The name (owner decision 2026-11-02): the text right after the link up
 *   to the end of its line (a line break, the paragraph end, the next
 *   timestamp link or a non-inline block; another link's text is part of
 *   the line), with leading separators («—», «–», «-», «:», «.») and spaces
 *   trimmed; when that is empty, the time itself.
 * - Sorted by second; a repeated second keeps its first link (post order).
 *   With a known duration, a timestamp at or past it is ignored.
 *
 * Never throws on odd input: an unknown shape just gives no chapter.
 */
export type Chapter = {
  /** Whole seconds from the video's start. */
  sec: number;
  /** One-line name (never empty). */
  title: string;
};

/** Media `previous` (YouTube rule): more than this far into a chapter → its own start. */
export const CHAPTER_RESTART_SEC = 3;

/** The same depth bound as the mapper's and the post body's lists. */
const MAX_LIST_DEPTH = 8;

/** Leading separators and spaces before a chapter name. */
const LEADING_SEPARATORS = /^[\s—–\-:.]+/;

/**
 * The chapter-name rule (Story 10.1, owner decision 2026-11-02), shared with
 * the Post body's timestamp chips (Story 13.2): `rest` is the text after the
 * timestamp link to the end of its line; leading separators («—», «–», «-»,
 * «:», «.») and spaces are trimmed and inner whitespace collapsed; when
 * nothing is left, the time itself (`formatDuration(seconds)`).
 */
export function chapterTitle(rest: string, seconds: number): string {
  const name = rest.replace(LEADING_SEPARATORS, '').replace(/\s+/g, ' ').trim();
  return name.length > 0 ? name : formatDuration(seconds);
}

type Self = { blogUrl: string; postId: string; mediaIds: readonly string[] };

type Found = { sec: number; title: string };

/**
 * The raw text (before `chapterTitle`) from the inline blocks after a
 * timestamp link, up to the end of its line: a line break, the paragraph end, the next timestamp link of this
 * post or a non-inline block. Any other link is part of the line (its text
 * counts).
 */
function nameAfter(blocks: readonly Block[], from: number, self: Self): string {
  let name = '';
  for (let i = from; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.type === 'smile') {
      continue;
    }
    if (block.type === 'link' && timestampRef(block.url, self) === null) {
      name += block.text;
      continue;
    }
    if (block.type !== 'text') {
      // The next timestamp link, or a non-inline block, ends the line.
      break;
    }
    const lineBreak = block.text.indexOf('\n');
    if (lineBreak >= 0) {
      name += block.text.slice(0, lineBreak);
      break;
    }
    name += block.text;
    if (block.paragraphEnd) {
      break;
    }
  }
  return name;
}

/**
 * The timestamps of `mediaId` in a run of blocks, in post order: a `list`
 * block's items (each item is a line) at its own position.
 */
function collect(blocks: readonly Block[], self: Self, mediaId: string, out: Found[], depth = 0): void {
  blocks.forEach((block, index) => {
    if (block.type === 'list') {
      collectList(block.items, self, mediaId, out, depth + 1);
      return;
    }
    if (block.type !== 'link' || block.text.length === 0) {
      return;
    }
    const ref = timestampRef(block.url, self);
    if (ref === null || ref.mediaId !== mediaId) {
      return;
    }
    out.push({ sec: ref.seconds, title: chapterTitle(nameAfter(blocks, index + 1, self), ref.seconds) });
  });
}

function collectList(items: readonly ListItem[], self: Self, mediaId: string, out: Found[], depth: number): void {
  if (depth > MAX_LIST_DEPTH) {
    return;
  }
  for (const item of items) {
    collect(item.blocks, self, mediaId, out, depth);
    collectList(item.items, self, mediaId, out, depth + 1);
  }
}

/**
 * The chapters of the video `mediaId` in `post`, sorted by second, one per
 * second. `durationSec` (when known, > 0) drops a timestamp at or past it.
 */
export function postChapters(post: Post, mediaId: string, durationSec?: number | null): Chapter[] {
  const mediaIds = post.blocks.flatMap(b => (b.type === 'ok_video' && b.id.length > 0 ? [b.id] : []));
  if (!mediaIds.includes(mediaId)) {
    return [];
  }
  const self = { blogUrl: post.author.blogUrl, postId: post.id, mediaIds };
  const found: Found[] = [];
  collect(post.blocks, self, mediaId, found);
  return chaptersWithin(dedupe(found), durationSec ?? null, { unknownKeepsAll: true });
}

function dedupe(found: readonly Found[]): Chapter[] {
  const seen = new Set<number>();
  const out: Chapter[] = [];
  for (const chapter of found) {
    if (!Number.isFinite(chapter.sec) || chapter.sec < 0 || seen.has(chapter.sec)) {
      continue;
    }
    seen.add(chapter.sec);
    out.push(chapter);
  }
  return out.sort((a, b) => a.sec - b.sec);
}

/**
 * The chapters inside a video of `durationSec`: a timestamp at or past the
 * duration is dropped. An unknown duration (null or ≤ 0) gives none (the
 * player shows no marks until the duration is known), unless
 * `unknownKeepsAll`.
 */
export function chaptersWithin(
  chapters: readonly Chapter[],
  durationSec: number | null,
  { unknownKeepsAll = false }: { unknownKeepsAll?: boolean } = {},
): Chapter[] {
  if (durationSec === null || !(durationSec > 0)) {
    return unknownKeepsAll ? [...chapters] : [];
  }
  return chapters.filter(chapter => chapter.sec < durationSec);
}

/** The index of the chapter playing at `sec` (the last one starting at or before it); -1 before the first. */
export function chapterIndexAt(chapters: readonly Chapter[], sec: number): number {
  let at = -1;
  for (let i = 0; i < chapters.length; i += 1) {
    if (chapters[i].sec <= sec) {
      at = i;
    } else {
      break;
    }
  }
  return at;
}

/** The chapter playing at `sec`; null before the first chapter (no name). */
export function chapterAt(chapters: readonly Chapter[], sec: number): Chapter | null {
  const at = chapterIndexAt(chapters, sec);
  return at >= 0 ? chapters[at] : null;
}

/**
 * Where a chapter jump from `sec` lands, or null (no jump):
 * - next: the first chapter starting after `sec`; none after the last one;
 * - previous (YouTube rule): more than `CHAPTER_RESTART_SEC` into the
 *   current chapter → its start; otherwise the previous chapter's start;
 *   before the first chapter (or within the first one's first seconds) →
 *   none.
 */
export function chapterJumpTarget(chapters: readonly Chapter[], sec: number, direction: 1 | -1): number | null {
  if (direction === 1) {
    const next = chapters.find(chapter => chapter.sec > sec);
    return next === undefined ? null : next.sec;
  }
  const at = chapterIndexAt(chapters, sec);
  if (at < 0) {
    return null;
  }
  if (sec - chapters[at].sec > CHAPTER_RESTART_SEC) {
    return chapters[at].sec;
  }
  return at > 0 ? chapters[at - 1].sec : null;
}
