# Epic 4 Context: Watch and resume (P1)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The family presses «Смотреть» on a post (or a «Продолжить просмотр» card) and watches the video full screen with the remote: seeking, quality choice, and resume where anyone in the family stopped (local position first, else the server `timeCode`). Playback recovers once by itself from expired signed URLs and player errors, survives sleep/background paused in place, marks finished videos, and feeds the Home «Продолжить просмотр» row. This closes the P1 vertical slice (sign in → feed → post → video → resume → return with restored focus); it is not a feature-complete release. Epics 1–3 are done. **Where newer long-term docs or owner decisions differ from the epics/spine text, the newer source wins:** `docs/api-contract.md` (§1, §3 E8/E9/E15, §6, §7), `docs/android-tv-auth-playback-spike.md`, `docs/testing.md` (Story 1.6, spike report), `docs/focus-map.md` (§1, §4 F Пост, G Плеер), ADRs 0004, 0007, 0008, 0009, 0012, the Epic 3 retro and `deferred-work.md`. The differences are called out below.

## Stories

- Story 4.1: Play a video from a post
- Story 4.2: Progress is saved and playback resumes
- Story 4.3: Choose video quality
- Story 4.4: Recover from expired links and playback errors
- Story 4.5: Finishing a video
- Story 4.6: Sleep, background and audio focus
- Story 4.7: Continue-watching row on the Home screen

## Requirements & Constraints

