---
title: 'Story 2.2: Request a sign-in code by phone'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: 'f9e6c1d5c2b1a1310b69d563401bf791ec6039d0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/adr/0008-api-request-profiles.md'
  - '{project-root}/docs/adr/0007-navigation-js-stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A1 Welcome is a dead end today: OK does nothing. The family needs to enter a phone number with any country code and request a sign-in code on the TV. The code screen and confirm come in Story 2.3.

**Approach:**
- Introduce the root JS stack (ADR 0007) with routes A1 → A2 Phone → A5 Code.
- Build A2 with the country-code and number fields and E.164 validation.
- Build `AuthApiClient.sendCode` (ADR 0008 auth profile, Zod-parsed) and the native install `device_id`.
- Add a redacting `Logger` and the auth-error mapping for verified shapes only.
- On success, store the challenge in memory and open a minimal A5. Story 2.3 completes A5.

## Boundaries & Constraints

**Always:**
- **Focus (`docs/focus-map.md` §2):**
  - A2 initial focus is the number field. ← moves to the country code, → moves back. ↓ moves to «Получить код»; ← → moves between the buttons «Получить код» and «Назад».
  - IME «Готово» moves focus to «Получить код» if the number is valid, otherwise back to the number field.
  - Back → A1 with «Войти в Boosty» focused.
  - Every screen is inside `Screen`. Focus ids: `auth/phone/country`, `auth/phone/number`, `auth/phone/send`.
- **Phone input:**
  - The country code is editable, defaults to `+7`, and is digits only after the `+`.
  - Validation follows E.164 rules: country code plus national number, 8–15 digits in total, whitespace trimmed. It is not a fixed digit count.
  - An invalid number at «Получить код» shows A4 (field error `error.InvalidPhone`), sends no request, and focuses the number field.
  - Fields are plain text, not password: the owner must see the digits.
- **Send:** `POST /auth/phone/verification_code/send`, form fields `phone` (E.164), `device_os=web` and `device_id`, no `transport`. The request carries the ADR 0008 auth headers plus `X-From-Id`, no Bearer, `credentials: 'omit'`, and a 30 s `AbortController` timeout.
  - An in-flight **ref** blocks a second send. The button shows `busy`.
  - The response is parsed with Zod: `data.phoneCode.code` (string, required); `sentTransport` and `expiresIn` optional.
- **Error mapping (only verified shapes):**
  - 429 `error=sms_gate_ratelimit` → `TooManyAttempts` → A9: «Изменить номер» focused, copy `error.TooManyAttempts`, no countdown, no auto-retry.
  - Transport error or timeout → `Network`.
  - Anything else (any other status, an unparseable 200, or a non-2xx body that hints at captcha) → `Unknown`, generic copy, focus on «Получить код».
  - A10 (`VerificationRequired`) has a rendered state (one retry via «Попробовать снова»), but nothing maps to it, because no captcha shape is verified.
  - Never match on `error_description`.
- **Challenge:** kept only in an in-memory auth-flow holder in `features/auth`. It is never put in route params, logs or storage, and it is cleared when leaving A5 back to A1.
- **Logger (`shared/services`):**
  - `debug/info/warn/error`, an in-memory ring of 200 entries, and `console` output only in `__DEV__`.
  - Every message and field passes `redact()`: E.164-like and 7+ digit runs, `Bearer …`, 32+ char opaque runs, URLs with a query, `code=`, `sms_code=` and `phone=` values.
  - File and export are out of scope (Story 8.3).
- **Dependencies:** pin the exact versions validated in Story 1.2: `@react-navigation/native` 7.5.1, `@react-navigation/stack` 7.12.1, `react-native-gesture-handler` 3.4.0, `react-native-screens` 4.30.0, `react-native-safe-area-context` 5.10.1, `zod` 4.6.7, and dev `@babel/plugin-transform-export-namespace-from` 7.29.7 in `babel.config.js`. Add the CI release-bundle check.

**Never:**
- code confirm, resend, countdown, tokens or SecureStore (all Story 2.3);
- persisting the phone (also Story 2.3);
- `RNScreensFragmentFactory` and native-stack;
- logging the phone, challenge or response bodies;
- a custom keyboard;
- the comments endpoint.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Valid send | `+375` + 9 digits, 200 with `data.phoneCode.code` | Busy, then A5 opens, challenge held in memory | — |
| Short/long number | Fewer than 8 or more than 15 digits in total | A4 error, no request, focus on the number field | — |
| Double OK | Two OK presses during the in-flight send | Exactly one request | — |
| Rate limit | 429 `sms_gate_ratelimit` | A9 with `error.TooManyAttempts`, focus «Изменить номер» → A2, number kept | No retry |
| Network | Fetch rejects or times out | `error.Network` on A2, focus «Получить код» | No retry |
| Unknown | 400 with another error, 500, or 200 without `code` | `error.Unknown` (generic) | — |
| Redaction | Log lines with a phone, challenge, `Bearer`, URL query | Values replaced; the ring holds no raw value | — |
| Headers | `sendCode` request | Exact ADR 0008 auth set + `X-From-Id`, no `Authorization` | — |

