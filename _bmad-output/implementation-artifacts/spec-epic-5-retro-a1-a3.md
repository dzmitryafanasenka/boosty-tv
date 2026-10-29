---
title: 'Epic 5 retro follow-ups A1–A3'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_commit: '591e72a4bf3be9ebdad13b350d21fd41926c6c3d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Epic 5 retrospective (`epic-5-retro-2026-10-29.md`, findings F1–F5, F7; action items A1–A3) found these cross-story gaps:
- Поиск keeps a stale-outcome focus bug that Story 5.7 fixed only on Автор, and its «Сбросить фильтры» reuses a cached result where Автор re-runs the query.
- Nobody has proven that E6 honours the access params under a query, while its sibling E7 ignores them.
- «Обновить» never re-checks the «Мой блог» tile.
- `phaseFlags.search` silently gates Автор search too.

**Approach:**
- **A2 first:** a live E6 check of «Доступные мне» against a query that matches a locked post, and of «Только купленные» against a query that matches the account's purchased post.
- **A1:** port Автор's next-frame outcome settle to Поиск, and make Поиск's «Сбросить фильтры» re-run the query under the default Filter.
- **A3:** «Обновить» re-asks only the «Мой блог» steps that ended without a tile; the flag's doc names both scopes it gates.

**Decisions:**
- Owner decision 2026-10-29: one change for A1–A3.
- A2 runs before any code change. Use a debug build with a temporary counts-only probe (booleans, counts and keys only; never a title, a query, an id or a URL), removed before the commit. Record «E6 access (LIVE)» in `docs/api-contract.md`. If E6 ignores `only_allowed` or `only_bought`, stop and report before A1/A3 code. The owner then decides as in Story 5.7 (A a / B a).
- A1 matches Автор (`AuthorScreen.tsx` `awaitOutcome`, `onResetFilters`): the settle on the next frame when no fetch started, and `submitFeedSearch(client, query, DEFAULT_FILTER)` before `reset('search')`.
- A3:
  - «Обновить» (`manualRefreshFeed`) also refetches `me` when it failed or has no `blogUrl`.
  - It refetches the own blog's header when it is not `ok`, and its posts (default Filter) when they failed or are empty.
  - A shown tile triggers no request.
  - The Shell's own refresh rules, the feed head refresh and E2 behave as before.
- A3 flag: documentation only (`phaseFlags.ts` header, `docs/focus-map.md` §1.7). No new flag.

## Boundaries & Constraints

**Always:** Keys come from `queryKeys`. Focus moves by explicit targets. No page storm: never invalidate a multi-page list. Copy, if any, goes in `ru`.

**Never:** Change Автор's behaviour, the feed refresh semantics, or the tile's own rules (Story 5.2). No new phase flag. No logging of query text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reset onto cached empty | Поиск: default result cached and empty, filtered empty, «Сбросить фильтры» | E6 re-run under the default Filter; focus on the field; no stale outcome later | E6 error → «Повторить» focused |
| Reset onto cached results | default result cached with posts | E6 re-run; focus → first result | — |
| Refresh, no tile, first own post | `me` ok with `blogUrl`, own posts cached empty | «Обновить» refetches own E4 page 1; tile appears | failure → still no tile, no error |
| Refresh, tile shown | tile visible | no E1/E3/E4 request from the tile | — |
| Refresh, `me` failed | `me` in error | `me` refetched; on success the tile chain runs | — |

</frozen-after-approval>

## Code Map

- `src/features/search/SearchScreen.tsx:259-264` (`awaitOutcome`) -- add the `outcomeFrame` rAF settle, `listFetchingRef`, `resolveLater` and cancel on unmount, copied from `src/features/author/AuthorScreen.tsx:405-436`.
- `SearchScreen.tsx:330-335` (`onResetFilters`) -- call `submitFeedSearch(client, queryRef.current, DEFAULT_FILTER)` before `filtersStore.getState().reset('search')` when a query is set.
- `src/features/home/feedRefresh.ts:90-123` (`manualRefreshFeed`) -- a non-awaited «Мой блог» re-check, using `client.getQueryState` / `getQueryData` on `queryKeys.me()`, `queryKeys.author(own)` and `queryKeys.authorPosts(own, DEFAULT_FILTER)`. Invalidate (`exact`, `refetchType: 'all'`) only the steps in error or empty. The posts list then has only page 1, so invalidating it sends one request. `features/home` must not import `features/subscriptions`: use the keys and `shared/entities` types only.
- `src/app/phaseFlags.ts` header and `docs/focus-map.md` §1.7 -- `search` gates the Поиск section (E6) and Автор «Поиск в блоге» (E7).
- `__tests__/searchFlow.test.tsx` -- reset cases (cached empty default, cached results). `__tests__/subscriptionsFlow.test.tsx` or `homeFeedFlow.test.tsx` -- the refresh tile cases.
- Docs: `docs/api-contract.md` «E6 access (LIVE)», `docs/testing.md` «Epic 5 retro A1–A3», `docs/focus-map.md` E (reset re-runs the query).

## Tasks & Acceptance

