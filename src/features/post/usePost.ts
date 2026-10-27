import { useQuery } from '@tanstack/react-query';
import {
  queryKeys,
  useHeldError,
  type AppErrorKind,
  type HttpClient,
} from '../../shared/api';
import { PostRepository, type Post } from '../../shared/entities/post';

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
 */
export function usePost(http: HttpClient, blogUrl: string, postId: string): PostState {
  const query = useQuery({
    queryKey: queryKeys.post(blogUrl, postId),
    queryFn: () => PostRepository.post(http, blogUrl, postId),
    retry: false,
  });
  const { data, error, status, isFetching, refetch } = query;

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
