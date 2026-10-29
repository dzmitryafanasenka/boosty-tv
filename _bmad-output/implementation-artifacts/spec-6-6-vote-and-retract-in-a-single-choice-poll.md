---
title: 'Story 6.6: Vote and retract in a single-choice poll'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: '01b7faf3ba559a0c310ed6716e4af9ca3a99dd2e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A poll in a post is read-only (Story 6.5), so the user cannot vote or retract (FR41, POLL-02, POLL-04; epics.md Story 6.6).

**Approach:**
- In an **open single-choice** poll, each option becomes a focus stop (`post/<postId>/poll/option/<optionId>`), with the PollOption states default, chosen, pending, sending and inline error.
- 1st OK → pending: a pulsing accent outline plus «Нажмите OK ещё раз». On the chosen option it reads «Нажмите OK ещё раз, чтобы отозвать».
- 2nd OK on the same option → E11 vote (form `answer` = the option id). On the chosen option it sends E12 retract instead. Moving focus off the option cancels pending. The two-OK confirmation is our improvement: the reference votes on one click.
- After a 2xx, send E10 and apply its poll through `entities/poll.applyPoll` to every cached post and list page holding that poll. Focus stays on the option. The E11/E12 bodies are ignored.
- A finished poll, and a multiple-choice poll (6.7), stay one stop with OK inert.

**Decisions:**
- Mutation failure: an inline error under the poll («Не удалось отправить голос» / «Не удалось отозвать голос»), the previous state kept, no automatic retry, and no replay after a 401 (HttpClient already refuses).
- Single flight per poll id, app-wide. While a request runs, OK on any option of that poll is ignored. The error clears on the next OK.
- E10 fails after a 2xx mutation: invalidate that post's E8 query. The poll then comes back with the post and no error is shown (the vote did succeed).
- `applyPoll` keeps each query's `dataUpdatedAt`, so a vote never delays the feed-head refresh.
- An open single-choice poll as the post's first stop: initial focus is its first option. A stray OK only reaches pending.
- The E10 response shape (`data.poll`?) is verified with a read-only live GET before relying on it, recorded in api-contract «Polls (LIVE)».
- Owner decision 2026-10-29 (Q1 a, reference parity): when the user has voted, OK, OK on a different option sends E11 with that option, with the same pending hint «Нажмите OK ещё раз». If the server refuses, the inline error is shown and the previous state is kept.
- Owner decision 2026-10-29 (Q2 a): the agent may vote on, then retract, the live poll (Стас Асафьев) from the app on the device, to verify E11, E12 and E10 live. The vote must be retracted afterwards.

## Boundaries & Constraints

**Always:** Option ids, never indices. Pure `applyPoll`, which tolerates any cache shape. Copy in `ru`, tokens from `poll-option`. Focus moves by native/explicit targets; ↑ ↓ between options, ← the sidebar. Never log poll ids, option text or titles beyond what httpClient already logs (path only).

**Never:**
- Multiple-choice voting or «Отозвать голос» (6.7).
- Optimistic updates.
- Automatic retries.
- New endpoints beyond E10–E12.
- A separate poll query key.
- Voting on the live poll without the owner's explicit permission.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Vote | open single, no answer; OK, OK on option 2 | pending, then sending, then E11 `answer=2`, then E10; results update, check on 2, focus on 2 | — |
| Cancel | OK on 1, then ↓ to 2 | 1 leaves pending; nothing sent | — |
| Retract | answer [2]; OK, OK on 2 | pending «…чтобы отозвать», then E12, then E10; no check | — |
| Mutation fails | E11 → network/5xx/429 | inline error, previous state, 1 request only | next OK clears the error and starts pending again |
| Double press while sending | 3rd OK during the request | ignored; still 1 request | — |
| E10 fails | E11 200, E10 error | post's E8 invalidated; no error shown | — |
| Change vote | answer [1]; OK, OK on 2 | pending «Нажмите OK ещё раз», then E11 `answer=2`, then E10 | server refusal → inline error, previous state |
| Finished / multiple | `isFinished` or `isMultiple` | one stop, OK inert (6.5 behavior) | — |

</frozen-after-approval>

## Code Map

