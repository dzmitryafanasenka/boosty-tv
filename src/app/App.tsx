// First: registers every account-scoped store before App renders (AD-4).
import './bootstrap';
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { AppState, StatusBar, StyleSheet, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  CodeScreen,
  ExpiredScreen,
  PhoneScreen,
  WelcomeScreen,
} from '../features/auth';
import { refreshAuthorPostsHeads } from '../features/author';
import { refreshFeedHead } from '../features/home';
import { debugBreakNextVideoSource } from '../features/player';
import { SignOutDialog } from '../features/settings';
import { accountScope } from '../shared/account';
import {
  SessionCheckContext,
  createSessionCheck,
  type SignInResult,
  type ValidateResult,
} from '../shared/api';
import { getFilter } from '../shared/filters';
import { ModalHostProvider, useModal, type ModalApi } from '../shared/focus';
import type { MediaRef } from '../shared/entities/post';
import { ProgressContext } from '../shared/services/progress';
import { t } from '../shared/i18n';
import { Text, colors, components, spacing, type HostView } from '../shared/ui';
import type * as DevFocusModule from './dev/devFocus';
import { progress } from './progress';
import { queryClient, resetQueryCache } from './queryClient';
import type { RootStackParamList } from './routes';
import { phaseFlags, type SectionId } from './phaseFlags';
import { DEMO_ACTIVE, session } from './session';
import { SessionUiContext, useSessionUi, type SessionUi } from './sessionUi';
import { Shell } from './Shell';
import { AuthorRoute, PlayerRoute, PostRoute, takePendingShellSection } from './stackRoutes';

/**
 * Debug builds only (Story 2.4 «Проверка фокуса»). `__DEV__` is a constant
 * in Metro bundles, so in release the require and every dev route below are
 * folded away and the module is not bundled.
 */
const dev: typeof DevFocusModule | null = __DEV__
  ? require('./dev/devFocus')
  : null;

const Stack = createStackNavigator<RootStackParamList>();
/** Exported for flow tests (the current route, a stand-in route above a screen). */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Background of the container and cards, so no light frame shows. */
const theme: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg },
};

/** The first route, decided by `session.restore()`. */
type Boot = { initial: 'Welcome' | 'Shell' | 'Expired'; signInAgain: boolean };

/**
 * The Shell's FocusRestoration key (Story 2.6). A constant, not `route.key`:
 * the reset after a re-login gives the Shell route a new key, and the same
 * account keeps its memory.
 */
export const SHELL_RESTORATION_KEY = 'shell';

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

function Phone({
  navigation,
  route,
}: StackScreenProps<RootStackParamList, 'Phone'>) {
  return (
    <PhoneScreen
      onCodeSent={() => navigation.navigate('Code')}
      onExit={() => navigation.goBack()}
      fromExpired={route.params?.fromExpired === true}
      sendCode={session.authApi.sendCode}
    />
  );
}

/**
 * After a sign-in: the Shell on Главная. A different account (or none
 * before) was already wiped by `SessionManager.signIn` through the
 * account-switch hook (`AccountScope.reset()`, Story 2.8) before its phone
 * and session were stored; the same account keeps its FocusRestoration.
 */
function onSignedIn(_result: SignInResult) {
  // Every sign-in starts with an empty query cache, also a re-login to the
  // same account after A11 (owner decision 2026-10-26): a feed fetched with
  // the dead token (all locked) must not survive. Cancel, then clear; the
  // Shell opens after it, so its first E5 is never cancelled.
  resetQueryCache().then(openShell, openShell);
}

function Code({ navigation }: StackScreenProps<RootStackParamList, 'Code'>) {
  return (
    <CodeScreen
      onChangeNumber={() => navigation.goBack()}
      onSignedIn={onSignedIn}
      signIn={session.signIn}
      resendCode={session.authApi.resendCode}
    />
  );
}

function Expired({ navigation }: StackScreenProps<RootStackParamList, 'Expired'>) {
  const loadPhone = useCallback(() => session.getExpiredPhone(), []);
  const onRelogin = useCallback(
    () => navigation.navigate('Phone', { fromExpired: true }),
    [navigation],
  );
  return <ExpiredScreen loadPhone={loadPhone} onRelogin={onRelogin} />;
}

/**
 * Story 2.6: replace the whole stack with A11. Not ready yet: nothing
 * happens, and `onNavigationReady` resets once the navigator is mounted.
 * Already `[Expired]`: nothing happens (no remount).
 */
