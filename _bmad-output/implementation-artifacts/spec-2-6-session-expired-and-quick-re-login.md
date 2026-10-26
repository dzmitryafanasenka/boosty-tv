---
title: 'Story 2.6: Session expired and quick re-login'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: 'd9879b3402818a28a5318f0ddbfaaee95c0b7537'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When the session truly expires (refresh 400 `invalid_grant`), Story 2.5 drops the user on A1 «Войдите снова». They then have to retype the phone number. Nothing tells them what happened, and the app forgets which account was signed in.

**Approach:**
- Add A11 «Сессия истекла». It replaces the stack from any screen and also opens at a cold start after expiry.
- OK opens A2 with the stored phone prefilled and focus on «Получить код».
- A re-login with the same account id lands on Главная and keeps its saved focus state. A different account starts fresh.

## Boundaries & Constraints

**Always:**
- **A11 screen.** Route `Expired`, wrapped in the shared screen wrapper.
- **A11 copy and focus.** Copy from the approved design, verbatim, via the `ru` catalog:
  - title «Сессия истекла»;
  - body «Boosty завершил вход на этом телевизоре. Войдите снова — позиции просмотра хранятся в Boosty и не потеряются.»;
  - one primary button «Войти снова», focus id `auth/expired/relogin`, the initial focus.
- **Back on A11** exits the app (root, focus-map §1 and §2).
- **Expiry from any screen.** On a transition to `expired`, close an open modal first, then reset the stack to `[Expired]`. Keep the 2.5 not-ready guard: if the navigator is not ready yet, reset when it becomes ready.
- **Cold start after expiry.** `restore()` reason `expired` boots into A11. Reason `wiped` keeps A1 «Войдите снова».
- **Expiry marker.** `expire()` replaces the stored session with a marker that holds no token: `{v:1, expired:true, accountId}`.
  - `restore()` maps the marker to reason `expired`. The previous `accountId` is available for the same-account check, also after a restart.
  - The phone entry is kept.
  - Sign-in overwrites the marker with the new session.
  - A failed marker write is logged and changes no status, same as the 2.5 clear failure.
- **Prefill.** `SessionManager` gets a narrow accessor for the stored phone, readable only while the status is `expired`.
  - The phone is split into the A2 fields via the ITU-T E.164 country calling code list (prefix-free) in `features/auth/phone.ts`.
  - An unknown code or a missing phone means no prefill: A2 opens normally with focus on the number field.
  - The phone travels through `authFlow`'s in-memory draft, never through route params, logs or storage.
- **A2 opened from A11.**
  - Initial focus is «Получить код» (`auth/phone/send`) when the prefilled draft is valid; otherwise the number field.
  - Back → A11.
  - The rest of A2/A5 behaves as today.
- **Same vs different account.** `signIn` reports whether the E1 id differs from the previous account id. The previous id comes from the in-memory session or the expiry marker; with no previous id, the account counts as changed.
  - Same account → Shell on Главная, FocusRestoration kept. The Shell uses a stable restoration key, not `route.key`, because a stack reset gives the Shell a new key.
  - Different account → `focusRestoration.clear()`, then Shell on Главная fresh. Full AccountScope wipes remain Stories 2.7–2.8.
- **Offline view.** `expired` clears Главная's offline view (closes the 2.5 deferred test).
- **Logging.** Never log the phone, the account id or a token.
- **Debug-only A11 trigger.** A `__DEV__`-only Настройки row («Проверка: сессия истекла»), following the 2.5 session-check pattern.
  - It sets the status to `expired` **in memory only**: no storage write, no network.
  - Its id is added to the `releaseBundle.test.js` markers.

**Never:**
- sign-out UI (2.7) or AccountScope (2.7, 2.8);
- QR or companion sign-in;
- the phone or the account id in route params, logs or plain storage;
- a working-looking screen for a capability that is not implemented;
- spending a sign-in on the device, clearing data or signing the owner out.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Mid-session expiry | Shell (any section), refresh 400 `invalid_grant` | Stack = `[Expired]`, focus «Войти снова» | An open modal is closed first |
| Before ready | `expired` before navigator `onReady` | A11 once ready | — |
| Cold start after expiry | Stored marker + phone | Boot into A11 | — |
| Wiped | Corrupted stored session | A1 «Войдите снова» (unchanged) | — |
| Relogin prefill | A11 OK, stored `+375291234567` | A2 `+375` / `291234567`, focus «Получить код» | — |
| No phone | Marker without phone | A2 empty, focus on the number | — |
| Unknown code | Stored phone with an unassigned code | A2 empty, focus on the number | — |
| Back | A2 from A11 → Back; A11 → Back | → A11; app exit | — |
| Same account | Re-login, E1 id = previous | Shell Главная, FocusRestoration entry kept | — |
| Other account | Re-login, E1 id ≠ previous | Shell Главная, FocusRestoration cleared | — |
| Offline then expiry | Offline cold start → resume → `invalid_grant` → re-login | Главная placeholder, no offline view | — |
| Debug trigger | Debug row OK | A11; SecureStore untouched; next cold start → Shell | Absent in release |

