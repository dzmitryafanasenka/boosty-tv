import { useCallback, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MediaRef, VideoRow } from '../../../shared/entities/post';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { t, tf } from '../../../shared/i18n';
import { formatDuration } from '../../../shared/i18n/format';
import { Button, QrIcon, buttonInk, components, mediaRowLabel, type HostView } from '../../../shared/ui';

/**
 * How the Player is opened (Story 4.2): `beginning` for «С начала»; Story
 * 6.3: `{atSec}` for a timestamp link chip.
 */
export type OpenPlayer = (ref: MediaRef, focusId: string, start?: 'beginning' | { atSec: number }) => void;

/** The play part of the action row (Story 4.1, 4.2); absent while the player is off. */
export type PostPlayAction = {
  /** The first unfinished video (all finished: the first one). */
  target: VideoRow;
  /** The post has several videos: the label names the target («· Видео N»). */
  multi: boolean;
  /** The target has progress > 0: «Продолжить» and «С начала». */
  resume: boolean;
  /**
   * Story 13.1: the target's saved position (`useProgress`), shown on a
   * single video's «Продолжить · 12:08»; null: «Продолжить» alone.
   */
  resumeAtSec: number | null;
};

export type PostActionsProps = {
  /** `post/<postId>/primary` */
  id: string;
  /** `post/<postId>/restart` */
  restartId: string;
  /** `post/<postId>/phone` */
  phoneId: string;
  /** «Смотреть» / «Продолжить» and «С начала»; null: none (the player is off, or no video). */
  play: PostPlayAction | null;
  /** Story 13.1: OK on «На телефоне» (its host view is the dialog's initiator); null: no button. */
  onOpenPhone: ((initiator: RefObject<HostView | null>) => void) | null;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onOpenPlayer: OpenPlayer;
  style?: StyleProp<ViewStyle>;
};

type ColumnButtonProps = {
  id: string;
  label: string;
  kind: 'primary' | 'secondary';
  onPress: (viewRef: RefObject<HostView | null>) => void;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  accessibilityLabel?: string;
  icon?: ReactNode;
};

/** A button that is a content zone item and a column stop (like the rows). */
function ColumnButton({ id, label, kind, onPress, onView, onFocus, accessibilityLabel, icon }: ColumnButtonProps) {
  const { ref, viewRef, handleFocus } = useColumnStop(id, onView, onFocus);
  const handlePress = useCallback(() => onPress(viewRef), [onPress, viewRef]);
  return (
    <Button
      ref={ref}
      testID={id}
      kind={kind}
      label={label}
      accessibilityLabel={accessibilityLabel}
      icon={icon}
      onPress={handlePress}
      onFocus={handleFocus}
    />
  );
}

/**
 * The primary's label (Stories 4.1, 4.2, 13.1): «Продолжить» when the
 * target has progress (a single video names the time: «Продолжить ·
 * 12:08»; several name the video: «Продолжить · Видео 2»), else «Смотреть»
 * («Смотреть · Видео N» for several).
 */
export function primaryLabel({ target, multi, resume, resumeAtSec }: PostPlayAction): string {
  if (resume) {
    if (multi) {
      return tf('post.continueVideo', { label: mediaRowLabel(target) });
    }
    return resumeAtSec !== null && resumeAtSec > 0
      ? tf('post.continueAt', { time: formatDuration(resumeAtSec) })
      : t('post.continue');
  }
  return multi ? tf('post.watchVideo', { label: mediaRowLabel(target) }) : t('post.watch');
}

/**
 * The header's action row (Story 4.1, owner decision 2026-10-27; Story
 * 13.1 mockup «Пост — новый макет»): the primary Button targets the first
 * unfinished video, «С начала» to its right only when that one has
 * progress (owner decision 2026-10-28; it starts the video at 0), then
 * «На телефоне» (Story 13.1, every post: the QrDialog with the post's
 * boosty.to page). The row wraps when the column is narrow. Native focus:
 * ← → move along the row, ↑ reaches the author, ↓ the tiles or the body.
 */
export function PostActions({
  id,
  restartId,
  phoneId,
  play,
  onOpenPhone,
  onView,
  onFocus,
  onOpenPlayer,
  style,
}: PostActionsProps) {
  const targetRef = play?.target.ref ?? null;
  const onPress = useCallback(() => {
    if (targetRef !== null) {
      onOpenPlayer(targetRef, id);
    }
  }, [onOpenPlayer, targetRef, id]);
  const onRestart = useCallback(() => {
    if (targetRef !== null) {
      onOpenPlayer(targetRef, restartId, 'beginning');
    }
  }, [onOpenPlayer, targetRef, restartId]);
  const onPhone = useCallback(
    (viewRef: RefObject<HostView | null>) => onOpenPhone?.(viewRef),
    [onOpenPhone],
  );
  if (play === null && onOpenPhone === null) {
    return null;
  }
  return (
    <View testID={`${id}-row`} style={[styles.row, style]}>
      {play !== null ? (
        <ColumnButton
          id={id}
          kind="primary"
          label={primaryLabel(play)}
          onPress={onPress}
          onView={onView}
          onFocus={onFocus}
        />
      ) : null}
      {play !== null && play.resume ? (
        <ColumnButton
          id={restartId}
          kind="secondary"
          label={t('post.restart')}
          onPress={onRestart}
          onView={onView}
          onFocus={onFocus}
        />
      ) : null}
      {onOpenPhone !== null ? (
        <ColumnButton
          id={phoneId}
          kind="secondary"
          label={t('post.phone')}
          accessibilityLabel={t('post.phoneA11y')}
          icon={<QrIcon testID={`${phoneId}/icon`} color={buttonInk({ kind: 'secondary' })} size={HERO.buttonIcon} />}
          onPress={onPhone}
          onView={onView}
          onFocus={onFocus}
        />
      ) : null}
    </View>
  );
}

const HERO = components['post-hero'];

const styles = StyleSheet.create({
  // The buttons left-aligned, wrapping onto a second row when narrow; the
  // gap stays between wrapped rows too (the 1.04 focus scale never overlaps).
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: HERO.buttonGap,
  },
});
