---
title: 'Epic 3 retro A3: Главная follows a refreshed head like Автор'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: 'e72bff7609c2d5c0d7a137275fa7f76fe2e4dfc7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-feed-refresh-on-resume.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-author-posts-refresh.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Главная and Автор react differently to a head refresh on the shared PostGrid: on Автор an untouched page moves focus to the new top post, on Главная the old card keeps focus and the new posts sit above it; and Главная's resume refresh can lose focus twice — a focused load-more «Повторить» unmounts when the refresh clears the query error, and an empty page 1 with a next cursor replaces the cache so the focused card disappears with no refocus (Epic 3 retro F3, F4, F10; A3).

**Approach (owner decision 2026-10-27, Epic 3 retro):** Give Главная the Author page's rules: (1) while the user has not moved since Главная took its content focus by itself, a changed head moves focus to the new first post and the grid shows the top; after any D-pad move or OK the focused card keeps focus, as today; the sidebar's focus is never taken; (2) the resume refresh is skipped while the feed query is in an error state, so a focused «Повторить» stays; (3) an empty page 1 with a next cursor keeps the cached feed (counted as fresh); an empty last page still replaces it. Use the existing `postsHeadRefresh` options (`skipWhileError`, `keepEmptyWithMore`) and the `followHead` hook of `useHeadChangeRefocus`; do not add a third copy of the "not moved" latch — share Автор's.

## Boundaries & Constraints

**Always:**
- The result must not depend on whether the refresh reply or a native focus event arrives first (as Автор).
- Главная's existing behaviour elsewhere stays: initial focus rules, skeleton on the sidebar, OK-open restore, pagination, held row, restoration on return from Пост.
- The Главная tests that pin the old behaviour (`__tests__/homeFeedFlow.test.tsx` ««Повторить» focused during a resume prepend», `postsHeadRefresh.test.ts` «an empty fresh page 1, default (Главная)») change to the new rules; no other test is weakened.

**Never:** No new endpoints, no refresh of other lists, no change to Автор's behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Untouched, new posts | Главная took focus on card 1 by itself, resume adds 2 posts | focus → the new first post, grid at the top | — |
| Moved, new posts | user moved to card 7 | card 7 keeps focus at its new row | — |
| Sidebar focus | focus on `nav/home` | nothing moves | — |
| «Повторить» focused | load-more failed, resume | refresh skipped; «Повторить» stays focused | — |
| Empty page 1 with more | E5 page 1 `[]`, next cursor | cache kept, counted fresh; focus kept | — |
| Empty last page | E5 page 1 `[]`, no cursor | cache replaced (empty state) | — |
| Reply vs focus order | reply before / after the auto-focus event | same result | — |

</frozen-after-approval>

## Code Map

- `src/features/home/feedRefresh.ts` -- pass `{ skipWhileError: true, keepEmptyWithMore: true }` to `refreshPostsHead`.
- `src/features/home/HomeScreen.tsx` (`useHeadChangeRefocus` call ~l.323) -- add `followHead`/`onFollowHead` and the "not moved" latch.
- `src/features/author/AuthorScreen.tsx` (~l.198–250: `moved`, `autoTargets`, `onFocusChange`, `followHead`, `onCardPress`) -- the latch to extract into a shared hook in `src/shared/ui/PostGrid.tsx` (next to `useHeadChangeRefocus`) and reuse on both screens.
- `src/app/Shell.tsx` -- Главная needs the focus-change feed that `AuthorFocusInfo.onFocusChange` gives Автор (`src/app/App.tsx` `useStackSidebar`/AuthorRoute); add the same to `HomeFocusInfo`.
- Tests: `__tests__/homeFeedFlow.test.tsx` resume block (~l.1078–1360), `postsHeadRefresh.test.ts`, `src/features/home/__tests__/feedRefresh.test.ts`.
- Docs: `docs/focus-map.md` §3 B resume notes, ADR 0010 resume paragraph.

## Tasks & Acceptance

