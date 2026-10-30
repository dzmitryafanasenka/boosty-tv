---
title: 'Epic 5 retro A4: shared outcome focus and trim hooks, Author screen split'
type: 'refactor'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e6138efbe69696a819c2bb88e242ca3d9ea64b4a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-retro-2026-10-29.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Epic 5 retro (A4, `epic-5-retro-item-22`) found duplicated code:
- The outcome-focus machinery is copied in `SearchScreen.tsx` and `AuthorScreen.tsx`, and the copies already drifted once (retro F1).
- Trim-on-key-change is written four ways, two of them without a deps array.
- The flow-test grid helpers are redefined in three test files.

`AuthorScreen.tsx` has grown to 982 lines in one component. Epic 7 Story 7.1 adds the LiveCard to this screen.

**Approach:**
- Extract `useOutcomeFocus` into `shared/focus` and `useTrimOnKeyChange` into `shared/entities/post`, and move both screens and all four list hooks onto them.
- Move the identical grid helpers into `src/test/flow.tsx`.
- Split `AuthorScreen.tsx` into focused hooks and components under `features/author/`, with the screen as the composer.
- Pure refactor: no change in behavior, focus timing, requests or copy.

## Boundaries & Constraints

**Always:**
- Every existing test passes, and its assertions keep their meaning. Only helper definitions move.
- Keep the import boundaries: `shared` never imports `features`, and Search and Author never import each other (`.eslintrc.js`, `__tests__/boundaries.test.js`).
- Keep the exports of `features/author/index.ts`, including `AUTHOR_STATE_ACTION_ID` and `authorCardId`.

**Never:**
- No behavior fixes. Known quirks stay as they are, for example Author's E3 `error`/`unavailable` outcome falling back to the field. Record them under Implementation Notes instead.
- Do not swap in `focusSoon`: it would change timing.
- No Story 7.1 code and no speculative hooks for it.
- Epic 6 retro A3 (the `PostBody`/`PollWidget` split) is out of scope.

</frozen-after-approval>

## Code Map

- `src/features/search/SearchScreen.tsx:241-351` — outcome copy.
  - Parts: `pendingOutcome`, `mayTakeOutcomeFocus`, `outcomeFetchSeen`, `awaitOutcome`, `resolveOutcome` (returns void), the rAF loop (`OUTCOME_FRAME_TRIES = 30`, `:65`), the fetching-cycle effect.
  - Phase `hint` keeps waiting and clears the flag.
  - Callers: `onSubmit` 356-372 (clears the flag directly on a blank query), `onRetry`, `onResetFilters`.
- `src/features/author/AuthorScreen.tsx:410-509` — outcome copy.
  - Same `awaitOutcome` body. `resolveOutcome` returns boolean. Only `loading` keeps waiting.
  - `usePhaseChange` wrapper with the screen fallback: 511-545.
  - Callers: `onRetryList`, `leaveSearch` (clears the flag), `onSubmit`, `onResetFilters`.
- Outcome differences that must become parameters:
  - the fetching flag (`results.isFetching` vs `list.isFetching`);
  - the shown key (`feedSearch(query, filter)` vs `listKey`);
  - the allowed focus ids;
  - the wait and drop phases;
  - the per-phase focus action (results/grid → `scrollToOffset(0)` + `restoration.focusInitial()`; error or filtered-empty → state action; else → the field).
- `src/shared/focus/screenFocus.ts:48-71` — `useLatestRef`, `usePhaseChange`; reuse.
- Trim copies, all calling `trimPostsToFirstPage(client, prevKey).catch(() => {})` (`src/shared/entities/post/postsHeadRefresh.ts:277-289`):
  - `src/features/home/useSubscriptionFeed.ts:69-79`
  - `src/features/author/useAuthorPosts.ts:44-51`: it must stay after the head-refresh effect at 41-43.
  - `src/features/search/useFeedSearch.ts:31-40`: no deps array.
  - `src/features/author/useBlogSearch.ts:45-54`: no deps array.
- Grid helpers:
  - `grid()` in `__tests__/authorFlow.test.tsx:193`, `searchFlow.test.tsx:181` and `subscriptionsFlow.test.tsx:169` is identical apart from the testID.
  - `homeFeedFlow.test.tsx:186` differs; leave it.
  - Every `openSheet` is screen-specific; leave them all.
  - `src/test/flow.tsx:175` (`lists`) is the place for the shared helpers.
- `AuthorScreen.tsx` concerns:
  - ids 57-121
  - filter/query state 176-200
  - focus primitives 234-363
  - route focus 389-408
  - head refocus 548-558
  - blog search 582-645
  - filters 651-696
  - action-row focus 702-742
  - render 749-928
