import { useCallback, useRef, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { useZoneItem } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { getVersionName } from '../../shared/platform/appInfo';
import { SettingRow, Text, spacing, type HostView } from '../../shared/ui';

/** Focus ids (docs/focus-map.md §1.5). */
export const SETTINGS_VERSION_ID = 'settings/row/version';
export const SETTINGS_SIGN_OUT_ID = 'settings/row/signout';
export const SETTINGS_FOCUS_CHECK_ID = 'settings/row/focus-check';
/**
 * Debug builds only. Folded to '' in release bundles (`__DEV__` is a Metro
 * constant), so the id is not shipped (__tests__/releaseBundle.test.js).
 */
export const SETTINGS_SESSION_CHECK_ID = __DEV__ ? 'settings/row/session-check' : '';
/** Debug builds only (Story 2.6), folded to '' in release like the one above. */
export const SETTINGS_EXPIRED_CHECK_ID = __DEV__ ? 'settings/row/expired-check' : '';

export type SettingsScreenProps = {
  /**
   * OK on «Выйти из аккаунта» (Story 2.7): the app opens the sign-out
   * dialog in the modal host with the row as the initiator, so focus
   * returns to it on «Отмена» or Back.
   */
  onOpenSignOut: (initiator: RefObject<HostView | null>) => void;
  /**
   * Debug builds only: opens «Проверка фокуса». The row is rendered only
   * when this is given; the app passes it under `__DEV__`.
   */
  onOpenFocusCheck?: () => void;
  /**
   * Debug builds only (Story 2.5): the one live refresh check. Corrupts the
   * in-memory access token, then E1 → 401 → refresh → retry. Rendered only
   * when given; the app passes it under `__DEV__`.
   */
  onCheckSession?: () => void;
  /**
   * Debug builds only (Story 2.6): sets the session status to `expired` in
   * memory only (no storage write, no network), so A11 can be checked on
   * the device without dropping the stored session. Rendered only when
   * given; the app passes it under `__DEV__`.
   */
  onExpireSession?: () => void;
};

/**
 * Настройки (Stories 2.4, 2.7): the info row «Версия <versionName>» (OK
 * does nothing), the initial focus of the section; below it the nav row
 * «Выйти из аккаунта», which opens the sign-out dialog; the debug rows
 * (`__DEV__` only) after it. Rendered inside the Shell's content FocusZone.
 */
export function SettingsScreen({
  onOpenSignOut,
  onOpenFocusCheck,
  onCheckSession,
  onExpireSession,
}: SettingsScreenProps) {
  const version = useZoneItem(SETTINGS_VERSION_ID);
  const focusCheck = useZoneItem(SETTINGS_FOCUS_CHECK_ID);
  const sessionCheck = useZoneItem(SETTINGS_SESSION_CHECK_ID);
  const expiredCheck = useZoneItem(SETTINGS_EXPIRED_CHECK_ID);
  const signOut = useZoneItem(SETTINGS_SIGN_OUT_ID);
  /** The row's host view, the dialog's initiator. */
  const signOutView = useRef<HostView | null>(null);
  const zoneRef = signOut.ref;
  const signOutRef = useCallback(
    (view: HostView | null) => {
      signOutView.current = view;
      zoneRef?.(view);
    },
    [zoneRef],
  );

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
        <SettingRow
          ref={signOutRef}
          testID={SETTINGS_SIGN_OUT_ID}
          kind="nav"
          label={t('settings.signOut.row')}
          onPress={() => onOpenSignOut(signOutView)}
          onFocus={signOut.onFocus}
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
        {__DEV__ && onCheckSession ? (
          <SettingRow
            ref={sessionCheck.ref}
            testID={SETTINGS_SESSION_CHECK_ID}
            kind="nav"
            label={t('dev.sessionCheck.row')}
            onPress={onCheckSession}
            onFocus={sessionCheck.onFocus}
          />
        ) : null}
        {__DEV__ && onExpireSession ? (
          <SettingRow
            ref={expiredCheck.ref}
            testID={SETTINGS_EXPIRED_CHECK_ID}
            kind="nav"
            label={t('dev.expiredCheck.row')}
            onPress={onExpireSession}
            onFocus={expiredCheck.onFocus}
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
