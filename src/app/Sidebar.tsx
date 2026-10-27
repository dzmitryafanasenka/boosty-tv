import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet, TVFocusGuideView, View } from 'react-native';
import { t } from '../shared/i18n';
import { NavItem, Text, colors, spacing, type HostView } from '../shared/ui';
import type { SectionId } from './phaseFlags';

/** Focus ids of the sidebar items (docs/focus-map.md §1.5). */
export const NAV_ID: Record<SectionId, string> = {
  home: 'nav/home',
  search: 'nav/search',
  subs: 'nav/subs',
  events: 'nav/events',
  settings: 'nav/settings',
};

export type SidebarNav = {
  /** The item's ref callback (stable per section). */
  navRef(section: SectionId): (view: HostView | null) => void;
  /** The mounted item views by section. */
  views: RefObject<Map<SectionId, HostView>>;
  /** ← from content lands on the current item. */
  destinations: HostView[];
};

/** The sidebar items' views and the content → sidebar destination. */
export function useSidebarNav(current: SectionId): SidebarNav {
  const views = useRef(new Map<SectionId, HostView>());
  const callbacks = useRef(new Map<SectionId, (v: HostView | null) => void>());
  const [destination, setDestination] = useState<HostView | null>(null);

  const navRef = useCallback((section: SectionId) => {
    let callback = callbacks.current.get(section);
    if (!callback) {
      callback = (v: HostView | null) => {
        if (v) {
          views.current.set(section, v);
        } else {
          views.current.delete(section);
        }
      };
      callbacks.current.set(section, callback);
    }
    return callback;
  }, []);

  useEffect(() => {
    setDestination(views.current.get(current) ?? null);
  }, [current]);
  const destinations = useMemo(() => (destination ? [destination] : []), [destination]);

  return { navRef, views, destinations };
}

export type SidebarProps = {
  sections: readonly SectionId[];
  /** The selected section (the item's current mark), not focus. */
  current: SectionId;
  nav: SidebarNav;
  onPress(section: SectionId): void;
  onFocus(section: SectionId): void;
  /** Item testIDs are `<idPrefix><NAV_ID>` (the Author page: `author/`). */
  idPrefix?: string;
  /** The item with `hasTVPreferredFocus` (the Shell: Главная). */
  preferredSection?: SectionId;
  testID: string;
};

/**
 * The always-expanded sidebar of the Shell and of stack screens that keep
 * it (Автор, owner decision 2026-10-27): the wordmark and the enabled
 * sections. A `TVFocusGuideView` that traps ↑ ↓ ← (no wrap, no escape) and
 * whose destination is the current item, so ← from content lands on it.
 * A section opens only on OK (`onPress`), never on focus.
 */
export function Sidebar({
  sections,
  current,
  nav,
  onPress,
  onFocus,
  idPrefix = '',
  preferredSection,
  testID,
}: SidebarProps) {
  return (
    <TVFocusGuideView
      testID={testID}
      style={styles.sidebar}
      destinations={nav.destinations}
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
            ref={nav.navRef(section)}
            testID={`${idPrefix}${NAV_ID[section]}`}
            label={t(`shell.nav.${section}`)}
            current={section === current}
            hasTVPreferredFocus={section === preferredSection}
            onPress={() => onPress(section)}
            onFocus={() => onFocus(section)}
          />
        </View>
      ))}
    </TVFocusGuideView>
  );
}

/** The content area beside the sidebar (Shell sections, Автор). */
export const sidebarLayout = StyleSheet.create({
  content: {
    position: 'absolute',
    top: spacing['safe-y'],
    bottom: spacing['safe-y'],
    left: spacing['content-x'],
    width: spacing['content-width'],
  },
});

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
});
