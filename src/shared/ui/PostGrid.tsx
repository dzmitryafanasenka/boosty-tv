import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import { StyleSheet, TVFocusGuideView, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import type { Post } from '../entities/post';
import {
  restoreElseFirst,
  useZoneItem,
  type ListRestoration,
  type RestorableList,
} from '../focus';
import { t } from '../i18n';
import { Button } from './Button';
import type { HostView } from './FocusableSurface';
import { PostCard, postCardHeight, postCardWidth } from './PostCard';
import { Spinner } from './Spinner';
import { Text } from './Text';
import { colors, spacing } from './tokens';

/**
 * The 3-column PostCard grid (Story 3.1 Главная, Story 3.3 Автор): a
 * recycling FlashList (ADR 0011) of rows of 3 cards keyed by the first post
 * id, fixed row height, a bounded viewport height (Story 2.4 device lesson)
 * and focus headroom on every side. Screens pass their focus ids and
 * testIDs by prefix; the geometry, the paging triggers and the focus rules
 * are the same everywhere.
 */

/** Owner decision 2026-10-26 (device review): 3 columns (Главная and Автор). */
export const POST_GRID_COLUMNS = 3;
/**
 * The grid keeps `focus-headroom` on both sides of the 720 dp content for
 * the focus scale (1.06) and ring: (720 − 2 × 12 − 2 × 16) / 3 = 221.
 */
export const POST_GRID_CARD_WIDTH = postCardWidth(spacing['content-width'], POST_GRID_COLUMNS);
export const POST_GRID_CARD_HEIGHT = postCardHeight(POST_GRID_CARD_WIDTH);
export const POST_GRID_ROW_HEIGHT = POST_GRID_CARD_HEIGHT + spacing['card-gap-y'];
const HEADROOM = spacing['focus-headroom'];
/**
 * Every card's focusable view carries half the row gap as vertical padding
 * (11 above, 11 below), so its rectangle includes the room the 1.06 scale
 * and the ring need (about 10 dp). Android's ScrollView scrolls a newly
 * focused view's rectangle into view (minimal scroll, flush with the edge):
 * with the padding, the scaled card and its ring stay visible, and no JS
 * scroll runs on focus. A JS `scrollToOffset` on focus raced the native
 * focus scroll on fast ↓ and let focus jump columns (Story 3.1 device run).
 */
export const POST_GRID_SLOT_PADDING = spacing['card-gap-y'] / 2;
/** Content top padding: the first card still starts `HEADROOM` below the list top. */
const CONTENT_TOP = HEADROOM - POST_GRID_SLOT_PADDING;
/** The header-to-first-row gap is `8` (16); the list's top headroom gives 12 of it. */
export const POST_GRID_LIST_TOP_GAP = spacing['8'] - HEADROOM;

/** One grid row: up to `POST_GRID_COLUMNS` posts. The list's items are rows. */
export type PostRowItem = {
  key: string;
  posts: readonly Post[];
  start: number;
};

/**
 * The posts the grid shows. While more pages may come, a trailing partial
 * row is held back (shown with the next page): with 3 columns the last row
 * could be 1 card wide, and a fast ↓ that outran the next page moved focus
 * into it, i.e. into column 1 (Story 3.1 device run, adb). Without it, ↓
 * from the last full row hits the end guide and keeps the column. Fewer
 * than 3 posts are all shown; on the last page (`hasNextPage` false)
 * everything is shown.
 */
export function visibleGridPosts(posts: readonly Post[], hasNextPage: boolean): readonly Post[] {
  const partial = posts.length % POST_GRID_COLUMNS;
  return hasNextPage && partial > 0 && posts.length > POST_GRID_COLUMNS
    ? posts.slice(0, posts.length - partial)
    : posts;
}

/**
 * Rows keyed by their first post id. FlatList's `numColumns` keys a row by
 * all its item keys, so the partial last row ([9] → [9, 10, 11]) changed
 * its key when a page arrived and remounted, focused card included (focus
 * fell back to the first card). A first-post key keeps the row mounted.
 */
export function postGridRows(posts: readonly Post[]): PostRowItem[] {
  const rows: PostRowItem[] = [];
  for (let start = 0; start < posts.length; start += POST_GRID_COLUMNS) {
    const slice = posts.slice(start, start + POST_GRID_COLUMNS);
    rows.push({ key: slice[0].id, posts: slice, start });
  }
  return rows;
}

/**
 * Row geometry. FlashList measures rows (all rows have this fixed height);
 * kept as the `getItemLayout` of the FlatList rollback (ADR 0011).
 */
export function postGridRowLayout(_data: unknown, rowIndex: number) {
  return {
    length: POST_GRID_ROW_HEIGHT,
    offset: CONTENT_TOP + POST_GRID_ROW_HEIGHT * rowIndex,
    index: rowIndex,
  };
}

/** FocusRestoration speaks item indexes; the grid scrolls by row. */
export function postGridListAdapter(list: {
  current: FlashListRef<PostRowItem> | null;
}): RestorableList {
  return {
    scrollToOffset: params => list.current?.scrollToOffset(params),
    scrollToIndex: ({ index, ...rest }) => {
      Promise.resolve(
        list.current?.scrollToIndex({ ...rest, index: Math.floor(index / POST_GRID_COLUMNS) }),
      ).catch(() => {});
    },
  };
}

/** The paging state a grid screen reads (a `PagedPosts` satisfies it). */
type GridPaging = {
  posts: readonly Post[];
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  loadMoreFailed: boolean;
  fetchNextPage: () => void;
  autoFetchNext: () => boolean;
};

/**
 * A page that added posts but no shown row (they all went into the held
 * partial row) would stall paging: nothing new to focus or scroll to.
 * Fetch the next page then (bounded like the paged hook's own auto-fetch).
 * Only an append counts (the last post changed): a refresh that puts posts
 * on top sends no further request.
 */
export function useHeldRowAutoFetch(paging: GridPaging, shownCount: number): void {
  const { posts, autoFetchNext, hasNextPage, isFetching, loadMoreFailed } = paging;
  const lastPostId = posts[posts.length - 1]?.id;
  const counts = useRef({ all: posts.length, shown: shownCount, last: lastPostId });
  useEffect(() => {
    if (isFetching) {
      return;
    }
    const before = counts.current;
    counts.current = { all: posts.length, shown: shownCount, last: lastPostId };
    if (
      posts.length > before.all &&
      lastPostId !== before.last &&
      shownCount === before.shown &&
      hasNextPage &&
      !loadMoreFailed
    ) {
      autoFetchNext();
    }
  }, [posts.length, shownCount, lastPostId, hasNextPage, isFetching, loadMoreFailed, autoFetchNext]);
}

/**
 * The posts a grid screen shows: `visibleGridPosts` (a trailing partial row
 * held while `hold`), except that a held row containing the focused card
 * (`focusedId`, read at render time) is shown. A head refresh that puts
 * posts on top can move the focused card into the trailing partial row, and
 * it must stay visible (and focused) there. Read before the remount moves
 * native focus; once focus has left the row, the next render holds it again.
 */
export function useShownGridPosts(
  posts: readonly Post[],
  hold: boolean,
  focusedId: string | null,
  cardIdPrefix: string,
): readonly Post[] {
  return useMemo(() => {
    const shown = visibleGridPosts(posts, hold);
    return shown.length < posts.length &&
      posts.slice(shown.length).some(post => `${cardIdPrefix}${post.id}` === focusedId)
      ? posts
      : shown;
  }, [posts, hold, focusedId, cardIdPrefix]);
}

export type HeadChangeRefocusOptions = {
  /** The shown cards' focus ids, in order. */
  ids: readonly string[];
  cardIdPrefix: string;
  /** The load-more «Повторить» (never taken, even when it shares the card prefix). */
  retryId: string;
  /** The screen's last focused element (sidebar or content id); null: none yet. */
  focused: () => string | null;
  /** The screen's pending-focus gate (false while covered or inactive). */
  canFocus: () => boolean;
  restoration: ListRestoration;
  list: RefObject<RestorableList>;
  /**
   * Optional (Автор reopen, owner decision 2026-10-27; Главная, Epic 3
   * retro A3): true when focus should follow the head instead (the user has
   * not moved since the page took focus by itself, `useNotMovedLatch`;
   * called with the focused element). The new first card then takes focus
   * and the list shows the top.
   */
  followHead?: (focused: string | null) => boolean;
  /** Called with the card id the head-follow focused (before the focus request). */
  onFollowHead?: (id: string) => void;
};

/**
 * A head refresh changed the shown cards other than by an append (posts on
 * top or inserted below the first one, or a gap that replaced the list):
 * the rows regroup and remount (rows are keyed by their first post id), so
 * a focused card would lose native focus. The trigger is that change of the
 * ids, never frame timing. The focused element is read in a layout effect,
 * right after the commit and before any native focus event of the remount
 * reaches JS. A focused card that is still shown keeps focus and, if its
 * index moved, is scrolled into view at its new row; a card that is gone
 * follows the fallback chain (else the first card). Sidebar, StateView and
 * «Повторить» focus is never taken, and a covered screen never takes focus
 * (`canFocus`).
 *
 * With `followHead` returning true (the user has not moved), the first card
 * takes focus instead and the list scrolls to the top, whether or not the
 * native focus event of the earlier automatic focus has reached JS yet.
 */
export function useHeadChangeRefocus({
  ids,
  cardIdPrefix,
  retryId,
  focused,
  canFocus,
  restoration,
  list,
  followHead,
  onFollowHead,
}: HeadChangeRefocusOptions): void {
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const followRef = useRef({ followHead, onFollowHead });
  followRef.current = { followHead, onFollowHead };
  const lastIds = useRef(ids);
  useLayoutEffect(() => {
    const previous = lastIds.current;
    lastIds.current = ids;
    if (previous.length === 0 || ids.length === 0 || previous === ids) {
      return;
    }
    const appended =
      ids.length >= previous.length && previous.every((id, i) => ids[i] === id);
    if (appended) {
      return;
    }
    const current = focusedRef.current();
    const follow = followRef.current;
    // Follow only when the first card changed; with the same first card
    // (posts inserted below it) the focused card keeps focus as below (its
    // row may still remount).
    if (follow.followHead?.(current) === true && canFocus() && previous[0] !== ids[0]) {
      const first = ids[0];
      list.current.scrollToOffset({ offset: 0, animated: false });
      follow.onFollowHead?.(first);
      restoration.focusItem(first);
      return;
    }
    if (
      current === null ||
      !current.startsWith(cardIdPrefix) ||
      current === retryId ||
      !canFocus()
    ) {
      return;
    }
    const index = ids.indexOf(current);
    if (index < 0) {
      restoreElseFirst(restoration);
      return;
    }
    const before = previous.indexOf(current);
    const rowStart = (i: number) => i - (i % POST_GRID_COLUMNS);
    if (before === index && previous[rowStart(before)] === ids[rowStart(index)]) {
      // Same index, same row key: the card's row did not remount.
      return;
    }
    if (before !== index) {
      list.current.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
    }
    restoration.focusItem(current);
  }, [ids, cardIdPrefix, retryId, canFocus, restoration, list]);
}

/** "The user has not moved" for `useHeadChangeRefocus`'s `followHead` (see `useNotMovedLatch`). */
export type NotMovedLatch = {
  /**
   * Record a focus the page requests by itself (call it before the
   * request): its native focus event, however late, is not a move.
   * Ignored while unarmed or after a move (nothing to protect).
   */
  auto(id: string | null | undefined): void;
  /**
   * (Re)start "not moved" now: the page takes focus by itself. `ids` are
   * the elements whose native focus events may still arrive and are not
   * moves (where focus was), in request order; they are appended to the
   * still-unsettled automatic targets (deduped, null ignored). The target
   * itself is recorded with `auto`.
   */
  arm(ids: readonly (string | null | undefined)[]): void;
  /** Stop following (the content the latch protected is gone). */
  disarm(): void;
  /** An explicit user action that is not a focus event (OK on a card). */
  move(): void;
  /** `useHeadChangeRefocus`'s `followHead`. */
  followHead(focused: string | null): boolean;
  /** `useHeadChangeRefocus`'s `onFollowHead` (the head-follow focus is automatic). */
  onFollowHead(id: string): void;
};

/**
 * "The user has not moved since the page took focus by itself" (Автор
 * reopen, owner decision 2026-10-27; Главная, Epic 3 retro A3): while it
 * holds, a head refresh moves focus to the new first post instead of
 * keeping the focused card (`useHeadChangeRefocus` `followHead`).
 *
 * - `armed` from the start (Автор: since the page opened) or from `arm()`
 *   (Главная: since it took its content focus by itself); unarmed
 *   (`disarm()`, e.g. the grid went away), it never follows. `arm()` keeps
 *   the still-unsettled automatic targets, so a late native event of an
 *   earlier automatic focus is not a move.
 * - The latch closes on the first focus event (`onFocusChange`) of an
 *   element the page did not focus by itself (a D-pad move), or on `move()`
 *   (OK on a card). The page's own focus requests are recorded in request
 *   order (`auto`, `arm`); their native events, which may arrive after a
 *   newer automatic request, settle the older ones and are never moves. So
 *   the result does not depend on whether a refresh reply or a native focus
 *   event comes first. A move forgets the recorded targets; `auto()` is
 *   ignored while unarmed or after a move.
 * - A D-pad press that does not move focus is not observable in JS and is
 *   not counted.
 */
export function useNotMovedLatch(
  onFocusChange: (listener: (focusId: string) => void) => () => void,
  { armed: armedInitially }: { armed: boolean },
): NotMovedLatch {
  const armed = useRef(armedInitially);
  const moved = useRef(false);
  const autoTargets = useRef<string[]>([]);
  useEffect(
    () =>
      onFocusChange(focusId => {
        if (!armed.current || moved.current) {
          return;
        }
        const index = autoTargets.current.indexOf(focusId);
        if (index >= 0) {
          // Older automatic targets are settled.
          autoTargets.current = autoTargets.current.slice(index);
        } else {
          moved.current = true;
          autoTargets.current = [];
        }
      }),
    [onFocusChange],
  );
  return useMemo<NotMovedLatch>(() => {
    // Request order: a repeated id moves to the end (its newest request).
    const add = (id: string | null | undefined) => {
      if (id !== null && id !== undefined) {
        autoTargets.current = [...autoTargets.current.filter(target => target !== id), id];
      }
    };
    const auto = (id: string | null | undefined) => {
      if (armed.current && !moved.current) {
        add(id);
      }
    };
    return {
      auto,
      arm: ids => {
        armed.current = true;
        moved.current = false;
        // Earlier automatic targets whose events have not arrived stay.
        for (const id of ids) {
          add(id);
        }
      },
      disarm: () => {
        armed.current = false;
      },
      move: () => {
        moved.current = true;
        autoTargets.current = [];
      },
      followHead: focused =>
        armed.current &&
        !moved.current &&
        (focused === null || autoTargets.current.includes(focused)),
      onFollowHead: auto,
    };
  }, []);
}

/**
 * B5 load-more «Повторить»: reloads the failed page only. On success the
 * first new card is focused if focus is still on «Повторить»
 * (`retryFocused`); a retry that adds no card (the row is gone) focuses the
 * last card. Failing again leaves focus on the button.
 */
export function useLoadMoreRetry(
  paging: GridPaging,
  ids: readonly string[],
  restoration: ListRestoration,
  retryFocused: () => boolean,
): () => void {
  const retryFrom = useRef<number | null>(null);
  const retryFocusedRef = useRef(retryFocused);
  retryFocusedRef.current = retryFocused;
  const { fetchNextPage, isFetchingNextPage, loadMoreFailed } = paging;
  const onRetry = useCallback(() => {
    retryFrom.current = ids.length;
    fetchNextPage();
  }, [fetchNextPage, ids.length]);
  useEffect(() => {
    const from = retryFrom.current;
    if (from === null || isFetchingNextPage) {
      return;
    }
    // Any completed retry ends the wait.
    retryFrom.current = null;
    if (loadMoreFailed || !retryFocusedRef.current()) {
      return;
    }
    if (ids.length > from) {
      restoration.focusItem(ids[from]);
    } else if (ids.length > 0) {
      // Nothing new and the row is gone: the last card, not lost focus.
      restoration.focusItem(ids[ids.length - 1]);
    }
  }, [ids, isFetchingNextPage, loadMoreFailed, restoration]);
  return onRetry;
}

type GridCardProps = {
  post: Post;
  index: number;
  cardIdPrefix: string;
  restoration: ListRestoration;
  onCardFocus: (index: number, view: HostView | null) => void;
  onCardPress?: (postId: string) => void;
  nowMs?: number;
  /** Mark pinned posts «Закреплено» (the Author page). */
  showPinned?: boolean;
};

/**
 * One card: a FocusZone item (Back, ← → zones) and a FocusRestoration item.
 * Memoized with stable props (the merged ref changes only with the id), so
 * a focus move or a page append does not re-render other cards.
 */
const GridCard = memo(function GridCardView({
  post,
  index,
  cardIdPrefix,
  restoration,
  onCardFocus,
  onCardPress,
  nowMs,
  showPinned,
}: GridCardProps) {
  const id = `${cardIdPrefix}${post.id}`;
  const zone = useZoneItem(id);
  const view = useRef<HostView | null>(null);
  const zoneRef = zone.ref;
  const itemRef = restoration.itemRef(id);
  const ref = useCallback(
    (next: HostView | null) => {
      view.current = next;
      zoneRef?.(next);
      itemRef(next);
    },
    [zoneRef, itemRef],
  );
  const onFocus = useCallback(() => {
    // Zone first (it remembers the id without an offset), then the list,
    // which remembers the id with its index and scroll offset.
    zone.onFocus();
    restoration.onItemFocus(id, index);
    onCardFocus(index, view.current);
  }, [zone, restoration, id, index, onCardFocus]);
  const postId = post.id;
  const onPress = useCallback(() => onCardPress?.(postId), [onCardPress, postId]);
  return (
    <PostCard
      ref={ref}
      testID={id}
      post={post}
      width={POST_GRID_CARD_WIDTH}
      nowMs={nowMs}
      showPinned={showPinned}
      onFocus={onFocus}
      onPress={onCardPress ? onPress : undefined}
      style={index % POST_GRID_COLUMNS === 0 ? styles.slot : styles.slotGap}
    />
  );
});

type GridRowProps = {
  row: PostRowItem;
  cardIdPrefix: string;
  restoration: ListRestoration;
  onCardFocus: (index: number, view: HostView | null) => void;
  onCardPress?: (postId: string) => void;
  nowMs?: number;
  /** Mark pinned posts «Закреплено» (the Author page). */
  showPinned?: boolean;
};

/** A row re-renders when its posts change; its memoized cards do not. */
const GridRow = memo(function GridRowView({
  row,
  cardIdPrefix,
  restoration,
  onCardFocus,
  onCardPress,
  nowMs,
  showPinned,
}: GridRowProps) {
  return (
    <View style={styles.row}>
      {row.posts.map((post, column) => (
        <GridCard
          // By column, not by post id: a recycled row (ADR 0011) reuses its
          // card instances for the new posts instead of remounting them.
          key={column}
          post={post}
          index={row.start + column}
          cardIdPrefix={cardIdPrefix}
          restoration={restoration}
          onCardFocus={onCardFocus}
          onCardPress={onCardPress}
          nowMs={nowMs}
          showPinned={showPinned}
        />
      ))}
    </View>
  );
});

type EndGuideHandle = { setTarget(view: HostView | null): void };

/**
 * A focus guide under the last row whose destination is the focused card:
 * ↓ from the last row (also while the next page loads) lands back on that
 * card instead of on Android's fallback (the first card). Only its own state
 * changes on a card focus.
 */
function EndGuide({ testID, ref }: { testID: string; ref?: Ref<EndGuideHandle> }) {
  const [target, setTarget] = useState<HostView | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      setTarget: next => setTarget(prev => (prev === next ? prev : next)),
    }),
    [],
  );
  const destinations = useMemo(() => (target ? [target] : []), [target]);
  return (
    <TVFocusGuideView testID={testID} destinations={destinations} style={styles.endGuide} />
  );
}

