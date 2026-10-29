import { useFocusEffect } from '@react-navigation/native';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { BackHandler } from 'react-native';
import { HomeScreen, type HomeFocusInfo, type HomeScreenProps } from '../features/home';
import { SearchScreen, type SearchFocusInfo } from '../features/search';
import { SETTINGS_VERSION_ID, SettingsScreen } from '../features/settings';
import { SubscriptionsScreen, type SubscriptionsFocusInfo } from '../features/subscriptions';
import type { HttpClient } from '../shared/api';
import type { MediaRef } from '../shared/entities/post';
import { FocusZone, Screen, type FocusZoneHandle } from '../shared/focus';
import { requestHostFocus, type HostView } from '../shared/ui';
import { enabledSections, phaseFlags, type SectionId } from './phaseFlags';
import { NAV_ID, Sidebar, sidebarLayout, useSidebarNav } from './Sidebar';

export type ShellProps = {
  /**
   * The FocusRestoration key: memory is per key + section. The app passes a
   * constant, not `route.key`, because a stack reset (A11 → re-login) gives
   * the Shell route a new key while the same account keeps its memory.
   */
  routeKey: string;
  /**
   * The active session's content client (`session.http`), for the feed and
   * Подписки.
   * Passed down, never imported: demo mode must not reach the real API.
   */
  http: HttpClient;
  /** Настройки «Выйти из аккаунта»: open the sign-out dialog (Story 2.7). */
  onOpenSignOut: (initiator: RefObject<HostView | null>) => void;
  /** Debug builds only: open «Проверка фокуса» from Настройки. */
  onOpenFocusCheck?: () => void;
  /** Debug builds only: the live refresh check row in Настройки. */
  onCheckSession?: () => void;
  /** Debug builds only: the in-memory A11 trigger row in Настройки. */
  onExpireSession?: () => void;
  /** Debug builds only (Story 4.4): the broken-next-video-URL row in Настройки. */
  onBreakNextVideoUrl?: () => void;
  /** Главная's offline StateView (Story 2.5); absent: the feed. */
  homeOffline?: HomeScreenProps['offline'];
  /** Подписки: OK on a tile opens the Author page (Story 3.3). */
  onOpenAuthor?: (blogUrl: string) => void;
  /**
   * Главная: OK on a feed card opens Пост (Story 3.4); Поиск: OK on a result
   * (Story 5.6, `section` 'search': Пост's sidebar current item).
   */
  onOpenPost?: (blogUrl: string, postId: string, section?: SectionId) => void;
  /** Главная: OK on a «Продолжить просмотр» card opens the Player (Story 4.7). */
  onOpenPlayer?: (ref: MediaRef, focusId: string) => void;
  /**
   * A section to open when the Shell is the focused route again: OK on a
   * sidebar item of a screen on top (Автор, owner decision 2026-10-27)
   * popped back here. Read once per return; null: a plain return.
   */
  takePendingSection?: () => SectionId | null;
};

/** The content's initial element per section; none: focus stays on the sidebar. */
const INITIAL_CONTENT_ID: Partial<Record<SectionId, string>> = {
  settings: SETTINGS_VERSION_ID,
};

const HOME: SectionId = 'home';

/**
 * Sections whose screen takes its content focus itself (restoration in a
 * virtualized grid, or after the first data arrives), so the content zone
 * does not focus its target on mount.
 */
