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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StatusBar, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { CodeScreen, PhoneScreen, WelcomeScreen } from '../features/auth';
import {
  sessionManager,
  type SessionManager,
  type ValidateResult,
} from '../shared/api';
import { ModalHostProvider } from '../shared/focus';
import { t } from '../shared/i18n';
import { Text, colors, components, spacing } from '../shared/ui';
import { DEMO_MODE } from './appConfig';
import type * as DemoModule from './dev/demo';
import type * as DevFocusModule from './dev/devFocus';
import type { RootStackParamList } from './routes';
import { SessionUiContext, useSessionUi, type SessionUi } from './sessionUi';
import { Shell } from './Shell';

/**
 * Debug builds only (Story 2.4 «Проверка фокуса»). `__DEV__` is a constant
 * in Metro bundles, so in release the require and every dev route below are
 * folded away and the module is not bundled.
 */
const dev: typeof DevFocusModule | null = __DEV__
  ? require('./dev/devFocus')
  : null;

/**
 * Debug-only demo mode (Story 2.5, `appConfig.DEMO_MODE`): folded away in
 * release bundles like `dev` above.
 */
const demo: typeof DemoModule | null =
  __DEV__ && DEMO_MODE ? require('./dev/demo') : null;

/** The session the app runs on: the real one, or the demo's in-memory one. */
const session: SessionManager = demo
  ? demo.createDemoSessionManager()
  : sessionManager;

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

/** Story 2.5 (owner decision): `expired` → A1 «Войдите снова» until A11 (Story 2.6). */
function openSignInAgain() {
  if (navigationRef.isReady()) {
    navigationRef.reset({
      index: 0,
      routes: [{ name: 'Welcome', params: { signInAgain: true } }],
    });
  }
}

function ShellRoute({
  navigation,
  route,
}: StackScreenProps<RootStackParamList, 'Shell'>) {
  const ui = useSessionUi();
  return (
    <Shell
      routeKey={route.key}
      onOpenFocusCheck={
        __DEV__ ? () => navigation.navigate('DevFocus') : undefined
      }
      onCheckSession={__DEV__ ? ui.onCheckSession : undefined}
      homeOffline={
        ui.homeOffline
          ? { retrying: ui.retrying, onRetry: ui.onRetry }
          : undefined
      }
    />
  );
}

/** The persistent «ДЕМО» badge (DESIGN Badge tokens); not focusable. */
function DemoBadge() {
  return (
    <View
      testID="demo/badge"
      style={styles.badge}
      pointerEvents="none"
      focusable={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text variant="badge" style={styles.badgeText}>
        {t('demo.badge')}
      </Text>
    </View>
  );
}

/**
 * App root. Startup gate: a neutral splash (`colors.bg`, nothing focusable)
 * until `sessionManager.restore()` resolves; then a stored session opens
 * the Shell, nothing (or a transient storage error) opens Welcome, and a
 * wiped store opens Welcome with «Войдите снова».
 *
 * Story 2.5: with a stored session the Shell opens at once, then E1 runs in
 * the background (single-flight, never moves focus) at cold start and on
 * every return to the foreground. A cold-start E1 that ends in `Network`
 * shows Главная's offline StateView; «Повторить» runs E1 again. Resume
 * failures change nothing visible. `expired` (refresh 400 `invalid_grant`)
 * resets the stack to A1 «Войдите снова» from any screen.
 *
 * The JS stack (ADR 0007): `detachInactiveScreens={false}` renders plain
 * Views, never react-native-screens; no header, no gestures (remote only).
 * Covered screens stay mounted; each screen traps focus (`Screen`). The one
 * modal host sits above the stack (AD-13).
 */
function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [homeOffline, setHomeOffline] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(true);

  /** Cold start and «Повторить»: only `Network` keeps the offline view. */
  const applyColdResult = useCallback((result: ValidateResult) => {
    if (alive.current) {
      setHomeOffline(result.kind === 'failed' && result.error === 'Network');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    session.restore().then(result => {
      if (!alive.current) {
        return;
      }
      setBoot(
        result.status === 'signedIn'
          ? { initial: 'Shell', signInAgain: false }
          : {
              initial: 'Welcome',
              signInAgain:
                result.reason === 'wiped' || result.reason === 'expired',
            },
      );
    });
    const unsubscribe = session.subscribe(status => {
      if (status === 'expired') {
        setHomeOffline(false);
        openSignInAgain();
      }
    });
    const appState = AppState.addEventListener('change', state => {
      // Resume: E1 again; only a success changes anything (offline → placeholder).
      session.onAppStateChange(state)?.then(result => {
        if (alive.current && result.kind === 'ok') {
          setHomeOffline(false);
        }
      });
    });
    return () => {
      alive.current = false;
      unsubscribe();
      appState.remove();
    };
  }, [applyColdResult]);

  /**
   * The navigator is mounted: the cold-start E1 runs now, in the background,
   * so an `expired` result can always reset the stack.
   */
  const onNavigationReady = useCallback(() => {
    if (session.getStatus() === 'expired') {
      openSignInAgain();
    } else if (session.getStatus() === 'signedIn') {
      session.validate().then(applyColdResult);
    }
  }, [applyColdResult]);

  const onRetry = useCallback(() => {
    setRetrying(true);
    session.validate().then(result => {
      if (alive.current) {
        setRetrying(false);
        applyColdResult(result);
      }
    });
  }, [applyColdResult]);

  const ui = useMemo<SessionUi>(
    () => ({
      homeOffline,
      retrying,
      onRetry,
      onCheckSession: __DEV__
        ? () => {
            session.debugCorruptAccessToken?.();
          }
        : undefined,
    }),
    [homeOffline, retrying, onRetry],
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      {boot ? (
        <SessionUiContext.Provider value={ui}>
          <ModalHostProvider>
            <NavigationContainer
              ref={navigationRef}
              theme={theme}
              onReady={onNavigationReady}
            >
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
                    <Stack.Screen
                      name="DevFocus"
                      component={dev.DevFocusRoute}
                    />
                    <Stack.Screen
                      name="DevFocusDetail"
                      component={dev.DevFocusDetailRoute}
                    />
                  </>
                ) : null}
              </Stack.Navigator>
            </NavigationContainer>
          </ModalHostProvider>
        </SessionUiContext.Provider>
      ) : (
        <View testID="app/splash" style={styles.root} />
      )}
      {demo ? <DemoBadge /> : null}
    </GestureHandlerRootView>
  );
}

const BADGE = components.badge;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Top-right corner inside the DESIGN.md safe area.
  badge: {
    position: 'absolute',
    top: spacing['safe-y'],
    right: spacing['safe-x'],
    height: BADGE.height,
    borderRadius: BADGE.radius,
    backgroundColor: BADGE.bg,
    paddingHorizontal: spacing['3'],
    justifyContent: 'center',
  },
  badgeText: {
    ...BADGE.text,
  },
});

export default App;