## Decisions (owner, 2026-10-26)

- Device check without a live sign-in: only the debug in-memory A11 trigger (A11 → A2 prefilled → Back → A11 → exit, then a cold start back to the Shell). No code is sent; the re-login itself is covered by host tests only.
- The spec is kept whole (~2600 tokens), debug trigger included.

</frozen-after-approval>

## Code Map

- `src/app/App.tsx` --
  - `Boot` (L61), the `restore()` mapping (L181-193), `openSignInAgain` (L100-108), the `subscribe` `expired` branch (L195-200), `onNavigationReady` (L220-226), `openShell` (L64-68), `Code.onSignedIn` (L95);
  - replace the A1 reset with `[Expired]`;
  - add the `Expired` route;
  - pass the A11 → A2 prefill via `authFlow`;
  - close the modal through a small component inside `ModalHostProvider` (`useModal().close`, `src/shared/focus/ModalHost.tsx:32-58`).
- `src/app/routes.ts` -- add `Expired: undefined`. Phone gets a non-secret flag param (e.g. `{ fromExpired: true }`); the comment at L2-4 forbids secrets in params.
- `src/features/auth/` -- a new `ExpiredScreen.tsx` (pattern: `WelcomeScreen.tsx`; Back at root L32).
  - `PhoneScreen.tsx`: the initial focus (L102, L124-130, L150-158) honours the flag and a valid draft. The `formFocus='send'` branch (L161-172) already exists. `onExit` → `goBack()`, so the stack `[Expired, Phone]` returns to A11.
  - `authFlow.ts`: `setDraft` is reused. `PhoneScreen` unmount resets it (L107-110), which is fine.
  - `phone.ts`: add `splitE164` with the calling-code list and tests. `toE164` and `maskPhone` stay unchanged.
- `src/shared/api/sessionManager.ts` --
  - `RestoreResult` (L53-65), `expire()` (L211-225), `readSession` (L243-252), `decodeSession`, `doSignIn` (L323-334);
  - the marker, the phone accessor (status-gated, AD-3 comment updated), and the `signIn` result `{ accountChanged }`;
  - the `debugExpireInMemory` hook, `__DEV__`-only like `debugCorruptAccessToken`.
- `src/shared/focus/focusRestoration.ts` (key `routeKey\0sectionId` L23-26, `clear()` L53) -- reuse. The Shell restoration key must be a constant (`src/app/Shell.tsx:20,63,212`; App passes `route.key` at L117).
- `src/features/settings/SettingsScreen.tsx` -- the debug row, following the `SETTINGS_SESSION_CHECK_ID` pattern.
- `src/shared/i18n/ru.ts` -- add `auth.expired.{title,body,relogin}` and `dev.expiredCheck.row`. The existing `auth.welcome.signInAgain` and `error.SessionExpired` stay.
- Tests:
  - `__tests__/sessionFlow.test.tsx` L285-293 and L323-339 expect A1 and are rewritten for A11. Reuse the keychain mock, the FixtureTransport handler and its helpers (L62-182).
  - The BackHandler mock comes from `__tests__/shellFlow.test.tsx:48-85`.
  - A2 Back is covered by `__tests__/signInFlow.test.tsx:220,230,405`.
