---
title: 'Finish the PlayerScreen live/VOD split before Epic 8'
type: 'refactor'
created: '2026-10-31'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'af673791240e3c4a817db603626d27a7e007358e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-epic-7-retro-a2-live-and-focus-refactor.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `src/features/player/PlayerScreen.tsx` (1477 lines) still holds about 20 behavioural `isLive` branches and every player concern (engine state, recovery, settings sheet, progress, lifecycle, keys, focus) in one component. Epic 8 Story 8.1 (playback speed) and 8.2 (system player) would grow it further (deferred-work entry from the Epic 7 retro A2 spec; owner approved starting, 2026-10-31).

**Approach:** A behaviour-preserving split. Live/VOD differences become one `PlaybackMode` decision object per mode (pure data and intents, no mutation). One session hook owns the engine state and refs and executes those intents. The other cohesive chunks (settings, progress, keys, focus, phase derivation) move to their own hooks or pure modules in `src/features/player/`. PlayerScreen keeps the wiring and the render.

## Boundaries & Constraints

**Always:**
- No user-visible change: same UI, copy, focus targets, Back order, timings, requests and logs.
- Keep exactly as they are now:
  - E9 rules: report only when `gate.kind === 'started'`; one `begin` per open (none for recovery or retry; a replay after the end calls `begin` and seeks to 0); `pause` only on a user pause; `'end'` on exit with `Math.max(d, p)`; forced write on background and unmount.
  - `forget` on `goneForGood`; the quality preference is written only after `onLoad`.
  - Recovery budget: `takeRecovery` once per episode; a source refresh does not spend it; retry resets `played`.
  - The heartbeat condition; the engine `key` `${resolution}:${type}:${epoch}`.
- Engine refs that native callbacks read synchronously (`gate`, `heldByLifecycle`, `nextStart`, …) stay refs; mutation lives in one place (the session hook).
- Feature boundaries: new modules stay inside `src/features/player/`; the public exports of `src/features/player/index.ts` do not change; copy only through `t()`.

**Never:**
- No new user features (no speed, no external player), no speculative 8.1/8.2 API beyond what the split naturally exposes.
- No `useReducer` for engine state (async dispatch would shift native-callback timing).
- No changes to `useLivePlayback.ts` behaviour, `recovery.ts`, `seekController.ts`, `mediaResolver.ts`, `PlayerOverlay.tsx` beyond import moves.
- No weakening or rewriting of existing `playerFlow` assertions; only additions.

</frozen-after-approval>

## Code Map

- `src/features/player/PlayerScreen.tsx` -- line numbers are pre-split (baseline `af67379`). Live/VOD branches: `progress` null for live (~228), `media` pick (263), `phase` (304–307), heartbeat (454), `retryable` (578), overlay focus target (593–596), `settingsShown` (618), live `pickQuality` (699–711), live play after pause (793–805) vs VOD 23 h source refresh (806–820), `seekBy`/`onSkip` (866, 883), held key without `seek.markHeld` (949), live `onEnd` (1175–1182), `onError` target (1210), render (1296–1369). Cohesive chunks: source/preference (231–280), phase (298–321), engine state + seek (325–424), recovery (426–440, 1197–1292), spinner/overlay timers (456–482), focus (484–521, 565–608), settings sheet (523–563, 688–772), progress wiring, lifecycle (651–686, 1259–1271), keys (780–787, 903–1072), engine callbacks (1076–1196).
- `src/features/player/useLivePlayback.ts`, `useLiveHeartbeat.ts`, `recovery.ts`, `seekController.ts`, `qualityPreference.ts`, `PlayerSettingsSheet.tsx` -- reuse as they are.
- `__tests__/playerFlow.test.tsx` -- the behaviour lock (4.1–4.6, 6.3, 7.2, 7.3); fragile: fake timers with `Date.now` (500 ms entry guard, `SOURCE_REFRESH_AGE_MS`, `HOLD_REPEAT_MS`, spinner, auto-hide), two-frame `focusSoon`, `src/test/playerEngineMock`, effect order (`closeSheet(false)` before the focus effect; the resolution effect before `begin`).
- `__tests__/authorFlow.test.tsx`, `__tests__/postFlow.test.tsx` -- player return focus.
- `.eslintrc.js`, `__tests__/boundaries.test.js`, `__tests__/noRawText.test.js` -- boundary and copy rules.

## Tasks & Acceptance

