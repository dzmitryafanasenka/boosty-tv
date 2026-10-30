import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, TVFocusGuideView, View, useWindowDimensions } from 'react-native';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  DEFAULT_FILTER,
  FilterSheet,
  chipLabels,
  filtersStore,
  isDefaultFilter,
  useFilter,
} from '../../shared/filters';
import {
  focusRestoration,
  restoreElseFirst,
  useFocusRestoration,
  useLatestRef,
  useModal,
  useOutcomeFocus,
  usePhaseChange,
  useZoneItem,
} from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  FilterChip,
  POST_GRID_CARD_WIDTH,
  POST_GRID_COLUMNS,
  POST_GRID_LIST_TOP_GAP,
  PostCardSkeleton,
  PostGrid,
  StateView,
  Text,
  TextField,
  components,
  postGridListAdapter,
  requestHostFocus,
  spacing,
  typography,
  useHeadChangeRefocus,
  useHeldRowAutoFetch,
  useLoadMoreRetry,
  useShownGridPosts,
  type HostView,
  type PostRowItem,
} from '../../shared/ui';
import { searchQueryStore, useSubmittedQuery } from './searchQueryStore';
import { submitFeedSearch, useFeedSearch } from './useFeedSearch';

/** FocusRestoration section of Поиск (the Shell's section id). */
export const SEARCH_SECTION = 'search';
/** Focus ids (docs/focus-map.md §1.5, §4 E). */
export const SEARCH_FIELD_ID = 'search/field';
export const SEARCH_FILTERS_ID = 'search/action/filters';
export const SEARCH_RESULT_PREFIX = 'search/result/';
export const searchResultId = (postId: string) => `${SEARCH_RESULT_PREFIX}${postId}`;
/** «Повторить» of the full error state (E6 page 1 failed). */
export const SEARCH_RETRY_ID = 'search/retry';
/** «Сбросить фильтры» of the filtered «Ничего не найдено». */
export const SEARCH_RESET_FILTERS_ID = 'search/reset-filters';
/** The inline load-more «Повторить» at the end of the grid. */
export const SEARCH_LOAD_MORE_RETRY_ID = 'search/results/retry';

const SKELETON_ROWS = 2;
/** The outcome waits through the skeleton and the hint; the hint drops it. */
const OUTCOME_WAIT_PHASES: readonly Phase[] = ['loading', 'hint'];
const OUTCOME_DROP_PHASES: readonly Phase[] = ['hint'];
const FIELD = components['text-field'];
/** The field row: the label above the 50 dp field, and a little room under it. */
const FIELD_ROW_HEIGHT = typography['body-s'].lineHeight + spacing['4'] + FIELD.height + spacing['2'];
const FIELD_WIDTH = 440;

/** What the Shell tells Поиск about focus (it owns the zones). */
export type SearchFocusInfo = {
  /** The Shell is the focused route; a covered or closing Shell never takes focus. */
  isActive(): boolean;
  /** The last focused Shell element (sidebar or content id); null: none yet. */
  current(): string | null;
  /** Поиск's sidebar item (`nav/search`). */
  sectionItemId: string;
  /** Listen to the Shell's focus events (the same ids as `current()`); returns the unsubscribe. */
  onFocusChange(listener: (focusId: string) => void): () => void;
  /**
   * Registers how Поиск restores its content focus when the Shell is the
   * focused route again (Back from Пост): the result card by id with the
   * fallback chain (neighbor → first result → the field). Returns the
   * unregister function.
   */
  setReturnFocus?(restore: () => boolean): () => void;
};

export type SearchScreenProps = {
  /** The active session's content client (from the Shell; never a singleton). */
  http: HttpClient;
  /** FocusRestoration route key (the Shell's). */
  routeKey: string;
  /** The section was opened with OK: the field takes focus. */
  focusOnMount?: boolean;
  focus: SearchFocusInfo;
  /** OK on a result: open Пост by its identity. */
  onOpenPost?: (blogUrl: string, postId: string) => void;
  /** `phaseFlags.filters`: off → no chip and the default Filter. */
  filtersEnabled?: boolean;
};

type Phase = 'hint' | 'loading' | 'error' | 'empty' | 'results';

