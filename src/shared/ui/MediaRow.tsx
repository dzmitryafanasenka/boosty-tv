import { memo, type Ref } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { VideoRow } from '../entities/post';
import { tf } from '../i18n';
import { formatDuration } from '../i18n/format';
import { FocusableSurface, type FocusableSurfaceProps, type HostView, type SurfaceState } from './FocusableSurface';
import { Text } from './Text';
import { useItemState } from './useItemState';
import { colors, components, spacing } from './tokens';

/**
 * DESIGN.md MediaRow (Story 3.5): one row per video of a post: a 96×54
 * thumbnail, «Видео N», the title (when it has one) and the duration (when
 * the API gives it). Focusable for reading; no status, progress line or
 * action yet: progress is Epic 4's ProgressRepository, and «Смотреть» comes
 * with the player behind `phaseFlags.player` (off), passed down as
 * `playable`. While it is false the row has no `onPress`, no action label
 * and the text role (a button role with no action would be a TalkBack dead
 * end). Never a fake «Не начато».
 *
 * The thumbnail is the video's preview URL with no auth headers (a plain
 * `Image`), `resizeMethod="resize"` and `fadeDuration={0}`; a missing or
 * failed preview is a neutral plate.
 */

const TOKENS = components['media-row'];
const [THUMB_WIDTH, THUMB_HEIGHT] = TOKENS.thumb.split('x').map(Number);

/** «Видео N» (N = the row's position, from 1). */
export function mediaRowLabel(row: VideoRow): string {
  return tf('post.video.label', { n: String(row.index + 1) });
}

/** «Видео N. {title}. {duration}», leaving out the parts the row does not have. */
export function mediaRowA11yLabel(row: VideoRow): string {
  const label = mediaRowLabel(row);
  const duration = row.durationSec !== null ? formatDuration(row.durationSec) : null;
  if (row.title.length > 0) {
    return duration !== null
      ? tf('post.video.a11y', { label, title: row.title, duration })
      : tf('post.video.a11yNoDuration', { label, title: row.title });
  }
  return duration !== null
    ? tf('post.video.a11yNoTitle', { label, duration })
    : tf('post.video.a11yLabelOnly', { label });
}

export type MediaRowProps = {
  row: VideoRow;
  /**
   * `phaseFlags.player` from the app. False: no action, text role. True:
   * the button role; the action itself (OK → Player) is Epic 4's, so there
   * is still nothing to call in Story 3.5.
   */
  playable: boolean;
  testID?: string;
  onFocus?: FocusableSurfaceProps['onFocus'];
  style?: StyleProp<ViewStyle>;
  ref?: Ref<HostView>;
};

const surfaceStyle = ({ focused }: SurfaceState) => [styles.row, focused ? styles.rowFocused : null];

export function MediaRowView({ row, playable, testID, onFocus, style, ref }: MediaRowProps) {
  // A failure belongs to one preview URL only.
  const [failed, setFailed] = useItemState(false, row.previewUrl ?? undefined);
  const preview = row.previewUrl && !failed ? row.previewUrl : null;
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      accessibilityRole={playable ? 'button' : 'text'}
      accessibilityLabel={mediaRowA11yLabel(row)}
      onFocus={onFocus}
      style={style}
      surfaceStyle={surfaceStyle}
    >
      {preview ? (
        <Image
          // Keyed by the URL: a new preview never shows the previous one.
          key={preview}
          testID={testID ? `${testID}/thumb` : undefined}
          source={{ uri: preview }}
          resizeMode="cover"
          resizeMethod="resize"
          fadeDuration={0}
          onError={() => setFailed(true)}
          style={styles.thumb}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          testID={testID ? `${testID}/thumb-placeholder` : undefined}
          style={[styles.thumb, styles.thumbPlaceholder]}
        />
      )}
      <View style={styles.texts}>
        <Text testID={testID ? `${testID}/label` : undefined} variant="card-title" numberOfLines={1}>
          {mediaRowLabel(row)}
        </Text>
        {row.title.length > 0 ? (
          <Text
            testID={testID ? `${testID}/title` : undefined}
            variant="body-s"
            color="text-secondary"
            numberOfLines={1}
          >
            {row.title}
          </Text>
        ) : null}
        {row.durationSec !== null ? (
          <Text
            testID={testID ? `${testID}/duration` : undefined}
            variant="meta"
            color="text-meta"
            numberOfLines={1}
          >
            {formatDuration(row.durationSec)}
          </Text>
        ) : null}
      </View>
    </FocusableSurface>
  );
}

/** Memoized: a focus move re-renders only the focus state inside FocusableSurface. */
export const MediaRow = memo(MediaRowView);

const styles = StyleSheet.create({
  row: {
    height: TOKENS.height,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: (TOKENS.height - THUMB_HEIGHT) / 2,
    borderRadius: TOKENS.radius,
    backgroundColor: colors.surface,
  },
  rowFocused: {
    backgroundColor: colors['surface-focus-row'],
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: TOKENS.radius,
  },
  thumbPlaceholder: {
    backgroundColor: colors.skeleton,
  },
  // Layout only (flattened by Fabric): the three lines, centered.
  texts: {
    flex: 1,
    marginLeft: spacing['6'],
  },
});
