---
title: 'Story 2.7: Minimal Settings and sign-out'
type: 'feature'
created: '2026-10-26'
status: 'in-review'
baseline_commit: '9ef168140d8a881fcac5e51425762af416ff7c18'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to sign out. The TV cannot be handed over or tested with another account. Account-scoped state (tokens, the stored phone, the account id, FocusRestoration, the log ring) has no single cleanup path. Nothing guarantees that a new account-scoped store will be wiped.

**Approach:**
- Настройки gets «Выйти из аккаунта». A confirmation Dialog opens with «Отмена» focused.
- Confirm runs `AccountScope.reset()`, the only cleanup path (AD-4). It clears every account-scoped store registered in `app/bootstrap.ts`, bumps a generation and opens A1.
- A test fails when an account-scoped store is not registered.

## Boundaries & Constraints

**Always:**
- **Настройки.** Keep the version row (the initial focus). Add a `nav` row «Выйти из аккаунта» (`settings/row/signout`) below it. The debug rows stay under `__DEV__`, after it.
- **Dialog.** Opened through the modal host with the row as the initiator. It uses a new shared `Dialog` primitive (`shared/ui`, DESIGN Dialog tokens: centered, `rounded.xl`, max width 560, title + body + 2 actions).
  - Copy from the approved design, verbatim, via `ru`:
    - title «Выйти из аккаунта?»;
    - body «Чтобы снова войти, понадобятся номер телефона и код из сообщения. Это коснётся всех, кто смотрит на этом телевизоре.»;
    - actions «Отмена» (`dialog/signout/cancel`, the initial focus) and «Выйти» (`dialog/signout/confirm`), in this order.
  - ← → move between the actions.
  - «Отмена» or Back closes the dialog, and focus returns to the row.
- **Confirm.**
  - «Выйти» is busy while the reset runs; a repeated OK is ignored.
  - Success: the modal closes without a focus return, and the stack resets to `[Welcome]` with A1's initial focus. «Войдите снова» is not shown.
  - Failure (a SecureStore clear rejects): the dialog stays open and shows an error line «Не удалось выйти из аккаунта. Попробуйте ещё раз.». Focus stays on «Выйти», and the session and its status are kept.
- **AccountScope** (`src/shared/account/`). Stores are declared with `defineAccountScoped(name, reset)` and registered in `src/app/bootstrap.ts`, which runs once before `App` renders. Lazy registration is not allowed.
  - `reset()` bumps the generation and is single-flight.
  - Order: the session first. `sessionManager.signOut()` clears SecureStore (session or expiry marker, then the phone), then memory. The account id and the previous account id are dropped. Only then are the other stores reset: `focusRestoration.clear()`, `authFlow.reset()`, `logger.clear()`.
  - The other stores are reset only after the session clear succeeded. A session-clear failure rejects `reset()` and leaves every store as it was.
  - `generation()` is exposed for later async writers (E9, history, cache).
  - Logs only the store names and the outcome.
- **No server revoke call.** No network request on sign-out.
- **Registration test.** A test scans `src/` for `defineAccountScoped(` declarations and fails if any declared name is missing from the bootstrap registry, or registered twice.
- **Closes deferred items:** sign-out clears FocusRestoration; a test that `getExpiredPhone()` resolves null when the status changes mid-read.
- **Copy** through the `ru` catalog. Russian accessibility labels.

**Never:**
- account switch on re-login (Story 2.8);
- a server revoke;
- removing the version row;
- a JS focus engine;
- any new dependency;
- signing the owner out on the device without the decision below.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Open | Настройки, OK on «Выйти из аккаунта» | Dialog, focus «Отмена», background unfocusable | — |
| Cancel | «Отмена» or Back in the dialog | Dialog closed, focus on `settings/row/signout` | — |
| Confirm | «Выйти» | SecureStore session + phone cleared, then FocusRestoration, authFlow and the log ring; generation +1; stack `[Welcome]`, A1 initial focus; no request sent | — |
| Double OK | «Выйти» twice during the reset | One reset | — |
| Clear fails | Session clear rejects | Dialog stays, error line, focus «Выйти», still `signedIn`, other stores untouched | Retry possible |
| Refresh race | Refresh in flight at confirm | Signed out; the late result is dropped; storage stays clear | — |
| Unregistered | A `defineAccountScoped` store missing in bootstrap | The registration test fails | — |
| Phone read race | `getExpiredPhone()` pending, then sign-out | Resolves null | — |

## Decisions (owner, 2026-10-26)

- The sign-out row has no subtitle. The stored phone stays readable only in `expired` (the 2.6 accessor is unchanged).
- A11 keeps its one-button design; there is no forget path there. The phone and the expiry marker stay until the next sign-in or sign-out. This closes deferred-work L133-134 as "won't do".
- Device check: only the dialog (open, focus «Отмена», ← →, «Отмена» and Back return to the row). No real sign-out; the reset is covered by host tests only.
- The spec is kept whole (~2500 tokens), the registration test included.

</frozen-after-approval>

## Code Map

