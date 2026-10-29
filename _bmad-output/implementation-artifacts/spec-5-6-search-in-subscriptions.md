---
title: 'Story 5.6: Search in subscriptions'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: '2166b460eb2b5b6b7fd934970c2559e239d95dab'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to find a post by name across the subscriptions (FR26, FEED-04, SEARCH-SCOPES; epics.md Story 5.6). The «Поиск» sidebar section is phase-gated off.

**Approach:** Turn on `phaseFlags.search` and add the Поиск section (focus-map E): a system-keyboard field labelled «Поиск по подпискам», a «Фильтры» chip that edits a new `search` Filter scope, and a 3-column result grid. Results come from E6 (`/v1/search/feed/post/`) with E5's params plus `search_query`, through the shared paged-posts and grid patterns. Opening a result and pressing Back restores the query, the Filter and the focused card.

**Decisions:**
- The search fires on «Готово» only (EXPERIENCE.md Flow 4, the E2 mock). Back with the keyboard open closes it without searching. This is our improvement over the reference's 1 s debounce on every keystroke (BoostBuddy `HandleSearchStateChanges`, SHA `87c0852044d9b98b3ee1e94a544e78e250f4b5c9`), because typing on a TV keyboard would otherwise send a request per pause.
- The query is trimmed. If it is empty after the trim, «Готово» shows the hint state and sends no request. The trimmed query is part of the query key.
- `search` is its own Filter scope, as decided in planning (AD-18). The reference shares the feed's filter instead. The `search` scope uses the same sheet as Главная, feed tags (E13) included.
- An all-locked result page is ordinary: no session (E1) check. No «Обновить» on Поиск. No search history or suggestions, because the reference has none.
- Owner decision 2026-10-29 (Q1 a): the submitted query lives in an in-memory, account-scoped store (wiped on sign-out and account switch, kept across a same-account re-login, never persisted). Leaving Поиск through the sidebar and coming back shows the same query and its cached results, with focus on the field.
- Owner decision 2026-10-29 (Q2 a): no background head refresh for search results (no resume refresh, no `refreshPostsHead`). The results are a snapshot until the next «Готово». «Готово» on the same query refetches page 1 (the list is reset to that page).
- Before relying on E6, verify it live (debug build, counts and booleans only, log removed before the commit). Check the shape (`data.searchPosts[].post`, `extra`), that a query with the access, period and tag params is honoured, and paging. Record «E6 (LIVE)» in `docs/api-contract.md`. If E6 does not behave, stop and report.

## Boundaries & Constraints

**Always:** Request on «Готово» only. Search keys get their own root and never prefix-match a feed or author key (AD-7). The query is never logged; the counts-only rule applies. Trim on change (`trimPostsToFirstPage`) when the query or Filter changes. Focus moves by explicit targets. Every list state exists: hint, skeleton, results, filtered-empty, empty, error with «Повторить», inline load-more «Повторить». Copy goes in `ru`; tokens come from `shared/ui`.

**Never:** No blog search or `author:` scope (Story 5.7). No custom keyboard, voice, history or suggestions. No debounce or search-as-you-type. No persistence across a restart. No search query in a URL log or crash report.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | OK on «Поиск» in the sidebar | Focus on `search/field`, hint shown, no request | — |
| Submit | «капуста» + «Готово» | E6 `search_query=капуста` + the `search` Filter params; skeleton; focus → first result | E6 error → «Повторить» focused, query kept |
| Nothing found, default Filter | `searchPosts: []` | «Ничего не найдено», focus → field | — |
| Nothing found, filters active | `[]` + access ≠ default | + «Сбросить фильтры», focused; OK resets `search` only and re-runs | — |
| Blank | «   » + «Готово» | hint state, no request | — |
| Back with keyboard open | typing | keyboard closes, no request, focus on field | — |
| Filter change | results shown, sheet toggles | refetch behind the sheet; old key trimmed | — |
| Load more | `isLast` false | next page with the opaque offset, deduped by id | inline «Повторить» |
| Return from Post | OK on a result, then Back | same query, Filter, card and scroll | gone card → neighbor → first → field |
| Sidebar round trip | results shown → Главная → Поиск | same query and results from cache, focus on field, no request within `staleTime` | sign-out wipes the query |
| Same query again | «Готово» on the shown query | page 1 refetched, list reset to it | error → «Повторить» |
| Key isolation | the same Filter on `feed` and `search` | different query keys; a `feed` change never refetches search | — |

</frozen-after-approval>

## Code Map

