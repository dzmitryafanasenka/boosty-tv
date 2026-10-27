---
title: 'Epic 3 retro A6: check the session before showing locked content'
type: 'bugfix'
created: '2026-10-27'
status: 'done'
baseline_commit: '7e46478b46914c4a2e350ce91c8c89bc70d232d0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-retro-2026-10-27.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** With a dead or invalid access token Boosty answers content endpoints (E4, E5, E8) with 200 anonymous: paid posts come back `hasAccess: false` with empty `data` (api-contract §7, `e8-no-token.json`). The app then shows «Нет доступа» on the Post screen, «Нет доступа к этому видео» in the player and locked cards in lists, and never notices the dead session (Epic 3 retro F5/F6, action A6; Story 4.1 review finding 15). F5 also asks whether Boosty ever returns `hasAccess: true` with empty `data` (the mapper shows that as locked); no fixture answers it.

**Approach (owner decision 2026-10-27: its own change, split from the session-robustness pass):** before showing «locked» at the chosen trigger points, run the existing E1 validation (`session.validate()`, generation-keyed single-flight): `expired` routes to A11 through the existing status listener; `ok` refetches the locked query once (covers a silent token refresh); `failed` shows the locked state as today. Validation reaches features through a narrow port provided by the app, not an app import.

**Owner decisions (2026-10-27):** (1) trigger points: the player's fresh E8 locked, the Post screen's E8 locked, and Главная feed page 1 when every post on it is locked (author pages excluded: all-locked is legitimate there). (2) F5 is checked live now: a temporary debug-only counter on E4/E5 pages (only the count of `hasAccess: true` with empty `data` and those post ids; no bodies, tokens or URLs) on the device debug build with the owner's session (`adb install -r`, session kept), over the feed and a few author pages; the result goes to api-contract §7; the counter is removed before the commit and the release-like build is reinstalled.

## Boundaries & Constraints

**Always:**
- At most one E1 per trigger point per cooldown window; never an E1 per card; a refetch after `ok` happens once and never loops.
- Locked stays an ordinary state: no error copy, no retry storm; while the check runs the locked UI is shown as today (no spinner flash) unless a check is already known to be pending for that query.
- Never log tokens, the E1 body or post content; never send a comments request.
- eslint boundaries hold (features never import app; `shared/api/session/` stays private).

**Never:** No change to SessionManager modules, `refreshCoordinator.ts`, `httpClient.ts`; no new endpoint; no treatment of 403 or `hasAccess: false` alone as session expiry.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Dead session, player | fresh E8 locked; E1 → 401 → refresh `invalid_grant` | A11 opens; no «Нет доступа» left behind it |
| Silent refresh | E8 locked; E1 → 401 → refresh ok → 200 | one refetch of that E8; accessible → plays / shows the post |
| Truly locked | E8 locked; E1 200 | locked UI as today; no refetch loop; no second E1 within the cooldown |
| Offline | E8 locked; E1 Network | locked UI as today |
| Post screen | Пост E8 locked; E1 → `invalid_grant` | A11; on `ok` with a refreshed token one refetch, the post opens |
| Feed all locked | Главная page 1 all `hasAccess: false`; E1 → `invalid_grant` / refresh ok | A11 / one feed refetch |
| Feed partly locked | page 1 has an accessible post | no E1 |
| Author all locked | Автор page 1 all locked | no E1 |

</frozen-after-approval>

## Code Map

