---
title: 'Retro follow-ups: PostBody / PollWidget split and story-boundary tests (Epic 6 A3/A4, Epic 7 A4, Epic 3 A5)'
type: 'refactor'
created: '2026-10-31'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '48b1a22b8104ed032b633660e4f4b37df4ea42ce'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-retro-2026-10-30.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-retro-2026-10-30.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-retro-2026-10-27.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-epic-7-retro-a2-live-and-focus-refactor.md'
  - '{project-root}/docs/focus-map.md'
---

## Intent

**Problem:** four open retro items.
- `epic-6-retro-item-28` (Epic 6 A3): `PostBody.tsx` (1396 lines, 19 components) and `PollWidget.tsx` (1205 lines) are too big; the two-OK confirm is written twice (`pendingId` / `pending`); the poll focus ids and the fallback order live in `PostScreen.tsx`; the flow-test `frames` / `key` / `advance` helpers are copied per file. The guarded `focusSoon` part was already done in Epic 7 A2.
- `epic-6-retro-item-29` (Epic 6 A4, R3–R6): no test that audio keeps playing across a vote, none that Back after a vote restores the feed card; undocumented audio under the QR dialog; the `applyPoll` list-page limit is not stated.
- `epic-7-retro-item-36` (Epic 7 A4, F3, F5, F6): Events → Автор untested with a scheduled stream and a stream ended between E18 and E15; no test of the combined resume request count; F3: OK on «Нравится» cancels any running E15, also the page's first E15 or the Player-exit invalidation, so an ended stream's card can stay up to 30 s.
- `epic-3-retro-item-13` (Epic 3 A5, V1–V3): no test of a resume while Пост covers Главная, of a resume with nested stacks, or that Главная never shows the pin badge.

**Approach:** two commits on one branch.
1. A behaviour-preserving refactor (Epic 6 A3).
2. The boundary tests, the F3 fix (small, so preferred over accepting it), the docs lines and the spec.

## Boundaries & Constraints

**Always:**
- Commit 1 changes no behaviour, focus timing, request, copy or log. Existing tests keep their meaning; only helpers move.
- Import boundaries hold (`shared` never imports `features`; `FEATURE_EDGES` unchanged: `post → polls, player`, through the index).
- When a pattern is extracted, every copy is patched in the same change.

**Never:**
- No comment feature, no outward mutation in tests (E11/E12/E17 are mocks only).
- No fix beyond F3; a real bug found by a test is reported, not silently changed.
- No `sprint-status.yaml` change.

## Implementation Notes

### Commit 1 — refactor (Epic 6 A3)

**Files:**
- `src/features/post/PostBody.tsx`: a thin composer (the `switch` over `PostBodyItem` kinds) that re-exports the moved public names (`TEASER_IMAGE_GAP`, `IMAGE_STOP_MAX_HEIGHT`, `PostBodySkeleton`, `PostVideoRows`, `PostPrimaryAction`, `OpenPlayer`, `OpenQr`, `OpenPost`, `PlayAt`, `ResolveFileTarget`), so no importer changed.
- `src/features/post/body/`:
  - `blockStyles.ts`: `BAR_WIDTH`, `DEFAULT_ASPECT`, `aspectOf`, and the shared styles;
  - `TextBlocks.tsx`: inline emoji, segments, `EmojiParagraph`, `ParagraphStop`, `BlockPlaceholder`, `Heading`;
  - `ImageBlocks.tsx`: `TeaserImage`, `ImageStop`;
  - `chipParts.tsx`: the chip types, `ChipGuide`, `QrSuffix`, the chip surface and styles;
  - `LinkChips.tsx`, `FileChip.tsx`, `ExternalVideoChip.tsx`: one file per chip kind;
  - `VideoActions.tsx`: `PostVideoRows`, `PostPrimaryAction`, `ColumnButton`;
  - `PostBodySkeleton.tsx`.
- `src/features/polls/PollWidget.tsx`: a thin router to `PollDisplay.tsx`, `SingleChoicePoll.tsx` (was `VotablePoll`) and `MultipleChoicePoll.tsx` (was `MultiplePoll`). It re-exports the three label functions. The rest of the split:
  - `pollLabels.ts`: every label builder;
  - `PollStops.tsx`: `PollOptionStop`, `PollCheckOption`, `PollActionStop`;
  - `PollParts.tsx`: `ResultRow`, `PendingOutline`, `PollError`;
  - `pollStyles.ts`.
- `src/features/polls/pollFocus.ts` (exported from the polls index):
  - `pollFocusIds(contentPrefix)`: the ids, `post/<postId>/poll/option|submit|retract`;
  - `pollFirstStopId`;
  - `pollFallbackOrder`.
  `PostScreen.tsx` only applies them. The unused `postPoll*` id exports are gone; nothing imported them.
- `src/shared/focus/usePendingConfirm.ts`: `press(key) → 'armed' | 'confirm'` and `cancel(key?)`. Both copies use it:
  - single choice: `cancel(optionId)` on blur;
  - multiple choice: `cancel()` on blur and during render on a mode change.
