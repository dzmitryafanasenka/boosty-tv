---
title: 'Story 14.2: Sleep timer'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'bad2dd4d2f047140bfafa6511d82a6fca8e2559d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Falling asleep in front of a long video loses the place: playback runs on and the saved position moves far past what was watched.

**Approach:** A «Таймер сна» row in the player settings sheet (our improvement IMP-08, FR-64). Owner decisions 2026-11-03: options «Выкл» (default), «15 мин», «30 мин», «60 мин», «90 мин», and «До конца видео» (VOD with a known duration only); fixed durations count down on the wall clock from the pick, also while paused or in the background; «До конца видео» keeps the player paused on the last frame at the end instead of the usual exit to Пост (the video is still marked finished); the timer is available on live streams too, so the live gear is always shown there (the sheet has «Таймер сна», plus «Качество» when the live offers a choice).

**Owner decisions 2026-11-03 (after review):** a fixed timer's countdown uses a monotonic clock (elapsed real time from the pick, not affected by device clock changes). One minute before a fixed timer fires, unless the settings sheet is open, the overlay opens with focus on a «Ещё 15 мин» button in the top band next to «Пауза через 0:59» (counting down); the overlay does not auto-hide during the warning; OK on the button adds 15 minutes to the deadline and ends the warning; without OK the pause happens as described. After a timer pause, the top band shows «Пауза по таймеру сна» while paused; it goes away when playback resumes. «До конца видео» has no warning.

## Boundaries & Constraints

**Always:** the choice lives in the player session only (not persisted; a new Player starts at «Выкл»; unmount cancels it); a fixed timer firing while playing calls the existing programmatic pause (`commands.setPlaying(false)`, ending a hold-scrub first like `pauseForLifecycle`), so VOD gets the normal pause progress write and live gets a plain pause; firing while already paused or in the background only ends the timer (no extra write); it closes an open settings sheet and shows the overlay (as on a pause); «До конца видео»: at the end the VOD writes `end` as today, stays paused on the last frame with the overlay, does not call `onEnded`; replay after that starts with the timer «Выкл»; while active the overlay's top band shows «Таймер сна · 12:34» (fixed: time left on the wall clock; «До конца видео»: «Таймер сна · до конца»), tabular meta text, not focusable, no live region; the sheet row shows the current choice; picking closes the sheet and returns focus to «Настройки» (as speed); submenu focus ids `player/sheet/sleep/<off|15|30|60|90|end>`; Back submenu → sheet row → overlay as today; Russian copy; tests use fake timers with `jest.setSystemTime`.

**Never:** persisting the choice; changing the default end-of-video exit when the timer is not «До конца видео»; showing «До конца видео» on live or without a known duration; a progress write on live; a second write after a background pause.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pick 30 мин | VOD playing | Sheet closes, focus «Настройки»; overlay «Таймер сна · 30:00» counting down | N/A |
| Fires while playing | 30 min later | Paused at that position, pause write once, overlay shown, timer «Выкл» | N/A |
| Fires while paused / in background | user paused or app backgrounded | Timer «Выкл», no extra write, stays paused | N/A |
| Fires during a hold-scrub | scrub held | Scrub cancelled, paused, one pause write | N/A |
| Fires with the sheet open | sheet open | Sheet closes, paused | N/A |
| «До конца видео» | VOD reaches the end | `end` write (finished), player stays paused at the end with overlay; Back exits to Пост as usual | N/A |
| «До конца видео» availability | live or unknown duration | Option not offered | N/A |
| «Выкл» | pick «Выкл» | Timer cancelled, indicator gone | N/A |
| Live | live with one quality | Gear shown; sheet has «Таймер сна»; fire → plain pause, no write | N/A |
| Leave / new Player | Back, or open another video | Timer gone; the next Player starts «Выкл» | N/A |

</frozen-after-approval>

## Code Map

