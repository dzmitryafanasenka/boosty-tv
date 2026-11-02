import { StyleSheet, TVFocusGuideView, View } from 'react-native';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { t } from '../../../shared/i18n';
import { Button, Spinner, Text, components, spacing } from '../../../shared/ui';

const ROW = components['comment-row'];

export type CommentActionRowProps = {
  id: string;
  /** «Показать ещё», «Ещё ответы» or «Повторить». */
  label: string;
  /** A load runs: the spinner, focus kept, OK ignored. */
  busy: boolean;
  /** The last load failed: the row reads «Повторить» (the list above is kept). */
  failed?: boolean;
  onPress: () => void;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
};

/**
 * ShowMoreRow (Story 11.2): «Показать ещё» under the comments, «Ещё ответы»
 * under a thread, «Повторить» for a failed load. One small secondary button,
 * one focus stop. It sits in a full-measure `TVFocusGuideView autoFocus` (as
 * the chip rows, Story 6.3: Android's focus search could skip a narrow
 * left-aligned stop under a full-width row).
 */
export function CommentActionRow({ id, label, busy, failed = false, onPress, onView, onFocus }: CommentActionRowProps) {
  const { ref, handleFocus } = useColumnStop(id, onView, onFocus);
  return (
    <TVFocusGuideView testID={`${id}/guide`} autoFocus style={styles.guide}>
      <Button
        ref={ref}
        testID={id}
        kind="secondary"
        size="small"
        label={failed ? t('common.retry') : label}
        accessibilityLabel={failed ? t('post.comments.a11yMoreFailed') : label}
        busyAccessibilityLabel={t('post.comments.a11yLoadingMore')}
        busy={busy}
        onPress={onPress}
        onFocus={handleFocus}
        style={styles.button}
      />
    </TVFocusGuideView>
  );
}

/** A non-focusable line of the block (loading, empty, error, denied, comments off). */
export function CommentsNote({ testID, text, busy = false }: { testID: string; text: string; busy?: boolean }) {
  return (
    <View testID={testID} focusable={false} accessible accessibilityLabel={text} style={styles.note}>
      {busy ? <Spinner testID={`${testID}/spinner`} /> : null}
      <Text variant="body-s" color="text-secondary" style={busy ? styles.noteText : null}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  guide: {
    alignSelf: 'stretch',
    maxWidth: spacing['text-measure'],
    marginBottom: ROW.rowGap,
  },
  button: {
    alignSelf: 'flex-start',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: ROW.rowGap,
    paddingHorizontal: ROW.gap,
    marginBottom: ROW.rowGap,
  },
  noteText: {
    marginLeft: ROW.gap,
  },
});