function openExpired() {
  if (!navigationRef.isReady()) {
    return;
  }
  const state = navigationRef.getRootState();
  if (state?.routes.length === 1 && state.routes[0].name === 'Expired') {
    return;
  }
  navigationRef.reset({ index: 0, routes: [{ name: 'Expired' }] });
}

/**
 * Story 2.7 «Выйти»: `AccountScope.reset()`, the only cleanup path (AD-4):
 * the session (SecureStore, then memory) first, then every other
 * account-scoped store. No network request. A rejection (a SecureStore
 * clear failed) keeps everything and leaves the dialog open with its error
 * line. On success the modal closes without a focus return (the Shell is
 * going away) and the stack is replaced by `[Welcome]`, whose «Войти в
 * Boosty» takes the initial focus; «Войдите снова» is not shown.
 */
async function signOut(modal: ModalApi): Promise<void> {
  await accountScope.reset();
  modal.close({ restoreFocus: false });
  if (navigationRef.isReady()) {
    navigationRef.reset({
      index: 0,
      routes: [{ name: 'Welcome', params: { signInAgain: false } }],
    });
  }
}

/** Hands the modal host API to App, which sits outside the provider. */
function ModalBridge({ apiRef }: { apiRef: RefObject<ModalApi | null> }) {
  const modal = useModal();
  useEffect(() => {
    apiRef.current = modal;
    return () => {
      apiRef.current = null;
    };
  }, [modal, apiRef]);
  return null;
}

