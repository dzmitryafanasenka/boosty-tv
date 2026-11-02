---
title: 'Story 10.1: Chapter marks on the player timeline'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '20ee3df8ef9bf7a3f34140e3a45bc79804d096fe'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Long videos on Boosty often have a «Таймкоды» list in the post, but in the player there is no sign of the video's structure, and reaching a part means leaving for the post and pressing a chip. This is our improvement, not BoostBuddy parity.

**Approach:** Derive chapters from the post's timestamp links for the video being played. Draw a mark per chapter on the built-in player's timeline, show the current chapter's name next to the elapsed time (following the pending position during a scrub), and add a remote action that jumps between chapters.

## Boundaries & Constraints

**Always:**
- Only the known timestamp shape counts: links recognized by `timestampRef` (this post, `tmid` = one of the post's videos). A timestamp belongs to the video named by its `tmid`; links to another post are ignored.
- Chapters are sorted by second, duplicates removed; a timestamp at or past the duration is ignored. Before the first chapter there is no name.
- A chapter jump is a normal engine seek; progress is written by the usual rules (Story 4.2). Seek steps, hold-scrub, Back order and overlay auto-hide stay as they are.
- Tokens only; marks and the name fit the existing bottom band without reflow; the name is one line, truncated.
- Russian copy through the i18n structure; accessibility label on the timeline includes the current chapter name.

- **Owner decisions 2026-11-02:**
  - **Chapter name:** the text right after the time link up to the end of its line, with leading separators («—», «–», «-», «:», «.») and spaces trimmed; when that is empty, the time itself.
  - **Remote, as on YouTube:** ↑ shows the overlay with the timeline (as today). ↑ again while the timeline is focused and the video has chapters opens the **chapter strip** above the timeline: a horizontal row of chapters (time and name), the current chapter selected. In the strip ←/→ move the selection one chapter, OK seeks to the selected chapter's start and closes the strip, Back or ↓ closes it without seeking. While the strip is open the overlay does not auto-hide. With no chapters, the second ↑ does nothing.
  - The media keys `next`/`previous` jump to the next/previous chapter when chapters exist, and seek ± as today when not.

**Never:**
- Marks or names for a live stream, the system video player, or a video with no timestamps; any change in behaviour for those.
- A second timestamp parser; logging URLs, ids or titles; new endpoints.
- Focusable controls other than the chapter strip below.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy path | Post with «0:00 Вступление», «3:45 Разбор», «12:10 Итоги» for this video, duration 20:00 | 3 marks; at 5:00 the name «Разбор»; jump forward lands at 12:10 | N/A |
| Two videos | Timestamps with `tmid` of video A and of video B | Playing A shows only A's chapters | N/A |
| Out of range / odd | `t` ≥ duration, non-digit `t`, unknown `tmid`, another post | Ignored; the rest still shown | Never throws; no chapters → no marks |
| Duration unknown | Before metadata loads | No marks until the duration is known | N/A |
| Strip at the edges | ← on the first chapter / → on the last | Selection stays | N/A |
| Strip and Back | Strip open, Back | Strip closes, overlay stays on the timeline, no seek | N/A |

</frozen-after-approval>

## Code Map

- `src/shared/entities/externalUrls.ts:178-188` -- `TimestampRef {mediaId, seconds}`, `timestampRef(raw, {blogUrl, postId, mediaIds})`. Reuse as the only parser.
- `src/shared/entities/post/types.ts:29-39` -- `Post.blocks` in order: `{type:'text', text, spans, paragraphEnd}`, `{type:'link', text, spans, url}`. The name source walks these (a link block, then following text up to `paragraphEnd` or the next link). `postBody.ts` `ParagraphLink` lacks positions; do not change it.
- `src/shared/entities/post/postBody.ts:585-596` -- how timestamps and `selfMediaIds` are attached today; mirror the media-id set, do not duplicate the parser.
- `src/features/player/mediaResolver.ts:156,171-190,347-368` -- `useMediaSource` already has `data.post`; add `chapters` to the `ready` state next to `meta`.
- `src/features/player/PlayerOverlay.tsx:113-153,435-449,531-597` -- `Timeline` (percent widths via `fraction()`, no layout measure) gets `chapters`; marks drawn by percentage like the fill. Chapter name is a `Text` in `elapsedRow` beside `player/speed`, `numberOfLines={1}`, `flexShrink`. `isLive` branch (:424) untouched.
- `src/features/player/seekController.ts:49-83` -- add an absolute `seekTo(sec)` that sets the pending target and uses the existing commit; copy `seekBy`/`onSkip` in `usePlaybackSession.ts:514-540`.
- `src/features/player/usePlayerKeys.ts:262-287` -- ↑/↓ only show the overlay; `next/previous` map to `seekBy(±1)`; extend per the key decision.
- `src/features/player/usePlayerFocus.ts` -- focus per phase; the strip is a new phase between the timeline and hidden overlay. Back layers in `usePlayerKeys.ts:300-322` get the strip first (after the sheet).
- `src/shared/ui/tokens.ts:296` `components.timeline` -- add mark tokens (width, height, colour) here and in DESIGN.md frontmatter (the 9.4 guards check both).
- Tests: `src/features/player/__tests__/` (`seekController.test.ts`, `PlayerOverlay.test.ts`, `mediaResolver.test.ts`), `__tests__/playerFlow.test.tsx` (Story 6.3 case), `src/shared/entities/__tests__` / `postBody.test.ts:667`. No fixture has a `tmid` link: build blocks inline or add a sanitized synthetic link.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/entities/post/chapters.ts` -- pure `postChapters(post, mediaId, durationSec?)` → sorted `{sec, title}[]` and `chapterAt(chapters, sec)` -- one tested place for the rules in the matrix.
- [x] `src/features/player/mediaResolver.ts` -- expose `chapters` for VOD only.
- [x] `src/features/player/seekController.ts` + `usePlaybackSession.ts` -- `seekTo(sec)` and `jumpChapter(±1)`.
- [x] `src/features/player/PlayerOverlay.tsx`, `tokens.ts`, DESIGN.md -- marks and the name label.
- [x] `src/features/player/ChapterStrip.tsx` (new), `PlayerOverlay.tsx` -- the strip: horizontal row, selected item visibly distinct, scrolls to keep the selection in view, tokens only.
- [x] `src/features/player/usePlayerKeys.ts`, `usePlayerFocus.ts` -- second ↑ opens the strip; ←/→/OK/Back/↓ in the strip; Back order sheet → strip → held target → overlay → exit; media `next`/`previous`.
- [x] Tests for the matrix, the overlay (marks count, name, live/no-chapter absent), the strip keys and Back order, media keys, and a flow test from a post with timestamps.
- [x] `docs/focus-map.md`, `docs/feature-parity.md` (our-improvement row), `docs/testing.md` «Story 10.1», `CHANGELOG.md` / `CHANGELOG.ru.md` [Unreleased].
- [x] Device: owner-signed release build, `adb install -r`; the agent checks marks/name visually only by the player-visit rule; the jump and scrub-name checks are the owner's with the remote.

**Acceptance Criteria:**
- Given a VOD with chapters and the timeline focused, when ↑ is pressed, then the strip opens on the current chapter; when → then OK are pressed, then playback seeks to the next chapter's start, the strip closes and the name updates.
- Given a D-pad scrub, when the pending position crosses a chapter, then the label shows the pending chapter, and committing behaves exactly as before.
- Given a live stream, the system player or a video without timestamps, when it plays, then nothing differs from 1.0.0 (existing player tests pass unchanged).

## Implementation Notes

- Chapters: `src/shared/entities/post/chapters.ts` (`postChapters`, `chaptersWithin`, `chapterAt`, `chapterIndexAt`, `chapterJumpTarget`). Links inside `list` items count too (the item is the line). `MediaSourceState.ready.chapters` is uncut; the session cuts it to the engine's duration (`SessionView.chapters`, empty for live).
- Strip: `src/features/player/ChapterStrip.tsx` (`ChapterStrip`, `useChapterStrip`). OK in the strip is `seekTo` + `commitNow` (one engine seek at once); media Next / Previous use `seekTo` with the normal 600 ms commit, built on the pending target.
- The ↑ that moves focus from the controls row to the timeline: its key up may land after the timeline's `onFocus`, so within `STRIP_ENTRY_GUARD_MS` (300 ms) of such a move it does not open the strip (not measured on the device).
- Menu / Info while the strip is open close it and open the sheet (not in the spec; avoids a strip left open behind the sheet).
- Tokens: `timeline.markWidth|mark|markPlayed|chapterMaxWidth` and `chapter-strip` in `tokens.ts` and DESIGN.md.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter BH, edge-case-hunter EC, verification-gap VG):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| VG1 | Native SeekKeys ← → in the open strip (no held target) not pinned by a test | medium | Pre-verified gap: only the RN key path is asserted; removing the guard keeps the suite green | patch (test) |
| VG2 | Strip reset when the overlay hides by background/error/recovery untested | medium | Pre-verified gap: every strip close in tests goes through `closeStrip` | patch (test) |
| BH1 | testing.md «Story 10.1» still says the device check was not run | low | The line sits above the passed device table | patch |
| BH2 | TV runs an unpublished Story 10.1 build named 1.0.0 (versionCode 10000), undocumented | medium | Installed with `adb install -r`; testing.md does not say so | patch (doc) |
| BH3 | `nameInLink` (orchestrator's fix) goes beyond the frozen name rule («empty → the time itself») | medium | Frozen decision and the option the owner chose say the time when the text after the link is empty | patch (remove) |
| BH4 | epic-10-context Back order puts the held target before the sheet | low | `usePlayerKeys` Back handler returns early while the sheet is open, before the held check (as in 1.0.0); the context line was wrong | patch (doc) |
| BH5 / EC4 | Strip not virtualized | low | Mounted only while open; posts carry tens of timestamps, not hundreds; fix adds a list component | reject (low, rare, not a direct fix) |
| BH6 | Strip may open with the current chapter off-screen | false | Android `HorizontalScrollView.requestChildFocus` scrolls the focused child into view, also for a programmatic focus | reject |
| BH7 | Item shows the time twice when the name is the time | low | `ChapterItem` renders the time and the title unconditionally | patch |
| BH8 | Timeline a11y label pairs the position with the pending target's chapter | low | `chapterName` uses `seekTargetSec ?? positionSec`, the label's time uses `positionSec` | patch |
| BH9 | Chapter name length unbounded | low | Timestamp lines are short; fix adds a cap | reject (low, rare) |
| BH10 | `nameAfter` stops at any link, not only the next timestamp | medium | The frozen rule says «up to the end of its line»; an inline link inside a name cuts it | patch |
| BH11 | Media Next during a hold leaves the target held; strip OK with a held target | low / false | `commitNow` commits a held target too (`commit` clears `held`); media keys plus a held ← is not reachable on the pinned remote | reject |
| BH12 | Chapters recomputed on every resolver state change | low | Only on refetch during playback; no user-visible effect | reject (low) |
| BH13 | `elapsedRow` `flexShrink: 1` changes layout without chapters | false | Shrink applies only on overflow; the elapsed time and «N×» never overflow the row | reject |
| EC1 | Fractional duration lets a chapter sit in (d−1, d) | false | Durations are integer seconds above `PlayerEngine` (epic context, Technical Decisions) | reject |
| EC2 | A list item's duplicate second loses to a later paragraph link | low | `postChapters` collects top-level links before lists; the fix is a single in-order walk | patch |
| EC3 | Chapters shrink while the strip is open | low | Needs the duration to drop mid-playback; rare, fix adds a guard | reject (low, rare) |
| EC5 | A second Back before re-render is swallowed | false | Remote key repeats are ≥ 50 ms apart; `useLatestRef` updates on the next render well before | reject |

## Design Notes

- Media `previous` follows the YouTube rule: more than 3 s into the current chapter → its start; otherwise the previous chapter's start; before the first chapter → no-op. In the strip, before the first chapter the first chapter is selected.
- The strip's items are focusable rows inside one TVFocusGuideView trapped horizontally; ↑ inside the strip does nothing.
- Marks are thin vertical ticks over the track at `sec / duration`, hidden under the fill colour change only by colour, not by layout; a mark at 0 is not drawn.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- all green.
- `(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a)` -- owner-signed device build.
