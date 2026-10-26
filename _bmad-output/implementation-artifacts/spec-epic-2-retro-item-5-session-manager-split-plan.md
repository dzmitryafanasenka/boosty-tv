---
title: 'Epic 2 retro item 5: SessionManager split plan (ADR 0009)'
type: 'chore'
created: '2026-10-26'
status: 'done'
baseline_commit: '697de1feee495e33c4c25e7bc91bd7ae03496b7f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-retro-2026-10-26.md'
  - '{project-root}/docs/adr/0008-api-request-profiles.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 2 retro finding A2 (action item 5): `src/shared/api/sessionManager.ts` grew to 609 lines and owns tokens, the refresh host, E1 validation, restore, the expiry marker, the phone accessor, sign-in, sign-out, the account-switch hook, two debug hooks and a generation counter. The retro asks for a split plan before Epic 3 adds session concerns.

**Approach:** Write `docs/adr/0009-session-manager-split.md` (status `proposed`): the concerns map, the target module split behind an unchanged `SessionManager` facade, the order of extraction, the test strategy, and when the split runs. Plan only — no source code changes in this change.

## Boundaries & Constraints

**Always:**
- Every claim cites code (`file:line` or symbol) or a doc; the Epic 3/4 "new session concerns" check names the planning sources it read (`epic-3-context.md`, `epics.md` Epic 3–4 stories, spine AD-3/AD-4/AD-7/AD-11).
- The plan keeps the public contract stable: the `SessionManager` type, `createSessionManager(deps)` and `SessionManagerDeps` (used by `src/app/session.ts`, `src/app/dev/demo.ts`, `sessionManager.test.ts`, `__tests__/sessionRefresh.test.ts`), and every AD-3 / api-contract §2.3 invariant (single writer of tokens, one store queue, persist-before-adopt, generation guard, sign-in order, sign-out order, never logging secrets).
- The plan names what it deliberately leaves alone, including the two generation counters (retro A3) and the failed-sign-out generation entry in `deferred-work.md`, each with a decision: fold into the split or keep separate.
- ADR follows the existing ADR format (`docs/adr/0008`), concise, English.

**Never:**
- No change under `src/`, no test change, no new dependency.
- No new behaviour, endpoints or session features proposed as part of the split.

**Decision (owner, 2026-10-26):** the split runs between Epic 3 and Epic 4, as its own change right before Story 4.2 (the first story with a session concern). Epic 3 starts now without it. The ADR records this timing and the evidence (no Epic 3 story adds a session concern).

</frozen-after-approval>

## Code Map

- `src/shared/api/sessionManager.ts` -- the subject. Concerns and lines (at `697de1f`): types/contract L62–176; stored-session + expiry-marker schemas and `decodeSession` L179–222 (pure); `SessionManagerDeps`/factory L225–245; mutable core (status, session, previousAccountId, generation, signingOut, listeners, `enqueue` store queue, `setStatus`) L246–282; refresh host adapter `host` L284–324 and coordinator/http wiring L326–332; restore `readSession` L334–378; sign-in `validateWithE1`/`discardSaved`/`doSignIn` L380–472; lifecycle `doValidate`/`validate` L474–496 and `onAppStateChange` L580–584; sign-out L498–514; expired-phone accessor L563–575; debug hooks L516–521 and L587–607 (`__DEV__` only).
- `src/shared/api/refreshCoordinator.ts` -- already extracted (`RefreshHost<T>` interface); the model for the other seams.
- `src/app/session.ts`, `src/app/dev/demo.ts` -- the only factory callers; must not change in the split.
- `src/shared/api/__tests__/sessionManager.test.ts` (637 lines, 45 cases), `__tests__/sessionRefresh.test.ts` (668 lines) -- black-box tests through the facade; the plan says whether they stay as is and which new unit tests the seams get.
- `src/shared/account/accountScope.ts` -- AccountScope's own generation (retro A3); the account-switch hook target.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the failed-sign-out generation entry (Story 2.7).
- `docs/adr/0008-api-request-profiles.md` -- ADR format.

## Tasks & Acceptance

**Execution:**
- [x] `docs/adr/0009-session-manager-split.md` -- write the ADR: Context (A2 facts, sizes), the Epic 3–4 session-concern check with sources, Decision (target modules with responsibilities and the shared core they receive; facade unchanged), extraction order (smallest, pure seams first), test strategy, what stays out (A3, deferred entry), the owner's timing decision (between Epic 3 and Epic 4), consequences -- the plan the retro asked for.
- [x] `_bmad-output/implementation-artifacts/epic-3-context.md` -- update the item 5 line to point at ADR 0009 and its timing decision -- keep the epic context truthful.
- [x] `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-26.md` -- mark action item 5 as planned (ADR 0009, proposed) without rewriting the retro -- traceability.

