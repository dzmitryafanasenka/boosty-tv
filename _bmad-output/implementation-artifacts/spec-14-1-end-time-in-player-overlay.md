---
title: 'Story 14.1: «Закончится в ЧЧ:ММ» in the player overlay'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '4972ce51716c913664fa6eb18e8fe3946b53e19a'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The overlay shows only the remaining media time, so at 1.5× or late in the evening the viewer has to work out when the video actually ends.

**Approach:** For a VOD with a known duration, the overlay's bottom row shows «Закончится в 21:47» next to the remaining time: now + (duration − position) / speed, on the device clock, 24-hour in the app's existing clock style (`H:MM`, as `formatCardDate`). It follows the current position (like «−remaining»), the current speed, and re-computes at least once a minute (also while paused) and on every position, seek-done or speed change. Hidden for live streams and unknown durations. Plain text (no live region), not focusable. Our improvement IMP-07 (FR-65, owner decision 2026-11-02).

</frozen-after-approval>

## Implementation Notes

- `src/features/player/endTime.ts` (new): `remainingWallMs` (shared with the Story 14.2 «До конца видео» timer), `endTimeMs`, and `stableEndTime` with a 20 s hysteresis: the position ticks in whole seconds while the clock runs on, so the raw end wobbles by about a second and would flip the minute at an edge.
- `PlayerOverlay.tsx`: `EndsAt` after «−remaining» in a row on the right (VOD with `durationSec > 0`; the live branch never renders it); a 30 s timer (≤ 1 min) keeps it moving while paused. `formatClockTime` in `format.ts` (`H:MM`, the app's clock style; no `Intl` on Hermes). Copy `player.endsAt`.
- Decisions: it follows the position, not a pending seek target (like «−remaining»); «−remaining» stays media time (Story 8.1).
- Docs: feature-parity IMP-07, DESIGN.md Timeline row, EXPERIENCE.md, testing.md, CHANGELOG pair. Sprint status also closes 12.5 / Epic 12 (carried on this branch after PR #120).

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | testing.md promises a device check that is not there | low | Status line written before the run | patch (filled after the device check) |
| 2 | End time flips at a minute edge while playing | medium | Whole-second position vs continuous clock; a test with values around 21:50:00 fails without the fix | patch (20 s hysteresis) |
| 3 | Follows position, not the seek target | false | Intent: «follows the current position (like «−remaining»)» | rejected |
| 4 | Spec notes empty | low | Direct edit | patch |
| 5 | Formula not reusable for 14.2 | low | Was exported from the UI file | patch (`endTime.ts`) |
| 6 | Sprint status carries 12.5 / Epic 12 done | false | Intentional, recorded above | rejected |
| 7 | Not-focusable test is weak | low | `Text` is never focusable; no harm | rejected |
| 8 | Row may squeeze a long chapter name | low | `elapsedRow` already shrinks and truncates; owner checks the layout on the TV | rejected |
| 9 | Remaining media vs end wall time at 1.5× | low | Story 8.1 decision (times are media time) | rejected |
| 10 | No recompute on wake | low | ≤ 30 s stale after a wake while paused | rejected |
| 11 | Wiki not mentioned | false | Wiki is updated after the merge (standing rule) | rejected |
