---
title: 'Story 9.2: Update notice and in-app install from GitHub Releases'
type: 'feature'
created: '2026-11-01'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ada2bd3e69f1e4455ff95c8485a7d331fd090487'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/docs/release.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The family TV cannot tell when a newer release exists on GitHub Releases, and an update needs a computer and adb (FR-56, UPD-01/02).

**Approach:** An anonymous `UpdateChecker` reads `releases/latest` of `dzmitryafanasenka/boosty-tv` on start and on return to the foreground (≤ 1 per day), and on a single OK on «Версия» (≤ 1 per 60 s). A newer tag shows a passive plaque and a «Версия» hint. OK on the row opens a dialog with the Russian changelog and «Скачать и установить». After that explicit OK, the app downloads the release APK for the device ABI, verifies its SHA-256 against GitHub's asset digest, and hands it to the Android system installer. The QR to the release page is the fallback.

## Boundaries & Constraints

**Always:**
- Owner decisions 2026-11-01:
  - In-app download and install replaces "no in-app install". This reverses PRD FR-55/FR-56 "nothing is downloaded or installed", AD-16 and feature-parity §12 Q3 / UPD-02. It is never silent: it starts only from «Скачать и установить», and the Android installer asks for confirmation.
  - One story.
  - The QR to the release page stays as the fallback: shown in the dialog when there is no usable asset or digest, or after a failed download, verification or install.
  - Releases attach one APK per ABI (`boosty-tv-{v}-{abi}.apk`) plus the universal `boosty-tv-{v}.apk`, all signed with the release key and with the same `versionCode`. The device picks the first `Build.SUPPORTED_ABIS` entry that has an asset, else the universal one.
  - An automatic check that finds a newer version shows a non-focusable plaque for about 10 s («Доступна версия X.Y.Z · Настройки → Версия»), on every daily check while it is newer. It never takes focus, and it is not shown while Player is on top.
  - «Версия» reads «0.9.0 · доступна X.Y.Z» while a newer release is known. OK opens the dialog: the title, the changelog, «Скачать и установить», «Закрыть». Back closes it, and focus returns to «Версия».
  - A manual check with no newer version, or a failed check, shows nothing.
- The check is a plain GET to the fixed URL with only GitHub `Accept` / API-version headers. It sends no Boosty auth, cookies, account data or identifiers, makes no retries and has a bounded timeout. A check failure writes exactly one logger entry with literal non-secret field keys. Tags are `vX.Y.Z` compared numerically with `getVersionName()`; anything unparsable means not newer. The changelog is the body before the first line `---`, as capped plain text.
- Install path:
  - Download only `browser_download_url` values under `https://github.com/dzmitryafanasenka/boosty-tv/releases/download/`, over HTTPS. Redirects to GitHub's asset CDN are allowed. Store into an app-private cache dir.
  - The asset must have a `sha256:` digest. A mismatch deletes the file and installs nothing.
  - Show progress. Back cancels the download and deletes the file. Only one download runs at a time. Old update files are deleted on the next start.
  - If installs from this app are not allowed (`canRequestPackageInstalls`), explain this in the dialog and open the system «Установка неизвестных приложений» screen for this package (verified on the device: `ExternalSourcesActivity`). On return, continue from the same state.
  - Launch `ACTION_INSTALL_PACKAGE` (verified: `com.google.android.packageinstaller`) with a `FileProvider` content URI.
  - The URL, the file path and the digest values are never logged in full. The download and install log status and reason fields only.
- Off in demo mode (no request, no download). Behind a new phase flag `updateCheck`. The last check time and the last newer release persist as a device-scoped preference and are dropped once the installed version is equal or higher.
- The 7-press Diagnostics gesture triggers at most one check (`useVersionPresses` `onFirstPress`).

**Never:**
- No download without the explicit «Скачать и установить» OK.
- No silent or background install, no `PackageInstaller` session API, no auto-retry of a failed download or install.
- No BoostBuddy repository, no other host.
- No Boosty `httpClient` per-attempt logging for GitHub requests (Epic 8 retro X7: the checker logs its own fixed label).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Newer on start | latest `v0.9.1` > installed, last check > 24 h | plaque, row hint, stored | N/A |
| Within a day / same | last check < 24 h / latest = installed | no request / nothing shown | N/A |
| Manual OK | no newer known; ≥ 60 s since last manual check | one request; newer → dialog | failure → nothing |
| Gesture | presses 2–7, or < 60 s | no request | N/A |
| Install, allowed | per-ABI asset + digest | progress → verify → system installer | N/A |
| ABI fallback | no asset for any supported ABI | the universal APK | none → QR |
| No digest / foreign URL | asset lacks `sha256:` or is off-repo | no download | QR fallback |
| Not allowed | `canRequestPackageInstalls` false | explanation → system settings → resume on return | still false → stays, QR |
| Digest mismatch | bytes differ | file deleted, error text | QR fallback, one log entry |
| Cancel | Back during download | download stops, file deleted, dialog stays | N/A |
| Network loss | during download | error text, file deleted | QR fallback |
| Installer cancelled | user declines | back in the dialog | QR fallback |
| Demo / Player on top | — | no request / no plaque | N/A |

