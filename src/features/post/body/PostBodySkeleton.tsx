import { StyleSheet, View } from 'react-native';
import { colors, rounded, spacing } from '../../../shared/ui';

/** The body's skeleton: a few non-focusable text lines, capped at the text measure. */
export function PostBodySkeleton() {
  return (
    <View testID="post/body-skeleton" focusable={false} style={styles.measure}>
      {[100, 92, 96, 60, 0, 100, 88, 70].map((width, i) =>
        width === 0 ? (
          <View key={i} style={styles.skeletonBreak} />
        ) : (
          <View key={i} style={[styles.skeletonLine, { width: `${width}%` }]} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Body text: at most the text measure, left-aligned (≈ 75 characters a line).
  measure: {
    maxWidth: spacing['text-measure'],
  },
  skeletonLine: {
    height: spacing['6'],
    borderRadius: rounded.sm,
    backgroundColor: colors.skeleton,
    marginBottom: spacing['4'],
  },
  skeletonBreak: {
    height: spacing['6'],
  },
});
