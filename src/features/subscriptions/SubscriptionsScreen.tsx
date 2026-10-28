import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HttpClient } from '../../shared/api';
import type { Author } from '../../shared/entities/author';
import {
  focusRestoration,
  mayTakeScreenFocus,
  restoreElseFirst,
  useFocusRestoration,
  useLatestRef,
  usePhaseChange,
  useZoneItem,
} from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
import {
  AuthorCardSkeleton,
  StateView,
  Text,
  requestHostFocus,
  spacing,
  typography,
  type HostView,
} from '../../shared/ui';
import {
  MY_BLOG_TILE_ID,
  SUBS_COLUMNS,
  SUBS_LIST_TOP_GAP,
  SUBS_TILE_WIDTH,
  SubscriptionsGrid,
  isSubsTileId,
  subsListAdapter,
  subsTileId,
  type SubsRowItem,
} from './SubscriptionsGrid';
import { useMyBlog, useSubscriptions } from './useSubscriptions';

/** The error StateView's single action (focus-map §1.5 `state/<screen>/action`). */
export const SUBS_STATE_ACTION_ID = 'state/subs/action';
/** FocusRestoration section of Подписки (the Shell's section id). */
export const SUBS_SECTION = 'subs';

const SKELETON_ROWS = 2;
const HEADER_HEIGHT = typography.section.lineHeight;

/** What the Shell tells Подписки about focus (it owns the zones). */
export type SubscriptionsFocusInfo = {
  /** The Shell is the focused route; a covered or closing Shell never takes focus. */
  isActive(): boolean;
  /** The last focused Shell element (sidebar or content id); null: none yet. */
  current(): string | null;
  /** Подписки's sidebar item (`nav/subs`). */
  sectionItemId: string;
  /** Focus Подписки's sidebar item (the last fallback of the grid). */
  focusSidebar(): void;
  /**
   * Registers how Подписки restores its content focus when the Shell is the
   * focused route again (Back from Автор): the tile by `blogUrl` with the
   * fallback chain. The function returns false when it did nothing (the
   * Shell then uses the zone's target). Returns the unregister function,
   * which clears the slot only while it still holds this registration.
   */
  setReturnFocus?(restore: () => boolean): () => void;
};

export type SubscriptionsScreenProps = {
  /** The active session's content client (from the Shell; never a singleton). */
  http: HttpClient;
  /** FocusRestoration route key (the Shell's). */
  routeKey: string;
  /** The section was opened with OK: take the content focus once content exists. */
  focusOnMount?: boolean;
  focus: SubscriptionsFocusInfo;
  /** OK on a tile: open the Author page (Story 3.3). */
  onOpenAuthor?: (blogUrl: string) => void;
  /**
   * `phaseFlags.myBlog` (AD-20, from the Shell; features cannot import
   * `app`). Off: no profile E1 and no «Мой блог» tile.
   */
  myBlogEnabled?: boolean;
};

type Phase = 'loading' | 'error' | 'empty' | 'grid';

/**
 * Подписки (Story 3.2, docs/focus-map.md §3 C1–C3): a 3-column AuthorCard
 * grid (FlashList, ADR 0011) fed by one E2 request.
 *
 * Focus:
 * - Skeleton: focus stays on the sidebar (`nav/subs`).
 * - When the tiles arrive, focus moves to them only if the user has not
 *   moved: focus is still on `nav/subs` (or unknown), or on the error
 *   StateView's «Повторить» that was just pressed. Tiles cached when the
 *   section opens (OK on «Подписки») take focus at once. The grid restores
 *   the remembered tile by `blogUrl` (FocusRestoration, fallback chain),
 *   else the first tile.
 * - Empty (C3): nothing is focusable; focus stays on the sidebar.
 * - Error: «Повторить» takes focus when the section was opened with OK and
 *   the user has not moved; a retry keeps focus on the busy button.
 * - OK on a tile opens Автор (Story 3.3); the tile is already remembered
 *   (FocusRestoration, by its focus). Back from Автор restores it by
 *   `blogUrl` with the fallback chain (neighbor by index → first tile →
 *   the sidebar item), at the same scroll.
 *
 * «Мой блог» (Story 5.2, focus-map §3 C): when the account's own blog has a
 * post, its tile (`subs/mine`, tinted label) is the first tile and
 * the initial focus: the skeleton stays until the check settles (E1, then
 * E3 and E4 page 1); a failure means no tile and no error. The own blog is
 * shown once: as «Мой блог», not again among the subscriptions. A tile that
 * arrives (or goes) later never moves focus off the focused tile.
 *
 * The response reached the E2 limit and `total > 30`: «Показаны первые N»
 * (N = tiles shown) next to the header, not focusable; no paging
 * (unverified, api-contract §5).
 */
