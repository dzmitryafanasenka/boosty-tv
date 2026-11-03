import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TVFocusGuideView, View } from 'react-native';
import { useZoneItem, type ListRestoration } from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
import {
  AuthorAvatar,
  FocusableSurface,
  Text,
  colors,
  components,
  spacing,
  type HostView,
  type SurfaceState,
} from '../../shared/ui';
import type { LivePlaqueItem } from './livePlaque';

/** Focus ids (docs/focus-map.md §1.5): `home/live/<blogUrl>`. */
export const LIVE_PLAQUE_PREFIX = 'home/live/';
export const livePlaqueId = (blogUrl: string) => `${LIVE_PLAQUE_PREFIX}${blogUrl}`;

const TOKENS = components['live-plaque'];
const BADGE = components.badge;
const HEADROOM = spacing['focus-headroom'];
/** Room above and below the plaques for the row scale and the ring. */
const FOCUS_ROOM = spacing['3'];
/** The gap under the row (to «Продолжить просмотр» or the feed's title row). */
const ROW_BOTTOM_GAP = spacing['4'];
/** The whole block the row takes (for Главная's bounded list height). */
export const LIVE_PLAQUE_ROW_HEIGHT = TOKENS.height + 2 * FOCUS_ROOM + ROW_BOTTOM_GAP;

/** The visible title: the stream's, else «Эфир без названия». */
export function livePlaqueTitle(item: Pick<LivePlaqueItem, 'title'>): string {
  return item.title.length > 0 ? item.title : t('home.live.untitled');
}

/** «<имя> в эфире: <название>». */
export function livePlaqueA11yLabel(item: LivePlaqueItem): string {
  return tf('home.live.a11y', { name: item.name, title: livePlaqueTitle(item) });
}

type PlaqueProps = {
  item: LivePlaqueItem;
  index: number;
  restoration: ListRestoration;
  onPlaqueFocus: (id: string, view: HostView | null) => void;
  onPlaqueView: (id: string, view: HostView | null) => void;
  onPress: (id: string) => void;
};

/** One plaque: a FocusZone item (Back → `nav/home`) and a FocusRestoration item. */
const Plaque = memo(function PlaqueView({ item, index, restoration, onPlaqueFocus, onPlaqueView, onPress }: PlaqueProps) {
  const id = livePlaqueId(item.blogUrl);
  const zone = useZoneItem(id);
  const view = useRef<HostView | null>(null);
  const zoneRef = zone.ref;
  const itemRef = restoration.itemRef(id);
  const ref = useCallback(
    (next: HostView | null) => {
      view.current = next;
      zoneRef?.(next);
      itemRef(next);
      onPlaqueView(id, next);
    },
    [zoneRef, itemRef, onPlaqueView, id],
  );
  const onFocus = useCallback(() => {
    zone.onFocus();
    restoration.onItemFocus(id, index);
    onPlaqueFocus(id, view.current);
  }, [zone, restoration, id, index, onPlaqueFocus]);
  const press = useCallback(() => onPress(id), [onPress, id]);
  const surfaceStyle = useCallback(
    ({ focused }: SurfaceState) => [styles.surface, { backgroundColor: focused ? TOKENS.bgFocus : TOKENS.bg }],
    [],
  );
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      resetKey={id}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      accessibilityRole="button"
      accessibilityLabel={livePlaqueA11yLabel(item)}
      onFocus={onFocus}
      onPress={press}
      style={index === 0 ? undefined : styles.next}
      surfaceStyle={surfaceStyle}
    >
      {({ focused }) => (
        <>
          <AuthorAvatar url={item.avatarUrl} size={TOKENS.avatar} testID={`${id}/avatar`} />
          <View style={styles.text}>
            <View style={styles.firstLine}>
              <Text testID={`${id}/badge`} variant="badge" numberOfLines={1} style={styles.badge}>
                {t('home.live.badge')}
              </Text>
              <Text testID={`${id}/name`} variant="card-title" color="text-card" numberOfLines={1} style={styles.name}>
                {item.name}
              </Text>
            </View>
            <Text
              testID={`${id}/title`}
              variant="body-s"
              color={focused ? 'text-secondary' : 'text-meta'}
              numberOfLines={1}
              style={styles.title}
            >
              {livePlaqueTitle(item)}
            </Text>
          </View>
        </>
      )}
    </FocusableSurface>
  );
});

