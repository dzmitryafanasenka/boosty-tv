---
title: 'Feed refresh on return from background (AD-7)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: '8b84e5b3799cf3df7123ecc991473c65f4492a9a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/adr/0010-server-state-tanstack-query.md'
  - '{project-root}/docs/adr/0011-feed-list-flashlist.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since Story 3.1 the feed refreshes only by explicit action (`refetchOnMount: false`, no resume invalidation), so a TV left in the background for hours shows a stale «Новое в подписках»; a same-account re-login after «Сессия истекла» can keep a feed fetched with a dead token (all locked) (deferred-work "Feed freshness (AD-7)").

**Approach:** On return to the foreground, after the resume E1 succeeds, refresh the head of the feed (page 1 only) when the cached feed is older than 60 s, and merge new posts on top while keeping the loaded pages, the scroll position and the focused card. After any successful sign-in, reset the query cache.

**Decisions (owner, 2026-10-26):**
- Deep in the feed: new posts are added on top; the user stays on the same card (sees them by scrolling up); loaded pages are kept.
- Refresh only when the cached feed is ≥ 60 s old (`QUERY_STALE_TIME_MS`); a quick out-and-back sends nothing.
- After a re-login to the same account (A11 → sign-in) the query cache is reset, so the feed loads fresh.

## Boundaries & Constraints

**Always:**
- One E5 request per resume refresh (page 1, no cursor); never refetch all loaded pages. Only after the resume `validate()` result is `ok`; never while offline/expired/signed out or when no feed is cached.
- Merge: the fresh page 1 goes in front of the existing pages; `mergePosts` dedupe by `post.id` (first kept); the next-page cursor stays the one from the last loaded page. If page 1 shares no post with the cached feed (a gap larger than one page), replace the cache with page 1 alone (focus follows the existing fallback chain).
- Focus: if a feed card had focus when the merged data is applied, the same card (by id, captured at apply time) keeps focus and stays visible (scroll to its new row); sidebar/StateView/«Повторить» focus is never taken; a covered Shell never takes focus. The trigger is the head change caused by this refresh, not frame timing.
- A failed refresh is silent: cached data and focus stay; logged without content.
- Re-login reset uses the existing `resetQueryCache` (cancel, then clear); account switch keeps its current path.

**Never:**
- No pull-to-refresh button, no NetInfo, no focus-based refetch, no changes to `sessionManager.ts` (ADR 0009), no new endpoint.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Quick return | background < 60 s since `dataUpdatedAt` | no E5 request | — |
| Stale return, new posts | ≥ 60 s, E1 ok, page 1 has 2 new + 8 known | 2 posts on top, all loaded pages kept, focused card unchanged and visible | — |
| Stale return, nothing new | page 1 equals the cached head | no visible change, focus unchanged | — |
| Gap | page 1 shares no id with the cache | cache = page 1 only; focus → fallback chain | — |
| Refresh fails | E5 network/server error | nothing changes | logged |
| Resume E1 fails/expired | E1 `failed`/`expired` | no E5 request | — |
| Focus on sidebar | `nav/home` focused | data merged, focus stays on `nav/home` | — |
| Re-login same account | A11 → sign-in ok | cache reset → feed loads fresh | — |

</frozen-after-approval>

## Code Map

- `src/app/App.tsx:304-310` -- `AppState` listener: `session.onAppStateChange(state)` → `result.kind === 'ok'`; hook the head refresh here (with `session.http`, the app `queryClient`). `onSignedIn` (`:114`) -- add `resetQueryCache()` for every successful sign-in (account switch already wipes via AccountScope; a second reset is harmless).
- `src/app/queryClient.ts` -- `queryClient`, `resetQueryCache`, `QUERY_STALE_TIME_MS`.
- `src/features/home/useSubscriptionFeed.ts` -- infinite query (`queryKeys.subscriptionFeed()`, `initialPageParam: null`, `nextFeedCursor`, `refetchOnMount: false`, auto-fetch cap); `src/shared/entities/post` `PostRepository.feedPage(http, cursor)`, `mergePosts`.
- `src/features/home/HomeScreen.tsx` -- `ids`/`visibleFeedPosts`, `restoration.focusItem`, `HomeFocusInfo` (`isActive`, `current`, `canFocus` gate); `FeedGrid.tsx` rows keyed by their first post id (a prepend regroups rows → rows remount; hence the explicit re-focus).
- `src/features/home/index.ts` -- export the refresh helper for `app`.
- `__tests__/homeFeedFlow.test.tsx` (FixtureTransport, fake timers, `QUERY_STALE_TIME_MS`), `__tests__/sessionFlow.test.tsx` (AppState capture pattern), `__tests__/expiredFlow.test.tsx` (A11 → re-login).
- `docs/adr/0010-server-state-tanstack-query.md` (freshness section), `docs/focus-map.md` §3, deferred-work entry "Feed freshness (AD-7)".

## Tasks & Acceptance

