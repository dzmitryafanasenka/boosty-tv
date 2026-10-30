---
title: 'Story 7.3: Live viewer heartbeat'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'oneshot'
baseline_commit: 'ec085c2887e871dad2f8890ef1f89154b9e87f1f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-7-2-watch-a-live-stream.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Boosty counts a viewer of a live stream by a heartbeat the website sends, and the TV app sends none (LIVE-03, FR23).

**Approach:**
- While a live stream plays in the Player (Story 7.2), send E16 `PUT /v1/blog/{blogUrl}/video_stream/heartbeat/viewer` every 30 s.
- On exit or end, send exactly one `?stop=true`, also when the screen unmounts.
- A failure is not retried immediately (AD-6) and never touches playback.

**Decisions (agent, invisible in the UI; reference: `HEARTBEAT_INTERVAL_MS = 30_000`):**
- "Watching" means the live player is in phase `playing` and not paused.
- A pause, background, sleep, audio-focus loss, recovery, error or the ended state stops the ticks, with no stop sent.
- Play after a pause restarts the 30 s schedule. The first heartbeat goes out 30 s after watching starts.
- The single stop goes out on the first of: the ended state, or the player unmounting (every exit path). It is sent only if watching started at least once (so an exit within the first 30 s still sends it, matching the AC), and only while the account generation captured at the start is unchanged. After a sign-out or account switch nothing is sent, not even the stop (Epic 6 retro lesson).
- A failure logs a counts-only warning (no blog, URL or token). The next tick still goes out on schedule.
- Demo mode answers E16 with 200 in the demo transport. Nothing reaches Boosty.
- A real E16 on the device is an outward action. It is sent only with the owner's approval, and only if a subscribed blog is live.

</frozen-after-approval>

## Implementation Notes

### Decisions

