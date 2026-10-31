---
title: 'Epic 8 retro A6: platform probes before the spec'
type: 'chore'
created: '2026-10-31'
status: 'done'
route: 'oneshot'
baseline_commit: '0f7e6d0802201a7cc7d48c5e8abb2ae3071628f0'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In Epic 8 the planning text was wrong about Android platform behaviour in two of three stories (the 8.2 chooser, 8.3 internal storage), and both were found only on the device (Epic 8 retro process lessons, `epic-8-retro-item-44`).

**Approach:** Add a rule to `docs/testing.md`: a story that depends on Android platform behaviour probes it on the pinned device at spec time, first with shell and then from inside the app, and records the result in the spec. Also add the device rule learned in the 8.3 and A3 runs: the first key of a batch can be lost on a fresh screen.

</frozen-after-approval>

## Implementation Notes

- `docs/testing.md`: a new section «Platform probes before the spec (Epic 8 retro A6)» after «Device rules», plus one Device rule («Check where focus went after the first key of a batch»).
- Docs only, no code. Checked the commands it names against this session's device runs: `pm query-activities`, `run-as`, `dumpsys package` and the `BTVPROBE` logcat probe in Story 8.2.
- No review layer: a short docs-only addition whose facts come from the recorded 8.2 and 8.3 device runs.