type FooterState = {
  loadMoreFailed: boolean;
  isFetchingNextPage: boolean;
  onRetry: () => void;
  endGuide: RefObject<EndGuideHandle | null>;
  testIDPrefix: string;
  retryId: string;
  loadMoreErrorLabel: string;
};

const FooterContext = createContext<FooterState | null>(null);

/**
 * The list footer: the retry row (B5) or a non-focusable spinner, then the
 * end guide. A stable component reading a context (not an element prop), so
 * the list's footer never remounts and the end guide keeps its target.
 */
function GridFooter() {
  const state = useContext(FooterContext);
  if (!state) {
    return null;
  }
  return (
    <View>
      {state.loadMoreFailed ? (
        <RetryRow
          busy={state.isFetchingNextPage}
          onRetry={state.onRetry}
          testID={`${state.testIDPrefix}/retry-row`}
          retryId={state.retryId}
          label={state.loadMoreErrorLabel}
        />
      ) : state.isFetchingNextPage ? (
        <View
          testID={`${state.testIDPrefix}/loading-more`}
          style={styles.loadingMore}
          focusable={false}
        >
          <Spinner color={colors['text-tertiary']} />
        </View>
      ) : null}
      <EndGuide ref={state.endGuide} testID={`${state.testIDPrefix}/end-guide`} />
    </View>
  );
}

