---
title: 'Story 12.5: «Продолжить просмотр» as an app channel in the launcher'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'bcd274dad206817b3f949f01a17f30c857476fb1'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/docs/research/watch-next-and-launcher-channel-spike.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The owner's launcher, Aero TV, shows other apps' cards when their tile is focused, but Boosty TV publishes nothing, so resuming a video always means opening the app first.

**Approach:** Publish the local Continue history as one Android TV app preview channel «Продолжить просмотр» (our improvement IMP-04, FR67). Gate passed on the device 2026-11-03: Aero picks up a new or changed channel at once, ignores an empty channel (keeps stale cards) and replaces them with a neutral card. Owner decisions 2026-11-03: an empty history shows one neutral card «Откройте Boosty TV»; OK on a video card opens the Player at the resume point; Back from it goes to Главная.

## Boundaries & Constraints

**Always:** one channel found by its `INTERNAL_PROVIDER_ID`, created once and kept (programs replaced, the channel never deleted); programs mirror `continueEntries(store.entries())` (same order, ≤ `MAX_CONTINUE_ENTRIES`) with title (video title rule of the Continue card), author as the short description, and a poster that passes `persistablePreviewUrl`, else the app banner; an empty list publishes the neutral card (banner, «Откройте Boosty TV»); sync is driven by a projection key (order + titles + posters), so periodic progress ticks never sync; the AccountScope wipe publishes the neutral card (an account-scoped store registered after `progressAccountStore`) and late syncs carry the scope generation so an old account is never republished; the native module runs only on API 26+, off the UI thread, logs nothing and rejects with outcomes only; `WRITE_EPG_DATA` (normal) in the manifest; card links are `boostytv://continue?blogUrl=…&postId=…&mediaId=…` (URL-encoded) and `boostytv://home` for the neutral card and the channel app link, received through a VIEW + DEFAULT + BROWSABLE intent-filter (scheme `boostytv`, hosts `continue` and `home`) and stashed by the native module for a one-time `takePendingOpen()` (cold start and `onNewIntent` with `setIntent`); any other app can fire these links, so the ref validation below is the security boundary (owner decision 2026-11-03, after the device probe: Aero TV ignores a program's explicit-component intent and launches the app's LEANBACK_LAUNCHER intent, but fires a `boostytv://` VIEW link); a pending open is applied after navigation is ready and only when signed in and the ref matches a current local Continue entry (validated with the progress ref schema), else Главная; the Player opens as from a Continue card (`[Shell, Player]`, origin Главная, focus id `home/continue/<mediaId>`); the neutral card and the channel app link open Главная; demo mode never writes the channel.

**Never:** Watch Next; deleting the channel; account data beyond what the card shows; signed URLs; logging titles, ids or intent URIs; any scheme or host other than `boostytv://continue` / `boostytv://home`; acting on a link without the local-history check; syncing on every progress write.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First run | no history | Channel with the neutral card | Module missing / API < 26 → no-op |
| History | 3 Continue entries | 3 programs, newest first, title + author + poster | Poster with query → banner |
| Tick | progress ticks on the top entry | No sync | N/A |
| New / removed / finished / clear-all | the Continue projection changes | One sync with the new list (empty → neutral) | Sync failure → logged outcome, next change retries |
| Sign-out / account switch | AccountScope wipe | Neutral card; no late sync of the old account | N/A |
| OK on a video card, cold start, signed in | valid ref in history | Shell then Player at the resume point; Back → Главная focused on that card or its neighbour | Locked/removed post → the Player's existing unavailable path |
| OK, warm start | app running anywhere | Same, replacing the current stack | N/A |
| Stale / foreign / malformed ref, or signed out | not in local history | Главная (Welcome when signed out) | N/A |
| Neutral card / channel link | OK | Главная | N/A |

</frozen-after-approval>

## Code Map

- `android/app/src/main/java/io/github/dzmitryafanasenka/boostytv/` -- add `LauncherChannelModule.kt` (sync(cards), takePendingOpen()), register in `BoostyNativePackage.kt`; `MainActivity.kt` `onNewIntent` → `setIntent` + stash; template `ExternalPlayerModule.kt` (outcomes, no logs). Spike probe code shape: `docs/research/watch-next-and-launcher-channel-spike.md`.
- `android/app/src/main/AndroidManifest.xml` -- `WRITE_EPG_DATA`; no new intent-filter.
- `src/shared/platform/launcherChannel.ts` (new) -- port like `externalPlayer.ts` (`launcherChannelAvailable()`, try/catch → outcome).
- `src/shared/services/progress/continueEntries.ts` (`continueEntries`, `MAX_CONTINUE_ENTRIES`), `progressStore.ts` (`subscribe`, `persistablePreviewUrl` l.141, `progressAccountStore` l.423), `src/app/bootstrap.ts:36-46` (scoped stores; `__tests__/accountScopeRegistry.test.js`).
- `src/app/launcherChannel.ts` (new, started from `App.tsx` like the update checker ~l.437) -- subscriber, projection key, generation guard, demo off.
- `src/app/App.tsx` -- `onNavigationReady` (l.517) applies the pending open; `navigationRef` (l.76); `onOpenPlayer` shape (l.257-268); `src/app/routes.ts:51-53`; Back via `PlayerRoute` `beforeRemove` (`stackRoutes.tsx:446-480`).
- i18n `ru.ts` -- neutral card copy; Continue card title rule (`videoDisplayTitle`).
- Tests: platform port test pattern `src/shared/platform/__tests__/externalPlayer.test.ts`; Kotlin source tests `__tests__/appUpdaterModule.test.js`; `androidManifest.test.js`; `accountSwitchFlow` / `signOutFlow`; `src/test/flow.tsx`.
- Docs: `docs/adr/0016-…` (new: launcher channel, external entry, permission, account isolation), `docs/focus-map.md` (deep-link entry + Back), `docs/testing.md`, `docs/feature-parity.md` IMP-04, CHANGELOG pair.

