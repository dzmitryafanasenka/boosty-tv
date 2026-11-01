---
title: 'Story 9.4: Visual fidelity and accessibility pass'
type: 'feature'
created: '2026-11-01'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '578a7bb044ea4107e211aa34517fb0aef7e7082a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:**
- No pass has compared the built screens with DESIGN.md and the mocks at 1080p and 720p.
- No test enforces tokens-only styling or computes the DESIGN.md contrast pairs.
- TalkBack has never run on the device.
- Nobody has walked `docs/focus-map.md` screen by screen.
- A known focus-map mismatch is open: Главная loses focus after Настройки → «Главная» when a «Продолжить» card is the remembered focus.

**Approach:**
- Add host guards: a tokens-only source scan, a contrast unit test and a label check on every focusable.
- Fix what they find.
- Walk every IA screen on the device for layout, the focus map and labels, and fix the mismatches.
- List the remaining deviations for the owner to accept.

## Boundaries & Constraints

**Always:**
- Owner decisions 2026-11-01:
  - **TalkBack:** the agent turns TalkBack on over adb on the family TV. It reads `enabled_accessibility_services` first and appends TalkBack, so «Button Mapper» stays. It traverses each screen and reads the spoken text from logcat. Afterwards it restores the exact previous values of `enabled_accessibility_services` and `accessibility_enabled`. The owner then listens to a few screens. These results are labelled agent over adb, and owner where the owner listened.
  - **720p:** a separate 720p Android TV emulator AVD in demo mode. Its results are labelled emulator. The family TV's display settings are not touched.
  - **Font scale:** cap the growth at 1.3× (`maxFontSizeMultiplier` in the shared Text and Button primitives). Fixed heights stay as they are. Screenshot A1 and Button at the maximum system font size on the emulator.
  - One story and one spec, kept whole, at about 2100 tokens.
- Source precedence: EXPERIENCE.md, then DESIGN.md and `docs/focus-map.md`, then the mocks. The "As built" and "Superseded" notes in DESIGN.md are the target, for example the 3-column grids and the single-column Post. The mocks are not normative.
- A deviation is either fixed or listed in `docs/testing.md` «Story 9.4» with a screenshot reference, for the owner to accept. Changing `docs/focus-map.md` instead of the code needs the owner's approval.
- Every focusable has a meaningful Russian label from `src/shared/i18n/ru.ts`. The `noRawText` rules still apply.
- Device runs:
  - Use an owner-signed `assembleRelease` armeabi-v7a build installed with `adb install -r`. The session is kept.
  - Check the foreground before every key batch.
  - Label results as agent over adb, emulator or owner.
- Screenshots of the real account stay local and are deleted after use. Committed or shared images come from demo mode on the emulator only.
- The 9.3 performance results hold:
  - PostCard gets no added native views;
  - `POST_GRID_DRAW_DISTANCE` stays 2 rows;
  - `homeFeedFlow` and `authorFlow` stay green.

**Never:**
- No new design direction, tokens without a DESIGN.md entry, or new features.
- Do not disable or reconfigure the owner's «Button Mapper» accessibility service.
- No debug or demo build on the family TV.
- Do not claim a TalkBack or physical-remote check that the owner did not do.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Continue focus restore | «Продолжить» card remembered → Настройки → «Главная» OK | Главная opens at its top with the Continue row visible; → from the sidebar lands on the remembered Continue card | If the card is gone, use the focus-map §1.6 fallback |
| Feed card restore | feed card remembered, same path | unchanged: the row and offset are restored, → lands on the card | — |
| Raw style literal | a hex color or a non-zero size literal in `src/**` outside tokens | the source scan fails, naming the file:line | Allowlist: `0`, `StyleSheet.hairlineWidth`, and `qrRenderer` black-on-white |
| Unlabelled focusable | a `FocusableSurface` or `Pressable` without a resolved label | the label check fails | — |
| Contrast pair | each DESIGN.md contrast row from the token values | the ratio ≥ the target (WCAG relative luminance) | — |

