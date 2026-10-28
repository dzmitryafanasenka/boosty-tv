# Epic 4 Context: Watch and resume (P1)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The family presses «Смотреть»/«Продолжить» on a post (or a «Продолжить просмотр» card on Главная) and watches the video full screen with the remote: seeking, quality choice, and resume where anyone in the family stopped. Playback recovers once by itself from expired signed URLs and player errors, survives sleep/background paused in place, marks finished videos and feeds the Home continue row. This closes the P1 vertical slice (sign in → feed → post → video → resume → return with restored focus); it is not a feature-complete release. Android TV / Google TV only. Stories 4.1 (player route, engine, resolver, overlay, hold-to-seek) and 4.2 (ProgressRepository, local store, E9 writes, Post «Продолжить»/«С начала» and MediaRow status) are done; 4.3–4.7 remain. Where newer long-term docs differ from the epics text, they win: `docs/api-contract.md` (§6 production client sections), `docs/focus-map.md`, `docs/testing.md`, ADRs 0004/0007/0008/0012, `deferred-work.md`.

## Stories

- Story 4.1: Play a video from a post (done)
- Story 4.2: Progress is saved and playback resumes (done)
- Story 4.3: Choose video quality
- Story 4.4: Recover from expired links and playback errors
- Story 4.5: Finishing a video
- Story 4.6: Sleep, background and audio focus
- Story 4.7: Continue-watching row on the Home screen

## Requirements & Constraints

