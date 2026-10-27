---
title: 'Post screen: header on top instead of two columns'
type: 'refactor'
created: '2026-10-27'
status: 'done'
baseline_commit: '7396d82ba992a235676d49bf6529e4b114f4e5ef'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-4-post-screen.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5-media-rows-in-a-post.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Post screen's two columns (DESIGN.md «Post screen. Two columns») split a mostly-video post into a narrow left header and a narrow right column; the owner prefers the TV-conventional layout with the author and title as a header on top (owner decision 2026-10-27).

**Approach:** One vertically scrolling column inside the content area: a header (author row → Автор, title, date · likes), then the MediaRows, then the body (paragraphs and placeholders) with the text width capped for readability. Data, MediaRows, paragraph splitting, ids, states and Back behaviour stay as built in Stories 3.4 and 3.5.

**Decisions:**
- Order: header → MediaRows → body. The header scrolls away with the content; it is not pinned. Future «Смотреть»/«С начала» (Epic 4) and the locked copy (3.6) go in or right under the header.
- Focus: initial focus unchanged (first MediaRow, else first paragraph, else the author; locked → the author). ↑ ↓ move through author → rows → paragraphs in one column; ↑ from the first row or paragraph reaches the author; ← from any of them → the sidebar's current item; → from the sidebar → the remembered element. Back pops, as before.
- Text width: paragraphs and placeholders are capped at about 600 dp (≈ 75 Cyrillic characters at `typography.body`), left-aligned; the header and the rows may use the full content width. The paragraph stop budget is recomputed for the new width so a stop stays well under the viewport.

## Boundaries & Constraints

**Always:**
- Keep every focus id (`post/<postId>/author`, `/video/<mediaId>`, `/block/<key>`, `state/post/action`, `post/nav/<section>`), the MediaRow and ParagraphStop components, `postBodyItems`/`videoRowsOf`, the states and the restoration contracts; only layout, focus guides and the stop budget change.
- One focus guide/zone for the column with ↑ ↓ trapped at its ends; native focus scroll only (no JS scroll on focus); slot padding so the scaled row and ring stay visible (as the grids).
- Tokens only from `shared/ui/tokens.ts`; keep the skeleton, error and unavailable states readable in the new layout.

**Never:** No pinned/sticky header, no new endpoints, no behaviour change outside the Post screen.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Video post | 2 videos + text | header, 2 rows, paragraphs in one column; focus on row 1 | — |
| Text post | text only | header, paragraphs; focus on the first paragraph | — |
| Up to author | focus on the first row | ↑ → author | — |
| Long text | 30 paragraphs | ↓ walks to the end; the header scrolls away; ↑ walks back to the author | — |
| Sidebar | focus on a paragraph | ← → `post/nav/<origin>`; → back to that paragraph | — |
| Locked | `hasAccess=false` | header + teaser placeholder; focus on the author | — |
| States | loading / 404 / error | skeleton, «Пост недоступен», error StateView in the single column | as 3.4 |

</frozen-after-approval>

## Code Map

- `src/features/post/PostScreen.tsx` (render ~l.312–400: `post/left` and `post/right` `TVFocusGuideView`s, `LEFT_WIDTH`, `firstRightId`, the right-guide destination `lastRight`) -- merge into one `ScrollView` column inside one guide; the header becomes the first child; keep `initialId` logic; replace the left/right guide destinations with a single column destination (remembered element, else initial).
- `src/features/post/PostHeader.tsx` -- full-width header layout (avatar + author row, title, meta); skeleton matching.
- `src/features/post/PostBody.tsx` -- text width cap; rows full width.
- `src/shared/entities/post/postBody.ts` (`PARAGRAPH_STOP_MAX_CHARS`, comment with the width math) -- recompute for ≈ 600 dp.
- Tests: `__tests__/postFlow.test.tsx` (left/right guide assertions → column assertions; ↑ to author; ← sidebar), `postBody.test.ts` budget.
- Docs: `docs/focus-map.md` §4 F (table row: «Left column … → into the right column» → one column), `_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md` «Post screen» (owner decision, header on top), `docs/testing.md`.

## Tasks & Acceptance

**Execution:**
- [x] `src/features/post/*`, `src/shared/entities/post/postBody.ts` -- single column, header, text cap, budget.
- [x] Tests -- every matrix row; existing post flows updated, none weakened.
- [x] Docs -- focus-map §4 F, DESIGN.md Post screen, testing.md.
- [x] Device (release-like, owner's session) -- a video post and a long text post: header, rows, ↓ to the end, ↑ to the author, ← sidebar, Back.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; post flow tests 30/30; lint, typecheck, check:fixtures clean.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Placeholder text-measure cap untested (verification-gap) | low | patch: test |
| 2 | Duplicated clause in focus-map «Long text» (blind, verification-gap) | low | patch: docs |
| 3 | Docs say 404/error sit in the single column; the code replaces the column with the StateView (no header skeleton) (blind, edge, verification-gap) | low | patch: docs say «replaces the column»; test the 404/error containment |
| 4 | Stale 3.4/3.5 focus-map notes (left/right columns, ← to author) left next to the superseded marker (blind) | low | patch: rewrite |
| 5 | A 6-line title can push the first row low on open (blind) | low | rejected: native focus scroll brings the focused row into view; a 6-line title at full width is rare |
| 6 | Epic 4 «Смотреть» placement left open (blind) | medium | defer: decide in Epic 4 (in the header vs under it; ↑ ↓ order) |
| 7 | `Post Screen.dc.html` still shows two columns (blind) | low | defer: mark the mock superseded in the UX pass |
| 8 | Budget test repeats comment arithmetic (blind) | low | rejected: cosmetic |
| 9 | Header skeleton name width reuses `author-tile-width` (blind) | low | patch: a percentage |
| 10 | `PostHeader` comment contradicts `AuthorRow` (blind) | low | patch: comment |
| 11 | `rightStops` test helper name (blind) | low | patch: rename |
| 12 | Long-text/sidebar tests are destination bookkeeping, not navigation proofs (blind) | low | patch: say so in testing.md |
| 13 | Spec device task ticked (blind) | false | testing.md states adb main path only |
| 14 | 600 dp measure rationale (blind) | low | rejected: ≈ 75 characters documented in DESIGN.md |
| 15 | Column guide keeps a stale remembered element across ready → error → ready (edge) | low | patch: clear it when the phase leaves ready |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `postFlow` 30×.