- `src/shared/entities/post/mapPost.ts:234` -- `hasAccess = dto.hasAccess !== false && blocks.length > 0` (F5).
- `src/shared/entities/post/postRepository.ts` -- `onePost`, `videoSources` (`{kind:'locked'}`); doc comments «never a session problem» to update.
- `src/features/player/mediaResolver.ts:158` `useMediaSource` -- locked state; `PlayerScreen.tsx` phase `'locked'`.
- `src/features/post/usePost.ts`, `PostScreen.tsx:191,466`, `LockedNotice.tsx`.
- `src/shared/entities/post/usePagedPosts.ts` (`refetchOnMount: false`), `features/home/useSubscriptionFeed.ts`.
- `src/shared/api/session/lifecycle.ts` `validate()` -- never rejects; `ok | expired | failed | skipped`; A11 comes from the status listener in `src/app/App.tsx` (`subscribe` → `openExpired`).
- Port: features receive `http` as a prop from `src/app/stackRoutes.tsx:270,325,374` and `Shell.tsx`; add a `validateSession` prop or a small `shared` context provided by App.
- After a sign-in `App.tsx:114` `onSignedIn` → `resetQueryCache()` (same account too): re-login clears caches already.
- Tests: `__tests__/playerFlow.test.tsx:361`, `postFlow.test.tsx:453-505,1274`, `homeFeedFlow.test.tsx:562`, `authorFlow.test.tsx:296,336`, `sessionFlow.test.tsx:275,295`, `expiredFlow.test.tsx:215-256`; fixtures `src/test/postFixtures.ts`, `e8-no-token.json` (unused), `e1-no-token.json`, `refresh-invalid-grant.json`, `refresh-ok.json`.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/api/sessionCheck.ts` (new) -- a `SessionCheck` port (`check(key): Promise<'expired'|'refetch'|'locked'>`) behind a React context with a no-op default, provided by `src/app/App.tsx` from `session.validate()`; per-key cooldown 5 min; `ok` → `'refetch'` once per key per cooldown, else `'locked'` -- one place for the rules.
- [x] `src/features/player/mediaResolver.ts` / `PlayerScreen.tsx` -- on a fresh E8 locked: check; `'refetch'` → refetch the E8 once; else the locked state.
- [x] `src/features/post/usePost.ts` -- the same for the Post screen E8.
- [x] `src/features/home/useSubscriptionFeed.ts` -- page 1 all locked → check; `'refetch'` → refetch the feed once.
- [x] `src/shared/entities/post/postRepository.ts` -- update the «never a session problem» comments.
- [x] F5 live check per the owner decision; record in `docs/api-contract.md` §7; remove the counter.
- [x] Tests: every matrix row (`playerFlow`, `postFlow`, `homeFeedFlow`, `authorFlow` no-E1 case; reuse `e8-no-token.json`, `e1-no-token.json`, `refresh-invalid-grant.json`, `refresh-ok.json`); port unit test (cooldown, once-only refetch).
- [x] Docs: api-contract §7, `docs/testing.md`, deferred-work (resolve the A6 entry; retro item 14 closes after the merge).

**Acceptance Criteria:**
- Given the matrix, then each row has a flow test that passes; suite ×3; changed flow suites 30×; lint, typecheck, check:fixtures clean.
- Given the release-like build on the pinned device with the owner's session, when browsing Главная, a locked post and an author page, then no A11 appears and nothing regresses (smoke); the debug counter is absent from the diff.

## Implementation Notes

- Port keys are the three trigger points (`SESSION_CHECK_KEYS`: `player`, `post`, `feed`), not per post: at most one E1 per trigger point per 5 min window, so opening several locked posts in a row sends one E1. The window starts at the check; callers during a running E1 share it; `refetch` goes to the first caller only. Every session status change (`subscribe` in `App`) resets the windows, so a re-login starts clean.
- The check is triggered from inside the query functions on a fresh answer (`usePost`, `useMediaSource`, the feed's `fetchPage` for cursor `null`), never on a cached render; the locked UI stays while E1 runs (no spinner). `refetch` reuses each hook's own refetch (the feed's resets its auto-fetch counter, as «Обновить»). The resume head refresh (`refreshFeedHead`) does not go through `fetchPage` and sends no check (resume already runs E1).
- At cold start Главная's check shares the running cold-start E1 (single-flight), so an all-locked first page costs no extra E1, but it does cost one page-1 refetch when E1 is ok.
- `PlayerScreen`: the late (two-frame) focus retry now also requires `isActive()`. Found by the dead-session flow test: the retry fired after the reset to A11 and pulled focus to the departing player's «Назад».
- Review fixes: the window is kept only after `ok`/`expired` (a failed or skipped E1 drops it); `check(key, canRefetch)` gives `refetch` only to a still-mounted caller; a negative elapsed time ends the window; the hook catches; a failed post-`ok` player refetch keeps the locked state; the player's immediate focus request also requires `isActive()`. Known gap: a session that dies within 5 min after an `ok` at the same trigger point is noticed only after the window or on resume. The device silent-refresh run was skipped: `debugCorruptAccessToken` runs E1 right after corrupting the token.
- F5: no live sample of `hasAccess: true` with empty `data` (37 E5 + 23 E4 pages, owner's session); `mapPost` unchanged. Recorded in api-contract §7.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | A `failed`/`skipped` E1 (network blip) holds the 5 min window: a dead session stays undetected (blind, edge) | medium | patch: keep the window only for `ok`/`expired` |
| 2 | `refetch` is handed to a caller that already unmounted (Back before E1), burning the window's one refetch (blind, edge) | low | patch: hand `refetch` out only to a caller still able to use it |
| 3 | Player: the post-`ok` E8 refetch failing turns «Нет доступа» into the error screen (edge) | low | patch: a failed session-check refetch keeps the locked state (Always: no error copy) |
| 4 | Wall clock jumping back keeps the window open (edge) | low | patch: a negative elapsed time starts a new window |
| 5 | `validate()` throwing synchronously escapes into the queryFn (edge) | false | `lifecycle.validate()` wraps an async `doValidate` and never throws or rejects |
| 6 | `ok` refetches even when the token did not change (blind) | low | rejected: the approved approach («`ok` refetches the locked query once»); cost recorded in Implementation Notes |
| 7 | Window per trigger point, not per post: a session dying inside a window after an `ok` goes unnoticed up to 5 min; not in api-contract/testing (blind) | low | patch: document the known window |
| 8 | `useLockedSessionCheck` has no `.catch`; the feed passes a bare `refetch` (blind) | low | patch: catch in the hook |
| 9 | `PlayerScreen` immediate focus request is not guarded by `isActive()` (blind) | low | patch: guard it too |
| 10 | F5 row labelled `LIVE` though it is an absence of observations (blind) | low | patch: «not observed in 60 pages, one account»; E5 dead-token behaviour stays inferred |
| 11 | Dead-session / silent-refresh not checked on the device; the in-memory token replacement could exercise the silent refresh safely (blind) | low | patch: run the silent-refresh path on the device debug build if the debug hook replaces the access token in memory only (no sign-out, no re-login); the dead-session path stays host-only, recorded |
| 12 | Tests: an all-locked page 2 sends no E1 (verification-gap); cold-start page 1 arriving during the cold E1 (blind); focus kept after the feed refetch (blind); exact E1 count offline (blind); a cached locked post re-open sends no E1 (blind) | low | patch: tests |
| 13 | `sessionCheck.reset()` on a status change is not flow-tested (verification-gap, blind) | low | defer: unit-tested; add with the next re-login flow test |
| 14 | Spec status/triage empty while deferred says Done; the «unless a check is pending» clause (blind) | false | the review is running now; the clause permits, not requires, a pending indicator |

## Verification

Run 2026-10-27: lint (`--max-warnings 0`), typecheck, check:fixtures clean; `npm test` ×3: 1446/1446 each before the review fixes, 1454/1454 each after them (orchestrator); `playerFlow`, `postFlow`, `homeFeedFlow`, `authorFlow` + `sessionCheck.test.ts` 30/30. Device (release-like, owner's session): smoke passed before the review fixes, no A11 (`docs/testing.md` «Epic 3 retro A6»); the debug counter is not in the diff or the release bundle.

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3; changed flow suites 30×.
