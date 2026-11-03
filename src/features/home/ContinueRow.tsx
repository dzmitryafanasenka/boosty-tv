import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TVFocusGuideView, View } from 'react-native';
import type { MediaRef } from '../../shared/entities/post';
import { useZoneItem, type ListRestoration } from '../../shared/focus';
import { t } from '../../shared/i18n';
import type { ProgressStatus } from '../../shared/services/progress';
import {
  ContinueCard,
  POST_GRID_CARD_WIDTH,
  POST_GRID_COLUMNS,
  POST_GRID_SLOT_PADDING,
  Text,
  spacing,
  typography,
  type HostView,
} from '../../shared/ui';
import { CONTINUE_CLEAR_ID, ContinueClearTile } from './ContinueClearTile';

/** Focus ids (docs/focus-map.md §1.5): `home/continue/<mediaId>`. */
export const CONTINUE_CARD_PREFIX = 'home/continue/';
export const continueCardId = (mediaId: string) => `${CONTINUE_CARD_PREFIX}${mediaId}`;

/**
 * The card that takes the place of `gone` (no longer in `ids`): in the
 * `previous` order, the next card that still exists, else the previous
 * one; null when none is left (or `gone` was not in `previous`, then the
 * first card).
 */
export function continueNeighbour(
  previous: readonly string[],
  gone: string,
  ids: readonly string[],
): string | null {
  const at = previous.indexOf(gone);
  if (at < 0) {
    return ids[0] ?? null;
  }
  const kept = new Set(ids);
  for (let i = at + 1; i < previous.length; i += 1) {
    if (kept.has(previous[i])) {
      return previous[i];
    }
  }
  for (let i = at - 1; i >= 0; i -= 1) {
    if (kept.has(previous[i])) {
      return previous[i];
    }
  }
  return null;
}

/** One «Продолжить просмотр» card (Story 4.7): ids and display data only. */
export type ContinueItem = {
  /** The focus id (`home/continue/<mediaId>`). */
  id: string;
  ref: MediaRef;
  title: string;
  authorName: string;
  previewUrl: string | null;
  status: ProgressStatus;
};

const WIDTH = POST_GRID_CARD_WIDTH;
const GAP = spacing['card-gap-x'];
const HEADROOM = spacing['focus-headroom'];
/**
 * Column alignment with the feed grid (owner decision 2026-10-28: the same
 * card size, 3 visible, the columns line up). Android's horizontal
 * ScrollView scrolls a newly focused child's rectangle flush with its edge
 * (no JS scroll on focus, as in the grid). Each card's focusable view
 * therefore carries `PAD_LEFT` / `PAD_RIGHT` so that, flush at the left
 * edge, the card sits on column 1 (x = headroom) and, flush at the right
 * edge, on column 3: 720 − 12 − 3 × 221 − 2 × 16 = 13. The padded views
 * overlap by the difference (negative margin), the visible gap stays 16.
 * The padding also leaves room for the focus scale and ring.
 */
const PAD_LEFT = HEADROOM;
const PAD_RIGHT =
  spacing['content-width'] - HEADROOM - POST_GRID_COLUMNS * WIDTH - (POST_GRID_COLUMNS - 1) * GAP;
const OVERLAP = GAP - PAD_LEFT - PAD_RIGHT;

type CardProps = {
  item: ContinueItem;
  index: number;
  restoration: ListRestoration;
  onCardFocus: (id: string, view: HostView | null) => void;
  onCardView: (id: string, view: HostView | null) => void;
  onCardPress: (id: string) => void;
  onCardLongPress?: (id: string) => void;
};

/** A FocusZone item (Back, ← → zones) and a FocusRestoration item (route key + `home`). */
const RowCard = memo(function RowCardView({
  item,
  index,
  restoration,
  onCardFocus,
  onCardView,
  onCardPress,
  onCardLongPress,
}: CardProps) {
  const { id } = item;
  const zone = useZoneItem(id);
  const view = useRef<HostView | null>(null);
  const zoneRef = zone.ref;
  const itemRef = restoration.itemRef(id);
  const ref = useCallback(
    (next: HostView | null) => {
      view.current = next;
      zoneRef?.(next);
      itemRef(next);
      onCardView(id, next);
    },
    [zoneRef, itemRef, onCardView, id],
  );
  const onFocus = useCallback(() => {
    // Zone first (no offset), then the list (the index in the row and the
    // grid's scroll offset): the neighbour fallback uses that index.
    zone.onFocus();
    restoration.onItemFocus(id, index);
    onCardFocus(id, view.current);
  }, [zone, restoration, id, index, onCardFocus]);
  const onPress = useCallback(() => onCardPress(id), [onCardPress, id]);
  const onLongPress = useCallback(() => onCardLongPress?.(id), [onCardLongPress, id]);
  return (
    <ContinueCard
      ref={ref}
      testID={id}
      resetKey={id}
      title={item.title}
      authorName={item.authorName}
      previewUrl={item.previewUrl}
      status={item.status}
      width={WIDTH}
      onFocus={onFocus}
      onPress={onPress}
      onLongPress={onCardLongPress ? onLongPress : undefined}
      style={index === 0 ? styles.slot : styles.slotNext}
    />
  );
});

