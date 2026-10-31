---
title: 'Finish the PlayerScreen live/VOD split before Epic 8'
type: 'refactor'
created: '2026-10-31'
status: 'in-progress'
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

- `src/features/player/PlayerScreen.tsx` -- live/VOD branches: `progress` null for live (~228), `media` pick (263), `phase` (304–307), heartbeat (454), `retryable` (578), overlay focus target (593–596), `settingsShown` (618), live `pickQuality` (699–711), live play after pause (793–805) vs VOD 23 h source refresh (806–820), `seekBy`/`onSkip` (866, 883), held key without `seek.markHeld` (949), live `onEnd` (1175–1182), `onError` target (1210), render (1296–1369). Cohesive chunks: source/preference (231–280), phase (298–321), engine state + seek (325–424), recovery (426–440, 1197–1292), spinner/overlay timers (456–482), focus (484–521, 565–608), settings sheet (523–563, 688–772), progress wiring, lifecycle (651–686, 1259–1271), keys (780–787, 903–1072), engine callbacks (1076–1196).
- `src/features/player/useLivePlayback.ts`, `useLiveHeartbeat.ts`, `recovery.ts`, `seekController.ts`, `qualityPreference.ts`, `PlayerSettingsSheet.tsx` -- reuse as they are.
- `__tests__/playerFlow.test.tsx` -- the behaviour lock (4.1–4.6, 6.3, 7.2, 7.3); fragile: fake timers with `Date.now` (500 ms entry guard, `SOURCE_REFRESH_AGE_MS`, `HOLD_REPEAT_MS`, spinner, auto-hide), two-frame `focusSoon`, `src/test/playerEngineMock`, effect order (`closeSheet(false)` before the focus effect; the resolution effect before `begin`).
- `__tests__/authorFlow.test.tsx`, `__tests__/postFlow.test.tsx` -- player return focus.
- `.eslintrc.js`, `__tests__/boundaries.test.js`, `__tests__/noRawText.test.js` -- boundary and copy rules.

## Tasks & Acceptance

**Execution:**
- [x] `src/features/player/playbackMode.ts` -- `createVodMode(...)` / `createLiveMode()` returning `{ kind, canSeek, holdSeeks, overlayFocus, retryable(state), settingsShown(...), progress, playIntent(...), qualityIntent(...), endIntent(), recoveryTarget(...) }` -- every remaining live/VOD decision in one pure place.
- [x] `src/features/player/playerPhase.ts` -- pure `derivePhase`, error target and error copy helpers.
- [x] `src/features/player/usePlaybackSession.ts` -- owns engine state, refs, seek controller, recovery and budget; exposes the engine callbacks and commands; executes mode intents with a `switch`.
- [x] `src/features/player/usePlayerSettings.ts`, `usePlayerProgress.ts`, `usePlayerKeys.ts`, `usePlayerFocus.ts` -- move the settings sheet, progress wiring, key handling (entry guard, hold, seek keys, Back) and overlay focus out of PlayerScreen.
- [x] `src/features/player/PlayerScreen.tsx` -- wiring and render only; no `isLive` branch outside building the mode and the render.
- [x] `src/features/player/__tests__/playbackMode.test.ts`, `playerPhase.test.ts` -- intent matrix for vod and live; phase derivation.
- [x] `docs/focus-map.md` (player section pointer), `docs/testing.md` (new section), `_bmad-output/implementation-artifacts/deferred-work.md` (mark the split entry done) -- record the change.

**Acceptance Criteria:**
- Given the existing suites, when run unchanged, then every `playerFlow`, `authorFlow`, `postFlow` and `demoFlow` test passes.
- Given `PlayerScreen.tsx` after the change, when counted, then it is at most about 550 lines and has no live/VOD behaviour branch outside the mode construction and the render.
- Given a live and a VOD mode, when each intent is asked, then the unit tests show the same decisions the old branches made.

## Implementation Notes