const SELF_FOCUS_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>(['home', 'subs', 'search']);

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
  http,
  onOpenSignOut,
  onOpenFocusCheck,
  onCheckSession,
  onExpireSession,
  onBreakNextVideoUrl,
  homeOffline,
  onOpenAuthor,
  onOpenPost,
  onOpenPlayer,
  takePendingSection,
}: ShellProps) {
  const sections = useMemo(() => enabledSections(), []);
  const [view, setView] = useState<View_>({ section: HOME, focusContent: false });
  const sectionRef = useRef(view.section);
  sectionRef.current = view.section;
  /** Where focus is: the sidebar or the content zone. */
  const zone = useRef<'sidebar' | 'content'>('sidebar');
  /** The last focused element (a nav id or a content item id); null: none yet. */
  const lastFocusId = useRef<string | null>(null);
  /** Главная's focus listeners (`HomeFocusInfo.onFocusChange`). */
  const focusListeners = useRef(new Set<(focusId: string) => void>());
  /** A focus event of the focused Shell: remember it and tell the listeners. */
  const recordFocus = useCallback((focusId: string) => {
    lastFocusId.current = focusId;
    for (const listener of [...focusListeners.current]) {
      listener(focusId);
    }
  }, []);
  const onFocusChange = useCallback((listener: (focusId: string) => void) => {
    focusListeners.current.add(listener);
    return () => {
      focusListeners.current.delete(listener);
    };
  }, []);
  const nav = useSidebarNav(view.section);
  const navViews = nav.views;
  const contentRef = useRef<FocusZoneHandle>(null);
  /**
   * The current section's own return focus (Подписки: the tile by
   * `blogUrl`; Главная: the card by id; both with the fallback chain);
   * null: the content zone's target.
   */
  const sectionReturn = useRef<(() => boolean) | null>(null);
  const takePendingRef = useRef(takePendingSection);
  takePendingRef.current = takePendingSection;
  /**
   * Whether the Shell is the focused route. A covered Shell ignores focus
   * events: Android can move fallback focus into a covered screen (e.g. when
   * a focused view is removed), and that must not change the zone the Shell
   * restores on return.
   */
  const routeFocused = useRef(false);

  const focusNav = useCallback(
    (section: SectionId) => {
      zone.current = 'sidebar';
      requestHostFocus(navViews.current.get(section));
    },
    [navViews],
  );

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
      const pending = takePendingRef.current?.() ?? null;
      if (pending !== null && sections.includes(pending)) {
        // OK on a sidebar item of the screen that was on top: as OK on that
        // item here. The item has focus and the user has not moved, so the
        // section may take its content focus (Главная, Подписки rules).
        lastFocusId.current = NAV_ID[pending];
        focusNav(pending);
        if (pending === sectionRef.current) {
          contentRef.current?.focusTarget();
        } else {
          setView({ section: pending, focusContent: true });
        }
      } else if (zone.current === 'content' && sectionReturn.current?.()) {
        // The section restored its own content focus.
      } else if (!(zone.current === 'content' && contentRef.current?.focusTarget())) {
        focusNav(sectionRef.current);
      }
      // An open modal never reaches this listener: the modal host adds its
      // own in `open()`, after this one, so it sees Back first
      // (docs/focus-map.md §1.4).
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
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
    }, [focusNav, sections]),
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

  const onSidebarFocus = useCallback(
    (section: SectionId) => {
      if (routeFocused.current) {
        zone.current = 'sidebar';
        recordFocus(NAV_ID[section]);
      }
    },
    [recordFocus],
  );
  const isShellActive = useCallback(() => routeFocused.current, []);
  const onContentFocus = useCallback(
    (focusId: string) => {
      if (routeFocused.current) {
        zone.current = 'content';
        recordFocus(focusId);
      }
    },
    [recordFocus],
  );
  // A section registers its own return restore (Главная, Подписки; ADR 0012).
  const setReturnFocus = useCallback((restore: () => boolean) => {
    sectionReturn.current = restore;
    // Clears the slot only while it still holds this registration (a
    // newer section may have registered before this one unmounts).
    return () => {
      if (sectionReturn.current === restore) {
        sectionReturn.current = null;
      }
    };
  }, []);
  // Главная moves focus into its content only while the user has not moved
  // (docs/focus-map.md §1.6 skeleton rule), and never while the Shell is
  // covered or closing.
  const homeFocus = useMemo<HomeFocusInfo>(
    () => ({
      isActive: () => routeFocused.current,
      current: () => lastFocusId.current,
      sectionItemId: NAV_ID[HOME],
      focusSidebar: () => focusNav(HOME),
      onFocusChange,
      setReturnFocus,
    }),
    [focusNav, onFocusChange, setReturnFocus],
  );
  // Подписки follows the same rules (docs/focus-map.md §1.6, §3 C).
  const subsFocus = useMemo<SubscriptionsFocusInfo>(
    () => ({
      isActive: () => routeFocused.current,
      current: () => lastFocusId.current,
      sectionItemId: NAV_ID.subs,
      focusSidebar: () => focusNav('subs'),
      setReturnFocus,
    }),
    [focusNav, setReturnFocus],
  );

  // Поиск (Story 5.6): the field on open, the result card on return.
  const searchFocus = useMemo<SearchFocusInfo>(
    () => ({
      isActive: () => routeFocused.current,
      current: () => lastFocusId.current,
      sectionItemId: NAV_ID.search,
      onFocusChange,
      setReturnFocus,
    }),
    [onFocusChange, setReturnFocus],
  );

  return (
    <Screen testID="shell">
      <Sidebar
        testID="shell/sidebar"
        sections={sections}
        current={view.section}
        nav={nav}
        preferredSection={HOME}
        onPress={openSection}
        onFocus={onSidebarFocus}
      />
      <FocusZone
        key={view.section}
        ref={contentRef}
        testID={`shell/content/${view.section}`}
        routeKey={routeKey}
        sectionId={view.section}
        initialFocusId={INITIAL_CONTENT_ID[view.section]}
        // Главная, Подписки and Поиск take their content focus themselves.
        focusOnMount={view.focusContent && !SELF_FOCUS_SECTIONS.has(view.section)}
        onItemFocus={onContentFocus}
        isActive={isShellActive}
        style={sidebarLayout.content}
      >
        <SectionContent
          section={view.section}
          routeKey={routeKey}
          http={http}
          focusContent={view.focusContent}
          homeFocus={homeFocus}
          subsFocus={subsFocus}
          searchFocus={searchFocus}
          onOpenSignOut={onOpenSignOut}
          onOpenFocusCheck={onOpenFocusCheck}
          onCheckSession={onCheckSession}
          onExpireSession={onExpireSession}
          onBreakNextVideoUrl={onBreakNextVideoUrl}
          homeOffline={homeOffline}
          onOpenAuthor={onOpenAuthor}
          onOpenPost={onOpenPost}
          onOpenPlayer={onOpenPlayer}
        />
      </FocusZone>
    </Screen>
  );
}

