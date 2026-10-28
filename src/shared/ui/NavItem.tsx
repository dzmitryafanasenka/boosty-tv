import type { Ref } from 'react';
import { StyleSheet, View, type BlurEvent, type FocusEvent } from 'react-native';
import { FocusableSurface, type HostView, type SurfaceState } from './FocusableSurface';
import { Text } from './Text';
import { colors, components, focus, rounded, spacing } from './tokens';

export type NavItemProps = {
  /** Visible and accessibility label; from the i18n catalog. */
  label: string;
  /** The open section (accent bar + `surface-current`), not focus. */
  current: boolean;
  onPress?: () => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: BlurEvent) => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
  /** The focusable host view (for `requestTVFocus()` and focus guides). */
  ref?: Ref<HostView>;
};

const TOKENS = components['nav-item'];
const MARK_WIDTH = 3;
const MARK_HEIGHT = 16;

/**
 * DESIGN.md Sidebar / NavItem. Current: `surface-current` plus an accent
 * bar. Focused: ring plus `surface-focus-row` (and the row scale). A focused
 * current item keeps the bar, so the two states never look the same.
 */
export function NavItem({
  label,
  current,
  onPress,
  onFocus,
  onBlur,
  hasTVPreferredFocus,
  testID,
  ref,
}: NavItemProps) {
  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.surface,
    {
      backgroundColor: focused
        ? TOKENS.focusBg
        : current
          ? TOKENS.currentBg
          : 'transparent',
    },
  ];

  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={TOKENS.radius}
      scaleFocus={focus['scale-row']}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      hasTVPreferredFocus={hasTVPreferredFocus}
      surfaceStyle={surfaceStyle}
    >
      {({ focused }) => (
        <>
          {current ? (
            <View
              testID={testID ? `${testID}/current` : undefined}
              style={styles.mark}
            />
          ) : null}
          <Text
            variant="button"
            numberOfLines={1}
            color={focused || current ? 'text' : 'text-secondary'}
          >
            {label}
          </Text>
        </>
      )}
    </FocusableSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    width: TOKENS.width,
    height: TOKENS.height,
    justifyContent: 'center',
    paddingLeft: TOKENS.paddingLeft,
    paddingRight: spacing['4'],
  },
  mark: {
    position: 'absolute',
    left: spacing['9'],
    top: (TOKENS.height - MARK_HEIGHT) / 2,
    width: MARK_WIDTH,
    height: MARK_HEIGHT,
    borderRadius: rounded.full,
    backgroundColor: colors.accent,
  },
});
