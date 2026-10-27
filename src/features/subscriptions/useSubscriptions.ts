import { useQuery } from '@tanstack/react-query';
import {
  queryKeys,
  useHeldError,
  type AppErrorKind,
  type HttpClient,
} from '../../shared/api';
import {
  AuthorRepository,
  SUBSCRIPTIONS_LIMIT,
  type Author,
} from '../../shared/entities/author';

export type Subscriptions = {
  authors: Author[];
  /** No list yet and none failed: the skeleton. */
  isPending: boolean;
  /** The load failed and nothing is loaded: the error StateView. */
  error: AppErrorKind | null;
  /** Any fetch is running («Повторить» shows busy). */
  isFetching: boolean;
  /**
   * The response reached the E2 limit (30 raw items) and the server reports
   * more (`total > 30`): «Показаны первые N». `total` alone is not enough:
   * the live account returned `total` 5 with 3 items. Paging beyond 30 is
   * unverified, so none is offered.
   */
  truncated: boolean;
  /** Reload («Повторить»). */
  refetch: () => void;
};

const EMPTY: Author[] = [];

/**
 * Подписки (Story 3.2): E2 through `useQuery`, one request per load. The
 * HttpClient is the active session's, passed in by the Shell (never a
 * singleton). The cache is account-scoped (ADR 0010); a remount after
 * `staleTime` refetches the single request in the background.
 */
export function useSubscriptions(http: HttpClient): Subscriptions {
  const query = useQuery({
    queryKey: queryKeys.subscriptions(),
    queryFn: () => AuthorRepository.subscriptions(http),
  });
  const { data, error, status, isFetching, refetch } = query;
  const authors = data?.authors ?? EMPTY;

  // The error StateView keeps its busy «Повторить» during a retry.
  const shownError = useHeldError({ empty: data === undefined, status, error, isFetching });

  return {
    authors,
    isPending: shownError === null && data === undefined,
    error: shownError,
    isFetching,
    truncated:
      data !== undefined &&
      data.received >= SUBSCRIPTIONS_LIMIT &&
      data.total !== null &&
      data.total > SUBSCRIPTIONS_LIMIT,
    refetch: () => {
      refetch().catch(() => {});
    },
  };
}
