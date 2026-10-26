---
title: 'Story 2.3: Confirm the code and create the session'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: '55addc67a525645725f4db37aa9f327d9824029a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/adr/0006-secure-storage-keychain-reset-helper.md'
  - '{project-root}/docs/adr/0008-api-request-profiles.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After «Получить код», the minimal A5 is a dead end. The owner cannot enter the code, nothing creates or stores a session, and phone sign-in has never run through production code on the TV.

**Approach:**
- Complete A5/A6: code field, 60 s resend countdown, resend, «Изменить номер», and the A7 error state.
- Confirm through `AuthApiClient`. Validate the session with E1 through a minimal content-profile `HttpClient`.
- Store tokens, account id and phone only through a `SecureStore` keychain adapter with the ADR 0006 recovery.
- Open a minimal signed-in screen.
- At startup, read the stored session: a session opens the signed-in screen, nothing opens Welcome, a corrupted store is wiped and opens Welcome with «Войдите снова».
- Then run the one live sign-in on the device with the owner.

## Boundaries & Constraints

**Always:**
- **A5 focus (`docs/focus-map.md` §2).**
  - Initial focus is the code field. ↓ moves to the buttons «Войти», «Выслать повторно» and «Изменить номер»; ← → moves between them.
  - «Выслать повторно» is disabled and unfocusable during the countdown and shows its sub-label «через 0:42».
  - IME «Готово» with a non-empty code submits it.
  - Back and «Изменить номер» return to A2 with the number kept.
- **A5 copy.** The body tells where the code may arrive: by SMS, in a messenger or in the Boosty app. When `sentTransport` names the channel, say it plainly. The phone appears masked as `+375 •• ••• •• 07`.
- **Resend** sends `transport=gate`, restarts the 60 s countdown and moves focus to the code field.
- **Confirm request.** `PUT /auth/phone/verification_code/confirm` with form fields `phone`, `code` (the challenge), `sms_code`, `device_os=web` and `device_id`.
  - Auth profile, single-flight, 30 s timeout.
  - The response is parsed with Zod: `access_token` and `refresh_token` as non-empty strings, `expires_in` as a finite number above 300.
- **Confirm errors.**
  - 400 `invalid_sms_code` → `WrongCode` → A7: the inline error `error.WrongCode`, the field cleared and focused.
  - 429 `sms_gate_ratelimit` on resend → `TooManyAttempts`, inline on A5, focus on the field.
  - Transport failure → `Network`.
  - Anything else → `Unknown`.
  - A8 (`CodeExpired`) is a rendered state («Выслать новый код» focused, «Войти» hidden), but nothing maps to it: there is no verified shape, and the `expiresIn` units are unverified.
- **Session creation, in order:**
  1. confirm;
  2. E1 `GET /v1/user/current` through `HttpClient`: content profile per ADR 0008, `Authorization: Bearer`, 30 s timeout, Zod requires `id`;
  3. only after E1 succeeds, `SessionManager.signIn` saves `{accessToken, refreshToken, expiresAt, accountId}` and then the phone, both through `SecureStore`;
  4. clear the challenge from `authFlow`;
  5. reset the stack to `SignedIn`.

  If E1 fails or the save fails, discard the tokens, keep nothing, and show `error.Unknown` on A5.
- **SecureStore** (`shared/platform`) wraps react-native-keychain 10.0.0 (pinned) with services `boostytv.session` and `boostytv.phone`. These are not the spike's service names.
  - Error classification and recovery follow ADR 0006: `CorruptionException` → native helper deletes the storage file → reset → signed-out; `CryptoFailedException`/`KeyPermanentlyInvalidatedException` → reset → signed-out; anything else → keep the data, one retry, recoverable error.
  - Port the native `KeychainStorageResetModule` from the spike.
- **SessionManager** (`shared/api`) is the only reader and writer of tokens. It exposes `status: 'signedOut' | 'signedIn'` and `signIn` / `restore`. Refresh, expiry and E1 at startup are Story 2.5.
- **Startup.** A neutral splash (`colors.bg`, no focusable element) until `restore()` resolves.
  - A session → `SignedIn`.
  - No session → `Welcome`.
  - Corruption → wipe, then `Welcome` with the line «Войдите снова» (`auth.welcome.signInAgain`).
  - A recoverable error → `Welcome` without wiping.
