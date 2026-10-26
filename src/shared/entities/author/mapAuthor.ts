import { subscriptionDtoSchema, type BlogDto } from '../../api/dto/subscriptions';
import { logger as appLogger, type Logger } from '../../services/logger';
import type { Author } from './types';

/**
 * The one Author mapper (AD-8). A dropped item is logged with the names of
 * the failing fields only, never content.
 */

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** A parsed blog DTO → Author (E2 items now, E3 in Story 3.3). */
export function authorFromBlog(blog: BlogDto): Author {
  const owner = blog.owner;
  return {
    blogUrl: blog.blogUrl,
    title: blog.title?.trim() ?? '',
    ownerName: nonEmpty(owner?.name),
    avatarUrl: owner?.hasAvatar === false ? null : nonEmpty(owner?.avatarUrl),
  };
}

/** One E2 item (`unknown`) → Author, or null without a valid `blog.blogUrl`. */
export function mapSubscription(raw: unknown, logger: Logger = appLogger): Author | null {
  const parsed = subscriptionDtoSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn('author', 'dropped', {
      fields: [
        ...new Set(parsed.error.issues.map(issue => issue.path.join('.') || '<root>')),
      ].join(','),
    });
    return null;
  }
  return authorFromBlog(parsed.data.blog);
}

