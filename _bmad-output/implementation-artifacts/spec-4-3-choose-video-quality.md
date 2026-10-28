---
title: 'Story 4.3: Choose video quality'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '1db0dcadcf0647a40227ad6151ea85360b3a6eef'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The player always plays the auto-picked source; a blurry or stuttering picture cannot be fixed (FR46, PLAY-02, PLAY-08, UX-DR15; epics.md Story 4.3).

**Approach:** Add «Настройки» to the player controls. It (and the Menu / Info keys) opens a 340 dp right side sheet through the one modal host (AD-13) with one row «Качество · <current>»; OK opens the quality submenu (radio rows). A pick reloads the same video at the same second, stores the choice device-scoped and closes the sheet with focus on «Настройки». The stored preference feeds `pickSource(preferredType)` on every later open.

**Decisions:**
- Quality list: «Авто» when the video has HLS or DASH (one row; plays HLS, else DASH), then each progressive height that exists, highest first, one row per height («1080p», …). «Авто» shows « · 1080p» only when the engine reports the current height (react-native-video `onBandwidthUpdate` with `reportBandwidth`, behind the PlayerEngine port as `onResolution(height)`); never guessed. The selected row is the playing source.
- Preference: device-scoped KeyValueStore key `player.quality.v1`: `auto` or a progressive height (never a URL). On open: the stored height's source if this video has it, else the default order (no error, preference kept). «Авто» clears the height.
- Reload: the same E8 sources (no new request); the engine remounts with the new source and seeks to the current position (a pending seek target if one is pending); the start gate blocks progress until that seek is done (no t=0). The progress session continues (no `begin`, the short-visit rule is not restarted).
- While the sheet is open: the overlay never auto-hides; the player ignores remote keys (the sheet owns them); playback continues. Back: submenu → sheet → closes (focus «Настройки») → overlay → exit; a pending held seek is still the first layer when the sheet is closed.
- «Настройки»: a secondary control right of play/pause in the controls row (play/pause stays centered); id `player/settings`; ← → between them. Rows `player/sheet/quality` (sheet), `player/sheet/quality/<auto|height>` (submenu); initial focus in the submenu on the selected row.
- Menu / Info keys (react-native-tvos maps only these two; there is no Settings key): open the sheet when the overlay or the surface has focus, showing the overlay. Unverified on the device (the pinned remote has no such keys).
- Owner decisions 2026-10-28: **qualities above 1080p are listed** (every existing height); auto-selection keeps its 1080p cap; a pick the decoder cannot play shows the existing start-failure error («Не удалось воспроизвести видео», «Повторить»/«Назад»; recovery is Story 4.4). **No quality list before playback**: with our mapping every usable source is auto-pickable, so the case is unreachable; recorded in feature-parity PLAY-02. The spec is kept whole (≈ 2050 tokens).
- Owner decision 2026-10-28 (device check of the first build; supersedes the «Настройки» placement above): **«Настройки» becomes a gear icon control at the bottom right** of the overlay (same id `player/settings`, a11y label «Настройки»); **the controls row is «−10 с» · play/pause · «+10 с», centered** (our improvement, not reference parity): ids `player/back10`, `player/forward10`, a11y «Назад на 10 секунд» / «Вперёд на 10 секунд»; OK moves the seek target by exactly 10 s (quick OKs accumulate, one commit 600 ms after the last OK, the bubble shows the target, clamped to 0…duration); ← → move focus natively across −10 · play/pause · +10 · gear; ↑ → the timeline; ↓ from the timeline → play/pause. Icons are drawn without a new dependency (Unicode glyphs or Views); if they look wrong on the device, an SVG library is a separate owner decision.
- Owner decision 2026-10-28 (device check of the glyphs: «↺10»/«↻10» unreadable): **icons are SVG via `react-native-svg`**, pinned exactly (15.15.5, the newest release older than two weeks, claims RN ≥ 0.78; if the native release build fails on react-native-tvos 0.87.1-1, use 15.16.0 (RN ≥ 0.80) and record why); a circular arrow with «10» inside for ±10 and a gear for settings, in `src/shared/ui/icons/`; a short ADR (0013) records the dependency and the compatibility check; release build and device check required.

## Boundaries & Constraints

**Always:** Features import no native module (engine via the port, KV via the port). Copy and a11y labels from `ru` («Настройки», «Качество», «Авто», «Авто · 1080p», «1080p»). Tokens `side-sheet.widthPlayer`, `bg-sidebar`, SettingRow (add a `radio` kind with a selected state). URLs never in the preference, logs or keys.

