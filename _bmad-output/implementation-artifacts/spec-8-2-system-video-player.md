---
title: 'Story 8.2: System video player option'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: 'ddaa4b9dfa8272eaae28fc7c9b8713f1792c6069'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The owner cannot hand a recording to an installed Android player (PLAY-13, FR53/FR50); Настройки has no «Системный видеоплеер» toggle.

**Approach:** A device-scoped toggle in Настройки. When it is on, opening a recording shows a quality list, then an `ExternalPlayer` port launches the Android chooser with the chosen URL and the title. No progress is written. If no real player resolves, the built-in player plays the chosen quality with the hint «Внешний плеер не найден».

## Boundaries & Constraints

**Always:**
- The preference is device-scoped (owner decision 2026-10-31), default off, key `player.external.v1` in `boostytv-device`. It is not registered with AccountScope, so it survives sign-out.
- Gated by a new `phaseFlags.externalPlayer` flag. The row and the hand-off exist only when it is on.
- Recordings only. Live (`LiveRef`) always uses the built-in player.
- The signed URL never goes into logs, storage, route params or Boosty headers, on the JS or the Kotlin side. Logs record only outcomes (`opened` / `none`).
- The hand-off path never calls `progress.begin` / `report`, so there is no E9 write and no Continue entry. The fallback is the normal built-in session with progress.
- The native code lives behind `src/shared/platform/externalPlayer.ts`. No feature touches `NativeModules` or intents.
- Russian copy goes in `ru.ts`.

**Never:**
- No change to PlayerScreen's playback logic beyond an optional notice prop.
- No automatic retry once the URL has left the app.
- The external quality pick does not overwrite the stored quality preference; it uses memory-only `remember`.
- No player-specific UI and no "default app" setting.
- Launch (owner decision 2026-10-31, after the device run): one real player → open it directly with an explicit intent; two or more → the system chooser listing those players as explicit intents. On the pinned Google TV the plain chooser (and `MATCH_DEFAULT_ONLY`) sees only the framework stub.
- No start position is passed: the external player always starts from 0:00, even with a resume point or a post timestamp (owner decision 2026-10-31).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Toggle | OK on «Системный видеоплеер» | Flips «Выкл» ↔ «Вкл» right away and persists. The description says progress is not tracked. | A write failure only logs a warning; the UI still flips |
| Hand-off | Toggle on, OK on a recording or a Continue card | Loading, then the «Качество» sheet with focus on the preferred quality. OK opens the chooser and the route exits to the origin with restored focus. | — |
| Back in list | Sheet open, Back | Exits the route to the origin. Nothing is launched or written. | — |
| No player | Only our app or the TV stub resolves | Built-in player at the picked quality, with «Внешний плеер не найден» in the overlay | Launch exception → same fallback |
| Not ready | E8 error, no access or no source | Renders PlayerScreen, which owns those states | — |
| Live / flag off / toggle off | — | Built-in player as today | — |

</frozen-after-approval>

## Code Map

- `src/features/settings/SettingsScreen.tsx` -- rows via `useZoneItem`. Optional callback props gate the rows; they are wired in `src/app/Shell.tsx` (~l.429). Add an `externalPlayer?: {on, onToggle}` prop and put the row first.
- `src/shared/ui/SettingRow.tsx` -- add `kind: 'toggle'` with a value «Вкл»/«Выкл», the accent on «Вкл», and `accessibilityState.checked`. DESIGN.md SettingRow; EXPERIENCE.md: toggle flips immediately.
- `src/features/player/speedPreference.ts` -- template for the new `externalPlayerPreference.ts` (`peek/read/write`, `kv()` throw guard, setter for demo).
- `src/app/session.ts` l.33-39 -- demo store wiring; add the new setter.
- `src/app/phaseFlags.ts` -- add `externalPlayer: true` with a doc block, and update `src/app/__tests__/phaseFlags.test.ts`.
- `src/app/stackRoutes.tsx` `PlayerRoute` (~l.435-525) -- for a VOD ref with the flag on, render the new `PlayerEntry`, which reads the preference and picks the hand-off or PlayerScreen.
- `src/features/player/mediaResolver.ts` -- `useMediaSource` (ready: `sources`, `source`, `meta`), `qualityOptions`, `qualityOf`, `pickSource`. Reuse them; do not fork.
- `src/features/player/qualityPreference.ts` -- `read()` sets the initial focus; `remember()` is the fallback hand-over.
- `src/features/player/PlayerSettingsSheet.tsx` -- the quality submenu (radio `SettingRow`s, `qualityLabel`, SideSheet variant "player"). Extract and reuse it for the hand-off list.
- `src/features/player/PlayerScreen.tsx` -- add an optional `notice?: string` shown in the overlay (the overlay shows at start).
- `src/shared/platform/seekKeys.ts` -- port pattern (`native()`, availability check). Tests fake `NativeModules`.
- `android/.../boostytv/BoostyNativePackage.kt` -- register the new `ExternalPlayerModule.kt`.
- `android/app/src/main/AndroidManifest.xml` and `__tests__/androidManifest.test.js` -- `<queries>` for VIEW `video/*`. Without it, Android 11+ hides the other players.
- `src/shared/i18n/ru.ts` -- keys `settings.externalPlayer.{row,description,on,off}`, `player.external.{notFound,chooser}`.

## Tasks & Acceptance

**Execution:**
- [x] `android/.../ExternalPlayerModule.kt`, `BoostyNativePackage.kt`, `AndroidManifest.xml` -- add `open(url, title, chooserTitle): Promise<'opened'|'none'>`:
  - an `ACTION_VIEW` with `video/*` data and the `title` / `forcename` extras;
  - `queryIntentActivities` excluding our package and `com.android.tv.frameworkpackagestubs` (Google TV resolves VIEW to that stub, which is not a player);
  - none left → `'none'`; otherwise `createChooser` with those excluded via `EXTRA_EXCLUDE_COMPONENTS`;
  - the URI is never logged.
