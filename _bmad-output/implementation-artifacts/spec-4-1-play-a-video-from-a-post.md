---
title: 'Story 4.1: Play a video from a post'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: 'b9f2715b89a098af76f40f767541d840bd17a908'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A post's videos are inert rows (`phaseFlags.player` off); the family cannot watch anything (FR42, FR45, UX-DR14; epics.md Story 4.1).

**Approach:** Turn the player on: OK on a MediaRow (and the primary «Смотреть» under the header) opens a full-screen Player route `{ref: MediaRef, origin: {routeKey, focusId}}`. `MediaResolver` re-reads the post via a fresh E8 (content profile) and picks the source (preferred quality — none stored before 4.3 — else HLS, else DASH, else the highest progressive). Playback goes through a `PlayerEngine` port backed by `react-native-video` 6.19.3; a `PlaybackArbiter` holds the one playback slot. Overlay with author, titles, timeline and elapsed/remaining; remote seeking, play/pause, auto-hide, buffering spinner, Back order overlay → exit, focus back to the origin element.

**Decisions:**
- Seek acceleration on the pinned remote: D-pad arrives as key up only (Story 1.6), so «hold to accelerate» is measured on the device first; if no repeat events arrive, acceleration applies to quick repeated presses instead (each press within the 600 ms bubble window grows the step: 5, 5, 10, 10, 20, 30 s…). The bubble shows the pending target and commits 600 ms after the last press; presses during an in-flight seek build on the pending target.
- No «Настройки» control, Menu key or sheet in 4.1 (Story 4.3); no progress writes, resume or «Продолжить» (Story 4.2); a start failure shows «Не удалось воспроизвести видео» with «Повторить» (re-resolve once via E8) and «Назад» (full recovery is Story 4.4); a post that turns out locked on the fresh E8 shows «Нет доступа к этому видео» with «Назад».
- Owner feedback after the device run (2026-10-27): picture and sound OK; hold-to-accelerate does not work on the physical remote (no key repeat) — acceleration stays on quick repeated presses; **hold-to-seek must work (the AC): JS gets D-pad left/right only as key up, so a small native key listener in `MainActivity` (no new dependency) forwards ←/→ key down + key repeat + key up to the player while it is the focused route; holding seeks with a growing step and a live bubble, the release commits; quick repeated presses keep working; verify on the device that repeat events arrive (if the pinned remote sends none even natively, report it and keep the press acceleration)**; **OK while a seek is pending commits the pending target at once and keeps playing (no pause toggle)** — OK toggles play/pause only when no seek is pending; **the player controls sit centered at the bottom** (the play/pause control centered under the timeline); **a generic video title (e.g. «Video», «Видео», «Видео N», case-insensitive, or one equal to the post title) is not shown** in the overlay; **the seek bubble's time never wraps** (one line at any length, e.g. «1:11:21»).
- «Смотреть» placement (owner decision 2026-10-27, option A): a button row right under the header (after date · likes), before the MediaRows; for a multi-video post the label names the target video («Смотреть · Видео 1»); in 4.1 it opens the first video. Initial focus of an accessible post with video: «Смотреть»; ↓ → the rows, ↑ → the author. Id `post/<postId>/primary`.
- The Player has no sidebar (it does not use `StackSidebarRoute`); its own Back handling.
- Owner decisions 2026-10-27 (device check, after hold-to-seek worked): **the accent fill follows the seek target like the thumb** while a target is pending or in flight (YouTube-style), then shows the real position; **after a hold (a key down with `repeatCount ≥ 1`) the release does not commit** — the target stays pending (bubble and thumb there, playback continues, no auto-hide): OK (surface, timeline, play/pause) and the Play/Pause media keys commit it; Back cancels it (overlay stays; the next Back follows the normal order); 5 s without input cancels it (bubble gone, thumb and fill back at the position); further ← → presses or holds build on it and restart the 5 s; cancelling never calls `engine.seek`; quick presses without a hold keep the 600 ms auto-commit. Frame preview while seeking is not part of 4.1.
- Owner decision 2026-10-27 (device check): **a hold-scrub pauses playback**, like YouTube on Android TV. When a hold starts (the first key repeat) the engine pauses if it was playing; OK or a Play/Pause key commits the target and resumes only if it was playing before the hold (paused before → stays paused); Back and the 5 s idle cancel without a seek and resume the same way (same position as before the hold). While the scrub is pending, play/pause shows the paused state and the overlay never auto-hides. Quick presses without a hold never pause (600 ms auto-commit unchanged); a hold that starts during a quick-press target becomes a held scrub the same way. No progress is written for these pauses.
- Owner decision 2026-10-27: **the frame preview while scrubbing is a separate later task**, not Story 4.1. Accepted thresholds: preview frame p95 ≤ 500 ms, zero decoder errors on the main player (`docs/research/seek-preview-thumbnails.md`).