**Execution:**
- [x] A2 live E6 check (debug build, owner's session, counts-only probe removed); record it; stop if E6 ignores a param.
- [x] A1 Поиск settle + reset re-run; tests.
- [x] A3 «Мой блог» re-check on «Обновить»; flag docs; tests.
- [x] Docs as in the Code Map.

**Acceptance Criteria:**
- Given the suite, when run 3×, then everything passes; touched suites pass 30/30; lint `--max-warnings 0`, typecheck and `check:fixtures` are clean.

## Implementation Notes

- **A2 result: go.** Live check on the pinned device, 2026-10-29: debug build with Metro, the owner's session, a temporary counts-only probe (`TEMPA2`) that was removed before the commit (release bundle: `TEMPA2` 0). E6 honours both `only_allowed` and `only_bought` with `search_query`. A locked post that E6 returns under «Все посты» is absent under «Доступные мне», and «Только купленные» returns only the purchased post. No owner decision was needed. Recorded in `docs/api-contract.md` «E6 access (LIVE)».
- **A1:** `src/features/search/SearchScreen.tsx`: the next-frame outcome settle, and «Сбросить фильтры» re-runs the query under the default Filter. Review fix: the frame also skips while the awaited key is fetching per the query cache (`client.isFetching`) or the render has not reached that key yet. It looks again for up to 30 frames. The same block is in `src/features/author/AuthorScreen.tsx`, where `awaitOutcome` now takes the awaited key.
- **A3:** `src/features/home/feedRefresh.ts` (`recheckMyBlog`, called by `manualRefreshFeed`, not awaited). `src/features/subscriptions/useSubscriptions.ts` doc comment. Flag docs in `src/app/phaseFlags.ts` and `docs/focus-map.md` §1.7.
- **Tests:** `__tests__/searchFlow.test.tsx` («Epic 5 retro A1» block, the slow-device race), `__tests__/authorFlow.test.tsx` (the slow-device race), `__tests__/subscriptionsFlow.test.tsx` (the A3 block).
- **Docs:** `docs/api-contract.md` (E6 access, the E1/E4 rows), `docs/focus-map.md` (§1.7, §3 C, E), `docs/testing.md` «Epic 5 retro A1–A3».
- **Device state:** the release-like build with the first A1/A3 implementation is installed (built before the review fixes) and kept the owner's session; cold start reaches the Shell. Nothing was uninstalled or cleared. Metro is stopped and `adb reverse` is removed. The A1/A3 behaviour was not checked on the device.

## Spec Change Log

## Review Triage Log

Iteration 0 (layers: blind-hunter 12, edge-case-hunter 5, verification-gap 2 gaps + 3 other).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge | The rAF settle can fire before the fetch reaches React and settle on the stale phase (Поиск and, since Story 5.7, Автор) | medium | patch | The frame reads `listFetchingRef` set during render and a `resolveOutcome` closed over the rendered `phase`; TanStack notifies observers in a batch, so on a slow device the frame can win. Fix: also ask the query cache (`client.isFetching`) in the frame, in both screens. |
| 2 | blind, vgap | The rAF branch has no test in Поиск (every caller starts a fetch) | low | patch | Covered by the race tests of #1, which run the frame while a fetch is in flight. |
| 3 | blind, vgap | A successful E1 without `blogUrl` is never refetched in a test; its cost (one E1 per «Обновить») is undocumented | low | patch | The A3 block seeds only `blogUrl` present or E1 failed. |
| 4 | vgap | Failed E3/E4 and in-flight branches of `recheckMyBlog` untested | low | patch | «E3 unavailable» is a successful `unavailable` result; no E3 Parse / E4 404 case presses «Обновить». |
| 5 | blind, vgap | `api-contract.md` E1/E4 rows, `focus-map.md` §3 C and the `useMyBlog` doc comment still describe mount-only re-asks | low | patch | Direct doc corrections. |
| 6 | blind, edge | The «flag off» test title claims more than it checks; the flag-off safety is implicit | low | patch | Title renamed; the comment states that a disabled `me` is never filled. |
| 7 | blind | The A1 failure test does not assert the re-run; it uses 403 | low | patch | Assertions added; a 5xx used. |
| 8 | blind | Reset with no cached default key untested | low | patch | One added case. |
| 9 | blind | Spec record sections empty | low | patch | Implementation Notes filled (A2 result, files, device state). |
| 10 | vgap | The reset re-run shows the skeleton instead of the cached list | low | patch (doc) | The intended «not reused» behaviour; focus-map E now says so. |
| 11 | blind | The spec cites the retro doc that lives on the unmerged retro branch | false | reject | Both branches go to main; the retro PR carries the doc. |
| 12 | blind | `recheckMyBlog` refetches E4 while E3 is `unavailable` | low | reject | One extra request only for an unavailable own blog; rare. |
| 13 | blind | A re-check in flight across sign-out could refill the old account | false | reject | AccountScope clears the query cache, which removes the queries; a late reply has no query to write to. |
| 14 | edge | A failed `me` refetch that keeps stale data with a `blogUrl` is not re-asked | low | reject | The tile chain still runs from the kept `blogUrl`, and E3/E4 are re-asked. |
| 15 | edge | Two quick «Обновить» between the trim and the refetch send two E4 (one aborted) | low | reject | A rare double press; the second request supersedes the first. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean.
- `npm test` ×3 -- expected: all pass.

**Result (after the review patches, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 1963 passed each; `searchFlow` + `authorFlow` + `subscriptionsFlow` + `homeFeedFlow` + `src/features/{home,author,search}` ×30: 399 passed each run, 0 failed runs. The installed release-like build predates the review patches (host-tested only).
