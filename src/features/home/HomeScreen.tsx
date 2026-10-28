import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, TVFocusGuideView, View, useWindowDimensions } from 'react-native';
import type { HttpClient } from '../../shared/api';
import { videoDisplayTitle, type MediaRef, type Post } from '../../shared/entities/post';
import {
  DEFAULT_FILTER,
  FilterSheet,
  activeFilterCount,
  filtersStore,
  formatPeriod,
  isDefaultFilter,
  useFilter,
  type Filter,
} from '../../shared/filters';
import {
  focusRestoration,
  mayTakeScreenFocus,
  restoreElseFirst,
  useFocusRestoration,
  useLatestRef,
  useModal,
  usePhaseChange,
  useZoneItem,
} from '../../shared/focus';
import { t, tf, tp } from '../../shared/i18n';
import {
  entryDurationSec,
  progressStatus,
  useContinueEntries,
  type ProgressEntry,
} from '../../shared/services/progress';
import {
  Button,
  FilterChip,
  PostCardSkeleton,
  StateView,
  Text,
  requestHostFocus,
  spacing,
  colors,
  components,
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
import {
  CONTINUE_CARD_PREFIX,
  ContinueRow,
  continueCardId,
  continueNeighbour,
  type ContinueItem,
} from './ContinueRow';
import { manualRefreshFeed } from './feedRefresh';
import { useSubscriptionFeed } from './useSubscriptionFeed';

/** Focus id of «Повторить» on the offline StateView (docs/focus-map.md §3). */
export const HOME_OFFLINE_RETRY_ID = 'home/offline/retry';
/** The single action of the feed's empty and error StateViews (focus-map §1.5). */
export const HOME_STATE_ACTION_ID = 'state/home/action';
/** FocusRestoration section of Главная (the Shell's section id). */
export const HOME_SECTION = 'home';
/** «Обновить» in the feed's title row (Story 5.1, docs/focus-map.md §3 B). */
export const HOME_REFRESH_ID = 'home/refresh';
/** «Фильтры» in the feed's title row (Story 5.3, docs/focus-map.md §3 B). */
export const HOME_FILTERS_ID = 'home/filters';

const SKELETON_ROWS = 2;
const HEADER_HEIGHT = typography.section.lineHeight;
/**
 * The ↓ guide under «Обновить» (Story 5.1): a thin band right under the
 * button, with its width, so Android's focus search ↓ from the button finds
 * it before any card and it redirects to the remembered feed card.
 */
const DOWN_GUIDE_HEIGHT = spacing['2'];
/** The grid phase's title row: «Новое в подписках» + «Обновить», then the ↓ band. */
const TITLE_ROW_HEIGHT =
  Math.max(HEADER_HEIGHT, components['button-small'].height) + DOWN_GUIDE_HEIGHT;

/** Where the last Shell focus was, for the title row's guides (Stories 5.1, 5.3). */
type TitleFocus = 'refresh' | 'filters' | 'continue' | 'other';
/** The title row's controls (the ↑ guide goes to the last focused one). */
type TitleControl = 'refresh' | 'filters';
type RefreshState = 'idle' | 'busy' | 'failed';

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
  /**
   * OK on a «Продолжить просмотр» card (Story 4.7): open the Player for
   * that video at its resume point; `focusId` is the card (the return
   * focus). Absent (the player phase is off): no Continue row.
   */
  onOpenPlayer?: (ref: MediaRef, focusId: string) => void;
  /**
   * The «Фильтры» chip (Story 5.3, `phaseFlags.filters`). Off: no chip and
   * the feed uses the default Filter.
   */
  filtersEnabled?: boolean;
};

/**
 * The chip's visible label and TalkBack label for a Filter (owner decision
 * 2026-10-28, Story 5.4): the default → «Фильтры · Доступные мне»; one
 * active section → that section's value («Фильтры · Последние 7 дней») and
 * the count; two or more → «Фильтры» and the count.
 */