## Boundaries & Constraints

**Always:**
- Route params ids only (AD-9, AD-17); signed URLs, `signedQuery`, `timeCode` live only in memory inside the player feature — never in routes, storage, query keys, logs or fixtures. Extend the one E8 DTO/repository to expose sources to `MediaResolver` (player-only type); the `Post` entity stays without `playerUrls`.
- No `Authorization` or Boosty headers to CDN hosts; the player sends only its own UA. Verify with a debug-only network log that prints host + whether an `Authorization` header is present (no URLs, no queries), Android debug source set only, absent from release.
- `PlayerEngine` port in `shared/platform` (integer seconds across the port); features never import `react-native-video`. `react-native-video` pinned exactly at 6.19.3; record the version in `docs/testing.md`; adaptive selection capped to the device (no 1440p AVC High on the pinned device).
- Remote: `useTVEventHandler` raw keys, the first key up right after focus lands on the player is ignored; ←/→ seek (5 s); OK and Play/Pause toggle; FF/Next forward, Rew/Prev/Step-back back; Stop exits. Overlay shows on OK/arrows/pause/media keys; hides after 5 s only while playing (never paused, seeking or on error). Spinner after 500 ms buffering. Back: overlay visible → hide it; else exit → focus on the origin element (`FocusRestoration` / `setReturnFocus`). Unmount releases the engine and the arbiter slot.
- Copy and a11y labels from `ru`; tokens from `shared/ui/tokens.ts` (player overlay per DESIGN.md).

**Never:** No progress/E9, no quality sheet, no autoplay of the next video, no comments, no custom playback engine, no audio playback.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open from a row | OK on `post/<id>/video/<mid>` | Player route; fresh E8; HLS chosen when present; plays | — |
| Source order | only DASH + 720p/1080p progressive | DASH | — |
| Progressive only | 360p, 720p, 1080p | 1080p (within the device cap) | — |
| No usable URL | all empty/unknown | «Не удалось воспроизвести видео» «Повторить»/«Назад» | Повторить → one fresh E8 |
| Locked on fresh E8 | `hasAccess=false` | «Нет доступа к этому видео» «Назад» | no retry |
| E8 fails | Network/Server | error state «Повторить»/«Назад» | retry E8 |
| Seek | → ×3 quickly | bubble +5, +10, +15 (or the accelerated steps), one commit 600 ms after the last | builds on the pending target |
| OK during a pending seek | → ×3, then OK before 600 ms | the pending target is committed at once; playback continues (no pause) | — |
| Auto-hide | playing, 5 s idle | overlay hides | not while paused/seeking/error |
| Back | overlay shown / hidden | hide overlay / exit → origin focus | — |
| Buffering | > 500 ms | spinner | — |
| Arbiter | another playback holds the slot | it is stopped when the player starts | — |
| CDN headers | debug network log | no `Authorization` on CDN hosts | — |

</frozen-after-approval>

## Code Map

- `src/app/phaseFlags.ts` (`player: false` → true); `src/app/routes.ts` (`Player: { ref: MediaRef; origin: { routeKey: string; focusId: string } }`); `src/app/stackRoutes.tsx`/`App.tsx` (register `PlayerRoute` in the shared `Screen` wrapper, no sidebar; `onOpenPlayer` from PostRoute).
- `src/features/post/PostScreen.tsx`, `PostBody.tsx`, `src/shared/ui/MediaRow.tsx` (`playable` → `onPress`, button role), primary «Смотреть» row under the header; ids `post/<postId>/primary`.
- `src/shared/entities/post/postRepository.ts` (`post()` E8) + `src/shared/api/dto/post.ts` — expose `ok_video.playerUrls` to a player-only source type; mapping table per api-contract §6.
- `src/features/player/` (new): `PlayerScreen`, `MediaResolver` (`useMediaSource(ref)` via TanStack Query with a key that holds ids only, `gcTime` short, never persisted), overlay, timeline/bubble, seek controller, key handling.
- `src/shared/platform/` (new): `PlayerEngine` port + Android adapter over `react-native-video`; `PlaybackArbiter` (`src/shared/platform` or `src/shared/playback`).
- `android/app/src/debug/…` -- debug-only OkHttp interceptor (host + `Authorization` present yes/no), as the Story 1.6 spike did (`spike/1-6-playback` branch for reference).
- `src/shared/i18n/ru.ts` -- `player.*`.
- Tests: `__tests__/playerFlow.test.tsx` (mock the engine port), resolver/source-order unit tests with the sanitized E8 fixtures (`e8-post-accessible.json`), seek controller unit tests (fake timers).
- Docs: `docs/focus-map.md` §4 G notes, `docs/testing.md` Story 4.1 (react-native-video pin, key-repeat measurement, CDN header log), `docs/api-contract.md` §6 if anything new is seen.

