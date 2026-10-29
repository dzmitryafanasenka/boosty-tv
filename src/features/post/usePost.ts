import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import {
  SESSION_CHECK_KEYS,
  queryKeys,
  useHeldError,
  useLockedSessionCheck,
  type AppErrorKind,
  type HttpClient,
} from '../../shared/api';
import {
  PostRepository,
  type FileTargetResult,
  type Post,
  type ServerProgressSink,
} from '../../shared/entities/post';

export type PostState = {
  /** The post (E8 200, accessible or locked); null while loading, failed or unavailable. */
  post: Post | null;
  /** E8 404 `not_found`: «Пост недоступен» + «Назад», no retry. */
  unavailable: boolean;
  /** E8 failed (not 404) and nothing is shown: the error StateView. */
  error: AppErrorKind | null;
  /** Any E8 fetch is running («Повторить» shows busy). */
  isFetching: boolean;
  /** Reload E8 («Повторить»). */
  refetch: () => void;
};

/**
 * One post (Story 3.4): E8 through `useQuery`, keyed by its identity
 * `{blogUrl, postId}` (`queryKeys.post`; no URL or signed value). The
 * HttpClient is the active session's, passed down from the route (never a
 * singleton); no query-level retry (HttpClient owns AD-6).
 *
 * A fresh E8 that says locked asks the SessionCheck port (Epic 3 retro A6):
 * a dead token also answers «locked» (api-contract §7). The locked post
 * stays shown meanwhile; `refetch` reloads E8 once, `expired` opens A11
 * through the app's status listener.
 */
export function usePost(
  http: HttpClient,
  blogUrl: string,
  postId: string,
  onServerProgress?: ServerProgressSink,
): PostState {
  const refetchRef = useRef<() => void>(() => {});
  const sinkRef = useRef(onServerProgress);
  sinkRef.current = onServerProgress;
  const checkLocked = useLockedSessionCheck(SESSION_CHECK_KEYS.post, () => refetchRef.current());
  const query = useQuery({
    queryKey: queryKeys.post(blogUrl, postId),
    queryFn: async () => {
      // Story 4.2: each video's `timeCode` goes to the ProgressRepository
      // (the MediaRow status, «Продолжить»), never into the post or the cache.
      const result = await PostRepository.post(http, blogUrl, postId, {
        onServerProgress: (mediaId, sec) => sinkRef.current?.(mediaId, sec),
      });
      if (result.kind === 'ok' && !result.post.hasAccess) {
        checkLocked();
      }
      return result;
    },
    retry: false,
  });
  const { data, error, status, isFetching, refetch } = query;
  refetchRef.current = () => {
    refetch().catch(() => {});
  };

  // The error StateView keeps its busy «Повторить» during a retry.
  const shownError = useHeldError({ empty: data === undefined, status, error, isFetching });

  return {
    post: data?.kind === 'ok' ? data.post : null,
    unavailable: data?.kind === 'unavailable',
    error: shownError,
    isFetching,
    refetch: () => {
      refetch().catch(() => {});
    },
  };
}

/**
 * Story 6.3: resolves a file's QR target on OK (a fresh E8 through
 * `PostRepository.fileTarget`, by the file's block key). Not a query: the
 * signed target lives only in the caller's memory (the QR dialog), never in
 * a query cache. Rejects with the E8 `AppError`.
 */
export function useFileTarget(
  http: HttpClient,
  blogUrl: string,
  postId: string,
): (fileKey: string, title: string) => Promise<FileTargetResult> {
  return useCallback(
    (fileKey: string, title: string) => PostRepository.fileTarget(http, blogUrl, postId, fileKey, { title }),
    [http, blogUrl, postId],
  );
}
