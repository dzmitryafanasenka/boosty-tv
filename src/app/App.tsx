import { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { AudioFilesCheck } from './spike/AudioFilesCheck';
import { ContentShapesCheck } from './spike/ContentShapesCheck';
import { JsStackCheck } from './spike/JsStackCheck';
import { KeychainCheck } from './spike/KeychainCheck';
import { NavigationCheck } from './spike/NavigationCheck';
import { PhoneAuthCheck } from './spike/PhoneAuthCheck';
import { PlaybackCheck } from './spike/PlaybackCheck';
import { QrCheck } from './spike/QrCheck';
import { SessionRefreshCheck } from './spike/SessionRefreshCheck';
import { SpikeButton, spikeColors } from './spike/SpikeUi';
import { VideoCheck } from './spike/VideoCheck';
import { ZodPluralCheck } from './spike/ZodPluralCheck';

/**
 * Spike menu (spike branches only; never merged). Story 1.7 adds the audio
 * and files check as the first entry, then Story 1.6's playback,
 * expiry and progress check, then the Story 1.5 content
 * shapes check, the Story 1.4 session refresh/logout
 * check and the Story 1.3 phone sign-in;
 * the Story 1.2 library checks follow. Each entry opens one check screen.
 * The menu is also present in the locally signed release-like build, where
 * the device checks run.
 */

const CHECKS = [
  { id: 'audiofiles', label: 'Аудио и файлы', Screen: AudioFilesCheck },
  {
    id: 'playback',
    label: 'Плеер: доступ, истечение, прогресс',
    Screen: PlaybackCheck,
  },
  {
    id: 'contentshapes',
    label: 'Контент: доступ, ошибки, события',
    Screen: ContentShapesCheck,
  },
  {
    id: 'sessionrefresh',
    label: 'Сессия: обновление и выход',
    Screen: SessionRefreshCheck,
  },
  { id: 'phoneauth', label: 'Вход по телефону', Screen: PhoneAuthCheck },
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
      <Text style={styles.title}>Boosty TV — спайк 1.7</Text>
      <Text style={styles.subtitle}>
        {`Проверки на устройстве (${__DEV__ ? 'debug' : 'release'})`}
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
