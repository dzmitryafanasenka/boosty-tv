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
| Launch from the Google TV home-screen tile with the physical remote | _Pending: owner check_ |
| Staged files (`git add -A -n`) | No keystore, `.env`, `local.properties`, APK or build output |

Per-scenario results for `docs/android-tv-auth-playback-spike.md` go here. Physical-device and emulator results are labeled separately.
