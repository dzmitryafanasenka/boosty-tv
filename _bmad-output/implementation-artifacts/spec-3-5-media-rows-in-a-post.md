---
title: 'Story 3.5: Media rows in a post'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: '2a4c7111d8104647ea78659ebfdde5957b1aabe9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-4-post-screen.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A post's videos show only as «Видео» placeholders; the family cannot see how many videos a post has or which part is which (FR33, UX-DR9; epics.md Story 3.5).

**Approach:** Replace the video placeholders with one MediaRow per `ok_video` block (thumbnail, «Видео N», title, duration), identified by `MediaRef {blogUrl, postId, mediaId}`, focusable for reading, with no «Смотреть» while the player phase flag is off, and with no `timeCode` or signed URL reaching the UI or routes.

**Decisions:**
- Placement (DESIGN.md Post screen): the MediaRows sit at the top of the right column, in block order; the text and other placeholders follow. Video blocks no longer appear as placeholders.
- Status before Epic 4: progress is not known yet (ProgressRepository, Epic 4), so the row shows the duration («12:34») when known instead of «Не начато / Осталось N мин / Просмотрено»; nothing when unknown. Never a fake «Не начато».
- Initial focus: the first MediaRow; a locked post → the author (as 3.4). OK on a row does nothing (no dead end; the player is Epic 4).
- A video block without an id has no MediaRef: it stays a neutral placeholder.

## Boundaries & Constraints

**Always:**
- `MediaRef` is a domain type in `shared/entities/post` (with a helper that lists a post's MediaRefs in order); keys and focus ids use `mediaId`, never an index or URL: `post/<postId>/video/<mediaId>` (focus-map §1.5). Duplicate ids keep the first.
- A `player` capability flag in `app/phaseFlags.ts`, off; the row shows no action label while it is off.
- Thumbnail: the video's preview URL with `resizeMethod="resize"`, `fadeDuration={0}`, a neutral placeholder when missing or failed; no auth headers on images.
- `timeCode`, `playerUrls` and `signedQuery` never reach the Post entity, the UI, query keys or route params (test the domain shape).
- Tokens from `shared/ui/tokens.ts` (`media-row`), DESIGN states (default, focused with `scale-row`, pressed); Russian a11y label «Видео N. {title}. {duration}» from `ru`.
- Focus: ↑ ↓ through rows then paragraphs in one right column; ← → author; restoration on Back unchanged.

**Never:** No «Смотреть»/«Продолжить»/«С начала», no progress line, no player route, no audio rows (Epic 6.4), no request beyond E8.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two videos | 2 `ok_video` + text | 2 rows «Видео 1», «Видео 2» on top, then paragraphs; focus on row 1 | — |
| One video | 1 `ok_video` | 1 row «Видео 1» | — |
| No title | video title empty | «Видео N» only | — |
| Duration | 754 s / missing | «12:34» / no duration | — |
| No preview | preview missing or fails | thumbnail placeholder | — |
| No id | `ok_video` without id | neutral placeholder, no row | — |
| Duplicate id | same id twice | one row | — |
| Locked | `hasAccess=false` | no rows; focus on author | — |
| Domain shape | live E8 fixture | no `timeCode`/`playerUrls`/`signedQuery` in Post, MediaRef or props | — |

</frozen-after-approval>

## Code Map

- `src/shared/entities/post/types.ts`, `mapPost.ts`, `index.ts` -- `ok_video` block already has `id`, `title`, `durationSec`, `previewUrl`; add `MediaRef` and `mediaRefsOf(post)` (or `videoRowsOf`) returning `{ref, index, title, durationSec, previewUrl}` in block order, deduped by id.
- `src/shared/entities/post/postBody.ts` -- video blocks with an id leave the body items (a video without an id stays the `video` placeholder); keep keys stable for the rest.
- `src/features/post/PostScreen.tsx` (~l.113 `initialId`, ~l.332 ScrollView), `PostBody.tsx` -- render the rows above the body in the right column; initial focus = first row when present; the right-column guide and restoration include rows.
- `src/shared/ui/` -- new `MediaRow.tsx` on `FocusableSurface` (`media-row` token at `src/shared/ui/tokens.ts:233`), reuse `formatDuration` (`src/shared/i18n/format.ts:62`), `useItemState` for the image failure.
- `src/app/phaseFlags.ts` -- `player: false` (not a section; `enabledSections` stays section-only).
- `src/shared/i18n/ru.ts` -- `post.video.label` («Видео {n}»), a11y.
- `src/app/dev/demo.ts` -- a demo post with 2 videos (one without a title).
- Tests: `__tests__/postFlow.test.tsx`, `src/shared/entities/post/__tests__/*`, a MediaRow component test (states, native view budget like PostCard).
- Docs: `docs/focus-map.md` §4 F notes, `docs/testing.md` Story 3.5.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/entities/post/*` (+ unit tests) -- MediaRef, rows helper, body without video blocks with ids, domain-shape test.
- [x] `src/shared/ui/MediaRow.tsx` (+ test), `src/app/phaseFlags.ts`, `ru.ts` -- the row.
- [x] `src/features/post/*` -- rows on top, initial focus, focus order.
- [x] `src/app/dev/demo.ts`, tests -- every matrix row; focus ↑ ↓ rows → paragraphs, ← author, Back restore.
- [x] Docs -- focus-map §4 F, testing.md.
- [x] Device (release-like, owner's session) -- a post with one and with several videos: rows, thumbnails, durations, focus.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new/changed flow tests 30/30; lint, typecheck, check:fixtures clean.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | `phaseFlags.player` is declared but gates nothing; the «no action while off» rule holds only by structure (blind, verification-gap) | medium | patch: the app passes the flag to the Post screen; the row gets an action only when it is on (never in this story) |
| 2 | Feed badge counts duplicate and empty-id videos («2 видео» vs one row) (blind, edge) | medium | patch: count distinct non-empty video ids in `kindOf` |
| 3 | The row is announced as a button with no action (TalkBack dead end) (blind) | low | patch: no button role while the player is off |
| 4 | `postBodyItems` defaults `videoRows` to true; a teaser call without it drops videos (blind, edge) | low | patch: default false; the Post body passes true |
| 5 | Comments in `mediaRows.ts`/`postBody.ts` say an id-less video never arrives as `ok_video` (blind) | low | patch: comments |
| 6 | Thumbnail failure reset on a new preview URL untested (verification-gap) | low | patch: test |
| 7 | Paragraph keys around a removed video not compared with `videoRows: false` (blind) | low | patch: test |
| 8 | An id-less video stays a placeholder inside the text, outside the numbered rows (blind) | low | rejected: the owner-approved decision; no live sample |
| 9 | A vanished row after a refetch falls back to the first row, not a neighbor (blind) | low | rejected: a refetch rarely changes a post's videos; documented |
| 10 | Headroom test uses hard-coded numbers (blind) | low | rejected: cosmetic |
| 11 | Spec statuses / testing.md lacks lint results (blind) | false | statuses move at completion; the orchestrator ran lint, typecheck, check:fixtures |
| 12 | Unused public exports (`mediaRefsOf`, `MediaRowView`) (blind) | low | rejected: `MediaRef` is the Epic 4 contract (AC) |
| 13 | A remembered right-column target can dangle after a refetch (blind) | low | rejected: a missing view falls back to the first focusable |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; changed flow tests 30×.
