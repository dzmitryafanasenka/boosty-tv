---
title: 'Story 4.7: Continue-watching row on the Home screen'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'e89e123dc07f59fdec212da255aa5b050e6005bd'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/adr/0004-progress-ownership-and-resume.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Unfinished videos can only be found by opening their posts; Главная has no way to continue in one press (FR15, UJ-1/SM-3; epics.md Story 4.7).

**Approach:** Above the feed grid on Главная, a «Продолжить просмотр · на этом устройстве» row of continue cards built from the account-scoped local progress (`progressStore.entries()`, Story 4.2): unfinished entries with a position > 0, newest first, at most 20, one per media id. OK on a card opens the Player for that media at `resumePoint(ref)`; Back returns focus to the same card. The row is hidden when empty; initial focus goes to its first card when shown, else to the first feed card.

**Decisions:**
- Card: the preview (16:9), the video title (the post title when the video title is empty or generic, the 4.1 rule), the author, «Осталось N мин» and the progress line. Id `home/continue/<mediaId>`; a11y «{title}. {author}. Осталось N мин».
- The row reacts to the store (a finished video leaves it, a just-watched one moves first) while focus stays on the same media id; if the focused card disappears, its neighbour (next, else previous), else the first feed card.
- Focus: ↓ from a continue card → the first feed row, the column of the card's visible position (0–2); ↑ from the first feed row → the remembered continue card (else the first); ← from a card's first visible position → the sidebar; → / ← scroll the row.
- Natural end from a continue card (Story 4.5 «Ended», Главная branch): the card is gone (finished), focus → its neighbour, else the first feed card.
- Preview safety (deferred from 4.2): before showing stored previews, check on the device whether the `ok_video.preview` URL carries a token or expiry in its query (log only the parameter names, debug build); if it does, the progress store stops persisting `previewUrl` and the card shows the preview only from in-memory post data, else a neutral plate.
- No E8 per card: the row uses only the stored meta (and in-memory data).
- Owner decision 2026-10-28: **continue cards are the same size as the feed cards** (3 visible, the row scrolls horizontally, columns line up with the grid).
- Owner decisions 2026-10-28 (device screenshot reviewed, the row's look accepted): **the row shows only together with the feed grid** (hidden while the feed is empty, failed or offline); **an entry whose post turns out locked (confirmed) or unavailable when its player opens is removed from the local progress** (so it leaves the row; no extra requests).

## Boundaries & Constraints

**Always:** ids only in routes; progress read only through the ProgressRepository/store hooks; FlashList grid unchanged except the header row; copy from `ru`; tokens from `shared/ui`; no URL in logs.

**Never:** No server «continue» list (none exists); no feed/Author card progress (FR-14, later); no comments; no autoplay.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Empty | no unfinished entries | row hidden, focus first feed card | — |
| Shown | 3 unfinished, 1 finished | 3 cards, newest first; focus first card | — |
| Cap | 25 unfinished | 20 cards | — |
| Open | OK on a card at 12:00 of 60:00 | Player, starts at 12:00 (resume point) | — |
| Return | Back from that player | focus on the same card (now first) | — |
| Finished at end | the video ends | card gone; focus neighbour, else first feed card | — |
| Reset | sign-out / account switch | row empty | — |
| ↑ ↓ | ↓ from card 2 / ↑ from feed row | feed column 2 / back to that card | — |

</frozen-after-approval>

## Code Map

- `src/features/home/HomeScreen.tsx` (531 lines: focus info, initial focus, return restore via `HomeFocusInfo.setReturnFocus` registered with the Shell), `FeedGrid.tsx` (FlashList wrapper; header component), `src/shared/ui/PostGrid.tsx` (grid focus, `useHeadChangeRefocus`, `useNotMovedLatch` — keep their behaviour), `src/shared/ui/PostCard.tsx` (reuse for the continue card; `post-card` tokens).
- `src/shared/services/progress/` -- a hook for the continue entries (`useSyncExternalStore` over `progressStore.subscribe`/`entries`, unfinished filter with `isFinished`, cap 20); `progressStore.ts` (preview persistence per the check).
- `src/app/Shell.tsx` / `stackRoutes.tsx` -- open the Player from Главная with `origin: {routeKey: <Shell route>, focusId: home/continue/<mediaId>}`; the PlayerRoute `beforeRemove`/`endedFocus` (4.5) must handle a Главная origin (FocusRestoration key of the Home section, neighbour on a natural end).
- `src/shared/i18n/ru.ts` -- `home.continue.title`, card a11y.
- Tests: `__tests__/homeFeedFlow.test.tsx` (every matrix row; focus moves; store reactivity), unit tests for the entries hook.
- Docs: `docs/focus-map.md` B Главная, `docs/feature-parity.md` (FR15 improvement row), `docs/testing.md` Story 4.7 (SM-3 press count, preview check), `deferred-work.md`.

## Tasks & Acceptance

**Execution:**
- [x] Continue entries hook + preview persistence rule.
- [x] Continue row + card on Главная; initial focus; ↑ ↓ ← →; reactivity.
- [x] Player open/return from Главная; natural-end neighbour.
- [x] Tests; docs.
- [x] Device (the owner reviewed the row on the TV 2026-10-28) (release-like, owner's session; check every post title on a screenshot before playing): row shown with real entries, OK resumes, Back returns to the card; SM-3 cold-start press count to a playing new video (≤ 5) recorded; preview query parameter names checked (debug build, names only); screenshot of Главная with the row to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new/changed flow suites 30/30; lint `--max-warnings 0`, typecheck, `check:fixtures` clean; release bundle without debug-only code.

## Implementation Notes

- Final verification (coordinator, 2026-10-28, after the review patches and the owner decisions): lint `--max-warnings 0`, typecheck, check:fixtures clean; `npm test` ×3: 1646 passed each; homeFeedFlow + playerFlow + progress + sessionCheck + ContinueCard ×30: 0 failed runs (295 tests each). Device (release-like, adb): cold start → focus on the first continue card; ↓ → the feed column 1; ↑ → back to the remembered card. The owner reviewed the row on the TV before the review loop and accepted its look.

- Preview check (debug build, names only): `ok_video.preview` URLs carry no query; the `defaultPreview` fallback carries `tkn`. So the store writes (and loads) a preview URL only when it has no query (`persistablePreviewUrl`); memory keeps it; the card falls back to the in-memory feed post's block, else a neutral plate.
- `useContinueEntries` (`shared/services/progress/continueEntries.ts`) over `progressStore`; the store now notifies when its disk read finishes (also for an empty disk), so Главная can wait for the first read (skeleton) and put the initial focus on the first Continue card. A later re-read (after a reset) never brings the skeleton back.
- The row is the FlashList's list header (`PostGrid` `header` prop; the grid is otherwise unchanged). While it is shown, «Новое в подписках» moves into the header under the row; when hidden, the layout is Story 3.1's. Shown only in the grid phase (empty/error/offline feed: hidden; deferred-work).
- Column alignment without JS scroll: each card's focusable view has 12/13 dp horizontal padding (overlapping by 9 dp) so Android's flush-to-edge focus scroll lands the visible cards on the grid's columns; ↓ is native geometry. ↑ from the feed uses a `TVFocusGuideView` around the row (destination: last focused card, else the first).
- Interpretation: «← from a card's first visible position → the sidebar» is native: ← from the first card (index 0) goes to the sidebar; from any other card ← moves (and scrolls) to the previous card, so earlier cards stay reachable.
- Player origin gained `sectionId` (`home` for Главная); `beforeRemove` writes under it. A natural end needs no `endedFocus` for Главная: the card is gone, and the return picks the card at its remembered index (next, else previous), else the first feed card.
- `isGenericVideoTitle` moved to `shared/entities/post/videoTitle.ts` (used by the player overlay and the card title rule).

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | `forget` writes the disk after the 2 s debounce: a kill in the window restores the card (blind) | medium | patch: immediate disk write for a removal |
| 2 | Pre-4.7 disk previews with a query stay on disk until another write (edge) | low | patch: rewrite after a sanitizing load |
| 3 | Preview filter refuses only `?` (blind, edge) | low | patch: also `#` |
| 4 | Entry duration 0 shadows the meta duration (edge) | low | patch |
| 5 | Both titles empty → blank card title and «. » label; empty author segment (blind, edge) | low | patch: «Без названия» fallback |
| 6 | Reactive focus move skips the latch/autoContinue; index-based neighbour; the guide's remembered target disagrees with the neighbour rule (blind, edge ×3) | medium | patch: id-based neighbour everywhere, latch set |
| 7 | No test: a transient locked (silent refresh / offline E1) keeps the entry (verification-gap) | medium | patch: test |
| 8 | No test: a head refresh keeps focus on an auto-focused continue card (verification-gap) | medium | patch: test |
| 9 | No test: disk-only entry → initial focus on the row (verification-gap) | medium | patch: test |
| 10 | Docs miss the owner decisions and the removal path; `FR15`/`FR-15` (blind) | low | patch |
| 11 | `unavailable` also covers a video block the mapper dropped → progress erased (blind) | low | rejected: owner decision covers «the video gone»; a whole-post parse failure is `Parse`, not `unavailable` |
| 12 | `remove` before the disk load finished lets the load re-add it (edge) | low | rejected: the player opens after `progress.ready()`; the locked/unavailable answer comes after that |
| 13 | A hung async-storage read keeps Главная on the skeleton (blind) | low | rejected: async-storage reads settle or reject (as in 4.3) |
| 14 | Reset during the initial load leaves `ready` false forever (edge) | low | rejected: a reset leaves Главная (sign-out → Welcome; a switch remounts Shell, whose mount calls `ready()` again) |
| 15 | Re-renders of the row during playback (blind) | low | rejected: 3–20 cards, memoized; no device lag seen |
| 16 | Geometry test uses literals (blind) | low | rejected: values are the tokens' current values; a token change fails the test loudly |
| 17 | Account isolation only via `progressStore.reset()` (blind) | low | rejected: the store is registered with AccountScope; 4.2 tests the sign-out wipe through it |
| 18 | Return from the Player into a non-grid phase untested (blind) | low | rejected: the row exists only with the grid (owner decision); the zone fallback applies |
| 19 | `focusItem` gives up silently if the card does not mount (edge) | low | rejected: the row renders from in-memory entries before the return |
| 20 | Feed preview matched by `postId` only (edge) | false | Boosty post ids are UUIDs, unique across blogs |
| 21 | Spec/sprint status mismatch (blind) | low | rejected: synced at completion |

## Verification

Run 2026-10-28: lint `--max-warnings 0`, typecheck, `check:fixtures` clean; `npm test` ×3: 1635 passed each; `homeFeedFlow` + `playerFlow` + `progress` + `ContinueCard` suites ×30: 272/272 each run. Device rows: docs/testing.md «Story 4.7».

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `homeFeedFlow`, `playerFlow` and the new suites 30×.
