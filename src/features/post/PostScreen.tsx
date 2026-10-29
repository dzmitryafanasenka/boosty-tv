import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TVFocusGuideView,
  View,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';
import type { HttpClient } from '../../shared/api';
import {
  isFocusStop,
  postBodyItems,
  videoRowsOf,
  type MediaRef,
  type Post,
  type PostBodyItem,
  type VideoRow,
} from '../../shared/entities/post';
import {
  mayTakeScreenFocus,
  useLatestRef,
  useModal,
  usePhaseChange,
  useZoneItem,
} from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  progressStatus,
  useProgress,
  useProgressRepository,
  type ProgressSnapshot,
  type ProgressStatus,
} from '../../shared/services/progress';
import { QrDialog, StateView, requestHostFocus, spacing, type HostView } from '../../shared/ui';
import {
  PostBody,
  PostBodySkeleton,
  PostPrimaryAction,
  PostVideoRows,
  TEASER_IMAGE_GAP,
  type OpenPost,
  type PlayAt,
  type OpenQr,
} from './PostBody';
import { LOCKED_NOTICE_GAP, LockedNotice } from './LockedNotice';
import { PostHeader, PostHeaderSkeleton } from './PostHeader';
import { useAudioSource, useFileTarget, usePost } from './usePost';

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
/** «Смотреть» / «Продолжить» under the header (Story 4.1, 4.2). */
export const postPrimaryId = (postId: string) => `post/${postId}/primary`;
/** «С начала», to the right of the primary (Story 4.2, owner decision 2026-10-28). */
export const postRestartId = (postId: string) => `post/${postId}/restart`;

/**
 * The primary's target (Story 4.2): the first unfinished video; `resume`
 * when it has progress > 0 («Продолжить», «С начала»). All finished: the
 * first video, no resume («Смотреть», it starts at 0). Null without rows.
 */
export function primaryTarget(
  rows: readonly VideoRow[],
  statuses: readonly (ProgressStatus | null)[],
): { row: VideoRow; resume: boolean } | null {
  for (let i = 0; i < rows.length; i += 1) {
    const status = statuses[i];
    if (status?.kind !== 'watched') {
      return {
        row: rows[i],
        resume: status?.kind === 'inProgress' || status?.kind === 'unknown',
      };
    }
  }
  return rows.length > 0 ? { row: rows[0], resume: false } : null;
}

/**
 * Story 4.5 (focus-map G «Ended»): where focus lands on the Post after a
 * video played to its real end: the first unfinished MediaRow after the
 * ended one (post order, the 4.2 finished rule), else the primary button.
 * `snapshot` is the progress of a media id (local entry, else server).
 */
export function endedReturnFocusId(
  post: Post,
  endedMediaId: string,
  snapshot: (mediaId: string) => ProgressSnapshot | null,
): string {
  const rows = videoRowsOf(post);
  const ended = rows.findIndex(row => row.ref.mediaId === endedMediaId);
  for (let i = ended + 1; ended >= 0 && i < rows.length; i += 1) {
    const snap = snapshot(rows[i].ref.mediaId);
    const status = progressStatus(snap?.positionSec ?? null, snap?.durationSec ?? rows[i].durationSec);
    if (status.kind !== 'watched') {
      return postVideoId(post.id, rows[i].ref.mediaId);
    }
  }
  return postPrimaryId(post.id);
}

const NO_DESTINATIONS: HostView[] = [];

/** The smallest teaser image cap, even when a long title leaves less room. */
export const TEASER_IMAGE_MIN_HEIGHT = 96;

/** The column's padding (focus headroom around the stops, room below the last one). */
export const COLUMN_PADDING_X = spacing['focus-headroom'];
export const COLUMN_PADDING_TOP = spacing['focus-headroom'];
export const COLUMN_PADDING_BOTTOM = spacing['safe-y'];

/**
 * The tallest a locked post's teaser image may be (owner decision
 * 2026-10-27, «Teaser fits the screen»): the column's measured viewport
 * height, minus the copy's measured bottom (its y + height in the column's
 * content: top padding, header and copy), the gap under the copy, the
 * image's own bottom margin and the column's bottom padding, so the header,
 * the copy and one image fit without scrolling. Until the viewport is
 * measured: the minimum; until the copy is: half the viewport. Never below
 * `TEASER_IMAGE_MIN_HEIGHT`.
 */
