---
title: 'Story 13.1: Пост header with a large preview and the post QR'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: 'f898ee89fb34c76a1bc411dc134bfaf25f4f4f65'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On Пост a video is started from three places (the primary button, a thin MediaRow strip with a 96×54 thumbnail, timestamp chips), and the preview is too small to recognise the video. There is no way to open the post itself on a phone.

**Approach:** Implement the approved mockup «Пост — новый макет» (artboards `Main.dc.html`, `MultiVideo.dc.html`): a two-part header for a video post — a large 16:9 preview on the left, the title, meta, media line and actions on the right — with a «На телефоне» QR of the post's boosty.to URL. A single-video post loses the MediaRow strip; a multi-video post gets a compact tile row under the header. The body below stays one column.

## Boundaries & Constraints

**Always:** progress and «finished» come only from `useProgress` / `progressStatus` (AD-10); focus ids keep `post/<postId>/primary|restart|video/<mediaId>` so FocusRestoration and `endedReturnFocusId` keep working; native focus only (no D-pad handlers); sizes from `tokens.ts` (mockup px ÷ 2), new tokens added to DESIGN.md frontmatter and `tokens.ts` together (the tokens test compares them); Russian copy in `ru.ts`; accessibility labels for the new button and tiles; the QR goes through the existing `onOpenQr` → `QrDialog` modal path (Back returns to the button).

**Decisions (owner, 2026-11-02):** «На телефоне» appears on every post — video, text, audio, poll and locked. The spec stays one story despite ~2000 tokens (owner kept the full spec).

**Never:** a second timestamp parser or any change to timestamp chips (Story 13.2); a new request or endpoint; a signed URL or account data in the QR; logging the post URL; changes to comments, polls, audio or the player; reading `timeCode` in the header.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| One video, not started | 1 row, no progress | Preview with duration; media line «Видео · 56:14»; buttons «Смотреть», «На телефоне»; no MediaRow | N/A |
| One video, in progress | progress 12:08 of 56:14 | Preview progress line; media line «Видео · 56:14 · осталось 44 мин»; «Продолжить · 12:08», «С начала», «На телефоне» | N/A |
| Several videos | 3 rows, video 1 watched, 2 in progress | Preview of video 2 with «Видео 2 из 3»; «Продолжить · Видео 2»; tile row «Видео в посте · 3» (tiles keep `post/<id>/video/<mediaId>` ids) | N/A |
| No video | text / audio / poll post | Today's header (author, title, meta) plus «На телефоне»; no preview | N/A |
| Locked post | `hasAccess` false | Today's header, LockedNotice and teaser unchanged, plus «На телефоне» under the meta (opens the post page only; never a price or subscribe action) | N/A |
| Missing / failed preview | `previewUrl` null or load error | Neutral plate with the play glyph, same size | Image `onError` → plate |
| Player off | `phaseFlags.player` false | Preview and media line shown; no play buttons; «На телефоне» stays | N/A |
| Video ended in player | return after real end | Next unfinished tile, else the primary (unchanged rule) | N/A |
| Invalid blog/post id | `boostyPostUrl` returns null | «На телефоне» not rendered | N/A |

</frozen-after-approval>

## Code Map

- `src/features/post/PostScreen.tsx` -- composer: renders `PostHeader`, `LockedNotice`, `PostPrimaryAction`, `PostVideoRows`, `PostBody`; owns `rows`, `statuses`, `primaryTarget`, `firstStopId`, the refetch focus fallback (l.612-644, ids by prefix), `onOpenQr` (l.695) and `endedReturnFocusId` (l.116). Rewire here; keep the fallback covering the new ids.
- `src/features/post/PostHeader.tsx` -- author row (first stop, ↑ target), title (`title-s`, 6 lines), `postMetaLine`. Keep the author row and meta; the title moves into the hero's right column for video posts.
- `src/features/post/body/VideoActions.tsx` -- `PostPrimaryAction` (labels via `post.continue/watch/continueVideo/watchVideo/restart`), `ColumnButton` (`useColumnStop`), `PostVideoRows`. Reuse `ColumnButton`; add the «На телефоне» button and the compact tile row here or in a sibling.
- `src/shared/ui/MediaRow.tsx` -- `mediaRowLabel`, `mediaRowStatusText`, `mediaRowA11yLabel`, progress fraction logic: reuse for tiles; the 64-dp row itself is no longer used on Пост.
- `src/shared/ui/ContinueCard.tsx` -- preview + accent progress line + plate pattern to copy for the hero preview and tiles.
- `src/shared/entities/externalUrls.ts` -- add `boostyPostUrl(blogUrl, postId)` next to `boostyStreamUrl` (l.126), same `blogUrlSchema` guard, both segments `encodeURIComponent`.
- `src/shared/ui/tokens.ts` + DESIGN.md frontmatter -- add a `post-hero` group (preview 320×180, radius `xl`, gap 28, button gap 12) and a `media-tile` group (168×95, gap 16).
- `src/shared/i18n/ru.ts` (`post`, l.350+) -- new keys: «На телефоне», QR title «Пост на Boosty», media line, «Видео N из M», «Видео в посте · N», «Продолжить · {time}».
- Tests: `src/features/post/__tests__/` (postFlow, PostScreen tests), `src/shared/entities/__tests__/externalUrls*`, `src/shared/ui/__tests__/tokens.test.js`.
- Mockup (visual spec only): `/private/tmp/claude-501/-Users-dzmitryafanasenka-Documents-Projects-js-boosty/56fa7fd7-cf2f-4d38-a3e7-0220eb9f612d/scratchpad/post-design/project/Main.dc.html`, `MultiVideo.dc.html`.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/entities/externalUrls.ts` -- add `boostyPostUrl` with unit tests (valid, unsafe blog, odd post id) -- QR target
- [x] `src/shared/ui/tokens.ts`, DESIGN.md frontmatter -- add `post-hero` and `media-tile` tokens -- tokens-only styling
- [x] `src/features/post/PostHero.tsx` (new) -- preview (plate fallback, duration badge, «Видео N из M» badge for several, progress line; not focusable) + right column (title `title-l`, meta, media line, action row) -- the mockup header
- [x] `src/features/post/body/VideoActions.tsx` -- primary label «Продолжить · ЧЧ:ММ» for a single video in progress; «На телефоне» `ColumnButton` (`post/<postId>/phone`); compact `PostVideoTiles` replacing `PostVideoRows` for several videos, ids unchanged -- actions and tiles
- [x] `src/features/post/PostScreen.tsx` -- render `PostHero` for posts with video rows, today's header otherwise; drop rows for one video; wire «На телефоне» to `onOpenQr`; extend the refetch fallback to the phone id -- composition
- [x] `src/shared/i18n/ru.ts` -- new copy -- i18n
- [x] tests -- I/O matrix rows, focus order, tile ids, QR open/Back, plate fallback -- regression
- [x] `docs/focus-map.md` F Пост, DESIGN/EXPERIENCE planned→as built, `docs/feature-parity.md` IMP-05 -- docs

**Acceptance Criteria:**
- Given a video post, when Пост opens, then initial focus is the primary and the order is primary → «С начала» → «На телефоне»; ↑ reaches the author; ↓ reaches the tile row (several) or the body.
- Given «На телефоне», when OK, then a QrDialog shows the post URL; Back returns focus to «На телефоне».
- Given the release-like build at 1080p on the pinned TV, then the header matches the mockup (agent screenshot check; the remote check is the owner's).

## Design Notes

The hero replaces the strip only on Пост; MediaRow stays exported for any other use. The preview is not a focus stop — the primary is the single action for it (Winston's rule from the 2026-11-02 discussion). Keep tile ids identical to the old row ids so `endedReturnFocusId` and the player's return target need no change.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0` -- expected: clean
- `npm run typecheck` -- expected: clean
- `npm test -- --ci` -- expected: all pass

