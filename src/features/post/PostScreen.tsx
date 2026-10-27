import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TVFocusGuideView, View } from 'react-native';
import type { HttpClient } from '../../shared/api';
import {
  postBodyItems,
  videoRowsOf,
  type PostBodyItem,
  type VideoRow,
} from '../../shared/entities/post';
import { useZoneItem } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { StateView, requestHostFocus, spacing, type HostView } from '../../shared/ui';
import { PostBody, PostBodySkeleton, PostVideoRows } from './PostBody';
import { PostHeader, PostHeaderSkeleton } from './PostHeader';
import { usePost } from './usePost';

/** Focus ids (docs/focus-map.md §1.5). */
export const POST_STATE_ACTION_ID = 'state/post/action';
export const postIdPrefix = (postId: string) => `post/${postId}/`;
export const postAuthorId = (postId: string) => `post/${postId}/author`;
export const postBlockPrefix = (postId: string) => `post/${postId}/block/`;
export const postBlockId = (postId: string, blockKey: string) =>
  `${postBlockPrefix(postId)}${blockKey}`;
export const postVideoPrefix = (postId: string) => `post/${postId}/video/`;
export const postVideoId = (postId: string, mediaId: string) =>
  `${postVideoPrefix(postId)}${mediaId}`;

const NO_DESTINATIONS: HostView[] = [];

/** What the route tells the Post page about focus (it owns the sidebar and the zone). */
export type PostFocusInfo = {
  /** The Post route is the focused route; a covered or closing one never takes focus. */
  isActive(): boolean;
  /** The last focused element on the route (sidebar or content id); null: none yet. */
  current(): string | null;
  /** The sidebar's current item (the origin section, `post/nav/<section>`). */
  sectionItemId: string;
  /** Focus the sidebar's current item. */
  focusSidebar(): void;
  /** Focus the content zone's remembered element; false when it has none. */
  focusZoneTarget(): boolean;
};

export type PostScreenProps = {
  /** The active session's content client (from the route; never a singleton). */
  http: HttpClient;
  /** The post's blog (route-safe: it passed `blogUrlSchema` in the post mapper). */
  blogUrl: string;
  postId: string;
  focus: PostFocusInfo;
  /** «Назад» on «Пост недоступен»: pop. */
  onBack: () => void;
  /** OK on the author row: open Автор for this blog. */
  onOpenAuthor: (blogUrl: string) => void;
  /**
   * `phaseFlags.player` (AD-20), passed by the route: off → the MediaRows
   * have no action. Epic 4 adds the action when it is on.
   */
  playerEnabled: boolean;
};

type Phase = 'unavailable' | 'error' | 'loading' | 'ready';

/**
 * F Пост (Story 3.4, docs/focus-map.md §4 F): E8 in one scrolling column
 * (owner decision 2026-10-27, header on top). First the header: the author
 * row (OK → Автор), the title and the meta line (date · likes, read only);
 * it scrolls away with the content (never pinned). Then one MediaRow per
 * video (Story 3.5, in block order), then the blocks as plain paragraphs
 * (each a ParagraphStop) and neutral non-focusable placeholders, the text
 * capped at `spacing['text-measure']`. Not here yet:
 * «Смотреть» and progress (Epic 4), the locked copy (3.6), styles, collapse
 * and real blocks (Epic 6). A locked post shows its header and teaser
 * placeholders (no rows).
 *
 * Focus:
 * - Skeleton: nothing focusable in content; focus goes to the sidebar's
 *   current item explicitly (it must leave the covered screen below).
 * - When the post arrives, the first MediaRow takes focus, else the first
 *   paragraph (a locked post or one with neither: the author) only if the user has not moved (focus
 *   still on the sidebar's current item, nothing yet, or the StateView
 *   action just pressed). A StateView action takes focus the same way, or
 *   when the focused content it replaces is gone.
 * - ↓ ↑ move through the author, the rows, then the paragraphs, natively
 *   (the column scrolls the focused one into view; ↑ from the first row or
 *   paragraph reaches the author). The column's guide traps ↑ ↓; its
 *   destination is the last focused element of the column, else the
 *   initial one. ← from any of them → the sidebar's current item; → from
 *   the sidebar → the content zone's remembered element.
 * - A refetch never moves focus, unless the focused row or paragraph is
 *   gone: the initial target then.
 * - Return to the route (Автор on top popped): the remembered element
 *   through the content zone, else the sidebar's current item.
 */
