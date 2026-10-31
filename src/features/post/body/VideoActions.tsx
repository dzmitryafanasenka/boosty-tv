import { memo, useCallback } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MediaRef, VideoRow } from '../../../shared/entities/post';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { t, tf } from '../../../shared/i18n';
import type { ProgressStatus } from '../../../shared/services/progress';
import { Button, MediaRow, mediaRowLabel, spacing } from '../../../shared/ui';

/**
 * How the Player is opened (Story 4.2): `beginning` for «С начала»; Story
 * 6.3: `{atSec}` for a timestamp link chip.
 */
export type OpenPlayer = (ref: MediaRef, focusId: string, start?: 'beginning' | { atSec: number }) => void;

type VideoRowStopProps = {
  id: string;
  row: VideoRow;
  playable: boolean;
  /** Story 4.2: the row's progress status (only while playable). */
  status: ProgressStatus | null;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  /** OK (only while playable): the Player for `ref`, opened from the focus id `id`. */
  onOpen: OpenPlayer;
};

/**
 * One MediaRow as a focus stop of the Post column (Story 3.5): a content
 * zone item, its host view reported by focus id. OK opens the Player for
 * this video (Story 4.1) while `phaseFlags.player` is on; otherwise it does
 * nothing.
 */
const VideoRowStop = memo(function VideoRowStopView({
  id,
  row,
  playable,
  status,
  onView,
  onFocus,
  onOpen,
}: VideoRowStopProps) {
  const { ref, handleFocus } = useColumnStop(id, onView, onFocus);
  const mediaRef = row.ref;
  const handlePress = useCallback(() => onOpen(mediaRef, id), [onOpen, mediaRef, id]);
  return (
    <MediaRow
      ref={ref}
      testID={id}
      row={row}
      playable={playable}
      status={status}
      onPress={handlePress}
      onFocus={handleFocus}
      style={styles.gap}
    />
  );
});

export type PostVideoRowsProps = {
  rows: readonly VideoRow[];
  /** `post/<postId>/video/` */
  idPrefix: string;
  /** `phaseFlags.player`, from the route (features cannot import `app`). */
  playable: boolean;
  /** Story 4.2: each row's progress status, by index (none while not playable). */
  statuses: readonly (ProgressStatus | null)[];
  onRowView: StopViewHandler;
  onRowFocus: StopFocusHandler;
  /** OK on a row (while playable): the Player for that video. */
  onOpenPlayer: OpenPlayer;
};

/**
 * The post's MediaRows, in block order, under the header, full content
 * width (DESIGN.md Post screen). Keys and ids use the media id
 * (`post/<postId>/video/<mediaId>`), never the index or a URL.
 */
export function PostVideoRows({
  rows,
  idPrefix,
  playable,
  statuses,
  onRowView,
  onRowFocus,
  onOpenPlayer,
}: PostVideoRowsProps) {
  return (
    <>
      {rows.map((row, i) => (
        <VideoRowStop
          key={row.ref.mediaId}
          id={`${idPrefix}${row.ref.mediaId}`}
          row={row}
          playable={playable}
          status={playable ? statuses[i] ?? null : null}
          onView={onRowView}
          onFocus={onRowFocus}
          onOpen={onOpenPlayer}
        />
      ))}
    </>
  );
}

export type PostPrimaryActionProps = {
  /** `post/<postId>/primary` */
  id: string;
  /** `post/<postId>/restart` */
  restartId: string;
  /** The post has several MediaRows: the label names the target («· Видео N»). */
  multi: boolean;
  /** The first unfinished video (all finished: the first one). */
  target: VideoRow;
  /** The target has progress > 0: «Продолжить» and «С начала». */
  resume: boolean;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onOpenPlayer: OpenPlayer;
};

type ColumnButtonProps = {
  id: string;
  label: string;
  kind: 'primary' | 'secondary';
  onPress: () => void;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  style?: StyleProp<ViewStyle>;
};

/** A button that is a content zone item and a column stop (like the rows). */
function ColumnButton({ id, label, kind, onPress, onView, onFocus, style }: ColumnButtonProps) {
  const { ref, handleFocus } = useColumnStop(id, onView, onFocus);
  return (
    <Button
      ref={ref}
      testID={id}
      kind={kind}
      label={label}
      onPress={onPress}
      onFocus={handleFocus}
      style={style}
    />
  );
}

/**
 * The primary action under the header (Story 4.1, owner decision
 * 2026-10-27, option A): a primary Button in its own row, before the
 * MediaRows. Story 4.2: it targets the first unfinished video; «Продолжить»
 * when that one has progress, else «Смотреть» (all finished: «Смотреть» on
 * the first video, which starts at 0); several videos name the target
 * («Продолжить · Видео 2»). «С начала» (owner decision 2026-10-28) sits in
 * the same row, to its right, only when the target has progress; it starts
 * that video at 0. ← → move between them, ↓ from either reaches the first
 * MediaRow, ↑ the author (native focus in the one column).
 */
export function PostPrimaryAction({
  id,
  restartId,
  multi,
  target,
  resume,
  onView,
  onFocus,
  onOpenPlayer,
}: PostPrimaryActionProps) {
  const targetRef = target.ref;
  const onPress = useCallback(() => onOpenPlayer(targetRef, id), [onOpenPlayer, targetRef, id]);
  const onRestart = useCallback(
    () => onOpenPlayer(targetRef, restartId, 'beginning'),
    [onOpenPlayer, targetRef, restartId],
  );
  const video = mediaRowLabel(target);
  const label = resume
    ? multi
      ? tf('post.continueVideo', { label: video })
      : t('post.continue')
    : multi
      ? tf('post.watchVideo', { label: video })
      : t('post.watch');
  return (
    <View testID={`${id}-row`} style={styles.primaryRow}>
      <ColumnButton id={id} kind="primary" label={label} onPress={onPress} onView={onView} onFocus={onFocus} />
      {resume ? (
        <ColumnButton
          id={restartId}
          kind="secondary"
          label={t('post.restart')}
          onPress={onRestart}
          onView={onView}
          onFocus={onFocus}
          style={styles.restart}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The primary button's own row, left-aligned, above the MediaRows.
  primaryRow: {
    flexDirection: 'row',
    marginBottom: spacing['8'],
  },
  // «С начала» to the right of the primary (owner decision 2026-10-28).
  restart: {
    marginLeft: spacing['6'],
  },
  gap: {
    marginBottom: spacing['6'],
  },
});
