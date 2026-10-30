import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useRef, type RefObject } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, TVFocusGuideView, View, useWindowDimensions } from 'react-native';
import { queryKeys, type HttpClient } from '../../shared/api';
import { chipLabels } from '../../shared/filters';
import {
  MAIN_SECTION,
  restoreElseFirst,
  useFocusRestoration,
  useLatestRef,
  useModal,
  useOutcomeFocus,
  usePhaseChange,
  type ListRestoration,
  type OutcomeFocus,
} from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  POST_GRID_LIST_TOP_GAP,
  PostGrid,
  postGridListAdapter,
  requestHostFocus,
  spacing,
  useHeadChangeRefocus,
  useHeldRowAutoFetch,
  useLoadMoreRetry,
  useShownGridPosts,
  type PostRowItem,
} from '../../shared/ui';
import { AUTHOR_ACTION_ROW_HEIGHT, AUTHOR_ACTION_ROW_TOP, AuthorActionRow } from './AuthorActionRow';
import { AUTHOR_HEADER_HEIGHT, AuthorHeader, AuthorHeaderSkeleton } from './AuthorHeader';
import { AuthorListState, AuthorPageState } from './AuthorStates';
import { LIVE_CARD_BLOCK_HEIGHT, LiveCard, liveCardBlockStyle } from './LiveCard';
import {
  AUTHOR_STATE_ACTION_ID,
  authorCardPrefix,
  authorFiltersId,
  authorLiveId,
  authorResetId,
  authorRetryId,
  authorSearchId,
} from './authorIds';
import { useAuthor } from './useAuthor';
import { useAuthorActionRowFocus } from './useAuthorActionRowFocus';
import {
  useAuthorAutoFocus,
  useAuthorField,
  type AuthorFocusInfo,
} from './useAuthorAutoFocus';
import { useAuthorFilters } from './useAuthorFilters';
import {
  useAuthorLiveCard,
  useAuthorLiveFocus,
  useAuthorLivePress,
  useAuthorLiveStream,
} from './useAuthorLive';
import { useAuthorPosts } from './useAuthorPosts';
import { useAuthorSearch, type AuthorSearch } from './useAuthorSearch';
import { useBlogSearch } from './useBlogSearch';

export type { AuthorFocusInfo } from './useAuthorAutoFocus';

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
  /**
   * Story 7.2: OK on a playable LiveCard: the live Player for `blogUrl`
   * (the route's callback, `LiveRef`); exit returns focus to `focusId`.
   */
  onOpenLive?: (blogUrl: string, focusId: string) => void;
  /**
   * Story 7.2: true once when the live player left because the stream was
   * not playable at resolve time: the page shows the stream page's QR on
   * its return (focus back to the card).
   */
  takeLiveQrRequest?: () => boolean;
  /** `phaseFlags.search`: «Поиск в блоге» in the action row (Story 5.7). */
  searchEnabled?: boolean;
  /** `phaseFlags.filters`: the «Фильтры» chip; off → the default Filter. */
  filtersEnabled?: boolean;
  /** `phaseFlags.live`: the LiveCard (E15, Story 7.1); off → no E15, no card. */
  liveEnabled?: boolean;
  /**
   * Story 5.7: the route's Back hook. The page sets it to its handler (an
   * active search: clear it, focus the field, return true); the route calls
   * it first on Back.
   */
  backHandlerRef?: RefObject<(() => boolean) | null>;
};

/** The page's phase (also typed by `AuthorStates`). */
export type AuthorPhase = 'unavailable' | 'error' | 'loading' | 'postsError' | 'empty' | 'grid';
type Phase = AuthorPhase;

