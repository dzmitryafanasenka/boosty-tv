---
title: 'Story 4.5: Finishing a video'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'e334d4cd2df9d6e1a9b1169b0479301d2eb0d75f'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** At the real end of a video the player stays paused on its last frame; the family has to press Back, and focus returns to the element that opened it, not to the next unwatched video (FR49; epics.md Story 4.5; focus-map G «Ended»; deferred-work 4.1 finding 14).

**Approach:** When the engine reports the end, the player writes the final position (as today) and exits to the origin at once — no autoplay. Coming from a Post, the return focus is the first unfinished MediaRow after the ended one (post order, finished = ≥ 95 % or < 30 s left), else the primary button. The return focus is written through FocusRestoration's `remember` for the Post route (the same channel the Player exit already uses; a one-shot `setReturnFocus` is never read by the Post's `peek`). «Просмотрено» and the absence from the Continue history already follow from the 4.2 finished rule (the Continue view, Story 4.7, lists unfinished entries only); playback is never interrupted when the threshold is crossed. Back / Stop exits keep returning to the origin element as before.

</frozen-after-approval>

## Implementation Notes

- `src/features/player/PlayerScreen.tsx`: new optional `onEnded`; `onEnd` reports `end` (as before), then calls it (no overlay, no autoplay). Without `onEnded` the old «stay paused at the end, play starts over» path remains (the app always passes it).
- `src/features/post/PostScreen.tsx` (+ index): pure `endedReturnFocusId(post, endedMediaId, snapshot)` — the first unfinished row after the ended one (finished via `progressStatus`, the row duration when the snapshot has none), else the primary id.
- `src/app/stackRoutes.tsx` `PlayerRoute`: `onEnded` reads the cached Post E8 (`queryKeys.post`) and the progress store snapshot, stores the target in `endedFocus`, pops; `beforeRemove` remembers `endedFocus ?? origin.focusId`. Only when the origin is that Post (focus id prefix).
- Tests: playerFlow «Story 4.5» (4 rows); the 4.2/4.1 rows that relied on staying at the end were adjusted; «play after the end starts over» and «a replay after the end is a new session» were removed (unreachable: the player leaves at the end).
- Docs: focus-map G «Ended» note, feature-parity POST-04, testing.md Story 4.5, deferred-work (4.1 finding 14 done).
- Checks: lint `--max-warnings 0`, typecheck, check:fixtures clean; `npm test` ×3: 1594 passed each.
- Device (agent, adb, release-like, owner-approved on the first feed video): quick → presses to the end → the Player left by itself → Пост, «Смотреть» focused, «Просмотрено». Review fixes: unit tests `src/features/post/__tests__/endedReturnFocus.test.ts` (6), `postIdPrefix` reused, docs and the PlayerRoute docstring updated; `npm test` ×3: 1600 passed each.

## Review Triage Log

| # | Finding (Blind Hunter) | Verdict | Route / evidence |
|---|---|---|---|
| 1 | The «stay paused at the end / replay from 0» path is dead in the app (always `onEnded`) and lost its tests | low | rejected: a documented default for `PlayerScreen` without `onEnded`; deleting it touches 4.2 code for no user benefit |
| 2 | `onEnded` returns early when the route is not focused, leaving the player at the end without an overlay | false | the Player is the focused route at the end: the sheet is a modal over it (the route stays focused), and `expired` resets the stack (the player unmounts) |
| 3 | The end leaves even with the settings sheet open or during a seek | low | rejected: a hold-scrub pauses playback (no end); the sheet closes on unmount (4.3); leaving at the natural end is the intent |
| 4 | `endedReturnFocusId` edge cases untested (not found, server-only, unknown duration, no rows) | low | patch: `endedReturnFocus.test.ts` (6 tests) |
| 5 | The row status rule is duplicated with PostScreen | low | rejected: one call of the shared `progressStatus`; a helper adds surface for two call sites |
| 6 | The origin prefix is built by hand | low | patch: `postIdPrefix` exported and used |
| 7 | focus-map G «Ended» main bullet still says `setReturnFocus` | low | patch: bullet rewritten (incl. that the primary may target an earlier unfinished video) |
| 8 | PlayerRoute docstring outdated | low | patch |
| 9 | testing.md points to device rows that do not exist; no counts | low | patch: device result and counts written |
| 10 | Blank lines left after removed tests | low | patch |
| 11 | A seek to the end marks the video watched and leaves | false | intended: FR49 (finished at the end), Story 4.5 exit at the real end |
| 12 | Returning to an earlier unfinished video via the primary is undocumented | low | patch: documented in focus-map (test 5 of `endedReturnFocus.test.ts` pins the primary id) |