export function SubscriptionsScreen({
  http,
  routeKey,
  focusOnMount = false,
  focus,
  onOpenAuthor,
  myBlogEnabled = false,
}: SubscriptionsScreenProps) {
  const subs = useSubscriptions(http);
  const myBlog = useMyBlog(http, myBlogEnabled);
  const mine = myBlog.author;
  // «Мой блог» first; the own blog is not repeated among the subscriptions.
  const authors = useMemo<Author[]>(
    () =>
      mine === null
        ? subs.authors
        : [mine, ...subs.authors.filter(a => a.blogUrl !== mine.blogUrl)],
    [mine, subs.authors],
  );
  const windowHeight = useWindowDimensions().height;
  // A bounded viewport (Story 2.4 device lesson): the content zone's height
  // (window − 2 × safe-y) minus the header and the grid's top gap.
  const listHeight = windowHeight - 2 * spacing['safe-y'] - HEADER_HEIGHT - SUBS_LIST_TOP_GAP;

  const listRef = useRef<FlashListRef<SubsRowItem>>(null);
  const adapterRef = useRef(subsListAdapter(listRef));
  const ids = useMemo(
    () =>
      authors.map((a, i) => (i === 0 && mine !== null ? MY_BLOG_TILE_ID : subsTileId(a.blogUrl))),
    [authors, mine],
  );
  // Scroll on return: mounted with cached tiles, the grid opens at the
  // remembered tile's row, so it is mounted when restoration focuses it.
  const [initialRow] = useState(() => {
    const index = focusRestoration.peek(routeKey, SUBS_SECTION)?.index;
    return ids.length > 0 && index !== undefined && index < ids.length
      ? Math.floor(index / SUBS_COLUMNS)
      : undefined;
  });

  const focusRef = useRef(focus);
  focusRef.current = focus;
  const stateAction = useZoneItem(SUBS_STATE_ACTION_ID);
  const stateActionView = useRef<HostView | null>(null);
  const stateActionRef = useCallback(
    (view: HostView | null) => {
      stateActionView.current = view;
      stateAction.ref?.(view);
    },
    [stateAction],
  );
  // Nothing above the grid («Мой блог» is a grid tile, not a row above
  // it): the StateView action when shown, else give up to the sidebar item.
  const focusAbove = useCallback(() => {
    if (stateActionView.current) {
      requestHostFocus(stateActionView.current);
    } else {
      focusRef.current.focusSidebar();
    }
  }, []);
  // A pending tile focus lands only while the Shell is active and focus is
  // still where Подписки may take it: none yet, `nav/subs`, a tile or the
  // StateView action. A move elsewhere drops it.
  const canFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive()) {
      return false;
    }
    const current = info.current();
    return (
      current === null ||
      current === info.sectionItemId ||
      current === SUBS_STATE_ACTION_ID ||
      isSubsTileId(current)
    );
  }, []);

  const restoration = useFocusRestoration({
    routeKey,
    sectionId: SUBS_SECTION,
    ids,
    listRef: adapterRef,
    focusAbove,
    canFocus,
  });
  /**
   * A restore or initial focus was started and no tile has had focus since:
   * a data change meanwhile must re-resolve the target (the awaited tile may
   * be gone). Cleared by the first tile focus.
   */
  const focusPending = useRef(false);
  const gridRestoration = useMemo(
    () => ({
      ...restoration,
      onItemFocus: (id: string, index: number) => {
        focusPending.current = false;
        restoration.onItemFocus(id, index);
      },
    }),
    [restoration],
  );
  const restoreOrFirst = useCallback(() => {
    focusPending.current = true;
    restoreElseFirst(restoration);
  }, [restoration]);

  // «Мой блог» holds the skeleton only on the first load (E2 not cached when
  // Подписки mounted) and only until Подписки first settles, so a shown tile
  // is the initial focus. A mount over a cached grid, or a later check (a
  // `blogUrl` that appears, a refetch), never shows the skeleton: the tile
  // just arrives without moving focus.
  const [firstLoad] = useState(() => subs.isPending);
  const [settled, setSettled] = useState(false);
  const nowSettled = !subs.isPending && !myBlog.isPending;
  useEffect(() => {
    if (nowSettled) {
      setSettled(true);
    }
  }, [nowSettled]);
  const holdForMyBlog = firstLoad && !settled && myBlog.isPending;

  const phase: Phase = subs.isPending
    ? 'loading'
    : subs.error !== null
      ? 'error'
      : holdForMyBlog
        ? 'loading'
        : authors.length === 0
          ? 'empty'
          : 'grid';

  const pendingMountFocus = useRef(focusOnMount);
  /** The user has not moved focus away from where Подписки may take it. */
  const mayTakeFocus = useCallback(
    () => mayTakeScreenFocus(focusRef.current, SUBS_STATE_ACTION_ID),
    [],
  );

  usePhaseChange(phase, (_phase, previous) => {
    if (phase === 'loading') {
      return;
    }
    const mountFocus = pendingMountFocus.current;
    pendingMountFocus.current = false;
    const info = focusRef.current;
    if (phase === 'grid') {
      if (previous === null ? mountFocus && mayTakeFocus() : mayTakeFocus()) {
        restoreOrFirst();
      } else if (previous === null) {
        // Cached tiles, focus stays on the sidebar: only the scroll returns.
        const offset = focusRestoration.peek(routeKey, SUBS_SECTION)?.scrollOffset;
        if (offset !== undefined && offset > 0) {
          listRef.current?.scrollToOffset({ offset, animated: false });
        }
      }
    } else if (phase === 'error') {
      if (
        (mountFocus && mayTakeFocus()) ||
        (info.isActive() && info.current() === SUBS_STATE_ACTION_ID)
      ) {
        requestHostFocus(stateActionView.current);
      }
    } else {
      focusPending.current = false;
      const current = info.current();
      if (
        info.isActive() &&
        current !== null &&
        (current === SUBS_STATE_ACTION_ID || isSubsTileId(current))
      ) {
        // Empty while the error action or a tile had focus (a retry, or a
        // background refetch that emptied the grid): that view is gone and
        // C3 has nothing focusable, so focus goes to the sidebar item.
        info.focusSidebar();
      }
    }
  });

  // Blur or unmount: stop a pending restore focus.
  useEffect(() => restoration.cancel, [restoration]);

  // Return from Автор (the Shell is focused again with focus in content):
  // the remembered tile by `blogUrl`, else the fallback chain. Only the grid
  // restores this way; the error action and the sidebar use the zone.
  const phaseRef = useLatestRef(phase);
  useEffect(() => {
    const info = focusRef.current;
    const unregister = info.setReturnFocus?.(() => {
      if (phaseRef.current !== 'grid') {
        return false;
      }
      restoreOrFirst();
      return true;
    });
    return () => unregister?.();
  }, [restoreOrFirst, phaseRef]);

  const onOpenRef = useRef(onOpenAuthor);
  onOpenRef.current = onOpenAuthor;
  const onOpenTile = useCallback((blogUrl: string) => onOpenRef.current?.(blogUrl), []);

  // A background refetch (a remount after `staleTime`) changed the tiles
  // other than by an append: the rows regroup and may remount (rows are
  // keyed by their first `blogUrl`), so a focused tile would lose native
  // focus. The trigger is that change of the ids, never frame timing. A
  // focused tile that is still shown is scrolled into view at its new index
  // and focused again; a tile that is gone follows the fallback chain.
  //
  // «Мой блог» and the own blog's plain tile are the same tile: when the
  // focused plain tile is deduped by an arriving «Мой блог» (or «Мой блог»
  // goes while the blog is still a subscription), focus moves to the other
  // id of that blog instead of a neighbour.
  const lastIds = useRef(ids);
  const ownBlogUrl = mine?.blogUrl ?? null;
  const lastOwnBlogUrl = useRef(ownBlogUrl);
  useLayoutEffect(() => {
    const previous = lastIds.current;
    lastIds.current = ids;
    const previousOwn = lastOwnBlogUrl.current;
    lastOwnBlogUrl.current = ownBlogUrl;
    if (previous.length === 0 || ids.length === 0 || previous === ids) {
      return;
    }
    const appended = ids.length >= previous.length && previous.every((id, i) => ids[i] === id);
    if (appended) {
      return;
    }
    if (!canFocus()) {
      return;
    }
    const focused = focusRef.current.current();
    if (focused === null || !isSubsTileId(focused)) {
      // A restore still waiting for its tile: re-resolve it against the new
      // ids (the awaited tile may be gone).
      if (focusPending.current) {
        restoreOrFirst();
      }
      return;
    }
    let target = focused;
    if (!ids.includes(focused)) {
      if (focused === MY_BLOG_TILE_ID && previousOwn !== null) {
        target = subsTileId(previousOwn);
      } else if (ownBlogUrl !== null && focused === subsTileId(ownBlogUrl)) {
        target = MY_BLOG_TILE_ID;
      }
    }
    const index = ids.indexOf(target);
    if (index < 0) {
      restoreOrFirst();
      return;
    }
    const before = previous.indexOf(focused);
    const rowStart = (i: number) => i - (i % SUBS_COLUMNS);
    if (
      target === focused &&
      before === index &&
      previous[rowStart(before)] === ids[rowStart(index)]
    ) {
      // Same index, same row key: the tile's row did not remount.
      return;
    }
    if (before !== index) {
      adapterRef.current.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
    }
    restoration.focusItem(target);
  }, [ids, ownBlogUrl, canFocus, restoration, restoreOrFirst]);

  return (
    <View testID="subs" style={styles.root}>
      <View style={styles.header}>
        <Text variant="section" accessibilityRole="header">
          {t('subs.title')}
        </Text>
        {phase === 'grid' && subs.truncated ? (
          <Text
            testID="subs/first-only"
            variant="body-s"
            color="text-tertiary"
            style={styles.note}
          >
            {tf('subs.firstOnly', { n: String(subs.authors.length) })}
          </Text>
        ) : null}
      </View>
      {phase === 'loading' ? (
        <View
          testID="subs/skeleton"
          style={styles.skeleton}
          accessible
          accessibilityLabel={t('subs.loading')}
        >
          {Array.from({ length: SKELETON_ROWS }, (_, row) => (
            <View key={row} style={styles.skeletonRow}>
              {Array.from({ length: SUBS_COLUMNS }, (__, column) => (
                <AuthorCardSkeleton
                  key={column}
                  width={SUBS_TILE_WIDTH}
                  style={column > 0 ? styles.columnGap : undefined}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {phase === 'error' && subs.error !== null ? (
        <View testID="subs/error" style={styles.state}>
          <StateView
            title={t('subs.errorTitle')}
            body={t(`error.${subs.error}`)}
            action={{
              label: t('common.retry'),
              onPress: subs.refetch,
              busy: subs.isFetching,
              testID: SUBS_STATE_ACTION_ID,
              ref: stateActionRef,
              onFocus: stateAction.onFocus,
            }}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'empty' ? (
        <View testID="subs/empty" style={styles.state}>
          <StateView
            title={t('subs.emptyTitle')}
            body={t('subs.emptyBody')}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'grid' ? (
        <SubscriptionsGrid
          authors={authors}
          firstIsMyBlog={mine !== null}
          height={listHeight}
          restoration={gridRestoration}
          listRef={listRef}
          initialRow={initialRow}
          onOpen={onOpenTile}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'baseline',
    marginHorizontal: spacing['focus-headroom'],
  },
  note: {
    marginLeft: spacing['9'],
  },
  skeleton: {
    marginTop: spacing['8'],
    paddingHorizontal: spacing['focus-headroom'],
  },
  skeletonRow: {
    flexDirection: 'row',
    marginBottom: spacing['author-tile-gap'],
  },
  columnGap: {
    marginLeft: spacing['author-tile-gap'],
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