**Acceptance Criteria:**
- Given ADR 0009, when a reader maps each concern in the Code Map list, then each lands in exactly one target module or is explicitly kept in the facade.
- Given ADR 0009, when it lists the AD-3 / §2.3 invariants, then each names the module that owns it after the split.
- Given the diff, when listing changed paths, then none is under `src/` or `__tests__/`.

## Implementation Notes

- The Code Map lists `__tests__/sessionRefresh.test.ts` without a directory; it is the root `__tests__/sessionRefresh.test.ts`, not `src/shared/api/__tests__/`.
- The ADR line references were re-read on `697de1f` and differ from the Code Map by a line or two in places (types L62–176 incl. `CURRENT_USER_PATH`; `AccountSwitchHook` is at L223, inside the "factory" range). The ADR uses its own concern table (C1–C14).
- The ADR adds `session/signOut.ts` and `session/debug.ts` besides the retro's three suggested groups (restore/marker, sign-in, lifecycle/E1), so every concern lands in exactly one module; `getExpiredPhone` goes with restore.
- `deferred-work.md` still has the item 5 entry saying "to run before Story 3.1"; it was left untouched because it is outside this spec's file list (Verification expects only four changed paths).

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Modules need `CURRENT_USER_PATH` and the result/status types left in the facade, so modules and facade import each other (blind) | medium | patch: leaf `session/types.ts`, re-exported by the facade |
| 2 | `core` API lacks accessors/transitions for `session`, `previousAccountId`, `signingOut`, the debug rewrite, and the in-queue persist guard (`sessionManager.ts:288-293`) (blind, edge) | medium | patch: core transitions listed, `writeSessionIf(next, guard)` evaluated inside the queued op |
| 3 | `restoring`/`signingIn`/`validating`/`appState` (L258–261) have no owner; "core is the only holder of mutable state" is false (blind, edge) | medium | patch: assigned to restore/signIn/lifecycle; rule reworded to session state |
| 4 | Invariant table: generation bump and `expired` writers incomplete (debug L600/L604, restore L369); corrupted-store order inverted (status before clear, L359/L361) (edge) | medium | patch: rows corrected |
| 5 | Invariant table misses single-flight sign-in (L545–551), restore never rejects (L533–537), `challengeSpent` (L411), no session during sign-out (L286) (blind) | medium | patch: rows added with owners |
| 6 | Debug extraction omits the local-binding minifier trap (`src/app/session.ts:13-17`), the `access token corrupted` bundle guard (`releaseBundle.test.js:23,78`), and the `debugExpireInMemory` copy of `host.expire` (blind) | medium | patch: debug section restated |
| 7 | The account-switch hook makes signIn call signOut at runtime, unmentioned under "modules never depend on each other" (blind, edge) | low | patch: runtime path stated, black-box suites named as the guard |
| 8 | `deferred-work.md` still says item 5 runs before Story 3.1; epic-3-context lost its pointer; the split has no durable tracker (blind, edge, verification-gap) | medium | patch (orchestrator): note on the item 5 entry, new entry "split per ADR 0009 before Story 4.2", pointer restored in `epic-3-context.md` |
| 9 | Test strategy ignores retro item 7 (≥30 isolated runs of new async tests) (blind) | low | patch: added |
| 10 | No unit test for the facade composition and `authApi` pick; no lint/test guard that `index.ts` never exports `session/*` (blind) | low | rejected: the facade is exercised by every `sessionManager`/`sessionRefresh` case and the `authApi` pick by `signInFlow`/`codeFlow`; a lint rule adds config for no observed case |
| 11 | Spec Code Map line ranges differ from the ADR's by 1–2 lines (blind) | low | rejected: the fix edits this spec; the ADR's ranges are the checked ones (Implementation Notes) |
| 12 | The Epic 3 "no session concerns" guardrail is in no story checklist (blind) | low | rejected: `epic-3-context.md` is the loaded context for every Epic 3 story run |

## Verification

**Commands:**
- `git diff --name-only main` -- expected: only `docs/adr/0009-session-manager-split.md`, `epic-3-context.md`, the retro file and this spec.
- `npm run lint -- --max-warnings 0 && npm test` -- expected: unchanged (649 passed), proving no code moved.

**Manual checks:**
- Every `file:line` cited in the ADR points at the code it describes on `main` (`697de1f`).
