import {
  audioBlockDtoSchema,
  blockTypeDtoSchema,
  fileBlockDtoSchema,
  imageBlockDtoSchema,
  linkBlockDtoSchema,
  listBlockDtoSchema,
  listItemDtoSchema,
  okVideoBlockDtoSchema,
  pollBlockDtoSchema,
  postDtoSchema,
  smileBlockDtoSchema,
  textBlockDtoSchema,
} from '../../api/dto/post';
import { logger as appLogger, type Logger } from '../../services/logger';
import type { Block, ListItem, Post, PostKind, TextSpan, TextStyle } from './types';

/**
 * The one Post mapper (AD-8): `unknown` (one post of E4/E5/E8) → `Post`, or
 * null when a required field is missing. A dropped post is logged with its
 * id (if any) and the names of the failing fields only, never content.
 * Unknown or malformed blocks become `Block.Unknown`; nothing here throws.
 */

const MAX_LIST_DEPTH = 8;

/** api-contract §4.1 style codes; any other code renders as normal text. */
const STYLE_CODES: Readonly<Record<number, TextStyle>> = { 0: 'bold', 2: 'italic', 4: 'underline' };

/** A fragment's plain text and its style ranges (Story 6.1). */
export type StyledText = { text: string; spans: TextSpan[] };

/** `content` parsed as the JSON array `[text, style, ranges]`; undefined when it is not one. */
function contentArray(content: string): unknown[] | undefined {
  if (!content.startsWith('[')) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    // Not JSON: the content is raw text.
    return undefined;
  }
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

/**
 * The style ranges `[[code, from, len], …]` of a `text`/`link` fragment.
 * Live (Story 6.1, api-contract §4.1 «Text styles and smile (LIVE)»):
 * `from` counts from the start of the paragraph the fragment belongs to,
 * not from the fragment, so the ranges are kept as given here and the
 * paragraph builder places and clamps them. Only known codes are kept; an
 * empty, negative (`from` < 0 or `len` ≤ 0) or malformed range is dropped. A value that is not an array is no ranges. Total: never throws.
 */
function spansOf(raw: unknown): TextSpan[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const spans: TextSpan[] = [];
  for (const range of raw) {
    if (!Array.isArray(range) || range.length < 3) {
      continue;
    }
    const [code, from, len] = range as unknown[];
    if (!isInt(code) || !isInt(from) || !isInt(len) || from < 0 || len <= 0) {
      continue;
    }
    const style = STYLE_CODES[code];
    if (style === undefined) {
      continue;
    }
    spans.push({ style, from, len });
  }
  return spans;
}

/**
 * `text`/`link` content (api-contract §4.1): a JSON string `[text, style,
 * ranges]` gives its text and style ranges; any other content is raw text
 * with no styles. A malformed range list drops only the styles.
 */
export function styledTextOf(content: string | null | undefined): StyledText {
  if (!content) {
    return { text: '', spans: [] };
  }
  const parsed = contentArray(content);
  if (parsed === undefined) {
    return { text: content, spans: [] };
  }
  const text = typeof parsed[0] === 'string' ? parsed[0] : '';
  return { text, spans: spansOf(parsed[2]) };
}

/** `text`/`link` content as plain text (titles and other plain-text callers). */
export function textOf(content: string | null | undefined): string {
  return styledTextOf(content).text;
}

const nonEmpty = (value: string | null | undefined): string | null =>
  value ? value : null;

const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function mapListItems(raw: readonly unknown[] | null | undefined, depth: number): ListItem[] {
  if (!raw || depth > MAX_LIST_DEPTH) {
    return [];
  }
  const items: ListItem[] = [];
  for (const entry of raw) {
    const parsed = listItemDtoSchema.safeParse(entry);
    if (parsed.success) {
      items.push({
        blocks: mapBlocks(parsed.data.data, depth + 1),
        items: mapListItems(parsed.data.items, depth + 1),
      });
    }
  }
  return items;
}

