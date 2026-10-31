import type { Ref } from 'react';
import { StyleSheet, View, type BlurEvent, type FocusEvent } from 'react-native';
import { FocusableSurface, type HostView, type SurfaceState } from './FocusableSurface';
import { CheckIcon } from './icons';
import { Text } from './Text';
import { colors, components, spacing } from './tokens';

/**
 * Kinds implemented so far (DESIGN.md SettingRow): `info` shows a value and
 * OK does nothing visible (Story 8.3: an optional `onPress` is called, with
 * no press scale and the same `text` role, e.g. «Версия»'s hidden gesture); `nav` opens something on OK; `radio` (Story 4.3) is one
 * choice of a list, with an accent mark when `selected`, and OK picks it;
 * `check` (Story 5.5, a tag) is one of several independent choices, an
 * accent box with a tick when `checked`, and OK toggles it; `toggle`
 * (Story 8.2) is an on/off setting: its value is the caller's «Вкл»
 * (accent, `checked`) or «Выкл», and OK flips it (the caller flips
 * `checked` at once, EXPERIENCE.md).
 */
export type SettingRowKind = 'info' | 'nav' | 'radio' | 'check' | 'toggle';

export type SettingRowProps = {
  kind: SettingRowKind;
  /** From the i18n catalog. */
  label: string;
  /** Right-aligned value (info rows), e.g. the version. */
  value?: string;
  /**
   * Lines the value may wrap to (default 1: one line, right of the label).
   * Above 1 the value goes under the label and wraps (Story 5.4: a custom
   * period range does not fit beside its label on the 320 dp filter sheet).
   */
  valueLines?: number;
  /**
   * A secondary line under the label (DESIGN.md SettingRow: «optional
   * description»), e.g. the «Системный видеоплеер» note (Story 8.2).
   */
  description?: string;
  /**
   * `nav`, `radio`, `check` and `toggle` rows. `info` rows (Story 8.3): called
   * on OK too, but the row looks and reads the same (no press scale, role
   * `text`).
   */
  onPress?: () => void;
  /** `radio` rows: this choice is the current one (accent mark, `accessibilityState.selected`). */
  selected?: boolean;
  /** `check` rows: checked (accent box with a tick, `accessibilityState.checked`); `toggle` rows: on (accent value). */
  checked?: boolean;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: BlurEvent) => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
  ref?: Ref<HostView>;
};

const TOKENS = components['setting-row'];
/** The radio mark's diameter. */
const RADIO = 18;
/** The check box's side (the mock's 32 px at 1920, halved and rounded to the radio's). */
const CHECK = 18;

/**
 * DESIGN.md SettingRow (`setting-row` tokens): focusable in every kind, so
 * the remote can reach and read it. Focused: ring, `surface-focus-row` and
 * the row scale; secondary text switches to `text-secondary`.
 */
export function SettingRow({
  kind,
  label,
  value,
  description,
  valueLines = 1,
  onPress,
  selected = false,
  checked = false,
  onFocus,
  onBlur,
  hasTVPreferredFocus,
  testID,
  ref,
}: SettingRowProps) {
  const radio = kind === 'radio';
  const check = kind === 'check';
  const toggle = kind === 'toggle';
  const info = kind === 'info';
  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.surface,
    focused && { backgroundColor: TOKENS.bgFocus },
  ];
  const a11yLabel = [label, value, description].filter(Boolean).join(' ');

  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      // An info row's OK is not a «click» (Story 8.3): no visible press.
      scalePressed={info ? 1 : undefined}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole={
        radio ? 'radio' : check ? 'checkbox' : toggle ? 'switch' : kind === 'nav' ? 'button' : 'text'
      }
      accessibilityLabel={a11yLabel}
      accessibilityState={
        radio ? { selected, checked: selected } : check || toggle ? { checked } : undefined
      }
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      surfaceStyle={surfaceStyle}
    >
      {({ focused }) => (
        <View style={description ? styles.described : undefined}>
          <View style={valueLines > 1 ? styles.stacked : styles.content}>
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
            {check ? (
              <View
                testID={testID ? `${testID}/check` : undefined}
                style={[styles.check, checked && styles.checkOn]}
              >
                {checked ? (
                  <CheckIcon
                    testID={testID ? `${testID}/checked` : undefined}
                    color={colors['accent-ink']}
                    size={CHECK - 4}
                  />
                ) : null}
              </View>
            ) : null}
            <Text
              variant="body"
              numberOfLines={1}
              style={valueLines > 1 ? undefined : styles.label}
            >
              {label}
            </Text>
            {value ? (
              <Text
                testID={testID ? `${testID}/value` : undefined}
                variant="body"
                numberOfLines={valueLines}
                color={toggle && checked ? 'accent' : focused ? 'text-secondary' : 'text-meta'}
              >
                {value}
              </Text>
            ) : null}
          </View>
          {description ? (
            <Text
              testID={testID ? `${testID}/description` : undefined}
              variant="body-s"
              color={focused ? 'text-secondary' : 'text-meta'}
              style={styles.description}
            >
              {description}
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
  // `valueLines` > 1: the value under the label (device: Story 5.4, a long
  // value beside the label squeezed the label or overflowed the row).
  stacked: {
    paddingVertical: spacing['3'],
  },
  // A row with a description (Story 8.2): the label line, then the description.
  described: {
    paddingVertical: spacing['3'],
  },
  description: {
    marginTop: spacing['1'],
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
  // The check box (DESIGN.md: selected check marks use `accent`; the mock's
  // tick is dark ink on the accent box).
  check: {
    width: CHECK,
    height: CHECK,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors['text-meta'],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing['6'],
  },
  checkOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  radioDot: {
    width: RADIO / 2,
    height: RADIO / 2,
    borderRadius: RADIO / 4,
    backgroundColor: colors.accent,
  },
});
