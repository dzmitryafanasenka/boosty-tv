---
title: 'Story 1.2: Library compatibility on the device'
type: 'chore'
created: '2026-10-25'
status: 'done'
baseline_commit: '10c44765df1c5bb83d11ae2d650c32f07d7c3a61'
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
- [x] `package.json`, `package-lock.json` -- add the pinned libraries listed above; `npm ls` shows a single react-native (tvos).
- [x] `src/shared/i18n/plural.ts` + `__tests__/plural.test.ts` -- ru plural selector and the matrix cases.
- [x] `src/app/spike/NavigationCheck.tsx` -- a two-screen native-stack: screen A has 3 focusable items; OK on item 2 pushes B; Back pops; focus must return to item 2. Show on screen which item is focused.
- [x] `src/app/spike/KeychainCheck.tsx` -- buttons: save, read, simulate corruption; each shows the result on screen. Simulate corruption by deliberately corrupting the library's storage, or by forcing its error path. Any read error leads to wipe + «signed-out».
- [x] `src/app/spike/VideoCheck.tsx` -- plays public HLS, DASH and MP4 test URLs; seek ±10 s, rate 1.5×, and an invalid URL to see the error event; events are shown on screen.
- [x] `src/app/spike/ZodPluralCheck.tsx` -- runs the Zod matrix and the plural matrix in-app and prints pass/fail.
- [x] `src/app/spike/QrCheck.tsx` -- renders a QR for a ~300-character URL, offline.
- [x] `src/app/App.tsx` -- debug-only spike menu with D-pad focusable entries.
- [x] `docs/testing.md` -- results table for every check, with how each was observed (device screen, logcat, owner).
- [x] `docs/adr/0005+` and the spine Stack row -- only if a check fails.

**Acceptance Criteria:**
- Given the spike build on the device, when each check screen is run, then its outcome is visible on screen and recorded in `docs/testing.md`.
- Given a release-like Hermes build, when ZodPluralCheck runs, then all cases pass, and whether Zod needs `jitless` is recorded.
- Given the keychain value was saved, when the app is killed and the device rebooted, then the value is read back.
- Given any library fails, when its fallback is chosen, then an ADR exists and the spine Stack row is updated.
- Given `npm run lint && npm run typecheck && npm test`, when run, then all pass.

## Implementation Notes

- Implementation by the dev agent, plus orchestrator follow-ups; see `docs/testing.md` (Story 1.2) for every result and how it was observed.
- Deviations: the plural test lives at `src/shared/i18n/__tests__/plural.test.ts`. The spike menu is also in the release-like build, because the Hermes check must run there. A dev dependency `@babel/plugin-transform-export-namespace-from` is required for Zod 4 in the release bundle.
- Device facts: 32-bit only (`armeabi-v7a`), ~350 MB free; device builds use `-PreactNativeArchitectures=armeabi-v7a`.
- **native-stack: fail.** Intermittent `MissingViewState` in the debug and the release-like build (owner-reported, then reproduced). Owner decision: (b) the JS stack, else an own stack. The JS stack passed 50/50 cycles in each build and the owner's physical-remote check, given a per-screen `TVFocusGuideView` trap and explicit focus restoration. Recorded in ADR 0007; ADR 0005 is superseded and ADR 0003 amended.
- **keychain:** passes save/read, cold start, reinstall, reboot and ciphertext corruption. File-level corruption leaves a dead end. Owner decision: option (b), a native storage-reset helper (ADR 0006), gated in Story 1.3.
- **Zod 4 + plural selector:** pass under Hermes in the release-like build; `jitless` is not needed. **Video:** HLS/DASH/MP4 load, seek and change rate, and `onError` fires on an invalid URL; the picture was confirmed by the owner. **QR:** scans on a phone (owner).

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind | ADR 0007 still says the physical-remote check is pending | low | patch | Updated: owner check passed |
| 2 | blind | `RNScreensFragmentFactory`: testing.md says "keep in production", ADR 0007 says unnecessary | medium | patch | Resolved: not carried to production (spike only) |
| 3 | blind | ADR 0006 gate not in Story 1.3 acceptance | medium | patch | AC added to epics.md Story 1.3 |
| 4 | blind | Keychain wipe on any error vs CorruptionException-only: no error classification | medium | patch | ADR 0006 now classifies unreadable / undecryptable / transient; transient never signs out |
| 5 | blind | Focus restoration proven only by index on a static list; virtualized lists and focus-map not covered | medium | patch | ADR 0007 consequence + Story 2.4 device check + focus-map requirement for Story 1.8 |
| 6 | blind | `detachInactiveScreens={false}` memory cost unmeasured on a 32-bit device | medium | patch | ADR 0007 consequence; measured in Story 9.3 |
| 7 | blind | Video rate evidence ≈1.7× and release seek/rate not re-checked | low | patch | testing.md row marked event-level, release not re-checked |
| 8 | blind | ADR 0005 Context misleading; testing.md links ADR 0005 without "superseded" | low | patch | Superseded banner added; link annotated |
| 9 | blind | `pluralRu` throws on invalid counts at render time | low | patch | Contract documented: validate at the boundary (Zod); throwing stays so bugs surface in tests |
| 10 | blind | Spike vs main mixing; native-stack still in package.json | medium | patch | Handled by the results PR: only docs, ADRs, spine, epics and `src/shared/i18n/plural.ts` (+test) go to main; spike code and packages stay on the branch |
| 11 | blind | ABI / APK size follow-up missing | medium | defer | deferred-work.md (Story 9.1) |
| 12 | verification-gap | Babel export-namespace-from not exercised by Jest | medium | defer | deferred-work.md: Metro bundle check in CI once zod is a production dependency |
| 13 | verification-gap, blind | App menu test no longer presses entries / restores focus | low | reject | Spike-only menu, not merged; the production Shell gets its own focus tests (Story 2.4) |
| 14 | edge | KeychainCheck module-level corruption flag survives unmount; race with mount-time read | low | reject | Spike check screen only; results were gathered deliberately, and the production adapter follows ADR 0006 |
| 15 | edge | VideoCheck seek not clamped, reselecting the same source, controls before a source | low | reject | Spike check screen only; it does not affect the recorded results |
| 16 | edge | NavigationCheck preferredFocus hard-wired to item 1 may explain the focus-return issues | false | reject | The decisive native-stack failure was B never appearing (`MissingViewState`), not focus return |
| 17 | blind | sprint-status `in-progress` vs spec `in-review` | false | reject | Step 5 syncs the status |
| 18 | blind | Spec Change Log empty / checkbox semantics | low | reject | The fix would edit this build's spec; outcomes are recorded in Implementation Notes and testing.md |
| 19 | blind | `docs/focus-map.md` not updated | low | defer | The file is produced by Story 1.8; requirement added in ADR 0007 |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test` -- expected: exit 0.
- `cd android && ./gradlew assembleDebug assembleRelease` -- expected: BUILD SUCCESSFUL.
- `adb -s <device> install -r <apk>` and `adb logcat -s ReactNativeJS` -- expected: the check outputs appear.

**Manual checks (if no CLI):**
- On the device: each check screen shows its outcome; the navigation focus returns to item 2 after Back; the QR scans on a phone.