</frozen-after-approval>

## Code Map

- `src/features/settings/useVersionPresses.ts:30,60` -- `onFirstPress` fires once per series; the 60 s throttle belongs to the caller. `SettingsScreen.tsx:91` passes only `onOpenDiagnostics`; the «Версия» row is ≈l.129.
- `src/app/App.tsx:265,271,291` (`ShellRoute`, `useModal()`) → `Shell.tsx` 45/358/402/442 → `SettingsSection` 496. Keep `Shell.tsx` thin. Start effect `App.tsx:373`; `DemoBadge` ≈l.309 is the non-focusable overlay pattern.
- `src/shared/api/transport.ts:19,25,28` -- `Transport` / `fetchTransport` / `parseJson` for the JSON check (not `httpClient`).
- `src/shared/services/logger.ts:31,132` and `__tests__/loggerFieldKeys.test.js` -- literal field keys; never `versionCode`.
- `src/shared/storage/devicePreference.ts:76` -- device-scoped store; `src/shared/platform/appLifecycle.ts:15,34`; `src/app/phaseFlags.ts:46`; `src/app/session.ts:24` `DEMO_ACTIVE`.
- `src/shared/ui/QrDialog.tsx:37`, `Dialog.tsx:41`, `src/shared/focus/ModalHost.tsx:46` -- reuse the QR rendering for the fallback inside a feature `UpdateDialog`; existing callers unchanged.
- `src/shared/platform/appInfo.ts:11`; Kotlin modules beside `android/.../AppInfoModule.kt`, `ExternalPlayerModule.kt`, `LogFileModule.kt` (the port pattern: JS port in `src/shared/platform/`, module + package registration).
- `android/app/src/main/AndroidManifest.xml` -- add `REQUEST_INSTALL_PACKAGES`, a `FileProvider` (`res/xml` paths limited to the update cache dir). `android/app/build.gradle` -- `splits.abi` with `universalApk true`; the same `versionCode` for every split.
- `docs/release.md` -- the per-ABI asset names and publish command. `src/test/flow.tsx:434,441` -- `installFixtureTransport`, `installNativeModules`.
- Device probe (2026-11-01, API 34, read-only): `MANAGE_UNKNOWN_APP_SOURCES` with `package:` resolves to `com.android.tv.settings/.device.apps.specialaccess.ExternalSourcesActivity`; `INSTALL_PACKAGE` to `com.google.android.packageinstaller/...InstallStart`; `VIEW` + apk MIME → the resolver (do not use); `REQUEST_INSTALL_PACKAGES` not granted; `/data` 875 MB free. GitHub release assets carry `digest: "sha256:…"` (verified on v0.9.0).

## Tasks & Acceptance

**Execution:**
- [x] `src/features/update/{version,releaseInfo}.ts` -- tag compare; Zod release shape (`tag_name`, `html_url`, `body`, `assets[].name/browser_download_url/digest/size`); RU notes; asset pick by ABI; URL and digest rules
- [x] `src/features/update/updateChecker.ts`, `updateStore.ts` + hook -- gates (persisted daily, 60 s in memory), one log entry, demo and flag off, known-release state
- [x] `src/shared/platform/appUpdater.ts` + `android/.../AppUpdaterModule.kt` (+ package) -- `supportedAbis()`, `canRequestInstalls()`, `openInstallSettings()`, `download(url, sha256, size)` with progress events, cancel and cache cleanup, `install(fileRef)` -- the native port
- [x] Manifest, `res/xml/update_file_paths.xml`, `build.gradle` splits -- permission, FileProvider, per-ABI APKs
- [x] `src/features/update/UpdatePlaque.tsx`, `UpdateDialog.tsx` -- tokens only; dialog states: info, permission needed, downloading (progress, Back cancels), verifying, installer launched, failed + QR
- [x] `App.tsx` / `Shell.tsx` / `SettingsScreen.tsx`, `phaseFlags.ts`, `ru.ts` -- triggers, `onFirstPress`, row text and a11y label, strings
- [x] Tests -- unit for every matrix row and the request headers; native port mocked in flow tests: plaque not focusable, row hint, dialog states, Back order, gesture ≤ 1 request, demo no request
- [x] Docs -- `docs/release.md` (per-ABI assets), PRD FR-55/56, `epics.md` 9.2, ARCHITECTURE-SPINE AD-16, `docs/feature-parity.md` (§12 decision, UPD-01/02, SET-06), `docs/focus-map.md`, `docs/testing.md` «Story 9.2»
- [x] Device -- temporary uncommitted build `versionName "0.8.0"`, `versionCode 900`: plaque, hint, dialog, the first-time permission screen, download of the v0.9.0 universal APK (fallback path), digest, system installer with the remote → real 0.9.0 installed, session kept

**Acceptance Criteria:**
- Given any check or download, when its requests are inspected, then only the fixed GitHub API URL and repo asset URLs are fetched, with no Boosty headers, cookies or account data.
- Given the plaque is visible, when the D-pad is used, then focus behaves as if it were absent.
- Given the installer was launched and the update succeeded, when the app starts, then the session is kept and «Версия» shows the new version.

