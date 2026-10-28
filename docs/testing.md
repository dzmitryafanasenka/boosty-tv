# Testing

Apple TV (tvOS) is out of scope (owner decision 2026-10-27); every check here is Android TV only.

## Pinned test device

| Item | Value |
|---|---|
| Device | Chromecast with Google TV 4K (confirmed by owner 2026-10-25) |
| Android TV OS version | Android TV OS 14 (API 34), build `UTTC.250917.004` (`google/sabrina_prod_stable/sabrina:14/UTTC.250917.004/14193937`) |
| Security patch level | 2025-10-01 |
| Android System WebView version | 156.0.8078.47 |
| Remote | Stock Chromecast with Google TV voice remote: D-pad, OK, Back, Home, voice; **no media keys** (owner, Story 1.6). D-pad left/right reach `useTVEventHandler` as key up only |
| Display | Physical 3840×2160; UI override 1920×1080 px at density 320 |
| Reported window size (dp) | **960×540 dp** (1920 × 160 / 320 = 960; 1080 × 160 / 320 = 540). Matches the DESIGN.md assumption (design px ÷ 2). |
| adb connection | Wireless debugging (Android 11+ pairing): `adb pair <ip>:<pair-port> <code>` once, then `adb connect <ip>:<port>` (the port changes after a reboot) |

## Build configuration

Recorded for Story 1.1 (2026-10-25).

| Item | Value |
|---|---|
| React Native | `react-native` → `npm:react-native-tvos@0.87.1-1` (core 0.87.1), React 19.2.3 ([ADR 0001](adr/0001-react-native-tvos-0-87-bootstrap.md)) |
| Native artifacts | `io.github.react-native-tvos:react-android:0.87.1-1`, `com.facebook.hermes:hermes-android:250829098.0.17` (from `./gradlew :app:dependencies`) |
| Architecture | New Architecture on (`newArchEnabled=true`), Hermes on |
| Package manager | npm 11.12.1, exact pins (`.npmrc` `save-exact=true`), committed `package-lock.json` |
| Node | 24.15.0 (`.nvmrc`: 24; `engines`: `>=24 <25`) |
| JDK | 17.0.21 — Homebrew `openjdk@17` (keg-only, `JAVA_HOME=/opt/homebrew/opt/openjdk@17`). See note below. |
| Android SDK root | `/opt/homebrew/share/android-commandlinetools` (Homebrew `android-commandlinetools` 15859902) |
| SDK packages | platform-tools 37.0.1 (`adb` 1.0.41 / 37.0.1), `platforms;android-36`, `platforms;android-37.0`, `build-tools;36.0.0`, `build-tools;37.0.0`, `ndk;27.1.12297006`, `cmake;3.22.1` |
| Gradle / AGP / Kotlin | Gradle 9.4.1 (wrapper), AGP 9.2.1 (RN Gradle plugin catalog), Kotlin 2.2.0 |
| SDK levels | minSdk 24, compileSdk 37, targetSdk 36, buildTools 37.0.0 |
| ABIs | armeabi-v7a, arm64-v8a, x86, x86_64 (template default) |
| Video player | `react-native-video` **6.19.3** exact (Media3 1.8.0 on Android; added to `main` in Story 4.1, the version that passed the Story 1.2/1.6 spikes), behind the `PlayerEngine` port (`src/shared/platform/playerEngine.ts`, `PlayerEngineView.tsx`) |
| applicationId | `io.github.dzmitryafanasenka.boostytv`, launcher label «Boosty TV» |
| Variants | `debug`: debuggable, cleartext on (Metro only), signed with the local SDK debug keystore. `release`: cleartext off, unsigned in-repo (owner signs locally). |
| Build host | macOS 26.5.2, Apple Silicon (arm64) |

**JDK note.** The owner approved `zulu@17` via Homebrew. The `zulu@17` cask runs a
`.pkg` installer that needs `sudo`, which is not available to a non-interactive
agent session, so the install failed. The keg-only Homebrew formula
`openjdk@17` (same major version, no `sudo`) was installed instead. CI uses
Zulu 17 through `actions/setup-java`. The owner can switch the local JDK to
Zulu later with `brew install --cask zulu@17` in a terminal.

### Bootstrap commands (Story 1.1)

```sh
# Toolchain (owner-approved, outside the repo)
brew install --cask android-commandlinetools android-platform-tools
brew install --cask zulu@17          # failed: needs sudo, see JDK note
brew install openjdk@17              # used instead
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
yes | sdkmanager --licenses
sdkmanager --install "platform-tools" "platforms;android-36" "platforms;android-37.0" \
  "build-tools;36.0.0" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.22.1"

# Template, generated in a scratch directory and moved into the repo root
npx @react-native-community/cli@20.2.0 init BoostyTV --version 0.87.1 \
  --package-name io.github.dzmitryafanasenka.boostytv \
  --skip-install --skip-git-init --install-pods false
# Copied everything except ios/, Gemfile, .bundle/, android/app/debug.keystore,
# App.tsx, README.md and .gitignore (merged by hand).
```

Changes on top of the template:

- `package.json`: `react-native` aliased to `npm:react-native-tvos@0.87.1-1`;
  `overrides.react-native = "$react-native"` so `@react-native-tvos/virtualized-lists`
  (peer `react-native: 0.87.1`) resolves to the react-native-tvos fork instead of pulling a
  second, core `react-native@0.87.1` into `node_modules`; all versions pinned
  exactly; template-only packages removed (`@react-native/new-app-screen`,
  `react-native-safe-area-context`, `react-test-renderer`,
  `@types/react-test-renderer`, `@react-native-community/cli-platform-ios`);
  added `eslint-plugin-boundaries@7.3.0` and `test-renderer@1.3.1`.
- `overrides.test-renderer.react-reconciler = "0.33.0"`: `test-renderer@1.3.1`
  depends on `react-reconciler@~0.34.0`, which needs React ^19.3. React is
  pinned to 19.2.3 by RN 0.87.1, so the reconciler is held at 0.33.0 (the React
  19.2 line). Revisit when RNTL is added.
- Android: TV manifest (LEANBACK_LAUNCHER + LAUNCHER, `android:banner`,
  `touchscreen`/`faketouch`/`leanback` `required=false`, `allowBackup=false`),
  neutral placeholder banner (320×180) and launcher icons generated by a local
  script (no Boosty, BoostBuddy or React Native marks), no committed keystore.

### Story 2.4 — The app shell: sidebar, Back and focus, 2026-10-26

**Status: implemented and host-tested; the Shell rows verified on the pinned device by adb (release-like build, injected keys, uiautomator, screenshots); restoration on the 300-card list, the fallback chain and the modal host verified on a debug build by adb. The owner checked the sidebar, Back, the dialog and «Проверка фокуса» with the physical remote on the debug build: all work.**

Changes: `SignedIn` replaced by the Shell (`src/app/Shell.tsx`, sections gated by `src/app/phaseFlags.ts`: Главная and Настройки); `HomeScreen` (StateView «Лента появится здесь», `src/features/home`), `SettingsScreen` (info row «Версия <versionName>», `src/features/settings`); `NavItem`, `SettingRow`, `StateView` (`src/shared/ui`); `focusRestoration` store, `FocusZone` (zone destinations + remembered content focus), `useFocusRestoration` (virtualized list restore + fallback chain) and `ModalHostProvider` / `useModal` (`src/shared/focus`); native `AppInfoModule` (`versionName` constant) + `src/shared/platform/appInfo.ts`; debug-only «Проверка фокуса» (`src/app/dev/devFocus.tsx`, routes `DevFocus` / `DevFocusDetail`, required only under `__DEV__`). Jest now also transforms `@react-native-tvos/virtualized-lists` (FlatList).

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (31 suites, 430 tests after the review fixes), `npm run check:fixtures` pass. New tests: `focusRestoration.test.ts` (store per route + section, override once, fallback chain), `useFocusRestoration.test.tsx` (scroll → index → focus once mounted, neighbor, above, frame budget, cancelled loop), `ModalHost.test.tsx` (scrim, 4-side trap, Back first, focus to the initiator before/after the unmount and two frames later), `shellPrimitives.test.tsx`, `phaseFlags.test.ts`, `appInfo.test.ts`, `shellFlow.test.tsx` (the real App: every Shell row of the spec matrix, the dev list restore / fallback / modal, a covered Shell ignoring fallback focus), and `releaseBundle.test.js` (the `--dev false` Metro bundle has no `DevFocus`, `dev/list/`, `dev/focus`, `dev/action/`, `dev/dialog`; the debug bundle has them as a control). The shipped Hermes bundle of the release APK was also searched: `DevFocus` 0, `dev/list` 0, `nav/settings` 1.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL; release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo) installed with `adb install -r`. A debug build (`assembleDebug -PreactNativeArchitectures=armeabi-v7a`, Metro on port 8097 via `adb reverse tcp:8081 tcp:8097`; the other Metro on host 8081 was not touched) was installed in between with `adb install -r`, then the release-like build again; it is the installed build now. Nothing uninstalled or cleared; the owner's session was never touched and no request to Boosty was sent by the agent.

| Row | Result | Who |
|---|---|---|
| Signed-in boot | Cold start (launcher intent) → Shell, Главная current, focus `nav/home`, StateView shown; no sign-in (stored session) | agent via adb (release-like, screenshot) |
| Layout (px = dp × 2) | Sidebar 0–336 (168 dp), wordmark and items from x 96 (48 dp), first item top 140; content 384–1824 (192–912 dp), top 54 / bottom 1026 (27 dp). Settings rows 408–1800, so the scaled focused row and ring end at ≤ 1824 (safe area) | agent via adb (uiautomator) |
| Current vs focused | Current: `surface-current` + accent bar; focused: ring + `surface-focus-row`; distinct (screenshots) | agent via adb |
| Edges | ↑ on `nav/home`, ↓ on `nav/settings`, ← on the sidebar: focus stays; → from the sidebar on Главная: stays (no content focus) | agent via adb (release-like) |
| Focus alone | ↓ to `nav/settings` does not switch the section | agent via adb |
| Open section | OK on `nav/settings` → Настройки current, focus `settings/row/version` («Версия 1.0»); OK on the row does nothing | agent via adb (release-like) |
| Zones | ← from a content row → `nav/settings` (current item, also from the lower row); → → the remembered content row; ↑ ↓ in content do not leave it | agent via adb |
| Back order | content → `nav/settings`; → Главная current, focus `nav/home`; → Google TV Home (app exits) | agent via adb (release-like) |
| Restore on a virtualized list (debug) | 149 × ↓ to `dev/list/150` (scrolled into view), OK → detail, Back → card 150 focused and centered | agent via adb |
| Fallback (debug) | Card deleted on the detail screen → Back → `dev/list/151`; first card deleted → `dev/list/2`; all deleted → Back → «Открыть диалог» (action above) | agent via adb |
| Screen trap (debug) | On the detail screen ↑ ← → ↓ never reached the covered list | agent via adb |
| Modal host (debug) | OK → dialog on the scrim, focus «Понятно»; ↑ ↓ ← → stay inside; Back closes it, focus «Открыть диалог» (5/5 after the fix below); «Закрыть» does the same; Back from the check → Shell with `settings/row/focus-check` focused | agent via adb |
| Debug row in release | Not rendered in the release-like build (Настройки has only «Версия») | agent via adb |
| Edge-to-edge | `edgeToEdgeEnabled=true` kept: no system bars on this TV, content and safe area at their designed positions (bounds above), nothing clipped | agent via adb |
| Physical remote (debug build) | Sidebar ↑ ↓, open on OK, zones ← →, Back order, «Проверка фокуса» restore / fallback, dialog: all work. Remote response on the 300-card list felt slower than usual (debug build; release latency to be measured on the first long production list, deferred-work.md) | owner, 2026-10-26 |
| TalkBack | **Not verified** | — |

Device findings fixed in this story: (1) a focus request sent in the same commit as the dialog unmount was lost and nothing stayed focused (the next ↓ then focused the covered Shell); the modal host now also requests the initiator two frames later. (2) Fallback focus can land on the covered Shell; a covered Shell now ignores focus events, so it still restores its content focus on return. (3) On the pushed dev screen a FlatList with `flex: 1` or absolute `bottom: 0` measured 0 high, and a list taller than the screen did not scroll a newly focused card into view; the dev list uses an explicit viewport height. Later list screens must give their list a bounded viewport and verify it on the device. (4) Native scrolling puts a newly focused card flush with the list edge, so its ring can cross the safe area at the bottom; production lists need headroom or explicit scrolling. One unexplained observation: in one release-like run right after a burst of blind injected keys, ← on `nav/home` moved focus to `nav/settings`; it did not reproduce in later release-like and debug runs.

Review fixes, re-checked on the device by adb: the sidebar now traps ← (← on `nav/home` and `nav/settings` keeps focus, debug and release-like); a pop restores the remembered scroll offset without recentring (card 41 at the same bounds before the push and after Back). The release-like build was installed again afterwards (Hermes bundle: `DevFocus` 0, `dev/list` 0); boot into the Shell with the stored session, no debug row in Настройки, Back order unchanged, no JS errors in logcat.

### Story 2.5 — Stay signed in across restarts and expiry, 2026-10-26

**Status: implemented and host-tested; cold start, resume and the one live refresh verified on the pinned device by adb (rows below). Offline cold start is verified with FixtureTransport only (owner decision: no device offline run).**

Changes: `AppError` + AD-6 retry table (`src/shared/api/appError.ts`); the shared `Transport` seam (`transport.ts`) and `FixtureTransport` (`fixtureTransport.ts`); `HttpClient` with the token from an injected `AccessTokenSource`, the 401 → renew → one GET retry path, AD-6 retries, a per-attempt timeout and non-GET support without retries; `AuthApiClient.refresh` and the lenient refresh DTO; the single-flight `refreshCoordinator.ts` (persist before adopt, generation guard, a 30 s cooldown after a failed refresh, the current token kept while not past `expiresAt`, `expired` only on 400 `invalid_grant`); `SessionManager` keeps the session in memory, adds `expired` (clears the stored session entry, keeps the phone; the next cold start opens A1 «Войдите снова» via restore reason `expired`), `validate()` (E1), `onAppStateChange`, a local `signOut()` (no UI yet) and the `__DEV__`-only `debugCorruptAccessToken`. App: E1 after the navigator is ready and on every return to `active`, Главная's offline StateView with «Повторить» (`src/features/home`), `expired` → A1 «Войдите снова», the debug-only Настройки row «Проверка обновления сессии», the demo mode (`src/app/appConfig.ts` `DEMO_MODE`, `src/app/dev/demo.ts`, the «ДЕМО» badge). Release guard: `checkDemoModeOff` in `android/app/build.gradle` (before `createBundleReleaseJsAndAssets`) and `__tests__/demoModeOff.test.js`. New fixtures: `e1-user-current`, `refresh-ok`, `refresh-invalid-grant`.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (36 suites, 546 tests after the review fixes), `npm run check:fixtures` (17 clean) pass. New or extended tests: `appError.test.ts`, `httpClient.test.ts` (headers, AD-6 table, per-attempt timeout, 401 paths, mutations never re-sent, 403 never renews), `authApiClient.test.ts` (refresh form and headers, only 400 `invalid_grant` rejected, every other result kept with its kind, `expires_in` and `refresh_token` edges), `__tests__/sessionRefresh.test.ts` (matrix rows cold start, proactive with 5 concurrent GETs, past `expiresAt`, 401, retry 401, concurrent and staggered 401s, rejected, recoverable 5xx/429/400/401/403/network/timeout/bad 200, save failure, the refresh cooldown, a still-valid token after a failed proactive refresh, sign-out and reload during a refresh, sign-out during the save, a request after sign-out began, offline E1, the debug trigger, no secrets in logs), `__tests__/sessionFlow.test.tsx` (the real App: background E1 without a focus move, offline StateView, «Повторить» busy state, Server/Parse/Client cold-start results keep the placeholder, resume, `expired` route, cold start after expiry → «Войдите снова», the debug row end to end), `__tests__/demoFlow.test.tsx` (badge, not focusable, no keychain call, no network), `releaseBundle.test.js` (no session-check id, debug trigger, demo or FixtureTransport in the `--dev false` bundle). The shipped Hermes bundle of the release APK was also searched: `settings/row/session-check` 0, `createDemoSessionManager` 0, `access token corrupted` 0, `home/offline/retry` 1.

Review fixes (refresh cooldown, `expired` wipes the stored session, sign-out race, still-valid token after a failed proactive refresh, `expired` before the navigator is ready) were host-tested only; the device rows below were run before them and were not repeated. After the fixes `assembleRelease` was re-run (BUILD SUCCESSFUL) and `checkDemoModeOff` was re-proven to fail with the flag flipped.


**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL with `DEMO_MODE = false`; with the flag flipped to `true` locally: `Execution failed for task ':app:checkDemoModeOff'` → BUILD FAILED (flag reverted afterwards). Release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo) and debug (`assembleDebug`, Metro on port 8097 via `adb reverse tcp:8081 tcp:8097`; the other Metro on host 8081 was not touched, the reverse mapping was restored afterwards) installed with `adb install -r`; the release-like build is installed now. Nothing uninstalled or cleared.

| Row | Result | Who |
|---|---|---|
| Cold start, release-like | Launcher start → Shell, Главная placeholder, focus `nav/home`, no sign-in. The release build logs nothing, so its E1 is not visible in logcat; the placeholder (not the offline view, not A1) shows E1 did not fail with `Network` or `expired` | agent via adb (uiautomator) |
| Cold start, debug | `[http] GET /v1/user/current 200 (attempt 1)`, `[session] E1 ok` once; Shell shown | agent via adb (logcat) |
| Resume, debug | Home → launcher start (same process): one more `GET /v1/user/current 200`; focus stays `nav/home` | agent via adb (logcat, uiautomator) |
| One live refresh, debug | Настройки → «Проверка обновления сессии» (OK injected): `E1 401` → `[auth] refresh ok 200, rotated` → `[secureStore] saved` → `[session] refreshed` → `E1 200` | agent via adb (logcat) |
| Rotated session after a cold start, release-like | Reinstalled release-like, force-stop + launcher start → Shell, focus `nav/home`, no sign-in | agent via adb (uiautomator) |
| Debug row in release | `settings/row/session-check` absent from the release bundle (Jest + APK bundle search) | host |
| Logcat scan | The captured segment of the live-refresh run: no `Bearer <value>`, `access_token`, `refresh_token`, 9+ digit runs or 32+ opaque runs in app lines; buffer cleared, local copy deleted | agent |
| Offline cold start | FixtureTransport only (host tests); not run on the device (owner decision) | host |
| Demo mode on the device | **Not run** (host tests only) | — |
| Physical remote / TalkBack | **Not verified** | — |

### Story 2.6 — Session expired and quick re-login, 2026-10-26

**Status: implemented and host-tested; the debug in-memory A11 path and the release-like cold start verified on the pinned device by adb (rows below). The re-login itself is host-tested only (owner decision: no code is sent on the device).**

