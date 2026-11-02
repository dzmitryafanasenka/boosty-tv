import { memo, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { HttpClient } from '../../../shared/api';
import { useCommentReplies, type Comment, type CommentsState } from '../../../shared/entities/comment';
import type { StopFocusHandler, StopViewHandler } from '../../../shared/focus';
import { t } from '../../../shared/i18n';
import { Text, components, spacing } from '../../../shared/ui';
import { CommentActionRow, CommentsNote } from './CommentActionRow';
import { CommentRow } from './CommentRow';
import type { OpenImages } from '../ImageViewer';

const ROW = components['comment-row'];

/*
 * Focus ids (docs/focus-map.md §1.5, F Пост). The `comment` segments are
 * appended to the post's own prefix, so no source line spells a comment
 * request path (`__tests__/commentsReadOnly.test.js`: E19 has one owner).
 */
const postBase = (postId: string) => `post/${postId}/`;
/** Every comment and reply row: `post/<postId>/` + `comment/<commentId>`. */
export const postCommentPrefix = (postId: string) => `${postBase(postId)}comment/`;
export const postCommentId = (postId: string, commentId: string) => `${postCommentPrefix(postId)}${commentId}`;
/** «Показать ещё» under the comments. */
export const postCommentsMoreId = (postId: string) => `${postBase(postId)}comments/more`;
/** «Повторить» of a failed first page. */
export const postCommentsRetryId = (postId: string) => `${postBase(postId)}comments/retry`;
/** «Ещё ответы» under one comment's replies. */
export const postRepliesMoreId = (postId: string, commentId: string) =>
  `${postBase(postId)}comments/replies/${commentId}`;

/**
 * Moves focus off `fromId` (an action row that may unmount) to the first
 * mounted of `candidates` once laid out (PostScreen's `focusLaidOut`): only
 * while focus is still on `fromId`.
 */
export type MoveFocus = (fromId: string, candidates: readonly string[]) => void;

type ThreadProps = {
  comment: Comment;
  postId: string;
  http: HttpClient;
  blogUrl: string;
  columnWidth: number | null;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  moveFocus: MoveFocus;
  onOpenImages?: OpenImages;
  nowMs?: number;
};

/**
 * One comment, its replies (oldest first, one indent step) and «Ещё ответы»
 * while the server reports more. OK on «Ещё ответы» loads them
 * (`useCommentReplies`); when they arrive, focus moves to the first reply not
 * shown before (else the last reply, else the comment). A failure keeps the
 * replies and turns the row into «Повторить».
 */
const CommentThread = memo(function CommentThreadView({
  comment,
  postId,
  http,
  blogUrl,
  columnWidth,
  onView,
  onFocus,
  moveFocus,
  onOpenImages,
  nowMs,
}: ThreadProps) {
  const replies = useCommentReplies(http, blogUrl, postId, comment);
  const moreId = postRepliesMoreId(postId, comment.id);
  const pending = useRef<ReadonlySet<string> | null>(null);
  const { loadMore, loading } = replies;
  const onMore = useCallback(() => {
    const known = new Set(replies.replies.map(reply => reply.id));
    // Pending only once a load really started (a repeated press is ignored).
    if (!loading && loadMore()) {
      pending.current = known;
    }
  }, [loading, loadMore, replies.replies]);
  useEffect(() => {
    const known = pending.current;
    if (known === null || replies.loading) {
      return;
    }
    pending.current = null;
    if (replies.failed) {
      return;
    }
    const fresh = replies.replies.find(reply => !known.has(reply.id));
    const last = replies.replies[replies.replies.length - 1];
    const targets = [fresh, last].filter((reply): reply is Comment => reply !== undefined);
    moveFocus(moreId, [...targets.map(reply => postCommentId(postId, reply.id)), postCommentId(postId, comment.id)]);
  }, [replies.loading, replies.failed, replies.replies, moveFocus, moreId, postId, comment.id]);

  return (
    <View testID={`${postCommentId(postId, comment.id)}/thread`}>
      <CommentRow
        id={postCommentId(postId, comment.id)}
        comment={comment}
        columnWidth={columnWidth}
        onView={onView}
        onFocus={onFocus}
        onOpenImages={onOpenImages}
        nowMs={nowMs}
      />
      {replies.replies.length > 0 || replies.hasMore ? (
        <View testID={`${postCommentId(postId, comment.id)}/replies`} style={styles.replies}>
          {replies.replies.map(reply => (
            <CommentRow
              key={reply.id}
              id={postCommentId(postId, reply.id)}
              comment={reply}
              columnWidth={columnWidth}
              isReply
              onView={onView}
              onFocus={onFocus}
              onOpenImages={onOpenImages}
              nowMs={nowMs}
            />
          ))}
          {replies.hasMore ? (
            <CommentActionRow
              id={moreId}
              label={t('post.comments.moreReplies')}
              busy={replies.loading}
              failed={replies.failed}
              onPress={onMore}
              onView={onView}
              onFocus={onFocus}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

export type PostCommentsProps = {
  postId: string;
  /** The active session's client and the post's blog (replies, E19 `parent_id`). */
  http: HttpClient;
  blogUrl: string;
  /** `isCommentsDenied`: the author turned comments off (no request was sent). */
  authorOff: boolean;
  /** The comments query (`useComments`, owned by the screen). */
  state: CommentsState;
  /** The column's measured inner width (images); null until measured. */
  columnWidth: number | null;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  moveFocus: MoveFocus;
  /** Story 11.2: OK on a comment with images opens the image viewer. */
  onOpenImages?: OpenImages;
  nowMs?: number;
};

function Block({ children }: { children: ReactNode }) {
  return (
    <View testID="post/comments" style={styles.block}>
      <Text testID="post/comments-title" variant="section" accessibilityRole="header" style={styles.title}>
        {t('post.comments.title')}
      </Text>
      {children}
    </View>
  );
}

/**
 * The «Комментарии» block (Story 11.2, COMM-01, FR-58; read-only) at the
 * bottom of an accessible Пост, after every block. Newest first; OK on
 * «Показать ещё» appends the next older page below (only on that press, 20
 * at a time) and moves focus to the first new comment. Every state stays in
 * the block: loading (a spinner line), empty, error with «Повторить»
 * (page 1 again), `denied` («Комментарии недоступны», no retry), the
 * author's comments off (no request), `notFound` (no block). No writing
 * control of any kind.
 */
export function PostComments({
  postId,
  http,
  blogUrl,
  authorOff,
  state,
  columnWidth,
  onView,
  onFocus,
  moveFocus,
  onOpenImages,
  nowMs,
}: PostCommentsProps) {
  const { view, loadMore, retry } = state;
  const moreId = postCommentsMoreId(postId);
  const retryId = postCommentsRetryId(postId);

  // «Показать ещё» done: focus on the first comment not shown before.
  const pendingMore = useRef<ReadonlySet<string> | null>(null);
  const loadingMore = view.kind === 'ready' && view.loadingMore;
  const onMore = useCallback(() => {
    if (view.kind !== 'ready' || view.loadingMore) {
      return;
    }
    const known = new Set(view.comments.map(comment => comment.id));
    // Pending only once a load really started.
    if (loadMore()) {
      pendingMore.current = known;
    }
  }, [view, loadMore]);
  useEffect(() => {
    const known = pendingMore.current;
    if (known === null) {
      return;
    }
    // The list was replaced (a reset, a refetch from page 1): never move focus later.
    if (view.kind !== 'ready') {
      pendingMore.current = null;
      return;
    }
    if (view.loadingMore) {
      return;
    }
    pendingMore.current = null;
    if (view.moreFailed) {
      return;
    }
    const fresh = view.comments.find(comment => !known.has(comment.id));
    const last = view.comments[view.comments.length - 1];
    const targets = [fresh, last].filter((comment): comment is Comment => comment !== undefined);
    moveFocus(moreId, targets.map(comment => postCommentId(postId, comment.id)));
  }, [view, moveFocus, moreId, postId]);

  // «Повторить» done: focus on the first comment (none: the screen's initial element).
  const pendingRetry = useRef(false);
  const retrying = view.kind === 'error' && view.retrying;
  const onRetry = useCallback(() => {
    if (!retrying) {
      pendingRetry.current = true;
      retry();
    }
  }, [retrying, retry]);
  useEffect(() => {
    if (!pendingRetry.current || view.kind === 'loading' || (view.kind === 'error' && view.retrying)) {
      return;
    }
    pendingRetry.current = false;
    if (view.kind === 'error') {
      return;
    }
    const first = view.kind === 'ready' ? view.comments[0] : undefined;
    moveFocus(retryId, first ? [postCommentId(postId, first.id)] : []);
  }, [view, moveFocus, retryId, postId]);

  if (authorOff) {
    return (
      <Block>
        <CommentsNote testID="post/comments-off" text={t('post.comments.authorOff')} />
      </Block>
    );
  }
  switch (view.kind) {
    case 'notFound':
      return null;
    case 'loading':
      return (
        <Block>
          <CommentsNote testID="post/comments-loading" text={t('post.comments.loading')} busy />
        </Block>
      );
    case 'denied':
      return (
        <Block>
          <CommentsNote testID="post/comments-denied" text={t('post.comments.denied')} />
        </Block>
      );
    case 'error':
      return (
        <Block>
          <CommentsNote testID="post/comments-error" text={t('post.comments.error')} />
          <CommentActionRow
            id={retryId}
            label={t('common.retry')}
            busy={view.retrying}
            onPress={onRetry}
            onView={onView}
            onFocus={onFocus}
          />
        </Block>
      );
    default:
      break;
  }
  if (view.comments.length === 0) {
    return (
      <Block>
        <CommentsNote testID="post/comments-empty" text={t('post.comments.empty')} />
      </Block>
    );
  }
  return (
    <Block>
      {view.comments.map(comment => (
        <CommentThread
          key={comment.id}
          comment={comment}
          postId={postId}
          http={http}
          blogUrl={blogUrl}
          columnWidth={columnWidth}
          onView={onView}
          onFocus={onFocus}
          moveFocus={moveFocus}
          onOpenImages={onOpenImages}
          nowMs={nowMs}
        />
      ))}
      {view.hasMore || view.moreFailed ? (
        <CommentActionRow
          id={moreId}
          label={t('post.comments.showMore')}
          busy={loadingMore}
          failed={view.moreFailed}
          onPress={onMore}
          onView={onView}
          onFocus={onFocus}
        />
      ) : null}
    </Block>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing['10'],
    maxWidth: spacing['text-measure'],
  },
  title: {
    marginBottom: spacing['6'],
  },
  replies: {
    marginLeft: ROW.indent,
  },
});