## Tasks & Acceptance

**Execution:**
- [x] Dependency: `react-native-video@6.19.3` exact; native build; release bundle check.
- [x] `PlayerEngine` port + adapter, `PlaybackArbiter`.
- [x] E8 source exposure + `MediaResolver` (+ unit tests: source order, empty/unknown, locked).
- [x] Player route, screen, overlay, seek controller, keys, auto-hide, spinner, Back, origin focus.
- [x] Post: player flag on, MediaRow OK, primary «Смотреть» under the header.
- [x] Debug network interceptor.
- [x] Tests: every matrix row; player flow with the engine mocked.
- [x] Docs.
- [ ] Device (release-like, owner's session): play from a one-video and a two-video post, seek, pause, auto-hide, Back order, origin focus; measure key repeat on hold; debug build: CDN header log; screenshot of the Post with «Смотреть» shown to the owner before the review loop (retro A10).

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new/changed flow tests 30/30; lint, typecheck, check:fixtures clean; release bundle without debug-only code.

## Orchestrator Notes

- Final verification (2026-10-27, after the review fixes and the owner's device-check decisions: hold-to-seek via the native key listener, thumb and fill follow the target, hold commits on OK / cancels on Back or 5 s idle, hold-scrub pauses, no pressed scale on the timeline): lint `--max-warnings 0`, typecheck, check:fixtures clean; `npm test` ×3: 78 suites / 1388 tests passed each run; `playerFlow` + `postFlow` 30× together: 0 failed runs.
- Device: the owner confirmed on the pinned Chromecast with the physical remote that everything works (hold-to-seek, OK commit, cancel, pause while scrubbing, no timeline press effect). Agent adb smoke on the release-like build matched.
- The research `docs/research/seek-preview-thumbnails.md` found no Boosty/OK scrub thumbnails; the frame preview is a separate backlog spike (owner decision, `deferred-work.md`). During the research a public free post's HLS variant signature and the Mac's IP reached the session transcript (path-segment signature); nothing was written to files or git; the redaction rule is recorded in the research doc.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Hold-to-seek (owner decision, the AC) not implemented: JS gets key up only (edge) | high | patch: native key listener in `MainActivity` |
| 2 | A late `onSeek` of an earlier seek clears the newer in-flight target; next press builds on a stale position (blind, edge) | medium | patch: match the report to the in-flight target |
| 3 | Reopen within `gcTime` plays the cached signed URL, then restarts when the fresh E8 lands; «fresh E8 on every mount» unpinned (blind, edge, verification-gap) | medium | patch: ignore pre-mount data; test |
| 4 | Player exit overwrites the Post's remembered scroll offset with 0 (blind, edge) | medium | patch: keep `peek`'s offset/index; also remember on any removal |
| 5 | After the end, play/OK shows playing but the ended engine never restarts (blind, edge) | medium | patch: seek to 0 then play |
| 6 | Seeking before the duration is known is unbounded (edge) | low | patch: ignore seeks until the duration is known |
| 7 | A retry whose fresh E8 fails shows generic copy (error kind swallowed with data present) (edge) | low | patch |
| 8 | `hasAccess: true` + empty `data` is «Видео недоступно», api-contract §7 says locked (edge) | low | patch: locked |
| 9 | Entry guard not applied to OK on the surface (blind) | low | patch |
| 10 | Play/Pause media keys «play»/«pause» don't commit a pending seek (blind) | low | patch |
| 11 | No adapter test (1080p cap, type hint, seek rounding) (verification-gap) | medium | patch: `PlayerEngineView.test.tsx` |
| 12 | No double-OK test for opening the Player; no player-on refetch test for a vanished «Смотреть» (verification-gap) | low | patch: tests |
| 13 | Debug net log omits Cookie (blind) | low | patch: `cookie=yes/no` |
| 14 | `setReturnFocus` does not work for the Post (peek) — Story 4.5 «Ended» relies on it (blind) | medium | defer: entry for 4.5 |
| 15 | Locked on the player's fresh E8 is not re-validated with E1 (an expired token looks locked) (blind) | medium | defer: with A6 / the session pass before 4.2 |
| 16 | No cap before `onLoad`; all variants > 1080p → no cap (blind, edge) | low | defer (existing entry; add the all-above case) |
| 17 | One unexplained 1322/1322 run (blind, verification-gap) | maybe-false | 5 orchestrator runs: 77 suites / 1351 tests each; recorded |
| 18 | Step-back listed in the spec though Android does not deliver it to JS (blind) | low | recorded in focus-map (deviation) |
| 19 | Unverified-on-device items not all in deferred-work; status mismatch; focus-map typo (blind) | low | patch docs; statuses move at completion |
| 20 | `onError` code filtering has no consumer (verification-gap) | low | rejected: harmless; covered when a story logs codes |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `playerFlow` and `postFlow` 30×.
