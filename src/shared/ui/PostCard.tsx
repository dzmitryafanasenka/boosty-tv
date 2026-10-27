import { memo, type Ref } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { firstText, type Post, type PostKind } from '../entities/post';
import { t, tf } from '../i18n';
import { formatCardDate, formatDuration } from '../i18n/format';
import { FocusableSurface, type FocusableSurfaceProps, type HostView } from './FocusableSurface';
import { Text } from './Text';
import { useItemState } from './useItemState';
import { colors, components, rounded, spacing } from './tokens';

/**
 * DESIGN.md PostCard / UX-DR6: a 16:9 preview with the type badge at the
 * top left and the duration at the bottom right (only when the API gives
 * it), then a 2-line title and avatar · author · date. Locked: dimmed
 * preview, lock glyph and the «Нет доступа» badge; never a price or a
 * subscribe action. No comment count anywhere.
 *
 * The width is the grid's: the token width (168) leaves no horizontal focus
 * headroom in the 720 dp content (4 × 168 + 3 × 16 = 720), so the feed
 * passes a narrower card (`postCardWidth`), see FeedGrid.
 */

const TOKENS = components['post-card'];
const BADGE = components.badge;
const AVATAR = components.avatar.meta;
const TITLE_HEIGHT = TOKENS.title.lineHeight * TOKENS.titleLines;
const TITLE_GAP = spacing['4'];
const META_GAP = spacing['2'];
const META_HEIGHT = AVATAR;
/** DESIGN.md «dimmed preview» for a locked card. */
const LOCKED_PREVIEW_OPACITY = 0.4;
const LOCK = { body: 14, shackle: 10 } as const;

/** Card width for `columns` cards in `contentWidth`, with focus headroom on both sides. */
export function postCardWidth(contentWidth: number, columns: number): number {
  const inner = contentWidth - 2 * spacing['focus-headroom'] - (columns - 1) * spacing['card-gap-x'];
  return Math.floor(inner / columns);
}

export function postCardThumbHeight(width: number): number {
  return Math.round((width * 9) / 16);
}

/** The card's fixed height (thumb, title block, meta row), for `getItemLayout`. */
export function postCardHeight(width: number): number {
  return postCardThumbHeight(width) + TITLE_GAP + TITLE_HEIGHT + META_GAP + META_HEIGHT;
}

export function postBadgeLabel(kind: PostKind): string {
  switch (kind.kind) {
    case 'videos':
      return tf('postCard.badge.videos', { n: String(kind.count) });
    default:
      return t(`postCard.badge.${kind.kind}`);
  }
}

/** The visible title: the post title, else its first text, else «Без названия». */
export function postCardTitle(post: Post): string {
  const title = post.title.trim();
  if (title.length > 0) {
    return title;
  }
  const text = firstText(post.blocks);
  return text.length > 0 ? text : t('postCard.untitled');
}

export function postCardA11yLabel(post: Post, nowMs?: number): string {
  const values = {
    badge: postBadgeLabel(post.kind),
    title: postCardTitle(post),
    author: post.author.name,
    date: formatCardDate(post.publishedAt, nowMs),
  };
  return post.durationSec !== null
    ? tf('postCard.a11yDuration', { ...values, duration: formatDuration(post.durationSec) })
    : tf('postCard.a11y', values);
}

export type PostCardProps = {
  post: Post;
  width: number;
  /** Epoch ms for the date label (tests); defaults to now. */
  nowMs?: number;
  testID?: string;
  onFocus?: FocusableSurfaceProps['onFocus'];
  /** OK on the card (Главная and Автор open Пост, Story 3.4). */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<HostView>;
};

/** Two absolutely placed views centered on the thumb (no container view). */
function LockGlyph({
  testID,
  width,
  thumbHeight,
}: {
  testID?: string;
  width: number;
  thumbHeight: number;
}) {
  const top = (thumbHeight - (LOCK.shackle + LOCK.body - 3)) / 2;
  return (
    <>
      <View
        testID={testID}
        pointerEvents="none"
        style={[styles.lockShackle, { top, left: (width - LOCK.shackle) / 2 }]}
      />
      <View
        pointerEvents="none"
        style={[styles.lockBody, { top: top + LOCK.shackle, left: (width - LOCK.body) / 2 }]}
      />
    </>
  );
}

function Avatar({ url }: { url: string | null }) {
  // Recycled cells (ADR 0011): a failure belongs to one URL only.
  const [failed, setFailed] = useItemState(false, url ?? undefined);
  return url && !failed ? (
    <Image
      // Keyed by the URL: a recycled cell never shows the previous author's
      // avatar while the new one loads (only this view remounts, not the cell).
      key={url}
      source={{ uri: url }}
      resizeMethod="resize"
      fadeDuration={0}
      style={styles.avatar}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <View style={[styles.avatar, styles.avatarPlaceholder]} />
  );
}

