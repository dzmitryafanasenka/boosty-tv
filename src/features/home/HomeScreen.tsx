import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HttpClient } from '../../shared/api';
import { focusRestoration, useFocusRestoration, useZoneItem } from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  PostCardSkeleton,
  StateView,
  Text,
  requestHostFocus,
  spacing,
  typography,
  useHeadChangeRefocus,
  useHeldRowAutoFetch,
  useLoadMoreRetry,
  useNotMovedLatch,
  useShownGridPosts,
  type HostView,
} from '../../shared/ui';
import {
  FEED_CARD_PREFIX,
  FEED_CARD_WIDTH,
  FEED_COLUMNS,
  FEED_LIST_TOP_GAP,
  FEED_RETRY_ID,
  FeedGrid,
  type FeedRowItem,
  feedCardId,
  gridListAdapter,
} from './FeedGrid';
import { useSubscriptionFeed } from './useSubscriptionFeed';

/** Focus id of «Повторить» on the offline StateView (docs/focus-map.md §3). */
export const HOME_OFFLINE_RETRY_ID = 'home/offline/retry';
/** The single action of the feed's empty and error StateViews (focus-map §1.5). */
export const HOME_STATE_ACTION_ID = 'state/home/action';
/** FocusRestoration section of Главная (the Shell's section id). */
export const HOME_SECTION = 'home';

const SKELETON_ROWS = 2;
const HEADER_HEIGHT = typography.section.lineHeight;

/** What the Shell tells Главная about focus (it owns the zones). */
export type HomeFocusInfo = {
  /**
   * The Shell is the focused route. A covered (or closing) Shell never takes
   * focus: a late page must not steal it from the screen on top (A11).
   */
  isActive(): boolean;
  /** The last focused Shell element (sidebar or content id); null: none yet. */
  current(): string | null;
  /** Главная's sidebar item (`nav/home`). */
  sectionItemId: string;
  /** Focus Главная's sidebar item (the last fallback of the grid). */
  focusSidebar(): void;
  /**
   * Listen to the Shell's focus events (the same ids as `current()`, only
   * while the Shell is the focused route); returns the unsubscribe.
   */
  onFocusChange(listener: (focusId: string) => void): () => void;
  /**
   * Registers how Главная restores its content focus when the Shell is the
   * focused route again (Back from Пост, Story 3.4): the remembered card by
   * id through FocusRestoration (scroll, index, focus) with the fallback
   * chain. The function returns false when it did nothing (the Shell then
   * uses the zone's target). Returns the unregister function, which clears
   * the slot only while it still holds this registration.
   */
  setReturnFocus?(restore: () => boolean): () => void;
};

export type HomeScreenProps = {
  /**
   * Cold start with a stored session but no network (E1 `Network` after the
   * retries): the offline StateView with «Повторить». The session is kept.
   * The Shell passes it down; this feature does not know the session.
   */
  offline?: { retrying: boolean; onRetry: () => void };
  /** The active session's content client (from the Shell; never a singleton). */
  http: HttpClient;
  /** FocusRestoration route key (the Shell's). */
  routeKey: string;
  /** The section was opened with OK: take the content focus once content exists. */
  focusOnMount?: boolean;
  focus: HomeFocusInfo;
  /** OK on a feed card: open Пост (Story 3.4) by its identity. */
  onOpenPost?: (blogUrl: string, postId: string) => void;
};

type Phase = 'offline' | 'loading' | 'error' | 'empty' | 'grid';

/**
 * Главная (Story 3.1, docs/focus-map.md §3 B1–B6): «Новое в подписках», a
 * 3-column PostCard grid (FlashList, ADR 0011) fed by E5.
 *
 * Focus:
 * - Skeleton: focus stays on the sidebar (`nav/home`).
 * - When the first cards arrive, focus moves to them only if the user has
 *   not moved: focus is still on `nav/home` (or unknown), or on the
 *   StateView action that was just pressed. Cards already cached when
 *   Главная mounts take focus only if the section was opened with OK. The
 *   grid restores the remembered card (FocusRestoration, fallback chain),
 *   else the first card.
 * - The empty and error StateViews do not take focus by themselves (as the
 *   offline view, Story 2.5): → or OK on «Главная» reaches the action.
 * - Pagination, refetch and image loads never move focus. A load-more
 *   retry that succeeds focuses the first new card if focus is still on
 *   «Повторить».
 * - A resume head refresh that changes the head (Epic 3 retro A3, as on
 *   Автор): while the user has not moved since Главная took its content
 *   focus by itself (no D-pad move or OK; `useNotMovedLatch`), the new
 *   first post takes focus and the grid shows the top, whichever comes
 *   first, the reply or the native focus event of that automatic focus.
 *   Once the user has moved, the focused card keeps focus (scrolled to its
 *   new row). Focus the user put on the sidebar, a StateView action or
 *   «Повторить» is never taken.
 * - OK on a card opens Пост (Story 3.4). Back from it restores that card
 *   by id (card-only memory: only a card entry is restored this way) with
 *   the fallback chain neighbor by index → first card → the sidebar item.
 *
 * Offline: «Нет подключения к интернету» with «Повторить» (Story 2.5); the
 * feed is not requested meanwhile.
 */