## Tasks & Acceptance

**Execution:**
- [x] Native module + manifest + `MainActivity` + Kotlin source tests.
- [x] Port `launcherChannel.ts` + tests.
- [x] `src/app/launcherChannel.ts` sync (projection key, neutral card, wipe store, generation guard, demo off) + unit tests for every sync row.
- [x] Pending open in `App.tsx` + flow tests (cold, warm, invalid, signed out, Back).
- [x] ADR 0016, docs, changelog.

**Acceptance Criteria:**
- Given the release-like build on the pinned TV, when the owner watches part of a video and focuses Boosty TV in Aero, then its card shows; OK starts the Player at the resume point and Back lands on Главная; after «Очистить всё» Aero shows «Откройте Boosty TV» (owner's remote check; agent via adb for the rest).
- Given `npm run lint`, `npm run typecheck`, `npm test`, then all pass.

## Implementation Notes

- Device run 2026-11-03 on the first build: cards and the neutral card appear in Aero TV; OK on a card did not open the Player. Logcat: Aero starts `act=MAIN cat=[LEANBACK_LAUNCHER]` for our explicit-component program intent. A temporary probe card (`TEMP126`, removed) with `INTENT_URI` `boostytv://continue?probe=1` and a VIEW filter: Aero started `act=VIEW dat=boostytv://continue/...` and the app received it. The link format was changed with the owner's approval (frozen block updated).

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind, edge | `syncNow` ignores a null insert and still deletes old programs; a mid-loop exception leaves mixed programs | high | Empty channel → Aero keeps stale (possibly another account's) cards (gate result) | patch |
| 2 | edge | `pending` read-then-clear races UI thread vs module thread | medium | `stash` runs on the UI thread, `takePendingOpen` on the module thread | patch |
| 3 | blind, edge, vgap | `lastKey` set before the result; a failed sync (also the wipe) is never retried for an unchanged list | medium | Launcher can stay stale / leak the old account until the list changes | patch |
| 4 | blind | Channel row updated on every sync | low | Needless provider write; trivial fix | patch |
| 5 | vgap | Production demo-off gate untested; `applyLauncherOpen` not demo-gated | medium | Tests inject `enabled`; demoFlow has no native module | patch |
| 6 | blind | Warm open while another video plays untested | medium | `reset` removes Player A; restoration/progress order unasserted | patch (test) |
| 7 | blind | ADR rollback leaves the last account's cards | low | Doc gap; direct edit | patch |
| 8 | blind | i18n block placed under the demo comment | low | Misattached comment | patch |
| 9 | blind | CHANGELOG omits the API 26+ / launcher limits | low | Users may expect the stock launcher | patch |
| 10 | vgap | Native behaviour pinned only by source-text tests | maybe-false | No JVM test path; settle with device rows (order, recents, tile launch, foreign ref) | defer (device rows added) |
| 11 | blind | `onNewIntent` while already in the foreground applies late | low | Only a crafted intent can reach a foreground app; Aero always foregrounds us | rejected |
| 12 | blind | Cold/warm apply race at start | low | `takePendingOpen` is one-shot; only one call can win | rejected |
| 13 | blind | No logo, no program progress columns | low | Aero shows neither (spike); progress would make ticks sync | rejected (recorded) |
| 14 | blind | Status mismatch | false | Workflow syncs status at present | rejected |
| 15 | blind | `takePendingContentReturn` flag lifetime | low | Cleared on openShell/openExpired/signOut; other resets go through those | rejected |
| 16 | blind | Demo on a device with a real channel keeps real cards | low | Demo is a debug-only dev path | rejected |
| 17 | blind | `playerOpenMark('continue')` mixes cold launcher starts into the metric | low | Diagnostics only | rejected |
| 18 | edge | Expired session drops the open | low | Spec: signed out → no open | rejected |
| 19 | edge | `requestChannelBrowsable` not called | false | Aero shows `browsable=0` channels (spike); the call shows a system dialog | rejected |

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test` -- all pass.
- `cd android && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- BUILD SUCCESSFUL; check the APK time and bundle markers directly.

**Manual checks:**
- adb (foreground checked): Aero shows the cards after a short playback (owner-approved video) and the neutral card after clear-all; `am start` with a crafted intent for a foreign ref → Главная.
