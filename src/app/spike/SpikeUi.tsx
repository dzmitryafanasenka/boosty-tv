import { useEffect, type ReactNode } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

/**
 * Story 1.2 spike only (branch spike/1-2-library-compat). Minimal TV controls
 * shared by the library check screens. Not production UI.
 */

export function spikeLog(tag: string, message: string) {
  // Visible with `adb logcat -s ReactNativeJS`. Spike data only: no secrets.
  console.log(`[spike:${tag}] ${message}`);
}

/** Back on a check screen returns to the spike menu. */
export function useBackToMenu(onExit: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onExit();
      return true;
    });
    return () => sub.remove();
  }, [onExit, enabled]);
}

type SpikeButtonProps = {
  label: string;
  onPress: () => void;
  onFocus?: () => void;
  preferredFocus?: boolean;
  testID?: string;
};

export function SpikeButton({
  label,
  onPress,
  onFocus,
  preferredFocus,
  testID,
}: SpikeButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      hasTVPreferredFocus={preferredFocus}
      onPress={onPress}
      onFocus={onFocus}
      style={({ focused, pressed }) => [
        styles.button,
        focused && styles.buttonFocused,
        pressed && styles.buttonPressed,
      ]}
    >
      {({ focused }) => (
        <Text
          style={[styles.buttonLabel, focused && styles.buttonLabelFocused]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

type SpikeScreenProps = {
  title: string;
  controls: ReactNode;
  children?: ReactNode;
};

export function SpikeScreen({ title, controls, children }: SpikeScreenProps) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.body}>
        <View style={styles.controls}>{controls}</View>
        <View style={styles.content}>{children}</View>
      </View>
    </View>
  );
}

export function SpikeLog({ lines }: { lines: readonly string[] }) {
  return (
    <ScrollView style={styles.log} focusable={false}>
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`} style={styles.logLine}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

export const spikeColors = {
  background: '#121212',
  text: '#F2F2F2',
  muted: '#A8A8A8',
  accent: '#E8A33D',
  pass: '#6CCB7A',
  fail: '#E5645B',
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: spikeColors.background,
    paddingHorizontal: 32,
    paddingVertical: 20,
  },
  title: {
    color: spikeColors.text,
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 12,
  },
  body: { flex: 1, flexDirection: 'row' },
  controls: { width: 240, marginRight: 24 },
  content: { flex: 1 },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
    borderRadius: 6,
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: '#2A2A2A',
  },
  buttonFocused: {
    borderColor: spikeColors.accent,
    backgroundColor: '#3A3A3A',
  },
  buttonPressed: { backgroundColor: '#4A4A4A' },
  buttonLabel: { color: '#D0D0D0', fontSize: 15 },
  buttonLabelFocused: { color: '#FFFFFF' },
  log: { flex: 1 },
  logLine: { color: spikeColors.muted, fontSize: 12, marginBottom: 2 },
});
