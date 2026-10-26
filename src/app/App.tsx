import {
  NavigationContainer,
  DarkTheme,
  createNavigationContainerRef,
  type Theme,
} from '@react-navigation/native';
import {
  createStackNavigator,
  type StackScreenProps,
} from '@react-navigation/stack';
import { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  CodeScreen,
  PhoneScreen,
  SignedInScreen,
  WelcomeScreen,
} from '../features/auth';
import { sessionManager } from '../shared/api';
import { colors } from '../shared/ui';
import type { RootStackParamList } from './routes';

const Stack = createStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Background of the container and cards, so no light frame shows. */
const theme: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg },
};

/** The first route, decided by `sessionManager.restore()`. */
type Boot = { initial: 'Welcome' | 'SignedIn'; signInAgain: boolean };

/** Replace the whole stack with the signed-in screen (Back then exits). */
function openSignedIn() {
  if (navigationRef.isReady()) {
    navigationRef.reset({ index: 0, routes: [{ name: 'SignedIn' }] });
  }
}

function Welcome({ navigation, route }: StackScreenProps<RootStackParamList, 'Welcome'>) {
  return (
    <WelcomeScreen
      onSignIn={() => navigation.navigate('Phone')}
      signInAgain={route.params?.signInAgain === true}
    />
  );
}

function Phone({ navigation }: StackScreenProps<RootStackParamList, 'Phone'>) {
  return (
    <PhoneScreen
      onCodeSent={() => navigation.navigate('Code')}
      onExit={() => navigation.goBack()}
    />
  );
}

function Code({ navigation }: StackScreenProps<RootStackParamList, 'Code'>) {
  return (
    <CodeScreen
      onChangeNumber={() => navigation.goBack()}
      onSignedIn={openSignedIn}
    />
  );
}

/**
 * App root. Startup gate: a neutral splash (`colors.bg`, nothing focusable)
 * until `sessionManager.restore()` resolves; then a stored session opens
 * SignedIn, nothing (or a transient storage error) opens Welcome, and a
 * wiped store opens Welcome with «Войдите снова». E1 at startup is Story 2.5.
 *
 * The JS stack (ADR 0007): `detachInactiveScreens={false}` renders plain
 * Views, never react-native-screens; no header, no gestures (remote only).
 * Covered screens stay mounted; each screen traps focus (`Screen`). The
 * Shell (Story 2.4) replaces SignedIn.
 */
function App() {
  const [boot, setBoot] = useState<Boot | null>(null);

  useEffect(() => {
    let alive = true;
    sessionManager.restore().then(result => {
      if (alive) {
        setBoot(
          result.status === 'signedIn'
            ? { initial: 'SignedIn', signInAgain: false }
            : { initial: 'Welcome', signInAgain: result.reason === 'wiped' },
        );
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      {boot ? (
        <NavigationContainer ref={navigationRef} theme={theme}>
          <Stack.Navigator
            initialRouteName={boot.initial}
            detachInactiveScreens={false}
            screenOptions={{ headerShown: false, gestureEnabled: false }}
          >
            <Stack.Screen
              name="Welcome"
              component={Welcome}
              initialParams={{ signInAgain: boot.signInAgain }}
            />
            <Stack.Screen name="Phone" component={Phone} />
            <Stack.Screen name="Code" component={Code} />
            <Stack.Screen name="SignedIn" component={SignedInScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      ) : (
        <View testID="app/splash" style={styles.root} />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});

export default App;
