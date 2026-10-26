import { StyleSheet, View } from 'react-native';
import { Screen } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { Text, spacing } from '../../shared/ui';

const COLUMN_WIDTH = 440;
const COLUMN_TOP = 150;

/**
 * Temporary signed-in screen (Story 2.3; the Shell replaces it in Story
 * 2.4): a title and one body line, no personal data and no focusable
 * element. It is the only stack entry, so Back exits the app.
 */
export function SignedInScreen() {
  return (
    <Screen testID="auth/signed-in">
      <View style={styles.columnSlot}>
        <View style={styles.column}>
          <Text variant="title-l" accessibilityRole="header">
            {t('auth.signedIn.title')}
          </Text>
          <Text variant="body" color="text-secondary" style={styles.body}>
            {t('auth.signedIn.body')}
          </Text>
        </View>
      </View>
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
});