## Implementation Notes

- The checker lives in `src/features/update/` and is wired in `src/app/update.ts` over `fetchTransport` (not `HttpClient`): no Boosty auth, no `http` per-attempt log line (X7). `enabled` is read per call (`phaseFlags.updateCheck && !DEMO_ACTIVE`).
- An installed `versionName` that does not parse as `X.Y.Z` sends no request (nothing could be newer). Jest flow suites install `versionName: '1.0'`, so only `updateFlow` reaches GitHub.
- Every automatic attempt (success or failure) sets the persisted `lastCheckAt`, so a failing GitHub never gets more than one automatic request per day. A clock moved back (stored time in the future) does not block the check.
- The dialog's initial focus is «Закрыть» (the safe choice), so quick OK presses on «Версия» never start a download. With a known release the first OK opens the dialog and the next one closes it; the Diagnostics gesture then needs eight presses in total (`docs/focus-map.md` §5).
- The native module keeps one file, `cacheDir/updates/update.apk`; `fileRef` is its name only. `install` resolves from the installer's activity result (`EXTRA_RETURN_RESULT`): `cancelled` / `failed` / `installed`.
- `splits.abi` is on for every build type (debug too): debug outputs are now `app-<abi>-debug.apk` and `app-universal-debug.apk`; the RN CLI picks the device's split. CI checks the universal unsigned release and the x86_64 split's `versionCode`.
- `QrDialog`'s code box is now the exported `QrCodeBox` (same rendering), reused by `UpdateDialog`; `SettingRow` takes an optional `accessibilityLabel`.

- 2026-11-01 device run: temporary 0.8.0/900 build → plaque, row hint, dialog (agent via adb); permission screen, universal download, digest, system installer → 0.9.0 installed, session kept (owner, physical remote). `build.gradle` restored after the temporary build.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | blind | `download` resolves before `finally` clears `running`; `install` fails while `running` | high | Verified in `AppUpdaterModule.kt` (resolve in `try`, `running.set(false)` in `finally`, `install` checks `running.get()`). Patch |
| 2 | edge | Permission denied → «Открыть настройки» removed, focus target unchanged, D-pad dead | high | Verified: `focusTargetOf` → `'settings'`; button only when `!denied`; «Закрыть» preferred only for `close`. Patch: keep the button in both states |
| 3 | blind / edge | Double OK starts two downloads; unmount during `canRequestInstalls` starts an orphan download; close in `failed` leaves a running download | medium | Verified: guard before the await. Patch |
| 4 | edge / blind (other) | Cancel in `verifying` still launches the installer | medium | Native last `cancelled` check precedes the digest; JS installs on `done`. Patch (JS ref + native check) |
| 5 | blind | Cancel not prompt on a stalled connection; Back swallowed while `downloading` | medium | `cancelled` only between reads; timeouts 15/30 s. Patch: disconnect on cancel, check before redirects |
| 6 | blind | `installed` outcome leaves the dialog on «Открыт установщик…» | low | Verified (`if (outcome === 'installed') return`). Patch: close |
| 7 | edge | `canRequestInstalls` rejection shown as missing permission | low | Port maps a rejection to `false`. Patch |
| 8 | blind | Manual check dropped while an auto check is in flight | medium | Verified `inFlight` early return. Patch: await the in-flight result |
| 9 | blind | Redirect allowlist `*.githubusercontent.com` broader than release assets | low | Digest limits impact; exact hosts are a direct correction. Patch |
| 10 | blind | Plaque shown on sign-in/expired routes where Настройки is unreachable | low | Host mounted whenever `boot`; only Player suppressed. Patch |
| 11 | verification-gap | Foreground check, Player suppression, startup cleanup, Back-in-modal-host untested at App level | medium | Verified: no flow test drives AppState/Player/cleanup/Back during download. Patch: flow tests |
| 12 | verification-gap / blind | Native download/verify/redirect logic only source-grepped | medium | No JVM test setup; the Device task executes it once. Deferred (JVM test) — the device run must pass before done |
| 13 | blind / edge | `docs/testing.md` names pre-split APK files | medium | Verified lines 235-244, 337-341. Patch |
| 14 | blind | `appArchitectures()` placed under the 9.1 signing comment; duplicated ABI default | low | Verified. Patch |
| 15 | blind | Docs overclaim SHA-256 as authenticity | low | Digest comes from the same unauthenticated response; authenticity is Android's same-key rule. Patch: one sentence |
| 16 | blind | Docs describe UPD-02 as current while the device row is pending | low | Patch: mark host-tested, device pending; updated after the device run |
| 17 | edge | ABI not among assets → universal | false | Handled by the fallback (reviewer confirmed) |
| 18 | impl report | `sessionManager.test.ts` failed once in 3 full runs | maybe-false | File untouched by 9.2; passed 30/30 alone. Deferred (full-suite ×10 would settle) |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- all green
- `(cd android && ./gradlew assembleRelease)` -- the per-ABI and universal APKs exist, are signed, and share `versionCode`

**Manual checks:**
- The device row above with the physical remote for the installer screens (owner), and the agent over adb for the rest.
