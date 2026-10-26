import type { Ref } from 'react';
import { StyleSheet, View, type BlurEvent, type FocusEvent } from 'react-native';
import { FocusableSurface, type HostView, type SurfaceState } from './FocusableSurface';
import { Text } from './Text';
import { components, spacing } from './tokens';

/**
 * Kinds implemented so far (DESIGN.md SettingRow): `info` shows a value and
 * OK does nothing; `nav` opens something on OK. Toggle, radio and check come
 * with the stories that need them.
 */
export type SettingRowKind = 'info' | 'nav';

export type SettingRowProps = {
  kind: SettingRowKind;
  /** From the i18n catalog. */
  label: string;
  /** Right-aligned value (info rows), e.g. the version. */
  value?: string;
  /** `nav` rows only; ignored for `info`. */
  onPress?: () => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: BlurEvent) => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
  ref?: Ref<HostView>;
};

const TOKENS = components['setting-row'];

/**
 * DESIGN.md SettingRow (`setting-row` tokens): focusable in every kind, so
 * the remote can reach and read it. Focused: ring, `surface-focus-row` and
 * the row scale; secondary text switches to `text-secondary`.
 */
export function SettingRow({
  kind,
  label,
  value,
  onPress,
  onFocus,
  onBlur,
  hasTVPreferredFocus,
  testID,
  ref,
}: SettingRowProps) {
  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.surface,
    focused && { backgroundColor: TOKENS.bgFocus },
  ];
  const a11yLabel = value ? `${label} ${value}` : label;

  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole={kind === 'nav' ? 'button' : 'text'}
      accessibilityLabel={a11yLabel}
      onPress={kind === 'nav' ? onPress : undefined}
      onFocus={onFocus}
      onBlur={onBlur}
      surfaceStyle={surfaceStyle}
    >
      {({ focused }) => (
        <View style={styles.content}>
          <Text variant="body" numberOfLines={1} style={styles.label}>
            {label}
          </Text>
          {value ? (
            <Text
              variant="body"
              numberOfLines={1}
              color={focused ? 'text-secondary' : 'text-meta'}
            >
              {value}
            </Text>
          ) : null}
        </View>
      )}
    </FocusableSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    minHeight: TOKENS.minHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing['8'],
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    flex: 1,
    marginRight: spacing['8'],
  },
});