- **SignedIn screen (temporary, replaced by the Shell in 2.4):** title «Вход выполнен» and one body line, no personal data, no focusable element. Back exits the app.
- **Logs:** the Logger only. Never the phone, challenge, code, tokens or E1 body.
- **Device run.**
  - **Implementation agent, via adb, no send request:** a device-id check (two reads plus a restart return the same UUID; no value logged), then the A2 → A5 UI walkthrough with the network calls left out (A5 is reached only through a real send, so A5 itself is checked in the live run).
  - **Coordinator with the owner, after review:** one live sign-in by the owner with the physical remote. Record in `docs/testing.md`:
  - the E1 status with the content profile (ADR 0008 check);
  - session survival after force-stop and cold start;
  - a logcat scan.

  Also record the request details in `docs/api-contract.md` §2.2 (deferred from 2.2).

**Never:**
- refresh, the 401 retry, A11, sign-out or account-switch wipes (Stories 2.5–2.8);
- storing tokens, the phone or the account id outside `SecureStore`;
- automatic resend or retry of confirm;
- more than one live sign-in attempt without asking the owner;
- uninstalling the app or clearing its data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Success | Confirm 200, E1 200 with `id` | Tokens, account id and phone saved; stack reset to SignedIn | — |
| Wrong code | 400 `invalid_sms_code` | A7: inline error, field cleared, focused | No retry |
| E1 fails | Confirm 200, E1 401/500/network | Nothing saved, `error.Unknown`, still on A5 | Tokens dropped |
| Save fails | Keychain rejects during save | Nothing kept, `error.Unknown` | — |
| Resend | Countdown over, OK on «Выслать повторно» | `transport=gate` sent, countdown restarts, focus on field | 429 → inline `TooManyAttempts` |
| Bad confirm body | 200 without `access_token` or with `expires_in` ≤ 300 | `Unknown`, nothing saved | — |
| Restore ok | Stored session | SignedIn | — |
| Restore corrupt | `CorruptionException` | Helper delete + reset, Welcome with «Войдите снова» | No crash |
| Restore transient | Other keychain error | Welcome, data kept | One retry |
| Double submit | Two «Готово» presses during confirm | One request | — |

</frozen-after-approval>

## Code Map

- `src/features/auth/CodeScreen.tsx` -- the minimal A5 from 2.2 (title, body, «Изменить номер» with id `auth/code/change-number`). Extend it to A5–A8. `authFlow.ts` holds `{phone, challenge, sentTransport}` in memory; read it, then clear it on success.
- `src/features/auth/PhoneScreen.tsx` -- reference patterns for the in-flight ref, `requestHostFocus` after state switches, `useFocusEffect` focus and late-result discard. Reuse them; do not change PhoneScreen except for shared helpers.
- `src/shared/api/authApiClient.ts` -- add `confirmCode(phone, challenge, smsCode)` and `resendCode(phone)`, mirroring `sendCode` (deviceId read bounded by the timeout, same-args single-flight, `credentials: 'omit'`). `authError.ts`: add `mapConfirmFailure`. `dto/`: a tokens schema and a user-current schema.
- `src/shared/api/profiles.ts` -- `contentProfileHeaders` / `CONTENT_USER_AGENT` exist (ADR 0008). New `httpClient.ts`: a minimal `get(path, token)` with content headers, Bearer only for `isBoostyApiUrl`, and a 30 s timeout. New `sessionManager.ts`.
- Spike reference (read with `git show origin/spike/1-3-phone-auth:<path>`; never merge):
  - `src/app/spike/spikeSecureStore.ts`: `classifyStoreError`, the reset flow, `KeychainLike` / `StorageResetHelper` ports, plus its test;
  - `android/.../KeychainStorageResetModule.kt`: `deleteKeychainStorage()`;
  - `src/app/spike/phoneAuthApi.ts`: `buildConfirmRequest`, `parseTokens`, `maskPhone`;
  - `src/app/spike/PhoneAuthCheck.tsx`: the code-phase UX.
