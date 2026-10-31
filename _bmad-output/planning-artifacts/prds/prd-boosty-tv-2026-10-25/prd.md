---
title: "PRD: Boosty TV"
status: final
created: 2026-10-25
updated: 2026-10-25
sources:
  - ../../briefs/brief-boosty-tv-2026-10-25/brief.md
  - ../../ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md
  - ../../ux-designs/ux-boosty-tv-2026-10-25/EXPERIENCE.md
  - ../../../../docs/feature-parity.md
  - ../../../../docs/api-contract.md
  - ../../../../docs/android-tv-auth-playback-spike.md
  - ../../../../docs/testing.md
  - ../../../../CLAUDE.md
---

# PRD: Boosty TV
*Working title. Not approved branding.*

## 0. Document Purpose

This PRD defines **what** the Android TV app must do. Its readers are the owner, `bmad-architecture`, `bmad-create-epics-and-stories` and story developers. It builds on existing inputs and does not repeat them:

- **Behavior and visuals:** `EXPERIENCE.md` and `DESIGN.md` (UX spines, final). They own screens, focus rules, copy and tokens.
- **Capability evidence:** `docs/feature-parity.md`. IDs such as `PLAY-04` are cited in every FR. FRs marked **[IMPROVEMENT]** are ours and are not reference parity.
- **API facts:** `docs/api-contract.md` (endpoints `E1`–`E18`). Nothing here assumes an endpoint that is not listed there.
- **Engineering rules:** `CLAUDE.md` (stack, security, TV and testing). Technical choices live in `addendum.md`.

Each FR carries a **phase tag** taken from the CLAUDE.md delivery phases: **[P1]** vertical slice (= MVP), **[P2]** full Android parity, **[P3]** polish and release. FR numbers are global and stable. Inferences are tagged `[ASSUMPTION]` and indexed in §11.

## 1. Vision

Boosty TV is an unofficial Boosty client for the television, made for one household that shares one Boosty account on a Chromecast with Google TV 4K. You switch it on, it is already signed in, and in a few remote presses you are watching what is new from the authors you support. It does everything the only existing TV client (BoostBuddy) does, except comments, and adds the two things BoostBuddy lacks: navigation designed for the remote, and a session that does not drop every few days.

Video is the main job. Text, images, audio, files, polls, live streams, search, filters and events are all there as well, because the family's subscriptions contain them. Success is personal and simple: the owner stops opening BoostBuddy.

## 2. Target User

### 2.1 Jobs To Be Done

- **Functional:** watch new and unfinished videos from my subscriptions on the big screen, with only the remote.
- **Functional:** pick up exactly where any family member stopped.
- **Functional:** occasionally read a post, listen to audio, vote in a poll or catch a live stream without reaching for a phone.
- **Emotional:** never fight the remote; never be asked to sign in "again".
- **Contextual:** a shared living-room device used by technical and non-technical people.

### 2.2 Non-Users (v1)

- Anyone outside the household. Not published to Google Play.
- Authors or creators managing their own blog (no content creation).
- Phone or tablet users.

### 2.3 Key User Journeys

These mirror `EXPERIENCE.md › Key Flows`, where the full steps live. The IDs map as UJ-N = Flow N.

- **UJ-0. The owner sets up the TV.** First launch → phone with the `+375` code → code → Главная with the first feed card focused. *Edge:* captcha → blocking state (release blocker).
- **UJ-1. The owner watches the evening episode.** Cold start → feed → post → «Смотреть» in 4 presses → quality change keeps the position → Back restores the card. *Edge:* expired media URL → silent recovery.
- **UJ-2. A family member resumes a cooking video.** Подписки → author → a post with two videos → video 2 → seek → exit → hours later «Продолжить просмотр» resumes exactly. *Edge:* sleep or network loss.
- **UJ-3. The session expires weeks later.** 401 + failed refresh → «Сессия истекла» → prefilled phone → code → same account, history intact. *Edge:* a different account → everything account-scoped is wiped.
- **UJ-4. The owner searches an archive.** Поиск «по подпискам» → keyboard → filters (custom period) → post → Back restores the query, filter and card.
- **UJ-5. The owner catches a live stream.** Event or author page → live player (no seek) → stream ends → Back to the author page.
- **UJ-6. The owner votes in a poll.** Single choice → OK twice → results with the choice marked. *Edge:* send fails → inline error, no auto-retry.
- **UJ-7. The owner signs out.** Настройки → confirm → Welcome; no account data left.

