# Epic 8 Context: Viewing preferences and diagnostics (P2)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Close the remaining BoostBuddy player and settings parity (PLAY-07, PLAY-13, SET-02, SET-04, SET-05). The family can change the playback speed of recorded videos, and the owner can hand videos to an installed Android player. Full Настройки gains the «Системный видеоплеер» toggle and a hidden Diagnostics screen. Diagnostics captures redacted logs for testing on the TV and is retrieved over adb (owner decision: debug logs yes, for testing and debugging only, with redaction). The epic builds on the player as split on 2026-10-31 (`PlaybackMode`, `usePlaybackSession`, `usePlayerSettings`), so live/VOD differences go through the mode and not through new `isLive` branches in `PlayerScreen.tsx`.

## Stories

- Story 8.1: Playback speed
- Story 8.2: System video player option
- Story 8.3: Hidden diagnostics for testing

## Requirements & Constraints

- **Speed (recordings only):**
  - The presets are exactly 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2 and 3×, shown as a list with the current one checked.
  - Picking one keeps the position.
  - The speed is one global preference, stored device-scoped. It survives sign-out and is not part of the account wipe. It applies to the next videos.
  - Live streams: no «Скорость» row, and playback stays at a fixed 1×.
  - Expose the option only if the engine really supports a rate change on the device.
- **System player:**
  - «Системный видеоплеер» is a toggle in Настройки. Its description says that progress is not tracked in this mode.
  - When it is on, starting a video always opens the quality list first. Then the Android chooser (`ACTION_VIEW`) gets the chosen URL and the title. The reference also passes MX Player / Vimu extras.
  - No progress write (E9) and no Continue history entry in this mode.
  - If no app resolves the intent, fall back to the built-in player and show «Внешний плеер не найден».
  - The URL is a signed CDN URL. Never log it, persist it or put it in route params, and never attach Boosty `Authorization` to it.
- **Diagnostics:**
  - Seven OK presses on «Версия» open Diagnostics. A single press does nothing visible in this epic.
  - Diagnostics toggles log capture and explains how to pull the file over adb. There is no share sheet or upload, no telemetry and no crash reporting.
  - Logger redacts the following before anything is stored:
    - tokens and cookies;
    - Authorization headers;
    - phone numbers and codes;
    - signed URLs and `signedQuery`.
  - A unit test feeds all of these and asserts that they are redacted. The reference logged full signed CDN URLs in player diagnostics; we must not.
  - The log ring and the log file are account-scoped. `AccountScope.reset()` (sign-out, account switch) clears both.
- **Tests:**
  - unit: speed presets, preference persistence and live forcing 1×, external-player fallback, redaction, reset clearing the file;
  - component: settings rows and the toggle, the hidden gesture, the Back order;
  - device: rate change, chooser launch and fallback, adb retrieval.
  - Emulator or mock results are never reported as device verification.

## Technical Decisions

- **Ports (AD-2):**
  - The external player goes through the `ExternalPlayer` port in `shared/platform`, with its adapter in `shared/platform/android`. No feature calls a native module or an intent API directly. *As built: see «As built» below (flat `shared/platform/externalPlayer.ts`).*
  - The playback rate goes through the `PlayerEngine` port (react-native-video 6.19.x).
- **Storage scopes (AD-4):**
  - Device-scoped: preferred quality and preferred speed.
  - The planning docs do not name a scope for the «Системный видеоплеер» setting. Device scope matches the reference and the review note that the account wipe excludes it, but the story must state it.
  - Account-scoped: the diagnostics log buffer. It is registered with AccountScope at bootstrap; lazy registration is not allowed.
  - Async log writes started under an old generation must not land in the new account's file.
- **Logger (AD-14):**
  - The existing `shared/services/logger.ts` already holds the redacting in-memory ring (200 entries) and its account-store registration. *As built: the file is in app-specific external storage, see «As built» below.*
  - Story 8.3 adds the capped file in internal storage and the adb export. Redaction is the safety net, not the policy: callers still never log bodies, the phone, the challenge or the code. *As built: external files dir (internal below API 29), see «As built» below.*
  - `allowBackup=false` stays in the manifest.
- **Phase gating (AD-20):** the speed row, the system-player row and Diagnostics are entry points rendered only when their flag in `app/phaseFlags.ts` is on. No screen hard-codes the phase.
- **Progress (AD-9):** ProgressRepository stays the only E9 writer. The external path must simply never call `begin`/`report`.
- **Media resolution (AD-11):** the external path resolves the URL through `MediaResolver` like the built-in player. There is no recovery once the URL leaves the app.
- **Copy:** Russian strings go in `ru` (i18n-ready); code and docs are in English.

## UX & Interaction Patterns

- **Player settings sheet:**
  - It is the existing 340 dp right side sheet, opened by the gear «Настройки» or the Menu/Info keys.
  - «Скорость» sits beside «Качество» as a radio submenu. It is hidden for live streams.
  - Back order: submenu → sheet → close (focus returns to «Настройки») → overlay → exit.
  - The overlay never auto-hides while a sheet is open.
- **Настройки screen:** rows for «Системный видеоплеер» (toggle with a description), «Версия» and «Выйти из аккаунта». Diagnostics stays hidden until the gesture.
- **Focus:** the sheet and dialogs trap focus and return it to the initiator on close. The focus states (focused, selected, checked) stay distinct.
- **Errors:** raw codes and technical text appear only in Diagnostics, never in the family-facing UI.
- **No options the stream does not have:** subtitles and audio tracks are never shown.

## Cross-Story Dependencies

- 8.1 and 8.2 both touch the player and its settings: put the speed and the external hand-off behind `PlaybackMode` / `usePlayerSettings`, not in the screen.
- 8.2 reuses the Story 4.3 quality list and preference, and adds the `ExternalPlayer` port.
- 8.3 extends the Epic 2 Logger. Its account-scope reset must cover the new file.
- Epic 9 (update check) also binds «Версия»: one OK press checks at most once per 60 s, and the seven-press gesture must never trigger more than one check or be interrupted by a notice. Leave the press handling ready for that.
- The owner idea of post timestamps as chapter marks on the timeline (deferred work) was flagged to plan with Epic 8. It is not a story in this epic and needs an owner decision before any work.

## As built (Epic 8 retro A2, 2026-10-31)

- 8.1: speed through `PlaybackMode` (`speedShown`, `rate()`); no runtime rate capability check (accepted in the 8.1 triage); the rate was measured by the agent over adb on a release-like build (≈ 1.57× at 1.5×); live at 1× and the physical remote were not checked.
- 8.2: the hand-off is a route-level `PlayerEntry` around `PlayerScreen` (`stackRoutes.tsx`), not inside `PlaybackMode`. One real player opens directly; 2+ get the chooser with explicit intents (owner decision after the device run). The external player starts at 0:00 (owner decision). The adapter is the flat `src/shared/platform/externalPlayer.ts` (there is no `shared/platform/android`).
- 8.3: the log file is in app-specific external storage (internal below API 29), owner decision; turning capture off deletes it; HTTP paths are masked; the capture toggle is device-scoped (`diagnostics.capture.v1`). Device (agent over adb): gesture, capture, `adb pull`, masking, clear and delete checked; rotation, the sign-out reset, the background flush and API < 29 not checked. The ExternalPlayer port is two steps (`prepare`, then `launch` after the route pops). Epic 8 retro A1 narrowed the `code` field-key rule so `versionCode` (Epic 9) stays readable.

