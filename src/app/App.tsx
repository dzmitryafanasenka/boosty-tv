// First: registers every account-scoped store before App renders (AD-4).
import './bootstrap';
import {
  NavigationContainer,
  DarkTheme,
  createNavigationContainerRef,
  useFocusEffect,
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
import { AppState, BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  CodeScreen,
  ExpiredScreen,
  PhoneScreen,
  WelcomeScreen,
} from '../features/auth';
import { AuthorScreen, refreshAuthorPostsHeads, type AuthorFocusInfo } from '../features/author';
import { refreshFeedHead } from '../features/home';
import { PostScreen, type PostFocusInfo } from '../features/post';
import { SignOutDialog } from '../features/settings';
import { accountScope } from '../shared/account';
import type { SignInResult, ValidateResult } from '../shared/api';
import {
  FocusZone,
  MAIN_SECTION,
  ModalHostProvider,
  Screen,
  focusRestoration,
  useModal,
  type FocusZoneHandle,
  type ModalApi,
} from '../shared/focus';
import { t } from '../shared/i18n';
import {
  Text,
  colors,
  components,
  requestHostFocus,
  spacing,
  type HostView,
} from '../shared/ui';
import type * as DevFocusModule from './dev/devFocus';
import { queryClient, resetQueryCache } from './queryClient';
import type { RootStackParamList } from './routes';
import { DEMO_ACTIVE, session } from './session';
import { enabledSections, phaseFlags, type SectionId } from './phaseFlags';
import { SessionUiContext, useSessionUi, type SessionUi } from './sessionUi';
import { Shell } from './Shell';
import { NAV_ID, Sidebar, sidebarLayout, useSidebarNav } from './Sidebar';

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

/**
 * The Shell section to open on its next return (OK on a sidebar item of
 * Автор or Пост, owner decision 2026-10-27, ADR 0012): set right before the
 * pop, read once by the Shell when it is the focused route again. `owner`
 * is the route that set it: only its unmount clears it (a `popTo` through
 * an Автор below unmounts that one at once, before the Shell reads it).
 */
let pendingShellSection: { section: SectionId; owner: string } | null = null;
function takePendingShellSection(): SectionId | null {
  const pending = pendingShellSection;
  pendingShellSection = null;
  return pending?.section ?? null;
}

function ShellRoute({
  navigation,
}: StackScreenProps<RootStackParamList, 'Shell'>) {
  const ui = useSessionUi();
  const onOpenAuthor = useCallback(
    (blogUrl: string) => navigation.navigate('Author', { blogUrl }),
    [navigation],
  );
  // OK on a feed card (Главная): Пост, with Главная as its sidebar's current item.
  const onOpenPost = useCallback(
    (blogUrl: string, postId: string) => {
      if (navigation.isFocused()) {
        navigation.push('Post', { blogUrl, postId, section: 'home' });
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
      homeOffline={
        ui.homeOffline
          ? { retrying: ui.retrying, onRetry: ui.onRetry }
          : undefined
      }
      onOpenAuthor={onOpenAuthor}
      onOpenPost={onOpenPost}
      takePendingSection={takePendingShellSection}
    />
  );
}

/** Автор opened from Подписки: its sidebar's current item (decision A). */
const AUTHOR_ORIGIN: SectionId = 'subs';
/** Sidebar item testIDs on Автор: `author/nav/<section>` (the Shell's stay mounted below). */
const AUTHOR_NAV_PREFIX = 'author/';
/** Sidebar item testIDs on Пост: `post/nav/<section>`. */
const POST_NAV_PREFIX = 'post/';

type StackSidebarFocus = {
  isActive(): boolean;
  current(): string | null;
  sectionItemId: string;
  focusSidebar(): void;
  focusZoneTarget(): boolean;
  onFocusChange(listener: (focusId: string) => void): () => void;
};

/**
 * The shared sidebar of a stack screen (ADR 0012: Автор, Пост) with the
 * origin Shell section as its current item:
 *
 * - OK on a sidebar item pops to the Shell (`popTo`, also through an Автор
 *   or Пост below) and, for an item other than the origin, opens that
 *   section there as OK on it would (`pendingShellSection`). Only while the
 *   route is focused: a second OK during the pop is ignored.
 * - Back anywhere on the route (content or sidebar) pops one route.
 * - FocusRestoration is keyed by the route's key and forgotten on unmount.
 * - `focus`: what the page needs (the route's last focused element, the
 *   sidebar's current item, the content zone's target, focus events).
 */
function useStackSidebar(
  navigation: StackScreenProps<RootStackParamList, 'Author' | 'Post'>['navigation'],
  routeKey: string,
  origin: SectionId,
  idPrefix: string,
) {
  const sections = useMemo(() => enabledSections(), []);
  const nav = useSidebarNav(origin);
  const zoneRef = useRef<FocusZoneHandle>(null);
  /** The last focused element on this route (a sidebar or content id). */
  const lastFocusId = useRef<string | null>(null);
  /** The page's focus listeners (`onFocusChange`). */
  const focusListeners = useRef(new Set<(focusId: string) => void>());
  const recordFocus = useCallback((focusId: string) => {
    lastFocusId.current = focusId;
    for (const listener of [...focusListeners.current]) {
      listener(focusId);
    }
  }, []);
  // `isFocused()`, not a ref set in a focus effect: the page's own effects
  // run before this component's, already on the first focus.
  const isActive = useCallback(() => navigation.isFocused(), [navigation]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        pendingShellSection = null;
        navigation.goBack();
        return true;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  useEffect(
    () => () => {
      focusRestoration.forget(routeKey);
      // A pop that never reached the Shell must not open a section later.
      if (pendingShellSection?.owner === routeKey) {
        pendingShellSection = null;
      }
    },
    [routeKey],
  );

  const onSidebarPress = useCallback(
    (section: SectionId) => {
      if (!navigation.isFocused()) {
        return;
      }
      pendingShellSection = section === origin ? null : { section, owner: routeKey };
      navigation.popTo('Shell');
    },
    [navigation, origin, routeKey],
  );
  const onBack = useCallback(() => {
    pendingShellSection = null;
    navigation.goBack();
  }, [navigation]);
  const onSidebarFocus = useCallback(
    (section: SectionId) => {
      if (isActive()) {
        recordFocus(`${idPrefix}${NAV_ID[section]}`);
      }
    },
    [isActive, recordFocus, idPrefix],
  );
  const onContentFocus = useCallback(
    (focusId: string) => {
      if (isActive()) {
        recordFocus(focusId);
      }
    },
    [isActive, recordFocus],
  );
  const views = nav.views;
  const focus = useMemo<StackSidebarFocus>(
    () => ({
      isActive,
      current: () => lastFocusId.current,
      sectionItemId: `${idPrefix}${NAV_ID[origin]}`,
      focusSidebar: () => requestHostFocus(views.current.get(origin)),
      focusZoneTarget: () => zoneRef.current?.focusTarget() ?? false,
      onFocusChange: listener => {
        focusListeners.current.add(listener);
        return () => {
          focusListeners.current.delete(listener);
        };
      },
    }),
    [isActive, views, idPrefix, origin],
  );

  return { sections, nav, zoneRef, onSidebarPress, onBack, onSidebarFocus, onContentFocus, focus };
}

/**
 * D Автор (Story 3.3) in the shared screen wrapper (trapped on all sides),
 * with the Shell's sidebar (owner decision 2026-10-27, option A; ADR 0012):
 * the same component and enabled sections, current item = the origin
 * section (Подписки, or Главная for an Автор opened from a feed post).
 *
 * - ← from the grid's first column → the current item; → from the sidebar →
 *   the remembered post (the content zone's destination).
 * - OK on a post opens Пост (Story 3.4) with the same origin section.
 * - Sidebar OK and Back: `useStackSidebar`.
 */
function AuthorRoute({
  navigation,
  route,
}: StackScreenProps<RootStackParamList, 'Author'>) {
  const { blogUrl } = route.params;
  const origin = route.params.section ?? AUTHOR_ORIGIN;
  const routeKey = route.key;
  const sidebar = useStackSidebar(navigation, routeKey, origin, AUTHOR_NAV_PREFIX);
  const focus: AuthorFocusInfo = sidebar.focus;
  const onOpenPost = useCallback(
    (postBlogUrl: string, postId: string) => {
      if (navigation.isFocused()) {
        navigation.push('Post', { blogUrl: postBlogUrl, postId, section: origin });
      }
    },
    [navigation, origin],
  );

  return (
    <Screen testID="author">
      <Sidebar
        testID="author/sidebar"
        idPrefix={AUTHOR_NAV_PREFIX}
        sections={sidebar.sections}
        current={origin}
        nav={sidebar.nav}
        onPress={sidebar.onSidebarPress}
        onFocus={sidebar.onSidebarFocus}
      />
      <FocusZone
        ref={sidebar.zoneRef}
        testID="author/content"
        routeKey={routeKey}
        sectionId={MAIN_SECTION}
        onItemFocus={sidebar.onContentFocus}
        isActive={focus.isActive}
        style={sidebarLayout.content}
      >
        <AuthorScreen
          http={session.http}
          blogUrl={blogUrl}
          routeKey={routeKey}
          focus={focus}
          onBack={sidebar.onBack}
          onOpenPost={onOpenPost}
        />
      </FocusZone>
    </Screen>
  );
}

/**
 * F Пост (Story 3.4) in the shared screen wrapper, with the Shell's sidebar
 * (ADR 0012): current item = the origin section (Главная from the feed,
 * Подписки from Автор). OK on the author row opens Автор, or pops to it when
 * the route below is Автор of the same blog. Sidebar OK and Back:
 * `useStackSidebar`.
 */
function PostRoute({ navigation, route }: StackScreenProps<RootStackParamList, 'Post'>) {
  const { blogUrl, postId, section: origin } = route.params;
  const routeKey = route.key;
  const sidebar = useStackSidebar(navigation, routeKey, origin, POST_NAV_PREFIX);
  const focus: PostFocusInfo = sidebar.focus;
  const onOpenAuthor = useCallback(
    (authorBlogUrl: string) => {
      if (!navigation.isFocused()) {
        return;
      }
      const state = navigation.getState();
      const below = state.routes[state.index - 1];
      if (
        below?.name === 'Author' &&
        (below.params as RootStackParamList['Author'] | undefined)?.blogUrl === authorBlogUrl
      ) {
        navigation.goBack();
      } else {
        navigation.push('Author', { blogUrl: authorBlogUrl, section: origin });
      }
    },
    [navigation, origin],
  );

  return (
    <Screen testID="post">
      <Sidebar
        testID="post/sidebar"
        idPrefix={POST_NAV_PREFIX}
        sections={sidebar.sections}
        current={origin}
        nav={sidebar.nav}
        onPress={sidebar.onSidebarPress}
        onFocus={sidebar.onSidebarFocus}
      />
      <FocusZone
        ref={sidebar.zoneRef}
        testID="post/content"
        routeKey={routeKey}
        sectionId={MAIN_SECTION}
        onItemFocus={sidebar.onContentFocus}
        isActive={focus.isActive}
        style={sidebarLayout.content}
      >
        <PostScreen
          http={session.http}
          blogUrl={blogUrl}
          postId={postId}
          focus={focus}
          onBack={sidebar.onBack}
          onOpenAuthor={onOpenAuthor}
          playerEnabled={phaseFlags.player}
        />
      </FocusZone>
    </Screen>
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
 */
function App() {
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
      // page 1 each, spec-author-posts-refresh). Failures send nothing more.
      session.onAppStateChange(state)?.then(result => {
        if (alive.current && result.kind === 'ok') {
          setHomeOffline(false);
          const now = Date.now();
          refreshFeedHead(queryClient, session.http, now).catch(() => {});
          refreshAuthorPostsHeads(queryClient, session.http, now).catch(() => {});
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
