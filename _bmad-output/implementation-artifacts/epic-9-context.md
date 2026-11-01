# Epic 9 Context: Ready for the family (P3)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the Android build into something the family can run every evening and the owner can retire BoostBuddy for. Releases, in-app updates, performance, and visual fidelity and accessibility are done. 0.9.0 and 0.9.1 are on GitHub Releases, and the TV installs updates after an explicit OK. Story 9.3 measured performance on the pinned Chromecast with Google TV 4K, and the owner accepted two exceptions. Story 9.4 fixed the focus and token deviations, verified contrast and labels, and had the owner listen to TalkBack and accept the remaining deviations. One story remains. Story 9.5 is the full real-device regression with the release build, and it ends with the owner's explicit acceptance of the Android release. That acceptance starts the switch-over and session-longevity observation periods.

## Stories

- Story 9.1: Signed release on GitHub Releases (done)
- Story 9.2: Update notice and in-app install from GitHub Releases (done)
- Story 9.3: Performance on the device (done)
- Story 9.4: Visual fidelity and accessibility pass (done)
- Story 9.5: Full device regression and owner acceptance (next)

## Requirements & Constraints

- **Regression checklist (9.5):** run on the pinned device with the release build, and record each item in `docs/testing.md`:
  - D-pad-only sign-in and browsing; long lists; filter apply and reset; keyboard close;
  - multiple media in a post; quality change; resume; poll vote;
  - the Back hierarchy; sleep and resume; network interruption; logout and re-login.
- **User journeys (9.5):** walk UJ-0 to UJ-7 with the remote only (D-pad, OK, Back, media keys; no pointer or touch).
  - UJ-0 first sign-in by phone and code; UJ-1 cold start to a playing video, quality change keeps the position, Back restores the card; UJ-2 two-video post, seek, exit, later resume from «Продолжить»; UJ-3 expired session, prefilled phone, same account and history (a different account wipes account-scoped data); UJ-4 search with the keyboard and a custom period, Back restores query, filter and card; UJ-5 live from an event or author page to stream end; UJ-6 single-choice vote; UJ-7 sign out to Welcome with no account data left.
  - UJ-1 takes 5 presses or fewer, with no autoplay shortcuts. Resume lands within ±10 s of the exit point.
- **Acceptance:** the owner explicitly accepts the Android release. Then the observation periods start: 4 weeks without opening BoostBuddy, and 30+ days without a forced re-login.
- **Settled owner decisions:**
  - «Boosty TV» is the final name. The banner and icon carry no Boosty marks.
  - The keystore and its passwords stay outside the repository, in `~/.gradle/gradle.properties`. Never read, print or log them.
  - In-app update needs an explicit OK plus the system installer. It is never silent and never retried automatically. The QR is the fallback.
  - Publishing a release needs the owner's OK.
  - Accepted 9.3 exceptions: held-↓ jank on Главная (15–21 %) and the Graphics image-cache plateau (about 115 MB). These are not regression failures. Single-step scroll, TTFF (median ≤ 2 s, worst ≤ 4 s) and flat PSS must still hold.
  - Accepted 9.4 deviations: «Код страны» wraps on A2 at font scale 1.3; line spacing grows above the 1.3× cap; the «FocusGuide» placeholder description from the framework. The placeholder decision was made by the owner: TextField placeholders use `text-tertiary`, which gives 4.68:1. The device build from 9.4 predates this fix, so the 9.5 build is the first device run with it.
- **Evidence labels:** keep agent over adb, emulator, owner and physical remote apart. Emulator and mock results never count as device verification. A run by the agent over adb is never a physical-remote or TalkBack-by-owner check.
- **Owner's account safety:** agent player visits must not write progress on the owner's account. 9.4 wrote a resume point of about 10 s because a visit lasted 11 s, and the progress cadence writes every 10 s of movement. 9.5 needs an explicit prevention rule before any player step. Items that pause, seek or resume a video, such as the player overlay and settings, belong to the owner, or need the owner's consent for that write.
- **Open items 9.5 can close:**
  - Player overlay and settings sheet labels on the device. They are host-tested only.
  - Medium, unverified: a sidebar focus event after the filter sheet closes might still make the Поиск/Автор chip unfocusable. Settle it with a device trace after a level change, then Back.
  - Owner device passes from earlier retros: a second account, physical-remote passes, live at 1×, the external-player chooser with 2+ players, and the 55-author grid (emulator only so far; the real account has 3 subscriptions).
  - A3–A11 sign-in screens on the device. They were never walked, because the family TV is never signed out without the owner.

## Technical Decisions

- **Builds:**
  - Device builds are owner-signed `assembleRelease` (armeabi-v7a for agent installs), installed with `adb install -r` over the family build. Nothing is uninstalled or cleared without the owner's approval.
  - Debug builds cannot install over the family build. The release build fails if the demo flag is on, so demo-only states need a debug build with Metro on the emulator.
  - Branch builds carry the same versionName and versionCode as the published release. This is open: «Версия» cannot tell them apart, and an older build needs `install -r -d`.
- **Before each adb key batch:** confirm the app is in the foreground. The device runs the owner's «Button Mapper» accessibility service. Leave it enabled and never reconfigure it. If TalkBack is toggled, restore `enabled_accessibility_services` and `accessibility_enabled` exactly.
- **Screenshots and logs:** screenshots of the real account stay local and are deleted after use. Committed images come from demo mode on the emulator only. Logs come from the hidden Diagnostics capture and `adb pull`. Turn capture off afterwards, and check that no URL query, token or phone number is in the log.
- **Update path:** the per-ABI asset path has not run on the device yet. v0.9.0 had only the universal asset, so the in-app update from 0.9.1 to the next release exercises it.
- **Guards that must stay green:** the tokens-only scan, the contrast and label checks, `homeFeedFlow` and `authorFlow`, `POST_GRID_DRAW_DISTANCE` at 2 rows (ADR 0015), and no added views in PostCard.
- **Focus:** native only (react-native-tvos, `TVFocusGuideView`). Focus IDs follow `<screen>/<zone>/<id>`. `docs/focus-map.md` is the normative contract. Changing it instead of the code needs the owner's approval.
- **Logging:** use structured fields, and `loggerFieldKeys` covers each call site. Redact signed URLs and personal data.

## UX & Interaction Patterns

- **Precedence:** EXPERIENCE.md, then DESIGN.md and `docs/focus-map.md`, then the mocks. The «as built» notes are the target:
  - 3-column post grids;
  - a single-column Пост;
  - the Shell sidebar on Автор and Пост.
- **Focus visuals:** one clear target (ring, surface lift and scale). «Current» is distinct from «focused». Disabled elements are not focusable.
- **Back:** Back closes the transient overlay first, then navigates. Restoration returns to the focused content ID, with the documented fallback when the item is gone.
- **Layout:** one logical layout of 960×540 dp. It is confirmed at 720p on the emulator and at 1080p on the device.
- **Anti-patterns:** no autoplay on Главная or after a video ends; no comment counts, prices or sort controls; no quality, speed or track options the stream lacks.

## Cross-Story Dependencies

- 9.5 runs on the next published release after 0.9.1. It includes the 9.4 fixes and needs the owner's OK to publish. Installing it in the app from 0.9.1 is the first device run of the per-ABI update path.
- 9.5 is the last story of Epic 9. The owner's acceptance closes P3 and starts SM-1 (switch-over) and SM-2 (session longevity).
- Failures found in 9.5 go back as fixes in this story, or as owner-visible deviations. They are never silent passes.
