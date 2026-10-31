import { useCallback, useRef, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { useZoneItem } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { getVersionName } from '../../shared/platform/appInfo';
import { SettingRow, Text, spacing, type HostView } from '../../shared/ui';
import { useVersionPresses } from './useVersionPresses';

/** Focus ids (docs/focus-map.md §1.5). */
export const SETTINGS_EXTERNAL_PLAYER_ID = 'settings/row/external-player';
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
/** Debug builds only (Story 4.4), folded to '' in release like the ones above. */
export const SETTINGS_BREAK_VIDEO_ID = __DEV__ ? 'settings/row/break-video' : '';

export type SettingsScreenProps = {
  /**
   * Story 8.2 (PLAY-13, SET-02): the «Системный видеоплеер» toggle, the
   * first row. Rendered only when given; the app passes it while
   * `phaseFlags.externalPlayer` is on and the device value is read. `on`
   * is the current value; `onToggle` flips and stores it at once.
   */
  externalPlayer?: { on: boolean; onToggle: () => void };
  /**
   * Story 8.3 (SET-05): seven OK presses on «Версия» (each < 2 s apart,
   * `useVersionPresses`) call it; the app opens the hidden Diagnostics
   * route. Absent (`phaseFlags.diagnostics` off): «Версия» does nothing on
   * any number of presses.
   */
  onOpenDiagnostics?: () => void;
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
  /**
   * Debug builds only (Story 4.4): «Сломать следующую ссылку видео» arms a
   * one-shot flag, so the next video source the player resolves fails in
   * the engine (the automatic recovery's device check). Rendered only when
   * given; the app passes it under `__DEV__`.
   */
  onBreakNextVideoUrl?: () => void;
};

/**
 * Настройки (Stories 2.4, 2.7, 8.2): first the toggle row «Системный
 * видеоплеер» (Story 8.2, when given: «Вкл» / «Выкл», a description that
 * progress is not tracked; OK flips it at once); then the info row «Версия
 * <versionName>» (OK does nothing visible; seven quick presses open the
 * hidden Diagnostics when `onOpenDiagnostics` is given, Story 8.3), the
 * initial focus of the section; below
 * it the nav row «Выйти из аккаунта», which opens the sign-out dialog; the
 * debug rows (`__DEV__` only) after it. Rendered inside the Shell's content
 * FocusZone.
 */
export function SettingsScreen({
  externalPlayer,
  onOpenDiagnostics,
  onOpenSignOut,
  onOpenFocusCheck,
  onCheckSession,
  onExpireSession,
  onBreakNextVideoUrl,
}: SettingsScreenProps) {
  const externalPlayerRow = useZoneItem(SETTINGS_EXTERNAL_PLAYER_ID);
  const onVersionPress = useVersionPresses(onOpenDiagnostics);
  const version = useZoneItem(SETTINGS_VERSION_ID);
  const focusCheck = useZoneItem(SETTINGS_FOCUS_CHECK_ID);
  const sessionCheck = useZoneItem(SETTINGS_SESSION_CHECK_ID);
  const expiredCheck = useZoneItem(SETTINGS_EXPIRED_CHECK_ID);
  const breakVideo = useZoneItem(SETTINGS_BREAK_VIDEO_ID);
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
        {externalPlayer ? (
          <SettingRow
            ref={externalPlayerRow.ref}
            testID={SETTINGS_EXTERNAL_PLAYER_ID}
            kind="toggle"
            label={t('settings.externalPlayer.row')}
            value={externalPlayer.on ? t('settings.externalPlayer.on') : t('settings.externalPlayer.off')}
            checked={externalPlayer.on}
            description={t('settings.externalPlayer.description')}
            onPress={externalPlayer.onToggle}
            onFocus={externalPlayerRow.onFocus}
          />
        ) : null}
        <SettingRow
          ref={version.ref}
          testID={SETTINGS_VERSION_ID}
          kind="info"
          label={t('settings.version')}
          value={getVersionName() ?? t('settings.versionUnknown')}
          onPress={onVersionPress}
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
        {__DEV__ && onBreakNextVideoUrl ? (
          <SettingRow
            ref={breakVideo.ref}
            testID={SETTINGS_BREAK_VIDEO_ID}
            kind="nav"
            label={t('dev.breakVideo.row')}
            onPress={onBreakNextVideoUrl}
            onFocus={breakVideo.onFocus}
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
