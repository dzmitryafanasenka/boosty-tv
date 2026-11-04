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

## Device rules (agent over adb)

Rules for every device run that drives the app with injected keys, own or delegated. Epic 7 retro A6 collected them from earlier slips.

- **The app is in the foreground before every key batch.** Check the resumed activity before each batch of key events: `adb shell dumpsys activity activities | grep -i resumed`, or `adb shell dumpsys window | grep mCurrentFocus`. It must name the package `io.github.dzmitryafanasenka.boostytv`. After an app restart, a wake-up or a screensaver, check again. A batch sent while the Google TV launcher was in front put two OKs on the launcher's account chooser and «Заставка» (Story 7.4; the owner checked the TV: nothing changed).
- **Screenshot before every OK.** Read the focused element before pressing OK, from `adb exec-out screencap -p > shot.png` (kept in the scratchpad, never committed) or `adb shell uiautomator dump`. Stray OKs opened a player twice in Epic 5 (Stories 5.4, 5.7).
- **The owner's content and their progress.** Ask the owner first, or keep a playback of the owner's content short. The progress rule writes a session once it has moved 10 s or more from its start, or the moment the user pauses (`WRITE_MOVEMENT_SEC`, `src/shared/services/progress/progressRepository.ts`). So stay under 10 s and never pause. A timestamp-chip check that played 10 s or more overwrote the owner's resume point on a video (Story 6.3); a sleep test played the new feed head (Story 4.6).
- **An agent player visit is one command (Story 9.5).** On the owner's content, a player visit is a single shell command: OK, then a fixed `sleep` of 5 s or less, then Back. Nothing runs in between: no dump, no screenshot, no pause, no seek, no other key. Read the focused element before the command, and check the result after Back. The 10 s write threshold can then never be reached (Story 9.4: a visit with two dumps in the middle ran about 11 s and wrote a resume point). Steps that pause or seek the owner's video (the player overlay, the settings sheet, a quality change, resume) are done by the owner, or need the owner's OK for that write at that moment.
- **Settle before key batches in a sheet or list.** After Menu the settings sheet needs about 1 s before ↓ lands on its rows; a ↓ sent sooner is lost and the next OKs pick the wrong row (Story 8.1: quality «Авто» and speed 1.5× were stored by mistake, then restored). Repeated ←/→ events sent back to back act as hold-to-seek (one long jump to 0:00); space single seeks ≥ 1.3 s apart, and avoid seeks on the owner's content (a seek counts as movement).
- **Outward actions need the owner's approval.** That covers a poll vote, a like (E17) and a live heartbeat (E16). Never sign out, uninstall or clear app data; install with `adb install -r`.
- **No secrets in device logs.** Temporary probes log counts, types and key sets only, never names, URLs, tokens or signed values. Remove every probe before the commit, and check that it is gone from the release bundle. Grep the built Hermes bundle for the probe's marker and expect a count of 0, as the story sections record (for example «`TEMP75` 0»).
- **Check where focus went after the first key of a batch.** On a freshly rendered screen the first ← toward the sidebar was sometimes lost, and the following ↓ keys moved through the grid instead (Story 8.3, Epic 8 retro A3 runs; nothing opened because no OK followed). Screenshot after the first key, then continue.

## Platform probes before the spec (Epic 8 retro A6)

A story that depends on Android platform behaviour probes that behaviour on the pinned device while its spec is written, before the spec checkpoint. Platform behaviour here means intents and the chooser, package visibility, storage paths, permissions, `run-as` and the release build's flags. In Epic 8 the planning text was wrong twice, and both times it was found only on the device:
- 8.2 assumed the system chooser lists the installed players. On the pinned Google TV, `queryIntentActivities` with `MATCH_DEFAULT_ONLY` returns only `com.android.tv.frameworkpackagestubs`, and the plain chooser lists no targets. That cost three probe builds after implementation.
- 8.3 assumed internal storage can be pulled over adb. One `adb shell run-as io.github.dzmitryafanasenka.boostytv ls` at spec time showed the release build is not debuggable, and the owner chose the app-specific external files dir before any code.

How to probe:
- **Shell first.** Use `pm query-activities`, `dumpsys package <pkg>`, `run-as`, `ls /sdcard/Android/data/…` and `getprop ro.build.version.sdk`. Remember that adb shell sees more than the app does: `pm` lists activities that the app's own query may not return.
- **Then from inside the app, when the question is what the app sees.** Add a temporary probe in the native module that logs counts and package names only (no URLs or user data) to `logcat` under a marker tag. Build release-like, read it with `adb logcat -s <TAG>`, and remove the probe before the commit (see «No secrets in device logs»).
- **Record the result in the spec**, as a Code Map note or an Open Question for the owner, so implementation starts from the device's real behaviour.

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
| Variants | `debug`: debuggable, cleartext on (Metro only), signed with the local SDK debug keystore. `release`: cleartext off; signed by Gradle with the owner's key when all four `BOOSTYTV_RELEASE_*` properties are in `~/.gradle/gradle.properties`, unsigned otherwise (CI). See [release.md](release.md). |
| Version | `versionName` `MAJOR.MINOR.PATCH` (first release `0.9.0`), `versionCode` = `MAJOR*10000 + MINOR*100 + PATCH`; tags `v{versionName}` ([release.md](release.md)) |
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
# Story 9.2 ABI splits: app-<abi>-<type>[-unsigned].apk plus app-universal-<type>[-unsigned].apk
aapt dump badging app/build/outputs/apk/debug/app-universal-debug.apk   # leanback-launchable-activity + banner
aapt dump xmltree app/build/outputs/apk/release/app-universal-release-unsigned.apk AndroidManifest.xml
```

Device install and launch (owner connects the Chromecast over network `adb`):

```sh
adb pair <chromecast-ip>:<pairing-port> <code>   # once, from «Беспроводная отладка» → pair with code
adb connect <chromecast-ip>:<debug-port>
adb install -r android/app/build/outputs/apk/debug/app-armeabi-v7a-debug.apk   # the Chromecast's split (or app-universal-debug.apk)
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
| JS stack keeps covered screens mounted (memory unmeasured on a 32-bit device with ~350 MB free) | Memory pressure with Shell + Post + Player | Story 9.3: measured, no steady growth over 1 h (PSS 326–356 MiB after 20 min) |
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
| `./gradlew assembleDebug` | BUILD SUCCESSFUL, `app-debug.apk` (before the 9.2 ABI splits) |
| `./gradlew assembleRelease` | BUILD SUCCESSFUL, `app-release-unsigned.apk` (before the 9.2 ABI splits) |
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

Review fixes (2026-10-28, host-tested only): short visits write nothing (owner decision: a session writes no E9 and no local entry until it moved ≥ 10 s from its start or the user paused; a replay after the end is a new session); the local store's disk chain writes a change made during an in-flight write (also after a reset) and `flush()` waits for it; the demo keeps progress in an in-memory store (never the `boostytv-account` database); `begin` once per source resolution. New tests: 7 unit (short visits, disk chain), 4 `playerFlow` (now in `playerProgressFlow`; finished → «Смотреть» → Back after 2 s keeps «Просмотрено» with no E9; a short replay; «Повторить» after an error resumes at the last position from «Смотреть» and «С начала», no new-engine t=0), 1 `postFlow` (a started video without a duration), 1 `demoFlow` (the demo never touches the real database).

Host tests: `src/shared/services/progress/__tests__/progressRepository.test.ts` (29: the finished rule and status, resume precedence, the 10 s cadence, one write in flight with the latest position, forced events, start over, seeks as movement, failure gating ≥ 10 s and the bounded automatic retry, expired hold/flush/drop, sign-out wipe, a late write after a reset, the debounced/forced disk write, cold-start load, corrupt disk, the 200-entry cap, the stale disk write undone, a load after a reset dropped, stable snapshots); `__tests__/playerProgressFlow.test.tsx` «progress and resume (Story 4.2)» (10: server only with no pre-seek t=0 and the E9 request shape, local wins, finished, multi-video + start over, hold-scrub, background and end, the vanished «С начала» fallback, failure retry, cold start from the persisted entry, log hygiene); `__tests__/postFlow.test.tsx` (status and «Продолжить» only while the player is on); `__tests__/accountScopeRegistry.test.js` (`progress` registered); `demoFlow` (the row label now ends with the status). Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 1494 passed each; `playerFlow` + `postFlow` + the progress suite 30/30 (187 tests each run).

### Story 15.2 — Account name next to «Выйти из аккаунта», 2026-11-04

**Status: implemented, host-tested and checked on the pinned TV (2026-11-04, release-like build `assembleRelease` armeabi-v7a, still 1.2.0, `adb install -r`, session kept): the agent over adb with screencaps (the name value is not recorded here) before the review patches; after them the owner looked at Настройки on the rebuilt build (owner: «все ок»). After the review patches: lint, typecheck, `check:fixtures` clean; full `npm test` 3683/3683; `assembleRelease` OK, no probe marker in the bundle.** `spec-15-2-account-name-in-settings.md`, our improvement IMP-10 (FR-66). E1 `name` evidence: the probe of 2026-11-04 (`docs/api-contract.md` §3 E1, keys and types only). Focus: `docs/focus-map.md` «Story 15.2» (unchanged ids and order).

