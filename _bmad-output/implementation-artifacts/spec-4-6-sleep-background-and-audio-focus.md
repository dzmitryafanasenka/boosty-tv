---
title: 'Story 4.6: Sleep, background and audio focus'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'd8a6c12e6aafc1496ee673223c211076ac488d39'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When the app goes to the background or the TV sleeps, react-native-video pauses natively but the player's own state stays «playing», so on return `onHostResume` restarts playback by itself (seen in the Story 1.6 spike); an audio-focus loss pauses natively without the player knowing (wrong play/pause state, a later prop update resumes) (FR51; epics.md Story 4.6; deferred-work Story 1.6).

**Approach:** On background (sleep included: the activity stops) the player pauses itself (the existing 4.2 `background` progress write stays), cancels a pending seek target without seeking, closes the settings sheet; on return to the foreground it stays paused with the overlay shown and focus on the timeline. The PlayerEngine port reports an audio-focus loss (react-native-video `onAudioFocusChanged(false)`, also the transient loss) and the player pauses (a user pause: the 4.2 `pause` write). Pressing play on a source resolved ≥ 23 h ago first re-resolves it through the Story 4.4 path (one fresh E8, same quality, same second, «Восстанавливаем воспроизведение…») and then plays; a younger URL that turns out expired still falls into the 4.4 automatic recovery. The AppLifecycle port gains a foreground subscription. Unmount keeps releasing the engine and the playback slot (Story 4.1; pinned by a test).

</frozen-after-approval>

## Implementation Notes

- `src/shared/platform/appLifecycle.ts`: `subscribeAppForeground`. `playerEngine.ts` / `PlayerEngineView.tsx`: `onAudioFocusLost` from react-native-video `onAudioFocusChanged` (`hasAudioFocus: false`; full and transient).
- `src/features/player/PlayerScreen.tsx`: background → `background` write, pending seek dropped (no seek), sheet closed, `paused` true; foreground → overlay (focus → timeline by the existing focus effect); audio-focus loss → `setPlaying(false)` (the 4.2 `pause` write); `SOURCE_REFRESH_AGE_MS` (23 h): play on an older source runs the 4.4 recovery path without using the budget (`resolvedAt` set per resolution).
- Root cause noted: react-native-video `onHostResume` calls `setPlayWhenReady(!isPaused)`, so JS must pause on background.
- Tests: playerFlow «Story 4.6» (4), adapter test (1). `npm test` ×3: 1605 passed each. Device: sleep/wake over adb passed (see testing.md); the played video was a new feed post, not the owner-approved one (reported).
- Docs: focus-map resume note, feature-parity PLAY-12, testing.md Story 4.6, deferred-work (Story 1.6 wake item done).
- Review patches: `heldByLifecycle` + `pauseForLifecycle` (background or an audio-focus loss in any phase keeps the next source paused until the user presses play; a hold-scrub never resumes after it); the overlay hidden on background so the foreground re-shows it and focus goes to the timeline; the foreground fires only after `background`/`inactive`; the library's `OnAudioFocusChangedData` type; docs (no auto-resume on focus gain, keep-screen-on = library default, unverified). Tests: +3 flow, `appLifecycle.test.ts` (2). `npm test` ×3: 1610 passed each. Device re-run on the owner-approved video passed. `playerFlow` + `src/shared/platform` ×30: the first batch had 1 failed run (its output was not captured, not reproduced), the next two batches 30/30 and 30/30 with failure capture on.

## Review Triage Log

| # | Finding (Blind Hunter) | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Background during loading/recovering does not pause: the next source would start by itself on return | medium | patch: `heldByLifecycle` keeps every next start paused until a user play; flow test «background during a recovery» |
| 2 | Audio-focus loss during a hold-scrub (or a load/recovery) is lost; the scrub end resumes playback | medium | patch: `pauseForLifecycle` clears `scrubWasPlaying`; flow test |
| 3 | Background with the sheet open: focus not moved to the timeline on return (overlay already true) | medium | patch: the overlay is hidden on background, re-shown on return; flow test |
| 4 | Spec items (sheet closed, pending seek dropped) untested; «pinned by a test» claim | low | patch: flow test; docs name the 4.1 `exit releases the slot` test |
| 5 | No unit tests for the lifecycle port; duplicated helpers | low | patch: `appLifecycle.test.ts` (it found that `unknown → active` counted as a return: fixed); no extra helper |
| 6 | Transient focus loss stays paused, no resume on gain; undocumented | low | patch: documented as our decision (focus-map, PLAY-12) |
| 7 | 23 h threshold by client clock, not the URL `expires`; JSDoc states 24 h as fact | low | patch: JSDoc hedged; parsing the signed URL rejected (URLs stay opaque) |
| 8 | The age re-resolve skips the `ended` branch; E8 failure outcome unclear | low | rejected: after 4.5 the player leaves at the end; an E8 failure ends the recovery in the existing error state (4.4) |
| 9 | deferred-work marked done before the story closes | low | rejected: closed in this commit |
| 10 | PLAY-12 keep-screen-on not addressed | low | patch: documented as the library default, unverified |
| 11 | The device side effect (progress on a non-approved video) without rollback/prevention | low | patch: lesson recorded in testing.md; the owner was told how to reset it on Boosty |
| 12 | Hand-written event type in the adapter | low | patch: `OnAudioFocusChangedData` |

