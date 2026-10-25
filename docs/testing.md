# Testing

## Pinned test device

| Item | Value |
|---|---|
| Device | Chromecast with Google TV 4K (confirmed by owner 2026-10-25) |
| Android TV OS version | Android TV OS 14 (API 34), build `UTTC.250917.004` (`google/sabrina_prod_stable/sabrina:14/UTTC.250917.004/14193937`) |
| Security patch level | 2025-10-01 |
| Android System WebView version | 156.0.8078.47 |
| Remote | Stock Chromecast voice remote (to confirm) |
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
  (peer `react-native: 0.87.1`) resolves to the tvOS fork instead of pulling a
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

### Verification commands

```sh
npm ci && npm run lint && npm run typecheck && npm test
npm run check:fixtures   # sanitization check for src/test/fixtures (Story 1.5)
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
- Open for production: whether a `device_id` mismatch alone rejects a refresh (needs one refresh with a different `device_id` on a session with no prior token reuse, followed by one with the real `device_id`); the real access and refresh token lifetimes.

### Story 1.5 — entitlement, errors and events shapes (in progress), 2026-10-25

**Blocked on sign-in (2026-10-25):** the owner's new sign-in got HTTP 429 `sms_gate_ratelimit` on every first send (18:34, 18:35, 18:42, 18:52). The boosty.to website got the same error, so the limit is server-side (`docs/api-contract.md` §2.2 «Rate limit, longer window»). The spike sign-in screen now shows the 429 details on screen: rate-limit header values, all header names without values, and the `error_description` text when it is safe. The server sent no wait hint. Next: one attempt the next day; no attempts in between.

Branch `spike/1-5-entitlement-errors-events` (throwaway, Story 1.4 spike + `main`). Spike screen «Контент: доступ, ошибки, события» (`src/app/spike/ContentShapesCheck.tsx`, first menu entry) runs the fixed read-only request set from `src/app/spike/contentShapesApi.ts` once: E1 → E2 → E4 (at most 5 subscribed blogs, until an accessible and a locked post are found) → E5 → E3 → E8 accessible/locked (`comments_limit=0&reply_limit=0`) → E15 per chosen blog → E1/E8 without `Authorization` → E8 random post id / E3 random slug → E18 (+ one page only if the response offers `extra.offset`). Budget: at most 30 requests including refreshes. Sanitized fixtures go to the app's external files directory (`SpikeFiles` native module) for `adb pull`.

**Host checks:** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` (13 suites, 156 tests), `npm run check:fixtures` pass. New tests: `contentShapesApi.test.ts` (request paths, picking, analysis lines without values, sanitizer: no input string survives except allowlisted enums, runner order, 5-blog cap, budget stop, no page 2 without a cursor), `ContentShapesCheck.test.tsx` (one run, request count, fixtures written, second run refused, no token/title/URL in console, screen or files) and `__tests__/checkFixtures.test.js` (the real CLI passes clean fixtures and spike sanitizer output; fails on a planted token, `Bearer`, signed URL, query string, phone string and number, email, free-form string, unsafe key, real text content).

**Build:** `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` BUILD SUCCESSFUL; release-like (`zipalign` + `apksigner`, SDK debug key outside the repo) installed on the pinned device. The screen opens and reads the store without a request: **signed-out** (expected after the Story 1.4 logout).

**Device run: not done yet.** It needs the owner to sign in on «Вход по телефону» (SMS code). Pending: one run, `adb pull` of the fixtures to `src/test/fixtures/boosty/`, deletion on the device, logcat scan, and the `LIVE` results in `docs/api-contract.md` §3/§4/§7/§8.

`device_id` / refresh-token reuse re-test: closed as not needed for production (owner decision 2026-10-25; no requests), see api-contract §2.3.

