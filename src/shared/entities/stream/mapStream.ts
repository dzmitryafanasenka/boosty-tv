import { streamCoverBlockDtoSchema, streamDtoSchema } from '../../api/dto/stream';
import { logger as appLogger, type Logger } from '../../services/logger';
import { safeHttpUrl } from '../externalUrls';
import type { Stream } from './types';

/**
 * The one Stream mapper (Story 7.1): a raw E15 200 body → `Stream`, or null
 * when there is no card to show:
 * - the body fails the schema (no `id`, `isOnline` or `hasAccess`, or one of
 *   them with another type): logged as a warning with the issue count only;
 * - the stream is neither online nor scheduled (`isTemplate`, e.g. it just
 *   ended): logged at info with those two booleans only.
 * Never logs a title, a URL, a signed query or an id. Pure and total:
 * nothing here throws.
 */

/** Epoch seconds below this (year ≈ 5138); larger values are milliseconds or junk. */
const MAX_START_TIME_SEC = 1e11;

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** The first teaser image, else the first block's video preview (http(s) only). */
function coverOf(teaser: readonly unknown[], data: readonly unknown[]): string | null {
  for (const raw of teaser) {
    const block = streamCoverBlockDtoSchema.safeParse(raw);
    if (block.success && block.data.type === 'image') {
      const url = safeHttpUrl(block.data.url);
      if (url) {
        return url;
      }
    }
  }
  for (const raw of data) {
    const block = streamCoverBlockDtoSchema.safeParse(raw);
    if (block.success) {
      const url = safeHttpUrl(block.data.preview) ?? safeHttpUrl(block.data.defaultPreview);
      if (url) {
        return url;
      }
    }
  }
  return null;
}

export function mapStream(raw: unknown, logger: Logger = appLogger): Stream | null {
  const parsed = streamDtoSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn('stream', 'dropped', { issues: parsed.error.issues.length });
    return null;
  }
  const dto = parsed.data;
  const scheduled = dto.isTemplate === true;
  if (!dto.isOnline && !scheduled) {
    // A 200 for a stream that just ended is not malformed: info, not warn.
    logger.info('stream', 'not live or scheduled', { isOnline: false, isTemplate: false });
    return null;
  }
  // Epoch seconds only: a millisecond value (≥ 1e11) or anything out of
  // range would render a year in the tens of thousands.
  const startTime =
    typeof dto.startTime === 'number' && Number.isFinite(dto.startTime) && dto.startTime > 0 && dto.startTime < MAX_START_TIME_SEC
      ? dto.startTime
      : null;
  return {
    id: String(dto.id),
    title: dto.title?.trim() ?? '',
    status: dto.isOnline ? 'live' : 'scheduled',
    hasAccess: dto.hasAccess,
    startTime,
    viewers: dto.count?.viewers ?? 0,
    likes: dto.count?.likes ?? 0,
    coverUrl: coverOf(dto.teaser ?? [], dto.data ?? []),
    levelName: nonEmpty(dto.subscriptionLevel?.name),
  };
}
