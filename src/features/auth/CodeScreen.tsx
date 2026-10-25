import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { Button, Text, spacing } from '../../shared/ui';
import { authFlow } from './authFlow';

/** Focus id (docs/focus-map.md §1.5). */
export const CODE_CHANGE_NUMBER_ID = 'auth/code/change-number';

export type CodeScreenProps = {
  /** «Изменить номер»: back to A2 with the number kept. */
  onChangeNumber: () => void;
};

const COLUMN_WIDTH = 440;
const COLUMN_TOP = 100;

/**
 * A5 Code, minimal (Story 2.2): the step, the title and the hint, plus
 * «Изменить номер» as the only focusable element, so focus never stays on
 * the covered A2. The code field, confirm, resend and the countdown are
 * Story 2.3. Back (stack pop) or «Изменить номер» → A2 with the number kept.
 * The challenge lives in `authFlow` and is cleared when A5 is left.
 */
export function CodeScreen({ onChangeNumber }: CodeScreenProps) {
  useEffect(() => () => authFlow.clearChallenge(), []);

  return (
    <Screen testID="auth/code">
      <View style={styles.columnSlot}>
        <View style={styles.column}>
          <Text variant="body-s" color="text-tertiary" style={styles.step}>
            {t('auth.code.step')}
          </Text>
          <Text variant="title-l" accessibilityRole="header">
            {t('auth.code.title')}
          </Text>
          <Text variant="body" color="text-secondary" style={styles.body}>
            {t('auth.code.body')}
          </Text>
          <Button
            testID={CODE_CHANGE_NUMBER_ID}
            kind="secondary"
            label={t('auth.code.changeNumber')}
            onPress={onChangeNumber}
            hasTVPreferredFocus
            style={styles.button}
          />
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
  step: {
    marginBottom: spacing['4'],
  },
  body: {
    marginTop: spacing['6'],
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing['10'],
  },
});
