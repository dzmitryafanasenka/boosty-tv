---
title: 'Story 12.1: Remove videos from «Продолжить просмотр»'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '0e17a3e52fc79d6d67aa754132c8b456d5556801'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** «Продолжить просмотр» on Главная keeps every started video until it is finished; the viewer cannot drop videos they will not finish, so the row fills with noise.

**Approach:** A long OK on a Continue card opens a confirmation Dialog «Убрать из списка» / «Отмена»; a «Очистить всё» tile at the end of the row clears the whole row after confirmation. Removal is local only (our improvement, owner decision 2026-11-02, epic-12-context).

## Boundaries & Constraints

**Always:** long press via the `Pressable` `onLongPress` that react-native-tvos already drives from native key down (no JS key handler, no native change; document it in `docs/focus-map.md` §1.1 as the long-press exception); short OK keeps opening the Player; Dialogs use the shared `Dialog` through `useModal()` with initial focus on «Отмена» and Back = cancel; removal goes only through ProgressRepository and is written at once; it keeps the in-memory server position (`resumePoint` still offers the E8 `timeCode`); clear-all empties only the local Continue entries of the current account and keeps AccountScope generation rules; Russian copy in `ru.ts`; stable focus ids.

**Never:** an E9 or any other request; calling `repository.reset()`/AccountScope wipe for clear-all; changing the existing Story 4.7 `forget(mediaId)` semantics for locked/gone posts; a hint/toast about long press; logging titles or ids beyond existing logger rules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Short OK | OK < 500 ms on a card | Player opens as today | N/A |
| Long OK | OK held ≥ 500 ms | Dialog «Убрать из «Продолжить просмотр»?», focus «Отмена»; the trailing key up of the hold does not press «Отмена» | N/A |
| Cancel | «Отмена» or Back | Dialog closes, focus back on the same card, entry kept | N/A |
| Confirm remove | «Убрать из списка» | Entry gone from the row and storage at once; focus → next card, else previous, else first feed card | N/A |
| Remove last card | only one entry | Row hidden, focus → first feed card | No feed cards → `focusInitial()` fallback |
| Server position | removed video opened from Пост | «Продолжить · <server time>» still offered (if E8 had a `timeCode`) | N/A |
| Watched again | removed video played again | It returns to the row (normal Story 4.7 rule) | N/A |
| Clear all | OK on «Очистить всё» → confirm | All unfinished (Continue) local entries gone; finished entries kept (owner decision 2026-11-03); row hidden, focus → first feed card | N/A |
| Account switch / sign-out | after removal | Unchanged AccountScope wipe; no cross-account effect | N/A |

</frozen-after-approval>

## Code Map