## Decisions (owner, 2026-10-26)

- **No real send in Story 2.2.** The device check covers A1→A2, the keyboard, focus, validation and A4, with no request sent. The live send runs once in Story 2.3, together with the confirm, as one sign-in, to spare the server's send limit.
- The spec is kept whole (about 2600 tokens).

</frozen-after-approval>

## Code Map

- `src/app/App.tsx` -- renders `WelcomeScreen` directly; replace it with `NavigationContainer` + `createStackNavigator` (`detachInactiveScreens={false}`, `headerShown: false`, `gestureEnabled: false`) inside `GestureHandlerRootView`. New `src/app/routes.ts`: typed param list `{ Welcome: undefined; Phone: undefined; Code: undefined }` (ids only).
- Spike reference (do not merge the branch; read with `git show origin/spike/1-3-phone-auth:<path>`):
  - `src/app/spike/phoneAuthApi.ts`: `encodeForm`, `webHeaders`, `DESKTOP_USER_AGENT`, `buildSendCodeRequest`, `normalizePhone` (too strict: 11–15 digits), `parseSendCode`;
  - `android/.../InstallIdModule.kt` + `BoostyNativePackage.kt`: install UUID in SharedPreferences `boostytv_install`/`device_id`. Port the module only; the keychain reset module is Story 2.3/2.5;
  - `src/app/spike/spikeNative.ts`: the JS binding.
  - Redaction ideas: `redactForLog` in `origin/spike/1-7-audio-files:src/app/spike/playbackApi.ts`.
- New files:
  - `src/shared/api/`: `profiles.ts` (two UA constants and the header builders for both profiles, ADR 0008), `authApiClient.ts` (`sendCode`), `authError.ts` (`AuthError` kinds + mapper), `dto/phoneCode.ts` (Zod).
  - `src/shared/platform/deviceId.ts`: `getDeviceId()`, memoized, over the native module.
  - `src/shared/services/logger.ts`: Logger.
- `src/features/auth/`:
  - `WelcomeScreen.tsx`: OK → `navigation.navigate('Phone')`;
  - new `PhoneScreen.tsx` (A2, A4, A9, A10 states, «Назад» → A1), `CodeScreen.tsx` (minimal A5: step label, title «Код из сообщения», body; Back → A2 with the number kept), `authFlow.ts` (in-memory phone draft + challenge), `phone.ts` (E.164 validation).
  - Copy goes into `src/shared/i18n/ru.ts` (`auth.phone.*`, `auth.code.*`), taken from the A2/A5 mock entries in `Boosty TV - A B C.dc.html` and `Auth Screen.dc.html`.
- `src/shared/ui/`:
  - reuse `Button` (`busy`), `Text`, tokens;
  - new `TextField.tsx` (DESIGN `components.text-field`: height 50, border 1.5, `focus-ring` border when focused, no scale, error border + `error-text` message).
  - `TextInput` opens the IME on OK (Android TV default). `onSubmitEditing` implements the «Готово» rule.
- `babel.config.js`, `package.json`, `package-lock.json`, `.github/workflows/ci.yml` -- add the deps; CI step `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output "$RUNNER_TEMP/index.android.bundle"`.
- `android/app/src/main/java/io/github/dzmitryafanasenka/boostytv/MainApplication.kt` -- add the native package (no fragment factory in `MainActivity`).
- Tests: test-renderer as in `__tests__/App.test.tsx`; mock `fetch` and the native module; navigation via a real `NavigationContainer` in tests.
- Device: release-like build, `adb install -r` (same package id as the spike; never uninstall or clear data); serial in `docs/testing.md`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, lockfile, `babel.config.js`, CI -- the pinned deps, the babel plugin and the bundle check.
- [x] Native `InstallIdModule.kt` + package + `src/shared/platform/deviceId.ts` + test.
- [x] `src/shared/services/logger.ts` + test -- the redaction row of the matrix.
- [x] `src/shared/api/profiles.ts`, `authApiClient.ts`, `authError.ts`, `dto/phoneCode.ts` + tests -- the headers, send, Unknown, rate-limit, network and double-send rows.
- [x] `src/features/auth/phone.ts` + test -- the valid and short/long rows, plus whitespace and the country code.
- [x] `src/shared/ui/TextField.tsx` + test -- focused and error states, accessibility label.
- [x] `src/app/routes.ts`, `App.tsx`, `WelcomeScreen.tsx`, `PhoneScreen.tsx`, `CodeScreen.tsx`, `authFlow.ts`, ru catalog + screen tests -- the navigation, the «Готово» rule, A4/A9/A10 states, focus targets and Back.
- [x] Device check per the owner decision (no send request); results in `docs/testing.md`; logcat scan for digits, `Bearer` and 32+ runs on app lines, then clear the buffer.

