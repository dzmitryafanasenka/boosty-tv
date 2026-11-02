---
title: 'Story 13.2: Timestamp chips instead of a text line and a chip'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '522ae543913bd5b2e3ed38038dd45ecf5ad011ba'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On Пост every chapter line is shown twice: the text «0:20 Что тут происходит?» and under it a chip «0:20 · Смотреть». It is not obvious which part is the button, and a chapter list takes twice the room.

**Approach:** Implement the approved mockup artboard `Chapters.dc.html`: a text line that starts with a timestamp link of this post becomes one chip «▶ 0:20  Что тут происходит?» and the text line is not rendered; consecutive chips form a tight list. A timestamp inside a paragraph keeps the text, and its chip after the paragraph reads «▶ 42:10».

## Boundaries & Constraints

**Always:** recognise timestamps only through the existing `timestampRef` (this post, `tmid` = one of its videos); the chip title follows the Story 10.1 chapter-name rule (text after the link to the end of its line, leading «—–-:.» and spaces trimmed, else the time) from one shared helper, not a copy; the time on the chip is `formatDuration(seconds)`; OK keeps the Story 6.3 behaviour (`onPlayAt`: player at that second, focus returns to the chip; player off → the link's QR); chip focus ids stay under `post/<postId>/block/` with stable keys derived from the paragraph key; tokens only (`link-chip` plus any new token added to `tokens.ts` and DESIGN.md frontmatter together); Russian copy and accessibility labels («Смотреть с 0:20: Что тут происходит?»).

**Never:** a second timestamp parser; changes to player chapters (Story 10.1), non-timestamp LinkChips («· Открыть», «QR»), the hero or comments; a new request; logging link URLs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chapter line | paragraph «[0:20] Что тут происходит?» (link = timestamp of this post) | One chip «▶ 0:20 Что тут происходит?»; no text line, no «0:20 · Смотреть» chip | N/A |
| Consecutive lines | several chapter lines (separate paragraphs or `\n` lines of one paragraph) | Tight chip list, ↑↓ moves through it, post order kept | N/A |
| Mixed paragraph | intro text, then chapter lines in the same paragraph | Intro stays a paragraph stop; the chapter lines become chips after it | N/A |
| Empty title | line is only «[1:30]» | Chip «▶ 1:30» | N/A |
| Inside a paragraph | «… на [42:10] я рассказываю …» | Paragraph text unchanged; chip «▶ 42:10» after it | N/A |
| Line with another link | «[3:00] Гость — [его канал]» | Stays as today: paragraph + chips | N/A |
| Not this post | timestamp link to another post or unknown `tmid` | Unchanged (paragraph + «· Открыть» / «QR» chip) | N/A |
| Player off | `phaseFlags.player` false | Chips render; OK opens the link's QR | N/A |
| Back from player | OK on a chip, then Back | Focus returns to that chip | N/A |

</frozen-after-approval>

## Code Map

- `src/shared/entities/post/postBody.ts` -- `postBodyItems` (l.536): paragraphs are built from inline blocks into a `Line` (`plain`, `segments`, `links`) and flushed by `pushStops` (l.565) with links resolved through `timestampRef` (l.590). Add the chapter-line split here (needs `selfPost` + `qr`), emitting a new `PostBodyItem` kind (e.g. `timestamp`: key, mediaId, seconds, title, url) in place of those lines; the rest of the paragraph keeps today's stops and keys.
- `src/shared/entities/post/chapters.ts` -- `nameAfter` and `LEADING_SEPARATORS`: the chapter-name rule; export a shared helper and use it in both places.
- `src/features/post/PostBody.tsx` -- renders items; add the new kind (a chip list group for consecutive items).
- `src/features/post/body/LinkChips.tsx` -- `LinkChip` action `play` now renders «▶ time» (inline timestamps); keep `post`/`qr` unchanged. Add the chapter chip here or in a sibling, reusing `chipParts.tsx` (`chipSurface`, `chipStyles`, `ChipGuide`).
- `src/shared/i18n/ru.ts` (`post.chip`) -- new labels; `watchSuffix` may become unused.
- `src/shared/ui/icons/index.tsx` -- a play glyph if none exists.
- Tests: `src/shared/entities/post/__tests__/postBody*.test.ts`, `chapters.test.ts`, `__tests__/postFlow.test.tsx` (Story 6.3 timestamp tests at «timestamp», Story 13.1 block).
- Mockup (visual spec only): `/private/tmp/claude-501/-Users-dzmitryafanasenka-Documents-Projects-js-boosty/56fa7fd7-cf2f-4d38-a3e7-0220eb9f612d/scratchpad/post-design/project/Chapters.dc.html` (px ÷ 2 = dp).

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/entities/post/chapters.ts` -- export the chapter-name helper; `postChapters` uses it unchanged -- one rule
- [x] `src/shared/entities/post/postBody.ts` + types -- chapter-line split into `timestamp` items with stable keys; unit tests for every matrix row at entity level -- data
- [x] `src/features/post/body/LinkChips.tsx` (+ new chip component) -- chapter chip «▶ time title» (one line, ellipsized, max `text-measure`), inline timestamp chip «▶ time» -- UI
- [x] `src/features/post/PostBody.tsx` -- render consecutive timestamp items as one tight list -- composition
- [x] `src/shared/i18n/ru.ts`, tokens if needed -- copy and a11y -- i18n
- [x] `__tests__/postFlow.test.tsx` -- matrix rows at screen level, focus order, OK → player at the second, Back → chip -- regression
- [x] `docs/focus-map.md` F Пост, DESIGN.md LinkChip and EXPERIENCE.md Пост as built, `docs/feature-parity.md` IMP-06, `docs/testing.md` -- docs

**Acceptance Criteria:**
- Given a post with a chapter list, when Пост opens, then no chapter text appears twice and each chapter is one focus stop.
- Given the release-like build on the pinned TV, when the agent opens «Философский выпуск по вашим заявкам №2», then the chapters show as «▶ 0:00 Приветики!», «▶ 0:20 Что тут происходит?», … (agent screenshot; the remote check is the owner's).

## Design Notes

Split at line granularity before `lineStops` so the paragraph budget logic is untouched. The chip list is a sequence of ordinary column stops (native focus), not a new focus container.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0` -- expected: clean
- `npm run typecheck` -- expected: clean
- `npm test -- --ci` -- expected: all pass

**Manual checks (if no CLI):**
- Release-like build on the pinned Chromecast: screenshot of Stas's post chapters, focused chip, Back from the player to the chip (no playback longer than 10 s on the owner's account).

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | gap | Links and styles of kept lines in a split paragraph untested | medium | Pre-verified gap; `subLine` has no test with a kept-line link or span → patch (entity test) |
| 2 | gap | Grouping of chapter items from separate paragraphs not checked at render level | low | Pre-verified; direct one-test fix → patch |
| 3 | edge | Whole line linked («[0:20 Что тут]») loses its words | medium | Confirmed: `chapterOf` takes the title only from text after the link (`postBody.ts:517`) → patch |
| 4 | edge | `TimestampList` keyed by the first chip; a refetch changing it remounts the list | low | Real but needs a post edit while Пост is open; fix adds keying logic → rejected |
| 5 | edge | Chapters of separate paragraphs merge into one list | false | Intended: matrix «Consecutive lines (separate paragraphs …)» → one tight list |
| 6 | edge | Chip with neither `onPlayAt` nor `onOpenQr` is a dead stop | false | `PostScreen` always passes `onOpenQr` |
| 7 | edge | Same second in two videos gives identical «▶ 3:45» chips | low | Rare; fix adds labelling logic → rejected |
| 8 | blind | Story status differs across files | false | `sprint-status` stays `in-progress` until step 5 by design; epic context predates the story |
| 9 | blind | No recorded visual check against the mockup | low | Device screenshots s7/s8/s10/s11 exist and match `Chapters.dc.html`; → rejected |
| 10 | blind | Hundreds of chips not virtualized at render | medium | Pre-existing: the Пост body was never virtualized (ScrollView) → defer |
| 11 | blind | Rest-of-line rule still in two places (`nameAfter`, `chapterOf`) | low | Titles agree (parity test); divergence only in matrix-excluded lines → rejected, noted |
| 12 | blind | Player off: chip shows ▶ but OK opens a QR | low | `phaseFlags.player` is on in every release → rejected |
| 13 | blind | «No title» passed by string compare | low | Needs a title equal to its own time → rejected |
| 14 | blind | Bullet-prefixed chapter lines («• 0:20 …», «1) 0:20 …») not recognised | medium | Real: they keep the duplicate; outside the frozen «starts with a timestamp link» rule → defer for an owner decision |
| 15 | blind | A link with an unsafe URL blocks the conversion | low | Rare → rejected |
| 16 | blind | List spacing token and comment mismatch | low | Cosmetic → rejected |
| 17 | blind | ▶ glyph too small | false | Device screenshot s8 shows a clearly visible glyph |
| 18 | blind | `lineParts` quadratic | low | 300 lines ≈ 90k cheap ops, memoised per post → rejected |
| 19 | blind | Inline chip a11y lost context | low | «Смотреть с 3:45» follows its paragraph → rejected |
| 20 | blind | Nested lists, split spans, >600-char paragraphs untested | low | Partly covered by #1's patch → rejected |
| 21 | blind | Device coverage of inline chip and player-off not tracked | low | Reported to the owner as residual risk |
