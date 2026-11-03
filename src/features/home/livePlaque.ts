import { NavigationContext } from '@react-navigation/native';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useContext, useEffect } from 'react';
import { accountScope } from '../../shared/account';
import { QUERY_STALE_TIME_MS, isAppError, queryKeys, type HttpClient } from '../../shared/api';
import { AuthorRepository, type Author, type SubscriptionList } from '../../shared/entities/author';
import { StreamRepository, isPlayableLive } from '../../shared/entities/stream';
import { useLatestRef } from '../../shared/focus';
import { logger as appLogger, type Logger } from '../../shared/services/logger';
import { authorPrimaryName } from '../../shared/ui';

/**
 * Главная's «в эфире» plaque (Story 12.3, FR-61, our improvement IMP-03;
 * owner decision 2026-11-02, option b; docs/api-contract.md «E15»).
 *
 * One pass: E2 (the `subscriptions` cache when fresh), then E15 for at most
 * the first `LIVE_PLAQUE_MAX_AUTHORS` authors in E2 order, one at a time. A
 * failed author is skipped; `RateLimited` or `SessionExpired` stops the pass
 * and it shows nothing. A pass never fails as a query: every failure is an
 * empty result, so the TTL holds for it too (no retry storm on mount).
 * E18 is never used.
 */

/** The cap of E15 requests per pass (the first N subscriptions in E2 order). */
export const LIVE_PLAQUE_MAX_AUTHORS = 10;
/** The pass's TTL: a new pass only after this age (Главная mount or focus, app resume). */
export const LIVE_PLAQUE_TTL_MS = 5 * 60_000;

/** One plaque: a subscribed author who is live now with a playable stream. */
export type LivePlaqueItem = {
  /** The blog's identity (focus id `home/live/<blogUrl>`, the `LiveRef`). */
  blogUrl: string;
  /** E2's author name (`authorPrimaryName`). */
  name: string;
  /** E2's avatar (http(s)); null: the placeholder. */
  avatarUrl: string | null;
  /** E15's stream title (trimmed; may be empty, the plaque then shows a fallback). */
  title: string;
};

const NONE: readonly LivePlaqueItem[] = [];

/** A pass's outcome, for the counts-only log line. */
type PassStats = { checked: number; live: number; failed: number };

/** Kinds that stop the whole pass: no further E15, nothing shown. */
function stopsPass(error: unknown): boolean {
  return isAppError(error) && (error.kind === 'RateLimited' || error.kind === 'SessionExpired');
}

/**
 * Runs one pass. `isCurrent` (the account generation captured at the
 * start): once it turns false (an account reset), the pass sends no further
 * E15 and shows nothing; an E15 already sent still completes. Never rejects.
 */
export async function runLivePlaquePass(
  queryClient: QueryClient,
  http: HttpClient,
  isCurrent: () => boolean = () => true,
  logger: Logger = appLogger,
): Promise<readonly LivePlaqueItem[]> {
  let list: SubscriptionList;
  try {
    list = await queryClient.fetchQuery({
      queryKey: queryKeys.subscriptions(),
      queryFn: () => AuthorRepository.subscriptions(http),
      staleTime: QUERY_STALE_TIME_MS,
    });
  } catch (error) {
    logger.info('live', 'plaque pass failed', {
      step: 'subscriptions',
      kind: isAppError(error) ? error.kind : 'unknown',
    });
    return NONE;
  }
  const authors: readonly Author[] = list.authors.slice(0, LIVE_PLAQUE_MAX_AUTHORS);
  const items: LivePlaqueItem[] = [];
  const stats: PassStats = { checked: 0, live: 0, failed: 0 };
  for (const author of authors) {
    if (!isCurrent()) {
      return NONE;
    }
    stats.checked += 1;
    try {
      const stream = await StreamRepository.fetchActive(http, author.blogUrl, logger);
      if (stream !== null && isPlayableLive(stream)) {
        stats.live += 1;
        items.push({
          blogUrl: author.blogUrl,
          name: authorPrimaryName(author),
          avatarUrl: author.avatarUrl,
          title: stream.title,
        });
      }
    } catch (error) {
      if (stopsPass(error)) {
        logger.info('live', 'plaque pass stopped', {
          checked: stats.checked,
          kind: isAppError(error) ? error.kind : 'unknown',
        });
        return NONE;
      }
      // One failed author is skipped (no names, URLs or ids in the log).
      stats.failed += 1;
    }
  }
  if (!isCurrent()) {
    return NONE;
  }
  logger.info('live', 'plaque pass', {
    checked: stats.checked,
    live: stats.live,
    failed: stats.failed,
  });
  return items;
}

/**
 * A new pass when the last one is older than the TTL and Главная observes
 * the plaque (app resume, Главная focus). No observer, or a fresh pass:
 * nothing is sent.
 */
export async function refreshLivePlaque(queryClient: QueryClient, now: number): Promise<void> {
  const query = queryClient.getQueryCache().find({ queryKey: queryKeys.livePlaque(), exact: true });
  if (query === undefined || !query.isActive()) {
    return;
  }
  const { dataUpdatedAt, fetchStatus } = query.state;
  if (fetchStatus === 'fetching' || (dataUpdatedAt > 0 && now - dataUpdatedAt < LIVE_PLAQUE_TTL_MS)) {
    return;
  }
  await queryClient.refetchQueries({ queryKey: queryKeys.livePlaque(), exact: true, type: 'active' });
}

/**
 * Главная's live plaques (empty while `enabled` is false, during a pass
 * with nothing cached, and after a failed pass). `enabled`: Главная shows
 * its grid (the pass never delays the feed or the initial focus). A pass
 * starts on mount when the cached one is older than the TTL, and when the
 * Shell is the focused route again (a return from Пост or the Player)
 * under the same rule. No polling.
 */
export function useLivePlaque(http: HttpClient, enabled: boolean): readonly LivePlaqueItem[] {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.livePlaque(),
    // TanStack's `signal` is not passed on purpose: a query whose fn reads it
    // is cancelled and reverted when its last observer unmounts, so leaving
    // Главная mid-pass would start a second pass on return. A started pass
    // completes (and sets `dataUpdatedAt`); only an account reset stops it.
    queryFn: () => {
      const generation = accountScope.generation();
      return runLivePlaquePass(queryClient, http, () => accountScope.generation() === generation);
    },
    enabled,
    staleTime: LIVE_PLAQUE_TTL_MS,
    retry: false,
  });
  const enabledRef = useLatestRef(enabled);
  // The route that holds Главная (the Shell) is focused again. Outside a
  // navigator (a screen rendered alone) there is no such event.
  const navigation = useContext(NavigationContext);
  useEffect(
    () =>
      navigation?.addListener('focus', () => {
        if (enabledRef.current) {
          refreshLivePlaque(queryClient, Date.now()).catch(() => {});
        }
      }),
    [navigation, queryClient, enabledRef],
  );
  return enabled ? (data ?? NONE) : NONE;
}
