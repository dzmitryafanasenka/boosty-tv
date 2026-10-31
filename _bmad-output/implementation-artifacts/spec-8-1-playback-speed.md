---
title: 'Story 8.1: Playback speed'
type: 'feature'
created: '2026-10-31'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '990c62aeb67e1eab3ef05b062185bd3e57fcbed7'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-player-live-vod-split.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The player has no playback speed. BoostBuddy offers presets 0.5–3× with a global preference and forces 1× on live (PLAY-07, SET-04, FR47).

**Approach:** A «Скорость» row in the player settings sheet for recordings, with a radio submenu of the presets 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2 and 3×. The current speed is checked. A pick applies at once from the same position, closes the sheet with focus on «Настройки», and is stored device-scoped as the global preference for the next videos. Live has no row and stays at 1×. The work goes through `PlaybackMode` and `usePlayerSettings`, not through new branches in `PlayerScreen`.

## Boundaries & Constraints

**Always:**
- Store the speed device-scoped (one KeyValueStore key, like `qualityPreference.ts`). It survives sign-out and is not in the AccountScope wipe. An unreadable or unknown stored value means 1×. Nothing logs the value as personal data; plain logging of the speed number is fine.
- The live mode forces rate 1 and hides the row (a mode flag). The engine gets `rate` through the `PlayerEngine` port / `PlayerEngineView`.
- Progress rules stay in media time: `WRITE_MOVEMENT_SEC`, resume, `'end'` and E9 are unchanged at any speed. Seek ±10 s stays in media seconds. Elapsed and remaining time are shown in media time.
- A quality change, a recovery or a source refresh keeps the current speed.
- The row sits under «Качество»: «Скорость · 1×». The submenu follows the quality submenu pattern: initial focus on the checked row, Back → the sheet with focus on «Скорость». Copy goes through `t()`, with `ru.ts` keys.
- Phase gate: a `speed` flag in `app/phaseFlags.ts` (AD-20), on.
- Owner decisions (2026-10-31):
  - Q1 a: while the speed is not 1×, the overlay shows a small «1.5×» label next to the elapsed time (none at 1×, none on live). Our improvement; BoostBuddy shows no badge.
  - Q2 a: 1× is labelled «1×», like every other preset (no «Обычная»).

**Never:**
- No speed for inline post audio (`AudioBlock`) or for live.
- No per-video or per-account speed. No pitch controls, no custom value.
- `PlayerScreen.tsx` grows by only a few lines of wiring at most.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First run | no stored value | the video plays at 1×; the row shows «1×» | N/A |
| Pick | 1.5× in the submenu at 2:00 | rate 1.5 from 2:00, no seek, no new E8; the sheet closes, focus on «Настройки»; stored | a failed write is only logged; memory keeps 1.5 |
| Next video | stored 2 | the new video starts at 2×; the row shows «2×» | N/A |
| Live | stored 2 | the live stream plays at 1×; no «Скорость» row | N/A |
| Bad store | stored `"fast"` or `"9"` | 1× | treated as no preference |
| Quality change / recovery | at 1.25× | the new source plays at 1.25× | N/A |

</frozen-after-approval>

## Code Map

- `src/features/player/qualityPreference.ts` -- the pattern for `speedPreference.ts`: parse, serialize, a store with `peek`/`read`/`remember`/`write`/`forget`, device-scoped `asyncKeyValueStore`.
- `src/features/player/playbackMode.ts` -- add the mode flag, e.g. `speedShown` (vod true, live false), and `rate(pref)` (live → 1). `settingsShown` is already `() => true` for vod.
- `src/features/player/usePlayerSettings.tsx` + `PlayerSettingsSheet.tsx` -- the sheet model gains the speed and a `level: 'speed'` submenu. The sheet header comment says «No speed row (Epic 8)»; update it. `onPick` today takes a `QualityKey` only.
- `src/features/player/usePlaybackSession.ts` -- `engineProps` gains `rate`. Keep the engine key unchanged (a rate change must not remount the engine).
- `src/shared/platform/playerEngine.ts`, `PlayerEngineView.tsx` -- pass `rate` to react-native-video 6.19.3 (`rate?: number` exists in `lib/types/video.d.ts`).
- `src/test/playerEngineMock` -- record `rate` for assertions.
- `src/app/phaseFlags.ts`, `src/shared/i18n/ru.ts` -- the flag and the copy.
- `__tests__/playerFlow.test.tsx` «quality (Story 4.3)» -- the sheet/submenu/Back tests to mirror; «Story 7.2» for live.
- `docs/feature-parity.md` PLAY-07/PLAY-08/SET-04, `docs/focus-map.md` §4 G, `docs/testing.md` -- update.

## Tasks & Acceptance