- **Sources:** a fresh E8 on the content profile on every player open and every retry; CDN signatures are bound to the fetching client (web profile URLs get HTTP 400). Never send `Authorization` or Boosty headers to CDN hosts. `comments_limit=0&reply_limit=0` on every E8.
- **Quality mapping:** `playerUrls[].type` per the api-contract table; skip empty/unknown. Order: preferred quality (4.3 adds it), else HLS, else DASH, else highest progressive ≤ 1080p. Show only existing variants; HLS/DASH = one «Авто» row, resolution suffix only if the engine reports it. Every existing progressive height is listed, also above 1080p (owner decision 2026-10-28); only the automatic pick keeps the 1080p cap. Adaptive is capped at 1080p via declared bitrates after `onLoad` (known gap before `onLoad`).
- **Signed URLs:** 24 h lifetime; the CDN response after a real expiry is unverified, so any player HTTP/decoder error → re-resolve once via E8 (same media id and `playerUrls` type), seek to the last position; then «Повторить/Назад». URLs in memory only — never in routes, storage, query keys, logs or fixtures.
- **Progress (landed in 4.2, reuse, do not re-implement):** E9 `PUT /v1/viewstat/video/{id}/timecode/`, form `time_code`, integer seconds, content profile — `LIVE`. Writes after the start position is reached (never a pre-seek `t=0`), every ≥ 10 s of movement, forced on user pause, background, Stop/Back/unmount and end; none for hold-scrub pauses. One write in flight, latest position only; failed writes re-sent ≥ 10 s later, max 5 automatic attempts; held while the session is `expired` and flushed only with the same account generation.
- **Short-visit rule (owner decision):** a player session (open, replay after end, «С начала», a retry's new source) writes nothing — no E9, no local entry — until it moved ≥ 10 s from its start or the user paused. Story 4.5's final write and replay must respect it.
- **Resume / finished:** local entry wins, else server `timeCode`; 0 when none, finished (≥ 95 % or < 30 s left) or at/after the end. Playback is not interrupted at the finished threshold.
- **Errors:** an invalid token on content endpoints returns 200 anonymous ("all locked"); the SessionCheck port runs E1 before trusting a locked player E8. 403 is never session expiry. Verified `NoAccess` → exit with the no-access message, no retry.
- **Remote reality:** the pinned Chromecast remote has no media keys (mapping unverified). D-pad ←/→ reach JS only as key up; hold-to-seek uses the native key listener. No Step-back key reaches JS. After wake, playback must stay paused.
- **Verification:** pinned Chromecast with Google TV 4K, release-like build, owner's session; label adb vs physical remote; mocks/emulator are never device results. Full suite ×3, new/changed flow suites ×30; lint `--max-warnings 0`, typecheck, `check:fixtures`. Story 4.7 records the cold-start press count to a playing video (≤ 5) in `docs/testing.md`.

## Technical Decisions

- **Dependencies:** `react-native-video` 6.19.3 and `@react-native-async-storage/async-storage` 3.1.1 (exact pins). Async-storage sits behind the `KeyValueStore` port with `device` (`boostytv-device`) and `account` (`boostytv-account`) databases; demo mode uses an in-memory store.
- **Ports in `shared/platform`:** `PlayerEngine` (integer seconds), `KeyValueStore`, a minimal app-background subscription (`appLifecycle.ts`); 4.6 extends lifecycle for foreground and audio-focus loss. Features import no native module.
- **Identity:** play by `MediaRef {blogUrl, postId, mediaId}`; Player route `{ref, origin: {routeKey, focusId}, start?: 'resume' | 'beginning'}`, ids only.
- **ProgressRepository** (`shared/services/progress`, ADR 0004): the only E9 writer, only `timeCode` reader (via an `onServerProgress` sink from both E8s; the Post entity carries no `playerUrls`, `signedQuery` or `timeCode`), owner of the account-scoped local store (`progress.v1`: per media id `{ref, positionSec, durationSec, updatedAt, meta}`, ≤ 200 entries, disk debounced 2 s, wiped by `AccountScope.reset()`). API: `begin`, `report`, `resumePoint`, finished rule, `useProgress(ref)` (`useSyncExternalStore`). Story 4.7 derives the continue view from `progressStore.entries()`.
- **Open before 4.7:** `meta.previewUrl` is persisted; verify a live `ok_video.preview` URL carries no CDN token — if signed, store none and re-read it from E8.
- **Quality preference** is device-scoped (4.3).
- **PlaybackArbiter:** one playback slot app-wide; claimed by the player, released on unmount; audio-focus loss pauses the holder. An arbiter pause writes no progress.
- **Retries:** E9 is the only re-sendable mutation. Recovery runs once automatically, then waits for the user.
- **Navigation (ADRs 0007, 0012):** the Player is a JS-stack route without the sidebar. Back order: pending held seek → settings submenu → sheet → overlay → exit.
- **Return focus:** only FocusRestoration decides it. Known gap for 4.5: the Post reads restoration through `peek`, so a one-shot `setReturnFocus` is never consumed (the player exit uses `remember`) — decide the mechanism in 4.5.
- **Logging:** redact URLs, queries, signatures, Bearer values, titles/ids; never log positions with ids.

## UX & Interaction Patterns

- **Post (header on top, one column):** the primary sits in its own row under the header and targets the first unfinished media: «Продолжить» (multi: «Продолжить · Видео N») with progress > 0, else «Смотреть»; all finished → «Смотреть» on the first media from 0. «С начала» sits to the right of the primary only when the target has progress (← → between them, ↓ → first MediaRow, ↑ → author); a vanished focused «С начала» falls back to the primary. Ids `post/<postId>/primary`, `post/<postId>/restart`, `post/<postId>/video/<mediaId>`.
- **MediaRow status:** «Не начато» / «Осталось N мин» (rounded up) / «Просмотрено» plus a progress line; no status for a started video without a known duration. Never a fake status.
- **Player overlay:** top band (avatar, author, post title, non-generic video title), bottom band (timeline, elapsed/remaining, then «−10 с» · play/pause · «+10 с» centered and a gear «Настройки» at the row's right end, Story 4.3 owner decision; SVG icons, ADR 0013). Auto-hide after 5 s only while playing. Spinner after 500 ms buffering. Ids `player/timeline`, `player/back10`, `player/playpause`, `player/forward10`, `player/settings`, `player/sheet/quality/<q>`, `player/error/retry|back`.
- **Settings sheet (4.3):** 340 dp right side sheet, focus «Качество», traps focus; Menu/Info open it (Android has no Settings key); a pick reloads at the same second, stores the preference once the picked source loaded, closes with focus on «Настройки». No quality list before playback: with our mapping every usable source is auto-pickable, so that case is unreachable (owner decision 2026-10-28).
- **States:** «Восстанавливаем воспроизведение…» (no focusable action); «Не удалось воспроизвести видео» with «Повторить» focused / «Назад». After wake: paused, overlay shown, focus on the timeline; play re-resolves if expired.
- **Return:** exit → the initiator on the origin. Natural end: final write, exit, focus on the next unfinished MediaRow else the primary; from Главная → the neighbor of the removed card, else the first feed card. No autoplay.
- **Continue row (Главная, 4.7):** «Продолжить просмотр · на этом устройстве», ≤ 20 entries, one per media id, newest first, above the feed grid; each card: preview, title, author, remaining time or progress. Initial focus on its first card; hidden when empty (focus → first feed card). OK starts at `resumePoint(ref)`; exit returns to the same card. Ids `home/continue/<videoId>`.
- Copy in Russian via the `ru` catalog; every focusable has a Russian a11y label.

## Cross-Story Dependencies

- 4.1 and 4.2 underlie the rest; 4.5 and 4.7 build on ProgressRepository and the local store; 4.4's recovery path is reused by 4.6 (re-resolve on play after wake) and 4.3 (keep quality on recovery).
- Still-open device checks carried from 4.1/4.2: a multi-video post (none known to the owner; host-tested), host-only error/spinner/arbiter paths, physical remote and TalkBack; the subtle timeline focus state. Host gap: E9 hold-on-expiry not flow-tested through the real HttpClient/SessionManager. Frame preview while scrubbing is a separate backlog spike.
- Downstream: Epic 6 audio shares PlaybackArbiter; Epic 7 live player reuses the player with `LiveRef`/E15; Epic 8 adds speed and the system player; feed/Author card progress (FR-14) is later.
