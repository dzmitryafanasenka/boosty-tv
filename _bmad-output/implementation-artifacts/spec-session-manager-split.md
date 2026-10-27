---
title: 'Split SessionManager into modules behind an unchanged facade (ADR 0009)'
type: 'refactor'
created: '2026-10-27'
status: 'done'
baseline_commit: '02b7fc6c26720b8fe7e5c489a75cae39d0e980b9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/adr/0009-session-manager-split.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `src/shared/api/sessionManager.ts` (609 lines) is one closure owning fourteen session concerns. Story 4.2 (Epic 4) is the first story that adds a session concern (pending progress writes across expiry and re-login), and the owner decided the split runs right before it (ADR 0009, accepted 2026-10-26; Epic 2 retro item 5; deferred-work entry «split SessionManager per ADR 0009 before Story 4.2»).

**Approach:** Execute ADR 0009 exactly: the modules under `src/shared/api/session/` (`types`, `codec`, `core`, `refreshHost`, `signOut`, `lifecycle`, `restore`, `signIn`, `debug`) behind the unchanged `sessionManager.ts` facade, the `SessionCore` API and module rules, the invariant ownership table, the extraction order (one commit per step), and the test strategy. No behaviour, endpoint, feature or dependency change; the «Left out on purpose» items stay out.

## Boundaries & Constraints

**Always:**
- `src/shared/api/__tests__/sessionManager.test.ts` and `__tests__/sessionRefresh.test.ts` pass unchanged after every step; a needed edit to either means the step changed behaviour — stop and report it.
- The facade keeps its file, exports, types, `createSessionManager(deps)` signature and returned object; `index.ts` keeps exporting only the facade; `session/` is private to `shared/api`.
- `core.ts` is the only holder of session state and the only module touching a `SecureStore`; modules import only `core`, `codec`, `types`; the debug module is loaded with a local, unexported `__DEV__ ? require(...) : null` binding, and `__tests__/releaseBundle.test.js` stays green.
- Never log the phone, challenge, code, tokens or the E1 body.

**Never:** No change to `refreshCoordinator.ts`, `httpClient.ts`, `authApiClient.ts`, `src/app/session.ts`, `src/app/dev/demo.ts`; no merge of the two generation counters; no sign-out rollback; no fix of the unqueued `getExpiredPhone` read; `SignInResult.accountChanged` stays.

</frozen-after-approval>

## Code Map

- ADR 0009 «Context» table maps each concern C1–C14 to its lines in `src/shared/api/sessionManager.ts` (at `697de1f`; re-locate by symbol, line numbers may have shifted).
- Contract users: `src/app/session.ts`, `src/app/dev/demo.ts`, `src/app/bootstrap.ts`, `src/app/App.tsx`, `src/shared/api/index.ts`.
- New tests per ADR: `src/shared/api/session/__tests__/{codec,core,refreshHost}.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] Steps 1–9 of ADR 0009 «Extraction order», one commit each, the two contract suites green after each.
- [x] `codec.test.ts`, `core.test.ts`, `refreshHost.test.ts` per ADR «Test strategy».
- [x] Docs: ADR 0009 status note (executed, commits), `deferred-work.md` entry resolved.
- [x] Release bundle check (`__tests__/releaseBundle.test.js`) and `assembleRelease`; device smoke: cold start (session restored) and resume (E1), recorded as a smoke check.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; `core.test.ts` and `refreshHost.test.ts` 30/30 in isolation; lint, typecheck clean; the two contract suites unchanged (`git diff` empty for them).
- Given `src/shared/api/sessionManager.ts`, then it only composes the modules (no flow logic of its own beyond C3, C6, C13).


## Implementation Notes

- Executed on `refactor/session-manager-split`: steps 1–9 as one commit each (`2195e1f` types, `92589c8` codec, `9029355` core + test, `bf47814` refreshHost + test, `f708a90` signOut, `9b39f29` lifecycle, `1a5afa3` restore, `af663d9` signIn, `b8e2426` debug), `23fd74c` codec test, `6d3dc0d` docs. Facade 609 → 155 lines.
- `src/shared/api/sessionManager.ts` is identical at `697de1f` (the ADR's line references) and at the baseline `02b7fc6`.
- Orchestrator checks: `git diff 02b7fc6` of `src/shared/api/__tests__/sessionManager.test.ts` and `__tests__/sessionRefresh.test.ts` (both paths exist as written) is empty; session modules import only `core`/`codec`/`types` within `session/`; lint, typecheck clean; `npm test` 1236 passed (agent: ×3; `core`/`refreshHost` tests 30/30; release bundle markers absent; `assembleRelease` OK).
- Device smoke (agent, adb, release-like, owner's session): cold start restored the session (Главная, feed, focus on the first card); resume after the Home key kept the card, no A11, no error. The resume E1 itself is not observable in the release build (no logs); only its absence of effect was seen.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Verification command's `__tests__/sessionRefresh.test.ts` path is wrong (blind) | false | the file lives at the repository root `__tests__/sessionRefresh.test.ts`; the diff check covers it |
| 2 | Spec checklist unticked; ADR status line stale (blind) | low | patch |
| 3 | `SessionCore.writeSession(raw)` takes any string (blind) | low | rejected: the API ADR 0009 defines; callers encode through `codec` |
| 4 | `core.markExpired()` unguarded without a session (blind, edge) | low | defer: the old closure's semantics (callers guard); session robustness entry |
| 5 | Module rules not enforced by lint (blind) | low | defer: an eslint restriction for `session/` before Story 4.2 adds a module |
| 6 | No unit tests for restore/signIn/signOut/lifecycle/debug (blind) | false | ADR 0009 «Test strategy»: these stay covered through the unchanged facade suites |
| 7 | Facade docblock duplicates module docs (blind) | low | rejected: cosmetic |
| 8 | Resume E1 not observed on the device (blind) | low | recorded (release build has no logs) |
| 9 | Test count mismatch (blind) | false | A7 ended at 1200 after its review fixes; 1200 + 36 = 1236 |
| 10 | Retro item 15 closed without a ref (blind) | low | the PR body names PR #35 / `0d54139` |
| 11 | `discardSaved` iterates unbound core methods (blind) | low | rejected: core methods are closures without `this` |
| 12 | Weak assertions in `core.test.ts`/`refreshHost.test.ts` (blind) | low | rejected: the contract suites carry the behaviour |
| 13 | Edge races: overlapping sign-outs (boolean `signingOut`), same-account sign-in vs an in-flight refresh, restore keeps `signedIn` while the read runs, restore vs a finishing sign-in, `validate` single-flight across a generation change, `discardSaved` clears the expiry marker, a listener subscribed twice, `restoreSignedIn` without reset, `markExpired` with no session (edge) | maybe-false | defer: all present verbatim in the pre-split closure (the split must not change behaviour); a session-robustness entry for Story 4.2 |
| 14 | `debugExpireInMemory`'s generation bump untested (verification-gap) | low | defer (debug-only; equally untested before) |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck` -- clean.
- `npm test` ×3 -- all pass; `git diff 02b7fc6 -- src/shared/api/__tests__/sessionManager.test.ts __tests__/sessionRefresh.test.ts` -- empty.