type RetryRowProps = {
  busy: boolean;
  onRetry: () => void;
  testID: string;
  retryId: string;
  label: string;
};

/** B5: the inline load-more error row at the end of the grid. */
function RetryRow({ busy, onRetry, testID, retryId, label }: RetryRowProps) {
  const zone = useZoneItem(retryId);
  return (
    <View testID={testID} style={styles.retryRow}>
      <Text variant="body-s" color="text-secondary" accessibilityLiveRegion="polite">
        {label}
      </Text>
      <Button
        ref={zone.ref}
        testID={retryId}
        kind="secondary"
        size="small"
        label={t('common.retry')}
        busy={busy}
        onPress={onRetry}
        onFocus={zone.onFocus}
        style={styles.retryButton}
      />
    </View>
  );
}

export type PostGridProps = {
  posts: readonly Post[];
  height: number;
  restoration: ListRestoration;
  listRef: RefObject<FlashListRef<PostRowItem> | null>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreFailed: boolean;
  /** Fetch the next page (guarded by the caller's state). */
  onLoadMore: () => void;
  /** OK on «Повторить»: reload the failed page only. */
  onRetry: () => void;
  /** Row to open at (keep scroll on return); undefined: the top. */
  initialRow?: number;
  /** OK on a card (optional; a stable callback). */
  onCardPress?: (postId: string) => void;
  nowMs?: number;
  /** Mark pinned posts «Закреплено» (the Author page). */
  showPinned?: boolean;
  /** Card focus ids are `<cardIdPrefix><postId>` (e.g. `home/feed/`). */
  cardIdPrefix: string;
  /** The load-more «Повторить» focus id (e.g. `home/feed/retry`). */
  retryId: string;
  /** `<prefix>/list`, `/end-guide`, `/loading-more`, `/retry-row`. */
  testIDPrefix: string;
  /** The load-more error line, from the i18n catalog. */
  loadMoreErrorLabel: string;
};