export function teaserImageMaxHeight(viewportHeight: number | null, copyBottom: number | null): number {
  if (viewportHeight === null) {
    return TEASER_IMAGE_MIN_HEIGHT;
  }
  const room =
    copyBottom === null
      ? viewportHeight / 2
      : viewportHeight - copyBottom - LOCKED_NOTICE_GAP - TEASER_IMAGE_GAP - COLUMN_PADDING_BOTTOM;
  return Math.max(TEASER_IMAGE_MIN_HEIGHT, Math.floor(room));
}

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
   * OK on the primary or a MediaRow (Story 4.1): open the Player for `ref`;
   * `focusId` is the element that opened it (exit returns focus there).
   * «С начала» (Story 4.2) passes `beginning`: the video starts at 0.
   */
  onOpenPlayer: (ref: MediaRef, focusId: string, start?: 'beginning' | { atSec: number }) => void;
  /**
   * Story 6.3 (owner decision 2026-10-29): OK on a link chip to another
   * Boosty post opens that Пост on top (Back returns to the chip).
   */
  onOpenPost?: OpenPost;
  /**
   * `phaseFlags.player` (AD-20), passed by the route: off → no «Смотреть»
   * and the MediaRows have no action.
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
 * capped at `spacing['text-measure']`. With the player on (Story 4.1), a
 * post with videos shows «Смотреть» right under the header (before the
 * rows) and OK on it or on a row opens the Player. Story 4.2: the primary
 * targets the first unfinished video («Продолжить» when it has progress,
 * «С начала» to its right), and each MediaRow shows its status, all from
 * `useProgress` (the local entry, else the server `timeCode` that this
 * screen's E8 hands to the ProgressRepository). Not here yet: styles,
 * collapse and real blocks (Epic 6). A locked post (Story 3.6) shows its header, the no-access copy
 * (`LockedNotice`, with the level name when known; never a price or a
 * subscribe action), then its teaser: images, paragraphs and placeholders
 * (no rows). A locked post is never an error; `usePost` first asks the
 * SessionCheck port (E1) whether a dead session hides behind it (Epic 3
 * retro A6).
 *
 * Focus:
 * - Skeleton: nothing focusable in content; focus goes to the sidebar's
 *   current item explicitly (it must leave the covered screen below).
 * - When the post arrives, «Смотреть» takes focus, else the first MediaRow,
 *   else the first paragraph (a locked post or one with neither: the
 *   author) only if the user has not moved (focus
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
  onOpenPlayer,
  onOpenPost,
  playerEnabled,
}: PostScreenProps) {
  const progress = useProgressRepository();
  const state = usePost(http, blogUrl, postId, progress?.onServerProgress);
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
  const primaryId = postPrimaryId(postId);
  const restartId = postRestartId(postId);

  // The MediaRows (an accessible post's videos with an id, deduped) and the
  // body: the other blocks of an accessible post, the teaser of a locked one
  // (its images shown, Story 3.6).
  const rows: readonly VideoRow[] = useMemo(() => (post === null ? [] : videoRowsOf(post)), [post]);
  const items: readonly PostBodyItem[] = useMemo(
    () =>
      post === null
        ? []
        : post.hasAccess
          ? postBodyItems(post.blocks, {
              videoRows: true,
              images: 'stops',
              qr: true,
              // Story 6.4: the AudioBlock plays through the PlayerEngine (the player capability).
              audio: playerEnabled,
              selfPost: { blogUrl: post.author.blogUrl, postId: post.id },
            })
          : postBodyItems(post.teaser, { images: true }),
    [post, playerEnabled],
  );
  /** «Смотреть» (Story 4.1): an accessible post with a video, while the player is on. */
  const showPrimary = playerEnabled && rows.length > 0;
  // Story 4.2: each row's progress (the local entry, else the server
  // `timeCode`), only through `useProgress`; the row's own duration applies
  // when the local entry has none.
  const refs = useMemo(() => rows.map(row => row.ref), [rows]);
  const snapshots = useProgress(refs);
  const statuses = useMemo(
    () =>
      rows.map((row, i) => {
        const snap = snapshots[i] ?? null;
        return progressStatus(snap?.positionSec ?? null, snap?.durationSec ?? row.durationSec);
      }),
    [rows, snapshots],
  );
  const primary = useMemo(() => primaryTarget(rows, statuses), [rows, statuses]);
  /** «С начала»: only when the primary's target has progress > 0. */
  const showRestart = showPrimary && primary !== null && primary.resume;

  /**
   * The first stop below the header: «Смотреть», else the first MediaRow,
   * else the first paragraph.
   */
  const firstStopId = useMemo(() => {
    if (showPrimary) {
      return primaryId;
    }
    if (rows.length > 0) {
      return `${videoPrefix}${rows[0].ref.mediaId}`;
    }
    const first = items.find(isFocusStop);
    return first ? `${blockPrefix}${first.key}` : null;
  }, [showPrimary, primaryId, rows, items, videoPrefix, blockPrefix]);
  // The column's measured viewport and content height (the ScrollView's
  // layout and content size).
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const onColumnLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport(prev => (prev?.width === width && prev?.height === height ? prev : { width, height }));
  }, []);
  const onContentSizeChange = useCallback((_w: number, h: number) => setContentHeight(h), []);
  // The teaser image cap follows the viewport and the copy's measured bottom
  // (its y + height in the column's content, which includes the top padding).
  // The measure belongs to one post state: a post change or a refetch that
  // changes `hasAccess` forgets it (a later lock measures the copy again).
  const copyKey = post === null ? null : `${post.id}:${post.hasAccess}`;
  const [copyBottom, setCopyBottom] = useState<number | null>(null);
  useEffect(() => {
    setCopyBottom(null);
  }, [copyKey]);
  const onCopyLayout = useCallback((e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    setCopyBottom(prev => (prev === y + height ? prev : y + height));
  }, []);
  const imageMaxHeight = teaserImageMaxHeight(viewport?.height ?? null, copyBottom);
  const columnWidth = viewport === null ? null : viewport.width - 2 * COLUMN_PADDING_X;

  // Scrolling stays on with a focus stop below the author (native focus
  // scroll) or when the content is taller than the viewport (reachable
  // overflow). Content that fits with nothing focusable below the author
  // turns it off: on Android `scrollEnabled={false}` also makes the
  // ScrollView non-focusable and leaves ↑ ↓ to focus search (RN's ScrollView
  // ignores `focusable`), so ↓ keeps focus on the author (Story 3.6, device).
  const overflows =
    viewport === null || contentHeight === null || contentHeight > viewport.height + 0.5;
  const scrollEnabled = firstStopId !== null || overflows;
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  useEffect(() => {
    if (!scrollEnabled) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [scrollEnabled]);

  /**
   * «Смотреть», else the first row or paragraph; a locked post or one with
   * neither: the author.
   */
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
  }, [rows, items, showPrimary, showRestart, initialId, refreshColumnTarget]);

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
  const mayTakeFocus = useCallback(
    () => mayTakeScreenFocus(focusRef.current, POST_STATE_ACTION_ID),
    [],
  );
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

  const phaseRef = useLatestRef(phase);
  const restartRef = useLatestRef(restartId);
  const primaryRef = useLatestRef(primaryId);

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
      // «С начала» opened the player and is gone now (that video is
      // finished): the primary instead (Story 4.2).
      if (current === restartRef.current && !views.current.has(current)) {
        const primaryView = views.current.get(primaryRef.current);
        if (primaryView) {
          requestHostFocus(primaryView);
          return;
        }
      }
      if (!(current !== null && current !== info.sectionItemId && info.focusZoneTarget())) {
        info.focusSidebar();
      }
    }, [phaseRef, restartRef, primaryRef]),
  );

  usePhaseChange(phase, () => {
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
  });

  // A refetch changed the blocks and the focused row or paragraph is gone:
  // the initial target (its view is already unmounted when this runs). A
  // focused «С начала» that disappears (Story 4.2) falls back to the
  // primary, which is the initial target whenever «С начала» exists.
  useEffect(() => {
    const info = focusRef.current;
    const current = info.current();
    if (
      phaseRef.current === 'ready' &&
      info.isActive() &&
      current !== null &&
      (current.startsWith(blockPrefix) ||
        current.startsWith(videoPrefix) ||
        current === primaryId ||
        current === restartId) &&
      !views.current.has(current)
    ) {
      if (lastFocused.current === current) {
        lastFocused.current = null;
      }
      focusInitial();
    }
  }, [rows, items, showPrimary, showRestart, blockPrefix, videoPrefix, primaryId, restartId, focusInitial, phaseRef]);

  // Story 6.3: OK on a link, file or external-video chip → the QrDialog in
  // the modal host (focus trapped; «Закрыть» or Back returns it to the chip).
  // Only while Пост is the focused route (a file's E8 can land after a pop).
  const modal = useModal();
  const onOpenQr = useCallback<OpenQr>(
    (title, value, initiator) => {
      if (!focusRef.current.isActive() || modal.isOpen()) {
        return;
      }
      modal.open(<QrDialog title={title} value={value} onClose={() => modal.close()} />, initiator);
    },
    [modal],
  );
  const resolveFile = useFileTarget(http, blogUrl, postId);
  // Story 6.4: an AudioBlock's source (a fresh E8 on play). A playing track
  // pauses while Пост is not the focused route (the Player or another Пост
  // on top) and never resumes by itself; leaving Пост unmounts it (stops).
  const resolveAudio = useAudioSource(http, blogUrl, postId);
  const [routeFocused, setRouteFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setRouteFocused(true);
      return () => setRouteFocused(false);
    }, []),
  );
  // Story 6.3 (owner decision 2026-10-29, option b): a timestamp chip plays
  // this post's video from that second; the Player returns focus to the chip.
  // Only while the player is on (else the chip keeps its QR).
  const postAuthorBlogUrl = post?.author.blogUrl ?? null;
  const postEntityId = post?.id ?? null;
  const onPlayAt = useCallback<PlayAt>(
    (mediaId, seconds, focusId) => {
      if (postAuthorBlogUrl !== null && postEntityId !== null) {
        onOpenPlayer({ blogUrl: postAuthorBlogUrl, postId: postEntityId, mediaId }, focusId, { atSec: seconds });
      }
    },
    [onOpenPlayer, postAuthorBlogUrl, postEntityId],
  );

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
            ref={scrollRef}
            testID="post/body"
            scrollEnabled={scrollEnabled}
            onLayout={onColumnLayout}
            onContentSizeChange={onContentSizeChange}
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
            {post.hasAccess ? null : (
              <LockedNotice levelName={post.levelName} onLayout={onCopyLayout} />
            )}
            {showPrimary && primary !== null ? (
              <PostPrimaryAction
                id={primaryId}
                restartId={restartId}
                multi={rows.length > 1}
                target={primary.row}
                resume={showRestart}
                onView={onStopView}
                onFocus={onStopFocus}
                onOpenPlayer={onOpenPlayer}
              />
            ) : null}
            <PostVideoRows
              rows={rows}
              idPrefix={videoPrefix}
              playable={playerEnabled}
              statuses={statuses}
              onRowView={onStopView}
              onRowFocus={onStopFocus}
              onOpenPlayer={onOpenPlayer}
            />
            <PostBody
              items={items}
              idPrefix={blockPrefix}
              onParagraphView={onStopView}
              onParagraphFocus={onStopFocus}
              imageMaxHeight={imageMaxHeight}
              columnWidth={columnWidth}
              onOpenQr={onOpenQr}
              resolveFile={resolveFile}
              onOpenPost={onOpenPost}
              onPlayAt={playerEnabled ? onPlayAt : undefined}
              resolveAudio={playerEnabled ? resolveAudio : undefined}
              active={routeFocused}
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
    paddingHorizontal: COLUMN_PADDING_X,
    paddingTop: COLUMN_PADDING_TOP,
    paddingBottom: COLUMN_PADDING_BOTTOM,
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
