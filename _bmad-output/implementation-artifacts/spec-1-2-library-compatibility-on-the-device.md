---
title: 'Story 1.2: Library compatibility on the device'
type: 'chore'
created: '2026-10-25'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/testing.md'
  - '{project-root}/docs/adr/0001-react-native-tvos-0-87-bootstrap.md'
  - '{project-root}/docs/adr/0002-secure-storage-keychain.md'
  - '{project-root}/docs/adr/0003-navigation-react-navigation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every later epic depends on five library choices that have never run on the Chromecast with react-native-tvos 0.87.1-1:
- React Navigation native-stack;
- react-native-keychain;
- react-native-video;
- Zod 4 under Hermes, together with the hand-written ru plural selector;
- react-native-qrcode-svg.

**Approach:**
1. On the throwaway branch `spike/1-2-library-compat`, add these libraries at the spine's pinned versions, plus a debug-only spike menu that runs one check screen per library on the physical device.
2. Record each pass or fail with details in `docs/testing.md`.
3. For any failure, adopt the spine's fallback through a new ADR and update the spine Stack row.

## Boundaries & Constraints

**Always:**
- Use the exact versions from the spine Stack table:
  - `@react-navigation/native` 7.5.1, `@react-navigation/native-stack` 7.21.0;
  - `react-native-screens` 4.30.0, `react-native-safe-area-context` 5.10.1;
  - `react-native-keychain` 10.0.0;
  - `react-native-video` 6.19.3;
  - `zod` 4.6.7;
  - `react-native-qrcode-svg` 6.3.27 with `react-native-svg` 15.16.0.
- Record results only as observed on the physical device. Label any emulator, injected-key or owner-reported result as such.
- Use public test media only: no Boosty content and no credentials.
- Run the Hermes check in a release-variant build signed locally with the SDK debug key. Commit no signing config.
- Results docs (`docs/testing.md`, new ADRs, spine Stack updates) must be correct on their own. They will be carried to `main` in a separate small PR; the spike code is not.

**Never:**
- Production feature code, or real Boosty API calls.
- Changes to the eslint boundaries or the CI release check.
- Leaving a failing library in place without an ADR.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plural selector | n = 0, 1, 2, 5, 11, 21, 22, 25, 111 | ru forms: 0 «лайков», 1 «лайк», 2 «лайка», 5 «лайков», 11 «лайков», 21 «лайк», 22 «лайка», 25 «лайков», 111 «лайков» | Negative or non-integer input throws |
| Zod parse | Valid fixture / fixture with an unknown extra field / fixture missing a required field | Parses / parses (extra field ignored) / returns a failure result | No crash under Hermes |
| Keychain read | Stored value / corrupted store | Value returned / store wiped and «signed-out» result returned | No crash, no unhandled rejection |

## Decisions (owner, 2026-10-25)

- **Reboot:** the agent reboots the Chromecast with `adb reboot` when the keychain check needs it, after telling the owner. The owner then sends the new wireless-debugging port.
- **Hands-on checks:** the owner does the physical-remote navigation check (focus, Back, focus return) and scans the QR with a phone during this story, when asked. Their reports are recorded as "owner-reported".

</frozen-after-approval>

## Code Map

- `src/app/App.tsx` -- the current placeholder. On the spike branch it becomes a debug-only spike menu that links to the check screens.
- `src/` boundaries (`.eslintrc.js`) -- spike screens live under `src/app/spike/` so no feature or shared rules are touched. The ru plural selector goes in `src/shared/i18n/plural.ts`, a production-shaped module kept for Story 2.1, with unit tests.
- `android/app/build.gradle` -- autolinking handles the native libs. Add nothing to `signingConfigs` in git; the release-like spike build is signed locally with `apksigner` and the SDK debug key.
- `docs/testing.md` -- add a «Story 1.2 — library compatibility (physical device)» results table.
- `docs/adr/0002`, `docs/adr/0003` -- fallbacks named there (own Keystore module; own minimal stack) apply only if the checks fail.
- Spine `_bmad-output/planning-artifacts/architecture/architecture-boosty-tv-2026-10-25/ARCHITECTURE-SPINE.md` Stack table -- update only on a fallback or version change.
- Device: Chromecast with Google TV 4K, wireless adb at `192.168.1.75` (the port changes after a reboot). `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.

## Tasks & Acceptance

**Execution:**
- [ ] `package.json`, `package-lock.json` -- add the pinned libraries listed above; `npm ls` shows a single react-native (tvos).
- [ ] `src/shared/i18n/plural.ts` + `__tests__/plural.test.ts` -- ru plural selector and the matrix cases.
- [ ] `src/app/spike/NavigationCheck.tsx` -- a two-screen native-stack: screen A has 3 focusable items; OK on item 2 pushes B; Back pops; focus must return to item 2. Show on screen which item is focused.
- [ ] `src/app/spike/KeychainCheck.tsx` -- buttons: save, read, simulate corruption; each shows the result on screen. Simulate corruption by deliberately corrupting the library's storage, or by forcing its error path. Any read error leads to wipe + «signed-out».
- [ ] `src/app/spike/VideoCheck.tsx` -- plays public HLS, DASH and MP4 test URLs; seek ±10 s, rate 1.5×, and an invalid URL to see the error event; events are shown on screen.
- [ ] `src/app/spike/ZodPluralCheck.tsx` -- runs the Zod matrix and the plural matrix in-app and prints pass/fail.
- [ ] `src/app/spike/QrCheck.tsx` -- renders a QR for a ~300-character URL, offline.
- [ ] `src/app/App.tsx` -- debug-only spike menu with D-pad focusable entries.
- [ ] `docs/testing.md` -- results table for every check, with how each was observed (device screen, logcat, owner).
- [ ] `docs/adr/0005+` and the spine Stack row -- only if a check fails.

**Acceptance Criteria:**
- Given the spike build on the device, when each check screen is run, then its outcome is visible on screen and recorded in `docs/testing.md`.
- Given a release-like Hermes build, when ZodPluralCheck runs, then all cases pass, and whether Zod needs `jitless` is recorded.
- Given the keychain value was saved, when the app is killed and the device rebooted, then the value is read back.
- Given any library fails, when its fallback is chosen, then an ADR exists and the spine Stack row is updated.
- Given `npm run lint && npm run typecheck && npm test`, when run, then all pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test` -- expected: exit 0.
- `cd android && ./gradlew assembleDebug assembleRelease` -- expected: BUILD SUCCESSFUL.
- `adb -s <device> install -r <apk>` and `adb logcat -s ReactNativeJS` -- expected: the check outputs appear.

**Manual checks (if no CLI):**
- On the device: each check screen shows its outcome; the navigation focus returns to item 2 after Back; the QR scans on a phone.