export function PostScreen({
  http,
  blogUrl,
  postId,
  focus,
  onBack,
  onOpenAuthor,
  playerEnabled,
}: PostScreenProps) {
  const state = usePost(http, blogUrl, postId);
  const { post } = state;
  const phase: Phase = state.unavailable
    ? 'unavailable'
    : state.error !== null
      ? 'error'
      : post !== null
        ? 'ready'
        : 'loading';

  const authorId = postAuthorId(postId);
  const blockPrefix = postBlockPrefix(postId);
  const videoPrefix = postVideoPrefix(postId);
  const contentPrefix = postIdPrefix(postId);

  // The MediaRows (an accessible post's videos with an id, deduped) and the
  // body: the other blocks of an accessible post, the teaser of a locked one.
  const rows: readonly VideoRow[] = useMemo(() => (post === null ? [] : videoRowsOf(post)), [post]);
  const items: readonly PostBodyItem[] = useMemo(
    () =>
      post === null
        ? []
        : post.hasAccess
          ? postBodyItems(post.blocks, { videoRows: true })
          : postBodyItems(post.teaser),
    [post],
  );
  /** The first stop below the header: the first MediaRow, else the first paragraph. */
  const firstStopId = useMemo(() => {
    if (rows.length > 0) {
      return `${videoPrefix}${rows[0].ref.mediaId}`;
    }
    const first = items.find(item => item.kind === 'paragraph');
    return first ? `${blockPrefix}${first.key}` : null;
  }, [rows, items, videoPrefix, blockPrefix]);
  /** The first row or paragraph; a locked post or one with neither: the author. */
  const initialId = post !== null && post.hasAccess && firstStopId !== null ? firstStopId : authorId;

  const focusRef = useRef(focus);
  focusRef.current = focus;
  const views = useRef(new Map<string, HostView>());
  const initialRef = useRef(initialId);
  initialRef.current = initialId;

  // The column's guide: focus entering the column lands on its last
  // focused element (author, row or paragraph), else the initial one.
  const lastFocused = useRef<string | null>(null);
  const [columnTarget, setColumnTarget] = useState<HostView | null>(null);
  const refreshColumnTarget = useCallback(() => {
    const remembered = lastFocused.current ? views.current.get(lastFocused.current) : undefined;
    const next = remembered ?? views.current.get(initialRef.current) ?? null;
    setColumnTarget(prev => (prev === next ? prev : next));
  }, []);
  const columnDestinations = useMemo(
    () => (columnTarget ? [columnTarget] : NO_DESTINATIONS),
    [columnTarget],
  );

  /** A column element's host view (author, row or paragraph), by focus id. */
  const onStopView = useCallback((id: string, view: HostView | null) => {
    if (view) {
      views.current.set(id, view);
    } else {
      views.current.delete(id);
    }
  }, []);
  const onStopFocus = useCallback(
    (id: string) => {
      lastFocused.current = id;
      refreshColumnTarget();
    },
    [refreshColumnTarget],
  );

  const authorZone = useZoneItem(authorId);
  const authorRef = useCallback(
    (view: HostView | null) => {
      authorZone.ref?.(view);
      onStopView(authorId, view);
      refreshColumnTarget();
    },
    [authorZone, authorId, onStopView, refreshColumnTarget],
  );
  const onAuthorFocus = useCallback(() => {
    authorZone.onFocus();
    onStopFocus(authorId);
  }, [authorZone, authorId, onStopFocus]);
  useEffect(() => {
    refreshColumnTarget();
  }, [rows, items, initialId, refreshColumnTarget]);

  const stateAction = useZoneItem(POST_STATE_ACTION_ID);
  const stateActionView = useRef<HostView | null>(null);
  const stateActionRef = useCallback(
    (view: HostView | null) => {
      stateActionView.current = view;
      stateAction.ref?.(view);
    },
    [stateAction],
  );

  const focusInitial = useCallback(() => {
    const view = views.current.get(initialRef.current);
    if (view) {
      requestHostFocus(view);
    }
  }, []);
  const focusAction = useCallback(() => {
    requestHostFocus(stateActionView.current);
  }, []);

  /** The user has not moved focus away from where the page may take it. */
  const mayTakeFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive()) {
      return false;
    }
    const current = info.current();
    return current === null || current === info.sectionItemId || current === POST_STATE_ACTION_ID;
  }, []);
  /** Focus was on this page's content (now replaced or gone). */
  const contentFocused = useCallback(() => {
    const info = focusRef.current;
    const current = info.current();
    return (
      info.isActive() &&
      current !== null &&
      (current.startsWith(contentPrefix) || current === POST_STATE_ACTION_ID)
    );
  }, [contentPrefix]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // First focus of the route and every return to it (Автор on top popped).
  // Declared before the phase effect: on the first focus it only covers the
  // skeleton, which the phase effect leaves alone.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      const info = focusRef.current;
      if (firstFocus.current) {
        firstFocus.current = false;
        if (phaseRef.current === 'loading') {
          info.focusSidebar();
        }
        return;
      }
      const current = info.current();
      if (!(current !== null && current !== info.sectionItemId && info.focusZoneTarget())) {
        info.focusSidebar();
      }
    }, []),
  );

  const lastPhase = useRef<Phase | null>(null);
  useEffect(() => {
    const previous = lastPhase.current;
    lastPhase.current = phase;
    if (previous === phase) {
      return;
    }
    if (phase !== 'ready') {
      // The column is gone (skeleton or StateView): forget its remembered element.
      lastFocused.current = null;
    }
    if (phase === 'ready') {
      if (mayTakeFocus()) {
        focusInitial();
      }
    } else if (phase === 'loading') {
      // The skeleton has nothing focusable: focused content is gone.
      if (contentFocused()) {
        focusRef.current.focusSidebar();
      }
    } else if (mayTakeFocus() || contentFocused()) {
      // A StateView with its one action (Повторить / Назад).
      focusAction();
    }
  }, [phase, mayTakeFocus, contentFocused, focusInitial, focusAction]);

  // A refetch changed the blocks and the focused row or paragraph is gone:
  // the initial target (its view is already unmounted when this runs).
  useEffect(() => {
    const info = focusRef.current;
    const current = info.current();
    if (
      phaseRef.current === 'ready' &&
      info.isActive() &&
      current !== null &&
      (current.startsWith(blockPrefix) || current.startsWith(videoPrefix)) &&
      !views.current.has(current)
    ) {
      if (lastFocused.current === current) {
        lastFocused.current = null;
      }
      focusInitial();
    }
  }, [rows, items, blockPrefix, videoPrefix, focusInitial]);

  const authorBlogUrl = post?.author.blogUrl ?? null;
  const onAuthorPress = useCallback(() => {
    if (authorBlogUrl !== null) {
      onOpenAuthor(authorBlogUrl);
    }
  }, [authorBlogUrl, onOpenAuthor]);

  if (phase === 'unavailable' || phase === 'error') {
    const unavailable = phase === 'unavailable';
    return (
      <View testID="post/page" style={styles.root}>
        <View testID={unavailable ? 'post/unavailable' : 'post/error'} style={styles.state}>
          <StateView
            title={unavailable ? t('post.unavailableTitle') : t('post.errorTitle')}
            body={unavailable ? t('post.unavailableBody') : t(`error.${state.error ?? 'Client'}`)}
            action={{
              label: unavailable ? t('common.back') : t('common.retry'),
              onPress: unavailable ? onBack : state.refetch,
              busy: unavailable ? false : state.isFetching,
              testID: POST_STATE_ACTION_ID,
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
    <View testID="post/page" style={styles.root}>
      <TVFocusGuideView
        testID="post/column"
        style={styles.column}
        destinations={columnDestinations}
        trapFocusUp
        trapFocusDown
      >
        {post !== null ? (
          <ScrollView
            testID="post/body"
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
          >
            <PostHeader
              post={post}
              authorId={authorId}
              authorRef={authorRef}
              onAuthorFocus={onAuthorFocus}
              onAuthorPress={onAuthorPress}
            />
            <PostVideoRows
              rows={rows}
              idPrefix={videoPrefix}
              playable={playerEnabled}
              onRowView={onStopView}
              onRowFocus={onStopFocus}
            />
            <PostBody
              items={items}
              idPrefix={blockPrefix}
              onParagraphView={onStopView}
              onParagraphFocus={onStopFocus}
            />
          </ScrollView>
        ) : (
          <View
            style={styles.scrollContent}
            accessible
            accessibilityLabel={t('post.loading')}
          >
            <PostHeaderSkeleton />
            <PostBodySkeleton />
          </View>
        )}
      </TVFocusGuideView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  column: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  // Focus headroom around the author row, the rows and the paragraphs;
  // room below the last one.
  scrollContent: {
    paddingHorizontal: spacing['focus-headroom'],
    paddingTop: spacing['focus-headroom'],
    paddingBottom: spacing['safe-y'],
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
