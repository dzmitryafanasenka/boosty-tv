import { QueryClient } from '@tanstack/react-query';
import { defineAccountScoped } from '../shared/account';
import { QUERY_STALE_TIME_MS } from '../shared/api';

/**
 * Server state (AD-7, ADR 0010): one TanStack Query client for the app.
 *
 * - `staleTime` 60 s, `gcTime` 10 min, no focus or reconnect refetch: React
 *   Native has neither window focus nor `online` events here, and no
 *   NetInfo is installed (ADR 0010).
 * - No Query-level retry: HttpClient already retries a GET (`Network` ≤ 2,
 *   `Server` ≤ 1, AD-6), and `NoAccess`, `NotFound`, `Client`, `Parse` and
 *   `SessionExpired` are never retried. A second retry layer would multiply
 *   requests (a storm on a flaky network).
 * - The cache is account-scoped (AD-4): `queryCacheAccountStore` is
 *   registered in `bootstrap.ts`; a reset cancels in-flight queries first,
 *   so a late response of the old account is dropped, then clears the
 *   cache.
 */

export { QUERY_STALE_TIME_MS };
export const QUERY_GC_TIME_MS = 10 * 60_000;

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** The app's client: one per app process, like `session`. */
export const queryClient = createAppQueryClient();

/** Cancel, then clear: nothing of the previous account survives. */
export async function resetQueryCache(client: QueryClient = queryClient): Promise<void> {
  await client.cancelQueries();
  client.clear();
}

export const queryCacheAccountStore = defineAccountScoped('queryCache', () =>
  resetQueryCache(),
);