/**
 * Load more: when a card of the last row gets focus, or when the list
 * nears its end. Never moves focus by itself.
 */
export function PostGrid({
  posts,
  height,
  restoration,
  listRef,
  hasNextPage,
  isFetchingNextPage,
  loadMoreFailed,
  onLoadMore,
  onRetry,
  initialRow,
  onCardPress,
  nowMs,
  showPinned,
  cardIdPrefix,
  retryId,
  testIDPrefix,
  loadMoreErrorLabel,
}: PostGridProps) {
  const canLoadMore = hasNextPage && !isFetchingNextPage && !loadMoreFailed;
  const state = useRef({ canLoadMore, count: posts.length, onLoadMore });
  state.current = { canLoadMore, count: posts.length, onLoadMore };

  const endGuide = useRef<EndGuideHandle>(null);

  const onCardFocus = useCallback((index: number, view: HostView | null) => {
    endGuide.current?.setTarget(view);
    const { canLoadMore: can, count, onLoadMore: load } = state.current;
    const lastRowStart = Math.floor((count - 1) / POST_GRID_COLUMNS) * POST_GRID_COLUMNS;
    if (can && index >= lastRowStart) {
      load();
    }
  }, []);

  const onEndReached = useCallback(() => {
    if (state.current.canLoadMore) {
      state.current.onLoadMore();
    }
  }, []);

  const rows = useMemo(() => postGridRows(posts), [posts]);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PostRowItem>) => (
      <GridRow
        row={item}
        cardIdPrefix={cardIdPrefix}
        restoration={restoration}
        onCardFocus={onCardFocus}
        onCardPress={onCardPress}
        nowMs={nowMs}
        showPinned={showPinned}
      />
    ),
    [cardIdPrefix, restoration, onCardFocus, onCardPress, nowMs, showPinned],
  );

  const footerState = useMemo<FooterState>(
    () => ({
      loadMoreFailed,
      isFetchingNextPage,
      onRetry,
      endGuide,
      testIDPrefix,
      retryId,
      loadMoreErrorLabel,
    }),
    [loadMoreFailed, isFetchingNextPage, onRetry, testIDPrefix, retryId, loadMoreErrorLabel],
  );

  return (
    <FooterContext.Provider value={footerState}>
      {/*
        FlashList (ADR 0011): rows are recycled instead of mounted, so a page
        arrival no longer creates every card's native views (device
        profiling: ≈ 37 ms of native work per mounted card). Items are rows
        of 3 keyed by their first post id, one item type, fixed height.
        `drawDistance` keeps about 3 rows ready beyond the viewport so on a
        fast ↓ the next row exists when Android's focus search runs; the
        recycle pool is bounded for the 2 GB device. `removeClippedSubviews`
        stays off (clipped views are unreachable to focus search).
      */}
      <FlashList
        ref={listRef}
        testID={`${testIDPrefix}/list`}
        style={[styles.list, { height }]}
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={keyOf}
        getItemType={rowType}
        renderItem={renderItem}
        onScroll={restoration.onScroll}
        scrollEventThrottle={100}
        onEndReached={onEndReached}
        onEndReachedThreshold={1}
        ListFooterComponent={GridFooter}
        initialScrollIndex={initialRow}
        drawDistance={POST_GRID_DRAW_DISTANCE}
        maxItemsInRecyclePool={POST_GRID_RECYCLE_POOL}
        removeClippedSubviews={false}
      />
    </FooterContext.Provider>
  );
}

