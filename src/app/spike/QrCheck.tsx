import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  SpikeButton,
  SpikeScreen,
  spikeColors,
  spikeLog,
  useBackToMenu,
} from './SpikeUi';

/**
 * Story 1.2 spike only. Renders a ~300-character URL as a QR code, fully
 * offline (no network involved in rendering). The URL points at a reserved
 * example domain and carries no data.
 */
const BASE = 'https://example.com/boosty-tv-spike/qr-check?payload=';
const FILLER =
  'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
export const QR_URL = (BASE + FILLER.repeat(5)).slice(0, 300) + '&end=1';

export function QrCheck({ onExit }: { onExit: () => void }) {
  useBackToMenu(onExit);

  return (
    <SpikeScreen
      title="react-native-qrcode-svg"
      controls={
        <SpikeButton label="Назад в меню" onPress={onExit} preferredFocus />
      }
    >
      <View style={styles.row}>
        <View style={styles.quietZone}>
          <QRCode
            value={QR_URL}
            size={300}
            ecl="M"
            onError={(error: unknown) =>
              spikeLog('qr', `ERROR ${String(error)}`)
            }
          />
        </View>
        <View style={styles.side}>
          <Text style={styles.text}>{`Длина URL: ${QR_URL.length}`}</Text>
          <Text style={styles.url}>{QR_URL}</Text>
        </View>
      </View>
    </SpikeScreen>
  );
}

spikeLog('qr', `module loaded, url length ${QR_URL.length}`);

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  quietZone: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    alignSelf: 'flex-start',
  },
  side: { flex: 1, marginLeft: 16 },
  text: { color: spikeColors.text, fontSize: 14, marginBottom: 8 },
  url: { color: spikeColors.muted, fontSize: 11 },
});
