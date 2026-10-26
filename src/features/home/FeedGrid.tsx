import {
  createContext,
  memo,
  useCallback,
  useContext,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import {
  StyleSheet,
  TVFocusGuideView,
  View,
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import type { Post } from '../../shared/entities/post';
import {
  useZoneItem,
  type ListRestoration,
  type RestorableList,
} from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  Button,
  PostCard,
  Spinner,
  Text,
  colors,
  postCardHeight,
  postCardWidth,
  spacing,
  type HostView,
} from '../../shared/ui';

/** Focus ids (docs/focus-map.md §1.5). */
export const FEED_CARD_PREFIX = 'home/feed/';
export const FEED_RETRY_ID = 'home/feed/retry';
export const feedCardId = (postId: string) => `${FEED_CARD_PREFIX}${postId}`;

/** Owner decision 2026-10-26 (device review): 3 columns (also the Author grid). */
export const FEED_COLUMNS = 3;
/**
 * The grid keeps `focus-headroom` on both sides of the 720 dp content for
 * the focus scale (1.06) and ring: (720 − 2 × 12 − 2 × 16) / 3 = 221.
 */
export const FEED_CARD_WIDTH = postCardWidth(
  spacing['content-width'],
  FEED_COLUMNS,
);
export const FEED_CARD_HEIGHT = postCardHeight(FEED_CARD_WIDTH);
export const FEED_ROW_HEIGHT = FEED_CARD_HEIGHT + spacing['card-gap-y'];
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
export const FEED_SLOT_PADDING = spacing['card-gap-y'] / 2;
/** Content top padding: the first card still starts `HEADROOM` below the list top. */
const CONTENT_TOP = HEADROOM - FEED_SLOT_PADDING;
/** The header-to-first-row gap is `8` (16); the list's top headroom gives 12 of it. */
export const FEED_LIST_TOP_GAP = spacing['8'] - HEADROOM;

/** One grid row: up to `FEED_COLUMNS` posts. The list's items are rows. */
export type FeedRowItem = {
  key: string;
  posts: readonly Post[];
  start: number;
};

/**
 * The posts the grid shows. While more pages may come, a trailing partial
 * row is held back (shown with the next page): E5 pages are 10 posts, so
 * with 3 columns the last row would be 1 card wide, and a fast ↓ that
 * outran the next page moved focus into it, i.e. into column 1 (Story 3.1
 * device run, adb). Without it, ↓ from the last full row hits the end guide
 * and keeps the column. Fewer than 3 posts are all shown; on the last page
 * (`hasNextPage` false) everything is shown.
 */
export function visibleFeedPosts(posts: readonly Post[], hasNextPage: boolean): readonly Post[] {
  const partial = posts.length % FEED_COLUMNS;
  return hasNextPage && partial > 0 && posts.length > FEED_COLUMNS
    ? posts.slice(0, posts.length - partial)
    : posts;
}

/**
 * Rows keyed by their first post id. FlatList's `numColumns` keys a row by
 * all its item keys, so the partial last row ([9] → [9, 10, 11]) changed
 * its key when a page arrived and remounted, focused card included (focus
 * fell back to the first card). A first-post key keeps the row mounted.
 */
export function feedRows(posts: readonly Post[]): FeedRowItem[] {
  const rows: FeedRowItem[] = [];
  for (let start = 0; start < posts.length; start += FEED_COLUMNS) {
    const slice = posts.slice(start, start + FEED_COLUMNS);
    rows.push({ key: slice[0].id, posts: slice, start });
  }
  return rows;
}

/**
 * Row geometry. FlashList measures rows (all rows have this fixed height);
 * kept as the `getItemLayout` of the FlatList rollback (ADR 0011).
 */
export function feedRowLayout(_data: unknown, rowIndex: number) {
  return {
    length: FEED_ROW_HEIGHT,
    offset: CONTENT_TOP + FEED_ROW_HEIGHT * rowIndex,
    index: rowIndex,
  };
}

/** FocusRestoration speaks item indexes; the grid scrolls by row. */
export function gridListAdapter(list: {
  current: FlashListRef<FeedRowItem> | null;
}): RestorableList {
  return {
    scrollToOffset: params => list.current?.scrollToOffset(params),
    scrollToIndex: ({ index, ...rest }) => {
      Promise.resolve(
        list.current?.scrollToIndex({ ...rest, index: Math.floor(index / FEED_COLUMNS) }),
      ).catch(() => {});
    },
  };
}

type FeedCardProps = {
  post: Post;
  index: number;
  restoration: ListRestoration;
  onCardFocus: (index: number, view: HostView | null) => void;
  nowMs?: number;
};

/**
 * One card: a FocusZone item (Back, ← → zones) and a FocusRestoration item.
 * Memoized with stable props (the merged ref changes only with the id), so
 * a focus move or a page append does not re-render other cards.
 */
const FeedCard = memo(function FeedCardView({
  post,
  index,
  restoration,
  onCardFocus,
  nowMs,
}: FeedCardProps) {
  const id = feedCardId(post.id);
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
      width={FEED_CARD_WIDTH}
      nowMs={nowMs}
      onFocus={onFocus}
      style={index % FEED_COLUMNS === 0 ? styles.slot : styles.slotGap}
    />
  );
});

