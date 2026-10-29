---
title: 'Story 6.5: Poll display'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: '3f6651b73352b6c1e1b4d8c637bdae463cf39f39'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A post's poll shows only the «Опрос» placeholder, so the question, its options and the results are invisible (FR40, POLL-01/05; epics.md Story 6.5).

**Approach:**
- A **PollWidget** (new `features/polls`, exported from `features/polls/index.ts` and used through the allowed post → polls edge) shows:
  - the title;
  - each option with a result bar and a percentage;
  - the voter count;
  - the user's own choices (an accent check);
  - for a finished poll, «Опрос завершен».
- The data is the `poll` inside the cached post. There is no separate poll query key, and no write path in this story.
- The widget is **one focus stop** with its options not focusable. This holds in 6.5 for every poll, finished or not. Voting (6.6, 6.7) makes the options of an open poll focusable later.

**Decisions:**
- Domain `Poll {id, title (joined), isMultiple, isFinished, counter, answer: string[], options: [{id, text, counter, fraction}]}`, with string ids.
- The mapper degrades to the «Опрос» placeholder when the poll itself is unusable: no `id`, `isMultiple` or `isFinished`, or no valid option left. Owner decision 2026-10-29 (option a, reference parity): an option without `id`, `counter` or `fraction` is dropped on its own and the rest of the poll is shown. It never crashes.
- Results are always visible, also before voting, as in the reference.
- Parity correction (review 2026-10-29, POLL-01 «per-option counter and percentage», confirmed): each option also shows its vote count next to the percent (e.g. «48 % · 1 210»); voter and option counts use a thousands separator.
- Percent text: `fraction`, as the API gives it, rounded to an integer.
- The bar width is `fraction`%, clamped to 0…100.
- The voter line reads «Проголосовали: N» (plural-safe form; the reference's «Проголосовал: N» is ungrammatical for N ≠ 1).
- **Placement:**
  - where the post's `poll` block sits in `data` when there is one;
  - else after the body, as the reference renders `post.poll` below the content.
  - The live probe decides which case applies.
- A locked post's teaser shows no poll (Story 3.6 rule).
- Before relying on it, find a live sample (debug build, counts, keys and types only, never titles or option text, removed before the commit). Scan the owner's feed and subscribed blogs for posts with `poll` (top-level) and/or a `poll` block. Record:
  - where the poll lives;
  - the keys and types (`fraction` an integer percent? a float?);
  - whether `answer` and `counter` are present.

  Record «Polls (LIVE)» in `docs/api-contract.md`. If no sample exists, implement from the reference shape with a synthetic, marked fixture, and record polls as unverified live (the epic context allows this).

## Boundaries & Constraints

**Always:**
- Pure mapping; nothing throws.
- The poll's identity is its `id`; never use an index as the key.
- Focus moves by explicit targets. Initial focus is unchanged: the poll is a stop in body order.
- Copy goes in `ru`; tokens come from `shared/ui` (`poll-option`).

**Never:**
- Voting, retracting, E10, E11 or E12 (Stories 6.6–6.7).
- Focusable options in this story.
- Inventing fields the live data does not carry.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open poll | poll with 3 options, `answer` [] | title, 3 rows with bars and %, «Проголосовали: N»; one focus stop | — |
| My choice | `answer` contains option 2 | option 2 carries the accent check | — |
| Finished | `isFinished` true | «Опрос завершен», results; one stop | — |
| Malformed option | one option without `fraction` | that option dropped, the poll shown | every option invalid → the «Опрос» placeholder |
| Zero voters | `counter` 0, all fractions 0 | 0 % bars, «Проголосовали: 0» | — |
| Locked post | `hasAccess` false with a poll | no poll in the teaser | — |

</frozen-after-approval>

## Code Map

- `src/shared/api/dto/post.ts` -- a lenient `pollDtoSchema` (reference shape, §4.2). The post schema reads the top-level `poll`. The `poll` block keeps its id.
- New `src/shared/entities/poll/` (`types.ts`, `mapPoll.ts`, `index.ts`, tests) -- the domain `Poll`. `mapPoll(dto) → Poll | null` (null when the reference would drop it).
- `src/shared/entities/post/types.ts`, `mapPost.ts` -- `Post.poll: Poll | null`.
- `src/shared/entities/post/postBody.ts` -- a `{kind:'poll'; key: 'poll:<id>'; poll}` item at the block's position, or appended after the body when only the top-level poll exists (per the probe). Not added in a teaser. `isFocusStop` includes it. A malformed poll stays a placeholder.
- New `src/features/polls/PollWidget.tsx` (+ `index.ts`) -- a FocusableSurface stop (ring, no scale, as ImageStop) containing the title, rows (text, bar on `poll-option` tokens, «N %»), the accent check for `answer`, the voter line and «Опрос завершен». The accessibility label is a readable summary (title; each option with its percent and «ваш выбор»; the voter count; finished).
- `src/features/post/PostBody.tsx` -- render `PollWidget` for `poll` items.
- `eslint` boundaries -- allow `features/post → features/polls` (check the existing rule list before adding).
- `src/shared/i18n/ru.ts` -- `poll.*` («Проголосовали: {n}», «Опрос завершен», «ваш выбор», percent format).
- `src/app/dev/demo.ts` -- a demo post with an open poll and a finished one.
- Fixtures: a poll in `e8-post-accessible.json` (live-sanitized if a sample exists, else synthetic and marked).
- Tests: `mapPoll.test.ts` (each drop rule, string ids, title joining, fraction clamp), `postBody.test.ts` (placement, teaser), `PollWidget` component test, `__tests__/postFlow.test.tsx` «Story 6.5» (every matrix row, a single stop, label).

## Tasks & Acceptance

**Execution:**
- [x] Live poll probe (removed); `docs/api-contract.md` «Polls (LIVE)», or recorded as unverified.
- [x] DTO, `entities/poll`, Post field, builder item, PollWidget, PostBody wiring, eslint boundary, copy, demo, fixture.
- [x] Tests for every matrix row; docs: feature-parity POLL-01/05, focus-map F (poll stop), testing.md Story 6.5.
- [x] Device (release-like, adb): a poll post if one exists, else the demo build; screenshots to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then everything passes; the touched suites pass 30/30; lint `--max-warnings 0`, typecheck and `check:fixtures` are clean.

## Implementation Notes

- Live probe (`TEMP65`, removed): 493 posts (E5 10 pages; E4 3 blogs, 10/10/5 pages), 1 poll: top-level `poll` only, no `poll` block, `fraction` an integer, no `answer` key. So the poll renders after the body; the block-position path is kept for a `poll` block with the poll's id (fixture-tested only).
- `Post.pollUnsupported` (not in the Code Map): a top-level poll with no valid option (or no `id`/`isMultiple`/`isFinished`) must still give the «Опрос» placeholder, and `Post.poll` stays `Poll | null`.
- `kindOf` takes the top-level poll into account, so a poll post's card reads «Опрос» (live polls are never blocks).
- Owner decision 2026-10-29 (option a): as BoostBuddy's `mapNotNull`, an option missing `id`/`counter`/`fraction` (or not an object) is dropped on its own; no valid option left → the placeholder.
- The TalkBack label is built as sentences: no period is added after a part ending in «?», «!», «.» or «…» (no «Что лучше?.»).
- `counter` missing → 0 and the title joined with «, » follow the reference (`counter ?: 0`, `title.joinToString()`).
- Review fixes: each option shows «N % · count» (POLL-01; `shared/i18n/format.formatCount`, narrow no-break thousands separator), also in the label with its plural; «Вариант N» for an option without text; the label's «Опрос» prefix is said once; duplicate option ids keep the first; the top-level `counter` must be a non-negative integer; a usable top-level poll counts as content for `hasAccess`; `Post.pollUnsupported` carries the raw poll id so only a `poll` block of that id (or an id-less one) shows its placeholder in place; the block with the poll's id wins over an earlier id-less one; the fixture's fractions are 100/0 (`check:fixtures` allows only 0 or 100 for `fraction`).
- `entities/poll.applyPoll` (epic context) is not added: this story has no write path; it belongs with E10 in Story 6.6.
- Device: the PollWidget's ring was cut at the column bottom on the first release-like build; fixed with the stop's vertical padding (as the AudioBlock).

## Spec Change Log

## Review Triage Log

Iteration 0 (layers: blind-hunter 14, edge-case-hunter 6, verification-gap 0 gaps + 1 other).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind | Per-option vote count missing (POLL-01 confirmed parity) | medium | patch | The reference shows counter and percentage; the spec missed it; recorded as a parity correction in Decisions. |
| 2 | blind | An accessible post whose only content is a top-level poll is mapped as locked | medium | patch | `hasAccess` needs `blocks.length > 0`; live polls are top-level only. |
| 3 | blind | Untitled poll announced «Опрос. Опрос.» | low | patch | Separate prefix key. |
| 4 | blind, edge | Empty option text: blank row, «, 48 %» label | low | patch | «Вариант N» fallback. |
| 5 | edge, blind | Duplicate option ids; non-finite ids; negative/fractional voter counter | low | patch | First occurrence kept; finite ids; counter sanitized. |
| 6 | blind, edge | Placeholder skipped for a mismatched-id poll block; an id-less block wins over the matching one | low | patch | Matching block preferred; only matching or id-less blocks count. |
| 7 | blind | No thousands separator («1643») | low | patch | Shared ru number format. |
| 8 | blind | `handleFocus` depends on the whole zone object | low | patch | Depends on `zone.onFocus`. |
| 9 | blind, vgap | The «live-sanitized» fixture's fractions sum to 5 | low | patch | 100 / 0. |
| 10 | blind | `demoPoll` comment says «every fourth»; orphaned JSDoc | low | patch | Doc correction. |
| 11 | blind | Demo finished/chosen and locked-focus assertions missing | low | patch | Assertions added. |
| 12 | edge | Demo lost the in-body poll-block path | low | reject | Live polls are top-level only; the block path is unit-tested. |
| 13 | blind | Status files disagree | false | reject | Statuses move at finalize. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean.
- `npm test` ×3 -- expected: all pass.

**Result (after the review patches, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 2227 passed each; `postFlow` + `demoFlow` + `checkFixtures` + `src/features/{polls,post}` + `src/shared/{entities,i18n}` ×30: 656 passed each run, 0 failed runs. The installed release-like build predates the per-option counts and the other review patches (host-tested only).
