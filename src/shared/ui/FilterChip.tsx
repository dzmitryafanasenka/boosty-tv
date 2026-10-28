import type { Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  FocusableSurface,
  type FocusableSurfaceProps,
  type HostView,
  type SurfaceState,
} from './FocusableSurface';
import { Text } from './Text';
import { colors, components, focus, spacing } from './tokens';

const TOKENS = components['filter-chip'];

export type FilterChipProps = {
  /** The visible text («Фильтры · Доступные мне»), from the i18n catalog. */
  label: string;
  /** Active (non-default) filters; a badge when above 0. */
  count?: number;
  /** The whole state for TalkBack (value and count), from the i18n catalog. */
  accessibilityLabel?: string;
  onPress?: () => void;
  onFocus?: FocusableSurfaceProps['onFocus'];
  /** See `FocusableSurface` `focusable` (default true). */
  focusable?: boolean;
  testID?: string;
  /** The focusable host view (the modal initiator, focus guides). */
  ref?: Ref<HostView>;
};

/** The count badge's diameter (fits inside the 32 dp pill). */
const BADGE = 20;

/**
 * DESIGN.md FilterChip (`filter-chip` tokens, Story 5.3): a 32 dp pill on
 * `surface-raised` with the label and the current value («Фильтры ·
 * Доступные мне») and, when filters are active, a count badge on
 * `accent-tint`. Focused: the ring, `surface-focus-button` and the button
 * scale (a transform, the layout never moves).
 */
export function FilterChip({
  label,
  count = 0,
  accessibilityLabel,
  onPress,
  onFocus,
  focusable,
  testID,
  ref,
}: FilterChipProps) {
  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.surface,
    { backgroundColor: focused ? colors['surface-focus-button'] : TOKENS.bg },
  ];
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={TOKENS.height / 2}
      scaleFocus={focus['scale-button']}
      focusable={focusable}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      onFocus={onFocus}
      surfaceStyle={surfaceStyle}
    >
      <View style={styles.content}>
        <Text variant="button-s" numberOfLines={1}>
          {label}
        </Text>
        {count > 0 ? (
          <View testID={testID ? `${testID}/count` : undefined} style={styles.badge}>
            <Text variant="button-s" color="accent-text">
              {String(count)}
            </Text>
          </View>
        ) : null}
      </View>
    </FocusableSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    height: TOKENS.height,
    paddingHorizontal: components['button-small'].paddingX,
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    minWidth: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    paddingHorizontal: spacing['2'],
    marginLeft: spacing['3'],
    marginRight: -spacing['3'],
    backgroundColor: TOKENS.countBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
