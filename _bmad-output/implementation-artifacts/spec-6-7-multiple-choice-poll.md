---
title: 'Story 6.7: Multiple-choice poll'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: 'b83dc22ffec7c96500030cbf4c2f954da8345c1a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-6-vote-and-retract-in-a-single-choice-poll.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A multiple-choice poll is still display-only: one inert stop (Story 6.6), so the user cannot answer it (FR57, POLL-03, POLL-04, POLL-05; epics.md Story 6.7).

**Approach:**
- **Open multiple-choice poll, not voted** (`isMultiple`, `!isFinished`, `answer` empty):
  - Each option is a stop (`post/<postId>/poll/option/<optionId>`). OK toggles a local check; there is no pending step.
  - «Проголосовать» (`post/<postId>/poll/submit`) sits under the options. It is disabled and not focusable while nothing is checked. OK on it sends E11 with every checked id, comma-joined in option order, with no extra confirmation (the checks are the deliberate step).
- **Voted** (`answer` non-empty):
  - The results show with the accent checks, as in the reference (`isMultipleUnVoted`). The options are not focusable rows.
  - «Отозвать голос» (`post/<postId>/poll/retract`) is the poll's only stop. It needs two OKs: the 1st is pending (the pulsing outline and «Нажмите OK ещё раз, чтобы отозвать» on the button), the 2nd sends E12. Moving focus cancels pending.
- Every 2xx reuses 6.6: E10, then `applyPoll`; an E10 failure invalidates the post's E8. Single flight per poll and account generation, the inline error, the previous state kept, no retry.
- A finished multiple-choice poll stays one inert stop.

**Decisions:**
- **Focus after a vote:** «Проголосовать» is replaced by «Отозвать голос», and focus moves to `/poll/retract`. After a retract, focus moves to the first option. Otherwise the 6.6 fallback applies (another option, then the poll block, then initial).
- **Local checks:**
  - They live in the widget, keyed by option id. Ids missing from a refetched poll are dropped.
  - They are cleared after a successful vote, and lost when the post unmounts (never persisted).
  - They are kept when the vote fails.
- **Check visual:** each option shows a check box at the left, an empty outline or an accent fill (`poll-option.chosenMark`). It is distinct from the answered state's accent check, which shows only after the vote.
- **Live:** no multiple-choice sample exists (Story 6.5 scan: 1 single-choice poll in 493 posts). Multi-id E11 and the multi `answer` stay unverified live (`REF`), and are tested with fixtures and the demo.

## Boundaries & Constraints

**Always:**
- Reuse `usePollVote`, `applyPoll`, `PollRepository.vote(http, pollId, ids[])` and the 6.6 option stop styles (padding, ring, no scale).
- Use option ids, never indices.
- Copy goes in `ru`: «Проголосовать», «Отозвать голос», and the a11y «отмечено» / «не отмечено».
- Accessibility: each option is a checkbox (`accessibilityRole="checkbox"`, `accessibilityState.checked`). The disabled «Проголосовать» is `disabled`.

**Never:**
- Optimistic updates or automatic retries.
- Changing the single-choice behavior of 6.6.
- A pending step on option toggles.
- Voting live without the owner's permission.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Toggle | multi, no answer; OK on 1, OK on 3, OK on 1 | only 3 checked; nothing sent | — |
| Submit disabled | nothing checked | «Проголосовать» shown disabled, not focusable | — |
| Vote | 1 and 3 checked; OK on «Проголосовать» | sending, then E11 `answer=1,3`, then E10; results with checks; «Отозвать голос» focused | — |
| Vote fails | E11 error | inline error; checks kept; 1 request | the next OK clears the error |
| Retract | answer [1,3]; OK, OK on «Отозвать голос» | pending hint, then E12, then E10; options with no checks; focus on the first option | failure → inline error, vote kept |
| Cancel retract | OK on «Отозвать голос», then ↑ (nothing focusable above in the poll) | pending cleared when focus leaves | — |
| Finished multi | `isFinished` | one inert stop (6.5) | — |

</frozen-after-approval>

## Code Map

- `src/shared/entities/poll/mapPoll.ts` -- `isVotablePoll` is single-choice only today. Add `isMultipleVotable(poll)` (`isMultiple && !isFinished`) next to it, and export it.
- `src/features/polls/PollWidget.tsx` -- the dispatcher picks the mode: `VotablePoll` (6.6, single), a new `MultiplePoll` (open multiple), else `PollDisplay`. `MultiplePoll` has two cases:
  - unvoted: option stops with a check box, plus a `Button` for submit;
  - voted: result rows (reuse the display row markup) plus the retract `Button`, with the 6.6 pending outline and hint.
  Keep the 6.6 `PollOptionStop` intact. Factor the row content into a shared piece only if it stays small.
