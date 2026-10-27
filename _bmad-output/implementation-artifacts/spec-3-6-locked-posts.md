---
title: 'Story 3.6: Locked posts'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: '2fdf7f68eb22942466f6844b0686d6e9ced0957b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-post-header-layout.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A locked post opens as a header and a neutral teaser placeholder with no explanation; the family cannot tell why there is nothing to read or watch (FR37, epics.md Story 3.6).

**Approach:** On the Post screen of a locked post (`hasAccess=false` or empty `data`), show the no-access copy (with the subscription level name when known) and the teaser under the header, initial focus on the author, and never a price, payment or subscribe action. Locked cards in lists already show the dimmed preview, lock glyph and «Нет доступа» badge (Story 3.1): verify, do not redo.

**Decisions:**
- Copy (EXPERIENCE.md «Honest limits»): with a level name — «Нет доступа. Этот пост доступен подписчикам уровня «{level}». Оформить подписку можно на сайте или в приложении Boosty.»; without one — «Нет доступа. Этот пост доступен подписчикам автора. Оформить подписку можно на сайте или в приложении Boosty.» Plain non-focusable text, no button.
- Place: right under the header, before the teaser.
- Teaser image (owner decision 2026-10-27, option A): a teaser `image` block renders as a non-focusable image under the copy, at the column width (capped at `text-measure`), max height 300 dp, aspect from the block's width/height when known, `resizeMethod="resize"`, `fadeDuration={0}`, no auth headers; no URL or a load failure → the neutral «Изображение» placeholder. Only teaser images; images inside accessible posts stay Story 6.2.
- Teaser fits the screen (owner decision 2026-10-27, after the device run): the teaser image uses the loaded image's real aspect ratio (the block's width/height may be wrong, e.g. 4:3 for a 16:9 image) and its height is capped so the header, the copy and one teaser image fit in the viewport without scrolling (about 240 dp on the pinned device; computed from the window, not hard-coded). With nothing focusable below the author, ↓ does nothing and focus never leaves the author (the scroll container never takes focus).

## Boundaries & Constraints

**Always:**
- `Post.levelName` (already parsed from `subscriptionLevel.name` only) is the only level input; never read or show `price`, `currencyPrices`, promos or payment fields.
- A locked response is never a session problem (an invalid token looks anonymous, api-contract §7): no refresh, no A11, no error state.
- Initial focus on the author; the copy is not a focus stop; teaser paragraphs (if any) are focus stops as in 3.4; teaser videos stay placeholders (no MediaRows for a locked post).
- Russian copy from `ru`, i18n-ready; the copy is readable by TalkBack (accessible text).

**Never:** No «Оформить подписку» button, QR, price, level list or link to payment; no new endpoints.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Locked with level | `hasAccess=false`, `subscriptionLevel.name` «Базовый» | header, copy with «Базовый», teaser; focus on author | — |
| Locked, no level | no `subscriptionLevel` / blank name | header, copy without level, teaser | — |
| Empty data | `hasAccess` true but `data: []` | treated as locked: copy + teaser | — |
| Teaser kinds | image / text / video / none | image (failure → placeholder) / paragraph stop / placeholder / nothing | — |
| Price fields | `price`, `currencyPrices` present | never shown | — |
| Card | locked post in feed/Автор | dimmed, lock, «Нет доступа» (existing; regression test) | — |

</frozen-after-approval>

## Code Map

- `src/features/post/PostScreen.tsx` (~l.121–141: `items` from `post.teaser` when locked; `initialId` → author) -- render the locked copy after the header for a locked post.
- `src/features/post/PostHeader.tsx` / new `LockedNotice` in `src/features/post/` -- the copy block (tokens, `body` typography, non-focusable, accessible).
- `src/features/post/PostBody.tsx` -- teaser image (owner decision A) (only when rendering the teaser).
- `src/shared/entities/post/mapPost.ts` (`hasAccess`, `levelName` l.258), `types.ts` -- already in place; add tests only if a gap shows.
- `src/shared/ui/PostCard.tsx` (~l.151–192 locked) -- existing; add a regression test if none covers dim + lock + badge together.
- `src/shared/i18n/ru.ts` -- `post.locked.withLevel`, `post.locked.noLevel`.
- `src/app/dev/demo.ts` -- a locked demo post with and one without a level name.
- Tests: `__tests__/postFlow.test.tsx` (locked rows), fixtures `e8-post-locked.json`.
- Docs: `docs/focus-map.md` §4 F locked note, `docs/testing.md` Story 3.6, `docs/feature-parity.md` row for locked content if one exists (FR37).

## Tasks & Acceptance

**Execution:**
- [x] `src/features/post/*`, `ru.ts` -- copy, placement, teaser image, focus.
- [x] `src/app/dev/demo.ts`, tests -- every matrix row; no price text anywhere on the locked screen; no refresh/A11.
- [x] Docs -- focus-map §4 F, testing.md.
- [x] Device (release-like, owner's session) -- open a locked post from the feed/Автор: copy, level, teaser, focus on author, Back.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; post flow tests 30/30; lint, typecheck, check:fixtures clean.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | `scrollEnabled={firstStopId !== null}` leaves overflow unreachable: two+ teaser images, the 96 dp floor with a long title/level, an accessible post of placeholders only; it is pinned only for locked posts (blind, edge, verification-gap) | high | patch: scrolling stays on whenever the content overflows the measured viewport (only content that fits disables it); tests incl. accessible video-only, text, placeholder-only posts |
| 2 | The cap uses the window height and a duplicated padding instead of the measured viewport; the test repeats the arithmetic (blind) | medium | patch: measure the ScrollView (onLayout) |
| 3 | `maxWidth: '100%'` clamps width but not the explicit height in a narrow column (blind, edge, verification-gap) | low | patch: size the box from the measured column width |
| 4 | `copyBottom` survives a post change / an unlocked refetch (blind, edge) | low | patch: reset it |
| 5 | A refetch that removes every stop after scrolling leaves the column offset (edge) | low | patch: scroll to top when scrolling turns off |
| 6 | `teaserImageMaxHeight` and the URL reset of `TeaserImage` lack unit tests (blind) | low | patch: tests |
| 7 | Empty `data` with `hasAccess` true says «Нет доступа» to a possibly entitled user (blind) | maybe-false | rejected: api-contract §7 defines empty `data` as locked (live, Story 1.5); the frozen matrix row «Empty data» says so |
| 8 | Test evidence in testing.md predates the final code; stale epic-context lines; 3.4/3.5 «not verified» paragraph not updated (blind) | low | patch: docs (the orchestrator records the final 3×/30× run) |
| 9 | Device task ticked though the feed entry path was not run (edge) | low | patch: testing.md says Автор only |
| 10 | Demo locked posts untested; demo teasers have no URL (blind, verification-gap) | low | defer (dev-only) |
| 11 | Unescaped/unbounded level name in the copy (blind) | low | rejected: the name comes from Boosty as shown on the site; the floor + scrolling (#1) cover a long one |
| 12 | Spec decision still says 300 dp (blind) | false | the next frozen decision («Teaser fits the screen») supersedes it explicitly |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `postFlow` 30×.
