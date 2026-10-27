import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HttpClient } from '../../shared/api';
import { MAIN_SECTION, useFocusRestoration, useZoneItem } from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  POST_GRID_CARD_WIDTH,
  POST_GRID_COLUMNS,
  POST_GRID_LIST_TOP_GAP,
  PostCardSkeleton,
  PostGrid,
  StateView,
  postGridListAdapter,
  requestHostFocus,
  spacing,
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

/** Focus ids (docs/focus-map.md §1.5). */
export const AUTHOR_STATE_ACTION_ID = 'state/author/action';
export const authorCardPrefix = (blogUrl: string) => `author/${blogUrl}/post/`;
export const authorCardId = (blogUrl: string, postId: string) =>
  `${authorCardPrefix(blogUrl)}${postId}`;
export const authorRetryId = (blogUrl: string) => `author/${blogUrl}/retry`;

const SKELETON_ROWS = 2;

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
 */
export function AuthorScreen({
  http,
  blogUrl,
  routeKey,
  focus,
  onBack,
  onOpenPost,
}: AuthorScreenProps) {
  const author = useAuthor(http, blogUrl);
  const posts = useAuthorPosts(http, blogUrl);
  const windowHeight = useWindowDimensions().height;
  // A bounded viewport (Story 2.4 device lesson): the content zone's height
  // (window − 2 × safe-y) minus the header and the grid's top gap.
  const listHeight =
    windowHeight - 2 * spacing['safe-y'] - AUTHOR_HEADER_HEIGHT - POST_GRID_LIST_TOP_GAP;

  const cardPrefix = authorCardPrefix(blogUrl);
  const retryId = authorRetryId(blogUrl);
  const listRef = useRef<FlashListRef<PostRowItem>>(null);
  const adapterRef = useRef(postGridListAdapter(listRef));

  // A trailing partial row is held while more pages may come (PostGrid);
  // a failing next page shows it, and so does a focused card in it (a head
  // refresh can move the focused card there; `useShownGridPosts`).
  const shownPosts = useShownGridPosts(
    posts.posts,
    posts.hasNextPage && !posts.loadMoreFailed,
    focus.current(),
    cardPrefix,
  );
  const ids = useMemo(() => shownPosts.map(post => `${cardPrefix}${post.id}`), [shownPosts, cardPrefix]);
  useHeldRowAutoFetch(posts, shownPosts.length);

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
  // "The user has not moved since the page opened" (reopen focus, owner
  // decision 2026-10-27; shared with Главная, `useNotMovedLatch`): armed
  // from the start; every element the page focuses by itself (the sidebar
  // item, the StateView action, a card) is recorded as automatic.
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
  // Nothing above the grid (no search or filters before Epic 5): the
  // StateView action when shown, else the sidebar's current item.
  const focusAbove = useCallback(() => {
    if (stateActionView.current) {
      autoFocusAction();
    } else {
      autoFocusSidebar();
    }
  }, [autoFocusAction, autoFocusSidebar]);
  // A pending card focus lands only while the route is active and focus is
  // still where the page may take it: none yet, the sidebar's current item,
  // a card, the StateView action or the load-more «Повторить».
  const canFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive()) {
      return false;
    }
    const current = info.current();
    return (
      current === null ||
      current === info.sectionItemId ||
      current === AUTHOR_STATE_ACTION_ID ||
      current === retryId ||
      current.startsWith(cardPrefix)
    );
  }, [cardPrefix, retryId]);

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
      : posts.isPending
        ? 'loading'
        : posts.firstPageError !== null
          ? 'postsError'
          : posts.posts.length === 0
            ? 'empty'
            : 'grid';
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  /** The user has not moved focus away from where the page may take it. */
  const mayTakeFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive()) {
      return false;
    }
    const current = info.current();
    return (
      current === null || current === info.sectionItemId || current === AUTHOR_STATE_ACTION_ID
    );
  }, []);

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
    if (restoration.restore().kind === 'none') {
      latch.auto(idsRef.current[0]);
      restoration.focusInitial();
    }
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
    }, [cardPrefix, restoreOrFirst, restoration, autoFocusSidebar]),
  );

  const lastPhase = useRef<Phase | null>(null);
  useEffect(() => {
    const previous = lastPhase.current;
    lastPhase.current = phase;
    if (previous === phase) {
      return;
    }
    const info = focusRef.current;
    const current = info.current();
    const contentLost =
      info.isActive() &&
      current !== null &&
      (current.startsWith(cardPrefix) || current === retryId || current === AUTHOR_STATE_ACTION_ID);
    if (phase === 'loading') {
      // The skeleton has nothing focusable: a focused action (an E3 retry
      // that succeeded while E4 still loads) or card is gone.
      if (contentLost) {
        autoFocusSidebar();
      }
    } else if (phase === 'grid') {
      if (mayTakeFocus()) {
        restoreOrFirst();
      }
    } else if (phase === 'empty') {
      // Nothing focusable in content: a focused action or card is gone.
      if (contentLost) {
        autoFocusSidebar();
      }
    } else if (mayTakeFocus() || contentLost) {
      // A StateView with its one action (Повторить / Назад).
      autoFocusAction();
    }
  }, [phase, mayTakeFocus, restoreOrFirst, cardPrefix, retryId, autoFocusSidebar, autoFocusAction]);

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

  const onRetryLoadMore = useLoadMoreRetry(posts, ids, restoration, () => {
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

  return (
    <View testID="author/page" style={styles.root}>
      {author.author ? (
        <AuthorHeader author={author.author} testID="author/header" />
      ) : (
        <AuthorHeaderSkeleton testID="author/header-skeleton" />
      )}
      {phase === 'loading' ? (
        <View
          testID="author/skeleton"
          style={styles.skeleton}
          accessible
          accessibilityLabel={t('author.loadingPosts')}
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
      {phase === 'postsError' && posts.firstPageError !== null ? (
        <View testID="author/posts-error" style={styles.state}>
          <StateView
            title={t('author.postsErrorTitle')}
            body={t(`error.${posts.firstPageError}`)}
            action={{
              label: t('common.retry'),
              onPress: posts.refetch,
              busy: posts.isFetching,
              testID: AUTHOR_STATE_ACTION_ID,
              ref: stateActionRef,
              onFocus: stateAction.onFocus,
            }}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'empty' ? (
        <View testID="author/empty" style={styles.state}>
          <StateView
            title={t('author.emptyTitle')}
            body={t('author.emptyBody')}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'grid' ? (
        <PostGrid
          posts={shownPosts}
          height={listHeight}
          restoration={restoration}
          listRef={listRef}
          hasNextPage={posts.hasNextPage}
          isFetchingNextPage={posts.isFetchingNextPage}
          loadMoreFailed={posts.loadMoreFailed}
          onLoadMore={posts.fetchNextPage}
          onRetry={onRetryLoadMore}
          onCardPress={onCardPress}
          cardIdPrefix={cardPrefix}
          retryId={retryId}
          testIDPrefix="author/posts"
          showPinned
          loadMoreErrorLabel={t('author.loadMoreError')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
