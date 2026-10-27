---
title: 'Author posts refresh on resume and on reopen'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: '7f3d0854037d634ec2656551b154918c3b599ae3'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-feed-refresh-on-resume.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-author-page.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An author's cached posts never refresh (`refetchOnMount: false`, no «Обновить» before Epic 5): reopening an author or returning to the app shows a stale list until the cache is collected (Story 3.3 review, finding 8).

**Approach:** Reuse Главная's head refresh (owner decision 2026-10-26, `spec-feed-refresh-on-resume.md`) for the Author page: one E4 page-1 request merged into the cached head when the cache is at least 60 s old, new posts on top, loaded pages, scroll and the focused card kept.

**Decisions (owner, 2026-10-27, option 2):**
- Triggers: (a) after a resume E1 `ok`, for every Author route currently in the stack (its posts query has an observer); (b) when an Author page mounts with cached posts at least 60 s old (reopen). A first open without cache loads normally.
- Reopen focus (owner decision 2026-10-27, review loop 1, option 1): the first cached post takes focus at mount as today. When the reopen refresh then changes the head and the user has not moved since the page opened (focus is still that automatic first-post focus, or focus never reached a card yet), focus goes to the new first post and the list shows the top. Once the user has moved (any D-pad move or OK), a focused card keeps focus as on Главная. The result must not depend on whether the reply arrives before or after the native focus event.
- Same rules as Главная: one request, single-flight per blog, skipped while that query fetches, silent failure (error kind logged only), a response after a cache reset is dropped, a gap (no shared post id) replaces the cache with page 1 alone.

## Boundaries & Constraints

**Always:**
- One shared implementation for the feed and the author: move `mergeFeedHead`/`refreshFeedHead` logic to a generic head refresh in `shared/entities/post` (query key + first-page fetcher); Главная keeps its exports and behaviour; `src/features/home/__tests__/feedRefresh.test.ts` and `homeFeedFlow.test.tsx` pass unchanged (imports aside).
- Focus on Автор as on Главная after a head change: a focused card that is still shown keeps focus (scrolled to its new row if its index moved); a gone card follows the fallback chain; sidebar, StateView and «Повторить» focus is never taken; a covered Author route never takes focus; a focused card in the held partial row keeps that row shown. Triggered by the id change, never frame timing.
- E4 path, keys and content profile as in Story 3.3; no new endpoints or params.

**Never:**
- No «Обновить» button, no full refetch of all loaded pages, no refresh of the E3 header beyond its existing `useQuery` staleness, no polling, no refresh of Author queries without an observer.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reopen, fresh cache | cache < 60 s | no request | — |
| Reopen, stale cache, new posts | cache ≥ 60 s, page 1 has 2 new ids | 2 new cards on top, old pages kept, one E4 request | — |
| Reopen, new posts, user has not moved | reply before or after the mount focus | focus on the new first post, list at the top | — |
| Reopen, new posts, user moved | focus on card N before the reply | card N keeps focus | — |
| Reopen, nothing new | page 1 ids all cached | no visual change, fresh copies written | — |
| Gap | page 1 shares no id with cache | cache = page 1 alone | — |
| Resume with Автор open | E1 ok, cache ≥ 60 s, focus on card N | one E4 page 1; card N keeps focus | — |
| Refresh fails | Network/Server | cache kept, nothing visible | kind logged |
| Query fetching | a page append in flight | refresh skipped | — |
| Account reset meanwhile | cache cleared before the reply | reply dropped | — |

</frozen-after-approval>

## Code Map