- Pinning tests:
  - `searchFlow` 238-535 (submit matrix, slow device, retro A1) and 835 (trim);
  - `authorFlow` 1466-1780 (Story 5.7 search, filters, trim, slow device, cached empty);
  - `homeFeedFlow:2941`; `subscriptionsFlow:989`;
  - `postsHeadRefresh.test.ts:360`; `screenFocus.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/focus/useOutcomeFocus.ts` (+ `index.ts` export) -- the hook `useOutcomeFocus({client, phase, isFetching, shownKey, mayTakeFocus, waitPhases, dropPhases?, onOutcome})` → `{awaitOutcome(key), cancel(), resolve(): boolean}`. It owns the refs, the rAF loop, the unmount cancel and the fetching-cycle effect, and reads the latest render's values through refs. It does not call `usePhaseChange`. -- one copy instead of two.
- [x] `src/shared/focus/__tests__/useOutcomeFocus.test.tsx` -- unit tests: no focus while waiting; settle after the fetch cycle; a cached key with no fetch settles on a later frame; it gives up after 30 frames; `mayTakeFocus` false → nothing; a drop phase clears the flag; `cancel()` clears it; unmount cancels the frame.
- [x] `src/features/search/SearchScreen.tsx` -- use the hook (`waitPhases ['loading','hint']`, `dropPhases ['hint']`) and `usePhaseChange(phase, () => { resolve(); })`. -- dedupe.
- [x] `src/shared/entities/post/useTrimOnKeyChange.ts` (+ export, unit test) -- `useTrimOnKeyChange(client, key)` with `useEffect([client, keyString])`. It never trims on the first render, compares keys by their JSON string, passes the previous raw key to trim, and swallows errors. -- one copy instead of four.
- [x] `src/features/home/useSubscriptionFeed.ts`, `src/features/author/useAuthorPosts.ts`, `src/features/search/useFeedSearch.ts`, `src/features/author/useBlogSearch.ts` -- use `useTrimOnKeyChange`; in `useAuthorPosts` it stays after the head refresh.
- [x] `src/features/author/authorIds.ts` -- the ids, prefixes and `authorCardId`; `index.ts` re-exports them unchanged.
- [x] `src/features/author/useAuthorSearch.ts` -- query/draft state, `leaveSearch`, `onChangeDraft`, `onSubmit`, the Back handler; it takes the outcome `awaitOutcome`/`cancel`.
- [x] `src/features/author/useAuthorFilters.ts` -- the scope, Filter, reset on unmount, chip ref, `onOpenFilters`, `onResetFilters`, `onResetAll`.
- [x] `src/features/author/AuthorActionRow.tsx` + `useAuthorActionRowFocus.ts` -- the field, chip and reset JSX and the action-row focus logic (702-742).
- [x] `src/features/author/AuthorScreen.tsx` -- composes the pieces above plus `useOutcomeFocus`, keeps the phase fallback, route focus and head refocus. -- target under ~550 lines.
- [x] `src/test/flow.tsx` -- add `listProps(testID)` and `gridRowItems(testID, field)`; the wrappers in `authorFlow`, `searchFlow` and `subscriptionsFlow` become thin. Assertions are unchanged.

**Acceptance Criteria:**
- Given the refactor, when `npm test` runs 3 times, then it passes each time with the same number of existing tests plus the new unit tests, and no existing assertion was edited.
- Given the touched flow suites (`authorFlow`, `searchFlow`, `homeFeedFlow`, `subscriptionsFlow`, `screenFocus`, `postsHeadRefresh`), when they run 30 times, then none fails.
- Given the source tree, when the outcome and trim code is searched, then `awaitOutcome`, `OUTCOME_FRAME_TRIES` and `trimPostsToFirstPage(` appear only in the shared hooks (and in `feedRefresh.ts`, which uses trim for its own flow).
- Given lint (`--max-warnings 0`), typecheck and `check:fixtures`, when they run, then they are clean, including the boundary rules.
- Given a release-like build on the pinned device, when the agent opens Автор, searches, filters, resets and returns from a post over adb, then focus and results behave as before.

## Design Notes

`resolve()` returns `true` when it handled the phase. Author keeps its wrapper: `usePhaseChange(phase, () => { if (resolve()) return; /* screen fallback */ })`. Search ignores the result. `onOutcome(phase)` performs the screen-specific focus, so the hook knows nothing about field, results or state-action ids.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean
- `npm test` ×3 -- expected: all pass each run
- the touched suites ×30 -- expected: 0 failed runs
- `grep -rn "OUTCOME_FRAME_TRIES\|trimPostsToFirstPage(" src` -- expected: only the shared hooks and `feedRefresh.ts`