type ClearProps = {
  /** The tile's index in the row (after the last card). */
  index: number;
  restoration: ListRestoration;
  onCardFocus: (id: string, view: HostView | null) => void;
  onCardView: (id: string, view: HostView | null) => void;
  onPress: () => void;
};

/**
 * «Очистить всё» (Story 12.1): a FocusZone item and a FocusRestoration item
 * like a card (Back → `nav/home`; its index is the row's length), and a
 * row-guide candidate (↑ from the feed returns to it when it was last).
 */
const RowClearTile = memo(function RowClearTileView({
  index,
  restoration,
  onCardFocus,
  onCardView,
  onPress,
}: ClearProps) {
  const zone = useZoneItem(CONTINUE_CLEAR_ID);
  const view = useRef<HostView | null>(null);
  const zoneRef = zone.ref;
  const itemRef = restoration.itemRef(CONTINUE_CLEAR_ID);
  const ref = useCallback(
    (next: HostView | null) => {
      view.current = next;
      zoneRef?.(next);
      itemRef(next);
      onCardView(CONTINUE_CLEAR_ID, next);
    },
    [zoneRef, itemRef, onCardView],
  );
  const onFocus = useCallback(() => {
    zone.onFocus();
    restoration.onItemFocus(CONTINUE_CLEAR_ID, index);
    onCardFocus(CONTINUE_CLEAR_ID, view.current);
  }, [zone, restoration, index, onCardFocus]);
  return (
    <ContinueClearTile
      ref={ref}
      width={WIDTH}
      onFocus={onFocus}
      onPress={onPress}
      style={styles.slotNext}
    />
  );
});

export type ContinueRowProps = {
  items: readonly ContinueItem[];
  /**
   * The card Главная restores at mount (Story 9.4): the row opens scrolled
   * so it is in view, flush on column 3 as Android's own focus scroll leaves
   * it. A card in the first three needs no scroll.
   */
  initialCardId?: string;
  restoration: ListRestoration;
  /** OK on a card (by focus id). */
  onCardPress: (id: string) => void;
  /** A long OK on a card (Story 12.1, by focus id). */
  onCardLongPress?: (id: string) => void;
  /** OK on «Очистить всё» (Story 12.1); absent: no tile. */
  onClearAll?: () => void;
};

/**
 * «Продолжить просмотр · на этом устройстве» (Story 4.7, docs/focus-map.md
 * §3 B): the section title and one horizontally scrolling row of
 * ContinueCards above the feed grid (the grid's list header). The row is a
 * `TVFocusGuideView` whose destination is the last focused card (else the
 * first), so ↑ from the first feed row lands on it; ← → move natively
 * inside the row and scroll it; ↓ lands natively on the grid card in the
 * same column (the columns line up).
 */
