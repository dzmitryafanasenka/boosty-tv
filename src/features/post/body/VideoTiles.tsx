import { memo, useCallback } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { VideoRow } from '../../../shared/entities/post';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { t, tf } from '../../../shared/i18n';
import { formatDuration } from '../../../shared/i18n/format';
import type { ProgressStatus } from '../../../shared/services/progress';
import {
  FocusableSurface,
  Text,
  colors,
  components,
  mediaRowA11yLabel,
  mediaRowLabel,
  spacing,
  useItemState,
  type SurfaceState,
} from '../../../shared/ui';
import type { OpenPlayer } from './VideoActions';

/**
 * Story 13.1 (mockup «Пост — новый макет», `MultiVideo.dc.html`): the
 * compact video tiles of a multi-video post under the header, «Видео в
 * посте · N» above them. One tile per video, in block order, each one focus
 * stop with the old MediaRow id (`post/<postId>/video/<mediaId>`), so the
 * Player's return target and `endedReturnFocusId` keep working. The tiles
 * wrap onto more rows when they do not fit the column (no horizontal
 * scroller: native focus moves ↑ ↓ between the rows).
 */

const TILE = components['media-tile'];
const PROGRESS_HEIGHT = components.timeline.trackHeight;

/** «Видео N · title», or «Видео N» for an untitled video. */
export function videoTileLabel(row: VideoRow): string {
  const label = mediaRowLabel(row);
  return row.title.length > 0 ? tf('post.tiles.tileLabel', { label, title: row.title }) : label;
}

/**
 * The tile's status line (null: none): «Просмотрено», «Осталось N мин»,
 * «Не начато · 21:40»; without a status (the player off) or with an
 * unknown one, the duration when known (never a fake status).
 */
export function videoTileStatusText(row: VideoRow, status: ProgressStatus | null): string | null {
  const duration = row.durationSec !== null ? formatDuration(row.durationSec) : null;
  switch (status?.kind) {
    case 'watched':
      return t('post.video.status.watched');
    case 'inProgress':
      return tf('post.video.status.left', { n: String(status.minutesLeft) });
    case 'notStarted':
      return duration !== null
        ? tf('post.tiles.notStartedDuration', { duration })
        : t('post.video.status.notStarted');
    default:
      return duration;
  }
}

/** The progress line's filled share (null: no line). */
function progressFraction(status: ProgressStatus | null): number | null {
  return status?.kind === 'inProgress' ? status.fraction : status?.kind === 'watched' ? 1 : null;
}

type VideoTileProps = {
  id: string;
  row: VideoRow;
  playable: boolean;
  status: ProgressStatus | null;
  /** The primary's target: the «Сейчас» badge. */
  current: boolean;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onOpen: OpenPlayer;
};

const tileSurface = ({ focused }: SurfaceState) => [styles.tile, focused ? styles.tileFocused : null];

const VideoTile = memo(function VideoTileView({
  id,
  row,
  playable,
  status,
  current,
  onView,
  onFocus,
  onOpen,
}: VideoTileProps) {
  const { ref, handleFocus } = useColumnStop(id, onView, onFocus);
  const mediaRef = row.ref;
  const handlePress = useCallback(() => onOpen(mediaRef, id), [onOpen, mediaRef, id]);
  const [failed, setFailed] = useItemState(false, row.previewUrl ?? undefined);
  const preview = row.previewUrl && !failed ? row.previewUrl : null;
  const fraction = progressFraction(status);
  const statusText = videoTileStatusText(row, status);
  const base = mediaRowA11yLabel(row, status);
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      radius={TILE.radius}
      scaleFocus={TILE.scaleFocus}
      accessibilityRole={playable ? 'button' : 'text'}
      accessibilityLabel={current ? tf('post.tiles.a11yNow', { base }) : base}
      onPress={playable ? handlePress : undefined}
      onFocus={handleFocus}
      surfaceStyle={tileSurface}
    >
      <View style={styles.thumbBox}>
        {preview ? (
          <Image
            key={preview}
            testID={`${id}/thumb`}
            source={{ uri: preview }}
            resizeMode="cover"
            resizeMethod="resize"
            fadeDuration={0}
            onError={() => setFailed(true)}
            style={styles.thumb}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View testID={`${id}/thumb-placeholder`} style={[styles.thumb, styles.plate]} />
        )}
        {current ? (
          <View testID={`${id}/now`} style={styles.badge} pointerEvents="none">
            <Text variant="badge" color="accent-text" numberOfLines={1}>
              {t('post.tiles.now')}
            </Text>
          </View>
        ) : null}
        {fraction !== null ? (
          <View testID={`${id}/progress`} style={styles.track} pointerEvents="none">
            <View style={[styles.fill, { width: Math.round(TILE.width * fraction) }]} />
          </View>
        ) : null}
      </View>
      <Text testID={`${id}/label`} variant="card-title" numberOfLines={1} style={styles.label}>
        {videoTileLabel(row)}
      </Text>
      {statusText !== null ? (
        <Text testID={`${id}/status`} variant="meta" color="text-meta" numberOfLines={1} style={styles.status}>
          {statusText}
        </Text>
      ) : null}
    </FocusableSurface>
  );
});