**Execution:**
- [x] `src/features/player/speedPreference.ts` (+ unit test) -- the presets, parse/serialize, the device-scoped store.
- [x] `src/features/player/playbackMode.ts` (+ test) -- the speed flag and live forcing 1.
- [x] `src/shared/platform/playerEngine.ts`, `PlayerEngineView.tsx`, `src/test/playerEngineMock` -- the `rate` prop end to end.
- [x] `src/features/player/PlayerSettingsSheet.tsx`, `usePlayerSettings.tsx`, `usePlaybackSession.ts` -- the row, the submenu, the pick, the rate, the preference write.
- [x] `src/features/player/PlayerOverlay.tsx` (+ test) -- the «N×» label next to the elapsed time while the rate is not 1 (Q1 a).
- [x] `src/app/phaseFlags.ts`, `src/shared/i18n/ru.ts` -- the `speed` flag and the copy.
- [x] `__tests__/playerFlow.test.tsx` -- a «Story 8.1» describe covering the matrix and the Back order.
- [x] `docs/feature-parity.md`, `docs/focus-map.md`, `docs/testing.md` -- record.

**Acceptance Criteria:**
- Given a recording, when I open «Настройки», then «Скорость» shows the current speed, and its submenu lists the 8 presets with the current one checked (FR47).
- Given the submenu, when I press Back, then focus returns to «Скорость»; another Back closes the sheet with focus on «Настройки».
- Given a speed change, when the next video opens after an app restart, then it plays at the stored speed.

## Implementation Notes

