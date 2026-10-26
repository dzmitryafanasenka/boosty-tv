import type { Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from './Button';
import type { HostView } from './FocusableSurface';
import { Text } from './Text';
import { components, spacing } from './tokens';

export type DialogAction = {
  /** From the i18n catalog. */
  label: string;
  onPress: () => void;
  testID?: string;
  /** In progress: spinner, focus kept, OK ignored. */
  busy?: boolean;
  ref?: Ref<HostView>;
};

export type DialogProps = {
  /** From the i18n catalog. */
  title: string;
  body: string;
  /** The first action has the initial focus (the safe choice, e.g. «Отмена»). */
  primary: DialogAction;
  /** The second action, to the right of the first. */
  secondary: DialogAction;
  /** An inline error line under the body (polite live region). */
  error?: string;
  testID?: string;
};

const TOKENS = components.dialog;

/**
 * DESIGN.md Dialog (`dialog` tokens): centered (the modal host centers its
 * content above `colors.scrim`), `rounded.xl`, max width 560; a title, a
 * body, an optional error line and two actions in one row, so ← → move
 * between them natively. The first action is the preferred focus when the
 * dialog mounts inside the modal host's trap. Both actions are secondary
 * buttons: the dialog carries no visual push towards the riskier one.
 */
export function Dialog({ title, body, primary, secondary, error, testID }: DialogProps) {
  return (
    <View testID={testID} style={styles.dialog}>
      <Text variant="title-s" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="body-s" color="text-secondary" style={styles.body}>
        {body}
      </Text>
      {error ? (
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
      <View style={styles.actions}>
        <Button
          ref={primary.ref}
          testID={primary.testID}
          kind="secondary"
          label={primary.label}
          busy={primary.busy}
          onPress={primary.onPress}
          hasTVPreferredFocus
        />
        <Button
          ref={secondary.ref}
          testID={secondary.testID}
          kind="secondary"
          label={secondary.label}
          busy={secondary.busy}
          onPress={secondary.onPress}
          style={styles.actionGap}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dialog: {
    maxWidth: TOKENS.maxWidth,
    borderRadius: TOKENS.radius,
    backgroundColor: TOKENS.bg,
    // Spacing from the Settings mock (1920 frame, halved to dp).
    padding: spacing['11'],
  },
  body: {
    marginTop: spacing['5'],
  },
  error: {
    marginTop: spacing['5'],
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing['9'],
  },
  actionGap: {
    marginLeft: spacing['5'],
  },
});