## 3. Glossary

- **Account** — the single Boosty user signed in on this device, identified by `E1.id`. At most one at a time.
- **Session** — the stored access token, refresh token and expiry for the Account. Persisted only in secure storage.
- **Secure storage** — Keystore-backed native storage for secrets (Session, stored phone).
- **Author** — a Boosty blog, identified by `blogUrl`; shown with title, owner name and avatar.
- **Subscription** — an Author the Account subscribes to or follows (E2). «Мой блог» is the Account's own Author.
- **Feed** — the paginated list of Posts from Subscriptions (E5).
- **Post** — a publication, identified by `post.id`, made of Blocks, with `hasAccess`, `teaser` and an optional Poll.
- **Block** — one content element of a Post: text, link, emoji, image, Media, external video, file, or unknown.
- **Media** — a playable item inside a Post (`ok_video` or `audio_file`), identified by its media `id`. A Post may hold several Media.
- **Progress** — the playback position of one video Media, keyed by media `id`. Written to the server (E9) and read back as `timeCode` (E8). The round-trip is **unverified** (api-contract §8.8, spike S8); the Continue history also keeps the last local position as a fallback.
- **Continue history** — a device-local, Account-scoped list of recently played video Media, used for «Продолжить просмотр». [IMPROVEMENT]
- **Live stream** — an Author's active or scheduled broadcast (E15). It is not part of the Feed.
- **Event** — a notification item (E18), e.g. `video_stream_start`. [IMPROVEMENT]
- **Filter** — a combination of access type, period and tags applied to the Feed, an Author or a search.
- **Locked** — a Post or Live stream the Account is not entitled to (`hasAccess=false`).
- **QR handoff** — showing a URL as a QR code so it can be opened on a phone.
- **Focus restoration** — returning focus and scroll to the same element (by id) after navigating back.

## 4. Features

### 4.1 Sign-in and Session

**Description:** The Account signs in with a phone number and a one-time code, on the TV, with the remote and the system keyboard. The Session lives in Secure storage and refreshes silently, so the household rarely sees sign-in again. An expired Session leads to a fast re-login with the phone prefilled. Signing in as a different Account wipes everything account-scoped. Realizes UJ-0, UJ-3 and UJ-7. The owner approved this flow as an exception to the CLAUDE.md "no custom form" rule (feature-parity §12 Q1).

#### FR-1: Phone and one-time-code sign-in [P1]
The user can request a code for a phone number, then enter the code to sign in (E-phone send and confirm, AUTH-03).
- The country code is editable, defaults to `+7`, and the number is sent as E.164.
- Resend is available only after 60 s; «Изменить номер» returns to the phone step.
- The wrong-code, expired-code, too-many-attempts and extra-verification states are distinct screens (A4, A7–A10). Server-specific copy is used only where the response shape has been verified; otherwise generic copy.
- Sign-in completes only after `GET /v1/user/current` (E1) succeeds (AUTH-08).
- The phone, challenge and code never appear in logs. The challenge and code are never persisted.

#### FR-2: Captcha / extra verification is surfaced honestly [P1]
When Boosty demands extra verification that cannot be completed on TV, the app shows a blocking state with one retry and does not attempt a workaround.
- This outcome is reported as a release blocker (§9), not as a working feature.

#### FR-3: Session persistence [P1]
The Session survives app restarts and device reboots without signing in again (AUTH-04).
- Tokens are stored only in Secure storage. They never go to plain storage, logs, fixtures or crash reports.

#### FR-4: Silent single-flight refresh [P1]
The app refreshes the access token before expiry and once after a 401, with exactly one refresh in flight (AUTH-05, E `POST /oauth/token/`).
- N concurrent requests during expiry cause exactly one refresh request.
- A failed refresh produces no loop and no request storm. The original 401 surfaces.

