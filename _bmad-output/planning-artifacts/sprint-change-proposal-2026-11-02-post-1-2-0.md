# Sprint Change Proposal: everyday improvements after 1.2.0 (2026-11-02)

Status: approved by the owner 2026-11-02 (batch mode). Author: correct-course run, owner Dzmitry.

## 1. Issue Summary

**Trigger.** New requirements from the stakeholder, not a defect. After 1.2.0 (Epics 1–11 done), the owner ran an ideation session on 2026-11-02 and approved a set of improvements based on daily use on the TV. Wiki: «План улучшений после 1.2.0» and «Убрать «События», плашка эфира на Главной».

**Owner decisions (2026-11-02):**
1. «Продолжить просмотр»: remove one card with a long OK press, and a «Очистить всё» tile at the end of the row. Local only.
2. Feed cards show progress and «Просмотрено».
3. Player: a sleep timer, and «закончится в ЧЧ:ММ» in the overlay.
4. Пост: a QR «На телефоне» with the post's own link.
5. Пост header redesign: a large 16:9 preview on the left (about 45 % of the content width), title, meta and buttons on the right. The MediaRow strip goes away for a single-video post; a post with several videos gets a compact row of videos under the header. Mockup approved by the owner: https://claude.ai/artifact/E16eGy7h7pJ8KC9ugJZoG8 (private canvas, 3 artboards).
6. Timestamps in the post: a line that starts with a timestamp becomes one chip «▶ time + title» (no duplicated text line). A timestamp inside a paragraph keeps the text, and a chip follows the paragraph.
7. Remove the «События» section. Instead, Главная shows a «в эфире» plaque when a subscribed author is live.
8. Настройки: «Сообщить о проблеме» (QR to a GitHub issue), «О приложении» (unofficial client, MIT, QR to GitHub), and the account name next to «Выйти из аккаунта». Separate rows, not one screen.
9. Spike: publish the Continue history to the system Watch Next channel (`TvContract`) so that third-party launchers show it. The owner uses the Aero TV launcher (`tv.aero.home` 1.32), which shows Kinopoisk and YouTube there, but not Boosty TV.

**Closed or rejected the same day:**
- PLAY-14 subtitles and audio tracks: Boosty does not provide them. Live manifests of two posts (2026-10-27, `docs/research/seek-preview-thumbnails.md`) have no `EXT-X-MEDIA`, one AAC audio set in DASH, no text track, and `ok_video` has no such field.
- Search history: rejected. The 2026-10-29 decision (the query lives in memory only) stays.
- Mini audio player, «N новых» on subscription tiles, «Отложить», cached instant start, image slideshow, «next post of the author»: not needed.

**Evidence and unknowns.**
- Feed cards: FR-14 already promises «duration and progress when known», but `PostCard` renders only the duration. Item 2 completes FR-14.
- Long OK on react-native-tvos is unverified on the pinned remote (`DPAD_CENTER` with `repeatCount` vs `ENTER`). Item 1 starts with a device check.
- Account name: E1 (`/v1/user/current`) is recorded only as «large object, `id`, `blogUrl?`». A display-name field is not verified.
- GitHub issue-form prefill from URL parameters is not verified on our `bug_report.yml`.
- Aero TV: it requests `READ_TV_LISTINGS` and declares `VIEW content://android.media.tv/…`, which suggests it reads `TvContract`. `adb shell content query` returned nothing, which is inconclusive (shell access). Its README does not describe the mechanism.

## 2. Impact Analysis

**Epics.** Epics 1–11 are done; none is invalidated or rolled back. The changes are our improvements (not parity), grouped by screen into four new epics (§4.1). Item 7 removes a shipped section (EVT-01, Story 7.5).

**Conflicts with earlier decisions. The owner's 2026-11-02 decisions supersede them:**
1. `EXPERIENCE.md` l.47: «Home does not fetch live streams … polling every subscription would cause a request storm. Home learns about a live stream through События». Item 7 removes События and adds a Home plaque. Mitigation in Story 12.3: one cheap source, a TTL, an author cap and sequential requests.
2. `EXPERIENCE.md` l.294: «Пост is one column with the header on top, not two columns (owner decision 2026-10-27)». The new header puts the preview and the actions side by side. The body below the header stays one column, and the element order is unchanged.
3. PRD §6 l.430 lists «chapters» as a non-goal, but Epic 10 shipped chapter marks. Fix it in the same docs PR.