Changes: A11 «Сессия истекла» (`src/features/auth/ExpiredScreen.tsx`, route `Expired`); `SessionManager` replaces the stored session with a token-free expiry marker `{v:1, expired:true, accountId}` on refresh 400 `invalid_grant`, `restore()` maps only the marker to status `expired` (an empty session store is `signedOut`, reason `none`, even with a kept phone), the status-gated `getExpiredPhone()`, `signIn` → `{ accountChanged }`, the `__DEV__`-only `debugExpireInMemory`; `splitE164` over the ITU-T calling code list (`src/features/auth/phone.ts`); A2 opened from A11 focuses «Получить код» when the prefill is valid; App: `expired` closes an open modal without a focus return (`ModalApi.close({ restoreFocus: false })`), clears the offline view and resets to `[Expired]` (also on `onReady`), boots into A11 after an expiry, a different account clears FocusRestoration, the Shell uses the constant restoration key `shell`; the debug-only Настройки row «Проверка: сессия истекла» (`settings/row/expired-check`).

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (37 suites, 595 tests after the review fixes), `npm run check:fixtures` (17 clean) pass. New or extended tests: `__tests__/expiredFlow.test.tsx` (every spec matrix row through the real App over FixtureTransport: mid-session expiry, expiry from a pushed screen with an open dialog, expiry before the navigator is ready, cold start with the marker, wiped store → A1, prefill `+375` / `291234567` with focus «Получить код», no phone and an unassigned code → empty A2 with focus on the number, Back A2 → A11 → exit, A5 Back and «Изменить номер» → A2 with focus on the number, A9 «На первый экран» → A11, a double OK during the phone read opens A2 once (busy meanwhile), same account (also after a restart) keeps FocusRestoration, a different account clears it, offline cold start → expiry → re-login shows the placeholder, the debug row leaves SecureStore untouched and sends nothing), `sessionManager.test.ts` (marker restore, invalid markers → wiped, the phone accessor gating and failures, `accountChanged` for same/other/none, marker overwritten by sign-in, the debug hook, sign-out forgets the previous id, no phone or account id in logs), `sessionRefresh.test.ts` (marker written instead of a clear, marker write failure logged), `phone.test.ts` (`splitE164`, a prefix-free calling code list), `ModalHost.test.tsx` (`restoreFocus: false`; the flaky Story 2.4 close test — 8/40 failures on baseline `d9879b3`, a late-flushed open effect calling the no-op `requestHostFocus(null)` — now counts non-null focus targets only: 0/60 failures), `sessionFlow.test.tsx` (the expiry rows now expect A11), `releaseBundle.test.js` (`settings/row/expired-check` and the debug log line absent from the `--dev false` bundle).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL. The shipped Hermes bundle: `settings/row/expired-check` 0, `debug: expired in memory` 0, `settings/row/session-check` 0, `auth/expired/relogin` 1. Debug APK (`assembleDebug`, native unchanged) with Metro on port 8097 via `adb reverse tcp:8081 tcp:8097` (the other Metro on host 8081 was not touched; the reverse mapping was restored to `tcp:8081 tcp:8081` afterwards); release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo); both installed with `adb install -r`. The release-like build is installed now. Nothing uninstalled or cleared; no sign-in, no code sent.

| Row | Result | Who |
|---|---|---|
| Debug row → A11 | Shell → Настройки → `settings/row/expired-check` → OK: A11 with the catalog copy, focus `auth/expired/relogin`; logcat `[session] debug: expired in memory`, `status expired`; no request | agent via adb (uiautomator, logcat, screenshot) |
| A11 OK → A2 prefilled | One OK: A2 with the stored phone split into a 3-digit country code and a 9-digit number (digits masked in the capture), focus `auth/phone/send`; one keychain read of `boostytv.phone`, no request | agent via adb |
| Back A2 → A11 → exit | Back → A11, focus «Войти снова»; Back → Google TV Home | agent via adb |
| Cold start after the debug trigger (debug) | Force-stop + launcher start → Shell, focus `nav/home`, `E1 200` (the stored session was untouched) | agent via adb (logcat, uiautomator) |
| Cold start, release-like | Launcher start → Shell, focus `nav/home`; Настройки has only «Версия» (no debug rows) | agent via adb (uiautomator) |
| Real `invalid_grant` expiry, re-login, same/different account | Host tests only (FixtureTransport); not run on the device (owner decision) | host |
| Modal open during expiry | Host test only (the debug dialog) | host |
| Physical remote, TalkBack | **Not verified** | — |

### Story 2.7 — Minimal Settings and sign-out, 2026-10-26

**Status: implemented and host-tested; the Настройки rows and the sign-out dialog (open, focus, ← →, «Отмена», Back) verified on the pinned device by adb on a release-like build. The sign-out itself is host-tested only (owner decision: the owner stays signed in on the device).**

