import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { QrCode } from '../platform/qrRenderer';
import { Button } from './Button';
import type { HostView } from './FocusableSurface';
import { requestHostFocus } from './requestHostFocus';
import { Text } from './Text';
import { components, spacing } from './tokens';

/** Focus id of «Закрыть» (docs/focus-map.md §4 F7). */
export const QR_CLOSE_ID = 'dialog/qr/close';

const TOKENS = components['qr-dialog'];

export type QrDialogProps = {
  /** What the QR opens (a link's text, a file's title, «Видео на YouTube»). */
  title: string;
  /**
   * The QR target. It can be a personal signed link (a file): it is only
   * drawn as a QR code, never shown as text, logged or stored.
   */
  value: string;
  /** «Закрыть»: the caller closes the modal (focus goes back to the initiator). */
  onClose: () => void;
  testID?: string;
};

/**
 * DESIGN.md QrDialog (`qr-dialog` tokens, Story 6.3, focus-map §4 F7): the
 * title, a QR code generated on the device (200 dp on `qr-bg`), «Откроется на
 * телефоне» and «Закрыть». Shown in the single modal host, which traps focus
 * and closes it on Back (then focus returns to the initiator). «Закрыть» takes
 * the initial focus (`hasTVPreferredFocus` plus an explicit request on
 * mount). Nothing opens on the TV. Reused by Story 7.4 and 9.2.
 */
export function QrDialog({ title, value, onClose, testID = 'dialog/qr' }: QrDialogProps) {
  const closeRef = useRef<HostView>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    requestHostFocus(closeRef.current);
  }, []);
  // The library reports a value it cannot encode during its own render:
  // deferred, so this dialog never updates in the middle of a child's render.
  const onQrError = useCallback(() => {
    Promise.resolve().then(() => setFailed(true));
  }, []);
  return (
    <View testID={testID} style={styles.dialog}>
      <Text variant="title-s" accessibilityRole="header" numberOfLines={2} style={styles.title}>
        {title}
      </Text>
      <View
        testID={`${testID}/code`}
        accessible
        accessibilityRole="image"
        accessibilityLabel={failed ? t('qr.error') : t('qr.a11yCode')}
        style={styles.code}
      >
        {failed ? (
          // Dark text: it sits on the white `qr-bg`.
          <Text variant="body-s" color="bg" style={styles.error}>
            {t('qr.error')}
          </Text>
        ) : (
          <QrCode
            testID={`${testID}/svg`}
            value={value}
            size={TOKENS.qrSize}
            background={TOKENS.qrBg}
            onError={onQrError}
          />
        )}
      </View>
      <Text variant="body-s" color="text-secondary" style={styles.hint}>
        {t('qr.hint')}
      </Text>
      <Button
        ref={closeRef}
        testID={QR_CLOSE_ID}
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
    borderRadius: TOKENS.radius,
    backgroundColor: components.dialog.bg,
    padding: spacing['11'],
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
  },
  code: {
    marginTop: spacing['8'],
    width: TOKENS.qrSize,
    height: TOKENS.qrSize,
    borderRadius: components['qr-dialog'].radius / 2,
    backgroundColor: TOKENS.qrBg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    textAlign: 'center',
    paddingHorizontal: spacing['5'],
  },
  hint: {
    marginTop: spacing['6'],
    textAlign: 'center',
  },
  close: {
    marginTop: spacing['9'],
  },
});
