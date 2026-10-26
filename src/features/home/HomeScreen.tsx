import { StyleSheet, View } from 'react-native';
import { useZoneItem } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { StateView, spacing } from '../../shared/ui';

/** Focus id of «Повторить» on the offline StateView (docs/focus-map.md §3). */
export const HOME_OFFLINE_RETRY_ID = 'home/offline/retry';

export type HomeScreenProps = {
  /**
   * Cold start with a stored session but no network (E1 `Network` after the
   * retries): the offline StateView with «Повторить». The session is kept.
   * Absent: the placeholder. The Shell passes it down; this feature does
   * not know the session.
   */
  offline?: { retrying: boolean; onRetry: () => void };
};

/**
 * Главная until Epic 3 (EXPERIENCE › Shell): the neutral StateView «Лента
 * появится здесь» with no action, so the section has nothing focusable and
 * focus stays on the sidebar item (docs/focus-map.md §3).
 *
 * Offline: «Нет подключения к интернету» with «Повторить», a FocusZone item.
 * It gets focus only when OK on the current Главная item (or →) moves focus
 * into the content; E1 never moves focus by itself.
 */
export function HomeScreen({ offline }: HomeScreenProps) {
  const retry = useZoneItem(HOME_OFFLINE_RETRY_ID);
  if (offline) {
    return (
      <View testID="home/offline" style={styles.root}>
        <StateView
          title={t('home.offline.title')}
          body={t('home.offline.body')}
          action={{
            label: t('common.retry'),
            onPress: offline.onRetry,
            busy: offline.retrying,
            testID: HOME_OFFLINE_RETRY_ID,
            ref: retry.ref,
            onFocus: retry.onFocus,
          }}
          style={styles.withAction}
        />
      </View>
    );
  }
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
  // Focus headroom: the scaled button and its ring stay inside the content.
  withAction: {
    paddingHorizontal: spacing['focus-headroom'],
  },
});
