import { useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp, StackScreenProps } from '@react-navigation/stack';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { BackHandler } from 'react-native';
import { AuthorScreen } from '../features/author';
import { PlayerScreen } from '../features/player';
import { PostScreen, endedReturnFocusId, postIdPrefix } from '../features/post';
import { queryKeys } from '../shared/api';
import type { MediaRef, PostResult } from '../shared/entities/post';
import {
  FocusZone,
  MAIN_SECTION,
  Screen,
  focusRestoration,
  type FocusZoneHandle,
} from '../shared/focus';
import { requestHostFocus } from '../shared/ui';
import { progress } from './progress';
import type { RootStackParamList } from './routes';
import { session } from './session';
import { enabledSections, phaseFlags, type SectionId } from './phaseFlags';
import { NAV_ID, Sidebar, sidebarLayout, useSidebarNav } from './Sidebar';

/**
 * The Shell section to open on its next return (OK on a sidebar item of
 * Автор or Пост, owner decision 2026-10-27, ADR 0012): set right before the
 * pop, read once by the Shell when it is the focused route again. `owner`
 * is the route that set it: only its unmount clears it (a `popTo` through
 * an Автор below unmounts that one at once, before the Shell reads it).
 */
let pendingShellSection: { section: SectionId; owner: string } | null = null;

/** The Shell's side of the handshake: the pending section, read once. */
export function takePendingShellSection(): SectionId | null {
  const pending = pendingShellSection;
  pendingShellSection = null;
  return pending?.section ?? null;
}

/** Автор opened from Подписки: its sidebar's current item (decision A). */
const AUTHOR_ORIGIN: SectionId = 'subs';

/**
 * What a stack screen's page gets from its route: the route's last focused
 * element, the sidebar's current item, the content zone's target and focus
 * events (`AuthorFocusInfo` and `PostFocusInfo` are subsets).
 */
export type StackSidebarFocus = {
  isActive(): boolean;
  current(): string | null;
  sectionItemId: string;
  focusSidebar(): void;
  focusZoneTarget(): boolean;
  onFocusChange(listener: (focusId: string) => void): () => void;
};

type StackNavigation = StackNavigationProp<RootStackParamList>;

/**
 * The shared sidebar of a stack screen (ADR 0012: Автор, Пост) with the
 * origin Shell section as its current item:
 *
 * - OK on a sidebar item pops to the Shell (`popTo`, also through an Автор
 *   or Пост below) and, for an item other than the origin, opens that
 *   section there as OK on it would (`pendingShellSection`). Only while the
 *   route is focused: a second OK during the pop is ignored.
 * - Back anywhere on the route (content or sidebar) pops one route, unless
 *   `onBackPress` (called first) returns true: it handled Back itself.
 * - FocusRestoration is keyed by the route's key and forgotten on unmount.
 * - `focus`: what the page needs (the route's last focused element, the
 *   sidebar's current item, the content zone's target, focus events).
 */
