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
  textBlockDtoSchema,
} from '../../api/dto/post';
import { logger as appLogger, type Logger } from '../../services/logger';
import type { Block, ListItem, Post, PostKind } from './types';

/**
 * The one Post mapper (AD-8): `unknown` (one post of E4/E5/E8) → `Post`, or
 * null when a required field is missing. A dropped post is logged with its
 * id (if any) and the names of the failing fields only, never content.
 * Unknown or malformed blocks become `Block.Unknown`; nothing here throws.
 */

const MAX_LIST_DEPTH = 8;

/** `text`/`link` content: a JSON string `[text, style, ranges]`, else raw text. */
export function textOf(content: string | null | undefined): string {
  if (!content) {
    return '';
  }
  if (content.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return typeof parsed[0] === 'string' ? parsed[0] : '';
      }
    } catch {
      // Not JSON: the content is raw text.
    }
  }
  return content;
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
            text: textOf(b.data.content),
            paragraphEnd: b.data.modificator === 'BLOCK_END',
          }
        : unknown;
    }
    case 'link': {
      const b = linkBlockDtoSchema.safeParse(raw);
      return b.success
        ? { type: 'link', text: textOf(b.data.content), url: nonEmpty(b.data.url) }
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
  const videos = blocks.filter(b => b.type === 'ok_video').length;
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
    levelName: nonEmpty(dto.subscriptionLevel?.name),
  };
}