**What moved (2026-10-31):**
- `playbackMode.ts` (117 lines): `createVodMode(progress)` / `createLiveMode()` return a `PlaybackMode`: the flags `kind`, `canSeek`, `holdSeeks`, `heartbeat`, `overlayFocus`, `progress`, and the pure decisions `pickMedia`, `retryable`, `settingsShown`, `playIntent` (`liveEdge` | `refreshSource` | `plain`), `qualityIntent` (`switchSource` | `storeOnly` | `liveSwitch` | `none`), `endIntent` (`markEnded` | `reportEnd`) and `recoveryTarget`. `SOURCE_REFRESH_AGE_MS` moved here. Two flags beyond the spec's list, because they replace old branches: `heartbeat` (the `useLiveHeartbeat` condition) and `pickMedia` (the `media` pick). `recoveryTarget` takes the pending seek as a getter, so live never reads it (as before).
- `playerPhase.ts` (102): `isRecovering`, `derivePhase` (takes the mode's `kind`), `errorTarget`, `errorCopy`.
- `usePlaybackSession.ts` (696): the engine state, the overlay visibility and `showOverlay`, the refs (`gate`, `heldByLifecycle`, `nextStart`, `startMode`, `lastFailure`, `budget`, `resolvedAt`, `pendingPreferenceWrite`, `ended`, `scrubWasPlaying`), the seek controller, the recovery, the progress `report`, the commands (`pickQuality`, `setPlaying`, `togglePause`, `onOk`, `seekBy`, `onSkip`, `onRetry`, `pauseForLifecycle`) and the engine callbacks. `pickQuality`, `setPlaying` and `onEnd` `switch` on the mode's intents. No `useReducer`.
- `usePlayerSource.ts` (88, not in the task list): the quality preference, `keepQuality`, both media hooks (same order) and the progress store's readiness. Its own file because it is the first effect block and the session needs its output.
- `usePlayerSettings.tsx` (131; `.tsx`, not `.ts`, because `openSettings` renders `<PlayerSettingsSheet>`): `useSheetOpen` (state only) and `usePlayerSettings` (the sheet model, `closeSheet`, the close-when-not-playing and unmount effects, `openSettings`). The pick runs `session.pickQuality`, then `closeSheet(true)` and `showOverlay()`, as before.
- `usePlayerFocus.ts` (195): `useOverlayTimers` (spinner, auto-hide, no overlay outside playing) and `usePlayerFocus` (the views, the focused id, the `onXFocus` callbacks, the focus effect). The focus ids and the two timing constants moved here.
- `usePlayerKeys.ts` (313): `createEntryGuard` / `useEntryGuard`, `usePlayerKeys` (surface OK, hold, swallowed key ups, `onSeekKey`, `onTvEvent`, Back). `ENTRY_GUARD_MS`, `HOLD_REPEAT_MS` and `REMOTE_KEYS` moved here.
- `usePlayerProgress.ts` (106): `usePlayerProgress` (`begin`, the background/foreground subscriptions, the unmount `exit`) and `usePlayerAccessEnd` (the no-access exit, then `forget`).
- `PlayerScreen.tsx` 1477 → 413 lines. It builds the mode, calls the hooks, composes the background handler and `exitPlayer`, and renders. `isLive` is read only for the mode and for `liveCopy` in the render. It re-exports the moved constants and `PlayerStart`, so `index.ts` is unchanged.

**Effect order kept exactly.** Custom hooks run in the screen's fiber, so the hook call order is the effect order. The calls follow the old declaration order: source (preference, both media hooks, progress ready) → session (seek reset, new resolution, recovery end, arbiter) → heartbeat → overlay timers → settings (model, close when not playing, unmount close) → focus → progress (`begin`, background, foreground, unmount `exit`) → keys (seek keys, TV events, Back) → access end (no-access exit, `forget`) → live unplayable exit. `useSheetOpen` is a state-only hook declared before the timers, because the auto-hide reads `sheetOpen` before the settings effects run. Callback dependencies keep the same stability. `setPlaying` (and so `onTvEvent`) still changes with `media` on every render. `exitPlayer`, `onSeekKey` and the Back callback stay stable, so the Back listener is not re-registered and keeps its place among the BackHandler listeners.

**Verification (2026-10-31):** lint `--max-warnings 0`, typecheck and `check:fixtures` clean. `npm test` ×3: 125 suites, 2791 passed each. `playerFlow`, `authorFlow`, `postFlow`, `demoFlow` and `src/features/player/**` ×30: 0 failed runs, 662 passed each. Device check: left to the owner (see `docs/testing.md`).

**Quirks recorded (not fixed):**
- `mode` is memoized on `[isLive, progressRepository]`. If the repository changed while the player was mounted, `seekBy`, `onSkip` and `onSeekKey` would now change too. Before, only the progress callbacks changed. The seek keys would then re-subscribe. The repository changes only on an account switch, and that replaces the stack, so this cannot be seen.
- `setPlaying` now reads `Date.now()` for every call that has a ready source (to compute `sourceAgeMs`). Before, it read it only for a VOD play. The value is only compared, so behaviour is unchanged.
- The jest run picks up `.claude/worktrees/` (other agents' worktrees). Those suites fail to resolve modules, and haste reports duplicate mocks. All runs here pass `--modulePathIgnorePatterns '<rootDir>/.claude/worktrees/'` and `--testPathIgnorePatterns` for it. The repository's jest config is unchanged.

## Spec Change Log

## Review Triage Log

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