export function PostCardView({
  post,
  width,
  nowMs,
  testID,
  onFocus,
  onPress,
  style,
  ref,
}: PostCardProps) {
  // Recycled cells (ADR 0011): per-post state starts over for each post.
  const [previewFailed, setPreviewFailed] = useItemState(false, post.id);
  const locked = !post.hasAccess;
  const thumbHeight = postCardThumbHeight(width);
  const preview = post.previewUrl && !previewFailed ? post.previewUrl : null;
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      accessibilityRole="button"
      accessibilityLabel={postCardA11yLabel(post, nowMs)}
      onFocus={onFocus}
      onPress={onPress}
      style={style}
      resetKey={post.id}
      surfaceStyle={() => ({ width })}
    >
      {/*
        Flat on purpose (Story 3.1 device profiling: mounting ≈ 37 ms of
        native work per card): the thumb is the Image itself (or the
        placeholder View), the badges are single Texts with their own
        background, and the lock and badges are placed absolutely on the
        surface, whose top-left is the thumb's.
      */}
      {preview ? (
        <Image
          // Keyed by the URL: a recycled cell never shows the previous post's
          // preview while the new one loads (only this view remounts).
          key={preview}
          testID={testID ? `${testID}/preview` : undefined}
          source={{ uri: preview }}
          resizeMode="cover"
          resizeMethod="resize"
          fadeDuration={0}
          onError={() => setPreviewFailed(true)}
          style={[styles.thumb, { width, height: thumbHeight }, locked && styles.dimmed]}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.thumb, { width, height: thumbHeight }]} />
      )}
      {locked ? (
        <LockGlyph
          testID={testID ? `${testID}/lock` : undefined}
          width={width}
          thumbHeight={thumbHeight}
        />
      ) : null}
      <Text
        testID={testID ? `${testID}/badge` : undefined}
        variant="badge"
        numberOfLines={1}
        style={[styles.badge, styles.badgeTopLeft]}
      >
        {postBadgeLabel(post.kind)}
      </Text>
      {post.durationSec !== null ? (
        <Text
          testID={testID ? `${testID}/duration` : undefined}
          variant="badge"
          numberOfLines={1}
          style={[
            styles.badge,
            styles.badgeRight,
            { top: thumbHeight - spacing['3'] - BADGE.height },
          ]}
        >
          {formatDuration(post.durationSec)}
        </Text>
      ) : null}
      <Text
        variant="card-title"
        color="text-card"
        numberOfLines={TOKENS.titleLines}
        style={styles.title}
      >
        {postCardTitle(post)}
      </Text>
      <View style={styles.meta}>
        <Avatar url={post.author.avatarUrl} />
        <Text
          testID={testID ? `${testID}/author` : undefined}
          variant="meta"
          color="text-meta"
          numberOfLines={1}
          style={styles.metaAuthor}
        >
          {post.author.name}
        </Text>
        <Text
          testID={testID ? `${testID}/date` : undefined}
          variant="meta"
          color="text-meta"
          numberOfLines={1}
          style={styles.metaDate}
        >
          {tf('postCard.metaDate', { date: formatCardDate(post.publishedAt, nowMs) })}
        </Text>
      </View>
    </FocusableSurface>
  );
}

/**
 * Memoized: a card re-renders only when its own props change (a focus move
 * re-renders only the focus state inside FocusableSurface).
 */
export const PostCard = memo(PostCardView);

/** DESIGN.md Skeleton: a non-focusable block with the card's geometry. */
export function PostCardSkeleton({
  width,
  testID,
  style,
}: {
  width: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      testID={testID}
      style={[{ width, height: postCardHeight(width) }, style]}
      focusable={false}
    >
      <View style={[styles.thumb, { width, height: postCardThumbHeight(width) }]} />
      <View style={[styles.skeletonLine, styles.skeletonFirst, { width: width * 0.9 }]} />
      <View style={[styles.skeletonLine, styles.skeletonNext, { width: width * 0.6 }]} />
      <View style={[styles.skeletonLine, styles.skeletonNext, { width: width * 0.7 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: {
    borderRadius: TOKENS.radius,
    backgroundColor: colors.skeleton,
    overflow: 'hidden',
  },
  dimmed: {
    opacity: LOCKED_PREVIEW_OPACITY,
  },
  // One Text per badge: its own background, radius and padding; the text
  // is centered in the 20 dp box.
  badge: {
    ...BADGE.text,
    position: 'absolute',
    height: BADGE.height,
    lineHeight: BADGE.height,
    textAlignVertical: 'center',
    borderRadius: BADGE.radius,
    backgroundColor: BADGE.bg,
    paddingHorizontal: spacing['3'],
    overflow: 'hidden',
  },
  badgeTopLeft: {
    top: spacing['3'],
    left: spacing['3'],
  },
  badgeRight: {
    right: spacing['3'],
  },
  title: {
    marginTop: TITLE_GAP,
    height: TITLE_HEIGHT,
  },
  meta: {
    marginTop: META_GAP,
    height: META_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // A long author name ellipsizes; « · date» always stays whole.
  metaAuthor: {
    flexShrink: 1,
    marginLeft: spacing['3'],
  },
  metaDate: {
    flexShrink: 0,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: rounded.full,
  },
  avatarPlaceholder: {
    backgroundColor: colors['surface-raised'],
  },
  lockShackle: {
    position: 'absolute',
    width: LOCK.shackle,
    height: LOCK.shackle,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderColor: colors.text,
    borderTopLeftRadius: LOCK.shackle / 2,
    borderTopRightRadius: LOCK.shackle / 2,
  },
  lockBody: {
    position: 'absolute',
    width: LOCK.body,
    height: LOCK.body - 3,
    borderRadius: rounded.sm / 2,
    backgroundColor: colors.text,
  },
  skeletonLine: {
    height: spacing['6'],
    borderRadius: rounded.sm,
    backgroundColor: colors.skeleton,
  },
  skeletonFirst: {
    marginTop: TITLE_GAP + spacing['1'],
  },
  skeletonNext: {
    marginTop: spacing['4'],
  },
});