export type PostVideoTilesProps = {
  rows: readonly VideoRow[];
  /** `post/<postId>/video/` */
  idPrefix: string;
  /** `phaseFlags.player`, from the route (features cannot import `app`). */
  playable: boolean;
  /** Each row's progress status, by index (none while not playable). */
  statuses: readonly (ProgressStatus | null)[];
  /** The primary's target (the «Сейчас» badge); null: none. */
  currentMediaId: string | null;
  onTileView: StopViewHandler;
  onTileFocus: StopFocusHandler;
  /** OK on a tile (while playable): the Player for that video. */
  onOpenPlayer: OpenPlayer;
};

/** «Видео в посте · N» and its tiles; keys and ids by media id, never by index or URL. */
export function PostVideoTiles({
  rows,
  idPrefix,
  playable,
  statuses,
  currentMediaId,
  onTileView,
  onTileFocus,
  onOpenPlayer,
}: PostVideoTilesProps) {
  return (
    <View testID="post/tiles" style={styles.section}>
      <Text testID="post/tiles/title" variant="section" accessibilityRole="header" style={styles.title}>
        {tf('post.tiles.title', { n: String(rows.length) })}
      </Text>
      <View style={styles.tiles}>
        {rows.map((row, i) => (
          <VideoTile
            key={row.ref.mediaId}
            id={`${idPrefix}${row.ref.mediaId}`}
            row={row}
            playable={playable}
            status={playable ? statuses[i] ?? null : null}
            current={playable && row.ref.mediaId === currentMediaId}
            onView={onTileView}
            onFocus={onTileFocus}
            onOpen={onOpenPlayer}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing['10'],
  },
  title: {
    marginBottom: spacing['6'],
  },
  // Wrapping rows; the gap leaves room for the focus scale and ring.
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE.gap,
  },
  tile: {
    width: TILE.width,
    borderRadius: TILE.radius,
    paddingBottom: spacing['3'],
  },
  tileFocused: {
    backgroundColor: colors['surface-focus-row'],
  },
  thumbBox: {
    width: TILE.width,
    height: TILE.thumbHeight,
    borderRadius: TILE.radius,
    overflow: 'hidden',
  },
  thumb: {
    width: TILE.width,
    height: TILE.thumbHeight,
  },
  plate: {
    backgroundColor: components['post-hero'].plate,
  },
  badge: {
    position: 'absolute',
    left: spacing['3'],
    top: spacing['3'],
    height: components.badge.height,
    paddingHorizontal: spacing['3'],
    borderRadius: components.badge.radius,
    backgroundColor: components.badge.bg,
    justifyContent: 'center',
  },
  // The accent line along the thumbnail's bottom edge (absolute: no reflow).
  track: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: TILE.width,
    height: PROGRESS_HEIGHT,
    backgroundColor: colors['overlay-badge'],
  },
  fill: {
    height: PROGRESS_HEIGHT,
    backgroundColor: components['media-row'].progress,
  },
  label: {
    marginTop: spacing['3'],
    paddingHorizontal: spacing['2'],
  },
  status: {
    paddingHorizontal: spacing['2'],
  },
});
