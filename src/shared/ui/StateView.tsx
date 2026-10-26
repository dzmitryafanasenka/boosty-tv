import type { ReactNode, Ref } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button, type ButtonProps } from './Button';
import type { HostView } from './FocusableSurface';
import { Text } from './Text';
import { colors, components, rounded, spacing } from './tokens';

export type StateViewAction = {
  /** From the i18n catalog. */
  label: string;
  onPress: () => void;
  testID?: string;
  /** In progress: spinner, focus kept, OK ignored. */
  busy?: boolean;
  /** The button's host view (a FocusZone item's `ref`). */
  ref?: Ref<HostView>;
  onFocus?: ButtonProps['onFocus'];
};

export type StateViewProps = {
  /** From the i18n catalog. */
  title: string;
  /** Explanation, from the i18n catalog. */
  body?: string;
  /** A custom icon; defaults to a neutral outline glyph. */
  icon?: ReactNode;
  /** At most one action (DESIGN.md StateView). None: nothing is focusable. */
  action?: StateViewAction;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

const TOKENS = components['state-view'];

/**
 * DESIGN.md StateView: icon, `title-s` title, `body-s` explanation and an
 * optional single action (a secondary Button).
 */
export function StateView({ title, body, icon, action, testID, style }: StateViewProps) {
  return (
    <View testID={testID} style={[styles.root, style]}>
      <View style={styles.icon}>{icon ?? <View style={styles.glyph} />}</View>
      <Text variant="title-s" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body ? (
        <Text variant="body-s" color="text-secondary" style={styles.body}>
          {body}
        </Text>
      ) : null}
      {action ? (
        <Button
          kind="secondary"
          label={action.label}
          onPress={action.onPress}
          testID={action.testID}
          busy={action.busy}
          ref={action.ref}
          onFocus={action.onFocus}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const GLYPH = TOKENS.iconSize * 0.6;

const styles = StyleSheet.create({
  root: {
    alignItems: 'flex-start',
  },
  icon: {
    width: TOKENS.iconSize,
    height: TOKENS.iconSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    width: GLYPH,
    height: GLYPH,
    borderRadius: rounded.md,
    borderWidth: 2,
    borderColor: colors['text-tertiary'],
  },
  title: {
    marginTop: spacing['8'],
  },
  body: {
    marginTop: spacing['4'],
  },
  action: {
    marginTop: spacing['10'],
  },
});