function ShellRoute({
  navigation,
}: StackScreenProps<RootStackParamList, 'Shell'>) {
  const ui = useSessionUi();
  // OK on a Подписки tile: Автор. Only while the Shell is the focused route
  // (the same guard as `onOpenPost`): a second OK during the transition (a
  // double press, or another tile) is dropped (Epic 3 retro F8).
  const onOpenAuthor = useCallback(
    (blogUrl: string) => {
      if (navigation.isFocused()) {
        navigation.navigate('Author', { blogUrl });
      }
    },
    [navigation],
  );
  // OK on a feed card (Главная) or a search result (Поиск, Story 5.6): Пост,
  // with that section as its sidebar's current item.
  const onOpenPost = useCallback(
    (blogUrl: string, postId: string, section: SectionId = 'home') => {
      if (navigation.isFocused()) {
        navigation.push('Post', { blogUrl, postId, section });
      }
    },
    [navigation],
  );
  // OK on a «Продолжить просмотр» card (Story 4.7): the Player at the
  // resume point; the origin is Главная's FocusRestoration section, so the
  // exit (or a natural end) returns to that card (or its neighbour).
  const onOpenPlayer = useCallback(
    (ref: MediaRef, focusId: string) => {
      if (navigation.isFocused()) {
        navigation.push('Player', {
          ref,
          origin: { routeKey: SHELL_RESTORATION_KEY, sectionId: 'home', focusId },
        });
      }
    },
    [navigation],
  );
  const modal = useModal();
  const onOpenSignOut = useCallback(
    (initiator: RefObject<HostView | null>) => {
      modal.open(
        <SignOutDialog
          onCancel={() => modal.close()}
          onConfirm={() => signOut(modal)}
        />,
        initiator,
      );
    },
    [modal],
  );
  return (
    <Shell
      routeKey={SHELL_RESTORATION_KEY}
      http={session.http}
      onOpenSignOut={onOpenSignOut}
      onOpenFocusCheck={
        __DEV__ ? () => navigation.navigate('DevFocus') : undefined
      }
      onCheckSession={__DEV__ ? ui.onCheckSession : undefined}
      onExpireSession={__DEV__ ? ui.onExpireSession : undefined}
      onBreakNextVideoUrl={__DEV__ ? debugBreakNextVideoSource : undefined}
      homeOffline={
        ui.homeOffline
          ? { retrying: ui.retrying, onRetry: ui.onRetry }
          : undefined
      }
      onOpenAuthor={onOpenAuthor}
      onOpenPost={onOpenPost}
      onOpenPlayer={phaseFlags.player ? onOpenPlayer : undefined}
      takePendingSection={takePendingShellSection}
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
 * until `session.restore()` resolves; then a stored session opens
 * the Shell, nothing (or a transient storage error) opens Welcome, and a
 * wiped store opens Welcome with «Войдите снова».
 *
 * Story 2.5: with a stored session the Shell opens at once, then E1 runs in
 * the background (single-flight, never moves focus) at cold start and on
 * every return to the foreground. A cold-start E1 that ends in `Network`
 * shows Главная's offline StateView; «Повторить» runs E1 again. Resume
 * failures change nothing visible.
 *
 * Story 2.6: `expired` (refresh 400 `invalid_grant`, or the debug trigger)
 * closes an open modal, clears Главная's offline view and resets the stack
 * to `[Expired]` (A11) from any screen; before the navigator is ready, the
 * reset happens in `onNavigationReady`. A cold start after an expiry
 * (`restore()` reason `expired`) boots into A11; a wiped store keeps A1
 * «Войдите снова».
 *
 * The JS stack (ADR 0007): `detachInactiveScreens={false}` renders plain
 * Views, never react-native-screens; no header, no gestures (remote only).
 * Covered screens stay mounted; each screen traps focus (`Screen`). The one
 * modal host sits above the stack (AD-13).
 *
 * Story 4.2: `ProgressContext` provides the app's ProgressRepository
 * (`./progress`, the active session's client) to the player and Пост.
 *
 * Epic 3 retro A6: the SessionCheck port (`SessionCheckContext`) lets the
 * player, the Post screen and Главная run E1 before they trust a «locked»
 * answer (a dead token reads as anonymous, api-contract §7). An `expired`
 * result reaches A11 through the status listener below; every status change
 * starts the port's cooldown windows afresh.
 */
function App() {
  const [sessionCheck] = useState(() => createSessionCheck({ validate: () => session.validate() }));
  const [boot, setBoot] = useState<Boot | null>(null);
  const [homeOffline, setHomeOffline] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(true);
  const modalApi = useRef<ModalApi | null>(null);

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
          : result.status === 'expired'
            ? { initial: 'Expired', signInAgain: false }
            : { initial: 'Welcome', signInAgain: result.reason === 'wiped' },
      );
    });
    const unsubscribe = session.subscribe(status => {
      // A new session (or none) owes nothing to the old one's checks.
      sessionCheck.reset();
      if (status === 'signedOut') {
        // Sign-out (Story 2.7): nothing of the old session stays on screen.
        setHomeOffline(false);
      }
      if (status === 'expired') {
        // The modal host first (AD-13), then the stack. The screen behind the
        // modal is going away: no focus return to its initiator.
        modalApi.current?.close({ restoreFocus: false });
        setHomeOffline(false);
        openExpired();
      }
    });
    const appState = AppState.addEventListener('change', state => {
      // Resume: E1 again; only a success changes anything (offline → the
      // feed, and a stale cached feed gets its head refreshed: one E5 page 1,
      // AD-7; so do the posts of every Author route in the stack: one E4
      // page 1 each, spec-author-posts-refresh). The feed is the active
      // `feed` Filter's (Story 5.3). Failures send nothing more.
      session.onAppStateChange(state)?.then(result => {
        if (alive.current && result.kind === 'ok') {
          setHomeOffline(false);
          const now = Date.now();
          refreshFeedHead(queryClient, session.http, getFilter('feed'), now).catch(() => {});
          refreshAuthorPostsHeads(queryClient, session.http, now).catch(() => {});
        }
      });
    });
    return () => {
      alive.current = false;
      unsubscribe();
      appState.remove();
    };
  }, [applyColdResult, sessionCheck]);

  /**
   * The navigator is mounted: the cold-start E1 runs now, in the background,
   * so an `expired` result can always reset the stack.
   */
  const onNavigationReady = useCallback(() => {
    if (session.getStatus() === 'expired') {
      openExpired();
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
      onExpireSession: __DEV__
        ? () => {
            session.debugExpireInMemory?.();
          }
        : undefined,
    }),
    [homeOffline, retrying, onRetry],
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      {boot ? (
        <QueryClientProvider client={queryClient}>
          <SessionUiContext.Provider value={ui}>
            <SessionCheckContext.Provider value={sessionCheck}>
              <ProgressContext.Provider value={progress}>
                <ModalHostProvider>
                  <ModalBridge apiRef={modalApi} />
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
                      <Stack.Screen name="Author" component={AuthorRoute} />
                      <Stack.Screen name="Post" component={PostRoute} />
                      <Stack.Screen name="Player" component={PlayerRoute} />
                      <Stack.Screen name="Expired" component={Expired} />
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
              </ProgressContext.Provider>
            </SessionCheckContext.Provider>
          </SessionUiContext.Provider>
        </QueryClientProvider>
      ) : (
        <View testID="app/splash" style={styles.root} />
      )}
      {DEMO_ACTIVE ? <DemoBadge /> : null}
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