**Execution:**
- [x] `src/features/player/playbackMode.ts` -- `createVodMode(...)` / `createLiveMode()` returning `{ kind, canSeek, streamEnds, noSourceLeaves, heartbeat, overlayFocus, progress, pickMedia, retryable(state), settingsShown(...), playIntent(...), qualityIntent(...), endIntent(), recoveryTarget(...) }` (as shipped; the pure live quality rules in `livePolicy.ts`) -- every remaining live/VOD decision in one pure place.
- [x] `src/features/player/playerPhase.ts` -- pure `derivePhase`, error target and error copy helpers.
- [x] `src/features/player/usePlaybackSession.ts` -- owns engine state, refs, seek controller, recovery and budget; exposes the engine callbacks and commands; executes mode intents with a `switch`.
- [x] `src/features/player/usePlayerSettings.tsx`, `usePlayerSource.ts`, `usePlayerProgress.ts`, `usePlayerKeys.ts`, `usePlayerFocus.ts` -- move the settings sheet, the source and preference, progress wiring, key handling (entry guard, hold, seek keys, Back) and overlay focus out of PlayerScreen.
- [x] `src/features/player/PlayerScreen.tsx` -- wiring and render only; no `isLive` branch outside building the mode and the render.
- [x] `src/features/player/__tests__/playbackMode.test.ts`, `playerPhase.test.ts`, `entryGuard.test.ts`; `__tests__/playerFlow.test.tsx` «Story 7.2» live quality pick (review) -- intent matrix for vod and live; phase derivation; the entry guard.
- [x] `docs/focus-map.md` (player section pointer), `docs/testing.md` (new section), `_bmad-output/implementation-artifacts/deferred-work.md` (mark the split entry done) -- record the change.

**Acceptance Criteria:**
- Given the existing suites, when run unchanged, then every `playerFlow`, `authorFlow`, `postFlow` and `demoFlow` test passes.
- Given `PlayerScreen.tsx` after the change, when counted, then it is at most about 550 lines and has no live/VOD behaviour branch outside the mode construction and the render.
- Given a live and a VOD mode, when each intent is asked, then the unit tests show the same decisions the old branches made.

## Implementation Notes