function chipLabels(filter: Filter): { label: string; a11y: string; count: number } {
  const count = activeFilterCount(filter);
  if (count >= 2) {
    return {
      label: t('filters.title'),
      a11y: tf('filters.chipA11yMany', { count: `${count} ${tp('filters.activeCount', count)}` }),
      count,
    };
  }
  const value =
    filter.period.kind !== 'all' ? formatPeriod(filter.period) : t(`filters.access.${filter.access}`);
  return {
    label: tf('filters.chip', { value }),
    a11y:
      count > 0
        ? tf('filters.chipA11yCount', { value, count: `${count} ${tp('filters.activeCount', count)}` })
        : tf('filters.chipA11y', { value }),
    count,
  };
}

/**
 * The preview of a video in the in-memory post data (the feed's posts):
 * the Continue card's fallback when the stored entry has none (a preview
 * URL with a query is never persisted, Story 4.7).
 */
function feedPreviewUrl(posts: readonly Post[], ref: MediaRef): string | null {
  const post = posts.find(p => p.id === ref.postId);
  const block = post?.blocks.find(b => b.type === 'ok_video' && b.id === ref.mediaId);
  return block?.type === 'ok_video' ? block.previewUrl : null;
}

function continueItem(entry: ProgressEntry, posts: readonly Post[]): ContinueItem {
  const { ref, meta } = entry;
  return {
    id: continueCardId(ref.mediaId),
    ref,
    // Both titles empty: «Без названия», as an untitled post card.
    title: videoDisplayTitle(meta.title, meta.postTitle) || t('postCard.untitled'),
    authorName: meta.authorName,
    previewUrl: meta.previewUrl ?? feedPreviewUrl(posts, ref),
    status: progressStatus(entry.positionSec, entryDurationSec(entry)),
  };
}

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
  onOpenPlayer,
  filtersEnabled = false,
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
  // The `feed` Filter (Story 5.3): the default while the chip is off.
  const storedFilter = useFilter('feed');
  const filter = filtersEnabled ? storedFilter : DEFAULT_FILTER;
  const filtered = !isDefaultFilter(filter);
  // The Filter changed while Главная is mounted: a filter skeleton keeps the
  // chip (the sheet's initiator), unlike the first load's skeleton.
  const initialFilter = useRef(filter);
  const filterTouched = useRef(false);
  if (filter !== initialFilter.current) {
    filterTouched.current = true;
  }
  const feed = useSubscriptionFeed(http, !offline, filter);
  // «Сбросить фильтры» on the filtered empty view (Story 5.3): while the
  // default feed is not loaded yet, that view stays (its action busy) instead
  // of the skeleton, so focus stays on the action until the cards arrive.
  const [resetHold, setResetHold] = useState(false);
  useEffect(() => {
    if (resetHold && !feed.isPending) {
      setResetHold(false);
    }
  }, [resetHold, feed.isPending]);
  // The filtered empty copy (Story 5.3): a non-default Filter, or the reset
  // still loading the default feed.
  const filteredEmpty = filtered || (resetHold && feed.isPending);
  /** The next grid takes focus on the first feed card (after «Сбросить фильтры»). */
  const focusFirstAfterReset = useRef(false);
  // «Продолжить просмотр» (Story 4.7): the local history, only while the
  // player is on (`onOpenPlayer`).
  const continueView = useContinueEntries();
  const continueEnabled = onOpenPlayer !== undefined;
  const continueItems = useMemo(
    () => (continueEnabled ? continueView.entries.map(entry => continueItem(entry, feed.posts)) : []),
    [continueEnabled, continueView.entries, feed.posts],
  );
  const continueIds = useMemo(() => continueItems.map(item => item.id), [continueItems]);
  const continueIdsRef = useLatestRef(continueIds);
  const showContinue = continueItems.length > 0;
  const windowHeight = useWindowDimensions().height;
  // A bounded viewport (Story 2.4 device lesson): the content zone's height
  // (window − 2 × safe-y) minus the header and the grid's top gap. With the
  // Continue row, the feed title scrolls with the grid (the list header).
  const listHeight =
    windowHeight - 2 * spacing['safe-y'] - (showContinue ? 0 : TITLE_ROW_HEIGHT) - FEED_LIST_TOP_GAP;

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
      current.startsWith(FEED_CARD_PREFIX) ||
      current.startsWith(CONTINUE_CARD_PREFIX)
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

  // The grid waits for the local history's first read too (a disk read),
  // so the initial focus can go to the first Continue card. Only the first:
  // a later re-read (after a reset) never brings the skeleton back.
  const continueRead = useRef(false);
  if (continueView.ready) {
    continueRead.current = true;
  }
  const phase: Phase = offline
    ? 'offline'
    : feed.isPending && resetHold
      ? 'empty'
      : feed.isPending || (continueEnabled && !continueRead.current)
        ? 'loading'
        : feed.firstPageError !== null
          ? 'error'
          : feed.posts.length === 0
            ? 'empty'
            : 'grid';

  const pendingMountFocus = useRef(focusOnMount);
  /**
   * The page's last automatic content focus was a Continue card: a head
   * refresh then never moves focus to the new first post (the row is above
   * the grid and stays where it is).
   */
  const autoContinue = useRef(false);

  /**
   * A remembered Continue card (Story 4.7): that card by id at its current
   * position; gone (finished) → its neighbour by the remembered index (the
   * next card, else the previous one); the row empty → the first feed card.
   * The grid's remembered scroll offset is restored first.
   */
  const restoreContinue = useCallback(() => {
    const entry = focusRestoration.peek(routeKey, HOME_SECTION);
    const rowIds = continueIdsRef.current;
    if (rowIds.length === 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      autoContinue.current = false;
      latch.auto(idsRef.current[0]);
      restoration.focusInitial();
      return;
    }
    listRef.current?.scrollToOffset({ offset: entry?.scrollOffset ?? 0, animated: false });
    const found = entry ? rowIds.indexOf(entry.focusId) : -1;
    const index = found >= 0 ? found : Math.min(entry?.index ?? 0, rowIds.length - 1);
    autoContinue.current = true;
    latch.auto(rowIds[index]);
    restoration.focusItem(rowIds[index]);
  }, [latch, restoration, routeKey, continueIdsRef]);

  /**
   * Главная takes its content focus by itself: the remembered card
   * (FocusRestoration, fallback chain; a Continue card by its own rule),
   * else the first Continue card (Story 4.7), else the first feed card.
   * Arms "not moved": where focus was (`nav/home`, the StateView action)
   * and the target are automatic, so their late native events are not
   * moves.
   */
  const takeContentFocus = useCallback(() => {
    const info = focusRef.current;
    latch.arm([info.sectionItemId, info.current()]);
    const remembered = focusRestoration.peek(routeKey, HOME_SECTION)?.focusId;
    if (remembered?.startsWith(CONTINUE_CARD_PREFIX)) {
      restoreContinue();
      return;
    }
    const firstContinue = continueIdsRef.current[0];
    if (remembered === undefined && firstContinue !== undefined) {
      autoContinue.current = true;
      latch.auto(firstContinue);
      restoration.focusItem(firstContinue);
      return;
    }
    autoContinue.current = false;
    const target = restoreElseFirst(restoration, () => latch.auto(idsRef.current[0]));
    if (target.kind === 'item') {
      latch.auto(target.id);
    }
  }, [latch, restoration, routeKey, restoreContinue, continueIdsRef]);

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
  // Story 5.4 (device): a sheet level change unmounts the focused row and
  // native focus may fall back to the sidebar for a moment, which the
  // Shell records; the page never takes focus while a modal is open.
  const modal = useModal();
  const mayTakeFocus = useCallback(
    () => !modal.isOpen() && mayTakeScreenFocus(focusRef.current, HOME_STATE_ACTION_ID),
    [modal],
  );

  usePhaseChange(phase, (_phase, previous) => {
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
      // Also when «Обновить» or «Фильтры» had focus and went away with the grid.
      const current = focusRef.current.current();
      if (
        (mountFocus && mayTakeFocus()) ||
        (focusRef.current.isActive() &&
          (current === HOME_REFRESH_ID || current === HOME_FILTERS_ID))
      ) {
        takeActionFocus(HOME_OFFLINE_RETRY_ID, offlineRetryView.current);
      }
    } else if (phase === 'grid' && focusFirstAfterReset.current) {
      // «Сбросить фильтры» (Story 5.3): the first feed card, while focus is
      // still on that action (else it stays where the user put it).
      focusFirstAfterReset.current = false;
      if (mayTakeFocus()) {
        const info = focusRef.current;
        latch.arm([info.sectionItemId, info.current()]);
        autoContinue.current = false;
        latch.auto(idsRef.current[0]);
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        restoration.focusInitial();
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
      (focusRef.current.isActive() &&
        (focusRef.current.current() === HOME_STATE_ACTION_ID ||
          focusRef.current.current() === HOME_REFRESH_ID))
    ) {
      // Empty or error: focus stays on the sidebar (as for the offline view,
      // Story 2.5), unless the section was opened with OK or the previous
      // StateView action had focus (its view was replaced), or «Обновить»
      // had it and went away with the grid (an empty last page 1, Story 5.1).
      takeActionFocus(HOME_STATE_ACTION_ID, stateActionView.current);
    }
    if (phase !== 'grid' && phase !== 'empty') {
      // The reset's empty view went away without a grid (an error).
      focusFirstAfterReset.current = false;
    }
    pendingMountFocus.current = false;
  });

  // Blur or unmount: stop a pending restore focus.
  useEffect(() => restoration.cancel, [restoration]);

  // Return from Пост (the Shell is focused again with focus in content):
  // the remembered card by id through FocusRestoration, with the fallback
  // chain (deferred from Story 3.1: the content zone's target used zone
  // order and no scroll). Card-only memory: the load-more «Повторить» and
  // the StateView action return through the zone as before.
  const phaseRef = useLatestRef(phase);
  useEffect(() => {
    const info = focusRef.current;
    const unregister = info.setReturnFocus?.(() => {
      const remembered = focusRestoration.peek(routeKey, HOME_SECTION)?.focusId;
      if (phaseRef.current === 'grid' && remembered?.startsWith(CONTINUE_CARD_PREFIX)) {
        // Back or a natural end in the Player (Story 4.7): the same card,
        // else its neighbour, else the first feed card.
        restoreContinue();
        return true;
      }
      if (
        phaseRef.current !== 'grid' ||
        remembered === undefined ||
        !remembered.startsWith(FEED_CARD_PREFIX) ||
        remembered === FEED_RETRY_ID
      ) {
        return false;
      }
      restoreElseFirst(restoration);
      return true;
    });
    return () => unregister?.();
  }, [restoration, routeKey, phaseRef, restoreContinue]);

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

  // OK on a Continue card (Story 4.7): the Player at the resume point (a
  // move for the head-follow rule).
  const continueItemsRef = useLatestRef(continueItems);
  const onOpenPlayerRef = useLatestRef(onOpenPlayer);
  const onContinuePress = useCallback(
    (id: string) => {
      latch.move();
      const item = continueItemsRef.current.find(i => i.id === id);
      if (item) {
        onOpenPlayerRef.current?.(item.ref, item.id);
      }
    },
    [latch, continueItemsRef, onOpenPlayerRef],
  );

  // The row reacts to the store (Story 4.7: a finished video leaves it, a
  // just-watched one moves first). A focused card keeps focus by id (its
  // view is keyed by the media id); a focused card that is gone → its
  // neighbour (the next card, else the previous one), else the first feed
  // card. Never while covered or when focus is elsewhere (`canFocus`).
  const lastContinueIds = useRef(continueIds);
  useLayoutEffect(() => {
    const previous = lastContinueIds.current;
    lastContinueIds.current = continueIds;
    if (previous === continueIds) {
      return;
    }
    const current = focusRef.current.current();
    if (
      current === null ||
      !current.startsWith(CONTINUE_CARD_PREFIX) ||
      continueIds.includes(current) ||
      !canFocus()
    ) {
      return;
    }
    // The neighbour by id in the previous list (a reorder in the same
    // update must not pick an arbitrary card); an automatic move, like the
    // other moves the page makes by itself.
    const neighbour = continueNeighbour(previous, current, continueIds);
    if (neighbour !== null) {
      autoContinue.current = true;
      latch.auto(neighbour);
      restoration.focusItem(neighbour);
    } else if (idsRef.current.length > 0) {
      autoContinue.current = false;
      latch.auto(idsRef.current[0]);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      restoration.focusInitial();
    }
  }, [continueIds, canFocus, restoration, latch]);

  // A Continue card the page focused by itself is never left for the head.
  const followHead = useCallback(
    (focused: string | null) =>
      !autoContinue.current &&
      !(focused?.startsWith(CONTINUE_CARD_PREFIX) ?? false) &&
      latch.followHead(focused),
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
    followHead,
    onFollowHead: latch.onFollowHead,
  });

  // Load-more retry: on success, the first new card (if focus is still on «Повторить»).
  const onRetryLoadMore = useLoadMoreRetry(
    feed,
    ids,
    restoration,
    () => focusRef.current.isActive() && focusRef.current.current() === FEED_RETRY_ID,
  );

  // «Обновить» (Story 5.1, FEED-03): a forced head refresh of the feed and
  // the subscriptions. Busy: «Обновляем…», focus kept, OK ignored; a failure
  // keeps every card and shows a short inline error; the next press tries
  // again. The remembered feed card is kept (↓ returns to it).
  const queryClient = useQueryClient();
  const [refresh, setRefresh] = useState<RefreshState>('idle');
  const refreshRunning = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const httpRef = useLatestRef(http);
  const filterRef = useLatestRef(filter);
  // The inline error is about the last press only: new feed data (any
  // write, e.g. a later resume refresh) or leaving the grid clears it.
  useEffect(() => {
    setRefresh(current => (current === 'failed' ? 'idle' : current));
  }, [feed.dataUpdatedAt, phase]);
  const onRefresh = useCallback(() => {
    if (refreshRunning.current) {
      return;
    }
    refreshRunning.current = true;
    // OK on «Обновить» is a move (the head-follow rule never takes it).
    latch.move();
    setRefresh('busy');
    manualRefreshFeed(queryClient, httpRef.current, filterRef.current, Date.now())
      .catch(() => 'failed' as const)
      .then(result => {
        refreshRunning.current = false;
        if (mounted.current) {
          setRefresh(result === 'failed' ? 'failed' : 'idle');
        }
      });
  }, [latch, queryClient, httpRef, filterRef]);

  // «Фильтры» (Story 5.3, FILTER-01): OK opens the filter sheet in the one
  // modal host (focus trapped, opens on the selected value; Back closes it
  // and focus returns to the chip, its initiator). A change applies at once
  // and the feed behind refetches; focus stays in the sheet.
  const chipView = useRef<HostView | null>(null);
  const filtersZone = useZoneItem(HOME_FILTERS_ID);
  const onOpenFilters = useCallback(() => {
    if (modal.isOpen()) {
      return;
    }
    // OK on the chip is a move (the head-follow rule never takes it).
    latch.move();
    modal.open(<FilterSheet scope="feed" />, chipView, { placement: 'end' });
  }, [latch, modal]);
  // «Сбросить фильтры» on the filtered empty view: the default Filter; the
  // first feed card takes focus when it arrives.
  const onResetFilters = useCallback(() => {
    focusFirstAfterReset.current = true;
    setResetHold(true);
    filtersStore.getState().reset('feed');
  }, []);

  // The title row's focus moves (docs/focus-map.md §3 B, Story 5.1):
  // - ↑ from the first feed row → «Обновить»: the row is a guide whose
  //   destination is the button;
  // - ↓ from «Обновить» → the remembered feed card (by id), else its
  //   neighbour by index, else the first card: the band under the button;
  // - ↑ from «Обновить» → the Continue row's guide (native), ← → the sidebar
  //   (native, like the first column);
  // - while a Continue card has focus the row is no guide and the button is
  //   not focusable, so ↓ from the row keeps its column (Story 4.7).
  const [titleFocus, setTitleFocus] = useState<TitleFocus>('other');
  const [lastTitleControl, setLastTitleControl] = useState<TitleControl | null>(null);
  const lastFeedCard = useRef<{ id: string; index: number } | null>(null);
  if (lastFeedCard.current === null) {
    const entry = focusRestoration.peek(routeKey, HOME_SECTION);
    if (entry?.focusId.startsWith(FEED_CARD_PREFIX) && entry.focusId !== FEED_RETRY_ID) {
      lastFeedCard.current = { id: entry.focusId, index: entry.index ?? 0 };
    }
  }
  useEffect(
    () =>
      focus.onFocusChange(focusId => {
        if (focusId.startsWith(FEED_CARD_PREFIX) && focusId !== FEED_RETRY_ID) {
          const index = idsRef.current.indexOf(focusId);
          lastFeedCard.current = { id: focusId, index: Math.max(index, 0) };
        }
        if (focusId === HOME_REFRESH_ID || focusId === HOME_FILTERS_ID) {
          setLastTitleControl(focusId === HOME_REFRESH_ID ? 'refresh' : 'filters');
        }
        setTitleFocus(
          focusId === HOME_REFRESH_ID
            ? 'refresh'
            : focusId === HOME_FILTERS_ID
              ? 'filters'
              : focusId.startsWith(CONTINUE_CARD_PREFIX)
                ? 'continue'
                : 'other',
        );
      }),
    [focus],
  );
  const refreshZone = useZoneItem(HOME_REFRESH_ID);
  const [refreshView, setRefreshView] = useState<HostView | null>(null);
  // The button reports focus to the content zone (Back, the Shell's focus
  // tracking) but does not register its view there: the zone's fallback
  // destination is the first registered item, and the button mounts before
  // the grid's cards, so → from the sidebar would land on it instead of a
  // card (focus-map §3 B: → returns to the remembered card).
  const refreshRef = useCallback((view: HostView | null) => setRefreshView(view), []);
  // The chip, like the button: focus reported to the zone, the view not
  // registered there (→ from the sidebar returns to the remembered card).
  const [filtersView, setFiltersView] = useState<HostView | null>(null);
  const filtersRef = useCallback((view: HostView | null) => {
    chipView.current = view;
    setFiltersView(view);
  }, []);
  const [downTarget, setDownTarget] = useState<HostView | null>(null);
  useEffect(() => {
    if (titleFocus !== 'refresh' && titleFocus !== 'filters') {
      setDownTarget(null);
      return;
    }
    const pick = () => {
      const remembered = lastFeedCard.current;
      const id =
        remembered === null
          ? ids[0]
          : ids.includes(remembered.id)
            ? remembered.id
            : ids[Math.min(remembered.index, ids.length - 1)];
      return (
        (id !== undefined ? restoration.viewOf(id) : null) ??
        (ids[0] !== undefined ? restoration.viewOf(ids[0]) : null)
      );
    };
    setDownTarget(pick());
    // A row that mounts after the list's layout pass (a regroup after a
    // merge): look again on the next frame.
    const frame = requestAnimationFrame(() => setDownTarget(pick()));
    return () => cancelAnimationFrame(frame);
  }, [titleFocus, ids, restoration]);

  // The chip (Story 5.3): in the grid's title row, and above the empty and
  // error views (an empty «Доступные мне» feed may still have posts under
  // «Все посты»). Above a skeleton only after a Filter change or with a
  // non-default Filter: the first load's skeleton has nothing focusable.
  const chip = filtersEnabled ? chipLabels(filter) : null;
  const showChip =
    chip !== null &&
    (phase === 'grid' ||
      phase === 'empty' ||
      phase === 'error' ||
      (phase === 'loading' && (filtered || filterTouched.current)));
  const chipProps =
    chip !== null && showChip
      ? {
          label: chip.label,
          a11y: chip.a11y,
          count: chip.count,
          onPress: onOpenFilters,
          ref: filtersRef,
          onFocus: filtersZone.onFocus,
        }
      : null;
  // ↑ from the first feed row: the row's last focused control, else the chip
  // (else «Обновить» when there is no chip).
  const rowControl =
    lastTitleControl === 'refresh' || chipProps === null ? refreshView : filtersView;
  const titleRow =
    phase === 'grid' ? (
      <FeedTitleRow
        refresh={refresh}
        onRefresh={onRefresh}
        buttonRef={refreshRef}
        onButtonFocus={refreshZone.onFocus}
        chip={chipProps}
        controlsFocusable={titleFocus !== 'continue'}
        rowDestination={titleFocus === 'continue' ? null : rowControl}
        refreshDownDestination={titleFocus === 'refresh' ? downTarget : null}
        chipDownDestination={titleFocus === 'filters' ? downTarget : null}
        inList={showContinue}
      />
    ) : chipProps !== null ? (
      <FeedTitleRow
        chip={chipProps}
        controlsFocusable
        rowDestination={null}
        refreshDownDestination={null}
        chipDownDestination={null}
        inList={false}
      />
    ) : null;

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
      {phase === 'grid' ? (
        showContinue ? null : (
          titleRow
        )
      ) : titleRow !== null ? (
        titleRow
      ) : (
        <Text variant="section" accessibilityRole="header" style={styles.header}>
          {t('home.feed.title')}
        </Text>
      )}
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
        // One element for both copies, so the action keeps its view (and
        // focus) when a reset lands on an empty default feed.
        <View
          testID={filteredEmpty ? 'home/feed/filtered-empty' : 'home/feed/empty'}
          style={styles.state}
        >
          <StateView
            title={t(filteredEmpty ? 'home.feed.filteredEmptyTitle' : 'home.feed.emptyTitle')}
            body={t(filteredEmpty ? 'home.feed.filteredEmptyBody' : 'home.feed.emptyBody')}
            action={{
              label: t(filteredEmpty ? 'home.feed.filteredEmptyReset' : 'home.feed.refresh'),
              onPress: filteredEmpty ? onResetFilters : feed.refetch,
              busy: filteredEmpty ? resetHold : feed.isFetching,
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
          header={
            showContinue ? (
              <ContinueHeader
                items={continueItems}
                restoration={restoration}
                onCardPress={onContinuePress}
                titleRow={titleRow}
              />
            ) : null
          }
        />
      ) : null}
    </View>
  );
}

