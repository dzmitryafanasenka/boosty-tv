---
title: 'Story 12.4: Spike — the Continue history in the system Watch Next channel'
type: 'chore'
created: '2026-11-03'
status: 'done'
baseline_commit: '9efea470c14b64b8699f0bf07b2f1f7d88baf4ae'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The owner uses the Aero TV launcher (`tv.aero.home`), whose «continue» row shows other apps' Watch Next programs but not Boosty TV's. We do not know whether publishing to the system Watch Next channel would make our Continue history appear there (or in the stock Google TV launcher).

**Approach:** A temporary native probe on the pinned TV inserts one synthetic `WatchNextPrograms` row through the system TV provider (platform `android.media.tv.TvContract`, API 26+, which `androidx.tvprovider` wraps), checks with screenshots whether Aero TV and the stock launcher show it, then deletes it and is removed from the code. The result is a go / no-go research note in `docs/research/`; a go adds a follow-up story to the epic. Synthetic data only (no account data, no signed URLs); the probe is triggered over adb and guarded by `android.permission.DUMP` so no other app can call it; nothing of it ships.

**Owner decision (2026-11-03, during the spike):** Aero TV showed no Watch Next card but shows other apps' preview channels, so the probe was extended to one synthetic app preview channel with one program (same rules: synthetic, adb-only, deleted afterwards).

</frozen-after-approval>

## Implementation Notes

- Probe: a `BroadcastReceiver` guarded by `android.permission.DUMP` plus `WRITE_EPG_DATA` (normal permission; the first insert failed without it), platform `TvContract` (no new dependency). Ops insert / channel / query / delete over `adb shell am broadcast`.
- Result: Watch Next row inserted but not shown by Aero; a preview channel card is shown (also with `browsable=0`) and OK opens the app; no progress bar; after delete Aero keeps showing the card (its own cache). Stock launcher is in apps-only mode.
- Cleanup: provider rows deleted (0 channels, 0 Watch Next), probe code and permission removed, clean release-like build installed (`dumpsys` shows neither). Aero's cached card was left alone (not our data to clear).
- Deviations from the epic AC: a release-like build instead of a debug build (the probe was adb-only and removed); the platform `TvContract` instead of `androidx.tvprovider` (same provider, no new dependency); the intent URI opens `MainActivity` (no deep link into a video yet; that is Story 12.5); the progress field was written but Aero shows no progress bar.
- Outputs: `docs/research/watch-next-and-launcher-channel-spike.md` (go for an app channel, no-go for Watch Next), cropped screenshots without third-party posters or location, Story 12.5 added to `epics.md` and sprint status (backlog).

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | Story 12.5 inserted into the Epic List summary, not after Story 12.4; `### Epic 13` became `## Epic 13` | high | The anchor `## Epic 13: …` matched inside `### Epic 13: …` | patch: reverted, inserted before the detailed `## Epic 13` |
| 2 | Epic 12 summary / FR trace not updated for 12.5 | medium | No FR for the follow-up | patch: FR67, coverage map, summary, IMP-04 FR column |
| 3 | `epic-12-context.md` still plans a Watch Next port | medium | Lines on the port and the 12.1 → 12.4 dependency | patch |
| 4 | AC deviations not recorded | low | Notes listed results only | patch: deviation line |
| 5 | Spec `done` vs sprint `review` | false | The workflow sets spec done and sprint review at this step | rejected |
| 6 | «go» rests on the unverified Aero cache refresh | medium | Aero kept the card after the delete | patch: «go, with one open point», 12.5 starts with that device check |
| 7 | Residual synthetic card on the owner's TV | low | Cached by Aero | patch: documented with the removal path |
| 8 | Screenshot labels vs Method; crop hides Aero labels | low | Program fields differed from the Watch Next row | patch |
| 9 | Planning claim that Aero shows Watch Next unexplained | low | Other apps' cards were preview channels | patch: noted, untested variants listed |
| 10 | Reproducibility: versions, commands | low | Missing | patch |
| 11 | «permission is added» reads as done | low | It was removed with the probe | patch: «must be added in 12.5» |
| 12 | 12.5 AC miss sync rate, cap, API guard, deep-link validation, tests, Back options | medium | Planning AC were thin | patch |
