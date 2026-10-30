---
title: 'Story 7.2: Watch a live stream'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'abec3c8bfdc644e75653c6c04e42b1ad8f2be1d2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-7-1-live-stream-card-on-the-author-page.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The family can see an author's live stream on the Author page (Story 7.1), but OK on the LiveCard does nothing (LIVE-02, FR22).

**Approach:**
- OK on a live card that has `hasAccess` and playable `ok_stream` URLs opens the Player with `LiveRef {blogUrl}`. The resolver reads E15 and keeps only live-edge URLs.
- The live overlay is honest: a LIVE badge and the time elapsed since the start, no timeline, no ±10, no speed. Pause is allowed, and play returns to the live edge.
- When the engine reports the end, the player shows «Стрим завершён» with focus on «Назад». Exiting invalidates `['stream', blogUrl]`.
- Any other card (scheduled, no access, no URLs) shows a QR to the stream page instead.
- No progress is ever written for live.

**Owner decision (2026-10-30), quality:** the gear stays for live only when there is a real choice. The live candidates go through the existing quality-list rules (docs: «Правила выбора качества видео»). The gear and sheet are shown only when the list has more than one entry. A single adaptive «Авто» means no gear. A pick switches the source at the live edge, not at a saved position.

## Boundaries & Constraints

**Always:**
- Signed live URLs go to the engine only. No Boosty `Authorization` reaches the CDN (the existing API-host-only profile rule). They are never persisted, never in route params, never logged.
- The `Stream` entity stays URL-free. Live sources come from a player-only parser.
- Keep the shared Player pieces: the PlaybackArbiter claim, the lifecycle pause (sleep, background, audio focus), one automatic recovery (re-fetch E15), and the Back order (sheet → overlay → exit).
- Author reaches the Player only through an `onOpenLive` callback from `src/app/stackRoutes.tsx`, with no new feature edge. `LiveRef` lives in `shared/entities/stream`.

**Never:**
- No heartbeat (Story 7.3), no like or share (Story 7.4), no progress write, and no change to VOD sources, `MediaRef`, the post Player paths or Story 4.5's ended auto-exit for posts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open live | Live card, `hasAccess`, `ok_stream` with a `live_hls`/`live_dash` URL | OK → Player (`LiveRef`), plays the live-edge URL | — |
| URL filter | `playerUrls` with `live_playback_*`, empty URLs, VOD types | Only non-empty `live_*` URLs (not `live_playback_*`) are candidates; HLS is preferred | none left → the QR row |
| Not playable | Card scheduled, or `hasAccess: false`, or no candidate URL (on the card or at resolve time) | OK → QrDialog with `https://boosty.to/{blog}/streams/video_stream`; closing it returns focus to the card | — |
| Overlay | Playing | LIVE badge, elapsed `now − startTime` (h:mm:ss, ticking), title and author, play/pause | missing `startTime` → no elapsed |
| Pause / play | Pause, then play | The engine pauses; play seeks to the live edge (or remounts the source) | — |
| ← → keys | Overlay shown | They move between controls only, no seek | — |
| Quality | The live candidates give more than one quality entry | The gear opens the quality sheet; a pick replays the chosen source at the live edge | one entry → no gear |
| Ended | The engine reports the end | «Стрим завершён» state, focus on «Назад»; no auto-exit, no restart | — |
| Exit | Back or «Назад» | Player closes; `['stream', blogUrl]` is invalidated; focus returns to the card if it is still shown, else to the first post | — |
| Engine error | First error | One automatic re-fetch of E15 and replay at the edge; a second error → the error state with «Назад» | — |
| Stream gone at resolve | E15 204, or not live, at Player open | The «Стрим завершён» state | — |
| Progress | Any live playback | No ProgressRepository call (no tick, pause, exit or forget) | — |

</frozen-after-approval>

## Code Map

- `src/shared/entities/post/types.ts:160-169` -- `MediaRef`; unchanged. Add `LiveRef {kind: 'live', blogUrl}` in `src/shared/entities/stream/types.ts`.
- `src/app/routes.ts:34-49` -- `Player.ref: MediaRef | LiveRef`; `start` stays VOD-only.
- `src/app/stackRoutes.tsx`:
  - `AuthorRoute` (255-297): add `onOpenLive(blogUrl, focusId)`, which pushes the Player behind a `navigation.isFocused()` guard.
  - `PlayerRoute` (390-469): for live, skip the post `onNoAccess` and `onEnded`. `beforeRemove` keeps `remember(...)` and also invalidates `queryKeys.stream(blogUrl)`.