function useStackSidebar(
  navigation: StackNavigation,
  routeKey: string,
  origin: SectionId,
  idPrefix: string,
  onBackPress?: () => boolean,
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
  const onBackPressRef = useRef(onBackPress);
  onBackPressRef.current = onBackPress;

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (onBackPressRef.current?.() === true) {
          return true;
        }
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

/** The stack routes that keep the Shell sidebar (their testID and sidebar prefix). */
export type StackSidebarRouteName = 'author' | 'post';

export type StackSidebarRouteProps = {
  /** The route's navigation (`popTo`, `goBack`, `isFocused`). */
  navigation: StackNavigation;
  /** The route's key: FocusRestoration memory, forgotten on unmount. */
  routeKey: string;
  /** The origin Shell section: the sidebar's current item. */
  origin: SectionId;
  /**
   * The screen's id: the wrapper's testIDs (`<name>`, `<name>/sidebar`,
   * `<name>/content`) and the sidebar items' prefix (`<name>/nav/<section>`;
   * the Shell's `nav/<section>` stay mounted below).
   */
  name: StackSidebarRouteName;
  /**
   * The route's own Back order (e.g. close an overlay first): called first
   * on the hardware Back; true = handled, nothing else happens. Absent or
   * false: Back pops one route.
   */
  onBackPress?: () => boolean;
  /** The page, in the content zone. */
  children: (stack: { focus: StackSidebarFocus; onBack: () => void }) => ReactNode;
};

/**
 * A stack route above the Shell that keeps the Shell's sidebar (ADR 0012): the
 * shared screen wrapper (trapped on all sides), the sidebar with the origin
 * section as its current item, and the page in a content FocusZone (route
 * key + `main`). Sidebar OK, Back and restoration: `useStackSidebar`.
 *
 * - ← from the page's first column → the current item; → from the sidebar →
 *   the page's remembered element (the content zone's destination).
 */
export function StackSidebarRoute({
  navigation,
  routeKey,
  origin,
  name,
  onBackPress,
  children,
}: StackSidebarRouteProps) {
  const idPrefix = `${name}/`;
  const sidebar = useStackSidebar(navigation, routeKey, origin, idPrefix, onBackPress);
  return (
    <Screen testID={name}>
      <Sidebar
        testID={`${name}/sidebar`}
        idPrefix={idPrefix}
        sections={sidebar.sections}
        current={origin}
        nav={sidebar.nav}
        onPress={sidebar.onSidebarPress}
        onFocus={sidebar.onSidebarFocus}
      />
      <FocusZone
        ref={sidebar.zoneRef}
        testID={`${name}/content`}
        routeKey={routeKey}
        sectionId={MAIN_SECTION}
        onItemFocus={sidebar.onContentFocus}
        isActive={sidebar.focus.isActive}
        style={sidebarLayout.content}
      >
        {children({ focus: sidebar.focus, onBack: sidebar.onBack })}
      </FocusZone>
    </Screen>
  );
}

/**
 * D Автор (Story 3.3) with the Shell's sidebar (owner decision 2026-10-27,
 * option A; ADR 0012): current item = the origin section (Подписки, or
 * Главная for an Автор opened from a feed post). OK on a post opens Пост
 * (Story 3.4) with the same origin section. Story 5.7: the route key is the
 * page's Filter scope (`author:<routeKey>`); Back first clears an active
 * blog search (the page's handler), else pops.
 */
export function AuthorRoute({
  navigation,
  route,
}: StackScreenProps<RootStackParamList, 'Author'>) {
  const { blogUrl } = route.params;
  const origin = route.params.section ?? AUTHOR_ORIGIN;
  const routeKey = route.key;
  const onOpenPost = useCallback(
    (postBlogUrl: string, postId: string) => {
      if (navigation.isFocused()) {
        navigation.push('Post', { blogUrl: postBlogUrl, postId, section: origin });
      }
    },
    [navigation, origin],
  );

  // Story 5.7: Back asks the page first (an active blog search is cleared).
  const pageBack = useRef<(() => boolean) | null>(null);
  const onBackPress = useCallback(() => pageBack.current?.() === true, []);

  return (
    <StackSidebarRoute
      navigation={navigation}
      routeKey={routeKey}
      origin={origin}
      name="author"
      onBackPress={onBackPress}
    >
      {({ focus, onBack }) => (
        <AuthorScreen
          http={session.http}
          blogUrl={blogUrl}
          routeKey={routeKey}
          focus={focus}
          onBack={onBack}
          onOpenPost={onOpenPost}
          searchEnabled={phaseFlags.search}
          filtersEnabled={phaseFlags.filters}
          backHandlerRef={pageBack}
        />
      )}
    </StackSidebarRoute>
  );
}

/**
 * F Пост (Story 3.4) with the Shell's sidebar (ADR 0012): current item = the
 * origin section (Главная from the feed, Подписки from Автор). OK on the
 * author row opens Автор, or pops to it when the route below is Автор of
 * the same blog.
 */
export function PostRoute({ navigation, route }: StackScreenProps<RootStackParamList, 'Post'>) {
  const { blogUrl, postId, section: origin } = route.params;
  const routeKey = route.key;
  // OK on «Смотреть» or a MediaRow (Story 4.1): the Player for exactly that
  // video; exit returns focus to `focusId` on this route. Only while Пост is
  // the focused route (a second OK during the transition is dropped).
  // «С начала» (Story 4.2) passes `beginning`: that video starts at 0.
  const onOpenPlayer = useCallback(
    (ref: MediaRef, focusId: string, start?: 'beginning') => {
      if (navigation.isFocused()) {
        navigation.push('Player', {
          ref,
          origin: { routeKey, focusId },
          ...(start === 'beginning' ? { start } : {}),
        });
      }
    },
    [navigation, routeKey],
  );
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
    <StackSidebarRoute navigation={navigation} routeKey={routeKey} origin={origin} name="post">
      {({ focus, onBack }) => (
        <PostScreen
          http={session.http}
          blogUrl={blogUrl}
          postId={postId}
          focus={focus}
          onBack={onBack}
          onOpenAuthor={onOpenAuthor}
          onOpenPlayer={onOpenPlayer}
          playerEnabled={phaseFlags.player}
        />
      )}
    </StackSidebarRoute>
  );
}