- **Where the logic lives:** a small hook, `useLiveHeartbeat(http, blogUrl | null, watching, ended)` in `src/features/player/useLiveHeartbeat.ts`, called once from `PlayerScreen` with `watching = isLive && phase === 'playing' && !paused` and `ended = phase === 'ended'`. A VOD player passes a null blog, so the hook is inert. The E16 call itself is `StreamRepository.heartbeat(http, blogUrl, { stop })` next to E15, with `heartbeatPath(blogUrl, stop)` built on `streamPath` (blog validation reused; `?stop=true` in the path because `HttpRequest` has no query option). `retry: false` is explicit, although the HttpClient never retries or replays a non-GET anyway.
- **Timing:** a `setInterval(30 s)` started each time watching becomes true and cleared when it ends, so the first heartbeat goes out 30 s after watching starts and a play after a pause restarts the schedule. `phase === 'ended'` (the engine's end, or E15 saying no stream at open or after a recovery) and `phase` `loading`/`recovering`/`error` are not `playing`, so ticks stop; background, sleep and audio-focus loss stop them through `paused`.
- **Single stop:** a `stopped` ref makes the stop one-shot across the two triggers (the `ended` effect and the unmount cleanup). It is sent only if watching started at least once (the captured generation is non-null), so a player that never got to `playing` (not playable, gone at resolve, failed E15) sends no E16 at all.
- **Account guard:** the generation is captured when watching first starts (`accountScope.generation()`); every tick and the stop check it. After a sign-out or account switch nothing is sent, and the stop is marked as done so it can never go out later.
- **One request in flight:** a tick while the previous heartbeat still runs is skipped (AD-6 "one request in flight per entity"). The stop is chained on the pending heartbeat's promise (review fix), so it never overtakes it; fire-and-forget, so it still goes out after the unmount.
- **Halting (review fix):** after an unauthorized failure (`SessionExpired`, or status 401: a mutation is not replayed after the renewal, so a 401 surfaces as `Client` with status 401) or a 429 (`RateLimited`), the interval is cleared for this playback and never restarted; the stop still goes out after a 429, not after a 401. A renewal that rejects with another kind (e.g. `Network`, or `Client` without a status when the refresh cannot run) is not treated as unauthorized: a known gap.
- **Failure log:** `logger.warn('live', 'heartbeat failed', { stop, failures, kind })` — counts plus the `AppError` kind (review fix), no blog, URL or token (the HttpClient's own `PUT failed`/`PUT` lines with the path existed before and are unchanged).

### Files changed

- `src/shared/entities/stream/streamRepository.ts`, `index.ts` — `heartbeatPath`, `StreamRepository.heartbeat`.
- `src/features/player/useLiveHeartbeat.ts` (new), `src/features/player/PlayerScreen.tsx` — the hook and its call; header doc line.
- `src/app/dev/demo.ts` — E16 branch (PUT on a demo blog's heartbeat path, 200, no body).
- Tests: `src/shared/entities/stream/__tests__/streamRepository.test.ts` «E16 heartbeat»; `__tests__/playerFlow.test.tsx` (global E16 handler, nested «Story 7.3» block, 10 tests); `__tests__/demoFlow.test.tsx` (demo E16 answered 200, one stop, no network); `__tests__/authorFlow.test.tsx` (E16 handler only, so its live-player tests do not record failing heartbeats).
- Docs: `docs/api-contract.md` (E16 row and «E16 heartbeat (Story 7.3)»), `docs/feature-parity.md` LIVE-03, `docs/testing.md` «Story 7.3».

### Surprises

- A Back exit does not unmount the Player synchronously in `playerFlow` (the native-stack pop finishes on a timer and that suite settles with `timerRounds: 0`), so the stop shows up only after `advance(1_000)`. Without it, the stop of one test landed in the next test's transport (a VOD test saw a leaked `synthetic-blog-1` stop).
- A deferred E15 in the recovery test must stay under the 30 s HttpClient timeout, otherwise the recovery ends in the error state instead of «Стрим завершён».
- Guard checks were mutation-tested by hand: removing the generation check in the stop makes «An account reset while watching» fail (a token-less stop goes out after the reset), and removing the demo E16 branch makes the demo test fail.

### Verification

Lint (`--max-warnings 0`), typecheck, `check:fixtures` (29 clean): pass. `npm test` ×3: 113 suites, 2487 passed each. `playerFlow` + `demoFlow` + `authorFlow` + `src/shared/entities/stream` ×30 (352 tests per run): 0 failed runs. No device build or run.

### Not done / risks

- No real E16 was sent to Boosty and nothing was run on the device (no subscribed blog was live; a device E16 needs the owner's approval). The request shape, status and body are `REF` only.
- Whether Boosty expects a body, a specific content type, or counts the first heartbeat at 0 s instead of 30 s is unverified; we follow the reference interval and spec decisions.

## Review Triage Log

- **Patched** — `useLiveHeartbeat` sendStop: the stop now waits for a heartbeat in flight (chained on its promise; fire-and-forget after unmount). Test: «The stop waits for a heartbeat still in flight».
- **Patched** — failure handling: after `Unauthorized` (`SessionExpired` or status 401) or `RateLimited` the interval is cleared for this playback; the stop is still sent after `RateLimited`, not after `Unauthorized`. Tests: «Unauthorized (a 401 …)» (with a working refresh, so the 401 surfaces as `Client`/401 and only one refresh is made), «Rate limited (429) …» (a pause/play does not restart it). Note: the app has no `Unauthorized` kind; a renewal that rejects with another kind is not halted (recorded in Decisions).
- **Patched** — log and generation: the warning carries `kind`; a tick that sees a bumped generation clears the interval. The account-reset test now asserts `clearInterval` was called with the heartbeat interval's id while the Player stays mounted.
- **Patched** — missing playerFlow tests: (a) the in-flight guard (a `hang` reply across the 60 s tick → skipped; the request ends at its 30 s timeout; the 90 s tick goes out); (b) a failed stop (500 on `stop=true` → `{ stop: true, failures: 1, kind: 'Server' }`, no `unhandledRejection`); (c) exit from the live error state (no tick during `error`, one stop).
- **Patched** — docs: «the first E16 goes out 30 s after watching starts» wording (api-contract, feature-parity LIVE-03); the known limitation (no stop if the process is killed or the app never returns from the background); the reference's first-heartbeat timing recorded as unverified (`LiveStreamComponentModel.kt` not re-read: the reference source is not in this workspace).
- Mutation checks (manual, reverted): removing the in-flight guard, the generation-change `clearInterval`, the stop chaining, or the halt each makes its new test fail.
- Verification after the fixes: `playerFlow` and `demoFlow`, eslint on the edited files, typecheck. Full verification is the coordinator's.