#### FR-5: Session expired and re-login [P1]
After a 401 that follows a failed refresh, the app shows «Сессия истекла» and offers re-login with the stored phone prefilled (AUTH-06).
- If the player is open, a best-effort Progress write happens first.
- After re-login, the user lands on Главная.

#### FR-6: Stored phone for re-login [P1] [IMPROVEMENT]
The last phone number is kept in Secure storage to prefill re-login.
- It is wiped on sign-out and on Account switch.

#### FR-7: Account switch isolation [P1]
After sign-in, if `E1.id` differs from the stored Account id, the app wipes the Continue history, the query cache, Filters and the stored phone before showing Главная.
- The same Account id keeps them.

#### FR-8: Sign out [P1]
The user can sign out after a confirmation dialog whose default focus is «Отмена» (AUTH-07).
- Sign-out clears the Session, the stored phone, the query cache, the Continue history and Filters, then shows Welcome.
- No server revoke call is made (none is verified).

**Feature-specific NFRs:** session longevity ≥ 30 days without forced re-login on the test device, bounded by Boosty's refresh-token lifetime (SM-2).

### 4.2 Navigation Shell and Focus

**Description:** The app has a persistent labeled sidebar (Главная, Поиск, Подписки, События, Настройки) and a content area, both fully operable with D-pad, OK, Back and media keys. Focus behavior is normative in `EXPERIENCE.md › Interaction Primitives` and `_bmad-output/planning-artifacts/design/claude-design-v1/docs/focus-map.md`. CLAUDE.md expects `docs/focus-map.md`; it is created in English from these sources during architecture (see §10). Realizes all UJs.

#### FR-9: Sidebar navigation [P1]
The user can switch sections from the sidebar.
- A section opens only on OK, never on focus alone.
- Current section and focused item are visually distinct.
- «События» stays hidden until E18 is verified (FR-52).
- Only sections whose FRs are implemented in the current phase are shown. In P1 the sidebar shows Главная, Подписки and Настройки (minimal). Поиск appears in P2. No dead-end sections.

#### FR-10: Back hierarchy [P1]
Back closes the topmost layer first (keyboard → dialog → side sheet → overlay), then follows content → sidebar → Главная → exit app (APP-02).
- Recoverable errors use inline or screen states with one action, not toasts that can be missed (APP-01 intent).

#### FR-11: Focus restoration [P1]
Returning from a post or the player restores scroll and focus to the same element by id.
- If the element is gone, focus falls back to the neighbor by index, then to the first element of the zone, then to the nearest action above.
- Refetching, pagination and image loading never move focus.

#### FR-12: Deterministic initial focus and modal isolation [P1]
Every screen and state has a defined initial focus.
- Dialogs and side sheets trap focus and return it to the initiator on close.
- There is no wrap-around at list edges.

### 4.3 Home and Feed

**Description:** Главная shows «Продолжить просмотр» (when the Continue history is non-empty) above «Новое в подписках». Cards distinguish post types, show duration and Progress when known, and mark Locked posts. Live streams are not fetched here: polling every Author would cause a request storm. Realizes UJ-1 and UJ-2.

#### FR-13: Subscription feed with cursor pagination [P1]
The user can browse the Feed, loading more as focus nears the end (FEED-01, FEED-02, E5).
- `offset` is opaque and passed back verbatim. Paging stops when `isLast` is true.
- Pages are merged with dedup by `post.id`.
- A load-more failure appears as an inline «Повторить» row.
- The list stays smooth with hundreds of posts (virtualized, stable keys).

#### FR-14: Post-type cards [P1]
Each card shows: preview, type badge (Видео / N видео / Аудио / Текст и фото / Опрос / Файл / Нет доступа), title (2 lines), author, date, and duration and progress when known.
- No comment count appears anywhere (POST-10 exclusion).

#### FR-15: «Продолжить просмотр» row [P1] [IMPROVEMENT]
Главная shows recently played, unfinished video Media from the Continue history.
- OK opens the player at the Progress (FR-43).
- The row is hidden when empty. It is labeled «на этом устройстве».
- The Continue history keeps at most 20 entries, one per media `id`. It is ordered by last played, newest first, and the oldest entry drops when the limit is exceeded.
- An entry is removed when its Media is finished (FR-49), on sign-out and on Account switch.