- **Sources come from a fresh E8 on the content profile** (ADR 0008; overrides any web-header assumption): CDN signatures are bound to the fetching client (`srcAg`); only the mobile Android Chrome UA without web headers yields playable URLs. Web-profile URLs get HTTP 400. The player uses its own UA; never send `Authorization` or Boosty headers to CDN hosts (the CDN's own cookie via the shared RN cookie jar is expected).
- **Quality mapping:** map `playerUrls[].type` per the api-contract table; skip empty URLs and unknown types. Order: preferred quality, else HLS, else DASH, else the highest progressive. Show only variants that exist; HLS/DASH = one «Авто» row, resolution suffix only if the engine reports it. Cap adaptive selection to what the display/decoder supports (the Chromecast once failed on adaptive 1440p AVC High).
- **Signed URLs:** 24 h lifetime (`expires`); the CDN response after a real expiry is unverified, so treat any player HTTP/decoder error as "re-resolve once via E8" (same `ok_video.id` and same type, else HLS/nearest fallback), seek to the last position, then «Повторить/Назад». URLs live in memory only — never in routes, storage, query keys, logs or fixtures.
- **E9 progress:** `PUT /v1/viewstat/video/{id}/timecode/`, form `time_code`, integer seconds, HTTP 200, round-trips to the next E8 `timeCode` and the website (LIVE). Write every ≥ 10 s of movement and on pause, background, Stop/exit, end. Never write a new source's pre-seek `t=0` (write only after the source reached its start position). Serialize writes or drop completions older than the newest sent; re-send only the latest position; never rely on a background/exit write completing (during sleep it finished only after wake). E9 has so far been verified only with the web profile; Story 4.2 must verify it with the content profile on the device and record it in api-contract.
- **Resume:** local position if a local entry exists, else server `timeCode` (ADR 0004); start over when the resume point is at/near the end. «С начала» starts at 0. Finished = ≥ 95 % or < 30 s left; not interrupted at the threshold.
- **Errors:** an invalid/expired token on content endpoints returns 200 anonymous ("all locked"), not 401 — validate with E1, never treat a missing video as a session problem. 403 is never session expiry. Verified `NoAccess` → exit with the no-access message, no retry. Session expired in the player → best-effort E9 write, then A11; a held write flushes after re-login only if the account generation is unchanged.
- **Remote reality (device, Story 1.6):** the pinned Chromecast remote has **no media keys**; media-key mapping (Play/Pause, FF/Next, Rew/Prev, Stop, Menu/Info/Settings) is implemented per spec but stays unverified on the device. D-pad left/right reach `useTVEventHandler` **only as key up**; key repeat/hold acceleration is unverified and must be measured before relying on it. In the Story 1.6 spike the player resumed by itself on wake — production must stay paused.
- **Comments:** never requested (`comments_limit=0&reply_limit=0` on every E8).
- **Verification:** pinned Chromecast with Google TV 4K, release-like `-PreactNativeArchitectures=armeabi-v7a`, owner's session; label adb vs physical remote; mocks/emulator are never device results. Full suite ×3, new/changed flow suites ×30; lint `--max-warnings 0`, typecheck, `check:fixtures`. Story 4.7 records the cold-start press count to a playing video (≤ 5) in `docs/testing.md`.

## Technical Decisions

- **Not yet on `main`:** `react-native-video` (6.19.3 passed the spike; spine pins 6.19.x) and a non-secret `KeyValueStore` (spine: async-storage 3.1.x, device/account scope) are not installed; Story 4.1/4.2 add them with exact pins and a device check. The spike's OkHttp interceptor is spike-only.
- **Ports (AD-2):** `PlayerEngine` (react-native-video behind it; integer seconds across the port), `AppLifecycle` (background/foreground, audio-focus loss), `KeyValueStore`, in `shared/platform` with Android adapters; features never import native modules.
- **Identity (AD-9):** play by `MediaRef {blogUrl, postId, mediaId}` (exists in `shared/entities/post`, built by `videoRowsOf`). Player route `{ref, origin: {routeKey, focusId}}` in `app/routes.ts`, ids only.
- **Domain stays clean:** the Post entity deliberately carries no `playerUrls`, `signedQuery` or `timeCode`. `MediaResolver` (player feature) reads sources from E8 through the entity repository (extend the one E8 DTO/repository, never copy), and `timeCode` is read only by `ProgressRepository`.
- **ProgressRepository (AD-10, ADR 0004):** the only writer of E9 and the account-scoped Continue history, the only reader of `timeCode`; API `begin(ref, meta)`, `report(ref, positionSec, event)`, `resumePoint(ref)`, finished computation, `useProgress(ref)` for UI. Account-scoped and cleared by `AccountScope.reset()`; quality preference is device-scoped.
- **PlaybackArbiter (AD-19):** one playback slot app-wide; the player claims it and releases it on unmount.
- **Navigation (ADRs 0007, 0012):** the Player is a JS-stack route in the focus-trapping screen wrapper, **without the sidebar** — it does not use `StackSidebarRoute`. Back order: settings submenu → sheet → overlay → exit. `pendingShellSection` handshake is irrelevant to the player.
- **Session (ADR 0009, executed):** SessionManager is split into `src/shared/api/session/*` behind the unchanged facade. A session-robustness review (overlapping sign-outs, sign-in vs in-flight refresh, restore/validate generation races, etc., listed in `deferred-work.md`) is due **before or with Story 4.2**, with a `debugExpireInMemory`-during-refresh test and an eslint import restriction for `session/`.
- **Phase flag:** `phaseFlags.player` is currently off (MediaRows inert, no button role); Epic 4 turns it on and passes it through the route as today.
- **Logging:** redact URLs, queries, `sig`/`srcIp`/`expires`, Bearer values and titles/ids; never log a signed URL even "shaped".

## UX & Interaction Patterns

- **Post screen is one column with the header on top** (owner decision 2026-10-27; supersedes the two-column UX-DR10/Story 3.4 text and `Post Screen.dc.html`): header (author row, title, date · likes) → MediaRows → body. **Open decision for Story 4.1/4.2:** where «Смотреть/Продолжить» and «С начала» sit (in the header row vs right under it) and their ↑ ↓ order — ask the owner, show a device screenshot before the review loop (Epic 3 retro A10). Focus-map target: initial focus on the primary button (targets the first unfinished media), «С начала» only when progress > 0; until then initial focus is the first MediaRow.
- **MediaRow:** gains the action (OK → Player for that media), button role, and status «Не начато» / «Осталось N мин» / «Просмотрено» plus a progress line from `useProgress(ref)` — never a fake status. Ids `post/<postId>/video/<mediaId>`, `post/<postId>/primary`, `post/<postId>/restart`.
- **Player overlay:** top band (avatar, author, post title, video title if different), bottom band (timeline with bubble, elapsed/remaining, play/pause, «Настройки»). Initial focus timeline; ↓ controls. Seek 5 s per press, presses during an in-flight seek build on the pending target; bubble commits after 600 ms. Ignore the first key up that arrives right after focus lands on the player (it belongs to the move). Auto-hide after 5 s only while playing; never while paused, seeking, with a sheet open, or on error. Spinner after 500 ms buffering. Ids `player/timeline`, `player/playpause`, `player/settings`, `player/sheet/quality/<q>`, `player/prequality/<q>`, `player/error/retry|back`.
- **Settings sheet:** 340 dp side sheet, focus «Качество», traps focus; quality pick reloads at the same second, stores the preference, closes with focus on «Настройки». No auto-pick possible → quality list before playback.
- **States:** «Восстанавливаем воспроизведение…» (no focusable action), «Не удалось воспроизвести видео» with «Повторить» focused / «Назад». After wake: paused, overlay shown, focus on the timeline.
- **Return:** exit → the initiator on the origin (primary or that MediaRow; the Continue card). Natural end: final E9, exit, `setReturnFocus` to the next unfinished MediaRow else the primary; from Главная → the neighbor of the removed card, else the first feed card. No autoplay.
- **Continue row (Главная):** «Продолжить просмотр · на этом устройстве», ≤ 20 entries, one per media id, newest first, above the FlashList feed grid; initial focus on its first card, hidden when empty. Ids `home/continue/<videoId>`.
- Copy in Russian via the `ru` catalog; every focusable has a Russian a11y label.

## Cross-Story Dependencies

- 4.1 (route, engine, resolver, overlay) underlies all others; 4.2 (ProgressRepository, KeyValueStore, Post buttons/status) is needed by 4.5 and 4.7; 4.4's recovery path is reused by 4.6 (re-resolve on play after wake) and 4.3 (keep quality on recovery).
- The session-robustness pass must land before or with 4.2 (held E9 write vs generation).
- Open Epic 3 items still relevant: A6 (`hasAccess: true` with empty `data`; all-locked lists after token refresh), A8 physical-remote/TalkBack pass, A9 planning-artifact reconciliation (`epics.md` still says two-column Post and FlatList).
- Downstream: Epic 6 AudioBlock shares PlaybackArbiter; Epic 7 live player reuses the player with `LiveRef`/E15; Epic 8 adds speed and the system player.
