---
title: 'Epic 3 retro A7: shared screen focus pieces and one stack-route wrapper'
type: 'refactor'
created: '2026-10-27'
status: 'done'
baseline_commit: '0350927d31dff87ec97d4f1265ad22f6d9bcf883'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-retro-2026-10-27.md'
  - '{project-root}/docs/adr/0012-sidebar-on-stack-screens.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 3 left the same focus logic in four screens and every stack route in one 748-line `src/app/App.tsx`: local `Phase` + `phaseRef`, `mayTakeFocus` gates and «restore, else the first item» fallbacks in HomeScreen, SubscriptionsScreen, AuthorScreen and PostScreen; the TanStack «hold the last error during a retry» block in four hooks; `AuthorRoute` and `PostRoute` repeating the `Screen → Sidebar → FocusZone` JSX; flow-test helpers re-declared in each flow test (Epic 3 retro, aggregate views; action A7). Epic 4 adds a Player route and more screens, which would copy all of it again.

**Approach (owner decision 2026-10-27: its own change before Epic 4):** A behaviour-preserving refactor: (1) move the stack routes and the Shell return handshake (`pendingShellSection`, `useStackSidebar`, `AuthorRoute`, `PostRoute`) out of `App.tsx` into an app-level module with one reusable stack-route wrapper (sidebar + content zone + Back + restoration forget) that a future Player-like route can use; (2) extract the duplicated pieces into shared, tested helpers — the held-error hook and the screen focus helpers that are genuinely identical (restore-or-first, the may-take-focus gate) — and use them in all four screens/hooks; (3) move the re-declared flow-test helpers into `src/test/flow.tsx`. The SessionManager split (ADR 0009) is a separate change.

## Boundaries & Constraints

**Always:**
- No behaviour change: every existing test passes with only import or helper-location edits; no test expectation changes. Focus ids, query keys, copy and docs-described behaviour stay.
- Extract only what is identical in all callers; where a screen differs (e.g. Главная's offline view, Пост's column memory), keep that part local rather than adding flags to a shared helper.
- eslint boundaries hold (shared never imports app/features; features never import app or other features); no new dependencies.
- New shared helpers get unit tests; `App.tsx` keeps the navigator, boot, resume orchestration and the auth routes.

**Never:** No SessionManager change, no new feature, no Player route, no change to `useNotMovedLatch`/`useHeadChangeRefocus` semantics.

</frozen-after-approval>

## Code Map

- `src/app/App.tsx` -- `pendingShellSection`/`takePendingShellSection` (~l.216), `ShellRoute` (~l.223), `useStackSidebar` (~l.311), `AuthorRoute` (~l.418), `PostRoute` (~l.476): move to e.g. `src/app/stackRoutes.tsx` with a `StackSidebarRoute` wrapper (Screen → Sidebar → FocusZone, Back handler, `focusRestoration.forget` on unmount, the pending-section handshake).
- `src/app/Shell.tsx` -- `setReturnFocus` registration duplicated for Главная/Подписки (~l.226–251): one helper.
- Held error: `src/features/post/usePost.ts:36`, `src/features/author/useAuthor.ts:38`, `src/features/subscriptions/useSubscriptions.ts:48`, `src/shared/entities/post/usePagedPosts.ts:105` → one hook in `shared` (e.g. `src/shared/api/useHeldError.ts` or next to `usePagedPosts`).
- Screen focus: `HomeScreen.tsx`, `SubscriptionsScreen.tsx`, `AuthorScreen.tsx`, `PostScreen.tsx` (`Phase`/`phaseRef`, `mayTakeFocus`, `restore().kind === 'none'` → `focusInitial`, also `PostGrid.tsx:~282`) → helpers in `src/shared/focus` where identical.
- Tests: `__tests__/{homeFeed,subscriptions,author,post,shell}Flow.test.tsx` helpers (`deferred`, `destinationIds`, `focusTargets`, the guide/list recorders) → `src/test/flow.tsx`.
- Docs: ADR 0012 (where the stack routes live), `docs/focus-map.md` file references.

## Tasks & Acceptance

**Execution:**
- [x] Stack routes module + wrapper; `App.tsx` slimmed.
- [x] Held-error hook (+ unit tests) used by the four hooks.
- [x] Shared screen focus helpers (+ unit tests) used where identical.
- [x] Flow-test helpers moved to `src/test/flow.tsx`.
- [x] Docs: ADR 0012, focus-map references.
- [x] Device smoke (release-like, owner's session): feed → Пост → Back; Подписки → Автор → Пост → author row → Back chain; sidebar OK from Автор and Пост.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass with no expectation changes; all flow tests 30/30; lint, typecheck, check:fixtures clean.
- Given `src/app/App.tsx`, then it no longer contains the Author/Post routes or the pending-section handshake.

## Orchestrator Notes

- Orchestrator verification after the review fixes (2026-10-27): no test expectation changed (23 removed / 23 added `expect` lines, all the `mockLists` → `lists` rename); lint, typecheck, check:fixtures clean; `npm test` ×3: 1200 passed; flow suites 30/30 when run alone. Two earlier 30× batches showed 2/30 and 1/30 failed runs while another Jest batch ran in parallel on the same machine (CPU contention; the failing run's output was not kept); the isolated re-run had 0/30. Device smoke (agent, adb) ran before the review fixes, which changed tests, a rename, docs and an optional Back override that no route passes yet.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | sprint-status closes A3 (item-11), A7 (item-15) untouched (blind) | false | A3 closed after PR #34 merged (owner-confirmed); A7 closes after this merges; the SessionManager split is its own change (owner decision) |
| 2 | Orphaned comments in `shellFlow` (JSDoc over `topScreen`), extra blank lines after removed helpers (blind, edge) | low | patch |
| 3 | Recorder reset scattered; `lists.last`/`guideDestinations` never reset in some files; lists without a testID share the `undefined` key (blind, edge) | medium | patch: `resetRecorders()` in `src/test/flow.tsx`, called by every flow test; skip lists without a testID |
| 4 | `homeFeedFlow` `grid()` reads `lists.last` (any list) (blind) | low | patch: read by the feed list's testID |
| 5 | Shared `restoreOrFirst` shadows local wrappers with the same name (blind) | low | patch: rename the shared helper |
| 6 | `StackSidebarRoute` cannot override Back, yet spec/ADR promise reuse by a Player-like route (blind) | medium | patch: optional Back override (return true when handled); ADR wording |
| 7 | `StackSidebarRouteProps.name` is a free string feeding testIDs/prefixes (blind) | low | patch: a union of route names |
| 8 | `useHeldError` duplicates the status literal; lives in `shared/api`; deep import (blind) | low | patch: TanStack `QueryStatus`; consistent import; location kept (depends on AppError) |
| 9 | `useHeldError` edge tests missing (error → retry → other error; error while fetching) (blind) | low | patch |
| 10 | `usePhaseChange` order/unmount tests (blind) | low | rejected: covered by the unchanged flow tests |
| 11 | Docs inconsistent (`useLatestRef`, Пост's own focus memory vs AD-12 not recorded) (blind) | low | patch |
| 12 | `useLatestRef` writes a ref during render (blind) | low | rejected: the pattern the four screens already used; unchanged behaviour |
| 13 | Import order changes (blind) | low | rejected: cosmetic |
| 14 | Offline retry (`fetchStatus: 'paused'`) drops the held error (edge) | low | defer: inherited verbatim from the four old copies |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; flow tests 30×.