/**
 * The grid's list header with the Continue row (Story 4.7): the row, then
 * the feed's title row (it scrolls with the grid here).
 */
function ContinueHeader({
  titleRow,
  ...props
}: {
  items: readonly ContinueItem[];
  restoration: ReturnType<typeof useFocusRestoration>;
  onCardPress: (id: string) => void;
  titleRow: ReactNode;
}) {
  return (
    <View testID="home/header">
      <ContinueRow {...props} />
      {titleRow}
    </View>
  );
}

/** The «Фильтры» chip's props in the title row (Story 5.3). */
type TitleChip = {
  label: string;
  a11y: string;
  count: number;
  onPress: () => void;
  ref: (view: HostView | null) => void;
  onFocus: () => void;
};

/**
 * The feed's title row (Story 5.1; Story 5.3 adds the chip): «Новое в
 * подписках», the «Фильтры» chip (when the filters phase is on), the
 * secondary small «Обновить» (grid only; busy: «Обновляем…») and, after a
 * failed refresh, a short inline error. The row is a focus guide to its
 * last focused control, else the chip (↑ from the first feed row); the band
 * under each control is a guide to the remembered feed card (↓ from it).
 * ← → move between the chip and «Обновить» (native, one row); → from
 * «Обновить» does nothing. Outside the grid only the title and the chip are
 * shown, with no guides. See HomeScreen for the rules.
 */
