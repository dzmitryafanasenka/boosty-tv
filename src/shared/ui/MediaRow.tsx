import { memo, type Ref } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { VideoRow } from '../entities/post';
import { t, tf } from '../i18n';
import type { ProgressStatus } from '../services/progress/finished';
import { formatDuration } from '../i18n/format';
import { FocusableSurface, type FocusableSurfaceProps, type HostView, type SurfaceState } from './FocusableSurface';
import { Text } from './Text';
import { useItemState } from './useItemState';
import { colors, components, spacing } from './tokens';

/**
 * DESIGN.md MediaRow (Story 3.5): one row per video of a post: a 96×54
 * thumbnail, «Видео N», the title (when it has one) and the duration (when
 * the API gives it). Story 4.2: with a `status` (from `useProgress` via the
 * Post), the meta line also shows «Не начато» / «Осталось N мин» /
 * «Просмотрено» and the thumbnail an accent progress line (DESIGN.md
 * MediaRow, `components['media-row'].progress`); a started video without a
 * known duration shows neither (never a fake status). The action (Story
 * 4.1: OK → the Player for this video) exists only while `playable`
 * (`phaseFlags.player`): then the row has the button role and `onPress`.
 * Not playable: no `onPress` and the text role (a button role with no
 * action would be a TalkBack dead end).
 *
 * The thumbnail is the video's preview URL with no auth headers (a plain
 * `Image`), `resizeMethod="resize"` and `fadeDuration={0}`; a missing or
 * failed preview is a neutral plate.
 */

const TOKENS = components['media-row'];
const [THUMB_WIDTH, THUMB_HEIGHT] = TOKENS.thumb.split('x').map(Number);
/** The thumbnail's inset in the row (it is vertically centered). */
const THUMB_INSET = (TOKENS.height - THUMB_HEIGHT) / 2;
/** The progress line's height (DESIGN.md timeline track height, unfocused). */
const PROGRESS_HEIGHT = components.timeline.trackHeight;

/** «Видео N» (N = the row's position, from 1). */
export function mediaRowLabel(row: VideoRow): string {
  return tf('post.video.label', { n: String(row.index + 1) });
}

/** The status line (null: none shown). */
export function mediaRowStatusText(status: ProgressStatus | null | undefined): string | null {
  switch (status?.kind) {
    case 'notStarted':
      return t('post.video.status.notStarted');
    case 'inProgress':
      return tf('post.video.status.left', { n: String(status.minutesLeft) });
    case 'watched':
      return t('post.video.status.watched');
    default:
      return null;
  }
}

/** The progress line's filled share (null: no line). */
function progressFraction(status: ProgressStatus | null | undefined): number | null {
  return status?.kind === 'inProgress' ? status.fraction : status?.kind === 'watched' ? 1 : null;
}

/**
 * «Видео N. {title}. {duration}», leaving out the parts the row does not
 * have, then the status when there is one (Story 4.2).
 */
export function mediaRowA11yLabel(row: VideoRow, status?: ProgressStatus | null): string {
  const base = mediaRowBaseA11yLabel(row);
  const statusText = mediaRowStatusText(status);
  return statusText === null ? base : tf('post.video.a11yStatus', { base, status: statusText });
}

function mediaRowBaseA11yLabel(row: VideoRow): string {
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
   * the button role and `onPress`.
   */
  playable: boolean;
  /** Story 4.2: the video's progress status (`useProgress`); none: no status, no line. */
  status?: ProgressStatus | null;
  /** OK on the row (only while `playable`): open the Player for this video. */
  onPress?: () => void;
  testID?: string;
  onFocus?: FocusableSurfaceProps['onFocus'];
  style?: StyleProp<ViewStyle>;
  ref?: Ref<HostView>;
};

const surfaceStyle = ({ focused }: SurfaceState) => [styles.row, focused ? styles.rowFocused : null];

export function MediaRowView({ row, playable, status, onPress, testID, onFocus, style, ref }: MediaRowProps) {
  // A failure belongs to one preview URL only.
  const [failed, setFailed] = useItemState(false, row.previewUrl ?? undefined);
  const preview = row.previewUrl && !failed ? row.previewUrl : null;
  const statusText = mediaRowStatusText(status);
  const fraction = progressFraction(status);
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      accessibilityRole={playable ? 'button' : 'text'}
      accessibilityLabel={mediaRowA11yLabel(row, status)}
      onPress={playable ? onPress : undefined}
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
      {fraction !== null ? (
        // Over the thumbnail's bottom edge (the row's padding is the thumb's inset).
        <View testID={testID ? `${testID}/progress` : undefined} style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: Math.round(THUMB_WIDTH * fraction) }]} />
        </View>
      ) : null}
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
        {row.durationSec !== null || statusText !== null ? (
          <View style={styles.metaLine}>
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
            {statusText !== null ? (
              <Text
                testID={testID ? `${testID}/status` : undefined}
                variant="meta"
                color="text-meta"
                numberOfLines={1}
                style={row.durationSec !== null ? styles.status : null}
              >
                {statusText}
              </Text>
            ) : null}
          </View>
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
    paddingHorizontal: THUMB_INSET,
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
  // DESIGN.md MediaRow: the accent progress line along the thumbnail's
  // bottom edge (absolute: no extra layout, no reflow on focus).
  track: {
    position: 'absolute',
    left: THUMB_INSET,
    bottom: THUMB_INSET,
    width: THUMB_WIDTH,
    height: PROGRESS_HEIGHT,
    backgroundColor: colors['overlay-badge'],
  },
  fill: {
    height: PROGRESS_HEIGHT,
    backgroundColor: TOKENS.progress,
  },
  metaLine: {
    flexDirection: 'row',
  },
  status: {
    marginLeft: spacing['4'],
  },
  // Layout only (flattened by Fabric): the three lines, centered.
  texts: {
    flex: 1,
    marginLeft: spacing['6'],
  },
});
