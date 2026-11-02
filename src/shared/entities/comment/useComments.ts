import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppError } from '../../api/appError';
import type { HttpClient } from '../../api/httpClient';
import { queryKeys } from '../../api/queryKeys';
import { useHeldError } from '../../api/useHeldError';
import { CommentRepository } from './commentRepository';
import { mergeCommentPages, mergeComments } from './mapComments';
import type { Comment, CommentPage, CommentPageResult } from './types';

/**
 * The block's view of a post's comments (Story 11.2, COMM-01):
 * - `loading`: the first page runs;
 * - `ready`: `comments` newest first (the merged pages reversed), with
 *   `hasMore` while the last page gave a `nextCursor`;
 * - `denied` (HTTP 403) and `notFound` (404): no retry;
 * - `error`: the first page failed (held while «Повторить» refetches it).
 */
export type CommentsView =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      /** Newest first; older pages appended below. */
      comments: Comment[];
      hasMore: boolean;
      /** «Показать ещё» runs. */
      loadingMore: boolean;
      /** The last «Показать ещё» failed: the row reads «Повторить», the list is kept. */
      moreFailed: boolean;
    }
  | { kind: 'denied' }
  | { kind: 'notFound' }
  | { kind: 'error'; retrying: boolean };

export type CommentsState = {
  view: CommentsView;
  /**
   * The next older page («Показать ещё»; also its retry). Ignored while one
   * runs or with no next page; returns whether a load started.
   */
  loadMore: () => boolean;
  /** Page 1 again (the error state's «Повторить»). */
  retry: () => void;
};

/** A non-ok page outcome as the query's error (pages keep only ok results). */
class CommentsUnavailable extends Error {
  constructor(readonly reason: 'denied' | 'notFound') {
    super(reason);
  }
}

function pageOrThrow(result: CommentPageResult): CommentPage {
  switch (result.kind) {
    case 'ok':
      return result.page;
    case 'denied':
    case 'notFound':
      throw new CommentsUnavailable(result.kind);
    default:
      throw result.error;
  }
}

/**
 * A post's comments (Story 11.2) through `useInfiniteQuery` on
 * `queryKeys.comments` (account-scoped, cleared with the cache on sign-out
 * and account switch; never persisted). Page 1 is the newest page; each
 * `nextCursor` loads the next older one, only on the user's «Показать ещё»
 * (no auto-paging). No query retry (the HttpClient owns the GET retries)
 * and no refetch on mount: a return to Пост keeps the loaded pages.
 * `enabled` false (a locked post, comments off by the author, no post yet):
 * no request.
 */
export function useComments(http: HttpClient, blogUrl: string, postId: string, enabled: boolean): CommentsState {
  const query = useInfiniteQuery({
    queryKey: queryKeys.comments(blogUrl, postId),
    queryFn: async ({ pageParam }): Promise<CommentPage> => {
      const result = await CommentRepository.page(http, blogUrl, postId, pageParam);
      // An older page that answers denied / notFound ends the paging (no
      // «Показать ещё», no endless «Повторить»); the loaded pages stay.
      if (pageParam !== null && (result.kind === 'denied' || result.kind === 'notFound')) {
        return { comments: [], nextCursor: null };
      }
      return pageOrThrow(result);
    },
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
    refetchOnMount: false,
    retry: false,
    enabled,
  });
  const { data, error, status, isFetching, fetchNextPage, refetch } = query;

  const comments = useMemo(
    () => (data ? mergeCommentPages(data.pages).reverse() : []),
    [data],
  );
  const empty = data === undefined;
  const unavailable = status === 'error' && empty && error instanceof CommentsUnavailable ? error.reason : null;
  const heldError = useHeldError({
    empty: empty && unavailable === null,
    status,
    error: unavailable === null ? error : null,
    isFetching,
  });

  const view: CommentsView = useMemo(() => {
    if (unavailable !== null) {
      return { kind: unavailable };
    }
    if (heldError !== null) {
      return { kind: 'error', retrying: isFetching };
    }
    if (data === undefined) {
      return { kind: 'loading' };
    }
    return {
      kind: 'ready',
      comments,
      hasMore: query.hasNextPage,
      loadingMore: query.isFetchingNextPage,
      moreFailed: query.isFetchNextPageError,
    };
  }, [unavailable, heldError, isFetching, data, comments, query.hasNextPage, query.isFetchingNextPage, query.isFetchNextPageError]);

  const loadMore = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) {
      return false;
    }
    fetchNextPage({ cancelRefetch: false }).catch(() => {});
    return true;
  }, [query.hasNextPage, query.isFetchingNextPage, fetchNextPage]);
  const retry = useCallback(() => {
    if (!isFetching) {
      refetch().catch(() => {});
    }
  }, [isFetching, refetch]);

  return { view, loadMore, retry };
}