- `src/shared/focus/useColumnStop.ts`: the zone item plus `onView` / `onFocus` wiring with a `viewRef`. It replaces the copies in every post block stop, the poll stops and `AudioBlock`, which is in scope by the patch-every-copy rule. After review, `PostScreen`'s author row uses it too: its `onView` wraps `onStopView` plus `refreshColumnTarget`, so the call order is unchanged (zone, then screen, then the guide refresh).
- Tests:
  - `src/test/frames.ts` (`installFrameQueue`, `frame`, `frames(n)`, `queuedFrames`) replaces the frame queues in `postFlow`, `useAuthorLiveActions`, `useOutcomeFocus` and `focusSoon`.
  - `createFlow` gains `advance(ms)` and `key(eventType, action)`. They replace the copies in `playerFlow` (`advance`, `key`), `codeFlow`, `authorFlow` (×3) and `homeFeedFlow`.
  - New unit tests: `usePendingConfirm.test.tsx` and `pollFocus.test.ts`.
- `docs/focus-map.md`: a pointer to `usePendingConfirm`, `useColumnStop` and `pollFocus`, and the `PostVideoRows` path.

**Decisions:**
- `focusSoon`: no ad-hoc «now and after frames» copy is left in post or poll code. The `MultipleChoicePoll` hand-off is a bounded per-frame retry, which Epic 7 A2 left alone on purpose; a comment there says so.
- The single-choice confirm still does not reset on a poll mode change; only the multiple-choice one does. The retro recorded this drift. Keeping it is behaviour-preserving: an armed single-choice option survives a refetch, and a blur still cancels it.
- Unit tests with their own copies of a different shape stay as they are: `AudioBlock.test` and `PeriodStepper.test` use `key` / `advance` without a settle, and `progressRepository.test` uses `advance` with its own flush.

**Line counts (before → after):**
- `PostBody.tsx`: 1396 → 217;
- `PollWidget.tsx`: 1205 → 94;
- `PostScreen.tsx`: 813 → 792.

The largest new files are `PollStops.tsx` (319), `MultipleChoicePoll.tsx` (290), `ImageBlocks.tsx` (218) and `VideoActions.tsx` (213).

### Commit 2 — boundary tests, F3 fix, docs

**F3 fixed** (`src/features/author/useLiveLike.ts`, `useAuthorLiveBlock.ts` passes `liveAnswered`):
- `runningFetch` classifies the running E15:
  - `poll`: the page's first E15 has answered, and the query is not `isInvalidated`;
  - `other`: anything else, that is, the page's own first E15 or an invalidation's refetch (the Player exit, a resume). TanStack keeps `isInvalidated` true until the refetch succeeds.
- At OK, only a poll is cancelled.
- At E17 success, any running E15 is cancelled before the write, as before, because it may carry the pre-like value. A cancelled `other` is sent once more after the write (`invalidateQueries`), so the page never waits 30 s for the truth.
- Tests in `authorFlow` «Story 7.4»:
  - the first E15 runs on, and an ended stream's card goes when it lands;
  - the first E15 still running at E17 200 is cancelled and sent again, and its late pre-like reply is never written;
  - an invalidation's E15 runs on;
  - a poll is still cancelled.

  The first three fail on the old code.
- After review:
  - the re-send runs on every same-account success path where the cancel ran, also when the overlay entry was replaced meanwhile (before, the entry check returned first);
  - `runningFetch` treats `paused` as running. A query cannot be paused today: no `onlineManager` is wired, and React Native fires no `online` / `offline` window events, so TanStack always counts the app as online;
  - known imprecision (accepted): TanStack also sets `isInvalidated` after a failed fetch (`retry: false`), so after a failed E15 the next polls count as `other` until one succeeds. Such a poll is not cancelled at OK and may be sent once more after the write. Nothing visible changes; at most one extra E15. Recorded in the `runningFetch` comment and in `docs/api-contract.md`.
- `docs/api-contract.md` E17 updated.

**Tests added:**
- `eventsFlow`:
  - F6, scheduled: the «Запланирован» card, the first post focused, never the card;
  - F6, ended between E18 and E15: no card, the first post focused, Back → the row, read;
  - F5 and V2, `resume with nested stacks`: Shell (События) → Автор A → Пост → Автор B. One stale resume sends E1, then E5 + E4 page 1 ×2 + E15 ×2 + E18, which is 7 requests in all and nothing else (no E8). The covered routes take no focus. Back per layer: Пост (the author row) → Автор A (the post card) → the События row.
  - The second Автор is a different blog: E8 is synthetic, with the post's `user.blogUrl` set to BLOG2. E4 and E15 are sent once per observed query key, so two Author routes of the same blog send one each. «N» in F5 is the number of distinct observed keys.
  - The test file gained an E8 handler.
- `homeFeedFlow`:
  - V1: a stale resume while Пост covers Главная sends one E5 page 1 and no E8. The covered feed neither focuses nor scrolls. Back → the same card, scrolled to its new row (index 15 → row 5).
  - V3: a pinned E5 post shows no pin badge and no «Закреплено».
