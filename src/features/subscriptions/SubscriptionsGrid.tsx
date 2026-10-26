import { memo, useCallback, useMemo, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import type { Author } from '../../shared/entities/author';
import {
  useZoneItem,
  type ListRestoration,
  type RestorableList,
} from '../../shared/focus';
import {
  AUTHOR_CARD_HEIGHT,
  AuthorCard,
  authorCardWidth,
  spacing,
  type HostView,
} from '../../shared/ui';

/** Focus ids (docs/focus-map.md §1.5). */
export const SUBS_TILE_PREFIX = 'subs/tile/';
export const subsTileId = (blogUrl: string) => `${SUBS_TILE_PREFIX}${blogUrl}`;

/** Owner decision 2026-10-26: 3 columns (as the feed). */
export const SUBS_COLUMNS = 3;
/**
 * The grid keeps `focus-headroom` on both sides of the 720 dp content for
 * the focus scale (1.05) and ring: (720 − 2 × 12 − 2 × 12) / 3 = 224.
 */
export const SUBS_TILE_WIDTH = authorCardWidth(spacing['content-width'], SUBS_COLUMNS);
const ROW_GAP = spacing['author-tile-gap'];
/**
 * Every tile's focusable view carries half the row gap as vertical padding
 * (6 above, 6 below): Android's native focus scroll puts the focused view's
 * rectangle flush with the list edge, and the padding keeps the 1.05 scale
 * (≈ 2 dp) and the ring (4 dp) visible (as `FEED_SLOT_PADDING`, Story 3.1).
 * No JS scroll runs on focus.
 */
export const SUBS_SLOT_PADDING = ROW_GAP / 2;
export const SUBS_ROW_HEIGHT = AUTHOR_CARD_HEIGHT + ROW_GAP;
const HEADROOM = spacing['focus-headroom'];
/** Content top padding: the first tile still starts `HEADROOM` below the list top. */
const CONTENT_TOP = HEADROOM - SUBS_SLOT_PADDING;
/** The header-to-first-row gap is `8` (16); the list's top headroom gives 12 of it. */
export const SUBS_LIST_TOP_GAP = spacing['8'] - HEADROOM;

/** One grid row: up to `SUBS_COLUMNS` authors. The list's items are rows. */
export type SubsRowItem = {
  key: string;
  authors: readonly Author[];
  start: number;
};

/**
 * Rows keyed by their first `blogUrl` (ADR 0011: one item type, fixed row
 * height). E2 is one request, so the last row is never held back.
 */
export function subsRows(authors: readonly Author[]): SubsRowItem[] {
  const rows: SubsRowItem[] = [];
  for (let start = 0; start < authors.length; start += SUBS_COLUMNS) {
    const slice = authors.slice(start, start + SUBS_COLUMNS);
    rows.push({ key: slice[0].blogUrl, authors: slice, start });
  }
  return rows;
}

/** FocusRestoration speaks item indexes; the grid scrolls by row. */
export function subsListAdapter(list: {
  current: FlashListRef<SubsRowItem> | null;
}): RestorableList {
  return {
    scrollToOffset: params => list.current?.scrollToOffset(params),
    scrollToIndex: ({ index, ...rest }) => {
      Promise.resolve(
        list.current?.scrollToIndex({ ...rest, index: Math.floor(index / SUBS_COLUMNS) }),
      ).catch(() => {});
    },
  };
}

type TileProps = {
  author: Author;
  index: number;
  restoration: ListRestoration;
};

/**
 * One tile: a FocusZone item (Back, ← → zones) and a FocusRestoration item.
 * Memoized with stable props, so a focus move re-renders only the two
 * tiles' focus state. OK does nothing until Story 3.3 (Автор).
 */
const SubsTile = memo(function SubsTileView({ author, index, restoration }: TileProps) {
  const id = subsTileId(author.blogUrl);
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const itemRef = restoration.itemRef(id);
  const ref = useCallback(
    (next: HostView | null) => {
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
  }, [zone, restoration, id, index]);
  return (
    <AuthorCard
      ref={ref}
      testID={id}
      author={author}
      width={SUBS_TILE_WIDTH}
      onFocus={onFocus}
      style={index % SUBS_COLUMNS === 0 ? styles.slot : styles.slotGap}
    />
  );
});

type RowProps = { row: SubsRowItem; restoration: ListRestoration };

const SubsRow = memo(function SubsRowView({ row, restoration }: RowProps) {
  return (
    <View style={styles.row}>
      {row.authors.map((author, column) => (
        <SubsTile
          // By column, not by blogUrl: a recycled row (ADR 0011) reuses its
          // tile instances for the new authors instead of remounting them.
          key={column}
          author={author}
          index={row.start + column}
          restoration={restoration}
        />
      ))}
    </View>
  );
});

export type SubscriptionsGridProps = {
  authors: readonly Author[];
  height: number;
  restoration: ListRestoration;
  listRef: RefObject<FlashListRef<SubsRowItem> | null>;
  /** Row to open at (scroll on return); undefined: the top. */
  initialRow?: number;
};

/**
 * The Подписки grid: a recycling FlashList (ADR 0011) of rows of 3 tiles
 * keyed by the first `blogUrl`, fixed row height, a bounded viewport height
 * (Story 2.4 device lesson) and focus headroom on every side. ↓ from the
 * last row is held by the content zone's down trap (no paging, so no end
 * guide is needed).
 */
export function SubscriptionsGrid({
  authors,
  height,
  restoration,
  listRef,
  initialRow,
}: SubscriptionsGridProps) {
  const rows = useMemo(() => subsRows(authors), [authors]);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SubsRowItem>) => (
      <SubsRow row={item} restoration={restoration} />
    ),
    [restoration],
  );
  return (
    <FlashList
      ref={listRef}
      testID="subs/list"
      style={[styles.list, { height }]}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={keyOf}
      getItemType={rowType}
      renderItem={renderItem}
      onScroll={restoration.onScroll}
      scrollEventThrottle={100}
      initialScrollIndex={initialRow}
      drawDistance={SUBS_DRAW_DISTANCE}
      maxItemsInRecyclePool={SUBS_RECYCLE_POOL}
      removeClippedSubviews={false}
    />
  );
}

const keyOf = (row: SubsRowItem) => row.key;
const rowType = () => 'row';
/** About 3 rows beyond the viewport on each side (dp). */
export const SUBS_DRAW_DISTANCE = 3 * SUBS_ROW_HEIGHT;
/** Off-screen rows kept for reuse. */
export const SUBS_RECYCLE_POOL = 6;

const styles = StyleSheet.create({
  list: {
    marginTop: SUBS_LIST_TOP_GAP,
    width: spacing['content-width'],
  },
  content: {
    paddingTop: CONTENT_TOP,
    paddingHorizontal: HEADROOM,
    // The viewport already ends at the content's bottom inset: below the
    // last row only the same headroom as above the first (12 with the
    // slot padding), enough for the focused tile's scale and ring.
    paddingBottom: CONTENT_TOP,
  },
  row: {
    flexDirection: 'row',
    height: SUBS_ROW_HEIGHT,
  },
  slot: {
    paddingVertical: SUBS_SLOT_PADDING,
  },
  slotGap: {
    paddingVertical: SUBS_SLOT_PADDING,
    marginLeft: spacing['author-tile-gap'],
  },
});