- `src/features/player/PlayerSettingsSheet.tsx` -- ids (l.10-14), `SettingsSheetData` + `createSettingsSheetModel` with manual equality (l.17-62: add `sleep`), levels (l.96-98), Back (l.120-133), initial focus (l.139-143: generalise `backToSpeed` to the origin row), `SettingRow` nav/radio (l.148-193); speed submenu is the template.
- `src/features/player/usePlayerSettings.tsx` -- data (l.75-89), `onPickSpeedRef` (l.118-122: pick → `closeSheet(true)` → `showOverlay()`), sheet only while `phase==='playing'` (l.103-107), `openSettings` (l.124-144).
- `src/features/player/usePlaybackSession.ts` -- `setPlaying` (l.448-515: pause writes `report('pause')` once), `pauseForLifecycle` (l.356-363, scrub reset), `onAudioFocusLost` precedent (l.780-791), `onEnd` (l.694-719: `reportEnd` then `onEnded`), background/foreground (l.813-827).
- `src/features/player/PlayerScreen.tsx` -- hook order (l.158-159), gear visibility on live (l.196, `livePolicy.ts:10` `liveSettingsShown`, `playbackMode.ts:147`), overlay props (l.355-389).
- `src/features/player/PlayerOverlay.tsx` -- top band (l.452-489, after `notice`); `EndsAt` ticking pattern (l.66-83).
- `src/features/player/endTime.ts` -- `remainingWallMs` (not needed for the indicator text «до конца», available if useful).
- New: `src/features/player/useSleepTimer.ts` (state, deadline, fire, cancel on unmount, «end» mode flag consumed by `onEnd`).
- i18n `ru.ts` `player.sleep.*` next to `player.speed` (l.517-520).
- Tests: `PlayerSettingsSheet.test.tsx`, `__tests__/playerSpeedFlow.test.tsx` + `src/test/playerFlowHarness.tsx` (fake timers), `PlayerOverlay*.test.tsx`, live flow tests (`liveFlow.test.tsx`).
- Docs: `docs/focus-map.md` (l.68 ids, l.487-498 sheet notes, Back), `docs/feature-parity.md` IMP-08 (l.190), `docs/testing.md`, EXPERIENCE.md l.173, DESIGN.md sheet/overlay rows, CHANGELOG pair.

## Tasks & Acceptance

**Execution:**
- [x] `useSleepTimer.ts` + unit tests (deadline, fire paths, cancel, end mode).
- [x] Sheet row + submenu (+ live gear always) + overlay indicator + `onEnd` hold for «До конца видео».
- [x] Flow tests for every matrix row (VOD and live).
- [x] Docs and changelog.