- `src/features/polls/usePollVote.ts` -- `submit(mutation, optionId)` sends one id. Generalize it to `submit(mutation, optionIds: string[], focusKey)` (or add `submitMany`), keeping the 6.6 callers' behavior and its tests. `sendingOptionId` becomes the key of the control that sent: an option id, `submit` or `retract`.
- `src/features/post/PostScreen.tsx` -- `postPollSubmitId` and `postPollRetractId` (`post/<postId>/poll/submit|retract`). `firstStopId` gets the open multi poll's first option, or its retract button when voted. Focus after a multi vote or retract uses the existing focus request helper (see how 6.3 returns focus to a chip: `requestHostFocus`). The refetch fallback already covers the `poll/` prefix; check that submit and retract fall back to the poll's stops.
- `src/features/post/PostBody.tsx` -- passes `pollVote` as before; add any id builders needed.
- `src/shared/ui` -- reuse `Button` (`src/shared/ui/Button.tsx`) for submit and retract if its disabled/pending styling fits; else a FocusableSurface like the option stop. Use the `CheckIcon` for the box fill.
- `src/shared/i18n/ru.ts` -- `poll.submit`, `poll.retract`, `poll.a11yChecked`, `poll.a11yUnchecked`, `poll.pendingRetract` (reuse).
- `src/app/dev/demo.ts` -- make a demo multiple-choice poll open, answering E10–E12 in memory (the 6.6 demo transport handles multi ids).
- `src/test/fixtures/boosty/` -- a synthetic multi E10 fixture (`isMultiple: true`, `answer` two ids), marked synthetic in the docs.
- Do not change: the 6.6 single-choice flow, `applyPoll`, `PollRepository`.

## Tasks & Acceptance

**Execution:**
- [x] `isMultipleVotable`, `usePollVote` multi-id submit (6.6 tests unchanged and passing), PollWidget `MultiplePoll`, PostScreen ids/first stop/focus moves, copy, demo, fixture.
- [x] Tests: every matrix row (`PollWidget.test.tsx` «Story 6.7», `__tests__/postFlow.test.tsx` «Story 6.7» through E8 with FixtureTransport, incl. focus to retract after the vote and to the first option after the retract), the E11 body `answer=1,3`, single flight, a11y roles and states, the demo multi vote in `demoFlow`.
- [x] Docs: feature-parity POLL-03/04/05 (Android), focus-map I «multiple choice» (as built), api-contract «Poll votes» (multi unverified live), testing.md Story 6.7.
- [x] Device (release-like, adb): the demo multi poll in a debug demo build if no live sample (toggle, disabled submit, vote, retract); screenshots to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then everything passes; the touched suites pass 30/30; lint `--max-warnings 0`, typecheck and `check:fixtures` are clean.
- Given an open single-choice poll, when 6.6's flows run, then they behave exactly as before (6.6 tests untouched except for shared-signature updates).

## Implementation Notes