#### FR-16: Refresh [P2]
The user can refresh the Feed and Subscriptions with «Обновить» (FEED-03) while keeping focus on the same card.

#### FR-17: Feed filters [P2]
The user can filter the Feed by access type, period and tags (see §4.6).

### 4.4 Subscriptions

#### FR-18: Subscription grid [P1]
The user can see the Subscriptions as an author grid and open an Author (SUB-01, E2).
- An empty state («Подписок пока нет») offers no subscribe CTA.
- When more than 30 Subscriptions are returned, a «Показаны первые 30» note is shown until pagination is verified.

#### FR-19: «Мой блог» [P2]
If the Account owns an Author (its own blog) that has at least one post, «Мой блог» appears first (SUB-02, E1, E3, E4).

### 4.5 Author Page and Live Streams

#### FR-20: Author page [P1]
The user can open an Author and browse its posts with pagination (AUTH-PAGE-01, E3, E4).
- The header shows the title, owner name and avatar.
- Description and cover are not shown (not verified in E3).

#### FR-21: Live stream card [P2]
The Author page shows the Live stream state: live, scheduled (refreshed every 30 s) or needs a subscription level (level name only, no price) (LIVE-01, E15).
- A 204 response means no card is shown.

#### FR-22: Watch a live stream [P2]
The user can watch a live stream when it is live and `hasAccess` is true (LIVE-02).
- No seeking. Pause is allowed, and resume jumps to the live edge. Speed is fixed at 1×.
- A «Стрим завершён» state appears when the stream ends.
- If the stream is not playable, OK shows a QR handoff to the stream page.

#### FR-23: Live viewer heartbeat [P2]
While a live stream plays, the app sends the viewer heartbeat every 30 s and sends `stop=true` on exit (LIVE-03, E16).

#### FR-24: Like a live stream [P2]
The user can like and unlike a Live stream (LIVE-04, E17).
- The UI updates optimistically and rolls back on failure. There is no double-send while a request is in flight and no automatic replay.

#### FR-25: Share a live stream via QR [P2]
«Поделиться» shows the stream URL as a QR handoff (LIVE-05).

### 4.6 Search and Filters

**Description:** Search has exactly two scopes: the subscription Feed and a single Author. There is no global search and no sorting. Filters apply immediately. The same filter panel serves the Feed, an Author (AUTH-PAGE-03) and search results. Realizes UJ-4.

#### FR-26: Search in subscriptions [P2]
The user can search the Feed scope with the system keyboard (FEED-04, SEARCH-SCOPES, E6).
- The scope label «по подпискам» is always visible.
- The query and the result focus are restored after opening a post.

#### FR-27: Search within an Author [P2]
The user can search one Author's posts (AUTH-PAGE-02, E7).

#### FR-28: Access filter [P2]
The user can choose «Доступные мне» (default), «Все посты» or «Только купленные» (FILTER-01).

#### FR-29: Period filter [P2]
The user can choose a preset period or a custom period entered with D-pad steppers (FILTER-02).
- Days are normalized to the local start and end of day and sent as `from_ts` / `to_ts`.

#### FR-30: Tag filter [P2]
The user can multi-select tags: feed tags are paginated (E13), Author tags come from E14 (FILTER-03).

#### FR-31: Immediate apply and reset [P2]
Each filter change refetches immediately. «Сбросить» restores the defaults. The filter chip shows the active count (FILTER-04).

### 4.7 Post Content

**Description:** A full post screen (our TV adaptation; POST-11 [IMPROVEMENT]) shows the header, the Media rows and all Blocks. External targets open via QR handoff. Locked posts explain the lack of access and never offer payment. Realizes UJ-1 and UJ-2.

#### FR-32: Post screen [P1] [IMPROVEMENT]
The user can open a post and see the author (OK opens the Author), title, date, read-only like count (POST-01, POST-10) and a primary «Смотреть / Продолжить» action, plus «С начала» when Progress > 0.
- The post is fetched fresh with `comments_limit=0` (E8).