- `docs/focus-map.md` §2 rows A2-after-A11 and A11 (L102, L106) are normative. Update `docs/testing.md`. Mark the 2.6 entry in `deferred-work.md` done.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/api/sessionManager.ts` + tests -- expiry marker, `restore()` reason `expired` with the previous account id, status-gated phone accessor, `signIn` → `{ accountChanged }`, `__DEV__` in-memory expiry hook; no phone or account id in logs.
- [x] `src/features/auth/phone.ts` + tests -- `splitE164` over the ITU-T country calling code list; unknown → null.
- [x] `src/features/auth/ExpiredScreen.tsx`, `PhoneScreen.tsx`, `index.ts`, `src/shared/i18n/ru.ts` -- A11; A2 prefill and initial focus from A11; Back → A11.
- [x] `src/app/App.tsx`, `routes.ts`, `Shell.tsx` -- `[Expired]` reset from any screen (modal closed, not-ready guard), boot into A11, the same/different account landing, a stable Shell restoration key, offline view cleared on `expired`.
- [x] `src/features/settings/SettingsScreen.tsx`, `__tests__/releaseBundle.test.js` -- the debug A11 row, absent from release.
- [x] `__tests__/sessionFlow.test.tsx` (+ a new `expiredFlow.test.tsx` if clearer) -- every matrix row through the real App over FixtureTransport.
- [x] Device (debug build via Metro on a free port + `adb reverse`): debug row → A11 with focus «Войти снова» → OK → A2 prefilled, focus «Получить код» → Back → A11 → Back exits; a cold start of the release-like build → Shell with the owner's session intact. No code is sent. Record the results in `docs/testing.md`.

**Acceptance Criteria:**
- Given an `expired` transition on any screen, when it occurs, then A11 is shown with focus on «Войти снова».
- Given A11, when OK is pressed, then A2 opens with the stored phone prefilled and focus on «Получить код».
- Given a re-login with the same account id, when it completes, then Главная opens and FocusRestoration is kept.
- Given the full check suite and the release bundle, when run, then all pass and the debug rows are absent from the release bundle.

## Implementation Notes

- `restore()` returns `{ status: 'expired', reason: 'expired' }` for the marker only, and the manager status becomes `expired`, so the status-gated `getExpiredPhone()` works after a restart. An empty session store is `signedOut` (reason `none`) even with a kept phone: a first sign-in killed between the phone and session writes leaves that state (review fix).
- Closing the modal on expiry uses `ModalApi.close({ restoreFocus: false })`: without it the host's delayed focus request went to the departing initiator after the reset (caught by the host test).
- The Shell restoration key is the exported constant `SHELL_RESTORATION_KEY = 'shell'` in `src/app/App.tsx`.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|---|---|---|---|
| 1 | blind | `readSession` treats any "phone kept, no session" store as an expiry (Story 2.5 heuristic), so a first sign-in killed between the phone and session writes boots into A11 «Сессия истекла» | medium | patch: `doSignIn` writes the phone before the session; no 2.5-era expired store exists on the owner's device (no expiry happened under 2.5), so only the marker means `expired`; phone-only → `signedOut` `none` |
| 2 | verification-gap+blind | A11 → A2 → A5 → Back must focus the number field (focus-map 2.6 notes), and A9 «На первый экран» → A11; both untested | gap | patch: flow tests |
| 3 | verification-gap+blind+edge | ExpiredScreen double OK while the phone is read is untested | gap | patch: test (one `onRelogin`) |
| 4 | blind | `docs/feature-parity.md` AUTH-06 not updated; A11/prefill/marker are our improvements over the reference | low | patch: doc row |
| 5 | blind | sessionManager docblock says nothing else reads the phone | low | patch: wording |
| 6 | blind+edge | `expire()` without `accountId` keeps tokens | false | unreachable: `host.current()` requires a session, and `accountId` is `min(1)` |
| 7 | blind+edge | A failed marker write leaves dead tokens stored | low | rejected: the frozen intent says a failed write is logged and changes no status; the next start re-expires via one refresh |
| 8 | blind | A failed re-login save from A11 wipes the marker and phone (`discardSaved`) | low | rejected: pre-existing Story 2.3 save-failure path; rare Keystore failure; next start shows A1 |
| 9 | blind | No way to remove the stored phone from A11 | medium | defer: sign-out and wipes are Story 2.7 |
| 10 | blind | The debug row label is in the release `ru` catalog | low | rejected: same pattern as the 2.4/2.5 debug labels; the row and its id are absent from release |
| 11 | blind | Sprint/spec status mismatch; 2.5 set to done in this diff | false | workflow-managed statuses; 2.5 was merged (PR #15) |
| 12 | blind | Expired-before-ready only tested via the debug hook | low | rejected: the branch is a guard; the test exercises the same subscriber path |
| 13 | blind | No pre-reset hook for screens (player E9 write) | low | rejected: no such screen exists before Epic 4; focus-map §4G already records the rule |
| 14 | blind+edge | `relogin` has try/finally without catch | false | `loadPhone` is `getExpiredPhone`, which never rejects; `splitE164`/`setDraft` do not throw |
| 15 | edge | A failed non-fatal phone write keeps an older phone for prefill | low | rejected: rare store failure; the prefill is editable; fix adds a guard |
| 16 | edge | Story 2.5 store with an unavailable phone read lands on plain A1 | false | moot after #1 |
| 17 | edge | `debugExpireInMemory` during an in-flight refresh drops the rotated pair | low | rejected: debug-only, used once on the device with no refresh in flight |
| 18 | verification-gap | `getExpiredPhone` status re-check after the read is untested | gap | defer per filed disposition (Story 2.7 sign-out) |
| 19 | verification (own) | `ModalHost.test.tsx` flaky (~1 in 5 file runs): the open's passive effect is sometimes flushed after the close, calling `requestHostFocus(null)` | low | patch (test only): the Story 2.4 test failed equally on baseline `d9879b3` (8/40), the new 2.6 test by the same mechanism; `requestHostFocus(null)` is a no-op, so both tests now count non-null targets only; 0/60 failures after |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) -- expected: BUILD SUCCESSFUL.