**Artifacts to change.**

| Artifact | Places |
|---|---|
| PRD `prd.md` | FR-9 (l.137), FR-14 (l.169), FR-15 (l.173), FR-32 (l.252), FR-33 (l.256), FR-35 (l.264), FR-45 (l.328), §4.11 FR-52 (l.361), FR-53 (l.370), new FR-59…FR-66, §6 (l.430), §7, §10 |
| `epics.md` | FR inventory, FR coverage map, Epic List, new Epics 12–15 |
| `ARCHITECTURE-SPINE.md` | AD-10 (Continue history removal paths), AD-7 (live-plaque query), AD-2 (WatchNext port only if the spike passes), Capability map rows (l.470 Events → removed) |
| UX `EXPERIENCE.md` | l.42 События row, l.47 live on Главная, l.40 Пост inventory, l.130 События states, l.231 UJ live, l.294 Пост layout note, player overlay (l.169) |
| UX `DESIGN.md` | PostCard (l.248) progress, MediaRow (l.251), LinkChip (l.254) timestamp chip, EventRow (l.269) removed, new PostHero, LivePlaque, ClearAllTile, SleepTimer sheet row |
| `docs/feature-parity.md` | EVT-01 (removed by owner decision), PLAY-14 (closed: Boosty does not provide), PLAY-CONT (removal), new rows for our improvements |
| `docs/focus-map.md` | F Пост header, Главная plaque and «Очистить всё», sidebar without События, Настройки rows |
| `docs/api-contract.md` | E1 display-name field (after Story 15.2's probe) |
| `CHANGELOG.md` / `CHANGELOG.ru.md` | per release |
| Wiki | updated after each story (standing rule) |

**Technical impact.**
- Removing События touches `features/events`, the sidebar, routes, `phaseFlags.events`, `['events']` query invalidation (AD-7 l.194-198), tests and demo data.
- The live plaque adds background requests on Главная. This is the main risk to NFR-3 (no request storms).
- The Watch Next spike needs a native module (`androidx.tvprovider`) behind a port in `src/shared/platform`, and AccountScope must clear it on sign-out. This is only planned if the spike passes.
- No new endpoint is needed for items 1–8. E1's name field and E18/E15 for live are existing endpoints.

## 3. Recommended Approach

**Option 1, Direct Adjustment: add Epics 12–15 within the existing plan. Recommended.**
- Effort: Medium overall; each epic is Small to Medium.
- Risk: Low to Medium. The risk sits in Story 12.3 (request volume) and in the spikes (long OK, Watch Next).

**Option 2, Rollback: only the События section**, as part of Story 12.3. Nothing else is reverted.

**Option 3, MVP review: not needed.** The release is accepted; these are post-release improvements.

**Suggested order** (the owner can reorder):
1. Epic 13: the Пост redesign. The mockup is approved, the change is visible every evening, and it needs no unknowns.
2. Epic 12: Главная (progress on cards, removal from the row, live plaque, Watch Next spike).
3. Epic 14: the player (small).
4. Epic 15: Настройки (small; useful soon after the Threads launch for bug reports).

## 4. Detailed Change Proposals

### 4.1 Epics (`epics.md`)

**Add to the Epic List** after Epic 11:

```
NEW:
### Epic 12: Home and feed polish (our improvements)
Remove videos from «Продолжить просмотр», show progress on feed cards, replace the «События» section with a live plaque on Главная, and test the system Watch Next channel for third-party launchers (owner decisions 2026-11-02).
**FRs covered:** FR59, FR60, FR61; FR14 completed; FR9, FR15 amended; FR52 retired

### Epic 13: Post screen redesign (our improvements)
A large preview with the actions beside it, the post's own QR, and timestamp chips without duplicated text (owner decisions 2026-11-02; approved mockup).
**FRs covered:** FR62, FR63; FR32, FR33, FR35 amended

### Epic 14: Player additions (our improvements)
A sleep timer and the end time of the video in the overlay (owner decisions 2026-11-02).
**FRs covered:** FR64, FR65; FR45 amended

### Epic 15: Settings additions (our improvements)
«Сообщить о проблеме», «О приложении» and the account name next to sign-out (owner decisions 2026-11-02).
**FRs covered:** FR66; FR53 amended
```

**Story 12.1: Remove videos from «Продолжить просмотр»**

As the viewer, I want to remove a video I will not finish from «Продолжить просмотр», so that the row shows only what I still want to watch.

Acceptance Criteria:
- **Given** the pinned remote, **When** a temporary `__DEV__` probe logs key events for a long OK press on a focused card (key codes, `repeatCount`, timing only), **Then** the story records whether a long press is reliably detectable. If it is not, the story stops and the owner chooses an alternative before any UI work.
- **Given** a focused Continue card, **When** OK is held, **Then** a Dialog «Убрать из списка» / «Отмена» opens with focus on «Отмена». A short OK still opens the player.
- **Given** «Убрать из списка», **Then** the entry is removed from the local Continue history, is written at once, and focus moves to the neighbour card (else the first feed card, as at a natural end). No request is sent and the server `timeCode` is unchanged; the Пост still offers «Продолжить» from the server position.
- **Given** the row has entries, **Then** its last item is a «Очистить всё» tile. OK opens a confirmation Dialog with focus on «Отмена». Confirming clears the account's Continue history, hides the row and moves focus to the first feed card.
- **Given** sign-out or an account switch, **Then** behaviour is unchanged (AccountScope wipe).
- Device check on the release-like build; the long press on the physical remote is the owner's check.

**Story 12.2: Progress and «Просмотрено» on feed cards**

As the viewer, I want to see on the feed which videos I have started or finished, so that I do not open posts just to check.

Acceptance Criteria:
- **Given** a video post card on Главная, Автор or Поиск with a local progress entry, **Then** the preview shows a progress line, as in ContinueCard. A finished video (FR-49 rule) shows the badge «Просмотрено».
- **Given** a post with several videos, **Then** «Просмотрено» shows only when all of them are finished. Otherwise the line shows the progress of the first unfinished video (the same target as «Продолжить · Видео N»).
- **Given** no local entry, **Then** the card is unchanged. Progress comes only from the local store: no new request, no server `timeCode` fetch per card.
- **Given** progress changes in the player, **When** the user returns to the grid, **Then** the card reflects it without refetching the feed, and focus is unchanged.
- The card's accessibility label includes «просмотрено» or «осталось N мин».

**Story 12.3: Replace «События» with a live plaque on Главная**

As the viewer, I want to see on Главная when an author I follow is live, so that I do not miss rare streams, without a separate section I never open.

Acceptance Criteria:
- **Given** the spec, **Then** it picks the live source and records it in `docs/api-contract.md`:
  - (a) E18 events, one request, if a live `video_stream_start` can be observed; otherwise
  - (b) E15 per subscribed author, at most N authors per pass (N chosen at spec time), sequential, with a TTL of at least 5 minutes, refetched only on Главная focus or app resume after the TTL.
- **Given** a subscribed author is live, **Then** Главная shows a plaque above «Продолжить просмотр»: the author, «в эфире», the stream title. OK opens the live player as from the author page (FR-22). With several live authors, one plaque per author, in a row.
- **Given** no author is live, or the check failed, **Then** no plaque, no error state and no placeholder. Главная's initial focus and the feed are never delayed by the check.
- **Given** the release, **Then** the «События» sidebar item, route, feature module, `events` flag and `['events']` query are removed. Back and focus maps are updated (sidebar: Главная, Поиск, Подписки, Настройки). Docs: EVT-01 «removed by owner decision 2026-11-02, replaced by the live plaque».
- No request storm: a test asserts the request count per pass and the TTL.

**Story 12.4: Spike: Continue history in the system Watch Next channel**

As the owner, I want to know whether my launcher (Aero TV) can show Boosty TV's Continue history, so that we build it only if it works.

Acceptance Criteria:
- **Given** a debug build, **When** a temporary native probe inserts one `WatchNextProgram` (title, poster without a signed query, progress, deep link) via `androidx.tvprovider`, **Then** the story records whether it appears in Aero TV (`tv.aero.home`) and in the stock launcher on the pinned TV, with screenshots.
- The probe writes only one program with synthetic data and deletes it afterwards. No account data leaves the app.
- **Outcome:** a short research note in `docs/research/` and a go/no-go for a follow-up story. If go, that story covers sync with the Continue history (add, update, remove, «Очистить всё»), the deep link (cold start → session check → player; Back behaviour decided with the owner) and the AccountScope wipe. Google TV shows Watch Next only for certified apps; this is not a goal.

**Story 13.1: Пост header with a large preview and the post's QR**

As the viewer, I want a large preview and clear actions at the top of a post, so that I recognise the video and start it in one press.

Acceptance Criteria:
- **Given** a post with one video, **Then** the header follows the mockup:
  - on the left, a 16:9 preview at about 45 % of the content width, with the duration and the progress line; it is not focusable;
  - on the right, the title, the meta line and the media line (for example «Видео · 56:14 · осталось 44 мин»), then the buttons «Продолжить · ЧЧ:ММ» / «Смотреть», «С начала» (when progress > 0) and «На телефоне»;
  - the MediaRow strip is not shown.
- **Given** a post with several videos, **Then** the preview and «Продолжить» target the first unfinished video. Under the header, a compact row «Видео в посте · N» shows each video (preview, «Видео N · title», status) as one focus stop each.
- **Given** a post without video (text, audio, poll), **Then** the header has no preview, and the layout is otherwise unchanged.
- **Given** «На телефоне», **When** OK, **Then** a QrDialog shows the post's URL on boosty.to. Back returns focus to «На телефоне».
- Initial focus stays on the primary button. Focus order: primary → «С начала» → «На телефоне», ↓ to the body. Back and return-from-player focus rules are unchanged.
- Locked posts keep the teaser layout (FR-37) with the preview when available.
- Visual check against the mockup on the release-like build, at 1080p.

**Story 13.2: Timestamp chips instead of a text line and a chip**

As the viewer, I want each timestamp to be one obvious button, so that I see the chapters and jump to one without reading everything twice.

Acceptance Criteria:
- **Given** a text line that starts with a timestamp of a video in this post, **Then** the line renders as one chip «▶ time  title» (title = the rest of the line, one line, ellipsized), and the plain text line is not rendered.
- **Given** consecutive timestamp lines, **Then** the chips form a tight list (no blank lines between them), and ↑↓ moves through them.
- **Given** a timestamp inside a paragraph, **Then** the paragraph stays as text, and one chip «▶ time» per timestamp follows the paragraph.
- OK on a chip opens the player at that second (the Story 6.3 behaviour and progress rules are unchanged). Chapters in the player (Story 10.1) are unchanged.
- Links that are not timestamps keep the LinkChip behaviour.
- Hundreds of chips stay virtualized and focus-safe.

**Story 14.1: «Закончится в ЧЧ:ММ» in the player overlay**

As the viewer, I want to see when the video ends, so that I know whether I will finish it tonight.

Acceptance Criteria:
- **Given** a seekable video with a known duration, **Then** the overlay shows «−MM:SS · до ЧЧ:ММ» (exact copy at spec time), computed from the remaining time at the current speed, from the device clock in 24-hour format.
- It updates at least once a minute and after a seek or a speed change. It is hidden for live streams and unknown durations.

**Story 14.2: Sleep timer**

As the viewer, I want playback to stop by itself after a while, so that I do not lose my place when I fall asleep.

Acceptance Criteria:
- **Given** the player settings sheet, **Then** a «Таймер сна» row offers «Выкл», fixed durations and «До конца видео» (options chosen at spec time). Default «Выкл»; the choice is not persisted across player sessions.
- **Given** an active timer, **Then** the overlay shows the remaining time.
- **Given** the timer fires, **Then** playback pauses and progress is written at that position (the existing pause write). The overlay stays as on pause.
- Live streams: the timer stops playback the same way, with no progress write.
- Changing the video or leaving the player cancels the timer.

**Story 15.1: «О приложении» and «Сообщить о проблеме» in Настройки**

As a viewer who got the app from someone else, I want to see what the app is and where to report a problem, so that I can send a useful bug report.

Acceptance Criteria:
- **Given** Настройки, **Then** two new rows appear: «О приложении» and «Сообщить о проблеме». They are separate rows.
- **Given** «О приложении», **Then** a screen or dialog shows: the app name, the version, «Неофициальный клиент Boosty, не связан с Boosty», «Лицензия MIT», and a QR to the GitHub repository.
- **Given** «Сообщить о проблеме», **Then** a QrDialog links to a new GitHub issue with the bug template. If GitHub prefills issue-form fields from URL parameters (checked at spec time on `bug_report.yml`), the version and device model are prefilled. The URL never carries account data.
- Back returns focus to the row.

**Story 15.2: Account name next to «Выйти из аккаунта»**

As the viewer, I want to see which account I am signed in to, so that I know what «Выйти» will sign out.

Acceptance Criteria:
- **Given** a temporary probe of E1, **Then** `docs/api-contract.md` records which field carries the display name (keys and types only; no value is logged). If none exists, the story stops and the owner decides.
- **Given** the name, **Then** the «Выйти из аккаунта» row shows it as its secondary text. Missing or blank → the row is unchanged.
- The phone number is never shown. The name is account-scoped and never logged.

### 4.2 PRD (`prd.md`)

```
FR-9 l.140 OLD: - «События» stays hidden until E18 is verified (FR-52).
FR-9 l.140 NEW: - There is no «События» section (owner decision 2026-11-02; live streams surface on Главная, FR-61).

FR-14 l.170 ADD: - Video progress comes from the local store: a progress line, and «Просмотрено» when finished; for several videos, «Просмотрено» only when all are finished (FR-60).

FR-15 l.178 ADD: - The user can remove one entry (long OK) or clear the row («Очистить всё», confirmed). Removal is local; the server Progress is unchanged (FR-59).

FR-32 l.252 ADD: - The header shows a large preview beside the title, meta and actions, and a «На телефоне» QR of the post's URL (FR-62).

FR-33 l.256 ADD: - A single-video post shows no Media row; several videos show a compact row under the header (FR-62).

FR-35 l.264 ADD: - A text line that starts with a timestamp is rendered as one chip «▶ time title»; a timestamp inside a paragraph gets a chip after it (FR-63).

FR-45 l.329 ADD: The overlay also shows the end time of the video (FR-65).

§4.11 l.361 OLD: ### 4.11 Events [IMPROVEMENT] … FR-52 …
§4.11 l.361 NEW: ### 4.11 Events [RETIRED]
               FR-52 was shipped in Story 7.5 and retired by the owner on 2026-11-02 (section never used; one live event observed). Replaced by FR-61.

FR-53 l.370 ADD: Настройки also has «О приложении», «Сообщить о проблеме» and the account name with «Выйти из аккаунта» (FR-66).

ADD in the matching sections:
#### FR-59: Remove from «Продолжить просмотр» [P2] [IMPROVEMENT]
#### FR-60: Progress on feed cards [P2] [IMPROVEMENT] (completes FR-14)
#### FR-61: Live plaque on Главная [P2] [IMPROVEMENT] — bounded requests (NFR-3)
#### FR-62: Пост header with a large preview and the post's QR [P2] [IMPROVEMENT]
#### FR-63: Timestamp chips [P2] [IMPROVEMENT]
#### FR-64: Sleep timer [P2] [IMPROVEMENT]
#### FR-65: End time in the player overlay [P2] [IMPROVEMENT]
#### FR-66: About, report a problem, account name in Настройки [P2] [IMPROVEMENT]
(each with the bullets of its story's acceptance criteria, in PRD style)

§6 l.430 OLD: - No global Boosty search, recommendations, sorting, subtitles, audio tracks, chapters or seek thumbnails.
§6 l.430 NEW: - No global Boosty search, recommendations, sorting or seek thumbnails. No subtitles or audio tracks: Boosty does not provide them (PLAY-14, checked 2026-10-27). Chapters are shipped (Epic 10).

§7 ADD: «Post-release (P2+): Epics 12–15, owner decisions 2026-11-02.»

§10 ADD:
9. Is a long OK press detectable on the pinned remote? → Story 12.1.
10. Which live source is cheap enough for Главная (E18 or capped E15)? → Story 12.3.
11. Does Aero TV read the system Watch Next channel? → Story 12.4.
12. Which E1 field carries the display name? → Story 15.2.
```

### 4.3 Architecture (`ARCHITECTURE-SPINE.md`)

- AD-10: Continue-history removal paths gain «user removal» and «clear all» (local only, no E9 write).
- AD-7: the live-plaque query (key, TTL, cap) replaces `['events']`. Remove the `events()` invalidation notes (l.194-198).
- Capability map: the Events row (l.470) becomes «retired 2026-11-02»; add rows for FR-59…FR-66.
- AD-2: a `WatchNext` platform port is added only by the follow-up story if Story 12.4 is a go. It is listed under Deferred until then.

### 4.4 UX

- `EXPERIENCE.md`:
  - l.42: remove the События row; l.130: remove its states; l.231: UJ live starts from the plaque on Главная.
  - l.47: replace with «Главная shows a live plaque from one bounded source (FR-61); no unbounded per-author polling».
  - l.40: Пост inventory: the header with the large preview and «На телефоне»; timestamp chips.
  - l.294: «Пост is one column below a two-part header (preview | title, meta, actions), owner decision 2026-11-02, superseding the header part of the 2026-10-27 decision».
  - Player overlay: the end time; the sleep-timer row in the settings sheet.
  - Главная: the long-OK removal and the «Очистить всё» tile; Настройки: the new rows.
- `DESIGN.md`:
  - PostCard (l.248): the progress line and the «Просмотрено» badge.
  - MediaRow (l.251): used only as the compact multi-video row.
  - LinkChip (l.254): the timestamp chip «▶ time title».
  - EventRow (l.269): removed.
  - New: PostHero (preview + actions), LivePlaque, ClearAllTile. Tokens only, from the approved mockup.

### 4.5 docs/

- `feature-parity.md`: EVT-01 «removed by owner decision 2026-11-02, replaced by the live plaque»; PLAY-14 «closed: Boosty does not provide subtitles or audio tracks (LIVE, 2 posts, 2026-10-27)»; PLAY-CONT gains removal; new improvement rows for FR-59…FR-66.
- `focus-map.md`: updated in each story (sidebar, Главная, F Пост header and chips, Настройки).
- `api-contract.md`: the live source (Story 12.3) and the E1 name field (Story 15.2).

### 4.6 Sprint status and wiki

- `sprint-status.yaml` gets `epic-12…15: backlog` with the stories `12-1-remove-from-continue-watching`, `12-2-progress-on-feed-cards`, `12-3-live-plaque-replaces-events`, `12-4-spike-watch-next-channel`, `13-1-post-header-large-preview-and-qr`, `13-2-timestamp-chips`, `14-1-end-time-in-player-overlay`, `14-2-sleep-timer`, `15-1-about-and-report-a-problem`, `15-2-account-name-in-settings`, each epic with `retrospective: optional`.
- Wiki: the plan and the События decisions are already recorded (2026-11-02). Each story updates the wiki after it is done.

## 5. Implementation Handoff

**Scope: Moderate.**
- The backlog gains four epics, and the planning docs are amended.
- One shipped section is removed.
- There is no fundamental replan.

**Steps:**
1. **Developer, this session:** apply §4.1–§4.6 as one docs PR after approval. No code changes.
2. **Developer:** stories via `bmad-build`, in the order the owner picks (suggested: 13 → 12 → 14 → 15). The probes (12.1, 12.4, 15.2) and the live-source check (12.3) need the owner's OK to run on the account.
3. **Owner:** approves the docs PR, picks the order, does the remote checks, and decides at the stop points (long OK not detectable, Watch Next no-go, no name field).

**Success criteria:**
- The docs no longer mention События as a live feature or Home's ban on live checks without bounds.
- Each new behaviour works with the D-pad only on the pinned TV.
- The live plaque stays within its request budget.
- No account data appears in logs, QR links or system channels.