/**
 * Поиск по подпискам (Story 5.6, FEED-04, SEARCH-SCOPES; docs/focus-map.md
 * §4 E): a system-keyboard field, the «Фильтры» chip of the `search` scope
 * and a 3-column result grid (the shared PostGrid) fed by E6.
 *
 * - The search runs on «Готово» only (no search-as-you-type): the trimmed
 *   query is stored (`searchQueryStore`) and its page 1 is fetched afresh;
 *   a blank query shows the hint and sends nothing. Back with the keyboard
 *   open is the system's: the keyboard closes, nothing is sent.
 * - Focus: the field on open (also with cached results after a sidebar
 *   round trip). After «Готово»: the first result; none → the field, or
 *   «Сбросить фильтры» when filters are active; an error → «Повторить».
 *   Those moves land only while focus is still on the field (or the action
 *   just pressed) and no modal is open. → from the field: «Фильтры»; ↓: the
 *   remembered result (the band), else the first; ↑ from the first row: the
 *   field (the row guide); ← : the sidebar.
 * - Refetch (a Filter change behind the sheet), pagination and image loads
 *   never move focus.
 * - Back from Пост: the same query, Filter and card (by id; fallback
 *   neighbor → first result → the field).
 */
export function SearchScreen({
  http,
  routeKey,
  focusOnMount = false,
  focus,
  onOpenPost,
  filtersEnabled = false,
}: SearchScreenProps) {
  // The `search` Filter (AD-18, its own scope): the default while the chip is off.
  const storedFilter = useFilter('search');
  const effectiveFilter = filtersEnabled ? storedFilter : DEFAULT_FILTER;
  const filtered = !isDefaultFilter(effectiveFilter);
  const query = useSubmittedQuery();
  const [draft, setDraft] = useState(() => query ?? '');
  const results = useFeedSearch(http, query, effectiveFilter);
  const client = useQueryClient();
  const modal = useModal();

  const focusRef = useLatestRef(focus);
  const windowHeight = useWindowDimensions().height;
  const listHeight =
    windowHeight - 2 * spacing['safe-y'] - FIELD_ROW_HEIGHT - POST_GRID_LIST_TOP_GAP;

  const listRef = useRef<FlashListRef<PostRowItem>>(null);
  const adapterRef = useRef(postGridListAdapter(listRef));
  const shownPosts = useShownGridPosts(
    results.posts,
    results.hasNextPage && !results.loadMoreFailed,
    focus.current(),
    SEARCH_RESULT_PREFIX,
  );
  const ids = useMemo(() => shownPosts.map(post => searchResultId(post.id)), [shownPosts]);
  const idsRef = useLatestRef(ids);
  /** The last focused result (the ↓ band's target); null: none since «Готово». */
  const lastResult = useRef<{ id: string; index: number } | null>(null);
  useHeldRowAutoFetch(results, shownPosts.length);

  const phase: Phase =
    query === null
      ? 'hint'
      : results.isPending
        ? 'loading'
        : results.firstPageError !== null
          ? 'error'
          : results.posts.length === 0
            ? 'empty'
            : 'results';

  // The field: a content zone item (Back, ← → zones, the Shell's tracking).
  const fieldZone = useZoneItem(SEARCH_FIELD_ID);
  const [fieldView, setFieldView] = useState<HostView | null>(null);
  const fieldViewRef = useRef<HostView | null>(null);
  const fieldHostRef = useCallback(
    (view: HostView | null) => {
      fieldViewRef.current = view;
      setFieldView(view);
      fieldZone.ref?.(view);
    },
    [fieldZone],
  );
  const focusField = useCallback(() => requestHostFocus(fieldViewRef.current), []);

  const stateAction = useZoneItem(phase === 'error' ? SEARCH_RETRY_ID : SEARCH_RESET_FILTERS_ID);
  const stateActionView = useRef<HostView | null>(null);
  const stateActionRef = useCallback(
    (view: HostView | null) => {
      stateActionView.current = view;
      stateAction.ref?.(view);
    },
    [stateAction],
  );

  /**
   * A pending focus (a card restore, the first result after «Готово») lands
   * only while the Shell is active, no modal is open and focus is still
   * where Поиск may take it.
   */
  const canFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive() || modal.isOpen()) {
      return false;
    }
    const current = info.current();
    return (
      current === null ||
      current === info.sectionItemId ||
      current === SEARCH_FIELD_ID ||
      current === SEARCH_RETRY_ID ||
      current === SEARCH_RESET_FILTERS_ID ||
      current === SEARCH_LOAD_MORE_RETRY_ID ||
      current.startsWith(SEARCH_RESULT_PREFIX)
    );
  }, [focusRef, modal]);

  const restoration = useFocusRestoration({
    routeKey,
    sectionId: SEARCH_SECTION,
    ids,
    listRef: adapterRef,
    focusAbove: focusField,
    canFocus,
  });
  useEffect(() => restoration.cancel, [restoration]);

  // The section was opened with OK: the field (owner decision 2026-10-29
  // Q1 a: also with cached results after a sidebar round trip).
  useEffect(() => {
    if (focusOnMount) {
      focusField();
    }
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * «Готово», «Повторить» or «Сбросить фильтры» is waiting for its outcome
   * (`useOutcomeFocus`): the first result, else the field / «Сбросить
   * фильтры», else «Повторить». The hint drops a pending outcome. It lands
   * only while the user has not moved off the element that started the wait.
   */
  const mayTakeOutcomeFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive() || modal.isOpen()) {
      return false;
    }
    const current = info.current();
    return (
      current === null ||
      current === SEARCH_FIELD_ID ||
      current === SEARCH_RETRY_ID ||
      current === SEARCH_RESET_FILTERS_ID
    );
  }, [focusRef, modal]);
  const {
    awaitOutcome,
    cancel: cancelOutcome,
    resolve: resolveOutcome,
  } = useOutcomeFocus<Phase>({
    client,
    phase,
    isFetching: results.isFetching,
    shownKey: queryKeys.feedSearch(query ?? '', effectiveFilter),
    mayTakeFocus: mayTakeOutcomeFocus,
    waitPhases: OUTCOME_WAIT_PHASES,
    dropPhases: OUTCOME_DROP_PHASES,
    onOutcome: settled => {
      if (settled === 'results') {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        restoration.focusInitial();
      } else if (settled === 'error' || (settled === 'empty' && filtered)) {
        requestHostFocus(stateActionView.current);
      } else {
        focusField();
      }
    },
  });
  usePhaseChange(phase, () => {
    resolveOutcome();
  });

  const queryRef = useLatestRef(query);
  const filterRef = useLatestRef(effectiveFilter);
  const onSubmit = useCallback(() => {
    // The system closes the keyboard; focus stays on the field explicitly.
    focusField();
    const next = draft.trim();
    if (next === '') {
      cancelOutcome();
      searchQueryStore.getState().clear();
      return;
    }
    // A new search: the result memory starts over at the field.
    focusRestoration.remember(routeKey, SEARCH_SECTION, SEARCH_FIELD_ID, 0);
    lastResult.current = null;
    restoration.cancel();
    awaitOutcome(queryKeys.feedSearch(next, filterRef.current));
    submitFeedSearch(client, next, filterRef.current).catch(() => {});
    if (queryRef.current !== next) {
      searchQueryStore.getState().submit(next);
    }
  }, [
    draft,
    focusField,
    cancelOutcome,
    routeKey,
    restoration,
    client,
    filterRef,
    queryRef,
    awaitOutcome,
  ]);

  const onRetry = useCallback(() => {
    awaitOutcome(queryKeys.feedSearch(queryRef.current ?? '', filterRef.current));
    results.refetch();
  }, [results, awaitOutcome, queryRef, filterRef]);

  // «Сбросить фильтры»: the action goes with the empty view, so the field
  // keeps focus meanwhile. The query runs again under the default Filter (a
  // cached result for it is not reused; Автор's rule, Story 5.7).
  const onResetFilters = useCallback(() => {
    focusField();
    awaitOutcome(queryKeys.feedSearch(queryRef.current ?? '', DEFAULT_FILTER));
    if (queryRef.current !== null) {
      submitFeedSearch(client, queryRef.current, DEFAULT_FILTER).catch(() => {});
    }
    filtersStore.getState().reset('search');
  }, [focusField, awaitOutcome, queryRef, client]);

  // Back from Пост: the remembered result by id with the fallback chain.
  const phaseRef = useLatestRef(phase);
  useEffect(() => {
    const unregister = focusRef.current.setReturnFocus?.(() => {
      const remembered = focusRestoration.peek(routeKey, SEARCH_SECTION)?.focusId;
      if (
        phaseRef.current !== 'results' ||
        remembered === undefined ||
        !remembered.startsWith(SEARCH_RESULT_PREFIX)
      ) {
        return false;
      }
      restoreElseFirst(restoration);
      return true;
    });
    return () => unregister?.();
  }, [restoration, routeKey, phaseRef, focusRef]);

  // No head refresh here, but a cached list can replace the shown one: a
  // focused card keeps focus by id (shared rule).
  useHeadChangeRefocus({
    ids,
    cardIdPrefix: SEARCH_RESULT_PREFIX,
    retryId: SEARCH_LOAD_MORE_RETRY_ID,
    focused: () => focusRef.current.current(),
    canFocus,
    restoration,
    list: adapterRef,
  });

  const onRetryLoadMore = useLoadMoreRetry(
    results,
    ids,
    restoration,
    () => focusRef.current.isActive() && focusRef.current.current() === SEARCH_LOAD_MORE_RETRY_ID,
  );

  const postsRef = useLatestRef(shownPosts);
  const onOpenPostRef = useLatestRef(onOpenPost);
  const onCardPress = useCallback(
    (postId: string) => {
      const post = postsRef.current.find(p => p.id === postId);
      if (post) {
        onOpenPostRef.current?.(post.author.blogUrl, post.id);
      }
    },
    [postsRef, onOpenPostRef],
  );

  // «Фильтры»: the shared sheet with the `search` scope; Back returns to the chip.
  const chipView = useRef<HostView | null>(null);
  // Focus reported to the zone (Back, the Shell's tracking), the view not
  // registered there: the zone's destination (→ from the sidebar) must never
  // be the chip while it is not focusable.
  const chipZone = useZoneItem(SEARCH_FILTERS_ID);
  const chipRef = useCallback((view: HostView | null) => {
    chipView.current = view;
  }, []);
  const httpRef = useLatestRef(http);
  const onOpenFilters = useCallback(() => {
    if (modal.isOpen()) {
      return;
    }
    modal.open(<FilterSheet scope="search" http={httpRef.current} />, chipView, {
      placement: 'end',
    });
  }, [modal, httpRef]);

  // ↓ from the field or the chip: the last focused result, else its
  // neighbour by index, else the first (the guide around the grid). Set only
  // while the field row has focus. Forgotten on «Готово».
  //
  // The chip is focusable only while the field row has focus (device check,
  // Story 5.6): from the third column ↑ would otherwise find the chip
  // first, and the row guide never redirected it to the field.
  const [rowFocus, setRowFocus] = useState<'field' | 'chip' | 'other'>('other');
  useEffect(
    () =>
      focus.onFocusChange(focusId => {
        if (focusId.startsWith(SEARCH_RESULT_PREFIX)) {
          lastResult.current = { id: focusId, index: Math.max(idsRef.current.indexOf(focusId), 0) };
        }
        setRowFocus(
          focusId === SEARCH_FIELD_ID ? 'field' : focusId === SEARCH_FILTERS_ID ? 'chip' : 'other',
        );
      }),
    [focus, idsRef],
  );
  const [downTarget, setDownTarget] = useState<HostView | null>(null);
  useEffect(() => {
    if (rowFocus === 'other' || phase !== 'results') {
      setDownTarget(null);
      return;
    }
    const pick = () => {
      const remembered = lastResult.current;
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
    // A row that mounts after the list's layout pass: look again next frame.
    const frame = requestAnimationFrame(() => setDownTarget(pick()));
    return () => cancelAnimationFrame(frame);
  }, [rowFocus, phase, ids, restoration]);

  const chip = filtersEnabled ? chipLabels(effectiveFilter) : null;
  const rowDestinations = useMemo(() => (fieldView ? [fieldView] : []), [fieldView]);
  const downDestinations = useMemo(() => (downTarget ? [downTarget] : []), [downTarget]);

  return (
    <View testID="search/screen" style={styles.root}>
      <TVFocusGuideView
        testID="search/field-row"
        destinations={rowDestinations}
        trapFocusRight
        style={styles.fieldRow}
      >
        <View style={styles.fieldColumn}>
          <TextField
            testID={SEARCH_FIELD_ID}
            label={t('search.fieldLabel')}
            placeholder={t('search.placeholder')}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={onSubmit}
            onFocus={fieldZone.onFocus}
            hostRef={fieldHostRef}
          />
        </View>
        {chip !== null ? (
          <View style={styles.chipColumn}>
            <FilterChip
              ref={chipRef}
              testID={SEARCH_FILTERS_ID}
              label={chip.label}
              count={chip.count}
              accessibilityLabel={chip.a11y}
              onPress={onOpenFilters}
              onFocus={chipZone.onFocus}
              focusable={rowFocus !== 'other'}
            />
          </View>
        ) : null}
      </TVFocusGuideView>
      {phase === 'hint' ? (
        <View testID="search/hint" style={styles.hint}>
          <Text variant="body" color="text-secondary">
            {t('search.hint')}
          </Text>
        </View>
      ) : null}
      {phase === 'loading' ? (
        <View
          testID="search/skeleton"
          style={styles.skeleton}
          accessible
          accessibilityLabel={t('search.loading')}
        >
          {Array.from({ length: SKELETON_ROWS }, (_, row) => (
            <View key={row} style={styles.skeletonRow}>
              {Array.from({ length: POST_GRID_COLUMNS }, (__, column) => (
                <PostCardSkeleton
                  key={column}
                  width={POST_GRID_CARD_WIDTH}
                  style={column > 0 ? styles.columnGap : undefined}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {phase === 'error' && results.firstPageError !== null ? (
        <View testID="search/error" style={styles.state}>
          <StateView
            title={t('search.errorTitle')}
            body={t(`error.${results.firstPageError}`)}
            action={{
              label: t('common.retry'),
              onPress: onRetry,
              busy: results.isFetching,
              testID: SEARCH_RETRY_ID,
              ref: stateActionRef,
              onFocus: stateAction.onFocus,
            }}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'empty' ? (
        <View testID={filtered ? 'search/filtered-empty' : 'search/empty'} style={styles.state}>
          <StateView
            title={t('search.emptyTitle')}
            body={t(filtered ? 'search.filteredEmptyBody' : 'search.emptyBody')}
            action={
              filtered
                ? {
                    label: t('search.resetFilters'),
                    onPress: onResetFilters,
                    testID: SEARCH_RESET_FILTERS_ID,
                    ref: stateActionRef,
                    onFocus: stateAction.onFocus,
                  }
                : undefined
            }
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'results' ? (
        // ↓ from the field or the chip enters the grid through this guide
        // (the remembered result, else the first). Device check: a band
        // under the text field (Главная's pattern) never won Android's focus
        // search from the field; a guide around the grid does.
        // An explicit box (device check): unstyled, the guide collapsed and
        // the list was not shown.
        <TVFocusGuideView
          testID="search/results/guide"
          destinations={downDestinations}
          style={[styles.resultsGuide, { height: listHeight + POST_GRID_LIST_TOP_GAP }]}
        >
          <PostGrid
            posts={shownPosts}
            height={listHeight}
            restoration={restoration}
            listRef={listRef}
            hasNextPage={results.hasNextPage}
            isFetchingNextPage={results.isFetchingNextPage}
            loadMoreFailed={results.loadMoreFailed}
            onLoadMore={results.fetchNextPage}
            onRetry={onRetryLoadMore}
            onCardPress={onCardPress}
            cardIdPrefix={SEARCH_RESULT_PREFIX}
            retryId={SEARCH_LOAD_MORE_RETRY_ID}
            testIDPrefix="search/results"
            loadMoreErrorLabel={t('search.loadMoreError')}
          />
        </TVFocusGuideView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fieldRow: {
    height: FIELD_ROW_HEIGHT,
    marginLeft: spacing['focus-headroom'],
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  fieldColumn: {
    width: FIELD_WIDTH,
  },
  chipColumn: {
    marginLeft: spacing['6'],
    // Level with the field: below the label, centred on the 50 dp field.
    marginTop:
      typography['body-s'].lineHeight +
      spacing['4'] +
      (FIELD.height - components['filter-chip'].height) / 2,
  },
  hint: {
    marginTop: spacing['8'],
    marginLeft: spacing['focus-headroom'],
    maxWidth: FIELD_WIDTH,
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
  resultsGuide: {
    width: spacing['content-width'],
  },
  withAction: {
    paddingHorizontal: spacing['focus-headroom'],
  },
});