/**
 * G Плеер (Story 4.1): full screen in the shared screen wrapper (trapped on
 * all sides), **without** the sidebar (not a `StackSidebarRoute`); the
 * player handles Back itself (overlay → exit). Whenever the route is removed
 * (exit, Back, Stop, «Назад», or any other path: `beforeRemove`), the origin
 * route's content zone is pointed at the element that opened the player
 * (FocusRestoration, route key + `main`), keeping that route's remembered
 * scroll offset and index, so the origin screen's return focus lands on it.
 * After a natural end (Story 4.5) the Post gets the next unfinished
 * MediaRow after the ended video, else its primary button, instead
 * (`endedFocus`). `setReturnFocus` is not used: the content zone reads with
 * `peek`, so a one-shot override would never be consumed there.
 */
export function PlayerRoute({ navigation, route }: StackScreenProps<RootStackParamList, 'Player'>) {
  const { ref, origin, start } = route.params;
  const isActive = useCallback(() => navigation.isFocused(), [navigation]);
  /** Story 4.5: the return focus after a natural end (else the origin element). */
  const endedFocus = useRef<string | null>(null);
  // Story 4.7: a Главная origin (a Continue card) is the Shell's `home`
  // section. After a natural end its card is gone (finished): Главная's
  // return picks the neighbour by the kept index, else the first feed card.
  const originSection = origin.sectionId ?? MAIN_SECTION;
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        const kept = focusRestoration.peek(origin.routeKey, originSection);
        focusRestoration.remember(
          origin.routeKey,
          originSection,
          endedFocus.current ?? origin.focusId,
          kept?.scrollOffset ?? 0,
          kept?.index,
        );
      }),
    [navigation, origin.routeKey, origin.focusId, originSection],
  );
  const onExit = useCallback(() => {
    if (navigation.isFocused()) {
      navigation.goBack();
    }
  }, [navigation]);
  // Story 4.4 (owner decision 2026-10-28): a recovery's fresh E8 says locked
  // (session checked): the Post's E8 is invalidated, so it refetches and
  // shows its own locked notice; the pop returns to it (the remembered row is
  // gone there, so the Post's vanished-focus fallback picks the author).
  const queryClient = useQueryClient();
  const onNoAccess = useCallback(() => {
    if (!navigation.isFocused()) {
      return;
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.post(ref.blogUrl, ref.postId) }).catch(() => {});
    navigation.goBack();
  }, [navigation, queryClient, ref.blogUrl, ref.postId]);
  // Story 4.5 (focus-map G «Ended»): the video played to its real end. The
  // Post (the origin) gets focus on the next unfinished MediaRow, else its
  // primary button, through the same `remember` the exit uses (the Post
  // reads restoration with `peek`, so a one-shot `setReturnFocus` would never
  // be consumed). No autoplay.
  const onEnded = useCallback(() => {
    if (!navigation.isFocused()) {
      return;
    }
    const cached = queryClient.getQueryData<PostResult>(queryKeys.post(ref.blogUrl, ref.postId));
    if (cached?.kind === 'ok' && origin.focusId.startsWith(postIdPrefix(ref.postId))) {
      endedFocus.current = endedReturnFocusId(cached.post, ref.mediaId, mediaId =>
        progress.store.snapshot(mediaId),
      );
    }
    navigation.goBack();
  }, [navigation, queryClient, ref.blogUrl, ref.postId, ref.mediaId, origin.focusId]);
  return (
    <Screen testID="player">
      <PlayerScreen
        http={session.http}
        mediaRef={ref}
        isActive={isActive}
        onExit={onExit}
        onNoAccess={onNoAccess}
        onEnded={onEnded}
        start={start ?? 'resume'}
      />
    </Screen>
  );
}
