import { StyleSheet, View } from 'react-native';
import { t } from '../../shared/i18n';
import { StateView } from '../../shared/ui';

/**
 * Главная until Epic 3 (EXPERIENCE › Shell): the neutral StateView «Лента
 * появится здесь» with no action, so the section has nothing focusable and
 * focus stays on the sidebar item (docs/focus-map.md §3).
 */
export function HomeScreen() {
  return (
    <View testID="home/placeholder" style={styles.root}>
      <StateView
        title={t('home.placeholder.title')}
        body={t('home.placeholder.body')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
  },
});
