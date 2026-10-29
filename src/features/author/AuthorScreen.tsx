import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { StyleSheet, TVFocusGuideView, View, useWindowDimensions } from 'react-native';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  DEFAULT_FILTER,
  FilterSheet,
  authorFilterScope,
  chipLabels,
  filtersStore,
  isDefaultFilter,
  useFilter,
} from '../../shared/filters';
import {
  MAIN_SECTION,
  focusRestoration,
  mayTakeScreenFocus,
  restoreElseFirst,
  useFocusRestoration,
  useLatestRef,
  useModal,
  usePhaseChange,
  useZoneItem,
} from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  Button,
  FilterChip,
  POST_GRID_CARD_WIDTH,
  POST_GRID_COLUMNS,
  POST_GRID_LIST_TOP_GAP,
  PostCardSkeleton,
  PostGrid,
  StateView,
  TextField,
  components,
  postGridListAdapter,
  requestHostFocus,
  spacing,
  typography,
  useHeadChangeRefocus,
  useHeldRowAutoFetch,
  useLoadMoreRetry,
  useNotMovedLatch,
  useShownGridPosts,
  type HostView,
  type PostRowItem,
} from '../../shared/ui';
import { AUTHOR_HEADER_HEIGHT, AuthorHeader, AuthorHeaderSkeleton } from './AuthorHeader';
import { useAuthor } from './useAuthor';
import { useAuthorPosts } from './useAuthorPosts';
import { submitBlogSearch, useBlogSearch } from './useBlogSearch';

/** Focus ids (docs/focus-map.md §1.5). */
export const AUTHOR_STATE_ACTION_ID = 'state/author/action';
export const authorCardPrefix = (blogUrl: string) => `author/${blogUrl}/post/`;
export const authorCardId = (blogUrl: string, postId: string) =>
  `${authorCardPrefix(blogUrl)}${postId}`;
export const authorRetryId = (blogUrl: string) => `author/${blogUrl}/retry`;
/** The action row (Story 5.7): «Поиск в блоге», «Фильтры», «Сбросить». */
export const authorSearchId = (blogUrl: string) => `author/${blogUrl}/action/search`;
export const authorFiltersId = (blogUrl: string) => `author/${blogUrl}/action/filters`;
export const authorResetId = (blogUrl: string) => `author/${blogUrl}/action/reset`;

const SKELETON_ROWS = 2;
/** Frames the no-fetch outcome settle waits for the render and the cache. */
const OUTCOME_FRAME_TRIES = 30;
const FIELD = components['text-field'];
/** The action row: the label above the 50 dp field, and a little room under it. */
export const AUTHOR_ACTION_ROW_HEIGHT =
  typography['body-s'].lineHeight + spacing['4'] + FIELD.height + spacing['2'];
/** The gap between the header and the action row. */
const ACTION_ROW_TOP = spacing['4'];
const FIELD_WIDTH = 440;
const FIELD_MIN_WIDTH = 160;

/** What the route tells the Author page about focus (it owns the sidebar and zones). */
export type AuthorFocusInfo = {
  /** The Author route is the focused route; a covered or closing one never takes focus. */
  isActive(): boolean;
  /** The last focused element on the route (sidebar or content id); null: none yet. */
  current(): string | null;
  /** The sidebar's current item (the origin section, `author/nav/subs`). */
  sectionItemId: string;
  /** Focus the sidebar's current item. */
  focusSidebar(): void;
  /** Focus the content zone's remembered element; false when it has none. */
  focusZoneTarget(): boolean;
  /**
   * Listen to the route's focus events (the same ids as `current()`, while
   * the route is active); returns the unsubscribe.
   */
  onFocusChange(listener: (focusId: string) => void): () => void;
};