## Implementation Notes

- **Shared hooks.** `src/shared/focus/useOutcomeFocus.ts` holds the one copy of the outcome machinery (pending flag, fetch-seen flag, rAF settle loop with `OUTCOME_FRAME_TRIES = 30`, unmount cancel, fetching-cycle effect); `resolve()` checks drop phases first (clear, return false), then waiting phases, then `mayTakeFocus`, then calls `onOutcome(phase)`. `src/shared/entities/post/useTrimOnKeyChange.ts` holds the one copy of the trim; it stores the committed key (parsed from the JSON string the effect ran for, as the old `useAuthorPosts` did) and trims that one later, so a discarded render cannot desync it.
- **Grep AC.** `OUTCOME_FRAME_TRIES` and `trimPostsToFirstPage(` now appear only in the two shared hooks, `postsHeadRefresh.ts` (the definition) and `feedRefresh.ts`. `awaitOutcome` is the hook's API name, so the screens and `useAuthorSearch`/`useAuthorFilters` still call it; it is defined only in `useOutcomeFocus.ts`.
- **Effect order on Поиск.** Before, Поиск's `usePhaseChange` effect ran before its fetching-cycle effect; now the hook's fetching-cycle effect runs first (the screen calls `usePhaseChange` after the hook, as the spec says). Walked through every case (phase and `isFetching` changing in the same commit, to a waiting, drop or settling phase): the outcome and the flag end the same; only the leftover `fetchSeen` flag can differ, and `awaitOutcome` resets it before it is read. Автор keeps its old order.
- **Trim timing.** `useFeedSearch` / `useBlogSearch` had effects with no deps array; the hook runs on `[client, keyString]`. The trim still happens exactly when the key string changes, so requests are the same. `useSubscriptionFeed` used `[client, filter]` (object identity); the same holds. `useAuthorPosts` keeps the head-refresh effect before the trim.
- **Author split.** `AuthorScreen.tsx` 982 → 539 lines. New files under `features/author/`: `authorIds.ts`, `useAuthorSearch.ts`, `useAuthorFilters.tsx` (`.tsx`, not `.ts`: it renders `<FilterSheet>` into the modal), `AuthorActionRow.tsx`, `useAuthorActionRowFocus.ts`. To reach the size target two more seams were cut along existing blocks: `useAuthorAutoFocus.ts` (`useAuthorField` + the latch, the StateView action ref, `autoFocus*`, `focusAbove`, `focusAfterLoss`, `canFocus`, `mayTakeFocus`; `AuthorFocusInfo` moved there and is re-exported from `AuthorScreen.tsx`) and `AuthorStates.tsx` (the full-page E3 StateView body and the skeleton / page-1 error / empty views; the page root `View` stays in the screen, and the three list states keep their sibling slots, so the host tree and reconciliation are unchanged).
- **Circular data flow.** The Filter feeds the search, the search's query picks the list, the list feeds the phase, the outcome focus and the restoration; but the search and filter handlers call the outcome focus and the restoration, and the filter resets call the search. The screen passes `searchRef`, `outcomeRef` and `restorationRef`, set during render after each piece is composed and read only inside handlers (never during render). The hook order of the effects that existed before is kept: the Filter reset-on-unmount first; the latch, the route focus, the outcome effects, the phase change, the head refocus, the load-more retry and the row focus in their old order. Only the Back-handler effect moved earlier (it only sets a ref).
- **Test helpers.** `listProps(testID)` and `gridRowItems(testID, field)` in `src/test/flow.tsx`; `authorFlow`, `searchFlow` and `subscriptionsFlow` keep `grid()`/`gridPosts()`/`gridBlogs()` as one-line wrappers. Only the "not rendered" error text changed (now `no list rendered: <testID>`); no assertion changed. `homeFeedFlow` and every `openSheet` are untouched.
- **Known quirks kept (no behavior fixes).** Author's E3 `error`/`unavailable` phases are not waiting phases, so a pending outcome settles there: `onOutcome` falls back to the field, which the full-page StateView does not render (so nothing is focused), and `resolve()` returns true, so the screen's phase fallback (the StateView action) is skipped. Поиск's `stateAction` zone id still depends on the phase while Автор's is constant. Chip focusability is still modelled three ways across screens. F6 (an Author Filter change trimming the own-blog key Подписки observes) is unchanged: the trim hook keeps the same semantics.
- **Checks run (2026-10-30).** Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean. `npm test` ×3: 108 suites, 2335 tests each run (baseline 106 / 2322 + 13 new unit tests). The touched suites plus the two new ones ×30: 395 passed each run, 0 failed runs. Device: release-like build on the pinned Chromecast over adb; Автор open, search (none / results), Back clearing the search, Filter while searching, return from Пост, «Сбросить» and Back to Подписки behaved as in the Story 5.7 rows (`docs/testing.md` «Epic 5 retro A4»). Поиск was not re-driven on the device.
- **Review fixes (2026-10-30).** `cancel()` also cancels the scheduled frame and resets `fetchSeen`; `useTrimOnKeyChange` no longer writes a ref during render; `useAuthorFilters` returns only what the screen reads; `AuthorListState.phase` is `Exclude<AuthorPhase, 'unavailable' | 'error'>` (the screen exports `AuthorPhase`); `gridRowItems` throws on a field that is not an array. New tests: `authorFlow` «leaving a search while its E7 is pending» (Back and blank «Готово»; both fail with `outcome.cancel()` removed from `leaveSearch`), `useOutcomeFocus` Author config, a second `awaitOutcome` cancelling the first loop, and `cancel()` cancelling the frame. Pointers added in `docs/focus-map.md` and ADR 0010. Only the edited suites were re-run after these fixes (`useOutcomeFocus`, `useTrimOnKeyChange`, `authorFlow`, `searchFlow`, `subscriptionsFlow`, `homeFeedFlow`: pass); the counts above predate them.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter, Edge Case Hunter, Verification Gap):