Changes: `AccountScope` (`src/shared/account/`: `defineAccountScoped`, `register`, `seal`, single-flight `reset()` with the session as the gate, `generation()`); `src/app/bootstrap.ts` registers `session` (`src/app/session.ts`, the active SessionManager's local `signOut()`), `focusRestoration`, `authFlow` and `logger`, then seals, imported first by `App.tsx`; the shared `Dialog` primitive (`src/shared/ui/Dialog.tsx`); Настройки row «Выйти из аккаунта» (`settings/row/signout`) and `SignOutDialog` (`src/features/settings/`); App: confirm → `accountScope.reset()` → modal closed without a focus return → `[Welcome]`; a failure keeps the dialog with the error line. No network request on sign-out.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (41 suites, 622 tests), `npm run check:fixtures` (17 clean) pass. New tests: `__tests__/signOutFlow.test.tsx` (the spec matrix through the real App over FixtureTransport: the rows and the version focus, the dialog's focus, copy and hidden background, «Отмена» and Back → the row, confirm clears the keychain session and phone, FocusRestoration, the sign-in draft and the log ring, generation +1, no request, A1 with focus «Войти в Boosty» and no «Войдите снова», a repeated OK / «Отмена» / Back during the reset → one reset, a failed keychain clear keeps the dialog, the error line, the session and every store and moves no focus, a refresh in flight at confirm is dropped and storage stays clear), `__tests__/accountScopeRegistry.test.js` (scans `src/` for declared stores; fails on an unregistered or duplicate one; checked by removing a registration), `src/shared/account/__tests__/accountScope.test.ts` (order, gate failure, partial failure, single flight, generation, seal, logs), `src/shared/ui/__tests__/Dialog.test.tsx`, `sessionManager.test.ts` (sign-out from `expired`, its failure, `getExpiredPhone()` → null when sign-out lands mid-read).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL. The shipped Hermes bundle: `settings/row/signout` 1, `dialog/signout/confirm` 1, `createDemoSessionManager` 0, `settings/row/expired-check` 0, `settings/row/session-check` 0. Release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`; nothing uninstalled or cleared, no sign-in, no sign-out.

| Row | Result | Who |
|---|---|---|
| Настройки rows | Launcher start → Shell (still signed in), ↓ OK on Настройки: focus `settings/row/version`; rows `version`, `signout` only (release-like: no debug rows); ↓ → `settings/row/signout`, ↓ again stays | agent via adb (uiautomator) |
| Dialog open | OK on the row → `dialog/signout` with focus `dialog/signout/cancel`; copy as approved (screenshot) | agent via adb (uiautomator, screenshot) |
| ← → and the trap | → `confirm`, → stays, ↑ stays, ← `cancel`, ← stays | agent via adb |
| «Отмена» | OK on «Отмена» → dialog closed, focus `settings/row/signout` | agent via adb |
| Back | Dialog opened again, Back → dialog closed, focus `settings/row/signout`; ↑ → `settings/row/version`; the Shell and the session kept | agent via adb |
| Confirm, failure, double OK, refresh race | Host tests only (`signOutFlow.test.tsx`); not run on the device (owner decision) | host |
| Physical remote, TalkBack | **Not verified** | — |

### Story 2.8 — Account switch never leaks data, 2026-10-26

**Status: implemented and host-tested only.** Owner decision (2026-10-26): no device run and no sign-in spent; the owner's session on the TV stays untouched. S10 "second account" stays **not verified on the device**.

Changes: `SessionManager` gets an account-switch hook (`SessionManagerDeps.onAccountSwitch` / `setAccountSwitchHook`); `signIn` order is confirm → E1 → account-id compare (in-memory session, else the expiry marker) → on a change or no previous id `await hook()` → phone write → session write → `signedIn`. A hook rejection, or no hook set, fails the sign-in with the spent-challenge error and stores nothing of the new account. The bootstrap hook throws when `reset()` reports a failed store (a partial reset fails the switch; sign-out still leaves the account anyway). `CodeScreen` takes `signIn` as a prop from the active session, so a demo sign-in runs on the demo stores. The hook's gate is the manager's own `signOut()`, so the status may pass `signedOut` on the way to `signedIn` (no navigation is tied to it). `src/app/bootstrap.ts` sets the hook on the active session (real or demo) to `accountScope.reset()`; `App.onSignedIn` no longer clears FocusRestoration itself. `AccountScope.guard(store, write)` captures the generation; `commit(value)` writes only if no reset happened since, otherwise drops the value and logs `stale write dropped` with the store name only. Logs on switch: `accountChanged` and store names; never a phone or an account id.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (42 suites, 646 tests), `npm run check:fixtures` (17 clean) pass. New or extended tests: `__tests__/accountSwitchFlow.test.tsx` (the spec matrix through the real App over FixtureTransport: switch from A11 mid-session and after a restart, and from A1 with nothing stored — the requests after A11 are exactly send, confirm, E1; the keychain order is `reset:phone`, `reset:session`, `set:phone`, `set:session`, and at B's phone write the marker, FocusRestoration, the draft, the challenge and A's log lines are gone; same account → no keychain clear, FocusRestoration and the log ring kept; a failing gate clear → A8 with `error.Unknown`, no keychain write, A's marker and phone kept; a failing non-gate store → the sign-in fails as spent, nothing of B stored; a guarded write held on a delayed fixture response is dropped after B signs in and committed after a same-account re-login), `expiredFlow.test.tsx` (same/different account assert the keychain order), `demoFlow.test.tsx` (demo expiry → A11 → A2 → A5 → sign-in with another id through the UI: the demo hook wiped FocusRestoration and the log ring, the keychain mock was never called; the demo transport now answers confirm with synthetic tokens), `sessionManager.test.ts` (hook order, no hook for the same account, the gate inside sign-in, hook failure → spent), `accountScope.test.ts` (`guard`). A mutation check (the bootstrap hook body removed) fails 6 of these tests.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL. The shipped Hermes bundle: `stale write dropped` 1, `accountChanged` 1, `createDemoSessionManager` 0.

| Row | Result | Who |
|---|---|---|
| Different account from A11 / A1, same account, reset failure, late guarded write, demo | Host tests only (FixtureTransport); not run on the device (owner decision) | host |
| S10 second account on the device | **Not verified** (owner decision 2026-10-26; no second account used) | — |
| Physical remote, TalkBack | **Not verified** | — |

### Verification commands

```sh
npm ci && npm run lint && npm run typecheck && npm test
npm run check:fixtures   # sanitization check for src/test/fixtures (Story 1.5)
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/rn-check.bundle   # release Metro bundle (Zod 4 needs the Babel plugin; Story 2.2, also in CI)
npm ls react-native        # react-native@npm:react-native-tvos@0.87.1-1, deduped
cd android && ./gradlew assembleDebug assembleRelease
aapt dump badging app/build/outputs/apk/debug/app-debug.apk   # leanback-launchable-activity + banner
aapt dump xmltree app/build/outputs/apk/release/app-release-unsigned.apk AndroidManifest.xml
```

Device install and launch (owner connects the Chromecast over network `adb`):

```sh
adb pair <chromecast-ip>:<pairing-port> <code>   # once, from «Беспроводная отладка» → pair with code
adb connect <chromecast-ip>:<debug-port>
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081 && npm start
adb shell wm size && adb shell wm density   # dp = px * 160 / density
```

## Test account

An owner-provided Boosty account with subscriptions is available. Credentials are never stored in the repository. Content coverage against spike prerequisite P2 is checked at spike start.

## Spike report (Story 1.8, 2026-10-26)

Compiled from the Story 1.2–1.7 results below (exit criteria in `docs/android-tv-auth-playback-spike.md` §3). Every device result was obtained on the pinned **physical** Chromecast with Google TV 4K. **No emulator was used**, so there are no emulator results to label. "Owner" means the owner with the physical remote or phone; "adb" means the agent with keys injected via adb. Real Boosty API with the owner's account throughout.

Verdicts: **passed**, **failed**, **not verified** (the scenario ran but a required condition could not be produced), **not run**. «Passed after a fallback» means passed once the listed fallback was applied.

**Exit criteria gap.** The spike plan (§3) and the Story 1.8 acceptance criteria allow only *passed* or *failed with a blocker*. **S7 and S9 meet neither**: nothing failed, but the condition needed to test them (a URL older than 24 h; an accessible audio or file post) was not produced, by owner decisions of 2026-10-25. The spike is therefore **not fully complete**. Going ahead requires the owner to accept S7 and S9 as *not verified, deferred* to the stories named below; that acceptance is part of the go/no-go.

### Scenario verdicts

| Scenario | Story | Verdict | Evidence (physical device) | Not covered |
|---|---|---|---|---|
| S1 website sign-in (fallback research) | — | **Not run** | Not triggered: S2 met no captcha, so the fallback was not needed | — |
| S2 phone sign-in | 1.3 | **Passed** (owner) | Phone + code with the remote and the system keyboard → E1 200; code arrived via Telegram (`sentTransport=gate`); wrong code → 400 `invalid_sms_code`; resend too soon → 429 `sms_gate_ratelimit`; no captcha | Expired challenge, too many confirm attempts, `expiresIn` units. A longer server send limit (429 on a first send, about 2 h, Story 1.5) was observed once |
| S3 token persistence | 1.3 | **Passed** (adb, owner) | Session survives kill, cold start and reboot; ADR 0006 gate passed (file corruption → helper → reset → save + read in the same process; ciphertext corruption; transient error keeps data) | Corruption hit first by a save: unit test only |
| S4 refresh | 1.4 | **Passed** (adb) | 5 concurrent calls past expiry → exactly 1 refresh; 401 → 1 refresh → 1 retry; rotation on every refresh (single-use); rejected refresh = 400 `invalid_grant` → «expired», no loop | Real network drop during refresh (simulated only) |
| S5 entitlement and errors | 1.5 | **Passed** (adb) | Accessible vs locked post on E4, E5, E8 (`hasAccess`, `data` vs `teaser`, `playerUrls`, duration); 401 and 404 bodies; locked content is a 200 with `hasAccess=false`; E8 without or with an invalid token = anonymous 200 | 403 and 429 on content endpoints not observed; E15 returned only 204 (no live stream) |
| S6 authorized playback | 1.6 | **Passed after a fallback** (adb, owner) | First run **failed** (CDN 400 on every source with the web header profile). With E8 sent with the reference-like mobile profile: HLS → MP4 144p–1440p → DASH, position kept, TTFF 0.9–2.5 s; no Boosty auth on CDN hosts; picture, sound, Select and D-pad seek checked by the owner | Media keys (the remote has none); one decoder failure on adaptive HLS 1440p |
| S7 media URL expiry | 1.6 | **Not verified** | `expires` = 24 h after E8 (measured); probe at 15 min → 200; the E8 re-resolve by `ok_video.id` resumed at the same position after other player errors | The CDN response to a really expired URL and recovery from it (owner skipped the long pauses; needs a pause over 24 h) |
| S8 progress | 1.6 | **Passed** (adb, owner) | E9 every ~10 s of movement, on pause, exit and background; exit `t=1743` → next E8 `timeCode=1743`; the website offered the same position | — |
| S9 audio and files | 1.7 | **Not verified** | No accessible `audio_file` or `file` in the 60 newest posts of each of the 3 subscribed blogs. `Post.signedQuery` measured on 131 posts: `user_id`, `content_id`, `expire_time` (24 h), `sign` | Audio play/pause/seek/sleep, file QR on a phone, enforcement of `expire_time` by audio/file hosts |
| S10 logout | 1.4 | **Passed** (adb) | Store cleared and read back empty, also after cold start; `device_id` kept; no request after logout | Second-account isolation: not verified on the device (owner decision 2026-10-26); the production path is host-tested in Story 2.8 |
| S11 events | 1.5 | **Passed** (adb) | E18 → 200, `count{total, unread, byEventType}`, `updateTime`; EVT-01 endpoint reachable | Paging (1 event, no cursor); event types other than `target_new` |
| Library compatibility | 1.2 | **Passed with fallbacks** (adb, owner) | JS stack navigation 50/50 push/pop in debug and release-like; keychain survives reboot; react-native-video HLS/DASH/MP4; Zod 4 in Hermes release bytecode; QR scanned by a phone | — |

### Spike deliverables (plan §3)

| Deliverable | Status |
|---|---|
| Per-scenario results in this file | Done (this report and the per-story sections below) |
| `LIVE` entries in `docs/api-contract.md` | Done for §2.2, §2.3, §3, §4.1, §6, §7; open items in §8 |
| ADR: sign-in method | **No ADR.** Recorded as owner decision Q1 in `docs/feature-parity.md` §12 and in `CLAUDE.md` |
| ADR: secure storage | [ADR 0002](adr/0002-secure-storage-keychain.md), [ADR 0006](adr/0006-secure-storage-keychain-reset-helper.md) |
| ADR: video library | **No ADR.** react-native-video 6.19.x is pinned in the architecture spine (AD-2 `PlayerEngine`, version table) and passed on the device (Stories 1.2, 1.6) |
| ADR: refresh coordinator design | **No ADR.** Rules in the architecture spine AD-3 and the production requirements in `docs/api-contract.md` §2.3 |
| Sanitized fixtures | Post (accessible, locked, missing), feed, blog posts, blog, subscriptions, events, no-token errors, live stream **204 only** (`src/test/fixtures/boosty/`). **Missing:** a poll fixture (no poll seen in the scanned posts) and a live-stream 200 body (no stream at the time) |

The three missing ADRs are recorded elsewhere as decisions; the owner can accept that or ask for the ADRs before Epic 2.

### Blockers and fallbacks

**No release blocker was found.** Sign-in needs no captcha; playback, refresh and progress work on the real API.

| Finding | Fallback taken | Record |
|---|---|---|
| native-stack intermittently fails to show a pushed screen (`MissingViewState`), debug and release-like | JS stack `@react-navigation/stack`, react-native-screens not rendered, per-screen focus trap and explicit restoration | [ADR 0005](adr/0005-native-stack-debug-build-push-defect.md) (superseded), [ADR 0007](adr/0007-navigation-js-stack.md), `docs/focus-map.md` §1.3, §1.6 |
| react-native-keychain cannot recover from a corrupted storage file | Native helper deletes `RN_KEYCHAIN.preferences_pb`, then reset → signed-out; gate passed in Story 1.3 | [ADR 0006](adr/0006-secure-storage-keychain-reset-helper.md) |
| CDN URLs are signed per client family (`srcAg` from the E8 User-Agent); the web desktop profile gives HTTP 400 on the player | Content requests that yield played URLs use the reference-like mobile Android profile | **[ADR 0008](adr/0008-api-request-profiles.md)** (2026-10-26, after this report): auth profile for phone auth and refresh, content profile for everything else. At the time of the report the production header profile was undecided: auth and refresh were tested only with the web profile. To be decided with an ADR before the first production API story (Story 2.2); tracked in `_bmad-output/implementation-artifacts/deferred-work.md` (entry "Decide the production API header profile", Story 1.6) |
| The physical remote delivers D-pad only as key up to `useTVEventHandler` | Raw D-pad handlers act on key up; the press that moves focus onto the player must not seek | `docs/focus-map.md` §1.1, deferred-work (Story 1.6) |
| Zod 4 breaks the Metro release bundle without `@babel/plugin-transform-export-namespace-from` | Add the plugin with Zod on `main` | Story 1.2 results; deferred-work (Metro bundle check in CI) |

### Open risks carried into later stories

| Risk | Impact | Owner story |
|---|---|---|
| Header profile for auth and refresh vs content | A wrong profile breaks playback or sign-in | ADR before Story 2.2; used by 2.2, 2.5, 3.1 |
| Server send limit for codes (window, threshold, phone vs IP unknown) | Sign-in blocked for about 2 h after a few sends; A9 must say so without a timer | Story 2.2 (A9), observed passively only |
| Invalid token on content endpoints returns an anonymous 200, not 401 | Refresh would never fire from content calls | Story 2.5: validate the session with E1 at start and on resume |
| Real signed-URL expiry unverified | Recovery after a pause over 24 h is unproven | Story 4.4 (one re-resolve via E8); a 24 h re-test is possible on the Story 1.6 spike branch |
| Player resumed by itself after device wake; `t=0` E9 write during a source switch (fixed in the spike) | Unwanted playback; lost progress | Stories 4.2, 4.6 |
| Adaptive HLS climbed above the decoder (1440p AVC High) once | Decoder error mid-playback | Stories 4.1, 4.3 (cap to the display and decoder) |
| Media keys untested (no media keys on the remote) | Mapping may differ on other remotes | Story 4.1; unverified until such a remote is available |
| Audio and file blocks unverified (no sample) | POST-06/POST-07 rest on reference code | Stories 6.3, 6.4 re-run the scan first (one press on `spike/1-7-audio-files`; a followed free blog with public audio/files would supply a sample) |
| `Post.signedQuery` measured only with the web profile; it may depend on the profile like the video URLs | Audio and file links could fail with the chosen profile | Header-profile ADR (before Story 2.2); Stories 6.3, 6.4 |
| Live shape and parity treatment of the `video` block (seen in accessible posts, REF only in api-contract §4.1) | An unknown block type in posts | Story 6.3 (external videos via QR) |
| Second-account isolation not tested | Cross-account leakage | Story 2.8 |
| Subscriptions beyond 30, E18 paging, feed cursor format unverified | Missing items or broken paging | Stories 3.2, 7.5, 3.1 |
| JS stack keeps covered screens mounted (memory unmeasured on a 32-bit device with ~350 MB free) | Memory pressure with Shell + Post + Player | Story 9.3 |
| Focus restoration by id on a long virtualized list unverified | Focus lands on the wrong card after Back | Story 2.4 (device) |

### Recommendation

**Go for Epic 2**, on three conditions: (1) the owner accepts S7 and S9 as not verified and deferred; (2) the owner accepts the missing ADRs and fixtures listed above, or asks for them first; (3) the header-profile ADR is written before Story 2.2 starts. Every scenario that Epic 2 depends on (S2, S3, S4, S10) passed on the physical device. The not-verified scenarios (S7, S9) and the open risks belong to later epics and are tracked above and in `_bmad-output/implementation-artifacts/deferred-work.md`.

**Owner decision (2026-10-26): Go for Epic 2** on the recommended conditions: S7 and S9 are accepted as not verified and deferred to the named stories; the missing ADRs (sign-in method, video library, refresh coordinator) and the missing poll and live-200 fixtures are accepted as recorded above; the header-profile ADR is written before Story 2.2.

## Results

### Story 1.1 (2026-10-25), build host only

| Check | Result |
|---|---|
| `npm ci && npm run lint && npm run typecheck && npm test` | Pass (3 suites, 25 tests) after the review fixes |
| `npm ls react-native` | `react-native-tvos@0.87.1-1`, one copy |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL, `app-debug.apk` |
| `./gradlew assembleRelease` | BUILD SUCCESSFUL, `app-release-unsigned.apk` |
| Debug APK badging | `leanback-launchable-activity` with banner, `launchable-activity`, touchscreen/faketouch/leanback not required, `allowBackup=false`, cleartext on |
| Release APK manifest | `usesCleartextTraffic=false`, `allowBackup=false`, not debuggable. The same `aapt` check now runs in CI ("Check release manifest") |
| On-device install (physical Chromecast) | `adb install -r app-debug.apk` → Success |
| Launcher entry (physical) | `LEANBACK_LAUNCHER` activity resolved with banner (`cmd package query-activities`) |
| Launch and focus (physical) | Started via `adb shell am start` (not yet from the home-screen tile) with Metro; the button has initial focus (orange ring visible on the device screenshot) |
| D-pad input (physical device, keys injected via `adb shell input keyevent`) | DPAD_DOWN keeps focus on the only button; DPAD_CENTER presses it («Нажато: 1»). A check with the physical remote by the owner is still recommended. |
| Window size | 960×540 dp |
| Launch from the Google TV home-screen tile with the physical remote | **Pass (owner-reported 2026-10-25)** |
| Staged files (`git add -A -n`) | No keystore, `.env`, `local.properties`, APK or build output |

### Story 1.2 — library compatibility (physical device), 2026-10-25

Branch `spike/1-2-library-compat` (throwaway; the spike screens under `src/app/spike/` are not merged). Device: the pinned Chromecast with Google TV 4K, wireless adb.

**Builds**

| Build | How | Notes |
|---|---|---|
| Debug | `./gradlew assembleDebug -PreactNativeArchitectures=armeabi-v7a`, JS from Metro (`adb reverse tcp:8081 ...`) | The device ABI list is `armeabi-v7a,armeabi` only (32-bit). The default 4-ABI debug APK (~170 MB) failed with `INSTALL_FAILED_INSUFFICIENT_STORAGE` (about 350 MB free on `/data`). |
| Release-like | `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a`, then `zipalign -p 4` and `apksigner sign` with `~/.android/debug.keystore` outside the repo | Hermes bytecode bundle (v98), `__DEV__ = false`. No signing config in git. |

Added on the spike branch, exact pins: `@react-navigation/native` 7.5.1, `@react-navigation/native-stack` 7.21.0, `react-native-screens` 4.30.0, `react-native-safe-area-context` 5.10.1, `react-native-keychain` 10.0.0, `react-native-video` 6.19.3, `zod` 4.6.7, `react-native-qrcode-svg` 6.3.27, `react-native-svg` 15.16.0, and dev `@babel/plugin-transform-export-namespace-from` 7.29.7. Added later for the JS stack check (owner decision, [ADR 0007](adr/0007-navigation-js-stack.md)): `@react-navigation/stack` 7.12.1 and `react-native-gesture-handler` 3.4.0. `npm ls react-native` shows one `react-native-tvos@0.87.1-1`, deduped.

Build-time findings:
- **Zod 4 needs `@babel/plugin-transform-export-namespace-from`.** Without it, `createBundleReleaseJsAndAssets` fails on `zod/v4/classic/external.js` (`export * as core from ...`). Jest does not see this because it resolves Zod's CommonJS build. The plugin goes into `babel.config.js` together with Zod on `main`.
- **react-native-screens install step.** `MainActivity.onCreate` sets `RNScreensFragmentFactory` (README, "Android"). It did not change the debug defect below. It is **not** carried to production: ADR 0007 renders no react-native-screens views.

**Results.** "Keys injected via adb" means `adb shell input keyevent` (DPAD_*, BACK); outcomes were read from `adb exec-out screencap`, `uiautomator dump` and `adb logcat -s ReactNativeJS`. No physical remote, phone or owner check is included unless stated.

| Library / check | Build | Result | How observed |
|---|---|---|---|
| Spike menu: launch, initial focus on the first entry, D-pad between entries, Back returns to the menu | debug, release-like | Pass | Device screen; keys injected via adb |
| native-stack: A has 3 items, focus shown on screen | debug, release-like | Pass | Device screen, logcat |
| native-stack: OK on item 2 pushes B | release-like | **Pass** — B is shown with its button focused; 5 push/pop cycles in a row, no Fabric errors | Device screen, logcat; keys injected via adb |
| native-stack: OK on item 2 pushes B | debug | **Fail** — the JS stack becomes `A > B` and B's button gets `onFocus`, but B is never shown (zero-height in the accessibility tree); logcat `SurfaceMountingManager:MissingViewState ... Unable to find viewState for tag ... for addViewAt / updateProps / updateLayout`. Also with `animation: 'none'`, without `hasTVPreferredFocus`, with the fragment factory, and with JS dev mode off. Once, after a Fast Refresh, Back crashed in `ScreenContainer.getScreenAt` (`IndexOutOfBoundsException`). See [ADR 0005](adr/0005-native-stack-debug-build-push-defect.md) (superseded by [ADR 0007](adr/0007-navigation-js-stack.md)) | Device screen, uiautomator, logcat |
| native-stack: Back pops B, focus returns to item 2 | release-like | **Pass** — `onFocus` for item 2 fires after the pop, the accessibility tree shows item 2 focused, DPAD_DOWN then moves to item 3 | logcat, uiautomator; keys injected via adb |
| native-stack: Back on A (stack root) leaves the check | release-like | Pass | Device screen |
| native-stack with the physical remote (focus, Back, focus return) | release-like | **Intermittent fail (owner-reported 2026-10-25):** before the reboot, OK on item 2 froze screen A (no response); several Back presses returned to the menu. After the device reboot, push to B and Back worked | Owner, physical remote |
| native-stack: OK on item 2 pushes B, re-run after reboot | release-like | **Fail (reproduced 2026-10-25, 16:11):** after a cold start, OK on item 2 left screen A visible (uiautomator still shows A, focus on item 2); logcat `SurfaceMountingManager:MissingViewState`; JS logged `[spike:nav] B button focused`. The same defect as the debug build, so it is **not** debug-only | uiautomator, logcat; keys injected via adb |
| JS stack (`@react-navigation/stack` 7.12.1 + `react-native-gesture-handler` 3.4.0): react-native-screens bypass | debug, release-like | `detachInactiveScreens={false}` on the navigator was enough (the stack then renders plain Views instead of `RNSScreenContainer`/`RNSScreen`); a global `enableScreens(false)` was not needed and was not used, so the native-stack screen stayed unchanged for comparison. RNGH 3.4.0 chosen because its `compatibility.json` lists 3.4.x for RN 0.85–0.88 | Code path (`@react-navigation/stack` `Screens.tsx`, `react-native-screens` `ScreenContainer`), device runs below |
| JS stack: D-pad on B must not reach A (A stays mounted under B) | release-like | **Fail without a trap:** DPAD_UP/DOWN on B moved focus to A's items 2 and 3 (logged `A item N focused` while B was on top). **Pass with** each screen wrapped in `TVFocusGuideView` with `trapFocusUp/Down/Left/Right`: 0 escape events for DOWN, DOWN, UP, UP, LEFT, RIGHT | logcat; keys injected via adb |
| JS stack: D-pad on B must not reach A, with the trap | debug | Pass — 0 escape events | logcat; keys injected via adb |
| JS stack: focus return after Back | release-like | Without restoration, Android moved focus to A's item 1 after the pop. **Pass with explicit restoration** (remember the last focused item on blur, give it `hasTVPreferredFocus` on focus): item 2 focused directly, no intermediate item-1 focus | logcat; keys injected via adb |
| JS stack: stress, push/pop with uiautomator verification after every OK (B title present and B's button focused) and every Back (B gone, A shown, item 2 focused) | release-like | **Pass 50/50:** cold start + 20 cycles, then 3 × (force-stop + cold start + 10 cycles). Logcat captured continuously per round: 0 `MissingViewState`, 0 `ReactNoCrashSoftException`, 0 fatal exceptions; 50 pushes and 50 restores logged | uiautomator, logcat; keys injected via adb |
| JS stack: the same stress run | debug (Metro) | **Pass 50/50**, same layout (20 + 3 × 10, cold starts), 0 errors in logcat | uiautomator, logcat; keys injected via adb |
| JS stack: Back on A (stack root) leaves the check; menu shown | debug, release-like | Pass | uiautomator; keys injected via adb |
| JS stack with the physical remote (focus, Back, focus return, no focus escape from B) | release-like | **Pass (owner-reported 2026-10-25)** | Owner, physical remote |
| native-stack comparison re-run with the same stress script (16:3x, after the JS stack runs, cold start) | release-like | 10/10 passed in this run, no `MissingViewState`. Together with the owner's freeze and the 16:11 reproduction, the native-stack defect is **intermittent** in release-like builds | uiautomator, logcat; keys injected via adb |
| keychain: value survives a device reboot | release-like | **Pass** — after `adb reboot` and a cold start, the Keychain screen read `marker-1792932061953` | Device (uiautomator), logcat |
| keychain: save → read | debug | Pass (`storage=KeystoreAESGCM_NoAuth`) | Device screen, logcat |
| keychain: `getSecurityLevel()` | debug, release-like | `SECURE_SOFTWARE` (recorded) | logcat |
| keychain: value survives force-stop + cold start | debug | Pass | logcat (read on screen mount) |
| keychain: value survives reinstall debug → release-like (same SDK debug key) | release-like | Pass | logcat |
| keychain: forced error path (in-app «Симулировать порчу») → wipe → «signed-out» | debug | Pass, no crash, no unhandled rejection; next read `empty` | Device screen, logcat |
| keychain: ciphertext corruption (one byte of the stored value changed in `files/datastore/RN_KEYCHAIN.preferences_pb` via `run-as`) | debug | Pass — `CryptoFailedException: Decryption failed: Authentication tag verification failed`, wipe succeeded, «signed-out», next read `empty` | logcat |
| keychain: storage-file corruption (the same file overwritten with random bytes) | debug | **Fail** — read, save and reset all reject with `androidx.datastore.core.CorruptionException: Unable to parse preferences proto`; the adapter shows «signed-out» without crashing, but the store cannot be wiped and nothing can be saved until app data is cleared (recovered here by deleting the file via `run-as`). See [ADR 0006](adr/0006-secure-storage-keychain-reset-helper.md) | Device screen, logcat |
| video: HLS (`test-streams.mux.dev` x36xhzz) | debug, release-like | Pass — `load` (duration 634.6 s, 512×288 initial, 5 video tracks), `readyForDisplay` after ~2.4 s, position advances | logcat, on-screen event log |
| video: DASH (`dash.akamaized.net` bbb_30fps) | debug, release-like | Pass — `load` (3840×2160, 10 video tracks), `readyForDisplay` after ~1 s | logcat, on-screen event log |
| video: MP4 (`media.w3.org` Sintel trailer) | debug | Pass — `load` (52.2 s, 854×480), `readyForDisplay` after ~1.5 s | logcat, on-screen event log |
| video: seek +10 s / −10 s (HLS, DASH, MP4) | debug | Pass — `onSeek` reports the requested position each time, playback resumes | logcat |
| video: rate 1.5× (HLS, DASH, MP4) | debug | Pass (event-level) — `onPlaybackRateChange 1.5`; HLS position advanced ~27 s in ~16 s of wall time (≈1.7×; rough, includes dump latency; the actual rate is not precisely measured). Seek and rate are not re-checked in the release-like build | logcat, uiautomator |
| video: invalid URL (`example.invalid`) → error event | debug, release-like | Pass — `onError` code 22001 `ERROR_CODE_IO_NETWORK_CONNECTION_FAILED`, no crash | logcat |
| video: picture visible on the TV | release-like | **Pass (owner-reported 2026-10-25):** the picture was visible. `screencap` does not capture the video surface on this device (the player area is black in screenshots); `readyForDisplay` and advancing position are the only agent-side evidence | — |
| Zod 4 matrix (valid / unknown extra field stripped / missing required field → failure at `title`), default and per-parse `jitless` | debug (Hermes) | Pass 6/6 | Device screen, logcat |
| Zod 4 matrix, default and `jitless` | **release-like (Hermes bytecode)** | **Pass 6/6.** `new Function` works (`allowsEval` true), so Zod's JIT fast path runs; **jitless mode is not needed** | Device screen, logcat |
| ru plural selector: 0, 1, 2, 5, 11, 21, 22, 25, 111 «лайк/лайка/лайков»; −1 and 1.5 throw `RangeError` | debug, release-like | Pass 11/11 | Device screen, logcat; also Jest |
| QR: 306-character URL, `ecl="M"`, 300 dp, white quiet zone | debug, release-like | Pass — renders, no `onError`. Offline by construction (pure JS encoder + react-native-svg, no network call) | Device screenshot |
| QR scans on a phone | release-like | **Pass (owner-reported 2026-10-25)** | — |

Host checks on the spike branch: `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (5 suites, 47 tests) pass; `./gradlew assembleDebug assembleRelease` BUILD SUCCESSFUL.

Per-scenario results for `docs/android-tv-auth-playback-spike.md` go here. Physical-device and emulator results are labeled separately.

### Story 1.3 — phone sign-in and token persistence (physical device), 2026-10-25

**Review follow-ups (2026-10-25):**
- Before the fix, logcat lines contained the country code and the last 4 digits of the owner's phone (from the masked hint). The device log buffer was cleared (`adb logcat -c`) and local copies were deleted. The fixed build was not reinstalled on the device, so there is no post-fix device rescan; the fix is covered by a unit test.
- The logcat token scan was re-run with a wider pattern (`[A-Za-z0-9._~+/=-]{60,}`) on the app's log lines. The only matches were file paths and package names; no tokens. Future scans should also look for partial phone numbers (country code plus trailing digits).
- `spikeSecureStore.clear()` (session clear / logout path) is unit-tested only and was not exercised on the device. Handed to Story 1.4.

Branch `spike/1-3-phone-auth` (throwaway). Device: the pinned Chromecast with Google TV 4K, wireless adb. Spike screen «Вход по телефону» (`src/app/spike/PhoneAuthCheck.tsx`), first entry of the spike menu. Tokens go through the spike SecureStore wrapper (`spikeSecureStore.ts`: react-native-keychain 10.0.0 + ADR 0006 classification + native `KeychainStorageReset.deleteKeychainStorage()`). The install-scoped `device_id` is a UUIDv4 kept in a non-secret SharedPreferences file by the native `InstallId` module.

