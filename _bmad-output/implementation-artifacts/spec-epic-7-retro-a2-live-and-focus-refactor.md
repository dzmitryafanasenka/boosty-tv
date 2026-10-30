---
title: 'Epic 7 retro A2: live playback, author live block, generation-keyed store, guarded focusSoon'
type: 'refactor'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '0346d8d9da61182af829288211be6ee8187b1679'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-retro-2026-10-30.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Epic 7 retro (A2, `epic-7-retro-item-34`) found four problems:
- `PlayerScreen.tsx` (1514 lines) has about 20 live/VOD branches.
- `AuthorScreen.tsx` grew back to 751 lines, with a seven-branch live return-focus block that duplicates the card-loss logic.
- The generation-keyed single-flight/optimistic module state is written twice (`usePollVote`, `useLiveLike`), and the `sameAccount` guard three times.
- «Focus now and again after two frames» is copied six times.

Epic 8 changes the player next.

**Approach:** four extractions, one PR (owner decision 2026-10-30: one PR):
1. `useLivePlayback` from the Player.
2. `useAuthorLiveBlock` with one `liveReturnTarget` function.
3. `createGenerationKeyedStore` and `captureGeneration` in `shared/account`.
4. A guarded `focusSoon` in `shared/focus`.

This is a pure refactor: no change in behaviour, focus timing, requests, copy or logs. It carries the focus part of `epic-6-retro-item-28`; the `PostBody`/`PollWidget` split stays out of scope.

## Boundaries & Constraints

**Always:**
- Every existing test passes, and its assertions keep their meaning; only helpers move.
- Keep the import boundaries (`shared` never imports `features`; `FEATURE_EDGES` unchanged).
- Focus timing stays identical, frame for frame. `postFlow` mocks rAF, so frame counts matter.
- Keep the Story 6.7 rules: never unmount the focused view; a freshly mounted view gets focus after 2 frames.

**Never:**
- No behaviour fixes. Record any quirk found in Implementation Notes.
- Do not add cancellation where a site never cancelled (ModalHost, the PostScreen helpers).
- Do not unify the TagList retry loop, the PollWidget per-frame hand-off or the AuthorScreen 1-frame QR open.
- No `PostBody`/`PollWidget` split.

</frozen-after-approval>

## Code Map

- **1. Player** (`src/features/player/PlayerScreen.tsx`).
  - Live sites:
    - 231-236 (`liveRef`, `vodRef`, `isLive`, `progress` null for live);
    - 260 (`keepQuality`, shared by VOD and live);
    - 262-266 (both media hooks always run, in this order);
    - 268 `liveEnded`, 270 `liveEpoch`;
    - 311-315 phase;
    - 451/461 (`playing`, `useLiveHeartbeat`);
    - 585 `retryable`;
    - 600-621 overlay focus target (live → play/pause);
    - 631 `settingsShown`;
    - 712-724 live `pickQuality`;
    - 807-818 live play after a pause;
    - 880/897/963 seek disabled;
    - 1189-1196 live `onEnd`;
    - 1224 recovery target;
    - 1310-1322 `liveUnplayable` + `useFocusEffect`;
    - 1325-1356 live copy and a11y.
  - Split into two calls because `phase` depends on `liveEnded`:
    - `useLivePlayback(...)` before `phase`: refs, the live media, `liveEnded` / `markEnded`, `epoch` / `bumpEpoch`, the engine key suffix, `liveUnplayable`;
    - the side effects at line 461: the heartbeat and the unplayable focus effect.
  - Branches that mutate screen refs (`gate`, `heldByLifecycle`, `setBuffering`, `setAutoHeight`, `showOverlay`) stay in the screen or arrive as callbacks.
  - Live copy and a11y labels go to a pure `liveCopy(...)`.
  - **Order to keep:** the heartbeat effect is declared before `reportRef.current('exit')` (699; unmount cleanup order); the unplayable `useFocusEffect` comes after the noAccess effect; the engine key stays `${resolution}:${source.type}:${epoch}` (VOD epoch 0); `liveEnded` is never reset.
  - Tests: `playerFlow` Story 7.2 (2961) and 7.3 (3280); `liveSource`, `PlayerOverlayLive`, `mediaResolver`, `recovery` unit tests.