- **VG1. `leaveSearch` cancelling a pending outcome has no test.** Every Back, blank «Готово» or «Сбросить» test lets E7 settle first. **Medium**, gap pre-verified by the layer. Patch: a flow test with E7 held.
- **EC1. A frame check in a wait phase stops the loop without clearing the flag.** **False.** The original `awaitOutcome` did the same: `resolveLater()` returned without clearing on `loading`. Behavior is unchanged.
- **EC2 / BH6. `useTrimOnKeyChange` writes `latestKey` during render.** A discarded render can split the raw key from `keyString`. **Low**, but the fix is direct. Patch: store the committed key in the effect.
- **EC3 / BH5. An account switch changes the client and the key in one commit, so the old key is trimmed on the new client.** **Low, rejected.** The four copies did the same before, and the trim of a key the new client lacks is a no-op.
- **EC4 / BH1. The grep AC names `awaitOutcome`, which call sites still use as the hook's API.** Rejected: the fix would edit this spec. The Implementation Notes record that only the definition moved.
- **BH2. The task list does not match the shipped files** (`.tsx`; extra `useAuthorAutoFocus.ts`, `AuthorStates.tsx`). Rejected: the fix would edit this spec. Recorded in the Implementation Notes.
- **BH3. Поиск's effect order changed with no test for a phase and `isFetching` change in one commit.** **False.** The `searchFlow` submit matrix (238-398), slow device (296) and retro A1 block (435-535) drive the real screen through those commits, and they pass unchanged.
- **BH4. `useOutcomeFocus` tests miss Author's config and a second `awaitOutcome`.** **Low**; adding tests is direct. Patch.
- **BH7. Refs are assigned in render, and handlers use `?.`.** **Low, rejected.** It is the codebase's `useLatestRef` pattern. The refs are set before any handler can run, and VG1's test now pins the cancel path.
- **BH8. Leaky hook APIs:**
  - `queryRef`/`setDraft` and the shared `fieldAuto` ref: **low, rejected.** Narrowing them is an API redesign beyond a direct fix.
  - Unused returns `scope` and `chipView`: **low**, patch (deletion).
- **BH9. `AuthorStates` hand-copies the `Phase` union.** **Low**, direct fix. Patch: `Exclude<Phase, …>`.
- **BH10. `mayTakeOutcomeFocus` stays in the screen, apart from the other gates.** **Low, rejected:** cosmetic.
- **BH11. `gridRowItems` does not check its field.** **Low**, direct fix in test code. Patch.
- **BH12. The `cancel()` doc overstates what it does.** **Low.** Patch: also cancel the frame and reset `fetchSeen`.
- **BH13. Docs still describe outcome focus and trim as per-screen code.** **Low**, direct fix. Patch: pointers in `focus-map.md` and ADR 0010.
- **BH14. The device table lacks the moved state views and outcome paths.** **Low, rejected.** They are rendered and asserted by the unchanged flow tests; the device run covered the main paths.
