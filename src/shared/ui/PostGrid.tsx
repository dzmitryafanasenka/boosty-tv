import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
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
  nowMs?: number;
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
  nowMs,
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
  return (
    <PostCard
      ref={ref}
      testID={id}
      post={post}
      width={POST_GRID_CARD_WIDTH}
      nowMs={nowMs}
      onFocus={onFocus}
      style={index % POST_GRID_COLUMNS === 0 ? styles.slot : styles.slotGap}
    />
  );
});

type GridRowProps = {
  row: PostRowItem;
  cardIdPrefix: string;
  restoration: ListRestoration;
  onCardFocus: (index: number, view: HostView | null) => void;
  nowMs?: number;
};

/** A row re-renders when its posts change; its memoized cards do not. */
const GridRow = memo(function GridRowView({
  row,
  cardIdPrefix,
  restoration,
  onCardFocus,
  nowMs,
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
          nowMs={nowMs}
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
  nowMs?: number;
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
  nowMs,
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
        nowMs={nowMs}
      />
    ),
    [cardIdPrefix, restoration, onCardFocus, nowMs],
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