- **2. Author** (`src/features/author/AuthorScreen.tsx`).
  - Wiring at 200-223, 378-388 and 551.
  - Return block in `useFocusEffect` (396-452). Branches 1-5 move into `useAuthorLiveBlock`:
    1. card shown → `autoFocusLive()`, plus a QR request (consumed before branching, opened one rAF later, cancelled in cleanup);
    2. like or share still shown → that button;
    3. like gone, share shown → share;
    4. like/share gone, card shown → card;
    5. a live/like/share id with phase `grid` → `latch.auto(ids[0])` + `restoration.focusInitial()` (not `restoreOrFirst`).
  - Branches 6-7 (a card id → `restoreOrFirst`; else sidebar unless a zone target holds focus) stay in the screen.
  - Card loss in `src/features/author/useAuthorLive.tsx` 184-226: the render-phase capture of `lostWhileFocused` / `likeLostWhileFocused` **must stay render-phase**. Like lost → share; all lost → first post, both guarded by `isActive && !modal.isOpen()`.
  - Make **one pure `liveReturnTarget(current, {card, like, share, grid})`** → `'live' | 'like' | 'share' | 'firstPost' | null`, used by the return branches and by both loss effects. Each call site keeps its own guard; the loss path never returns `'live'`. The QR is a side output of branch 1, not part of the target.
  - Tests: `authorFlow` focus §4 D (656), Story 7.1 (2145), 7.2 (2572), 7.4 (2758); `LiveCard.test.tsx`.
- **3. Store** (`src/shared/account/generationKeyed.ts`, exported from the account index; imports only `./accountScope` and react).
  - API: `createGenerationKeyedStore<V>()` → `key(id, gen?)`, `get`, `getAt`, `set`, `delete`, `deleteIf(key, expected)` (identity), `subscribe`, `reset`, `useEntry(id)` (`useSyncExternalStore`).
  - `captureGeneration()` → `() => boolean`.
  - Move `usePollVote.inFlight` (`finally` deletes only its own entry) and `useLiveLike.overlays` (settle/rollback only on identity; `dropSettled` on the current generation) onto it.
  - `useLiveHeartbeat` keeps its lazy capture but uses the helper.
  - `notify` timing stays identical. `resetPollVotesForTests` / `resetLiveLikesForTests` keep their names as wrappers.
  - Tests: `PollWidget.test.tsx`, `postFlow` 6.6 (2761) and 6.7 (3035), `authorFlow` 7.4, `playerFlow` 7.3, `accountSwitchFlow`, `signOutFlow`; a new unit test for the store.