type FeedRowProps = {
  row: FeedRowItem;
  restoration: ListRestoration;
  onCardFocus: (index: number, view: HostView | null) => void;
  nowMs?: number;
};

/** A row re-renders when its posts change; its memoized cards do not. */
const FeedRow = memo(function FeedRowView({
  row,
  restoration,
  onCardFocus,
  nowMs,
}: FeedRowProps) {
  return (
    <View style={styles.row}>
      {row.posts.map((post, column) => (
        <FeedCard
          // By column, not by post id: a recycled row (ADR 0011) reuses its
          // card instances for the new posts instead of remounting them.
          key={column}
          post={post}
          index={row.start + column}
          restoration={restoration}
          onCardFocus={onCardFocus}
          nowMs={nowMs}
        />
      ))}
    </View>
  );
});

export type EndGuideHandle = { setTarget(view: HostView | null): void };

/**
 * A focus guide under the last row whose destination is the focused card:
 * ↓ from the last row (also while the next page loads) lands back on that
 * card instead of on Android's fallback (the first card). Only its own state
 * changes on a card focus.
 */
function EndGuide({ ref }: { ref?: Ref<EndGuideHandle> }) {
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
    <TVFocusGuideView
      testID="home/feed/end-guide"
      destinations={destinations}
      style={styles.endGuide}
    />
  );
}

type FooterState = {
  loadMoreFailed: boolean;
  isFetchingNextPage: boolean;
  onRetry: () => void;
  endGuide: RefObject<EndGuideHandle | null>;
};

const FooterContext = createContext<FooterState | null>(null);

/**
 * The list footer: the retry row (B5) or a non-focusable spinner, then the
 * end guide. A stable component reading a context (not an element prop), so
 * the list's footer never remounts and the end guide keeps its target.
 */
function FeedFooter() {
  const state = useContext(FooterContext);
  if (!state) {
    return null;
  }
  return (
    <View>
      {state.loadMoreFailed ? (
        <RetryRow busy={state.isFetchingNextPage} onRetry={state.onRetry} />
      ) : state.isFetchingNextPage ? (
        <View
          testID="home/feed/loading-more"
          style={styles.loadingMore}
          focusable={false}
        >
          <Spinner color={colors['text-tertiary']} />
        </View>
      ) : null}
      <EndGuide ref={state.endGuide} />
    </View>
  );
}

type RetryRowProps = { busy: boolean; onRetry: () => void };

