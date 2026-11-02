# Epic 13 Context: Post screen redesign (our improvements)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make Пост faster to read and start on the TV. A video post gets a large 16:9 preview with the title, meta and actions beside it. Every post gets a «На телефоне» QR with the post's own boosty.to link. Timestamp lines become single chips instead of a text line followed by a duplicate chip. These are our improvements, not reference parity (owner decisions 2026-11-02, approved mockup «Пост — новый макет»). No new endpoint or unknown is involved; the work stays in `src/features/post` and the existing shared primitives. Story 13.1 (header, preview, QR) is done and merged. Story 13.2 (timestamp chips) is next.

## Stories

- Story 13.1: Пост header with a large preview and the post's QR (done)
- Story 13.2: Timestamp chips instead of a text line and a chip

## Requirements & Constraints

- **Header, as built (13.1):** in a video post, the author row comes first, then the hero. The hero has a non-focusable 16:9 preview on the left showing the duration, «Видео N из M» and a progress line, with a neutral plate when there is no preview or it fails to load. The right side has the title, the meta line, the media line and the action row: primary → «С начала» (progress > 0 only) → «На телефоне». One video: no MediaRow. Several videos: a compact «Видео в посте · N» tile row under the header. Non-video and locked posts keep the old header and add «На телефоне» under the meta. A locked post never shows a price or a subscribe action.
- **«На телефоне», as built:** after an owner follow-up it is an **icon-only square QR button** in the action row. Its label appears under it only while focused, outside the layout, and TalkBack reads the full label. OK opens the QrDialog «Пост на Boosty» with `boosty.to/<blogUrl>/posts/<postId>`. The button is hidden when the URL cannot be built. The URL is never printed or logged.
- **Timestamp line (13.2):** a text line that starts with a timestamp link to a video in this post renders as one chip «▶ time  title». The title is the rest of the line, on one line, ellipsized. The plain text line is not rendered. Consecutive timestamp lines form a tight list with no blank lines between them, and ↑/↓ moves through them.
- **Timestamp inside a paragraph (13.2):** the paragraph stays as text, and one «▶ time» chip per timestamp follows it.
- **OK on a timestamp chip:** opens the player at that second with the existing timestamp-start progress rules (a timestamp start overwrites the resume point after 10 s). Player chapters and non-timestamp LinkChips keep their current behaviour: QR, or «· Открыть» for a Boosty post.
- **Scale:** hundreds of chips stay virtualized and focus-safe.
- Russian copy goes through i18n (`ru.ts`). Accessibility labels cover chips, buttons and tiles.
- **Done:** a visual check against the mockup on the release-like build at 1080p. Then update `docs/focus-map.md` (Пост), the DESIGN/EXPERIENCE "planned" notes to "as built", the `docs/feature-parity.md` improvement rows, and the wiki after each story.

## Technical Decisions

- **Progress:** read only through `useProgress(ref)` / `progressStatus`. "Finished" (≥ 95 % or < 30 s left) and `resumePoint` are computed only by the ProgressRepository. Never read `timeCode` in UI.
- **Identity:** every playable item is a `MediaRef {blogUrl, postId, mediaId}`. Never key focus or progress by index or URL, and never put signed URLs in route params or keys.
- **Timestamps:** reuse the existing recognizer (`timestampRef`: a `boosty.to/<blog>/posts/<post>?t=<sec>&tmid=<videoId>` link whose `tmid` is a video of this post). Do not add a second parser. Chip titles may reuse the Story 10.1 chapter-name rule: the text after the link to the end of the line, with leading separators trimmed, or the time itself when that text is empty. Links to another post's video, or in an unrecognized format, keep their normal chip.
- **Focus:** native focus only, with no D-pad handlers in Пост. IDs follow `post/<postId>/<zone>/<id>`, and the existing ids are fixed: `primary`, `restart`, `phone`, `video/<mediaId>`, and body blocks. Пост keeps its own column focus memory, and a refetch that removes the focused stop uses the shared vanished-stop fallback. The return target after the player goes through FocusRestoration / `endedReturnFocusId`.
- **Layout:** the mockups are 1920×1080 design px, which is 2× the app dp in `src/shared/ui/tokens.ts`. Halve the sizes into tokens; never hardcode 1920 units. Any new token goes into DESIGN.md frontmatter and `tokens.ts` together, because the tokens test compares them. 13.1 added the `post-hero` (preview 320×180 dp) and `media-tile` (168 dp) groups.
- **Timestamp chip mockup (`Chapters.dc.html`, design px):** a pill 64 high with padding 0 32 / 0 24, 16 between the time and the title, and 26 text. The background is a raised surface (#2E2B28). The time is semibold in the accent text colour, with a min width of 64 in the list form and none in the paragraph form. The chip hugs its content (left-aligned, not full width). The list gap is 12. A paragraph chip sits 16 below its paragraph. The body column gap is 32, and body text is 28/44 at max width 1200. The grey 22 px captions in the artboard are design annotations, not app copy.
- Mockups (visual spec only, not code): `/private/tmp/claude-501/-Users-dzmitryafanasenka-Documents-Projects-js-boosty/56fa7fd7-cf2f-4d38-a3e7-0220eb9f612d/scratchpad/post-design/project/` contains `Main.dc.html`, `MultiVideo.dc.html` and `Chapters.dc.html`.

## UX & Interaction Patterns

- **Initial focus:** primary; otherwise the first tile; otherwise the first body stop; otherwise «На телефоне». A locked post starts on the author. Column order: author → primary → «С начала» → «На телефоне» → tiles → body (including chips) → comments. The body stays one column in the same element order.
- **Focused chip:** inverts to a light fill (#F4EFE7) with dark text, the time loses its accent, and it gets a 4 px light outline at a 4 px offset and scales about 1.02 from its left edge. Scaling must not reflow the layout or clip the ring.
- **Return from the player:** after a video ends, focus goes to the next unfinished tile, else to the primary. Back from a player started by a timestamp returns to that chip. The other Back rules are unchanged.
- The sidebar stays visible on Пост. The read-only «Комментарии» block stays at the bottom, and the comment count appears only in the header.

## Cross-Story Dependencies

- 13.2 builds on the 13.1 composition (`PostScreen`, `PostHero`, `body/VideoActions`, `body/VideoTiles`). It edits the body path (`PostBody`, `body/TextBlocks`, `body/LinkChips`) and should not touch the header.
- Shipped work that must not regress: Story 6.3 (link/timestamp chips and the `{atSec}` player start), Story 10.1 (chapters built from the same timestamp links), Story 11.2 (comments block and header count), and FR-49 return focus.
- Epic 12 Story 12.2 (progress on feed cards) shares the `useProgress` / "finished" rules with the hero and the tiles.