**Never:** No speed row (Epic 8), no subtitles/audio tracks, no download, no live, no quality list before playback (owner decision), no recovery flow (4.4), no new E8 for a switch.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open sheet | OK on «Настройки» / Menu | sheet, focus «Качество · Авто»; overlay stays | — |
| List | hls + dash + 360/720/1080 progressive | «Авто», «1080p», «720p», «360p» | — |
| Progressive only | 480 + 720 (two types at 480) | «720p», «480p» (no «Авто») | — |
| Auto suffix | engine reports 1080 | «Авто · 1080p»; none before a report | — |
| Pick | «720p» at 5:12 | engine reloads 720p, seeks 312; preference `720`; sheet closed, focus «Настройки» | — |
| Stored pref | `720`, video has no 720 | default order (HLS…), preference kept | — |
| Back order | submenu open | submenu → sheet → close (focus «Настройки») → overlay → exit | — |
| Keys behind | sheet open, ← → / OK | sheet navigation only; no seek, no pause | — |
| Progress | switch at 5:12 | no E9 of 0; the session continues | — |

</frozen-after-approval>

## Code Map

- `src/features/player/PlayerScreen.tsx` -- sheet open state (from «Настройки» and `menu`/`info` keys), ignore remote keys and block auto-hide while open; quality switch: hold the chosen source in state, remount the engine (`key` includes the source type/height), seek to the current/pending position through the existing start gate with an explicit target (not `resumePoint`), no `progress.begin`. Keep seek controller, arbiter, focus and Back logic.
- `src/features/player/PlayerOverlay.tsx` -- «Настройки» control right of play/pause (`player/settings`), ← → between them.
- `src/features/player/mediaResolver.ts` -- `pickSource(sources, {preferredType})` exists: adapt to a preference of `auto | height`; expose the source list (for the sheet) with the ready state; a pure `qualityOptions(sources)` (dedupe heights, all heights listed).
- `src/features/player/` (new) `PlayerSettingsSheet.tsx` (sheet + submenu, own Back listener for the submenu level), `qualityPreference.ts` (device KV read/write, tolerant parse).
- `src/shared/platform/playerEngine.ts`, `PlayerEngineView.tsx` -- `onResolution?(heightPx)` from `onBandwidthUpdate` (`reportBandwidth`).
- `src/shared/ui/SettingRow.tsx` -- `radio` kind (selected mark, `accessibilityState.selected`); a `SideSheet` primitive in `src/shared/ui` (right, `side-sheet` tokens) rendered via `useModal().open(content, settingsRef)` (`src/shared/focus/ModalHost.tsx`).
- `src/shared/platform/asyncKeyValueStore.ts` -- the `device` scope already exists (Story 4.2); demo mode: in-memory as for progress.
- `src/shared/i18n/ru.ts` -- `player.settings`, `player.quality.*`.
- Tests: `playerFlow` (every matrix row, engine mocked), unit tests for `qualityOptions`, the preference parse and `pickSource` with a height preference, SettingRow radio, adapter `onResolution`.
- Docs: `docs/focus-map.md` G sheet rows/ids, `docs/feature-parity.md` PLAY-02/PLAY-08 Android status, `docs/testing.md` Story 4.3, `deferred-work.md` for gaps.

## Tasks & Acceptance