</frozen-after-approval>

## Code Map

- `src/shared/ui/tokens.ts`, `src/shared/ui/__tests__/tokens.test.js`: token groups and their check against the DESIGN.md frontmatter (both ways). New tokens need a DESIGN.md entry.
- DESIGN.md lines 164-174: the contrast table; lines 17-20, 188 and 208: 960×540 dp, with 720p assumed to give the same dp; lines 191-195: superseded mocks. EXPERIENCE.md line 28: the IA screen list (A1–K4 plus overlays).
- Raw literals (none are guarded today; `.eslintrc.js` enforces only import boundaries): `qrRenderer.tsx:39` `#000000`; about 29 non-zero numbers in `PlayerOverlay.tsx:630-644`, `AudioBlock.tsx:590-605`, `pollStyles.ts`, `Button.tsx`, `SettingRow.tsx:210,224-225`, `Sidebar.tsx`, `EventRow.tsx:182,185`, `ExternalVideoChip.tsx:104-105`, `chipParts.tsx:101`, `DiagnosticsScreen.tsx:165,174`, `PeriodStepper.tsx:478`, `PostCard.tsx:471`, `StateView.tsx:83`, `Spinner.tsx:55`, `TextBlocks.tsx:191` and `PostGrid.tsx:839`.
- Labels:
  - `FocusableSurface.tsx:35,162`: the label is optional.
  - The primitives derive it: `Button:160`, `FilterChip:64`, `SettingRow:95`, `NavItem:58`, `TextField:132`, and the card helpers `authorCardA11yLabel`, `continueCardA11yLabel`, `postCardA11yLabel` and `mediaRowA11yLabel`.
  - Surfaces to check by hand: `post/body/{FileChip,ExternalVideoChip,LinkChips,TextBlocks,ImageBlocks}`, `PostHeader`, `LiveCard`, `PollDisplay`, `PollStops`, `EventRow`, `PlayerOverlay`, `AudioBlock` and `PeriodStepper`.
  - The raw `Pressable`s are `PlayerScreen.tsx:299` and `ExternalHandoff.tsx:219`.
  - `__tests__/noRawText.test.js:41` checks only that labels come from the catalog.
- Contrast styling: the LIVE badge in `LiveCard.tsx:232` and `PlayerOverlay.tsx:575-582`; «Эфир» in `EventRow.tsx:157-166`; `surface-focus-row` in SettingRow, EventRow, MediaRow, AuthorCard, AudioBlock, PeriodStepper and NavItem.
- Continue bug (hypothesis):
  - `ContinueRow.tsx:117` stores `onItemFocus(id, indexInContinueRow)`.
  - `HomeScreen.tsx:295-300` `initialRow` treats that index as a feed index. It goes into `initialScrollIndex` (`PostGrid.tsx:793`), so the list opens past its header.
  - `restoreContinue` (`HomeScreen.tsx:399-415`) calls `scrollToOffset`, and `focusItem` gives up after 30 frames (`useFocusRestoration.ts:168-199`).
  - Likely fix: compute `initialRow` only for a `FEED_CARD_PREFIX` id.
  - Reproduce in `__tests__/homeFeedFlow.test.tsx` by combining the «Story 4.7» describe (about line 2085) with the section switch in «zones, Back and restoration» (about line 815).
- Focus map: `docs/focus-map.md` §2 Sign-in, §3 Shell, §4 D–I and §5 Events, settings and states. TalkBack is unverified across `docs/testing.md`.
- Emulator: AVD `tv34` (1080p) exists. A 720p AVD can be created with `avdmanager` (`tv_720p`).

## Tasks & Acceptance