- `src/features/player/mediaResolver.ts:226-358` -- `useMediaSource`: add a live branch (or a sibling hook) with the same state union. It has its own query key, and its queryFn is E15 through a new `StreamRepository.liveSources` returning `{kind: 'ok', stream, sources} | {kind: 'none'}`. Copy `refetchOnMount: 'always'` and `isFetchedAfterMount`. `pickSource` (83-95) is VOD-only; live gets its own picker.
- `src/shared/entities/post/videoSources.ts:50-80` -- the HLS/DASH type sets (`live_hls`, `live_dash`, `live_playback_*`) to reuse. Put the new `liveSourcesOf(data)` (`ok_stream` only) next to them, or in `entities/stream`.
- `src/shared/api/dto/stream.ts` -- `data[]` is `unknown[]`. Parse the `ok_stream` blocks' `playerUrls` with a lenient schema (as `playerUrlDtoSchema`, `dto/post.ts:245-264`).
- `src/features/player/PlayerScreen.tsx`:
  - live mode = `progress` null (every call site guards it) and no `forget`;
  - `onEnd` (~1087-1101): live → the ended state; reuse the error-state block (~1268-1305, `player/state/<phase>`, `PLAYER_BACK_ID`) with «Стрим завершён»;
  - `togglePause` (~740-750): live play seeks to the edge (or remounts), never to 0;
  - seek keys (`seekBy`/`onSkip`/`subscribeSeekKeys`, ~776-802): off for live;
  - the resume target and `SOURCE_REFRESH_AGE_MS`: off or edge for live;
  - the arbiter (398-406) and lifecycle (598-627): unchanged.
