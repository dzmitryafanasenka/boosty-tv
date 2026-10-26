import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen } from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  Button,
  Text,
  requestHostFocus,
  spacing,
  type HostView,
} from '../../shared/ui';

/** Focus id (docs/focus-map.md §1.5) of the only focusable element. */
export const WELCOME_SIGN_IN_ID = 'auth/welcome/signin';

const COLUMN_WIDTH = 440;
const COLUMN_TOP = 150;

export type WelcomeScreenProps = {
  /** OK on «Войти в Boosty»: open A2. */
  onSignIn: () => void;
  /** The stored session was unreadable and wiped: show «Войдите снова». */
  signInAgain?: boolean;
};

/**
 * A1 Welcome (docs/focus-map.md §2). One focusable element, «Войти в
 * Boosty», with initial focus; OK opens A2. Whenever A1 becomes the focused
 * route again (Back from A2), focus is put back on the button explicitly:
 * Android's post-pop fallback focus is never relied on (ADR 0007).
 * Back is not intercepted, so Android exits the app. After a wiped
 * (corrupted) store, the line «Войдите снова» is shown above the button.
 */
export function WelcomeScreen({ onSignIn, signInAgain = false }: WelcomeScreenProps) {
  const signInRef = useRef<HostView>(null);

  useFocusEffect(
    useCallback(() => {
      requestHostFocus(signInRef.current);
    }, []),
  );

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
          {signInAgain ? (
            <Text
              testID="auth/welcome/sign-in-again"
              accessibilityLiveRegion="polite"
              variant="body"
              color="text"
              style={styles.notice}
            >
              {t('auth.welcome.signInAgain')}
            </Text>
          ) : null}
          <Button
            ref={signInRef}
            testID={WELCOME_SIGN_IN_ID}
            label={t('welcome.signIn')}
            onPress={onSignIn}
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
  notice: {
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