**Acceptance Criteria:**
- Given A1, when OK is pressed, then A2 opens with focus on the number field and `+7` in the country code.
- Given A2, when Back is pressed, then A1 shows with «Войти в Boosty» focused.
- Given `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` and the release bundle command, when run, then all pass.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/rn-check.bundle` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.

## Implementation Notes

- Screens take navigation callbacks as props (`onSignIn`, `onCodeSent`, `onExit`, `onChangeNumber`); `src/app/App.tsx` wires them to the typed routes. Features must not import `src/app` (lint boundaries), so `routes.ts` stays in `app`.
- `AuthApiClient.sendCode` returns the in-flight promise to a second caller for the same phone; a different phone while one is in flight is rejected (`Unknown`) without a request. The 30 s timeout also bounds the device id read. `PhoneScreen` also guards with an in-flight ref. A result that arrives after Back is dropped.
- `+7` with an 11-digit national number starting with `8` (trunk prefix) is invalid.
- A9/A10 use `auth/phone/change-number` and `auth/phone/retry`; every state switch focuses its target with `requestHostFocus`; a successful A10 retry puts A2 back into the form before opening A5.
- `AuthError.kind` includes `Network` for transport failures and timeouts (copy `error.Network`).
- Focus to a text field uses `requestTVFocus()` on its non-collapsable host view (no IME); A2 ↓/↑ routing uses focus guide destinations. Recorded in `docs/focus-map.md` §2.
- `TextField` draws the focus ring outside the red border when focused with an error, so focus stays visible on A4.
- Device check per the owner decision: no send request; results in `docs/testing.md` (Story 2.2).

- Coordinator re-check after the review patches (2026-10-26): lint, typecheck, 237 tests, check:fixtures and the release bundle pass; release-like build reinstalled with `adb install -r`; A1 → OK → A2 focuses `auth/phone/number` (screenshot matches the mock), Back → A1 focuses `auth/welcome/signin`; no JS errors in logcat (agent via adb, no send request).

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind, edge | Back/«Изменить номер» on A5 after a successful A10 retry returns to A10; focus effect hits a null ref | medium | patch | `send()` navigates without resetting `mode`; A2 stays mounted under A5 |
| 2 | blind, edge | A9/A10 focus relies on a `hasTVPreferredFocus` flip after the focused button unmounts | medium | patch | No `requestHostFocus` on the mode switch, unlike other transitions |
| 3 | blind, edge | `sendCode` dedupe ignores the phone | medium | patch | Singleton client returns the pending promise for any phone; a Back during a send then a new number mixes challenge and phone |
| 4 | blind, edge | `getDeviceId` read not bounded by the timeout | low | patch | Timer starts after `await deviceId()`; a hung native call keeps the send in flight |
| 5 | edge | `+7` with trunk prefix `8` passes (12 digits) | medium | patch | E.164 length check alone accepts `+78916…` |
| 6 | edge | `retryUsed` never reset | low | patch | Only set, never cleared |
| 7 | blind | A9/A10 reuse `auth/code/*` ids on the phone screen | low | patch | Duplicate ids across mounted screens |
| 8 | blind | `isBoostyApiUrl` accepts an explicit port | low | patch | Host compare ignores the port |
| 9 | verification-gap | A10 retry ending in Network/Unknown untested | low | patch | `openA10` scripts only VerificationRequired/ok |
| 10 | verification-gap | Real `requestHostFocus` never tested | low | patch | Mocked in every test |
| 11 | verification-gap, blind | `InstallId` native module not exercised on the device | maybe-false | defer | Owner decision: no send in 2.2; added to deferred-work as a Story 2.3 pre-send device row |
| 12 | blind | api-contract/feature-parity not updated with the send details | low | defer | Recorded with #11 for Story 2.3, after the live send |
| 13 | blind | Logger over-redacts long URL paths and timestamps | low | reject | Over-redaction is the safe direction; no diagnostics consumer yet |
| 14 | blind | «Готово» with an invalid number shows no A4 | low | reject | Spec's «Готово» rule only moves focus; A4 appears on «Получить код» |
| 15 | blind | `credentials: 'omit'` unproven for the native jar | false | reject | RN Android `NetworkingModule` switches to `CookieJar.NO_COOKIES` when `withCredentials=false` (verification-gap layer) |
| 16 | blind | TextField error only as a hint; fields editable while busy | low | reject | Challenge is stored with the E.164 captured at send start (#3 patch); a11y state polish belongs to Story 9.4 |
| 17 | blind | `contentProfileHeaders` unused until Story 2.5 | low | reject | ADR 0008 defines both profiles in one module; tests pin both sets |
| 18 | edge | Invalid country code shows the error on the number field | low | reject | Rare; the country field is normalized to `+digits` |
| 19 | edge | `.` separators rejected | low | reject | Rare input; A4 explains |
| 20 | edge | Logger misses separated national numbers and short challenges | low | reject | The client never logs the phone; the live challenge is 64 chars (api-contract §2.2) |
| 21 | edge | Back during a busy A10 retry, then an error switches the mode | low | reject | Same-screen race needs a Back within the request window on A10, which has no Back target other than A2's form; not shown reachable |
| 22 | blind | App.test lost OK-press assertions | low | reject | Moved to `signInFlow.test.tsx` (A1 OK → A2) |