- `src/shared/entities/poll/pollRepository.ts` (new) -- `fetchPoll(http, blogUrl, pollId)` (E10 `GET /v1/blog/{blogUrl}/poll/{pollId}`, `mapPoll`), `vote(http, pollId, optionIds)` (E11 `request({method:'POST', form:[['answer', ids.join(',')]]})`), `retract(http, pollId)` (E12 DELETE). Path segments `encodeURIComponent`. Reuse `blogUrlSchema` validation as `postPath` does.
- `src/shared/entities/poll/applyPoll.ts` (new) -- `applyPoll(client, poll)`: walks the query cache roots `post` (`PostResult {kind:'ok', post}`), `feed`, `search` and `authorPosts` (`InfiniteData<PostPage>`). It replaces `post.poll` where `post.poll?.id === poll.id`, via `setQueryData(key, next, {updatedAt: query.state.dataUpdatedAt})`. A query with no match is left untouched (same object).
- `src/shared/api/dto/post.ts` -- reuse `pollDtoSchema`. Add a lenient E10 envelope schema per the live probe.
- `src/features/polls/usePollVote.ts` (new) -- a hook with a module-level `inFlight: Set<pollId>`: `submit(option)` → vote or retract, then E10 → `applyPoll`, or E10 failure → `invalidateQueries(queryKeys.post(blogUrl, postId))`. It returns `{sending, error}`. It needs `http`, `blogUrl`, `postId` and `queryClient` (`useQueryClient`).
- `src/features/polls/PollWidget.tsx` -- votable mode (`!isFinished && !isMultiple`): the root is not focusable, each option is a `FocusableSurface` stop (ring, no scale), using `useZoneItem`/`onView`/`onFocus` per option id. Local `pendingId` is cleared on blur and after a request ends. Sending shows a spinner in the option. Per-option a11y label: text, percent, count, «ваш выбор», hint. The display mode stays as in 6.5.
- `src/features/post/PostBody.tsx` (`case 'poll'`, ~l.945) -- pass `postId`, `blogUrl` and `http` (thread from `PostScreen`), plus the option id builder.
- `src/features/post/PostScreen.tsx` -- `postPollOptionId(postId, optionId)`. `firstStopId` (~l.302): a votable poll item → its first option id.
- `src/shared/entities/post/postBody.ts` -- export `isVotablePoll(poll)` (or put it in `entities/poll`). `isFocusStop` stays true.
- `src/shared/i18n/ru.ts` -- `poll.pendingVote`, `poll.pendingRetract`, `poll.voteFailed`, `poll.retractFailed`, `poll.sending` (a11y).
- `src/shared/ui/tokens.ts` `poll-option` -- `pendingOutline: colors.accent` if missing. Reuse the existing pulse/spinner primitives in `shared/ui` (check `ActivityIndicator` usage in StateView).
- `src/test/fixtures/` + `scripts/check-fixtures` -- an E10 fixture (sanitized; `check:fixtures` allows only 0/100 for `fraction`).
- `src/app/dev/demo.ts` -- a demo transport answering E10–E12 for the demo open poll.
- Do not change: `httpClient` retry rules, the `mapPoll` drop rules, Story 6.5's display mode.

## Tasks & Acceptance

**Execution:**
- [x] Live read-only E10 probe on the live poll (`__DEV__`, keys/types only, removed); api-contract «Polls (LIVE)» E10 row. On the device (Q2 a): vote, change the vote (Q1 a), retract; record the E11/E12 statuses and the E10 `answer` after each step; the vote ends retracted.
- [x] `pollRepository`, `applyPoll`, the E10 schema; unit tests: paths, form body, no retry on a mutation, `applyPoll` over post/feed/search/author caches, an untouched miss, `updatedAt` kept.
- [x] `usePollVote` + PollWidget votable mode + PostBody/PostScreen wiring + copy/tokens + demo; tests: every matrix row (`PollWidget.test.tsx`, `__tests__/postFlow.test.tsx` «Story 6.6»), single flight, focus stays on the option after apply.
- [x] Docs: feature-parity POLL-02/04 (Android), focus-map I (as built), testing.md Story 6.6, api-contract.
- [x] Device (release-like, adb): pending/cancel, vote, change, retract on the live poll (ends retracted); screenshots to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then everything passes; the touched suites pass 30/30; lint `--max-warnings 0`, typecheck and `check:fixtures` are clean.
- Given an open single-choice poll on the device, when I press OK once and then ↓, then nothing is sent (adb log shows no E11).

## Implementation Notes

- **Not done by the dev agent (orchestrator steps):** the read-only live E10 probe and every device/adb task (pending/cancel, vote, change, retract on the live poll). The code follows the documented E10 shape `data.poll` with a lenient schema (`pollRefreshDtoSchema`: other keys ignored, `poll` through `mapPoll`). If the live shape differs, E10 fails as `Parse` and the post's E8 is invalidated, so the poll still refreshes (no error shown); then adjust the schema and record the shape in api-contract «Polls (LIVE)».
- `e10-poll.json` is synthetic in the reference shape (not live-sanitized); `check:fixtures` now checks `answer` elements as ids. Replace/confirm after the probe.
- Option id builder: PostBody passes `pollVote = {http, blogUrl, postId, optionIdPrefix}` (memoized in PostScreen; prefix `post/<postId>/poll/option/`, built by `postPollOptionPrefix`/`postPollOptionId`), and PollWidget appends the option id. Inner testIDs (`/bar`, `/chosen`, `/pending`, `/sending`, `/outline`) stay under the block id `post/<postId>/block/poll:<id>/option/<optionId>/…` in both modes.
- Tokens deviation: the pending outline values are local constants in `PollWidget.tsx` (accent, 2 dp, 1.2 s pulse to opacity 0.35; steady with reduced motion), not `tokens.ts` `poll-option.pendingOutline`: `tokens.test.js` requires `tokens.ts` to match the DESIGN.md frontmatter exactly, and DESIGN.md has no pending tokens. Adding them to DESIGN.md is a design-doc change left to the owner.
- Single flight: a module-level `Map<pollId, optionId>` read through `useSyncExternalStore`, so every widget of the same poll shows the spinner and ignores OK. The error is per widget. Pending clears on blur and when a request starts.
- PostScreen: `firstStopId` → the first option of a votable poll that is the first stop; the refetch focus fallback also covers `post/<postId>/poll/…` ids.
- Demo: open demo polls keep the demo user's choice in memory and answer E10–E12 (E11 with an unknown option → 400).
- Orchestrator, live (2026-10-29, debug build + `TEMP66` probe, removed): E10 is `data.poll` as documented (the schema needed no change); options carry an extra `voters` object; `answer` (numbers) and `other` (string) appear only after a vote. Vote, vote change (Q1 a: the server moves the vote) and retract each returned HTTP 200 once; the poll ended retracted. The fixture got the live `other` key (values stay synthetic; `voters` left out, its content was not logged).
- Device fix: the focused option's ring was cut at the column's bottom (a margin between option stops); the stops now use vertical padding, as the 6.5 widget did. Seen whole on the release-like build.
- Device observations for the review: the pending hint grows the option, and at the column's bottom its lower part is clipped (the column does not re-scroll); the voters line under the last option is mostly off-screen while that option is focused.