- [x] `src/shared/platform/externalPlayer.ts` (+ test) -- `openExternalPlayer({url,title})` → `'opened' | 'none'`. A missing module or a rejection → `'none'`.
- [x] `src/features/player/externalPlayerPreference.ts` (+ test), `src/app/session.ts` -- store and demo wiring.
- [x] `src/shared/ui/SettingRow.tsx`, `SettingsScreen.tsx`, `Shell.tsx`, `ru.ts` -- toggle row; component tests for the states and the flip.
- [x] `src/features/player/ExternalHandoff.tsx`, `PlayerEntry.tsx`, the `PlayerSettingsSheet.tsx` extraction, `PlayerScreen.tsx` notice, `stackRoutes.tsx` -- the hand-off flow per the matrix.
- [x] Tests -- the matrix rows, plus no `progress.begin`/E9 on hand-off, the URL absent from logger output, and the Back order. Extend `__tests__/playerFlow`-style flow tests, the demo flow and the manifest test.
- [x] `docs/feature-parity.md` PLAY-13/SET-xx, `EXPERIENCE.md` as-built, `docs/focus-map.md` hand-off sheet, `docs/testing.md` Story 8.2.

**Acceptance Criteria:**
- Given the flag off, when Настройки or a recording opens, then the app behaves exactly as before.
- Given the hand-off sheet, when it opens, then focus is trapped in the sheet, and Back exits to the origin item with the focus restored.
- Given a fallback, when the built-in player runs, then progress is written as usual and the stored quality preference is unchanged.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter B, Edge Case Hunter E, Verification Gap V):

| # | Finding | Verdict | Evidence / route |
|---|---------|---------|------------------|
| 1 | V1/B7: Kotlin never compiled, native half unverified | medium | Real: my `assembleRelease` failed on `video/*` inside KDoc (nested comment). Fixed in the module KDoc; the build now passes. Device rows remain (step 5). patch |
| 2 | V2/B9: no test for Back during an in-flight launch | medium | Every `open` mock resolves immediately. patch (test) |
| 3 | V-other/B9/E2: `.catch(() => {})` after the callbacks can leave the spinner stuck | low | A throw in `onOpened`/`onFallback` keeps `launchingRef` true; direct fix. patch |
| 4 | E1/E7/B5/V-other: `remember()` keeps the fallback pick for the whole app run | low | `qualityPreference.ts:91` sets process memory; the spec chose memory-only `remember` and the stored key is untouched, but docs say "this run only". patch (docs: until the app restarts) |
| 5 | B4: toggle row appears after an async read, above the focused «Версия» | medium | `Shell.tsx` `SettingsSection` renders the row once the read resolves; the first Настройки visit shifts the focused row. patch (warm the read at startup) |
| 6 | B11: focus-map Back table has no hand-off rows | low | Doc edit. patch |
| 7 | E3: `pickSource` null on a row → OK does nothing | low | Effectively unreachable (options come from the same sources); direct fix (fall back). patch |
| 8 | B1: no-player check happens only after the pick | false | Intent: list first, then chooser; fallback is the specified outcome |
| 9 | B2: `video/*` for HLS/DASH | maybe-false | Reference parity passes `video/*`; settle with a device HLS pick. rejected |
| 10 | B3: sheet lacks a title; «Загружаем видео» during launch | low | Cosmetic; launch is sub-second. rejected |
| 11 | B6: logs cannot tell `none` from a thrown launch | low | Diagnostics are Story 8.3. rejected |
| 12 | B8: chooser even with one real player | low | Reference parity (always a chooser). rejected |
| 13 | B10: E8 sent twice on fallback / not-ready | false | By design (Design Notes): fresh signed URLs for PlayerScreen |
| 14 | B12: SettingRow description padding may double | maybe-false | Settle on the device screenshot. rejected unless seen |
| 15 | B13: TalkBack announces on/off twice | low | TalkBack not a release path today. rejected |
| 16 | B14: demo mode launches a real chooser | low | Dev-only mode. rejected |
| 17 | B15/E6: hand-off ignores `isActive` / long background | low | The sheet owns focus inside its route; 23 h staleness negligible. rejected |
| 18 | E4: hand-off consumes the `__DEV__` break-next-video one-shot | low | Dev-only. rejected |
| 20 | Device: chooser shows «Действие не поддерживается»; File Commander invisible to `MATCH_DEFAULT_ONLY` and to the system chooser | high | Probe: flags 0 return File Commander + stub; `MATCH_DEFAULT_ONLY` only the stub; the chooser shows no targets. Owner decision recorded in Boundaries; patch |
| 21 | Device: after the chooser closed, focus landed on the sidebar «Главная», not the origin card | medium | Screenshot `dev82/26`. patch |
| 19 | E5: `http` media URLs hidden by `<queries>` | false | Signed media URLs are https (api-contract) |

## Design Notes

`PlayerEntry` keeps PlayerScreen out of the hand-off: `read()` → off → `<PlayerScreen …/>`; on → `<ExternalHandoff onOpened={onExit} onFallback={(q) => { qualityPreference.remember(q); setNotice(true) }} onNotReady={…}/>`. A fallback or a non-ready E8 state then mounts PlayerScreen, which resolves E8 again (fresh signed URLs).

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npx tsc --noEmit && npm run check:fixtures && npm test` -- expected: all clean and green.

**Manual checks (if no CLI):**
- Chromecast: the toggle persists after a restart. The chooser lists File Commander's player and does not list the stub. Back from the list leaves «Осталось N мин» unchanged. Use test content, not the owner's resume point.
