import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { t, tf } from '../../shared/i18n';
import { Text, spacing } from '../../shared/ui';

/**
 * The no-access copy of a locked post (Story 3.6, EXPERIENCE.md «Honest
 * limits»), with the subscription level name when the post carries one.
 * The level name is the only input: never a price, a level list, a
 * subscribe button or a payment link.
 */
export function lockedNoticeText(levelName: string | null): string {
  return levelName === null
    ? t('post.locked.noLevel')
    : tf('post.locked.withLevel', { level: levelName });
}

/**
 * Right under the Post header, before the teaser. Plain, non-focusable text
 * (not a focus stop); TalkBack reads it as one text element.
 */
export function LockedNotice({
  levelName,
  onLayout,
}: {
  levelName: string | null;
  /** Its layout in the column (the Post screen fits the teaser below it). */
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const copy = lockedNoticeText(levelName);
  return (
    <View
      testID="post/locked"
      focusable={false}
      accessible
      accessibilityRole="text"
      accessibilityLabel={copy}
      onLayout={onLayout}
      style={styles.notice}
    >
      <Text variant="body">{copy}</Text>
    </View>
  );
}

/** The room between the copy and the teaser. */
export const LOCKED_NOTICE_GAP = spacing['8'];

const styles = StyleSheet.create({
  notice: {
    maxWidth: spacing['text-measure'],
    marginBottom: LOCKED_NOTICE_GAP,
  },
});
