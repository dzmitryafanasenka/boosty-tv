import { useCallback, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, TVFocusGuideView } from 'react-native';
import {
  NavigationContainer,
  useFocusEffect,
  type NavigationProp,
} from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SpikeButton, spikeColors, spikeLog } from './SpikeUi';

/**
 * Story 1.2 spike only. Same A/B scenario as NavigationCheck, built with the
 * JS stack (@react-navigation/stack). react-native-screens is bypassed for
 * this navigator with `detachInactiveScreens={false}`: the stack then renders
 * plain Views instead of RNSScreenContainer / RNSScreen. A global
 * `enableScreens(false)` is not used, so the native-stack check stays intact.
 *
 * The JS stack keeps the previous card (A) mounted under B, and Android
 * focus search can reach it: without a trap, D-pad on B moved focus to A's
 * items. Each screen is therefore wrapped in a TVFocusGuideView that traps
 * focus on all four sides.
 */

type StackParams = { A: undefined; B: { from: number } };

const Stack = createStackNavigator<StackParams>();

function ScreenA({
  navigation,
  onExit,
}: {
  navigation: NavigationProp<StackParams>;
  onExit: () => void;
}) {
  const [focused, setFocused] = useState<number | null>(null);
  // Explicit focus restoration: the JS stack keeps A mounted, and when B is
  // removed Android moves focus to the first focusable view (item 1). The
  // item focused when A lost screen focus gets hasTVPreferredFocus again.
  const lastFocused = useRef(1);
  const [preferred, setPreferred] = useState(1);

  // Registered while A is focused: Back on A (stack root) leaves the check.
  useFocusEffect(
    useCallback(() => {
      spikeLog(
        'jsnav',
        `A focused (screen), restore item ${lastFocused.current}`,
      );
      setPreferred(lastFocused.current);
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onExit();
        return true;
      });
      return () => {
        sub.remove();
        setPreferred(0);
      };
    }, [onExit]),
  );

  const onItemFocus = (item: number) => {
    if (preferred !== 0) {
      lastFocused.current = item;
    }
    setFocused(item);
    spikeLog('jsnav', `A item ${item} focused`);
  };

  return (
    <TVFocusGuideView
      style={styles.screen}
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
    >
      <Text style={styles.title}>Экран A — JS stack</Text>
      <Text style={styles.status}>
        {`В фокусе: ${focused === null ? 'ничего' : `пункт ${focused}`}`}
      </Text>
      {[1, 2, 3].map(item => (
        <SpikeButton
          key={item}
          testID={`jsnav-item-${item}`}
          label={item === 2 ? `Пункт ${item} (OK → экран B)` : `Пункт ${item}`}
          preferredFocus={item === preferred}
          onFocus={() => onItemFocus(item)}
          onPress={() => {
            spikeLog('jsnav', `A item ${item} pressed`);
            if (item === 2) {
              navigation.navigate('B', { from: item });
            }
          }}
        />
      ))}
    </TVFocusGuideView>
  );
}

function ScreenB() {
  const [focused, setFocused] = useState(false);
  return (
    <TVFocusGuideView
      style={styles.screen}
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
    >
      <Text style={styles.title}>Экран B — JS stack</Text>
      <Text style={styles.status}>
        {`Нажмите «Назад». В фокусе: ${focused ? 'кнопка B' : 'ничего'}`}
      </Text>
      <SpikeButton
        label="Кнопка на экране B"
        preferredFocus
        onFocus={() => {
          setFocused(true);
          spikeLog('jsnav', 'B button focused');
        }}
        onPress={() => spikeLog('jsnav', 'B button pressed')}
      />
    </TVFocusGuideView>
  );
}

export function JsStackCheck({ onExit }: { onExit: () => void }) {
  return (
    <NavigationContainer
      onStateChange={state =>
        spikeLog(
          'jsnav',
          `stack: ${state?.routes.map(route => route.name).join(' > ') ?? '-'}`,
        )
      }
    >
      <Stack.Navigator
        detachInactiveScreens={false}
        screenOptions={{ headerShown: false, gestureEnabled: false }}
      >
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
