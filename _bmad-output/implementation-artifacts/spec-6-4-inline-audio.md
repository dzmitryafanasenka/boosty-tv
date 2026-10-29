---
title: 'Story 6.4: Inline audio'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: '1a3f00dd8c1ce9df90e5480f240ad30664afe77d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An `audio_file` block in a post is a placeholder; the post's audio cannot be played on the TV (FR39, POST-06; epics.md Story 6.4).

**Approach:**
- An `audio_file` block becomes an **AudioBlock**: one focus stop that shows the title, `position / duration` and a thin progress bar. It is exported from `features/player/index.ts` and used through the allowed post → player edge.
- OK plays or pauses. ← / → seek 10 s while the block is focused.
- The source is `url + signedQuery`, taken from a fresh E8 when playback starts and kept in memory only. It plays through `PlayerEngine` in a view that is not visible.
- The block claims the app-wide `PlaybackArbiter` slot, so starting a video or another track stops the current one.
- Leaving the post (unmount), the app going to the background or sleep, and a loss of audio focus pause or stop the audio. It never resumes by itself.
- The audio position is never persisted. This is parity with the reference.

**Decisions:**
- One playback at a time, as in the reference's single global player. A second AudioBlock taking the slot stops the first (it pauses and keeps its shown position).
- An engine error re-resolves the source once through a fresh E8 (same block id, else the same index and title, as the 6.3 file target) and resumes from the last position. A second error shows «Не удалось воспроизвести» on the block, with OK to retry.
- An empty `signedQuery` means the source is unavailable (6.3 rule): the block shows the error and never plays a bare URL.
- No Boosty `Authorization` header is sent to the media host. No signed URL appears in logs, the cache or the UI.
- ← / → on a focused AudioBlock seek and do not move focus. To reach the sidebar, focus first moves ↑ or ↓ to another element (documented in focus-map).
- Before relying on it, verify live on the sample post (Илья MJTV Соколов, «Когда метроном - твой враг!"), on a debug build with a counts, types and statuses only probe that is removed before the commit:
  - the `audio_file` keys, and whether a duration is present;
  - the HTTP status and content type of `url + signedQuery` (HEAD), and of the bare `url`.

  Record «Audio blocks (LIVE)» in `docs/api-contract.md`. If the source does not play, stop and report.

## Boundaries & Constraints

**Always:**
- Keys come from `queryKeys`, and E8 goes through `PostRepository`.
- Focus moves only by explicit targets. Initial focus is unchanged.
- The Player's own behaviour is unchanged, apart from the arbiter stopping the audio.
- Copy goes in `ru`; tokens come from `shared/ui`.
- The release build is checked on the pinned device.

**Never:**
- Background playback (audio stops when the app leaves the foreground).
- Progress persistence for audio.
- A visible video surface.
- Autoplay.
- An audio queue or playlist.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Render | `audio_file` with title and duration | AudioBlock: title, `0:00 / 3:12`, empty bar; one focus stop | no duration → `0:00 / –:––` until loaded |
| Play | OK | fresh E8 → plays; position and bar advance; focus stays | E8 failure / empty query → «Не удалось воспроизвести» |
| Pause | OK while playing | pauses, position kept | — |
| Seek | → / ← while focused | ±10 s, clamped to 0…duration | — |
| Arbiter | audio plays, OK on «Смотреть» or another AudioBlock | first audio pauses | — |
| Leave | audio plays, Back from the post | audio stops; nothing persisted | — |
| Background | audio plays, Home / sleep / audio focus lost | pauses; no auto-resume on return | — |
| Engine error | playback error | one re-resolve via E8, resume at position | second error → message, OK retries |

</frozen-after-approval>

## Code Map

- `src/shared/entities/post/postRepository.ts` -- add `audioSource(http, blogUrl, postId, key, {title}) → {kind:'ok'; uri} | {kind:'unavailable'|'locked'}`, sharing the raw-block lookup (`rawFileBlock` pattern, generalised to `audio_file`) and the empty-query rule of `fileTarget`. Read `url` beside the mapper; never put it in the domain.
- `src/shared/api/dto/post.ts` -- the raw `audio_file` URL schema (`url`, `title`, `id`), as `fileUrlDtoSchema`.
- `src/shared/entities/post/postBody.ts` -- an `{kind:'audio'; key; title; durationSec}` item when the block is accessible and the `qr`/body option is on (not in a locked teaser); `isFocusStop` includes it.
- New `src/features/player/AudioBlock.tsx` (+ export in `features/player/index.ts`) -- a FocusableSurface stop with the title, the time text and a 2 dp bar on `shared/ui` tokens. It renders a 0×0 `PlayerEngineView` (`format:'progressive'`) only while a source is resolved.
  - `paused` follows the state.
  - `onProgress` updates the position.
  - `onAudioFocusLost` and the `AppLifecycle` background → pause.
  - On mount it subscribes to `playbackArbiter` when playing; on unmount it releases the slot and drops the source.
  - ← / → use the existing `SeekKeys` subscription (`src/shared/platform/seekKeys.ts`) only while the block has focus.
- `src/features/post/PostBody.tsx` -- render AudioBlock for `audio` items, with a resolver from `usePost` (`useAudioSource`, mirroring `useFileTarget`).
- `src/features/player/PlayerScreen.tsx` -- check that it already claims the arbiter (Story 4.1); no other change.
- `src/shared/i18n/ru.ts` -- `audio.*` (play / pause a11y, «Не удалось воспроизвести», duration placeholder).
- `src/app/dev/demo.ts` -- a demo audio block (a local or synthetic source the demo transport answers).
- Fixtures: a sanitized `audio_file` block in `e8-post-accessible.json` (synthetic, marked).
- Tests: `postRepository.test.ts` (`audioSource`), `postBody.test.ts`, a new `src/features/player/__tests__/AudioBlock.test.tsx` (play, pause, seek, the arbiter, unmount release, background pause, the error and re-resolve), and `__tests__/postFlow.test.tsx` «Story 6.4» (focus stop, OK → engine mounted with the resolved source, Back stops).

## Tasks & Acceptance

**Execution:**
- [x] Live check on the sample post (probe removed); `docs/api-contract.md`.
- [x] Repository `audioSource`, DTO, builder item; AudioBlock; PostBody wiring; copy; demo.
- [x] Tests for every matrix row; docs: feature-parity POST-06, focus-map F (AudioBlock, ← / → rule), testing.md Story 6.4.
- [x] Device (release-like, adb, owner's session): the sample post plays, pauses, seeks; Back stops; Home pauses; «Смотреть» on a video post stops audio (screenshot before every OK; no player left running over 10 s). The «Смотреть» row was not reachable on the device (see Implementation Notes).

**Acceptance Criteria:**
- Given the suite, when run 3×, then everything passes; the touched suites pass 30/30; lint `--max-warnings 0`, typecheck and `check:fixtures` are clean.

## Implementation Notes

- Live (2026-10-29, debug probe `TEMP64`, removed): one `audio_file` block (the sample post), `duration` present; `url` alone 403, `url + signedQuery` HEAD 200 `audio/mpeg`, range GET 206. The source plays (release-like build). `audio_file` also carries `timeCode`; it is never read or written.
- `PostRepository.audioSource` and `fileTarget` share `signedBlockUrl` / `rawSignedBlock` (by `<type>:<id>`, else `<type>@<index>` with the shown title).
- The AudioBlock holds the arbiter slot from the play press until it drops its source; a stop from another holder drops the source (the engine unmounts) and keeps the shown position; the next OK sends a fresh E8 and seeks there.
- Device task: the «Смотреть» stop was not run on the device (unreachable from the UI, see below); the route-blur pause through Пост is pinned by a `postFlow` link-chip test, the arbiter path by `AudioBlock.test.tsx`.
- Review follow-ups: an engine error while paused re-resolves paused; the recovery budget returns after a successful load; no forward seek while the duration is unknown, the start clamped to the loaded duration, the end clears a pending seek; a locked E8 shows «Нет доступа к аудио»; a synchronous in-flight guard (one E8 per two quick OKs); signed targets (audio and file) require `https:`; the AudioBlock only with `phaseFlags.player` on. Keep awake: react-native-video's `KEEP_SCREEN_ON` holds the screen while the engine is mounted (also while paused with the source kept).
- Route blur: `PostScreen` passes `active` (from `useFocusEffect`) so a covered Пост pauses its audio (the Player, a pushed Пост). This also makes «Смотреть» pause the audio before the Player claims the slot, so the device cannot reach the arbiter path from the UI; it is host-tested.
- Device fix: the last block's focus ring was cut by the column's bottom edge; the stop got 6 dp vertical padding on its focusable view and no focus scale (as the ImageStop).
- Not ported from the reference: its own «becoming noisy» pause (react-native-video's handling only); not tested.

## Spec Change Log

## Review Triage Log

Iteration 0 (layers: blind-hunter 13, edge-case-hunter 10, verification-gap 2 gaps + 2 other).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | vgap, blind, edge | The engine-error recovery resumes a paused track by itself, also in the background; an OK pause never sets `startPaused` | high | patch | `resolveAndPlay` resets `startPaused` and starts with `paused = !active`; breaks «never resumes by itself» and «no background playback». |
| 2 | edge | `recoveryUsed` is never reset after a successful recovery | low | patch | A later transient error skips the re-resolve. |
| 3 | blind, edge | Seeks past the end with an unknown duration; `onLoad` does not clamp the start; `onEnd` leaves `pendingSeek` | low | patch | `Infinity` upper clamp; the shown time can freeze. |
| 4 | blind, edge | `locked` shows the generic error with a useless retry | low | patch | «Нет доступа к аудио», as the 6.3 file chip. |
| 5 | edge | Two quick OKs can start two E8 resolves | low | patch | Status ref set synchronously. |
| 6 | edge | A signed target over `http:` leaks `signedQuery` in cleartext | medium | patch | `safeHttpUrl` accepts `http:`; signed targets now need `https:` (audio and file). |
| 7 | blind | Audio plays when the player phase flag is off | low | patch | Gated like `onPlayAt`. |
| 8 | vgap | The route-blur pause through PostScreen is untested (Пост over Пост) | medium | patch | No flow test pushes a Пост while audio plays. |
| 9 | blind | No wakelock: the screensaver may stop long tracks (POST-06 confirmed parity) | maybe-false | patch (device check) | react-native-video may keep the screen on while playing; checked on the device, fixed if not. |
| 10 | vgap | `testing.md` overstates the flow coverage of the arbiter path | low | patch (doc) | Reworded. |
| 11 | blind | Audio nested in a `list` is undocumented | low | patch (doc) | It stays a placeholder; stated. |
| 12 | blind | The device task reads done though «Смотреть» was not run | low | patch (doc) | Implementation Notes say so. |
| 13 | blind | Index keys can drift if the mapper drops a block | low | reject | The title check guards the id-less path; live audio has an id. |
| 14 | blind | The accessibility label changes every second; the error is announced twice | low | reject | Not re-announced unless focused; TalkBack is unverified and listed. |
| 15 | blind | Progress before the first load is not filtered | low | reject | A one-frame flicker at most; not seen on the device. |
| 16 | blind | The 23 h refresh test does not check the position | low | reject | The seek-back path is the same as the recovery test's. |
| 17 | blind | No Home → return test with a covered Пост | low | reject | Both pause sources are unit-tested; the combination keeps `paused` true. |
| 18 | blind | Status files disagree | false | reject | Statuses move at finalize. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean.
- `npm test` ×3 -- expected: all pass.

**Result (after the review patches, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 2156 passed each; `postFlow` + `demoFlow` + `playerFlow` + `src/features/{player,post}` + `src/shared/entities` ×30: 746 passed each run, 0 failed runs. Device (rebuilt after the patches): keep-screen-on held while audio plays and released after Back.