function SectionContent({
  section,
  routeKey,
  http,
  focusContent,
  homeFocus,
  subsFocus,
  searchFocus,
  onOpenSignOut,
  onOpenFocusCheck,
  onCheckSession,
  onExpireSession,
  onBreakNextVideoUrl,
  homeOffline,
  onOpenAuthor,
  onOpenPost,
  onOpenPlayer,
}: {
  section: SectionId;
  routeKey: string;
  http: HttpClient;
  focusContent: boolean;
  homeFocus: HomeFocusInfo;
  subsFocus: SubscriptionsFocusInfo;
  searchFocus: SearchFocusInfo;
  onOpenSignOut: (initiator: RefObject<HostView | null>) => void;
  onOpenFocusCheck?: () => void;
  onCheckSession?: () => void;
  onExpireSession?: () => void;
  onBreakNextVideoUrl?: () => void;
  homeOffline?: HomeScreenProps['offline'];
  onOpenAuthor?: (blogUrl: string) => void;
  onOpenPost?: (blogUrl: string, postId: string, section?: SectionId) => void;
  onOpenPlayer?: (ref: MediaRef, focusId: string) => void;
}) {
  const onOpenSearchResult = useCallback(
    (blogUrl: string, postId: string) => onOpenPost?.(blogUrl, postId, 'search'),
    [onOpenPost],
  );
  switch (section) {
    case 'home':
      return (
        <HomeScreen
          offline={homeOffline}
          http={http}
          routeKey={routeKey}
          focusOnMount={focusContent}
          focus={homeFocus}
          onOpenPost={onOpenPost}
          onOpenPlayer={onOpenPlayer}
          filtersEnabled={phaseFlags.filters}
        />
      );
    case 'settings':
      return (
        <SettingsScreen
          onOpenSignOut={onOpenSignOut}
          onOpenFocusCheck={onOpenFocusCheck}
          onCheckSession={onCheckSession}
          onExpireSession={onExpireSession}
          onBreakNextVideoUrl={onBreakNextVideoUrl}
        />
      );
    case 'subs':
      return (
        <SubscriptionsScreen
          http={http}
          routeKey={routeKey}
          focusOnMount={focusContent}
          focus={subsFocus}
          onOpenAuthor={onOpenAuthor}
          myBlogEnabled={phaseFlags.myBlog}
        />
      );
    case 'search':
      return (
        <SearchScreen
          http={http}
          routeKey={routeKey}
          focusOnMount={focusContent}
          focus={searchFocus}
          onOpenPost={onOpenSearchResult}
          filtersEnabled={phaseFlags.filters}
        />
      );
    // Phase-gated off (phaseFlags): never rendered.
    case 'events':
      return null;
  }
}