/** One comment's replies (Story 11.2), shown under it. */
export type RepliesView = {
  /** Oldest first: the inline replies merged with every loaded replies page, deduped by id. */
  replies: Comment[];
  /** «Ещё ответы» is shown: the server reports more replies than shown. */
  hasMore: boolean;
  loading: boolean;
  /** The last «Ещё ответы» failed (`error` only): its row reads «Повторить», the replies are kept. */
  failed: boolean;
};

export type RepliesState = RepliesView & {
  /** «Ещё ответы» (also its retry); ignored while one runs or when done; returns whether a load started. */
  loadMore: () => boolean;
};

const byIntId = (a: Comment, b: Comment) => a.intId - b.intId;

/**
 * One comment's replies (Story 11.2): the inline ones, then on «Ещё ответы»
 * the `parent_id` pages (`CommentRepository.replies`), merged with the inline
 * ones (deduped by id, oldest first by `intId`). Local state only: never
 * persisted, gone with the comment row. «Ещё ответы» stays while the last
 * replies page gave a `nextCursor`; `denied` / `notFound` end the paging
 * (no «Ещё ответы»), only `error` offers «Повторить». A repeated press while
 * one runs is ignored; a press after the row unmounted never sets state.
 */
export function useCommentReplies(
  http: HttpClient,
  blogUrl: string,
  postId: string,
  comment: Comment,
): RepliesState {
  const [loaded, setLoaded] = useState<{ comments: Comment[]; cursor: string | null; done: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const replies = useMemo(
    () => mergeComments(comment.replies, loaded?.comments ?? []).sort(byIntId),
    [comment.replies, loaded],
  );
  const hasMore = loaded === null ? comment.hasMoreReplies : !loaded.done;

  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const loadMore = useCallback(() => {
    if (busy.current || (loadedRef.current !== null && loadedRef.current.done)) {
      return false;
    }
    busy.current = true;
    setLoading(true);
    setFailed(false);
    const cursor = loadedRef.current?.cursor ?? null;
    CommentRepository.replies(http, blogUrl, postId, comment.intId, cursor)
      .then(
        (result): CommentPageResult => result,
        (): CommentPageResult => ({ kind: 'error', error: new AppError('Client') }),
      )
      .then(result => {
        busy.current = false;
        if (!mounted.current) {
          return;
        }
        setLoading(false);
        const previous = loadedRef.current?.comments ?? [];
        if (result.kind === 'denied' || result.kind === 'notFound') {
          setLoaded({ comments: previous, cursor: null, done: true });
          return;
        }
        if (result.kind !== 'ok') {
          setFailed(true);
          return;
        }
        setLoaded({
          comments: mergeComments(previous, result.page.comments),
          cursor: result.page.nextCursor,
          done: result.page.nextCursor === null,
        });
      });
    return true;
  }, [http, blogUrl, postId, comment.intId]);

  return { replies, hasMore, loading, failed, loadMore };
}