#### FR-33: Multiple Media per post [P1]
Each Media in a post has its own row, Progress and status. The user plays a specific one (POST-04).
- The primary action targets the first unfinished Media.

#### FR-34: Rich text and emoji [P2]
Text Blocks render bold, italic, underline and inline emoji (POST-02).
- Long text is collapsed, with an expand action. Expanded paragraphs are focus stops.

#### FR-35: Links, external video and files via QR [P2]
Inline links, external video (e.g. YouTube) and files are offered as chips that open a QR handoff (POST-02, POST-05, POST-07).
- Signed URLs are never logged.

#### FR-36: Images [P2]
Image Blocks render inline and are focus stops. A failed image shows a placeholder (POST-03).

#### FR-37: Locked post [P1]
A Locked post shows its teaser and the no-access copy (subscription level name only). It shows no price, no payment and no subscribe button (POST-08).

#### FR-38: Unknown Blocks never break a post [P1]
An unknown or malformed Block renders a neutral placeholder or is skipped. Unknown Blocks never crash the feed or the post (POST-09).

### 4.8 Audio

#### FR-39: Inline audio playback [P2]
The user can play, pause and seek an audio Media inside the post (`url + signedQuery`) (POST-06).
- Only one track plays app-wide. Leaving the post stops audio. Audio-focus loss pauses playback.
- Playback continues while the TV screen saver or sleep is suppressed. [ASSUMPTION: behavior on sleep to be verified in spike S9]
- The audio playback position is not persisted.

### 4.9 Polls

**Description:** Polls show results at all times and support single and multiple choice, voting and retracting. Mutations need a deliberate confirmation on TV and are never auto-replayed. Realizes UJ-6.

#### FR-40: Poll display and states [P2]
A poll shows its title, options with percentages, the voter count, the user's chosen options and the finished state (POLL-01, POLL-05).

#### FR-41: Single-choice vote and retract [P2]
Voting or retracting on a single-choice poll requires two OK presses on the same option (pending, then confirm) (POLL-02, E11, E12).
- After every response the poll is re-fetched (E10).
- A failure shows an inline error, keeps the previous state and is never retried automatically.

#### FR-57: Multiple-choice vote and retract [P2]
The user toggles options, then «Проголосовать» sends all checked IDs. «Отозвать голос» requires two OK presses (POLL-03, POLL-04).

### 4.10 Video Player

**Description:** The native player plays the selected video Media, resumes from server Progress, persists Progress and recovers from expired signed URLs. It offers only the quality and speed options that really exist. Realizes UJ-1 and UJ-2.

#### FR-42: Playback of HLS, DASH and MP4 [P1]
The player plays the Media's `playerUrls` without sending Boosty auth headers to the CDN (PLAY-01).
- The URL choice is: the preferred quality, otherwise HLS > DASH > highest progressive.

#### FR-43: Resume and start over [P1]
Playback starts at the server `timeCode` (fresh E8). «С начала» starts at 0 [IMPROVEMENT] (PLAY-03).
- If spike S8 shows that E9/`timeCode` does not round-trip, the local position from the Continue history is used instead. Without it, the video starts at 0 with «С начала» hidden.
- When both exist, the local position wins (owner decision 2026-10-25; the server `timeCode` has no timestamp).

#### FR-44: Progress persistence [P1]
The player writes Progress (E9, integer seconds, keyed by media `id`):
- during playback, whenever the position has moved ≥ 10 s since the last successful write (so about every 10 s while playing — this bounds SM-4);
- on pause, app background, Stop/exit and end.
- The latest position is also stored locally in the Continue history.

Write failures are not shown to the user and are retried only with the latest position (PLAY-04, PLAY-12 [IMPROVEMENT for pause and background writes]).

#### FR-45: Controls and remote keys [P1]
The overlay shows the post title, the video title, the author [IMPROVEMENT], the timeline, and elapsed and remaining time. Keys work as follows (PLAY-05, PLAY-06, PLAY-11):
- Left/Right seek 5 s, accelerating while held.
- OK pauses and plays.
- Play/Pause, FF/Next, Prev/Step-back, Rew [IMPROVEMENT] and Stop are supported.
- Menu/Info/Settings opens the settings.