**Execution:**
- [x] Engine port `onResolution`; SettingRow radio; SideSheet primitive.
- [x] Quality options, preference store, `pickSource` with the preference (+ unit tests).
- [x] Player: «Настройки», sheet/submenu, keys, Back order, auto-hide, switch at the same second, no t=0.
- [x] Demo/in-memory device KV; docs.
- [x] Device (release-like, owner's session): open the sheet, switch Авто ↔ a progressive height at the same second, «Авто · 1080p» suffix appears, preference survives a cold start, Back order; screenshot of the overlay with «Настройки» and of the sheet to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new/changed flow suites 30/30; lint `--max-warnings 0`, typecheck, `check:fixtures` clean; release bundle without debug-only code.

## Implementation Notes

- Final verification (2026-10-28, after the review patches): lint `--max-warnings 0`, typecheck, check:fixtures clean; `npm test` ×3: 1566 passed each; playerFlow + player/platform/ui suites 30×: 0 failed runs (328 tests each). Device (adb, release-like): overlay focus order, no seek on the controls, preference stored after `onLoad` and kept across a cold start, progressive 1440p plays; the owner's TV left on «Авто».

- Modal host: `open(content, initiator, {placement: 'end'})` renders a full-height right panel above the scrim (dialogs keep `center`). The sheet element is rendered once by the host; its data (options, selected, auto height) comes from a small observable model the player updates (`createSettingsSheetModel`).
- The preference is the single source of the playing quality: `useMediaSource(…, preference)` → `pickSource(sources, {preference})`; the engine waits for the first read. The engine `key` is `<resolution>:<source.type>`, so a pick that changes the source remounts it; the start gate carries the explicit target (`{kind: 'load', target}`), `startMode` and `begin` are untouched.
- `pickSource`'s `preferredType` option became `preference: 'auto' | height` (no caller used it before).
- The demo keeps the preference in memory (`setQualityPreferenceKeyValueStore` from `src/app/session.ts`).
- Device step: run by the coordinator over adb on 2026-10-28 (docs/testing.md «Story 4.3»).
- Owner change after the first build's device check: «Настройки» became a ⚙ PlayerControl at the right end of the controls row (absolutely placed in the same row, so native ← → reaches it from +10); the row is «−10 с» · play/pause · «+10 с» (`IconControl`). After the glyph device check the icons are SVG: `react-native-svg` 15.15.5 (exact), `src/shared/ui/icons` (`SkipIcon`, `GearIcon`), ADR 0013; release build on react-native-tvos 0.87.1-1 succeeded (15.16.0 not needed); Jest uses `__mocks__/react-native-svg.js`. ±10 uses `seekController.press(dir, pos, dur, stepSec = 10)` (fixed step, same 600 ms commit and clamp). Raw ← → are ignored on every id in `PLAYER_CONTROL_IDS`.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | A pick before the first `onLoad` (gate `load` without a target) or during the initial seek replaces the resume point with the current position 0 → the video restarts at 0 (edge 1, 2, 11, 12) | medium | patch: keep the pending start (the initial `load` stays without a target; a `seek` gate keeps its target) |
| 2 | A pick during a held scrub: `seek.reset()` skips `onHeldEnd`, playback stays paused (edge 3, blind) | low | patch: resume when the scrub had paused a playing video |
| 3 | A height the decoder cannot play is stored at once: every later open of a video with that height fails until Story 4.4 (edge 6, blind) | high | patch: write the preference to disk only after the switched source's `onLoad`; the in-memory choice stays for this run |
| 4 | Native `seekKey` on −10 / +10 / gear not tested (verification-gap) | medium | patch: test |
| 5 | Re-picking the selected row not tested (a dropped guard would leave the gate in `load`) (verification-gap) | medium | patch: test |
| 6 | «Авто» suffix reset across a switch not tested (verification-gap) | medium | patch: test |
| 7 | Docs inconsistent: testing.md «Device rows to run» header and stale host counts, focus-map media keys / G Overlay row / 4.1 centered note, epic-4-context (pre-playback list, Settings key, ±10, >1080p), feature-parity PLAY-05/06 and tests columns, ADR 0013 ABI scope and licence (blind) | low | patch: docs only |
| 8 | `package-lock.json` missing from the reviewed diff; transitive pins unverifiable (blind) | false | the coordinator excluded it from the diff; `git diff --numstat`: 147 added, 0 removed (react-native-svg + css-select/css-tree/… only) |
| 9 | A pick after the end seeks the new engine to the end (edge 4) | low | rejected: rare; the end fires again and Play restarts from 0 |
| 10 | Explicit target beyond a slightly shorter new source (edge 5) | low | rejected: the same video's variants share the duration |
| 11 | KV read that never settles keeps the engine unmounted (edge 7, blind) | low | rejected: async-storage reads settle or reject |
| 12 | Synchronous throw in `qualityPreference.write` (edge 8) | low | rejected: the adapter factory does not throw |
| 13 | ±10 during the initial seek gate (edge 9) | low | rejected: the initial seek lands in milliseconds |
| 14 | Clamp is duration − 1, not duration (edge 10) | false | intended: the seek controller never targets the last second (Story 4.1) |
| 15 | No forced progress report before a switch (blind) | low | rejected: the window is the reload (≈ 1–2 s); the last write is ≤ 10 s old |
| 16 | ±10 shares the press streak with raw ← → (blind) | low | rejected: only a mixed sequence within 600 ms; one larger step |
| 17 | I/O matrix lacks ±10 rows (blind) | low | rejected: spec edit; behaviour tested in playerFlow |
| 18 | No own tests for ModalHost `placement: 'end'` / SideSheet / sheet model (blind) | low | rejected: centered dialogs keep their tests; the sheet is covered in playerFlow |
| 19 | Radio mark has no focus variant (blind) | false | the row carries the focus state (ring, `surface-focus-row`); the mark shows selection |
| 20 | Device rows missing: ↓ timeline → play/pause, ↑ gear → timeline, ← gear → +10, «10» legibility from the couch (blind) | low | coordinator: adb check after the patches; legibility seen by the owner |
| 21 | Spec Implementation Notes say the device step was not run (verification-gap, blind) | low | rejected as a finding (spec edit); the coordinator corrects the note |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `playerFlow` and the new suites 30×.