**Builds:** `./gradlew assembleDebug assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL. Release-like = `zipalign -p 4` + `apksigner` with the SDK debug key, outside the repo. The storage matrix ran on the **debug** build, because `run-as` (needed to corrupt the file) only works on a debuggable package. The release-like build was then installed over it (same key, data kept) for the owner's sign-in.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (8 suites, 106 tests) pass. Unit tests cover the store classification and the helper path (mocked), request building (form encoding, headers, E.164), the sanitizers (no values leak), masking, and a flow test of the screen with mocked `fetch` (send → code → confirm → E1 → save; E1 failure saves nothing; wrong code; captcha stop; resend with `transport=gate`).

"Keys injected via adb" means `adb shell input keyevent`; outcomes were read from `adb logcat -s ReactNativeJS`, `uiautomator dump` and screenshots. No owner or physical-remote check is included unless stated. No Boosty API request was made by the agent.

| Check | Build | Result | How observed |
|---|---|---|---|
| Menu → «Вход по телефону»; initial focus on «Получить код»; UP reaches the phone field; DOWN walks every control to «Назад в меню»; RIGHT reaches the log ScrollView, LEFT returns; Back returns to the menu | debug, release-like | Pass | uiautomator focus dump; keys injected via adb |
| OK on the phone field opens the system keyboard (numeric panel); Back closes the keyboard first and keeps focus on the field | debug, release-like | Pass | Screenshot, `dumpsys input_method` (`mInputShown=true`); keys injected via adb |
| Phone field is a password field; the screen shows only the masked hint (fake number typed via `adb shell input text` → `+375 •• ••• 00 00`) | release-like | Pass. With `keyboardType="phone-pad"` the field ignored `secureTextEntry` and showed the digits in clear (found and fixed: now `number-pad` + `secureTextEntry` = Android numberPassword). Android still shows the last typed digit for about a second (system password behavior) | Screenshot, uiautomator (`password="true"`, text shown as bullets) |
| Code-phase screen (code field, «Войти», «Отправить код повторно», «Сменить номер») | release-like | Not reached by the agent (it needs a real send). Used by the owner in the session below | Owner, physical remote; Jest |
| Storage: save → read (dummy value, separate service) | debug | Pass (`KeystoreAESGCM_NoAuth`) | logcat |
| Storage: value survives force-stop + cold start | debug, release-like | Pass (also across the debug → release-like reinstall) | logcat (read on screen mount) |
| Storage: transient error (in-app «Тест: временная ошибка», a forced generic error) → «recoverable storage error», data kept, `retriesLeft=1`; «Повторить чтение» → value returned; not signed out | debug | Pass | logcat, uiautomator |
| Storage: ciphertext corruption (one base64 character of the stored value changed in `RN_KEYCHAIN.preferences_pb` via `run-as`, app stopped) → cold start | debug | Pass — `E_CRYPTO_FAILED CryptoFailedException` → classified `value-undecryptable` → reset (helper not called) → signed-out; then save + read in the same process work | logcat |
| Storage: file corruption (the file overwritten with 618 random bytes via `run-as`, app stopped) → cold start | debug | **Pass (ADR 0006 gate, same process)** — read rejects with `E_UNKNOWN_ERROR` + `androidx.datastore.core.CorruptionException: Unable to parse preferences proto` → classified `storage-unreadable` → helper deleted the file (`fileDeleted=true`) → reset OK → signed-out; the other service then read `empty` without error; save + read of a new value succeeded **in the same process** (same pid); the value also survived a later force-stop + cold start | logcat, `run-as ls files/datastore`, `pidof` |
| Storage: corruption hit first by a **save** | — | Not run on the device (the screen always reads first). Unit-tested only | Jest |
| `device_id`: generated once, unchanged across cold starts, reinstall and both corruption runs (helper deletes only the keychain file) | debug, release-like | Pass (only the last 4 characters are logged) | logcat |
| logcat during the agent's runs: no fake phone digits typed in the test, no `eyJ` | release-like | Pass (only fake values existed; see the owner-session scan below) | `adb logcat -d \| grep` |

**Owner session — release-like build, physical device, 2026-10-25 (S2/S3).** The owner typed the phone and the codes with the physical remote and the system keyboard. Statuses and shapes come from the spike's sanitized log. The response shapes are recorded in `docs/api-contract.md` §2.2 "Live evidence".

| Scenario | Steps | Result |
|---|---|---|
| S2 sign-in | Phone + code with the remote and the system keyboard → «Сессия сохранена» (E1 HTTP 200, `storage=KeystoreAESGCM_NoAuth`) | **Pass (owner, physical remote)** |
| S2 code delivery | Where the code arrived; `sentTransport`; `expiresIn` | Telegram (owner-reported); `sentTransport=gate` even on the first send; `expiresIn=604800` (units unverified: about 10 min in ms or 7 days in s) |
| S2 resend | «Отправить код повторно» 32 s after the send | HTTP 200, a new challenge issued |
| S2 resend too soon | Resend 2 s and 5 s after the previous resend (pressed three times in total, not once) | HTTP 429 `sms_gate_ratelimit` (both) |
| S2 wrong code (once) | Wrong code → «Войти» | HTTP 400 `invalid_sms_code`; the code field cleared for retyping |
| S2 correct code | Latest challenge, 31 s after the resend | HTTP 200, tokens (64-character opaque, not JWT), `expires_in=2592000` |
| S2 expired code | Wait past `expiresIn`, then enter the real code | **Not verified** (the code was entered within the window) |
| S2 too many attempts | — | Not triggered (owner decision 2026-10-25); shape unverified |
| S2 captcha | — | Not observed |
| S3 kill / cold start | Force-stop, start, «Проверить сессию» | **Pass** — session present, «Сессия действительна (E1 HTTP 200)» |
| S3 reboot | `adb reboot` (uptime 1 min afterwards; adb reconnected automatically via mDNS, no new port), cold start, «Проверить сессию» | **Pass** — session present, E1 HTTP 200, `device_id` unchanged |
| ADR 0006 matrix: reboot | Covered by the S3 reboot row | **Pass** — the gate is fully passed |
| logcat secret scan | Full `adb logcat -d` after sign-in and again after the reboot, searched locally (matches never recorded): full phone-number patterns (country code + 9 digits), alphanumeric runs of 60+ characters (the tokens are 64-character opaque strings, so the earlier `eyJ` JWT check means nothing here), `Bearer ` | **Pass** — 0 matches for each pattern |

Finding after the session: the debug log line for a successful send contained the masked phone hint (country code and the last 4 digits). Fixed: the masked hint stays on screen only; the log line says "phone hint shown" and carries no phone digits (covered by `PhoneAuthCheck.test.tsx`). The logcat scan above looked for full numbers, so it did not catch this partial-digit line.

### Story 1.4 — refresh and logout (physical device), 2026-10-25

Branch `spike/1-4-refresh-logout` (throwaway, on top of the Story 1.3 spike). Spike screen «Сессия: обновление и выход» (`src/app/spike/SessionRefreshCheck.tsx`), first entry of the spike menu, driving the spike refresh coordinator (`src/app/spike/refreshCoordinator.ts`: single-flight shared promise, proactive refresh below 300 s, one refresh + one retry on 401, «expired» only when the refresh endpoint rejects, tokens kept on transport/5xx/429 errors). The screen enforces the owner-decided order and runs each scenario once; «Выйти» needs a second press. "Corruption" only alters this app's stored copy of its own session; the last valid session is kept in memory and restored after the checks that need it.

**Builds:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL; release-like = `zipalign -p 4` + `apksigner` with the SDK debug key, outside the repo. Installed with `adb install -r` over the Story 1.3 release-like build (same key; the stored session was kept and read back before any scenario).

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (10 suites, 125 tests) pass. New unit tests: `refreshCoordinator.test.ts` (request form and headers, single-flight with 5 concurrent proactive calls, no refresh above 300 s, 401 → one refresh → one retry, concurrent 401s share one refresh, no second refresh after a failed retry, rejected refresh → «expired» with no further request, reload after rejection, transport failure keeps tokens, simulated failure sends nothing, 5xx/429 keep tokens, response without `refresh_token`, signed-out sends nothing, sign-out clears memory, no token or `Bearer ` in log lines) and `SessionRefreshCheck.test.tsx` (the whole matrix in order against a rotating fake server, order and once-only guards, two-press logout, no secret in console or rendered text).

All device rows: release-like build, keys injected via adb (`adb shell input keyevent`), outcomes read from `uiautomator dump` and `adb logcat -s ReactNativeJS`; the real Boosty API with the owner's session (owner-approved); no owner or physical-remote check. Shapes are recorded in `docs/api-contract.md` §2.3 "Live evidence (Story 1.4)".

| Scenario | Steps | Result |
|---|---|---|
| Pre-check | Cold start → screen mount reads the store (no request) → «Проверить сессию (E1)» | Stored session present (`expiresAt` about 30 days ahead), E1 HTTP 200, 0 refresh requests |
| S4 proactive (single-flight) | Stored `expiresAt` forced 60 s into the past → 5 concurrent E1 | **Pass** — exactly 1 `POST /oauth/token/` (HTTP 200, rotated), 5 E1 requests, 5 × HTTP 200 |
| S4 reactive | Stored access token corrupted → E1 | **Pass** — E1 401 (`unauthorized`) → 1 refresh (200) → 1 retry → 200. No second refresh |
| S4 rotation | Refresh with the current token, then one refresh with the previous (rotated-out) token, then E1 | Rotated = **yes** (also on every other successful refresh). Previous token → HTTP 400 `invalid_grant` (single-use). E1 afterwards 200 |
| S4 network loss | Stored expiry forced into the past; the coordinator fails the refresh at the transport level (simulated, nothing sent) → E1 | **Pass (simulated only; a real network drop and a lost response after the server processed the refresh were not tested)** — result `network` at the refresh stage (`TypeError`), status stays signed-in, the stored tokens unchanged, E1 not sent. The real expiry was restored afterwards |
| S4 rejected refresh | Stored access and refresh tokens corrupted → E1, then a second E1 | **Pass** — E1 401 → exactly 1 refresh → HTTP 400 `invalid_grant` → «expired»; the second call returned «expired» with no new request (no loop, no storm). Restore from memory → E1 200 |
| S4 `device_id` dependency | One refresh with a random different `device_id` (form and `X-From-Id`) and the current refresh token, then E1 | Refresh → HTTP 400 `invalid_grant`; E1 with the current access token → 200. **Ambiguous** (see api-contract §2.3): it may be a `device_id` binding or a revocation caused by the earlier reuse of a rotated-out token. Whether the current refresh token still worked afterwards was not checked |
| S10 logout | «Выйти» (two presses) → read the store back → read the native `device_id` again (bypassing the JS cache) → one API call | **Pass** — store cleared, read back `empty`, in-memory session none, `device_id` unchanged, the call after logout returned signed-out with 0 requests. After force-stop + cold start the store still read `empty` and `device_id` was unchanged. No server call (none is verified, §2.4) |
| S10 second account | — | Not run (no second account available in this session) |
| logcat secret scan | Full `adb logcat -d` after the run, searched locally, then `adb logcat -c` and the copy deleted: 60+ character runs `[A-Za-z0-9._~+/=-]{60,}` on app lines, phone-like digit runs (9+ digits) on app lines, `Bearer ` | **Pass** — `Bearer ` 0; phone-like 0; one 60+ run, which was the app's install path (`library_path=/data/app/~~…`), not a token |

Request totals for the run: 7 refresh attempts (6 sent to the server, 1 simulated), 12 E1 requests.

Notes:
- `spikeSecureStore.clear()` (handed over from Story 1.3) is now exercised on the device by the logout row.
- The account is **signed out** on the device after this story (planned). The owner signs in again with the Story 1.3 screen before Story 1.5.
- After the run, two log-only fixes were made and the build was reinstalled (no scenario re-run): E1 log lines now carry their own request number (concurrent calls all printed the final count), and the refresh log says "attempt" instead of "request sent", because the simulated failure sends nothing.
- Log hygiene: the spike logs the last 4 characters of `device_id` (an install identifier, not account data). Production logging must not include it. The Story 1.4 logcat scan looked for 60+ character token runs, `Bearer `, and full and partial phone numbers (country code plus trailing digits); nothing matched.
- (Closed in Story 1.5 as not needed for production, owner decision 2026-10-25; see api-contract §2.3.) Open for production: whether a `device_id` mismatch alone rejects a refresh (needs one refresh with a different `device_id` on a session with no prior token reuse, followed by one with the real `device_id`); the real access and refresh token lifetimes.

### Story 1.5 — entitlement, errors and events shapes, 2026-10-25

**Blocked on sign-in (2026-10-25):** the owner's new sign-in got HTTP 429 `sms_gate_ratelimit` on every first send (18:34, 18:35, 18:42, 18:52). The boosty.to website got the same error, so the limit is server-side (`docs/api-contract.md` §2.2 «Rate limit, longer window»). The spike sign-in screen now shows the 429 details on screen: rate-limit header values, all header names without values, and the `error_description` text when it is safe. The server sent no wait hint. The limit lifted the same evening: 429 again at 19:36, then 200 at 19:45, and the owner signed in (E1 200, session saved).

Branch `spike/1-5-entitlement-errors-events` (throwaway, Story 1.4 spike + `main`). Spike screen «Контент: доступ, ошибки, события» (`src/app/spike/ContentShapesCheck.tsx`, first menu entry) runs the fixed read-only request set from `src/app/spike/contentShapesApi.ts` once: E1 → E2 → E4 (at most 5 subscribed blogs, until an accessible and a locked post are found) → E5 → E3 → E8 accessible/locked (`comments_limit=0&reply_limit=0`) → E15 per chosen blog → E1/E8 without `Authorization` → E8 random post id / E3 random slug → E18 (+ one page only if the response offers `extra.offset`). Budget: at most 30 requests including refreshes. Sanitized fixtures go to the app's external files directory (`SpikeFiles` native module) for `adb pull`.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (13 suites, 169 tests after the review fixes), `npm run check:fixtures` pass. New tests: `contentShapesApi.test.ts` (request paths, picking, analysis lines without values, sanitizer: no input string survives except allowlisted enums, runner order, 5-blog cap, budget stop, no page 2 without a cursor), `ContentShapesCheck.test.tsx` (one run, request count, fixtures written, second run refused, no token/title/URL in console, screen or files) and `__tests__/checkFixtures.test.js` (the real CLI passes clean fixtures, the repository fixtures and, on the spike branch only, spike sanitizer output; fails on a planted token, `Bearer`, signed URL, query string, phone string and number, email, free-form string, unsafe key, real text content, real timestamp, count, price, exact duration and id number). The number rules (synthetic times in whole hours with order kept, counts and money as 0 or 5, durations in whole minutes, sizes rounded to 100 KiB, ids synthetic) are enforced by both the sanitizer and the check script. They were tightened after the first device run: verbatim publish times, view, like and subscriber counts, prices and exact durations could identify the owner's subscriptions in combination (owner decision: tighten and re-run).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL; release-like (`zipalign` + `apksigner`, SDK debug key outside the repo) installed on the pinned device. The screen opens and reads the store without a request: **signed-out** (expected after the Story 1.4 logout).

**Device run** (2026-10-25, owner signed in by phone; the run was started by the agent via adb keys; release-like build). One run of 15 requests out of the 30 budget, no refresh needed. It was repeated once after the number sanitizing was tightened, with identical results. 14 fixtures were pulled to `src/test/fixtures/boosty/`, `npm run check:fixtures` passed, and the files were deleted on the device.

| Row | Result |
|---|---|
| S5 accessible post | **Pass.** Found in E4 (blog #1), E5 (first page) and E8: `hasAccess=true`, `data` has 112 blocks (`ok_video`×1, `text`×90, `link`×21), `teaser` one image, `signedQuery` non-empty. `ok_video`: 19 `playerUrls`, 9 non-empty (`tiny`…`quad_hd`, `hls`, `dash`), `duration` and `timeCode` present in E4, E5 and E8 |
| S5 locked post | **Pass.** Found in E4 (blog #2), not on the first E5 page. E4 and E8: HTTP 200, `hasAccess=false`, `data` empty, `teaser` one image, `signedQuery` empty; no video, no `playerUrls` |
| S5 live stream | E15 → **204** for both blogs (no stream at the time) |
| Errors: no token | E1 → **401** `unauthorized`. E8 (accessible post) → **200** as an anonymous viewer (`hasAccess=false`, empty `data`), **not 401** |
| Errors: missing | E8 random post id → **404** `not_found`; E3 random slug → **404** `blog_not_found` |
| Errors: 403 / 429 | Not observed (locked content is a 200; no 429 on content endpoints; none triggered on purpose) |
| S11 events | E18 → **200**: 1 event (`target_new`), `count{total, unread, byEventType[17 types]}`, `updateTime`; no cursor, so no page 2. EVT-01 verified as reachable; paging unverified |
| Unknown blocks | `list` (nested `items[]{data[], items[]}`) seen and kept in the fixtures |
| Review fixes (after the device runs) | `total`/`unread` counts were made 0 or 5 like other counts (3 values changed in `e2-subscriptions.json` and `e18-events.json`, by applying the same rule to the committed files; the rule needs only the sanitized value). Time values of 0 are now kept as an "unset" sentinel; the committed fixtures were sanitized before this rule, so a 0 time may appear there as the earliest synthetic time. `check:fixtures` now runs in CI and as a jest test on the repository fixtures |
| Log hygiene | logcat scan of the app lines after each run: no `Bearer`, no 60+ character runs, no 9+ digit runs, no `sig=`, no URL with a query; only key paths, types and lengths. Buffer cleared after each run |

`device_id` / refresh-token reuse re-test: closed as not needed for production (owner decision 2026-10-25; no requests), see api-contract §2.3.


### Story 1.6 — authorized playback, expiry and progress round-trip, 2026-10-25

**Status: device run done (2026-10-25), except the long pauses (skipped by the owner, see below).** The owner picked the video with the physical remote and checked the picture, the remote and the website position; everything else was driven by the agent via adb on the release-like build.

Branch `spike/1-6-playback` (throwaway, Story 1.5 spike + `main`). Spike screen «Плеер: доступ, истечение, прогресс» (`src/app/spike/PlaybackCheck.tsx`, first menu entry), helpers in `src/app/spike/playbackApi.ts`:
- «Найти видео (E2, E4)»: E2, then E4 for at most 5 subscribed blogs, listing at most 5 accessible `ok_video` blocks. The post title is shown on screen only (the `ok_video` block title is a generic "Video" in live data).
- «Профиль E8» (last button): `reference` (default after the CDN finding below) sends E8 like the reference client (mobile Android Chrome User-Agent, no `X-App`/`Referer`/`Origin`); `web` sends the spike's web-style set.
- Picking a video sends a fresh E8 (`comments_limit=0&reply_limit=0`) and starts HLS at the E8 `timeCode`. One button per mapped source (HLS, each MP4 quality, DASH; api-contract §6, empty URLs skipped). A switch keeps the position (seek after `onLoad`). TTFF = source set → `onReadyForDisplay`, in ms.
- The player area is focusable (`TVFocusGuideView` traps left/right): D-pad left/right seeks ±10 s, Select toggles play/pause. Left/right act on key **up** (the device delivers only key up for them, see results); presses during an in-flight seek build on its target. Media keys (`play`, `pause`, `playPause`, `rewind`, `fastForward`, `stop`, `next`, `previous`) are logged from `useTVEventHandler` and act on key down. «В середину» seeks to half the duration.
- «Проба URL»: GETs to the current (or, after a stop, the first) media URL with `Range: bytes=0-0` and five header variants (none, desktop Chrome UA, `Referer`, UA + `Referer`, UA + `Referer` + `Origin`), no credentials. It records the status, the content type and, for a non-2xx, a redacted start of the body; a 2xx is aborted as soon as the status arrives (XMLHttpRequest, so a server that ignores `Range` cannot turn it into a download). Every source set also logs the URL shape (`describeUrlShape`: path segment lengths, query keys with a value class; values only for the allowlisted keys `cmd` and `srcAg`) and the seconds until `expires`.
- A new source's positions count only once the player reached the start position: the `t=0` it reports before the seek-after-load is neither written to E9 nor kept as the switch position.
- Recovery: on a player error, one automatic E8 re-fetch, the block with the same `ok_video.id` and the same `playerUrls` type, resumed at the last position. A second error before playback has advanced 5 s past the resume point stops and shows the error. After that the single recovery is re-armed, so the 30 min and ≥2 h pauses can each be recovered once.
- E9 (`PUT /v1/viewstat/video/{id}/timecode/`, form `time_code`, integer seconds) only for the picked video. A progress write happens when the position has moved ≥10 s since the last successful write. A failed write also moves the attempt mark, so a failure is not re-sent on every tick. Event writes: pause, exit (Back/unmount) and `AppState` background; they are skipped only when the second equals the last successful write. Non-2xx statuses are logged, never retried.
- «E8 с поддельным токеном»: one E8 sent directly (no coordinator, no refresh) with a synthetic random 64-character Bearer.
- Budget: at most 150 API requests per app run (refreshes and the direct E8 included), shown on screen as `API: n/150`. Nothing is sent past the cap. Probes are counted separately.
- Logs: every line and the on-screen error text go through `redactForLog` (URLs with or without a scheme, query strings, `Bearer` values, 40+ character opaque runs). No titles, ids, tokens or URL ages in logs; the URL age is on screen only.
- Native: `MainApplication` installs an `OkHttpClientFactory` (default builder with `ReactCookieJarContainer`, no HTTP disk cache) with `SpikeNetInterceptor`. The same client serves JS `fetch` and react-native-video (`DataSourceUtil` uses `OkHttpClientProvider.getOkHttpClient()`). The interceptor logs `net host=<host> auth=<bool> cookie=<bool> status=<code>` under the tag `SpikeNet`. It also logs the protocol, the sorted request header **names** and, for media URLs, flags comparing the connected IP with the `urls`/`srcIp` query values. It never logs paths, queries, header values or addresses.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (15 suites, 184 tests after the device-run and review fixes), `npm run check:fixtures` pass. New tests: `playbackApi.test.ts` (E9 and corrupted-Bearer builders, the §6 mapping on a live-like 19-entry `playerUrls`, candidates, same-media lookup, the ≥10 s rule with in-flight and failure cases, redaction of signed URLs, queries, `Bearer` and opaque runs) and `PlaybackCheck.test.tsx` (find → pick → HLS at `timeCode`, cadence writes, pause write, quality switch keeps the position, one recovery with the same id and type, stop on the second failure, re-arm after recovered playback, exit write, the 150 budget, the direct corrupted-Bearer E8 without refresh, no URL, query, token, title or id in console output, no E9 write of the pre-seek `t=0` after a switch). `describeUrlShape` is tested not to reveal a signature, a letters-only value under a non-allowlisted key, an IP or a host.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL. Release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo) installed with `adb install -r`, keeping the data. The stored session from Story 1.5 was kept across all reinstalls (no sign-in needed). Several diagnostic rebuilds followed during the run (listed in the results).

| Row | Result | Who |
|---|---|---|
| S6 first attempt (E8 with the web-style headers) | **Fail.** Every source (HLS, each MP4, DASH), also a fresh URL right after E8, got **HTTP 400** from `vd*.okcdn.ru` with body `8`; ExoPlayer `ERROR_CODE_IO_BAD_HTTP_STATUS` (22004). Probes with every header variant also 400/`8`. `srcIp` equals the device's egress IP (checked once from a diagnostic build: one in-app GET to api.ipify.org, a third-party request outside the spec's allowed set, logging only the address family and a match flag; the code was removed in the next build). Not the cause: User-Agent, `Referer`/`Origin`, IP, expiry | agent via adb (owner saw the error) |
| S6 cause | The signed URL carries `srcAg` = the client family from the E8 request's User-Agent: `CHROME_MAC` for the spike's desktop Chrome UA. With E8 sent like the reference (mobile Android Chrome UA, no `X-App`/`Referer`/`Origin`), `srcAg=CHROME_ANDROID` and the same player gets **200**. A probe on a `CHROME_ANDROID` URL: default UA and `Referer` only → 200 `application/x-mpegURL`; desktop Chrome UA → **400 body `10`**. The reference itself (BoostBuddy, installed on the same TV) plays the same video (owner) | agent via adb, owner |
| S6 play + switch (reference profile) | **Pass.** HLS → MP4 144p, 240p, 360p, 480p, 720p, 1080p, 1440p → DASH, each starting at the kept position (seek after load, `seek done` at the target). TTFF: HLS 0.9–2.5 s, MP4 1.0–1.3 s (360p once 6.9 s), DASH 1.0–1.6 s. MP4 1440p and DASH (1080p chosen) played 30 s each mid-video without errors | agent via adb |
| S6 no Boosty auth on CDN | **Pass.** `SpikeNet`: every `*.okcdn.ru` request `auth=false`; request headers only `Accept-Encoding, Connection, Host, User-Agent` (+`Cookie` after the first response: the CDN sets its own cookie and the shared cookie jar returns it to the same host; no Boosty cookie). `api.boosty.to` requests `auth=true` | agent via adb |
| S6 picture and sound | **Pass** (owner) | owner |
| S6 Select | **Pass**: play/pause (owner, physical remote) | owner, physical remote |
| S6 D-pad seek | First **fail**: `useTVEventHandler` receives only key **up** (`eventKeyAction=1`) for left/right from the physical remote; key down never reaches JS, so the key-down handler never seeked. Fixed (act on key up). Then **partial**: repeated presses during an in-flight seek (1–3 s on HLS) were computed from the stale position, so the picture "jumped in place". Fixed (presses build on the pending target). Then **pass** (owner). Remaining defect: moving focus onto the player with an arrow fires a seek, because that arrow's key up lands on the player | owner, physical remote |
| S6 media keys | The Chromecast with Google TV remote has **no media keys** (owner). Not tested | owner |
| S6 decoder | Once: adaptive HLS climbed to 2560×1440 (AVC High, `avc1.640032`, 8 Mbit/s) and the decoder failed (`ERROR_CODE_DECODING_FAILED`, 24003) right after a seek. The single automatic E8 re-resolve resumed at the same position. Not reproduced: MP4 1440p played 30 s without error | agent via adb (owner saw the error) |
| S7 URL lifetime | `expires` (epoch ms) is **86 400 s (24 h)** after the E8 response on every fetch. A probe at URL age 15 min → 200 | agent via adb |
| S7 pause 30 min / ≥2 h | **Skipped** (owner decision 2026-10-25): with a 24 h `expires`, neither pause reaches expiry. The CDN status after expiry and the recovery from a real expiry stay **unverified**; a re-test needs a pause over 24 h. The re-resolve mechanism itself (E8 → same `ok_video.id` and type → resume at the position) worked after the decoder error and the 400s | — |
| S8 E9 cadence | **Pass.** HTTP 200 every ~10 s of playback (`time_code` integer seconds), on pause, on exit (Back) and on background; no non-2xx | agent via adb |
| S8 E9 bug found | During a quality switch the spike wrote **`t=0`** (the new source reports 0 before its seek-after-load); the correct position was written about 1 s later. Fixed in the spike (positions count only once the start is reached; test added). Production must apply the same rule | agent via adb |
| S8 round-trip | **Pass.** Exit wrote `t=1743`; re-enter, fresh E8 → `timeCode=1743` (match). Later pause wrote `t=1802`, and the **website offered 30:02** (owner) | agent via adb, owner |
| Sleep/wake while playing | `KEYCODE_SLEEP` (injected) → AppState `active → background`, the player paused itself (`playing=false`). The background E9 write was issued but completed only after wake (`HTTP 200`, `t=1823`). `KEYCODE_WAKEUP` after 60 s → `background → active`, and playback **resumed by itself** (`playing=true`, the app's paused state was false). Production should stay paused after a background/sleep (reference: pause on ON_PAUSE/ON_STOP) | agent via adb |
| Corrupted Bearer | E8 with a synthetic 64-char token → **HTTP 200** as an anonymous viewer (`hasAccess=false`, `data` empty, `error` absent), **not 401** | agent via adb |
| Requests | Every app run stayed far under the 150 cap (largest run 31 API requests) | — |
| logcat scan | Full `adb logcat -v time` captured from the first fixed build to the end (about 49 000 lines), searched locally, matches never recorded: `sig=`, `srcIp=`, `expires=`, `okcdn.ru/`, `Bearer <value>`, URL with a query → **0** each; okcdn or `boosty.to` outside `SpikeNet` lines → 0 (ExoPlayer and react-native-video log no URLs); 9+ digit runs on app lines → 0; 60+ runs only Java class names and install paths. Device buffer cleared and the local copy deleted | agent via adb |
| Log hygiene finding | One diagnostic build logged the **value** of the `sig` query key: it is letters-only and short, so the first `describeUrlShape` showed it as an "enum" (11 characters of a signature, the URL living 24 h and bound to the owner's IP). The device buffer was cleared within minutes; nothing reached git or files. Fixed: values only for allowlisted keys (`cmd`, `srcAg`), with a test | agent |

### Story 1.7 — audio and files (S9), 2026-10-25

**Status: device scan done; no `audio_file` or `file` sample in the scanned range** (the 60 newest posts of each of the 3 subscribed blogs; page 3 had `isLast=false`, so older posts were not seen; E5 was not scanned). Every audio and file row is **not verified** (owner decision 2026-10-25: auto-scan only, no blog typed in; a missing sample is recorded, not worked around). The post-level `signedQuery` was measured on every accessible scanned post.

Branch `spike/1-7-audio-files` (throwaway, Story 1.6 spike + `main`). Spike screen «Аудио и файлы» (`src/app/spike/AudioFilesCheck.tsx`, first menu entry; the menu title is «спайк 1.7»), helpers in `src/app/spike/playbackApi.ts`:
- «Найти аудио и файлы (E2, E4)»: E2, then E4 for at most 5 subscribed blogs, up to 3 pages each, paging only with the returned `extra.offset` (`buildBlogPostsRequest(blog, offset)`). Lists at most 5 accessible `audio_file` and 5 `file` blocks (locked posts and blocks without `url` skipped). Per page it logs post, locked, `audio_file` and `file` counts, how many have an empty `signedQuery`, whether a next page exists, and the block types seen (including blocks nested in `list` items).
  Per page it also logs the post-level `signedQuery` facts (`signedQuerySummary`): accessible posts, how many have a non-empty `signedQuery`, the distinct shapes (keys and value classes only) and the expiry field as min/max seconds until expiry, with past timestamps counted apart. A scan cut short by the budget or by a failed E4 page reports «скан неполный», never «no sample». `audio_file`/`file` blocks nested in `list` items are counted and pickable.
- Picking a block sends a fresh E8 (`comments_limit=0&reply_limit=0`, Story 1.6 reference profile) and finds the same block by `id`, else by the same `url`. The URL is `signedUrl(url, signedQuery)`, in memory only. Logged: the `signedQuery` shape (`describeSignedQuery`: keys and value classes, no values), any expiry-like digit field as seconds until expiry, or «no expiry field (unverified)», and an empty `signedQuery` («bare url»).
- Audio: react-native-video, «Пауза/Играть», «−10 с», «+10 с», a focusable player area (D-pad left/right on key up, Select = play/pause), position/duration and buffering on screen; load, buffer, seek, playback state, audio focus, «becoming noisy», end and errors in the log; AppState transitions logged. One automatic E8 re-resolve on a player error, resumed at the last position; a second error stops. No E9 (the reference keeps no audio progress).
- File: the signed link is shown only as a QR code (`react-native-qrcode-svg`, 200 dp, `ecl="M"`, white quiet zone); its length is logged, never the text.
  **The QR encodes a live signed link** (24 h, carries the account's user id): do not photograph or screenshot it, and do not keep it as evidence. Record only that the phone opened it and what it showed.
- «Проба URL (аудио, файл)»: a status-only GET with only `Range: bytes=0-0`, no credentials, aborted as soon as the headers arrive (the body is never read, nothing is downloaded); logs the status, the media type and whether `Content-Range` came back, plus the URL age in minutes. Pressed again at the end of a session for the lifetime row.
- Budget: at most 100 API requests per app run (refreshes included), shown as `API: n/100`; probes are counted separately.
- Logs go through `redactForLog` and carry no titles, URLs, `signedQuery` values, cursors or ids. Titles appear on screen only.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test`, `npm run check:fixtures` pass (after the review fixes the agent ran only the two Story 1.7 suites, 27 tests; the coordinator runs the full set). Tests: `playbackApi.test.ts` (candidates skip locked posts and empty URLs and include blocks nested in `list` items, an empty or missing `signedQuery`, query joining with `?`/`&`, the joined URL fully redacted, `signedQuery` shape, expiry detection with `expire_time`, no one-letter keys, past timestamps reported as such, the per-page `signedQuery` summary without values, re-resolve by id then by url, `nextPageOffset` and the `offset` argument, block counts and the block-type summary) and `AudioFilesCheck.test.tsx` (scan with offset paging, audio pick → `url + signedQuery` played, ±10 s, pause, one re-resolve with the fresh `signedQuery` and the resume seek, the pre-seek `t=0` ignored, a stop on the second error, file pick → QR value, probe headers and abort, only GET requests, no E9 or comments request, an empty `signedQuery` plays the bare URL, «no sample» per kind, «скан неполный» after a failed page or a budget stop, the 100 budget, and no URL, `signedQuery` value, cursor, title, id or token in console output).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL. Release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo) installed with `adb install -r`; the stored session was kept (no sign-in needed). Rebuilds: one added the block-type summary; after review, one added the post-level `signedQuery` summary, and one more added the live key `expire_time` to the expiry detection (the first summary run showed `expire_time` but reported «no expiry field»).