**What changed (2026-10-31):**
- `speedPreference.ts` (new): `PLAYBACK_SPEEDS`, `parseSpeed` (only the exact preset strings; anything else → null → 1×), `serializeSpeed`, `speedLabel` («N×» via `t()`), a store with `peek` / `read` / `write` / `forget` (no `remember`: a speed pick is stored at once, unlike a quality pick that waits for `onLoad`), the device-scoped `asyncKeyValueStore('device')` key `player.speed.v1`, and `setSpeedPreferenceKeyValueStore` for the demo (wired in `src/app/session.ts`, like quality).
- `playbackMode.ts`: `speedShown` and `rate(stored)`. `createVodMode(progress, { speed })` takes the phase flag; live: `speedShown: false`, `rate: () => 1`. The flag reaches the mode through a new required `PlayerScreen` prop `speedEnabled` (review: no silent default), set from `phaseFlags.speed` by both `PlayerRoute` branches (live ignores it) (features cannot import `app`).
- `usePlayerSource.ts`: reads the stored speed beside the quality preference; `preferenceReady` waits for it only when `mode.speedShown` (review: live and the flag off neither read nor wait), so the first recording engine already has the stored rate.
- `usePlaybackSession.ts`: `rate = mode.rate(source.speed)` in `view` and `engineProps`; `commands.pickSpeed` (ignored without `speedShown`; logs `playback speed changed {speed}`; sets the state; writes the store). The engine `key` is unchanged, so a rate change never remounts; a quality switch or a recovery remounts with the same `rate` prop.
- `PlayerSettingsSheet.tsx` / `usePlayerSettings.tsx`: `SettingsSheetData.speed` (null: no row), the `speed` level submenu, `onPickSpeed`; the sheet level remembers which submenu Back came from (`sheetRow`) and focuses that row. The pick closes the sheet with focus on «Настройки» and shows the overlay, like quality.
- `PlayerOverlay.tsx`: optional `rate`; `player/speed` «N×» right of the elapsed time when not 1 (not on live, which has no times row).
- `playerEngine.ts` / `PlayerEngineView.tsx`: `rate?: number` on the port, passed to react-native-video 6.19.3 `rate` (default 1). The mock already records every prop, so `engine.props.rate` needed only a doc line.
- `PlayerScreen.tsx` 389 → 395 lines (the prop, the mode option, two settings arguments, the overlay `rate`).
- `focus-map.md` §4 G now says a speed pick closes the sheet (the old row said «close the submenu»; the spec's intent wins).

**Deviation:** `playerFlow` «quality (Story 4.3) › Open sheet» asserted the sheet's only focusable was «Качество»; it now expects «Качество», «Скорость» (the feature adds the row; nothing else in that test changed).

## Spec Change Log

## Review Triage Log

Coordinator review, 2026-10-31 (Blind Hunter, Edge Case Hunter, Verification Gap). Patches are in the commit `fix: review patches for Story 8.1 playback speed`.

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | The adapter's `rate` forwarding was untested (medium, VG) | patched | `src/shared/platform/__tests__/PlayerEngineView.test.tsx`: omitted → `rate` 1; 1.5 → 1.5; re-render with 2 → 2; the mocked Video mounted once. | test |
| 2 | The speed row turning null with its submenu open fell through to the quality submenu (low, ECH+BH) | patched | `PlayerSettingsSheet` derives the shown level (the sheet when the speed row is gone), resets the level and the return row in an effect, and focuses «Качество». New `src/features/player/__tests__/PlayerSettingsSheet.test.tsx`; red against the unpatched sheet. | code + test |
| 3 | Picking the current speed logged and wrote (low, ECH+BH) | patched | `pickSpeed` returns early for the current speed (no log, no write, no state change); the sheet still closes with focus on «Настройки». `playerFlow` «Story 8.1 › picking the current speed». | code + test |
| 4 | `preferenceReady` waited for an unused speed read (low, ECH+BH) | patched | `usePlayerSource` reads and waits only when `mode.speedShown`. `playerFlow` «Story 8.1 › live»: a `read` that never resolves is not called and the live engine mounts; the flag-off test also asserts no read. | code + test |
| 5 | A synchronous throw from `kv()` escaped `read()` / `write()` (low, ECH) | patched | `speedPreference` and, per the patch-every-copy rule, `qualityPreference`: the `get` throw becomes a rejection (→ 1× / null, logged), the `set` throw is logged; memory kept. One new unit test in each store's suite. | code + test |
| 6 | The overlay built its own label from `rate?: number` (low, BH) | patched | `PlayerOverlay` takes `rate?: PlaybackSpeed` and renders `speedLabel(rate)`, the sheet's label function. | code |
| 7 | The «Quality change / recovery» test proved nothing about writes (low, BH) | patched | The test spies on `speedPreference.write` (not called) and checks that no «playback speed changed» entry was logged. | test |
| 8 | No test for a pick while paused (low, BH) | patched | `playerFlow` «Story 8.1 › a pick while paused»: rate 2, `paused` stays true, «2×» shown. | test |
| 9 | No flag-off test; `speedEnabled` defaulted to false silently (low, BH) | patched | `speedEnabled` is required; both route branches pass `phaseFlags.speed`. `playerFlow` «Story 8.1 › the `speed` phase flag off» (`jest.replaceProperty`): stored `2` → rate 1, no row, no label, no read. | code + test |
| 10 | «The first engine starts at the stored rate» was not pinned (low, VG) | patched | `playerFlow` «Story 8.1 › the first engine starts at the stored rate»: the speed read is held with a deferred; no engine before it resolves, then one mount at rate 2. | test |
| 11 | No demo check for the preference stores (low, VG) | patched | `demoFlow` «Story 8.1 review»: a speed and a quality write in demo mode read back from the demo's memory stores; the seeded `boostytv-device` values stay. Demo videos have no `playerUrls`, so the player's sheet is unreachable in the demo: the test writes through the same stores the sheet's picks use, not through the UI. | test |
| 12 | Docs did not say which rules are media time; Menu/Info in the speed submenu undocumented (low, BH) | patched | PLAY-07, `docs/testing.md` «Story 8.1» and these notes list the E9 cadence, the short visit, the resume point / `'end'`, the recovery budget, «Осталось N мин» and the overlay times as media time. `docs/focus-map.md` §4 G: while the speed submenu is open the player ignores every remote key (Menu/Info included; `usePlayerKeys` returns early on `sheetOpenRef`, and `openSettings` is a no-op while open), as for quality. | docs |
| 13 | «1.5×» uses a dot, not the Russian «1,5×» | accepted | The owner approved the label written «1.5×» (Q1 a). | — |
| 14 | No runtime check that the engine supports rate changes | accepted | ExoPlayer / Media3 supports playback speed; the owner's device run is the check (recorded as its purpose in PLAY-07 and `docs/testing.md`). | — |
| 15 | At 2–3× E9 ticks fire every ~3–5 s of wall time | deferred | Bounded (one E9 in flight); a wall-clock floor in ProgressRepository would change progress rules the frozen block keeps unchanged. Entry in `deferred-work.md`. | deferred-work |

## Verification

**Run (2026-10-31):** lint `--max-warnings 0`, typecheck, `check:fixtures` (30) clean; `npm test` ×3: 128 suites, 2851 passed each; touched files ×30: 0 failed runs, 729 tests passed in each. Device: not run (owner).

**Review-patch verification (2026-10-31):** lint `--max-warnings 0`, typecheck, `check:fixtures` (30) clean; `npm test` ×3: 129 suites, 2860 passed each (2851 + 9 new); `playerFlow`, `authorFlow`, `postFlow`, `demoFlow`, `src/features/player` (incl. `qualityPreference` / `speedPreference` / `PlayerSettingsSheet`), `PlayerEngineView.test.tsx`, `phaseFlags.test.ts` ×30: 0 failed runs, 749 passed each. Device: not run (owner).

**Commands:**
- `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` -- clean.
- `npm test` ×3 -- all green.
- touched and new test files ×30 -- 0 failed runs.

**Manual checks (if no CLI):**
- Release-like build on the Chromecast (adb, under 10 s of the owner's content, no pause): open a video, Menu → «Скорость» → 1.5× → the time runs faster; Back out. Then reset the speed to 1× so the family is not surprised.
