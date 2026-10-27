---
title: 'Session robustness before Story 4.2: close the SessionManager races'
type: 'bugfix'
created: '2026-10-27'
status: 'done'
baseline_commit: 'd1631e422947701c69e394b43a68e47e5cba7268'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/adr/0009-session-manager-split.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-session-manager-split.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The SessionManager split review found pre-existing races in `src/shared/api/session/` (deferred-work «Session robustness review before or with Story 4.2»). Story 4.2 holds progress writes across expiry and re-login and keeps account-scoped progress, so a race that resurrects tokens after sign-out, serves a stale validation, or turns a same-account re-login into an account switch (wiping that account's data) becomes user-visible.

**Approach (owner decision 2026-10-27: split; the «dead token looks all-locked / E1 validation» work is a separate change):** fix the real or reachable-through-the-facade races with the smallest change in the owning module, harden the latent ones, document the two that are harmless, add the missing tests and an eslint import restriction for `session/`. The facade's public API stays.

## Boundaries & Constraints

**Always:**
- Existing assertions in `src/shared/api/__tests__/sessionManager.test.ts` and `__tests__/sessionRefresh.test.ts` stay unchanged; new cases may be added to them.
- ADR 0009 module rules hold: `core.ts` is the only state holder and the only `SecureStore` user; modules import only `core`, `codec`, `types`.
- Never log the phone, challenge, code, tokens or the E1 body.

**Never:** No change to the facade's exports or `createSessionManager(deps)`; no merge of the session and AccountScope generation counters; no change to `refreshCoordinator.ts`, `httpClient.ts`, `authApiClient.ts`, AccountScope; no E1-on-locked validation (separate change); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|---|---|---|
| Overlapping sign-outs | S1's phone clear rejects while S2's store clear is pending; a refresh completes | storage ends empty; no token written after sign-out |
| Restore vs sign-in | `restore()` read pending; `signIn` completes; read resolves | status `signedIn` with the new session; restore writes no state |
| Validate across re-login | E1 pending; `debugExpireInMemory`; same-account sign-in; `validate()` | a new E1 is sent; the old result is not reused |
| Failed same-account re-login write | `expired` for A with marker and phone; re-login as A; `writeSession` rejects | marker and `getExpiredPhone()` survive; a restart opens A11, not Welcome |
| Failed new-account write | as above, other account | marker and phone discarded (unchanged) |
| Same listener twice | `subscribe(f)` ×2, one unsubscribe | `f` still notified once per change |
| `markExpired` without a session | no session | no-op, returns null |
| Expiry during refresh | refresh reply held; `debugExpireInMemory`; reply ok / rejected | statuses `signedIn → expired`; old tokens kept, no NEW token, no marker; request rejects `Client`; «refresh result dropped» logged |

</frozen-after-approval>

## Code Map

- `src/shared/api/session/core.ts:102,177-182` -- boolean `signingOut` → depth counter (`isSigningOut = depth > 0`).
- `src/shared/api/session/core.ts:101,125-130` -- `subscribe` Set of functions → per-call wrapper; unsubscribe deletes its wrapper.
- `src/shared/api/session/core.ts:151-172` -- `markExpired` no-op without a session.
- `src/shared/api/session/restore.ts:26-64` -- capture `generation()` after `resetForRestore`; after the read, if not current, return the current status without writing state. Do not block restore while `signedIn` (suite «reload (restore) while a refresh is in flight»).
- `src/shared/api/session/lifecycle.ts:30,48-55` -- `validate()` single-flight keyed by generation; clear in `finally` only if still the same entry.
- `src/shared/api/session/signIn.ts:70-78,122-140` -- on write failure with `!accountChanged`: keep the phone, best-effort re-write the expiry marker for that account; discard only on account change. Comment the harmless bump→adopt window (status still `expired`, requests throw `SessionExpired`).
- `src/shared/api/session/restore.ts` / ADR 0009 -- note: `restore()` is cold-start only (App mount, UI gated on `boot`).
- `.eslintrc.js` -- eslint-plugin-boundaries treats `shared/api` as one element; add `no-restricted-imports` overrides: outside `sessionManager.ts` and `session/**`, ban `**/shared/api/session/**`, `./session/*`; inside `session/*.ts` only `./core`, `./codec`, `./types`. `session/__tests__` stay allowed.
- `__tests__/boundaries.test.js` -- pattern for asserting lint rules.
- Test helpers: `deferred()`/`flush()` in `__tests__/sessionRefresh.test.ts`; `memoryStore()`/`setup()` in both suites; `src/shared/api/session/__tests__/core.test.ts`.
- Story 4.2 facts: app code sees only `accountScope.generation()/guard()`; same-account re-login runs no hook (generation unchanged).

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/api/session/core.ts` -- sign-out depth, subscribe wrappers, `markExpired` guard -- items 1, 7, 8.
- [x] `src/shared/api/session/restore.ts` -- generation check after the read; cold-start comment -- items 3, 4.
- [x] `src/shared/api/session/lifecycle.ts` -- generation-keyed validate single-flight -- item 5.
- [x] `src/shared/api/session/signIn.ts` -- keep marker/phone on a failed same-account write; window comment -- items 2, 6.
- [x] Tests: the matrix rows in `sessionRefresh.test.ts` (overlapping sign-outs, validate, expiry during refresh ×2), `sessionManager.test.ts` (restore vs sign-in, failed same-account write), `core.test.ts` (subscribe twice, `markExpired`); extract `deferred`/`flush` to `src/test/` if both suites need them.
- [x] `.eslintrc.js` + `__tests__/boundaries.test.js` -- session import restriction, asserted (feature → `session/core` fails; `signIn` → `signOut` fails).
- [x] Docs -- ADR 0009 note (robustness pass, cold-start-only restore, harmless window); resolve the deferred entry.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; `sessionManager`, `sessionRefresh` and `session/__tests__` 30/30; lint `--max-warnings 0`, typecheck, check:fixtures clean.
- Given `git diff d1631e4` of the two contract suites, then it only adds cases.
- Given the release-like build on the pinned device with the owner's session, when cold-started and resumed, then the session is restored without A11 (smoke).

## Implementation Notes

- Code: `session/core.ts` (sign-out depth, per-call subscribe entries, `markExpired` guard), `session/restore.ts` (generation check after the read, also when the read rejects; cold-start comment), `session/lifecycle.ts` (generation-keyed single-flight), `session/signIn.ts` (`keepExpired` on a failed same-account write from `expired`; window comment). Only a write failure with status `expired` and `previousAccountId()` equal to the E1 id keeps the marker and phone (best effort); every other failure, including a same-account sign-in from `signedIn`, calls `discardSaved()` as before.
- Tests: `src/test/async.ts` (`deferred`, `flush`) is used by the new `sessionManager.test.ts` cases; `__tests__/sessionRefresh.test.ts` keeps its local copies because removing them would delete lines from a contract suite. 12 new cases (core 3, sessionManager 5, sessionRefresh 4); 9 of them fail against the baseline modules (the expiry-during-refresh pair and the new-account write case pass there: behaviour already correct, now pinned).
- Lint: three `no-restricted-imports` overrides in `.eslintrc.js`; `__tests__/boundaries.test.js` adds 23 cases through a second ESLint instance built from those overrides.
- Checks: `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` clean; `npm test` ×3: 79 suites, 1417 tests passed; the session suites (`sessionManager`, `sessionRefresh`, `session/__tests__`) 30/30; `git diff d1631e4` of the two contract suites has no removed lines.
- Device smoke (agent, adb, pinned device, owner's session): `assembleRelease -PreactNativeArchitectures=armeabi-v7a` → release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo) → `adb install -r`. Force-stop + launcher start → Shell, Главная with the feed, no A11/sign-in; Home, then launcher again → Shell, Главная, feed, no A11, no fatal exception in logcat. The resume E1 itself is not observable in the release build (no logs). Nothing uninstalled or cleared; no sign-in or code sent.

- Orchestrator verification after the review patches (2026-10-27): lint `--max-warnings 0`, typecheck, check:fixtures clean; `npm test` ×3: 1423 passed each; session suites (`session/__tests__`, `sessionManager`, `sessionRefresh`) 30/30; `git diff d1631e4` of the two contract suites removes no line. The device smoke (cold start, resume, no A11) ran before the review patches, which changed only the sign-in write-failure branch, comments, docs and lint rules.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | `validate()` doc, `restore.ts` doc and ADR say an expiry starts a new E1 / makes a read stale, but `refreshHost.expire()` does not bump the generation (only `debugExpireInMemory` does) (blind, edge) | low | patch: wording — sign-in, sign-out, restore; an in-flight E1 during a real expiry fails or returns for the same session (unchanged from the old single-flight) |
| 2 | Same-account sign-in from `signedIn` with a failed write no longer discards (beyond the matrix) (blind, edge) | low | patch: keep the old `discardSaved` path unless the status is `expired` for that account (sign-in from `signedIn` is unreachable: Welcome/Expired only) |
| 3 | ESLint: a session module can import a sibling via `../session/x` or `../../api/session/x`; `**/session` patterns would also ban future `dto/session` (blind, edge) | low | patch: ban those paths inside `session/`; narrow the outside patterns to the `shared/api/session` folder; boundaries cases |
| 4 | «imports only core, codec, types» reads as all imports (blind) | low | patch: say «sibling session modules» |
| 5 | Same function subscribed twice, no unsubscribe: «notified twice» untested (blind) | low | patch: one test |
| 6 | «Keeps the phone» not proven when the ADR 0006 recovery deletes the shared keychain file (blind) | low | patch: ADR wording «best effort» |
| 7 | Restore vs a sign-in completing during the corrupted-entry clear; restore from `signedIn` vs a failing sign-out (edge) | low | rejected: restore is cold-start only with the UI gated on `boot` (documented); adds guards for unreachable states |
| 8 | `keepExpired` marker write not guarded against a concurrent sign-out (edge) | low | rejected: sign-out cannot run during a sign-in from the Expired screen; adds a guard |
| 9 | `deferred`/`flush` stay duplicated in `sessionRefresh.test.ts`; `src/test/async.ts` import needs an inline boundaries disable (blind, edge) | low | rejected: removing lines from a contract suite is forbidden by the spec; cosmetic |
| 10 | No test of a production (non-debug) expiry during a refresh (blind) | false | covered by the existing «invalid_grant» cases of `sessionRefresh.test.ts`; the debug variant is the one the deferred entry asked for |
| 11 | `endSignOut` clamps silently (blind) | low | rejected: no unbalanced caller (signOut's `finally`) |
| 12 | Spec untracked; deferred `source_spec: none`; sprint-status 4.1 change in this diff (blind) | false | the spec is committed in step 5; `none` is the workflow's split format; 4.1 → done is recorded after the owner merged PR #37 and named in the commit |
| 13 | Stale restore read error not typed in the log; no sign-out-during-restore test (blind) | low | rejected: cold-start only; diagnostics never log values |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; session suites 30×.
- `git diff d1631e4 -- src/shared/api/__tests__/sessionManager.test.ts __tests__/sessionRefresh.test.ts | grep '^-[^-]'` -- empty.
