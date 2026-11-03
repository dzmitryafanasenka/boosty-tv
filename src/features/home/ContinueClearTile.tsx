import { memo, type Ref } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '../../shared/i18n';
import {
  FocusableSurface,
  Text,
  colors,
  components,
  postCardHeight,
  type FocusableSurfaceProps,
  type HostView,
} from '../../shared/ui';

/** Focus id of «Очистить всё», the last item of the Continue row (docs/focus-map.md §1.5). */
export const CONTINUE_CLEAR_ID = 'home/continue/clear-all';

const TOKENS = components['post-card'];

export type ContinueClearTileProps = {
  width: number;
  onFocus?: FocusableSurfaceProps['onFocus'];
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<HostView>;
};

/**
 * «Очистить всё» (Story 12.1, our improvement): a tile of a ContinueCard's
 * size on `colors.surface` at the end of the «Продолжить просмотр» row.
 * OK opens the clear-all confirmation (Главная owns the dialog).
 */
export const ContinueClearTile = memo(function ContinueClearTileView({
  width,
  onFocus,
  onPress,
  style,
  ref,
}: ContinueClearTileProps) {
  return (
    <FocusableSurface
      ref={ref}
      testID={CONTINUE_CLEAR_ID}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      accessibilityRole="button"
      accessibilityLabel={t('home.continue.clearAllA11y')}
      onFocus={onFocus}
      onPress={onPress}
      style={style}
      surfaceStyle={({ focused }) => [
        styles.surface,
        {
          width,
          height: postCardHeight(width),
          backgroundColor: focused ? colors['surface-raised'] : colors.surface,
        },
      ]}
    >
      <Text variant="card-title" color="text-card" numberOfLines={2} style={styles.label}>
        {t('home.continue.clearAll')}
      </Text>
    </FocusableSurface>
  );
});

const styles = StyleSheet.create({
  surface: {
    borderRadius: TOKENS.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
