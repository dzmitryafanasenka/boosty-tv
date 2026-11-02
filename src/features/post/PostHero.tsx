import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { Post, VideoRow } from '../../shared/entities/post';
import { t, tf } from '../../shared/i18n';
import { formatDuration } from '../../shared/i18n/format';
import type { ProgressStatus } from '../../shared/services/progress';
import {
  Text,
  VideoIcon,
  colors,
  components,
  mediaRowLabel,
  postCardTitle,
  spacing,
  useItemState,
} from '../../shared/ui';
import { postMetaLine } from './PostHeader';

const HERO = components['post-hero'];
const PROGRESS_HEIGHT = components.timeline.trackHeight;

/**
 * The media line under the meta (Story 13.1): «Видео · 56:14 · осталось 44
 * мин» for one video; several name the target: «Видео 2 · «Вторая часть» ·
 * 24:30 · осталось 15 мин». The duration only when known; «осталось N мин»
 * / «просмотрено» only with a status (the player on; never a fake one).
 */
export function heroMediaLine(row: VideoRow, multi: boolean, status: ProgressStatus | null): string {
  const parts: string[] = [multi ? mediaRowLabel(row) : t('post.hero.video')];
  if (multi && row.title.length > 0) {
    parts.push(tf('post.hero.quoted', { title: row.title }));
  }
  if (row.durationSec !== null) {
    parts.push(formatDuration(row.durationSec));
  }
  if (status?.kind === 'inProgress') {
    parts.push(tf('post.hero.left', { n: String(status.minutesLeft) }));
  } else if (status?.kind === 'watched') {
    parts.push(t('post.hero.watched'));
  }
  return parts.reduce((head, part) => tf('post.hero.join', { head, part }));
}

/** The progress line's filled share (null: no line). */
function progressFraction(status: ProgressStatus | null): number | null {
  return status?.kind === 'inProgress' ? status.fraction : status?.kind === 'watched' ? 1 : null;
}

type HeroPreviewProps = {
  row: VideoRow;
  /** The post's video count (> 1: the «Видео N из M» badge). */
  count: number;
  status: ProgressStatus | null;
};

/**
 * The 16:9 preview (not a focus stop: the primary is its one action,
 * 2026-11-02 discussion): the target video's preview URL as a plain `Image`
 * with no headers; missing or failed → a neutral plate with the video glyph
 * at the same size. The duration at the bottom right, «Видео N из M» at the
 * top left for several videos, the accent progress line along the bottom.
 */
function HeroPreview({ row, count, status }: HeroPreviewProps) {
  // A failure belongs to one preview URL only.
  const [failed, setFailed] = useItemState(false, row.previewUrl ?? undefined);
  const preview = row.previewUrl && !failed ? row.previewUrl : null;
  const fraction = progressFraction(status);
  return (
    <View
      testID="post/hero/preview"
      focusable={false}
      style={styles.preview}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {preview ? (
        <Image
          key={preview}
          testID="post/hero/image"
          source={{ uri: preview }}
          resizeMode="cover"
          resizeMethod="resize"
          fadeDuration={0}
          onError={() => setFailed(true)}
          style={styles.image}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View testID="post/hero/plate" style={[styles.image, styles.plate]}>
          <VideoIcon color={HERO.glyphInk} size={HERO.glyph} />
        </View>
      )}
      {count > 1 ? (
        <View testID="post/hero/position" style={[styles.badge, styles.badgeTopLeft]} pointerEvents="none">
          <Text variant="badge" numberOfLines={1}>
            {tf('post.hero.ofCount', { n: String(row.index + 1), m: String(count) })}
          </Text>
        </View>
      ) : null}
      {row.durationSec !== null ? (
        <View testID="post/hero/duration" style={[styles.badge, styles.badgeBottomRight]} pointerEvents="none">
          <Text variant="badge" numberOfLines={1}>
            {formatDuration(row.durationSec)}
          </Text>
        </View>
      ) : null}
      {fraction !== null ? (
        <View testID="post/hero/progress" style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: Math.round(HERO.previewWidth * fraction) }]} />
        </View>
      ) : null}
    </View>
  );
}

export type PostHeroProps = {
  post: Post;
  /** The primary's target: the first unfinished video (all finished: the first). */
  target: VideoRow;
  /** The post's video count. */
  count: number;
  /** The target's status (`useProgress`); null while the player is off. */
  status: ProgressStatus | null;
  /** The action row (`PostActions`). */
  actions: ReactNode;
  nowMs?: number;
};

/**
 * Story 13.1 (mockup «Пост — новый макет», our improvement): the header of
 * a video post below the author row: the preview on the left; the title
 * (`title-l`), the meta line («date · likes · comments», read-only), the
 * media line and the action row on the right. Only the buttons are focus
 * stops. Sizes from `components['post-hero']`.
 */
export function PostHero({ post, target, count, status, actions, nowMs }: PostHeroProps) {
  return (
    <View testID="post/hero" style={styles.hero}>
      <HeroPreview row={target} count={count} status={status} />
      <View style={styles.text}>
        <Text
          testID="post/title"
          variant="title-l"
          accessibilityRole="header"
          numberOfLines={HERO.titleLines}
        >
          {postCardTitle(post)}
        </Text>
        <Text testID="post/meta" variant="meta" color="text-meta" style={styles.line}>
          {postMetaLine(post, nowMs)}
        </Text>
        <Text testID="post/hero/media" variant="meta" color="text-meta" numberOfLines={2} style={styles.line}>
          {heroMediaLine(target, count > 1, status)}
        </Text>
        <View style={styles.actions}>{actions}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: HERO.gap,
    marginBottom: spacing['10'],
  },
  preview: {
    width: HERO.previewWidth,
    height: HERO.previewHeight,
    borderRadius: HERO.radius,
    overflow: 'hidden',
    flexShrink: 0,
  },
  image: {
    width: HERO.previewWidth,
    height: HERO.previewHeight,
  },
  plate: {
    backgroundColor: HERO.plate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    height: components.badge.height,
    paddingHorizontal: spacing['3'],
    borderRadius: components.badge.radius,
    backgroundColor: components.badge.bg,
    justifyContent: 'center',
  },
  badgeTopLeft: {
    left: spacing['5'],
    top: spacing['5'],
  },
  badgeBottomRight: {
    right: spacing['5'],
    bottom: spacing['7'],
  },
  // The accent line along the preview's bottom edge (absolute: no reflow).
  track: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: HERO.previewWidth,
    height: PROGRESS_HEIGHT,
    backgroundColor: colors['overlay-badge'],
  },
  fill: {
    height: PROGRESS_HEIGHT,
    backgroundColor: HERO.progress,
  },
  // The text column takes the rest of the width; focus headroom for the buttons.
  text: {
    flex: 1,
    minWidth: 0,
  },
  line: {
    marginTop: spacing['5'],
  },
  actions: {
    marginTop: spacing['10'],
  },
});