- `postFlow` «Story 6.6 › Epic 6 retro A4»:
  - R4: audio keeps playing across a vote, both for E11 + E10 and for the E8 fallback (E10 404). The same engine stays mounted, unpaused, with no new audio E8.
  - R6: Back after a vote returns focus to the same feed card by id, while `applyPoll` rewrote that card's poll in the feed cache.

**Docs:**
- `docs/focus-map.md`: audio under the QrDialog (R5, verified in code: the dialog is in the modal host on the same route, so `active` stays true; the block lost focus, so OK and ← → no longer reach it).
- `src/shared/entities/poll/applyPoll.ts`: the list-page limit (R3).
- `docs/testing.md`: a section for this change.

**Flaky assertions fixed:**
- `playerFlow` «Expired URL» stringified log entries with their wall-clock `time`, so «312» could match a timestamp.
- `eventsFlow` «Malformed» had the same latent problem with «1184».

Both now stringify every field except `time`, so the leak check still covers level, scope, message and fields.

**No real bug found** by the new tests, apart from F3.

**Verification:** see `docs/testing.md` «Retro follow-ups: PostBody / PollWidget split and boundary tests».

## Spec Change Log

## Review Triage Log

Coordinator review, 2026-10-31 (Blind Hunter, Edge Case Hunter, Verification Gap). All applied in commit 3 (`fix: review patches for the retro post split and boundary tests`).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | F3: no test for an invalidation's E15 still running at E17 200 | real | The new `authorFlow` test fails when the success branch re-sends only the first E15 (`fetchAgain = !answeredRef.current`): no third E15, the card stays | patch |
| 2 | No test for an uncancelled first E15 landing mid-E17, then a failed E17 | real (gap) | New test: «Вам нравится, 358» holds while the landed `likes: 400` is cached; a 400 on E17 rolls back to «Нравится, 400» | patch |
| 3 | `runningFetch` reads `isInvalidated`, which a failed fetch also sets | real, harmless | query-core's `error` reducer sets `isInvalidated: true`; the stream query has `retry: false`. The next polls count as `other`: not cancelled at OK, at most one extra E15 after the write. No small, clean way to tag a fetch's origin (TanStack gives no per-fetch meta for `refetchInterval`), so documented in the code comment, `docs/api-contract.md` and this spec | accept |
| 4 | The re-send is skipped when the overlay entry was replaced | real | The early return in the success `.then` ran before `fetchAgain`; the invalidate now runs on every same-account `ok` path where the cancel ran | patch |
| 5 | `runningFetch` ignores `fetchStatus === 'paused'` | not reachable today | No `onlineManager` is wired (no NetInfo, ADR 0010), and RN fires no window `online` / `offline` events, so a query is never paused. `paused` now counts as running anyway (only `idle` is «none»), as a guard | patch |
| 6 | `usePendingConfirm.press`: two presses in one tick both arm | real | `latest.current` updated only on render; now set in `press` (and cleared in `cancel`). Tests: a double press in one act confirms; cancel + press in one act re-arms; a render-phase `cancel()` on a prop flip resets with bounded renders | patch |
| 7 | No unit test for `useColumnStop` | gap | New `useColumnStop.test.tsx`: mount, an id change (old id `null` first, then the new id), unmount, `handleFocus` order (zone, then screen) | patch |
| 8 | `PostScreen`'s author row hand-wires a column stop | real | Migrated to `useColumnStop` with an `onView` wrapper that calls `refreshColumnTarget`; same call order; `postFlow` passes | patch |
| 9 | R5 (audio under the QrDialog) only documented | gap | New `postFlow` test: the engine stays unpaused under the dialog, ← → do not seek there (a control seek before), Back → the chip; the file now mocks TVEventHandler | patch |
| 10 | Nested-stack Back checks only non-GET requests | weak | Now `transport.calls` length is unchanged after the three pops | patch |
| 11 | V3 label check anchored at the start | weak | Now `not.toContain` «Закреплено.» and the pin glyph anywhere in the label | patch |
| 12 | `createFlow().key()` is a silent no-op without the TVEventHandler mock | real | It throws a clear error when no listener is subscribed; every suite passes | patch |
| 13 | Orphan doc comments and double blank lines from the extraction | real | Removed (`authorFlow`, `PostScreen`; blank lines in `playerFlow`, `codeFlow`, `authorFlow`, `focusSoon.test`, `useAuthorLiveActions.test`, `useOutcomeFocus.test`); the blank lines that existed on main are left alone | patch |
| 14 | `docs/testing.md` lacks per-file counts | real | Per-file counts added for every commit (eventsFlow: 4) | patch |
| 15 | `PostScreen` keeps a redundant `pollPrefix` alias | real | Removed; the effect reads `pollIds.prefix` and depends on `pollIds` only | patch |
| 16 | `frames.ts`: callbacks get `Date.now()`, the old copies passed 0 | real | Noted in the doc comment; no app code reads the timestamp | patch |
