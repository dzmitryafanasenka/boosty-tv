---
title: 'Story 2.8: Account switch never leaks data'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: 'f0617dd741a21cda62c47a71fc278b217da732e5'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a different account signs in, the previous account's data is wiped too late. Story 2.6 clears FocusRestoration in `App` after the new phone and session are already stored. The authFlow draft and the log ring are not cleared at all. Nothing drops an async write started under the previous account.

**Approach:**
- `SessionManager.signIn` runs `AccountScope.reset()` when E1 returns a different account id (or there is no previous id). The reset runs after E1 and **before** the new phone and session are written.
- `AccountScope` gets a generation-guarded write helper. An async write that started under the old account is dropped when the generation changed.
- The same account wipes nothing.

## Boundaries & Constraints

**Always:**
- **Hook (AD-3, AD-4).** `SessionManager` cannot import `app` or `AccountScope`'s registry. It gets an injected account-switch hook (`onAccountSwitch: () => Promise<void>`), set once in `src/app/bootstrap.ts` to `accountScope.reset()`. The demo session gets the same hook, so it never touches the real keychain.
- **Sign-in order.** confirm → E1 → compare the account id (in-memory session, else the expiry marker) → on a change or no previous id: `await onAccountSwitch()` → write the phone → write the session → `signedIn`.
- **Gate inside sign-in.** The reset's session gate (`signOut`) runs inside sign-in. It clears the old phone, the marker and memory, which is expected. It must not emit a visible navigation; the status may pass `signedOut` on the way to `signedIn`.
- **Reset failure.** The sign-in fails with the existing spent-challenge error (`AuthError('Unknown', { challengeSpent: true })`). Nothing of B is stored and the tokens are dropped.
- **Same account.** No reset, nothing wiped, FocusRestoration kept (the 2.6 behaviour).
- **App clear removed.** `App.onSignedIn` no longer clears FocusRestoration itself; it only opens the Shell.
- **Guarded write.** `accountScope.guard(start)` captures `generation()`. `commit(value)` writes only if the generation is unchanged; otherwise the value is dropped and a log line names the store, with no data. It is used by future E9, history and cache writers. In 2.8 it is proven by an integration test.
- **Integration test.** It runs over FixtureTransport with a test-only account-scoped store whose write waits for a delayed fixture response. Account A starts the write, account B signs in, and the late write is dropped.
- **Logs.** Never the phone or an account id: only `accountChanged` and store names.

**Never:**
- a server call on switch;
- new UI or copy (A11, A1–A5 and the Shell are unchanged);
- a query cache or history implementation (Epic 3+);
- spending a sign-in on the device without the decision below.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Switch from A11 | Marker for A, A's phone, FocusRestoration entries; B signs in (E1 id ≠ A) | Reset before B's writes (order: E1 → reset → phone write → session write); FocusRestoration, draft and log ring empty; B's phone and session stored; fresh Главная | — |
| Switch from A1 | Nothing stored (no previous id) | Reset runs (harmless), then B stored | — |
| Same account | Marker for A; A signs in | No reset; FocusRestoration kept; Главная with its saved state | — |
| Reset fails | Gate clear rejects during the switch | Sign-in fails as spent; nothing of B stored | Generic error on A5 (existing copy) |
| Late write | Guarded write started under A, B signs in, the fixture answers after | Write dropped, logged without data | — |
| Write same account | Guarded write; no reset in between | Committed | — |
| Demo | Demo session switch | The hook runs on the demo stores; the keychain is untouched | — |

## Decisions (owner, 2026-10-26)

- Host tests only for the account switch. No device run and no sign-in spent; the owner's session on the TV stays untouched. S10 "second account" stays not verified on the device (record it in `docs/testing.md`; keep deferred-work L35-36 open with that note).

</frozen-after-approval>

## Code Map

- `src/shared/api/sessionManager.ts` --
  - `doSignIn` (L379-422) computes `accountChanged` at L397-398, then writes the phone (L404-410) and the session. Insert `await onAccountSwitch()` between them when the account changed.
  - Add `onAccountSwitch` to `SessionManagerDeps` with a setter or an init option. The singleton is created at L558; a setter such as `setAccountSwitchHook` called by bootstrap is acceptable.
  - `signOut` (the gate) is reentrant-safe here: it runs inside the sign-in single-flight. Check that its `generation` bump does not drop the sign-in's own writes; the new session is adopted after the hook.
  - The `SignInResult.accountChanged` return stays.
- `src/shared/account/accountScope.ts` -- add `guard()` (capture, commit-if-current) + tests. `reset()` stays as fixed in #18 (generation bumped after the gate).
- `src/app/bootstrap.ts` -- wire the hook to `accountScope.reset()` for the active session (`src/app/session.ts` picks real or demo).
- `src/app/App.tsx` -- `onSignedIn` (L111-116): drop `focusRestoration.clear()`.
- `src/features/auth/CodeScreen.tsx` (L193-199) -- unchanged; it still receives the result.
- Tests:
  - `__tests__/expiredFlow.test.tsx` (same/different account, L523-575): update to assert the reset ran before the writes (the keychain write order).
  - New `__tests__/accountSwitchFlow.test.tsx`, or extend that file, for the matrix.
  - `src/shared/account/__tests__/accountScope.test.ts` for `guard`.
