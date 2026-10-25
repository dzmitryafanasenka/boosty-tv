import { useCallback, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import {
  NavigationContainer,
  useFocusEffect,
  type NavigationProp,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SpikeButton, spikeColors, spikeLog } from './SpikeUi';

/**
 * Story 1.2 spike only. Two-screen native-stack: A has three focusable items;
 * OK on item 2 pushes B; Back pops; focus should return to item 2. The
 * focused item is shown on screen and logged.
 */

type StackParams = { A: undefined; B: { from: number } };

const Stack = createNativeStackNavigator<StackParams>();

function ScreenA({
  navigation,
  onExit,
}: {
  navigation: NavigationProp<StackParams>;
  onExit: () => void;
}) {
  const [focused, setFocused] = useState<number | null>(null);

  // Registered while A is focused: Back on A (stack root) leaves the check.
  useFocusEffect(
    useCallback(() => {
      spikeLog('nav', 'A focused (screen)');
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onExit();
        return true;
      });
      return () => sub.remove();
    }, [onExit]),
  );

  const onItemFocus = (item: number) => {
    setFocused(item);
    spikeLog('nav', `A item ${item} focused`);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Экран A — native-stack</Text>
      <Text style={styles.status}>
        {`В фокусе: ${focused === null ? 'ничего' : `пункт ${focused}`}`}
      </Text>
      {[1, 2, 3].map(item => (
        <SpikeButton
          key={item}
          testID={`nav-item-${item}`}
          label={item === 2 ? `Пункт ${item} (OK → экран B)` : `Пункт ${item}`}
          preferredFocus={item === 1}
          onFocus={() => onItemFocus(item)}
          onPress={() => {
            spikeLog('nav', `A item ${item} pressed`);
            if (item === 2) {
              navigation.navigate('B', { from: item });
            }
          }}
        />
      ))}
    </View>
  );
}

function ScreenB() {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Экран B</Text>
      <Text style={styles.status}>
        {`Нажмите «Назад». В фокусе: ${focused ? 'кнопка B' : 'ничего'}`}
      </Text>
      <SpikeButton
        label="Кнопка на экране B"
        preferredFocus
        onFocus={() => {
          setFocused(true);
          spikeLog('nav', 'B button focused');
        }}
        onPress={() => spikeLog('nav', 'B button pressed')}
      />
    </View>
  );
}

export function NavigationCheck({ onExit }: { onExit: () => void }) {
  return (
    <NavigationContainer
      onStateChange={state =>
        spikeLog(
          'nav',
          `stack: ${state?.routes.map(route => route.name).join(' > ') ?? '-'}`,
        )
      }
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="A">
          {({ navigation }) => (
            <ScreenA navigation={navigation} onExit={onExit} />
          )}
        </Stack.Screen>
        <Stack.Screen name="B" component={ScreenB} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: spikeColors.background,
    paddingHorizontal: 48,
    paddingVertical: 32,
  },
  title: { color: spikeColors.text, fontSize: 22, fontWeight: '600' },
  status: {
    color: spikeColors.accent,
    fontSize: 16,
    marginVertical: 12,
  },
});
