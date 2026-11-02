# Epic 13 Context: Post screen redesign (our improvements)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make Пост faster to read and start on the TV: a large 16:9 preview with the title, meta and actions beside it, a «На телефоне» QR with the post's own boosty.to link, and timestamp chips that replace the duplicated "text line plus chip" rendering. These are our improvements, not reference parity (owner decisions 2026-11-02, approved mockup «Пост — новый макет»). No new endpoint or unknown is involved; the work stays inside `src/features/post` and existing shared primitives.

## Stories

- Story 13.1: Пост header with a large preview and the post's QR
- Story 13.2: Timestamp chips instead of a text line and a chip

## Requirements & Constraints

- **Header (video post):** a 16:9 preview on the left at about 45 % of the content width, showing duration and a progress line, not focusable. On the right: title, meta line (date · likes · comment count, read-only), a media line (e.g. «Видео · 56:14 · осталось 44 мин»), then the buttons «Продолжить · ЧЧ:ММ» / «Смотреть», «С начала» (only when progress > 0) and «На телефоне».
- **One video:** no MediaRow strip at all.
- **Several videos:** the preview and the primary button target the first unfinished video (the primary reads «Продолжить · Видео N»). Under the header, a compact row «Видео в посте · N» shows one tile per video (preview, «Видео N · title», status: «Просмотрено» / «Осталось N мин» / «Не начато · duration»), and each tile is one focus stop.
- **No video** (text, audio, poll): no preview; everything else is unchanged. A locked post keeps its teaser and no-access copy, with the preview when available. It never shows a price or a subscribe action.
- **«На телефоне»:** opens the existing QrDialog with the post's boosty.to URL (`boosty.to/<blogUrl>/posts/<postId>`). The URL is never printed in full and never logged. Back returns focus to «На телефоне».
- **Timestamp line:** a text line that starts with a timestamp link to a video of this post renders as one chip «▶ time  title» (title = rest of the line, one line, ellipsized). The plain text line is not rendered. Consecutive timestamp lines form a tight list with no blank lines, and ↑/↓ moves through them.
- **Timestamp inside a paragraph:** the paragraph stays as text. One «▶ time» chip per timestamp follows the paragraph.
- **OK on a timestamp chip:** opens the player at that second with the existing timestamp-start progress rules (a timestamp start overwrites the resume point after 10 s). Chapters in the player and LinkChips that are not timestamps keep their current behaviour (QR, or «· Открыть» for a Boosty post).
- **Scale:** hundreds of chips stay virtualized and focus-safe.
- Russian copy goes through the i18n structure. Accessibility labels cover the new buttons, tiles and chips.
- **Done:** a visual check against the mockup on the release-like build at 1080p. Update `docs/focus-map.md` (the Пост header and chips), DESIGN/EXPERIENCE "planned" notes to "as built", `docs/feature-parity.md` improvement rows, and the wiki after each story.

## Technical Decisions

- **Progress:** read only through `useProgress(ref)`. The ProgressRepository alone computes "finished" (≥ 95 % or < 30 s left) and `resumePoint`. Do not read `timeCode` in the header.
- **Identity:** every playable item is a `MediaRef {blogUrl, postId, mediaId}`. Never key focus or progress by index or URL. Signed URLs never go into route params or keys.
- **Timestamps:** reuse the existing recognizer (`timestampRef`: a `boosty.to/<blog>/posts/<post>?t=<sec>&tmid=<videoId>` link whose `tmid` is one of this post's videos). Do not write a second timestamp parser. Chip titles can reuse the Story 10.1 chapter-name rule: the text after the link up to the end of the line, leading separators trimmed, or the time itself when that text is empty. Links to another post's video or in an unrecognized format keep their normal chip.
- **Focus:** native focus only, with no D-pad handlers in Пост. Focus IDs follow `post/<postId>/<zone>/<id>`. Пост keeps its own column focus memory (a documented deviation). The return target after the player goes through FocusRestoration.
- **QR:** generated on the device by the existing QrRenderer/QrDialog. Its only action is «Закрыть», and Back closes it and returns focus to the initiator.
- **Layout:** the mockups are 1920×1080 design px, which is 2× the app's dp units in `src/shared/ui/tokens.ts`. Translate the sizes to tokens and do not hardcode 1920 units. Useful mockup measurements: preview 640×360 px (radius 14), gap 56 px between the preview and the text column, title 56/62 px semibold, meta/media lines 26 px muted, buttons 80 px high (radius 16, gap 24, 28 px text), compact video tiles 336×189 px (gap 32, «Сейчас» badge on the targeted one), timestamp chips 64 px pill (26 px text, time in the accent text colour, min time width 64 px, gap 12–16 px).
- New UI primitive PostHero (preview + actions), built from tokens only. MediaRow survives only as the compact multi-video tile.
- Approved artboards (local): `/private/tmp/claude-501/-Users-dzmitryafanasenka-Documents-Projects-js-boosty/56fa7fd7-cf2f-4d38-a3e7-0220eb9f612d/scratchpad/post-design/project/` — `Main.dc.html` (one video), `MultiVideo.dc.html`, `Chapters.dc.html`. They are visual specs, not code.

## UX & Interaction Patterns

- **Initial focus** stays on the primary button. Order: primary → «С начала» → «На телефоне». ↓ goes to the compact video row (multi-video) or to the body. The body below the header stays one column, in the same element order. This supersedes only the header part of the 2026-10-27 one-column decision.
- **Return from the player** after a video ends: focus goes to the next unfinished video tile, or to the primary button if there is none. A single-video post therefore lands on the primary. Back from a timestamp-started player returns to that chip. Other Back and return rules are unchanged.
- **Focused states:** the primary is accent-filled with a light outline and a slight scale. The focused chip inverts to a light fill and scales from its left edge. Scaling must not reflow the layout or clip focus rings.
- The sidebar stays visible on Пост, as today.
- Comments (read-only «Комментарии» block, count only in the header) are unchanged and stay at the bottom.

## Cross-Story Dependencies

- 13.1 and 13.2 both edit the Пост body/header composition (`PostScreen`, `PostHeader`, `PostBody`, `body/VideoActions`, `body/LinkChips`, `body/TextBlocks`). Do them sequentially, 13.1 first, as the epic suggests.
- Both depend on shipped work that must not regress: Story 6.3 (link/timestamp chips, the `{atSec}` player start), Story 10.1 (chapters from the same timestamp links), Story 11.2 (comments block and comment count in the header), and FR-49 return focus.
- Epic 12 Story 12.2 (feed card progress) uses the same `useProgress` / "finished" rules as the header preview and tiles, with no shared code change required.