- `src/features/player/PlayerOverlay.tsx` -- a live variant: the LIVE badge (`colors.live`, `author.live.badgeLive`) plus elapsed (`formatDuration`) instead of `Timeline` (107ff) and remaining (342-350); no ±10 (353-371); the gear (373-381) only when the live quality list has more than one entry (owner decision).
- `src/features/author/LiveCard.tsx:106-120`, `AuthorScreen.tsx:564-569` -- `onPress` plus the button role. OK → `onOpenLive` when playable, else the QR (`modal.open(<QrDialog …/>, initiator)` as `PostScreen.tsx:625-633`; `modal` at `AuthorScreen.tsx:161`).
- `src/shared/entities/externalUrls.ts:122` -- `boostyStreamUrl(blogUrl)` (encoded segment, null for an invalid blog).
- `AuthorScreen.tsx:337-361` -- the return branches (7.1 triage BH9): card still shown → the card; card gone → **the first post** (focus-map §4 D). `restoreOrFirst` would restore the remembered live id, so use `latch.auto(ids[0])` / `restoration.focusInitial()` directly. Test both.
- `src/shared/i18n/ru.ts` -- `player.live.*`: «Стрим завершён», the a11y labels, the QR title.
- Tests:
  - `__tests__/playerFlow.test.tsx`: engine mock `src/test/playerEngineMock.tsx`, `fire('onLoad'…)`, `engine.props.onEnd()`;
  - `src/features/player/__tests__/`;
  - `__tests__/authorFlow.test.tsx` «Story 7.1» block (2106), `src/test/authorFixtures.ts:91-105` `e15Stream(kind, overrides)`;
  - `src/test/fixtures/boosty/e15-video-stream-live.json`: add synthetic `playerUrls` (check-fixtures rules: `https://example.invalid/...?sig=REDACTED`);
  - `__tests__/demoFlow.test.tsx:181`, `src/app/dev/demo.ts:496-500`.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/entities/stream/` + `dto/stream.ts` + fixture -- `LiveRef`, `liveSourcesOf`, `StreamRepository.liveSources`; unit tests for every URL-filter row.
- [x] `src/features/player/mediaResolver.ts` -- the live branch; tests: ok, none (204 / not live), no URLs, a failure.
- [x] `src/features/player/PlayerScreen.tsx`, `PlayerOverlay.tsx` -- the live mode per the matrix; overlay unit tests (badge, elapsed ticking, no timeline, no ±10, the gear only with a choice).
- [x] `src/app/routes.ts`, `src/app/stackRoutes.tsx` -- the route union, `onOpenLive`, the live exit invalidation.
- [x] `src/features/author/LiveCard.tsx`, `AuthorScreen.tsx`, `useAuthorLive.ts`, `src/shared/entities/externalUrls.ts` -- OK → play or QR; the return-focus branches.
- [x] `src/shared/i18n/ru.ts` -- the copy.
- [x] `__tests__/playerFlow.test.tsx` «Story 7.2» -- one test per matrix row, including no progress call and no Authorization header on the engine source.
- [x] `__tests__/authorFlow.test.tsx` -- OK on live → Player; scheduled / locked / no URLs → QR, close → card; return from the Player → card, or ended → first post.
- [x] `src/app/dev/demo.ts` + `demoFlow` -- the demo live stream gets a synthetic, unplayable URL, so OK reaches the Player and its error path. No real CDN is called.
- [x] Docs: `docs/api-contract.md` (`ok_stream` mapping `REF`), `docs/feature-parity.md` LIVE-02, `docs/focus-map.md` (D, G live), `docs/testing.md`.

**Acceptance Criteria:**
- Given a live, accessible card with URLs, when OK is pressed, then the Player opens with `LiveRef` and plays only a live-edge URL.
- Given the live player, when the overlay shows, then there is a LIVE badge and elapsed time, with no timeline, ±10 or speed, and play after a pause returns to the live edge.
- Given the engine ends, when the state shows, then «Стрим завершён» has focus on «Назад», and exit invalidates `['stream', blogUrl]`.
- Given any not-playable card, when OK is pressed, then a QR to the stream page is shown.
- Given live playback, when it runs, pauses or exits, then no progress is written.
- Given lint, typecheck, `check:fixtures` and `npm test` ×3, when run, then all are clean; the touched suites pass ×30.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean
- `npm test` ×3 -- expected: all pass
- `playerFlow`, `authorFlow`, `demoFlow`, `src/features/player`, `src/shared/entities/stream` ×30 -- expected: 0 failed runs

**Manual checks:**
- Device (agent over adb): before the device run, re-probe E15 on the subscribed blogs, counts only. If one is live, play it without pressing OK on anything else, then exit; record what was seen.
- Otherwise: on the demo debug build, OK on the card → Player → error/ended path → «Назад»; on the release-like build, a no-stream author is unchanged.
- Report a real live playback as not verified unless it was seen.

## Implementation Notes

- **Entity:** `src/shared/entities/stream/liveSources.ts` (`liveSourcesOf`, `pickLiveSource`, `LIVE_EDGE_TYPES`), `LiveRef` + `isLiveRef` in `types.ts`, `StreamRepository.liveSources` (`{kind: 'ok', stream, sources} | {kind: 'none'}`; none = 204 / empty / malformed / not online), `okStreamSourcesDtoSchema` in `dto/stream.ts`. The `Stream` entity gained only a `hasLiveSources` flag (no URL), which the card uses to decide play vs QR.
- **URL filter reading:** candidates are `live_hls` and `live_dash` only. `live_playback_*` is dropped as specified; `live_ondemand_hls` is dropped too (read as an on-demand copy, not the live edge; unverified, documented in api-contract). HLS before DASH; `ok_stream` blocks only.
- **Resolver:** `useLiveSource` in `mediaResolver.ts` (own key `queryKeys.liveSource`, same freshness rules as `useMediaSource`), mapped to the existing state union: none → `unavailable` (shown as «Стрим завершён»), no access / no candidate → `noSource` (the QR path), else `ready` with `progress: null` and `live: {startTime}`. `useMediaSource` now accepts a null ref (disabled), so `PlayerScreen` calls both hooks unconditionally. The overlay's author comes from the cached E3 (`queryKeys.author`), since E15 has no author; empty if not cached.
- **Player:** live mode = `progress` null + `vodRef` null at every progress call site (no begin, report, resumePoint, forget). New phase `ended` (engine end, or `unavailable` for live) reuses the state block (`player/state/ended`, `PLAYER_BACK_ID`). Play after a pause remounts the engine (`liveEpoch` in the key) instead of seeking. Seek presses, skip, held keys and media seek keys only show the overlay. Overlay focus target is play/pause. The age-based re-resolve (`SOURCE_REFRESH_AGE_MS`) is off for live. Recovery: target = undefined (edge), one E15. A broken live source after its recovery shows «Назад» only; a failed E15 request keeps «Повторить».
- **Quality:** the gear shows only when `qualityOptions(sources).length > 1`. Live candidates are all adaptive, so the list is «Авто» only and the gear never shows as built; the live pick path (`keepQuality` → `useLiveSource`, remount at the edge, no stored preference) exists but is unreachable with the current mapping.
- **Not playable at resolve:** the matrix asks for the QR "at resolve time" too. As built, the player leaves (`onLiveUnplayable`) and sets a one-shot `pendingLiveQr` for the origin route key in `stackRoutes.tsx`; Автор reads it on return (`takeLiveQrRequest`), focuses the card and opens the QR one frame later (so Back closes the QR first: the route's Back listener is added after the child focus effect). Without the card on return, no QR.
- **Return focus:** the 7.1 BH9 branch now uses `latch.auto(ids[0])` + `restoration.focusInitial()` for the remembered card id when the card is gone; when the card is still shown on return, `autoFocusLive`, and a later 204 triggers the existing card-loss rule.
- **Route:** `Player.ref: MediaRef | LiveRef`; `AuthorRoute.onOpenLive` (push behind `navigation.isFocused()`); `PlayerRoute` renders the live player without `onNoAccess`/`onEnded` and invalidates `queryKeys.stream(blogUrl)` in `beforeRemove` (every exit path).
- **Demo:** `demo-blog-1`'s stream has one `live_hls` URL `https://example.invalid/demo-live.m3u8`, so OK reaches the Player and its error path; no CDN call.
- **Tests:** `liveSources.test.ts` (17), `externalUrls.test.ts` «boostyStreamUrl», `liveSource.test.tsx` (8), `PlayerOverlayLive.test.tsx` (6), `LiveCard.test.tsx` (+2), `playerFlow.test.tsx` «Story 7.2» (16), `authorFlow.test.tsx` «Story 7.2» (9; the 7.1 «OK inert» test removed), `demoFlow.test.tsx` (+1).
- **Checks run:** lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 113 suites, 2468 passed each; touched suites (`playerFlow`, `authorFlow`, `demoFlow`, `src/features/player`, `src/features/author`, `src/shared/entities/stream`; 465 tests per run) ×30: 0 failed runs.
- **Device (2026-10-30, pinned Chromecast, agent over adb, screenshot of the focused element before every OK):** E15 re-probe (temporary counts-only `TEMP72` `__DEV__` probe, removed): 3 subscribed blogs, 3 × 204, so no real stream was opened. Seen on the demo debug build (local `DEMO_MODE = true`, reverted): card → OK → Player → recovery → «Не удалось воспроизвести эфир» with «Назад» focused → «Назад» → focus back on the card; with a second local, reverted edit (no demo `playerUrls`): OK → QR «Эфир на Boosty» → «Закрыть» / Back → the card. Seen on the release-like build: a real no-stream author unchanged (no card, focus on the first post, ↑ field, Back → tile). **Not seen on the device:** a real live playback, the live overlay, pause / play at the edge, «Стрим завершён», the exit invalidation and the QR at resolve time (host-tested only). `DEMO_MODE` is `false` and the release bundle has `TEMP72` 0 and `createDemoSessionManager` 0.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter, Edge Case Hunter, Verification Gap):

