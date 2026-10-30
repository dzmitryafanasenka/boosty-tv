import QRCode from 'react-native-qrcode-svg';

/**
 * The QrRenderer port (Story 6.3, ADR 0014): a QR code generated on the
 * device by `react-native-qrcode-svg` 6.3.26 (drawn with react-native-svg).
 * Error correction `M`, black modules on white with a white quiet zone, so a
 * phone camera reads it from the TV. Nothing leaves the device: no service
 * renders the code. The value can be a personal signed link (a file): it is
 * only drawn, never logged or shown as text.
 *
 * The background colour comes from the caller (`QrDialog` passes the
 * `qr-bg` token), so the port does not depend on `shared/ui`.
 *
 * Features use `QrDialog` (`shared/ui`), never the library directly. Jest
 * renders it with the react-native-svg manual mock.
 */

/** The quiet zone, dp (inside `size`): about four modules of a typical link's code. */
export const QR_QUIET_ZONE = 16;

export type QrCodeProps = {
  value: string;
  /** Side, dp (DESIGN `qr-dialog.qrSize`: 200). */
  size: number;
  /** Background and quiet zone colour (light, so a phone reads the code). */
  background: string;
  /** The value does not fit a QR code (the library throws while encoding). */
  onError?: () => void;
  testID?: string;
};

export function QrCode({ value, size, background, onError, testID }: QrCodeProps) {
  return (
    <QRCode
      testID={testID}
      value={value}
      size={size}
      ecl="M"
      color="#000000"
      backgroundColor={background}
      quietZone={QR_QUIET_ZONE}
      onError={() => onError?.()}
    />
  );
}
