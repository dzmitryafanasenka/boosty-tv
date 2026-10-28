import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { components, spacing } from './tokens';

const TOKENS = components['side-sheet'];

export type SideSheetProps = {
  /** `player` (340 dp, the player settings) or `filters` (320 dp). */
  variant: 'player' | 'filters';
  /** The sheet's heading, from the i18n catalog. */
  title: string;
  children?: ReactNode;
  testID?: string;
};

/**
 * DESIGN.md SideSheet (`side-sheet` tokens): a full-height right panel on
 * `bg-sidebar` (tone only, no border), a heading, then its rows in one
 * column. It is rendered through the one modal host with
 * `placement: 'end'` (AD-13), which traps focus and owns the first Back.
 * Spacing from the Player mock (1920 frame, halved to dp).
 */
export function SideSheet({ variant, title, children, testID }: SideSheetProps) {
  const width = variant === 'player' ? TOKENS.widthPlayer : TOKENS.widthFilters;
  return (
    <View testID={testID} style={[styles.sheet, { width }]}>
      <Text variant="title-s" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: TOKENS.bg,
    borderRadius: TOKENS.radius,
    paddingVertical: spacing['safe-y'],
    paddingHorizontal: spacing['10'],
    gap: spacing['3'],
  },
  title: {
    marginBottom: spacing['5'],
  },
});
