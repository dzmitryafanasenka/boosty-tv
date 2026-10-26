import { useFocusEffect } from '@react-navigation/native';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { BackHandler, StyleSheet, TVFocusGuideView, View } from 'react-native';
import { HomeScreen, type HomeScreenProps } from '../features/home';
import { SETTINGS_VERSION_ID, SettingsScreen } from '../features/settings';
import { FocusZone, Screen, useModal, type FocusZoneHandle } from '../shared/focus';
import { t } from '../shared/i18n';
import {
  NavItem,
  Text,
  colors,
  requestHostFocus,
  spacing,
  type HostView,
} from '../shared/ui';
import { enabledSections, type SectionId } from './phaseFlags';

export type ShellProps = {
  /**
   * The FocusRestoration key: memory is per key + section. The app passes a
   * constant, not `route.key`, because a stack reset (A11 → re-login) gives
   * the Shell route a new key while the same account keeps its memory.
   */
  routeKey: string;
  /** Настройки «Выйти из аккаунта»: open the sign-out dialog (Story 2.7). */
  onOpenSignOut: (initiator: RefObject<HostView | null>) => void;
  /** Debug builds only: open «Проверка фокуса» from Настройки. */
  onOpenFocusCheck?: () => void;
  /** Debug builds only: the live refresh check row in Настройки. */
  onCheckSession?: () => void;
  /** Debug builds only: the in-memory A11 trigger row in Настройки. */
  onExpireSession?: () => void;
  /** Главная's offline StateView (Story 2.5); absent: the placeholder. */
  homeOffline?: HomeScreenProps['offline'];
};

/** Focus ids of the sidebar items (docs/focus-map.md §1.5). */
const NAV_ID: Record<SectionId, string> = {
  home: 'nav/home',
  search: 'nav/search',
  subs: 'nav/subs',
  events: 'nav/events',
  settings: 'nav/settings',
};

/** The content's initial element per section; none: focus stays on the sidebar. */
const INITIAL_CONTENT_ID: Partial<Record<SectionId, string>> = {
  settings: SETTINGS_VERSION_ID,
};

const HOME: SectionId = 'home';

type View_ = { section: SectionId; focusContent: boolean };

/**
 * The signed-in Shell (docs/focus-map.md §3, AD-13). An always-expanded
 * sidebar with the sections that `phaseFlags` enables, and the current
 * section's content swapped in place (sections are not stack entries).
 *
 * - ↑ ↓ move between sidebar items (no wrap: the sidebar traps up/down);
 *   OK opens a section and moves focus to its content's target, if any.
 * - Zones are `TVFocusGuideView` destinations: ← from content lands on the
 *   current item; → from the sidebar lands on the section's remembered
 *   content focus (FocusRestoration), or nowhere when there is none.
 * - Back (AD-13): the modal host first (its own listener); then content →
 *   the current sidebar item; sidebar on another section → Главная with
 *   focus on `nav/home`; sidebar on Главная → not handled, so the app exits.
 * - When the Shell is the focused route again (pop), focus is restored
 *   explicitly: the remembered content element, or the current item.
 */
