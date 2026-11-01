# Epic 9 Context: Ready for the family (P3)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the Android build into something the family can run every evening and the owner can retire BoostBuddy for (FR55, FR56, NFR5). The signed release and the update path are done: releases 0.9.0 and 0.9.1 are published on the public repository's GitHub Releases, and the TV checks for a newer release and, after an explicit OK, downloads and installs it through the Android system installer. What remains is to measure and fix performance, visual fidelity and accessibility on the pinned Chromecast with Google TV 4K, then run a full real-device regression that ends in the owner's explicit acceptance of the Android release. That acceptance starts the switch-over and session-longevity observation periods.

## Stories

- Story 9.1: Signed release on GitHub Releases (done)
- Story 9.2: Update notice and in-app install from GitHub Releases (done)
- Story 9.3: Performance on the device
- Story 9.4: Visual fidelity and accessibility pass
- Story 9.5: Full device regression and owner acceptance

## Requirements & Constraints

- **Owner decisions (2026-11-01):**
  - «Boosty TV» is approved as the final app name. The neutral TV banner and adaptive icon carry no Boosty marks.
  - The release keystore lives outside the repository. Its passwords live only in `~/.gradle/gradle.properties` and never enter agent context (do not read, print or log them).
  - The one-time uninstall to switch from the SDK debug key to the release key is done. Installs over a previous release with the same key keep the session.
  - In-app update download and install is allowed (reverses the earlier "nothing is downloaded or installed" rule), only after an explicit OK and the system installer's confirmation. Never silent, no PackageInstaller session, no automatic retry. The QR to the release page stays as the fallback.
- **Release state:** each release attaches one APK per ABI plus the universal APK, all with the same `versionCode`, tagged `v{versionName}`. The repository and releases stay free of secrets, keystores, account data, unsanitized fixtures and signed URLs; the CI fixture check must pass. Publishing needs the owner's explicit OK.
- **Performance (9.3):**
  - No visible frame drops or focus lag with 300+ fixture feed posts, 55 authors and real data, with the D-pad held and in single steps.
  - Time to first frame from a post and from «Продолжить» meets the target, or the owner accepts a documented exception. No numeric target has been recorded yet; the spike measured TTFF of roughly 0.9–2.5 s (HLS) and 1.0–1.6 s (MP4/DASH). Propose a target to the owner.
  - No steady memory growth over a 1-hour browse-and-watch session (images, players, listeners).
  - Method and numbers go in `docs/testing.md`.
- **Fidelity and accessibility (9.4):**
  - Every screen compared to the mocks and DESIGN.md at 1080p and 720p; deviations fixed, or listed and accepted.
  - Components use tokens only, with no raw colors or sizes.
  - All contrast pairs meet their targets, including focused rows and the LIVE badge.
  - Every focusable element announces a meaningful Russian TalkBack label.
  - Each screen matches `docs/focus-map.md`. Changing the doc instead of the code needs owner approval.
- **Regression (9.5):**
  - Run the CLAUDE.md device checklist on the Chromecast with the release build; record in `docs/testing.md`.
  - Walk UJ-0 to UJ-7 with the remote only (SM-5). UJ-1 must take 5 presses or fewer (SM-3), without autoplay shortcuts.
  - Keep physical-device results separate from emulator or mock results. Never report agent-over-adb runs as physical-remote checks.
  - The epic ends with the owner's explicit acceptance, which starts SM-1 (4 weeks without BoostBuddy) and SM-2 (session longevity).

## Technical Decisions

- **Builds and signing:** release builds are signed by Gradle with the owner's key; CI only lints, typechecks, tests and builds debug, and never signs. Debug builds use the SDK debug key and cannot install over the family build. Agent device builds are therefore `assembleRelease` with the owner's key (a branch build replaces the family build until the next release is installed). The release build fails if the demo flag is on.
- **Update path (shipped):** `UpdateChecker` lives in `features/update`, wired in `app/update.ts` over `fetchTransport` (never `HttpClient`, so no Boosty auth or `http` log line reaches GitHub). The `AppUpdater` port (`shared/platform/appUpdater.ts`, native module) downloads only this repository's assets into `cacheDir/updates/`, verifies GitHub's SHA-256 digest and launches the system installer. Phase flag `updateCheck`, off in the demo. Changes in 9.3–9.5 must not regress this path.
- **Lists:** FlashList 2.3.3 is adopted for the grids (ADR 0011) and reused by later lists. Any further list change for performance needs profiling evidence and an ADR.
- **Logging:** structured logger fields, not values in message text; the `loggerFieldKeys` source-scan test covers new logger call sites. Redact signed URLs and personal data.
- **Hardening stays:** `allowBackup=false`, no cleartext traffic, default TLS validation.
- **Copy:** Russian strings in `ru` (i18n-ready); code and docs in English.

## UX & Interaction Patterns

- One clear focus target; focus scaling must not reflow layouts or clip rings. Deterministic initial focus and stable focus during refetch, pagination and image loading.
- Back closes the top overlay first (update dialog, QrDialog, settings) and returns focus to the initiator; no focus behind modals.
- The update plaque is non-focusable and never shows over the Player. Technical errors appear only in Diagnostics, never in family-facing UI.

## Cross-Story Dependencies

- 9.3 builds on the Story 1.6 TTFF baseline and the Story 3.1 FlashList adoption. Device measurements need a release-signed build installed over the family build.
- 9.4 and 9.5 feed fixes back into earlier epics' screens. 9.4's focus-map and TalkBack pass should land before 9.5 so the regression runs on the final UI.
- 9.5 runs on a published release build (the next one after 0.9.1); it should also exercise the in-app update from the previous release, including the per-ABI asset path, which has not yet run on the device.
- Open owner device passes from earlier retros (second account, physical-remote passes, live at 1×, chooser with 2+ players) overlap with the 9.5 checklist and can be closed there.