- `src/features/settings/SettingsScreen.tsx` -- rows (L60-97) with `useZoneItem`. The version is `kind="info"` (the initial focus via `INITIAL_CONTENT_ID.settings`, `src/app/Shell.tsx:45-46`). The debug rows are `__DEV__`-only. Add the sign-out row. The feature receives the open-dialog callback through props; features do not import `app`.
- `src/shared/ui/` -- new `Dialog.tsx` (pattern: `DevDialog` in `src/app/dev/devFocus.tsx:253-279`; `hasTVPreferredFocus` on the first action), `Button` (`kind` primary/secondary, `busy`), tokens `dialog` (`tokens.ts:267-272`).
- `src/shared/focus/ModalHost.tsx` -- `open(content, initiatorRef)`, `close({restoreFocus})` (L32-41). Back closes it, as the newest listener. Reuse as is.
- `src/shared/api/sessionManager.ts` -- `signOut()` (L442-457) already clears SecureStore first, uses the `signingOut` guard and rejects on a failed clear. It must also drop `previousAccountId`, which it does, and work from the `expired` status (marker + phone). `getExpiredPhone` (status re-check after the read) gets its race test.
- New `src/shared/account/accountScope.ts` (+ `index.ts`) -- `defineAccountScoped`, `register`, `reset`, `generation`, and a test-only `registeredNames()`.
- New `src/app/bootstrap.ts`, imported first by `index.js` or `App.tsx` -- registers `session` (sessionManager.signOut), `focusRestoration` (`src/shared/focus/focusRestoration.ts:95-97`), `authFlow` (`src/features/auth/authFlow.ts:47-50`) and `logger` (`src/shared/services/logger.ts:34`). Each owning module declares its store with `defineAccountScoped`.
- `src/app/App.tsx` -- the stack reset to `[Welcome]` (pattern: `openShell`, L89), modal close via `ModalBridge` (L166), the confirm wiring passed to the Shell → Settings. `onSignedIn` (L125-130) keeps the 2.6 behaviour.
- `src/shared/i18n/ru.ts` -- `settings.signOut.row` and `dialog.signOut.{title,body,cancel,confirm,error}`.
- Tests:
  - helpers: `__tests__/shellFlow.test.tsx:131-232` (renderApp, focusOn, press, back, lastFocusTarget, topScreen) and `__tests__/expiredFlow.test.tsx:34-71` (BackHandler mock);
  - sign-out races: `__tests__/sessionRefresh.test.ts:516-580`.
- Docs:
  - `docs/focus-map.md` K4 (L226) is normative and needs the 2.7 notes;
  - `docs/testing.md`;
  - `docs/feature-parity.md` AUTH-07;
  - mark the deferred-work entries closed: L113, L116-118 (sign-out reset part), L133-134 (won't do, owner decision), L136.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/account/accountScope.ts` + tests -- define, register, reset (session first, then the others; stop on a session failure), generation, single flight, logs.
- [x] `src/app/bootstrap.ts`, `index.js`/`App.tsx`, owning modules -- declare and register the four stores; a registration test that scans `src/`.
- [x] `src/shared/api/sessionManager.ts` + tests -- `signOut` from `expired`; the `getExpiredPhone` mid-read race test.
- [x] `src/shared/ui/Dialog.tsx` + test -- title, body, 2 actions, an error line, a busy confirm; first action preferred focus.
- [x] `src/features/settings/SettingsScreen.tsx`, `src/app/App.tsx`, `Shell.tsx`, `ru.ts` -- the row, the dialog flow, confirm → reset → `[Welcome]`, failure kept in the dialog.
- [x] `__tests__/signOutFlow.test.tsx` -- every matrix row through the real App over FixtureTransport (no request on sign-out).
- [x] Device (release-like, adb): Настройки shows the version and «Выйти из аккаунта»; the dialog opens with focus «Отмена», ← → move, «Отмена» and Back return focus to the row; the owner stays signed in. Record in `docs/testing.md`.

**Acceptance Criteria:**
- Given Настройки, when it opens, then it shows the version and «Выйти из аккаунта», with focus on the version row.
- Given the sign-out dialog, when «Отмена» or Back is pressed, then focus returns to «Выйти из аккаунта».
- Given a confirmed sign-out, when it completes, then SecureStore holds no session and no phone, the account-scoped stores are empty, no request was sent, and A1 is shown with its initial focus.
- Given the full check suite and the release bundle, when run, then all pass.

## Implementation Notes

- The `session` store is declared in `src/app/session.ts` (not `shared/api`): the app chooses the active SessionManager (real or the debug demo), and the demo must never clear the real keychain. `session.ts` keeps `demo` a local binding and exports only `DEMO_ACTIVE`; an exported `demo` was not folded out of the release bundle (`releaseBundle.test.js` caught `createDemoSessionManager`).
- `defineAccountScoped` lives in an import-free file (`src/shared/account/defineAccountScoped.ts`) so the logger can declare its store without an import cycle; `bootstrap.ts` seals the scope, so a lazy `register` throws.
- `reset()` bumps the generation as it starts. Non-gate store failures are logged (`outcome: partial`) and do not stop the others or reject: the session is already gone, so the UI leaves the account.
- While «Выйти» is busy, `SignOutDialog` swallows Back (its listener is newer than the modal host's) and ignores «Отмена», so the dialog cannot disappear under a running sign-out.
- The registration test is plain JS (`__tests__/accountScopeRegistry.test.js`), like `boundaries.test.js`, because the repo has no Node type packages.
- Known edge (unchanged `signOut`): when the session clear succeeds but the phone clear fails, `reset()` rejects and memory keeps `signedIn`, while SecureStore already holds no session; a retry completes the sign-out, and a restart would open A1.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `cd android && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.