**Execution:**
- [x] `feedRefresh.ts` (+ tests) -- options.
- [x] Shared latch hook, `HomeScreen.tsx`, `AuthorScreen.tsx`, `Shell.tsx` -- follow-head on Главная, Автор unchanged.
- [x] Tests -- every matrix row; pinned Главная tests updated.
- [x] Docs -- focus-map §3 B, ADR 0010.
- [x] Device (release-like, owner's session) -- resume after > 60 s on an untouched Главная and after a move: focus as specified.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; `homeFeedFlow`/`authorFlow` 30/30; lint, typecheck, check:fixtures clean.

## Implementation Notes

- `refreshFeedHead` passes `{ skipWhileError: true, keepEmptyWithMore: true }`; `mergeFeedHead` passes `keepEmptyWithMore` (not `pinnedFirst`: E5 has no pins).
- Shared latch: `useNotMovedLatch(onFocusChange, { armed })` in `src/shared/ui/PostGrid.tsx` (exported via `shared/ui`): `auto(id)` records the page's own focus requests in request order, `arm(ids)` (re)starts "not moved" with the elements focus may still report as automatic, `move()` for OK on a card, `followHead`/`onFollowHead` for `useHeadChangeRefocus`. Автор uses it armed from the start (behaviour unchanged; `authorFlow` passes unmodified).
- Главная arms it in `takeContentFocus` (the phase effect when the page takes its content focus itself: the first cards, OK on «Главная», success after the StateView action) with `[nav/home, current]`, then records the restore target (or the first card); `focusAbove` records its StateView action / sidebar focus; OK on a card is a move. Cached cards mounted without self focus never arm, so the sidebar keeps focus.
- `Shell.tsx`: `HomeFocusInfo.onFocusChange` fed by the Shell's sidebar/content focus events (only while the Shell is the focused route), like `AuthorFocusInfo.onFocusChange`.
- Known edge (unchanged from before A3): an empty last page 1 replaces the cache while a card has focus; the empty StateView does not take that focus (Главная's StateViews never take focus by themselves).
- Review fixes: `useHeadChangeRefocus` follows only when the first card changed (same first card → the keep-focused-card branch, so a restored card in row ≥ 1 is refocused); `useNotMovedLatch.arm()` appends to the unsettled targets (repeat → end, null ignored), `auto()` is ignored while unarmed or moved, a move forgets the targets, new `disarm()`; Главная records its own StateView/offline «Повторить» focus (`takeActionFocus`) and disarms when the phase leaves `grid`. Unit tests: `src/shared/ui/__tests__/useNotMovedLatch.test.tsx`. Note: a native focus event of an unmounted StateView action never reaches the Shell (FocusZone drops it), so the action recording is defensive; the flow test fires the late event while the action is still shown.
- Not done: the device task (left to the owner/orchestrator).

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Follow-head branch returns early when the first post is unchanged, skipping the keep-focused-card refocus: a card armed in row ≥ 1 loses focus when posts are inserted below the first (edge) | medium | patch: fall through to the keep-focused-card branch (`src/shared/ui/PostGrid.tsx` `useHeadChangeRefocus`, verified) |
| 2 | `arm()` drops still-pending automatic targets; a late native event of an earlier automatic focus counts as a move (edge) | low | patch: keep the unsettled targets |
| 3 | Phase-effect focus of the StateView action / offline «Повторить» not recorded with `latch.auto` (edge, blind) | low | patch |
| 4 | `auto()` grows the list while the latch is unarmed or moved (edge) | low | patch: ignore then |
| 5 | `nav/home` in the armed targets: if the card request never lands, a later head change takes the sidebar's focus (edge, blind) | low | accepted + documented: needed so the result does not depend on the reply vs native-event order; only reachable when the page's own card request is dropped |
| 6 | No disarm: after grid → empty → grid without self focus the stale arming can follow a head (blind) | low | patch: disarm when the phase leaves the grid |
| 7 | No unit tests for `useNotMovedLatch` (blind) | low | patch |
| 8 | No tests for the Shell focus feed (blind) | low | rejected: exercised by every new Главная flow test |
| 9 | sprint-status changes A2, not A3 (blind) | false | A2 closed after PR #33 (owner-confirmed); A3 closes after this merges |
| 10 | Known focus loss on an empty last page 1 not tracked (blind) | low | defer: deferred-work entry |
| 11 | Device check not planned (blind, verification-gap) | low | the orchestrator runs it before completion |
| 12 | «Moved» only tested in the first row; other sidebar items (blind) | low | patch: a deeper-row move and `nav/subs` |
| 13 | StateView «Повторить» → grid → resume path untested (verification-gap, blind) | medium | patch: flow test |

## Verification

Host results (2026-10-27): lint (`--max-warnings 0`), typecheck, check:fixtures clean; full suite 3× — 63 suites, 1173 tests, all pass; `homeFeedFlow` + `authorFlow` 30/30 runs. Mutation checks: without Главная's `followHead` the three "untouched" follow tests fail; without the OK-on-card move the OK test fails; arming without `[nav/home, current]` fails the "nav/home event during the skeleton, reply first" test; without the feed options the «Повторить», empty-page and unit tests fail.

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass.