export type AuthorScreenProps = {
  /** The active session's content client (from the route; never a singleton). */
  http: HttpClient;
  /** Already validated (`blogUrlSchema`) where it came from. */
  blogUrl: string;
  /** FocusRestoration route key (the stack route's key). */
  routeKey: string;
  focus: AuthorFocusInfo;
  /** «Назад» on «Автор недоступен»: pop. */
  onBack: () => void;
  /** OK on a post: open Пост (Story 3.4) by its identity. */
  onOpenPost?: (blogUrl: string, postId: string) => void;
  /** `phaseFlags.search`: «Поиск в блоге» in the action row (Story 5.7). */
  searchEnabled?: boolean;
  /** `phaseFlags.filters`: the «Фильтры» chip; off → the default Filter. */
  filtersEnabled?: boolean;
  /**
   * Story 5.7: the route's Back hook. The page sets it to its handler (an
   * active search: clear it, focus the field, return true); the route calls
   * it first on Back.
   */
  backHandlerRef?: RefObject<(() => boolean) | null>;
};

type Phase = 'unavailable' | 'error' | 'loading' | 'postsError' | 'empty' | 'grid';

/**
 * D Автор (Story 3.3, docs/focus-map.md §4 D): the header (E3: avatar,
 * title, owner name) and the author's posts (E4, pages of 20) in the shared
 * 3-column PostCard grid. E3 and E4 run in parallel; the header and the
 * grid area each show their own skeleton. A full-page StateView replaces
 * both only when E3 fails: «Автор недоступен» + «Назад» for the verified
 * 404 `blog_not_found`, else `error.<kind>` + «Повторить» (it refetches E3,
 * and E4 only if its first page failed too).
 *
 * Focus:
 * - First focus of the route: while there is no content focus target
 *   (skeleton, empty), the sidebar's current item (Подписки), so focus
 *   leaves the covered Shell explicitly.
 * - When the first posts arrive, the first post takes focus only if the
 *   user has not moved (focus still on the sidebar's current item, nothing
 *   yet, or the StateView action just pressed). A StateView action takes
 *   focus the same way.
 * - Pagination, refetch and image loads never move focus.
 * - A head refresh (reopen with a stale cache, resume) that changes the
 *   head: while the user has not moved since the page opened (no D-pad move
 *   or OK; focus is still where the page put it by itself: the first post,
 *   the sidebar item or the StateView action, or none yet), the new first
 *   post takes focus and the list shows the top (owner decision
 *   2026-10-27, reopen focus), whichever comes first, the reply or the
 *   native focus event. This is the one exception to "sidebar and StateView
 *   focus are never taken": only the page's own automatic focus there is
 *   taken, never one the user chose. Once the user has moved, the focused card keeps focus (scrolled to its new row), as on
 *   Главная; a gap follows the fallback chain.
 * - Return to the route (a screen on top popped): the remembered post by id
 *   with the fallback chain (neighbor by index → first post → the action
 *   above / the sidebar item).
 * - OK on a post opens Пост (Story 3.4); the card is remembered (by its
 *   focus) and restored by id on return.
 *
 * Story 5.7 (AUTH-PAGE-02/03, docs/focus-map.md §4 D): the action row above
 * the grid: «Поиск в блоге» (E7 on «Готово», Поиск's rules; the results in
 * the same grid and card ids), the «Фильтры» chip (the route's own scope
 * `author:<routeKey>`, dropped on unmount; the blog's E14 tags) and
 * «Сбросить» (while a search or a filter is active). Back clears an active
 * search first (the route asks `backHandlerRef`). The field is the nearest
 * action above the grid (the fallback chain's last step).
 */