function mapBlock(raw: unknown, depth: number): Block {
  const typed = blockTypeDtoSchema.safeParse(raw);
  if (!typed.success) {
    return { type: 'unknown', rawType: '' };
  }
  const unknown: Block = { type: 'unknown', rawType: typed.data.type };
  switch (typed.data.type) {
    case 'text': {
      const b = textBlockDtoSchema.safeParse(raw);
      return b.success
        ? {
            type: 'text',
            ...styledTextOf(b.data.content),
            paragraphEnd: b.data.modificator === 'BLOCK_END',
          }
        : unknown;
    }
    case 'link': {
      const b = linkBlockDtoSchema.safeParse(raw);
      return b.success
        ? { type: 'link', ...styledTextOf(b.data.content), url: nonEmpty(b.data.url) }
        : unknown;
    }
    case 'smile': {
      const b = smileBlockDtoSchema.safeParse(raw);
      return b.success
        ? {
            type: 'smile',
            name: b.data.name ?? '',
            url:
              nonEmpty(b.data.mediumUrl) ?? nonEmpty(b.data.largeUrl) ?? nonEmpty(b.data.smallUrl),
          }
        : unknown;
    }
    case 'image': {
      const b = imageBlockDtoSchema.safeParse(raw);
      return b.success
        ? {
            type: 'image',
            id: nonEmpty(b.data.id),
            url: nonEmpty(b.data.url),
            width: finite(b.data.width),
            height: finite(b.data.height),
          }
        : unknown;
    }
    case 'ok_video': {
      const b = okVideoBlockDtoSchema.safeParse(raw);
      if (!b.success) {
        return unknown;
      }
      const duration = finite(b.data.duration);
      return {
        type: 'ok_video',
        id: b.data.id,
        title: b.data.title ?? '',
        durationSec: duration !== null && duration > 0 ? duration : null,
        previewUrl: nonEmpty(b.data.preview) ?? nonEmpty(b.data.defaultPreview),
      };
    }
    case 'audio_file': {
      const b = audioBlockDtoSchema.safeParse(raw);
      return b.success
        ? {
            type: 'audio_file',
            id: nonEmpty(b.data.id),
            title: b.data.title ?? '',
            durationSec: finite(b.data.duration),
          }
        : unknown;
    }
    case 'file': {
      const b = fileBlockDtoSchema.safeParse(raw);
      return b.success
        ? {
            type: 'file',
            id: nonEmpty(b.data.id),
            title: b.data.title ?? '',
            sizeBytes: finite(b.data.size),
          }
        : unknown;
    }
    case 'poll': {
      const b = pollBlockDtoSchema.safeParse(raw);
      return b.success
        ? {
            type: 'poll',
            id: b.data.id === null || b.data.id === undefined ? null : String(b.data.id),
          }
        : unknown;
    }
    case 'list': {
      const b = listBlockDtoSchema.safeParse(raw);
      return b.success ? { type: 'list', items: mapListItems(b.data.items, depth) } : unknown;
    }
    default:
      return unknown;
  }
}

function mapBlocks(raw: readonly unknown[] | null | undefined, depth = 0): Block[] {
  return raw ? raw.map(block => mapBlock(block, depth)) : [];
}

/** The badge kind: locked, then video(s), audio, poll, file, text and photos. */
export function kindOf(hasAccess: boolean, blocks: readonly Block[]): PostKind {
  if (!hasAccess) {
    return { kind: 'locked' };
  }
  // As the Post screen's MediaRows (Story 3.5): distinct non-empty ids. A
  // post whose videos all lack an id keeps the count of its video blocks.
  const videoBlocks = blocks.filter(b => b.type === 'ok_video');
  const ids = new Set(videoBlocks.map(b => b.id).filter(id => id.length > 0));
  const videos = ids.size > 0 ? ids.size : videoBlocks.length;
  if (videos > 1) {
    return { kind: 'videos', count: videos };
  }
  if (videos === 1) {
    return { kind: 'video' };
  }
  if (blocks.some(b => b.type === 'audio_file')) {
    return { kind: 'audio' };
  }
  if (blocks.some(b => b.type === 'poll')) {
    return { kind: 'poll' };
  }
  if (blocks.some(b => b.type === 'file')) {
    return { kind: 'file' };
  }
  return { kind: 'text' };
}

/** First video preview → first image → teaser image → none. */
export function previewOf(blocks: readonly Block[], teaser: readonly Block[]): string | null {
  for (const b of blocks) {
    if (b.type === 'ok_video' && b.previewUrl) {
      return b.previewUrl;
    }
  }
  for (const b of blocks) {
    if (b.type === 'image' && b.url) {
      return b.url;
    }
  }
  for (const b of teaser) {
    if (b.type === 'image' && b.url) {
      return b.url;
    }
  }
  return null;
}

/** The first non-empty text of the post (a card title fallback). */
export function firstText(blocks: readonly Block[]): string {
  for (const b of blocks) {
    if ((b.type === 'text' || b.type === 'link') && b.text.trim().length > 0) {
      return b.text.trim();
    }
  }
  return '';
}

export function mapPost(raw: unknown, logger: Logger = appLogger): Post | null {
  const parsed = postDtoSchema.safeParse(raw);
  if (!parsed.success) {
    const id =
      raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string'
        ? (raw as { id: string }).id
        : undefined;
    logger.warn('post', 'dropped', {
      id,
      fields: [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))].join(','),
    });
    return null;
  }
  const dto = parsed.data;
  const blocks = mapBlocks(dto.data);
  const teaser = mapBlocks(dto.teaser);
  const hasAccess = dto.hasAccess !== false && blocks.length > 0;
  const videos = blocks.filter(b => b.type === 'ok_video');
  return {
    id: dto.id,
    intId: dto.int_id,
    title: dto.title ?? '',
    publishedAt:
      typeof dto.publishTime === 'number' && Number.isFinite(dto.publishTime)
        ? dto.publishTime
        : dto.createdAt,
    author: {
      name: dto.user.name,
      blogUrl: dto.user.blogUrl,
      avatarUrl: nonEmpty(dto.user.avatarUrl),
    },
    hasAccess,
    blocks: hasAccess ? blocks : [],
    teaser,
    kind: kindOf(hasAccess, blocks),
    previewUrl: previewOf(hasAccess ? blocks : [], teaser),
    durationSec:
      hasAccess && videos.length === 1 && videos[0].type === 'ok_video'
        ? videos[0].durationSec
        : null,
    // Trimmed: a blank name is no level (Story 3.6, the copy without a level).
    levelName: nonEmpty(dto.subscriptionLevel?.name?.trim()),
    likeCount: dto.count?.likes ?? null,
    pinned: dto.isPinned === true,
  };
}
