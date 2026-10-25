import type { ReactNode } from 'react';
import { StyleSheet, TVFocusGuideView, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../ui/tokens';

export type ScreenProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Shared wrapper for every screen (docs/focus-map.md §1.3, ADR 0007).
 * The JS stack keeps covered screens mounted, so each screen traps focus on
 * all four sides; otherwise D-pad reaches the screen underneath.
 * Focus restoration is not part of it yet (Story 2.4).
 */
export function Screen({ children, style, testID }: ScreenProps) {
  return (
    <TVFocusGuideView
      testID={testID}
      style={[styles.screen, style]}
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
    >
      {children}
    </TVFocusGuideView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