export function AuthorScreen({
  http,
  blogUrl,
  routeKey,
  focus,
  onBack,
  onOpenPost,
  searchEnabled = false,
  filtersEnabled = false,
  backHandlerRef,
}: AuthorScreenProps) {
  // Story 5.7: the route's own Filter (owner decision 2026-10-29 Q3 b) and
  // its submitted query (local state; null: the normal list).
  const scope = authorFilterScope(routeKey);
  const storedFilter = useFilter(scope);
  const filter = filtersEnabled ? storedFilter : DEFAULT_FILTER;
  const filtered = !isDefaultFilter(filter);
  const [query, setQuery] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const searching = query !== null;
  const rowShown = searchEnabled || filtersEnabled;
  useEffect(() => () => filtersStore.getState().reset(scope), [scope]);

  const author = useAuthor(http, blogUrl);
  const posts = useAuthorPosts(http, blogUrl, filter);
  const search = useBlogSearch(http, blogUrl, query, filter);
  /** What the grid shows: the search results while a query is active, else the posts. */
  const list = searching ? search : posts;
  const listKey = useMemo(
    () =>
      query !== null
        ? queryKeys.blogSearch(blogUrl, query, filter)
        : queryKeys.authorPosts(blogUrl, filter),
    [blogUrl, query, filter],
  );
  const client = useQueryClient();
  const modal = useModal();
  const windowHeight = useWindowDimensions().height;
  // A bounded viewport (Story 2.4 device lesson): the content zone's height
  // (window − 2 × safe-y) minus the header, the action row and the grid's
  // top gap.
  const listHeight =
    windowHeight -
    2 * spacing['safe-y'] -
    AUTHOR_HEADER_HEIGHT -
    (rowShown ? ACTION_ROW_TOP + AUTHOR_ACTION_ROW_HEIGHT : 0) -
    POST_GRID_LIST_TOP_GAP;

  const cardPrefix = authorCardPrefix(blogUrl);
  const retryId = authorRetryId(blogUrl);
  const fieldId = authorSearchId(blogUrl);
  const chipId = authorFiltersId(blogUrl);
  const resetId = authorResetId(blogUrl);
  const listRef = useRef<FlashListRef<PostRowItem>>(null);
  const adapterRef = useRef(postGridListAdapter(listRef));

  // A trailing partial row is held while more pages may come (PostGrid);
  // a failing next page shows it, and so does a focused card in it (a head
  // refresh can move the focused card there; `useShownGridPosts`).
  const shownPosts = useShownGridPosts(
    list.posts,
    list.hasNextPage && !list.loadMoreFailed,
    focus.current(),
    cardPrefix,
  );
  const ids = useMemo(() => shownPosts.map(post => `${cardPrefix}${post.id}`), [shownPosts, cardPrefix]);
  useHeldRowAutoFetch(list, shownPosts.length);

  const focusRef = useRef(focus);
  focusRef.current = focus;
  const stateAction = useZoneItem(AUTHOR_STATE_ACTION_ID);
  const stateActionView = useRef<HostView | null>(null);
  const stateActionRef = useCallback(
    (view: HostView | null) => {
      stateActionView.current = view;
      stateAction.ref?.(view);
    },
    [stateAction],
  );

  // The field: a content zone item (Back, ← → zones, the route's tracking).
  const fieldZone = useZoneItem(fieldId);
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

  // "The user has not moved since the page opened" (reopen focus, owner
  // decision 2026-10-27; shared with Главная, `useNotMovedLatch`): armed
  // from the start; every element the page focuses by itself (the sidebar
  // item, the StateView action, a card, the field) is recorded as automatic.
  const latch = useNotMovedLatch(focus.onFocusChange, { armed: true });
  /** The page's own sidebar focus (recorded as automatic). */
  const autoFocusSidebar = useCallback(() => {
    latch.auto(focusRef.current.sectionItemId);
    focusRef.current.focusSidebar();
  }, [latch]);
  /** The page's own StateView action focus (recorded as automatic). */
  const autoFocusAction = useCallback(() => {
    latch.auto(AUTHOR_STATE_ACTION_ID);
    requestHostFocus(stateActionView.current);
  }, [latch]);
  /**
   * The field holds the page's own focus (content lost: the nearest action
   * above), not one the user chose: the first post may still take it when
   * posts arrive (as from the sidebar item). Cleared by any other focus.
   */
  const fieldAuto = useRef(false);
  /** The page's own field focus (recorded as automatic). */
  const autoFocusField = useCallback(() => {
    latch.auto(fieldId);
    fieldAuto.current = true;
    focusField();
  }, [latch, fieldId, focusField]);
  // The nearest action above the grid: the field (Story 5.7) when the action
  // row is shown, else the StateView action when shown, else the sidebar's
  // current item.
  const rowShownRef = useLatestRef(rowShown);
  const focusAbove = useCallback(() => {
    if (rowShownRef.current && fieldViewRef.current) {
      autoFocusField();
    } else if (stateActionView.current) {
      autoFocusAction();
    } else {
      autoFocusSidebar();
    }
  }, [autoFocusAction, autoFocusSidebar, autoFocusField, rowShownRef]);
  /** Content focus is gone (nothing focusable left there): the field, else the sidebar. */
  const focusAfterLoss = useCallback(() => {
    if (rowShownRef.current && fieldViewRef.current) {
      autoFocusField();
    } else {
      autoFocusSidebar();
    }
  }, [autoFocusField, autoFocusSidebar, rowShownRef]);
  // A pending card focus lands only while the route is active, no modal is
  // open and focus is still where the page may take it: none yet, the
  // sidebar's current item, a card, the StateView action, the load-more
  // «Повторить» or the action row (Story 5.7: the row is content).
  const canFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive() || modal.isOpen()) {
      return false;
    }
    const current = info.current();
    return (
      current === null ||
      current === info.sectionItemId ||
      current === AUTHOR_STATE_ACTION_ID ||
      current === retryId ||
      current === fieldId ||
      current === chipId ||
      current === resetId ||
      current.startsWith(cardPrefix)
    );
  }, [cardPrefix, retryId, fieldId, chipId, resetId, modal]);

  const restoration = useFocusRestoration({
    routeKey,
    sectionId: MAIN_SECTION,
    ids,
    listRef: adapterRef,
    focusAbove,
    canFocus,
  });

  const phase: Phase = author.unavailable
    ? 'unavailable'
    : author.error !== null
      ? 'error'
      : list.isPending
        ? 'loading'
        : list.firstPageError !== null
          ? 'postsError'
          : list.posts.length === 0
            ? 'empty'
            : 'grid';
  const phaseRef = useLatestRef(phase);

  /** The user has not moved focus away from where the page may take it. */
  const mayTakeFocus = useCallback(() => {
    if (modal.isOpen()) {
      return false;
    }
    const info = focusRef.current;
    return (
      mayTakeScreenFocus(info, AUTHOR_STATE_ACTION_ID) ||
      (fieldAuto.current && info.isActive() && info.current() === fieldId)
    );
  }, [modal, fieldId]);

  const idsRef = useRef(ids);
  idsRef.current = ids;
  const shownRef = useRef(shownPosts);
  shownRef.current = shownPosts;
  const onOpenPostRef = useRef(onOpenPost);
  onOpenPostRef.current = onOpenPost;
  const onCardPress = useCallback(
    (postId: string) => {
      // OK on a post is a move (the reopen rule), and opens Пост.
      latch.move();
      const post = shownRef.current.find(p => p.id === postId);
      if (post) {
        onOpenPostRef.current?.(post.author.blogUrl, post.id);
      }
    },
    [latch],
  );

  const restoreOrFirst = useCallback(() => {
    restoreElseFirst(restoration, () => latch.auto(idsRef.current[0]));
  }, [restoration, latch]);

  // First focus of the route and every return to it (a screen on top
  // popped). Declared before the phase effect: on the first focus it only
  // covers the phases the phase effect leaves alone.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      const info = focusRef.current;
      if (firstFocus.current) {
        firstFocus.current = false;
        if (phaseRef.current === 'loading' || phaseRef.current === 'empty') {
          autoFocusSidebar();
        }
      } else {
        const current = info.current();
        if (current !== null && current.startsWith(cardPrefix) && phaseRef.current === 'grid') {
          restoreOrFirst();
        } else if (!(current !== null && current !== info.sectionItemId && info.focusZoneTarget())) {
          autoFocusSidebar();
        }
      }
      return restoration.cancel;
    }, [cardPrefix, restoreOrFirst, restoration, autoFocusSidebar, phaseRef]),
  );

  /**
   * Story 5.7 (Поиск's rules): «Готово», a search «Повторить» or «Сбросить
   * фильтры» waits for its outcome: the first result, else the field /
   * «Сбросить фильтры», else «Повторить». It lands only while focus is
   * still on the element that started the wait and no modal is open.
   */
  const pendingOutcome = useRef(false);
  const outcomeFetchSeen = useRef(false);
  const listFetchingRef = useLatestRef(list.isFetching);
  /** The shown list's key (hashed), as last rendered. */
  const shownKeyRef = useLatestRef(hashKey(listKey));
  /** The latest `resolveOutcome` (set below; read by the next-frame check). */
  const resolveLater = useRef<() => boolean>(() => false);
  const outcomeFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (outcomeFrame.current !== null) {
        cancelAnimationFrame(outcomeFrame.current);
      }
    },
    [],
  );
  const awaitOutcome = useCallback(
    (awaited: QueryKey) => {
      pendingOutcome.current = true;
      outcomeFetchSeen.current = false;
      // No fetch followed (e.g. an action onto a cached list with no phase
      // change and no fetching cycle): settle on a next frame with the same
      // rules, so the flag never outlives its action. Not while the awaited
      // list is fetching per the cache, or the render has not reached it
      // yet (a slow device: TanStack's batched notify can come after the
      // frame); then look again on the next frame, at most
      // OUTCOME_FRAME_TRIES times (a longer fetch settles through the
      // fetching cycle or the phase change).
      if (outcomeFrame.current !== null) {
        cancelAnimationFrame(outcomeFrame.current);
      }
      const awaitedHash = hashKey(awaited);
      let tries = 0;
      const check = () => {
        outcomeFrame.current = null;
        if (!pendingOutcome.current || outcomeFetchSeen.current) {
          return;
        }
        const busy =
          listFetchingRef.current ||
          shownKeyRef.current !== awaitedHash ||
          client.isFetching({ queryKey: awaited, exact: true }) > 0;
        if (!busy) {
          resolveLater.current();
        } else if (++tries < OUTCOME_FRAME_TRIES) {
          outcomeFrame.current = requestAnimationFrame(check);
        }
      };
      outcomeFrame.current = requestAnimationFrame(check);
    },
    [listFetchingRef, shownKeyRef, client],
  );
  const mayTakeOutcomeFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive() || modal.isOpen()) {
      return false;
    }
    const current = info.current();
    return current === null || current === fieldId || current === AUTHOR_STATE_ACTION_ID;
  }, [modal, fieldId]);
  /** Settles a pending outcome on the current phase; true when it did (focus handled). */
  const resolveOutcome = (): boolean => {
    if (!pendingOutcome.current || phase === 'loading') {
      return false;
    }
    pendingOutcome.current = false;
    if (!mayTakeOutcomeFocus()) {
      return true;
    }
    if (phase === 'grid') {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      restoration.focusInitial();
    } else if (phase === 'postsError' || (phase === 'empty' && filtered)) {
      requestHostFocus(stateActionView.current);
    } else {
      focusField();
    }
    return true;
  };
  const resolveRef = useLatestRef(resolveOutcome);
  resolveLater.current = resolveOutcome;
  // The awaited fetch settled with the phase unchanged (the held error
  // through a failed retry): settle the outcome too.
  useEffect(() => {
    if (!pendingOutcome.current) {
      return;
    }
    if (list.isFetching) {
      outcomeFetchSeen.current = true;
    } else if (outcomeFetchSeen.current) {
      outcomeFetchSeen.current = false;
      resolveRef.current();
    }
  }, [list.isFetching, resolveRef]);

  usePhaseChange(phase, () => {
    if (resolveOutcome()) {
      return;
    }
    const info = focusRef.current;
    const current = info.current();
    const contentLost =
      info.isActive() &&
      !modal.isOpen() &&
      current !== null &&
      (current.startsWith(cardPrefix) || current === retryId || current === AUTHOR_STATE_ACTION_ID);
    const emptyAction = phase === 'empty' && filtered;
    if (phase === 'loading') {
      // The skeleton has nothing focusable: a focused action (an E3 retry
      // that succeeded while E4 still loads) or card is gone.
      if (contentLost) {
        focusAfterLoss();
      }
    } else if (phase === 'grid') {
      if (mayTakeFocus()) {
        restoreOrFirst();
      }
    } else if (phase === 'empty' && !emptyAction) {
      // Nothing focusable in the empty view: a focused action or card is gone.
      if (contentLost) {
        focusAfterLoss();
      }
    } else if (mayTakeFocus() || contentLost) {
      // A StateView with its one action (Повторить / Назад / Сбросить фильтры).
      autoFocusAction();
    }
  });

  // A head refresh (reopen or resume, spec-author-posts-refresh) changed the
  // shown cards other than by an append: the new first post while the user
  // has not moved (`followHead`), else the focused card keeps focus, as on
  // Главная (`useHeadChangeRefocus`). A covered route never takes focus.
  useHeadChangeRefocus({
    ids,
    cardIdPrefix: cardPrefix,
    retryId,
    focused: () => focusRef.current.current(),
    canFocus,
    restoration,
    list: adapterRef,
    followHead: latch.followHead,
    onFollowHead: latch.onFollowHead,
  });

  const onRetryLoadMore = useLoadMoreRetry(list, ids, restoration, () => {
    const info = focusRef.current;
    return info.isActive() && info.current() === retryId;
  });

  // «Повторить» on the full-page error: E3, and E4 only if it failed too.
  const onRetryAll = useCallback(() => {
    author.refetch();
    if (posts.firstPageError !== null) {
      posts.refetch();
    }
  }, [author, posts]);

  // «Повторить» of a failed list page 1 (posts or search results).
  const onRetryList = useCallback(() => {
    if (searching) {
      awaitOutcome(listKey);
    }
    list.refetch();
  }, [list, searching, awaitOutcome, listKey]);

  /** Back to the normal list (the search memory starts over at the field). */
  const leaveSearch = useCallback(() => {
    pendingOutcome.current = false;
    restoration.cancel();
    focusRestoration.remember(routeKey, MAIN_SECTION, fieldId, 0);
    setQuery(null);
  }, [restoration, routeKey, fieldId]);

  const onChangeDraft = useCallback((text: string) => {
    // Typing is the user's: the field is theirs now.
    fieldAuto.current = false;
    setDraft(text);
  }, []);

  // «Готово» (Поиск's rules): the trimmed query; blank → the normal list.
  const filterRef = useLatestRef(filter);
  const queryRef = useLatestRef(query);
  const onSubmit = useCallback(() => {
    // The system closes the keyboard; focus stays on the field explicitly.
    fieldAuto.current = false;
    focusField();
    const next = draft.trim();
    if (next === '') {
      if (queryRef.current !== null) {
        leaveSearch();
      }
      return;
    }
    restoration.cancel();
    focusRestoration.remember(routeKey, MAIN_SECTION, fieldId, 0);
    awaitOutcome(queryKeys.blogSearch(blogUrl, next, filterRef.current));
    submitBlogSearch(client, blogUrl, next, filterRef.current).catch(() => {});
    setQuery(next);
  }, [
    draft,
    focusField,
    queryRef,
    leaveSearch,
    restoration,
    routeKey,
    fieldId,
    awaitOutcome,
    client,
    blogUrl,
    filterRef,
  ]);

  // Back (the route asks first): an active search is cleared, focus → the field.
  useEffect(() => {
    if (!backHandlerRef) {
      return;
    }
    backHandlerRef.current = () => {
      if (queryRef.current === null) {
        return false;
      }
      setDraft('');
      leaveSearch();
      focusField();
      return true;
    };
    return () => {
      backHandlerRef.current = null;
    };
  }, [backHandlerRef, queryRef, leaveSearch, focusField]);

  // «Сбросить фильтры» in the filtered «Ничего не найдено»: the action goes
  // with the empty view, so the field keeps focus while the list reloads.
  // While searching, the query runs again under the default Filter (a
  // cached result for it is not reused).
  const onResetFilters = useCallback(() => {
    focusField();
    awaitOutcome(
      queryRef.current !== null
        ? queryKeys.blogSearch(blogUrl, queryRef.current, DEFAULT_FILTER)
        : queryKeys.authorPosts(blogUrl, DEFAULT_FILTER),
    );
    if (queryRef.current !== null) {
      submitBlogSearch(client, blogUrl, queryRef.current, DEFAULT_FILTER).catch(() => {});
    }
    filtersStore.getState().reset(scope);
  }, [focusField, awaitOutcome, scope, queryRef, client, blogUrl]);

  // «Фильтры»: the shared sheet with the route's scope and the blog's tags;
  // Back returns to the chip.
  const chipView = useRef<HostView | null>(null);
  const chipZone = useZoneItem(chipId);
  const chipRef = useCallback((view: HostView | null) => {
    chipView.current = view;
  }, []);
  const httpRef = useLatestRef(http);
  const onOpenFilters = useCallback(() => {
    if (modal.isOpen()) {
      return;
    }
    modal.open(<FilterSheet scope={scope} http={httpRef.current} blogUrl={blogUrl} />, chipView, {
      placement: 'end',
    });
  }, [modal, httpRef, scope, blogUrl]);

  // «Сбросить» (shown while a search or a filter is active): both cleared,
  // focus → the chip (it stays; «Сбросить» goes away).
  const resetZone = useZoneItem(resetId);
  const onResetAll = useCallback(() => {
    if (chipView.current) {
      requestHostFocus(chipView.current);
    } else {
      focusField();
    }
    setDraft('');
    if (queryRef.current !== null) {
      leaveSearch();
    }
    filtersStore.getState().reset(scope);
  }, [focusField, queryRef, leaveSearch, scope]);

  // The chip and «Сбросить» are focusable only while the action row has
  // focus (Поиск's device lesson, Story 5.6: ↑ from a later column would
  // otherwise find them first and the row guide never redirects to the
  // field). ↓ from the row: the last focused card, else its neighbour by
  // index, else the first (the guide around the grid).
  const lastCard = useRef<{ id: string; index: number } | null>(null);
  const [rowFocus, setRowFocus] = useState(false);
  useEffect(
    () =>
      focus.onFocusChange(focusId => {
        if (focusId.startsWith(cardPrefix)) {
          lastCard.current = { id: focusId, index: Math.max(idsRef.current.indexOf(focusId), 0) };
        }
        if (focusId !== fieldId) {
          fieldAuto.current = false;
        }
        setRowFocus(focusId === fieldId || focusId === chipId || focusId === resetId);
      }),
    [focus, cardPrefix, fieldId, chipId, resetId],
  );
  const [downTarget, setDownTarget] = useState<HostView | null>(null);
  useEffect(() => {
    if (!rowFocus || phase !== 'grid') {
      setDownTarget(null);
      return;
    }
    const pick = () => {
      const remembered = lastCard.current;
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

  const chip = filtersEnabled ? chipLabels(filter) : null;
  const showReset = rowShown && (searching || filtered);
  const rowDestinations = useMemo(() => (fieldView ? [fieldView] : []), [fieldView]);
  const downDestinations = useMemo(() => (downTarget ? [downTarget] : []), [downTarget]);

  if (phase === 'unavailable' || phase === 'error') {
    const unavailable = phase === 'unavailable';
    return (
      <View testID="author/page" style={styles.root}>
        <View testID={unavailable ? 'author/unavailable' : 'author/error'} style={styles.state}>
          <StateView
            title={unavailable ? t('author.unavailableTitle') : t('author.errorTitle')}
            body={
              unavailable
                ? t('author.unavailableBody')
                : t(`error.${author.error ?? 'Client'}`)
            }
            action={{
              label: unavailable ? t('common.back') : t('common.retry'),
              onPress: unavailable ? onBack : onRetryAll,
              busy: unavailable ? false : author.isFetching,
              testID: AUTHOR_STATE_ACTION_ID,
              ref: stateActionRef,
              onFocus: stateAction.onFocus,
            }}
            style={styles.withAction}
          />
        </View>
      </View>
    );
  }

  const emptyTestID = searching ? 'author/search-empty' : filtered ? 'author/filtered-empty' : 'author/empty';
  const emptyBody = searching
    ? t(filtered ? 'author.search.filteredEmptyBody' : 'author.search.emptyBody')
    : filtered
      ? t('author.search.filteredPostsEmptyBody')
      : t('author.emptyBody');

  return (
    <View testID="author/page" style={styles.root}>
      {author.author ? (
        <AuthorHeader author={author.author} testID="author/header" />
      ) : (
        <AuthorHeaderSkeleton testID="author/header-skeleton" />
      )}
      {rowShown ? (
        <TVFocusGuideView
          testID="author/action-row"
          destinations={rowDestinations}
          trapFocusRight
          style={styles.actionRow}
        >
          {searchEnabled ? (
            <View style={styles.fieldColumn}>
              <TextField
                testID={fieldId}
                label={t('author.search.fieldLabel')}
                placeholder={t('author.search.placeholder')}
                value={draft}
                onChangeText={onChangeDraft}
                onSubmitEditing={onSubmit}
                onFocus={fieldZone.onFocus}
                hostRef={fieldHostRef}
              />
            </View>
          ) : null}
          {chip !== null ? (
            <View style={styles.chipColumn}>
              <FilterChip
                ref={chipRef}
                testID={chipId}
                label={chip.label}
                count={chip.count}
                accessibilityLabel={chip.a11y}
                onPress={onOpenFilters}
                onFocus={chipZone.onFocus}
                focusable={rowFocus || !searchEnabled}
              />
            </View>
          ) : null}
          {showReset ? (
            <View style={styles.chipColumn}>
              <Button
                testID={resetId}
                kind="secondary"
                size="small"
                label={t('author.search.reset')}
                accessibilityLabel={t('author.search.resetA11y')}
                onPress={onResetAll}
                onFocus={resetZone.onFocus}
                focusable={rowFocus || !searchEnabled}
              />
            </View>
          ) : null}
        </TVFocusGuideView>
      ) : null}
      {phase === 'loading' ? (
        <View
          testID="author/skeleton"
          style={styles.skeleton}
          accessible
          accessibilityLabel={searching ? t('author.search.loading') : t('author.loadingPosts')}
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
      {phase === 'postsError' && list.firstPageError !== null ? (
        <View testID={searching ? 'author/search-error' : 'author/posts-error'} style={styles.state}>
          <StateView
            title={searching ? t('author.search.errorTitle') : t('author.postsErrorTitle')}
            body={t(`error.${list.firstPageError}`)}
            action={{
              label: t('common.retry'),
              onPress: onRetryList,
              busy: list.isFetching,
              testID: AUTHOR_STATE_ACTION_ID,
              ref: stateActionRef,
              onFocus: stateAction.onFocus,
            }}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'empty' ? (
        <View testID={emptyTestID} style={styles.state}>
          <StateView
            title={searching || filtered ? t('author.search.emptyTitle') : t('author.emptyTitle')}
            body={emptyBody}
            action={
              filtered
                ? {
                    label: t('author.search.resetFilters'),
                    onPress: onResetFilters,
                    testID: AUTHOR_STATE_ACTION_ID,
                    ref: stateActionRef,
                    onFocus: stateAction.onFocus,
                  }
                : undefined
            }
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'grid' ? (
        // ↓ from the action row enters the grid through this guide (the
        // remembered card, else the first; Поиск's device lesson). An
        // explicit box: unstyled, the guide collapses the list.
        <TVFocusGuideView
          testID="author/posts/guide"
          destinations={downDestinations}
          style={[styles.gridGuide, { height: listHeight + POST_GRID_LIST_TOP_GAP }]}
        >
          <PostGrid
            posts={shownPosts}
            height={listHeight}
            restoration={restoration}
            listRef={listRef}
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            loadMoreFailed={list.loadMoreFailed}
            onLoadMore={list.fetchNextPage}
            onRetry={onRetryLoadMore}
            onCardPress={onCardPress}
            cardIdPrefix={cardPrefix}
            retryId={retryId}
            testIDPrefix="author/posts"
            showPinned
            loadMoreErrorLabel={
              searching ? t('author.search.loadMoreError') : t('author.loadMoreError')
            }
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
  // The row keeps inside the content width (device check): the field takes
  // what the chip and «Сбросить» leave, up to 440 dp (a long chip label
  // would otherwise push «Сбросить» off the screen).
  actionRow: {
    height: AUTHOR_ACTION_ROW_HEIGHT,
    width: spacing['content-width'] - 2 * spacing['focus-headroom'],
    marginTop: ACTION_ROW_TOP,
    marginLeft: spacing['focus-headroom'],
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  fieldColumn: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: FIELD_WIDTH,
    minWidth: FIELD_MIN_WIDTH,
  },
  chipColumn: {
    flexShrink: 0,
    marginLeft: spacing['6'],
    // Level with the field: below the label, centred on the 50 dp field.
    marginTop:
      typography['body-s'].lineHeight +
      spacing['4'] +
      (FIELD.height - components['filter-chip'].height) / 2,
  },
  gridGuide: {
    width: spacing['content-width'],
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
  // Focus headroom: the scaled button and its ring stay inside the content.
  withAction: {
    paddingHorizontal: spacing['focus-headroom'],
  },
});
