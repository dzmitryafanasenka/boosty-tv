# Epic 4 Context: Watch and resume (P1)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The family presses «Смотреть»/«Продолжить» on a post (or a «Продолжить просмотр» card) and watches the video full screen with the remote: seeking, quality choice, and resume where anyone in the family stopped (local position first, else the server `timeCode`). Playback recovers once by itself from expired signed URLs and player errors, survives sleep/background paused in place, marks finished videos, and feeds the Home «Продолжить просмотр» row. This closes the P1 vertical slice (sign in → feed → post → video → resume → return with restored focus); it is not a feature-complete release. Target platform is Android TV / Google TV only. Story 4.1 is done (player route, engine port, resolver, overlay, hold-to-seek); the SessionManager robustness pass and the "validate the session before showing all-locked content" fix (Epic 3 retro A6) have landed, so Story 4.2 is unblocked. Where newer long-term docs or owner decisions differ from the epics text, the newer source wins: `docs/api-contract.md`, `docs/focus-map.md` (Пост, Плеер), `docs/testing.md`, ADRs 0004, 0007, 0008, 0009, 0012, and `deferred-work.md`.

## Stories

- Story 4.1: Play a video from a post
- Story 4.2: Progress is saved and playback resumes
- Story 4.3: Choose video quality
- Story 4.4: Recover from expired links and playback errors
- Story 4.5: Finishing a video
- Story 4.6: Sleep, background and audio focus
- Story 4.7: Continue-watching row on the Home screen

## Requirements & Constraints

- **Sources come from a fresh E8 on the content profile** (ADR 0008): CDN signatures are bound to the fetching client; only the mobile Android profile yields playable URLs (the web profile gets HTTP 400). Never send `Authorization` or Boosty headers to CDN hosts.
- **Quality mapping:** map `playerUrls[].type` per the api-contract table; skip empty/unknown. Order: preferred quality, else HLS, else DASH, else the highest progressive. Show only existing variants; HLS/DASH = one «Авто» row, resolution suffix only if the engine reports it. Adaptive selection is capped to 1080p via declared bitrates (no cap before `onLoad` — known gap).
- **Signed URLs:** 24 h lifetime; the CDN response after a real expiry is still unverified, so treat any player HTTP/decoder error as "re-resolve once via E8" (same media id and type, else HLS/nearest fallback), seek to the last position, then «Повторить/Назад». URLs live in memory only — never in routes, storage, query keys, logs or fixtures.
- **E9 progress:** `PUT /v1/viewstat/video/{id}/timecode/`, form `time_code`, integer seconds, HTTP 200, round-trips to the next E8 `timeCode`. Write every ≥ 10 s of movement and on pause, background, Stop/exit, end. Never write a new source's pre-seek `t=0`. Serialize writes or drop completions older than the newest sent; re-send only the latest position; never rely on a background/exit write completing. No writes for hold-scrub pauses. E9 was verified only with the web profile — Story 4.2 verifies it with the content profile on the device and records it in api-contract.
- **Resume:** local position if a local entry exists, else server `timeCode`; start over when at/near the end. «С начала» starts at 0. Finished = ≥ 95 % or < 30 s left; playback is not interrupted at the threshold.
- **Errors:** an invalid token on content endpoints returns 200 anonymous ("all locked"), not 401 — the player's fresh E8 already validates via the SessionCheck port before showing «Нет доступа». 403 is never session expiry. Verified `NoAccess` → exit with the no-access message, no retry. Session expired in the player → best-effort E9 write, then re-login; a held write flushes only if the account generation is unchanged.
- **Remote reality:** the pinned Chromecast remote has no media keys (mapping implemented, unverified). D-pad ←/→ reach JS only as key up; hold-to-seek uses the native key listener added in 4.1. Android delivers no Step-back key to JS. After wake, production must stay paused (the spike resumed by itself).
- **Comments:** never requested (`comments_limit=0&reply_limit=0` on every E8).
- **Verification:** pinned Chromecast with Google TV 4K, release-like build, owner's session; label adb vs physical remote; mocks/emulator are never device results. Full suite ×3, new/changed flow suites ×30; lint `--max-warnings 0`, typecheck, `check:fixtures`. Story 4.7 records the cold-start press count to a playing video (≤ 5) in `docs/testing.md`.

## Technical Decisions