The overlay auto-hides after 5 s only while playing. It never hides while paused, seeking, with a sheet open or on an error.

#### FR-46: Quality selection [P1]
The user can choose among the available variants only. Adaptive streams appear as «Авто». The «· 1080p» suffix is shown only if the player reports it (PLAY-02).
- A switch keeps the position and stores the preference (SET-04).
- Quality and speed are offered in a player settings side sheet opened by «Настройки» or Menu/Info/Settings (PLAY-08).

#### FR-47: Playback speed [P2]
The user can choose a speed from 0.5× to 3× (presets) for recordings. The speed is stored globally (PLAY-07).

#### FR-48: Expired-URL recovery [P1]
On a player error, the app re-fetches the post (or stream), matches the Media by `id`, re-picks the same quality and resumes at the current position. This happens once automatically. A second failure shows «Повторить» / «Назад» (PLAY-10).

#### FR-49: Finished Media and end of playback [P1]
- **Finished** is a status: a video Media is finished once ≥ 95 % has been watched or < 30 s remains (confirmed by owner 2026-10-25). A finished Media leaves the Continue history and its row shows «Просмотрено». Playback is **not** interrupted when the threshold is crossed.
- **End of playback** is the player reaching the actual end of the stream. The player writes the final Progress and exits to its origin, with focus on the next unfinished Media (or the card).
- No autoplay of the next item (PLAY-14 out of scope).

#### FR-50: External system player [P2]
With «Системный видеоплеер» on, the user picks a quality and the video opens in an external Android player via the chooser (PLAY-13). *As built (Story 8.2): one real player opens directly; 2+ get the chooser.*
- Progress is not tracked in this mode, and the setting says so.
- If no player is installed, the built-in player is used.

#### FR-51: Lifecycle behavior [P1]
On sleep or background, playback pauses and Progress is written. On return, the player shows the paused overlay, and resuming re-resolves the URL if it has expired. Player resources are released on exit.

### 4.11 Events [IMPROVEMENT]

#### FR-52: Events list [P2, gated]
After E18 is verified live, the user can see a list of Events. A «Начался эфир» event opens the Author with the live card focused.
- Unknown event types are shown generically.
- Until E18 is verified, the section stays hidden (EVT-01).

### 4.12 Settings and Diagnostics

#### FR-53: Settings screen [P1 minimal, P2 full]
Настройки contains the app version and «Выйти из аккаунта» in P1 (SET-06, AUTH-07). «Системный видеоплеер» (SET-02) is added in P2 together with FR-50 (SET-01).

#### FR-54: Diagnostics for testing [P2]
Seven OK presses on «Версия» reveal Diagnostics. It can capture logs for testing and debugging and explains how to retrieve them (adb) (SET-05).
- Logs are redacted: no tokens, cookies, phone, code, signed URLs or personal data.

### 4.13 Distribution

#### FR-55: Installable Android TV release [P3]
A signed release APK installs on the test device and appears in the Google TV launcher with a TV banner. It declares no mandatory touchscreen (APP-03).
- The APK is published as an asset of a GitHub Release of the **public** project repository (owner decision 2026-10-25) and installed manually. Because the repository is public, it must never contain secrets, the signing key, real account data, unsanitized fixtures or signed URLs.
- The signing key stays outside the repository.
- There is no in-app download or installation of updates.

#### FR-56: Update check via GitHub Releases [P3] [IMPROVEMENT of UPD-01]
The app checks the latest release of the public project repository (GitHub Releases API, unauthenticated) at most once per day and on «Версия» in Настройки. When a newer version exists, it shows a non-blocking notice with the version and changelog, plus a QR handoff to the release page.
- The check never downloads or installs anything. Installation stays manual (UPD-02 remains excluded).
- A failed check is silent, apart from a diagnostics log entry.
- No account data or identifiers are sent; it is a plain anonymous GET.
- Versions are compared semantically against the app's `versionName`.
- An OK on «Версия» triggers at most one check per 60 s. The 7-press Diagnostics gesture (FR-54) never triggers more than one check.