export function Shell({
  routeKey,
  onOpenSignOut,
  onOpenFocusCheck,
  onCheckSession,
  onExpireSession,
  homeOffline,
}: ShellProps) {
  const sections = useMemo(() => enabledSections(), []);
  const [view, setView] = useState<View_>({ section: HOME, focusContent: false });
  const sectionRef = useRef(view.section);
  sectionRef.current = view.section;
  /** Where focus is: the sidebar or the content zone. */
  const zone = useRef<'sidebar' | 'content'>('sidebar');
  const navViews = useRef(new Map<SectionId, HostView>());
  const navRefCallbacks = useRef(new Map<SectionId, (v: HostView | null) => void>());
  const contentRef = useRef<FocusZoneHandle>(null);
  /**
   * Whether the Shell is the focused route. A covered Shell ignores focus
   * events: Android can move fallback focus into a covered screen (e.g. when
   * a focused view is removed), and that must not change the zone the Shell
   * restores on return.
   */
  const routeFocused = useRef(false);
  const [sidebarDestination, setSidebarDestination] = useState<HostView | null>(null);
  const modal = useModal();

  const navRef = useCallback((section: SectionId) => {
    let callback = navRefCallbacks.current.get(section);
    if (!callback) {
      callback = (v: HostView | null) => {
        if (v) {
          navViews.current.set(section, v);
        } else {
          navViews.current.delete(section);
        }
      };
      navRefCallbacks.current.set(section, callback);
    }
    return callback;
  }, []);

  // ← from content lands on the current section's item.
  useEffect(() => {
    setSidebarDestination(navViews.current.get(view.section) ?? null);
  }, [view.section]);
  const sidebarDestinations = useMemo(
    () => (sidebarDestination ? [sidebarDestination] : []),
    [sidebarDestination],
  );

  const focusNav = useCallback((section: SectionId) => {
    zone.current = 'sidebar';
    requestHostFocus(navViews.current.get(section));
  }, []);

  const openSection = useCallback((section: SectionId) => {
    if (section === sectionRef.current) {
      // OK on the current item: go to its content, if it has any.
      contentRef.current?.focusTarget();
      return;
    }
    setView({ section, focusContent: true });
  }, []);

  // Initial focus and explicit restoration whenever the Shell is the focused
  // route again; Back while it is focused (AD-13 order).
  useFocusEffect(
    useCallback(() => {
      routeFocused.current = true;
      if (!(zone.current === 'content' && contentRef.current?.focusTarget())) {
        focusNav(sectionRef.current);
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (modal.isOpen()) {
          modal.close();
          return true;
        }
        if (zone.current === 'content') {
          focusNav(sectionRef.current);
          return true;
        }
        if (sectionRef.current !== HOME) {
          setView({ section: HOME, focusContent: false });
          focusNav(HOME);
          return true;
        }
        return false;
      });
      return () => {
        routeFocused.current = false;
        sub.remove();
      };
    }, [focusNav, modal]),
  );

  // The offline view went away (E1 succeeded) while «Повторить» had focus:
  // its button is gone, so focus goes to the current item explicitly.
  const offline = homeOffline !== undefined;
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (
      wasOffline.current &&
      !offline &&
      routeFocused.current &&
      zone.current === 'content' &&
      sectionRef.current === HOME
    ) {
      focusNav(HOME);
    }
    wasOffline.current = offline;
  }, [offline, focusNav]);

  const onSidebarFocus = useCallback(() => {
    if (routeFocused.current) {
      zone.current = 'sidebar';
    }
  }, []);
  const isShellActive = useCallback(() => routeFocused.current, []);
  const onContentFocus = useCallback(() => {
    if (routeFocused.current) {
      zone.current = 'content';
    }
  }, []);

  return (
    <Screen testID="shell">
      <TVFocusGuideView
        testID="shell/sidebar"
        style={styles.sidebar}
        destinations={sidebarDestinations}
        trapFocusUp
        trapFocusDown
        trapFocusLeft
      >
        <Text variant="section" accessibilityRole="header" style={styles.wordmark}>
          {t('shell.wordmark')}
        </Text>
        {sections.map((section, index) => (
          <View key={section} style={index > 0 ? styles.navGap : undefined}>
            <NavItem
              ref={navRef(section)}
              testID={NAV_ID[section]}
              label={t(`shell.nav.${section}`)}
              current={section === view.section}
              hasTVPreferredFocus={section === HOME}
              onPress={() => openSection(section)}
              onFocus={onSidebarFocus}
            />
          </View>
        ))}
      </TVFocusGuideView>
      <FocusZone
        key={view.section}
        ref={contentRef}
        testID={`shell/content/${view.section}`}
        routeKey={routeKey}
        sectionId={view.section}
        initialFocusId={INITIAL_CONTENT_ID[view.section]}
        focusOnMount={view.focusContent}
        onItemFocus={onContentFocus}
        isActive={isShellActive}
        style={styles.content}
      >
        <SectionContent
          section={view.section}
          onOpenSignOut={onOpenSignOut}
          onOpenFocusCheck={onOpenFocusCheck}
          onCheckSession={onCheckSession}
          onExpireSession={onExpireSession}
          homeOffline={homeOffline}
        />
      </FocusZone>
    </Screen>
  );
}

function SectionContent({
  section,
  onOpenSignOut,
  onOpenFocusCheck,
  onCheckSession,
  onExpireSession,
  homeOffline,
}: {
  section: SectionId;
  onOpenSignOut: (initiator: RefObject<HostView | null>) => void;
  onOpenFocusCheck?: () => void;
  onCheckSession?: () => void;
  onExpireSession?: () => void;
  homeOffline?: HomeScreenProps['offline'];
}) {
  switch (section) {
    case 'home':
      return <HomeScreen offline={homeOffline} />;
    case 'settings':
      return (
        <SettingsScreen
          onOpenSignOut={onOpenSignOut}
          onOpenFocusCheck={onOpenFocusCheck}
          onCheckSession={onCheckSession}
          onExpireSession={onExpireSession}
        />
      );
    // Phase-gated off in Epic 2 (phaseFlags): never rendered.
    case 'search':
    case 'subs':
    case 'events':
      return null;
  }
}

const styles = StyleSheet.create({
  sidebar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: spacing['sidebar-width'],
    backgroundColor: colors['bg-sidebar'],
    paddingLeft: spacing['safe-x'],
    paddingTop: spacing['safe-y'],
  },
  wordmark: {
    marginBottom: spacing['10'],
  },
  navGap: {
    marginTop: spacing['2'],
  },
  content: {
    position: 'absolute',
    top: spacing['safe-y'],
    bottom: spacing['safe-y'],
    left: spacing['content-x'],
    width: spacing['content-width'],
  },
});
