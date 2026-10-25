import { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { JsStackCheck } from './spike/JsStackCheck';
import { KeychainCheck } from './spike/KeychainCheck';
import { NavigationCheck } from './spike/NavigationCheck';
import { QrCheck } from './spike/QrCheck';
import { SpikeButton, spikeColors } from './spike/SpikeUi';
import { VideoCheck } from './spike/VideoCheck';
import { ZodPluralCheck } from './spike/ZodPluralCheck';

/**
 * Story 1.2 spike menu (branch spike/1-2-library-compat only; never merged).
 * Each entry opens one library check screen. The menu is also present in the
 * locally signed release-like build, because the Zod/Hermes check must run
 * there.
 */

const CHECKS = [
  {
    id: 'navigation',
    label: 'Навигация (native-stack)',
    Screen: NavigationCheck,
  },
  { id: 'jsstack', label: 'Навигация (JS stack)', Screen: JsStackCheck },
  { id: 'keychain', label: 'Keychain', Screen: KeychainCheck },
  { id: 'video', label: 'Видео', Screen: VideoCheck },
  { id: 'zod', label: 'Zod + множественные формы', Screen: ZodPluralCheck },
  { id: 'qr', label: 'QR-код', Screen: QrCheck },
] as const;

type CheckId = (typeof CHECKS)[number]['id'];

function App() {
  const [active, setActive] = useState<CheckId | null>(null);
  const [lastActive, setLastActive] = useState<CheckId>(CHECKS[0].id);

  const exit = useCallback(() => setActive(null), []);

  const check = CHECKS.find(c => c.id === active);
  if (check) {
    const { Screen } = check;
    return (
      <>
        <StatusBar hidden />
        <Screen onExit={exit} />
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <Text style={styles.title}>Boosty TV — спайк 1.2</Text>
      <Text style={styles.subtitle}>
        {`Проверка библиотек на устройстве (${__DEV__ ? 'debug' : 'release'})`}
      </Text>
      {CHECKS.map(c => (
        <SpikeButton
          key={c.id}
          testID={`menu-${c.id}`}
          label={c.label}
          preferredFocus={c.id === lastActive}
          onPress={() => {
            setLastActive(c.id);
            setActive(c.id);
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: spikeColors.background,
    paddingHorizontal: 48,
    paddingVertical: 32,
  },
  title: { color: spikeColors.text, fontSize: 28, fontWeight: '600' },
  subtitle: {
    color: spikeColors.muted,
    fontSize: 16,
    marginTop: 6,
    marginBottom: 20,
  },
});

export default App;
