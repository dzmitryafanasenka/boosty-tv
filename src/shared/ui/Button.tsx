import type { ReactNode, Ref } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  FocusableSurface,
  type FocusableSurfaceProps,
  type HostView,
  type SurfaceState,
} from './FocusableSurface';
import { Spinner } from './Spinner';
import { Text } from './Text';
import { colors, components, focus, rounded, spacing, typography } from './tokens';

export type ButtonKind = 'primary' | 'secondary';
export type ButtonSize = 'normal' | 'small';

export type ButtonProps = {
  /** Visible label and accessibility label; from the i18n catalog. */
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  size?: ButtonSize;
  /** Action in progress: spinner, focus kept, OK ignored. */
  busy?: boolean;
  /**
   * Shown instead of the spinner while `busy` (e.g. «Обновляем…», Story
   * 5.1). The button keeps the wider of the two labels' widths, so the
   * swap never changes its size.
   */
  busyLabel?: string;
  /** Accessibility label when it differs from the visible one (default `label`). */
  accessibilityLabel?: string;
  /** Accessibility label while `busy` (default `busyLabel`, else as idle). */
  busyAccessibilityLabel?: string;
  /**
   * Story 7.4: an icon before the label (e.g. the like's heart), hidden
   * while busy like the label. The caller draws it in the label's ink
   * (`buttonInk`). Not with `busyLabel`.
   */
  icon?: ReactNode;
  /**
   * Story 7.4: an on/off button in its on state (e.g. «Вам нравится»): the
   * label and icon use the accent ink, and the accessibility state says
   * selected. Distinct from focus (the background still follows focus).
   */
  selected?: boolean;
  /**
   * Story 7.4: a request runs but the button keeps its label, icon and
   * `onPress` (an optimistic toggle that ignores OK itself): only the
   * accessibility state says busy. `busy` is the spinner variant.
   */
  accessibilityBusy?: boolean;
  /** See `FocusableSurface` `focusable` (default true). */
  focusable?: boolean;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** The focusable host view (for `requestTVFocus()` and focus guides). */
  ref?: Ref<HostView>;
  /** Native focus arrived (e.g. `useZoneItem`'s `onFocus`). */
  onFocus?: FocusableSurfaceProps['onFocus'];
};

const KIND = {
  primary: {
    bg: components['button-primary'].bg,
    bgFocus: components['button-primary'].bgFocus,
    text: components['button-primary'].text,
    scaleFocus: components['button-primary'].scaleFocus,
  },
  secondary: {
    bg: components['button-secondary'].bg,
    bgFocus: components['button-secondary'].bgFocus,
    text: components['button-secondary'].text,
    // DESIGN.md gives button-secondary no scaleFocus; buttons share it.
    scaleFocus: focus['scale-button'],
  },
} as const satisfies Record<
  ButtonKind,
  { bg: string; bgFocus: string; text: string; scaleFocus: number }
>;

const SIZE = {
  normal: {
    height: components['button-primary'].height,
    paddingX: components['button-primary'].paddingX,
    radius: components['button-primary'].radius,
    variant: 'button',
  },
  small: {
    height: components['button-small'].height,
    paddingX: components['button-small'].paddingX,
    // DESIGN.md › Shapes: small buttons use rounded.md.
    radius: rounded.md,
    variant: 'button-s',
  },
} as const;

/** The label's ink for a button state (an icon passed in `icon` uses it too). */
export function buttonInk({
  kind = 'primary',
  disabled = false,
  selected = false,
}: Pick<ButtonProps, 'kind' | 'disabled' | 'selected'>): string {
  if (disabled) {
    return colors['text-disabled'];
  }
  return selected && kind === 'secondary' ? colors['accent-text'] : KIND[kind].text;
}

/** DESIGN.md Button, primary and secondary kinds, normal and small sizes. */
export function Button({
  label,
  onPress,
  kind = 'primary',
  size = 'normal',
  busy = false,
  busyLabel,
  accessibilityLabel,
  busyAccessibilityLabel,
  icon,
  selected,
  accessibilityBusy = false,
  focusable,
  disabled = false,
  hasTVPreferredFocus,
  testID,
  style,
  ref,
  onFocus,
}: ButtonProps) {
  const k = KIND[kind];
  const s = SIZE[size];

  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.surface,
    {
      height: s.height,
      paddingHorizontal: s.paddingX,
      backgroundColor: disabled
        ? colors.surface
        : focused
          ? k.bgFocus
          : k.bg,
    },
  ];
  const textColor = buttonInk({ kind, disabled, selected });

  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      style={style}
      radius={s.radius}
      scaleFocus={k.scaleFocus}
      disabled={disabled}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={
        busy && (busyAccessibilityLabel ?? busyLabel) !== undefined
          ? (busyAccessibilityLabel ?? busyLabel)
          : (accessibilityLabel ?? label)
      }
      accessibilityState={
        selected === undefined
          ? { busy: busy || accessibilityBusy, disabled }
          : { busy: busy || accessibilityBusy, disabled, selected }
      }
      onPress={busy || disabled ? undefined : onPress}
      onFocus={onFocus}
      surfaceStyle={surfaceStyle}
    >
      {/* The label always keeps its place, so busy never changes the width. */}
      {busyLabel !== undefined ? (
        <View style={styles.labels}>
          <Text
            variant={s.variant}
            numberOfLines={1}
            style={[{ color: textColor }, busy && styles.hidden]}
          >
            {label}
          </Text>
          <Text
            testID={testID ? `${testID}/busy-label` : undefined}
            variant={s.variant}
            numberOfLines={1}
            style={[
              { color: textColor, marginTop: -typography[s.variant].lineHeight },
              !busy && styles.hidden,
            ]}
          >
            {busyLabel}
          </Text>
        </View>
      ) : (
        <View style={icon ? styles.iconRow : undefined}>
          {icon ? <View style={[styles.icon, busy && styles.hidden]}>{icon}</View> : null}
          <Text
            variant={s.variant}
            numberOfLines={1}
            style={[{ color: textColor }, busy && styles.hidden]}
          >
            {label}
          </Text>
          {busy ? (
            <View style={styles.spinnerSlot}>
              <Spinner
                color={textColor}
                testID={testID ? `${testID}/spinner` : undefined}
              />
            </View>
          ) : null}
        </View>
      )}
    </FocusableSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    justifyContent: 'center',
  },
  hidden: {
    opacity: 0,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: spacing['3'],
  },
  // Both labels stacked in one line's place: the wider one sets the width.
  labels: {
    alignItems: 'center',
  },
  spinnerSlot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
