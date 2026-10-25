import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';

/**
 * Story 1.1 placeholder. One D-pad focusable button proves that the
 * react-native-tvos focus engine reaches the JS tree. Replaced by the real
 * Shell in a later story.
 */
function App() {
  const [pressCount, setPressCount] = useState(0);

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <Text style={styles.title}>Boosty TV</Text>
      <Text style={styles.subtitle}>Каркас проекта</Text>
      <Pressable
        testID="placeholder-button"
        accessibilityRole="button"
        hasTVPreferredFocus
        onPress={() => setPressCount(count => count + 1)}
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
            {pressCount === 0 ? 'Проверить фокус' : `Нажато: ${pressCount}`}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121212',
  },
  title: {
    color: '#F2F2F2',
    fontSize: 40,
    fontWeight: '600',
  },
  subtitle: {
    color: '#A8A8A8',
    fontSize: 20,
    marginTop: 8,
    marginBottom: 32,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: '#2A2A2A',
  },
  buttonFocused: {
    borderColor: '#E8A33D',
    backgroundColor: '#3A3A3A',
  },
  buttonPressed: {
    backgroundColor: '#4A4A4A',
  },
  buttonLabel: {
    color: '#D0D0D0',
    fontSize: 22,
  },
  buttonLabelFocused: {
    color: '#FFFFFF',
  },
});

export default App;