**Acceptance Criteria:**
- Given the release-like build on the pinned TV, when the owner sets a timer and lets it fire (and tries «До конца видео» near the end of a video), then playback pauses as described (owner's check; agent via adb for the sheet and the indicator).
- Given `npm run lint`, `npm run typecheck`, `npm test`, then all pass.

## Implementation Notes

- `PlaybackMode.settingsShown` became `qualityShown` (the «Качество» row; live: only with a real choice, `livePolicy.liveQualityShown`); the gear shows whenever a source is ready.
- `usePlaybackSession` gained the `holdAtEnd` input (a ref the sleep timer sets; `onEnd` asks it after the `end` write) and the `sleepPause(closeSheet)` command (only a playing video, a held scrub included: closes the sheet with focus «Настройки», cancels the scrub without resuming, then `report('pause')` / `setPlaying(false)`).
- `useSleepTimer` measures elapsed time on the monotonic clock (`sleepClockNow`, `performance.now()`; review fix: a device clock change must not move it) and checks the deadline at least every 1 s (`SLEEP_CHECK_MS`), so a late JS timer fires at the next check; the overlay indicator reads the same clock. A new `resetKey` (another ref) cancels it.
- Review fix: a fire while loading, recovering or on the error screen holds the next start paused (`pauseForLifecycle`, the pending retry marked paused); the hold-scrub branch reuses `pauseForLifecycle`, then writes the pause once.
- Flow tests: `__tests__/playerSleepFlow.test.tsx`; device check not run by the implementing agent.

- Warning and notice (owner decisions after review): `useSleepTimer` decides the warning at T−60 s once per deadline (`canWarn`: playing, sheet closed); `onWarn` shows the overlay and sets `warnFocus` (the focus target `player/sleep/extend` until the overlay hides or the warning ends); `useOverlayTimers` does not hide during the warning; `extend` adds 15 min; a manual pause ends the warning. `onFire` returns whether it paused (or held the next start paused); that, or the end hold, sets `pausedByTimer` («Пауза по таймеру сна» while paused). The countdown re-renders with a timeout chain, not an interval (Jest's fake timers crash when an interval is cleared by a job in its own tick).

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind, edge | A fire during loading/recovering/error is used up and playback then resumes | high | `sleepPause` returns when `phase !== 'playing'` after the hook set «Выкл» | patch |
| 2 | blind, edge | Scrub branch duplicates the cancel and skips `pauseForLifecycle` effects | medium | `nextStart` not forced paused | patch |
| 3 | blind, edge | Wall-clock deadline moves with clock changes; comment says it survives them | medium | `Date.now()` deadline; NTP sync after wake | patch (monotonic) |
| 4 | blind | Indicator first frame uses a stale `nowMs` | low | State set only in the effect | patch |
| 5 | vgap, edge | Kept «До конца видео» row (sleepEnd false) untested | medium | No test with `sleep:'end', sleepEnd:false` | patch (test; the row stays by design so focus has a target) |
| 6 | blind | 60-minute case untested | low | Test name vs assertion | patch |
| 7 | blind | testing.md lacks device rows / counts | low | Doc gap | patch |
| 8 | vgap | Quality row vanishing while its submenu is open untested | maybe-false | Not shown reachable mid-session | defer |
| 9 | blind | Paused player may keep the screen on overnight | maybe-false | Same as any user pause today; settle with a device check | defer (device row) |
| 10 | blind | No «paused by the sleep timer» message / no pre-warning | low | Not in the owner's decisions | rejected (idea for the owner) |
| 11 | edge | Sheet opened on a paused video stays open at fire | low | Nothing changes for a paused viewer | rejected |
| 12 | blind | Status mismatch; 14.1 done carried here | false | Workflow; intentional, noted | rejected |
| 13 | blind | `resetKey` "undefined/…" string, ref set in render | low | Works; style | rejected |
| 14 | blind | 1 s polling wakeups | low | Cheap; needed for the indicator and wake | rejected |

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test` -- all pass.
- `cd android && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- BUILD SUCCESSFUL; check the APK time and an ASCII bundle marker (`player/sheet/sleep`).

### Re-review of the warning code (2026-11-03)

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| R1 | `canWarn` false at T−60 s suppresses the warning for the whole deadline | medium | patch |
| R2 | «Ещё 15 мин» unreachable after focus leaves it (↑ opens chapters) | medium | patch |
| R3 | Chapter strip not considered; closing it jumps focus to the button | medium | patch |
| R4 | Deferred `sleepPause` returns true for a viewer/lifecycle pause → wrong notice | medium | patch |
| R5 | Background test assertion proves nothing | low | patch |
| R6 | Pause write gated during a quality-switch load | low | rejected (existing gate behaviour) |
| R7 | Countdown not aligned to the deadline second | low | rejected |
| R8 | Warning not announced to TalkBack | low | patch |
| R9 | «15 мин» copy not tied to `SLEEP_EXTEND_MS`; row still says «15 мин» after an extend | low | rejected |
| R10 | Stale JSDoc `settingsShown` | low | patch |
| R11 | `SleepCountdown` dummy prop | low | rejected |
| R12 | `resetKey` without a null guard | low | rejected (unreachable) |