/** B5: the inline load-more error row at the end of the grid. */
function RetryRow({ busy, onRetry }: RetryRowProps) {
  const zone = useZoneItem(FEED_RETRY_ID);
  return (
    <View testID="home/feed/retry-row" style={styles.retryRow}>
      <Text
        variant="body-s"
        color="text-secondary"
        accessibilityLiveRegion="polite"
      >
        {t('home.feed.loadMoreError')}
      </Text>
      <Button
        ref={zone.ref}
        testID={FEED_RETRY_ID}
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

export type FeedGridProps = {
  posts: readonly Post[];
  height: number;
  restoration: ListRestoration;
  listRef: RefObject<FlashListRef<FeedRowItem> | null>;
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
};

/**
 * The «Новое в подписках» grid: a recycling FlashList (ADR 0011) of rows
 * of 3 cards keyed by the first post id, fixed row height, a bounded
 * viewport height (Story 2.4 device lesson) and focus headroom on every
 * side.
 *
 * Load more: when a card of the last row gets focus, or when the list
 * nears its end. Never moves focus by itself.
 */
export function FeedGrid({
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
}: FeedGridProps) {
  const canLoadMore = hasNextPage && !isFetchingNextPage && !loadMoreFailed;
  const state = useRef({ canLoadMore, count: posts.length, onLoadMore });
  state.current = { canLoadMore, count: posts.length, onLoadMore };

  const endGuide = useRef<EndGuideHandle>(null);

  const onCardFocus = useCallback((index: number, view: HostView | null) => {
    endGuide.current?.setTarget(view);
    const { canLoadMore: can, count, onLoadMore: load } = state.current;
    const lastRowStart = Math.floor((count - 1) / FEED_COLUMNS) * FEED_COLUMNS;
    if (can && index >= lastRowStart) {
      load();
    }
  }, []);

  const onEndReached = useCallback(() => {
    if (state.current.canLoadMore) {
      state.current.onLoadMore();
    }
  }, []);

  const rows = useMemo(() => feedRows(posts), [posts]);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FeedRowItem>) => (
      <FeedRow
        row={item}
        restoration={restoration}
        onCardFocus={onCardFocus}
        nowMs={nowMs}
      />
    ),
    [restoration, onCardFocus, nowMs],
  );

  const footerState = useMemo<FooterState>(
    () => ({ loadMoreFailed, isFetchingNextPage, onRetry, endGuide }),
    [loadMoreFailed, isFetchingNextPage, onRetry],
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
        testID="home/feed/list"
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
        ListFooterComponent={FeedFooter}
        initialScrollIndex={initialRow}
        drawDistance={FEED_DRAW_DISTANCE}
        maxItemsInRecyclePool={FEED_RECYCLE_POOL}
        removeClippedSubviews={false}
      />
    </FooterContext.Provider>
  );
}

const keyOf = (row: FeedRowItem) => row.key;
const rowType = () => 'row';
/** About 3 rows beyond the viewport on each side (dp). */
export const FEED_DRAW_DISTANCE = 3 * FEED_ROW_HEIGHT;
/** Off-screen rows kept for reuse (about 2 viewports of rows). */
export const FEED_RECYCLE_POOL = 6;

const styles = StyleSheet.create({
  list: {
    marginTop: FEED_LIST_TOP_GAP,
    width: spacing['content-width'],
  },
  content: {
    paddingTop: CONTENT_TOP,
    paddingHorizontal: HEADROOM,
    paddingBottom: spacing['safe-y'],
  },
  // Fixed rows: getItemLayout assumes exactly FEED_ROW_HEIGHT per row (the
  // slots' vertical padding makes the row gap).
  row: {
    flexDirection: 'row',
    height: FEED_ROW_HEIGHT,
  },
  slot: {
    paddingVertical: FEED_SLOT_PADDING,
  },
  slotGap: {
    paddingVertical: FEED_SLOT_PADDING,
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