- `src/shared/services/progress/progressStore.ts` -- `remove(mediaId)` (L290) also deletes `server`; add a local-only removal and `clearLocal(predicate)` (drop matching local entries, `notify(null)`, `schedule(true)`, keep `server`).
- `src/shared/services/progress/progressRepository.ts` -- `forget(mediaId)` (L369, Story 4.7, keep); add `dismiss(mediaId)` (drop writer + local-only remove) and `clearContinue()` (drop writers of Continue entries, `store.clearLocal(isContinueEntry)`; `isContinueEntry` in `continueEntries.ts` is the row's rule); type at L54-80.
- `src/shared/services/progress/useProgress.ts` -- `useProgressRepository()` for Home callbacks.
- `src/shared/ui/ContinueCard.tsx` -- add `onLongPress` prop, passed to `FocusableSurface` (it spreads `PressableProps`).
- `src/features/home/ContinueRow.tsx` -- `RowCard` (L91) forwards `onCardLongPress(id)`; append the «Очистить всё» tile after `items.map` (L235) with `slotNext` style; `continueNeighbour` (L28) reuse.
- `src/features/home/HomeScreen.tsx` -- `useContinueEntries` (L263), `onContinuePress` (L609), gone-card effect (L625-653, does not fire while a Dialog holds focus), `useModal()` (L485). After confirm: `modal.close({restoreFocus:false})`, compute neighbour with `continueNeighbour` from current ids, then `restoration.focusItem(neighbour)` or the first-feed fallback (`latch.auto(idsRef.current[0])`, `scrollToOffset(0)`, `restoration.focusInitial()`), then call the repository.
- `src/shared/ui/Dialog.tsx`, `src/features/settings/SignOutDialog.tsx` -- pattern for a two-action dialog (primary = «Отмена» gets `hasTVPreferredFocus`).
- `src/shared/focus/ModalHost.tsx` -- `open(content, initiatorRef)`, `close({restoreFocus})`.
- `src/shared/i18n/ru.ts` -- `home.continue.*` (L113); add `home.continue.clearAll`, `dialog.continueRemove.*`, `dialog.continueClear.*`.
- Tests: `progressRepository.test.ts` (forget at L640), `continueEntries.test.tsx`, `ContinueCard.test.tsx`, `__tests__/homeFeedFlow.test.tsx` («Story 4.7» L2089), `src/test/flow.tsx` (`press()` uses `onClick`; long press via the node's `onLongPress`).
- Device probe result (2026-11-03, release-like, pinned Chromecast, owner's physical remote): OK = `KEYCODE_DPAD_CENTER` (23); key down reaches JS as `pressIn` at once; held ≈ 1.1 s → native repeats from ≈ 400 ms, JS `onLongPress` at ≈ 520 ms, key up → `pressOut`, no `onPress`. Short presses (80–180 ms) → `onPress` only. adb `--longpress` holds only ≈ 400 ms, so adb cannot trigger `onLongPress` at the default 500 ms delay.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/services/progress/progressStore.ts`, `progressRepository.ts` (+ tests) -- local-only `dismiss` and `clearContinue`; tests: server position kept, written at once, other entries untouched, generation guard, no E9.
- [x] `src/shared/ui/ContinueCard.tsx` (+ test) -- `onLongPress` prop.
- [x] `src/features/home/ContinueClearTile.tsx` (new, or inside `ContinueRow.tsx`) -- ContinueCard-sized tile on `colors.surface`, «Очистить всё», id `home/continue/clear-all`, a11y label.
- [x] `src/features/home/ContinueDialogs.tsx` (new) -- remove and clear-all dialogs on the shared `Dialog`, ids `dialog/continue-remove/{cancel,confirm}`, `dialog/continue-clear/{cancel,confirm}`.
- [x] `src/features/home/ContinueRow.tsx`, `HomeScreen.tsx` -- wire long press, tile, dialogs and focus moves.
- [x] `src/shared/i18n/ru.ts` -- copy: remove title «Убрать из «Продолжить просмотр»?», body «Видео пропадёт только из этого списка. Позиция на Boosty сохранится.», actions «Отмена» / «Убрать из списка»; clear title «Очистить «Продолжить просмотр»?», body «Список на этом устройстве станет пустым.», actions «Отмена» / «Очистить всё».
- [x] `__tests__/homeFeedFlow.test.tsx` -- «Story 12.1» flows for every matrix row.
- [x] `docs/focus-map.md`, `docs/feature-parity.md` (IMP entry), `docs/testing.md`, `CHANGELOG.md` / `CHANGELOG.ru.md` [Unreleased] -- document behaviour, ids, probe, device check.
- [x] `.gitignore` -- keep the pending party-mode ignore in this PR.

**Acceptance Criteria:**
- Given the release-like build on the pinned TV, when the owner removes a card and clears the row with the physical remote, then it works D-pad only and the check is labelled as the owner's.
- Given `npm run lint`, `npm run typecheck`, `npm test`, then all pass.

## Implementation Notes

- Owner decision 2026-11-03 (asked during the matrix audit): «Очистить всё» removes only the Continue entries (started, not finished; `isContinueEntry` in `continueEntries.ts`, the row's own rule); finished entries stay for Пост and Story 12.2. The frozen Clear-all row was updated with the owner's answer; `clearLocal(predicate)` replaced the first «empty `local`» implementation.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind, edge | Back (not «Отмена») after the card/row left while a dialog is open loses focus | low | Real: ModalHost Back → `close()` → null initiator. Only an account reset changes the store while Главная has a dialog open (no player runs); the fix adds a host callback | rejected (unlikely, adds surface) |
| 2 | blind | `dismiss`/`clearContinue` drop a pending E9 retry, contradicting «Позиция на Boosty сохранится» | medium | `dropWriter` → `clearRetry`; writer retries only send E9 (`putLocal` is called only from `report`), so keeping the writer cannot re-add the entry | patch |
| 3 | blind | After removal Пост offers the E8 value, older than a later successful E9 | medium | `setServerPosition` only from `onServerProgress`; the E9 success branch does not update `server` | patch |
| 4 | blind, edge, vgap | No-feed-cards fallback in `focusAfterRemoval` unguarded/untested | false | The row renders only in the grid phase with feed cards (HomeScreen L264-271), so `neighbour === null` always has a first feed card | rejected |
| 5 | vgap, blind | Restore of a remembered «Очистить всё» (Настройки → Главная) untested | medium | New `restoreContinue` branch has no test; removing it would fall to the last card silently | patch |
| 6 | vgap | Row guide after removing the last card / focusing the tile untested | low | `cards()` filter is unguarded by tests; a direct test addition | patch |
| 7 | vgap, blind | Card leaving while a dialog is open (Отмена path) untested | low | Same rare trigger as #1 | rejected (unlikely) |
| 8 | blind | Trailing-key-up test only models Pressability; not device proof | low | True; rename and keep the device check as the proof | patch |
| 9 | blind | Long press not exposed to TalkBack (no accessibility action) | medium | `ContinueCard` has only `onLongPress`; no `accessibilityActions` | patch |
| 10 | blind | AD-12 rule line in focus-map not updated for the long-press exception | low | §1.1 rule line still says three places only | patch |
| 11 | blind | Status/Change Log inconsistencies | false | sprint status follows the workflow (synced at present); owner decision recorded in Implementation Notes | rejected |
| 12 | blind | Dead code in `ContinueRow` (`index === 0` for the tile, duplicate `onClearAll` check), `ContinueHeader` prop optionality | low | Direct deletions | patch |
| 13 | blind | IMP-01 cell too long | low | Style only, no named harm | rejected |
| 14 | blind | `npm test` once; `focusSoonRun` cancel discarded | low | The guard checks focus is still on the gone stop or target; tests will run ×3 | rejected (guard covers) |
| 15 | blind | CHANGELOG before the device check | false | Device checks run before the PR; changelog stays [Unreleased] | rejected |
| 16 | edge | `leave()` neighbour when the card is already gone → first card | low | Same rare trigger as #1 | rejected |
| 17 | edge | Null repository: dialogs confirm but no-op | false | `useContinueEntries` returns no entries without a store, so no row renders | rejected |
| 18 | edge | `store.entries()` capped vs `local` | false | `trim()` on put and load keeps `local` ≤ `MAX_PROGRESS_ENTRIES`, so `capped` returns all | rejected |
| 19 | edge | `dismiss` stale write after reset untested | low | Shares `schedule(true)` with the tested clear-all path; a direct test | patch |

## Design Notes

Long press needs no new input path: react-native-tvos `ReactViewGroup.onKeyDown` sends `PressIn` on the first key down of OK, Pressability arms a 500 ms timer and calls `onLongPress`, and skips `onPress` on the key up. The remaining risk is the trailing key up landing on the Dialog's «Отмена»: Pressability ignores a `pressOut` without its `pressIn`, but verify on the device.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test` -- expected: all pass.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL; `adb install -r`.

**Manual checks (if no CLI):**
- adb (foreground checked before each batch): «Очистить всё» tile reachable by → at row end; OK → dialog, Back → tile. Owner (physical remote): long OK → dialog, «Отмена» not auto-pressed; confirm removes; clear-all hides row.