- **4. focusSoon** (`src/shared/focus/focusSoon.ts`; `src/shared/filters/focusSoon.ts` re-exports it or its users move).
  - API: `focusSoon(target: (() => HostView | null) | (() => void), {now = true, frames = 2, guard?}) → cancel`.
  - Sites, each with its timing kept:
    - `PlayerSettingsSheet.tsx` 113-119 (now + 2, no guard);
    - `ModalHost.tsx` 131-142 (guard `!modalRef.current`; the cancel is ignored, as before);
    - `PostScreen.tsx` 530-540 `focusAfterUnmount` (now + 2, guard `isActive && current === gone`, no cancel);
    - `PostScreen.tsx` 554-570 `focusLaidOut` (`now: false`, 2 frames, target resolved inside, guard, fallback `focusInitial`);
    - `PlayerScreen.tsx` 612-620 (the conditional early return stays outside; guard `focused !== id && isActive && !sheetOpen`);
    - `useAuthorAutoFocus.ts` 174-193 `autoFocusLive` (`latch.auto`, its ref and re-call cancel stay outside).
  - Leave alone: `TagList.tsx` 128-158, `PollWidget.tsx` 510-531, the `AuthorScreen` 1-frame QR, `useOutcomeFocus`, `useFocusRestoration`, and the single-frame `setDownTarget` sites.
  - Tests: `ModalHost.test.tsx` (135), `screenFocus.test.tsx`, `postFlow` §4 F (888 / ~1062), 6.6, 6.7; `PeriodStepper.test.tsx`; `playerFlow` 4.3 (1864), 4.6 (2732), 7.2; `authorFlow` 7.1; a new `focusSoon` unit test.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/focus/focusSoon.ts` (+ export, unit test: now + N frames, `now: false`, the guard blocks, the cancel stops later frames) -- move the filters helper there and point every listed site at it.
- [x] `src/shared/account/generationKeyed.ts` (+ export, unit test) -- move `usePollVote`, `useLiveLike` and the `useLiveHeartbeat` guard onto it.
- [x] `src/features/player/useLivePlayback.ts` (+ `liveCopy`) -- shrink `PlayerScreen.tsx`, keeping the ordering rules.
- [x] `src/features/author/useAuthorLiveBlock.ts` + `liveReturnTarget` (pure, unit-tested for every branch) -- shrink `AuthorScreen.tsx` and route the `useAuthorLive` loss effects through it.
- [x] Docs: one-line pointers in `docs/focus-map.md` (focusSoon, the live return target) and in `ARCHITECTURE-SPINE` notes only if a doc there names the moved code; Implementation Notes with the before/after line counts.

**Acceptance Criteria:**
- Given the refactor, when `npm test` runs 3 times, then all pass with the existing tests unchanged in meaning plus the new unit tests.
- Given the touched suites, when they run 30 times, then none fails. The suites: `playerFlow`, `authorFlow`, `postFlow`, `eventsFlow`, `searchFlow`, `homeFeedFlow`, `PollWidget`, `ModalHost`, `PeriodStepper`, the new unit tests, `accountSwitchFlow`, `signOutFlow`.
- Given the source, when searched, then `requestAnimationFrame` double-frame focus code exists only in `shared/focus/focusSoon.ts` and the three listed exceptions, and `${generation}:` keyed module maps exist only in `shared/account/generationKeyed.ts`.
- Given lint, typecheck and `check:fixtures`, when run, then they are clean, including the boundary rules.
- Given a release-like build on the device, when the agent drives it over adb, then focus behaves as before in Пост (poll vote/retract hand-off, link chips, QR), the player overlay and settings sheet, a modal close, Автор (search, filters, return from a post), and the demo LiveCard/like/share.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean
- `npm test` ×3 -- expected: all pass
- the touched suites ×30 -- expected: 0 failed runs

**Manual checks:**
- Device (agent over adb). Before every key batch, check the app is in the foreground (`io.github.dzmitryafanasenka.boostytv`); screenshot before every OK. No real vote, like or heartbeat; the demo for live.

## Implementation Notes

**What moved (2026-10-30):**
- `src/shared/focus/focusSoon.ts`: `focusSoon(view, {now = true, frames = 2, guard?}) → cancel` and `focusSoonRun(action, …)` (after review: explicit target kinds). The guard is read only at the deferred run, never for the `now` call, which matches every site. An action (`focusSoonRun`) moves focus itself and sends no `requestHostFocus` of its own. A view getter that returns `null` still sends it, because the old sites did and the flow tests count those calls. `src/shared/filters/focusSoon.ts` is deleted; `FilterSheet` and `PeriodStepper` import it from the `shared/focus` barrel.
- Sites on `focusSoon`, timing unchanged: `PlayerSettingsSheet` (now + 2, cancel), `ModalHost` (guard `!modalRef.current`, cancel ignored), `PostScreen.focusAfterUnmount` (`focusSoonRun`, now + 2, guard, no cancel), `PostScreen.focusLaidOut` (`focusSoonRun`, `now: false`, the target resolves the candidates or calls `focusInitial` itself, guard, no cancel), the `PlayerScreen` focus effect (the early return stays outside), and `useAuthorAutoFocus.autoFocusLive` (`latch.auto`, the cancel ref and the unmount cancel stay outside; the old `view === null` check is now part of the guard).
- `src/shared/account/generationKeyed.ts` (91 lines): `createGenerationKeyedStore<V>()` and `captureGeneration()`, exported from the account index. `set`, `delete` (only when it removed something), `deleteIf` and `reset` notify once each. That gives the same notify count and timing as the old hand-written `notify()` calls, because every old delete removed an existing entry. Moved onto it: `usePollVote.inFlight` (`finally` → `deleteIf(key, controlKey)`), `useLiveLike.overlays` (settle and rollback still only while `getAt(key) === entry`; `dropSettled` on the current generation), and `useLiveHeartbeat` (lazy `captureGeneration()` when watching first starts). `resetPollVotesForTests` and `resetLiveLikesForTests` keep their names.
- `src/features/player/useLivePlayback.ts`:
  - `splitMediaRef`;
  - `useLivePlayback` (the live media, `liveEnded` / `markEnded`, `epoch` / `bumpEpoch`, `liveUnplayable`), called right after `useMediaSource`, so the hook order is unchanged;
  - `useLiveUnplayableExit`;
  - the pure helpers `liveSettingsShown`, `liveQualitySwitch` and `liveCopy`.
  - The live paragraph of the `PlayerScreen` doc moved there as well.
- `src/features/author/liveReturnTarget.ts` (pure, plus `liveFocusRole`) and `src/features/author/useAuthorLiveBlock.ts`:
  - `useAuthorLiveBlock`: the ids, the card, like and share views, the E15 query and the like.
  - `useAuthorLiveActions`: the presses, `onLikePress`, and `returnFocus` (branches 1–5). It consumes the QR request first and returns the cleanup that cancels the one-frame QR open.
  - `liveReturnTarget` lives in its own file, so `useAuthorLive` can import it without a cycle (`useAuthorLiveBlock` imports `useAuthorLive`).
  - Both `useAuthorLive` loss effects now store the lost role (still captured during render) and go through `liveReturnTarget`. Like loss passes `{card: shown, share: shown, grid: false}` and acts on `'share'`; card loss passes all `false` with `grid: true` and acts on `'firstPost'`. `restoration.focusInitial` already falls back to the action above, which matches the old phase-free card loss.

**Deviation from the Code Map (ordering wins):** the player's side effects are not one second call at line 461. The heartbeat stays the existing `useLiveHeartbeat(...)` call at its old place, before the unmount `exit` report. The unplayable exit is `useLiveUnplayableExit(...)`, still declared after the no-access exit effect. Two separate calls are the only way to keep both «Order to keep» rules. The same applies to the Author side: `useAuthorLiveFocus` stays at its old place (after `useHeadChangeRefocus`), because its effects must keep their order relative to the phase effect and the head refocus. The block state hook moved to after `useAuthorField`. The moved code there is only `useMemo` and hooks that have no effects of their own and come before them, so the effect order is unchanged.

**Line counts (before → after):**
- `PlayerScreen.tsx` 1514 → 1477;
- `AuthorScreen.tsx` 751 → 694;
- `useAuthorLive.tsx` 313 → 322;
- `usePollVote.ts` 166 → 144;
- `useLiveLike.ts` 237 → 216;
- `useLiveHeartbeat.ts` 156 → 156;
- `useAuthorAutoFocus.ts` 269 → 260;
- `PostScreen.tsx` 811 → 813;
- `ModalHost.tsx` 219 → 213;
- `PlayerSettingsSheet.tsx` 163 → 160.

**Scope carried:** this change carries only the focus part of `epic-6-retro-item-28` (the `PostBody` / `PollWidget` split stays open). `epic-7-retro-item-34` (A2) should be closed after merge. The rest of the PlayerScreen live/VOD split is a `deferred-work.md` entry («finish the PlayerScreen live/VOD split before Epic 8 Story 8.1»).

The Player shrinks little. Most of the remaining `isLive` branches are single conditions inside VOD logic that mutates screen refs (`gate`, `heldByLifecycle`, `seek`, `setBuffering`, `setPaused`). Moving them out would mean passing those refs as callbacks, without a real seam, so they stay in the screen per the Code Map.

**Quirks recorded (not fixed):**
- `ModalHost`'s deferred request is never cancelled: a quick unmount of the host after a close still runs it (harmless: the guard reads a ref).
- The Author QR open is still a raw one-frame `requestAnimationFrame`. It now lives in `useAuthorLiveBlock.ts` instead of `AuthorScreen.tsx`.
- Device, already on the baseline build (`0346d8d`, compared on the device): Back on Автор with an active search while a result card is focused clears the search, but focus stays on that card when the card is also in the normal list. The field does not get focus; the head refocus likely keeps the card. The host test «Back with a search» covers focus on the field only.
- Host flake, already present: `playerFlow` «Expired URL» checks the player log JSON against `/…|312|v1/`, so it fails whenever the entry's wall-clock `time` contains «312» (1 run in 30 here). It then cascades through its `describe`.
- `GenerationKeyedStore.useEntry` does not re-render on a generation bump by itself (no store change is notified); the next render or notify reads the new generation. This is how the hooks behaved before the move; unchanged.
- `liveReturnTarget('live', …)` with the card gone but a button still mounted gives `'firstPost'`. The buttons never outlive the card, so this case cannot happen.

**Verification (2026-10-30):** lint `--max-warnings 0`, typecheck and `check:fixtures` clean. `npm test` ×3: 118 suites, 2665 passed each. Touched suites ×30: 29 clean (806 passed each) and 1 failed run, the `playerFlow` «312» timestamp flake above, unrelated to this change. Device rows: `docs/testing.md` «Epic 7 retro A2».

## Spec Change Log

## Review Triage Log

Coordinator review, 2026-10-30. All findings are patched, except one marked false:
- **patched** — `focusSoon.ts`:
  - `frame` is now declared before the first schedule (a synchronous rAF no longer hits the TDZ);
  - `frames` is clamped to an integer ≥ 1 (≤ 0 and NaN → 1);
  - the two target kinds are explicit: `focusSoon(view: () => HostView | null)` for views, `focusSoonRun(action)` for actions (the PostScreen helpers); view getters return `null`, never `undefined`;
  - new unit tests: `now: false` with a guard, cancel with `now: false`, `frames: 1`, clamping, a synchronous rAF shim.
- **patched** — `generationKeyed.ts`:
  - `deleteIf` now requires `entries.has(key)`, with a test (missing key, `expected` undefined);
  - the file doc records that `useEntry` does not re-render on a generation bump (also listed under quirks).
- **patched** — `captureGeneration()` now returns a `GenerationCheck` that exposes the captured `generation`. `usePollVote.submit` and `useLiveLike.toggle` use the same pattern: capture once, then `store.key(id, check.generation)`.
- **patched** — `useAuthorLive` like loss: it reads the real share view (`share.liveViewRef.current !== null`), and `likeLostWhileFocused` is narrowed to `'like' | null`. The capture still happens during render. Side effect: if the card is shown without a share view (it never is, since share renders with the card), the target is now the card and nothing is done; before, it was `latch.auto(share)` plus a no-op focus request.
- **patched** — `useAuthorAutoFocus.autoFocusLive` clears `cancelLive.current` at the deferred run, only while it still holds this call's cancel. This matches the old `liveFrame.current = null`.
- **patched** — new `src/features/author/__tests__/useAuthorLiveActions.test.tsx` covers:
  - the QR request is consumed when the result is null and when the target is not the card;
  - the QR opens only for role `live`, one frame later;
  - not for a button gone onto the card;
  - the cleanup cancels the QR frame;
  - the first post when everything is gone.
- **patched** — new `src/features/player/__tests__/liveCopy.test.ts` covers ended, an error with its kind, the generic error, and `surfaceLabel` loading and playing. `playerFlow` asserts the `player/surface` accessibility label in Story 7.2 «Open live» (live surface) and in the VOD «while the fresh E8 runs» test (loading). Both are new assertions; no existing assertion changed.
- **patched** — `ModalHost.test.tsx` has a new test: a close, then a reopen before two frames pass, then no late request to the first initiator. It is red with the guard removed.
- **patched** — the `liveQualitySwitch` doc now says it returns a boolean.
- **patched** — `FilterSheet` and `PeriodStepper` import `focusSoon` from the `shared/focus` barrel (no cycle: `shared/focus` and `shared/ui` never import `shared/filters`).
- **patched** — test names in `liveReturnTarget.test.ts` and `generationKeyed.test.tsx` use a plain apostrophe.
- **patched** — new `deferred-work.md` entry «finish the PlayerScreen live/VOD split before Epic 8 Story 8.1», with the reason. The Implementation Notes now record the leftover, that only the focus part of `epic-6-retro-item-28` is carried, and that `epic-7-retro-item-34` should be closed after merge.
- **false** — «the diff misses deferred-work.md»: the coordinator appended that entry after generating the diff.