Host tests:
- `src/shared/entities/user/__tests__/userRepository.test.ts` (Story 15.2 cases): the fixture's `name`; a missing, `null`, number, object or array `name` is absent and never a parse failure (`blogUrl` still read); `accountDisplayName`: missing, empty, blank → null, trimmed, phone-like values (`+7 900 123-45-67`, `8 (900) 123 45 67`, 7+ digits only) → null, six digits, letters with digits and nicknames kept; `UserRepository.current` maps padded, blank, phone-like and non-string names.
- `__tests__/accountNameFlow.test.tsx` (20) through the App over FixtureTransport, one per matrix row: the name right-aligned and spoken with the label, one E1 on a cold cache, the row order, role and dialog unchanged, the phone never shown, the name never in the log ring; trimmed; missing, empty, blank, number, `null` and object names and three phone-like names → the row as before; E1 pending, failed (no error UI; leaving and coming back sends no new E1) and with no valid id → the row as before, still signed in; Подписки filled `me` → the name with no extra E1; sign-out → sign-in as B → B's name (asked with B's token), none when B has none, none while B's E1 is pending, A's never; an 80-character name on one line (`numberOfLines` 1, the value shrinks) with no description line.
- Updated: `signOutFlow` (the row's spoken label with the fixture's `redacted` name), `subscriptionsFlow` (the `me` data has `name`; Epic 5 retro A3: «Обновить» after visiting only Настройки sends one more profile E1 and no E3/E4 when `me` has no `blogUrl`, no E1 when it has one, and no E1 with `myBlog` off), `sessionFlow` and `expiredFlow` (request counts after Настройки' own E1).
- Host tests do not prove native layout, ellipsis or the focus ring.

Device checks (release-like build on the pinned TV, 2026-11-04; checked by the agent over adb with screencaps before the review patches; the owner checked the first row on the rebuilt build):

| Check | Result | By |
|---|---|---|
| Настройки: «Выйти из аккаунта» shows the account name on the right of the same line, the row height and order unchanged; never the phone number | 2026-11-04: as described (the owner's display name, right-aligned like «1.2.0»; no phone). Owner on the rebuilt build: «все ок» | agent (adb + screencap), owner |
| Focused «Выйти из аккаунта» with the name: the ring and scale are not clipped; the label is not truncated | 2026-11-04: as described with the owner's short name. A long name's ellipsis: not checked on the device (host tests only) | agent (adb + screencap) |
| OK on the row still opens the sign-out dialog with focus on «Отмена»; Back closes it with focus on the row | 2026-11-04: as described; the sign-out itself was not confirmed (closed by Back) | agent (adb + screencap) |
| The name is not in `adb logcat` | 2026-11-04: no match | agent (adb) |

### Story 15.1 — «О приложении» and «Сообщить о проблеме», 2026-11-04

**Status: implemented, host-tested and checked on the pinned TV (2026-11-04, release-like build, owner-signed, still 1.2.0 / 10200, `adb install -r`, session kept): the agent walked the rows and both dialogs over adb with screencaps; the owner scanned both QR codes with a phone (owner: «все работает»). The device reports `Google` / `Chromecast` / `14`. Not re-checked on the device: the «Версия» gestures (host tests only). After the review patches: lint and typecheck clean, full `npm test` 3626/3626, `assembleRelease` (armeabi-v7a) BUILD SUCCESSFUL with the `settings/row/about` marker in the bundle.** `spec-15-1-about-and-report-a-problem.md`, our improvement IMP-09 (FR-66). Focus: `docs/focus-map.md` «Story 15.1».

Host tests:
- `src/features/settings/__tests__/reportIssueUrl.test.ts` (10): the repository page; the bug form URL with `version` and `device`; reserved characters and non-ASCII encoded (decoded back exactly); an unknown or blank version or device leaves its parameter out; only `template`, `version` and `device` are sent; the template file exists and declares `id: version` and `id: device`.
- `src/shared/platform/__tests__/deviceInfo.test.ts` (17): «Manufacturer Model, Android Release»; a model that already names the manufacturer as a whole word (followed by the end, a space, `-` or `_`) is not repeated, «LG» + «LGenius» keeps both; each missing or blank part left out; values trimmed; null when nothing is known or the values are not strings; the default read of a stubbed `Platform.constants`.
- `__tests__/aboutReportFlow.test.tsx` (12) through the App (the QR renderer records its values; the device adapter is faked): the row order and «Версия» as the initial focus; About: the copy, the repository QR, «Закрыть» the only focus target and focused, the background hidden; «Закрыть» and Back close it with focus on the row; «Версия неизвестна»; a QR that cannot be drawn shows «Не удалось показать QR-код» and «Закрыть» still closes; the report QrDialog with the exact URL (no account id or token in it), the URL never in the rendered text or the log ring; «Закрыть» and Back close it with focus on the row; no `version` / no `device` when unknown; the seven-press «Версия» gesture still opens Diagnostics after the About dialog was closed.
- Updated: `__tests__/signOutFlow.test.tsx` (the Настройки row order).

Device checks (release-like build on the pinned TV; all to check):

| Check | Result | By |
|---|---|---|
| Настройки rows in order: «Системный видеоплеер», «Версия» (focused), «О приложении», «Сообщить о проблеме», «Выйти из аккаунта»; ↑ ↓ move between them | 2026-11-04: as described | agent (adb + screencap) |
| OK on «О приложении»: the dialog with «Boosty TV», «Версия 1.2.0», the disclaimer, «Лицензия MIT», the QR, «Откроется на телефоне», focus on «Закрыть»; legible, nothing clipped | 2026-11-04: as described | agent (adb + screencap) |
| «Закрыть» and Back close the About dialog, focus back on «О приложении» | 2026-11-04: Back checked, focus back on the row | agent (adb + screencap) |
| OK on «Сообщить о проблеме»: the QrDialog «Сообщить о проблеме», focus on «Закрыть»; «Закрыть» and Back return focus to the row | 2026-11-04: dialog and focus as described; closed by the owner | agent (adb + screencap), owner |
| The About QR scanned with a phone opens the repository page | 2026-11-04: works | owner |
| The report QR scanned with a phone opens the GitHub bug form with «Версия приложения» and «Устройство» filled in (version, manufacturer model, Android release) | 2026-11-04: works | owner |
| «Версия»: one OK still runs the update check; seven quick OKs still open Diagnostics | Not checked on the device (host tests) | — |

### Story 14.2 — Sleep timer, 2026-11-03

**Status: implemented and host-tested; partly checked on the pinned TV by the owner with the physical remote (release-like build, owner-signed, still 1.2.0 / 10200, `adb install -r`, session kept): «Таймер сна» → «15 мин» starts the countdown in the overlay; at T−60 s the overlay opened with focus on «Ещё 15 мин»; OK extended the timer (the indicator showed about 15:5x) and playback went on; at the next deadline, without OK, playback paused (owner: «пауза сработала»). Not checked on the device: «До конца видео», the live gear, the screensaver after a pause (host tests only; deferred-work entry for the screensaver). Full `npm test` 3587/3587 (twice), lint and typecheck clean.** `spec-14-2-sleep-timer.md`, our improvement IMP-08 (FR-64). Focus: `docs/focus-map.md` «Story 14.2».

Host tests:
- `src/features/player/__tests__/useSleepTimer.test.tsx` (17; the 7 newest for the warning and `pausedByTimer`: at T−60 s once, «Ещё 15 мин» +15 min and a new warning, `canWarn` false at T−60 s re-checked until it holds, none when it only holds in the last 10 s, a manual pause ends it, none for «До конца видео», the notice flag set by a pausing fire or the end hold and cleared by playing): labels and the offered choices; seconds left rounded up; «Выкл» by default; a fixed pick fires once after its real time (monotonic clock), then «Выкл»; a device clock change forward or back neither fires it early nor delays it; «Выкл» cancels and a new pick restarts; unmount and a new reset key (another video) cancel; «До конца видео» never fires and is held at the end once, then «Выкл»; a fixed timer is not held.
- `src/features/player/__tests__/PlayerSettingsSheet.test.tsx` «Story 14.2» (5): the row last, its submenu rows and initial focus; no «До конца видео» when not offered; a chosen «До конца видео» no longer offered stays listed, checked and focused; the row shows the current choice and the submenu focuses it; a live sheet without a quality choice has «Таймер сна» only, focused.
- `src/features/player/__tests__/PlayerOverlaySleep.test.tsx` (9; plus the warning row: «Ещё 15 мин» focusable with its a11y label and in `PLAYER_CONTROL_IDS`, «Пауза через 1:00» ticking and replacing the line, OK → extend; the notice only with `sleepNotice`): none without a timer; «Таймер сна · 30:00» ticking each second, tabular, not focusable, no live region, in the top band; hours for 60 and 90 min, never below 0:00; «до конца»; live; a new deadline shows its own time left at once (no stale clock); a device clock change does not move it.
- `__tests__/playerSleepFlow.test.tsx` (33) through the App; the review fixes (7): the warning announced once per warning (TalkBack); paused at T−61 s and resumed at T−50 s → the warning starts then; ↑ on the timeline during the warning → «Ещё 15 мин», also with chapters (the strip does not open); the chapter strip open at T−60 s holds the warning back, it starts after the strip closes; a deferred fire after the viewer's own pause and one during a lifecycle hold show no notice; «Fires in the background» asserts the exact E9 writes (one `background` write, none at the fire). The warning block (8): T−60 s → the overlay opens, focus «Ещё 15 мин», «Пауза через 1:00» counting down, no auto-hide, without OK the pause at T with one E9 and «Пауза по таймеру сна», play removes it; OK → the new time left, focus → the timeline, auto-hide resumes, the pause 15 min later; the sheet open at T−60 s → no warning, the fire still closes it and pauses; the sheet opened during the warning → the countdown goes on, focus back to «Настройки»; a manual pause ends the warning, the later fire writes nothing and shows no notice; Back hides the overlay, shown again without a focus steal; «До конца видео» has no warning and shows the notice at the end hold; a deferred fire on the error screen → «Повторить» paused with the notice. Also with fake timers and `jest.setSystemTime`: a fire during a quality-switch load (the switched source stays paused, no extra write before its start position), during an error recovery (the recovered source starts paused) and on the error screen («Повторить» starts paused); every row of the spec's I/O matrix (pick 30 мин; fires while playing → one `pause` E9 at the position; fires while paused and in the background → no extra E9; fires during a hold-scrub → cancelled, no seek, one `pause` E9; fires with the sheet open → closed, focus «Настройки»; «Выкл»; «До конца видео» → `end` E9, stays paused with the overlay, replay «Выкл», Back exits; not offered without a duration; leave and a new Player → «Выкл»; live with one quality → gear, «Таймер сна» only, a plain pause with no E9), the Back order and the unchanged default exit at the end.
- Updated: `liveFlow`, `playerSpeedFlow`, `playerQualityFlow` (the sheet's rows end with «Таймер сна»; the live gear now shows), `playbackMode.test.ts` (`qualityShown`).

Host run after the re-review fixes (2026-11-03): `npx jest src/features/player __tests__/player __tests__/liveFlow` 31 suites, 521/521; `tsc --noEmit` and eslint on the changed files clean. After the warning and notice: 31 suites, 513/513; `tsc --noEmit` and eslint on the changed files clean. Earlier, after the review fixes: the four Story 14.2 suites 41/41; `npx eslint src/features/player __tests__/playerSleepFlow.test.tsx` and `tsc --noEmit` clean (the full `npm test` runs on the coordinator's side; before the fixes it was 3557/3557).

Device checks (release-like build on the pinned TV; all to check):

| Check | Result | By |
|---|---|---|
| D-pad path: overlay → ⚙ «Настройки» → «Таймер сна» → submenu (Выкл, 15/30/60/90 мин, «До конца видео»), the checked row focused; a pick closes the sheet with focus on «Настройки» | To check | agent (adb) → owner |
| Indicator «Таймер сна · 15:00» in the top band, counting down, legible, no layout shift | To check | agent (adb) → owner |
| A 15 мин timer fires: the video pauses at that position, the overlay shows, the resume point on Пост is that position | To check | owner |
| «До конца видео» started near the end: at the end the player stays paused on the last frame with the overlay; Back → Пост, the video marked «Просмотрено» | To check | owner |
| Live: the gear shows, the sheet has «Таймер сна» (no «До конца видео»); a fire pauses the stream | To check (needs a live stream) | owner |
| Warning: one minute before a 15 мин timer the overlay opens with focus on «Ещё 15 мин», «Пауза через 0:59» counts down, the overlay stays up | To check | agent (adb) → owner |
| OK on «Ещё 15 мин»: the indicator shows ~15:59, the overlay hides after 5 s, the pause comes 15 min later | To check | owner |
| Back during the warning hides the overlay; ↑ shows it again with the warning, focus on the timeline; ↑ again → «Ещё 15 мин» | To check | owner |
| TalkBack on: the warning is announced once («Пауза через минуту. Ещё 15 минут — OK») | To check (optional) | owner |
| After a timer pause the top band shows «Пауза по таймеру сна»; play removes it | To check | agent (adb) → owner |
| After a sleep-timer pause the TV's screensaver / sleep still engages (the paused player does not keep the screen on) | To check | owner |
| A timer running while the TV goes to standby and back: the player is paused, no second write (the monotonic clock may not count deep sleep; the player is paused either way) | To check | owner |

### Story 14.1 — «Закончится в H:MM» in the player overlay, 2026-11-03

**Status: implemented and host-tested; checked by the owner on the pinned TV with the physical remote (release-like build): the end time shows next to the remaining time, follows a speed change, and the layout is fine («все ок»).** `spec-14-1-end-time-in-player-overlay.md`, our improvement IMP-07 (FR-65). Focus is unchanged (the line is plain text, not focusable).

Tests: `src/features/player/__tests__/PlayerOverlayEndTime.test.tsx` (11): `endTimeMs` at 1×, 1.5× and 0.5×, past midnight («0:10»), at/after the end (now), unknown duration or rate → null; the overlay shows «Закончится в 21:50» next to «−50:00», follows a speed change and a position change, moves on with the timer while paused (two minutes → 21:52, tick ≤ 60 s), hidden without a duration and on live, not focusable and no live region. The system time is set with the local `Date` constructor, so the assertions do not depend on the host zone. A minute-edge test (raw ends around 21:50:00) fails without the 20 s hysteresis and passes with it; `remainingWallMs` / `stableEndTime` unit tests.

Device: release-like build (owner-signed, still 1.2.0 / 10200, `adb install -r`, session kept); the agent's adb capture could not show the overlay (video surface black, overlay hidden at start; a < 10 s play without pause, no progress written); the owner's remote check passed. `npm run lint`, `npm run typecheck` clean; full `npm test` 3523/3523.

### Story 12.5 — «Продолжить просмотр» as a launcher channel, 2026-11-03

**Status: implemented and host-tested; checked on the pinned TV (Aero TV 1.32) by the agent over adb and by the owner with the physical remote: the video card appears in Aero, OK continues the video in the Player, Back lands on Главная, «Очистить всё» turns the card into «Откройте Boosty TV» (owner: «работает», «все работает»).** `spec-12-5-continue-history-launcher-channel.md`, our improvement IMP-04 (FR67), ADR 0016. Focus: `docs/focus-map.md` «Launcher entry».

Host tests:
- `src/shared/platform/__tests__/launcherChannel.test.ts` (6): the port without the module (`unsupported`, no open), the flat card shape (an empty author → no description, the neutral card without ids or poster), `unsupported` / unknown / rejection outcomes (never thrown), the pending-open mapping (`media` with unvalidated ids, `home`, anything else null).
- `src/app/__tests__/launcherChannel.test.ts` (19): first run → the neutral card under «Продолжить просмотр»; no sync before the disk is read; 3 entries → 3 cards newest first with the Continue title rule, author and poster (finished and unstarted left out); a poster with a query → the banner; the 20-card cap; progress ticks → no sync; new, reordered, removed, finished and «Очистить всё» → one sync each (empty → neutral); a failure logged with outcome and count only, the next change retries; a failed sync of an unchanged list is sent again on the next return to the foreground (once); a failed wipe-time neutral sync is sent again on the next foreground; one sync at a time with only the latest list after it; the AccountScope wipe → the neutral card, the queued old-account list never sent, the next account's empty disk → no extra sync; a request under an older generation dropped; a failed neutral sync does not fail the wipe; disabled (demo) → never written; stopped → no sync.
- `src/app/__tests__/launcherOpen.test.ts` (9): what a card opens: none / signed out → nothing; neutral → Главная; a ref in the Continue view → the Player (after the store was read); finished, removed, foreign or partly matching → Главная; malformed → Главная without reading the store; the player phase off → Главная; signed out while reading → nothing; the Shell's one-time content-return handshake.
- `__tests__/launcherOpenFlow.test.tsx` (11) through the App with a fake native module: the history published newest first and «Выйти» → the neutral card; cold start with a valid card → `[Shell, Player]` with the Continue params, the engine seeks to the resume point, Back → `[Shell]` with focus on that card (fails without the Shell handshake: `nav/home`); warm start from Настройки and from Пост → the stack replaced, Back → the card; a warm start while Player A plays → `[Shell, Player B]`, A's last position kept, Back → B's card; stale / foreign / malformed refs → `[Shell]`; crafted `boostytv://` links on a warm start (a foreign blog, a video not in the history, a non-string id, an unknown host or missing params as answered `home` by the native side) → a fresh `[Shell]`, never the Player; a finished video while the Player is open → `[Shell]`; the neutral card → a fresh Shell on Главная; signed out → Welcome stays and the card is dropped; a foreground return without a card changes nothing.
- `__tests__/launcherChannelModule.test.js` (9) and `__tests__/androidManifest.test.js` «Story 12.5»: source guard of `LauncherChannelModule.kt`, `MainActivity.kt` and the manifest: registration, API 26+ and one serial thread, one preview channel by internal provider id (never deleted, no browsable request, no Watch Next), every program insert checked (null → failure), a failed sync deleting only its own new programs and keeping the old ones, the old ones deleted only after every insert, the channel row updated only when its name or app link differ, the pending open in an `AtomicReference`, the banner fallback, the card links `boostytv://continue?blogUrl&postId&mediaId` (encoded by `Uri.Builder`) and `boostytv://home` with the old explicit-intent path gone, the pending open from `ACTION_VIEW` + scheme `boostytv` only (host `continue` with three non-empty params → a video, else Главная; a non-VIEW launch clears it; recents ignored; read once), the stash in `onCreate` (not on recreation) and in `onNewIntent` after `setIntent`, no logging, class-name-only rejections, `WRITE_EPG_DATA`; MAIN/LAUNCHER plus exactly one VIEW + DEFAULT + BROWSABLE filter with scheme `boostytv` and hosts `continue` and `home` (no path, no http(s)); the only VIEW filter on the activity.
- `__tests__/accountScopeRegistry.test.js`: `launcherChannel` registered, after `progress`.
- `__tests__/demoFlow.test.tsx` «Story 12.5»: with a fake native module, the demo never calls `sync` (start, a progress change, the wipe) and drops a launcher card for a video in its history (fails without the demo gate).

Build (host only): `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL (the Kotlin compiles; not installed by the implementing agent).

Device results (2026-11-03, release-like build, owner-signed, still 1.2.0 / 10200, `adb install -r`, session kept; foreground checked before every key batch):
- *(agent, adb)* After install the app published the neutral card «Откройте Boosty TV · Открыть в Boosty TV»; after a short playback by the owner the card of that video (poster, title, author) replaced it.
- *(agent, adb)* First build: OK on a card launched `act=MAIN cat=[LEANBACK_LAUNCHER]` (Aero ignores an explicit-component program intent). A temporary `TEMP126` probe card with `boostytv://continue?probe=1` was launched as `act=VIEW dat=boostytv://continue/...`; the probe was removed (0 matches in the sources) and the links were changed to `boostytv://` with the owner's approval.
- *(agent, adb)* `am start -a android.intent.action.VIEW -d 'boostytv://continue?blogUrl=synthetic-blog&postId=synthetic-post&mediaId=synthetic-media'` → Главная, no Player. An explicit-action crafted intent on the first build also → Главная.
- *(owner, physical remote)* OK on the video card in Aero continues the video; Back → Главная; «Очистить всё» → Aero shows «Откройте Boosty TV».
- Not checked on the device: card order with several entries, reopening from recents, a tile launch after an untaken card (host/source tests only; deferred-work entry).
- `npm run lint`, `npm run typecheck` clean; full `npm test` 3509/3509.

Device checks planned in the spec (for reference):
- Aero shows the cards after a short playback of an owner-approved video, in the Continue row's order (newest first), and «Откройте Boosty TV» after «Очистить всё» (agent, screencap).
- OK on a card starts the Player at the resume point and Back lands on Главная on that card (owner, physical remote).
- Reopening Boosty TV from recents after a card open does not open the Player again (no replayed open) (agent, adb).
- A tile launch (the app's own launcher entry) after a card that was not taken opens Главная, not the Player (agent, adb).
- OK on a video card in Aero opens the Player for that video (Aero fires `act=VIEW dat=boostytv://continue?…`; logcat shows the activity start) (agent, adb + screencap).
- `am start -a android.intent.action.VIEW -d 'boostytv://continue?blogUrl=<foreign>&postId=<x>&mediaId=<y>'` opens Главная, never the Player; the same with a malformed link (missing params) and an unknown host (`boostytv://other`) (agent, adb).

### Story 12.1 — Remove videos from «Продолжить просмотр», 2026-11-03

**Status: implemented and host-tested; checked on the pinned TV by the agent over adb (release-like build, screenshots) and by the owner with the physical remote (long press, removal, «Очистить всё», short OK): all work.** `spec-12-1-remove-from-continue-watching.md`, our improvement IMP-01 (FR-59). Focus ids and moves: `docs/focus-map.md` §1.1 (the long-press exception) and «Story 12.1» in §3 B.

Device probe (gate, 2026-11-03, release-like build, the pinned Chromecast with Google TV 4K, the owner's physical remote): OK arrives as `KEYCODE_DPAD_CENTER` (23). The key down reaches JS at once as `pressIn`; held ≈ 1.1 s, the native side repeats from ≈ 400 ms, JS gets `onLongPress` at ≈ 520 ms, the key up gives `pressOut` and no `onPress`. Short presses (80–180 ms) give `onPress` only. adb `input keyevent --longpress` holds only ≈ 400 ms, so adb cannot trigger `onLongPress` at the default 500 ms delay: the long press is checked with the physical remote only.

Host tests:
- `src/shared/services/progress/__tests__/progressRepository.test.ts` «Story 12.1» (7): `dismiss` drops the local entry only (memory and disk at once), the server value stays the resume point, other entries untouched, no request and the entry is not written back, a later session brings the entry back; `dismiss` keeps a pending E9 retry (it still goes out, the Boosty position is kept) without re-adding the entry; an accepted E9 becomes the server position (E8 300, E9 410, dismiss → resume at 410); a dismiss disk write that lands after an account reset undoes itself; `clearContinue` drops the unfinished (Continue) entries at once and keeps a finished one, keeps the server values, is not a reset, sends nothing; a clear-all disk write that lands after an account reset undoes itself (generation guard); both are no-ops on an empty history.
- `src/shared/ui/__tests__/ContinueCard.test.tsx` «Story 12.1» (4): the TV `pressIn` / `pressOut` path with fake timers: held 520 ms → `onLongPress` and no `onPress`; 180 ms → `onPress` only; TalkBack: the `longpress` accessibility action («Убрать из списка») calls `onLongPress`, none without it.
- `src/features/home/__tests__/continueRowOffset.test.ts`: the row offset of «Очистить всё» (after the last card).
- `__tests__/homeFeedFlow.test.tsx` «Story 12.1» (10): every matrix row (short OK → Player; long OK → the dialog with «Отмена» preferred; the trailing key up on «Отмена» is ignored in the JS Pressability model only (a `pressOut` without its `pressIn`): the proof is the owner's physical-remote check; «Отмена» and Back → focus on the same card, entry kept; confirm → the entry gone from the row and the store, focus on the next card, else the previous, the row guide on the remaining card (never the tile), no request; the only card → row hidden, focus on the first feed card; the server position kept; watched again → back in the row; «Очистить всё» as the row's last stop and the row guide's destination once focused, «Отмена» / Back → focus on the tile, a remembered tile restored after Настройки → OK «Главная», confirm → every Continue entry gone, the row hidden, focus on the first feed card, no request, no AccountScope reset; sign-out after a removal still wipes the rest). The Story 4.7 helper `rowIds` now leaves the tile out.

Lint, typecheck clean; `npm test` 3477 passed (166 suites).

Device checks (2026-11-03, release-like build `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a`, owner-signed, still 1.2.0 / 10200, installed with `adb install -r`, session kept; the foreground activity checked before every key batch; release Hermes bundle: `home/continue/clear-all` 1, `TEMP121` 0):
- *(agent, adb + screencap)* → → from the first Continue card reaches «Очистить всё» at the row's end (focused tile, ring); OK → the Dialog «Очистить «Продолжить просмотр»?» with «Отмена» focused; Back → the dialog closes and focus is back on the tile. Nothing was confirmed by the agent.
- *(owner, physical remote)* A long OK on a Continue card opens the remove Dialog and «Отмена» is not pressed by the key up of the hold; «Убрать из списка» removes the card; «Очистить всё» works; a short OK still opens the Player: «все работает».
- `npm test` ran 5 times in full: 3 green (3482/3482); 2 runs had `playerRecoveryFlow` / `playerQualityFlow` failures that pass alone (2 × 46/46), the known load flakiness of the player flow suites.

### Story 12.3 — The «в эфире» plaque replaces «События», 2026-11-03

**Status: implemented and host-tested; checked on the pinned TV by the agent over adb (release-like build, screenshots): nobody live → no plaque, the sidebar has 4 items and its D-pad edges hold. A live plaque was not seen on the device: no subscribed author was live, and a live E15 200 has still never been observed; it is host-tested only (owner's check when an author goes live).**

Device checks (2026-11-03, release-like build `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a`, owner-signed, still 1.2.0 / 10200, `adb install -r`, session kept; the foreground activity checked before every key batch; release Hermes bundle: `nav/events` 0, `notification/standalone` 0, `home/live/` 1):
- *(agent, adb + screencap)* Главная opens on the first feed card with no plaque row (nobody live); ← → `nav/home`; ↓ × 4 → Главная, Поиск, Подписки, Настройки, the 4th ↓ stays on «Настройки».
- `npm run lint`, `npm run typecheck` clean; full `npm test` 3452/3452 after the review patches. The «leaving Главная mid-pass» test fails with the pre-patch `signal` wiring (mutation check by the orchestrator) and passes with the fix.

Host tests:
- `src/features/home/__tests__/livePlaque.test.ts` (13): the pass over FixtureTransport and the real HttpClient: nobody live (E2 once, one E15 per author in E2 order, one in flight at a time), one live (name and avatar from E2, trimmed title from E15), several in E2 order, not playable (locked, no live-edge URL, scheduled), the cap (15 subscriptions → 10 E15), a failed author skipped (5xx, network; no retry), 429 and an expired session stop the pass with nothing shown, E2 failure → no E15, a fresh `subscriptions` cache reused, an account reset mid-pass (the E15 in flight completes, no further E15), counts-only logging; `refreshLivePlaque`: no pass within 5 min, one after, none without an observer.
- `__tests__/livePlaqueFlow.test.tsx` (28, replaces `eventsFlow`; review fixes: leaving Главная mid-pass finishes the pass once; the Shell focus refresh after the TTL; a plaque that turned unplayable → no QR, a new pass, the focus fallback; focus fallbacks after a pass (second plaque, first Continue card, Back from the Player); account isolation; the empty-title fallback): every row of the spec's matrix through the App (the 4 sidebar items and no E18; nobody live; one live with and without «Продолжить просмотр»; several; not playable; the cap; one failure; 429; E2 failure; the TTL on Главная reopen and on resume, no polling; the key not under `stream`; OK → the live Player with `LiveRef` and origin Главная, Back → the plaque; Back from a plaque → `nav/home`; the row guide; a vanished focused plaque → the first feed card), and the stale-resume request count moved from `eventsFlow` (Подписки → Автор → Пост → Автор: E1 + E5 + E4×2 + E15×2, no E2, no E18; Главная under Пост after the TTL: E1 + E5 + E2 + E15×3).
- `demoFlow`: the demo pass shows one plaque (`demo-blog-1`), OK → the Player, no network. `phaseFlags`, `queryKeys`, `catalog`, `accountScopeRegistry`, `shellFlow` and the sidebar id lists of `subscriptionsFlow`, `codeFlow`, `authorFlow`, `postFlow`: События gone.
- Flow tests whose subject is not the plaque (`authorFlow`, `homeFeedFlow`, `subscriptionsFlow`, `sessionFlow`, `accountSwitchFlow`, `codeFlow`) turn the new `livePlaque` flag off (`src/test/phaseFlagsMock.ts`), so the pass does not change their request counts.
- Removed with События: `eventsFlow`, `eventRepository.test.ts`, the `e18-events*.json` fixtures (`npm run check:fixtures` now checks two JSON files fewer).

Checks run: `npm run lint`, `npm run typecheck` clean; full `npm test` 167 suites, 3443/3443. `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a`: BUILD SUCCESSFUL; the Hermes bundle has `nav/events` 0 and `notification/standalone` 0 (`home/live/` 1).

### Story 12.2 — Progress and «Просмотрено» on feed cards, 2026-11-03

**Status: implemented and host-tested; checked on the pinned TV by the agent (adb screencap, uiautomator label) and by the owner with the physical remote (the line after watching and after seeking to the middle). «Просмотрено» and long-list smoothness were not checked on the device.** `spec-12-2-progress-on-feed-cards.md`, our improvement IMP-02 (FR-60). Focus is unchanged (`docs/focus-map.md` «Story 12.2»).

Host tests:
- `src/shared/services/progress/__tests__/cardProgress.test.ts` (10): `postCardProgress` (no entry; 12:00 of 60:00 → 20 %, 48 min left; finished by ≥ 95 % and by < 30 s left; the block duration fallback; no duration → none; server-only → none; multi: 1 watched + 2 in progress → video 2's line; 1 watched + 2 not started → none; all finished → watched, a server-only one does not count) and `primaryTarget` (moved from `PostScreen`).
- `src/shared/ui/__tests__/PostCard.test.tsx` «Story 12.2» (9): with a `ProgressContext` over a memory store: the line's geometry and colours (ContinueCard's), the fill width, the bottom-left badge next to the kept duration chip and type badge, the label endings, unknown duration, server-only, multi-video target, other kinds and locked, and the card following the store (put → line, `removeLocal` → gone).
- `__tests__/homeFeedFlow.test.tsx` «Story 12.2» (6): the matrix rows on Главная with no E8 per card and one E5; Back from the Player via Пост (feed card → Пост → primary → Player, progress through the engine mock, Back → Пост, Back → Главная: focus on the same feed card, its line and label at the new position, no E5 refetch); Back from the Player (from a Continue card) → the feed card shows the new position, no E5 refetch, focus back on the card; a store write while a feed card is focused re-renders only that card, no focus request, no request; «Очистить всё» drops the line and keeps «Просмотрено» of a finished entry; account isolation: the AccountScope wipe (`progressStore.reset`) → no line, no badge, no status in the label. The Story 3.1 render-count tests stay green.
- `__tests__/authorFlow.test.tsx` and `__tests__/searchFlow.test.tsx` «Story 12.2» (1 each): line, «Просмотрено», unchanged card, no per-card request on Автор and Поиск.

Lint, typecheck clean; full `npm test` after the Пост-path test: 3508/3508 (orchestrator run).

Device checks (2026-11-03, release-like build `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a`, owner-signed, still 1.2.0 / 10200, `adb install -r`, session kept; foreground checked before every capture):
- *(owner, physical remote)* watched part of «ОТЕ №15» from the feed and returned: the feed card shows the line (a few pixels at < 1 min of 62), the Continue row came back, focus on the same card, no feed reload; after seeking to the middle the line reaches about half of the preview («линия видна»).
- *(agent, uiautomator)* the feed card's label ends «… Длительность 1:02:04. Прогресс: осталось 62 мин.».
- Not checked on the device: the «Просмотрено» badge (host-tested only) and scrolling a long feed right after playback (deferred-work entry).
- `npm run lint`, `npm run typecheck` clean; full `npm test` 3509/3509 after the review patches.

### Story 13.2 — Timestamp chips instead of a text line and a chip, 2026-11-02

**Status: implemented and host-tested; checked on the pinned TV by the agent over adb (screenshots); the remote check against the mockup is the owner's.** `spec-13-2-timestamp-chips.md`, our improvement IMP-06 (FR-63). Focus ids and moves: `docs/focus-map.md` «F Пост» «Story 13.2».

Host tests:
- `src/shared/entities/post/__tests__/postBody.test.ts` «Story 13.2» (11): every matrix row at entity level (chapter line; consecutive lines as separate paragraphs and as `\n` lines; mixed paragraph with an intro and a closing line keeping their keys; empty title → the time; a timestamp inside a paragraph keeps its link chip; a line with another link; two timestamps on a line; another post, an unknown `tmid`, no `selfPost` or no `qr`), a list item, 300 chapter lines (unique, stable keys, post order) and the chip titles equal to `postChapters` (one `chapterTitle` rule).
- `src/features/post/__tests__/linkChip.test.tsx`: the inline timestamp chip reads «▶ 3:45» (label «Смотреть с 3:45»); «Story 13.2» (3): consecutive chapters grouped in one list, time / title / labels; the focused chip inverts (light fill, dark ink, ring); OK → `onPlayAt` with the chip id, player off → the link QR.
- `__tests__/postFlow.test.tsx` «Story 13.2» (4): focus order author → primary → «На телефоне» → paragraph → chips → paragraph → its «▶ 42:10» chip; no chapter text in any paragraph, no «· Смотреть»; OK → Player `{atSec: 20}` with the chip as origin, Back → the chip; player off → the QR of the link; a line with another link and links to another post or video unchanged. `__tests__/playerFlow.test.tsx` «Story 6.3: timestamp link chips» updated for «▶ 3:45». `icons.test.tsx` covers `PlayIcon`; `tokens.test.js` the new `link-chip` tokens.

Lint (`--max-warnings 0`), typecheck clean; `npm test -- --ci` 3457 passed (166 suites).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17) BUILD SUCCESSFUL, versionName still 1.2.0 / 10200, installed with `adb install -r` over the Story 13.1 build (session kept). The foreground activity was checked before every key batch.

Device checks (pinned Chromecast with Google TV 4K, release-like build, the owner's session, 1080p screencaps):

| Check | Result | Method |
|---|---|---|
| Chapters of «Философский выпуск по вашим заявкам №2» (Подписки → Стас Асафьев → the post) | The intro paragraph, then one chip per line: «▶ 0:00 Приветики!», «▶ 0:20 Что тут происходит?», «▶ 1:58 Как не переживать?», «▶ 17:34 Как там здоровье?», … «▶ 50:17 Как понять, что ты молодец?»; no duplicate text line, a tight list | agent, adb + screencap |
| Focus | ↓ from «Продолжить · 0:29» → the paragraph → «0:00» → «0:20» (inverted light chip with the ring); ↓ walks the list and scrolls with it | agent, adb + screencap |
| OK → Player → Back | OK on «0:20» opened the Player (still loading); Back after ≈ 3 s → Пост with focus on «0:20»; «Продолжить · 0:29» unchanged (no write under 10 s) | agent, adb + screencap |
| Inline «▶ time» chip, player off | Not found on the device in this post; host-tested only | — |
| Physical remote | The owner's | — |

### Story 13.1 — Пост header with a large preview and the post QR, 2026-11-02

**Status: implemented and host-tested; the header checked on the pinned TV by the agent over adb (screenshots); the remote check against the mockup is the owner's.** `spec-13-1-post-header-large-preview-and-qr.md`, our improvement IMP-05 (FR-62). Focus ids and moves: `docs/focus-map.md` «F Пост» «Story 13.1».

Host tests:
- `__tests__/postFlow.test.tsx` «Story 13.1» (8): one video not started (preview with duration, «Видео · 56:14», «Смотреть» + «На телефоне», no MediaRow, title and meta in the hero, the preview not focusable, focus on the primary); one video in progress («Продолжить · 12:08», «С начала», «На телефоне» in that order, the progress line, «осталось 45 мин»); several videos (preview of video 2 «Видео 2 из 3», «Продолжить · Видео 2», tiles with the MediaRow ids, statuses, «Сейчас», a tile opens the Player); the plate fallback (missing and failed, same 320 × 180 size); player off (preview and media line, no play buttons, «На телефоне» stays); no video («На телефоне» under the meta, focus on the first paragraph); «На телефоне» → QrDialog «Пост на Boosty» with `https://boosty.to/<blog>/posts/<id>` (never in the dialog text or the logs), Back → focus on the button; a refetch keeps focus on it. The existing Пост, player, progress, quality, speed, recovery, first-frame, system-player and demo flows were updated for the new column order (`post/<postId>/phone` after the actions) and for single-video posts without a row (they open the Player from the primary).
- `src/shared/entities/__tests__/externalUrls.test.ts` «boostyPostUrl» (4): valid, encoded, read back by `boostyPostRef`, unsafe blog and odd post ids → null. `tokens.test.js` covers the `post-hero` and `media-tile` groups; `icons.test.tsx` the QR glyph.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, owner-signed (versionName still 1.2.0, versionCode 10200), installed with `adb install -r` over the published 1.2.0 (session kept); it is the installed build now. Release Hermes bundle: `post/hero` 3, `post/tiles` 1, `createDemoSessionManager` 0. The foreground activity was checked before every key batch (the screensaver was up; woken with `KEYCODE_WAKEUP`, then `am start`). No playback was started, nothing written to the account, nothing uninstalled or cleared.

Device checks (pinned Chromecast with Google TV 4K, release-like build, the owner's session, 1080p screencaps):

| Check | Result | Method |
|---|---|---|
| One video, not started | Author row; 16:9 preview left; title, «вчера · 10 лайков · 40 комментариев», «Видео» (no duration from the API); «Смотреть» focused, «На телефоне» with the QR glyph; no MediaRow; the body below | agent, adb + screencap |
| One video, in progress | «Видео · 56:14 · осталось 56 мин», duration badge on the preview, «Продолжить · 0:29» focused, «С начала», «На телефоне» wrapped to a second row (the right column is ≈ 378 dp) — fixed in the owner follow-up below | agent, adb + screencap |
| Focus | → primary → «На телефоне»; ↑ → the author; ↓ → the primary; ↓ → the first paragraph | agent, adb |
| «На телефоне» | OK → «Пост на Boosty» with a QR, «Откроется на телефоне», «Закрыть» focused; Back → focus on «На телефоне» | agent, adb + screencap |
| Text post | Plain header (title, meta), «На телефоне» under the meta; focus on the first paragraph | agent, adb + screencap |
| Several videos | Not run: no multi-video post in the account (Story 4.2 note); host-tested only | — |
| QR content | Not decoded on the host (no decoder installed); the value is host-tested | — |

### Release 1.2.0 on the TV, 2026-11-02

`1.2.0` (versionCode 10200) was published from `main` `8071f46` (PR #103) with Epic 11: read-only comments and the full-screen image viewer. The owner updated the pinned TV in the app over the unpublished Story 11.2 build and reported version 1.2.0 (owner). Over adb: `versionName` 1.2.0, `versionCode` 10200, and the installed `base.apk` SHA-256 `92bc6bec…2342` equals the armeabi-v7a asset digest; the app opened on Главная with the session kept (agent over adb). The TV runs a published release again.

### Story 11.2 — The «Комментарии» block on Пост, 2026-11-02

**Status: implemented, host-tested and checked by the owner on the pinned TV with the remote: the comments block («всё окей») and then the image viewer («всё прошло, картинки открываются»).** `spec-11-2-comments-block-on-post.md`.

What changed: the Пост header reads «date · N лайков · M комментариев» (`count.comments`, not focusable, left out when missing); an accessible Пост ends with the read-only «Комментарии» block (`src/features/post/comments`): newest first, «Показать ещё» (older pages, 20 at a time, only on OK), replies under each comment (oldest first, one indent step), «Ещё ответы», the deleted / blocked notes, and the in-block states (loading, empty, error + «Повторить», `denied`, «Автор отключил комментарии» with no request, `notFound` hides the block). Focus ids and moves: `docs/focus-map.md` «F Пост» «Story 11.2».

Host tests:
- `__tests__/postFlow.test.tsx` «Story 11.2» (20): the header plural (29 / 1 / 3, missing, comments without likes); first page (20 rows newest first after the blocks, then «Показать ещё»; one GET; one stop per comment, nothing focusable inside; initial focus unchanged); «Показать ещё» (appended below, no duplicates, focus on the first new row after two frames, the last page has no row); busy (focus kept, a second OK sends nothing), failure («Повторить», list kept) and retry; replies (2 inline of 5, «Ещё ответы» → 5 oldest first, focus on the first new) and its failure; empty, denied, notFound, author off (no request), error + «Повторить» (page 1 again, focus on the first comment); deleted / blocked; read-only (no writing text, the only buttons in the block are «Ещё ответы» / «Показать ещё», no input); 300 comments by 14 presses with focus on each first new row and no auto-load; Back from a comment pops to the origin card; the player return (same comment; gone → the block's first row); a refetch that drops the focused comment. The locked-post matrix row is in «locked posts» «price fields» (no block, no E19).
- `src/shared/entities/comment/__tests__/useComments.test.tsx` (10): page 1 newest first, «Показать ещё» merge order and the end of paging, a failed «Показать ещё» kept with its retry, empty, error + retry, denied / notFound, disabled (no request); replies merge (deduped, oldest first, no more after the last page), failure and retry, a press while one runs ignored.
- `commentRepository.test.ts` (the `hidden` flag), `mapPost.test.ts` (`commentCount`, `commentsDenied`), `demoFlow` (the demo header count and block), `commentsReadOnly.test.js` (still green; import specifiers are now blanked before the scan, since the feature folder is named `comments`), `tokens.test.js` (`comment-row`).
- `src/test/flow.tsx` `installFixtureTransport`: an E19 request a test does not answer gets an empty comments page, so every other Пост flow keeps its focus order.
- Image viewer (owner decision 2026-11-02, after the owner's device check of the block, «всё окей»): `postFlow` «Story 11.2: the full-screen image viewer» (5): matrix «Image viewer, post» (OK on the 2nd of 3 → image 2, «2 / 3», spinner until loaded, the background hidden, ← → step and stay at the ends, a key down alone does nothing, one stop, Back → focus on the 2nd image stop, the next Back pops Пост); a load failure («Изображение недоступно», arrows still work); one image (no counter); matrix «Image viewer, comment» (first image, «1 / 2», → stays at the end, Back → the comment row, a comment without images: OK does nothing); a locked post's teaser never opens. Host only: the native key path (`SeekKeys` key down) and the real fit on the screen are for the device.

Checks run:
- `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` (38): clean.
- `npm test`: 166 suites, 3408 tests passed.

Device (2026-11-02, owner-signed `assembleRelease` armeabi-v7a, `adb install -r`, session kept; still named 1.1.0):

| Check | Result | Evidence |
|---|---|---|
| Header «вчера · 9 лайков · 32 комментария» on a post | Passed | agent over adb (UI dump) |
| D-pad down through the post's blocks reaches the comment rows (`post/<postId>/comment/<commentId>`) | Passed | agent over adb (focus ids only, no player visit) |
| Rows newest first, replies indented with «ответ …», «Ещё ответы», «Показать ещё», Back, no count on cards | Passed («всё окей») | owner, physical remote |
| Image viewer: OK on a post image and on a comment with images, ← →, «N / M», Back returns focus | Passed («всё прошло, картинки открываются») | owner, physical remote |

Not verified: `isCommentsDenied: true`, a deleted or blocked comment, the 403 / dead-token meaning (never seen live); TalkBack reading the rows.

### Story 11.1 — Comments endpoint probe and the comment entity, 2026-11-02

**Status: E19 verified live (probe, agent over adb, owner's OK for each run); the GET-only comment entity is implemented and host-tested. No UI (Story 11.2).** `spec-11-1-comments-endpoint-probe-and-entity.md`, parity COMM-01 (FR-58, owner decision 2026-11-02: read-only comments).

**Probe environment (owner decision 2026-11-02):** the pinned TV (Chromecast with Google TV 4K); a temporary owner-signed `assembleRelease` armeabi-v7a build with a counts-only probe (temporary marker), installed with `adb install -r` with the session kept; the owner's session (no second sign-in); two runs, each after the owner's OK. The probe ran on the release build path (not gated on `__DEV__`) and wrote through the hidden diagnostics capture (Story 8.3): the agent turned capture on, read `boostytv.log` with `adb pull`, then turned capture off and cleared it. Logged: status codes, key names, value types, counts and booleans only. Afterwards the probe was removed (a grep of `src` for the marker: 0; the release Hermes bundle: 0) and a clean owner-signed build was installed over it with `adb install -r` (session kept). No debug-key APK; nothing uninstalled or cleared; no sign-out; GET requests only.

| Probe row | Result | By |
|---|---|---|
| Accessible post with comments, first page | 200; `{data, extra{isFirst, isLast}}`, no cursor field; the newest 20, `intId` ascending, `isLast: false` | agent, adb + diagnostics file |
| Second page (`offset` = the smallest `intId` of page 1) | 200; 20 older comments, no overlap, all below the offset, `isLast: false`. `offset` = the largest `intId` returned 19 of page 1 again (not a cursor) | agent, adb + diagnostics file |
| One comment's replies (`parent_id` = its `intId`) | 200; all 5 replies (`replyCount` 5), `isLast: true`; inline: up to 2 under `reply_limit=2`, `replies.extra.isLast` false when more | agent, adb + diagnostics file |
| Accessible post without comments | 200; `data: []`, `extra{isFirst: true, isLast: true}` | agent, adb + diagnostics file |
| Locked post (`hasAccess: false`) | **403** | agent, adb + diagnostics file |
| 404, a deleted / blocked comment, non-text blocks in comments, replies past one page, a dead token | **Not seen** | — |

Full shape: `docs/api-contract.md` §3 «E19 (LIVE)».

Host tests (host only; no device run of the entity, it has no UI yet): `src/shared/entities/comment/__tests__/commentRepository.test.ts` (55: the request as sent, path validation before a request (the trimmed blogUrl, positive safe-integer cursor and parent), the paging stops (`isLast` not exactly false, a cursor not below the one sent, no usable intId with a counts-only warning), `mergeCommentPages` (oldest page first), every row of the spec's I/O matrix: first page with the entity shape and the cursor, inline replies with `replyTo` and `hasMoreReplies`, the unknown block via `mapBlocks`, last page, no `extra`, no comments, merge keeping the first occurrence, replies via `parent_id` with their own cursor, `denied` for 403 with no retry and no refresh, `notFound`, `error(Parse)`, `error(Network)` after the bounded retries, a 401 through the refresh, 500 / 429 / 400; each malformed field dropped alone with a counts-only warning, avatars, reply counts, no raw DTO field in the domain); `__tests__/commentsReadOnly.test.js` (3: no comment path outside `entities/comment`, the repository sends GET only); `queryKeys.test.ts` (the two keys, ids only); `demoFlow` (the demo E19: three pages of 45, replies, empty, 403, 404). The existing exclusion guards (`postRepository.test.ts`, `mapPost.test.ts`, `PostCard.test.tsx`, `AuthorCard.test.tsx`, `eventRepository.test.ts`) are unchanged and pass. Fixtures: `src/test/fixtures/boosty/e19-*.json` (8, synthetic).

Checks run:
- `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` (38): clean.
- `npm test`: 165 suites, 3375 tests passed (after the review patches).
- A `git grep` for the probe marker: no output.

### Release 1.1.0 on the TV, 2026-11-02

`1.1.0` (versionCode 10100) was published from `main` `0269833` (PR #97) with the Story 10.1 chapters. The owner updated the pinned TV in the app over the unpublished Story 10.1 build (versionCode 10000) and reported version 1.1.0 (owner). Over adb: `versionName` 1.1.0, `versionCode` 10100, and the installed `base.apk` SHA-256 `a26ccdd3…10c7` equals the armeabi-v7a asset digest, so the per-ABI in-app update picked the right APK; the app opened on Главная with the session kept (agent over adb). The TV now runs a published release again.

### Story 10.1 — Chapter marks on the player timeline, 2026-11-02

**Status: implemented, host-tested and checked by the owner on the pinned TV.** `spec-10-1-chapter-marks-on-the-player-timeline.md`, our improvement (feature-parity PLAY-CHAP). Chapters come from the post's timestamp links of the playing video (`shared/entities/post/chapters.ts` over `externalUrls.timestampRef`, no second parser), cut to the engine's duration. The built-in player draws a tick per chapter (none at 0), shows the chapter name after the elapsed time (following the pending target while seeking), opens the chapter strip with ↑ on the focused timeline and maps media Next / Previous to chapter jumps (focus-map §4 G «Story 10.1»). Live, the system player and videos without timestamps are unchanged.

Host tests (35 new): `src/shared/entities/post/__tests__/chapters.test.ts` (the spec's I/O matrix: happy path, two videos, out of range / odd links, duration unknown; sorting and duplicates; the name rules; list items; `chapterAt`; the Next / Previous targets incl. the 3 s rule); `src/features/player/__tests__/seekController.test.ts` «seekTo»; `PlayerOverlayChapters.test.tsx` (marks count and position, colour-only change over the fill, the name and the timeline label, the name following the pending target, none before the first chapter, none without chapters or on live); `__tests__/playerChaptersFlow.test.tsx` (marks and name from a post, no marks before the duration, the scrub name, v2's own chapter, a video without timestamps keeps ↑ and Next as before; the strip: opens on the current chapter, → then OK seeks once and closes with focus on the timeline, the first chapter selected before the first, Back and ↓ close without a seek, no auto-hide while open, the ↑ from the controls does not open it, Menu closes it and opens the sheet, Back order strip → held target; Next / Previous jumps and the exit E9 after a jump). Existing player tests are unchanged and pass (AC 3).

Checks run:
- `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` (30): clean.
- `npm test`: 163 suites, 3310 tests passed.

Device (2026-11-02, owner-signed `assembleRelease` armeabi-v7a, `adb install -r`, still named 1.0.0; the session was kept and the app opened on Главная):

| Check | Result | Evidence |
|---|---|---|
| Marks on the track at the timestamps; the name after the elapsed time on one line, times and controls not moved | Passed | owner, physical remote |
| A scrub shows the pending chapter's name | Passed | owner, physical remote |
| ↑ ↑ opens the strip on the current chapter; ← → select without seeking and stay at the ends | Passed | owner, physical remote |
| OK jumps to the chapter, closes the strip, the name updates | Passed | owner, physical remote |
| Back and ↓ close the strip without a jump | Passed | owner, physical remote |
| ↑ from the controls row reaches the timeline without opening the strip; the next ↑ opens it (`STRIP_ENTRY_GUARD_MS` = 300 ms) | Passed | owner, physical remote |
| A video without timestamps: no marks, ↑ ↑ opens nothing | Passed | owner, physical remote |

The owner reported «всё прошло, полоса глав работает». The agent made no player visit: under the player-visit rule a visual check would need a capture inside the visit, so the visual checks are the owner's. Not verified: TalkBack reading the chapter in the timeline label. Not checkable on the pinned remote: media Next / Previous (it has no media keys). The TV now runs this unpublished Story 10.1 build, still named 1.0.0 (versionCode 10000); the next published release with a higher versionCode replaces it through the in-app update.

### Story 9.5 — Full device regression and owner acceptance, 2026-11-01

**Status: done. The owner accepted the Android release on 2026-11-01, which starts SM-1 (4 weeks without BoostBuddy) and SM-2 (30+ days without a forced re-login). `0.9.2` (the release candidate) was published and installed on the pinned TV through the in-app update from `0.9.1`; the agent regression, the joint sign-out session and the owner's remote walk ran on it. `1.0.0` is built from the same code. Every row is labelled agent over adb, emulator, owner or physical remote.** `spec-9-5-full-device-regression-and-owner-acceptance.md`.

Changes so far:
- «Device rules»: an agent player visit on the owner's content is one command (OK, a fixed sleep of 5 s or less, Back), and steps that pause or seek the owner's video belong to the owner.
- `appVersionName` `0.9.2` (`versionCode` 902); `CHANGELOG.md` / `CHANGELOG.ru.md` `[0.9.2]`.

Host checks (2026-11-01): `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (160 suites, 3275 tests) and `npm run check:fixtures` (30 clean) pass. The 9.3 and 9.4 guards are in that run (`homeFeedFlow`, `authorFlow`, `noRawStyleLiterals`, `contrast`, `labelGuard`).

**Release candidate build (build host, branch, not the public build).** `(cd android && ./gradlew clean assembleRelease)` with the owner's signing properties (values never read): five APKs. Each `Verifies` (v2), certificate SHA-256 `b7b8b0f14ffcd2b7fc153891ed660c0c8d61c264128c1bce0386e312c47d59eb` (as recorded), `versionCode='902' versionName='0.9.2'`. `native-code`: one ABI for each split, all four for the universal APK. The shipped Hermes bundle: `createDemoSessionManager` 0, `settings/row/session-check` 0. `git ls-files` has no keystore or APK; no `BOOSTYTV_RELEASE_*=` value outside the docs and CI. The public APK is built again from the `main` commit that gets the tag (`docs/release.md`).

**Carry-in: the filter chip after the sheet (agent over adb, before the release candidate).** Build on the TV: the Story 9.4 branch release build (`versionName 0.9.1`, installed 2026-11-01 17:35), which has the same focus guard as `0.9.2`. Sequence: from «Фильтры», OK → the sheet, ↓ to «Период», OK → the list, Back, a gap, Back. Each run was checked in the foreground, and the focused node was read before every OK.

| Screen | Runs (gap between the two Backs) | Result | Evidence |
|---|---|---|---|
| Поиск | 4 (about 1.5 s, 0.3 s, 0.6 s, 1.0 s) | Focus on «Фильтры: Доступные мне» every time; the node stays `focusable`. ← → the field, → → the chip again | agent over adb |
| Автор (Алексей Антонов) | 3 (0.3 s, 0.6 s, 1.0 s), plus one Back that closed the sheet from «Период» without opening the list | Same: focus on «Фильтры», `focusable`; ← → «В этом блоге», → → the chip. Back from the chip → the author's tile on Подписки | agent over adb |

No failure was reproduced, so no code change. The run was repeated on `0.9.2` (below).

**Release `0.9.2` (published 2026-11-01 with the owner's OK).** Built from `main` `3b66624` (PR #93), tag `v0.9.2`, https://github.com/dzmitryafanasenka/boosty-tv/releases/tag/v0.9.2. All five APKs verified before publishing (v2, certificate SHA-256 `b7b8b0f1…c47d59eb`, `versionCode` 902), and GitHub's asset digests equal the local `shasum` values. Asset digests: `boosty-tv-0.9.2-armeabi-v7a.apk` `b237f9e7…aa86`, `boosty-tv-0.9.2.apk` (universal) `81fc3eec…9461`.

**In-app update from `0.9.1` to `0.9.2`, the first device run of the per-ABI path.**

| Check | Result | Evidence |
|---|---|---|
| Update from the app | The owner opened Настройки → «Версия» → «Скачать и установить», and the system installer ran only after the owner's OK | owner |
| Installed version | `versionName 0.9.2`, `versionCode 902`, `installerPackageName com.google.android.packageinstaller`, `primaryCpuAbi armeabi-v7a`, «Версия 0.9.2» in Настройки | agent over adb |
| ABI asset | SHA-256 of the installed `base.apk` = `b237f9e7…aa86` = the `boosty-tv-0.9.2-armeabi-v7a.apk` digest. The split was downloaded and verified, not the universal APK | agent over adb |
| Session | Kept: the owner reported it, and after a later force-stop and cold start the app opened on Главная signed in, with «Продолжить» unchanged | owner; agent over adb |

**Agent regression on `0.9.2` (agent over adb, 2026-11-01).** The release build installed by the in-app update, the owner's session, the stock key events from `adb shell input keyevent`. Before every key batch the agent checked that the app was in the foreground, and it read the focused node from `uiautomator dump` before every OK. «Button Mapper» was left as it was. No screenshots were taken, and the dump file on the TV was deleted afterwards. Nothing was reinstalled, uninstalled or cleared. There was no sign-out, vote, like, pause or seek.

| Item | Steps | Result | Evidence |
|---|---|---|---|
| D-pad browsing | Sidebar Настройки → События → Подписки → Главная → Поиск, OK on each item, Back from each content area | Each screen opens on its documented initial element: «Версия 0.9.2»; «Обновить» (События is empty); the first tile; the remembered feed card; the field. Back from content → the current sidebar item | agent over adb |
| Long lists | Главная feed (3 subscriptions, the history back to 2024): 40 single ↓ at 0.5 s, then 60 ↓ at 0.3 s in column 1; → → to column 3, 20 ↓ at 0.15 s, 30 ↑ at 0.15 s, then about 90 ↑ to the top | About 100 rows (about 300 posts) loaded page by page. The column was kept on every run (x 408 for column 1, x 1356 for column 3), and one card was focused after every run | agent over adb |
| Filter apply and reset | Главная «Фильтры» → «Все посты» → Back; then «Фильтры» → «Сбросить» → Back | Apply: «Сбросить» appears in the sheet, and Back → the chip «Фильтры: Все посты. 1 активный фильтр». Reset: focus → «Доступные мне», «Сбросить» goes away, and Back → «Фильтры: Доступные мне» (the default is restored) | agent over adb |
| Keyboard close | Поиск: OK on the field (`mInputShown=true`) → Back; OK → `input text` + Enter | Back closes the keyboard (`mInputShown=false`), and focus stays on the field. Enter submits: the keyboard closes and focus goes to the first result. OK on it → Пост, Back → the same result, with the query kept | agent over adb |
| Multiple media | Главная → the «2 видео» post («Разбор работ на конкурс RATT») | «Смотреть · Видео 1», then rows «Видео 1. Video. Не начато» and «Видео 2. … 47:33. Не начато», each with its own status. ↓ ↓ ↑ ↑ moves through the rows and back to «Смотреть» | agent over adb |
| Player visit (one-command rule) | On «Смотреть · Видео 1» of that post: OK, `sleep 4`, Back in one command (18:51:11–18:51:15) | Back → «Смотреть · Видео 1»; both rows still «Не начато», and no new «Продолжить» entry after a cold start. Playback start is shown only indirectly: the audio HAL was active in logcat in that window. The video was not dumped while it played | agent over adb |
| Back hierarchy | Пост → Back; Автор → Back; Подписки tile → Back; feed card → Back; `nav/home` → Back | Пост → the same card or result; Автор → the author's tile; content → the current sidebar item; Главная's sidebar → the app exits to the Google TV home (focus-map §1.4). The player layers (overlay, settings) belong to the owner's walk | agent over adb |
| Sleep and resume | On Главная: `keyevent 223` (SLEEP), 8 s (`mWakefulness=Asleep`), `keyevent 224` (WAKEUP) | Awake, the app in the foreground, focus on the same card, and ← → work at once | agent over adb |
| Cold start | `am force-stop`, then the launcher intent | Signed in, Главная, initial focus on the first «Продолжить» card. The row is unchanged: «ОТЕ №15» 62 min, «Прошмандовки…» 8 min, «За какое мнение…» 60 min, «Lavrov_Full_2.mp4» 39 min | agent over adb |
| Chip race (carry-in) | Поиск and Автор: from «Фильтры» OK → «Период» → OK → Back, a gap of 0.2 / 0.3 / 0.6 / 1.0 / 1.5 s, Back | 5 of 5 runs on each screen: focus on «Фильтры», `focusable="true"`; ← → the field and → → the chip again; ↓ → the grid | agent over adb |

**Not run by the agent (owner's steps):** a quality change, resume within ±10 s, the player overlay and settings sheet (labels on the device), a poll vote (outward), UJ-1's press count and the SM-5 remote-only walk. These are in the owner's remote walk.

**Joint sign-out session (owner, physical remote, 2026-11-01, on `0.9.2`).** The owner signed out in Настройки and signed in again by phone and code with the remote, going through the A3–A11 screens, and reported that everything worked. The agent did not capture the screens, so no phone number or code reached it. Afterwards the app was in the foreground on `0.9.2`, signed in.

| Journey | Result | Evidence |
|---|---|---|
| UJ-7 sign out | Passed: back to Welcome with no account data | owner, physical remote |
| UJ-0 / A3–A11 sign in by phone and code | Passed: the same account | owner, physical remote |
| UJ-3 expired session, prefilled phone | Not verified: a real expiry cannot be forced, and a normal sign-out wipes the stored phone (owner decision 2026-10-25) | — |

**Owner's remote walk (physical remote, 2026-11-01, on `0.9.2`).** The agent gave the owner a short script; the owner reported «всё прошло».

| Journey | Result | Evidence |
|---|---|---|
| UJ-1 cold start to a playing video, 5 presses or fewer, no autoplay; quality change keeps the position; Back restores the card | Passed | owner, physical remote |
| UJ-2 two-video post, seek, exit, resume from «Продолжить» within ±10 s | Passed | owner, physical remote |
| UJ-4 search with the keyboard and a custom period; Back restores the query, filter and card | Passed | owner, physical remote |
| UJ-6 single-choice vote | Passed (the step was optional in the script) | owner, physical remote |
| UJ-5 live to stream end | Not verified unless a subscribed author was streaming; the owner reported no failure | owner |
| Player overlay and settings sheet on the device | Covered by UJ-1 (quality change); labels heard by TalkBack in Story 9.4 | owner, physical remote |

The press counts and the resume offsets were not reported as numbers; the owner reported each step as passed.

**Owner acceptance.** On 2026-11-01 the owner wrote «всё прошло, принимаю релиз, выпускай 1.0.0». The Android release is accepted. SM-1 and SM-2 start on 2026-11-01.

**1.0.0 on the TV.** `1.0.0` was published from `main` `925bc85` (PR #94). On 2026-11-02 the owner updated the TV in the app from `0.9.2` and reported version 1.0.0 with the session kept (owner). Later the same day, over adb: `versionName` 1.0.0, `versionCode` 10000, and the installed `base.apk` SHA-256 `0cab5227…2c4c` equals the armeabi-v7a asset digest (agent over adb).

Not verified by decision (owner, 2026-11-01): the account switch (no second account), network loss during playback, the external-player chooser with 2+ players. Live at 1× only if a subscribed author streams during the story.

### Story 9.4 — Visual fidelity and accessibility pass, 2026-11-01

**Status: implemented and host-tested. The 1080p walk ran on the pinned Chromecast with Google TV by the agent over adb, using owner-signed `assembleRelease -PreactNativeArchitectures=armeabi-v7a` builds from this branch (`versionName 0.9.1`, installed with `adb install -r`, session kept, nothing uninstalled or cleared). TalkBack ran on the same device, turned on and off by the agent over adb. The 720p and font-scale rows ran on an Android TV emulator in demo mode. Every row below is labelled agent over adb or emulator. The owner listened to TalkBack on the device on 2026-11-01 (owner) and reported that everything is announced properly; the physical-remote feel check of these changes is still open.** `spec-9-4-visual-fidelity-and-accessibility-pass.md`.

Changes:
- **«Продолжить» focus (the Story 9.3 finding).** There were two causes. Главная's `initialRow` read a remembered Continue card's index in the row as a grid index, so the list opened past its header. Also, a Continue card past the third sat outside the row's viewport at mount, and on the device the focus request on it did not stick (uiautomator: nothing focused). Fixes: `initialRow` applies only to a feed card (`HomeScreen.tsx`), and the row opens scrolled so the remembered card sits on column 3 (`ContinueRow` `initialCardId`, `continueRowOffset`), where Android's own focus scroll leaves it.
- **Filter chip after the sheet (found in this walk).** On Поиск and Автор, open the sheet, open «Период» and Back to the sheet. That level change drops focus to the sidebar for a moment (the Story 5.4 device lesson). The screen took it as «focus left the field row» and made the chip not focusable, so Back from the sheet left nothing focused. Fix: Поиск (`SearchScreen.tsx`) and Автор (`useAuthorActionRowFocus` `isModalOpen`) ignore focus events while a modal is open.
- **Tokens only.** `__tests__/noRawStyleLiterals.test.js` fails on a hex or rgb() color, or on a non-zero number literal in a size style property or a JSX size prop, anywhere in `src/` outside `tokens.ts`. It names the file and line. The allowlist is `0`, `StyleSheet.hairlineWidth` and the QR code's black modules in `qrRenderer.tsx`. Not scanned: the SVG glyph geometry in `src/shared/ui/icons/`, the demo API data in `src/app/dev/demo.ts` and named module constants (deferred work). Known blind spots of the line-based scan: named CSS colors and `hsl()`; transform `scale` (a multiplier, for example the spinner's `scale: 2`); a value after a ternary or on the next line; a string that contains `/*` (the `*/*` ACCEPT value in `profiles.ts`), which makes the comment stripper blank every line up to the next `*/`. It found 35 literals: 34 style values and one JSX icon size. They moved to new tokens, or to existing tokens with the same value. The new DESIGN.md frontmatter entries keep the built values, so nothing looks different: `button-small.iconSize`, `setting-row.listMaxWidth`, `event-row.skeletonLine`, `link-chip.labelMaxWidth` / `thumbWidth` / `thumbHeight`, the `player-control` glyph geometry, `timeline.bubbleMinWidth`, `audio-block`, `stroke` and `focus-guide`.
- **Contrast.** `src/shared/ui/__tests__/contrast.test.js` parses the DESIGN.md contrast table and computes each pair from `tokens.ts` with the WCAG 2.x relative luminance. A translucent background (`overlay-badge`) is composited over black and white, and the worse result counts. It also checks `text-tertiary` on its three allowed backgrounds. Every pair meets its target, so no token changed. Results: text/bg 15.79; text-tertiary on bg / bg-sidebar / surface 5.16 / 4.90 / 4.68; text-secondary/surface-focus-row 5.57; accent-ink on accent / accent-focus 7.40 / 8.58; text/live 4.83; text/overlay-badge 10.90 over white, 16.88 over black; focus-ring on bg / surface-focus-button 15.79 / 8.82.
- **Focused secondary text (DESIGN.md Colors).** MediaRow's duration and status, AuthorCard's blog title, EventRow's time and LiveCard's details line used `text-meta` inside a focused row or tile. They now switch to `text-secondary`. LiveCard's focused surface was `surface-raised`; it is now `surface-focus-row`, as for every row and tile. The card's view tree is unchanged.
- **Labels.** `FocusableSurface` now requires `accessibilityLabel` at the type level. The flow-test harness (`src/test/flow.tsx`) checks the whole tree on every `focusOn` and `press` across 24 flow suites and fails on a focusable host view with a missing or blank label. `__tests__/labelGuard.test.tsx` proves the guard. No unlabelled focusable was found. Label wording: a value that already ends a sentence absorbs the template's period (`tf`), so «договариваться!. Алексей» now reads «договариваться! Алексей». SettingRow joins the description as its own sentence («Системный видеоплеер Выкл. Видео откроется…»; it used to be «Выкл Видео»). `joinSentences` moved from polls to `shared/i18n`. Poll checkbox states are capitalized («…31 голос. Не отмечено»; it was «не отмечено» after a period).
- **Font scale (owner decision 2026-11-01).** The shared `Text` (so every Button label) and the `TextField` input cap growth at 1.3× (`MAX_FONT_SIZE_MULTIPLIER`). Fixed heights stay.

Host checks: `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (160 suites, 3274 tests) and `npm run check:fixtures` (30 clean) pass. New and changed tests:
- `homeFeedFlow.test.tsx` «Story 9.4»: a remembered fifth Continue card on OK and on Back, and a remembered feed card with the row shown. The first two failed before the fix. A remembered Continue card that is gone on return falls back to its neighbour by index (§1.6), and the row opens at 0. `src/features/home/__tests__/continueRowOffset.test.ts` covers the offset.
- `searchFlow.test.tsx` and `authorFlow.test.tsx` «Story 9.4»: the sidebar fallback while the sheet is open. Both failed before the fix.
- `noRawStyleLiterals`, `contrast` (also `accent-text` and `text-card` on `surface-focus-row`, drawn but not in the table: 5.85 and 9.13 ≥ 4.5), `labelGuard` (also `TextInput` hosts, focusable unless `focusable={false}`); `catalog.test.ts` (the period rule); `Button.test.tsx` and `TextField.test.tsx` (the 1.3× cap); `MediaRow` (duration and status), `AuthorCard`, `LiveCard` and `eventsFlow` (EventRow time) for the focus colors.
- The 9.3 results hold: PostCard has no added view, `POST_GRID_DRAW_DISTANCE` is still 2 rows, and `homeFeedFlow` and `authorFlow` are green.

**Method.**
- **1080p (agent over adb).** Real account, 1920×1080 UI = 960×540 dp. The app was checked in the foreground before every key batch, and the focused node was read (`uiautomator dump`: bounds, `focused`, `content-desc`) before every OK. Screenshots of the real account stayed in the scratchpad and were deleted.
- **Playback.** Each player visit was meant to stay under 10 s with no pause or seek. **One visit ran about 11 s** (OK, then ↑ and ↓ with two dumps in between, then Back). It wrote a resume point of about 10 s on «ОТЕ №15: ракеты для Patriot кончились…», which now shows first in «Продолжить» («Осталось 62 мин»). The owner should know; nothing else was written.
- **720p (emulator).** AVD `tv_720p`: Android TV API 34, arm64, 1280×720 at 213 dpi, which gives 961×541 dp. Debug APK with Metro and a local, uncommitted `DEMO_MODE = true` (reverted; the release bundle has `createDemoSessionManager` 0). The family TV's display settings were not touched.
- **TalkBack (agent over adb).** Before: `enabled_accessibility_services` = `flar2.homebutton/a.i` («Button Mapper»), `accessibility_enabled` = 1, `touch_exploration_enabled` = 0. TalkBack (`com.google.android.marvin.talkback/.TalkBackService`, 14.2.0 leanback) was appended to that list. Afterwards both values were restored exactly, and only «Button Mapper» was bound. TalkBack 14.2 does not log its spoken text, and its developer log level was not changed. So the check was:
  - a Google TTS «Synthesis request» in logcat (ru-RU) for each focus move;
  - the words TalkBack reads, taken from the `content-desc` of the focused node.

  A `uiautomator` dump suspends TalkBack for a moment, so the speech runs had no dumps.
- **Font scale (emulator).** `settings put system font_scale` set to 1.3 and then 2.0, then deleted.

**Walk (1080p, agent over adb; 720p, emulator).**

| Screen | Layout vs DESIGN.md / mocks (as built) | Focus map: initial, arrows, OK, Back, restoration | Labels (`content-desc`) | 720p |
|---|---|---|---|---|
| B Главная with «Продолжить» | Row title, 3 cards on the grid's columns, the title row with «Фильтры» and «Обновить», a 3-column grid | Initial: the first Continue card. → along the row; ↓ keeps the column (card 5 → column 3). Настройки → «Главная» OK: the remembered fifth card is focused and the header is shown (fixed). Back from Настройки → `nav/home`, then → lands on the card | «{title}. {author}. Осталось N мин»; feed cards «Видео. {title}. {author}, {date}. Длительность h:mm:ss.» | Same layout (`home-720p.png`) |
| E Поиск | The field, «Фильтры» on the right, the hint | Initial: the field. → chip, OK → sheet («Доступные мне» focused), «Период» → list, Back → «Период», Back → the chip (**was lost; fixed**) | «Поиск по подпискам» (field), «Фильтры: Доступные мне», «Период За всё время» | — |
| C Подписки | 3 tiles, «Мой блог» first in the demo | Initial: the first tile; OK → Автор; Back → the same tile | «{owner}. {title}»; «Мой блог. {owner}. {title}» | `subs` checked |
| D Автор | Header, «В этом блоге» field, chip, 3-column grid, LiveCard in the demo | Initial: the first post (LiveCard from События in the demo). ↑ → the field, → chip; the sheet's Back → the chip (**fixed**). Back → the tile | «Эфир: {title}. Идёт эфир. 128 зрителей», «Нравится, 42», «Поделиться эфиром: QR-код со ссылкой» | `author-live-720p.png` |
| F Пост | One column: author row, title, «вчера · 22 лайка», «Смотреть», MediaRow, paragraphs, link chips, audio, poll | Initial: «Смотреть»; ↓ through the stops; Back from the player → «Смотреть»; Back → the card | «Автор: {name}. Открыть страницу автора», «Видео 1. Video. 1:02:04. Не начато», «{text}. Показать QR-код», «Аудио. {title}. 0:00 / 3:12. Воспроизвести», poll options «История, 78 %, 31 голос. Не отмечено» | `post-poll-720p.png` |
| G Плеер | Surface only (the overlay was not opened, see Not verified); on the emulator the error state | Initial: the surface; Back → «Смотреть»; error: «Повторить», ← → «Назад» | «Видео. OK — пауза, влево и вправо — перемотка» | error state checked |
| J События | Real account: the empty state. Demo: 5 rows, unread dots, «Эфир» chip | Empty: OK on «События» → «Обновить». Demo: the first row; OK on a stream → Автор on the LiveCard | «Новое. {name}: Начался эфир. Эфир. сегодня, 17:27» | `events-720p.png` |
| K Настройки | 3 rows (release); dialog over the scrim | Initial: «Версия»; ↑ → the toggle; «Выйти из аккаунта» → dialog on «Отмена», Back → the row; 7 × OK on «Версия» → Диагностика on «Запись логов» (left Выкл), Back → «Версия» | «Системный видеоплеер Выкл. Видео откроется…», «Версия 0.9.1», «Отмена», «Выйти», «Запись логов Выкл. Технический журнал…» | `settings` checked |
| A1, A2 | Hero, body, «Войти в Boosty»; phone form | Demo only (no sign-out on the TV): A1 → «Войти в Boosty»; A2 → the number field | «Войти в Boosty», «Код страны», «Номер телефона», «Получить код», «Назад» | `a1-font-*.png`, `a2-font-1.3-720p.png` |

**720p result:** at 1280×720 the app lays out as 961×541 dp, the same logical layout as 1080p. The DESIGN.md assumption («1280×720 gives the same 960×540 dp») holds on the emulator. Nothing was clipped or moved compared with 1080p.

**TalkBack (agent over adb).** Speech requests per key, without dumps:
- Главная: 7 moves, 6 spoken; the last ← had nothing to move to.
- Поиск: 4/4.
- Подписки: 5/5.
- Автор: 3 of 5. The first key after a dump is not spoken, and two ↑ moves toward the field «Поиск в блоге» gave no request. Whether the field is announced is still open.
- Пост: 7/7.
- Back, События, Настройки: 9 of 10.

D-pad focus moved as without TalkBack, and OK still activated items (TalkBack on Google TV). With TalkBack on, uiautomator shows react-native-tvos's focus guides as focusable views with the placeholder description «FocusGuide». The framework forwards them to a destination and says the placeholder is never spoken. Whether it is spoken is for the owner's listening session.

**Font scale (emulator, demo; `docs/screenshots/story-9-4/`).**
- At 1.3 the body text grows; «Войти в Boosty» fits its fixed 40 dp height.
- At 2.0 the text stays at 1.3×; the cap works. The line spacing of multi-line body text still grows, because React Native scales `lineHeight` past the cap.
- On A2 at 1.3, «Код страны» wraps to two lines, so the country field sits one line lower than the number field.

**Deviations and the owner's decisions (2026-11-01)** (screenshots from the emulator demo):
1. A2 at font scale 1.3: «Код страны» wraps to two lines and the two phone fields no longer line up (`a2-font-1.3-720p.png`). **Accepted as is.**
2. Field placeholders used `text-disabled` on `surface`: 3.01:1, below 4.5. **Fixed (owner's choice):** TextField placeholders now use `text-field.placeholder` = `text-tertiary`, 4.68:1 (DESIGN.md frontmatter and `contrast.test.js`). Not reinstalled on the device for this change alone.
3. With font scale above 1.3 (the 2.0 test; outside the TV's own text-size range), line spacing still grows (`a1-font-2.0-720p.png`). **Accepted.**
4. react-native-tvos's «FocusGuide» placeholder description (see TalkBack). It comes from the framework and cannot be fixed in the app. **Accepted**; revisit if the owner hears it while listening.

**Labels:** every focusable seen on the device had a Russian `content-desc` from `ru`, or one built from content with it. Exceptions:
- the native scroll containers (ScrollView / HorizontalScrollView, focusable for scrolling, no description);
- the «FocusGuide» placeholders while TalkBack runs.

**Not verified:**
- TalkBack by ear: **done by the owner, 2026-11-01.** The agent turned TalkBack on over adb (appended to «Button Mapper»); the owner listened with the remote to Главная, Пост, the player overlay and Настройки and reported «всё произносится нормально». The build on the device predates the review copy fixes («Не отмечено» capitalised, placeholder color). Afterwards the agent restored `enabled_accessibility_services` = `flar2.homebutton/a.i` and `accessibility_enabled` = 1 exactly.
- The physical remote.
- The player overlay and settings sheet on the device: opening them pauses or seeks the owner's video. Their labels are host-tested only.
- The A3–A11 sign-in screens on the device: no sign-out on the family TV.
- The Автор LiveCard on the real account: no live stream.
- A real event list: the account has no events.

**Device state afterwards:** the final release build is installed and open on Главная with focus on `nav/home`. TalkBack is off and the two accessibility settings have their previous values («Button Mapper» kept). «Запись логов» is Выкл, as before. The `log.tag` properties tried for TalkBack are cleared. Metro is stopped, the emulator is shut down and `DEMO_MODE` is `false`.

### Story 9.3 — Performance on the device, 2026-11-01

**Status: implemented and host-tested. Measured on the pinned Chromecast with Google TV by the agent over adb, using an owner-signed `assembleRelease -PreactNativeArchitectures=armeabi-v7a` build from this branch (`versionName 0.9.1`, installed with `adb install -r`, session kept, nothing uninstalled or cleared). The Подписки grid with 30 demo authors was measured on an Android TV emulator. Every row below is an agent-over-adb or emulator result; none is a physical-remote check. The owner checked the scroll with the physical remote on 2026-11-01 and accepted the held-↓ and Graphics exceptions.** `spec-9-3-performance-on-the-device.md`, [ADR 0015](adr/0015-post-grid-draw-distance.md).

Changes:
- **TTFF line.** `src/shared/services/perfMark.ts` holds `playerOpenMark`, a module-level mark that is taken once. The openers set it: the Post's video row and «Смотреть» (`post`), a timestamp chip (`timestamp`), a «Продолжить» card (`continue`) and Автор's live card (`live`). `usePlaybackSession` takes the mark at mount. The first `onReadyForDisplay` of that opening logs `logger.info('player', 'first frame', { ms, origin, kind })`, where `kind` is `hls`, `mp4`, `dash` or `live`. A quality switch, a recovery or a live-edge remount logs nothing more. An engine error or the error phase (an E8 failure included) clears the mark, so an opening that failed has no line, even after «Повторить». The time is monotonic (`performance.now()`). An early Back unmounts the player with the mark unlogged. A hand-off to the system player (`PlayerEntry`) also clears it. The line carries no URL, id, title or account data. `PlayerEngineView` passes react-native-video's `onReadyForDisplay` through the port.
- **Grid.** `POST_GRID_DRAW_DISTANCE` changed from 3 rows to 2 (ADR 0015). It applies to Главная and Автор.

Host checks: `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (156 suites, 3211 tests) and `npm run check:fixtures` (30 clean) pass. New tests:
- `src/shared/services/__tests__/perfMark.test.ts`: the mark is taken once, a later mark replaces an earlier one, and the default time is now.
- `__tests__/playerFirstFrameFlow.test.tsx`: origin `post` with one line across repeated «ready» events; kind `mp4` and `dash`; origin `timestamp`; no second line after a quality switch or a recovery; no line after an error before the first frame; no line on an early Back, and the next opening is timed from its own press.
- `playerFirstFrameFlow.test.tsx` also covers «Смотреть» (origin `post`) and an E8 failure followed by «Повторить» (no line).
- `homeFeedFlow.test.tsx`: origin `continue`, and `drawDistance` pinned to 2 rows.
- `authorFlow.test.tsx`: OK on the real Автор LiveCard gives `origin: live`, `kind: live`.
- `externalPlayerFlow.test.tsx`: the hand-off fallback logs no line.
- `PlayerEngineView.test.tsx`: `onReadyForDisplay` passes through.
- `liveFlow.test.tsx`: `kind: live`, with no line after the live-edge remount.

`loggerFieldKeys` covers the new call site.

**Method.** The device has 2 GB of RAM, a 1920×1080 UI and API 34. Its owner keeps the «Button Mapper» accessibility service enabled, which listens to window-content and scroll events. It was left as it is, so the numbers include its overhead.
- Each scroll run starts from a cold start (`am force-stop`, then launch) on Главная with the owner's real feed and the «Доступные мне» filter. E5 pages hold 10 posts each.
- «↓ held» means 20 s of `input keyevent` bursts of 6 ↓, about 16 key events per second, which is close to the remote's auto-repeat.
- «Single steps» means 40 ↓ 0.5 s apart. That covers 40 rows and about 12 page loads.
- Frames come from `dumpsys gfxinfo <pkg> reset`, then a dump after the run: janky %, percentiles, and the histogram buckets of 300 ms and more. Longest frames and mount work come from `atrace -a <pkg> gfx view input sched` during the single steps (top-level `Choreographer#doFrame`, `IntBufferBatchMountItem::mountViews`, `premountViews`).
- TTFF is the `first frame` lines in the Diagnostics log file: «Запись логов» on, then `adb pull`, then capture off.
- Memory is `dumpsys meminfo <pkg>` every 2 min (TOTAL PSS, Graphics).

**Profiling (atrace, ↓ held, ADR 0011 setup).** Every long frame came 0.3–0.5 s after an E5 response (11 page loads in 15 s; the hold outruns 10-post pages). The worst frame, 400 ms, was a single Fabric batch: `preMountItems` 107 ms, `mountViews` 205 ms (`UPDATE_STATE` ×79 67 ms, `UPDATE_LAYOUT` ×99 123 ms) and a 73 ms draw. Over the run the main thread was busy 8.3 s of 16 s, the JS thread 6.1 s and RenderThread 6.3 s. Images keyed by URL created 164 `RCTImageView`s.

**Scroll (Главная, owner's feed).**

| Build | ↓ held 20 s: janky / frames ≥ 300 ms / 99th | 40 single steps: janky / frames ≥ 300 ms / 99th | Longest frames in single steps (atrace) |
|---|---|---|---|
| Before (ADR 0011, `drawDistance` 3 rows), 3 + 2 runs | 19.9 / 20.7 / 20.9 %; 1–5 per run (max 550 ms); 200 ms | 5.3 / 5.5 %; none; 150 ms | 312–336 ms; frames over 100 ms add up to 1.15–1.40 s per 40 rows |
| Rejected: earlier prefetch | 27.7 %; 1 | 9.4 %; none | — |
| Rejected: images not keyed by URL | 18.2 / 26.4 %; 1–3 | 4.9 %; 1 | — |
| Rejected: E5 page size 30 | 19.1 / 20.1 %; 5–6 (max 500 ms) | 7.4 %; 1 | — |
| Rejected: `drawDistance` 1 row | 25.1 / 27.3 %; none | 6.9 %; none | — |
| **After (`drawDistance` 2 rows), 4 + 2 runs** | **14.8 / 19.3 / 21.0 / 21.2 %; 0, 0, 1, 2 per run; 150–200 ms** | **4.4 / 5.3 %; none; 97–109 ms** | **140–148 ms; frames over 100 ms add up to 0.37–0.80 s per 40 rows** |

The total mount work per row did not change: `mountViews` plus `premount` was 1.5–2.1 s per 40 rows in both builds. The fix spreads it over more, smaller frames. The Google TV launcher's 0 % (Story 3.1) is the reference point.

Columns on a fast ↓ (after): column 3 kept for 60 ↓ at 0.15 s, 60 ↓ at 0.3 s and a burst of 20; column 1 kept for a 15 s hold; column 2 kept for a 10 s hold.

**Scroll result:**
- Single steps meet the target: no frame of 300 ms or more, and 4.4–5.3 % janky.
- **Exception, accepted by the owner 2026-11-01 after the physical-remote check: ↓ held.** Janky frames are 15–21 % against the 10 % target, and 2 of 4 runs still had one or two frames of 300–350 ms. Cause: each 10-post page arrives while focus waits at the end of the list, and its rows mount at once. On top of that, every row that scrolls in rebinds 3 cards (text state, layout, two images), and this 2 GB device with the accessibility service needs about 30–36 ms per frame anyway. Focus waits for each page (about 1.2 s per E5 round trip) during a long hold. That wait is the network, not a backlog of key events: after a 10 s hold, focus was on the same card right after the last key and again 3 s later (uiautomator bounds). Not tried: fewer views per card, and replacing the image views. Both change the card's design or ADR 0011's stale-image guard and need the owner.

**Подписки grid (emulator, not the device).** An Android TV API 34 arm64 emulator (`tv_1080p`, host GPU) ran a debug build with the demo on, `DEMO_SUBSCRIPTIONS` temporarily 30 (uncommitted, reverted), and Metro dev JS. It showed 31 tiles («Мой блог» plus 30) in 11 rows.

| Run | Janky | 99th | Frames ≥ 300 ms |
|---|---|---|---|
| 15 ↓ at 0.5 s | 7.1 % | 20 ms | none |
| 15 ↑ at 0.5 s | 6.5 % | 21 ms | none |
| Hold ↓ 8 s, then ↑ 8 s | 6.4 % | 17 ms | none |

Column 1 kept on the way down, and column 3 kept for a burst of 12 ↓ and 12 ↑ at 0.15 s. The 30-author numbers are **emulator** numbers. The real account has 3 subscriptions, so the grid with 30 or more authors has not been measured on the device.

**Time to first frame (OK → first rendered frame, including the E8 resolve).** `onReadyForDisplay` is Media3's `STATE_READY`. For a resume it fires at the first frame before the seek to the resume point, so «Продолжить» times exclude that seek.

| Run | Starts | Median | Worst | Target (median ≤ 2 s, worst ≤ 4 s) |
|---|---|---|---|---|
| Post's video row, OK → 5 s → Back (no progress write, «Не начато» stayed) | 10, all `hls` | 1.29 s | 2.01 s | **pass** |
| «Продолжить» card, OK → 5 s → Back | 10, all `hls` | 1.54 s | 2.20 s | **pass** |
| «Смотреть» during the memory run (cold network and cache, different videos) | 11, all `hls` | 1.77 s | 2.86 s | pass |

The individual times in ms: post row 1118–2006 (1118, 1158, 1240, 1250, 1280, 1293, 1314, 1344, 1495, 2006); Continue 1404–2201 (1404, 1413, 1415, 1432, 1477, 1593, 1609, 1621, 1637, 2201). Every start played: 31 `first frame` lines in total, and no `playback failed` line. The pulled log had no URL query, `Bearer`, token, phone or 7+ digit run. Capture was turned off afterwards, the folder is empty, and the local copies are deleted.

**Memory, 1 hour (agent over adb, 2026-11-01 14:11–15:12).** One cold start, then a loop for 60 min: 3–12 ↓ on Главная, OK on the card, then OK on «Смотреть» or the video row, about 5 min of playback, then Back twice. That made 13 iterations: 11 played (about 55 min of video) and 2 text posts were opened and closed. The resume points and «Продолжить» changed, as the owner allowed. `dumpsys meminfo` ran every 2 min (31 samples).

| Window | TOTAL PSS | Graphics |
|---|---|---|
| Start (cold) | 152 MB | 25 MB |
| 10 min | 296 MB | 57 MB |
| 20 min | 327 MB | 79 MB |
| 30–60 min | 326–356 MB, no trend | 114–118 MB |
| Last 40 min, linear slope | **−0.25 MB/min** (target < 1 MB/min) | +0.53 MB/min, all of it before 30 min; flat from 30 min |

MB here means MiB (kB / 1024). The run kept Shell, Post and Player mounted together every iteration (the JS-stack risk above).

**Result: PSS meets the criterion. Graphics is a deviation, accepted by the owner 2026-11-01 after the physical-remote check.**
- PSS has no trend after 20 min, and its slope over the last 40 min is −0.25 MB/min.
- The spec asks for Graphics to be stable after the first 10 min. Instead it rose from 57 MB to about 117 MB between 10 and 30 min, while new feed images were decoded.
- From 30 min Graphics stayed flat at 114–118 MB. That is the image-cache plateau of about 115 MB also seen in Story 3.1, not a leak: it stopped growing while the browsing went on. Views stayed between 393 and 585, and Activities stayed at 1.

**Found on the way (not caused by this story):** Главная has a «Продолжить» card as its remembered focus. Open Настройки from the sidebar, then press ← and ↑ to «Главная» and OK. Главная then shows the feed scrolled past its header, and nothing has focus (uiautomator shows no focused node). This happened twice on this build and once on a build with the old `drawDistance` 3. When a feed card is the remembered focus, the same path works. The problem is recorded in deferred work and is not fixed here.

**Owner check (physical remote, 2026-11-01):** the owner scrolled Главная with the physical remote (single steps and ↓ held) and accepted both exceptions (held ↓, Graphics plateau).

**Not verified:** the Автор grid (same component, not measured separately); TalkBack; the 55-author grid on the device; live and timestamp TTFF on the device (host-tested only).

### Story 9.2 — Update notice and in-app install from GitHub Releases, 2026-11-01

**Status: implemented and host-tested; the release build checked on the build host; the full update path run on the pinned device (2026-11-01, below): agent over adb up to the dialog, the owner with the physical remote for the permission screen and the system installer.** `spec-9-2-update-notice-from-github-releases.md`. `UpdateChecker` (`src/features/update/`, wired in `src/app/update.ts` over `fetchTransport`) reads `GET https://api.github.com/repos/dzmitryafanasenka/boosty-tv/releases/latest` with only `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`, `credentials: 'omit'`, a 10 s timeout and no retry: on start and on return to the foreground at most once per day (`update.state.v1` in `boostytv-device`), and on the first OK of a «Версия» press series at most once per 60 s. A newer `vX.Y.Z` tag shows the passive plaque (about 10 s, not focusable, never over the Player) and «0.9.0 · доступна X.Y.Z»; OK opens the update dialog (K5, `docs/focus-map.md` §5). After «Скачать и установить»: `canRequestPackageInstalls` (else «Открыть настройки» → `ACTION_MANAGE_UNKNOWN_APP_SOURCES`), the download of the device-ABI asset (else the universal one) through `AppUpdaterModule.kt` into `cacheDir/updates/update.apk` with progress (Back cancels and deletes it), the SHA-256 check against GitHub's asset digest, and `ACTION_INSTALL_PACKAGE` with a FileProvider URI. A failure, a mismatch or an installer cancel shows the reason and the QR. Phase flag `updateCheck`; off in the demo.

Host tests:
- `src/features/update/__tests__/releaseInfo.test.ts`: tag / versionName parsing and numeric compare, the notes before `---` as capped plain text, the release shape, the page URL fallback, the stored copy, and the asset pick (per-ABI in device order, the universal fallback, no asset, no or bad digest, a foreign or non-HTTPS URL, bad sizes, no fallback from an unusable per-ABI asset).
- `src/features/update/__tests__/updateChecker.test.ts`: every check row of the matrix (newer on start, within a day, persisted gate, same, stored release dropped after the update, manual OK and its 60 s throttle, one request at a time, demo / flag off / unparsable version → no request), the request URL and exact headers, one log entry per failure (`reason`, `status`), the timeout.
- `__tests__/updateDialog.test.tsx` (fake port): info with «Закрыть» focused and nothing downloaded, the allowed install (progress → verify → installer), installer cancelled, digest / network / storage failures with the QR and no retry, Back and «Отменить» cancel and the dialog stays, unmount cancels, not allowed → the system screen → granted on return → download, still denied → the QR, the settings screen missing, the ABI fallback, no digest / foreign URL / no asset → the QR at once, empty notes, logs without URL / digest / path.
- `src/features/update/__tests__/UpdatePlaque.test.tsx`: the text, not focusable / no touches / hidden from accessibility, gone after 10 s, Player on top → none and dropped.
- `src/shared/platform/__tests__/appUpdater.test.ts`: the port without a module, progress events, the native codes, install answers, the permission calls.
- `__tests__/appUpdaterModule.test.js`: a source guard for the module (registration, `ACTION_INSTALL_PACKAGE` + FileProvider, no PackageInstaller session, the repository prefix, HTTPS and GitHub-only redirects, SHA-256, delete on failure, nothing logged), the manifest permission and provider, `update_file_paths.xml` (`cache-path updates/` only) and the gradle splits.
- `__tests__/updateFlow.test.tsx` (the real App): the start-up request with no Boosty headers and nothing else fetched off Boosty, the plaque never focusable and focus unchanged, gone after 10 s, a restart within a day, same version, the flag off, the row hint and its a11y label, OK → the dialog («Закрыть» focused, no extra request), Back → «Версия», no download before «Скачать и установить» and then the repository URL, manual OK → the dialog, the seven-press gesture → one request and Diagnostics, a failed manual check → one log entry.
- `__tests__/demoFlow.test.tsx`: the demo sends no check and shows no plaque. `src/app/__tests__/phaseFlags.test.ts`: the new flag.

Checks run (build host):
- `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` (30): clean.
- `npm test`: 154 suites, 3185 passed in two of three full runs; one run had one failure in `src/shared/api/__tests__/sessionManager.test.ts` (untouched by this story), which passed in four isolated runs: recorded as a flake to watch.
- `(cd android && ./gradlew clean assembleRelease)` (`JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, the owner's signing properties, values never read): BUILD SUCCESSFUL; `app-armeabi-v7a-release.apk`, `app-arm64-v8a-release.apk`, `app-x86-release.apk`, `app-x86_64-release.apk` (one ABI each in `native-code`) and `app-universal-release.apk` (all four); every APK `Verifies` (v2), the release certificate SHA-256 `b7b8b0f1…c47d59eb`, `versionCode='900' versionName='0.9.0'`, `REQUEST_INSTALL_PACKAGES`; the merged manifest has the FileProvider `io.github.dzmitryafanasenka.boostytv.updates`, not exported, with URI grants.

Device: **not run yet.** Planned row (spec «Device»; owner with the physical remote for the installer screens, the agent over adb for the rest): a temporary uncommitted build with `versionName "0.8.0"` / `versionCode 900`; the plaque, the hint, the dialog, the first-time «Установка неизвестных приложений» screen, the download of the v0.9.0 universal APK (the fallback path: v0.9.0 has no per-ABI assets), the digest, the system installer → the real 0.9.0 installed, the session kept.


Device (Chromecast with Google TV, API 34, 2026-11-01). A temporary, uncommitted build from the 9.2 tree with `versionName "0.8.0"` and `versionCode 900` (`assembleRelease -PreactNativeArchitectures=armeabi-v7a`, the release key; `build.gradle` restored right after), installed with `adb install -r` over the published 0.9.0:

| Row | Result | Who |
|---|---|---|
| Install over 0.9.0 | `Success`, `versionName=0.8.0`, `versionCode=900`; cold start → Главная, session kept | agent via adb |
| Newer on start | The plaque «Доступна версия 0.9.0 · Настройки → Версия» at the bottom right; focus stayed on the first card | agent via adb (screenshot) |
| Row hint | Настройки → «Версия 0.8.0 · доступна 0.9.0» | agent via adb (screenshot) |
| OK on «Версия» | Dialog «Доступна версия 0.9.0»: the Russian notes (capped with «…»), «Скачать и установить», «Закрыть» (focused) | agent via adb (screenshot) |
| Permission | «Скачать и установить» → the explanation → «Открыть настройки» → the system «Установка неизвестных приложений» screen; enabled, Back → the download continued | owner, physical remote |
| Download + digest | The v0.9.0 release has only the universal asset, so the universal fallback was used (83 962 932 bytes); progress, then the SHA-256 check passed (the installer opened) | owner, physical remote |
| System installer | `com.google.android.packageinstaller` opened; the owner confirmed; installed: `versionName=0.9.0`, `versionCode=900`, same signature, `lastUpdateTime 13:05:31`; `REQUEST_INSTALL_PACKAGES: allow`; the session kept | owner (remote), agent via adb (`dumpsys`, `appops`) |

Not seen on the device: a per-ABI asset (first possible with the next release), a digest mismatch, cancel during the download, the denied-permission return, a failed install (host-tested). The installed 0.9.0 has no updater, so the downloaded file stays in `cacheDir/updates/` until the next start of a build with the updater (`cleanup` on start).

Release `v0.9.1` (2026-11-01, owner's explicit OK): built from `main` `e054d8c` with a clean tree after lint, typecheck, `npm test` (3198 passed) and `check:fixtures`; `./gradlew clean assembleRelease` → four per-ABI APKs and the universal one, all `versionName 0.9.1`, `versionCode 901`, the release certificate, one ABI each in `native-code` (universal: all four). Published as `boosty-tv-0.9.1.apk` and `boosty-tv-0.9.1-{armeabi-v7a,arm64-v8a,x86,x86_64}.apk`; GitHub's asset digests equal the local SHA-256 values; `releases/latest` returns `v0.9.1`. The one manual install on the pinned device (agent, `adb install -r boosty-tv-0.9.1-armeabi-v7a.apk` over 0.9.0): `versionCode=901`, session kept, no plaque, Настройки «Версия 0.9.1» without a hint (the stored v0.9.0 entry dropped); one OK on «Версия» showed nothing (whether the request went out was not observed: log capture off, `run-as` refused on release). From now on the TV can update itself from the app (the per-ABI path will first run with the next release).
### Story 9.1 — Signed release on GitHub Releases, 2026-11-01

**Status: implemented, host-checked and checked on the pinned device (agent over adb, the owner signed in with the physical remote); published as GitHub Release `v0.9.0` (below).** `spec-9-1-signed-release-on-github-releases.md`. Release signing from four owner-held Gradle properties (all set: signed; none or empty: unsigned; partial: `checkReleaseSigning` fails before packaging and names only the missing keys), `versionName` `0.9.0` validated as `MAJOR.MINOR.PATCH` with `versionCode` 900 derived from it, the final neutral banner (`drawable-xhdpi/tv_banner.png`, 320×180) and adaptive icon (`mipmap-anydpi-v26`, vector foreground, legacy PNGs) rendered by `android/branding/render.mjs` with headless Chrome, `CHANGELOG.md` / `CHANGELOG.ru.md`, and [release.md](release.md).

Host tests: `__tests__/releaseSigning.test.js` (source guard: the four property names only, no literal secret, signing gated on all four, the partial-set check before `preReleaseBuild`, the demo guard kept, the version format and derived code); `__tests__/androidManifest.test.js` (the banner resolves to one 320×180 xhdpi PNG; the adaptive icon XML and the legacy PNG sizes).

Builds (build host, `-PreactNativeArchitectures=armeabi-v7a`): with all four properties overridden empty → `app-release-unsigned.apk`, `versionCode='900' versionName='0.9.0'`, cleartext and backup off, banner present; with the owner's properties (values never read by the agent) → `app-release.apk`, `apksigner verify --print-certs`: v2 verified, certificate DN not `CN=Android Debug`, certificate SHA-256 `b7b8b0f1…c47d59eb`; one property set and three empty → fails with the three missing names; a temporary `versionName "1.0"` → fails at configuration with the expected format (reverted).

Review fixes (host): a blank-only property counts as not set; with all four set, `checkReleaseSigning` also requires an absolute path to an existing store file (the message names the key, never the path); CI now runs `checkReleaseSigning` with one dummy property (must fail, name the other three keys and not print the value) and checks `versionName` / `versionCode` from `aapt dump badging`. `npm test`: 147 suites, 3112 passed; lint, typecheck and `check:fixtures` clean.

Device (Chromecast with Google TV, API 34, 2026-11-01, `assembleRelease -PreactNativeArchitectures=armeabi-v7a` signed with the owner's key, certificate SHA-256 `b7b8b0f14ffcd2b7fc153891ed660c0c8d61c264128c1bce0386e312c47d59eb`):

| Row | Result | Who |
|---|---|---|
| Key switch | `adb install -r` over the old SDK-debug-key build (`versionCode 1`, `1.0`) → `INSTALL_FAILED_UPDATE_INCOMPATIBLE`; one-time `adb uninstall` (owner-approved), then `adb install` → `versionCode=900`, `versionName=0.9.0`, the new signature | agent via adb |
| Sign-in | A1 sign-in screen after the fresh install; phone and code entered by the owner | owner, physical remote |
| Update in place | the same-key APK again with `adb install -r` (`lastUpdateTime` changed) → cold start opens Главная with the feed, no sign-in: the session is kept | agent via adb (screenshot) |
| «Версия» | Настройки → «Версия 0.9.0» | agent via adb (screenshot) |
| Launcher | Google TV home, «Ваши приложения»: the new «Boosty TV» banner (mark + wordmark) is shown; a fresh install is placed at the end of the grid, not in the first row | agent via adb (screenshot) |

The adaptive icon is not shown by the Google TV launcher (it uses the banner); it was checked only as rendered PNGs.

Release (2026-11-01, owner's explicit OK): built from `main` `a4030ce` with a clean tree after lint, typecheck, `npm test` (3112 passed) and `check:fixtures`; `./gradlew clean assembleRelease` (all four ABIs in `native-code`, `versionCode 900`, the release certificate). Tag `v0.9.0` → GitHub Release «Boosty TV 0.9.0» with one asset, `boosty-tv-0.9.0.apk` (83 962 932 bytes, SHA-256 `8ae553944244ba885b65663589057a55aad513c84f401eb7f218458b8b9e4d96`, equal to GitHub's asset digest); notes in the documented RU / `---` / EN format with both digests. `GET /repos/dzmitryafanasenka/boosty-tv/releases/latest` returns `v0.9.0`.

### Epic 8 retro A4 — playerFlow split, 2026-10-31

**Status: test-only refactor; host-tested.** `spec-epic-8-retro-a4-split-player-flow.md`. `__tests__/playerFlow.test.tsx` (4415 lines, 192 tests) is split by story area: `playerFlow` (open, errors, overlay/keys/seek, arbiter, the 4.1 review fixes, the 4.5 end-exit rows, the Epic 3 retro A6 locked-E8 session check, 6.3 timestamps), `playerProgressFlow` (4.2), `playerQualityFlow` (4.3), `playerRecoveryFlow` (4.4, the debug broken URL, 4.6), `liveFlow` (7.2 with the 7.3 heartbeat), `playerSpeedFlow` (8.1) and `externalPlayerFlow` (8.2). The shared setup (constants, fixtures, the flow instance, the transport routing, the hooks, `fire` / `openPlayer` / `failPastRecovery`) is `src/test/playerFlowHarness.tsx`: each file repeats the same `jest.mock` block and calls `setupPlayerFlowHarness()`, which returns the per-test `handlers` (E8/E9/E15/E16, the held E1, the refresh reply, the transport). Test names and bodies are unchanged except `e8 = …` → `handlers.e8 = …` (and the same for the other handlers); no production code changed.

Host: lint (`--max-warnings 0`), typecheck clean; the seven files (`npx jest __tests__/playerFlow.test.tsx __tests__/playerProgressFlow.test.tsx __tests__/playerQualityFlow.test.tsx __tests__/playerRecoveryFlow.test.tsx __tests__/liveFlow.test.tsx __tests__/playerSpeedFlow.test.tsx __tests__/externalPlayerFlow.test.tsx`): 192 passed, the sorted full test names identical to the pre-split list (192 names, SHA-256 of the sorted newline-joined list starts `216220bcb1941a79`); older entries that ran `__tests__/playerFlow.test.tsx` alone covered all 192 player flow tests, today that command covers 68; historical entries keep the file names of their date, with «now `X`» where a moved test is named; `npm test`: 146 suites (was 140), 3104 passed. No device check (nothing the device runs changed).

### Epic 8 retro A3 — one device-preference factory, 2026-10-31

**Status: host-tested, plus a short agent device check without playback (below).** `spec-epic-8-retro-a3-device-preference.md`. The quality, speed, «Системный видеоплеер» and «Запись логов» stores are definitions on `createDevicePreference` (`src/shared/storage/devicePreference.ts`); keys and stored strings unchanged (`player.quality.v1`, `player.speed.v1`, `player.external.v1`, `diagnostics.capture.v1`). One demo setter, `setDevicePreferenceKeyValueStore`, replaces the four per-store setters. The capture preference moved from `logFileSink.ts` to `src/shared/services/diagnosticsCapture.ts`, and its `set` is now `write`. `useExternalPlayerPreference` and `DiagnosticsScreen`'s toggle state use `usePreference` (a single-consumer snapshot hook, no subscription). `usePlayerSource`, `PlayerEntry` and `ExternalHandoff`'s quality peek / read stay as they were on purpose: they gate the engine or `useMediaSource`, not a plain peek-read-setState. `remember` exists only on quality (`rememberable: true`), also at runtime; the capture returns explicit fields. A throwing `onValue` is logged once (`<label> not applied`) and does not leave the read stuck. `createDiagnosticsCapture(sink, { kv?, logger? })`. Lines across the four store files plus the factory: 513 → 448 (125 + 126 + 146 + 116 → 55 + 59 + 60 + 68 + 206).

Host tests: `src/shared/storage/__tests__/devicePreference.test.tsx` covers the factory on a generic definition (fallback, single-flight read, a pick wins, failures only logged, `forget`, `onValue` once per finished read and per write and not again when a pick won, a throwing `onValue`, `remember` only with `rememberable`) and `usePreference` (read then value, write, already in memory, disabled, a rejected read → the fallback, a new store → its snapshot). `__tests__/devicePreferences.test.tsx` runs the store contract once per app definition (first run → the fallback, one single-flight read of its key, junk or a failed read → the fallback with one warning and no fields, a pick during the read wins, a failed write is only logged, `forget` drops memory only, a synchronous `kv()` throw), plus the unchanged keys, `remember` on quality only, the capture's sink effects (first run: one `disable`, never `enable`; a pick during the read applied once), and the one setter moving all four app stores for reads and writes (the default store restored after each test, `logFileSink` stubbed). The per-store files keep their parse / label cases; `logFileSink.test.ts` keeps the capture's sink effects. Flow tests (`playerFlow`, `homeFeedFlow`, `diagnosticsFlow`, `demoFlow`, `signOutFlow`) unchanged except the `diagnosticsFlow` import path. Lint (`--max-warnings 0`), typecheck and `check:fixtures` clean; `npm test` ×3: 3104 passed; the touched suites plus `playerFlow`, `homeFeedFlow`, `demoFlow` ×30: 0 failed runs (503 each).

Device (agent over adb, Chromecast with Google TV, release-like build from `5fd6545`, `adb install -r`, the owner's stored values, no playback): Настройки showed «Системный видеоплеер · Выкл» and Diagnostics «Запись логов · Выкл» (log folder empty), as stored before the change; with the toggle briefly on, the «Качество» list on a Continue card opened with focus on the stored 1440p, Back returned to the same card («Осталось 108 мин» unchanged), and the toggle was set back to «Выкл». The speed (1×) is visible only inside the player and was not opened on the device (host-tested).

### Story 8.3 — Hidden diagnostics for testing, 2026-10-31

**Status: implemented, host-tested, and checked on the device by the agent over adb, before and after the review patches (below).** `spec-8-3-hidden-diagnostics.md`. Seven OK presses on Настройки' «Версия», each less than 2 s after the previous one, push the hidden `Diagnostics` route (phase flag `diagnostics`, on; the route ships in release, only the gesture reveals it). «Версия» stays an info row: no press scale, role `text`. The press handling is `useVersionPresses` (`src/features/settings/`); its `onFirstPress` hook is where Epic 9's single-press update check goes, and it runs once per series. Diagnostics has «Запись логов» (device-scoped `diagnostics.capture.v1` in `boostytv-device`, default off, the initial focus) and «Очистить логи», followed by the adb steps and the folder the app reports. Log lines are never shown. Back pops to Настройки with focus on «Версия».

While capture is on, `logFileSink` (`src/shared/services/logFileSink.ts`) first writes the Logger ring and then every new entry. Entries are already redacted by the Logger. The sink formats each as one line and appends batches (≤ 20 lines, or 1 s after the first) through the LogFile port (`src/shared/platform/logFile.ts` → `LogFileModule.kt`). The native side writes `getExternalFilesDir(null)/logs/boostytv.log` on one serial thread, rotates it to `boostytv.log.1` at 256 KB (≤ 512 KB in total), and needs no permission. A stored «on» resumes capture at app start. A failed append logs one warning, to the ring only, and capture stays on.

Account scope: `logFileAccountStore` (`logFile`) is registered in `bootstrap.ts` right after the ring. On reset it drops the queued lines and clears the file. Each batch carries `accountScope.guard('logFile')`, so a batch of an older generation is dropped. A failed native clear is reported in `failed[]`.

Logger redaction (`logger.ts`) adds:
- `Cookie:` / `Set-Cookie:` and any `Authorization:` value (to the end of the line);
- bare query strings with `expires=` / `sig=`;
- `access_token`, `refresh_token`, `token`, `signedQuery`, `sig`, `signature` (also `authorization`, `cookie`, `set-cookie`) as query or JSON keys, string or bare values;
- field keys naming token / cookie / authorization / signedQuery / phone / code in any case (`isSecretFieldKey`), whose values are always `<redacted>`. Epic 8 retro A1 (2026-10-31): `code` counts only as a one-time or access code (`SECRET_CODE_KEY` in `logger.ts`): `code` / `codes`, `codeVerifier` / `codeValue`, a qualifier (sms, otp, auth, verification, confirm(ation), onetime, pin, pass, access, security, login, device, mfa, 2fa, twofactor, recovery, backup, reset, activation, email) followed by `code(s)`, also as the last dotted segment (`user.code`); `challenge` joined the contains-words. So `versionCode`, `errorCode`, `statusCode`, `countryCode`, `codec` and `decoder` stay readable, and bare `code` is still secret (AudioBlock keeps its `error` key). `__tests__/loggerFieldKeys.test.js` parses every non-test `.ts`/`.tsx` file under `src` with the TypeScript compiler, including the `secureStore` `log(...)` wrapper, and fails on a field key that would be silently redacted or on a fields argument it cannot read (a variable, a foreign spread, a computed key). Checks: lint and typecheck clean; `npm test` ×3: 3080 passed.

`AudioBlock`'s engine-error field was renamed from `code` to `error`, so it is not redacted.

Host tests:
- `src/shared/services/__tests__/logger.test.ts`: every new secret kind, the field-key rule, the sink hook.
- `src/shared/services/__tests__/logFileSink.test.ts`:
  - line format and cut, capture off, the ring dump then new entries, batching 20 / 1 s;
  - every file line redacted, disable, a failed append (one ring-only warning);
  - clear, the stale-generation drop, and the acceptance: after a sign-out the file holds no line of the previous account, an in-flight append is cleared by the reset's ordered clear, a failed clear lands in `failed[]`;
  - the capture preference.
- `src/shared/platform/__tests__/logFile.test.ts`: no module, call order, fixed errors, location.
- `__tests__/logFileModule.test.js`: a source guard for registration, path, cap, serial thread, no content logging, no storage permission, `allowBackup=false`.
- `src/features/settings/__tests__/useVersionPresses.test.ts`.
- `__tests__/diagnosticsFlow.test.tsx`: the gesture, Back to «Версия», single / six presses, slow presses, the flag off, the toggle with the ring dump and the KV value, the folder, clear, reset.
- `shellPrimitives.test.tsx`: an info row with `onPress` keeps its role and look.
- `accountScopeRegistry.test.js` now expects `logFile`. `releaseBundle.test.js` asserts the Diagnostics ids are in the release bundle. `phaseFlags.test.ts` covers the new flag.

Checks run:
- `npm run lint -- --max-warnings 0`, `npx tsc --noEmit`, `npm run check:fixtures` (30): clean.
- `npm test`: 136 suites, 3004 tests passed (the release-bundle test included).
- `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` with `JAVA_HOME=/opt/homebrew/opt/openjdk@17` and `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`: BUILD SUCCESSFUL.
- Not run: any device or emulator check. The rotation at 256 KB and the native call order are covered only by code and the source guard.

Review patches (2026-10-31, `fix: review patches for Story 8.3 hidden diagnostics`):
- `logPath` (http log lines) keeps only the fixed API words; the blog slug after `/v1/blog/` is `<blog>`, every other variable segment `<seg>` (`/v1/feed/post/`, `/v1/user/current` unchanged). Test: `src/shared/api/__tests__/logPath.test.ts`.
- `LogFileModule.kt`: below API 29 the file is in the internal `filesDir/logs` (external files are shared storage there), so **adb pull works only on API 29+** (the pinned device is API 34); `location()` reports the directory in use. A failed rotation rename truncates the current file instead of failing every later append.
- `logFileSink`: the waiting batch is written when the app goes to the background (subscribed only while capture is on). Turning capture off drops the queue and deletes `boostytv.log` / `.1` (not the ring); the on-screen step 4 says to pull before that.
- Logger: `isSecretFieldKey` matches the secret words inside the compact lowercased key (`accesstoken`, `smscode`, `phonenumber`, `sessioncookie`; `decoder` now matches too, accepted) and `sig` / `signature` keys; the query and JSON rules accept a `<prefix>_` (`id_token=`, `csrf_token=`, `api_sig=`).
- Diagnostics: a rejected capture read shows «Выкл».
- New tests: the toggle stored «on» resumes capture at a cold start without opening Diagnostics (`diagnosticsFlow`, fresh modules); a rejecting native clear shows «Не удалось очистить логи» with focus kept; an info row with `onPress` never animates to the pressed scale (`shellPrimitives`); AudioBlock logs the engine code under `error`, unredacted.

Device (agent over adb, Chromecast with Google TV API 34, release-like build from `3250ed4`, the owner's session):
- One OK on «Версия» did nothing; 7 OK 0.5 s apart opened «Диагностика» with focus on «Запись логов».
- OK → «Вкл», and `boostytv.log` appeared in `/sdcard/Android/data/io.github.dzmitryafanasenka.boostytv/files/logs/`. Back → Настройки with focus on «Версия».
- After `am force-stop` and a relaunch capture continued (the toggle still «Вкл», 12 lines). `adb pull` worked on the release build.
- A scan of the pulled file found no URL query, `Bearer`, 7+ digit run, 32+ character opaque run or secret `key=value`.
- OK → «Выкл», then «Очистить логи» → «Логи очищены» and the folder empty.
- Second run after the review patches (release-like build from `bb85d8e`): the gesture opened Diagnostics with the new step-4 copy; capture on, Подписки → an author page → Back, then `adb pull`: 13 lines, the http paths read `/v1/blog/<blog>`, `/v1/blog/<blog>/post/`, `/v1/blog/<blog>/video_stream`, `/v1/feed/post/`, `/v1/user/current`, `/v1/user/subscriptions`; no author name, URL query, Bearer, 7+ digit run or 32+ char opaque run. Turning capture off deleted the file (the folder empty); the toggle left at «Выкл».
- Not checked on the device: the rotation at 256 KB, the sign-out reset (the owner's session must stay signed in), the background flush, API < 29.

Retrieving the logs (release or debug build on API 29+, no `run-as` needed):

```sh
# On the TV: Настройки → seven quick OK on «Версия» → «Запись логов» → «Вкл»; reproduce the problem.
adb connect <tv-ip>:5555        # or the wireless-debugging pairing flow
adb pull /sdcard/Android/data/io.github.dzmitryafanasenka.boostytv/files/logs/ ./boostytv-logs
# boostytv-logs/boostytv.log (newest) and, after a rotation, boostytv.log.1
```

Device rows to run (owner or a later agent pass, Chromecast with Google TV):
- Seven quick OK on «Версия» open Diagnostics with focus on «Запись логов»; a single press and slow presses (≥ 2 s apart) do nothing visible; Back returns to Настройки on «Версия».
- Capture on, browse and play a video, then the `adb pull` above. The file exists; no line contains a URL query, a token, a cookie, the phone or a code.
- «Очистить логи» → the pulled folder is empty. «Запись логов» → «Выкл» → the folder is empty. Sign-out → the folder is empty; the toggle is still «Вкл» after the next sign-in.
- Capture on across `am force-stop` and a relaunch: new lines appear without touching the toggle.
- Rotation: enough activity (or a temporary low cap in a local build) gives `boostytv.log.1`, with neither file above 256 KB.

### Story 8.2 — System video player option, 2026-10-31

**Status: implemented, host-tested, built and checked on the device by the agent over adb (below).** `spec-8-2-system-video-player.md`. Настройки' first row «Системный видеоплеер» (phase flag `externalPlayer`, on): a device-scoped toggle (`player.external.v1` in `boostytv-device`, default off, outside the AccountScope wipe), «Вкл» in accent / «Выкл», with the description that progress is not tracked; «Версия» keeps the initial focus. With it on, a recording opens a fresh E8 and the «Качество» list (`player/external/sheet`, the player's extracted `QualityMenu`) with focus on the quality the device preference picks; OK hands that source's URL and the title to the `ExternalPlayer` port (`src/shared/platform/externalPlayer.ts` → `ExternalPlayerModule.kt`: `ACTION_VIEW` `video/*`, `title` / `forcename` extras, this app and `com.android.tv.frameworkpackagestubs` dropped, one explicit intent per remaining player; `prepare` then `launch`). One player opens directly, several get the chooser with those intents. Ready → the route pops to the origin first, then the player starts 300 ms later; no ProgressRepository call, no E9, no start position; a launch failure after the pop is only logged. No player, a resolve failure or no module → PlayerScreen at that quality (`qualityPreference.remember`: kept in memory until the app restarts, so later built-in videos start there too; the stored preference unchanged) with «Внешний плеер не найден» in the overlay; the overlay opens once at the start and the notice goes when that overlay hides while the video plays (Epic 8 retro A5; a hide by an error or a recovery keeps it, host-untested; before A5 it stayed with every later overlay show). A non-playable E8 → PlayerScreen's own state. Live, the flag off and the toggle off: the built-in player as before. The manifest declares `<queries>` for VIEW `video/*` (https and URI-less). The log line carries the outcome only.

Host tests (39 new; 129 → 131 suites, 2860 → 2899 tests): `src/shared/platform/__tests__/externalPlayer.test.ts` (no module, `opened` / `none` / unknown / rejection, the arguments); `src/features/player/__tests__/externalPlayerPreference.test.ts` (parse, first run off, one read, failed read and write, a toggle during the read, a synchronous throw); `src/shared/ui/__tests__/shellPrimitives.test.tsx` «SettingRow toggle» (switch role, checked, accent «Вкл», description, OK); `__tests__/externalPlayerFlow.test.tsx` «Story 8.2» (the toggle flip and persistence, a restart and an account reset keep it, the flag off; the hand-off with the loading surface, the list's focus, the URL to the port, the pop to the origin with no engine, E9 or progress entry, no URL in logs or route params; «Авто» by default; no start position; Back in the list; `none`, a rejection and no module → the fallback with the notice, progress as usual and the stored quality unchanged; E8 404; toggle off; flag off; live); `__tests__/homeFeedFlow.test.tsx` «Story 8.2» (from a Continue card: back on the card, the resume point unchanged); `__tests__/demoFlow.test.tsx` «Story 8.2» (the demo's in-memory store); `__tests__/androidManifest.test.js` (the `<queries>` entry); `src/app/__tests__/phaseFlags.test.ts`. Changed: `signOutFlow` «Настройки» now expects the toggle row first.

Checks run:
- `npm run lint -- --max-warnings 0`, `npx tsc --noEmit`, `npm run check:fixtures` (30): clean.
- `npm test`: 131 suites, 2899 tests passed.
- First build attempt: `video/*` inside the module's KDoc opened a nested Kotlin comment and broke compilation; fixed in the review patches. `./gradlew assembleRelease` (armeabi-v7a) now passes.
- Not run: any device or emulator check (the rows below).

Device finding (coordinator's Chromecast run, Google TV API 34): On the pinned Google TV (API 34) `queryIntentActivities` with `MATCH_DEFAULT_ONLY` returned only the framework stub (flags 0 also return File Commander's player), and the plain system chooser offered no targets («Действие не поддерживается ни в одном приложении»); hence flags 0 and explicit intents per player. The same run returned to the app with focus on the sidebar «Главная» instead of the origin Continue card after the external activity opened (Back from the list without launching restored the card).

Device-run patches (2026-10-31, `fix: open a single external player directly (Story 8.2 device run)`): flags 0; one explicit intent per player (one → started directly, several → `createChooser` with `EXTRA_INITIAL_INTENTS`, no `EXTRA_EXCLUDE_COMPONENTS`); the native call split into `prepare` / `launch` so the route pops and the origin restores its focus before the launch (`EXTERNAL_LAUNCH_DELAY_MS`); the hand-off surface no longer re-takes focus once the route is leaving. Host tests: the port's `prepare` / `launch`; `externalPlayerFlow` «Hand-off» (the launch only after the pop, with focus on the origin), a launch failure after the pop (logged only); `homeFeedFlow` «Story 8.2» (the Continue card has focus before and after the launch). The host cannot express native window focus, so the return focus after a real external activity is a device row.

Review patches (2026-10-31, `fix: review patches for Story 8.2 system video player`): the KDoc fix above; a throw in the hand-off's outcome callbacks logs a warning (no URL, no title) and clears the launch state (no stuck spinner with Back ignored); a pick whose source cannot be resolved falls back to the built-in player; the «Системный видеоплеер» value is warmed at app startup (`src/app/session.ts`), so the toggle row is not inserted above a focused «Версия» on the first visit; new `externalPlayerFlow` tests: Back during an in-flight launch (ignored; `none` then mounts the fallback with the notice) and Back while the hand-off E8 is pending (pops to the origin, nothing launched).

Device rows to run (owner or a later agent pass, Chromecast with Google TV; test content, not the owner's resume point):
- The toggle persists after an app restart and after sign-out.
- With the toggle on, OK on a recording shows «Качество» with focus on the preferred quality; OK opens File Commander's player directly (the only real player on the pinned device; with several, the chooser lists them and not the TV stub); it plays the video from 0:00; Back from the player returns to the app with focus on the origin element (not the sidebar).
- Back from the list leaves «Осталось N мин» unchanged (no E9).
- With no player installed (or only the stub): the built-in player at the picked quality with «Внешний плеер не найден».
- `adb logcat` shows no signed URL from the app.

Device (agent over adb, Chromecast with Google TV API 34, release-like build from `7065e73` plus the KDoc and flags fix, `adb install -r`, the owner's session):
- Настройки: «Системный видеоплеер» first, the two-line description fits; OK flipped «Выкл» → «Вкл» (accent); after `am force-stop` and a relaunch the row still said «Вкл».
- From the Continue card «Безрисковая доходность…» (Осталось 73 мин): OK showed «Качество» (Авто, 1440p … 144p) with focus on the stored 1440p; Back returned to the same card, still «Осталось 73 мин».
- First build (chooser with `MATCH_DEFAULT_ONLY`): OK fell back to the built-in player with «Внешний плеер не найден» (correct fallback path, but File Commander was installed); the agent left within ~2 s with no pause; the card still said «Осталось 73 мин». A count-only probe (removed) showed the finding above. A second build with flags 0 opened the system chooser, which listed no targets.
- Final build: OK on 1440p opened File Commander's `VideoPlayerActivity` directly and it played (`dumpsys audio`: USAGE_MEDIA started); Back returned to Boosty TV with focus on the origin Continue card, still «Осталось 73 мин».
- Restored after the run: the toggle back to «Выкл»; the stored quality stays 1440p.
- Owner check (2026-10-31): the owner checked the flow with the physical remote and reported it OK.
- Not checked on the device: the chooser with two or more players (only one real player is installed), sign-out keeping the toggle, `adb logcat` for a signed URL beyond the probe tag.

### Story 8.1 — Playback speed, 2026-10-31

**Status: implemented, host-tested and checked on the device by the agent over adb (below).** `spec-8-1-playback-speed.md`. «Скорость» in the player settings sheet for recordings (phase flag `speed`, on): the presets 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2 and 3×, the current one checked; a pick sets react-native-video's `rate` on the mounted engine (no remount, no seek, no E8), closes the sheet with focus on «Настройки» and stores the speed device-scoped (`player.speed.v1` in `boostytv-device`, outside the AccountScope wipe). Live: no row, rate 1. While the rate is not 1, the overlay shows «N×» next to the elapsed time (owner decision Q1 a). The engine waits for the speed read (recordings with the flag on only; live and the flag off neither read nor wait), so the first engine already has the stored rate. Every progress rule stays in media time at any speed: the E9 cadence (`WRITE_MOVEMENT_SEC` of movement), the short-visit rule (< 10 s from the start), the resume point and `'end'`, the recovery budget (30 s played), «Осталось N мин» and the overlay's elapsed and remaining times are all media seconds.

Host tests (52 new): `src/features/player/__tests__/speedPreference.test.ts` (the presets and labels, tolerant parse incl. `fast` / `9`, the store: first run 1×, one read, a failed read or write); `playbackMode.test.ts` «speed» (VOD with and without the flag, live forced 1×); `PlayerOverlaySpeed.test.tsx` (no label at 1×, «N×» otherwise, none on live, times in media time); `__tests__/playerSpeedFlow.test.tsx` «Story 8.1» (first run, the pick at 2:00 with E9 and ±10 s in media seconds, the Back order, the quality submenu's Back after a speed visit, the next video at the stored speed, bad stored values, a quality switch and a recovery keep the speed, an account reset keeps it, the log carries the number only, live at 1× without the row); `src/app/__tests__/phaseFlags.test.ts` (the flag). Changed: `playerFlow` (now `playerQualityFlow`) «quality (Story 4.3) › Open sheet» now expects the two rows («Качество», «Скорость»).

Checks run:
- `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` (30): clean.
- `npm test` ×3: 128 suites, 2851 tests passed in each run.
- `npx jest __tests__/playerFlow.test.tsx __tests__/authorFlow.test.tsx __tests__/postFlow.test.tsx __tests__/demoFlow.test.tsx src/features/player src/app/__tests__/phaseFlags.test.ts` ×30: 0 failed runs, 729 tests passed in each.

Review patches (2026-10-31, `fix: review patches for Story 8.1 playback speed`): the adapter's `rate` forwarding (`PlayerEngineView.test.tsx`), the sheet falling back to its rows when the speed row goes away (`PlayerSettingsSheet.test.tsx`), the current speed picked (no write), a pick while paused, the flag off, the first engine held until the speed read, live not reading the speed, a synchronous store throw (both preference stores), the demo stores. Checks after them: lint, typecheck, `check:fixtures` clean; `npm test` ×3: 129 suites, 2860 passed each; the suites above plus `PlayerEngineView.test.tsx` ×30: 0 failed runs, 749 passed each.

Device (agent over adb, Chromecast with Google TV, release-like build from `3a00b41`, `adb install -r`, the owner's session; owner approved the restore pass):
- «Скорость · 1×» under «Качество»; the submenu lists the 8 presets with «1×» checked and focus on it; a pick of 1.5× closed the sheet and «1.5×» showed next to the elapsed time.
- The next open of the video started at the stored 1.5× (the row and the badge said 1.5×).
- The rate is real: with the sheet open, the elapsed time went 2:24 → 2:33 in 5.72 s of wall time (≈ 1.57×).
- Agent slip, then restored: a batched key run lost a ↓ right after Menu (the sheet's initial focus was not settled), so the next OKs stored quality «Авто» (was 1440p) and speed 1.5×, and the visit moved the owner's resume point (2:11 → 2:24). With the owner's approval, a step-by-step pass (screenshot before each OK) restored 1440p and 1×; the resume point ended about 12 s later than before (≈ 2:23).
- Not checked on the device: live at 1× (no subscribed blog is live), a quality switch or recovery at a non-1× rate, pitch, the physical remote and TalkBack.

### PlayerScreen live/VOD split before Epic 8, 2026-10-31

**Status: behaviour-preserving refactor plus review patches; host-tested, plus a short agent device run (below).** `spec-player-live-vod-split.md`. `PlayerScreen.tsx` 1477 → 389 lines: `playbackMode.ts` (the live/VOD decisions), `livePolicy.ts`, `playerPhase.ts`, `usePlaybackSession.ts`, `usePlayerSource.ts`, `usePlayerSettings.tsx`, `usePlayerFocus.ts`, `usePlayerKeys.ts`, `usePlayerProgress.ts`. The hook call order keeps the old effect order. Existing tests unchanged in meaning (`playerPhase.test.ts` is new in this change). New tests: `src/features/player/__tests__/playbackMode.test.ts` (the intent matrix for VOD and live), `playerPhase.test.ts` (phase, recovering, error target and copy), `entryGuard.test.ts` (the entry guard with a fake clock) and `liveFlow` «Story 7.2 › Quality pick (a live list with a real choice)» (the repository result gets an extra 720p candidate, since real E15 live candidates are «Авто» only). `jest.config.js` now ignores `.claude/worktrees/` (agent worktrees).

Checks run after the review patches:
- `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` (30): clean.
- Plain `npm test` ×3: 126 suites, 2799 tests passed in each run.
- `npx jest __tests__/playerFlow.test.tsx __tests__/authorFlow.test.tsx __tests__/postFlow.test.tsx __tests__/demoFlow.test.tsx src/features/player` ×30: 0 failed runs, 670 tests passed in each.

Before the review: the same suites with CLI ignore flags for `.claude/worktrees/`; full run ×3: 125 suites, 2791 passed each; the touched files ×30: 0 failed runs, 662 each.

Device (agent over adb, Chromecast with Google TV, release-like build from `8bd3669`, `adb install -r`): the Continue-row card → OK opened the player at the saved position (2:11) and it played about 2 s with no pause; Menu opened «Настройки» with focus on «Качество 1440p»; Back closed the sheet and focus returned to the gear; two more Back returned to the same Continue card, still «Осталось 108 мин» (no progress write). The whole run took under 10 s.

Not checked:
- Seeks, hold-to-seek, the ±10 s skip, sleep/resume, audio-focus loss and «Повторить» on the device (a seek on the owner's content would count as movement and write progress); host-tested only.
- Live (no subscribed blog is live), the physical remote and TalkBack.

### Epic 3 retro A4 — sidebar OK from Автор/Пост with animations off, 2026-10-31

Device: Chromecast with Google TV, the release-like build from `48b1a22` over adb. Window and transition animation scales set to 0 and animator duration to 0 for the check, then restored (1.0, 1.0, unset). Пост (opened from Главная) → Left → sidebar «Подписки» → OK: the Подписки section opened with the tab selected and focus on the first author card. Автор (opened from Подписки) → Left → sidebar «События» → OK: the События section opened (empty state) with focus on «Обновить»; Back moved focus to the sidebar and did not bring Автор back. No stuck or doubled screen, so the `pendingShellSection` unmount timing holds with animations off. Not checked with the physical remote.

### Retro follow-ups: PostBody / PollWidget split and boundary tests, 2026-10-31

**Status: host-tested only; no device run (no adb in this change).** `spec-retro-post-split-and-boundary-tests.md`. It covers `epic-6-retro-item-28` (A3), `epic-6-retro-item-29` (A4), `epic-7-retro-item-36` (A4) and `epic-3-retro-item-13` (A5).

Commit 1 is a behaviour-preserving refactor:
- the `PostBody` / `PollWidget` split;
- the shared `usePendingConfirm` and `useColumnStop`;
- `polls/pollFocus.ts`;
- `src/test/frames.ts` and `createFlow` `advance` / `key`.

Its new unit tests are `src/shared/focus/__tests__/usePendingConfirm.test.tsx` (5 tests in commit 1) and `src/features/polls/__tests__/pollFocus.test.ts` (6).

Commit 2:
- `authorFlow` «Story 7.4»: 4 tests «F3: …» for the fix (OK on «Нравится» cancels only a running E15 poll);
- `eventsFlow`: 4 tests: F6 scheduled, F6 ended, and «resume with nested stacks» ×2 (F5 and V2);
- `homeFeedFlow`: 2 tests, «Epic 3 retro V1» and «V3»;
- `postFlow` «Story 6.6 › Epic 6 retro A4»: 3 tests, R4 ×2 and R6;
- the R5 line in `focus-map.md` and the R3 comment in `applyPoll.ts`;
- the timestamp-proof log checks in `playerFlow` (now `playerRecoveryFlow`) «Expired URL» and `eventsFlow` «Malformed».

Commit 3 (review patches):
- `authorFlow` «Story 7.4»: 2 more F3 tests (an invalidation's E15 running at E17 200 is cancelled and sent again; the first E15 landing mid-E17, then an E17 failure rolls back to the landed value), 6 F3 tests in all;
- `postFlow`: R5 (audio under the QrDialog, ← → do not seek there, Back → the chip; the file now mocks TVEventHandler), 4 tests in that describe;
- `useColumnStop.test.tsx` (new, 4 tests); `usePendingConfirm.test.tsx`: 3 more (8 in all);
- a stricter nested-stack Back check and V3 label check;
- `createFlow().key()` throws when no TVEventHandler listener is subscribed.

Checks run (after commit 3):
- Lint (`--max-warnings 0`), typecheck and `check:fixtures` (30): clean.
- `npm test` ×3: 123 suites, 2742 tests passed in each run.
- The touched and new test files ×30: 0 failed runs, 843 tests passed in each. The files: `authorFlow`, `codeFlow`, `homeFeedFlow`, `playerFlow`, `postFlow`, `eventsFlow`, `useAuthorLiveActions`, `focusSoon`, `useOutcomeFocus`, `usePendingConfirm`, `useColumnStop`, `pollFocus`, `PollWidget`, `linkChip`, `teaser`, `AudioBlock`.

Before the review (commits 1–2): `npm test` ×3: 122 suites, 2732 passed each; the touched files ×30: 0 failed runs, 833 tests each.

Not checked:
- Device rows (the poll and audio focus after the split, the F3 like on a real stream).
- The physical remote and TalkBack.

### Fix — PostCard placeholder for posts without a preview, 2026-10-30

**Status: implemented, host-tested; the avatar plate checked on the pinned device (Chromecast with Google TV 4K) by the agent over adb (release-like build, the owner's session, injected D-pad keys only, no OK; not the physical remote).** `spec-post-card-no-preview-placeholder.md`. A card with no preview, or with a preview that failed, now shows the author's avatar (half the thumb height) on a `surface-raised` plate instead of the `skeleton` box; without an avatar, or when it fails, a post-type icon (new SVG glyphs `VideoIcon`, `VideosIcon`, `AudioIcon`, `TextPhotoIcon`, `PollIcon`, `FileIcon`) in `text-secondary`. The loading skeleton is unchanged. A locked card dims the plate avatar and keeps the lock glyph on top (no type icon). No new tokens.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (`DEMO_MODE = false`), `zipalign -p 4` + `apksigner` (the SDK debug key outside the repo), installed with `adb install -r`; it is the installed build now. Nothing uninstalled or cleared; no OK pressed, no playback.

| Row | Result | Who / how |
|-----|--------|-----------|
| Главная, a card without a preview | Several real «Текст и фото» posts (Стас Асафьев, Илья MJTV Соколов, Sep 2026) show the round author avatar centred on the warm grey plate, clearly different from the loading skeleton; the badge and the meta row unchanged. uiautomator found `home/feed/<id>/placeholder` and `/placeholder-avatar` on 6 cards within ≈ 30 rows | agent, adb + uiautomator + screencap |
| Focus on a placeholder card | → onto it: the ring and the card scale as on any card; nothing clipped | agent, adb + screencap |
| The type icon (no avatar or a failed avatar), a locked card without a preview, Автор and Поиск | **Not seen on the device**: every author reached had an avatar, and no locked post without a teaser was found. Host tests only (the same `PostCard` renders on Автор and Поиск) | — |
| The physical remote, TalkBack | **Not checked** | — |

The Continue row uses `ContinueCard`, not `PostCard`, so it is unchanged (spec: «if it uses PostCard»).

Host tests: `src/shared/ui/__tests__/PostCard.test.tsx` (new describe «without a preview»: the plate colour and size, the avatar size from the thumb, the type icon per kind equal to a standalone render of the expected glyph, 6 distinct glyphs, an avatar failure → icon, a preview failure → the plate with the avatar, both failures → icon, locked: plate then lock, dimmed avatar, no icon, the unchanged a11y label, the skeleton keeps only the skeleton colour; locked with no avatar = the plate and the lock only, the plate never dimmed; recycled-cell rows: preview ↔ no preview, a failed avatar → another author's avatar, no preview → locked; a native-view budget row: the same card after a preview failure has exactly one more native view), `src/shared/ui/__tests__/icons.test.tsx` (the six glyphs: ink, size, hidden from a11y). Review fixes were run only on `PostCard` + `icons` (57 passed); the full suite ran before them. No flow test asserted the old plain box. Lint (`--max-warnings 0`), typecheck, `check:fixtures` (30) clean; `npm test` ×3: 120 suites, 2703 passed each; `PostCard` + `icons` + `homeFeedFlow` + `authorFlow` + `searchFlow` ×30: 0 failed runs (405 tests each).

### Epic 7 retro A2 — live playback, author live block, generation-keyed store, guarded focusSoon, 2026-10-30

**Coordinator verification after the review fixes (2026-10-30):** lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 120 suites, 2683 passed each; touched suites (`playerFlow`, `authorFlow`, `postFlow`, `eventsFlow`, `searchFlow`, `homeFeedFlow`, `accountSwitchFlow`, `signOutFlow`, `src/features/polls|author|player`, `src/shared/focus|account|filters`) ×30: 0 failed runs. The review fixes are host-tested only (the device run preceded them).

**Status: pure refactor, host-tested; focus checked on the pinned device (Chromecast with Google TV 4K) by the agent over adb (injected keys, uiautomator focus dumps, a screenshot before every OK; not the physical remote).** `spec-epic-7-retro-a2-live-and-focus-refactor.md`. New unit tests: `src/shared/focus/__tests__/focusSoon.test.ts`, `src/shared/account/__tests__/generationKeyed.test.tsx`, `src/features/author/__tests__/liveReturnTarget.test.ts`. Existing tests unchanged.

Lint (`--max-warnings 0`), typecheck, `check:fixtures` (30) clean; `npm test` ×3: 118 suites, 2665 passed each. Touched suites (`playerFlow`, `authorFlow`, `postFlow`, `eventsFlow`, `searchFlow`, `homeFeedFlow`, `PollWidget`, `ModalHost`, `PeriodStepper`, the three new unit tests, `accountSwitchFlow`, `signOutFlow`) ×30: **1 failed run**, 806 passed in each of the other 29. The failure was captured: `playerFlow` (now `playerRecoveryFlow`) «recovery (Story 4.4) › matrix «Expired URL»» asserts that the player log JSON does not match `/example\.invalid|312|v1/`. The entry's wall-clock `time` (`1793373531280`) contains «312», and the failed test skipped its unmount, so the rest of that `describe` failed with it. This flake already existed (the assertion is unchanged since Story 4.4) and is not caused by this change.

**Builds:**
- Release-like: `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` with `DEMO_MODE = false`, `zipalign -p 4` + `apksigner` (the SDK debug key outside the repo). Installed with `adb install -r`; it is the installed build now.
- Baseline: the same build from `0346d8d` (changes stashed), installed with `adb install -r` for one comparison, then replaced.
- Demo: the existing debug APK (no native change since its build), Metro on 8081 (`adb reverse tcp:8081 tcp:8081`), a local, uncommitted `DEMO_MODE = true`. Reverted to `DEMO_MODE = false`; Metro stopped and the reverse mapping removed.
- Nothing uninstalled or cleared. No real vote, like or heartbeat. The real video played about 6 s with no pause, under the progress threshold.

| Row | Result | Who / how |
|-----|--------|-----------|
| Modal close (Главная «Фильтры») | OK on the chip → focus on the selected «Доступные мне»; Back → the chip. «Период» → the selected «За всё время»; «Свой период…» → the stepper's «С, день»; Back ×3 → the list, the sheet, then the chip. No filter changed | agent, adb + uiautomator, release-like |
| Автор filters and search | «Фильтры» chip → the sheet on «Доступные мне», Back → the chip. A search with no match («formula») → «Ничего не найдено», focus on the field. «p2p» → focus on the first result | agent, adb + uiautomator + screencap, release-like |
| Автор return from a post | OK on the search result → Пост; Back → the same card | agent, adb + uiautomator + screencap, release-like |
| Player overlay and settings sheet | «Продолжить» on a real video. ↑ shows the overlay. Menu → the sheet with focus on «Качество». Back → the sheet closes with focus on the gear (focus ring). Back hides the overlay; Back exits to Пост with focus on «Продолжить» | agent, adb + screencap (no OK inside the player), release-like |
| Player error target (demo) | The demo video has no URL → the error state, focus on «Повторить»; → «Назад»; Back → Пост «Смотреть» | agent, adb + uiautomator, demo debug build |
| Пост link chip and QR (demo) | The link chip → QR with focus on «Закрыть»; Back → the chip. Again → «Закрыть» OK → the chip | agent, adb + uiautomator + screencap, demo debug build |
| Poll vote and retract (demo, local) | Multiple choice: check «История», then «Проголосовать». After the vote the control turns into «Отозвать голос» in place, with focus kept on it. 1st OK shows the pending label; 2nd OK retracts, and focus goes to the first option without scrolling to the post's top | agent, adb + uiautomator + screencap, demo debug build |
| LiveCard, like and share (demo, local) | Автор «Демо-автор 1» opens with focus on the LiveCard. → «Нравится, 42»; OK → «Вам нравится, 43», focus kept; OK → 42 again. ↓ «Поделиться» → QR; Back → «Поделиться»; ← the card. OK on the card → the live player shows «Не удалось воспроизвести эфир» with «Назад» only; OK → back to the card. A post from the grid → Back → the same card | agent, adb + uiautomator + screencap, demo debug build |
| Back with an active search while a result card is focused | The search clears, but focus stays on that card (it is also in the normal list) instead of going to the field. **The same on the baseline build**, so the behavior already existed and is not changed here; recorded in the spec's Implementation Notes | agent, adb + uiautomator, release-like (this change and the baseline) |
| The physical remote, TalkBack, a real live stream, card loss on the device | **Not checked**; host tests only | — |

### Story 7.5 — Events list, 2026-10-30

**Coordinator verification after the review fixes (2026-10-30):** lint (`--max-warnings 0`), typecheck, `check:fixtures` (30) clean; `npm test` ×3: 115 suites, 2639 passed each. Touched suites (`eventsFlow`, `shellFlow`, `demoFlow`, `authorFlow`, `subscriptionsFlow`, `src/shared/entities/event`, `phaseFlags`) ×30: **1 failed run** (the failing test was not captured); 80 further runs with failure capture: 0 failed. Cause unknown — possibly the known host jest worker crash (`deferred-work.md`), possibly a rare flaky test. The review fixes are host-tested only (the device run preceded them).

**Status: implemented and host-tested; checked on the pinned device (Chromecast with Google TV 4K), driven by the agent over adb (injected keys, uiautomator focus dumps, a screenshot of the focused element before every OK in the app; not the physical remote). The `events` flag is on (owner decision Q1 a) after the live E18 probe found the documented shape. Not seen on the device: a real `video_stream_start` event (none on the account; the live account's only event, `target_new`, is hidden, so the real События shows «Событий нет»), a real stream, a long real list, the physical remote, TalkBack.**

`spec-7-5-events-list.md`. Host tests: `src/shared/entities/event/__tests__/eventRepository.test.ts` (48: the path with no params and the content profile, the live body → no row, the synthetic body, `Parse` for a missing list, no automatic retry on 5xx / network / 403, every mapper row: stream, post / promo, unknown type, each owner-side type, both comment types, malformed id / type / time each dropped alone with a counts-only warning, order, repeated ids, `isRead`, the blog fallback and validation, the author name and avatar, no money field); `__tests__/eventsFlow.test.tsx` (29: one test per matrix row — flag off, loading, list (order, initial focus, ↑ ↓ / ← zones, the row anatomy, one ring without reflow, 300 events virtualized with one request), stream, post / promo, owner-side, the live body, unknown, comment, malformed; OK → Автор with section `events` and focus on the LiveCard, the local read mark and Back → the same row; OK on a no-stream author → the first post; OK with no blog; the `target.bloggerUrl` blog; Back with the row gone → the first row; Back inside События and reopening; empty with «Обновить»; error Network / Server / Parse with «Повторить» and no automatic retry; error → empty; a move during the skeleton; the read marks cleared by AccountScope); `shellFlow`, `subscriptionsFlow`, `authorFlow`, `postFlow`, `codeFlow`, `demoFlow` (the sidebar now lists «События»; the demo E18 test), `phaseFlags`, `accountScopeRegistry` (`eventReadMarks`), `tokens` (`event-row`).

Lint (`--max-warnings 0`), typecheck, `check:fixtures` (30 clean); `npm test` ×3: 115 suites, 2621 passed each; `eventsFlow`, `shellFlow`, `demoFlow`, `authorFlow`, `src/shared/entities/event`, `phaseFlags` ×30: 0 failed runs (275 passed each).

**Live probe:** see `docs/api-contract.md` «E18 (LIVE, Story 7.5)» (HTTP 200, the documented shape, 1 `target_new` event, no cursor). The temporary `TEMP75` probe is removed (release bundle `TEMP75` 0).

**Demo debug build:** the existing debug APK (no native change since its build) installed with `adb install -r` over the release-like build (session kept), Metro on host port 8097 (`adb reverse tcp:8081 tcp:8097`), a local, uncommitted `DEMO_MODE = true` (reverted: `DEMO_MODE = false`). For the empty and error rows the demo E18 reply was changed locally to an empty list, then to a 503 (both reverted).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` with `DEMO_MODE = false`, release-like (`zipalign -p 4` + `apksigner`, the SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Release Hermes bundle: `TEMP75` 0, `createDemoSessionManager` 0, `events/row/` 1, the E18 path 1. Metro stopped, the reverse mapping removed. Nothing uninstalled or cleared; no sign-in, no sign-out; no request other than GETs.

| Row | Result | By |
|---|---|---|
| Sidebar | «События» between «Подписки» and «Настройки» (both builds) | agent, adb + screencap |
| List (demo) | OK on «События» (screenshot first) → 5 rows newest first: the stream row (unread dot, «Демо-автор 1 Начался эфир», a red «Эфир» chip, «сегодня, …»), «Новый пост» (unread), «Новая акция», the generic «Новое событие», a row without a blog; the demo comment and owner-side events are not shown; initial focus on the first row (screenshot) | agent, adb + uiautomator + screencap, demo debug build |
| Arrows (demo) | ↓ through every row, ↓ on the last row stays, ↑ moves back, ← → `nav/events`, → back to the same row | agent, adb + uiautomator, demo debug build |
| OK, no blog (demo) | Focus on the no-blog row (screenshot) → OK: nothing happens, focus stays | agent, adb + uiautomator + screencap, demo debug build |
| OK → LiveCard → Back (demo) | Focus on the stream row (screenshot) → OK → Автор «Демо-автор 1» with «События» as the sidebar's current item and focus on the LiveCard (screenshot); Back → the same row, now without the unread dot (screenshot) | agent, adb + uiautomator + screencap, demo debug build |
| OK on a no-stream author (demo) | «Новый пост» row (screenshot) → OK → Автор «Демо-автор 2» with focus on the first post; Back → the same row; Back → `nav/events`; Back → Главная (`nav/home`) | agent, adb + uiautomator + screencap, demo debug build |
| Empty (demo, local reply) | «Событий нет», the explanation and «Обновить» focused (screenshot); OK → one more E18 GET (logcat, path redacted), focus kept | agent, adb + uiautomator + screencap + logcat, demo debug build |
| Error (demo, local 503) | «Не удалось загрузить события», «Boosty сейчас не отвечает…», «Повторить» focused (screenshot); one GET only (no automatic retry); OK → one more GET, focus kept | agent, adb + uiautomator + screencap + logcat, demo debug build |
| Real account (release-like) | OK on «События» (screenshot first) → «Событий нет» with «Обновить» focused (screenshot): the account's only event is `target_new` (hidden, Q3 a). The release build logs nothing, so the 200 is inferred from the empty state (a failure shows the error view). ← → `nav/events`, → «Обновить», Back → `nav/events`, Back → Главная; no fatal exception in logcat | agent, adb + uiautomator + screencap |
| A real `video_stream_start`, a long real list, the physical remote | **Not checked on the device**: host tests and the demo only | — |

Process note: during the probe the device display was asleep (`mWakefulness=Asleep`), which held JS timers and promises; `KEYCODE_WAKEUP` (with the app in the foreground) let the probe finish.

### Story 7.4 — Like and share a live stream, 2026-10-30

**Status: implemented and host-tested; the demo path checked on the pinned device (Chromecast with Google TV 4K), driven by the agent over adb (injected keys, uiautomator focus dumps, a screenshot of the focused element before every OK in the app; not the physical remote). No real E17 was sent to Boosty (no subscribed blog was live, and a real E17 needs the owner's approval): the request is `REF` (api-contract «E17 like (Story 7.4)»). Not checked: the physical remote, TalkBack, a real stream, a real E17 failure and its line on the device (host tests only), card loss with «Нравится» / «Поделиться» focused on the device.**

`spec-7-4-like-and-share-a-live-stream.md`. Host tests: `src/shared/entities/stream/__tests__/streamRepository.test.ts` «E17 like» (the path, an unsafe blog → `Client` before a request; like → one POST, unlike → one DELETE, no body, the token, the body discarded; 500 / 503 / 429 / network sent once; a 401 not replayed with a renewed token) and the lenient `isLiked` mapping; `src/features/author/__tests__/LiveCard.test.tsx` (+10: the live details without likes, `liveLikeShown`, the like label, outline vs filled heart with the heart in the label's ink, «Поделиться» only for scheduled / needs a level, busy while sending with the role and OK kept, the column fits 120 dp, the fixed two-line failure slot in the error ink); `src/shared/ui/__tests__/Button.test.tsx` (the `icon` and `selected` props, `buttonInk`); `src/shared/ui/__tests__/icons.test.tsx` (HeartIcon); `__tests__/authorFlow.test.tsx` «Story 7.4» (one test per matrix row: like (at once, one POST with the content profile, kept and written into the query after success), unlike (one DELETE, clamped at 0), in flight (OK ignored), failure 5xx / network / 429 (rollback, `error.<kind>`, no retry, the next OK clears it), 401 (one refresh, not replayed, `error.Client`), a poll during the request (the optimistic state holds; the next poll reconciles), a poll during a failing request (rollback to the poll's value), account change mid-request (failure; success with the new account's stream in the cache: not written), review fixes (a poll started mid-flight answering after E17 200 is cancelled; a reply held from before the press is not written; the success write is relative to a newer poll count; a new stream id while E17 runs neither shows nor receives the old state; the failure line goes with a hidden like and does not come back with it; return to Автор → «Нравится» / «Поделиться», «Нравится» gone while covered → «Поделиться»), share (QR of the stream page, Back / «Закрыть» → «Поделиться», no request), focus (the action guide's destination is «Нравится», ↓ from «Поделиться» / «Нравится» / the card → the grid target, the block's height unchanged), states (live + access: heart and share; scheduled / needs a level: share only, the guide → share), card goes with «Нравится» or «Поделиться» focused → the first post, «Нравится» goes while focused and the card stays → «Поделиться»); the 7.1 «Live» row now expects the details without likes; `__tests__/demoFlow.test.tsx` (the demo like toggles, survives a poll, unlike, share opens the QR, no network).

Lint (`--max-warnings 0`), typecheck, `check:fixtures` (29 clean); `npm test` ×3: 113 suites, 2532 passed each; `authorFlow`, `demoFlow`, `src/features/author`, `src/shared/entities/stream`, `Button`, `icons` ×30 (271 tests each run): 0 failed runs (271 passed each).

**Demo debug build:** the existing debug APK (no native change since its build) installed with `adb install -r` over the release-like build (session kept), Metro on 8081 (`adb reverse tcp:8081 tcp:8081`), a local, uncommitted `DEMO_MODE = true` (reverted: `DEMO_MODE = false`).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` with `DEMO_MODE = false`, release-like (`zipalign -p 4` + `apksigner`, the SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Release Hermes bundle: `createDemoSessionManager` 0, «Вам нравится» 1. Metro stopped, the reverse mapping removed. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| Layout (demo) | «Демо-блог 1»: the card (details «128 зрителей», no likes), right of it «♡ 42» above «Поделиться», top-aligned with the card, the block's height unchanged; initial focus on the card (screenshot) | agent, adb + uiautomator + screencap, demo debug build |
| → / ↓ / ← (demo) | → from the card → «Нравится» (also after focus had been on «Поделиться»); ↓ → «Поделиться»; ↓ → the first post; ← from either → the card; ↑ from «Нравится» → the field | agent, adb + uiautomator, demo debug build |
| Like toggles (demo) | Focus on «Нравится» (screenshot) → OK → «♥ 43» in the accent at once, a11y «Вам нравится, 43», selected (screenshot); a fresh run: two OK presses sent back to back → one toggle (43; that both landed within the demo's 300 ms delay is likely, not proven); OK again → «♡ 42», «Нравится, 42» | agent, adb + uiautomator + screencap, demo debug build |
| Survives a poll (demo) | After the like, 36 s later (one E15 GET 200 in logcat at ≈ 30 s): still «Вам нравится, 43» | agent, adb + uiautomator + logcat, demo debug build |
| Share QR (demo) | Focus on «Поделиться» (screenshot) → OK → «Эфир на Boosty», the QR, «Откроется на телефоне», «Закрыть» focused (screenshot); Back → focus on «Поделиться»; OK again → QR, OK on «Закрыть» (screenshot first) → focus on «Поделиться» | agent, adb + uiautomator + screencap, demo debug build |
| No stream (real author, release-like) | Подписки → OK on «Алексей Антонов» (screenshot first) → Автор: no `…/live`, `…/like` or `…/share` node, focus on the first post (screenshot); ↑ → the field, ↓ → the first post; Back → the same tile; no fatal exception in logcat | agent, adb + uiautomator + screencap |
| Real E17, its failure line, card loss with a button focused | **Not checked on the device** (no stream; a real E17 needs the owner's approval); host tests only | — |

Observations:
- Pre-existing, not from this story: on the Author page with the live card, the first ↑ from a grid card in the first row did not move focus (the card's bounds shifted by 2 px, a list scroll); the second ↑ reached the live card. Reproduced on the demo debug build with the Story 7.4 changes stashed (the 7.3 code), so it predates 7.4. It matches the known Story 5.7 behaviour in focus-map §4 D («↑ from the first row first scrolls the list back by its few pixels; the next ↑ reaches the field»). Not fixed here.
- Process slip during the device run: after an app restart, one key series was sent while the Google TV launcher (not the app) was in the foreground, and two OK presses landed there without a screenshot first: one on the launcher's account chooser item «… Нажмите, чтобы продолжить с текущим аккаунтом» (the same account kept) and one on the launcher's «Заставка» button. The launcher home was showing right after, with nothing visibly changed. From then on the foreground activity was checked before every key series.

### Story 7.3 — Live viewer heartbeat, 2026-10-30

**Status: implemented; host- and demo-tested only. Not run on the device: no subscribed blog was live, and a real E16 to Boosty is an outward action that needs the owner's approval. No E16 was ever sent to Boosty; the request is `REF` (api-contract «E16 heartbeat (Story 7.3)»).**

`spec-7-3-live-viewer-heartbeat.md`. Host tests: `src/shared/entities/stream/__tests__/streamRepository.test.ts` «E16 heartbeat» (the path and `?stop=true`, an unsafe blog → `Client` before a request, one PUT each with no body and the token, the body discarded, 500 / 429 sent once, a 401 not replayed with a renewed token); `__tests__/liveFlow.test.tsx` «Story 7.3» (the first E16 at 30 s, then every 30 s, PUT with the content profile; an exit within 30 s → exactly one stop, nothing after; pause stops the ticks with no stop and play restarts the 30 s schedule; background and audio-focus loss stop the ticks, the exit still sends one stop; «Стрим завершён» → one stop and none at the later exit; the recovery sends no tick and the stream gone after it → one stop; a failed E16 → not retried, a counts-only warning, playback untouched, the next tick on schedule; never watched (not playable, gone at resolve) → no E16; an account reset while watching → nothing more, not even the stop; a VOD player → no E16; review fixes: the stop waits for a heartbeat in flight; a tick while one is in flight is skipped; a 401 stops the schedule with no stop; a 429 stops the schedule, the stop still goes out; a failed stop → a counts-only warning, no unhandled rejection; exit from the live error state → no tick during the error, one stop; the account reset clears the schedule); `__tests__/demoFlow.test.tsx` (the demo live Player: heartbeats and one stop, each answered 200 by the demo transport, no network). `authorFlow` got an E16 handler only.

Lint (`--max-warnings 0`), typecheck, `check:fixtures` (29 clean); `npm test` ×3: 113 suites, 2487 passed each; `playerFlow`, `demoFlow`, `authorFlow`, `src/shared/entities/stream` ×30 (352 tests each run): 0 failed runs (before the review fixes; after them `playerFlow` and `demoFlow` were re-run, full verification by the coordinator).

| Row | Result | By |
|---|---|---|
| Real E16 heartbeat and stop on the device | **Not checked** (no stream running; needs the owner's approval); host and demo tests only | — |

### Story 7.2 — Watch a live stream, 2026-10-30

**Status: implemented and host-tested; partly checked on the pinned device (Chromecast with Google TV 4K), driven by the agent over adb (injected keys, uiautomator focus dumps, a screenshot of the focused element before every OK; not the physical remote). No subscribed blog was streaming (probe: 3 × E15 204), so a real live playback, the live overlay (LIVE badge, elapsed, no timeline / ±10), pause / play at the live edge and «Стрим завершён» were not seen on the device: those are host-tested only. Seen on the device: the demo live card → Player → its error path → «Назад» → the card; a not-playable demo card → QR → close / Back → the card; a real no-stream author unchanged on the release-like build. The source mapping is `REF` (api-contract «E15 (LIVE)»).**

Host tests: `src/shared/entities/stream/__tests__/liveSources.test.ts` (the URL filter: the synthetic fixture, `live_playback_*` dropped, empty URLs, VOD / on-demand / progressive / CMAF / unknown types, HLS before DASH, `ok_stream` only, malformed input, no candidate; `hasLiveSources`; `isLiveRef`; `StreamRepository.liveSources`: ok, 204 / empty, scheduled / ended / malformed → none, `hasAccess: false` → ok with no sources, a failure sent once, no URL logged); `src/shared/entities/__tests__/externalUrls.test.ts` «boostyStreamUrl»; `src/features/player/__tests__/liveSource.test.tsx` (`useLiveSource`: ok with no progress meta and the start time, the kept quality, 204 / scheduled → `unavailable`, no URL / no access → `noSource`, a failure and its retry, disabled); `src/features/player/__tests__/PlayerOverlayLive.test.tsx` (badge, elapsed ticking every second, no elapsed without a start time, no timeline / times / ±10 s, the gear only with a choice, a video unchanged); `src/features/author/__tests__/LiveCard.test.tsx` (button role with an OK action, `liveCardPlayable`); `__tests__/liveFlow.test.tsx` «Story 7.2» (one test per matrix row: open (one E15, content profile, the HLS URL only, no `headers` on the engine, ids-only params, nothing logged), the URL filter (DASH), not playable at resolve (leaves, no engine), the overlay (badge, ticking elapsed, focus on play/pause, no timeline / ±10 / gear), no start time, pause / play (remount, no seek, no new E15, also the play/pause key), ← → raw / native / held and FF / Rew never seek, Back order, quality (no gear, Menu ignored), ended («Стрим завершён», «Назад» focused, engine released, no auto-exit, exit invalidates `['stream', blogUrl]`), Back exit invalidates too, engine error (one E15 and a remount, a second error → «Назад» only), stream gone at resolve (204, scheduled) and during the recovery, a failed E15 (retry), no ProgressRepository call and no E9 through ticks, pause, background and exit, the arbiter slot); `__tests__/authorFlow.test.tsx` «Story 7.2» (OK on a playable card → Player with `LiveRef`; scheduled / needs a level / no URL / DVR only → the QR of the stream page, Back → the card; return → the card and one more E15; ended in the Player → the first post; gone while covered → the first post, never the card; not playable at resolve → the QR over the card, close → the card, no QR on a later plain return); `__tests__/demoFlow.test.tsx` (the demo live card → Player with the synthetic `example.invalid` URL → recovery → error state → «Назад» → Автор, no network). Replaced: the 7.1 «OK on the card does nothing» row.

**Live probe (debug build, 2026-10-30):** the existing debug APK (native unchanged since its build) installed with `adb install -r` over the release-like build (session kept), Metro on 8081 (`adb reverse tcp:8081 tcp:8081`). A temporary counts-only `__DEV__` probe (`TEMP72`, mounted by the Shell; logged only the counts) sent E2, then `StreamRepository.liveSources` for each subscribed blog: **3 blogs, 3 × none (HTTP 204)**, no live tile. Removed right after (`src` grep `TEMP72` 0; release Hermes bundle `TEMP72` 0). No stream was opened from a real card.

**Demo debug build:** the same debug APK with Metro and a local, uncommitted `DEMO_MODE = true` (reverted: `DEMO_MODE = false`; release bundle `createDemoSessionManager` 0). For the QR row, a second local, reverted edit emptied the demo stream's `playerUrls` (the card then has no live-edge URL).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` with `DEMO_MODE = false`, release-like (`zipalign -p 4` + `apksigner`, the SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Metro stopped, the reverse mapping removed. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| E15 re-probe (real account) | 3 subscribed blogs, 3 × 204 (counts only) | agent, debug build + logcat |
| Card → OK → Player (demo) | Focus on `author/demo-blog-1/live` (screenshot), OK → the Player spinner, then (the synthetic `example.invalid` URL never loads) «playback failed; recovering» → one demo E15 → «playback failed again» → «Не удалось воспроизвести эфир» / «Попробуйте открыть эфир ещё раз.» with «Назад» only, focused (screenshot) | agent, adb + uiautomator + screencap + logcat, demo debug build |
| «Назад» → card (demo) | OK on «Назад» → Автор, focus on the live card | agent, adb + uiautomator, demo debug build |
| Not playable → QR (demo, no URL) | Focus on the card (screenshot), OK → «Эфир на Boosty», the QR, «Откроется на телефоне», «Закрыть» focused (screenshot); OK on «Закрыть» → the card; OK again → QR, Back → closed, focus on the card | agent, adb + uiautomator + screencap, demo debug build (local edit) |
| No stream (real author, release-like) | Подписки → OK on tile 1 → Автор: no `…/live` node, focus on the first post (screenshot); ↑ → the field, ↓ → the first post; Back → the same tile; no fatal exception in logcat | agent, adb + uiautomator + screencap |
| Real live playback, live overlay, pause / play at the edge, «Стрим завершён», exit invalidation, QR at resolve time | **Not checked on the device** (no stream running; the demo URL never plays); host tests only | — |

### Story 7.1 — Live stream card on the author page, 2026-10-30

**Status: implemented and host-tested. No subscribed blog was streaming: the live probe saw 3 × E15 204, so the three card states (live, scheduled, needs a level) are verified with synthetic fixtures, host tests and the demo only (`REF` shape). Checked on the pinned device (Chromecast with Google TV 4K), driven by the agent over adb (not the physical remote): the live card's focus moves in a debug build with Metro and a local, uncommitted `DEMO_MODE = true` (the demo live stream on «Демо-блог 1»); a real author with no stream on the release-like build. Not checked: the physical remote, TalkBack, a real live or scheduled stream, polling and card loss on the device (host tests only), the release-like build with a card (the demo cannot be built in release).**

`spec-7-1-live-stream-card-on-the-author-page.md`. Host tests: `src/shared/entities/stream/__tests__/streamRepository.test.ts` (the path and an unsafe blog → `Client` before a request; the live 204 fixtures and an empty 2xx → no stream; live, scheduled and needs-level from the synthetic fixtures, no URL, signed query or price in the entity; a malformed 200 → null with a counts-only warning; 5xx, network, 401, 403 sent once (no AD-6 retry); `mapStream` drop rules (no / empty / non-finite id, `isOnline` or `hasAccess` missing or another type, non-objects), neither online nor scheduled → null with the two booleans, online wins over `isTemplate`, fallbacks, the cover order and http(s) only); `src/shared/i18n/__tests__/format.test.ts` «formatStreamStart»; `src/app/__tests__/phaseFlags.test.ts` (`live` on, not a section); `__tests__/authorFlow.test.tsx` «Story 7.1» (one test per matrix row: no stream (one E15 with the content profile, layout and focus as before, none from Главная or Подписки, the grid gives up exactly the card's block when shown); live (badge on `colors.live`, title, «1 643 зрителя · 21 лайк», cover, the label, no price, initial focus on the card); the card request repeated two frames later and not after a user move (device lesson below); ↓ from the card → the remembered post, ↑ from the grid → the card (the live guide), ↓ from the row → the card, ↑ from the card → the field; one ring, no reflow (520 × 120 focused and not); scheduled (badge, «Начало … в 19:00», no viewers, no initial focus); needs level («Нужен уровень «Золото»», no price, no E1); malformed ×2; E15 fails ×2 (no card, no error UI, one request, no polling); polling every 30 s for scheduled and live, a state change in place with no focus move, a failed poll keeps the card, no poll while Пост covers Автор, again after Back, none after the pop; the stream ends with the card focused → the first post, with a post focused → no focus request; a stream appearing on a resume never takes focus (the resume invalidation); OK inert; flag off → no E15; a filter change keeps the card's focus; Back on the card pops). Existing Author tests pass with the default E15 204 handler. `__tests__/demoFlow.test.tsx` (the demo live card on `demo-blog-1` with initial focus, none on `demo-blog-3`, no network). Updated: `__tests__/subscriptionsFlow.test.tsx` (OK on a tile: Автор also sends E15), `__tests__/searchFlow.test.tsx` (a search sends no E15). Review follow-ups (host-tested only, after the device run): no poll while the app is in the background (`isAppActive`, `src/shared/platform/appLifecycle.ts`), one E15 on every open (`staleTime: 0`; a reopen within 60 s), card loss read before Android moves native focus (a focus event during the unmount commit), the head refresh suppressed only while the card holds the automatic focus (live vs scheduled resume tests), the live card as the nearest action above on a filter change, `accessibilityRole` not a button, millisecond `startTime` → none, the ended-stream log at info; `src/features/author/__tests__/LiveCard.test.tsx` (untitled, no start time, no level name, scheduled + needs level, cover error placeholder, role).

Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 109 suites, 2390 passed each; `authorFlow`, `demoFlow`, `src/shared/entities/stream`, `phaseFlags` ×30 (160 tests each run): 0 failed runs.

**Live probe (debug build):** the existing debug APK installed with `adb install -r` over the release-like build (session kept), Metro on 8081 (`adb reverse`). A temporary counts-only `__DEV__` probe (`TEMP71`, mounted by the Shell) sent E2, then E15 for each subscribed blog (`retry: false`): 3 blogs, 3 × HTTP 204 with an empty body. Removed before the commit (release Hermes bundle: `TEMP71` 0); Metro stopped, the reverse mapping removed. Results in `docs/api-contract.md` «E15 (LIVE)».

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL with `DEMO_MODE = false`, release-like (`zipalign -p 4` + `apksigner`, the SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| No stream (real author, release-like) | Подписки → OK on tile 1 → Автор: no card (no `…/live` node in the uiautomator dump), the action row then the grid as before, focus on the first post; ↑ → the field, ↓ → the first post; Back → the same tile (screenshot) | agent, adb + uiautomator + screencap |
| Live card shown (demo) | LIVE badge on the live red, «Идёт эфир», the 2-line title, «128 зрителей · 42 лайка», the placeholder cover; one ring around the whole card, nothing clipped, the grid below unmoved (screenshot) | agent, adb + screencap, demo debug build |
| Initial focus (demo) | **First run: focus stayed on the sidebar's «Подписки»** with the card shown: E15 and E4 answer together, the card mounts in the same commit as the focus request and Android drops it. Fixed: the request is repeated two frames later while focus is still where the page put it (host test above); the rebuilt run lands on the card | agent, adb + uiautomator, demo debug build |
| Moves (demo) | ↓ from the card → the first post; → → post 3; ↑ (the first ↑ only scrolls the list back by a few pixels, the known Story 5.7 behaviour) → the card; ↓ from the card → post 3 (the remembered post); ↑ from the card → the field; ↓ from the field → the card; ← from the card → the sidebar's «Подписки»; → → the card | agent, adb + uiautomator, demo debug build |
| OK on the card (demo) | Nothing: focus stays on the card, no route | agent, adb + uiautomator, demo debug build |
| Return from Пост (demo) | OK on post 3 → Пост; Back → Автор with post 3 focused, the card still shown | agent, adb + uiautomator, demo debug build |

### Epic 5 retro A4 — shared outcome focus and trim hooks, Author split, 2026-10-30

**Status: refactor, no behavior change; host-tested, and the Author page re-checked on the pinned device by the agent over adb (release-like build, injected keys, uiautomator, screenshots). Not checked by the owner with the physical remote; TalkBack not checked; Поиск was not re-driven on the device (its flow tests pass unchanged).** `spec-epic-5-retro-a4-author-split.md`. New unit tests: `src/shared/focus/__tests__/useOutcomeFocus.test.tsx` (8), `src/shared/entities/post/__tests__/useTrimOnKeyChange.test.tsx` (5). Existing flow tests unchanged except the grid helpers moved to `src/test/flow.tsx` (`listProps`, `gridRowItems`). Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3 (after the review fixes): 108 suites, 2340 passed each; `authorFlow`, `searchFlow`, `homeFeedFlow`, `subscriptionsFlow`, `src/shared/focus`, `postsHeadRefresh` and `useTrimOnKeyChange` ×30: 0 failed runs. The review fixes (the trim stores the committed key, `cancel()` also drops the scheduled frame, the pending-outcome leave tests) are host-tested only: the device run preceded them.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| Open | Подписки → OK on a tile → Автор: header, action row, focus on the first post (screenshot) | agent, adb + uiautomator + screencap |
| Row moves | → card 2, ↑ → the field; → the chip; ← the field | agent, adb + uiautomator |
| Search, nothing found | OK on the field → keyboard shown, «MJTV» + ENTER → «Ничего не найдено», focus on the field, «Сбросить» shown (screenshot) | agent, adb + uiautomator + screencap |
| Back, search active | Back → the query cleared, posts again, focus on the field | agent, adb + uiautomator |
| Search, results | «2025» + ENTER → results, focus on the first result | agent, adb + uiautomator |
| Filter while searching | ↑ → → the chip, OK → sheet on «Доступные мне»; ↓ OK «Все посты»; Back → the chip «Фильтры: Все посты. 1 активный фильтр», results refetched behind (screenshot) | agent, adb + uiautomator + screencap |
| Return from Post | ↓ → the first result, → card 2, OK → Пост (focus «Смотреть»); Back → Автор with «2025» and card 2 focused | agent, adb + uiautomator |
| «Сбросить» | ↑ → → → «Сбросить», OK → focus on the chip «Фильтры: Доступные мне», «Сбросить» gone | agent, adb + uiautomator |
| Back pops | Back → Подписки, the tile focused; no JS error in logcat | agent, adb + uiautomator |

### Epic 6 retro follow-ups A1–A2, 2026-10-30

**Status: host-tested only (no device run, no live vote).** `spec-epic-6-retro-a1-a2.md`. A1: `usePollVote` sends no E10 after a late E11/E12 once the account generation changed, and before `applyPoll` it cancels the post's running E8 (exact key, only while the generation is unchanged). A2: the QrRenderer port takes `background` from `QrDialog` and no longer imports `shared/ui`. Host tests: `src/features/polls/__tests__/PollWidget.test.tsx` «Story 6.6» rows «… while E11 runs: its late 200 sends no E10», «… while E10 runs: the post query of the new account is not cancelled», «an E8 of the post started before the vote and landing after E10 does not undo the vote» (each red on the unfixed hook); `QrDialog.test.tsx` unchanged and passing. Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 2322 passed each; `polls`, `QrDialog`, `postFlow`, `demoFlow` ×30: 0 failed runs.

### Story 6.7 — Multiple-choice poll, 2026-10-29

**Status: implemented and host-tested. No live multiple-choice poll exists (Story 6.5 scan: 1 single-choice poll in 493 posts): the multi-id E11 and the multiple `answer` are verified with the synthetic fixture `e10-poll-multiple.json`, host tests and the demo only (`REF`). Checked on the pinned device (Chromecast with Google TV 4K) in a debug build with Metro and a local, uncommitted `DEMO_MODE = true`, driven by the agent over adb (not the physical remote), on the demo multi poll («Демо-пост 6»). Not checked: the physical remote, TalkBack, a live multiple-choice vote, the release-like build (the demo cannot be built in release).**

| Check | Result | Who / how |
|---|---|---|
| Toggle | OK toggles the box (empty outline ↔ accent fill); nothing sent | demo debug build, adb |
| Submit | «Проголосовать» under the options, focusable once something is checked | demo debug build, adb |
| Vote | E11 `/v1/poll/2005/vote` 200 (demo), E10; results with accent checks on 1 and 3, «Проголосовали: 41»; focus stays on the same control, now «Отозвать голос» | demo debug build, adb |
| Retract | 1st OK: pulsing outline and «Нажмите OK ещё раз, чтобы отозвать» on the button; 2nd OK: E12 200, E10; focus on the first option, «Проголосовать» shown disabled | demo debug build, adb |
| Device bugs found and fixed | (1) The focused «Проголосовать» was unmounted on a vote: Android moved focus to the author and the column scrolled to the top → one action control that changes mode in place. (2) A focus request to a view mounted in the same commit (no layout yet) scrolled the column to the post's top → the retract hand-off and the poll fallback request focus from the second frame. Both re-checked on the device | demo debug build, adb, temporary logs (removed) |

`spec-6-7-multiple-choice-poll.md`. Host tests: `src/features/polls/__tests__/PollWidget.test.tsx` «Story 6.7» (checkbox stops with a ring and no scale, `accessibilityRole="checkbox"` and `accessibilityState.checked`, the labels with «отмечено» / «не отмечено»; every matrix row: toggle 1, 3, 1 → only 3, nothing sent, no pending; «Проголосовать» shown disabled and not focusable with nothing checked (`accessibilityState.disabled`); vote → E11 `answer=1,3` in option order, spinner and `busy`, E10, results with the accent checks, «Отозвать голос» the only stop with the poll summary in its label; vote failure → inline error, checks kept, 1 request, no retry after 60 s, the next OK clears it; single flight (also across two widgets); retract with the pending outline and hint, E12, E10, back to unchecked options; retract failure keeps the vote; cancel retract on blur; a refetch dropping a checked option drops its check; a finished multi poll one inert stop; a single-choice poll with the 6.7 ids keeps the 6.6 flow); `__tests__/postFlow.test.tsx` «Story 6.7» (through E8 → Пост with FixtureTransport: toggle and the disabled submit; vote → E11 `{answer: '1,3'}`, E10, the cached `answer`; vote failure; retract → E12, E10; retract failure; cancel retract; E10 failure after the vote → the post's E8 brings the voted poll; the focus mechanics are in the device-fix sentence below; first stop → initial focus on the first option, or on «Отозвать голос» when voted; a finished multi poll inert); `pollRepository.test.ts` (E10 from `e10-poll-multiple.json`: `isMultiple`, two `answer` ids); `mapPoll.test.ts` («poll modes»: `isVotablePoll` / `isMultipleVotable`); `__tests__/demoFlow.test.tsx` (the demo multi poll on `demo-post-5`: check 3 and 1, vote, results with checks 1 and 3, «Проголосовали: 41», retract back to unchecked options; no network). Device-fix tests (one action control): `PollWidget` «Vote» asserts the same host view re-registered from `…/submit` to `…/retract` and the reported focus id `…/retract`; «Retract» asserts the control stays focusable (drawn disabled: `text-disabled` label, `surface-raised` surface; inert) until the first option reports focus; after a bounded number of frames the requests stop but the focused control stays focusable until it blurs; the spinner shows for either running request when the mode flips; the last unvoted option's label carries «Затем выберите «Проголосовать» под вариантами»; no hand-off when the control is not focused. `postFlow` «Vote» / «E10 fails» assert the column guide's destination is the same view, now `…/retract`, with no focus request also after the deferred frames; `postFlow` «a refetch that drops the focused paragraph (`focusAfterUnmount`)» asserts the second request two frames later, and none after the user focused another stop; «Retract» asserts no focus request on frame 1 and the request on the first option from frame 2, never the author, while «Проголосовать» is still focusable; «Story 6.6» «E10 returns the poll finished» asserts the block stop is focused two frames later, also when the tracked id became the author meanwhile, and not when it became another stop (a manual rAF queue, `queueFrames` / `frames(n)`). Updated: `postFlow` «Story 6.6» «Finished / multiple» now uses a finished multiple-choice poll (an open one takes votes now). Demo: the open demo polls with n % 8 = 5 are multiple choice and not voted, answering E10–E12 in memory (E11 with one or more known distinct ids, else 400).

Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 2319 passed each; the touched suites (`polls`, `poll` entity, `postFlow`, `demoFlow`, `checkFixtures`) 30/30 (290 tests each run). The review patches are host-tested only (the device run preceded them).

### Story 6.6 — Vote and retract in a single-choice poll, 2026-10-29

**Status: implemented and host-tested; checked on the pinned device (Chromecast with Google TV 4K, the owner's session), driven by the agent over adb (not the physical remote). The live vote, vote change and retract ran in a debug build with Metro and a temporary probe (owner decision 2026-10-29, Q2 a; the poll ended retracted; results in `docs/api-contract.md` §4.2 «Poll votes (LIVE)»); pending, cancel and the focus ring were then seen on the release-like build. Not checked: the physical remote, TalkBack, a live mutation failure (host tests only), the multiple-choice and finished states (no live sample).**

`spec-6-6-vote-and-retract-in-a-single-choice-poll.md`. Host tests: `src/shared/entities/poll/__tests__/pollRepository.test.ts` (E10/E11/E12 paths, segments encoded, an unsafe blog or poll id → `Client` before a request; the E11 form `answer` (one id, several comma-joined), the form content type; a 5xx, 429 or network E11 sent once; a 401 never replayed after a renewed token; E12 DELETE without a body, sent once on failure; E10 through `mapPoll` from `e10-poll.json`, `Parse` for no `data.poll`, a dropped poll or another poll id; E10 follows AD-6); `applyPoll.test.ts` (pure `withPoll` over a `PostResult` and an `InfiniteData`, misses and malformed shapes returned as the same object; the cache: post, feed, feed search, blog search and author posts written, another post and another root untouched, every `dataUpdatedAt` kept, an unknown poll writes nothing); `src/features/polls/__tests__/PollWidget.test.tsx` «Story 6.6» (option stops with a ring and no scale, the root not focusable, the first option's label; every matrix row: vote with pending outline/hint, spinner, `accessibilityState.busy`, E11 then E10 and the updated results; cancel on blur; retract; change vote; mutation failure (network, 5xx, 429, a server refusal) with the inline error, the previous state, no retry after 60 s, the next OK clearing it; retract failure copy; double press ignored; single flight across two widgets of one poll; E10 failure → `invalidateQueries` on the post key, no error; finished / multiple stay one inert stop); `__tests__/postFlow.test.tsx` «Story 6.6» (through E8 → Пост with FixtureTransport: vote, cancel, retract, change vote, mutation failure ×4, double press with a held E11, E10 failure → one more E8 bringing the poll, an open poll as the first stop → initial focus on its first option, finished / multiple inert; the cached post holds the E10 poll, no `poll` query key, no focus request after the vote). Updated: `postFlow` «Story 6.5» and `demoFlow` (an open single-choice poll now exposes option stops instead of one block stop); `__tests__/checkFixtures.test.js` (`answer` ids). Demo: the open demo polls (n % 4 = 1) answer E10–E12 in memory.

Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 2283 passed each; the touched suites (`PollWidget`, `pollRepository`, `applyPoll`, `mapPoll`, `postFlow`, `demoFlow`, `checkFixtures`) 30/30.

| Check | Result | Who / how |
|---|---|---|
| Live E10 shape | `data.poll` as the reference; options carry an extra `voters` object; `answer` (numbers) and `other` (string) appear only after a vote | debug build + temporary probe, adb |
| Pending / cancel (OK on option 1, then ↓) | Pulsing outline and «Нажмите OK ещё раз»; ↓ cancels it; **no HTTP request in the adb log** (debug build; the release-like build logs nothing, screens only) | debug and release-like builds, adb |
| Vote (OK, OK on option 2) | `POST …/vote` 200 once, then E10; the check on option 2, its count +1, focus stays on it | debug build, adb |
| Change vote (↑, OK, OK on option 1) | `POST …/vote` 200; E10 moved the vote (option 1 +1, option 2 −1); the check moved, focus stays | debug build, adb |
| Retract (OK, OK on the chosen option) | «Нажмите OK ещё раз, чтобы отозвать», then `DELETE …/vote` 200; no check; counts back to the start | debug build, adb |
| Pending hint after the review patch | In the option's row in place of «N % · count», one line, no height change; ↑ cancels it and the result returns | release-like build, adb |
| Focus ring of a focused option at the column's bottom | Cut off with a margin between options on the first device run; whole after the fix (vertical padding on each option stop) | release-like build, adb |

### Story 6.5 — Poll display, 2026-10-29

**Status: implemented and host-tested; the live poll shape was checked on the pinned device (debug build with Metro, a temporary probe, the owner's session; results in `docs/api-contract.md` §4.2 «Polls (LIVE)»). The one live poll was shown on the release-like build, driven by the agent over adb. Only an open, unvoted single-choice poll exists live: the chosen-option check, the finished state, zero voters and a malformed poll are verified with fixtures, host tests and the demo only. Not checked: the physical remote, TalkBack.**

`spec-6-5-poll-display.md`. Host tests: `src/shared/entities/poll/__tests__/mapPoll.test.ts` (the live shape with string ids, the fixture poll, the «, » title join and non-strings skipped, `answer` ids as strings, string ids kept, a missing `counter` → 0, missing option text → empty, one option without `fraction`, `counter` or `id` (or not an object) dropped on its own with the rest kept (owner decision, option a); every drop rule → null: no or empty id, no or wrong-typed `isMultiple`/`isFinished`, no or empty `options`, no valid option left, non-object input; duplicate option ids (1 and "1") keep the first, `answer` deduplicated; a non-finite id; a negative, fractional or non-numeric `counter` → 0; the percent rounding and the bar clamp to 0…100); `src/shared/i18n/__tests__/format.test.ts` «formatCount» (narrow no-break thousands separator); `postBody.test.ts` «polls (Story 6.5)» (after the body as one stop keyed `poll:<id>`, at its `poll` block when one has the poll's id or none, another id's block stays a placeholder, a poll with no valid option → «Опрос» placeholder after the body (or the block's own), no poll → nothing, a video row + poll → the poll is the only body stop, a poll-only post is accessible, the block with the poll's id wins over an earlier id-less one, a malformed poll with a `poll` block of another id still gets its placeholder after the body, a locked post → no poll); `mapPost.test.ts` «poll (Story 6.5)» (mapped, `pollUnsupported` with the raw id, kind «Опрос», a poll-only post accessible, locked → none); `src/features/polls/__tests__/PollWidget.test.tsx` (every matrix row: open, my choice, finished, zero voters; each option's «N % · count» with a thousands separator; the bar clamp; «Опрос» for an empty title (said once in the label); «Вариант N» for an option without text; the label with the vote counts, with no added period after a title ending in «?», «!», «.» or «…»; one stop; ring, no scale, OK does nothing); `__tests__/postFlow.test.tsx` «Story 6.5» (every matrix row through E8 → Пост, «Malformed option»: one bad option dropped and the poll shown, every option bad → the placeholder; a single stop with no focusable option, the label, the unchanged initial focus, a heading + poll → initial focus on the poll, no `/poll` request, the live-sanitized fixture's poll last); `__tests__/demoFlow.test.tsx` (the open demo poll after the body with the check on option 2 only, a finished demo poll with 0 voters, «0 % · 0» and 0 % bars). `postFlow` «Locked post» also asserts focus on the author. Updated: `postDetail` (test fixtures) leaves the fixture's poll out unless a test passes one. Fixture: `e8-post-accessible.json` gained a live-sanitized top-level `poll` in the live key set (id 1020, 2 options, fractions 100 and 0, counters 5 and 0, no `answer`); `check:fixtures` now allows a `fraction` of only 0 or 100 (`__tests__/checkFixtures.test.js`). Demo: open (with a choice) and finished (0 voters) top-level polls on every odd accessible post (n % 4 = 1 and 3); the old demo `poll` block (a placeholder) was removed.

Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 2208 passed each; the touched suites (`postFlow`, `demoFlow`, `PollWidget`, `mapPoll`, `postBody`, `mapPost`, `endedReturnFocus`) 30/30.

**Live check (debug build):** the existing debug APK installed with `adb install -r` over the release-like build (session kept), Metro on 8081 (`adb reverse`). A temporary `__DEV__` probe (`TEMP65`, mounted by the Shell) read E5 (10 pages of 20) and E2 → E4 for all 3 subscribed blogs (up to 10 pages of 20, `is_only_allowed=false`; blog 3 reached `isLast` at page 5), 493 distinct posts, then one E8 for the poll post; 37 requests, all HTTP 200. Removed before the commit (release Hermes bundle: `TEMP65` 0); Metro stopped, the reverse mapping removed.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, the SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Nothing uninstalled or cleared; no sign-in, no sign-out, no vote.

| Check | Result | Who / how |
|---|---|---|
| Live shape | 1 poll in 493 posts: top-level `poll` only, no `poll` block; keys `counter`, `defaultLang`, `hasOther`, `id`, `isFinished`, `isMultiple`, `options`, `title`; options `counter`, `fraction` (integer), `id`, `text`, `voters`; no `answer` | agent, adb + logcat (debug build) |
| Card badge | The poll post's card on Автор (Подписки → blog 3, row 12) reads «Опрос» | agent, adb + screenshot |
| Poll on Пост | Initial focus on the first paragraph; ↓ through the paragraphs reaches the poll: title, 2 rows with result bars and «12 %» / «88 %», «Проголосовали: 1643»; one ring around the whole poll; ↓ again stays (the column scrolls to its end), OK does nothing; ↑ → the last paragraph; Back → Автор with focus on the same card | agent, adb + screenshots |
| Per-option count | **Not re-checked on the device:** the count next to the percent, the thousands separator and «Вариант N» were added after the device run (review fix); host-tested only | — |
| Ring at the column bottom | First build: the ring's bottom edge was cut off at the column's bottom (the poll is the last block). Fixed with the stop's vertical padding (as the AudioBlock); the rebuilt release-like build shows the whole ring | agent, adb + screenshots |

### Story 6.4 — Inline audio, 2026-10-29

**Status: implemented and host-tested; the live keys and the source were checked on the pinned device (debug build with Metro, a temporary probe, the owner's session; results in `docs/api-contract.md` §4.1 «Audio blocks (LIVE)»). The sample post's track was played, seeked, paused, backgrounded and left on the release-like build, driven by the agent over adb. Not checked: the PlaybackArbiter on the device («Смотреть» while audio plays; see below), sleep (only Home), an audio-focus loss, an engine error and its re-resolve, the physical remote, TalkBack.**

`spec-6-4-inline-audio.md`. Host tests: `src/features/player/__tests__/AudioBlock.test.tsx` (render: one stop, «0:00 / 3:12», an empty bar, «–:––» until the engine loads a duration, «Аудио» without a title, the guide traps ← → only; play: one fresh resolve, the 0 × 0 progressive engine hidden from accessibility, the URI not in the tree, progress moves the time and the bar, OK pauses and resumes without a new E8, busy while resolving (OK ignored), the end then OK starts over from 0, no resolver → nothing; seek: ±10 s on key up without the native module, clamped to 0…duration, a stale progress report before the seek lands ignored, keys only while focused, the entry guard, native `SeekKeys` key down with the 200 ms hold repeat and the swallowed key up, enabled only while focused, a seek before play sets the start; arbiter: another holder drops the source and keeps the position (OK → a fresh resolve from there), a second AudioBlock stops the first; lifecycle: unmount releases the engine and the slot, a late resolve after unmount plays nothing, background and an audio-focus loss pause with no auto-resume, `active` false pauses and true does not resume, background during the resolve starts paused, a source ≥ 23 h old is resolved again; errors: one re-resolve at the last position, a second error → «Не удалось воспроизвести» (label, no engine, the slot free), OK retries with the budget restored, unavailable / locked / an E8 failure → the error, no URI in the logs); `postRepository.test.ts` «PostRepository.audioSource» (a fresh E8, by id, the live fixture's block, by index only with the shown title, a `file` never an audio source, a missing or unsafe URL, an empty or missing `signedQuery` → unavailable, locked, 404, errors, nothing logged); `postBody.test.ts` «audio (Story 6.4)» (the `audio` item and stop, whole-second duration, null for none/zero/negative/malformed, an index key without an id, a repeated id, a placeholder without `qr`); `__tests__/postFlow.test.tsx` «Story 6.4» (the stop between paragraphs with its label and the unchanged initial focus; OK → one extra E8 → the engine with `url + signedQuery`, never in the tree, logs or the query cache; pause and resume without an E8; Back → the engine unmounts, the slot is free; an empty `signedQuery` → the error, no engine, OK retries; with the player on, «Смотреть» opens the Player and the audio pauses at once and stays paused after Back; a locked teaser keeps the placeholder); `__tests__/demoFlow.test.tsx` (the demo AudioBlock «Демо-аудио», «0:00 / 3:12»). Updated: the Story 3.4 «Mixed blocks» test (audio is a stop now) and a placeholder-only scroll test. Fixture: `e8-post-accessible.json` gained one synthetic `audio_file` block at the end of `data` in the live key set (`synthetic-id-14`, `https://example.invalid/audio`, 3:00). Demo: the demo post's audio has an `example.invalid` URL, so its playback ends in the error state.

**Live check (debug build):** the existing debug APK installed with `adb install -r` over the release-like build (session kept), Metro on 8081 (`adb reverse`). A temporary `__DEV__` probe (`TEMP64`, mounted by the Shell) read E2 and E4 (3 blogs × up to 8 pages), all HTTP 200, found 1 `audio_file` block (the sample post), then one fresh E8 and status-only requests to the audio host (403 bare; HEAD 200 `audio/mpeg`, range GET 206 signed; never a URL or value logged). Removed before the commit (release Hermes bundle: `TEMP64` 0); Metro stopped, the reverse mapping removed. The debug build also played the track before the release-like build was made; it showed the last block's focus ring cut off at the column's bottom edge, fixed with the stop's vertical padding (and no focus scale).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, `JAVA_HOME` openjdk 17) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, the SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| Live keys and source | `audio_file`: `album`, `artist`, `complete`, `duration` (present), `fileType`, `id`, `isInvalid`, `showViewsCounter`, `size`, `timeCode`, `title`, `track`, `type`, `uploadStatus`, `url`, `viewsCounter`; `url` alone 403, `url + signedQuery` HEAD 200 `audio/mpeg` / range GET 206 | agent, adb + logcat (debug build) |
| Render | Подписки → Илья MJTV Соколов → «Когда метроном - твой враг!» → ↓ to the block: «Мастодон - бусти-001.mp3», «0:00 / 3:58», the play glyph, the ring fully visible (screenshot before OK) | agent, adb + uiautomator + screencap |
| Play | OK → about 4 s later «0:02 / 3:58», the pause glyph, the bar moving; the app's `AudioTrack` `started` (`dumpsys audio`) | agent, adb + screencap |
| Seek | → → : 0:02 → 0:23; ←: 0:23 → 0:14; focus stayed on the block (← did not reach the sidebar) | agent, adb + uiautomator + screencap |
| Pause | OK → the play glyph, 0:16 kept; `AudioTrack` `paused` | agent, adb + screencap |
| Home | Playing, Home → `AudioTrack` `paused`; back to the app → still paused at 0:20, the play glyph, focus on the block | agent, adb + uiautomator + screencap |
| Back | Playing, Back → Автор with focus on the same card; `ExoPlayerImpl: Release`, no `AudioTrack` of the app left | agent, adb + logcat + `dumpsys audio` |
| Reopen | The post again: «0:00 / 3:58» (nothing persisted); ↓ on the block stays, ↑ → the image above, ↓ → the block | agent, adb + uiautomator |
| «Смотреть» while audio plays | **Not run on the device.** A post leaves focus (or unmounts) before any Player opens, so on the device the audio is already paused (route blur) or stopped (Back) when a video starts. The `postFlow` «Story 6.4» «Смотреть» test cannot tell the route blur from the arbiter; the arbiter path is unit-tested in `AudioBlock.test.tsx`, and the route-blur pause through Пост is pinned by the `postFlow` link-chip test | — |
| Keep awake (review follow-up, rebuilt release-like build) | Before play: no `KEEP_SCREEN_ON`. Playing (`AudioTrack` `started`): the app window `fl=KEEP_SCREEN_ON`, `mHoldScreenWindow` = the app, `SCREEN_BRIGHT_WAKE_LOCK` for the app (`dumpsys window`, `dumpsys power`). Paused with the source kept: still `KEEP_SCREEN_ON` (2 s after the pause). Back: `mHoldScreenWindow=null`, no wake lock, no `AudioTrack` | agent, adb + `dumpsys` (screenshot before OK) |

No player ran longer than about 10 s unattended; the last state is the Автор page with nothing playing.

Not verified on the device: sleep (only Home), an audio-focus loss, an engine error and its re-resolve, a source ≥ 23 h old, the entry-guard window (not measured separately: the native key down that moves focus onto the block arrives before the block subscribes to `SeekKeys`), a held ← → (adb sends single presses), the physical remote, TalkBack. uiautomator sometimes returned the block's previous `content-desc` while the track played (the label changes every second); what TalkBack reads was not checked.

**Host checks (2026-10-29):** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` (24 clean) pass; `npm test` ×3: 102 suites, 2143 tests passed each run; the touched suites (`postFlow`, `demoFlow`, `noRawText`, `boundaries`, `src/features/player`, `src/features/post`, `src/shared/entities/post`, `src/shared/i18n`; 599 tests) ×30: 0 failed runs.

### Story 6.3 — Links, files and external videos via QR, 2026-10-29

**Status: implemented and host-tested; the live keys and the file target were checked on the pinned device (debug build with Metro, a temporary probe, the owner's session; results in `docs/api-contract.md` §4.1 «File and video blocks (LIVE)»). A link chip and a YouTube chip opened the QrDialog on the release-like build, driven by the agent over adb. A file chip was not opened on the device (no file post was reached by D-pad; the file target is live-checked by the probe only). The owner scanned a link chip's QR with a phone (below). A Boosty post link chip (owner decision 2026-10-29) opened the linked Пост and Back returned to the chip on the device. Not checked with the physical remote; TalkBack not checked.**

`spec-6-3-links-files-and-external-videos-via-qr.md`. Host tests: `src/features/post/__tests__/linkChip.test.tsx` (a post link chip without `onOpenPost` falls back to the QR label and the QR; a timestamp chip with `onPlayAt` plays at that second, without it falls back to the QR); `__tests__/playerFlow.test.tsx` «Story 6.3: timestamp link chips» (the «· Смотреть» label; another video or format keeps the QR, another post «Открыть»; OK → `Player {ref, origin: the chip, start: {atSec: 225}}`, the engine seeks to 225, a 5 s visit writes no E9, Back → the same chip; a time past the end → the last second); `src/shared/entities/__tests__/externalUrls.test.ts` (`timestampRef`: the live shape, key order, another video/post/blog, `1m2s`, negative, decimal, empty, fragment, malformed encoding, YouTube; `boostyPostRef`: `boosty.to`/`www.` post pages with query, fragment or a trailing slash; null for a blog page, other Boosty paths, an extra segment, an unsafe `blogUrl` or `postId`, `http:`, a port, `api.` or look-alike hosts; `safeHttpUrl` accepts only absolute http(s) URLs with a host; `youtubeId` for `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, rejects look-alike hosts and malformed ids; `fileTarget` `?`/`&` join, fragment dropped, empty query, unsafe URL); `src/shared/entities/post/__tests__/postBody.test.ts` «Story 6.3» (matrix «Link»: 2 chips for 3 links with a repeat, none for `javascript:` or empty; link-only paragraphs; chips on the last stop of a split paragraph; list items; «File»; «YouTube» / «Other video» / unsafe → placeholder; «Header»: heading ends the paragraph, empty dropped; no chips without `qr`; the live fixture with its synthetic blocks); `postRepository.test.ts` «PostRepository.fileTarget» (a fresh E8, by id, by index only with the shown title, an empty `signedQuery` → unavailable, unavailable, locked, 404, errors, nothing logged); `src/shared/ui/__tests__/QrDialog.test.tsx` (the real library through the react-native-svg mock: 200 dp, the quiet zone in the viewBox, `qr-bg` background, black modules; «Закрыть» the only focusable, preferred and requested; the value never in the tree; an oversized value → «Не удалось показать QR-код»); `src/shared/i18n/__tests__/format.test.ts` `formatFileSize`; `__tests__/postFlow.test.tsx` «Story 6.3» (every matrix row through the real App; an id-less file `file@<n>` opens its QR; a failed file chip's label carries the error; chips in column order, the heading, «Open QR» with the trap and the hidden background, Back → the chip, the next Back pops; «Закрыть» → the chip; «File» with one extra E8 and the signed target only in the QR port (not in the tree, `logger`, `console` or the query cache); busy, a second OK ignored, a 500 → the inline error, retry; a file gone → error; YouTube thumbnail and its failure; other video; a locked teaser without chips; the autoFocus guides); a locked fresh E8 → «Нет доступа к файлу»; a file E8 that lands after a Boosty post link pushed another Пост → no dialog, no QR value, no focus move; «Timestamp» with the player off (the chip keeps its QR); «Boosty post link» (the «<text> · Открыть» chip without «QR», OK pushes the linked Пост with the same sidebar origin and one E8 for it, Back → the same chip, a link to the current post and a blog page keep the QR chip); `__tests__/demoFlow.test.tsx` (the demo post's chips, heading and a file QR opened from the demo E8). Updated: the Story 3.4 «Mixed blocks» / «Inline link» / Story 6.1 tests (a file is a chip now, links have chips), a placeholder-only scroll test (audio + poll). Fixture: `e8-post-accessible.json` gained three synthetic blocks at the end of `data` (a `header`, a `file` `synthetic-id-13` with `https://example.invalid/file` and size 204800, a `video` with `https://example.invalid/video`); a YouTube URL cannot pass `check:fixtures`, so YouTube is tested with in-test blocks. The Story 3.4/6.1 tests on the live fixture drop these three (`liveBlocks()`).

**Live check (debug build):** the existing debug APK installed with `adb install -r` over the release-like build (session kept), Metro on 8081 (`adb reverse`). A temporary `__DEV__` probe (`TEMP63`, mounted by the Shell) read E5 (10 pages of 20) and E2 → E4 (3 blogs × 8 pages), 32 requests, all HTTP 200, then for 3 files one fresh E8 each and status-only requests to the file host (403 bare, 200 HEAD / 206 range GET with `signedQuery`; never a URL or value logged). A second probe (`TEMP63B`) logged only the feed or blog position of posts with `file`/`video` blocks, to find them on the device. Both were removed (release Hermes bundle: `TEMP63` 0); Metro stopped, the reverse mapping removed.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, `JAVA_HOME` openjdk 17) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, the SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| Live keys | `file`: `complete`, `id`, `isInvalid`, `size`, `title`, `type`, `url` (6 blocks); `video`: `type`, `url` (2, both `youtube.com/watch`); `header`: `content` (text JSON, non-empty), `modificator` (empty), `type` (21) | agent, adb + logcat (debug build) |
| File target | 3 files: `url` alone → 403; `url + signedQuery` (fresh E8) → HEAD 200, range GET 206; target 192 characters | agent, adb + logcat (debug build) |
| Link chips | A video post of the owner's feed: «Полезные ссылки» lines and timecode lines each show a chip under the line («…  QR»); ↓ and ↑ walk paragraph → chip → next paragraph through every chip (uiautomator). **First build:** a narrow chip under a full-width paragraph was skipped both ways (Android weighs the horizontal center offset); fixed with a full-measure `TVFocusGuideView autoFocus` around each chip row / chip, then re-checked | agent, adb + uiautomator + screencap |
| Open QR (link) | OK on «Личная безопасность QR» → the dialog: the title, a QR on white, «Откроется на телефоне», «Закрыть» focused; ↓ ← ↑ → keep focus on «Закрыть»; Back → the dialog closes, focus on the same chip; OK, then OK on «Закрыть» → closed, focus on the chip | agent, adb + uiautomator + screencap |
| External video | «Сравнение Faded и Tribute!» (feed): the chip with the YouTube thumbnail and «Видео на YouTube QR»; OK → the QrDialog, the app stays in front (nothing opened); Back → the chip; Back → Главная on the same card | agent, adb + uiautomator + screencap |
| Heading | Not seen on the device (the posts opened had none); host-tested | — |
| File chip | Not run on the device (no file post reached); the signed target is live-checked by the probe and host-tested | — |
| Live timestamp links (debug build, temporary probe `TEMP63C`, removed) | E2 → E4 (13 requests, HTTP 200): 101 posts with «Таймкоды» (100 with one `ok_video`, 1 with two); all 1 327 links `boosty.to/<blog>/posts/<post>?t=<int>&tmid=<id>`; 1 304 name this post and one of its `ok_video` ids, 23 another post; `t` equals the text time for 1 326 (api-contract §4.1 «Timestamp links (LIVE)») | agent, adb + logcat (debug build) |
| Timestamp chip (rebuilt release-like build) | «А Зеленский может мне не сидеть…»: under «Таймкоды:» the chips «0:00 · Смотреть», «1:57 · Смотреть» (screenshot before OK). OK on «1:57 · Смотреть» → the Player (the surface focused); about 5–8 s later the position read **2:07** of 1:50:01 (uiautomator; the screencap of the video surface is black); Back → Пост, focus on the same chip. **Side effect:** the visit lasted ≥ 10 s of playback from 1:57, so the progress rule wrote it: this video's progress moved from «Осталось 19 мин» to «Осталось 108 мин» (local entry, and E9 by the rule) — the owner's resume point for this video was overwritten | agent, adb + uiautomator |
| Long post-link chips | **First rebuilt build:** a long link text cut the action word («… · От…»); the action word is now its own text after the truncated link text; re-checked on the device: «… · Открыть» and «0:00 · Смотреть» fully visible | agent, adb + screencap |
| Owner scans a QR with a phone | Done (link chip; see «Owner check» below). No photo of a file QR is kept | owner |
| Boosty post link (owner decision 2026-10-29, rebuilt release-like build) | Главная → «А Зеленский может мне не сидеть…» (Алексей Антонов) → ↓ to «Полезные ссылки»: the chip «Смотрим любимых инфоцыган и мотивируемся · Открыть» (no «QR»; screenshot before OK); OK → that Пост on top (header «Смотрим любимых инфоцыган и мотивируемся», sidebar current Главная, focus on «Смотреть»; no OK pressed there, no player opened); Back → the same chip focused; Back → Главная on the same card | agent, adb + uiautomator + screencap |

**Owner check (2026-10-29):** the owner scanned a link chip's QR (react-native-qrcode-svg 6.3.26) with a phone on the installed release-like build: the phone opened the right page. Owner decision then: timestamp links keep one chip each (option a); **superseded** the same day by option b (a timestamp link to this post's video opens the Player at that time; see the «Timestamp chip» row).

Not verified on the device: a file chip (busy, the dialog with a signed target, the error line, «Нет доступа к файлу»), a phone scan of a file QR, a heading, a YouTube thumbnail failure, the physical remote, TalkBack. Seen on the way: an accessible `audio_file` post exists in a subscribed blog (for Story 6.4).

**Host checks (2026-10-29), Boosty post link addition:** lint `--max-warnings 0`, typecheck clean; the touched suites (`postFlow`, `demoFlow`, `noRawText`, `boundaries`, `src/shared/entities`, `src/features/post`, `QrDialog`, `src/shared/i18n`, `src/app`; 22 suites, 598 tests) pass; the full runs are the coordinator's.

**Host checks (2026-10-29, before the addition):** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` (24 clean) pass; `npm test` ×3: 100 suites, 2044 tests passed each run; the touched suites (`postFlow`, `demoFlow`, `src/shared/entities`, `src/features/post`, `QrDialog`, `src/shared/i18n`; 18 suites, 495 tests) ×30: 0 failed runs. `releaseBundle` (the debug and release Metro bundles with the asset-registry alias) passes.

### Story 6.2 — Images in posts, 2026-10-29

**Status: implemented and host-tested; the main path checked on the pinned device by the agent over adb (release-like build, the owner's session). Not checked by the owner with the physical remote; TalkBack not checked; a failed image and the skeleton were not seen on the device (host-tested).**

`spec-6-2-images-in-posts.md` (oneshot). Host tests: `src/shared/entities/post/__tests__/postBody.test.ts` «images of an accessible post (Story 6.2)» (`images: 'stops'` → an image stop, no URL → placeholder; a teaser image is never a stop), `__tests__/postFlow.test.tsx` «Story 6.2» (the image is a stop between paragraphs; 4:3 → 400 × 300; the skeleton colour until `onLoad`, then the real aspect 16:9 → ≈ 533 × 300; loading moves no focus; a failure → «Изображение недоступно» in the same stop, the stop and the rest kept; an image first is the initial focus). The «Mixed blocks» test now uses an image without a URL for its placeholder row.

**Host checks (2026-10-29, after the review fixes):** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` clean; `npm test` ×3: all passed each run; `postFlow` + `src/shared/entities/post` + `src/features/post` ×30: 0 failed runs. The review fixes (a neutral, minimum-size failed box; no press scale; the no-size test) are host-tested only: the installed build predates them. Open risk: a post with many large images decodes them all in the plain ScrollView (not virtualized); a gallery-style post was not tried on the device (`deferred-work.md`).

**Device (Chromecast with Google TV 4K, release-like `assembleRelease -PreactNativeArchitectures=armeabi-v7a` + `zipalign -p 4` + `apksigner` with the SDK debug key, `adb install -r`, session kept; the screensaver was up, woken with `KEYCODE_WAKEUP`; every OK sent after a screenshot of the focused element):** Главная → the «Текст и фото» card «ЭТО ЧТО ЗА ИМБА!?» → Пост: the paragraphs as before; ↓ ↓ ↓ → the portrait photo as a focus stop with the ring, 300 dp tall with its aspect, left-aligned under the text; OK on it: nothing happens (the activity and screen unchanged); Back → Главная with focus on the same card. It is the installed build now.

### Story 6.1 — Rich text, emoji and long posts, 2026-10-29

**Status: implemented and host-tested; the live style ranges were checked on the pinned device (debug build with Metro, a temporary counts-only probe, the owner's session, 2026-10-29; results in `docs/api-contract.md` §4.1 «Text styles and smile (LIVE)»). The live check corrected one spec assumption: style ranges count from the paragraph start, not from the fragment (implemented that way; see the spec's Spec Change Log). Bold and underline were then seen rendered on the release-like build by the agent over adb (screenshots). No `smile` block exists in the scanned posts, so emoji are fixture-tested only. Italic and a styled paragraph longer than one stop were not seen on the device. Not checked by the owner with the physical remote; TalkBack not checked.**

`spec-6-1-rich-text-emoji-and-long-posts.md`. Host tests: `src/shared/entities/post/__tests__/mapPost.test.ts` «styledTextOf / smile (Story 6.1)» (matrix «Styles», «Unknown code», «Bad ranges», «Non-JSON content»; ranges kept past the fragment for the builder; UTF-16 offsets; `text`/`link` spans; `smile` URL order medium → large → small → none, malformed fields); `src/shared/entities/post/__tests__/postBody.test.ts` «styled segments and emoji (Story 6.1)» (matrix «Styles», «Merge» with paragraph offsets, a range clamped to its own fragment, offsets restarting per paragraph / list item / non-inline block with a smile counting one, adjacent runs merged, «Emoji» inline, an image-less smile takes no space, «Long styled» 1500 characters with a bold run across the 600 cut → 3 stops, an emoji as one character of the budget, list items, the live E8 fixture with its sanitized ranges and synthetic smile); `__tests__/postFlow.test.tsx` «styled text and an inline emoji (Story 6.1)» (nested runs: SemiBold face with no `fontWeight`, `fontStyle: italic`, underline; the emoji a plain `{uri}` image at 22 dp, not focusable; `onError` → the emoji gone, the text and the label intact, the focus stops unchanged). The Story 3.4 body tests now compare paragraphs as `{kind, key, text}` (segments are covered by the new tests). Fixture: `e8-post-accessible.json` gained sanitized ranges on its first two fragments and one synthetic `smile` block (name `synthetic-key-1`, before the last paragraph end; indices and keys of every focusable paragraph unchanged).

**Live check (debug build):** the existing debug APK (native unchanged since; the only later `package.json` change is the JS-only `zustand`) installed with `adb install -r` over the release-like build (session kept), Metro on host port 8081 (`adb reverse tcp:8081 tcp:8081`). A temporary `__DEV__` probe (`TEMP61`, mounted by the Shell) read E5 (10 pages) and E2 → E4 (3 blogs × 8 pages), 32 requests, all HTTP 200, and logged only counts, types and booleans. All `TEMP61` code was removed (release Hermes bundle: `TEMP61` 0). Metro was stopped and the reverse mapping removed.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Release Hermes bundle: `GolosText-SemiBold` 1, `/emoji/` 1, `TEMP61` 0, `createDemoSessionManager` 0. Nothing uninstalled or cleared; no sign-in, no sign-out.

**Host checks (2026-10-29):** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` clean; `npm test` ×3: 98 suites, 1985 tests passed each run; the touched suites (`postFlow`, `playerFlow`, `src/shared/entities/post`, `src/features/post`) ×30: 441 tests passed in every run.

| Row | Result | By |
|---|---|---|
| Live style codes and offsets | Codes 0 / 2 / 4 only; every range fits its fragment at paragraph offsets (UTF-16), none at fragment offsets for a later fragment; no `smile` in 612 posts; first live `file` (9) and `header` (42) blocks seen (types only) | agent, adb + logcat (debug build) |
| Bold and underline | Главная → OK on a video post of the owner's feed → ↓ through the body: «Полезные ссылки:» and «Таймкоды:» bold (SemiBold), the link lines «→ …» with the link text underlined after a plain «→ » (a later fragment: placed by its paragraph offset) (screenshots) | agent, adb + uiautomator + screencap |
| ↓ through a long styled post | 30 stops from the MediaRow to the last paragraph (`text@1` … `link@104`), one focused stop at a time, the column scrolling; ↓ at the end stays; Back → the same feed card | agent, adb + uiautomator |
| A text post without styles | «ЭТО ЧТО ЗА ИМБА!?»: paragraphs as before (screenshot) | agent, adb + screencap |
| Emoji | Not run: no `smile` block in the scanned posts; fixture-tested only | — |

Not verified on the device: italic (48 live ranges, none on the posts opened), a styled paragraph split across stops (host-tested), inline emoji and an emoji image failure, the physical remote, TalkBack. **Native-unverified:** on Android an `Image` nested in `Text` becomes an inline span, so its `onError` (the emoji removed, no gap), its 22 dp box against the 14 sp / 22 sp-line body text and the emoji-only non-focusable paragraph are proven only by JS tests (`postFlow`), not by a native render.

Review fixes (2026-10-29, host-tested only; the installed build predates them): a paragraph or split part without plain text (emoji only) renders as non-focusable content and is never the initial target (`isFocusStop`); a range with `from` < 0 is dropped (not clamped); `listItemTexts` removed (no production caller).

### Epic 5 retro A1–A3, 2026-10-29

**Status: implemented and host-tested; the A2 live E6 access check ran on the pinned device (debug build with Metro, a temporary counts-only probe, the owner's session, 2026-10-29; results in `docs/api-contract.md` «E6 access (LIVE)»: E6 honours `only_allowed` and `only_bought`, so no stop). The Поиск reset (A1) and the «Мой блог» re-check (A3) were not checked on the device: the release-like build with them is installed and reaches the Shell with the session kept, nothing more. Not checked by the owner with the physical remote; TalkBack not checked.**

`spec-epic-5-retro-a1-a3.md`. Host tests: `__tests__/searchFlow.test.tsx` «Epic 5 retro A1» («Сбросить фильтры» onto a cached, also empty default result: E6 runs again with the default params and the same query, page 1, focus → the field, and a later list change takes no focus; the re-run fails → «Повторить» focused; onto a cached default result with posts: E6 runs again, focus → the first result). `__tests__/subscriptionsFlow.test.tsx` ««Обновить» re-checks «Мой блог» (Epic 5 retro A3)» (no tile, the first own post published: «Обновить» on Главная refetches own E4 page 1 only, no E1/E3, the tile appears on Подписки with no further request; the re-check fails → still no tile, no error; a multi-page empty own list is trimmed to page 1 first → one E4 request without `offset`; a shown tile → no E1/E3/E4; E3 unavailable → E3 only, then the tile; the profile E1 failed → E1 refetched, then the E3/E4 chain and the tile; Подписки never visited → no profile E1, E3 or E4). Each new test failed against the code before the change (checked by reverting the source file), except the two «no request» rows, which guard against over-fetching. Review fixes (host-tested only; the installed build predates them): the outcome frame waits while the awaited list is fetching per the query cache or the render has not reached it (a slow-device race test in `searchFlow` and `authorFlow`, notifications held while the frame fires; both failed without the fix); more A3 cases (E1 without `blogUrl` then a blog, E3 Parse / 503, E4 404 on the first load); the A1 failure case uses a 5xx and asserts the re-run; a reset with no cached default result.

**Live E6 access check (debug build):** the existing debug APK (native unchanged) installed with `adb install -r` over the release-like build (session kept), Metro on host port 8081 (`adb reverse tcp:8081 tcp:8081`). A temporary `__DEV__` probe (`TEMPA2`, mounted by the Shell) picked the target posts from E5 «Все посты» (locked posts) and E5 «Только купленные» (the purchased post). For each target it ran E6 with the longest title word under every access value and logged only counts and booleans. All `TEMPA2` code was removed before the release build (release Hermes bundle: `TEMPA2` 0). Metro was stopped and the reverse mapping removed.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Release Hermes bundle: `search/reset-filters` 1, `TEMPA2` 0, `createDemoSessionManager` 0. Cold start → the Shell (uiautomator). Nothing uninstalled or cleared; no sign-in, no sign-out.

**Host checks (2026-10-29):** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` clean; `npm test` ×3: 98 suites, 1956 tests passed each run; the touched suites (`searchFlow`, `subscriptionsFlow`, `homeFeedFlow`, `src/features/home`) ×30: 5 suites, 291 tests passed in every run.

Not verified on the device: the Поиск «Сбросить фильтры» re-run (it needs a filtered empty result over a cached default one), the «Мой блог» tile appearing after «Обновить» (the owner's account state would have to change), the physical remote, TalkBack.

### Story 5.7 — Search and filters inside an author, 2026-10-29

**Status: implemented and host-tested; the live E4 filter params, E7 and E14 checked on the pinned device (debug build with Metro, a temporary counts-only log, the owner's session, 2026-10-29; results in `docs/api-contract.md` «E4 filters (LIVE)», «E7 (LIVE)», «E14 (LIVE)»). The live check stopped the story once (E4 ignores `only_bought`, E7 ignores both access params); the owner decided A a (no «Только купленные» on Автор) and B a (locked E7 results dropped under «Доступные мне»). Then the Author page was checked on the release-like build by the agent over adb (injected keys, uiautomator, screenshots). Not checked by the owner with the physical remote; TalkBack not checked; an E4/E7/E14 error, a load-more failure and a dropped locked search result were not seen on the device; adb cannot type Cyrillic, so the device queries were Latin and digits («MJTV», «2025»).**

`spec-5-7-search-and-filters-inside-an-author.md`. Host tests: `__tests__/authorFlow.test.tsx` «Story 5.7» (every matrix row: Open (default access params, the action row, no «Сбросить», focus → the first post, the chip focusable only while the row has focus, the row guide), Access values (no «Только купленные» on Автор), Filter («Все посты» refetches behind the sheet with `is_only_allowed=false`, focus stays, Главная's and Поиск's Filters untouched, the old key trimmed, Back → the chip; an E4 error → the page-1 error), Blog tags (E14 once, no E13, no «Загрузить ещё», `tags_ids` on E4, no second E14; an E14 error → «Повторить» → reload), Search (E7 with `blog_url`, the trimmed query and the Filter params, skeleton, focus → the first result, no session check; an error → «Повторить» focused → results), Search access (locked results dropped under «Доступные мне», shown under «Все посты»; an all-locked result list → 3 automatic pages → «Ничего не найдено»), Nothing found (→ the field; with filters → «Сбросить фильтры» focused, OK resets the scope and re-runs the query), the filtered posts empty view, Blank «Готово», Back with a search (cleared, posts, field focused; Back again pops), «Сбросить» (focus → the chip, both cleared), Isolation (the scope dropped on unmount, a reopened author and another author at the default), Return from Post (same query and card, no new E7; a gone card → its neighbour), key isolation, 300 results virtualized with stable row keys, and the resume head refresh with the active Filter while search results are never refreshed). Existing rows updated: E4 URLs now carry `is_only_allowed=true&only_bought=false`; a focused card or action lost to a skeleton or an empty view now goes to the search field (the nearest action above) instead of the sidebar item. Unit tests: `postRepository.test.ts` (`blogPostsPath` access, period, tag and cursor order and encoding, `only_bought` always false; `blogSearchPath` param order and encoding; `blogSearchPage` with the E7 fixture, drop rules, `Parse`), `tagRepository.test.ts` (E14 path, fixture, drop rules with a counts-only log, dedupe, `Parse`), `queryKeys.test.ts` (`authorPosts` per Filter, `blogSearch`, `blogTags`; no collision or prefix match between feed, Поиск, author posts and blog search keys), `filtersStore.test.ts` (the Author scope, its access values, reset and the account wipe), `authorPostsRefresh.test.ts` (the resume refresh rebuilds the Filter from each observed key), `postsHeadRefresh.test.ts`, `subscriptionsFlow` / `postFlow` (keys and URLs with the default Filter), `demoFlow.test.tsx` (the demo E4 params, E7 and E14).

**Live check (debug build):** the existing debug APK installed with `adb install -r` over the release-like build (session kept), Metro on host port 8081 (`adb reverse tcp:8081 tcp:8081`). A temporary `__DEV__` probe (`TEMP57`, mounted by the Shell route) logged per request only keys, types, counts and booleans. All `TEMP57` code was removed (release Hermes bundle: `TEMP57` 0); Metro was stopped; the release-like Story 5.6 build was reinstalled until this story's build.

**Device bug found and fixed (release-like build):** with a long chip label («Фильтры · гитарнаязарядка») the fixed 440 dp field would push «Сбросить» past the content width. The row now has the content width and the field shrinks (down to 160 dp). Re-run: field, chip and «Сбросить» all on screen (screenshot).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Release Hermes bundle: `search/blog/post` 1, `is_only_allowed` 1, `post/tag/` 1, `action/search` 1, `TEMP57` 0, `createDemoSessionManager` 0. Nothing uninstalled or cleared; no sign-in, no sign-out.

**Host checks (2026-10-29, after the review fixes):** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` clean; `npm test` ×3: 98 suites, 1946 tests passed each run; the touched suites (`authorFlow`, `homeFeedFlow`, `searchFlow`, `demoFlow`, `subscriptionsFlow`, `src/features/author`, `src/shared/filters`, `src/shared/entities`, `queryKeys`) ×30: 677 passed in 29 runs; in 1 run a jest worker died with SIGSEGV before `postsHeadRefresh.test.ts` started (no test failed). The review fixes (an outcome with no fetch settles on the next frame, `PERIOD_PRESET_DAYS` in the resume refresh, new trim and no-E14 tests) are host-tested only: the installed release-like build predates them.

**Host checks (2026-10-29):** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` clean; `npm test` ×3: 98 suites, 1944 tests passed each run. The new and touched suites (`authorFlow`, `postFlow`, `subscriptionsFlow`, `demoFlow`, `src/shared/entities`, `queryKeys`, `src/shared/filters`, `src/features/author`) ×30: in a first batch 29 runs reported 572 tests passed and one run 548 passed with no failed test reported (only the `Tests:` line was kept, so a suite that did not start would not show; not explained); a second batch of 30 with full logs: 19 suites, 572 tests passed every run.

| Row | Result | By |
|---|---|---|
| Live E4 / E7 / E14 | See `docs/api-contract.md`: E4 honours `is_only_allowed`, period and tags, ignores `only_bought`; E7 has E6's shape, pages without overlap, honours period and tags, ignores both access params; E14 `data[]{id, title, count}`, one page | agent, adb + logcat (debug build) |
| Open | Подписки → OK on a tile → Автор: the header, the row («В этом блоге», «Поиск в блоге», «Фильтры · Доступные мне»), no «Сбросить», no locked card (the blog has 14 locked posts on page 1), focus on the first (pinned) post (screenshot) | agent, adb + uiautomator + screencap |
| Focus moves | → card 2, ↑ → the field; → the chip; ↓ from the field → the remembered card; ↑ from column 2 → the field; from column 3 after scrolling to row 2 and back: the first ↑ scrolled the list back a few pixels, the next ↑ reached the field (documented in `docs/focus-map.md` D) | agent, adb + uiautomator |
| Filter | Chip → the sheet on «Доступные мне» with only «Доступные мне» and «Все посты» (no «Только купленные»), «Период», «Теги»; ↓ OK «Все посты» → locked cards behind the sheet, focus stayed on the row (screenshot) | agent, adb + uiautomator + screencap |
| Blog tags | «Теги» → the level with the blog's tags (E14), focus on the first; OK on «видеоответы» → checked, the tag «Сбросить» on top, the posts behind narrowed to two (screenshot); Back → «Теги · видеоответы»; Back → the chip «Фильтры. 2 активных фильтра», «Сбросить» shown (screenshot) | agent, adb + uiautomator + screencap |
| «Сбросить» | OK → focus on the chip «Фильтры · Доступные мне», «Сбросить» gone, no locked card | agent, adb + uiautomator |
| Search, nothing found | ← the field, OK → the keyboard (`mInputShown=true`), «MJTV», ENTER → «Ничего не найдено» + «Ищем только в этом блоге…», focus on the field, «Сбросить» shown (screenshot) | agent, adb + uiautomator + screencap |
| Back, search active | Back → the query cleared, the posts again, focus on the field, the route stays | agent, adb + uiautomator |
| Search, results | «2025» + ENTER → 2 results, focus on the first result | agent, adb + uiautomator |
| Return from Post | OK on the result → Пост (an extra injected OK opened the player for a moment; Back closed it, a few seconds of progress may have been saved for that video); Back → Автор with «2025», the same results and the same card focused (screenshot) | agent, adb + uiautomator + screencap |
| Filter with search | «Все посты» while searching → the results refetched (no locked result for «2025» on this blog), chip «Фильтры: Все посты. 1 активный фильтр» | agent, adb + uiautomator |
| Reopen resets | Back (clears the search), Back (pops to Подписки), OK on the same tile → «Поиск в блоге» empty, «Фильтры · Доступные мне», no «Сбросить» | agent, adb + uiautomator |
| Long chip, filtered empty | A tag with no accessible post: «Фильтры · гитарнаязарядка» + 1 and «Сбросить» fit beside the shrunk field; «Ничего не найдено» + «Нет публикаций с такими фильтрами.» + «Сбросить фильтры» (screenshot); ↓ → «Сбросить фильтры», OK → the default posts, focus on the first post | agent, adb + uiautomator + screencap |

Not verified on the device: E4/E7/E14 errors and «Повторить», a load-more failure, a locked search result dropped under «Доступные мне» (no locked match for the Latin/digit queries), the auto-fetch past an all-locked result page, a Cyrillic query typed with the remote, the physical remote, TalkBack. The owner's filters and queries were left at the default (the Author route's Filter is gone with the route).

### Story 5.6 — Search in subscriptions, 2026-10-29

**Status: implemented and host-tested; the live E6 shape and params checked on the pinned device (debug build with Metro, a temporary counts-only log, the owner's session, 2026-10-29; results in `docs/api-contract.md` «E6 (LIVE)»), then the Поиск screen checked on the release-like build by the agent over adb (injected keys, uiautomator, screenshots). Not checked by the owner with the physical remote; TalkBack not checked; an E6 error and a load-more failure were not provoked on the device. adb cannot type Cyrillic, so the device queries were Latin and digits («Mayones», «2025»).**

`spec-5-6-search-in-subscriptions.md`. Host tests: new `__tests__/searchFlow.test.tsx` (every matrix row: Open (field focused, hint, chip, no request, typing alone sends nothing), Submit (E6 with the trimmed `search_query` and the `search` Filter params, skeleton, focus → the first result; the live fixture shape; an E6 error → «Повторить» focused, query kept, retry → results; the user moved away while it loaded → no focus taken), Nothing found (default → the field; filters active → «Сбросить фильтры» focused, OK resets `search` only and re-runs), Blank (hint, no request; also after results), Back (typing without «Готово» sends nothing; Back → `nav/search` → Главная; Back from a result → `nav/search`), the field row and grid guides and the chip's focusability, Filter change (refetch behind the sheet, focus stays, the old key trimmed to page 1; feed tags E13 in the `search` scope), Load more (opaque offset, dedupe, inline «Повторить» → the first new result), Return from Post (sidebar current Поиск, same query, Filter and card, no request; a gone card → its neighbour; every card gone → the field), Sidebar round trip (cache, field focused, no request; AccountScope wipes the query), Same query again (page 1 refetched, list reset; a failure → «Повторить»; another query trims the old list), Key isolation (`feed` vs `search` keys; a `feed` change sends no E6; no session check on an all-locked page), 300 results virtualized with stable row keys). New: `src/features/search/__tests__/searchQueryStore.test.ts`. Updated: `postRepository.test.ts` (`feedSearchPath`: Cyrillic, spaces, `&`, `#`, `=`, `+`, `%`, `/` encoding, param order; `feedSearchPage`: the live fixtures, DTO drop rules with a counts-only log, empty page, errors), `queryKeys.test.ts` (`feedSearch`: query and symbolic Filter, no titles, non-collision with feed, author, post and tag keys), `demoFlow.test.tsx` (the demo E6), `accountScopeRegistry.test.js` (`searchQuery`), and the sidebar lists in `shellFlow`, `subscriptionsFlow`, `codeFlow`, `postFlow`, `authorFlow`, `demoFlow`, `phaseFlags.test.ts` (Поиск is now shown).

**Live E6 check (debug build):** the existing debug APK (native unchanged for JS-only work) installed with `adb install -r` over the release-like build (session kept), Metro on host port 8081 (`adb reverse tcp:8081 tcp:8081`, nothing else was listening). A temporary `__DEV__` probe (`TEMP56`, mounted by the Shell) took the longest word of the newest default E5 post's title as the query and logged, per E6 request, only keys, types, counts and booleans. Results in `docs/api-contract.md` «E6 (LIVE)». All `TEMP56` code was removed before the release build (release Hermes bundle: `TEMP56` 0); Metro was stopped afterwards.

**Device bugs found and fixed (release-like build):**
- ↑ from the third result column did nothing: Android's focus search found the «Фильтры» chip (above that column) and the field row guide never redirected it to the field. Fix: the chip is focusable only while the field row has focus. Re-run: ↑ from column 3 → the field.
- ↓ from the field went to the first card, not the remembered one: a guide band under the text field (Главная's pattern) never won the focus search from the field (the temporary log `TEMP56B` showed its destination set). Fix: the guide wraps the result grid. The first build of that fix showed no results at all: the unstyled guide collapsed the list (as the TV FlatList wrapper in Story 5.5); it now has an explicit box. Re-run: ↓ from the field → the remembered result, ↓ from the chip → the remembered third-column result. `TEMP56B` removed.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Release Hermes bundle: `search/field` 1, `search/feed/post` 1, `search_query` 1, `TEMP56` 0, `createDemoSessionManager` 0. Nothing uninstalled or cleared; no sign-in, no sign-out.

**Host checks (2026-10-29, after the review fixes):** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` clean; `npm test` ×3: 98 suites, 1901 tests passed each run; `searchFlow` + `demoFlow` + `src/features/search` + `postRepository` + `queryKeys` ×30: 112 tests passed each run, 0 failed runs. The review fixes (the pending «Готово»/«Повторить» outcome settles when its fetch ends with the phase unchanged; the resume test) are host-tested only: the installed release-like build predates them.

| Row | Result | By |
|---|---|---|
| Live E6 | See `docs/api-contract.md`: `data.searchPosts[]{post, rank, headline}`, `extra{offset, isLast}`; paging without overlap; period, tags and «Только купленные» honoured with the query | agent, adb + logcat (debug build) |
| Open | ← from a Главная card → `nav/home`, ↓ `nav/search`, OK → focus on `search/field` («Поиск по подпискам», placeholder), the hint, the chip «Фильтры · Доступные мне»; the keyboard not opened (`mInputShown=false`) (screenshot) | agent, adb + uiautomator + screencap |
| Back with keyboard open | OK on the field → the system keyboard (`mInputShown=true`); «Mayones» typed; Back → the keyboard closed, focus on the field, the hint still shown (no search) (screenshot) | agent, adb + uiautomator + screencap |
| Nothing found | OK, ENTER («Готово») with «Mayones» → «Ничего не найдено» + «Проверьте написание или сократите запрос.», no action, focus on the field (screenshot) | agent, adb + screencap |
| Submit | «2025» + «Готово» → the results grid, focus on the first result (screenshot) | agent, adb + uiautomator + screencap |
| Focus moves | → card 2, ↑ → the field; ↓ → card 2 (remembered); → card 3, ↑ → the field; → the chip, ↓ → card 3 (after the fixes above) | agent, adb + uiautomator |
| Return from Post | ↓ / → to a second-row result, OK → Пост with Поиск as the sidebar's current item (screenshot); Back → the same result card focused | agent, adb + uiautomator + screencap |
| Filter change, filtered empty | ↑ field, → chip, OK → the sheet on «Доступные мне»; ↓ ↓ «Только купленные», OK → the results behind refetched, focus stayed on that row; Back → the chip «Фильтры: Только купленные. 1 активный фильтр»; ↓ → «Сбросить фильтры» under «Ничего не найдено» (screenshot); OK → the results again, focus on the first result | agent, adb + uiautomator + screencap |
| Load more | ↓ ×6 through the results: more pages loaded, focus moved row by row (a result from page 2 focused) | agent, adb + uiautomator + screencap |
| Back, sidebar round trip | Back → `nav/search`; ↑ OK «Главная» (the feed with its default Filter); ← ↓ OK «Поиск» → «2025» in the field, the same results (no skeleton), focus on the field (screenshot) | agent, adb + uiautomator + screencap |
| ← from the field | With «2025» in the field, ← ×4 moved the caret (focus stayed on the field), the 5th ← reached `nav/search` (the platform's EditText behaviour) | agent, adb + uiautomator |
| Blank | The field emptied, three spaces, «Готово» → the hint, the results gone, focus on the field (screenshot) | agent, adb + uiautomator + screencap |

Not verified on the device: an E6 error and «Повторить», a load-more failure, a Cyrillic query typed with the remote, the tag level from Поиск, TalkBack, the physical remote. The `search` Filter was left at the default; the submitted query lives in memory only (gone on the next app restart).

### Story 5.5 — Filter by tags, 2026-10-29

**Status: implemented and host-tested; the live E13 shape and E5 `tags_ids` checked on the pinned device (debug build with Metro, a temporary counts-only log, the owner's session, 2026-10-29; results in `docs/api-contract.md` «E13 (LIVE)», «E5 tags (LIVE)»), then the tag level checked on the release-like build by the agent over adb. Not checked by the owner with the physical remote; TalkBack not checked; «Загрузить ещё» and a failed tag page were not seen on the device (this account's 45 tags fit in one page).**

`spec-5-5-filter-by-tags.md`. Host tests: `__tests__/homeFeedFlow.test.tsx` «Story 5.5» (the «Теги · Все» row, no E13 before the level opens; every matrix row: open with the loading row then the check rows and focus on the first, E13 failure → «Повторить» kept while its retry runs, «Тегов нет», toggle (sorted `tags_ids`, one page 1 per change, focus stays, the chip with one title then «Теги: 2», uncheck, Back → «Теги» with the titles → the chip, reopened with the checked tag first and focus on the tag «Сбросить», no second E13 within `staleTime`), toggle with E5 failing (error behind, focus kept), «Загрузить ещё» (opaque offset, dedupe, focus kept, then the first new tag when the row goes), a failed later page → «Повторить» → reload, the tag «Сбросить» (tags only, focus → the first tag), the sheet «Сбросить» (all sections), key stability (A+B = B+A, one E5), 300 tags virtualized with stable keys, the list sized from its box's layout); the Story 5.3–5.4 expectations now include `tags: []` and the «Теги» row. New: `src/shared/filters/__tests__/tags.test.ts` (key normalization, count, store toggles), `src/shared/entities/tag/__tests__/tagRepository.test.ts` (E13 path, DTO drop rules, paging stop, dedupe, errors). Updated: `postRepository.test.ts` (`tags_ids` order, encoding, position), `queryKeys.test.ts` (sorted ids, no titles, `feedTags` root), `filtersStore.test.ts`, `period.test.ts`, `shellPrimitives.test.tsx` / `surfaceRules.test.tsx` (SettingRow `check`).

**Device bug found and fixed (release-like build):** the tag level opened with its title only; the rows existed (one focused) but were not visible. `uiautomator` showed the list's ScrollView 2 px tall: the TV FlatList (`@react-native-tvos/virtualized-lists` `VirtualizedList`) wraps its ScrollView in an unstyled `TVFocusGuideView`, so `flex: 1` on the list never reaches the wrapper and it collapses. Fix: a `flex: 1` box (`filters/tags/box`) measures its height with `onLayout` and passes it to the list as an explicit height. Jest has no layout, so only the device shows it; the host test pins the handover.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r` (session kept); it is the installed build now. Release Hermes bundle: `filters/tags/list` 1, `search/feed/tag` 1, `tags_ids` 1, `createDemoSessionManager` 0, no temporary marker. Before the run: `adb reverse` back to `tcp:8081 tcp:8081`, no Metro on 8097, the app in the foreground. Every OK was sent after reading the focused element (the app started on a «Продолжить просмотр» card; no player was opened).

| Row | Result | By |
|---|---|---|
| Live E13 / E5 `tags_ids` | See `docs/api-contract.md`: 45 tags in one page, ids numbers; E5 intersects the listed tags | agent, adb + logcat (debug build) |
| Sheet → «Теги» | Chip → sheet on «Доступные мне»; ↓ ×4 → «Теги · Все»; OK → the level with 9 visible check rows, focus on the first tag (after the fix) | agent, adb + uiautomator + screencap |
| Toggle | OK on the first tag: checked, the tag «Сбросить» appears on top, focus stays, the chip «Фильтры · <title>» + 1, the feed behind refetched | agent, adb + screencap |
| Scroll to the end | ↓ ×50: the list scrolls, focus stops on the last tag (no footer: `isLast`) | agent, adb + screencap |
| Two tags | A second tag: the chip «Фильтры · Теги: 2» + 1; the feed shows the one post carrying both | agent, adb + screencap |
| Back levels | Tags → the sheet on «Теги» (both titles, two lines) → the chip («Фильтры: Теги: 2. 1 активный фильтр») | agent, adb + uiautomator + screencap |
| Reopen, tag reset | The level opens on the tag «Сбросить» with the two checked tags first; OK → tags cleared, focus → the first tag; Back → «Теги · Все» → the chip «Фильтры: Доступные мне» | agent, adb + uiautomator + screencap |

**After the review fixes (release-like rebuild, 2026-10-29):** the chip label is capped at 360 dp (a long tag title ends in an ellipsis). Check: a custom range 29 сентября 2026 — 29 октября 2026 (the longest 5.4 label): the chip reads it whole (≈ 295 dp), «Обновить» fully in the row (screenshot); filters reset to the default afterwards. A long tag title was not seen (this account's titles are short); the cap is host-reviewed only. The owner also used the physical remote during the run: the tag level, a check and Back behaved as expected.

Not verified on the device: «Загрузить ещё» and a failed tag page (one page live; host-tested and in the demo), an E5 failure under tags, the physical remote, TalkBack (`checkbox` role and `checked` state are host-tested only). The filters were left at the default.

### Story 5.4 — Filter by period, 2026-10-28

**Status: implemented and host-tested; the live E5 period params, the raw ↑/↓ keys of the stepper and the sheet levels checked on the pinned device by the agent over adb (debug build with Metro for the live check and the key measurement, then the release-like build; the owner's session, 2026-10-28). The owner checked the hold-to-step build with the physical remote (2026-10-29): holding ↑/↓ keeps changing the value. TalkBack not checked; an E5 failure under a period was not provoked on the device.**

`spec-5-4-filter-by-period.md`. Host tests: `__tests__/homeFeedFlow.test.tsx` «Story 5.4» (the «Период» row and the list on the current period, only its five rows focusable; matrix «Preset» (one E5 page 1 with `from_ts` = 00:00 of today − 6 and `to_ts` = today 23:59:59, back on «Период», «Сбросить», chip value and count 1 with its a11y, the list reopens on the preset), «Preset» with E5 failing (error view behind, sheet usable, Back → chip), a period change with the Shell's last focus on the sidebar takes no focus out of the sheet (the device bug below), «Custom» (1 авг – 25 сен 2026 through the stepper with raw key ups, no request while stepping, OK on a field → «Готово», E5 bounds, the sheet on «Период» with the range, the list on «Свой период…», the stepper reopens on the range), «Invalid» (hint, «Готово» disabled and not focusable, OK on a field does nothing, no request), «Day clamp» (31 Aug, month ↓ ×6 → 28 Feb), «Back» (stepper → list on «Свой период…», edits discarded; list → sheet on «Период»; sheet → chip), «Two sections» (chip «Фильтры» + 2 and its a11y; «Сбросить» resets both, focus → «Доступные мне»), «Key stability» (one query key as the clock moves), a filtered empty period); the Story 5.3 focusable lists now include `filters/period`. New: `src/shared/filters/__tests__/period.test.ts` (Filter default and count, `periodEquals`, day keys, month lengths and leap years, `periodBounds` for presets, custom ranges, year and month ends, DST, key stability, the ru labels, the stepper field rules), `src/shared/filters/__tests__/PeriodStepper.test.tsx` (`tvEventMock`: key up only, `longUp`/`longDown` as one step, no wrap-around, the entry guard in both device orders, the band and row guides, OK → «Готово», invalid, clamp, the year limits, the listener removed on unmount). Updated: `filtersStore.test.ts` (`setPeriod`, reset of both), `postRepository.test.ts` (period params, `feedPage` reads the clock when it sends), `queryKeys.test.ts` (symbolic period in the key), `demoFlow.test.tsx` (the demo E5 honours `from_ts`/`to_ts`).

**Live E5 check and key measurement (debug build):** the existing debug APK (native unchanged since it was built) installed with `adb install -r` over the release-like build (session kept), Metro on port 8097 via `adb reverse tcp:8081 tcp:8097` (the Metro on host 8081 was not touched; the mapping restored to `tcp:8081 tcp:8081` and the 8097 Metro stopped afterwards). A temporary `__DEV__` log (`TEMP54`) printed per E5 page only the period kind, the post count, whether every post was inside the bounds and whether more pages followed; on the first default page 1 it sent six probe requests around the newest post's publish time and logged counts and booleans only. Results in `docs/api-contract.md` «E5 period (LIVE)»: seconds, both bounds inclusive. The same log printed the stepper's raw key events (event type and key action only) and field focus events; results in `docs/focus-map.md` §1.1: ↑/↓ arrive as key up only, a long press as `longUp`/`longDown` (key down + key up) with no repeats, and the key up of the press that enters a field can reach JS before or after its focus event. All `TEMP54` code was removed before the release build (release Hermes bundle: `TEMP54` 0).

**Device bug found and fixed (debug build):** OK on «Последние 7 дней» closed the list and the sheet came back, but focus ended on the first feed card behind the open sheet. A temporary log showed the Shell's last focus was `nav/home`: when the list (with the focused row) unmounted, native focus fell back to the sidebar for a moment, so Главная's «user has not moved» rule took content focus when the filtered cards arrived. Fix: Главная never takes focus while a modal is open (`mayTakeFocus`). Re-run: focus stays on «Период» for 7, 30 and 90 days and a custom range. Two layout fixes from screenshots: the custom range did not fit beside «Период» (the label shrank to nothing, then the value overflowed); a `SettingRow` with `valueLines` > 1 now puts the value under the label.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`; it is the installed build now. Release Hermes bundle: `filters/period/custom/done` 1, `from_ts` 1, `longUp` 1, `TEMP54` 0, `createDemoSessionManager` 0. The foreground activity was checked first (the screensaver was up; woken with `KEYCODE_WAKEUP`, then `am start`). Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| Live E5 period | Seconds, both bounds inclusive, milliseconds return nothing; every post of 7 / 30 / 90 days and a custom range inside its bounds, paging unchanged (`docs/api-contract.md`) | agent, adb + logcat (debug build) |
| Raw ↑/↓ | Key up only (`eventKeyAction` 1); long press → `longUp`/`longDown` (down + up), no repeats in React Native's events | agent, adb-injected keys + logcat (debug build); **not the physical remote** |
| Hold (owner) | First build: holding ↑/↓ on the physical remote changed the value only once, on release; owner decision 2026-10-28: holding must keep changing it | owner, physical remote |
| Hold-to-step (native `SeekKeys`, second release-like build) | A short ↑ / ↓ → one step each (no double step); `input keyevent --longpress 19` on «С, день» 28 → 30 (the key down and its one injected repeat); `--longpress 20` on «По, день» 28 → 26, focus stays on the field; `--longpress 19` on «Готово» → «С, день», value unchanged (the press is ignored with its repeat). A real hold with many repeats (physical remote) is for the owner: the stepper is left open on the TV | agent, adb + uiautomator (release-like) |
| Sheet and list | Release-like: chip → sheet on «Доступные мне»; ↓ ×3 → «Период · За всё время»; OK → the list on «За всё время» (screenshot); ↓ OK «Последние 7 дней» → the sheet, focus on «Период · Последние 7 дней»; Back → the chip «Фильтры: Последние 7 дней. 1 активный фильтр» | agent, adb + uiautomator + screencap |
| Presets 30 / 90 days | Each: back on «Период» with its name, the feed behind refetched (debug build) | agent, adb + uiautomator |
| Stepper, custom range | Release-like: list on «Последние 7 дней», ↓ ×3 «Свой период…», OK → «С, день: 28» (today − 30); ↓ ×3 → 25; → «С, месяц», ↑ → октябрь; → → «По, день» (through the band); ← back to «С, год» checked in the debug build; OK on a field → «Готово»; OK → the sheet on «Период 25 октября 2026 — 25 октября 2026» (screenshot of the stepper) | agent, adb + uiautomator + screencap |
| Invalid range | «По» day ↓ to 24 (before 25): «Дата «по» раньше даты «с»», «Готово» dimmed; OK on the field: focus stays; ↑ → valid again | agent, adb + screencap |
| ↑ from «Готово» | → «С, день» with the value unchanged (the entry guard); a second ↑ within ≈ 200 ms counted (debug build, `input keyevent 19 19`) | agent, adb + logcat |
| Back levels | Stepper (after an ↑) → list on «Свой период…» with the stored range (edit discarded) → sheet on «Период» → chip | agent, adb + uiautomator (release-like) |
| Two sections, reset | «Все посты» + a custom range: chip «Фильтры» + 2 (a11y «Фильтры. 2 активных фильтра»); «Сбросить» → focus «Доступные мне», chip «Фильтры: Доступные мне» (debug build) | agent, adb + uiautomator + screencap |
| Screenshots | The list and the stepper (`rel-list.png`, `rel-stepper.png`, the agent's scratchpad); the stepper left open on the TV for the owner | agent → owner |
| Hold, physical remote (hold-to-step build) | Holding ↑/↓ on a field keeps changing the value; the step rate is acceptable | owner, physical remote |
| After the review fixes (release-like rebuild, 2026-10-29) | Hint «↑ ↓ меняют значение, ← → переход между полями, OK — готово»; the first ↑ ≈ 2 s after the open stepped 29 → 30 (the 500 ms window itself is host-tested only); «Готово» → «Период 30 сентября 2026 — 29 октября 2026»; Back → the chip «Фильтры · 30 сентября 2026 — 29 октября 2026» + 1 fits on one line, «Обновить» fully visible (screenshots `p-stepper.png`, `p-chip.png`) | agent, adb + uiautomator + screencap |

**Hold fix (after the owner's check):** `SeekKeysModule` forwards D-pad UP/DOWN as well as LEFT/RIGHT (`seekKey` `{key: 'up'|'down', …}`); `PeriodStepper` subscribes while mounted, steps on the native key down and on its repeats (at most every 150 ms) and skips React Native's key up of that press; the Player ignores ↑/↓. Rebuilt (`assembleRelease`, native change), release-like, installed with `adb install -r` (session kept; the foreground activity checked first). Release Hermes bundle: `seekKey` 1, `TEMP54` 0, `createDemoSessionManager` 0. Host: `PeriodStepper.test.tsx` (native key down + repeats, the 150 ms throttle, no double step, the press leaving «Готово» ignored with its repeats, the entry guard, the key-up fallback without the module), `seekKeys.test.ts` (new: the parser with ↑/↓, availability, subscribers), `playerFlow` and `homeFeedFlow` pass.

**Incident:** during the debug run a Fast Refresh reloaded the app between two scripted key sequences, so an OK meant for the chip landed on the first «Продолжить просмотр» card and opened the player for «А Зеленский может мне не сидеть…» for ≈ 15 s before Back. Its local progress moved from «Осталось 110 мин» to «Осталось 109 мин» (and the player may have sent an E9 progress write for that video). Afterwards every scripted OK was sent only after checking the focused element.

Not verified on the device: an E5 failure under a period, the filtered empty view under a period (this account has posts in every preset), a DST change (host-tested), TalkBack (the boxes' `increment` / `decrement` actions are host-tested only). Not host-tested under a non-«За всё время» period either: the resume head refresh, «Обновить» and a page-2 load; they pass the whole Filter through `getFilter('feed')`, `feedRefresh` and `useSubscriptionFeed` (Story 5.3 tests cover them under an access Filter), and only the device run loaded a page 2 under a period.

Host (after the review fixes): lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 1812 passed each; `homeFeedFlow` + `playerFlow` + `src/shared/filters` + `src/shared/ui` + `src/shared/entities/post` + `queryKeys` + `src/shared/platform` ×30: 0 failed runs. Before them: `homeFeedFlow` + `period` + `PeriodStepper` + `filtersStore` + `postRepository` + `queryKeys` + `demoFlow` ×30: 30/30 runs passed (240 tests each).

### Story 5.3 — Filter the feed by access, 2026-10-28

**Status: implemented and host-tested; the live E5 params and the chip/sheet focus moves checked on the pinned device by the agent over adb (debug build with Metro for the live counts, then the release-like build; the owner's session, 2026-10-28). Not checked by the owner with the physical remote; TalkBack not checked; the filtered empty view, the E5 failure behind the sheet and the resume refresh under a Filter were not provoked on the device (host-tested only).**

`spec-5-3-filter-the-feed-by-access.md`. Host tests: `__tests__/homeFeedFlow.test.tsx` «Story 5.3» (every I/O matrix row: Open (chip label and a11y, the sheet, focus on the selected value, only the three values focusable in the modal), Select «Все посты» (one E5 page 1 with `only_allowed=false&only_bought=false`, no focus request, «Сбросить» appears, chip count 1 and its a11y), E5 fails behind the sheet (error view behind, the sheet still usable, Back → the chip), Reset (from the cache, no E5; focus → «Доступные мне»), Back (→ the chip; then Back → `nav/home`), Empty («Ничего не найдено» + «Сбросить фильтры» → the default, focus → the first card; with no cached default the view stays busy, no skeleton; a default that is empty too keeps focus on the action), Account (sign-out → the default), Resume (only the active Filter's page 1; the default cache untouched); «Обновить» with the active Filter; the session check skipped under «Все посты»; the title row (chip then «Обновить», ↓ guides from each, ↑ → the last focused control); a filter skeleton keeps the chip; switching back to a stale Filter sends one E5 page 1; flag off → no chip, the default Filter). Updated: the exact E5 URL (default params) in `homeFeedFlow`, `codeFlow`, `postRepository.test.ts`; the focusable lists in `shellFlow`, `codeFlow`, `demoFlow` (`home/filters`; the demo feed now honours the params, so the locked `demo-post-6` is not in the default feed); the Story 5.1 and 4.7 title-row guide expectations (↑ → the chip until «Обновить» had focus); the empty feed lists the chip. New: `src/shared/filters/__tests__/filtersStore.test.ts`, `src/shared/ui/__tests__/FilterChip.test.tsx` (+ `surfaceRules`), `queryKeys.test.ts` (Filter in the key), `postsHeadRefresh.test.ts` (`trimPostsToFirstPage`), `phaseFlags.test.ts` (`filters`), `accountScopeRegistry.test.js` (`filters`).

**Dependency:** `zustand` 5.0.15 (exact, `package.json` + `package-lock.json`; published 2026-08-13 per `npm view zustand time`; ARCHITECTURE-SPINE pins 5.0.x). Not 5.0.16: published 2026-10-22, less than 14 days before this story. JS only (no native module, no rebuild of the debug APK); used only by `src/shared/filters/filtersStore.ts` (`createStore` + `useStore`).

**Live E5 check (debug build):** the existing debug APK (native unchanged; `zustand` is JS only) installed with `adb install -r` over the release-like build (session kept), Metro on port 8097 via `adb reverse tcp:8081 tcp:8097` (the Metro on host 8081 was not touched; the mapping restored to `tcp:8081 tcp:8081` afterwards and the 8097 Metro stopped). A temporary `__DEV__` log (`TEMP53`) in `PostRepository.feedPage` printed per E5 page only the Filter value, post count, locked count, `isLast` and whether `offset` was present; a second temporary request without access params on every page 1 logged the same counts and how many of its post ids were on the filtered page (a count only). Results in `docs/api-contract.md` «E5 access params (LIVE)». Both were removed before the release build (release Hermes bundle: `TEMP53` 0).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`; it is the installed build now. Release Hermes bundle: `home/filters` 1, `filters/access/` 1, `only_allowed` 1, `TEMP53` 0, `createDemoSessionManager` 0. The foreground activity was checked first (the screensaver was up; woken with `KEYCODE_WAKEUP`, then `am start`). Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| Layout | «Продолжить просмотр», then «Новое в подписках» · «Фильтры · Доступные мне» · «Обновить», then the grid | agent, adb + screencap |
| Open | ↓ to feed column 1, ↑ → `home/filters`; OK → the sheet on the right, focus on «Доступные мне» (selected); ← in the sheet: stays | agent, adb + uiautomator (release-like) |
| Each value | ↓ OK «Все посты»: focus stays on it, «Сбросить» appears, the chip behind reads «Фильтры · Все посты» with the count 1, locked cards («Нет доступа») in the feed; ↓ OK «Только купленные»: focus stays, one card behind | agent, adb + uiautomator + screencap |
| Back → chip | Back: the sheet closes, focus on `home/filters` (a11y «Фильтры: Только купленные. 1 активный фильтр») | agent, adb + uiautomator |
| ← → ↓ ↑ | → from the chip → «Обновить»; → again stays; ← → the chip; ↓ from the chip → the remembered card; ↑ from column 3 → the chip (last control); ↑ from column 2 after «Обновить» → «Обновить»; ← from the chip → `nav/home` | agent, adb + uiautomator (release-like) |
| Reset | Reopen: focus on «Только купленные»; ↓ → «Сбросить», OK → «Сбросить» gone, focus on «Доступные мне»; Back → the chip «Фильтры · Доступные мне» | agent, adb + uiautomator (release-like) |
| Screenshot | The sheet open with «Все посты» selected left on the TV for the owner | agent → owner |

Open risk: the default `only_allowed=true&only_bought=false` was compared with the no-params feed on page 1 of one account only (the owner's); deeper pages and other accounts were not compared.

Not verified on the device: the filtered empty view (this account has one purchased post), an E5 failure behind the sheet, the resume refresh and «Обновить» under a non-default Filter (host-tested), sign-out resetting the Filter, the physical remote, TalkBack.

Host: lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 1752 passed each; `homeFeedFlow` + the new and changed unit suites ×30: 30/30 runs passed (208 tests each: `homeFeedFlow`, `filtersStore`, `FilterChip`, `postsHeadRefresh`, `postRepository`).

### Story 5.2 — My-blog tile in Subscriptions, 2026-10-28

**Status: implemented and host-tested. On the pinned device (release-like build, the owner's session, agent over adb, 2026-10-28) the owner's account showed Подписки without «Мой блог»: the account has no own blog with a post, or one of E1/E3/E4 failed (the release build logs nothing, so the cause was not determined). The tile itself, its label, OK → Автор and Back → the tile were therefore not seen on the device; they are host-tested only. Not checked with the physical remote; TalkBack not checked.**

`spec-5-2-my-blog-tile-in-subscriptions.md`. Host tests: `__tests__/subscriptionsFlow.test.tsx` «Мой блог» (a blog with a post: the first tile `subs/mine`, the tinted label, a11y «Мой блог. {owner}. {title}», initial focus, one profile E1 + E3 + E4 page 1 with `limit=20` and the content profile; the skeleton held until E4 answers; no `blogUrl`, an unsafe `blogUrl`, an empty E4 page 1, E1 404/Parse, E3 404/Parse, E4 404/Parse, E1 Network after the AD-6 retries → no tile, no error; the own blog also a subscription → shown once, first; only the own blog → a one-tile grid, not C3; OK → Автор with no new E3/E4, Back → the same tile; ← from the tile leaves for `nav/subs`; a late tile: the focused author tile is scrolled to its row and focused again (only it), never the skeleton; a late tile with focus on the sidebar moves nothing; focus on «Мой блог» and a refetch with no post → the first tile; the focused own-blog plain tile deduped by an arriving «Мой блог» → «Мой блог», and back to the plain tile when «Мой блог» goes; E1 fails → the grid, then leave and come back → the grid at once, no skeleton, no new E1; flag off → no profile E1, no E3/E4; an account reset clears the `me` query), `src/shared/entities/user/__tests__/userRepository.test.ts` (the E1 DTO: a missing, null, blank, non-string or unsafe `blogUrl` is absent, never a parse failure; the repository's request and errors), `AuthorCard.test.tsx` (the label: `accent-tint` / `accent-text`, a11y order, not focusable; a long owner name is one line with the label, two without; the labelled host-view budget), `queryKeys.test.ts` (`me`), `phaseFlags.test.ts` (`myBlog`). `authorFlow`, `postFlow` now answer E1 without `blogUrl` (they are not about «Мой блог»); `demoFlow`: the demo account owns `demo-blog-2`, so «Мой блог» is first and `demo-blog-2` is not repeated.

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`; it is the installed build now. Release Hermes bundle: `my-blog` 1, `myBlogEnabled` 1, `createDemoSessionManager` 0. The foreground activity was checked first (the screensaver was up; woken with `KEYCODE_WAKEUP`, then the app started with `am start`). Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| Подписки for the owner's account | Without «Мой блог»: the owner's 3 subscriptions, focus on the first tile (as before Story 5.2) | agent, adb + screencap |
| OK → Автор, Back → the tile (a regular tile, regression) | → to tile 2, OK → Автор of that blog; Back → Подписки with focus on tile 2 | agent, adb + screencap |
| «Мой блог» tile, label, OK → Автор, Back → the tile | Not run: no tile for this account | — |
| Screenshot | Подписки (without «Мой блог») left on the TV for the owner | agent → owner |

Host: lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 1712 passed each; `subscriptionsFlow` ×30: 30/30 runs passed (48 tests each). (Before the review fixes; the full verification is re-run after them.)

Resume refresh: while Подписки is mounted, the resume head refresh also refreshes the own blog's E4 page 1 (it observes `authorPosts(ownBlogUrl)`), so a first post published later can bring the tile in (host behaviour; not run on the device).

Owner: the account has no blog with posts, so no tile on the real session is correct. Coordinator demo check (debug build with Metro, `DEMO_MODE` flipped locally and reverted, the owner's keychain session untouched; 2026-10-28): Подписки → «Мой блог» first with the tinted label and the initial focus, «Демо-автор 2» not repeated below; OK → Автор «Демо-автор 2»; Back → focus on «Мой блог». The release-like build was reinstalled afterwards.

Final verification after the review patches (coordinator, 2026-10-28): lint `--max-warnings 0`, typecheck, check:fixtures clean; `npm test` ×3: 1717 passed each; subscriptionsFlow + authorFlow + AuthorCard ×30: 0 failed runs (136 tests each). The review patches were host-tested only (the owner's account shows no tile by design).


### Story 5.1 — Refresh the feed, 2026-10-28

**Status: implemented and host-tested; the focus moves and the busy state checked on the pinned device by the agent over adb (debug build with Metro for one layout fix, then the release-like build; the owner's session, 2026-10-28). Not checked by the owner with the physical remote; TalkBack not checked; the inline error was not provoked on the device.**

`spec-5-1-refresh-the-feed.md`. Host tests: `__tests__/homeFeedFlow.test.tsx` «Story 5.1» (the title row and a11y label, the row guide; press → one E5 page 1 + one E2, «Обновляем…» busy, a second OK ignored, new posts on top with loaded pages kept, no focus request, ↓ guide → the remembered card; a gap → page 1 alone, ↓ → the neighbour by index; nothing remembered → the first card; failure → cards kept, inline error, no full-screen error, logged by kind, the next press succeeds and clears it; Back → `nav/home`; an empty last page 1 → the empty StateView takes focus) and «Story 4.7» (on a Continue card the title row has no destination and the button is not focusable; on the button ↓ → the remembered feed card, ↑ → the row's remembered card), `feedRefresh.test.ts` (`manualRefreshFeed`: no staleness check, one E5 + one E2, single-flight, joins a running resume refresh, failure, no E2 when not cached), `postsHeadRefresh.test.ts` (`force`), `Button.test.tsx` (`busyLabel`, `focusable={false}`); `shellFlow`, `codeFlow`, `demoFlow` now list `home/refresh` among the focusable ids.

**Device lesson:** the first ↓ band under «Обновить» spanned the whole row; on the device ↓ from the button landed on the card below it (column 1), not the remembered card, because Android's focus search weighs the distance between centers. The band now sits right under the button with its width (`docs/focus-map.md` §3, Story 5.1 notes). The first build also let → from the button reach the card to the lower right; the title row now traps → (`trapFocusRight`).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`; the existing debug APK (native unchanged) with Metro on port 8097 via `adb reverse tcp:8081 tcp:8097` for the band fix (a temporary `TEMP51` focus log, removed before the release build; restored to `tcp:8081 tcp:8081` afterwards); then the release-like build again, which is the installed build now. Release Hermes bundle: `home/refresh/down-guide` 1, `TEMP51` 0, `createDemoSessionManager` 0. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| Layout | Cold start (release-like): «Продолжить просмотр» (2 entries), then «Новое в подписках» with the secondary small «Обновить» to its right, then the grid | agent, adb + screencap |
| OK, busy | ↑ to «Обновить», OK: the label reads «Обновляем…» (same width), focus stays on the button, the feed stays; after the reply the label is «Обновить» again and focus is still on the button; one E5 `GET /v1/feed/post/` 200 in the debug log (no E2: Подписки was not opened in that session) | agent, adb + screencap (release-like; the request count from the debug build) |
| ↑ ↓ ← → | Release-like, by the focused view in `uiautomator dump`: ↑ from feed columns 1, 2 and 3 → «Обновить»; ↓ from «Обновить» → the remembered feed card (column 3 and column 2, each after being there); ↑ from «Обновить» → the Continue row's remembered card; ↓ from Continue card 1 → feed column 1 and from card 2 → feed column 2 (the button is skipped); ← from «Обновить» → `nav/home`; → from «Обновить» → stays; → from the sidebar after «Обновить» → the first Continue card (documented: the button is not a zone destination) | agent, adb |

Review fixes (host-tested only, after the device run; not repeated on the device): a press waits for a running page append and refreshes even while a page append has failed; E2 (`exact`) is not awaited; the inline error clears on new feed data or when the grid goes away; grid → offline with focus on the button hands focus to the offline «Повторить»; busy TalkBack label «Обновляем ленту…».

Not verified on the device: a refresh that brings new posts or a gap (the owner's feed had nothing new during the run), the inline error (no way to make E5 fail without touching the network), the E2 refetch (host-tested), a resume refresh at the same time, the grid without the Continue row, the physical remote, TalkBack.

Host: lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 1665 passed each; `homeFeedFlow` ×30: 30/30 runs passed (115 tests each).

Coordinator device re-run after the review patches (release-like, adb, 2026-10-28): → ↓ ↑ reached «Обновить» (focus ring on it), OK → «Обновляем…» at once → «Обновить» again ≈ 3 s later, focus kept on the button, the feed unchanged. Note: the first attempt ran while the TV showed its screensaver, so the keys opened the system «Настройки заставки» (nothing changed; closed with Back) — check the foreground activity before an adb run.


### Story 4.7 — Continue-watching row on the Home screen, 2026-10-28

**Status: implemented and host-tested; the main path checked on the pinned device by the agent over adb (debug build with Metro, then the release-like build; the owner's session, 2026-10-28). Not checked by the owner with the physical remote; TalkBack not checked.**

`spec-4-7-continue-watching-row-on-the-home-screen.md`. Host tests: `__tests__/homeFeedFlow.test.tsx` «Story 4.7» (every matrix row: empty, shown (3 + 1 finished, newest first, focus on the first card, the generic-title rule, «Осталось N мин», the plate), unknown duration, cap 20, open at 12:00 (ids-only params, the engine seeks to 720), return to the same card now first, natural end → the next card / the previous card / the first feed card, reset, the row guide and the column geometry, store reactivity, the preview from the in-memory feed post; both titles and the author empty → «Без названия»; a focused card leaving in the same update as a reorder → its neighbour by id, the guide agrees; a resume refresh with a new head keeps focus on the Continue card; an entry only on disk → initial focus on its card; owner decision 2026-10-28: a locked post (session verified) → the entry dropped, the card gone, focus on its neighbour; E8 404 → the only card dropped, focus on the first feed card; the 4.4 no-access exit after playback drops the entry), `continueEntries.test.tsx` (filter, cap, unknown duration, the hook's stable snapshots and reset), `ContinueCard.test.tsx`, `progressRepository.test.ts` (a preview URL with a query never reaches the disk and is dropped on load; readiness notifies; `forget` drops the entry, memory and disk at once, with no request and no later write of that session; a pre-4.7 disk entry with a query is rewritten at once; a fragment is refused like a query), `playerFlow.test.tsx` «a locked fresh E8 checks the session first» (a seeded entry survives the silent refresh and the offline check, removed only when truly locked), `sessionCheck.test.ts` (a failed or skipped E1 gives `unverified`), `surfaceRules.test.tsx`.

**Preview check (debug build, names only, 2026-10-28):** a temporary `__DEV__` log in the post mapper printed only the query parameter names of the `ok_video` preview URLs of the owner's feed (8 videos): `preview` had **no query** on all 8; the `defaultPreview` fallback had `id,type,idx,scl,tkn` (7) and `id,type,idx,tkn` (1), i.e. a CDN token (`tkn`). Decision (spec «Preview safety»): a preview URL with any query is never written to disk (nor read back from it); it lives in memory only, and the card falls back to the in-memory feed post, else a neutral plate. The log was removed before the commit (release Hermes bundle: `TEMP47` 0).

**Build:** the existing debug APK (no native change since it was built) with Metro on port 8097 via `adb reverse tcp:8081 tcp:8097` (restored to `tcp:8081 tcp:8081` afterwards), installed with `adb install -r`; then `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL, release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`; it is the installed build now. Release Hermes bundle: `home/continue/` 1, `TEMP47` 0, `TEMP-4-7` 0, `createDemoSessionManager` 0, `DevFocus` 0. Nothing uninstalled or cleared; no sign-in, no sign-out.

| Row | Result | By |
|---|---|---|
| Row with real entries | Cold start (release-like): Главная shows «Продолжить просмотр · на этом устройстве» with the owner's 2 entries («Безрисковая доходность и формула Байеса · Осталось 73 мин», «А Зеленский может мне не сидеть и рэп тут не исполнять? · Осталось 110 мин»), previews shown, newest first, focus on the first card; «Новое в подписках» below; the two cards sit exactly on the grid's columns 1 and 2 | agent, adb + screencap |
| ↑ ↓ ← → | → card 2, ↓ → feed column 2, ↑ → card 2; ↓, ← (feed column 1), ↑ → card 2 (the remembered card, not the one above); ← ← → card 1, then the sidebar | agent, adb (debug build) |
| Horizontal row (7 cards) | A temporary in-memory `__DEV__` patch added 5 copies of the real cards (never stored, never opened; removed before the commit): → ×3 scrolled the row by exactly one card (the 3 visible cards still on the grid's columns), ↓ from the third visible card → feed column 3, ↑ → back to it, ← ×3 → the first card with the row back at its start | agent, adb (debug build) |
| OK resumes, Back returns | OK on «Безрисковая доходность и формула Байеса» (owner-approved video, title checked on a screenshot first) → the Player at ≈ 0:20 (its stored position), not 0:00; Back → Главная with focus on the same card (debug build and again on the release-like build at ≈ 0:3x) | agent, adb + screencap |
| SM-3 press count | Cold start (release-like) → ↓ → → (the feed card «Безрисковая доходность и формула Байеса») → OK (Пост, «Продолжить» focused) → OK → playing (`dumpsys audio`: an AudioTrack `state:started`): **4 presses** (≤ 5). The newest feed post would take 3 (↓, OK, OK); without the row (no history) 2. Back after ≈ 5 s (a short visit: nothing written) → Пост → Back → the same feed card | agent, adb |
| Preview query names | See «Preview check» above | agent, adb + logcat (debug build) |

Progress written to the owner's account during the run: only «Безрисковая доходность и формула Байеса» (owner-approved), ≈ 0:20 → ≈ 0:3x by two plays longer than 10 s.

Not verified on the device: a locked or unavailable post opened from a card (host-tested; owner decision 2026-10-28 added after the device run), a natural end from a card (host-tested; it would mark an owner video watched), «Return» with a card that is not first (playing the second, not approved video would write its progress), more than 3 real entries (the 7-card check used in-memory copies), reset by sign-out (host-tested; Story 4.2 covers the AccountScope registration), the physical remote, TalkBack.

Host: lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 1635 passed each; `homeFeedFlow` + `playerFlow` + progress + `ContinueCard` suites ×30: 272/272 each run.

### Story 4.6 — Sleep, background and audio focus, 2026-10-28

`spec-4-6-sleep-background-and-audio-focus.md` (oneshot). Host tests: `__tests__/playerRecoveryFlow.test.tsx` «sleep, background and audio focus (Story 4.6)» (background pauses and writes, the foreground shows the overlay paused with focus on the timeline; audio-focus loss pauses with the progress write; play on a ≥ 23 h old source re-resolves first with one E8 and continues at the same second; a younger source plays at once), `PlayerEngineView.test.tsx` (`onAudioFocusLost` only on a loss). Lint, typecheck, check:fixtures clean; `npm test` ×3: 1610 passed each (after the review patches; also `appLifecycle.test.ts`).

Device (pinned Chromecast with Google TV 4K, release-like build, owner's session, agent via adb, 2026-10-28): playing at ≈ 0:19 → `input keyevent 223` (SLEEP), 6 s, `224` (WAKEUP; wireless adb stayed connected) → the player was paused (play icon), the overlay shown, 0:21 unchanged 6 s later, `dumpsys audio`: no started media player — it did not resume by itself (the Story 1.6 spike did). The video was the newest feed post (the feed head had changed), so the background write stored ≈ 0:21 for that video on the owner's account (not the owner-approved video; reported to the owner). After the review patches (lifecycle pause flag for every phase, audio focus during a hold-scrub, overlay re-shown on return), rebuilt and re-run on the owner-approved video «Безрисковая доходность и формула Байеса» (title checked on a screenshot first): play ≈ 20 s → SLEEP → WAKEUP → paused at 0:20, overlay shown, no started media player, 0:20 unchanged 6 s later. Lesson: the feed head changes; before a device run that plays a video, screenshot the post and check its title (or open the approved post by its author page) before pressing play. Not on the device: audio-focus loss (no way to take focus from adb here), the ≥ 23 h re-resolve, the physical remote.

### Story 4.5 — Finishing a video, 2026-10-28

`spec-4-5-finishing-a-video.md` (oneshot): the engine's end writes the final position, then the Player exits to the Post at once (no autoplay); return focus: the first unfinished MediaRow after the ended one, else the primary (focus-map G «Ended»). «Просмотрено» and leaving the Continue view follow from the 4.2 finished rule. Host tests: `__tests__/playerFlow.test.tsx` «Story 4.5» rows (next unfinished row, a finished next row skipped, the last video → primary, Back still → origin) and the 4.2 rows updated for the automatic exit (the «play after the end» and «replay after the end» rows were removed: the player no longer stays at the end). Device (pinned Chromecast with Google TV 4K, release-like build, owner's session, agent via adb, 2026-10-28; owner-approved: the first feed video is now marked watched on Boosty): «Продолжить» → 100–160 quick → presses on the timeline (accelerated steps, the target clamped to 1:13:29) → the commit reached the end → the Player left by itself (no autoplay) → Пост with «Смотреть» focused (one video: the primary), the row «Просмотрено». A multi-video post (focus on the next row) and the physical remote were not checked. Host: lint, typecheck, check:fixtures clean; `npm test` ×3: 1594 passed each.

### Story 4.4 — Recover from expired links and playback errors, 2026-10-28

**Status: implemented and host-tested; on the device only one start-failure recovery was checked** (agent, adb, debug build with the debug trigger, the owner's session, 2026-10-28: the row below). The other device rows are host-only so far; no «Восстанавливаем воспроизведение…» screenshot went to the owner (in that build the copy showed only ≈ 0.5 s; since the review fix it stays until the recovered source reached its start). A real 24 h signed-URL expiry is not waited for and stays unverified (Story 1.6: the CDN response after expiry was never observed), so the recovery treats every engine error alike.

What it adds: the first engine error starts one automatic recovery («Восстанавливаем воспроизведение…», no action, focus on the surface): one fresh E8 (content profile), the same media id, the same quality key (else the default order; the preference is unchanged), a seek to the current position or the pending start through the start gate; the progress session continues (no `begin`, no E9 for the error, never a new source's t=0). Budget: one automatic recovery per error episode, back after the recovered source played 30 s (`src/features/player/recovery.ts`). A second error or a failed recovery E8 → the error state; «Повторить» continues the same way but plays the default order when a non-`auto` quality had chosen the broken source (in-memory `auto`, the stored value untouched). A locked fresh E8 after playback runs the SessionCheck port, then the Player pops to Пост, whose E8 is invalidated and refetched (its locked notice, focus on the author). No new dependency. Debug-only (`__DEV__`, absent from the release bundle: `__tests__/releaseBundle.test.js` markers `settings/row/break-video`, `boostytv-debug-broken`, `debug: next video source will be broken`): the Настройки row «Сломать следующую ссылку видео» arms a one-shot flag (`src/features/player/debugBreakSource.ts`); the next source resolution the player plays gets its URL corrupted in memory (its host becomes the reserved `boostytv-debug-broken.invalid`, so the engine fails with a network error; an extra path segment did not fail on the device); exactly that one resolution, nothing logged with a URL.

Device rows to run (pinned Chromecast with Google TV 4K, release-like build, the owner's session):

| Check | How | Result | Method |
|---|---|---|---|
| One recovery (start failure) | Debug build (Metro 8097, `adb reverse`): Настройки «Сломать следующую ссылку видео» (`settings/row/break-video`), then «Продолжить» on the first feed video. The broken source uses the reserved host `boostytv-debug-broken.invalid` (an extra path segment was tried first: the CDN still served it, no error) | 2026-10-28: logcat `UnknownHostException` → `[player] playback failed; recovering` → exactly one more E8 GET → a new ExoPlayer; playback continued at the resume point (≈ 19:2x → 19:34 shown), audio on. «Восстанавливаем…» showed only ≈ 0.5 s (during the E8), then the loading spinner — screencaps caught only the spinner | agent, adb + logcat + screencap |
| Second failure → error state, «Повторить» focused | Provoke a second error within 30 s of the recovery | not run | — |
| Screenshot of «Восстанавливаем воспроизведение…» to the owner | After the review patch (the copy stays until the recovered source reaches its start), same debug trigger | 2026-10-28: caught on screencap (spinner + «Восстанавливаем воспроизведение…»); logcat `UnknownHostException` → `recovering` → a new ExoPlayer; playback continued at the resume point (25:13 shown), audio on. Shown to the owner | agent, adb + screencap |
| Back while recovering | Back during the recovery → Пост, focus on the origin row | not run | — |
| No-access exit | Not reproducible with the owner's subscriptions on purpose; host-tested only | not run | — |
| Real 24 h expiry | Not waited for (owner decision, Story 1.6) | unverified | — |

Host tests: `__tests__/playerRecoveryFlow.test.tsx` «recovery (Story 4.4)» (every matrix row: expired URL at 5:12 with the recovering state, one E8 and a seek to 312 over FixtureTransport answering two E8s with different URLs; second error; budget back after 30 s of playback (a seek jump does not count); recovery E8 Network failure then «Повторить»; same quality; quality gone; bad pick 1440p via a second failure and via a failed E8 (default order, in-memory `auto`, stored value unchanged); start failure to the resume point and to 0 for «С начала»; unavailable; no access → Пост with its locked notice and focus on the author, also after «Повторить»; Back while recovering with keys ignored and the exit report; player logs without URL, id or position), plus the Story 4.1–4.3 error tests updated for the automatic recovery (`failPastRecovery`); `src/features/player/__tests__/recovery.test.ts` (target selection, budget); `mediaResolver.test.ts` (the kept-quality pick and fallback, `chosenByQuality`). Lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 1587 passed each (before the docs-only edits); `playerFlow` + `src/features/player` suites 30/30.

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


Host tests: `__tests__/playerFlow.test.tsx` overlay rows (the controls row layout, labels and SVG icons, ±10 s accumulate/commit/clamp, raw and native ← → never seeking on any control) and `__tests__/playerQualityFlow.test.tsx` «quality (Story 4.3)» (every matrix row — open, list, progressive only, auto suffix, pick at 5:12 with no E9 of 0 and the session continuing, stored preference with and without that height, Back order, keys behind the sheet, Menu/Info — plus a pick during a pending seek, a pick before the first `onLoad` and during the initial resume seek (the resume point kept), a pick during a held scrub (resumes), the preference stored only after the picked source loaded (never after a start failure), re-picking the selected row, «Авто» clearing the height and its suffix, a junk stored value, an engine error closing the sheet, no URL in the preference or logs); `src/features/player/__tests__/mediaResolver.test.ts`; `qualityPreference.test.ts`; `seekController.test.ts` (fixed step); `src/shared/platform/__tests__/PlayerEngineView.test.tsx` (`onResolution`); `src/shared/ui/__tests__/icons.test.tsx`; `shellPrimitives.test.tsx` and `surfaceRules.test.tsx` (SettingRow radio). Lint, typecheck, `check:fixtures`, the full suite ×3 and the 30× runs: see the coordinator's final verification for this story (counts not recorded here).

### Epic 3 retro A6 — check the session before showing locked content, 2026-10-27

`spec-epic-3-retro-a6-locked-session-check.md`: the SessionCheck port (`src/shared/api/sessionCheck.ts`, provided by `App`) runs E1 before the player's fresh E8, the Post screen's E8 or Главная's all-locked page 1 is trusted as «locked» (api-contract §7 «Client handling of locked»).

**F5 live check (debug build):** `assembleDebug -PreactNativeArchitectures=armeabi-v7a` installed with `adb install -r` over the release-like build (session kept), Metro on port 8097 via `adb reverse tcp:8081 tcp:8097` (the other Metro on host 8081 was not touched; the mapping was restored to `tcp:8081 tcp:8081` afterwards). A temporary debug-only counter in `PostRepository` logged, per E4/E5 page, only the number of posts with `hasAccess: true` and an empty or missing `data` and their ids. Cold start (`E1 ok`), then ↓ through Главная (37 E5 pages) and the 3 subscribed blogs (23 E4 pages): every page logged 0. The counter was removed before the commit (the release Hermes bundle: `accessEmpty` 0, `TEMP-A6` 0).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (JDK 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`) BUILD SUCCESSFUL; release-like (`zipalign -p 4` + `apksigner`, SDK debug key outside the repo), installed with `adb install -r`; it is the installed build now. Nothing uninstalled or cleared; no sign-in, no sign-out.

Smoke (agent, adb injected keys + uiautomator + screencap, release-like build, owner's session, Chromecast with Google TV 4K): cold start → Главная, focus on the first feed card; OK → Пост («Смотреть» focused), Back → the same card; Подписки → «Илья MJTV Соколов» → Автор (locked cards «Нет доступа» shown, no A11) → OK on a locked post → Пост with the header and «Нет доступа. Этот пост доступен подписчикам уровня …», focus on the author row; 10 s later still there, no A11; Back → the same Автор card → the tile → `nav/subs`. The E1 sent by the check is not visible in a release build (no JS logs); only its absence of effect was observed. The dead-session and silent-refresh paths were not provoked on the device (host-tested only). The silent-refresh path was not run either: the only debug hook (`debugCorruptAccessToken`, Настройки «Проверка обновления сессии») corrupts the in-memory token **and runs E1 at once**, so the refresh happens before a locked post can be opened; reproducing the A6 path would need a SessionManager change, which this spec forbids. Known gap (by design): the session-check window is per trigger point, so a session that dies within 5 min after an `ok` is noticed only after the window or on the next resume E1.

Review fixes (host-tested only, 2026-10-27): a failed or skipped E1 no longer keeps the window; `refetch` goes only to a still-mounted caller; a clock moved back ends the window; the hook catches; a failed post-`ok` E8 refetch keeps «Нет доступа к этому видео»; the player's immediate focus request also requires `isActive()`. New flow tests: page 2 all locked (no E1), page 1 all locked during the cold-start E1 (one shared E1; refetch / A11), focus kept across the silent-refresh feed refetch, a cached locked post within `staleTime` (no E1), the failed player refetch, exact E1 counts in the offline cases.

Host: lint (`--max-warnings 0`), typecheck, check:fixtures clean; `npm test` ×3: 1454 passed each (after the review fixes); `playerFlow`, `postFlow`, `homeFeedFlow`, `authorFlow` + `sessionCheck.test.ts` 30/30. Not checked with the physical remote.

**Story 13.1 follow-up (owner, 2026-11-02): icon-only «На телефоне».** The owner found the wrapped text button too prominent. It is now a 40 × 40 dp secondary button with the QR glyph in the same row; «На телефоне» shows under it only while focused. Release-like build (armeabi-v7a, owner-signed, still 1.2.0 / 10200) installed over the previous story build with `adb install -r`, session kept. On «Философский выпуск по вашим заявкам №2»: «Продолжить · 0:29», «С начала» and the QR button in one row; → → focuses the QR button and the label appears under it (agent, adb + screencap). Test: the hint is absent until focus, then «На телефоне» (`postFlow` «Story 13.1» QR test).

