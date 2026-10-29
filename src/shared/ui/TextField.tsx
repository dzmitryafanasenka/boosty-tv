import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { HostView } from './FocusableSurface';
import { requestHostFocus } from './requestHostFocus';
import { Text } from './Text';
import { colors, components, focus, spacing, typography } from './tokens';

export type TextFieldHandle = {
  /**
   * Moves D-pad focus to the field without opening the keyboard. The field's
   * host view requests focus natively; `TextInput.focus()` would also open
   * the IME (ReactEditText.requestFocusFromJS).
   */
  focus(): void;
  /** The host view, for focus guide destinations. */
  host(): HostView | null;
};

export type TextFieldProps = {
  /** Visible label and accessibility label; from the i18n catalog. */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** IME action («Готово»). */
  onSubmitEditing?: () => void;
  placeholder?: string;
  /** Error message (from the catalog); shows the error border and text. */
  error?: string | null;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** The input received focus (e.g. a FocusZone item's `onFocus`, Story 5.6). */
  onFocus?: () => void;
  /** The host view as it mounts and unmounts (e.g. a FocusZone item's `ref`, Story 5.6). */
  hostRef?: (view: HostView | null) => void;
  ref?: Ref<TextFieldHandle>;
};

const FIELD = components['text-field'];
const RING_INSET = -(focus['ring-offset'] + focus['ring-width']);

/**
 * DESIGN.md `components.text-field`: height 50, border 1.5, `focus-ring`
 * border when focused, no scale (`scale-field` 1.0), error border plus an
 * `error-text` message. Focused with an error, the border stays red and the
 * focus ring is drawn outside it (as the A4 mock), so focus stays visible.
 * Plain text, never a password field.
 *
 * OK on the focused field opens the system IME (Android TV default); the app
 * draws no keyboard. Back with the IME open closes it and keeps focus here.
 */
export function TextField({
  label,
  value,
  onChangeText,
  onSubmitEditing,
  placeholder,
  error,
  keyboardType = 'default',
  maxLength,
  testID,
  style,
  onFocus,
  hostRef: onHostRef,
  ref,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const hostRef = useRef<HostView>(null);
  const onHostRefRef = useRef(onHostRef);
  onHostRefRef.current = onHostRef;
  const setHost = useCallback((view: HostView | null) => {
    hostRef.current = view;
    onHostRefRef.current?.(view);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => requestHostFocus(hostRef.current),
      host: () => hostRef.current,
    }),
    [],
  );

  const hasError = Boolean(error);
  const borderColor = hasError
    ? FIELD.borderError
    : focused
      ? FIELD.borderFocus
      : FIELD.border;

  return (
    <View style={style}>
      <Text variant="body-s" color="text-secondary" style={styles.label}>
        {label}
      </Text>
      {/* Not collapsable: a real native view, so requestTVFocus() and focus
          guide destinations can find it; it hands focus to the input. */}
      <View
        ref={setHost}
        collapsable={false}
        testID={testID ? `${testID}/host` : undefined}
      >
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors['text-disabled']}
          cursorColor={colors.accent}
          selectionColor={colors['accent-tint']}
          keyboardType={keyboardType}
          maxLength={maxLength}
          returnKeyType="done"
          autoComplete="off"
          autoCorrect={false}
          importantForAutofill="no"
          accessibilityLabel={label}
          accessibilityHint={error ?? undefined}
          style={[styles.input, { borderColor }]}
        />
        {hasError && focused ? (
          <View
            testID={testID ? `${testID}/ring` : undefined}
            pointerEvents="none"
            style={styles.ring}
          />
        ) : null}
      </View>
      {hasError ? (
        <Text
          testID={testID ? `${testID}/error` : undefined}
          accessibilityLiveRegion="polite"
          variant="body-s"
          color="error-text"
          style={styles.error}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing['4'],
  },
  input: {
    ...typography['title-s'],
    height: FIELD.height,
    borderWidth: FIELD.borderWidth,
    borderRadius: FIELD.radius,
    backgroundColor: FIELD.bg,
    color: colors.text,
    paddingHorizontal: spacing['8'],
    paddingVertical: 0,
  },
  ring: {
    position: 'absolute',
    top: RING_INSET,
    right: RING_INSET,
    bottom: RING_INSET,
    left: RING_INSET,
    borderRadius: FIELD.radius - RING_INSET,
    borderWidth: focus['ring-width'],
    borderColor: colors['focus-ring'],
  },
  error: {
    marginTop: spacing['4'],
  },
});
