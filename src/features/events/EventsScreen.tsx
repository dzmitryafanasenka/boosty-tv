import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import type { HttpClient } from '../../shared/api';
import type { Event } from '../../shared/entities/event';
import {
  focusRestoration,
  mayTakeScreenFocus,
  useFocusRestoration,
  useLatestRef,
  usePhaseChange,
  useZoneItem,
  type ListRestoration,
  type RestorableList,
} from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  StateView,
  Text,
  components,
  requestHostFocus,
  spacing,
  typography,
  type HostView,
} from '../../shared/ui';
import { eventReadMarksStore } from './eventReadMarks';
import { EventRow, EventRowSkeleton } from './EventRow';
import { useEvents } from './useEvents';

/** FocusRestoration section of События (the Shell's section id). */
export const EVENTS_SECTION = 'events';
/** Focus ids (docs/focus-map.md §1.5). */
export const EVENTS_ROW_PREFIX = 'events/row/';
export const eventRowId = (eventId: string) => `${EVENTS_ROW_PREFIX}${eventId}`;
/** The StateView action: «Повторить» (error) or «Обновить» (empty). */
export const EVENTS_STATE_ACTION_ID = 'state/events/action';

const TOKENS = components['event-row'];
const SKELETON_ROWS = 5;
const HEADER_HEIGHT = typography.section.lineHeight;
const HEADROOM = spacing['focus-headroom'];
/** The gap between rows; each row's slot carries half of it above and below. */
const ROW_GAP = spacing['5'];
const SLOT_PADDING = ROW_GAP / 2;
/** One list item: the row and its slot padding (fixed height, ADR 0011). */
export const EVENTS_ITEM_HEIGHT = TOKENS.height + ROW_GAP;
/** The header-to-first-row gap is `8` (16); the list's top headroom gives 12 of it. */
const LIST_TOP_GAP = spacing['8'] - HEADROOM;
/** About 3 screens of rows beyond the viewport (dp). */
const DRAW_DISTANCE = 3 * 8 * EVENTS_ITEM_HEIGHT;
const RECYCLE_POOL = 12;

/** What the Shell tells События about focus (it owns the zones). */
export type EventsFocusInfo = {
  /** The Shell is the focused route; a covered or closing Shell never takes focus. */
  isActive(): boolean;
  /** The last focused Shell element (sidebar or content id); null: none yet. */
  current(): string | null;
  /** События' sidebar item (`nav/events`). */
  sectionItemId: string;
  /** Focus События' sidebar item (the last fallback). */
  focusSidebar(): void;
  /**
   * Registers how События restores its content focus when the Shell is the
   * focused route again (Back from Автор): the row by event id, else the
   * first row. Returns the unregister function.
   */
  setReturnFocus?(restore: () => boolean): () => void;
};

export type EventsScreenProps = {
  /** The active session's content client (from the Shell; never a singleton). */
  http: HttpClient;
  /** FocusRestoration route key (the Shell's). */
  routeKey: string;
  /** The section was opened with OK: take the content focus once content exists. */
  focusOnMount?: boolean;
  focus: EventsFocusInfo;
  /** OK on a row with a blog: open the Author page; returns whether it navigated. */
  onOpenAuthor?: (blogUrl: string) => boolean;
  /** Test clock for the rows' time. */
  nowMs?: number;
};

type Phase = 'loading' | 'error' | 'empty' | 'list';

const isRowId = (id: string | null): id is string => id !== null && id.startsWith(EVENTS_ROW_PREFIX);

/** FocusRestoration speaks item indexes; the list's items are the rows. */
function listAdapter(list: RefObject<FlashListRef<Event> | null>): RestorableList {
  return {
    scrollToOffset: params => list.current?.scrollToOffset(params),
    scrollToIndex: params => {
      Promise.resolve(list.current?.scrollToIndex(params)).catch(() => {});
    },
  };
}

type ItemProps = {
  event: Event;
  index: number;
  restoration: ListRestoration;
  onOpen: (eventId: string) => void;
  nowMs?: number;
};

/** One row: a FocusZone item (Back, ← → zones) and a FocusRestoration item. */
const EventItem = memo(function EventItemView({ event, index, restoration, onOpen, nowMs }: ItemProps) {
  const id = eventRowId(event.id);
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const itemRef = restoration.itemRef(id);
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      itemRef(view);
    },
    [zoneRef, itemRef],
  );
  const onFocus = useCallback(() => {
    zone.onFocus();
    restoration.onItemFocus(id, index);
  }, [zone, restoration, id, index]);
  return (
    <View style={styles.slot}>
      <EventRow ref={ref} testID={id} event={event} onFocus={onFocus} onPress={onOpen} nowMs={nowMs} />
    </View>
  );
});