- **Not done by the dev agent (orchestrator steps):** every device/adb task (the demo multi poll in a debug demo build: toggle, disabled submit, vote, retract; screenshots). `docs/testing.md` «Story 6.7» says so; add the device rows there after the run.
- `usePollVote.submit(mutation, optionIds, sendingKey)`; `sendingOptionId` is now `sendingKey` (an option id for single choice, `submit` / `retract` for multiple choice). The 6.6 caller passes `[optionId], optionId`; 6.6 tests are unchanged except `postFlow` «Story 6.6» «Finished / multiple», whose open-multiple case became a finished multiple-choice poll (an open one is votable by design now).
- PollWidget: the dispatcher picks `MultiplePoll` when the vote props plus `submitId`/`retractId` are given and `isMultipleVotable`. `MultiplePoll` holds `usePollVote` (so the inline error survives the voted ↔ not-voted switch) and renders `MultipleChoice` (checks in local state, by option id; pruned when a refetch drops an id; gone when it unmounts on a vote or with the post) or `MultipleVoted` (result rows via the factored `ResultRow`, shared with the 6.5 display, and the retract stop).
- Submit / retract are a local `PollActionStop` (FocusableSurface with the `button-primary` / `button-secondary` token colors, no scale, vertical padding like the option stops), not `Button`: `Button` has no `onBlur` (pending cancel) and no pending outline/hint. A disabled «Проголосовать» uses `surface-raised` with `text-disabled` (the poll's own background is `surface`, where Button's disabled `surface` would vanish).
- Check box: 20 dp, 2 dp `text-secondary` outline, or an accent (`poll-option.chosenMark`) fill with an `accent-ink` tick; testIDs `<block>/option/<id>/box` and `/checked` (the answered state keeps `/chosen`).
- **Device fix (coordinator, 2026-10-29):** on the Chromecast the vote unmounted the focused «Проголосовать» and Android moved focus to the author (column scrolled to the top; a JS request could not repair it); a retract turned the focused button into a disabled submit, same result. Now `MultiplePoll` renders ONE `PollActionStop` (key `action`, after the voted/choice switch) whose mode follows the poll (submit ↔ retract); the checks, pending and `usePollVote` live in `MultiplePoll` (the `MultipleChoice` / `MultipleVoted` parts are gone). `PollActionStop` tracks its focus; when `focusId` changes while focused it re-runs zone `onFocus` + `onFocus(newId)` in a layout effect (before PostScreen's fallback effect); the ref callback changes with the id, so the old id is unregistered and the same view registered under the new one. Retract under focus: the mode switch is detected during render (state from the previous render) and starts a hand-off in the same render: the control is drawn disabled but stays focusable (`keepFocusable`), `requestHostFocus` targets the first option, and the hand-off ends when an option reports focus, the control blurs, or after `HANDOFF_MAX_FRAMES` (10) frames. Known gap: during the hand-off Pressable reports `accessibilityState.disabled: false` (the surface is not `disabled`). PostScreen's fallback stays as a safety net. Also renamed the `focus` parameter of the orchestrator's `focusAfterUnmount` to `moveFocus` (lint `no-shadow` warning).
- **Review fixes (2026-10-29):** `focusLaidOut` takes the candidate ids and resolves the first mounted one inside the frame (else `focusInitial`), so a view replaced meanwhile is never targeted; the hand-off's give-up only stops the requests (the control stays focusable until it blurs or an option reports focus); `sending` shows for either multiple-choice key (the mode may flip mid-request); the last unvoted option's label adds `poll.submitHint` before the voters line; the dead `ids.length === 0` demo branch is gone. Tests: `focusAfterUnmount` retry (postFlow), deferred frames before the «Vote» / «E10 fails» assertions, the drawn-disabled check on the control's own text color and surface; `demoFlow` now moves focus to the first option after the retract (the control stays focusable until then).
- **Frame deferral (coordinator, device root cause):** a focus request to a view mounted in the same commit (no layout yet) scrolls the column to y = 0, so the retract hand-off requests the first option from frame 2 (`HANDOFF_FIRST_FRAME`) every frame until an option reports focus (giving up at 10), and PostScreen's poll fallback waits two frames (`focusLaidOut`) and moves focus only if the tracked id is still the vanished stop or the author (Android's fallback). Tests count frames with a manual `requestAnimationFrame` queue in `postFlow` (`queueFrames` / `frames(n)`): the RN preset's rAF is a 0 ms timeout, and a fake-timer advance runs a whole chain of them at once.
- Focus after a vote / retract (superseded by the device fix above for the normal path): no new focus request path; PostScreen's refetch fallback orders its candidates by the vanished id: `…/submit` → `…/retract`, then the options, then the block stop; anything else → the options, `…/retract`, the block stop; then the initial element. This also covers an E10 failure (the E8 refetch brings the voted poll). `firstStopId`: the first option of an open unvoted multi poll, or `…/retract` when voted.
- The retract stop's a11y label carries the poll summary (`pollAccessibilityLabel`), since the result rows are not focusable.
- Demo: open demo polls with n % 8 = 5 (`demo-post-5`) are multiple choice (4 options, not voted); answers in a separate in-memory map. `demoFlow` votes and retracts, so the module state ends where it started.

- Orchestrator, device (2026-10-29, debug demo build, adb; `DEMO_MODE` reverted): toggle, submit, vote, retract seen on «Демо-пост 6». Two device bugs fixed: the focused submit was unmounted on a vote (Android moved focus to the author, the column jumped to the top) → one action control that changes mode in place; a focus request to a freshly mounted view (no layout) scrolled the column to y = 0 → the hand-off and the poll fallback (`focusLaidOut`) request focus from the second frame. The release-like build was not used (demo is debug-only).