const keyOf = (row: PostRowItem) => row.key;
const rowType = () => 'row';
/** About 3 rows beyond the viewport on each side (dp). */
export const POST_GRID_DRAW_DISTANCE = 3 * POST_GRID_ROW_HEIGHT;
/** Off-screen rows kept for reuse (about 2 viewports of rows). */
export const POST_GRID_RECYCLE_POOL = 6;

const styles = StyleSheet.create({
  list: {
    marginTop: POST_GRID_LIST_TOP_GAP,
    width: spacing['content-width'],
  },
  content: {
    paddingTop: CONTENT_TOP,
    paddingHorizontal: HEADROOM,
    paddingBottom: spacing['safe-y'],
  },
  // Fixed rows: getItemLayout assumes exactly POST_GRID_ROW_HEIGHT per row
  // (the slots' vertical padding makes the row gap).
  row: {
    flexDirection: 'row',
    height: POST_GRID_ROW_HEIGHT,
  },
  slot: {
    paddingVertical: POST_GRID_SLOT_PADDING,
  },
  slotGap: {
    paddingVertical: POST_GRID_SLOT_PADDING,
    marginLeft: spacing['card-gap-x'],
  },
  endGuide: {
    height: 1,
    width: spacing['content-width'] - 2 * HEADROOM,
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing['4'],
  },
  retryButton: {
    marginLeft: spacing['6'],
  },
  loadingMore: {
    paddingVertical: spacing['6'],
    alignItems: 'flex-start',
  },
});
