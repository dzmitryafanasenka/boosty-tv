import { StyleSheet, View } from 'react-native';
import { useZoneItem } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { getVersionName } from '../../shared/platform/appInfo';
import { SettingRow, Text, spacing } from '../../shared/ui';

/** Focus ids (docs/focus-map.md §1.5). */
export const SETTINGS_VERSION_ID = 'settings/row/version';
export const SETTINGS_FOCUS_CHECK_ID = 'settings/row/focus-check';

export type SettingsScreenProps = {
  /**
   * Debug builds only: opens «Проверка фокуса». The row is rendered only
   * when this is given; the app passes it under `__DEV__`.
   */
  onOpenFocusCheck?: () => void;
};

/**
 * Настройки in Story 2.4: one focusable info row «Версия <versionName>»
 * (OK does nothing), the initial focus of the section. Sign-out arrives in
 * Story 2.7. Rendered inside the Shell's content FocusZone.
 */
export function SettingsScreen({ onOpenFocusCheck }: SettingsScreenProps) {
  const version = useZoneItem(SETTINGS_VERSION_ID);
  const focusCheck = useZoneItem(SETTINGS_FOCUS_CHECK_ID);

  return (
    <View testID="settings" style={styles.root}>
      <Text variant="title-s" accessibilityRole="header" style={styles.title}>
        {t('settings.title')}
      </Text>
      <View style={styles.rows}>
        <SettingRow
          ref={version.ref}
          testID={SETTINGS_VERSION_ID}
          kind="info"
          label={t('settings.version')}
          value={getVersionName() ?? t('settings.versionUnknown')}
          onFocus={version.onFocus}
        />
        {onOpenFocusCheck ? (
          <SettingRow
            ref={focusCheck.ref}
            testID={SETTINGS_FOCUS_CHECK_ID}
            kind="nav"
            label={t('dev.focusCheck.row')}
            onPress={onOpenFocusCheck}
            onFocus={focusCheck.onFocus}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  title: {
    marginBottom: spacing['8'],
  },
  // Focus headroom: the scaled row and its ring stay inside the safe area.
  rows: {
    paddingHorizontal: spacing['focus-headroom'],
  },
});
