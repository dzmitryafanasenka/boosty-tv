# Epic 9 Context: Ready for the family (P3)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the Android build into something the family can run every evening and the owner can retire BoostBuddy for (FR55, FR56, NFR5). The owner builds and signs a release APK locally and publishes it as a GitHub Release of the public repository. The TV tells the owner when a newer release exists, without downloading or installing anything. Performance, visual fidelity and accessibility are measured and fixed on the pinned Chromecast with Google TV 4K. A full real-device regression ends in the owner's explicit acceptance of the Android release. That acceptance starts the switch-over and session-longevity observation periods.

## Stories

- Story 9.1: Signed release on GitHub Releases
- Story 9.2: Update notice from GitHub Releases
- Story 9.3: Performance on the device
- Story 9.4: Visual fidelity and accessibility pass
- Story 9.5: Full device regression and owner acceptance

## Requirements & Constraints

- **Owner decisions (2026-11-01):**
  - The app name «Boosty TV» is approved as final.
  - The agent draws a new neutral TV banner and adaptive icon. No Boosty marks.
  - The owner creates the release keystore outside the repository. Its passwords live only in `~/.gradle/gradle.properties` and never enter agent context (do not read, print or log them).
  - A one-time uninstall on the TV is approved, to switch from the SDK debug signing key to the release key. After that, an install over a previous release signed with the same key must keep the session.
- **Release (9.1):**
  - The documented local release build produces a signed APK with incremented `versionName` and `versionCode`.
  - The build fails if the demo flag is on.
  - The APK appears in the Google TV launcher with the final banner and icon, runs without touch and declares no mandatory touchscreen.
  - The release is tagged `v{versionName}`, with the APK and a changelog attached.
  - The repository is public. The repository and the release must contain no secrets, keystore, real account data, unsanitized fixtures or signed URLs. The CI fixture check must pass.
- **Update check (9.2):**
  - Checks run on app start (at most once per day) and on OK on «Версия» (at most once per 60 s). The 7-press Diagnostics gesture never triggers more than one check, and a notice must not interrupt it.
  - It fetches the latest release of the configured public repository with a plain anonymous GET. No account data, identifiers or Boosty auth. GitHub allows 60 unauthenticated requests per hour per IP.
  - It compares the latest tag semantically against `versionName`. The tag format must match that comparison.
  - If the tag is newer, it shows a non-blocking notice with the version, the changelog and a QR to the release page. Nothing is downloaded or installed (in-app install stays excluded).
  - Failures and rate limits are silent to the user and write one diagnostics log entry.
  - Never use BoostBuddy's GitHub repository.
- **Performance (9.3):**
  - No visible frame drops or focus lag with 300+ fixture feed posts, 55 authors and real data, with the D-pad held and in single steps.
  - Time to first frame (from a post and from «Продолжить») meets the post-spike target, or the owner accepts a documented exception.
  - No steady memory growth over a 1-hour session.
  - The method and the numbers go in `docs/testing.md`.
- **Fidelity and accessibility (9.4):**
  - Every screen is compared to the mocks and DESIGN.md at 1080p and 720p. Deviations are fixed, or listed and accepted.
  - Components use tokens only, with no raw colors or sizes.
  - All contrast pairs meet their targets, including focused rows and the LIVE badge.
  - Every focusable element has a meaningful Russian TalkBack label.
  - Each screen matches `docs/focus-map.md`. Changing the doc instead of the code needs owner approval.
- **Regression (9.5):**
  - Run the CLAUDE.md device checklist on the Chromecast with the release build.
  - Walk UJ-0 to UJ-7 with the remote only. UJ-1 must take 5 presses or fewer.
  - Keep physical-device results separate from emulator or mock results. Never report agent-over-adb runs as physical-remote checks.
  - The epic ends with the owner's explicit acceptance.

## Technical Decisions

- **Release and signing (AD-16):**
  - CI (GitHub Actions) runs only lint, typecheck, tests and the debug build. It never signs.
  - The owner signs locally and attaches the APK to the tagged GitHub Release.
- **Demo flag (AD-15):** the single `FixtureTransport` serves demo mode and tests. The release build must fail if the demo flag is on.
- **UpdateChecker (AD-16, AD-11, AD-14):**
  - It is a `shared/services` singleton with its own unauthenticated client. Boosty `Authorization` is attached only to `api.boosty.to` and never to GitHub.
  - Endpoint: `GET https://api.github.com/repos/<owner>/<repo>/releases/latest`.
- **Epic 8 retro carry-overs:**
  - Bind the «Версия» press to `useVersionPresses.onFirstPress`. It runs once per press series, so the gesture can trigger at most one check.
  - Log `versionCode`, tag and status as logger fields, not in the message text. Free-text redaction still blanks `code=` / `*_code=` patterns.
  - X7: `logPath` in `src/shared/api/transport.ts` assumes a Boosty path and drops the host, so a GitHub request through `httpClient` would log as `/<seg>/<seg>/…`. Decide it when the update check picks its HTTP path: either a separate client that logs its own fixed label, or a host-aware `logPath`.
  - The `loggerFieldKeys` source-scan test covers every new logger call site.
- **Phase gating (AD-20):** the update notice and the start-up check sit behind a flag in `app/phaseFlags.ts`. No screen hard-codes the phase.
- **Lists:** FlashList 2.3.3 is already adopted for the grids (ADR 0011), and later lists reuse it. Any further list change for performance needs profiling evidence and an ADR.
- **Hardening stays:** `allowBackup=false`, no cleartext traffic, default TLS validation.
- **Copy:** Russian strings go in `ru` (i18n-ready). Code and docs are in English.

## UX & Interaction Patterns

- **Update notice:**
  - It is non-blocking and never steals focus from the family's current task.
  - The QR to the release page reuses the existing QrDialog: it traps focus, «Закрыть» or Back closes it, and focus returns to the initiator. The QR is generated on the device and the URL is not printed in full or logged.
- **«Версия» row:**
  - A single OK triggers the check. Seven quick presses (each less than 2 s after the previous one) still open Diagnostics.
  - Back from Diagnostics returns to Настройки with focus on «Версия».
- **Errors:** technical errors appear only in Diagnostics, never in the family-facing UI.

## Cross-Story Dependencies

- 9.1 comes first. It provides the signed release, the `v{versionName}` tag format and the GitHub Release that 9.2 checks against. 9.5 runs on that release build.
- 9.2 depends on the Epic 8 «Версия» press handling (`useVersionPresses`) and the redacting Logger. `Shell.tsx` (about 510 lines) is expected to host the start-up wiring; keep it thin.
- 9.3 builds on the Story 1.6 time-to-first-frame baseline and the Story 3.1 FlashList adoption.
- 9.4 and 9.5 feed fixes back into earlier epics' screens. Open owner device passes from earlier retros (second account, physical-remote passes, live at 1×, chooser with 2+ players) overlap with the 9.5 checklist and can be closed there.
