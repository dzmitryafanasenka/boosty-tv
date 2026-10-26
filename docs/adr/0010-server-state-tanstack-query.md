# ADR 0010: Server state with TanStack Query 5.104.2

- Status: accepted with Story 3.1 (2026-10-26); the version and setup below are what Story 3.1 ships
- Date: 2026-10-26
- Relates to: architecture spine AD-4 (account scope), AD-6 (retries), AD-7 (server state); `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md`; [ADR 0008](0008-api-request-profiles.md)

## Context

Epic 3 brings the first production content lists (E5 feed, then E2, E3, E4, E8). AD-7 names TanStack Query as the only server-state library: keys in one module, lists through `useInfiniteQuery` with the opaque `extra.offset` cursor, `staleTime` 60 s, `gcTime` 10 min, no focus-based refetch, and an account-scoped cache. It was not a dependency yet.

## Decision

**Dependency.** `@tanstack/react-query` pinned exactly at `5.104.2` (`package.json` without a range; `package-lock.json` resolves `@tanstack/query-core` `5.104.2`).

| Check | Evidence (npm registry, 2026-10-26) |
|---|---|
| Published | `5.104.2`: 2026-10-11T19:35Z (stable tag, more than two weeks old at adoption) |
| Peer dependencies | `react: ^18 \|\| ^19` (the app runs React 19.2.3) |
| Dependencies | `@tanstack/query-core` `5.104.2` only |
| Native code | None (pure JS/TS). Metro resolves the package's `react-native` field (`src/index.ts`); Jest uses the CJS build. Works with react-native-tvos 0.87.1-1 like any JS module; no tvOS-specific concern for phase 4 |

**Setup (`src/app/queryClient.ts`).** One `QueryClient` per app process (like `session`), provided in `App.tsx` around the navigator.

- `staleTime` 60 s, `gcTime` 10 min, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`.
- No `focusManager` or `onlineManager` wiring and no NetInfo. React Native has no window focus and no `online` events, so both managers stay idle. Adding NetInfo would be a new native module (not allowed in Story 3.1). Resume handling stays with Story 2.5's E1 path; invalidating the visible list on resume (AD-7) is not part of Story 3.1.
- Query keys only from `src/shared/api/queryKeys.ts`. Keys carry no account id (the cache is wiped per account), no URL, no signed value and no cursor (cursors are page params).

**Retry policy.** Query-level `retry: false` for queries and mutations. All retries stay in `HttpClient` (AD-6): a GET retries `Network` ≤ 2 with backoff and `Server` ≤ 1. Therefore `NoAccess`, `NotFound`, `Client`, `Parse` and `SessionExpired` are never retried, and a flaky network does not get a second retry layer multiplying requests. User-triggered retries («Повторить», «Обновить») call `refetch` / `fetchNextPage` explicitly.

**Account scope (AD-4).** `queryCacheAccountStore` (`defineAccountScoped('queryCache', …)`) is registered in `src/app/bootstrap.ts` after the session gate. Its reset is ordered: `await queryClient.cancelQueries()`, then `queryClient.clear()`. Cancelling first means a response of the previous account that is still in flight is discarded instead of landing in the cleared cache. Sign-out and an account switch both run it through `AccountScope.reset()`.

**HTTP client.** Query functions get the `HttpClient` from the active `session` through props (Shell → feature → hook → repository). `shared/api` keeps no singletons (Epic 2 retro, items 1–2), so demo mode can never reach the real API.

## Consequences

- Infinite lists: `initialPageParam: null`, `getNextPageParam` returns the page's `nextCursor` (null on `isLast` or a missing `extra`/`offset`). It also returns null when the cursor was already used for a page (an immediate repeat or a cycle), so a broken cursor cannot loop. A page that adds no new card but has a next cursor fetches the next page automatically, bounded by the same rule.
- **The feed refreshes only by explicit action.** The feed query sets `refetchOnMount: false`: a refetch of an infinite query reloads every loaded page in sequence, so a remount after `staleTime` would send about 31 E5 requests for a 300-post feed. In Story 3.1 the only refreshes are the StateView actions («Повторить» on the full error, «Обновить» on the empty feed). Resume invalidation and the «Обновить» button (FEED-03, Epic 5) come later; the policy is tracked in `_bmad-output/implementation-artifacts/deferred-work.md`.
- A refetch of a failed first page puts the query back into `pending`. The feed hook keeps reporting the previous error while that retry runs, so the error StateView stays with a busy «Повторить» and focus does not jump to a skeleton.
- Tests use the app's client and call `resetQueryCache()` after each test. Under Jest fake timers, a pending-timer run also fires the 10 min `gcTime` of inactive queries and moves the clock past `staleTime`. Tests that depend on the cache surviving run without timers, or raise the query's `gcTime` for that test only. `homeFeedFlow.test.tsx` moves TanStack's notifications from a 0 ms timer to a microtask (`notifyManager.setScheduler`) so it can run without timers.
- A change of the major version, or adding `focusManager`/`onlineManager` wiring, needs a new ADR.