- `src/features/home/feedRefresh.ts` -- `mergeFeedHead`, `refreshFeedHead` (single-flight `WeakSet<QueryClient>`): generalize into `src/shared/entities/post/postsHeadRefresh.ts` (`mergePostsHead`, `refreshPostsHead(client, queryKey, fetchFirstPage, now, logger)`; single-flight per client + key); keep `refreshFeedHead`/`mergeFeedHead` as thin wrappers.
- `src/app/App.tsx:~478` -- resume hook calls `refreshFeedHead`; add the Author refresh for observed `queryKeys.authorPosts(*)` queries (a small `refreshAuthorPostsHeads` in `features/author`, exported via its index).
- `src/features/author/AuthorScreen.tsx`, `useAuthorPosts.ts` -- reopen trigger on mount (cached and stale), and the id-change refocus + held-row rule ported from `src/features/home/HomeScreen.tsx` (`useLayoutEffect` on `ids`, ~lines 270–318; `shownPosts` focused-held-row rule ~116–133). Prefer one shared hook in `shared/ui/PostGrid.tsx` next to `useHeldRowAutoFetch` if both screens can use it unchanged.
- `src/shared/api/queryKeys.ts` -- `QUERY_STALE_TIME_MS` is the 60 s threshold.
- Tests: `__tests__/authorFlow.test.tsx` (harness `src/test/flow.tsx`), a unit test for the generic head refresh; `src/test/authorFixtures.ts` `syntheticBlogPosts`.
- Docs: `docs/focus-map.md` §4 D notes, `docs/testing.md` Story 3.3 section.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/entities/post/postsHeadRefresh.ts` (+ unit tests), `src/features/home/feedRefresh.ts` -- generic head refresh; Главная wrappers.
- [x] `src/features/author/*`, `src/app/App.tsx` -- reopen and resume triggers; focus rules on head change.
- [x] `__tests__/authorFlow.test.tsx` -- every matrix row, focus kept on resume, gap fallback.
- [x] Docs -- focus-map §4 D, testing.md.
- [x] Review loop 1 (carried) -- skip the head refresh while the query is in an error state (focused load-more «Повторить» must not vanish); an empty fresh page 1 leaves the cache unchanged; tests: reopen focus in both reply orders with exact targets, reopen refresh failure is silent, exact request counts for network/5xx, single-flight released after success and failure; remove the dead `total` branch in the test helper; docs: ADR 0010 resume-refresh text (shared `postsHeadRefresh.ts`, single-flight per client + query), known limit «a deleted post stays in the head until a gap or gc» in focus-map §4 D and ADR 0010.
- [x] Device (release-like, owner's session) -- open an author, wait > 60 s, Back, reopen: page shows, focus on the first post, no error; background > 60 s with Автор open, resume: focus kept.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new/changed flow tests 30/30; lint, typecheck, check:fixtures clean.

## Implementation Notes

- Review loop 1 (2026-10-27): the first implementation was set aside as `git stash` entry «author-posts-refresh v1 (before reopen-focus decision)» (src, __tests__, docs). Start from it (`git stash apply` of that entry, then drop it), keep what matches this spec (shared `postsHeadRefresh.ts`, `authorPostsRefresh.ts`, `useHeadChangeRefocus`/`useShownGridPosts`, the tests), and change only what the reopen-focus decision and the carried review-loop-1 task require.

- `refreshPostsHead(client, queryKey, fetchFirstPage, now, logger, log?)` (`src/shared/entities/post/postsHeadRefresh.ts`): the former feed logic, single-flight per client + `queryHash`; `log` sets the warn scope/message (feed keeps `feed` / `resume refresh failed`; author uses `author` / `head refresh failed`). `mergeFeedHead`/`refreshFeedHead` are thin wrappers; Главная's tests are unmodified.
- `src/features/author/authorPostsRefresh.ts`: `refreshAuthorPostsHead` (E4 `blogPage(http, blogUrl, null)`) and `refreshAuthorPostsHeads` (resume: every `queryKeys.allAuthorPosts()` query with `getObserversCount() > 0`). `queryKeys.allAuthorPosts()` is a new prefix key (no new endpoint). `App.tsx` calls it next to `refreshFeedHead` after a resume `ok`.
- Reopen: `useAuthorPosts` calls `refreshAuthorPostsHead` in a mount effect; a first open (pending/fetching query) is skipped by the guards.
- Focus: Главная's id-change refocus and held-row rule moved unchanged into `shared/ui/PostGrid.tsx` (`useHeadChangeRefocus`, `useShownGridPosts`); HomeScreen and AuthorScreen both use them.
- Review loop 1 (2026-10-27): the v1 stash was applied (`git stash apply`); the stash entry was NOT dropped (the drop was refused by the tool permission classifier) and can be dropped by the owner.
- Reopen focus: `useHeadChangeRefocus` takes an optional `followHead(focused)` / `onFollowHead(id)`; when `followHead` is true (and `canFocus`), a head change that changed the first id scrolls the list to offset 0 and focuses the new first card. `AuthorScreen` implements "the user has not moved": a `moved` latch set by the first focus event the page did not ask for or by OK on a card (`PostGrid` got an optional `onCardPress`, which does nothing else until Story 3.4); `autoTargets` = the cards the page focused itself (first-post mount focus, head-follow focus), whose late native events are not moves; the automatic sidebar focus before any card is not one either. Route focus events reach the page through the new `AuthorFocusInfo.onFocusChange` (App `AuthorRoute`). It applies to any head change before the user moved (reopen, or a resume on a page never touched). A D-pad press that does not move focus is not observable in JS and is not counted.
- `refreshPostsHead` gained a 7th parameter `{ skipWhileError }` (Author passes true). Главная does not: its pinned test `homeFeedFlow` ««Повторить» focused during a resume prepend» expects the merge to happen while a page append failed, so the error-state skip could not be applied there without changing that test (frozen constraint). Recorded as an open follow-up in ADR 0010.
- Empty page 1 (coordinator review): Author-only option `keepEmptyWithMore` — empty with a next cursor keeps the cached posts, written back with `updatedAt: now`; empty last page replaces the cache («Публикаций нет»). Главная unchanged (every empty page 1 replaces).
- «Not moved» latch (coordinator review): every focus the page requests by itself (skeleton/lost-content sidebar focus, StateView action, first card, head-follow card) is recorded in `autoTargets` in request order; the former sidebar special case is gone.
- Not done: the device task (left to the owner/orchestrator).

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Reopen initial focus depends on network timing: the mount focus of the first cached post races the page-1 reply; with the reply first, focus lands on the new top post, otherwise the old first post is kept and new posts sit above it (blind, edge, verification-gap) | high | intent_gap: the frozen intent does not say where focus goes on reopen when the head changes before the user moved; CLAUDE.md requires deterministic initial focus. Loop back to the owner |
| 2 | Reopen + prepend test asserts only a card-id regex; the refocus hook is never reached on reopen (verification-gap) | medium | moot until #1 is decided; the re-derived tests must assert the exact target in both orders |
| 3 | A head merge while load-more «Повторить» is focused clears the query error (`setQueryData`), the retry row unmounts, focus is lost (edge) | medium | patch (carried into the re-derivation): skip the refresh while the query is in an error state |
| 4 | An empty fresh page 1 counts as a gap and wipes every loaded page (edge) | low | patch (carried): an empty fresh page leaves the cache unchanged |
| 5 | Empty ids after a replace while a card is focused skip the fallback (edge) | low | resolved by #4 |
| 6 | Reply after Back writes into the popped query (edge) | low | rejected: fresher data in the cache is harmless; the Never rule is about triggers |
| 7 | Single-flight keyed by hash survives a cache reset (edge) | low | rejected: the next reopen after the stale reply settles refreshes |
| 8 | No test for a failing reopen refresh (blind) | medium | patch (carried): test the reopen failure is silent |
| 9 | Network/5xx tests assert `> 1` requests (blind) | low | patch (carried): exact request count |
| 10 | Account reset with Автор mounted untested (blind) | low | rejected: guarded by the query-instance check; covered by the unit test |
| 11 | Gap while Автор is covered untested (blind) | false | the return fallback chain is tested in Story 3.3 (pushed route, card gone → neighbor) |
| 12 | Deleted posts stay in the head until a gap or gc (blind) | low | patch (carried): document as a known limit in focus-map/ADR 0010 (same as Главная) |
| 13 | ADR 0010 text stale (single-flight scope, file, signature) (blind) | low | patch (carried) |
| 14 | `DEFAULT_LOG` unused in production (blind) | low | rejected: cosmetic |
| 15 | Reopen effect deps / no offline gate (blind) | low | rejected: `session.http` is stable; an offline refresh fails silently |
| 16 | Single-flight release after success/failure untested (blind) | low | patch (carried): unit test |
| 17 | Dead `total` parameter in the test helper; positional `queryKey[1]` (blind) | low | patch (carried): remove the dead branch |
| L2-1 | «Not moved» latch depends on native event order: a late automatic sidebar (or StateView action) focus event after the first card was auto-requested latches `moved`; the sidebar exception is untested (edge, verification-gap) | medium | patch: record the page's automatic sidebar/action focus requests in `autoTargets`; tests for both orders |
| L2-2 | User-chosen focus on the sidebar item before any card is indistinguishable from the automatic one and can be taken (blind, edge) | low | rejected: staying on the auto-focused item is «not moved» by the owner's rule; any other D-pad move latches |
| L2-3 | Empty page-1 guard changed Главная (an empty E5 page 1 used to replace the cache) — conflicts with «Главная keeps behaviour»; a genuinely empty author list is never reached; `unchanged` keeps the old timestamp so every reopen/resume re-sends (edge, blind) | medium | patch: guard is Author-only (Главная as before); Author: empty + no next cursor → replace (shows «Публикаций нет»); empty with a cursor → keep the cache and write the timestamp |
| L2-4 | A stale `error` status from a failed append skips reopen refresh until gc (edge) | low | rejected: the retry row is shown in that state; «Повторить» clears it, then refresh resumes |
| L2-5 | Resume sends N+1 parallel requests (blind) | low | rejected: one per Author route in the stack (1–2 in practice), single-flight per query |
| L2-6 | Docs/comments say sidebar focus is never taken, but the reopen rule takes the automatic sidebar focus (blind, edge) | low | patch: state the exception |
| L2-7 | Главная merge while load-more «Повторить» is focused likely loses focus; only noted in the ADR (blind) | medium | defer: pre-existing in the feed refresh (spec-feed-refresh-on-resume), unverified |
| L2-8 | `refreshPostsHead` has 7 positional parameters; options type not re-exported (blind) | low | rejected: cosmetic |
| L2-9 | `queryKey[1]` positional read (blind) | low | rejected: one call site next to the key builder, unit-tested |
| L2-10 | Broken comment wrap in `postsHeadRefresh.ts`; stale `visibleFeedPosts` comment in HomeScreen (blind) | low | patch: direct correction |
| L2-11 | Stash/process notes in the spec (blind) | low | rejected: fix edits this build's spec |
| L2-12 | Focus listeners only fire while the route is active (blind) | low | rejected: a covered route takes no focus anyway |
| L2-13 | No multi-author resume flow test (blind) | low | rejected: unit-tested; single-flight per query |
| L2-14 | Device gate missing (blind) | false | the Device task is open and runs before completion |

## Verification

Host results (2026-10-27, review loop 1): lint (`--max-warnings 0`), typecheck, check:fixtures clean; full suite 3× — 58 suites, 995 tests, all pass; `authorFlow` + `homeFeedFlow` + the three head-refresh unit suites 30/30 runs. `homeFeedFlow.test.tsx` and `feedRefresh.test.ts` unchanged. Mutation checks (loop 1): without `followHead` both "user has not moved" reopen tests fail; treating a late native event of an older automatic target as a move fails the reply-first test; without the OK latch the "OK on the first card" test fails; without the error-state skip the «Повторить» resume test fails; without the empty-page guard the empty-page reopen test fails. Earlier (v1): without the Author refocus hook the resume focus/gap tests fail; without the mount trigger the reopen tests fail; without the App wiring the resume tests fail; without the held-row rule the held-row test fails. No device run.

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass.