**Manual checks (if no CLI):**
- Release-like build on the pinned Chromecast: screenshots of a single-video, a multi-video (demo mode if the account has none) and a text post; compare with the mockup.

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | edge | Empty hero action View when the player is off and `boostyPostUrl` is null | low | Real (`PostHero.tsx:155` wraps `actions` unconditionally) but needs both a non-release flag and an invalid id; fix adds a branch → rejected |
| 2 | edge | Single video with the player off has no focus stop | low | Real; `phaseFlags.player` is on in every release build → rejected |
| 3 | edge | AC focus order does not hold with the player off | low | Same root as #2 (flag off) → rejected |
| 4 | edge | `playerChaptersFlow` still targets `VIDEO('v1')` for a single video | false | Full suite passes (3438/3438); the harness defaults to the primary |
| 5 | blind | Locked video post shows no preview, epic context says «when available» | false | The frozen I/O matrix row «Locked post» says today's header; the spec governs |
| 6 | blind | Fixed 320 dp preview; «На телефоне» wraps | false | 320 dp ≈ 45 % of the 720 dp content; the mockup's own row also wraps (744 px column, `flex-wrap`) |
| 7 | blind | Multi-video not checked on the device (demo mode) | medium | Real verification gap of this story; host tests cover it; reported to the owner as residual risk |
| 8 | blind | «Продолжить · 12:08» from the snapshot, not `resumePoint` | false | Both read the local entry first, then the server `timeCode` (AD-10); a finished target shows no time |
| 9 | blind | A single video's title dropped from the media line | false | Matches the approved mockup («Видео · 56:14 · …»); the post title is shown |
| 10 | blind | Locked short post: `scrollEnabled` now true, the ScrollView may become a stop | false | Scrolling is disabled only when no stop exists; «На телефоне» is a stop now |
| 11 | blind | `statusOf` test helper silently falls back to the hero line | low | Real test weakness for multi-video; direct correction → patch |
| 12 | blind | No test of Back/end return to a tile | false | `playerFlow` Story 4.5 tests (multi-video, `VIDEO('v2')`/`VIDEO('v3')`) run against the tiles and pass |
| 13 | blind | `progressFraction` and plate styles duplicated | low | Cosmetic, no diverging caller named → rejected |
| 14 | blind | Empty View / `primary-row` testID on a phone-only row | low | Cosmetic → rejected |
| 15 | blind | Spec «tests» task unchecked | low | Real → patched (checkbox) |
| 16 | blind | `tokens.test.js` coverage claim | false | The test iterates every `tokens.ts` group generically (l.166) |
| 17 | blind | Unreleased build installed on the owner's TV as 1.2.0 | low | Real operational note; same practice as earlier device checks; reported to the owner |
| 18 | blind | Title lines 6 → 4 with `title-l` | low | Real for very long video titles; the full title stays in the a11y text; a layout decision → rejected, noted |
| 19 | gap | Player-off multi-video hero target untested | medium | Pre-verified gap → patch (assert «Видео 1 из 2» in the l.1508 player-off half) |
| 20 | gap-other | Hero ↔ header remount on a refetch flipping `showHero` | maybe-false | Needs a refetch that flips `hasAccess` on an open post; rare; would be low → rejected |
| 21 | gap-other | Spec task unchecked | low | Duplicate of #15 |