## 5. Cross-Cutting NFRs

- **NFR-1 Security:**
  - Secrets live only in Secure storage.
  - Diagnostics redact cookies, auth headers, signed URLs and personal data.
  - Default TLS validation is never disabled.
  - Auth headers are never forwarded to third-party hosts.
- **NFR-2 Error semantics:** the app distinguishes session expired, no access, expired media URL, content unavailable (404), rate limit (429) and network failure, using only verified responses. A 403 is never treated as an expired Session.
- **NFR-3 Resilience:**
  - GET requests get bounded retries with backoff.
  - Mutations (E9, E11, E12, E16, E17) are never replayed blindly. E9 is resent only with the latest position.
- **NFR-4 Defensive parsing:** DTOs are validated at the boundary. Missing optional fields degrade gracefully. Sanitized contract fixtures cover feed, post, poll, stream, auth and error shapes.
- **NFR-5 Performance:**
  - Feed and grid scrolling stay smooth with hundreds of items on the test device. [ASSUMPTION: target "no visible frame drops during D-pad scroll", measured in P3]
  - Time to first video frame is measured in the spike, and a target is set after that. [ASSUMPTION]
- **NFR-6 TV accessibility:**
  - Everything works with the remote alone.
  - Each focusable element has a Russian accessibility label.
  - Contrast follows `DESIGN.md`.
  - The minimum text size is 11 sp.
- **NFR-7 Localization:** Russian copy with an i18n-ready structure. Code identifiers and docs are in English.
- **NFR-8 Platform boundaries:** domain logic and the API layer do not call native modules or platform APIs directly. Android-specific behavior sits behind narrow platform modules.
- **NFR-9 Verification:**
  - Unit, component and integration tests as listed in CLAUDE.md.
  - Every [P1] FR is verified on the physical test device before P1 is accepted.
  - Emulator and mock results are never reported as device verification.

## 6. Non-Goals (Explicit)

- No comments anywhere: no screens, counters, actions or requests.
- No downloading video to the device.
- No light theme, multiple accounts or profiles.
- No payments, subscribing, prices, donations, analytics or telemetry.
- No sign-in via the website, QR or a companion phone.
- No global Boosty search, recommendations, sorting, subtitles, audio tracks, chapters or seek thumbnails.
- No live chat and no live DVR/seek.
- No in-app download or install of updates; only the update check and notice (FR-56). No Google Play publication in v1.
- No own backend, proxy or cloud sync. Continue history is device-local.
- No Apple TV work: Apple TV (tvOS) is out of scope (owner decision 2026-10-27).

Excluded reference items, per `feature-parity.md` and the owner decisions in §12:
- website and virtual-cursor sign-in (AUTH-01, AUTH-02);
- comments (COMM-01);
- live chat (LIVE-06);
- download (PLAY-09);
- touch gestures (PLAY-15);
- light theme (SET-03);
- sorting (SORT-01, not present);
- the in-app APK installer (UPD-02);
- reference branding, donate, forum and analytics, and the keystore (REF-01–04).

## 7. MVP Scope

### 7.1 In Scope (MVP = Phase 1, vertical slice)

All **[P1]** FRs:
- sign-in, Session, refresh, re-login, Account switch and sign-out (FR-1–8), with minimal Настройки (FR-53, P1 part);
- the navigation shell and focus (FR-9–12);
- the Feed with cards and Continue history (FR-13–15);
- Subscriptions (FR-18);
- the Author page (FR-20);
- the post screen with multiple Media, Locked and unknown Blocks (FR-32, 33, 37, 38);
- the player with resume, Progress, quality, recovery, end and lifecycle (FR-42–46, 48, 49, 51).

The MVP proves UJ-0, UJ-1, UJ-2 and UJ-3 on the device. Per CLAUDE.md it is **not** a feature-complete release.

### 7.2 Out of Scope for MVP

- **[P2], full parity:**
  - refresh and Feed filters (FR-16, 17);
  - «Мой блог» (FR-19);
  - live streams (FR-21–25);
  - search and filters (FR-26–31);
  - rich text, links, images and audio (FR-34–36, FR-39);
  - polls (FR-40, FR-41, FR-57);
  - speed (FR-47);
  - the external player (FR-50);
  - Events, gated (FR-52);
  - full Settings and Diagnostics (FR-53 P2 part, FR-54).