/**
 * События (Story 7.5, EVT-01, docs/focus-map.md §5 J): the account's
 * recent events (E18, one request, no paging) as a FlashList of EventRows
 * (ADR 0011), newest first.
 *
 * Focus:
 * - Skeleton: focus stays on the sidebar (`nav/events`).
 * - Rows arrive: the first row takes focus when the section was opened with
 *   OK and the user has not moved (focus still on `nav/events`, nothing, or
 *   the StateView action just pressed). A return or a reopen restores the
 *   remembered row by event id, else the first row. ↑ ↓ between rows; ←
 *   to the sidebar (the content zone).
 * - Empty: «Событий нет» with «Обновить» (owner decision Q2 a); error: the
 *   error with «Повторить». The action takes focus under the same rule;
 *   pressing it refetches and keeps focus on the busy button.
 * - OK on a row with a blog: the row is marked read locally (this app run
 *   only, no request), then Автор opens with section `events`. A row with
 *   no valid blog does nothing. Back from Автор: the same row by id.
 */
export function EventsScreen({ http, routeKey, focusOnMount = false, focus, onOpenAuthor, nowMs }: EventsScreenProps) {
  const data = useEvents(http);
  const events = data.events;
  const windowHeight = useWindowDimensions().height;
  // A bounded viewport (Story 2.4 device lesson): the content zone's height
  // minus the header and the list's top gap.
  const listHeight = windowHeight - 2 * spacing['safe-y'] - HEADER_HEIGHT - LIST_TOP_GAP;

  const listRef = useRef<FlashListRef<Event>>(null);
  const adapterRef = useRef(listAdapter(listRef));
  const ids = useMemo(() => events.map(e => eventRowId(e.id)), [events]);
  // Scroll on return: mounted with cached rows, the list opens at the
  // remembered row, so it is mounted when restoration focuses it.
  const [initialIndex] = useState(() => {
    const remembered = focusRestoration.peek(routeKey, EVENTS_SECTION)?.focusId;
    const index = remembered === undefined ? -1 : ids.indexOf(remembered);
    return index > 0 ? index : undefined;
  });

  const focusRef = useLatestRef(focus);
  const stateAction = useZoneItem(EVENTS_STATE_ACTION_ID);
  const stateActionView = useRef<HostView | null>(null);
  const stateActionRef = useCallback(
    (view: HostView | null) => {
      stateActionView.current = view;
      stateAction.ref?.(view);
    },
    [stateAction],
  );
  const focusAbove = useCallback(() => {
    if (stateActionView.current) {
      requestHostFocus(stateActionView.current);
    } else {
      focusRef.current.focusSidebar();
    }
  }, [focusRef]);
  // A pending row focus lands only while the Shell is active and focus is
  // still where События may take it: none yet, `nav/events`, a row or the
  // StateView action.
  const canFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive()) {
      return false;
    }
    const current = info.current();
    return (
      current === null || current === info.sectionItemId || current === EVENTS_STATE_ACTION_ID || isRowId(current)
    );
  }, [focusRef]);

  const restoration = useFocusRestoration({
    routeKey,
    sectionId: EVENTS_SECTION,
    ids,
    listRef: adapterRef,
    focusAbove,
    canFocus,
  });
  const idsRef = useLatestRef(ids);
  /** The remembered row by event id when it is still listed, else the first row (spec: no neighbour fallback). */
  const restoreOrFirst = useCallback(() => {
    const remembered = focusRestoration.peek(routeKey, EVENTS_SECTION)?.focusId;
    if (remembered !== undefined && idsRef.current.includes(remembered)) {
      restoration.restore();
      return;
    }
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    restoration.focusInitial();
  }, [restoration, routeKey, idsRef]);

  const phase: Phase = data.isPending
    ? 'loading'
    : data.error !== null
      ? 'error'
      : events.length === 0
        ? 'empty'
        : 'list';

  const pendingMountFocus = useRef(focusOnMount);
  const mayTakeFocus = useCallback(
    () => mayTakeScreenFocus(focusRef.current, EVENTS_STATE_ACTION_ID),
    [focusRef],
  );

  usePhaseChange(phase, (_phase, previous) => {
    if (phase === 'loading') {
      return;
    }
    const mountFocus = pendingMountFocus.current;
    pendingMountFocus.current = false;
    const info = focusRef.current;
    if (phase === 'list') {
      if (previous === null ? mountFocus && mayTakeFocus() : mayTakeFocus()) {
        restoreOrFirst();
      } else if (previous === null) {
        // Cached rows, focus stays on the sidebar: only the scroll returns.
        const offset = focusRestoration.peek(routeKey, EVENTS_SECTION)?.scrollOffset;
        if (offset !== undefined && offset > 0) {
          listRef.current?.scrollToOffset({ offset, animated: false });
        }
      }
      return;
    }
    // Error or empty: the StateView action, when the section was opened with
    // OK and the user has not moved, or when the action (or a row that is now
    // gone) had focus.
    const current = info.current();
    if (
      (mountFocus && mayTakeFocus()) ||
      (info.isActive() && (current === EVENTS_STATE_ACTION_ID || isRowId(current)))
    ) {
      requestHostFocus(stateActionView.current);
    }
  });

  // Blur or unmount: stop a pending restore focus.
  useEffect(() => restoration.cancel, [restoration]);

  // Return from Автор (the Shell is focused again with focus in content):
  // the remembered row by id, else the first row. Only the list restores
  // this way; the StateView action and the sidebar use the zone.
  const phaseRef = useLatestRef(phase);
  useEffect(() => {
    const unregister = focusRef.current.setReturnFocus?.(() => {
      if (phaseRef.current !== 'list') {
        return false;
      }
      restoreOrFirst();
      return true;
    });
    return () => unregister?.();
  }, [restoreOrFirst, phaseRef, focusRef]);

  // A background refetch changed the rows other than by an append: a
  // focused row that is still listed is scrolled to its new index and
  // focused again; a row that is gone gives focus to the first row. The
  // trigger is the id change, never frame timing.
  const lastIds = useRef(ids);
  useLayoutEffect(() => {
    const previous = lastIds.current;
    lastIds.current = ids;
    if (previous.length === 0 || ids.length === 0 || previous === ids) {
      return;
    }
    const focused = focusRef.current.current();
    if (!canFocus() || !isRowId(focused)) {
      return;
    }
    const index = ids.indexOf(focused);
    if (index < 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      restoration.focusInitial();
      return;
    }
    if (previous.indexOf(focused) !== index) {
      adapterRef.current.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
      restoration.focusItem(focused);
    }
  }, [ids, canFocus, restoration, focusRef]);

  const eventsRef = useLatestRef(events);
  const onOpenRef = useLatestRef(onOpenAuthor);
  const onOpenRow = useCallback(
    (eventId: string) => {
      const event = eventsRef.current.find(e => e.id === eventId);
      if (!event || event.blogUrl === null) {
        return;
      }
      // Marked read only when Автор really opens (a press during a
      // transition is dropped by the app and must not hide the dot).
      if (onOpenRef.current?.(event.blogUrl) === true) {
        eventReadMarksStore.getState().mark(event.id);
      }
    },
    [eventsRef, onOpenRef],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Event>) => (
      <EventItem event={item} index={index} restoration={restoration} onOpen={onOpenRow} nowMs={nowMs} />
    ),
    [restoration, onOpenRow, nowMs],
  );

  return (
    <View testID="events" style={styles.root}>
      <View style={styles.header}>
        <Text variant="section" accessibilityRole="header">
          {t('events.title')}
        </Text>
      </View>
      {phase === 'loading' ? (
        <View testID="events/skeleton" style={styles.skeleton} accessible accessibilityLabel={t('events.loading')}>
          {Array.from({ length: SKELETON_ROWS }, (_, row) => (
            <View key={row} style={styles.slot}>
              <EventRowSkeleton />
            </View>
          ))}
        </View>
      ) : null}
      {phase === 'error' && data.error !== null ? (
        <View testID="events/error" style={styles.state}>
          <StateView
            title={t('events.errorTitle')}
            body={t(`error.${data.error}`)}
            action={{
              label: t('common.retry'),
              onPress: data.refetch,
              busy: data.isFetching,
              testID: EVENTS_STATE_ACTION_ID,
              ref: stateActionRef,
              onFocus: stateAction.onFocus,
            }}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'empty' ? (
        <View testID="events/empty" style={styles.state}>
          <StateView
            title={t('events.emptyTitle')}
            body={t('events.emptyBody')}
            action={{
              label: t('events.refresh'),
              onPress: data.refetch,
              busy: data.isFetching,
              testID: EVENTS_STATE_ACTION_ID,
              ref: stateActionRef,
              onFocus: stateAction.onFocus,
            }}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'list' ? (
        <FlashList
          ref={listRef}
          testID="events/list"
          style={[styles.list, { height: listHeight }]}
          contentContainerStyle={styles.content}
          data={events}
          keyExtractor={keyOf}
          getItemType={rowType}
          renderItem={renderItem}
          onScroll={restoration.onScroll}
          scrollEventThrottle={100}
          initialScrollIndex={initialIndex}
          drawDistance={DRAW_DISTANCE}
          maxItemsInRecyclePool={RECYCLE_POOL}
          removeClippedSubviews={false}
        />
      ) : null}
    </View>
  );
}

const keyOf = (event: Event) => event.id;
const rowType = () => 'row';

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'baseline',
    marginHorizontal: HEADROOM,
  },
  skeleton: {
    marginTop: spacing['8'],
    paddingHorizontal: HEADROOM,
  },
  list: {
    marginTop: LIST_TOP_GAP,
    width: spacing['content-width'],
  },
  content: {
    paddingTop: HEADROOM - SLOT_PADDING,
    paddingHorizontal: HEADROOM,
    paddingBottom: HEADROOM - SLOT_PADDING,
  },
  slot: {
    height: EVENTS_ITEM_HEIGHT,
    paddingVertical: SLOT_PADDING,
  },
  state: {
    flex: 1,
    justifyContent: 'center',
  },
  // Focus headroom: the scaled button and its ring stay inside the content.
  withAction: {
    paddingHorizontal: HEADROOM,
  },
});