- `android/.../BoostyNativePackage.kt` -- has `InstallIdModule`; add the reset module.
- `src/app/App.tsx`, `src/app/routes.ts` -- add `SignedIn`, a startup gate and `navigation.reset` on success. The `CodeScreen` callbacks come via props: features cannot import `app`.
- `src/shared/i18n/ru.ts` -- add `auth.code.*`, `auth.signedIn.*`, `auth.welcome.signInAgain`. Copy comes from the A5–A8 mock entries in `_bmad-output/planning-artifacts/design/claude-design-v1/Boosty TV - A B C.dc.html`. Note that `docs/focus-map.md` overrides the mock on A7: the field is cleared.
- `package.json` / lockfile -- `react-native-keychain` 10.0.0 exact.
- Device: serial and the wireless adb notes are in `docs/testing.md`. Build `assembleRelease -PreactNativeArchitectures=armeabi-v7a`, then `zipalign` + `apksigner` with the SDK debug key outside the repo, then `adb install -r`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, native reset module + package, `src/shared/platform/secureStore.ts` + tests -- the restore rows of the matrix, and the save-failure path.
- [x] `src/shared/api/authApiClient.ts`, `authError.ts`, `dto/*`, `httpClient.ts`, `sessionManager.ts` + tests -- success, wrong code, E1 fails, bad body, double submit, and the exact header sets per client.
- [x] `src/features/auth/CodeScreen.tsx`, a new `SignedInScreen.tsx`, `src/app/App.tsx`, `routes.ts`, `ru.ts` + flow tests -- countdown (fake timers), resend, A7, focus targets, Back, and the startup gate.
- [x] Device run, implementation part (device-id check); the live sign-in rows are left for the coordinator; `docs/testing.md` and `docs/api-contract.md` updated with statuses and shapes only.

**Acceptance Criteria:**
- Given a successful live sign-in, when the app is force-stopped and cold-started, then it opens SignedIn without signing in again.
- Given the owner's live run, when logcat is scanned (phone digits, `Bearer`, 32+ char runs, `sms_code`), then nothing sensitive appears, and the buffer is cleared.
- Given `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` and the release bundle, when run, then all pass.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/rn-check.bundle` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.

- Coordinator live run (2026-10-26): the owner signed in once with the physical remote (code via Telegram); E1 with the content profile succeeded; SignedIn survived force-stop + cold start; logcat clean and cleared. Review patches re-verified: lint, typecheck, 363 tests, fixtures, release bundle and build pass.

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind, edge | `read()` reports `wiped` / `clear()` resolves when recovery failed | medium | patch | `resetOk`/`fileDeleted` logged but never change the result |
| 2 | blind | Corruption on the phone write deletes the just-saved session; phone failure fails a valid sign-in | medium | patch | Session written first, phone second, both in one try with `discardSaved()` |
| 3 | blind, edge | After confirm succeeds and E1/save fails, A5 re-offers «Войти» with a likely consumed challenge | medium | patch | `doSignIn` drops tokens but keeps the challenge |
| 4 | blind, edge | No countdown after a failed resend or A8 «Выслать новый код» | medium | patch | Catch branch does not reset the deadline; rejected attempts may extend the server window (api-contract §2.2) |
| 5 | edge | Huge `expires_in` → `expiresAt` Infinity → null → wiped on restore | low | patch | Schema only bounds below |
| 6 | blind | `maskPhone` comment contradicts the code | low | patch | Example ends `07`, code yields `67` |
| 7 | blind | Status lines not announced by TalkBack | low | patch | No live region on the inline error, resend hint, «Войдите снова» |
| 8 | verification-gap | Real `keychainStorageReset` bridge never exercised | medium | patch | Corruption flow test has no `NativeModules.KeychainStorageReset` stub |
| 9 | verification-gap, blind | A5 `sms` and mask-fallback branches untested | low | patch | All fixtures use `gate` |
| 10 | verification-gap | testing.md claims the corruption path is covered by the 1.3 gate | low | patch | Production helper logic differs (ADR 0006) |
| 11 | verification-gap, blind | Production helper not run on the device | maybe-false | defer | A device corruption run deletes the shared DataStore file (the spike session lives there too); listed as an open device item |
| 12 | blind | Confirm 429 maps to Unknown | low | reject | No confirm 429 shape is verified; recorded as a live-run observation item |
| 13 | blind | `sentBySmsTo` branch depends on an unverified value | low | reject | Spec asks to name the channel when `sentTransport` names it; the branch now has a test, the live run records the value |
| 14 | blind | Restore ignores a past `expiresAt` | low | reject | Expiry and refresh at startup are Story 2.5 by the frozen intent |
| 15 | edge | Restore hang leaves the splash forever | low | reject | A never-settling keychain read is not shown reachable; the fix adds a guard |
| 16 | edge | `navigationRef` not ready on `onSignedIn` | false | reject | The user is on A5, so the container is ready |
| 17 | edge | Stale sign-in clears a newer challenge; different args → Unknown | low | reject | Needs a Back + new code + submit inside one request window; a stack reset follows |
| 18 | edge | `discardSaved` clear failure leaves tokens stored | low | reject | Resolved by #2: the session is written last, so a failed sign-in has nothing to discard |
| 19 | blind | feature-parity AUTH-03 and ADR 0006 notes not updated | low | reject | Updated with the live-run results by the coordinator |
| 20 | blind | sprint-status flips 2.2 to done in this change | false | reject | 2.2 was merged (PR #12) |
