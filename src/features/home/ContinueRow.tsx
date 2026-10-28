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
};

/** A FocusZone item (Back, ← → zones) and a FocusRestoration item (route key + `home`). */
const RowCard = memo(function RowCardView({
  item,
  index,
  restoration,
  onCardFocus,
  onCardView,
  onCardPress,
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
      style={index === 0 ? styles.slot : styles.slotNext}
    />
  );
});

export type ContinueRowProps = {
  items: readonly ContinueItem[];
  restoration: ListRestoration;
  /** OK on a card (by focus id). */
  onCardPress: (id: string) => void;
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
export function ContinueRow({ items, restoration, onCardPress }: ContinueRowProps) {
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
  // Cards came or went (refs attach before effects): a gone remembered card
  // is replaced by its neighbour by id (the same card Главная focuses),
  // else the first one.
  const ids = items.map(item => item.id).join('\n');
  const lastIds = useRef(ids);
  useEffect(() => {
    const previous = lastIds.current.length > 0 ? lastIds.current.split('\n') : [];
    lastIds.current = ids;
    const current = ids.length > 0 ? ids.split('\n') : [];
    const id = remembered.current;
    if (id !== null && !current.includes(id)) {
      remembered.current = continueNeighbour(previous, id, current);
    }
    pickTarget();
  }, [ids, pickTarget]);

  const destinations = useMemo(() => (target ? [target] : []), [target]);

  return (
    <View testID="home/continue">
      <Text variant="section" accessibilityRole="header" style={styles.title}>
        {t('home.continue.title')}
      </Text>
      <TVFocusGuideView testID="home/continue/guide" destinations={destinations}>
        <ScrollView
          testID="home/continue/row"
          horizontal
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
            />
          ))}
        </ScrollView>
      </TVFocusGuideView>
    </View>
  );
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