export type LivePlaqueRowProps = {
  items: readonly LivePlaqueItem[];
  restoration: ListRestoration;
  /** OK on a plaque (by focus id). */
  onPress: (id: string) => void;
  /** In the grid's list header (with «Продолжить просмотр»): the list's headroom padding applies. */
  inList: boolean;
};

/**
 * DESIGN.md LivePlaque (Story 12.3, IMP-03, docs/focus-map.md §3 B): one
 * plaque per subscribed author who is live now, in E2 order, in a
 * horizontally scrolling row above «Продолжить просмотр» (or above the
 * feed's title row without it). The row is a `TVFocusGuideView` whose
 * destination is the last focused plaque (else the first), so ↑ from the
 * row below lands on it; ← → move natively inside the row. Not rendered
 * when nobody is live.
 */
export function LivePlaqueRow({ items, restoration, onPress, inList }: LivePlaqueRowProps) {
  const views = useRef(new Map<string, HostView>());
  const remembered = useRef<string | null>(null);
  const [target, setTarget] = useState<HostView | null>(null);
  const targetRef = useRef<HostView | null>(null);
  const firstId = items[0] ? livePlaqueId(items[0].blogUrl) : undefined;
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
  const onPlaqueView = useCallback((id: string, view: HostView | null) => {
    if (view) {
      views.current.set(id, view);
    } else {
      views.current.delete(id);
    }
  }, []);
  const onPlaqueFocus = useCallback((id: string, view: HostView | null) => {
    remembered.current = id;
    if (view && view !== targetRef.current) {
      targetRef.current = view;
      setTarget(view);
    }
  }, []);
  // Plaques came or went (refs attach before effects): a gone remembered
  // plaque gives way to the first one.
  const ids = items.map(item => livePlaqueId(item.blogUrl)).join('\n');
  useEffect(() => {
    if (remembered.current !== null && !ids.split('\n').includes(remembered.current)) {
      remembered.current = null;
    }
    pickTarget();
  }, [ids, pickTarget]);
  const destinations = useMemo(() => (target ? [target] : []), [target]);

  return (
    <TVFocusGuideView
      testID="home/live"
      destinations={destinations}
      style={inList ? styles.blockInList : styles.block}
    >
      <ScrollView
        testID="home/live/row"
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.row}
        contentContainerStyle={styles.rowContent}
      >
        {items.map((item, index) => (
          <Plaque
            key={item.blogUrl}
            item={item}
            index={index}
            restoration={restoration}
            onPlaqueFocus={onPlaqueFocus}
            onPlaqueView={onPlaqueView}
            onPress={onPress}
          />
        ))}
      </ScrollView>
    </TVFocusGuideView>
  );
}

const styles = StyleSheet.create({
  // The list's content has `focus-headroom` padding: in the list header the
  // row spans the whole 720 dp content, as the Continue row does.
  blockInList: {
    marginHorizontal: -HEADROOM,
    marginBottom: ROW_BOTTOM_GAP,
    width: spacing['content-width'],
  },
  block: {
    marginBottom: ROW_BOTTOM_GAP,
    width: spacing['content-width'],
  },
  row: {
    width: spacing['content-width'],
  },
  rowContent: {
    paddingHorizontal: HEADROOM,
    paddingVertical: FOCUS_ROOM,
  },
  next: {
    marginLeft: spacing['card-gap-x'],
  },
  // No `overflow` or `opacity`: the ring is a child of this view.
  surface: {
    width: TOKENS.width,
    height: TOKENS.height,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing['6'],
  },
  text: {
    flex: 1,
    marginLeft: spacing['6'],
    justifyContent: 'center',
  },
  firstLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    ...BADGE.text,
    height: BADGE.height,
    lineHeight: BADGE.height,
    textAlignVertical: 'center',
    borderRadius: BADGE.radius,
    paddingHorizontal: spacing['3'],
    color: colors.text,
    backgroundColor: TOKENS.badge,
    overflow: 'hidden',
  },
  name: {
    flexShrink: 1,
    marginLeft: spacing['4'],
  },
  title: {
    marginTop: spacing['2'],
  },
});