- `src/app/phaseFlags.ts` -- `search: true`. Update the doc comment.
- `src/app/Shell.tsx:397` -- render `SearchScreen` for `'search'` (http, routeKey, focusOnMount, focus info like `subsFocus`, onOpenPost, filtersEnabled). Add `'search'` to `SELF_FOCUS_SECTIONS`.
- New `src/features/search/` (`SearchScreen.tsx`, `useFeedSearch.ts`, `index.ts`, `__tests__/`) -- follow the `features/home` layering. The screen uses `TextField` (`src/shared/ui/TextField.tsx`; `focus()` does not open the IME) and `FilterChip`. Use `PostGrid` with `useShownGridPosts`, `useHeadChangeRefocus` and `useLoadMoreRetry` from `src/shared/ui/PostGrid.tsx`, and `setReturnFocus` for Back from Post (Главная's pattern, `HomeScreen.tsx`). Ids: `search/field`, `search/action/filters`, `search/result/<postId>`, `search/retry`, `search/reset-filters`.
- New `src/features/search/searchQueryStore.ts` -- a Zustand store of the submitted query (Q1 a), on the `filtersStore` pattern: `defineAccountScoped('searchQuery', …)`, registered in `src/app/bootstrap.ts:41` next to `filtersAccountStore` (the `__tests__/accountScopeRegistry.test.js` registry check). The field's draft text is local state, seeded from the store on mount.
- `src/shared/filters/filter.ts:54` -- `FilterScope = 'feed' | 'search'`. `FilterSheet` and `TagList` already take `scope`.
- `src/features/home/HomeScreen.tsx:164-205` -- move `chipLabels` / `chipTagsValue` into `src/shared/filters` (exported) and reuse them in Поиск.
- `src/shared/api/queryKeys.ts` -- `feedSearch(query, filter)` → `['search', 'feed', {query, access, period, tagIds}]` and `allFeedSearches()`. Story 5.7's blog search will be `['search','blog',blogUrl,…]`.
- `src/shared/api/dto/feed.ts` -- `feedSearchPageDtoSchema`: `data.searchPosts[]` of `{post: unknown}`. A bad item is dropped, never the page; `extra` reuses `feedPageDtoSchema.shape.extra`.
- `src/shared/entities/post/postRepository.ts:41-87` -- `feedSearchPath(query, cursor, filter, now)` reuses the access, period and tag param builders, plus `&search_query=<encoded>`. Add `PostRepository.feedSearchPage`, which goes through `toPage`.
- `src/shared/entities/post/usePagedPosts.ts` -- reuse as-is. The trim on change follows `useSubscriptionFeed.ts:66-77`.
- `src/shared/i18n/ru.ts` -- add `search.*` (field label «Поиск по подпискам», hint «Введите запрос и нажмите «Готово». Фильтры тоже сужают поиск.», «Ничего не найдено», «Сбросить фильтры», error and retry).
- `src/app/dev/demo.ts:344` -- demo `/v1/search/feed/post/`, a title substring match over the demo posts, honouring the Filter params.
- Fixtures: `src/test/fixtures/boosty/e6-feed-search-1.json`, `-2.json` (sanitized, `check:fixtures`).
- Do not change: Главная's feed key, `useSubscriptionFeed`, or the sheet levels.

## Tasks & Acceptance

**Execution:**
- [x] Live E6 check (debug build, owner's session, counts-only log removed); fixtures; `docs/api-contract.md` «E6 (LIVE)».
- [x] Scope type, keys, DTO, `feedSearchPath` / `feedSearchPage`, demo transport; move the chip labels to shared.
- [x] `features/search` screen and hook; Shell wiring; flag on.
- [x] Tests: new `__tests__/searchFlow.test.tsx` covering every matrix row, Back with keyboard → sidebar, «Готово» focus rules, return from Post, and 300 results virtualized. Unit tests for `feedSearchPath` (encoding of Cyrillic, `&`, `#`), the DTO drop rules, and the `queryKeys` non-collision with feed and author.
- [x] Docs: `docs/focus-map.md` E (ids, states, the return rule), `docs/feature-parity.md` FEED-04 / SEARCH-SCOPES «Android (Story 5.6)», `docs/testing.md` Story 5.6.
- [x] Device (release-like, adb, owner's session): open Поиск, type and submit, open a result and Back, filter change, nothing found, blank. Send screenshots to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then everything passes. `searchFlow` and the new suites pass 30/30. Lint `--max-warnings 0`, typecheck and `check:fixtures` are clean.
- Given a release-like build on the pinned device, when Поиск is used with the remote only, then the matrix rows Open, Submit, Nothing found, Back with keyboard open and Return from Post behave as specified (recorded honestly in `docs/testing.md`).

## Implementation Notes

- Live E6 (2026-10-29, debug build, counts-only `TEMP56` probe, removed): the reference shape (`data.searchPosts[]{post, rank, headline}`, `extra`), paging without overlap, period / tags / «Только купленные» honoured with `search_query`. «Все посты» showed no locked post for the probe query, so the access split is proven only for «Только купленные». Recorded in `docs/api-contract.md` «E6 (LIVE)».
- `onOpenPost` gained an optional `section` (App → Shell → SearchScreen passes `'search'`), so Пост's sidebar current item is Поиск.
- `TextField` gained `onFocus` and `hostRef` (the field is a content zone item).
- Device fixes: the chip is focusable only while the field row has focus (↑ from column 3 reached the chip instead of the field); ↓ into the grid goes through a guide around the grid with an explicit box (a band under the text field never won the focus search; an unstyled wrapper collapsed the list).
- Open for the owner: with text in the field, ← first moves the caret (Android EditText) and reaches the sidebar only from the start of the text; focus-map E says «← from the field → sidebar». Documented in `docs/focus-map.md` E, not worked around.
- Not seen on the device: an E6 error, a load-more failure, a Cyrillic query (adb cannot type it), the physical remote, TalkBack.

## Spec Change Log

## Review Triage Log

Iteration 0 (layers: blind-hunter 12, edge-case-hunter 3, verification-gap 1 gap).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge | `pendingOutcome` resolved only on a phase change; a held error through a retry or a «Готово» refetch keeps the phase 'error' | medium | patch | `useHeldError` returns the last error while empty and fetching, and `resetQueries` leaves the query empty and fetching: a second failure never changes the phase, so focus is not sent to «Повторить» (matrix «Submit») and the flag stays set. |
| 2 | blind, edge | No `maxLength` on the field; a very long query could fail with 414 | low | reject | Typing hundreds of characters on a TV remote keyboard is unlikely; the failure lands in the handled error state with «Повторить». A cap would guard a failure that was never observed. |
| 3 | edge | After `gcTime` (10 min away) the stored query refetches page 1 on return | low | reject | `refetchOnMount: false` holds while cached; once collected, one page-1 request is the only way to show results for the kept query (Q1 a); no page storm. |
| 4 | blind | Draft text survives a query wipe while the screen is mounted | false | reject | Sign-out resets the stack to Welcome (`App.tsx` `navigationRef.reset`) and an account switch runs before the Shell opens, so Поиск always remounts with the wiped store. |
| 5 | blind | No on-screen link between the results and the submitted query | low | reject | The E4 mock has no such line; editing without «Готово» is ordinary search-field behaviour. |
| 6 | blind | The hint mentions filters when `phaseFlags.filters` is off | low | reject | The flag is on in every shipped build; off is a code-only configuration. |
| 7 | blind | Sprint status `in-progress` vs spec `in-review` | false | reject | The workflow moves the sprint status at its own steps (step-05). |
| 8 | blind | `docs/testing.md` «Story 5.6» lacks the host run results | low | patch | Earlier story sections record the commands and counts; added after the final verification. |
| 9 | blind | Unverified device items have no follow-up | low | reject | Listed in `docs/testing.md` «Story 5.6»; the wiki problem «Не проверено на устройстве» tracks device gaps. |
| 10 | blind | `FIELD_WIDTH = 440` is not a token | low | reject | One screen-local layout value; no field-width token exists. |
| 11 | blind | `useFeedSearch` trim effect runs every render | low | reject | One `JSON.stringify` of a small key per render; no observable cost. |
| 12 | blind | No host test of chip focus after the sheet closes | false | reject | `searchFlow` «Filter change» asserts `lastFocusTarget()` is the chip after Back. |
| 13 | blind | Code Map misses the `onOpenPost` section parameter | low | reject | The fix edits this build's spec. |
| 14 | vgap | The "no background refresh on resume" test fires no AppState change | low | patch | `searchFlow.test.tsx:676` asserts only the E1 count; a resume refresh of search would pass it. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean.
- `npm test` ×3 -- expected: all pass.

**Result (after the review patches, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 1901 passed each; `searchFlow` + `demoFlow` + `src/features/search` + `postRepository` + `queryKeys` ×30: 112 passed each run, 0 failed runs. The installed release-like build predates the review patches (host-tested only).
