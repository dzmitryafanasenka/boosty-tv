# Epic 14 Context: Player additions (our improvements)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Add two small everyday conveniences to the built-in video player, requested by the owner after daily TV use (owner decisions 2026-11-02): the clock time at which the current video will end, shown in the overlay, and a sleep timer that pauses playback after a chosen time so the viewer does not lose their place when falling asleep. Both are our improvements beyond BoostBuddy parity (FR-65, FR-64; FR-45 amended). They are local player features with no new API dependency.

## Stories

- Story 14.1: «Закончится в ЧЧ:ММ» in the player overlay
- Story 14.2: Sleep timer

## Requirements & Constraints

- **End time (FR-65):** only for a seekable video with a known duration. Computed from the remaining time at the current playback speed plus the device clock, 24-hour format (exact Russian copy fixed at spec time). Updates at least once a minute and immediately after a seek or speed change. Hidden for live streams and unknown durations.
- **Sleep timer (FR-64):**
  - A «Таймер сна» row in the player settings side sheet: «Выкл», fixed durations and «До конца видео» (the exact options are chosen at spec time). Default «Выкл».
  - Not persisted: every player session starts with the timer off (unlike quality and speed, which are stored device preferences).
  - While active, the overlay shows the remaining timer time.
  - When it fires: playback pauses and progress is written at that position via the existing pause write; the overlay behaves as on any pause. On a live stream: pause only, no progress write.
  - Changing the video or leaving the player cancels the timer.
- Existing player rules stay intact: overlay auto-hides after 5 s only while playing, never while paused, seeking, with a sheet open or on an error. Live streams have no seeking and speed fixed at 1×. Speed presets 0.5×–3× for recordings.
- Progress-write rules are unchanged: at most one write per ≥ 10 s of movement plus forced writes on pause, background, exit and end. The sleep timer must reuse the pause path, not add a new write path.
- Do not present options the player cannot honour (e.g. «До конца видео» or end time where duration is unknown/live).
- Copy in Russian, i18n-ready; code and docs in English.

## Technical Decisions

- Both features live in `features/player` (capability map: FR-64/65 → `features/player`, bound by AD-10).
- **Progress ownership (AD-10):** `ProgressRepository` is the only writer of E9 and Continue history; the player only calls `report(ref, positionSec, event)`. The sleep-timer fire is a normal pause event. UI reads progress only through `useProgress(ref)`.
- Positions and durations are **integer seconds** above `PlayerEngine`; domain timestamps are epoch ms. Use the device clock for end-time display.
- `PlayerEngine` / `PlayerEngineView` (in `src/shared/platform`) wrap react-native-video; features must not touch `NativeModules` or `AppState` directly (use `appLifecycle` if lifecycle is needed).
- Lifecycle (FR-51): on sleep/background the player already pauses and writes progress; define how the sleep timer interacts (it must not fire a second write or survive leaving the player).
- Media identity is `MediaRef {blogUrl, postId, mediaId}` / `LiveRef {blogUrl}`; "video changes" means the ref changes (e.g. FR-48 recovery re-resolves the same ref and should not cancel the timer unless the spec says so).
- Timers must be cleaned up on unmount; no continuous storage writes.

## UX & Interaction Patterns

- Player overlay layout: top band (avatar · author, post title, video title); bottom band: Timeline, then elapsed / remaining time, then PlayerControls (play/pause, «Настройки»), over the top/bottom darkening gradient. The end time goes next to the remaining time.
- The remaining sleep-timer time is shown in the overlay while a timer is active.
- The «Таймер сна» row belongs to the existing player-settings SideSheet (opened by «Настройки» or Menu/Info/Settings), alongside quality and speed; the option list is a settings submenu.
- Back order in the player: settings submenu → settings sheet → overlay → exit (progress write, restore originating focus). Side sheets trap focus and return it to the initiator on close.
- Initial overlay focus is the Timeline; ↓ moves to PlayerControls. Native focus only; D-pad handlers are allowed in the player.
- Use existing tokens (`overlay-badge`, player typography); no new visual primitives are planned.

## Cross-Story Dependencies

- Independent stories; 14.1 first (smaller). Both depend on the current playback speed (Epic 8, Story 8.1) and the remaining-time display already in the overlay.
- 14.2's «До конца видео» option and 14.1's end time share the same remaining-time-at-speed calculation; reuse it rather than duplicate.
- 14.2 depends on the existing pause progress write (AD-10, FR-44) and live-stream handling (Epic 7).
- Update `docs/feature-parity.md` improvement rows, `docs/focus-map.md` (player settings sheet), and the wiki after each story.