**Execution:**
- [x] `src/features/home/feedRefresh.ts` (+ unit tests) -- `refreshFeedHead(client, http, now)`: guards (cache exists, age ≥ stale time, not already running), one `feedPage(http, null)`, merge rule (prepend page, keep pages/params, gap → replace), `setQueryData` with a new `updatedAt`; errors swallowed + logged -- the refresh.
- [x] `src/features/home/HomeScreen.tsx` -- when the head (first visible post id) changes and the captured focused id is a feed card still present, `restoration.focusItem(id)` gated by `canFocus` -- keep the focused card.
- [x] `src/app/App.tsx` -- call `refreshFeedHead` after a resume `ok`; `resetQueryCache()` on sign-in success -- wiring.
- [x] Tests: every matrix row (`homeFeedFlow`/`sessionFlow` with AppState capture and fake timers; `expiredFlow` re-login reset); the focused card keeps focus after a 2-post prepend that regroups rows.
- [x] Docs: ADR 0010 freshness note, focus-map §3 note, deferred-work entry note "done".
- [x] Device: background (HOME) ≥ 60 s with focus deep in the feed, return → no focus loss, same card visible; quick return → nothing (adb; new posts may not exist live — then host tests cover the merge).

**Acceptance Criteria:**
- Given the full suite, when run 3×, then all pass; new/changed flow tests 30/30; lint, typecheck pass.

## Implementation Notes

- `refreshFeedHead(client, http, now, logger?)` uses `QUERY_STALE_TIME_MS` (moved to `src/shared/api/queryKeys.ts` so features can read it; `src/app/queryClient.ts` re-exports it) against `dataUpdatedAt`, and writes `updatedAt: now`. Extra guards beyond the spec: it sends nothing while the feed query itself is fetching, and it drops a reply when a fetch started meanwhile or the cached query instance changed (sign-out, account switch or re-login reset).
- Collapse merge: page 1 is merged into the cached first page (fresh posts first, then the old first page's other posts; fresh copies win; the old first page's cursor kept); `pageParams` and later pages are untouched, so the page list never grows. A page with nothing new still writes the fresh copies.
- `HomeScreen`: the re-focus triggers on any non-append change of the shown ids; the focused element is read in a `useLayoutEffect`. A card still shown whose index or row key changed → `scrollToIndex` (only if its index moved) + `restoration.focusItem`; a card gone → `restoration.restore()`, else `focusInitial()`. `home/feed/retry` shares the card prefix and is excluded. A held partial row that contains the focused card (`focus.current()` at render) is shown.
- `HomeScreen`'s "page added only held posts" auto-fetch now also requires the last post to change, so a 1-post prepend (no new shown row) sends no second E5.
- `onSignedIn` awaits `resetQueryCache()` before opening the Shell, so the cache clear can never cancel the Shell's first E5.
- Not done here: the device task (left to the owner). Not covered by this spec: a cold-start E5 sent in parallel with an E1 that then refreshes the token (noted in deferred-work).

- **Device (orchestrator, adb, release-like, 2026-10-26):** focus deep in the feed (column 2 and column 3 runs) → HOME 66 s → return: same card focused at the same bounds; ↓ continues in the column; quick return (5 s): unchanged; no JS errors. The release build has no logs, so the E5 request and a live merge were not observed (no new posts appeared); the merge is host-tested.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | "Unchanged" merge keeps stale copies of known head posts (locked→unlocked never applied; anonymous cold-start page persists) (blind, edge) | medium | patch: collapse with fresh copies winning |
| 2 | Each refresh prepends a page: pages/pageParams grow, later refetch follows another cursor chain (blind, edge) | medium | patch: collapse into `pages[0]`, params unchanged |
| 3 | Re-focus only when `ids[0]` changes; inserts below an unchanged head regroup rows (edge) | medium | patch |
| 4 | Focused card can fall into the held partial row after a prepend → hidden, focus jumps (edge) | medium | patch: keep the re-focused card's row shown |
| 5 | Gap case: `restore()` `'none'` leaves nothing focused (edge) | low | patch: `focusInitial()` |
| 6 | Threshold read from `getDefaultOptions()`; `now` vs `Date.now()` mixed (blind) | low | patch |
| 7 | Post-await "fetch started meanwhile" drop untested; «Повторить» focus during refresh untested (verification-gap) | medium | patch: tests |
| 8 | Matrix rows partly covered: E1 `expired` on resume, E5 network/5xx in the flow (blind, edge) | low | patch: tests |
| 9 | deferred-work says "Done" and wrongly says the anonymous page ages out (blind, edge) | low | patch: accurate note |
| 10 | Freshness measured from the last page append, not page 1 (blind) | low | patch: documented in ADR 0010 (acceptable: an active user just loaded data) |
| 11 | Posts removed on the server stay in the cached feed (edge) | low | rejected: no removal signal is verified; a re-login/sign-out or cache gc clears it; documented |
| 12 | Refresh runs on resume even when Главная is not shown / demo mode (blind) | low | rejected: updating the cache is harmless and makes Главная fresh when opened; demo uses its own transport |
| 13 | `onSignedIn` waits for `cancelQueries` before the Shell (blind) | low | rejected: cancellation resolves synchronously for idle/aborted queries; first sign-in has no queries |
| 14 | A refresh dropped because a fetch started is silent (edge) | low | rejected: `updatedAt` is unchanged, so the next stale resume retries |
| 15 | Re-focus relies on JS focus state ordering; native behaviour unproven (blind) | low | rejected as code change: device check (66 s background, deep focus) passed on 2026-10-26; recorded in Implementation Notes |

## Verification

Host results (2026-10-26): lint (`--max-warnings 0`) and typecheck clean; full suite 3× — 51 suites, 829 tests, all pass; `homeFeedFlow` + `expiredFlow` + `feedRefresh` unit tests 30/30 runs. Mutation checks: without the sign-in reset the new `expiredFlow` test fails; without the re-focus the 2-post prepend test fails; without the last-post guard the 1-post prepend test fails. No device run.

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck` -- clean.
- `npm test` ×3 -- all pass; `homeFeedFlow` 30/30.