export function HomeScreen({
  offline,
  http,
  routeKey,
  focusOnMount = false,
  focus,
  onOpenPost,
}: HomeScreenProps) {
  const offlineRetry = useZoneItem(HOME_OFFLINE_RETRY_ID);
  const offlineRetryView = useRef<HostView | null>(null);
  const offlineRetryRef = useCallback(
    (view: HostView | null) => {
      offlineRetryView.current = view;
      offlineRetry.ref?.(view);
    },
    [offlineRetry],
  );
  const feed = useSubscriptionFeed(http, !offline);
  const windowHeight = useWindowDimensions().height;
  // A bounded viewport (Story 2.4 device lesson): the content zone's height
  // (window − 2 × safe-y) minus the header and the grid's top gap.
  const listHeight = windowHeight - 2 * spacing['safe-y'] - HEADER_HEIGHT - FEED_LIST_TOP_GAP;

  const listRef = useRef<FlashListRef<FeedRowItem>>(null);
  // The grid's posts (`useShownGridPosts` over PostGrid's
  // `visibleGridPosts`): a trailing partial row is held while more pages may
  // come. Restoration and focus use these ids, so a remembered card in a
  // held row falls back by the chain. A held row that contains the focused
  // card is shown, and so is one behind a failing next page (it must not
  // stay hidden behind «Повторить»).
  const shownPosts = useShownGridPosts(
    feed.posts,
    feed.hasNextPage && !feed.loadMoreFailed,
    focus.current(),
    FEED_CARD_PREFIX,
  );
  // Keep scroll on return (owner decision 2026-10-26): mounted with cached
  // cards, the grid opens at the remembered card's row (so it is mounted and
  // → from the sidebar lands on it), then at the exact remembered offset.
  const [initialRow] = useState(() => {
    const index = focusRestoration.peek(routeKey, HOME_SECTION)?.index;
    return shownPosts.length > 0 && index !== undefined && index < shownPosts.length
      ? Math.floor(index / FEED_COLUMNS)
      : undefined;
  });
  const adapterRef = useRef(gridListAdapter(listRef));
  const ids = useMemo(() => shownPosts.map(post => feedCardId(post.id)), [shownPosts]);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // A page that added posts but no shown row (they all went into the held
  // partial row): fetch the next one (only on an append, bounded).
  useHeldRowAutoFetch(feed, shownPosts.length);

  const focusRef = useRef(focus);
  focusRef.current = focus;
  const stateAction = useZoneItem(HOME_STATE_ACTION_ID);
  const stateActionView = useRef<HostView | null>(null);
  const stateActionRef = useCallback(
    (view: HostView | null) => {
      stateActionView.current = view;
      stateAction.ref?.(view);
    },
    [stateAction],
  );
  // "The user has not moved since Главная took its content focus by itself"
  // (Epic 3 retro A3, the Author page's rule; shared `useNotMovedLatch`):
  // armed only when the page takes its content focus itself (the first
  // cards arriving, OK on «Главная»), closed by any D-pad move or OK.
  const latch = useNotMovedLatch(focus.onFocusChange, { armed: false });
  // Nothing above the grid in Story 3.1 (no filters/refresh): the
  // StateView action when shown, else give up to the sidebar item. Both
  // are the page's own focus (recorded as automatic).
  const focusAbove = useCallback(() => {
    if (stateActionView.current) {
      latch.auto(HOME_STATE_ACTION_ID);
      requestHostFocus(stateActionView.current);
    } else {
      latch.auto(focusRef.current.sectionItemId);
      focusRef.current.focusSidebar();
    }
  }, [latch]);
  // A pending card focus lands only while the Shell is active and focus is
  // still where Главная may take it: none yet, `nav/home`, a feed card, the
  // StateView action or «Повторить». A move elsewhere (another sidebar item,
  // a covering screen) drops it.
  const canFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive()) {
      return false;
    }
    const current = info.current();
    return (
      current === null ||
      current === info.sectionItemId ||
      current === HOME_STATE_ACTION_ID ||
      current.startsWith(FEED_CARD_PREFIX)
    );
  }, []);

  const restoration = useFocusRestoration({
    routeKey,
    sectionId: HOME_SECTION,
    ids,
    listRef: adapterRef,
    focusAbove,
    canFocus,
  });

  const phase: Phase = offline
    ? 'offline'
    : feed.isPending
      ? 'loading'
      : feed.firstPageError !== null
        ? 'error'
        : feed.posts.length === 0
          ? 'empty'
          : 'grid';

  const pendingMountFocus = useRef(focusOnMount);

  /**
   * Главная takes its content focus by itself: the remembered card
   * (FocusRestoration, fallback chain), else the first card. Arms "not
   * moved": where focus was (`nav/home`, the StateView action) and the
   * target are automatic, so their late native events are not moves.
   */
  const takeContentFocus = useCallback(() => {
    const info = focusRef.current;
    latch.arm([info.sectionItemId, info.current()]);
    const target = restoration.restore();
    if (target.kind === 'item') {
      latch.auto(target.id);
    } else if (target.kind === 'none') {
      latch.auto(idsRef.current[0]);
      restoration.focusInitial();
    }
  }, [latch, restoration]);

  /**
   * Главная focuses a StateView action (empty/error) or the offline
   * «Повторить» by itself: recorded as automatic (armed from where focus
   * was), so its late native event is not a move when the grid follows.
   */
  const takeActionFocus = useCallback(
    (id: string, view: HostView | null) => {
      const info = focusRef.current;
      latch.arm([info.sectionItemId, info.current()]);
      latch.auto(id);
      requestHostFocus(view);
    },
    [latch],
  );

  /**
   * The user has not moved focus away from where Главная may take it (also
   * after OK on «Главная»: a move within the sidebar during the skeleton
   * still wins).
   */
  const mayTakeFocus = useCallback(() => {
    if (!focusRef.current.isActive()) {
      return false;
    }
    const current = focusRef.current.current();
    return (
      current === null ||
      current === focusRef.current.sectionItemId ||
      current === HOME_STATE_ACTION_ID
    );
  }, []);

  const lastPhase = useRef<Phase | null>(null);
  useEffect(() => {
    const previous = lastPhase.current;
    lastPhase.current = phase;
    if (previous === phase) {
      return;
    }
    if (phase !== 'grid') {
      // The grid is gone: nothing to follow until the page takes focus again.
      latch.disarm();
    }
    if (phase === 'loading') {
      return;
    }
    const mountFocus = pendingMountFocus.current;
    if (phase === 'offline') {
      // Opened with OK while offline: «Повторить» (Story 2.5 behavior; the
      // Shell leaves Главная's content focus to this screen).
      if (mountFocus && mayTakeFocus()) {
        takeActionFocus(HOME_OFFLINE_RETRY_ID, offlineRetryView.current);
      }
    } else if (phase === 'grid') {
      // Mounted with cached cards (Back to Главная, a section switch): focus
      // stays where the Shell put it unless the section was opened with OK.
      // Only cards that arrive while Главная is shown may take it.
      if (previous === null ? mountFocus && mayTakeFocus() : mayTakeFocus()) {
        takeContentFocus();
      } else if (previous === null) {
        // Cached cards, focus stays on the sidebar: only the scroll returns.
        const offset = focusRestoration.peek(routeKey, HOME_SECTION)?.scrollOffset;
        if (offset !== undefined && offset > 0) {
          listRef.current?.scrollToOffset({ offset, animated: false });
        }
      }
    } else if (
      (mountFocus && mayTakeFocus()) ||
      (focusRef.current.isActive() && focusRef.current.current() === HOME_STATE_ACTION_ID)
    ) {
      // Empty or error: focus stays on the sidebar (as for the offline view,
      // Story 2.5), unless the section was opened with OK or the previous
      // StateView action had focus (its view was replaced).
      takeActionFocus(HOME_STATE_ACTION_ID, stateActionView.current);
    }
    pendingMountFocus.current = false;
  }, [phase, mayTakeFocus, takeContentFocus, takeActionFocus, latch, routeKey]);

  // Blur or unmount: stop a pending restore focus.
  useEffect(() => restoration.cancel, [restoration]);

  // Return from Пост (the Shell is focused again with focus in content):
  // the remembered card by id through FocusRestoration, with the fallback
  // chain (deferred from Story 3.1: the content zone's target used zone
  // order and no scroll). Card-only memory: the load-more «Повторить» and
  // the StateView action return through the zone as before.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const info = focusRef.current;
    const unregister = info.setReturnFocus?.(() => {
      const remembered = focusRestoration.peek(routeKey, HOME_SECTION)?.focusId;
      if (
        phaseRef.current !== 'grid' ||
        remembered === undefined ||
        !remembered.startsWith(FEED_CARD_PREFIX) ||
        remembered === FEED_RETRY_ID
      ) {
        return false;
      }
      if (restoration.restore().kind === 'none') {
        restoration.focusInitial();
      }
      return true;
    });
    return () => unregister?.();
  }, [restoration, routeKey]);

  const postsRef = useRef(shownPosts);
  postsRef.current = shownPosts;
  const onOpenPostRef = useRef(onOpenPost);
  onOpenPostRef.current = onOpenPost;
  const onCardPress = useCallback(
    (postId: string) => {
      // OK on a card is a move (the head-follow rule), and opens Пост.
      latch.move();
      const post = postsRef.current.find(p => p.id === postId);
      if (post) {
        onOpenPostRef.current?.(post.author.blogUrl, post.id);
      }
    },
    [latch],
  );

  // A resume refresh changed the shown cards other than by an append
  // (shared rule, `useHeadChangeRefocus`): while the user has not moved
  // since Главная took its content focus by itself, the new first post
  // takes focus and the grid shows the top (Epic 3 retro A3, as on Автор);
  // else the focused card keeps focus. Sidebar focus is never taken.
  useHeadChangeRefocus({
    ids,
    cardIdPrefix: FEED_CARD_PREFIX,
    retryId: FEED_RETRY_ID,
    focused: () => focusRef.current.current(),
    canFocus,
    restoration,
    list: adapterRef,
    followHead: latch.followHead,
    onFollowHead: latch.onFollowHead,
  });

  // Load-more retry: on success, the first new card (if focus is still on «Повторить»).
  const onRetryLoadMore = useLoadMoreRetry(
    feed,
    ids,
    restoration,
    () => focusRef.current.isActive() && focusRef.current.current() === FEED_RETRY_ID,
  );

  if (phase === 'offline' && offline) {
    return (
      <View testID="home/offline" style={styles.centered}>
        <StateView
          title={t('home.offline.title')}
          body={t('home.offline.body')}
          action={{
            label: t('common.retry'),
            onPress: offline.onRetry,
            busy: offline.retrying,
            testID: HOME_OFFLINE_RETRY_ID,
            ref: offlineRetryRef,
            onFocus: offlineRetry.onFocus,
          }}
          style={styles.withAction}
        />
      </View>
    );
  }

  return (
    <View testID="home/feed" style={styles.root}>
      <Text variant="section" accessibilityRole="header" style={styles.header}>
        {t('home.feed.title')}
      </Text>
      {phase === 'loading' ? (
        <View
          testID="home/feed/skeleton"
          style={styles.skeleton}
          accessible
          accessibilityLabel={t('home.feed.loading')}
        >
          {Array.from({ length: SKELETON_ROWS }, (_, row) => (
            <View key={row} style={styles.skeletonRow}>
              {Array.from({ length: FEED_COLUMNS }, (__, column) => (
                <PostCardSkeleton
                  key={column}
                  width={FEED_CARD_WIDTH}
                  style={column > 0 ? styles.columnGap : undefined}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {phase === 'error' && feed.firstPageError !== null ? (
        <View testID="home/feed/error" style={styles.state}>
          <StateView
            title={t('home.feed.errorTitle')}
            body={t(`error.${feed.firstPageError}`)}
            action={{
              label: t('common.retry'),
              onPress: feed.refetch,
              busy: feed.isFetching,
              testID: HOME_STATE_ACTION_ID,
              ref: stateActionRef,
              onFocus: stateAction.onFocus,
            }}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'empty' ? (
        <View testID="home/feed/empty" style={styles.state}>
          <StateView
            title={t('home.feed.emptyTitle')}
            body={t('home.feed.emptyBody')}
            action={{
              label: t('home.feed.refresh'),
              onPress: feed.refetch,
              busy: feed.isFetching,
              testID: HOME_STATE_ACTION_ID,
              ref: stateActionRef,
              onFocus: stateAction.onFocus,
            }}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'grid' ? (
        <FeedGrid
          posts={shownPosts}
          height={listHeight}
          restoration={restoration}
          listRef={listRef}
          hasNextPage={feed.hasNextPage}
          isFetchingNextPage={feed.isFetchingNextPage}
          loadMoreFailed={feed.loadMoreFailed}
          onLoadMore={feed.fetchNextPage}
          onRetry={onRetryLoadMore}
          initialRow={initialRow}
          onCardPress={onCardPress}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    height: HEADER_HEIGHT,
    marginLeft: spacing['focus-headroom'],
  },
  skeleton: {
    marginTop: spacing['8'],
    paddingHorizontal: spacing['focus-headroom'],
  },
  skeletonRow: {
    flexDirection: 'row',
    marginBottom: spacing['card-gap-y'],
  },
  columnGap: {
    marginLeft: spacing['card-gap-x'],
  },
  state: {
    flex: 1,
    justifyContent: 'center',
  },
  // Focus headroom: the scaled button and its ring stay inside the content.
  withAction: {
    paddingHorizontal: spacing['focus-headroom'],
  },
});
