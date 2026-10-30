import { eventDtoSchema, type EventDto } from '../../api/dto/events';
import { blogUrlSchema } from '../../api/dto/subscriptions';
import { logger as appLogger, type Logger } from '../../services/logger';
import { safeHttpUrl } from '../externalUrls';
import type { Event } from './types';

/**
 * The one Event mapper (Story 7.5): the raw E18 items → the shown rows,
 * newest first. Pure and total: nothing here throws.
 *
 * - A malformed event (no `id` or `type`, or a bad `eventTime`) is dropped
 *   on its own: one warning with the count only.
 * - Comment types (any type containing `comment`, case-insensitive:
 *   comments are excluded everywhere) and the blog-owner types (owner
 *   decision 2026-10-30, Q3 a, compared case-insensitively) are never shown.
 * - A shown type outside `KNOWN_SHOWN_EVENT_TYPES` (generic text) is counted
 *   in an info log (the count only).
 * - A repeated id keeps its first occurrence (the row's identity).
 * Never logs a name, a URL, an id or a type.
 */

/** The stream start: «Начался эфир» and the «Эфир» chip. */
export const STREAM_EVENT_TYPE = 'video_stream_start';

/** Shown types with their own text; any other shown type gets the generic text. */
export const KNOWN_SHOWN_EVENT_TYPES = ['video_stream_start', 'post_new', 'promo_new'] as const;

/** Exact blog-owner types (Q3 a): about the account's own blog, not its subscriptions. */
const OWNER_TYPES: ReadonlySet<string> = new Set([
  'donation_new',
  'subscriber_new',
  'post_buy',
  'message_buy',
  'bundle_buy',
  'support_ticket_update',
  'level_subscribers_limit_reached',
  'target_new',
]);
/** Prefixes of hidden owner families (Q3 a): stat reports and referrals. */
const HIDDEN_PREFIXES = ['blog_stat_report_', 'referal_'] as const;
const KNOWN_SHOWN: ReadonlySet<string> = new Set(KNOWN_SHOWN_EVENT_TYPES);

/** Epoch seconds below this (year ≈ 5138); larger values are milliseconds or junk. */
const MAX_EVENT_TIME_SEC = 1e11;

/** A type that is never shown (comments, blog-owner events); case-insensitive. */
export function isHiddenEventType(type: string): boolean {
  const lower = type.toLowerCase();
  return (
    lower.includes('comment') ||
    OWNER_TYPES.has(lower) ||
    HIDDEN_PREFIXES.some(prefix => lower.startsWith(prefix))
  );
}

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * `blog.blogUrl`; for the known subscriber types only, else
 * `target.bloggerUrl` (inferred: `target` was seen live only on the hidden
 * owner-side `target_new`). Only a value that passes `blogUrlSchema`.
 */
function blogOf(dto: EventDto): string | null {
  const sources = KNOWN_SHOWN.has(dto.type) ? [dto.blog?.blogUrl, dto.target?.bloggerUrl] : [dto.blog?.blogUrl];
  for (const raw of sources) {
    const parsed = blogUrlSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return null;
}

export function mapEvents(items: readonly unknown[], logger: Logger = appLogger): Event[] {
  let dropped = 0;
  let hidden = 0;
  let repeated = 0;
  let unknown = 0;
  const seen = new Set<string>();
  const events: Event[] = [];
  for (const raw of items) {
    const parsed = eventDtoSchema.safeParse(raw);
    const time = parsed.success ? parsed.data.eventTime : NaN;
    if (!parsed.success || !(time > 0 && time < MAX_EVENT_TIME_SEC)) {
      dropped += 1;
      continue;
    }
    const dto = parsed.data;
    if (isHiddenEventType(dto.type)) {
      hidden += 1;
      continue;
    }
    const id = String(dto.id);
    if (seen.has(id)) {
      repeated += 1;
      continue;
    }
    seen.add(id);
    if (!KNOWN_SHOWN.has(dto.type)) {
      unknown += 1;
    }
    const author = dto.author;
    events.push({
      id,
      type: dto.type,
      kind: dto.type === STREAM_EVENT_TYPE ? 'stream' : 'generic',
      time,
      isRead: dto.isRead !== false,
      authorName: nonEmpty(author?.name),
      avatarUrl: author?.hasAvatar === false ? null : safeHttpUrl(author?.avatarUrl),
      blogUrl: blogOf(dto),
    });
  }
  if (dropped > 0) {
    logger.warn('event', 'dropped', { count: dropped });
  }
  if (hidden > 0 || repeated > 0) {
    logger.info('event', 'not shown', { hidden, repeated });
  }
  if (unknown > 0) {
    logger.info('event', 'unknown types shown', { count: unknown });
  }
  // Newest first; equal times keep the API's order (a stable sort).
  return events.sort((a, b) => b.time - a.time);
}