function FeedTitleRow({
  refresh,
  onRefresh,
  buttonRef,
  onButtonFocus,
  chip,
  controlsFocusable,
  rowDestination,
  refreshDownDestination,
  chipDownDestination,
  inList,
}: {
  /** Absent: no «Обновить» (outside the grid). */
  refresh?: RefreshState;
  onRefresh?: () => void;
  buttonRef?: (view: HostView | null) => void;
  onButtonFocus?: () => void;
  chip: TitleChip | null;
  controlsFocusable: boolean;
  rowDestination: HostView | null;
  refreshDownDestination: HostView | null;
  chipDownDestination: HostView | null;
  inList: boolean;
}) {
  const rowDestinations = useMemo(() => (rowDestination ? [rowDestination] : []), [rowDestination]);
  const refreshDown = useMemo(
    () => (refreshDownDestination ? [refreshDownDestination] : []),
    [refreshDownDestination],
  );
  const chipDown = useMemo(
    () => (chipDownDestination ? [chipDownDestination] : []),
    [chipDownDestination],
  );
  return (
    <TVFocusGuideView
      testID="home/title-row"
      destinations={rowDestinations}
      // → from «Обновить» does nothing (no edge transition; device check:
      // it reached the feed card to the lower right).
      trapFocusRight
      style={inList ? styles.titleRowInList : styles.titleRow}
    >
      <View style={styles.titleBox}>
        <Text variant="section" accessibilityRole="header">
          {t('home.feed.title')}
        </Text>
      </View>
      {/*
        Each ↓ band sits right under its control with the control's width:
        Android's focus search weighs the distance between centers, so a
        full-width band would lose to the card under the control (device
        check, Story 5.1).
      */}
      {chip !== null ? (
        <View style={styles.controlColumn}>
          <FilterChip
            ref={chip.ref}
            testID={HOME_FILTERS_ID}
            label={chip.label}
            count={chip.count}
            accessibilityLabel={chip.a11y}
            focusable={controlsFocusable}
            onPress={chip.onPress}
            onFocus={chip.onFocus}
          />
          <TVFocusGuideView
            testID="home/filters/down-guide"
            destinations={chipDown}
            style={styles.downGuide}
          />
        </View>
      ) : null}
      {refresh !== undefined ? (
        <View style={styles.controlColumn}>
          <Button
            ref={buttonRef}
            testID={HOME_REFRESH_ID}
            kind="secondary"
            size="small"
            label={t('home.refresh')}
            busyLabel={t('home.refreshing')}
            busyAccessibilityLabel={t('home.refreshingA11y')}
            accessibilityLabel={t('home.refreshA11y')}
            busy={refresh === 'busy'}
            focusable={controlsFocusable}
            onPress={onRefresh}
            onFocus={onButtonFocus}
          />
          <TVFocusGuideView
            testID="home/refresh/down-guide"
            destinations={refreshDown}
            style={styles.downGuide}
          />
        </View>
      ) : null}
      {refresh === 'failed' ? (
        <View style={styles.titleBox}>
          <Text
            testID="home/refresh/error"
            variant="body-s"
            numberOfLines={1}
            accessibilityLiveRegion="polite"
            style={styles.refreshError}
          >
            {t('home.refreshFailed')}
          </Text>
        </View>
      ) : null}
    </TVFocusGuideView>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    height: TITLE_ROW_HEIGHT,
    marginLeft: spacing['focus-headroom'],
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  titleRowInList: {
    height: TITLE_ROW_HEIGHT,
    marginTop: spacing['4'],
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  titleBox: {
    height: components['button-small'].height,
    justifyContent: 'center',
  },
  controlColumn: {
    marginLeft: spacing['6'],
  },
  refreshError: {
    marginLeft: spacing['6'],
    color: colors['error-text'],
  },
  downGuide: {
    height: DOWN_GUIDE_HEIGHT,
  },
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
