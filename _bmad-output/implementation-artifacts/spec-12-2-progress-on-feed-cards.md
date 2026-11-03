---
title: 'Story 12.2: Progress and «Просмотрено» on feed cards'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '99e5e8a154e611d28078148affe67d99387ba67f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Post cards on Главная, Автор and Поиск do not show which videos the viewer started or finished, so the viewer opens posts just to check.

**Approach:** Video post cards show the local progress of their target video as an accent line along the bottom edge of the preview (as ContinueCard), and a «Просмотрено» badge when every video of the post is finished. Our improvement IMP-02 (FR-60, owner decision 2026-11-02).

## Boundaries & Constraints

**Always:** only local progress (`source: 'local'` snapshots through `useProgress(refs[])`; server `timeCode` snapshots are ignored, the row is «на этом устройстве»); "finished" and the card status come only from the progress service (`progressStatus`, ADR 0004 rule: ≥ 95 % or < 30 s left); duration = the local snapshot's engine duration, else the video block's `durationSec`; the multi-video target is the same rule as Пост «Продолжить · Видео N» (one shared function, moved out of `PostScreen` into the progress service); no request per card; cards keep their height and the existing badges; the card updates from the store (no feed refetch) and focus never moves; tokens only; Russian copy.

**Never:** a per-card network request; showing a server-only position; a new progress store or second "finished" rule; changing ContinueCard, the Continue row or Пост behaviour; a «hide watched» filter.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No entry | video post, no local entry | Card unchanged (no line, no badge, label unchanged) | N/A |
| In progress | one video, local 12:00 of 60:00 | Accent line 20 % along the preview's bottom edge; label ends «осталось 48 мин» | N/A |
| Finished | one video, ≥ 95 % or < 30 s left | Full line + «Просмотрено» badge at the preview's bottom-left; label ends «просмотрено» | N/A |
| Unknown duration | local entry, no engine or block duration | No line, no badge (never a fake status) | N/A |
| Multi, partial | 3 videos: 1 watched, 2 in progress | Line of video 2; no badge | N/A |
| Multi, next not started | 1 watched, 2 no entry | No line, no badge (target video 2 not started) | N/A |
| Multi, all finished | every video watched | Full line + «Просмотрено» | N/A |
| Server only | E8 `timeCode` seen, no local entry | Card unchanged | N/A |
| Not a video post / locked | text, audio, locked | Card unchanged | N/A |
| Back from player | progress changed while playing | Card shows the new state without a feed refetch; focus stays on the card | N/A |
| Removed from Continue | 12.1 dismiss / clear-all | Line goes (no local entry); a finished entry kept by clear-all keeps «Просмотрено» | N/A |

</frozen-after-approval>

## Code Map

