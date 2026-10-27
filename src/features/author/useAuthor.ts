import { useQuery } from '@tanstack/react-query';
import {
  queryKeys,
  useHeldError,
  type AppErrorKind,
  type HttpClient,
} from '../../shared/api';
import { AuthorRepository, type Author } from '../../shared/entities/author';

export type AuthorHeaderState = {
  /** The header (E3 200); null while loading, failed or unavailable. */
  author: Author | null;
  /** E3 404 `blog_not_found`: «Автор недоступен» + «Назад», no retry. */
  unavailable: boolean;
  /** No answer yet and none failed: the header skeleton. */
  isPending: boolean;
  /** E3 failed (not 404): the full-page error StateView. */
  error: AppErrorKind | null;
  /** Any E3 fetch is running («Повторить» shows busy). */
  isFetching: boolean;
  /** Reload E3 («Повторить»). */
  refetch: () => void;
};

/**
 * The Author page header (Story 3.3): E3 through `useQuery`, keyed by
 * `blogUrl` (`queryKeys.author`). The HttpClient is the active session's,
 * passed down from the route (never a singleton); no query-level retry
 * (HttpClient owns AD-6).
 */
export function useAuthor(http: HttpClient, blogUrl: string): AuthorHeaderState {
  const query = useQuery({
    queryKey: queryKeys.author(blogUrl),
    queryFn: () => AuthorRepository.blog(http, blogUrl),
    retry: false,
  });
  const { data, error, status, isFetching, refetch } = query;

  // The error StateView keeps its busy «Повторить» during a retry.
  const shownError = useHeldError({ empty: data === undefined, status, error, isFetching });

  return {
    author: data?.kind === 'ok' ? data.author : null,
    unavailable: data?.kind === 'unavailable',
    isPending: shownError === null && data === undefined,
    error: shownError,
    isFetching,
    refetch: () => {
      refetch().catch(() => {});
    },
  };
}
