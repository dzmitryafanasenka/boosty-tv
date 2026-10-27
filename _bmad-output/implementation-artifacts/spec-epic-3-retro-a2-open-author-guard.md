---
title: 'Epic 3 retro A2: guard opening Автор from Подписки'
type: 'bugfix'
created: '2026-10-27'
status: 'done'
baseline_commit: '32dbbee0febdff42f203bad71fc36ae721ad9c73'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** OK on a Подписки tile opens Автор through the Shell's `onOpenAuthor` with no `navigation.isFocused()` guard (its sibling `onOpenPost` has one), so a fast double OK — or an OK on another tile while the push transition runs — can open Автор twice or with the wrong blog (Epic 3 retro F8, `src/app/App.tsx:227-230`).

**Approach:** Open Автор from the Shell only while the Shell is the focused route, exactly like `onOpenPost`; a second OK during the transition does nothing. A flow test presses two tiles in a row before the transition settles and expects exactly one Автор, for the first tile. Also mark Epic 3 retro A1 (`epic-3-retro-item-9-…`) done in sprint-status (owner-confirmed after PR #32 merged).

</frozen-after-approval>

## Implementation Notes

- `src/app/App.tsx` `ShellRoute.onOpenAuthor`: `navigate('Author', …)` only while `navigation.isFocused()` (the same guard as `onOpenPost`). `navigate` stays (not `push`): the Shell opens one Автор from Подписки, and a repeated navigate to the same blog is idempotent.
- Tests (`__tests__/authorFlow.test.tsx`): two different tiles clicked in one act → one Автор for tile 1, no E3 for tile 2, Back → tile 1 (fails without the guard: the second click retargets Автор to tile 2 — verified by running it against the unguarded code); the same tile twice → one Автор, one E3 (passes either way today: `navigate` is idempotent; it pins the behaviour if the call ever becomes `push`).
- Other handlers reviewed: `onOpenFocusCheck` and `DevFocusDetail` push are debug-only (accepted); `Welcome.onSignIn` → `navigate('Phone')` is idempotent (accepted).
- Sprint status: A1 (`epic-3-retro-item-9-…`) set `done` (owner-confirmed after PR #32); A2 (`epic-3-retro-item-10-…`) closes after this change merges.
- Host: lint, typecheck clean; `npm test` ×3 1157 passed; `authorFlow` 30/30 (before the review additions; re-run below). Device: not run (press timing during a transition is the device check tracked as retro A4).

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Spec notes empty | low | patch |
| 2 | No evidence the test fails without the guard | false | run against the unguarded code: the two-tile test fails (Автор retargeted to tile 2) |
| 3 | Same-tile double OK untested | low | patch: test added |
| 4 | Focus after the dropped OK and Back unchecked | low | patch: Back → tile 1 asserted |
| 5 | `navigate` vs `push`; comment says «as onOpenPost» | low | patch: comment reworded; `navigate` kept (idempotent) |
| 6 | A2 sprint item left open | low | recorded: closes after merge |
| 7 | Item 9 `ref` has no PR link | low | rejected: the retro document is the ref; the commit message names PR #32 |
| 8 | Other unguarded handlers | low | recorded: dev-only or idempotent |
| 9 | «A2» label collides with another test | low | patch: tests say «Epic 3 retro F8» |
| 10 | A dropped press gives no feedback; no device check | low | accepted (same as `onOpenPost`); device timing is retro A4 |
