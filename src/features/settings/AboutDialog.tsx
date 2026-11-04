import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { t, tf } from '../../shared/i18n';
import { getVersionName } from '../../shared/platform/appInfo';
import {
  Button,
  QrCodeBox,
  Text,
  components,
  requestHostFocus,
  spacing,
  type HostView,
} from '../../shared/ui';

/** Focus id of «Закрыть» (docs/focus-map.md §5 K). */
export const ABOUT_CLOSE_ID = 'dialog/about/close';

export type AboutDialogProps = {
  /** The public repository page; only drawn as a QR code, never shown as text. */
  repositoryUrl: string;
  /** «Закрыть»: the caller closes the modal (focus goes back to «О приложении»). */
  onClose: () => void;
};

/**
 * «О приложении» (Story 15.1, IMP-09, FR-66), shown in the single modal
 * host, which traps focus and closes it on Back (focus returns to the row).
 * The app name, «Версия X.Y.Z» (or «Версия неизвестна»), the disclaimer,
 * «Лицензия MIT», the repository QR on `qr-bg` with «Откроется на телефоне»,
 * and «Закрыть», the only focus target. Nothing opens on the TV.
 */
export function AboutDialog({ repositoryUrl, onClose }: AboutDialogProps) {
  const closeRef = useRef<HostView>(null);
  useEffect(() => {
    requestHostFocus(closeRef.current);
  }, []);
  const version = getVersionName();
  return (
    <View testID="dialog/about" style={styles.dialog}>
      <Text variant="title-s" accessibilityRole="header" style={styles.centered}>
        {t('shell.wordmark')}
      </Text>
      <Text testID="dialog/about/version" variant="body-s" color="text-secondary" style={styles.line}>
        {version !== null ? tf('dialog.about.version', { version }) : t('dialog.about.versionUnknown')}
      </Text>
      <Text variant="body-s" color="text-secondary" style={styles.line}>
        {t('dialog.about.disclaimer')}
      </Text>
      <Text variant="body-s" color="text-secondary" style={styles.line}>
        {t('dialog.about.license')}
      </Text>
      <View style={styles.qr}>
        <QrCodeBox value={repositoryUrl} testID="dialog/about/qr" />
      </View>
      <Text variant="body-s" color="text-secondary" style={styles.hint}>
        {t('qr.hint')}
      </Text>
      <Button
        ref={closeRef}
        testID={ABOUT_CLOSE_ID}
        kind="secondary"
        label={t('qr.close')}
        onPress={onClose}
        hasTVPreferredFocus
        style={styles.close}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dialog: {
    maxWidth: components.dialog.maxWidth,
    borderRadius: components['qr-dialog'].radius,
    backgroundColor: components.dialog.bg,
    padding: spacing['11'],
    alignItems: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  line: {
    marginTop: spacing['3'],
    textAlign: 'center',
  },
  qr: {
    marginTop: spacing['8'],
  },
  hint: {
    marginTop: spacing['6'],
    textAlign: 'center',
  },
  close: {
    marginTop: spacing['9'],
  },
});