- **The unplayable-at-resolve leave can hang on the spinner** (BH2, EC1, EC2). **Medium.** The effect bails when the route is inactive and never re-runs on focus; `onLiveUnplayable` also bails when not focused. Patch: run on focus, plus a test.
- **BH6. Live URLs reach the engine after only a non-empty check.** **Medium:** the shape is reference-only. Patch: http(s) only, plus tests.
- **BH1. Fixture live URLs lack `?sig=REDACTED`, so the leak checks are vacuous.** **Low**, direct. Patch.
- **EC6. `latch.move()` runs before knowing whether OK acts.** **Low**, direct reorder. Patch.
- **VG1. The live error bodies are not asserted.** **Low**, gap pre-verified. Patch.
- **BH12. Elapsed uses the device clock, undocumented.** **Low.** Patch: a doc line.
- **BH4 / EC5. Play after a long pause or sleep reuses a possibly expired signed URL.** **Maybe-false**, medium if true: the live URL lifetime was never observed. Deferred (`deferred-work.md`).
- **BH3 / EC3. The QR request is dropped when the card is gone on return, and it is held in a module global.** **Low, rejected.** The card is gone only if the stream ended between the resolve and the return (then «Стрим завершён» semantics apply), and the global is keyed by route and cleared on take or unmount.
- **EC4. Closing the QR after a refetch removed the card returns focus to a detached ref.** **Low, rejected.** It needs the exit refetch to drop the card while the QR is open; ModalHost falls back to the screen's focus.
- **BH5 / EC7 / VG other. The live quality pick and `keep` are unreachable** (every live candidate is «Авто»), and recovery never falls back to DASH. **Low, rejected:** this is the owner's rule («gear only with a real choice»). The code becomes reachable if live heights appear. Reported to the owner.
- **BH7. The overlay author is read once from the cache and is empty when uncached.** **Low, rejected.** The Player is always opened from the Author page, whose E3 is cached.
- **BH8. Status mismatch and an empty change log.** **False / rejected.** `review` is set at finalize; a change-log entry would edit the spec.
- **BH9. Cross-feature i18n keys.** **Low, rejected:** cosmetic.
- **BH10. `isLiveRef` uses `'kind' in ref`; PlayerRoute duplicates JSX.** **Low, rejected.** `MediaRef` has no `kind`, and the two branches differ in their props by design.
- **BH11. The ended state reuses error-state ids.** **Low, rejected.** The ids are documented in focus-map G11 as built.