export function ContinueRow({
  items,
  initialCardId,
  restoration,
  onCardPress,
  onCardLongPress,
  onClearAll,
}: ContinueRowProps) {
  const views = useRef(new Map<string, HostView>());
  const remembered = useRef<string | null>(null);
  const [target, setTarget] = useState<HostView | null>(null);
  const targetRef = useRef<HostView | null>(null);
  const firstId = items[0]?.id;
  const firstIdRef = useRef(firstId);
  firstIdRef.current = firstId;

  const pickTarget = useCallback(() => {
    const id = remembered.current;
    const next =
      (id !== null ? views.current.get(id) : undefined) ??
      (firstIdRef.current !== undefined ? views.current.get(firstIdRef.current) : undefined) ??
      null;
    if (next !== targetRef.current) {
      targetRef.current = next;
      setTarget(next);
    }
  }, []);

  const onCardView = useCallback(
    (id: string, view: HostView | null) => {
      if (view) {
        views.current.set(id, view);
      } else {
        views.current.delete(id);
      }
    },
    [],
  );
  const onCardFocus = useCallback(
    (id: string, view: HostView | null) => {
      remembered.current = id;
      if (view && view !== targetRef.current) {
        targetRef.current = view;
        setTarget(view);
      }
    },
    [],
  );
  // «Очистить всё» (Story 12.1) is the row's last stop while it has cards.
  const clearAll = items.length > 0 ? onClearAll : undefined;
  // Cards came or went (refs attach before effects): a gone remembered card
  // is replaced by its neighbour by id (the same card Главная focuses),
  // else the first one.
  const ids = [...items.map(item => item.id), ...(clearAll ? [CONTINUE_CLEAR_ID] : [])].join('\n');
  const lastIds = useRef(ids);
  useEffect(() => {
    const previous = lastIds.current.length > 0 ? lastIds.current.split('\n') : [];
    lastIds.current = ids;
    const current = ids.length > 0 ? ids.split('\n') : [];
    const id = remembered.current;
    if (id !== null && !current.includes(id)) {
      // Among the cards only (the tile is never a removed card's neighbour).
      const cards = (list: string[]) => list.filter(cardId => cardId !== CONTINUE_CLEAR_ID);
      remembered.current = continueNeighbour(cards(previous), id, cards(current));
    }
    pickTarget();
  }, [ids, pickTarget]);

  const destinations = useMemo(() => (target ? [target] : []), [target]);
  // Read once at mount: a later change of `items` never scrolls the row.
  const [contentOffset] = useState(() => ({ x: continueRowOffset(items, initialCardId), y: 0 }));

  return (
    <View testID="home/continue">
      <Text variant="section" accessibilityRole="header" style={styles.title}>
        {t('home.continue.title')}
      </Text>
      <TVFocusGuideView testID="home/continue/guide" destinations={destinations}>
        <ScrollView
          testID="home/continue/row"
          horizontal
          contentOffset={contentOffset}
          showsHorizontalScrollIndicator={false}
          style={styles.row}
          contentContainerStyle={styles.rowContent}
        >
          {items.map((item, index) => (
            <RowCard
              key={item.id}
              item={item}
              index={index}
              restoration={restoration}
              onCardFocus={onCardFocus}
              onCardView={onCardView}
              onCardPress={onCardPress}
              onCardLongPress={onCardLongPress}
            />
          ))}
          {clearAll ? (
            <RowClearTile
              index={items.length}
              restoration={restoration}
              onCardFocus={onCardFocus}
              onCardView={onCardView}
              onPress={clearAll}
            />
          ) : null}
        </ScrollView>
      </TVFocusGuideView>
    </View>
  );
}

/**
 * The row's start offset that shows `cardId` (a card or «Очистить всё») flush on the last visible
 * column (0 when it is among the first `POST_GRID_COLUMNS` or not in the row).
 * Each card's padded view advances by one column step (`WIDTH + GAP`).
 */
export function continueRowOffset(items: readonly ContinueItem[], cardId: string | undefined): number {
  // «Очистить всё» (Story 12.1) follows the last card.
  const index =
    cardId === undefined
      ? -1
      : cardId === CONTINUE_CLEAR_ID
        ? items.length
        : items.findIndex(item => item.id === cardId);
  return Math.max(0, index - (POST_GRID_COLUMNS - 1)) * (WIDTH + GAP);
}

/** The header's height above the feed title (for layout checks). */
export const CONTINUE_TITLE_HEIGHT = typography.section.lineHeight;

const styles = StyleSheet.create({
  title: {
    height: CONTINUE_TITLE_HEIGHT,
  },
  // The list's content has `focus-headroom` padding: the row spans the whole
  // 720 dp content so the padded cards line up with the grid's columns.
  row: {
    marginHorizontal: -HEADROOM,
    marginTop: spacing['8'] - POST_GRID_SLOT_PADDING,
    width: spacing['content-width'],
  },
  rowContent: {
    paddingLeft: HEADROOM - PAD_LEFT,
  },
  slot: {
    paddingLeft: PAD_LEFT,
    paddingRight: PAD_RIGHT,
    paddingVertical: POST_GRID_SLOT_PADDING,
  },
  slotNext: {
    paddingLeft: PAD_LEFT,
    paddingRight: PAD_RIGHT,
    paddingVertical: POST_GRID_SLOT_PADDING,
    marginLeft: OVERLAP,
  },
});
