import { memo, type Ref } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { tf } from '../i18n';
import type { ProgressStatus } from '../services/progress/finished';
import { FocusableSurface, type FocusableSurfaceProps, type HostView } from './FocusableSurface';
import { POST_CARD_TEXT, postCardHeight, postCardThumbHeight } from './PostCard';
import { Text } from './Text';
import { useItemState } from './useItemState';
import { colors, components } from './tokens';

/**
 * A «Продолжить просмотр» card (Story 4.7, Главная): the same size and
 * tokens as a feed PostCard (owner decision 2026-10-28: the row's columns
 * line up with the grid). A 16:9 preview with an accent progress line
 * along its bottom edge, the title (2 lines), then «author · Осталось N
 * мин». No line and no remaining time without a known duration (never a
 * fake status). The preview is a plain `Image` without headers; missing or
 * failed → a neutral plate.
 */

const TOKENS = components['post-card'];
const PROGRESS_HEIGHT = components.timeline.trackHeight;

export type ContinueCardProps = {
  /** The video title rule is the caller's (`videoDisplayTitle`). */
  title: string;
  authorName: string;
  previewUrl: string | null;
  /** The progress status (`progressStatus`): «Осталось N мин» and the line only when in progress. */
  status: ProgressStatus;
  width: number;
  testID?: string;
  onFocus?: FocusableSurfaceProps['onFocus'];
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** The media id: per-card state (a failed preview) starts over for another video. */
  resetKey: string;
  ref?: Ref<HostView>;
};

/** «Осталось N мин» (null: unknown duration). */
export function continueCardLeft(status: ProgressStatus): string | null {
  return status.kind === 'inProgress' ? tf('post.video.status.left', { n: String(status.minutesLeft) }) : null;
}

/**
 * «{title}. {author}. Осталось N мин», leaving out the remaining time when
 * unknown and the author when empty.
 */
export function continueCardA11yLabel(title: string, authorName: string, status: ProgressStatus): string {
  const left = continueCardLeft(status);
  const author = authorName.trim();
  if (author.length === 0) {
    return left === null ? title : tf('home.continue.a11yNoAuthor', { title, left });
  }
  return left === null
    ? tf('home.continue.a11yNoLeft', { title, author })
    : tf('home.continue.a11y', { title, author, left });
}

export function ContinueCardView({
  title,
  authorName,
  previewUrl,
  status,
  width,
  testID,
  onFocus,
  onPress,
  style,
  resetKey,
  ref,
}: ContinueCardProps) {
  const [failed, setFailed] = useItemState(false, `${resetKey}\n${previewUrl ?? ''}`);
  const thumbHeight = postCardThumbHeight(width);
  const preview = previewUrl && !failed ? previewUrl : null;
  const left = continueCardLeft(status);
  const fraction = status.kind === 'inProgress' ? status.fraction : null;
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      accessibilityRole="button"
      accessibilityLabel={continueCardA11yLabel(title, authorName, status)}
      onFocus={onFocus}
      onPress={onPress}
      style={style}
      resetKey={resetKey}
      surfaceStyle={() => ({ width, height: postCardHeight(width) })}
    >
      {preview ? (
        <Image
          key={preview}
          testID={testID ? `${testID}/preview` : undefined}
          source={{ uri: preview }}
          resizeMode="cover"
          resizeMethod="resize"
          fadeDuration={0}
          onError={() => setFailed(true)}
          style={[styles.thumb, { width, height: thumbHeight }]}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          testID={testID ? `${testID}/preview-placeholder` : undefined}
          style={[styles.thumb, { width, height: thumbHeight }]}
        />
      )}
      {fraction !== null ? (
        <View
          testID={testID ? `${testID}/progress` : undefined}
          pointerEvents="none"
          style={[styles.track, { top: thumbHeight - PROGRESS_HEIGHT, width }]}
        >
          <View style={[styles.fill, { width: Math.round(width * fraction) }]} />
        </View>
      ) : null}
      <Text
        testID={testID ? `${testID}/title` : undefined}
        variant="card-title"
        color="text-card"
        numberOfLines={TOKENS.titleLines}
        style={styles.title}
      >
        {title}
      </Text>
      <View style={styles.meta}>
        <Text
          testID={testID ? `${testID}/author` : undefined}
          variant="meta"
          color="text-meta"
          numberOfLines={1}
          style={styles.metaAuthor}
        >
          {authorName}
        </Text>
        {left !== null ? (
          <Text
            testID={testID ? `${testID}/left` : undefined}
            variant="meta"
            color="text-meta"
            numberOfLines={1}
            style={styles.metaLeft}
          >
            {authorName.trim().length > 0 ? tf('home.continue.metaLeft', { left }) : left}
          </Text>
        ) : null}
      </View>
    </FocusableSurface>
  );
}

/** Memoized: a focus move re-renders only the focus state inside FocusableSurface. */
export const ContinueCard = memo(ContinueCardView);

const styles = StyleSheet.create({
  thumb: {
    borderRadius: TOKENS.radius,
    backgroundColor: colors.skeleton,
    overflow: 'hidden',
  },
  // The accent line over the preview's bottom edge (absolute: no reflow).
  track: {
    position: 'absolute',
    left: 0,
    height: PROGRESS_HEIGHT,
    backgroundColor: colors['overlay-badge'],
  },
  fill: {
    height: PROGRESS_HEIGHT,
    backgroundColor: components['media-row'].progress,
  },
  title: {
    marginTop: POST_CARD_TEXT.titleGap,
    height: POST_CARD_TEXT.titleHeight,
  },
  meta: {
    marginTop: POST_CARD_TEXT.metaGap,
    height: POST_CARD_TEXT.metaHeight,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // A long author name ellipsizes; « · Осталось N мин» always stays whole.
  metaAuthor: {
    flexShrink: 1,
  },
  metaLeft: {
    flexShrink: 0,
  },
});