- **[P3], polish and release:**
  - the release APK and GitHub Release (FR-55);
  - the update check (FR-56);
  - performance tuning;
  - visual fidelity;
  - device regression.

Sign-out (FR-8) was moved into P1 by the owner (2026-10-25) so that logout and re-login can be tested in the slice.

## 8. Success Metrics

**Primary**
- **SM-1: Switch-over.** BoostBuddy is not opened for 4 consecutive weeks after P3 is installed. Validates the whole product. *Measured by:* owner self-report at the end of the 4 weeks.
- **SM-2: Session longevity.** No forced re-login for ≥ 30 days of normal use, or for the full refresh-token lifetime if that turns out shorter (measured in spike S4). Validates FR-3, FR-4. *Measured by:* a date-stamped local diagnostics entry for each forced re-login, reviewed by the owner (no telemetry).

**Secondary**
- **SM-3: Time to video.** ≤ 5 remote presses from a cold start to a playing subscribed video; UJ-1 currently needs 4. Validates FR-13, FR-32, FR-42. *Measured by:* counted during the P1 and P3 device checks (docs/testing.md).
- **SM-4: Resume accuracy.** Re-opened video resumes within ±10 s of where it stopped, including after sleep or a reboot. Validates FR-43, FR-44, FR-51. *Measured by:* scripted device checks comparing the exit and resume positions.
- **SM-5: Remote-only.** 100 % of UJ-0 to UJ-7 can be completed with D-pad, OK, Back and media keys only. Validates FR-9 to FR-12. *Measured by:* the device regression checklist in docs/testing.md, run without any pointer or touch input.

There is no telemetry by design (NFR-1, §6). All metrics are measured manually on the household device.

**Counter-metrics (do not optimize)**
- **SM-C1:** Do not cut press count by autoplaying content on Главная or after a video ends. This counterbalances SM-3.
- **SM-C2:** Do not extend session longevity by storing secrets outside Secure storage or by skipping Account isolation. This counterbalances SM-2.
- **SM-C3:** Do not raise resume accuracy with continuous storage or network writes. Writes stay throttled. This counterbalances SM-4.

## 9. Constraints, Risks and Dependencies

| Risk | Impact | Mitigation |
|---|---|---|
| The phone-auth API demands a captcha or rate limit that cannot be handled on TV | Release blocker for sign-in | Spike S2 first. Report to the owner. Website sign-in remains research only. |
| The unofficial API changes | Features break | Defensive parsing, contract fixtures, a clear error state |
| Unknown signed-URL TTL | Playback breaks after a pause | FR-48 recovery; measure in spike S7 |
| Unknown refresh-token lifetime | Caps SM-2 | Measure in spike S4 |
| An RN TV library is incompatible (video, secure storage) | Delays | Verify in the spike before adoption. ADR per choice. |

Dependency: **phase 0 (spike) must pass before production implementation of the FRs** (CLAUDE.md).

## 10. Open Questions

1. E18 Events format, subscriptions pagination, video duration in the Feed, and 429/404 shapes → spike S5 and S11.
2. Does E9 → `timeCode` (E8) round-trip, and is it visible on the web? Determines whether FR-43 uses server or local Progress → spike S8.
3. Is E8 accepted with `comments_limit=0`? → spike S5.
4. Phone-auth error shapes, captcha requirement, code delivery channel → spike S2.
5. Signed URL TTL and the CDN error on expiry → spike S7.
6. Refresh-token rotation and lifetime (caps SM-2) → spike S4.
7. Create `docs/focus-map.md` (English) from the design focus map and EXPERIENCE.md → during architecture or P1.

## 11. Assumptions Index

- §4.8 FR-39: audio keeps playing while the TV would otherwise sleep (verify S9).
- §5 NFR-5: scroll smoothness target and time-to-first-frame target to be set after the spike.
- `DESIGN.md`: 960×540 dp device scale; several component sizes estimated from the mocks.