**What moved (2026-10-31):**
- `playbackMode.ts` (139 lines): `createVodMode(progress)` / `createLiveMode()` return a `PlaybackMode`: the flags `kind`, `canSeek` (one gate for seeking and held targets; the review merged `holdSeeks` into it), `streamEnds` and `noSourceLeaves` (the phase rules, review), `heartbeat`, `overlayFocus`, `progress` (null: no progress writes; not a liveness test), and the pure decisions `pickMedia`, `retryable`, `settingsShown`, `playIntent` (`liveEdge` | `refreshSource` | `plain`), `qualityIntent` (`switchSource` | `storeOnly` | `liveSwitch` | `none`), `endIntent` (`markEnded` | `reportEnd`) and `recoveryTarget`. `SOURCE_REFRESH_AGE_MS` moved here. Beyond the spec's list (besides the review's phase flags), because they replace old branches: `heartbeat` (the `useLiveHeartbeat` condition) and `pickMedia` (the `media` pick). `recoveryTarget` takes the pending seek as a getter, so live never reads it (as before). The pure live rules `liveSettingsShown` and `liveQualitySwitch` moved from `useLivePlayback.ts` to `livePolicy.ts` (26), so the pure mode imports no hook module (`useLivePlayback.ts` 128 → 109, an import move only).
- `playerPhase.ts` (102): `isRecovering`, `derivePhase` (takes the mode's `streamEnds` / `noSourceLeaves`), `errorTarget`, `errorCopy`.
- `usePlaybackSession.ts` (744): the engine state, the overlay visibility and `showOverlay`, the refs (`gate`, `heldByLifecycle`, `nextStart`, `startMode`, `lastFailure`, `budget`, `resolvedAt`, `pendingPreferenceWrite`, `ended`, `scrubWasPlaying`), the seek controller, the recovery, the progress `report`, the commands (`pickQuality`, `setPlaying`, `togglePause`, `onOk`, `seekBy`, `onSkip`, `onRetry`, `pauseForLifecycle`) and the engine callbacks. `pickQuality`, `setPlaying` and `onEnd` `switch` on the mode's intents. No `useReducer`. It returns grouped members (review): `view` (render values), `engineProps` (spread onto `PlayerEngineView`), `commands` (including `hideOverlay`, `background(closeSheet)` and `foreground`, which compose the Story 4.6 lifecycle handlers) and `progress` (`report`, `reportRef`, `readyProgressRef`); the screen reads no session ref.
- `usePlayerSource.ts` (88, not in the task list): the quality preference, `keepQuality`, both media hooks (same order) and the progress store's readiness. Its own file because it is the first effect block and the session needs its output.
- `usePlayerSettings.tsx` (131; `.tsx`, not `.ts`, because `openSettings` renders `<PlayerSettingsSheet>`): `useSheetOpen` (state only) and `usePlayerSettings` (the sheet model, `closeSheet`, the close-when-not-playing and unmount effects, `openSettings`). The pick runs `session.pickQuality`, then `closeSheet(true)` and `showOverlay()`, as before.
- `usePlayerFocus.ts` (195): `useOverlayTimers` (spinner, auto-hide, no overlay outside playing) and `usePlayerFocus` (the views, the focused id, the `onXFocus` callbacks, the focus effect). The focus ids and the two timing constants moved here.
- `usePlayerKeys.ts` (313): `createEntryGuard` / `useEntryGuard`, `usePlayerKeys` (surface OK, hold, swallowed key ups, `onSeekKey`, `onTvEvent`, Back). `ENTRY_GUARD_MS`, `HOLD_REPEAT_MS` and `REMOTE_KEYS` moved here.
- `usePlayerProgress.ts` (106): `usePlayerProgress` (`begin`, the background/foreground subscriptions, the unmount `exit`) and `usePlayerAccessEnd` (the no-access exit, then `forget`).
- `PlayerScreen.tsx` 1477 → 389 lines. It builds the mode, calls the hooks, passes `closeSheet` to the session's background command, builds `exitPlayer`, and renders. `isLive` is read only for the mode and for `liveCopy` in the render. It re-exports the moved constants and `PlayerStart`, so `index.ts` is unchanged.

**Effect order kept exactly.** Custom hooks run in the screen's fiber, so the hook call order is the effect order. The calls follow the old declaration order: source (preference, both media hooks, progress ready) → session (seek reset, new resolution, recovery end, arbiter) → heartbeat → overlay timers → settings (model, close when not playing, unmount close) → focus → progress (`begin`, background, foreground, unmount `exit`) → keys (seek keys, TV events, Back) → access end (no-access exit, `forget`) → live unplayable exit. `useSheetOpen` is a state-only hook declared before the timers, because the auto-hide reads `sheetOpen` before the settings effects run. Callback dependencies keep the same stability. `setPlaying` (and so `onTvEvent`) still changes with `media` on every render. `exitPlayer`, `onSeekKey` and the Back callback stay stable, so the Back listener is not re-registered and keeps its place among the BackHandler listeners.

**Verification (first pass, 2026-10-31):** lint `--max-warnings 0`, typecheck and `check:fixtures` clean. `npx jest --modulePathIgnorePatterns '<rootDir>/.claude/worktrees/' --testPathIgnorePatterns /node_modules/ '<rootDir>/__tests__/fixtures/' '<rootDir>/.claude/worktrees/'` ×3: 125 suites, 2791 passed each. `npx jest __tests__/playerFlow.test.tsx __tests__/authorFlow.test.tsx __tests__/postFlow.test.tsx __tests__/demoFlow.test.tsx src/features/player` (same ignore flags) ×30: 0 failed runs, 662 passed each. Review-patch verification: below the Review Triage Log. Device check: left to the owner (see `docs/testing.md`).

**Quirks recorded (not fixed):**
- `mode` is memoized on `[isLive, progressRepository]`. If the repository changed while the player was mounted, `seekBy`, `onSkip` and `onSeekKey` would now change too. Before, only the progress callbacks changed. The seek keys would then re-subscribe. The repository changes only on an account switch, and that replaces the stack, so this cannot be seen.
- `setPlaying` now reads `Date.now()` for every call that has a ready source (to compute `sourceAgeMs`). Before, it read it only for a VOD play. The value is only compared, so behaviour is unchanged.
- Live quality lists never offer a real choice today: `liveSourcesOf` keeps only `live_hls` / `live_dash`, which are both «Авто». The live pick path (`liveSwitch`) is therefore reachable only with a richer list; the review's flow test extends the repository result to reach it.
- The jest run picked up `.claude/worktrees/` (other agents' worktrees): their suites failed to resolve modules and haste reported duplicate mocks. The first pass used CLI ignore flags; the review patch adds `.claude/worktrees/` to `testPathIgnorePatterns` and `modulePathIgnorePatterns` in `jest.config.js`, so plain `npm test` works.

## Spec Change Log

## Review Triage Log

Coordinator review, 2026-10-31 (Blind Hunter, Edge Case Hunter, Verification Gap). Every item is patched in the commit `fix: review patches for the PlayerScreen live/VOD split`.

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | Live quality pick has no flow coverage (medium, VG) | patched | New `playerFlow` «Story 7.2 › Quality pick (a live list with a real choice)»: the other quality remounts with that candidate's URL, no `engine.seek`, no new E15, the preference (peek and stored) unchanged, the sheet closes with focus on «Настройки»; the playing quality only closes the sheet. E15 fixtures cannot offer two qualities (`liveSourcesOf` keeps only `live_hls` / `live_dash`, both «Авто»), so the test spies on `StreamRepository.liveSources` and appends a 720p candidate to the real result; red when the live intent is changed to `switchSource`. | test |
| 2 | `usePlaybackSession` returns ~45 members; the screen reads `reportRef.current`, `live.current.phase`, `setOverlay` (medium, BH) | patched | The return is grouped into `view`, `engineProps` (spread onto `PlayerEngineView`), `commands` and `progress`; the background/foreground composition moved into `commands.background(closeSheet)` / `commands.foreground` (same call order inside); `hideOverlay` replaces the raw setter. Hook order and callback stability unchanged. | code |
| 3 | `setPlaying` `refreshSource` with `current === null` swallowed the press (low, BH+ECH) | patched | The case now falls through to the plain path when there is no ready source (the mode never returns this intent then, but the old code played). | code |
| 4 | Pure `playbackMode.ts` imported helpers from the hook module `useLivePlayback.ts` (low, BH) | patched | `liveSettingsShown` and `liveQualitySwitch` moved to `livePolicy.ts`; `useLivePlayback.ts` only lost them (an import move). | code |
| 5 | `derivePhase` still branched on `kind === 'live'` (low, ECH) | patched | New mode fields `streamEnds` and `noSourceLeaves`; `derivePhase` takes the mode; outputs identical, `playerPhase.test.ts` uses the real modes. | code + test |
| 6 | `canSeek` and `holdSeeks` were always equal (low, BH) | patched | Merged into `canSeek`, documented as the one gate for seek presses and held targets. | code |
| 7 | `PlaybackMode.progress === null` read as liveness (low, BH) | patched | Its doc says null means «no progress writes» (also a VOD without a repository), and code that means «is live» reads `kind` or a flag. | docs |
| 8 | `useLatestRef` objects named `live` in the new hooks (low, BH) | patched | Renamed to `latest`; the rest object in `usePlayerSource` is `livePlayback`. | code |
| 9 | No unit test for `createEntryGuard` (low, BH) | patched | New `entryGuard.test.ts` (fake `now`): the mount window, single use, expiry after `ENTRY_GUARD_MS`, re-arm on the first landing only. | test |
| 10 | `playbackMode` matrix gaps (low, BH) | patched | Added live `retryable` for `unavailable` and `loading`, live `settingsShown([])`, VOD `qualityIntent` for the playing non-auto source. | test |
| 11 | Docs consistency (low, BH) | patched | `deferred-work.md` says «Done (host-tested; device check pending)»; one line count (389) everywhere; the task list names `usePlayerSettings.tsx` and `usePlayerSource.ts`; Code Map line numbers labelled pre-split (baseline `af67379`); the exact test commands recorded here and in `docs/testing.md`. | docs |
| 12 | Agent worktrees break plain `npm test` (low, BH) | patched | `.claude/worktrees/` added to `testPathIgnorePatterns` and `modulePathIgnorePatterns` in `jest.config.js`. | config |

**Review-patch verification (2026-10-31):** `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` (30): clean. Plain `npm test` ×3: 126 suites, 2799 passed each (2791 + 8 new: 1 flow, 5 entry guard, 2 matrix cases; the other matrix additions extend existing tests). `npx jest __tests__/playerFlow.test.tsx __tests__/authorFlow.test.tsx __tests__/postFlow.test.tsx __tests__/demoFlow.test.tsx src/features/player` ×30: 0 failed runs, 670 passed each. Final `PlayerScreen.tsx`: 389 lines.

## Design Notes

The mode decides, the session acts. Example of the shape (not binding):

```ts
const intent = mode.playIntent({ paused, sourceAgeMs });
switch (intent) {
  case 'liveEdge': remountAtLiveEdge(); break;      // heldByLifecycle=false, gate=load, bumpEpoch, buffering
  case 'refreshSource': refreshStaleSource(); break; // nextStart, seek.reset, keepQuality, recovery, media.retry
  case 'plain': resume(); break;
}
```

Rejected: an engine-state `useReducer` (native callbacks read refs synchronously). Story 8.1 then adds a speed row in `usePlayerSettings` and a mode flag, and 8.2 a route-level launcher, without touching PlayerScreen.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run check:fixtures` -- clean.
- `npm test` ×3 -- all green.
- touched and new test files ×30 (at least `playerFlow`, `authorFlow`, `postFlow`, `demoFlow`, the new unit tests) -- 0 failed runs.

**Manual checks (if no CLI):**
- Release-like build on the Chromecast (adb): open a video, play under 10 s, Back; open quality settings and close; no pause on the owner's content. Live cannot be checked (no subscribed blog is live).