- Docs:
  - `docs/feature-parity.md`: the AUTH row covering the account switch;
  - `docs/testing.md`: S10 "second account" stays not verified on the device (owner decision);
  - `deferred-work.md` L35-36: S10 stays open, with a note that the production code path is host-tested in 2.8.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/api/sessionManager.ts` + tests -- the account-switch hook before the phone and session writes; reset failure → spent; same account → no hook.
- [x] `src/shared/account/accountScope.ts` + tests -- `guard()`.
- [x] `src/app/bootstrap.ts`, `src/app/session.ts`, `src/app/App.tsx` -- wire the hook (real and demo), remove the App-side clear.
- [x] `__tests__/accountSwitchFlow.test.tsx` (+ `expiredFlow` updates) -- every matrix row through the real App over FixtureTransport, including the late guarded write.
- [x] Docs per the Code Map (no device run, owner decision).

**Acceptance Criteria:**
- Given A's expired session, when B signs in from A11 or A2, then `AccountScope.reset()` completes before B's phone and id are stored and B lands on a fresh Главная.
- Given a guarded write started under A, when it completes after B's sign-in, then it is dropped.
- Given the same account signs in again, when it lands, then nothing is wiped.
- Given the full check suite and the release bundle, when run, then all pass.

## Implementation Notes

- The hook is set with `setAccountSwitchHook` from `src/app/bootstrap.ts` on `session` (the active SessionManager: real, or the demo's in-memory one); `SessionManagerDeps.onAccountSwitch` is the init option used by unit tests. A missing hook logs `no account-switch hook set` and signs in without a wipe.
- The hook runs after the account-id compare and before the sign-in's own generation bump; its gate (`signOut`) bumps the generation too, and the sign-in's phone/session writes are not generation-guarded, so they land after it. The status passes `signedOut` (App only clears the offline view on it; no navigation).
- `AccountScope.guard(store, write)` returns `{ commit(value): Promise<boolean>, isCurrent() }`.
- The integration test's guarded write calls FixtureTransport directly with a never-aborting signal: the content client's timeout would fire under fake timers while the response is held.
- `CodeScreen` still calls the real `sessionManager.signIn` even in demo mode (pre-existing, unchanged per the Code Map); the demo row is proven by checking the hook on the demo session in `demoFlow.test.tsx`.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|---|---|---|---|
| 1 | blind+edge+vg | In demo mode `CodeScreen` signs in through the real `sessionManager` (no hook), so a demo sign-in writes the real keychain and wipes nothing; the Demo matrix row is only proven by calling the hook by hand | medium | patch: `CodeScreen.tsx:193` imports `sessionManager` directly; route the sign-in through the active session (`src/app/session.ts`) via a prop from App; flow-test the demo sign-in path |
| 2 | blind+edge | The hook is fail-open: without it the account switch proceeds with only a warn | medium | patch: no hook on a change → fail as spent (AD-4: the reset must happen before the writes) |
| 3 | blind+edge+vg | The hook ignores `ResetResult.failed`, so a partial reset still stores B over A's leftovers | medium | patch: the switch hook rejects when `failed` is non-empty (sign-in fails as spent); sign-out keeps its documented "leave anyway" policy |
| 4 | blind | The `accountChanged` log line is written before the hook and wiped with the log ring | low | patch: log it after the hook |
| 5 | blind | Integration test: "no server call on switch" only counts token calls; `track()` stacks keychain mock wrappers across tests | gap | patch: assert the full path list; restore the mock implementation explicitly |
| 6 | blind+edge | `guard().commit` checks the generation before an async `write`, so a reset racing a slow write lets it land after the store's reset | low | patch (doc only): state the contract in `accountScope.ts` (writers' `write` must be synchronous with the store, or re-check `isCurrent()` after) — no async writer exists yet |
| 7 | blind+edge+vg | Partial gate failure on switch (phone cleared, session clear fails) loses A's prefill; docs say "A kept" | low | rejected: the phone-first order is the 2.7 review decision; the session stays intact; rare keychain failure (docs wording tightened in #6's patch scope is not needed) |
| 8 | blind+edge | Session write fails after a successful reset: A is wiped, B not stored, the draft gone on A8 | low | rejected: rare keychain write failure after a successful clear; the user re-enters the number |
| 9 | edge | A hanging hook keeps A5 busy forever | low | rejected: the hook is local keychain clears; no hang observed; the same holds for sign-in writes today |
| 10 | blind | `guard(store)` name is not tied to a registered store | low | rejected: names are log labels; registration is enforced by the registry test for stores |
| 11 | blind | Transient `signedOut` navigation only checked by the end state; log leak check runs after the ring is wiped | low | rejected: App has no `signedOut` navigation; logging is redacted by the logger's own tests |
| 12 | blind | `SignInResult.accountChanged` / `onSignedIn` param unused | low | rejected: kept as diagnostic API; tests read it |
| 13 | blind | testing.md counts and the mutation check are not reproducible commands | low | rejected: the commands are listed in the Verification section |
| 14 | blind | Spec/sprint status mismatch | false | workflow-managed |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `cd android && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.