## Spec Change Log

## Review Triage Log

Iteration 0 (layers: blind-hunter 15, edge-case-hunter 8, verification-gap 2 gaps + 3 other).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge, vgap | The shared refetch fallback (also 6.6's vanished option) is now deferred two frames; undocumented; the 6.6 focus-map row is stale | low | patch | A device fix of the shared fallback (a fresh view's focus scrolled the column to the top), not a 6.6 voting change; docs updated. |
| 2 | vgap, blind | The generalized `focusAfterUnmount` retry is never exercised by a test | medium | patch | No `queueFrames` test on the paragraph/row path. |
| 3 | vgap | «No focus request after a vote» cannot see a deferred request | medium | patch | Frames never run in those tests. |
| 4 | blind, edge | Deferred callbacks use a captured view that may be dead | low | patch | `nearby` is captured before two frames; re-resolved in the frame. |
| 5 | blind, vgap | Verification numbers contradict across spec and testing.md | false | reject | The orchestrator re-ran the full suite on the final tree with `DEMO_MODE = false`: ×3 2316, ×30 287; the spec's Verification is updated at finalize. |
| 6 | blind, vgap | testing.md says focus is requested on retract after a vote | low | patch | Pre-fix wording; the tests assert no request. |
| 7 | blind | Spec notes and Code Map stale | low | reject | Fix is a spec edit. |
| 8 | blind | Spec status vs sprint status | false | reject | Statuses move at finalize. |
| 9 | blind | a11y `disabled: false` during the hand-off | low | reject | A few frames, focused control only; not everyday. |
| 10 | blind | Weak «drawn disabled» assertion | low | patch | Test-only, direct. |
| 11 | blind, edge ×2 | 2xx vote but the refetch shows no `answer`: checks stay, submit enabled | low | patch (docs) | Treated as not recorded (the server state wins); a resend is the user's choice; documented as a risk (multi-id E11 unverified live). |
| 12 | blind | `answer` ids matching no option | low | reject | Needs a server quirk; voted mode with no checks is harmless. |
| 13 | blind | No TalkBack hint that a submit step follows | low | patch | One label part. |
| 14 | blind | Demo: no test reset; dead `ids.length === 0` | low | patch (dead code) / reject (reset) | Deletion is direct; the reset is demo-test hygiene only. |
| 15 | blind | Demo shows no voted/finished multi on first load | low | reject | Covered by fixtures and host tests. |
| 16 | blind | Fixture has `other` but no `voters`; untested tolerance | false | reject | `voters` is left out on purpose (content never logged); `mapPoll` ignores unknown keys (6.6 live shape). |
| 17 | edge | Hand-off give-up turns the focused control non-focusable | medium | patch | Reproduces the device bug when an option never reports focus. |
| 18 | edge | `focusLaidOut` only treats the author as Android's fallback | false | reject | The author is always the column's first focusable (header). |
| 19 | edge | Spinner hidden if the mode flips mid-request | low | patch | Direct condition fix. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean.
- `npm test` ×3 -- expected: all pass.

**Result after the device fix (dev agent, 2026-10-29):** lint and typecheck clean; the touched suites (`src/features/polls`, `src/shared/entities/poll`, `postFlow`, `demoFlow`) 262/262, run with a scratch Jest config that mocks `appConfig` to `DEMO_MODE = false` (the working tree has the orchestrator's `DEMO_MODE = true // TEMP67 REVERT`, which breaks the non-demo flow suites). The full suite ×3 / 30× were not re-run (coordinator: only the tests covering the edit).

**Result (dev agent, 2026-10-29, before the device fix):** lint, typecheck, check:fixtures clean; `npm test` ×3: 2312 passed each; `src/features/polls` + `src/shared/entities/poll` + `postFlow` + `demoFlow` + `checkFixtures` ×30: 283 passed each run, 0 failed runs. Device checks not run (orchestrator).

**Final result (orchestrator, after the review patches, 2026-10-29, `DEMO_MODE = false`):** lint, typecheck, check:fixtures clean; `npm test` ×3: 2319 passed each; `src/features/polls` + `src/shared/entities/poll` + `postFlow` + `demoFlow` + `checkFixtures` ×30: 290 passed each run, 0 failed runs. Device (debug demo build, adb) was checked before the review patches (hand-off give-up, in-frame re-resolve, the TalkBack hint); those patches are host-tested only. The installed release-like build includes 6.7 up to the device fixes, not the review patches.