## Spec Change Log

## Review Triage Log

Iteration 0 (layers: blind-hunter 14, edge-case-hunter 8, verification-gap 2 gaps + 2 other).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, device | The pending hint adds a line: the option grows and is clipped at the column bottom | medium | patch | Seen on the release-like build; the hint moves into the row in place of the result text. |
| 2 | blind | The votable labels never say «Проголосовали: N» | medium | patch | Only option 0 gets a prefix; no label has `votersText`; the line is off-screen with the last option focused. |
| 3 | blind | The inline error is not announced | low | patch | No live region; focus stays on the option. One prop. |
| 4 | blind | The first option's label uses the raw title, not «untitled» | false | reject | Same as the 6.5 display label (the prefix «Опрос» is said once; an empty title is filtered). |
| 5 | blind, edge ×2 | An in-flight E11→E10 after sign-out / account switch can write the old account's `answer`; `inFlight` can block the new account | medium | patch | `applyPoll` runs on the captured client with no reset check; AccountScope offers `generation()`. |
| 6 | blind, edge ×2, vgap | A vanished focused option sends focus to the post's top, not to the poll; untested | medium | patch | The fallback calls `focusInitial()`; CLAUDE.md asks for a nearby fallback; vgap: no flow test reaches it. |
| 7 | blind | No test for the reduced-motion / loop-stop outline | low | reject | No defect shown; `loop.stop()` runs in the effect cleanup. |
| 8 | blind | No test for unmount during a request | low | reject | `mounted` ref and `finally` release; no defect shown. |
| 9 | blind | Focus restore on return with the new ids is untested | maybe-false | reject | An option opens no route (OK only votes); only a pop leaves Пост, which drops it. Would be `low`. |
| 10 | blind | `labelPrefix` array literal defeats the memo | low | patch | A direct `useMemo`. |
| 11 | blind | The 401 test asserts neither kind nor renew | low | patch | Test-only, direct. |
| 12 | blind | Spec status vs sprint status; stale Code Map | false | reject | Statuses move at finalize; the Code Map fix is a spec edit. |
| 13 | blind | POLL-05 Tests column stale | low | patch | Docs, direct. |
| 14 | blind | Pending-outline values not in DESIGN.md, untracked | low | defer | Owner-owned design doc. |
| 15 | vgap | Demo E10–E12 untested | medium | defer | As filed: dev-only demo. |
| 16 | vgap | Fixture invents `voters: {data, extra}`; docs say it is left out | medium | patch | Live logged only the type `object`; the keys are invented. |
| 17 | vgap | Stale «createFixtureSanitizer» comment in `check-fixtures.mjs` | low | reject | Pre-existing, not caused by this story. |
| 18 | edge | Error not cleared when OK hits while another instance sends | low | reject | Needs the same poll in two mounted posts sending at once; not everyday. |
| 19 | edge | Stale error after another instance's success | low | reject | Same two-instance precondition. |
| 20 | edge | E10 and the E8 fallback both fail → old state, no error | low | reject | A repeat OK sends E11 with the same option, which the server keeps (live: a vote moves, never doubles). |
| 21 | edge | E10 failure invalidates only the post key; list caches stale | false | reject | List cards show no poll results (only the «Опрос» badge); a reopened post reads its own E8. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean.
- `npm test` ×3 -- expected: all pass.

**Result (after the review patches, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 2286 passed each; `src/features/polls` + `src/shared/entities/poll` + `postFlow` + `demoFlow` + `checkFixtures` ×30: 257 passed each run, 0 failed runs. Release-like build with the patches on the pinned device (adb): the pending hint sits in the option's row in place of the result (no height change), ↑ cancels it and the result returns; the focused option's ring is whole.
