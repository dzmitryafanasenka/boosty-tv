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
import { CodeScreen, PhoneScreen, WelcomeScreen } from '../features/auth';
import { sessionManager } from '../shared/api';
import { ModalHostProvider } from '../shared/focus';
import { colors } from '../shared/ui';
import type * as DevFocusModule from './dev/devFocus';
import type { RootStackParamList } from './routes';
import { Shell } from './Shell';

/**
 * Debug builds only (Story 2.4 «Проверка фокуса»). `__DEV__` is a constant
 * in Metro bundles, so in release the require and every dev route below are
 * folded away and the module is not bundled.
 */
const dev: typeof DevFocusModule | null = __DEV__
  ? require('./dev/devFocus')
  : null;

const Stack = createStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Background of the container and cards, so no light frame shows. */
const theme: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg },
};

/** The first route, decided by `sessionManager.restore()`. */
type Boot = { initial: 'Welcome' | 'Shell'; signInAgain: boolean };

/** Replace the whole stack with the Shell (Back on Главная then exits). */
function openShell() {
  if (navigationRef.isReady()) {
    navigationRef.reset({ index: 0, routes: [{ name: 'Shell' }] });
  }
}

function Welcome({
  navigation,
  route,
}: StackScreenProps<RootStackParamList, 'Welcome'>) {
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
      onSignedIn={openShell}
    />
  );
}

function ShellRoute({
  navigation,
  route,
}: StackScreenProps<RootStackParamList, 'Shell'>) {
  return (
    <Shell
      routeKey={route.key}
      onOpenFocusCheck={
        __DEV__ ? () => navigation.navigate('DevFocus') : undefined
      }
    />
  );
}

/**
 * App root. Startup gate: a neutral splash (`colors.bg`, nothing focusable)
 * until `sessionManager.restore()` resolves; then a stored session opens
 * the Shell, nothing (or a transient storage error) opens Welcome, and a
 * wiped store opens Welcome with «Войдите снова». E1 at startup is Story 2.5.
 *
 * The JS stack (ADR 0007): `detachInactiveScreens={false}` renders plain
 * Views, never react-native-screens; no header, no gestures (remote only).
 * Covered screens stay mounted; each screen traps focus (`Screen`). The one
 * modal host sits above the stack (AD-13).
 */
function App() {
  const [boot, setBoot] = useState<Boot | null>(null);

  useEffect(() => {
    let alive = true;
    sessionManager.restore().then(result => {
      if (alive) {
        setBoot(
          result.status === 'signedIn'
            ? { initial: 'Shell', signInAgain: false }
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
        <ModalHostProvider>
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
              <Stack.Screen name="Shell" component={ShellRoute} />
              {__DEV__ && dev ? (
                <>
                  <Stack.Screen name="DevFocus" component={dev.DevFocusRoute} />
                  <Stack.Screen
                    name="DevFocusDetail"
                    component={dev.DevFocusDetailRoute}
                  />
                </>
              ) : null}
            </Stack.Navigator>
          </NavigationContainer>
        </ModalHostProvider>
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