/** The outcome focus waits through the skeleton. */
const OUTCOME_WAIT_PHASES: readonly Phase[] = ['loading'];

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
 * the grid (`AuthorActionRow`): «Поиск в блоге» (E7 on «Готово», Поиск's
 * rules, `useAuthorSearch`; the results in the same grid and card ids), the
 * «Фильтры» chip (the route's own scope `author:<routeKey>`, dropped on
 * unmount; the blog's E14 tags; `useAuthorFilters`) and «Сбросить» (while a
 * search or a filter is active). Back clears an active search first (the
 * route asks `backHandlerRef`). The field is the nearest action above the
 * grid (the fallback chain's last step).
 *
 * Story 7.1 (LIVE-01, docs/focus-map.md §4 D): the LiveCard between the
 * action row and the grid (`LiveCard`, E15 through `useAuthorLiveStream`,
 * polled every 30 s while shown and focused). Initial focus is the card
 * when the stream is live; ↓ from the row reaches the card, ↓ from the card
 * the grid, ↑ from the grid's first row the card (its guide). When the card
 * goes while focused, the first post takes focus; a refetch never moves
 * focus otherwise (`useAuthorLiveFocus`).
 *
 * Story 7.2 (LIVE-02): OK on the card opens the live player when it is
 * playable, else the stream page's QR (`useAuthorLivePress`). Back from the
 * player returns to the card while it is shown, else to the first post.
 *
 * This component composes those pieces with the outcome focus
 * (`useOutcomeFocus`), and keeps the phase fallback, the route focus and
 * the head refocus.
 */
export function AuthorScreen({
  http,
  blogUrl,
  routeKey,
  focus,
  onBack,
  onOpenPost,
  onOpenLive,
  takeLiveQrRequest,
  searchEnabled = false,
  filtersEnabled = false,
  liveEnabled = false,
  backHandlerRef,
}: AuthorScreenProps) {
  const client = useQueryClient();
  const modal = useModal();
  const cardPrefix = authorCardPrefix(blogUrl);
  const retryId = authorRetryId(blogUrl);
  const fieldId = authorSearchId(blogUrl);
  const chipId = authorFiltersId(blogUrl);
  const resetId = authorResetId(blogUrl);
  const liveId = authorLiveId(blogUrl);
  // The search and filter actions call the outcome focus and the grid's
  // restoration, composed further down (they need the list the search
  // selects); the filter resets call the search. Read in handlers only,
  // never during render.
  const searchRef = useRef<AuthorSearch | null>(null);
  const outcomeRef = useRef<OutcomeFocus | null>(null);
  const restorationRef = useRef<ListRestoration | null>(null);

  const field = useAuthorField(fieldId);
  const { focusField, fieldAuto } = field;
  const liveCard = useAuthorLiveCard(liveId);
  const { stream, answered: liveAnswered } = useAuthorLiveStream(http, blogUrl, liveEnabled);
  const liveShown = stream !== null;
  const liveShownRef = useLatestRef(liveShown);

  // Story 5.7: the route's own Filter (owner decision 2026-10-29 Q3 b) and
  // its submitted query (local state; null: the normal list).
  const { filter, filtered, chipRef, onOpenFilters, onResetFilters, onResetAll } = useAuthorFilters({
    http,
    client,
    blogUrl,
    routeKey,
    filtersEnabled,
    modal,
    focusField,
    search: searchRef,
    outcome: outcomeRef,
  });
  const search = useAuthorSearch({
    client,
    blogUrl,
    routeKey,
    fieldId,
    filter,
    focusField,
    fieldAuto,
    backHandlerRef,
    outcome: outcomeRef,
    restoration: restorationRef,
  });
  searchRef.current = search;
  const { query } = search;
  const searching = query !== null;
  const rowShown = searchEnabled || filtersEnabled;

  const author = useAuthor(http, blogUrl);
  const posts = useAuthorPosts(http, blogUrl, filter);
  const blogSearch = useBlogSearch(http, blogUrl, query, filter);
  /** What the grid shows: the search results while a query is active, else the posts. */
  const list = searching ? blogSearch : posts;
  const listKey = useMemo(
    () =>
      query !== null
        ? queryKeys.blogSearch(blogUrl, query, filter)
        : queryKeys.authorPosts(blogUrl, filter),
    [blogUrl, query, filter],
  );
  const windowHeight = useWindowDimensions().height;
  // A bounded viewport (Story 2.4 device lesson): the content zone's height
  // (window − 2 × safe-y) minus the header, the action row and the grid's
  // top gap, and the LiveCard's block while it is shown (Story 7.1).
  const listHeight =
    windowHeight -
    2 * spacing['safe-y'] -
    AUTHOR_HEADER_HEIGHT -
    (rowShown ? AUTHOR_ACTION_ROW_TOP + AUTHOR_ACTION_ROW_HEIGHT : 0) -
    (liveShown ? LIVE_CARD_BLOCK_HEIGHT : 0) -
    POST_GRID_LIST_TOP_GAP;

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

  const {
    focusRef,
    latch,
    stateAction,
    stateActionView,
    stateActionRef,
    autoFocusSidebar,
    autoFocusAction,
    autoFocusLive,
    focusAbove,
    focusAfterLoss,
    canFocus,
    mayTakeFocus,
  } = useAuthorAutoFocus({
    focus,
    modal,
    field,
    live: liveCard,
    rowShown,
    cardPrefix,
    retryId,
    fieldId,
    chipId,
    resetId,
  });

  const restoration = useFocusRestoration({
    routeKey,
    sectionId: MAIN_SECTION,
    ids,
    listRef: adapterRef,
    focusAbove,
    canFocus,
  });
  restorationRef.current = restoration;

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
  /** Story 7.1: the page's own focus on the grid: the LiveCard while a stream is live, else the posts. */
  // Only this page's own E15 answer counts (a cached card may be stale).
  const liveRef = useLatestRef(liveAnswered && stream?.status === 'live');
  const focusGridOrLive = useCallback(() => {
    if (liveRef.current && liveCard.liveViewRef.current) {
      autoFocusLive();
    } else {
      restoreOrFirst();
    }
  }, [liveRef, liveCard.liveViewRef, autoFocusLive, restoreOrFirst]);

  // Story 7.2: OK on the LiveCard (the live player, else the stream page's QR).
  const { onLivePress, openLiveQr } = useAuthorLivePress({
    blogUrl,
    stream,
    card: liveCard,
    focusRef,
    modal,
    latch,
    onOpenLive,
  });
  const openLiveQrRef = useLatestRef(openLiveQr);
  const takeLiveQrRequestRef = useLatestRef(takeLiveQrRequest);

  // First focus of the route and every return to it (a screen on top
  // popped). Declared before the phase effect: on the first focus it only
  // covers the phases the phase effect leaves alone.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      const info = focusRef.current;
      let qrFrame: number | null = null;
      if (firstFocus.current) {
        firstFocus.current = false;
        if (phaseRef.current === 'loading' || phaseRef.current === 'empty') {
          autoFocusSidebar();
        }
      } else {
        const current = info.current();
        // Story 7.2: the live player left because the stream is not playable here.
        const liveQr = takeLiveQrRequestRef.current?.() === true;
        if (current === liveId && liveCard.liveViewRef.current) {
          // Story 7.1: back to the LiveCard it left from (Story 7.2: from the
          // live player too; a QR request opens over it).
          autoFocusLive();
          if (liveQr) {
            // A frame later: the route's own Back listener (added in this
            // focus pass, after this child effect) must be older than the
            // modal host's, so Back closes the QR first (focus-map §1.4).
            qrFrame = requestAnimationFrame(() => openLiveQrRef.current());
          }
        } else if (current === liveId && phaseRef.current === 'grid') {
          // The stream ended while covered (Story 7.2: e.g. the live player's
          // «Стрим завершён»): the first post, where the card was
          // (focus-map §4 D). Not `restoreOrFirst`: it would restore the
          // remembered card id.
          latch.auto(idsRef.current[0]);
          restoration.focusInitial();
        } else if (current !== null && current.startsWith(cardPrefix) && phaseRef.current === 'grid') {
          restoreOrFirst();
        } else if (!(current !== null && current !== info.sectionItemId && info.focusZoneTarget())) {
          autoFocusSidebar();
        }
      }
      return () => {
        if (qrFrame !== null) {
          cancelAnimationFrame(qrFrame);
        }
        restoration.cancel();
      };
    }, [focusRef, cardPrefix, restoreOrFirst, restoration, autoFocusSidebar, phaseRef, liveId, liveCard.liveViewRef, autoFocusLive, latch, takeLiveQrRequestRef, openLiveQrRef]),
  );

  /**
   * Story 5.7 (Поиск's rules): «Готово», a search «Повторить» or «Сбросить
   * фильтры» waits for its outcome: the first result, else the field /
   * «Сбросить фильтры», else «Повторить». It lands only while focus is
   * still on the element that started the wait and no modal is open.
   */
  const mayTakeOutcomeFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive() || modal.isOpen()) {
      return false;
    }
    const current = info.current();
    return current === null || current === fieldId || current === AUTHOR_STATE_ACTION_ID;
  }, [focusRef, modal, fieldId]);
  const outcome = useOutcomeFocus<Phase>({
    client,
    phase,
    isFetching: list.isFetching,
    shownKey: listKey,
    mayTakeFocus: mayTakeOutcomeFocus,
    waitPhases: OUTCOME_WAIT_PHASES,
    onOutcome: settled => {
      if (settled === 'grid') {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        restoration.focusInitial();
      } else if (settled === 'postsError' || (settled === 'empty' && filtered)) {
        requestHostFocus(stateActionView.current);
      } else {
        focusField();
      }
    },
  });
  outcomeRef.current = outcome;
  const { awaitOutcome, resolve: resolveOutcome } = outcome;

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
        focusGridOrLive();
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

  // Story 7.1: while the live card holds the page's own focus, a head
  // refresh never moves it to the new first post (a first post that took
  // the initial focus beside a scheduled card still follows the head).
  const followHeadUnlessLive = useCallback(
    (focused: string | null) =>
      !(liveShownRef.current && focused === liveId) && latch.followHead(focused),
    [liveShownRef, liveId, latch],
  );

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
    followHead: followHeadUnlessLive,
    onFollowHead: latch.onFollowHead,
  });

  // Story 7.1: the LiveCard's initial focus and card loss.
  useAuthorLiveFocus({
    stream,
    answered: liveAnswered,
    card: liveCard,
    focusRef,
    modal,
    latch,
    restoration,
    idsRef,
    mayTakeFocus,
    autoFocusLive,
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

  const { rowFocus, downTarget } = useAuthorActionRowFocus({
    focus,
    cardPrefix,
    fieldId,
    chipId,
    resetId,
    liveId,
    liveShown,
    fieldAuto,
    ids,
    gridShown: phase === 'grid',
    restoration,
  });

  const chip = filtersEnabled ? chipLabels(filter) : null;
  const showReset = rowShown && (searching || filtered);
  const downDestinations = useMemo(() => (downTarget ? [downTarget] : []), [downTarget]);
  const liveDestinations = useMemo(
    () => (liveCard.liveView ? [liveCard.liveView] : []),
    [liveCard.liveView],
  );

  if (phase === 'unavailable' || phase === 'error') {
    return (
      <View testID="author/page" style={styles.root}>
        <AuthorPageState
          unavailable={phase === 'unavailable'}
          error={author.error}
          isFetching={author.isFetching}
          onBack={onBack}
          onRetryAll={onRetryAll}
          stateActionRef={stateActionRef}
          onStateActionFocus={stateAction.onFocus}
        />
      </View>
    );
  }

  return (
    <View testID="author/page" style={styles.root}>
      {author.author ? (
        <AuthorHeader author={author.author} testID="author/header" />
      ) : (
        <AuthorHeaderSkeleton testID="author/header-skeleton" />
      )}
      {rowShown ? (
        <AuthorActionRow
          searchEnabled={searchEnabled}
          fieldId={fieldId}
          fieldView={field.fieldView}
          fieldHostRef={field.fieldHostRef}
          onFieldFocus={field.onFieldFocus}
          draft={search.draft}
          onChangeDraft={search.onChangeDraft}
          onSubmit={search.onSubmit}
          chip={chip}
          chipId={chipId}
          chipRef={chipRef}
          onOpenFilters={onOpenFilters}
          showReset={showReset}
          resetId={resetId}
          onResetAll={onResetAll}
          rowFocus={rowFocus}
        />
      ) : null}
      {stream !== null ? (
        // Story 7.1: ↑ from any grid column (and ↓ from the action row)
        // enters this guide and lands on the card.
        <TVFocusGuideView
          testID="author/live/guide"
          destinations={liveDestinations}
          style={liveCardBlockStyle}
        >
          <LiveCard
            ref={liveCard.liveHostRef}
            testID={liveId}
            stream={stream}
            onFocus={liveCard.onLiveFocus}
            onPress={onLivePress}
          />
        </TVFocusGuideView>
      ) : null}
      <AuthorListState
        phase={phase}
        searching={searching}
        filtered={filtered}
        firstPageError={list.firstPageError}
        isFetching={list.isFetching}
        onRetryList={onRetryList}
        onResetFilters={onResetFilters}
        stateActionRef={stateActionRef}
        onStateActionFocus={stateAction.onFocus}
      />
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
  gridGuide: {
    width: spacing['content-width'],
  },
});