| Row | Result | Who |
|---|---|---|
| Find | 3 subscribed blogs (fewer than the cap of 5), 3 E4 pages each = the 60 newest posts per blog, 180 in total (49 locked, all in blog #2; 131 accessible). **`audio_file`: 0, `file`: 0** in accessible posts, also inside `list` items. Block types seen: `text`, `link`, `ok_video`, `image`, `video`, `list` (`list>text`). Recorded as **«no sample» for the scanned range** for both kinds; those rows stop. Page 3 had `isLast=false`: older posts and E5 were not scanned. 4 runs, identical counts | agent via adb |
| E4 paging | Pages 2 and 3 with the previous `extra.offset`: HTTP 200, 20 new posts each; `isLast=false` on every page | agent via adb |
| Audio play / pause / seek ±10 s | **Not verified** (no sample) | — |
| Status-only probe (abort at the headers, nothing downloaded) | **Not verified on the device:** 0 probes ran. Jest with a fake XHR only | — |
| Audio sleep/wake | **Not verified** (no sample) | — |
| File QR, phone scan | **Not verified** (no sample); no owner check was possible | — |
| `Post.signedQuery` (post level) | Non-empty on **all 131** accessible posts (0 empty), empty on locked posts. One key set on every post: leading `?`, `user_id` (7 digits), `content_id` (7 or 8 digits), `expire_time` (10 digits, epoch s), `sign` (64 opaque). `expire_time` = **86 399–86 400 s** after the response on every post (0 past timestamps). Values never recorded | agent via adb |
| `signedQuery` enforcement by the audio/file host, empty `signedQuery` on an audio/file block | **Not verified** (no sample) | — |
| No Boosty auth on audio/file hosts | No audio or file host was requested. `SpikeNet`: only `api.boosty.to` (`auth=true`), 10 requests per run | agent via adb |
| Requests | 10 API requests per run (E2 + 9 × E4), 0 probes; far under the 100 cap. No E8, no mutation, no comments request | agent via adb |
| logcat scan | Full `adb logcat -v time` captured for each round (about 9 400 lines, then about 8 000 for the review re-scan), searched locally, matches never recorded: `sig=`, `sign=`, `user_id=`, `content_id=`, `expire_time=`, `srcIp=`, `expires=`, `signedQuery=`, `Bearer <value>`, URL with a query, `okcdn` → **0** each; `boosty.to` outside `SpikeNet` lines → 0; 7+ digit runs and `+` digit runs on app lines → 0; 40+ and 60+ runs on app lines → 0. Device buffer cleared (`adb logcat -c`) and the local copies deleted after each round | agent via adb |

Open: S9 needs an accessible `audio_file` and `file` post within the scanned range of a subscribed blog. A re-run is one press of «Найти аудио и файлы» on this branch; then the owner checks the sound and scans the QR (without photographing it).

### Story 2.1 — Welcome screen on the design foundation, 2026-10-26

**Status: A1 verified on the pinned device by adb (screenshot, uiautomator, injected keys). TalkBack announcement and the look with the physical remote are owner checks, not done yet.**

First production screen on `main`: design tokens (`src/shared/ui/tokens.ts`), bundled Golos Text 400/600 (`android/app/src/main/assets/fonts/`, OFL), `FocusableSurface`, `Button`, `Spinner`, `Text`, `useReducedMotion`, the shared `Screen` wrapper (`src/shared/focus`), the typed `ru` catalog (`src/shared/i18n`) and A1 `WelcomeScreen` (`src/features/auth`) as the app's only screen.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test`, `npm run check:fixtures` pass. New tests: `tokens.test.js` (every DESIGN.md color, typography, rounded, spacing, focus, motion and component token matches `tokens.ts`; no `fontWeight`; nothing under 11 sp; font files and OFL present), `catalog.test.ts` (welcome copy, `error.<kind>` for all 15 AD-5 kinds, `test.lesson` plurals 1/2/5/21, invalid counts throw, unknown keys fail typecheck), `Button.test.tsx` (focused ring/lift/scale with `motion.focus` and the native driver, pressed 0.98 with `motion.press`, disabled, busy with a constant width, secondary, reduce motion on / change event / change event before a slow query / rejected query), `Screen.test.tsx` (trap on all four sides, `colors.bg`, full size), `App.test.tsx` (one focusable element, initial focus, catalog label and accessibility label) and `noRawText.test.js` (the lint override fails on raw literals outside and inside `<Text>`, in ternaries, `&&`, `+`, fragments and copy-bearing props, in `src/app`, `src/features`, `src/shared/ui` and `src/shared/focus`).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL; the APK contains `assets/fonts/GolosText-Regular.ttf`, `GolosText-SemiBold.ttf` and `OFL.txt`. Release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo) installed with `adb install -r` over the spike build (app data kept, nothing uninstalled or cleared).

| Row | Result | Who |
|---|---|---|
| Launch | Started with the launcher intent (`monkey -c android.intent.category.LEANBACK_LAUNCHER`) from the Home screen; `MainActivity` resumed, A1 shown. Not opened by navigating the launcher with the remote | agent via adb |
| Font | Golos Text rendered: hero and button label are SemiBold although no `fontWeight` is set (a fallback to the system font would render weight 400); Cyrillic glyphs match Golos Text | agent via adb (screenshot) |
| Layout (px at 1920×1080 = dp × 2) | Column x 520–1400 (440 dp, centered), hero top 300 (150 dp); body 24 px below the hero (12 dp); button 48 px below the body (24 dp), height 80 (40 dp); footer x 96–1824, bottom 1026 (48 dp sides, 27 dp from the bottom). Everything inside the safe area; no wordmark in the corner | agent via adb (uiautomator bounds, screenshot) |
| Focus | Button is the only focusable node and has focus at launch (`focused=true`); ring visible around the scaled button (≈ 1.04, ring not clipped), `accent-focus` lift | agent via adb |
| Accessibility label | uiautomator `content-desc` = «Войти в Boosty» (`android.widget.Button`) | agent via adb |
| OK | `KEYCODE_DPAD_CENTER`: screenshot pixel-identical to before; focus kept | agent via adb (injected key) |
| D-pad | Up, down, left, right: screenshot pixel-identical; focus stays on the button | agent via adb (injected keys) |
| Back | `KEYCODE_BACK` → Google TV Home (`launcherx HomeActivity` resumed) | agent via adb (injected key) |
| Pressed scale 0.98 | Not observable by screenshot (80 ms); covered by the component test only | — |
| TalkBack announcement | **Not verified** — owner check | — |
| Physical remote look and feel | **Not verified** — owner check | — |
| Reduce motion on the device | **Not verified** on the device; component tests only | — |

### Story 2.2 — Request a sign-in code by phone, 2026-10-26

**Status: A1 → A2, focus, system keyboard, validation (A4) and Back verified on the pinned device by adb (injected keys, uiautomator, screenshots). No send request was made (owner decision 2026-10-26: the live send runs once in Story 2.3 together with confirm). A9, A10, A5, the network and unknown errors and the send itself are covered by host tests only.**

Changes: root JS stack (`@react-navigation/stack`, ADR 0007) with routes A1 → A2 → A5 (`src/app/routes.ts`); A2 `PhoneScreen` (A2/A4/A9/A10 states), minimal A5 `CodeScreen`, `authFlow` (in-memory draft and challenge) and E.164 validation (`src/features/auth`); `AuthApiClient.sendCode`, the ADR 0008 profiles, `AuthError` and the send DTO (`src/shared/api`); install `device_id` (`InstallIdModule.kt` + `src/shared/platform/deviceId.ts`); redacting `Logger` (`src/shared/services`); `TextField` (`src/shared/ui`). New exact pins: `@react-navigation/native` 7.5.1, `@react-navigation/stack` 7.12.1, `react-native-gesture-handler` 3.4.0, `react-native-screens` 4.30.0 (peer only, never rendered), `react-native-safe-area-context` 5.10.1, `zod` 4.6.7, dev `@babel/plugin-transform-export-namespace-from` 7.29.7 (in `babel.config.js`). Jest transforms the ESM navigation packages and loads `react-native-gesture-handler/jestSetup.js`.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test`, `npm run check:fixtures` and the release Metro bundle pass. New tests: `logger.test.ts` (redaction of E.164 numbers, 7+ digit runs, `Bearer`, 32+ opaque runs, URLs with a query, `code=` / `sms_code=` / `phone=`; ring of 200; console only when enabled), `deviceId.test.ts`, `profiles.test.ts` (exact header set per profile, no Boosty headers for other hosts), `authApiClient.test.ts` (send request and headers, double send = one request, 429 `sms_gate_ratelimit` → `TooManyAttempts`, everything else → `Unknown`, fetch rejection and 30 s timeout → `Network`, no secrets in logs), `phone.test.ts`, `authFlow.test.ts`, `TextField.test.tsx` and `signInFlow.test.tsx` (the real App: navigation, initial focus targets, «Готово» rule, A4, A9, A10 with one retry, network/unknown errors, Back on every layer, late result after Back).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL. Release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo) installed with `adb install -r` over the previous build (same package id, nothing uninstalled or cleared). Device serial: `adb-25311HFDD69E8B-SKv3Ox._adb-tls-connect._tcp` (wireless adb).

| Row | Result | Who |
|---|---|---|
| A1 OK → A2 | A2 shown; the number field focused (`focused=true`), country code `+7`; the IME is not opened by the move (`mInputShown=false`) | agent via adb (injected keys) |
| A2 arrows | ← number → country; → back to the number; ↓ from the number or the country → «Получить код»; → «Назад»; ↑ from either button → the number; → at the number and ↑ at the fields do nothing | agent via adb |
| System keyboard | OK on the number opens the system numeric IME (`mInputShown=true`); digits typed; Back closes the IME first and focus stays on the field | agent via adb |
| «Готово» (IME ✓ key, reached with the D-pad) | Number `91624` (invalid) → focus stays on the number field; a valid 11-digit number → focus on «Получить код», IME closed. OK was **not** pressed with the valid number | agent via adb |
| A4 | «Получить код» with an invalid or empty number: red border, «Проверьте номер телефона», focus on the number field (focus ring outside the red border); no request (no send was ever made) | agent via adb (screenshot) |
| Country code | Edited to `+375` digit by digit; a 4th digit is refused (`+` + 3 digits). A burst of adb `input text` with a letter lost characters (controlled-input race under injected bursts, see risks) | agent via adb |
| Back | A2 → A1 with «Войти в Boosty» focused; «Назад» → A1 focused; A1 again → A2 with an empty number (draft reset); Back on A1 → Google TV Home | agent via adb |
| Logcat | App lines scanned after the run: no 7+ digit runs, `Bearer` or 32+ opaque runs from the app (only system ids in `ActivityManager`/`WindowManager` lines); the typed numbers appear nowhere in the buffer; release build prints no JS log. Buffer cleared | agent via adb |
| `device_id` native module | Linked in the release build (app starts, no error), but **not exercised on the device**: only a send reads it. Story 2.3 | — |
| Send, A5, A9, A10, Network, Unknown | **Not run on the device** (owner decision); host tests only | — |
| Physical remote, TalkBack | **Not verified** — owner check | — |

### Story 2.3 — Confirm the code and create the session, 2026-10-26

**Status: implementation done and host-tested. On the device (adb, no request to Boosty): the startup gate with no session, the A1 → A2 walkthrough and the `device_id` check. The live sign-in passed on 2026-10-26 (owner, physical remote; rows below).**

Changes: A5–A8 `CodeScreen` (code field, 60 s resend countdown, resend with `transport=gate`, A7, A8 render state, «Изменить номер»), the temporary `SignedInScreen`, the startup gate and `SignedIn` route (`src/app`), «Войдите снова» on A1 (`src/features/auth`); `AuthApiClient.confirmCode` / `resendCode`, `mapConfirmFailure`, the tokens and user-current DTOs, a minimal content-profile `HttpClient` and `SessionManager` (`src/shared/api`); the `SecureStore` adapter with the ADR 0006 classification and recovery, services `boostytv.session` and `boostytv.phone` (`src/shared/platform/secureStore.ts`); the native `KeychainStorageResetModule` ported from the spike, now checking `File.delete()`, also removing a leftover `.tmp` and rejecting with a fixed reason. New exact pin: `react-native-keychain` 10.0.0. Jest uses the in-memory `__mocks__/react-native-keychain.js`.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (23 suites, 346 tests), `npm run check:fixtures` and the release Metro bundle pass. New tests: `secureStore.test.ts` (classification, corruption → helper → reset → wiped then save + read, undecryptable → reset, transient → one retry then `unavailable` with the data kept, save failures, recovery on save, clear, no values in logs), `httpClient.test.ts` (exact content headers, no Boosty headers or `Authorization` off `api.boosty.to`, 30 s timeout, path-only logs), `sessionManager.test.ts` (success order confirm → E1 → phone → session, wrong code, E1 401/500/network/no `id` with the challenge marked spent, a phone save failure is not fatal, corruption recovery during the phone write keeps the session, a session save failure keeps nothing, double submit, restore rows), confirm and resend cases in `authApiClient.test.ts` (exact bodies and headers, 400 `invalid_sms_code`, `expires_in` edges, single-flight), `maskPhone` in `phone.test.ts`, `tf` in `catalog.test.ts`, and `codeFlow.test.tsx` (the real App: initial focus, masked phone, countdown with fake timers, resend and 429, empty «Готово», Back and «Изменить номер», success to SignedIn with the exact E1 headers and the keychain contents, double «Готово», A7, E1 failures, save failure, bad confirm bodies, Network, A8, and the startup gate: splash, stored session, nothing stored, corruption, transient error twice and once).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL. Release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo) installed with `adb install -r` (nothing uninstalled or cleared). For the `device_id` check a debug build (same package and signing key) was installed over it with `adb install -r`, then the release-like build was installed again; it is the installed build now.

| Row | Result | Who |
|---|---|---|
| Startup gate, no session (release-like) | Cold start → A1, «Войти в Boosty» focused, no «Войдите снова»: the keychain read of `boostytv.session` returned empty without an error (the spike's entries in the same DataStore file are under other service names) | agent via adb |
| A1 → A2 (release-like) | OK → A2 with the number field focused, IME not open; ↓ → «Получить код»; ↑ → the number; Back → A1 with «Войти в Boosty» focused. «Получить код» was not pressed | agent via adb (injected keys, uiautomator) |
| `device_id` (debug build, Metro on a separate port, `Runtime.evaluate` over the inspector) | Two `InstallId.getOrCreate()` reads returned the same value: a 36-character UUIDv4; after `am force-stop` and a cold start (new process id) the same value again. Compared by an FNV-1a fingerprint only; the value was never printed or logged | agent via adb |
| Logcat | App-process lines scanned after the run: no `Bearer`, `sms_code`, phone digits, 7+ digit runs or 32+ opaque runs except Android class and property names; no UUID; the only app JS lines are `[secureStore] read: empty` with the service name (debug build). Buffer cleared | agent via adb |
| A5–A8 on the device | A5 used in the live sign-in (owner: code field, «Готово» submits). A6 (resend), A7 (wrong code) and A8 were **not reached** on the device; host tests only | owner |
| Live sign-in (owner, physical remote): send → code → confirm → E1 → SignedIn | **Pass (owner, physical remote, 2026-10-26)**: one send, the code arrived in Telegram, confirm succeeded, E1 with the `content` profile succeeded (ADR 0008 check for E1), SignedIn shown. No resend was needed. The release build logs no status lines, so the `sentTransport` value was not recorded (Story 1.3 saw `gate`) | owner |
| Session survival after force-stop and cold start | **Pass**: after `am force-stop` and a launcher start (new pid) the app opened SignedIn (`auth/signed-in`) without signing in again | agent via adb |
| Logcat scan after the live run (phone digits, `Bearer`, 32+ runs, `sms_code`) | **Pass**: full buffer from the launch before the sign-in to after the cold start (about 3 900 lines), searched locally: `Bearer <value>`, `sms_code=`, `access_token`, `refresh_token`, `+` with 9+ digits → 0. 9+ digit runs only in a system launcher tag (package cache), 32+ runs only in system tags (IME, ActivityManager); the app's own lines are only `Running "BoostyTV"`. Buffer cleared, local copy deleted | agent via adb |
| Corruption recovery through the production adapter and helper on the device | **Not verified on the device — open device item.** The production `KeychainStorageResetModule` differs from the Story 1.3 spike helper (checks `File.delete()`, removes `.tmp`, fixed failure reason; ADR 0006), so the Story 1.3 gate does not cover it. Not run here because overwriting the DataStore file would also wipe the spike's stored session. Host tests only | — |


### Story 3.1 — Subscription feed on the Home screen, 2026-10-26

**Status: implemented; verified on the pinned device (Chromecast with Google TV 4K, release-like build `assembleRelease -PreactNativeArchitectures=armeabi-v7a` + `zipalign` + `apksigner` with the SDK debug key) with the owner's existing session (no sign-in, no sign-out). Owner checks with the physical remote; agent checks by adb (injected keys, uiautomator, screencap, `dumpsys gfxinfo`/`meminfo`, `atrace`).**

| Check | Result | Who / how |
|---|---|---|
| E5 with the content profile | HTTP 200, the owner's subscribed posts, video previews and durations, paging via `extra.offset` (recorded in `docs/api-contract.md` §1) | agent, adb |
| Cold start focus | Focus moves to the first card once page 1 arrives (user had not moved) | agent, adb |
| Focused row fully visible | Bottom row's scaled card and ring inside the viewport (after fix: slot padding, no JS scroll on focus) | agent, screencap |
| Meta line | Long author names ellipsize, « · date» always visible | agent, screencap |
| Fast ↓ keeps the column | 60 presses at 0.15 s and 0.3 s, 2 runs each: column 3 kept (after holding back the partial last row) | agent, adb |
| End of list while loading | ↓ keeps focus on the last full row (end guide) | owner, physical remote |
| Return to Главная | Scroll position kept; → lands on the remembered card | owner, physical remote |
| Focus jumps on long scroll | Seen with the FlashList #1843 guard (it reverted user presses during mount hitches); guard removed; none after | owner, physical remote; agent adb (60 steps, ~18 appends, no move without a key) |
| Overall feel | "Everything works"; 3-column grid accepted | owner, physical remote |

**Performance (adb, 12–20× ↓ at 0.35 s):**

| Build | Janky frames | Median / 90th | Page-mount stall per 20 rows | Memory |
|---|---|---|---|---|
| First build (full-size previews) | 100 % | 150 / 300 ms | — | PSS 763 MB, Graphics 325 MB |
| `resizeMethod="resize"` | 9 % | 30 / 38 ms | — | PSS 229 MB, Graphics 37 MB |
| FlatList, flattened card | 8–9 % | 31 / 38 ms | 2.0–2.2 s (top frame 400–450 ms) | deep scroll: PSS ≈ 360 MB, Graphics plateau ≈ 115 MB (image cache) |
| FlashList 2.3.3 (ADR 0011) | — | — | 1.15–1.47 s (top frame ≈ 300 ms) | — |
| Google TV launcher (baseline) | 0 % | 32 / 34 ms | — | — |

A median of 31–32 ms is this device's normal (the launcher shows the same). The 300+ post latency check ran on the owner's real feed (~160 rows ≈ 480 posts with real images), not on a synthetic feed (the `LONG_FEED_CHECK` switch built for it was removed afterwards, unused); the owner judged it acceptable.

Not verified: TalkBack labels on cards; second-account cache isolation on the device (host tests only; action item 8).

### Story 3.2 — Subscriptions grid, 2026-10-26

**Status: implemented; partly verified on the pinned device (Chromecast with Google TV 4K, release-like build, the owner's existing session). Agent checks by adb (injected keys); the owner checked it with the physical remote: "everything works".**

| Check | Result | Who / how |
|---|---|---|
| E2 with the content profile | HTTP 200 | agent, adb |
| Sidebar `nav/home` ↓ `nav/subs` | Focus moves to «Подписки»; the section does not open on focus | agent, adb |
| OK on «Подписки» | The grid loads; focus moves to the first tile | agent, adb |
| → from the sidebar | Lands on the remembered tile | agent, adb |
| ← ← from the grid → `nav/subs` | Focus returns to the current sidebar item | agent, adb |
| Back | → `nav/home` (Главная) | agent, adb |
| Physical remote (grid, focus states, Back order) | **Pass** (owner, 2026-10-26): tiles, OK → first tile, → ← Back, return restores the tile | owner, physical remote |

Not measured on the device: the 55-author virtualized grid (fast ↓ column keeping, recycling, performance) — the owner's account has 3 subscriptions; host tests only. Not verified: «Показаны первые N» and the empty state (C3) on the device; TalkBack labels on tiles.

### Story 3.3 — Author page, 2026-10-27

**Status: implemented and host-tested; the main path verified on the pinned device (Chromecast with Google TV 4K, release-like build, the owner's existing session) by the agent with adb (injected keys, uiautomator, screencap). Not yet checked by the owner with the physical remote.**

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL (JDK 17); release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`. The shipped Hermes bundle: `state/author/action` 1, `createDemoSessionManager` 0. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Check | Result | Who / how |
|---|---|---|
| E3/E4 with the content profile | The header (title, owner name, avatar) and the posts (accessible and locked) rendered; no error state (recorded in `docs/api-contract.md` §1) | agent, adb |
| Подписки → → → OK on the 2nd tile | Автор opens; focus moves to the first post; sidebar current item «Подписки» | agent, adb (uiautomator) |
| ↓ through pages | 14 × ↓ at 1.2 s: a new card each step (≈ 42 posts, ≥ 3 E4 pages); column 1 kept (bounds x 408) | agent, adb |
| ← / → | ← → `author/nav/subs`; → → back to the same card | agent, adb |
| Back from a card | Подписки, focus on the same tile (`subs/tile/<blogUrl>`) | agent, adb |
| Back from the Author sidebar | Подписки, focus on the same tile | agent, adb |
| OK on «Главная» in the Author sidebar | Shell on Главная (current item), focus on the remembered feed card | agent, adb |

Host tests: `__tests__/authorFlow.test.tsx` (every matrix row, the focus rules, the stand-in pushed route for Story 3.4's return, 320 posts, account scope), `__tests__/subscriptionsFlow.test.tsx` (OK on a tile opens Автор), `__tests__/demoFlow.test.tsx` (demo E3/E4), repository unit tests for E3/E4. The full suite ran 3× green; the new and changed flow suites (author, subscriptions, home, demo, shell) ran 30× green.

**Author posts head refresh (2026-10-27, `spec-author-posts-refresh.md`), host-tested only:** `__tests__/authorFlow.test.tsx` «head refresh on reopen and resume» (reopen with a fresh cache: no E4; stale with 2 new posts: one E4 page 1, on top, both pages kept; reopen focus with the user not moved, the reply before and after the mount focus event: the new first post, list at the top; after a move (D-pad to card 1, → then ←, OK on the first card): the focused card kept at its new row; reopen refresh failure network/5xx/4xx silent with exact request counts (AD-6: 3/2/1 attempts) and the kind logged; an empty page 1 with more pages keeps the loaded posts and counts as fresh, an empty last page shows «Публикаций нет»; stale with nothing new: no visible change; gap: page 1 alone, the new first post; first open without a cache; resume quick/stale with focus on card 13 kept at its new row; gap fallback; a 1-post prepend into the held partial row; refresh failure 4xx/network/5xx with exact request counts; a failed page append with «Повторить» focused: the refresh is skipped, the retry row and focus stay; first open without a cache, untouched (automatic sidebar focus, its native event before or after the E4 reply), stale resume with 2 new posts: the new first post at the top; a deliberate move to another sidebar item latches; a page append in flight; an account reset before the reply; sidebar focus kept; a covered Автор takes no focus; a popped Автор is not refreshed), `src/shared/entities/post/__tests__/postsHeadRefresh.test.ts` (incl. an empty page 1 by default (replaced, Главная) and with `keepEmptyWithMore` (kept with a next cursor, replaced when last), the error-state skip, single-flight released after a success and a failure), `src/features/author/__tests__/authorPostsRefresh.test.ts`. Главная's `feedRefresh.test.ts` and `homeFeedFlow.test.tsx` pass unchanged on the shared implementation. Device (2026-10-27, agent by adb, release-like build `assembleRelease -PreactNativeArchitectures=armeabi-v7a` + `zipalign` + `apksigner`, the owner's existing session, Chromecast with Google TV 4K): Подписки → OK on the first tile → Автор, focus on the first post, header shown; Back → the same tile; reopen after 66 s: focus on the first post, header shown, no error state; ↓ ↓ → to another card, Home key, 66 s in the background, relaunch: focus on the same card, no error state. No new posts appeared meanwhile, so the head merge itself was not seen on the device (host-tested). Not checked by the owner with the physical remote.

Not verified on the device: the empty, error and «Автор недоступен» states (the owner's blogs have posts and exist; host and demo only); the return to Автор from a pushed route (Post is Story 3.4; host-tested with a stand-in route); performance/jank of the Author grid (not measured; it is the Главная grid component); TalkBack labels; the physical remote.

### Story 3.4 — Post screen, 2026-10-27

**Status: implemented and host-tested; the main path verified on the pinned device (Chromecast with Google TV 4K, release-like build, the owner's existing session) by the agent with adb (injected keys, screencap). Not yet checked by the owner with the physical remote.**

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17) BUILD SUCCESSFUL; release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`. The shipped Hermes bundle: `state/post/action` 1, `createDemoSessionManager` 0. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Check | Result | Who / how |
|---|---|---|
| E8 with the content profile | Posts rendered (title, date · likes, author, paragraphs, placeholders); no error state | agent, adb |
| Главная → ↓ → OK on a text post | Пост opens; focus on the first paragraph (accent bar + `surface` background, no ring); sidebar current item «Главная»; «16 окт · 13 лайков» | agent, adb (screencap) |
| ↓ / ← / → | ↓ → the next paragraph; ← → the author row; → → back to the last focused paragraph | agent, adb |
| ← ← then Back | Sidebar «Главная», then Главная with focus on the same card | agent, adb |
| OK on a video post (pre-decision build: before the inline-link decision and the long-paragraph split) | A «Видео» placeholder, then paragraphs; inline links shown as «Ссылка» placeholders (since replaced: link text stays in its paragraph); 8 × ↓ scrolls the right column natively | agent, adb |
| Author row OK, Back, Back | Автор (sidebar current «Главная», focus on its first post); Back → Пост with focus on the author row; Back → Главная, the same card | agent, adb |
| Подписки → Автор → OK on a post → author row OK | Pops to the same Автор, focus on the same card; Back → Подписки, the same tile | agent, adb |
| Пост over Автор: sidebar «Главная» OK | The Shell on Главная, focus on the remembered feed card | agent, adb |

Host tests: `__tests__/postFlow.test.tsx` (every matrix row; initial focus first paragraph / author for locked and text-less posts; the skeleton and a move during it; the column guides and traps; ↓ through 40 paragraphs; a refetch that drops the focused paragraph; Back to the same card from Главная and Автор, gone → the neighbor; the author row push/pop; sidebar items, origin and other sections, `popTo` through Автор; FocusRestoration forgotten on unmount), `__tests__/homeFeedFlow.test.tsx` and `__tests__/authorFlow.test.tsx` (OK on a card opens Пост; a stale reopen refresh while Пост covers Автор), `__tests__/demoFlow.test.tsx` (demo E8: paragraphs, mixed blocks, 404), unit tests `postBody.test.ts`, `postRepository.test.ts` (E8), `mapPost.test.ts` (like count, route-safe `blogUrl`), `queryKeys.test.ts`. The full suite ran 3× green (1059 tests); the new and changed flow suites (post, author, home, demo, shell, subscriptions: 219 tests) ran 30× green.

Seen on the device: the live posts put links inline (`text`, `link`, `text`, `BLOCK_END`), so the first build split such a sentence with a «Ссылка» placeholder. Owner decision 2026-10-27: a link's text stays in its paragraph as plain text (no placeholder); implemented and host-tested after the device run, not yet re-run on the device. An open Пост is not refreshed on resume (only Главная's and Автор's heads are); E8 is requested again only when Пост is reopened after `staleTime` (60 s). Not re-run on the device after the review fixes: the inline-link merge and the split of paragraphs longer than 400 characters into several stops (host-tested). Not verified on the device: «Пост недоступен» and the error state (host and demo only; the locked post: see «Story 3.6» below); a post with a list, a poll, audio or a file; TalkBack labels; the physical remote; performance of very long posts (the right column is a plain ScrollView, not virtualized).

Re-run after the review fixes (2026-10-27, agent by adb, a fresh release-like build, the owner's session): Главная → OK on the first card → Пост, focus on the first paragraph; the live post's inline links read as plain text inside their paragraphs (no «Ссылка» placeholder); the only placeholder is «Видео»; 6 × ↓ walk the paragraphs with the focused one scrolled into view (accent bar shown); Back → the same feed card. That post had no paragraph over the stop budget, so the long-paragraph split was not seen on the device (host-tested). Not checked by the owner with the physical remote.

### Story 3.5 — Media rows in a post, 2026-10-27

**Status: implemented and host-tested; the main path verified on the pinned device (Chromecast with Google TV 4K, release-like build, the owner's existing session) by the agent with adb (injected keys, uiautomator, screencap). Not yet checked by the owner with the physical remote.**

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17) BUILD SUCCESSFUL; release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`. The shipped Hermes bundle: `state/post/action` 1, `createDemoSessionManager` 0. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Check | Result | Who / how |
|---|---|---|
| Главная → OK on a one-video post | One MediaRow on top of the right column: thumbnail, «Видео 1», the title, «1:13:30»; focus on the row (ring, `surface-focus-row`); the paragraphs follow; no «Смотреть» or status | agent, adb (screencap, uiautomator) |
| ↓ / ↑ / ← / → | ↓ → the first paragraph; ↑ → the row; ← → the author row; → → back to the row | agent, adb |
| OK on the row | Nothing: focus stays on the row, Пост stays | agent, adb (uiautomator) |
| Back from the row | Главная, focus on the same card | agent, adb |
| A two-video post (feed, «2 видео») | Two rows «Видео 1», «Видео 2» on top; focus on row 1. Row 1 had no preview and no duration in the live data: the neutral thumbnail plate, «Видео 1», its title, no duration line (label «Видео 1. Video»); row 2: thumbnail, title, «47:33» | agent, adb (screencap, uiautomator) |
| ↓ ↓ ↑ ← → Back on the two-video post | Row 1 → row 2 → `text@0` → row 2 → author → row 2 (the remembered row) → Back: the same feed card | agent, adb (uiautomator) |

Host tests: `__tests__/postFlow.test.tsx` «media rows» (every matrix row: two videos on top in block order with focus on row 1, one video, no title, duration «12:34» / none, no preview and a failed preview, no id → placeholder, duplicate id → one row, locked → no rows and the author, the domain shape on the live E8 fixture (no `timeCode` / `playerUrls` / `signedQuery` / player URL in the cached Post, the rows, the query key, the route params or the row props); ↑ ↓ rows then paragraphs, the column guides, OK on a row does nothing, Back to the card and the author row round trip, a refetch that drops the focused row, a cached reopen), the Story 3.4 tests updated (a video is a row, not a placeholder), `__tests__/demoFlow.test.tsx` (a demo post with two videos, the second without a title), unit tests `mediaRows.test.ts` (`videoRowsOf` / `mediaRefsOf`, domain shape), `postBody.test.ts` (videos leave the body; an id-less video stays a placeholder), `MediaRow.test.tsx` (states, label, thumbnail, native view budget ≤ 6), `surfaceRules.test.tsx`, `phaseFlags.test.ts` (`player: false`). The full suite ran 3× green (1103 tests); the new and changed suites ran 30× green.

Not verified on the device: a failed thumbnail load (host only), a video without an id and a duplicate id (no live sample; host only), the locked post (verified in «Story 3.6» below: no rows, focus on the author), TalkBack reading the row labels (uiautomator shows the content descriptions), the physical remote.

Story 3.5 review fixes (2026-10-27; host only, not re-run on the device): the `player` flag reaches the rows (off: no action, text role), the feed badge counts distinct video ids, `postBodyItems` keeps videos as placeholders unless the Post body asks for rows, thumbnail failure resets on a new preview URL. Orchestrator: lint, typecheck, check:fixtures clean; `npm test` ×3 1109 passed; post, demo, MediaRow and post-entity suites 30/30.

### Post screen: header on top, 2026-10-27

Owner decision 2026-10-27 (spec `_bmad-output/implementation-artifacts/spec-post-header-layout.md`): the Post screen is one vertically scrolling column (header → MediaRows → body) instead of two columns; body text capped at `spacing['text-measure']` (600 dp); `PARAGRAPH_STOP_MAX_CHARS` 400 → 600. Focus ids, components, states and restoration unchanged (docs/focus-map.md §4 F «Header on top»).

**Status: implemented and host-tested; the main path verified on the pinned device (Chromecast with Google TV 4K, release-like build, the owner's existing session) by the agent with adb (injected keys, screencap). Not checked by the owner with the physical remote.**

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL; release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Check | Result | Who / how |
|---|---|---|
| Главная → OK on a one-video post | Header on top (author row, title on one line, «сегодня, 10:40 · 0 лайков»), then the MediaRow at full content width (focused: ring, `scale-row`, fully visible), then the paragraphs capped at ≈ 600 dp, left-aligned | agent, adb (screencap) |
| ↓ × 25 on that post | Walks every paragraph to the last one (trapped at the end); the header scrolled away; each focused paragraph scrolled into view | agent, adb (screencap) |
| ← then → | ← → the sidebar's current item «Главная» (ring); → → back to the same last paragraph | agent, adb (screencap) |
| ↑ × 30 | Walks back through the paragraphs and the row to the author row (ring fully visible, trapped at the top); the header is back in view | agent, adb (screencap) |
| Back | Главная, focus on the same card | agent, adb (screencap) |
| A text post («Текст и фото», 2nd card) | Header on top; focus on the first paragraph (accent bar); ↓ × 15 to the last paragraph with the «Изображение» placeholder below it (capped at the measure); ↑ × 18 to the author; Back → the same card | agent, adb (screencap) |

Host tests: `__tests__/postFlow.test.tsx` (the column guide `post/column` with ↑ ↓ traps and no ← → traps; no `post/left` / `post/right`; the header inside the scrolling `post/body`, not sticky; focus order author → rows → paragraphs; the guide's destination = the last focused element, else the initial one; matrix rows «Video post» (layout: rows without a width cap, paragraphs at `text-measure`), «Text post», «Up to author», «Long text» (30 paragraphs down and back to the author), «Sidebar», «Locked», «States» (the skeleton in the single column; the 404 / error StateView replaces the column: no column, no header)), placeholders capped at `text-measure` like paragraphs. The long-text, sidebar and «Up to author» host tests check guide destinations and focus order with simulated focus (`focusOn`), not native D-pad movement; native movement is the adb run above; `postBody.test.ts` (the 600-character budget against the measure and the viewport; split tests resized); `tokens.test.js` (`text-measure` in DESIGN.md and tokens.ts). Lint, typecheck, check:fixtures clean; the full suite ran 3× green (1112 tests); `postFlow`, the post-entity suites and `tokens.test.js` ran 30× green (170 tests each run).

Not verified on the device: «Пост недоступен», the error state and the skeleton in the new layout (host only; the locked post in this layout: see «Story 3.6» below); a post with several videos (host only in this layout); a paragraph split by the new 600-character budget (none seen on these posts); TalkBack; the physical remote.

### Story 3.6 — Locked posts, 2026-10-27

**Status: implemented and host-tested; the main path verified on the pinned device (Chromecast with Google TV 4K, release-like build, the owner's existing session) by the agent with adb (injected keys, uiautomator, screencap). Not checked by the owner with the physical remote.**

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17) BUILD SUCCESSFUL; release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`. The shipped Hermes bundle: `post/locked` 1, `createDemoSessionManager` 0. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Check | Result | Who / how |
|---|---|---|
| Locked cards on Автор (Подписки → «Музыкант и Видеоблогер») | Dimmed preview (or the neutral plate when the post has no preview), lock glyph, «Нет доступа» badge; label «Нет доступа. {title}. {author}, {date}.» (Story 3.1 state, unchanged) | agent, adb (screencap, uiautomator) |
| OK on a locked post without a teaser («Опыт с магазинами!») | Header, then «Нет доступа. Этот пост доступен подписчикам уровня «Я тебя поддержу!». Оформить подписку можно на сайте или в приложении Boosty.» (not focusable); focus on the author row; no error, no A11 | agent, adb (screencap, uiautomator) |
| OK on a locked post with a teaser image («Обзор Mayones Jasper Nidra 6»), first build | Header, the copy with the level, then the teaser image (the server's blurred preview); the box was taller than its 300 dp cap with letterbox bars (Yoga took the height from the unclamped `width: '100%'` with `aspectRatio`), and the column overflowed the screen; focus on the author | agent, adb (screencap, uiautomator) |
| ↓ from the author on that post (first build) | Focus moved onto the image: an accessible RN `Image` is a D-pad focus stop on Android even with `focusable={false}`. Fixed: the accessible, non-focusable element is a View around a non-accessible Image (rebuilt and re-run below) | agent, adb (uiautomator) |
| ↓ from the author (second build) | The image is not focusable (`focusable="false"`); Android's ScrollView scrolled the column and the author lost focus to the ScrollView (no visible focus) until ↑ or ←. Fixed by «Teaser fits the screen» (next rows) | agent, adb (uiautomator, screencap) |
| «Teaser fits the screen» build (owner decision 2026-10-27): the same post | Header, copy and the whole teaser image on one screen, no scrolling: image box 425 × 239 dp (850 × 478 px at density 2, window 960 × 540 dp; the computed cap ≈ 239 dp), the picture's 16:9 fills it with no letterbox bars; the ScrollView `focusable="false"`, `scrollable="false"`; image `focusable="false"` | agent, adb (screencap, uiautomator) |
| ↓ ↓ from the author, then ←, →, Back | ↓ ↓: focus stays on the author, nothing scrolls; ← → «Подписки»; → → the author; Back → Автор with focus on the same locked card | agent, adb (uiautomator, screencap) |
| Review-fix build (cap from the measured viewport, box from the measured column, scrolling only when the content overflows): the same post | Header, copy and the whole image on one screen: box 424 × 239 dp (848 × 478 px), 16:9 with no bars; ScrollView `focusable="false"`, `scrollable="false"`; ↓ ↓ keep focus on the author; ← «Подписки», → the author; Back → the same locked card | agent, adb (uiautomator, screencap) |
| Same build, regression: an accessible text post on Автор («Содержание») | Focus on the first paragraph; ↓ × 6 walks the paragraphs (ScrollView `scrollable="true"`); Back → the same card | agent, adb (uiautomator) |
| Back | Автор, focus on the same locked card | agent, adb (uiautomator) |

Host tests: `__tests__/postFlow.test.tsx` «locked posts (Story 3.6)» (every matrix row: with a level («Базовый» and the live fixture's level), without a level (missing, null, blank, malformed `subscriptionLevel`), empty `data` with `hasAccess` true, teaser kinds (image, image failure → placeholder, image without a URL → placeholder, text → a paragraph stop, video → placeholder, none), the page order header → copy → teaser, the copy non-focusable and accessible, focus on the author, no price/currency/subscribe/QR text, the author row the only button, no refresh, no A11, no extra E1; opened from Автор with Back to the same card); the earlier locked rows of Stories 3.4/3.5 kept; `postBody.test.ts` (`images: true` teaser items: URL, size, no URL → placeholder; off by default); `mapPost.test.ts` (the level name trimmed; blank or malformed → none). The card regression is the existing `PostCard.test.tsx` «locked: dimmed preview, lock glyph, «Нет доступа»; no price or subscribe action», `homeFeedFlow.test.tsx` and `authorFlow.test.tsx` locked rows. Lint, typecheck, check:fixtures clean (the 3× / 30× totals are recorded by the coordinator).

Not verified on the device: the copy without a level (every locked post seen named its level; host and demo only), a teaser image load failure, a teaser paragraph or video, an empty-`data` post with `hasAccess` true (host only), the feed entry path (every device row was run from Автор: no locked post in the owner's feed, so Главная → locked post was not run), TalkBack reading the copy (uiautomator shows it as one content description), the physical remote.

«Teaser fits the screen» (owner decision 2026-10-27, resolves the ↓ focus loss above; review fixes the same day): the teaser image uses the loaded image's real aspect (until then the block's, else 16:9) in an explicit box `min(column width, text-measure, cap × aspect)` wide, height = width / aspect. The cap (`teaserImageMaxHeight` in `PostScreen.tsx`) comes from the column ScrollView's measured height: viewport − the copy's measured bottom − the gaps under the copy and the image − the column's bottom padding (`COLUMN_PADDING_BOTTOM`, the same constant as the style), at least 96 dp; the copy measure is forgotten when the post id or `hasAccess` changes. Scrolling stays on with a focus stop below the author or when the content (`onContentSizeChange`) is taller than the viewport (`onLayout`); only content that fits with nothing focusable below the author turns it off (`scrollEnabled={false}`, which on Android also makes the ScrollView non-focusable), and the column then scrolls back to the top. Host tests: `postFlow.test.tsx` «the teaser fits the screen» (the cap follows the measured viewport and the copy, the copy measure forgotten after an unlock, a narrow column, the loaded aspect replacing the block's; scrolling off for a locked post that fits, on for two teaser images, on/off for a placeholder-only post that overflows/fits, on for a video-only and a text post); `src/features/post/__tests__/teaser.test.tsx` (the pure cap: viewport, copy bottom, minimum; the box: column/measure/cap, a new URL resets the failed and loaded state). Only `postFlow`, `demoFlow` and the new unit file were run after these changes (lint and typecheck clean); the full-suite totals are recorded by the coordinator. Not verified on the device: a long title that drives the cap to its 96 dp minimum, two teaser images, a teaser image with a paragraph below it.

Story 3.6 final host run (orchestrator, 2026-10-27, after the review fixes): lint, typecheck, check:fixtures clean; `npm test` ×3: 1143 passed each; post flow, demo flow, `src/features/post` and post-entity suites 30/30.

### Epic 3 retro A3 — Главная follows a refreshed head, 2026-10-27

Device (agent, adb, release-like build, owner's session, Chromecast with Google TV 4K): cold start (focus on the first feed card, untouched) → Home key, 66 s, relaunch → focus on the same card, no error; ↓ ↓ → to another card → Home key, 66 s, relaunch → focus kept on that card. No new posts appeared meanwhile, so the head change itself (focus → the new first post on an untouched page) was not seen on the device (host-tested). Host: lint, typecheck, check:fixtures clean; `npm test` ×3: 1186 passed; `homeFeedFlow`, `authorFlow`, `useNotMovedLatch` 30/30. Not checked with the physical remote.

### Epic 3 retro A7 — shared screen focus pieces and one stack-route wrapper, 2026-10-27

Refactor, no behaviour change (`spec-epic-3-retro-a7-screen-focus-and-stack-routes.md`): the stack routes and the Shell return handshake moved to `src/app/stackRoutes.tsx` (`StackSidebarRoute`); `useHeldError` (`src/shared/api`) and `mayTakeScreenFocus` / `restoreElseFirst` / `usePhaseChange` / `useLatestRef` (`src/shared/focus/screenFocus.ts`) replace the per-screen copies; the flow-test helpers and the guide/FlashList recorders moved to `src/test/flow.tsx`.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL; release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`. Nothing uninstalled or cleared; no sign-in, no sign-out.

Device (agent, adb injected keys + uiautomator, release-like build, owner's session, Chromecast with Google TV 4K):

| Check | Result |
|---|---|
| Cold start → → OK → Пост → Back | Focus on the first feed card; → the second card; OK → Пост, focus on its first paragraph; Back → the same feed card |
| Подписки → tile → Автор → Пост → ↑ author row → OK → Back × 3 | OK on «Подписки» → the first tile; OK → Автор, first post; OK → Пост, focus on its MediaRow; ↑ → the author row; OK → pops to the same Автор and card; Back → the same tile → `nav/subs` → `nav/home` |
| Sidebar OK from Автор («Главная») | Pops to the Shell; Главная opens (`shell/content/home`) with focus on its remembered card |
| Sidebar OK from Пост opened from Главная («Подписки») | Pops to the Shell; Подписки opens (`shell/content/subs`) with focus on the remembered tile; Back → `nav/subs` → `nav/home` |

Animations were left at the device default, so the A4 check (sidebar OK with animations off) is still open. Host: lint (`--max-warnings 0`), typecheck, check:fixtures clean; `npm test` ×3: 1198 passed each; every `*Flow.test.tsx` suite (12 suites, 384 tests) 30/30. Not checked with the physical remote.

### ADR 0009 — SessionManager split, 2026-10-27

Refactor, no behaviour change (`spec-session-manager-split.md`): `src/shared/api/sessionManager.ts` is a facade over `src/shared/api/session/` (`types`, `codec`, `core`, `refreshHost`, `restore`, `signIn`, `signOut`, `lifecycle`, `debug`).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL. The shipped Hermes bundle: `debug: expired in memory` 0, `access token corrupted` 0, `createDemoSessionManager` 0, `late rejection dropped` 1, `expiry marker not saved` 1. Release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`. Nothing uninstalled or cleared; no sign-in, no sign-out.

Smoke check (agent, adb injected keys + uiautomator + screencap, release-like build, owner's stored session, Chromecast with Google TV 4K): cold start (force-stop, launch) → Shell, Главная with the feed, focus on the first feed card: the stored session was restored as `signedIn`, no A11, no error. → to the second card → Home key, 10 s, relaunch (same process) → the feed, focus on the same second card, no A11, no error. The resume E1 request itself is not visible in a release build (no JS logs), so only its absence of effect was observed. Host: lint (`--max-warnings 0`), typecheck clean; `npm test` ×3: 1236 passed each; `core.test.ts` + `refreshHost.test.ts` 30/30 in isolation; `__tests__/releaseBundle.test.js` green. Not checked with the physical remote.

### Story 4.1 — Play a video from a post, 2026-10-27

**Status: implemented and host-tested; the main path verified on the pinned device (Chromecast with Google TV 4K, release-like build, the owner's stored session) by the agent with adb (injected keys, uiautomator, screencap); the CDN header log on a debug build. Not yet checked by the owner with the physical remote; the picture itself is not visible in screenshots (the video surface is not captured by `screencap`), so the owner must confirm picture and sound.**

**Dependency:** `react-native-video` 6.19.3 (exact, `package.json` + `package-lock.json`); autolinked, no native code of ours around it.

**Build:** `./gradlew assembleRelease assembleDebug -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL. Release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`. Release APK: `HostAuthInterceptor` 0 and `BoostyNet` 0 in the dex (only the no-op `DebugNetLog`), debug APK: present. The shipped Hermes bundle: `player/surface` 1, `player/timeline` 1, `DevFocus` 0, `createDemoSessionManager` 0, `settings/row/session-check` 0. The debug build ran with Metro on port 8097 via `adb reverse tcp:8081 tcp:8097` (the other Metro on host 8081 was not touched; the mapping was restored to `tcp:8081 tcp:8081` afterwards); the release-like build is installed now. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Check | Result | Who / how |
|---|---|---|
| Пост with a video | «Смотреть» right under «date · likes», before the MediaRow; initial focus on it (screenshot shown to the owner: `story-4-1-post-smotret.png`, not in git). ↑ → the author, ↓ → the row, ↑ → «Смотреть» | agent, adb (screencap, uiautomator) |
| OK on «Смотреть» | Player route, focus `player/surface`; ExoPlayer starts (Media3 1.8.0, audio focus requested), the decoder runs 640×360 → 1920×1080 (HLS) | agent, adb (uiautomator, logcat) |
| Adaptive cap | **First build:** HLS climbed to 2560×1440 within 15 s (the 7 Mbit/s bitrate guess did not hold). **Fixed:** the cap is now the highest declared bitrate at or below 1080p from the loaded tracks (`adaptiveBitrateCap`). Re-run: 360p → 720p → 1080p, no 1440p within about 90 s of playback (release-like and debug runs); no decoder error | agent, adb (logcat `VideoDecWraper` sizes) |
| Overlay focus | **First build:** the overlay showed but focus fell to the covered Shell (`nav/home`) when the surface turned non-focusable. **Fixed:** every player focus request is repeated two frames later unless focus arrived (as the modal host). Re-run: OK on the surface → paused, overlay, focus `player/timeline`; ↓ → `player/playpause` («Воспроизвести»); → stays; ↑ → the timeline | agent, adb (uiautomator while paused: a dump waits for idle and takes ≈ 7 s, longer than the 5 s auto-hide while playing) |
| Seek | → ×3 injected in one burst on the timeline: bubble «2:29» from 2:09 (+5, +5, +10), one seek; 2 s later the elapsed time reads 2:29 and the bubble is gone. Near the start the bubble aligns with the track start (screenshot) | agent, adb (screencap) |
| Auto-hide | While playing the overlay hid after ≈ 5 s (screencaps); while paused it stayed | agent, adb (screencap) |
| Back order | Overlay shown (paused) → Back hides it, focus `player/surface`; Back again → Пост, focus `post/<id>/primary` («Смотреть»). From a MediaRow: Stop → Пост, focus on that row. ExoPlayer released and audio focus abandoned on exit | agent, adb (uiautomator, logcat) |
| Media keys (injected) | `KEYCODE_MEDIA_PLAY_PAUSE` → paused + overlay; `MEDIA_FAST_FORWARD` → bubble 0:06 (+5 from 0:01); `MEDIA_STOP` → exit to the row. **Injected only:** the pinned remote has no media keys | agent, adb |
| CDN headers (debug build, `BoostyNet` log) | One open and ≈ 25 s of playback: `*.vkuser.net` 22 requests and `*.okcdn.ru` 1, all `authorization=no`, status 200; `images.boosty.to` 13 `authorization=no`; `api.boosty.to` 5 `authorization=yes`. Only hosts and flags are logged | agent, adb (logcat) |
| Owner check (physical remote) | Picture and sound: OK. **Hold: no repeat on the pinned remote** (holding → does not accelerate; owner, physical remote), so the quick-press acceleration stays. Findings fixed afterwards (host-tested, release-like build reinstalled for the owner's re-check): OK during a pending seek paused the video → now it commits the pending target at once and keeps playing (OK toggles only with no pending seek; the Play/Pause key commits a pending seek, then toggles); the controls row is centered under the timeline; a generic video title («Video», «Видео», «Видео N») is hidden (only the post title shows); the seek bubble never wraps (one line, a 120 dp box) | owner, physical remote |
| Hold-to-seek, native keys (review fix, owner decision) | React Native gives JS no repeat for a held ← → (owner, physical remote), so `MainActivity` forwards D-pad LEFT/RIGHT key down (with `repeatCount`) and key up through `SeekKeysModule` while the Player is the focused route. Debug build, `BoostySeekKeys` log (key, action, repeat count only): `adb shell input keyevent --longpress 22` → `down repeat=0`, `down repeat=1` (≈ 540 ms later), `up` — so repeats do reach the native layer for an injected long press; the player sought and committed on release. `sendevent` on `/dev/input/event5` («Chromecast Remote») is **denied** (SELinux; shell has the `input` group, write still refused); `input keyevent --duration` is not supported on this build. **A real hold on the physical remote is not verified yet: the owner must retry hold-to-seek** on the reinstalled release-like build | agent, adb (debug build, logcat) |
| CDN cookie flag (review fix) | `BoostyNet` now also logs `cookie=yes/no` (no values): `*.okcdn.ru` `authorization=no cookie=yes` (the CDN's own cookie from the shared jar) | agent, adb (debug build) |
| Log hygiene | After the debug run: logcat matches for `sig=`, `srcIp=`, `expires=`, `okcdn.ru/`, `vkuser.net/`, `Bearer <value>` → 0 | agent, adb |

Not verified on the device:
- A two-video post: none was found in the first ≈ 50 rows of Главная or the first ≈ 12 rows of each of the 3 authors (host-tested: «Смотреть · Видео 1» opens video 1).
- The entry guard with the physical remote (an injected OK arrives long after mount); the error states («Не удалось воспроизвести видео», «Нет доступа к этому видео», «Видео недоступно»), buffering spinner and arbiter: host only (no way to provoke them safely on the device).
- Picture and sound (not captured by screencap): the owner must look.
- TalkBack.

Host tests: `__tests__/playerFlow.test.tsx` (26 tests, every matrix row: open from a row and from «Смотреть», ids-only params, the fresh E8 with the content profile, HLS / DASH / 1080p progressive, loading, no usable URL with one E8 per «Повторить», locked, 404 / gone, E8 failure with a busy held «Повторить», a start failure with a new engine, the overlay contents, the video title rule, seek ×3 with acceleration, one commit and in-flight build-up, key up only, ← → on play/pause, the entry guard, media keys, auto-hide (not paused, not seeking), Back order and origin focus, «Смотреть» origin, the 500 ms spinner, the end without autoplay, the arbiter, no URL in logs or the post query, the live E8 shape), `postFlow.test.tsx` (the flag off/on rows), unit tests `videoSources.test.ts` (the §6 table, empty/unknown/malformed entries, `videoSources` ok/locked/unavailable/no source/errors, the Post without sources), `mediaResolver.test.ts` (source order), `seekController.test.ts` (fake timers), `playbackArbiter.test.ts`, `playerEngine.test.ts` (integer seconds, the adaptive cap), `MediaRow.test.tsx` (OK only while playable), `phaseFlags.test.ts` (`player: true`), `debugNetLog.test.js` (the interceptor only in `src/debug`). Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` 1335 passed, run 10×: 9 runs 1335/1335, one run reported 1322/1322 (its suite line was not captured; not reproduced in 7 later runs); `playerFlow` + `postFlow` 30/30.

### Story 4.2 — Progress is saved and playback resumes, 2026-10-28

**Status: implemented, host-tested and checked on the device by the agent over adb (release-like build, owner's session, 2026-10-28); live E9 with the content profile confirmed by the owner on the website.** Not checked: the physical remote, a multi-video post (the owner knows of none; host-tested only), TalkBack.

**Dependency:** `@react-native-async-storage/async-storage` 3.1.1 (exact, `package.json` + `package-lock.json`; published 2026-05-29). v3 API: one database per scope via `createAsyncStorage` (`boostytv-device`, `boostytv-account`), behind the `KeyValueStore` port (`src/shared/platform/keyValueStore.ts`, adapter `asyncKeyValueStore.ts`). Its Android module needs Kotlin ≥ 2.1 (project: 2.2.0, KSP 2.2.0-2.0.2 picked by its config) and pulls `shared-storage-android` 1.0.1 and Room 2.7.2 from Maven Central. Jest uses the root manual mock `__mocks__/@react-native-async-storage/async-storage.js` (the package's own `./jest` mock is ESM and not transformed).

**Build (host only):** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL. The unsigned release APK's dex contains the `org.asyncstorage` classes; its Hermes bundle has the E9 path and the account database name, and no `createDemoSessionManager` / `demo-access-token` (also `__tests__/releaseBundle.test.js`). Then signed release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo) and installed with `adb install -r` over the previous build (session kept); it is the installed build now.

Device checks (pinned Chromecast with Google TV 4K, release-like build, the owner's session, 2026-10-28; post = the first feed post, the owner's pick: one 1:13:30 video):

| Check | Result | Method |
|---|---|---|
| Before playing | «Смотреть», row status «Не начато» (server `timeCode` 0, no local entry) | agent, adb + screencap |
| Resume after exit | Played to ≈ 0:55, Back ×2 → Пост: «Продолжить» focused with «С начала» to its right, row «Осталось 73 мин» | agent, adb |
| Focus | → from «Продолжить» → «С начала»; ↓ → the MediaRow | agent, adb |
| Resume after a cold start | `am force-stop`, relaunch, the same post: «Продолжить» and the status from the persisted entry; «Продолжить» → 1:05 shown 10 s after OK, i.e. resumed at ≈ 0:55 (within ±10 s, SM-4) | agent, adb |
| «С начала» | Started at 0 (0:07 shown ≈ 8 s after OK); exit at ≈ 1:12 → focus back on «С начала» (the initiator) | agent, adb |
| Live E9 (content profile) | The website shows 1:14 for this video after the exit at ≈ 1:12 (the exit write, plus the ±1–2 s of the injected Back timing). The release build logs nothing, so the HTTP status is inferred from the website value | owner, website |
| Short visit (review fix, rebuilt and reinstalled) | Local entry at ≈ 1:48; «С начала» → exit at 0:01 → Пост still «Продолжить» / «Осталось 72 мин»; «Продолжить» → 1:53 shown 5 s after OK (resumed at ≈ 1:48): the short visit wrote nothing | agent, adb |
| Multi-video status | Not run: the owner knows of no post with two or more videos (none found in a year); host-tested only | — |
| Screenshot | The Post with «Продолжить»/«С начала» was left on the TV for the owner before the review | agent → owner |

Review fixes (2026-10-28, host-tested only): short visits write nothing (owner decision: a session writes no E9 and no local entry until it moved ≥ 10 s from its start or the user paused; a replay after the end is a new session); the local store's disk chain writes a change made during an in-flight write (also after a reset) and `flush()` waits for it; the demo keeps progress in an in-memory store (never the `boostytv-account` database); `begin` once per source resolution. New tests: 7 unit (short visits, disk chain), 4 `playerFlow` (finished → «Смотреть» → Back after 2 s keeps «Просмотрено» with no E9; a short replay; «Повторить» after an error resumes at the last position from «Смотреть» and «С начала», no new-engine t=0), 1 `postFlow` (a started video without a duration), 1 `demoFlow` (the demo never touches the real database).

Host tests: `src/shared/services/progress/__tests__/progressRepository.test.ts` (29: the finished rule and status, resume precedence, the 10 s cadence, one write in flight with the latest position, forced events, start over, seeks as movement, failure gating ≥ 10 s and the bounded automatic retry, expired hold/flush/drop, sign-out wipe, a late write after a reset, the debounced/forced disk write, cold-start load, corrupt disk, the 200-entry cap, the stale disk write undone, a load after a reset dropped, stable snapshots); `__tests__/playerFlow.test.tsx` «progress and resume (Story 4.2)» (10: server only with no pre-seek t=0 and the E9 request shape, local wins, finished, multi-video + start over, hold-scrub, background and end, the vanished «С начала» fallback, failure retry, cold start from the persisted entry, log hygiene); `__tests__/postFlow.test.tsx` (status and «Продолжить» only while the player is on); `__tests__/accountScopeRegistry.test.js` (`progress` registered); `demoFlow` (the row label now ends with the status). Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 1494 passed each; `playerFlow` + `postFlow` + the progress suite 30/30 (187 tests each run).

### Story 4.3 — Choose video quality, 2026-10-28

**Status: implemented, host-tested and checked on the device by the agent over adb (release-like build, owner's session, 2026-10-28); the owner reviewed the overlay and asked for the gear and ±10 controls, then for SVG icons (both done and re-checked).** Not checked: the physical remote, TalkBack, the Menu/Info keys (the pinned remote has neither), a pick the decoder cannot play (1440p).

What it adds: the controls row «−10 с» · play/pause · «+10 с» with a gear «Настройки» at its right end (owner decision 2026-10-28 after the device check of the first build, which had a «Настройки» text button right of play/pause); the ±10 and gear icons are SVG (owner decision 2026-10-28 after the Unicode «↺10»/«↻10» glyphs were unreadable on the device); OK on ±10 moves the seek target by exactly 10 s; a 340 dp right side sheet through the one modal host (`placement: 'end'`) with «Качество» and its radio submenu («Авто» for HLS/DASH, then every progressive height, highest first); a pick reloads the same E8's source at the current (or pending) second through the start gate and stores the device-scoped preference (`boostytv-device`, key `player.quality.v1`: `auto` or a height); the PlayerEngine port's `onResolution` (react-native-video `onBandwidthUpdate` with `reportBandwidth`, adaptive sources only) feeds «Авто · 1080p». **Dependency:** `react-native-svg` 15.15.5 (exact, `package.json` + `package-lock.json`; published 2026-05-11; README: RN ≥ 0.78; ADR 0013). Release build on react-native-tvos 0.87.1-1 (`./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a`, JDK 17, host only, 2026-10-28): BUILD SUCCESSFUL; the APK has `libreact_codegen_rnsvg.so`, the `com.horcrux.svg` classes and `RNSVG*` in the Hermes bundle; the 15.16.0 fallback was not needed. Jest mocks it (`__mocks__/react-native-svg.js`). The demo keeps the preference in memory.

Device rows to run (pinned Chromecast with Google TV 4K, release-like build, the owner's session):

| Check | Result | Method |
|---|---|---|
| Sheet (first build, text «Настройки») | → from play/pause to «Настройки», OK → the right sheet, focus «Качество», value «Авто · 1080p»; the dimmed overlay behind | agent, adb + screencap |
| «Авто · 1080p» | The suffix came from the engine (`onBandwidthUpdate`) on HLS | agent, adb |
| List | «Авто · 1080p», 1440p, 1080p, 720p, 480p, 360p, 240p, 144p for the owner's first feed video | agent, adb |
| Pick «720p» | Picked at 2:40 → 2:42 shown 4 s later (same second, reload), focus «Настройки»; the sheet then read «720p»; audio playing | agent, adb + dumpsys audio |
| Back order | Sheet open: Back → sheet closed, focus «Настройки» → Back → overlay hidden → Back → Пост | agent, adb |
| Cold start | `am force-stop`, relaunch, same video → the sheet reads «720p» (preference persisted) | agent, adb |
| Gear and ±10 (after the owner change, SVG build) | Row «−10» · play/pause · «+10» centered, gear at the bottom right; icons crisp (circular arrows with «10», gear), focused control inverted; → → from play/pause reaches the gear | agent, adb + screencap; owner reviewed |
| −10 | OK on −10 at 9:18 → bubble 9:08 → playback continued at 9:10 | agent, adb |
| Owner screenshots | The overlay and the sheet were shown to the owner on the TV | owner |
| Overlay focus (after the review patches) | ↓ from the timeline → play/pause; → → → the gear with no seek (time ran 16:12 → 16:18 unchanged); ← from the gear → +10; ↑ from the gear → the timeline | agent, adb + screencap |
| 1440p progressive | Picked by accident during a scripted run, stored after its `onLoad`, survived a cold start and played (time advancing, audio on): progressive 1440p decodes on the pinned device (the Story 1.6 failure was adaptive HLS 1440p AVC High) | agent, adb + dumpsys audio |
| Back to «Авто» | Picked «Авто» → the sheet then read «Авто · 1080p»; the owner's TV is left on «Авто» | agent, adb |


Host tests: `__tests__/playerFlow.test.tsx` overlay rows (the controls row layout, labels and SVG icons, ±10 s accumulate/commit/clamp, raw and native ← → never seeking on any control) and «quality (Story 4.3)» (every matrix row — open, list, progressive only, auto suffix, pick at 5:12 with no E9 of 0 and the session continuing, stored preference with and without that height, Back order, keys behind the sheet, Menu/Info — plus a pick during a pending seek, a pick before the first `onLoad` and during the initial resume seek (the resume point kept), a pick during a held scrub (resumes), the preference stored only after the picked source loaded (never after a start failure), re-picking the selected row, «Авто» clearing the height and its suffix, a junk stored value, an engine error closing the sheet, no URL in the preference or logs); `src/features/player/__tests__/mediaResolver.test.ts`; `qualityPreference.test.ts`; `seekController.test.ts` (fixed step); `src/shared/platform/__tests__/PlayerEngineView.test.tsx` (`onResolution`); `src/shared/ui/__tests__/icons.test.tsx`; `shellPrimitives.test.tsx` and `surfaceRules.test.tsx` (SettingRow radio). Lint, typecheck, `check:fixtures`, the full suite ×3 and the 30× runs: see the coordinator's final verification for this story (counts not recorded here).

### Epic 3 retro A6 — check the session before showing locked content, 2026-10-27

`spec-epic-3-retro-a6-locked-session-check.md`: the SessionCheck port (`src/shared/api/sessionCheck.ts`, provided by `App`) runs E1 before the player's fresh E8, the Post screen's E8 or Главная's all-locked page 1 is trusted as «locked» (api-contract §7 «Client handling of locked»).

**F5 live check (debug build):** `assembleDebug -PreactNativeArchitectures=armeabi-v7a` installed with `adb install -r` over the release-like build (session kept), Metro on port 8097 via `adb reverse tcp:8081 tcp:8097` (the other Metro on host 8081 was not touched; the mapping was restored to `tcp:8081 tcp:8081` afterwards). A temporary debug-only counter in `PostRepository` logged, per E4/E5 page, only the number of posts with `hasAccess: true` and an empty or missing `data` and their ids. Cold start (`E1 ok`), then ↓ through Главная (37 E5 pages) and the 3 subscribed blogs (23 E4 pages): every page logged 0. The counter was removed before the commit (the release Hermes bundle: `accessEmpty` 0, `TEMP-A6` 0).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL; release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`; it is the installed build now. Nothing uninstalled or cleared; no sign-in, no sign-out.

Smoke (agent, adb injected keys + uiautomator + screencap, release-like build, owner's session, Chromecast with Google TV 4K): cold start → Главная, focus on the first feed card; OK → Пост («Смотреть» focused), Back → the same card; Подписки → «Илья MJTV Соколов» → Автор (locked cards «Нет доступа» shown, no A11) → OK on a locked post → Пост with the header and «Нет доступа. Этот пост доступен подписчикам уровня …», focus on the author row; 10 s later still there, no A11; Back → the same Автор card → the tile → `nav/subs`. The E1 sent by the check is not visible in a release build (no JS logs); only its absence of effect was observed. The dead-session and silent-refresh paths were not provoked on the device (host-tested only). The silent-refresh path was not run either: the only debug hook (`debugCorruptAccessToken`, Настройки «Проверка обновления сессии») corrupts the in-memory token **and runs E1 at once**, so the refresh happens before a locked post can be opened; reproducing the A6 path would need a SessionManager change, which this spec forbids. Known gap (by design): the session-check window is per trigger point, so a session that dies within 5 min after an `ok` is noticed only after the window or on the next resume E1.

Review fixes (host-tested only, 2026-10-27): a failed or skipped E1 no longer keeps the window; `refetch` goes only to a still-mounted caller; a clock moved back ends the window; the hook catches; a failed post-`ok` E8 refetch keeps «Нет доступа к этому видео»; the player's immediate focus request also requires `isActive()`. New flow tests: page 2 all locked (no E1), page 1 all locked during the cold-start E1 (one shared E1; refetch / A11), focus kept across the silent-refresh feed refetch, a cached locked post within `staleTime` (no E1), the failed player refetch, exact E1 counts in the offline cases.

Host: lint (`--max-warnings 0`), typecheck, check:fixtures clean; `npm test` ×3: 1454 passed each (after the review fixes); `playerFlow`, `postFlow`, `homeFeedFlow`, `authorFlow` + `sessionCheck.test.ts` 30/30. Not checked with the physical remote.
