import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { queryKeys, useHeldError, type AppErrorKind, type HttpClient } from '../../shared/api';
import { EventRepository, type Event } from '../../shared/entities/event';
import { useEventReadMarks } from './eventReadMarks';

export type Events = {
  /** The shown events, newest first, with the local read marks applied. */
  events: Event[];
  /** No list yet and none failed: the skeleton. */
  isPending: boolean;
  /** The load failed and nothing is loaded: the error StateView. */
  error: AppErrorKind | null;
  /** Any fetch is running («Повторить» / «Обновить» show busy). */
  isFetching: boolean;
  /** Reload («Повторить», «Обновить»). */
  refetch: () => void;
};

const EMPTY: Event[] = [];

/**
 * События (Story 7.5): E18 through `useQuery`, one request per load, no
 * paging. The HttpClient is the active session's, passed in by the Shell
 * (never a singleton). The cache is account-scoped (ADR 0010). `staleTime`
 * 0: every open of the section fetches again (the cached rows show
 * meanwhile), so a new «Начался эфир» appears; the app's resume refresh
 * invalidates the query too (`App.tsx`). No automatic retry: the
 * repository sends E18 once and the app client has no Query-level retry.
 * Rows marked read locally (`eventReadMarks`) show no dot.
 */
export function useEvents(http: HttpClient): Events {
  const query = useQuery({
    queryKey: queryKeys.events(),
    queryFn: () => EventRepository.list(http),
    staleTime: 0,
  });
  const { data, error, status, isFetching, refetch } = query;
  const marks = useEventReadMarks();
  const events = useMemo(
    () =>
      data === undefined
        ? EMPTY
        : data.map(event => (!event.isRead && marks.has(event.id) ? { ...event, isRead: true } : event)),
    [data, marks],
  );

  // The error StateView keeps its busy «Повторить» during a retry.
  const shownError = useHeldError({ empty: data === undefined, status, error, isFetching });

  const reload = useCallback(() => {
    refetch().catch(() => {});
  }, [refetch]);

  return {
    events,
    isPending: shownError === null && data === undefined,
    error: shownError,
    isFetching,
    refetch: reload,
  };
}