- `src/shared/ui/PostCard.tsx` -- `PostCardView` (L227), `postCardA11yLabel` (L105), duration chip (L324-337, bottom-right), type badge top-left, pin top-right (Автор); `memo(PostCardView)` (L375); per-post state via `useItemState(…, post.id)` (recycled cells, ADR 0011). Bottom-left is free for «Просмотрено».
- `src/shared/ui/ContinueCard.tsx` -- progress line L132-140 (track `colors['overlay-badge']`, fill `components['media-row'].progress`, height `components.timeline.trackHeight`), styles L185-195; reuse the same look.
- `src/shared/ui/PostGrid.tsx` -- `GridCard` renders PostCard for Главная (`features/home/FeedGrid.tsx`), Автор (`features/author/AuthorScreen.tsx:663`) and Поиск (`features/search/SearchScreen.tsx:572`); all pass domain `Post`.
- `src/shared/entities/post/mediaRows.ts` -- `videoRowsOf(post)` (rows with id + `durationSec`, `[]` for locked), `mediaRefsOf(post)`.
- `src/shared/services/progress/useProgress.ts` -- `useProgress(refs[])` returns a referentially stable array (safe for the render-count tests); without `ProgressContext` returns `[]`.
- `src/shared/services/progress/finished.ts` -- `progressStatus(pos, dur)` → `notStarted | inProgress{minutesLeft, fraction} | watched | unknown`.
- `src/features/post/PostScreen.tsx` -- `primaryTarget(rows, statuses)` (L98-112); move it (pure) to the progress service and import it back (boundaries forbid shared → features, `__tests__/boundaries.test.js`).
- `src/shared/i18n/ru.ts` -- `post.video.status.watched` «Просмотрено» (L425), `post.hero.left` / `post.hero.watched` lowercase (L450-451); `postCard.*` (L623-642) for new card a11y keys.
- `src/shared/ui/tokens.ts` + DESIGN.md frontmatter (`ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md`) -- add any new token in both (`tokens.test.js`).
- Tests: `src/shared/ui/__tests__/PostCard.test.tsx` (needs a ProgressContext provider like `ContinueCard.test.tsx`), `__tests__/homeFeedFlow.test.tsx` (render-count tests L945-972; progress seeded with `progressStore.put`), `__tests__/authorFlow.test.tsx`, `__tests__/searchFlow.test.tsx`, `__tests__/postFlow.test.tsx` (primaryTarget), progress service tests.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/services/progress/` (new `cardProgress.ts` + `index.ts`, tests) -- move `primaryTarget` here; add `postCardProgress(rows, snapshots)` → `{kind:'none'} | {kind:'inProgress', fraction, minutesLeft} | {kind:'watched'}` using local snapshots only and the block duration fallback.
- [x] `src/features/post/PostScreen.tsx` -- import `primaryTarget` from the progress service; behaviour unchanged.
- [x] `src/shared/ui/PostCard.tsx` (+ tests) -- read `useProgress(mediaRefsOf(post))`, draw the line and the bottom-left «Просмотрено» badge, extend the a11y label.
- [x] `src/shared/i18n/ru.ts`, `tokens.ts` / DESIGN.md if needed -- copy and tokens.
- [x] `__tests__/homeFeedFlow.test.tsx`, `authorFlow`, `searchFlow` -- matrix rows; render-count tests stay green; back-from-player row.
- [x] `docs/feature-parity.md` (IMP-02 as built), `docs/testing.md`, `docs/focus-map.md` (focus unchanged note), `CHANGELOG.md` / `CHANGELOG.ru.md` [Unreleased].

**Acceptance Criteria:**
- Given the release-like build on the pinned TV, when the owner looks at Главная after watching, then started videos show the line and finished ones «Просмотрено», D-pad only.
- Given `npm run lint`, `npm run typecheck`, `npm test`, then all pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | edge, blind | «Просмотрено» and the duration chip may overlap | false | Grid cards are `postCardWidth(720, 3)` ≈ 221 dp (device screenshot); «Просмотрено» ≈ 90 dp + «1:44:46» ≈ 62 dp + 3 × 12 dp margins fit | rejected |
| 2 | edge | Local `durationSec` 0 skips the block fallback | false | The store schema keeps `durationSec` positive or null (`z.number().int().positive()`) | rejected |
| 3 | vgap | No verification gaps | — | — | — |
| 4 | blind | sprint status vs spec status | false | Synced at present per workflow | rejected |
| 5 | blind | DESIGN.md PostCard row still says «planned in Story 12.2» | low | Stale doc line; direct edit | patch |
| 6 | blind | Device acceptance pending | false | Device check runs before the PR (orchestrator + owner) | rejected |
| 7 | blind | testing.md full-run numbers predate the last test | low | Orchestrator ran the full suite after it: 3508/3508; direct edit | patch |
| 8 | blind | No account-isolation test for card progress | medium | Cards read the account-scoped store; no test shows a wipe clears the line/badge | patch |
| 9 | blind | Multi-video label does not say which video | low | Visual and label follow the epic rule; TalkBack-only nuance, fix adds plumbing | rejected (low, adds complexity) |
| 10 | blind | Track may poke past rounded preview corners | maybe-false | Same drawing as ContinueCard, already checked on the TV; the thumb's bottom corners are inside the card | rejected (device screenshot settles it) |
| 11 | blind | Per-card store subscription cost on long lists | maybe-false | `getSnapshot` is a cached read; render-count tests pass; settle with a long-scroll device check | deferred as device check note |
| 12 | blind | searchFlow «no request» assert is taken after render | low | Direct correction to compare against E8 calls | patch |
| 13 | blind | a11y label lacks the final period; `postCard.watched` duplicates `post.video.status.watched` | low | Direct copy fixes | patch |

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test` -- expected: all pass.
- `cd android && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL; `adb install -r`.

**Manual checks (if no CLI):**
- adb screenshots of Главная with the owner's existing progress (foreground checked before each batch); owner confirms with the remote.