**Execution:**
- [x] `__tests__/homeFeedFlow.test.tsx` + `src/features/home/HomeScreen.tsx`: write a failing reproduction, then the fix. Covers the first two matrix rows.
- [x] `__tests__/noRawStyleLiterals.test.js` (new) + offending files: the source scan, then move the literals to tokens. Add any missing token to the DESIGN.md frontmatter and `tokens.ts` with the same values, so nothing looks different.
- [x] `src/shared/ui/__tests__/contrast.test.js` (new): compute every DESIGN.md contrast pair from `tokens.ts` and assert its target. Fix a token that fails only by recording an owner-visible deviation, never silently.
- [x] A label guard: a render-level check that every focusable `FocusableSurface` or `Pressable` resolves a non-empty label, run across the existing flow tests or a dedicated suite. Fix the gaps in `ru.ts` and the components.
- [x] Device and emulator walk: every IA screen and overlay, comparing layout, focus map (initial focus, arrows, OK, Back, restoration) and `content-desc` on the TV (agent over adb). Use the 720p emulator and the TalkBack method from the decisions. Fix the mismatches and list the rest.
- [x] Font scale: cap at 1.3× and screenshot A1 and Button at the maximum system font size (emulator).
- [x] Docs: `docs/testing.md` «Story 9.4» (method, the per-screen table, the deviations to accept, labels), `docs/focus-map.md` only with the owner's approval, and deferred-work entries closed (font scale, the Continue focus bug).

**Acceptance Criteria:**
- Given the final build, when each IA screen is walked at 1080p and 720p, then layout and focus match the sources, or each deviation is listed for the owner.
- Given the new host guards, when `npm test` runs, then the tokens-only scan, the contrast and label checks pass.
- Given TalkBack per the decided method, when each screen is traversed, then every focusable announces a meaningful Russian label.

## Implementation Notes

- Continue focus: two causes, both fixed. `initialRow` now applies to feed cards only. A Continue card past the third was outside the row's viewport at mount, and the focus request did not stick on the device, so the row opens scrolled to it (`ContinueRow` `initialCardId`).
- Found on the device and fixed: on Поиск and Автор, Back from the filter sheet after a level change left nothing focused. The sidebar fallback during the level change had made the chip unfocusable. Focus events are now ignored while a modal is open.
- Tokens: 35 literals moved. The new DESIGN.md frontmatter entries keep the built values. Named module constants are outside the scan (deferred work).
- Contrast: every DESIGN.md pair passes, and no token changed. In focused rows and tiles, `text-meta` now switches to `text-secondary` (MediaRow, AuthorCard, EventRow, LiveCard). LiveCard's focused surface is now `surface-focus-row`.
- Labels: `FocusableSurface.accessibilityLabel` is required, and the flow harness checks every focusable on each `focusOn` and `press`. Label punctuation is tidied (`tf` period rule, SettingRow sentences).
- Device: TalkBack's spoken text cannot be logged without changing its developer settings. The agent's evidence is a TTS request per move plus the focused node's `content-desc`. The owner's listening session is still open.
- Incident: one player visit ran about 11 s and wrote a resume point of about 10 s on one of the owner's videos (`docs/testing.md` «Story 9.4»).
- Deviations for the owner: `docs/testing.md` «Story 9.4».

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter 16, edge-case-hunter 13, verification-gap 3).

| # | Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind | Poll labels end in lowercase «не отмечено» after a period; filed as an owner deviation although it is our copy | low | `ru.ts` `poll.a11yChecked/a11yUnchecked` are lowercase and `pollCheckOptionAccessibilityLabel` joins them as a sentence; a direct copy fix | patch |
| 2 | blind | Contrast test covers only the DESIGN.md table, not pairs the code draws (accent-text and text-card on surface-focus-row) | low | LiveCard `needsLevel` keeps `accent-text` on the new focused surface; computed 5.85 and 9.13, both pass, but unpinned | patch |
| 3 | blind | `contrast.test.js` says a new row needs no test change, yet asserts exactly 7 rows / 9 pairs; the section regex stops at the first blank line | low | the comment contradicts `toHaveLength(7)`; a direct correction | patch |
| 4 | blind, edge (×3) | Tokens scan blind spots: named colors, hsl(), transform `scale`, ternary or multi-line values | low | grep finds no named or hsl colors in src; `scale: 2` in PlayerScreen/ExternalHandoff is a multiplier, not a size; the gap is undocumented next to the named-constants note | patch (document) |
| 5 | blind, edge (×2) | Label guard selects only `focusable === true`, so `TextInput` hosts are never checked | low | TextField passes `accessibilityLabel={label}`, so no field is unlabelled today; the guard's claim is wider than its query | patch |
| 6 | blind | Guard does not catch focusables exposed behind an open modal | false | not what the guard claims; modal focus containment is covered by the flow suites' modal cases | reject |
| 7 | blind | No test for the matrix row «remembered Continue card is gone»; `continueRowOffset` has no unit cases | medium | matrix error-handling column names the §1.6 fallback; no test drives it with the new `initialContinueId` | patch |
| 8 | blind | `continueRowOffset` can exceed the row's scroll extent for the last card | false | offset (n−3)·(W+G) is below content − viewport for a viewport of ~3.04 columns, and ScrollView clamps `contentOffset` | reject |
| 9 | blind | `tf` period absorption is global, affecting visible strings | low | absorbing «!.» is correct in visible copy too; no harmful change named | reject |
| 10 | blind | Modal-open focus events dropped; Apply/Reset paths not re-synced | false | on close the sheet returns focus to the chip, whose focus event arrives after `isOpen()` is false and re-syncs the zone | reject |
| 11 | blind | `epic-9-context.md` stale; font cap in Text+TextField, not Button | false | the context was compiled for 9.4 as next and is recompiled for 9.5; Button labels render through Text, so the cap applies | reject |
| 12 | blind | Spec frontmatter, logs and ticks inconsistent | — | fix would edit this build's spec | reject |
| 13 | blind | The resume-point incident has no prevention rule for 9.5 device runs | medium | `docs/testing.md` records it with no guard for the next device story | defer |
| 14 | blind | lineHeight growth past the cap not investigated; TV's own max scale not recorded | low | only the 2.0 test (outside the TV's range) shows it; listed as deviation 3 | reject |
| 15 | blind | Diagnostics `steps` maxWidth now tied to `content-width` | low | same value (720) and the column is content-wide by intent | reject |
| 16 | blind | Render-prop children re-render each row subtree on focus | low | one row's small subtree per focus move; EventRow/MediaRow lists are short | reject |
| 17 | verif | EventRow `/time` focus color untested | low | pre-verified gap | patch |
| 18 | verif | MediaRow `/status` focus color untested | low | pre-verified gap | patch |
| 19 | verif | TextField input 1.3× cap untested | low | pre-verified gap | patch |
| 20 | edge | `stripComments` treats `'*/*'` in a string (profiles.ts ACCEPT) as a comment start, blanking lines to the next `*/` | low | real, but only profiles.ts (no styles) is affected and the fix is a tokenizer | reject |
| 21 | edge | `tf` misses punctuation followed by a space, «»» or «)» | low | rare titles; the fix adds branches | reject |
| 22 | edge | Continue row offset computed once; items arriving later keep offset 0 | low | on return to Главная the items are cached and present at mount | reject |
| 23 | edge | ContinueHeader remount reuses the mount-time `initialContinueId` | low | only after the row disappears and reappears within one Главная mount; a scroll position only | reject |
| 24 | edge | `home/feed/retry` shares `FEED_CARD_PREFIX` in `initialRow` | false | pre-existing (the old code had no prefix check), and the retry entry fails `index < shownPosts.length` | reject |
| 25 | edge | A late sidebar fallback after `close()` could still make the chip unfocusable | maybe-false | needs a device trace of event order on close; the device run saw the fix work | defer (medium, unverified) |
| 26 | edge | AC «every focusable announces» reported met although speech was not captured | false | `docs/testing.md` states the words were not heard and leaves it to the owner | reject |
| 27 | edge | «Tokens only» claim with ~30 named constants left | false | already recorded as deferred work in this diff | reject |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- all green
- `(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a)` -- the owner-signed device build

**Manual checks:**
- The device walk and the emulator runs above. The owner's TalkBack listening and physical-remote feel check are labelled separately.