- **Dependencies:** `react-native-video` 6.19.3 is pinned and on `main`. A non-secret `KeyValueStore` (async-storage 3.1.x, `device`/`account` scope) is not installed yet; Story 4.2 adds it with an exact pin and a device check.
- **Ports:** `PlayerEngine` (integer seconds across the port), `AppLifecycle` (background/foreground, audio-focus loss), `KeyValueStore` live in `shared/platform` with Android adapters; features never import native modules.
- **Identity:** play by `MediaRef {blogUrl, postId, mediaId}`; Player route `{ref, origin: {routeKey, focusId}}`, ids only.
- **Domain stays clean:** the Post entity carries no `playerUrls`, `signedQuery` or `timeCode`. `MediaResolver` reads sources through the one E8 repository (extend, never copy); `timeCode` is read only by `ProgressRepository`.
- **ProgressRepository** (ADR 0004): the only writer of E9 and the account-scoped Continue history, the only reader of `timeCode`; API `begin(ref, meta)`, `report(ref, positionSec, event)`, `resumePoint(ref)`, finished computation, `useProgress(ref)` for UI. Cleared by `AccountScope.reset()`; quality preference is device-scoped.
- **PlaybackArbiter:** one playback slot app-wide; the player claims it and releases it on unmount; audio-focus loss pauses the holder.
- **Retries:** E9 is the only mutation that may be re-sent, and only with the latest position. Recovery runs once automatically, then waits for the user.
- **Navigation (ADRs 0007, 0012):** the Player is a JS-stack route without the sidebar. Back order: pending held seek → settings submenu → sheet → overlay → exit.
- **Return focus:** only FocusRestoration decides it; others call `setReturnFocus`. Known gap for 4.5: the Post reads restoration through `peek`, so a one-shot `setReturnFocus` is never consumed — decide the mechanism in 4.5.
- **Logging:** redact URLs, queries, signature parameters, Bearer values and titles/ids; never log a signed URL.

## UX & Interaction Patterns

- **Post (one column, header on top):** «Смотреть» sits in its own row right under the header (owner decision, option A); multi-video label names the target («Смотреть · Видео 1»). Story 4.2 makes it target the first unfinished media, relabels it «Продолжить» and adds «С начала» only when progress > 0 (its exact spot and ↑ ↓ order: confirm with the owner and show a device screenshot before the review loop). Ids `post/<postId>/primary`, `post/<postId>/restart`, `post/<postId>/video/<mediaId>`.
- **MediaRow status:** «Не начато» / «Осталось N мин» / «Просмотрено» plus a progress line from `useProgress(ref)` — never a fake status.
- **Player overlay:** top band (avatar, author, post title, non-generic video title), bottom band (timeline, elapsed/remaining, centered play/pause, «Настройки» from 4.3). Auto-hide after 5 s only while playing; never while paused, seeking, with a sheet open, or on error. Spinner after 500 ms buffering. Ids `player/timeline`, `player/playpause`, `player/settings`, `player/sheet/quality/<q>`, `player/prequality/<q>`, `player/error/retry|back`.
- **Settings sheet (4.3):** 340 dp side sheet, focus «Качество», traps focus; Menu/Info/Settings keys open it; a pick reloads at the same second, stores the preference, closes with focus on «Настройки». No auto-pick possible → quality list before playback.
- **States:** «Восстанавливаем воспроизведение…» (no focusable action), «Не удалось воспроизвести видео» with «Повторить» focused / «Назад». After wake: paused, overlay shown, focus on the timeline; play re-resolves if expired.
- **Return:** exit → the initiator on the origin. Natural end: final E9, exit, focus on the next unfinished MediaRow else the primary; from Главная → the neighbor of the removed card, else the first feed card. No autoplay.
- **Continue row (Главная):** «Продолжить просмотр · на этом устройстве», ≤ 20 entries, one per media id, newest first, above the feed grid; initial focus on its first card, hidden when empty; OK starts at `resumePoint(ref)`, exit returns to the same card. Ids `home/continue/<videoId>`.
- Copy in Russian via the `ru` catalog; every focusable has a Russian a11y label.

## Cross-Story Dependencies

- 4.1 (done) underlies all others; 4.2 (ProgressRepository, KeyValueStore, Post buttons/status) is needed by 4.5 and 4.7; 4.4's recovery path is reused by 4.6 (re-resolve on play after wake) and 4.3 (keep quality on recovery).
- Carried from 4.1, still open: device checks of a two-video post, the host-only error/spinner/arbiter paths and TalkBack; the subtle timeline focus state; the frame preview while scrubbing is a separate backlog spike, not part of this epic.
- Open Epic 3 retro items still relevant: owner physical-remote and TalkBack pass; planning-artifact reconciliation (`epics.md` still describes a two-column Post).
- Downstream: Epic 6 AudioBlock shares PlaybackArbiter; Epic 7 live player reuses the player with `LiveRef`/E15; Epic 8 adds speed and the system player.
