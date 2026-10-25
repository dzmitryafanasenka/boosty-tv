import { StyleSheet, View } from 'react-native';
import { Screen } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { Button, Text, spacing } from '../../shared/ui';

/** Focus id (docs/focus-map.md §1.5) of the only focusable element. */
export const WELCOME_SIGN_IN_ID = 'auth/welcome/signin';

const COLUMN_WIDTH = 440;
const COLUMN_TOP = 150;

/**
 * A1 Welcome (docs/focus-map.md §2). One focusable element, «Войти в
 * Boosty», with initial focus. OK does nothing until A2 lands (Story 2.2).
 * Back is not intercepted, so Android exits the app.
 */
export function WelcomeScreen() {
  return (
    <Screen testID="auth/welcome">
      <View style={styles.columnSlot}>
        <View style={styles.column}>
          <Text variant="hero" accessibilityRole="header">
            {t('welcome.titleHead')}
            <Text variant="hero" color="accent">
              {t('welcome.titleAccent')}
            </Text>
          </Text>
          <Text variant="body" color="text-secondary" style={styles.body}>
            {t('welcome.body')}
          </Text>
          <Button
            testID={WELCOME_SIGN_IN_ID}
            label={t('welcome.signIn')}
            hasTVPreferredFocus
            style={styles.button}
          />
        </View>
      </View>
      <Text variant="meta" color="text-tertiary" style={styles.footer}>
        {t('welcome.disclaimer')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  columnSlot: {
    position: 'absolute',
    top: COLUMN_TOP,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  column: {
    width: COLUMN_WIDTH,
  },
  body: {
    marginTop: spacing['6'],
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing['10'],
  },
  footer: {
    position: 'absolute',
    left: spacing['safe-x'],
    right: spacing['safe-x'],
    bottom: spacing['safe-y'],
  },
});
