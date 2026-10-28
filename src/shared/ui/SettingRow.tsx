import type { Ref } from 'react';
import { StyleSheet, View, type BlurEvent, type FocusEvent } from 'react-native';
import { FocusableSurface, type HostView, type SurfaceState } from './FocusableSurface';
import { Text } from './Text';
import { colors, components, spacing } from './tokens';

/**
 * Kinds implemented so far (DESIGN.md SettingRow): `info` shows a value and
 * OK does nothing; `nav` opens something on OK; `radio` (Story 4.3) is one
 * choice of a list, with an accent mark when `selected`, and OK picks it.
 * Toggle and check come with the stories that need them.
 */
export type SettingRowKind = 'info' | 'nav' | 'radio';

export type SettingRowProps = {
  kind: SettingRowKind;
  /** From the i18n catalog. */
  label: string;
  /** Right-aligned value (info rows), e.g. the version. */
  value?: string;
  /** `nav` and `radio` rows; ignored for `info`. */
  onPress?: () => void;
  /** `radio` rows: this choice is the current one (accent mark, `accessibilityState.selected`). */
  selected?: boolean;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: BlurEvent) => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
  ref?: Ref<HostView>;
};

const TOKENS = components['setting-row'];
/** The radio mark's diameter. */
const RADIO = 18;

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
  selected = false,
  onFocus,
  onBlur,
  hasTVPreferredFocus,
  testID,
  ref,
}: SettingRowProps) {
  const radio = kind === 'radio';
  const pressable = kind === 'nav' || radio;
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
      accessibilityRole={radio ? 'radio' : kind === 'nav' ? 'button' : 'text'}
      accessibilityLabel={a11yLabel}
      accessibilityState={radio ? { selected, checked: selected } : undefined}
      onPress={pressable ? onPress : undefined}
      onFocus={onFocus}
      onBlur={onBlur}
      surfaceStyle={surfaceStyle}
    >
      {({ focused }) => (
        <View style={styles.content}>
          {radio ? (
            <View
              testID={testID ? `${testID}/radio` : undefined}
              style={[styles.radio, selected && styles.radioSelected]}
            >
              {selected ? (
                <View testID={testID ? `${testID}/selected` : undefined} style={styles.radioDot} />
              ) : null}
            </View>
          ) : null}
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
  // The radio mark (DESIGN.md: selected radio marks use `accent`).
  radio: {
    width: RADIO,
    height: RADIO,
    borderRadius: RADIO / 2,
    borderWidth: 2,
    borderColor: colors['text-meta'],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing['6'],
  },
  radioSelected: {
    borderColor: colors.accent,
  },
  radioDot: {
    width: RADIO / 2,
    height: RADIO / 2,
    borderRadius: RADIO / 4,
    backgroundColor: colors.accent,
  },
});
