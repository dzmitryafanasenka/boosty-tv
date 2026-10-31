---
name: Boosty TV
title: "Boosty TV — Experience"
status: final
created: 2026-10-25
updated: 2026-10-31
sources:
  - ../../briefs/brief-boosty-tv-2026-10-25/brief.md
  - ../../../../docs/feature-parity.md
  - ../../../../docs/api-contract.md
  - ../../../../docs/android-tv-auth-playback-spike.md
  - ../../../../docs/testing.md
  - ../../design/claude-design-v1/docs/focus-map.md
  - ../../design/claude-design-v1/docs/handoff-rn-tv.md
  - ../../design/claude-design-v1/docs/assumptions.md
---

# Boosty TV — Experience Spine

## Foundation

- **Form factor.** One surface: Android TV / Google TV, 10-foot UI, remote only (D-pad, OK, Back, media keys). Reference device: Chromecast with Google TV 4K. Apple TV (tvOS) is out of scope (owner decision 2026-10-27).
- **UI system.** React Native + react-native-tvos with native focus (`TVFocusGuideView`, `hasTVPreferredFocus`). There is no JS focus engine. `DESIGN.md` is the visual identity reference; this spine defines behavior.
- **Audience.** One household and one shared Boosty account, with no profiles. The owner is technical; the other family members are not.
- **References.** Feature IDs (`AUTH-03`, `PLAY-10`, …) point to `docs/feature-parity.md`. Screen IDs (`A1`…`L5`) point to the Claude Design package.
- **Precedence.** This spine wins over the mocks on conflict. `focus-map.md` is normative unless this spine overrides it.

## Information Architecture

The sidebar is visible everywhere except in the player and on the sign-in screens. This includes the stack screens Автор and Пост, where the current item is the origin section and OK on another section pops to the Shell and opens it (owner decision 2026-10-27, ADR 0012). → Composition reference: `Boosty TV - A B C.dc.html`, `Boosty TV - D-L.dc.html`.

| Surface | Screens | Reached from | Purpose | Features |
|---|---|---|---|---|
| Sign-in | A1–A10 | Cold start without a session; after sign-out | Phone → code → session | AUTH-03, AUTH-04, AUTH-08 |
| Session expired | A11 | Any 401 after a failed refresh | Re-login with a prefilled phone | AUTH-05, AUTH-06 |
| Главная | B1–B6 | Default after sign-in; sidebar | «Продолжить просмотр» (client improvement), the subscription feed, «Фильтры», «Обновить» | FEED-01, FEED-02, FEED-03, FILTER-01..04, PLAY-03 |
| Подписки | C1–C3 | Sidebar | Author grid plus «Мой блог» | SUB-01, SUB-02 |
| Автор | D1–D11 | Author tile, post author, event | Header, live card, posts, search in this author, filters | AUTH-PAGE-01..03, LIVE-01, LIVE-04, LIVE-05 |
| Поиск | E1–E10 | Sidebar | Search «по подпискам» (feed scope) with filters | FEED-04, SEARCH-SCOPES, FILTER-01..04 |
| Пост | F1–F8 | Post card, search result, «Продолжить» (via player exit) | Media rows, text, images, audio, files and links (QR), poll, read-only likes | POST-01..11, POLL-01..05 |
| Плеер | G1–G12 | Media row, «Продолжить» card, live card | VOD and live playback | PLAY-01..08, PLAY-10..13 (**not** PLAY-09 download), LIVE-02, LIVE-03 |
| События | J1–J3 | Sidebar; hidden until E18 (EVT-01) is verified (verified live and shown since Story 7.5, `events` flag on) | Events, e.g. «Начался эфир» → author | EVT-01 (client improvement) |
| Настройки | K1–K4 | Sidebar | System player, version, diagnostics (hidden), sign out | SET-01, SET-02, SET-05, SET-06, AUTH-07 (**not** SET-03 light theme) |

Overlays: the filter SideSheet (from Главная, Автор, Поиск), the player-settings SideSheet, QrDialog, the sign-out Dialog and the system keyboard.

**Live streams on Главная.** Home does not fetch live streams: a stream comes only from the per-author endpoint (E15), and polling every subscription would cause a request storm. Home learns about a live stream through События (`video_stream_start`). A LIVE card appears in the feed only if the spike proves the feed returns stream posts.

## Voice and Tone

- **Register.** Russian, plain and calm, addressed with «вы». Buttons use short verbs: «Смотреть», «Продолжить», «С начала», «Повторить», «Назад», «Закрыть», «Войти снова», «Обновить».
- **Honest limits.** Copy never implies that access can be bought in the app. Locked post: «Нет доступа. Этот пост доступен подписчикам уровня «…». Оформить подписку можно на сайте или в приложении Boosty.» No price and no button.
- **Errors.** Each error says what happened and offers one action, for example «Не удалось загрузить ленту. Проверьте подключение» → «Повторить». Raw codes and technical text appear only in diagnostics.
- **Unverified details.** Where a server detail is not verified, use the generic copy «Не удалось войти» or «Код не подошёл».
- **Scope labels.** Always show the scope: «Поиск по подпискам», «Продолжить просмотр · на этом устройстве».

## Component Patterns

This section is behavior only; visual specs are in `DESIGN.md › Components`. → Post and player illustrations: `Post Screen.dc.html`, `Player Screen.dc.html`.

| Component | Behavior |
|---|---|
| **Sidebar / NavItem** | ↑↓ moves between items. → returns to the last content focus. A section opens only on OK, never when the item is merely focused. **Back stack:** content → sidebar (current item) → Главная (from any other section) → exit app (from the sidebar on Главная). |
| **Button** | OK activates it. While an action runs, the button shows a spinner and keeps focus; a second OK is ignored. |
| **«Обновить» (FEED-03)** | Reloads the feed and subscriptions. Focus stays on the same card (by id). While loading the label reads «Обновляем…». As built (Story 5.1, ADR 0010): a forced head refresh, so one E5 page 1 is merged into the cached feed and loaded pages are kept; the subscriptions query is invalidated. Focus stays on the button. A failure keeps every card and shows «Не удалось обновить» next to it. |
| **PostCard** | Feed card → OK opens the post. «Продолжить» card → OK opens the player at the saved position. Identity is `post.id`, plus `video.id` for «Продолжить». |
| **AuthorCard** | OK opens the author page. Identity is `blogUrl`. |
| **LiveCard** | OK when the stream is live, `hasAccess` is true and E15 lists a live-edge URL → live player. Otherwise → a QR to the stream page. → moves to «Нравится»: optimistic toggle, rolled back on failure, no double-send while a request is in flight. ↓ moves to «Поделиться» (QR). As built (Story 7.4, owner decisions 2026-10-30 Q1 a, Q2 a): «Нравится» (heart plus count) is shown only on a live card with access. «Поделиться» is shown on every card. Without the like, → from the card reaches «Поделиться». ↓ from «Поделиться» → the grid; ← → the card. |
| **FilterChip → filter SideSheet** | The sheet opens with focus on the selected «Доступ» value. Every change applies immediately (there is no Apply button), and the list behind refetches while focus stays in the sheet. «Сбросить» appears only when a filter is non-default. The chip shows the active-filter count. Back closes the sheet, and focus returns to the chip. As built (Story 5.7, owner decisions 2026-10-29): on Автор the «Доступ» section has only «Доступные мне» (default) and «Все посты». The Author Filter belongs to the route: it starts at the default and is dropped when the route closes. |
| **PeriodStepper** | Presets: «За всё время», «Последние 7 дней», «Последние 30 дней», «Последние 3 месяца», «Свой период…» (copy taken verbatim from the design). In «Свой период», ↑↓ changes the value and ←→ moves between day, month and year. «Готово» returns to the sheet. Days are normalized to the local start and end of day. |
| **TagRow** | Multi-select check. «Загрузить ещё» loads the next page of feed tags. «Сбросить» clears tags only. |
| **TextField** | OK opens the system keyboard. While the keyboard is open the app does not intercept arrows. Phone field: the country code is editable, defaults to `+7` and is sent as E.164. The owner uses `+375`. |
| **Primary «Смотреть / Продолжить» + «С начала»** | «Продолжить» resumes from the server `timeCode`. «С начала» appears only when progress > 0. In a multi-video post the primary button targets the first media that is **not finished** (see Ended), and its sub-label names that media. |
| **MediaRow** | OK plays exactly this media. Each video has its own progress. When playback ends, focus returns to the next unfinished MediaRow. |
| **ImageBlock** | Is a focus stop, so tall images can be scrolled into view. OK does nothing. |
| **ParagraphStop** | Each paragraph of expanded long text is a focus stop. As built (owner decision 2026-10-29, Story 6.1 Q1 a): there is no collapse. Every paragraph is a stop, and a paragraph longer than 600 characters is split into several. A `header` block is a bold heading and is not a stop. |
| **LinkChip** | OK opens a QR. Used for inline links, files and external video (YouTube). As built (Story 6.3, owner decisions 2026-10-29; our improvements): a link to another Boosty post reads «… · Открыть» and opens that post in the app. A timestamp link to a video of this post reads «… · Смотреть» and opens the player at that second. |
| **LikeCount** | Read-only, not focusable. |
| **AudioBlock** | A single focus target. OK toggles play/pause; ←→ seeks 10 s. Only one track plays in the whole app. Leaving the post stops audio. On audio-focus loss, audio pauses. Position is not persisted. |
| **PollOption — single choice** | **Vote:** the first OK sets the option to pending, and a second OK on the same option sends the vote. **Retract:** the first OK on the chosen option shows pending with «Нажмите OK ещё раз, чтобы отозвать», and the second OK sends the retract. Moving focus cancels pending. After every response the poll is re-fetched and focus stays on the option. On failure an inline error appears, the previous state is kept, and nothing is retried automatically. As built (Story 6.6): after a vote, two OK presses on another option change the vote (owner decision 2026-10-29 Q1 a). The inline error is one line per action (vote or retract), whatever the error kind. |
| **PollOption — multiple** | OK toggles a check. «Проголосовать» is focusable only when at least one option is checked; it sends the vote with no extra confirmation, since the checks are the deliberate step. After voting, results are shown with «Отозвать голос», which needs two OK presses (pending, then confirm). |
| **Finished poll** | Results only. Options are not focusable; the whole poll is one focus stop. |
| **SettingRow** | nav → opens a submenu or sheet; toggle → flips immediately; radio → selects and closes the submenu; check → toggles; info → not activatable. |
| **QualityOption** | Lists only the variants present for this media. Adaptive streams (HLS or DASH) are one «Авто» row. OK reloads at the same position, stores the preference and closes the sheet. If no quality can be picked automatically (PLAY-02), the quality list opens before playback starts. Live (Story 7.2, owner decision 2026-10-30): the gear and the sheet are shown only when the live list has more than one entry. A single «Авто» means no gear, which is the as-built case for every live stream so far. |
| **Speed** | Presets 0.5–3×, recordings only, stored globally. Hidden for live streams. |
| **PlayerControl** | OK activates. Focus moves with ←→ along the control row; ↑ goes back to the Timeline. |
| **Timeline** | See Interaction Primitives › Player overlay. ←→ seeks 5 s, accelerating while held. The bubble commits after `{motion.seek-commit}`. |
| **SideSheet** | Traps focus. Initial focus is defined for each sheet (filters: the selected «Доступ»; player: «Качество»). Back closes the deepest level first. |
| **Dialog** | Traps focus. The safe action gets the initial focus. On close, focus returns to the initiator. |
| **Sign-out Dialog** | Initial focus is «Отмена». Confirming clears secure storage (tokens, stored phone), the query cache, the continue-watching history and filters, then shows Welcome. Cancel returns focus to «Выйти из аккаунта». |
| **QrDialog** | Traps focus. The only action is «Закрыть»; Back also closes it. Focus returns to the initiator. The QR is generated on the device and the URL is never logged. |
| **StateView** | The single action gets the initial focus. ← moves to the sidebar. |
| **EventRow** *(conditional; shown since Story 7.5)* | OK opens the author page; for a live event the page is focused on the LiveCard. OK also marks the row read locally, only when Автор really opens; no read request is sent. A row without a valid blog does nothing on OK. |
| **Diagnostics** | Revealed by 7 OK presses on «Версия». Toggles log capture and explains log retrieval (adb). Logs are redacted: no tokens, cookies, phone, code or signed URLs. |
| **«Системный видеоплеер»** | A toggle. When on, the user picks a quality, then the Android chooser opens. The row description says progress is not tracked in this mode. If no external player is installed, the built-in player is used and the hint «Внешний плеер не найден» is shown. |

## State Patterns

Global rules:
- Refetching, pagination and image loading never move focus. Identity is always an id, never an index.
- **While a skeleton is shown, focus stays on the sidebar's current item.** When the first item loads, focus moves to the screen's initial element only if the user has not moved focus in the meantime.

### Global states (any surface)

| State | Trigger | Behavior |
|---|---|---|
| Session expired | 401 after a failed single refresh | If in the player, a best-effort E9 position write. Then A11. After re-login → Главная. |
| Account switch | After sign-in, the `E1.id` differs from the stored account id | Wipe the continue-watching history, query cache, filters and stored phone, then land on Главная fresh. The same id keeps everything. |
| Rate limited | 429 (shape unverified) | «Слишком много запросов. Попробуйте через минуту». No automatic retry storm; at most one delayed retry for GETs. |
| Content unavailable | 404 / deleted post | «Пост недоступен» + «Назад». No «Повторить». |
| Network error | Request failed | Error + «Повторить». GETs get a bounded automatic retry first. |
| Cold start offline | No network, session stored | Главная StateView «Нет подключения к интернету» + «Повторить». The session is kept; this is not A11. |
| Resume from sleep | App returns to the foreground | The player stays paused with the overlay shown. The next play re-resolves the media URL if needed (PLAY-10 path). Lists refetch silently and keep focus. *As built (ADR 0010, `src/app/App.tsx`; this supersedes «lists refetch»): only after the resume E1 succeeds, and focus is kept. Главная's feed and every Автор route in the stack get a **head refresh**: one page-1 request each, sent only when the cached list is at least 60 s old and merged into the head. Paged lists are never refetched in full. Every observed live stream (E15) and an observed События list (E18) are fetched again. Подписки, Поиск results and an open Пост are not refreshed on resume.* |

Error classes stay distinct (CLAUDE.md): session expired ≠ no access ≠ media URL expired ≠ content unavailable ≠ rate limit ≠ network.

### Per-surface states

| Surface | Loading | Empty | Error | Entitlement | Other |
|---|---|---|---|---|---|
| Sign-in | Button spinner; the field is disabled | — | Invalid number (A4). Wrong code (A7). Expired code (A8, focus on «Выслать новый код»). Too many attempts (A9; a timer only if the server gives one). Captcha / extra verification (A10): blocking, one retry, otherwise a release blocker. | — | Resend countdown 60 s (A5/A6) |
| Главная | Skeleton rows (B6) | No subscriptions → explanation that points to Подписки. Filter with no results → «Ничего не найдено» + «Сбросить фильтры». | Full error; load-more error as an inline row (B5) | — | «Продолжить» row hidden when the history is empty; no progress bar without a duration |
| Подписки | Skeleton grid | C3 «Подписок пока нет» + explanation; no CTA | Error + «Повторить» | — | More than 30 subscriptions → «Показаны первые 30» until pagination is verified (overrides the «28 из 55» counter in the design) |
| Автор | Skeleton header + grid | «Публикаций нет» / «Ничего не найдено» | Error + «Повторить» | — | Live: live / scheduled / needs level / ended (focus → first post). As built (Story 7.1 Q1 a): E15 is polled every 30 s for a live and a scheduled card, while the route is focused and the app is in the foreground. A failed E15 shows no card and no error. |
| Поиск | Results skeleton | Hint before a query; «Ничего не найдено» + «Сбросить фильтры» | Error + «Повторить» | — | Keyboard open / closed |
| Пост | Skeleton | — | Error + «Повторить»; 404 → unavailable | Locked: teaser + no-access copy; focus on the author | Unsupported-block placeholder; long text collapsed / expanded (as built: no collapse, every paragraph a stop; Story 6.1 Q1 a) |
| Плеер | Spinner after `{motion.buffer-delay}` | — | Recovering (one automatic re-resolve, PLAY-10) → hard error «Повторить» / «Назад» | Media not entitled → exit with a no-access message | Paused, seeking, live, stream ended, **Ended** (below) |
| События | Skeleton list | «Событий нет» + «Обновить» (focused; refetches; Story 7.5 Q2 a) | Error + «Повторить» | — | Unknown types shown generically. Blog-owner types (donations, subscribers, stats, purchases, referrals, support, level limits, `target_new`) are hidden (Story 7.5 Q3 a); comment types are never shown. First E18 page only, no load-more. |
| Настройки | — | — | — | — | Diagnostics hidden / visible |

### Ended (recordings)

- **Finished means ≥ 95 % watched or < 30 s left** (confirmed by the owner, 2026-10-25). When playback crosses this threshold, the item leaves «Продолжить просмотр» and its MediaRow shows «Просмотрено». Playback is **not** interrupted.
- When a video actually ends:
  1. a final E9 write records the end position;
  2. the player exits to its origin:
     - **from a post:** focus goes to the next unfinished MediaRow, or to the primary button if there is none;
     - **from Главная:** the «Продолжить» card is gone, so focus goes to its neighbor in the row, or to the first feed card if the row is now empty.
- **No autoplay of the next video.** PLAY-14 is not in scope.

→ State illustrations: `State Screen.dc.html`.

## Interaction Primitives

- **Keys.**
  - D-pad moves focus, OK activates, Back closes the topmost layer and then navigates.
  - Player media keys:
    - Play/Pause toggles playback.
    - FF and Next seek forward.
    - Prev and Step-back seek backward. Rew also seeks backward; this is a client improvement, since the reference does not handle MEDIA_REWIND.
    - Stop exits the player with a position write.
    - Menu, Info and Settings open the player settings.
- **Zones.** sidebar ↔ content ↔ filters/side sheets ↔ grid ↔ dialogs.
  - ← from the first content column → the sidebar, on the current item.
  - → from the sidebar → the last content focus.
  - Built with `TVFocusGuideView` destinations.
- **No wrap-around.** At list edges nothing happens except the defined zone transitions.
- **Modals and side sheets trap focus.** On close, focus returns to the initiator.
- **Restoration.**
  - Before navigating forward, the screen saves `{focusId, scrollOffset}`. The focus ID scheme is `<screen>/<zone>/<id>` (handoff).
  - On return, restore the scroll first, then the focus.
  - If the item has disappeared, fall back in order: the neighbor by index in the same list, then the first item of the zone, then the nearest action above.
- **Keyboard «Готово».**
  - Phone: «Получить код» if the number is valid, otherwise the field.
  - Code: submit.
  - Search: the first result, or the field if there are no results.
- **Player overlay.**
  - Shown on OK, ↑↓, ←→ (with the bubble) or pause, and on media keys. Fades with `{motion.overlay-fade}`.
  - Hides after `{motion.overlay-hide}` only while playing. It **never** hides while paused, while seeking, with a sheet open or on an error.
  - Initial focus is the Timeline; ↓ moves to the PlayerControls.
- **Back in the player.** Settings submenu → settings sheet → overlay → exit (E9 write, restore the originating card or row).
- **Progress writes.** Throttled to every ≥ 10 s of movement, plus on pause, on background, on Stop or exit and at the end. The identity is `video.id`, never the URL.
- **Live player.**
  - No seeking. Pause is allowed, and resume jumps to the live edge. Speed is fixed at 1×. The quality gear appears only with a real choice (see QualityOption).
  - Heartbeat every 30 s, and a stop heartbeat on exit.
  - Audio-focus loss pauses playback.
- **Motion.** Only the `DESIGN.md › motion` tokens are used: `{motion.focus}`, `{motion.scroll}`, `{motion.panel}`. With the system "reduce motion" setting, the focus scale stays and scrolling becomes instant.

## Accessibility Floor

- **Labels.** Every focusable element has a Russian accessibility label that TalkBack reads, for example: «Видео. Стол из слэба… Илья Ковалёв, вчера. Осталось 20 минут».
- **Explicit confirmation.** Actions that affect the whole household need an explicit confirm step:
  - signing out (the safe default is «Отмена»);
  - voting and retracting a vote (pending, then confirm).
- **Baseline.** The remote-only, single-focus, contrast and auto-hide rules from CLAUDE.md and `DESIGN.md › Colors` apply as-is.

## Key Flows

### Flow 0 — First sign-in (the owner, setting up the TV)
1. Cold start shows A1 Welcome with focus on «Войти в Boosty». OK.
2. A2: the country code defaults to `+7`. The owner changes it to `+375`, opens the number field, types the number and presses «Готово». Focus moves to «Получить код»; OK.
3. A5 shows a hint about where the code may arrive, and the 60 s countdown. The owner types the code and presses «Готово».
4. **Climax: the app lands on Главная.** The «Продолжить» row is hidden (no history yet), and focus is on the first feed card. The phone number is stored in secure storage for future re-login.
- *Failure:* see A4, A7–A10. A captcha (A10) is a release blocker.

### Flow 1 — Evening episode (the owner, after work, 21:00)
1. The owner opens Boosty TV. The session is valid, and Главная focuses the first card (press 0).
2. ↓ to «Новое в подписках» (1), → to the newest episode (2), OK opens the post (3).
3. Focus is on «Смотреть»; OK starts the video (4). **The target is met: 4 presses from cold start.**
4. Mid-episode: Menu → «Качество» → 1080p. **Climax: playback continues from the same second.**
5. Back hides the overlay; Back again exits (the position is saved) with focus on the post's primary button. Back once more returns to the same feed card.
- *Failure:* after a long pause the signed URL has expired → «Восстанавливаем воспроизведение…» → playback continues at the same position. If that fails: «Повторить» / «Назад».

### Flow 2 — Cooking blog, interrupted (a family member, daytime)
1. Подписки → the cooking author → a post with two videos → «Видео 2».
2. → several times skips the intro; the bubble shows the target time.
3. Something needs attention: Back twice. The position is written to the server.
4. Hours later, «Продолжить просмотр» shows this video first with «осталось 12 мин». **Climax: OK resumes exactly there.**
- *Variant:* the TV went to sleep during playback → on wake the player is paused with the overlay, and Play resumes (the URL is re-resolved if expired). After a reboot, Главная shows the same «Продолжить» card.
- *Failure:* the network drops → buffering → one recovery attempt → «Не удалось воспроизвести видео» + «Повторить».

### Flow 3 — Session expired (the owner, weeks later)
1. A request gets 401 and the single refresh fails. A11 «Сессия истекла» appears with focus on «Войти снова».
2. OK opens A2 with the stored phone prefilled. Focus is on «Получить код» — an override of focus-map, which puts it on the field.
3. The owner enters the code and presses «Готово».
4. **Climax: the same account id → Главная with the continue-watching history and filters intact.**
- *Variant:* a different phone or account signs in → account switch: the history, cache, filters and stored phone are wiped → Главная fresh.
- *Failure:* A7, A8, A9, A10 as in Flow 0.

### Flow 4 — Search an author's archive (the owner)
1. Поиск → the field with the label «по подпискам» → OK opens the keyboard → the owner types «квашеная капуста» and presses «Готово». Focus moves to the first result.
2. ↑ to «Фильтры» → the sheet opens → «Период» → «Свой период…» → steppers set October → «Готово» → back in the sheet; the results refetch behind it.
3. Back closes the sheet; focus returns to «Фильтры» and the chip shows «1».
4. ↓ to a result → OK opens the post → Back.
5. **Climax: the query, the filter and the focused result card are exactly as they were left.**
- *Failure:* «Ничего не найдено» + «Сбросить фильтры» (focus on that action). A load-more error appears as an inline «Повторить» row.

### Flow 5 — Live stream (the owner)
1. События shows «Начался эфир» (when EVT-01 is enabled), or the owner opens the author directly. Focus lands on the LiveCard.
2. OK opens the live player: LIVE badge, elapsed time, no timeline.
3. OK pauses; OK again resumes at the live edge.
4. The stream ends → «Стрим завершён» with focus on «Назад».
5. **Climax: Back lands on the author page with focus on the first post, where the LiveCard used to be.**
- *Failure:* no access (a subscription level is needed) → OK on the card opens a QR to the stream page.

### Flow 6 — Poll vote (the owner)
1. In a post with a single-choice poll, ↓ to the options.
2. The first OK sets pending: «Нажмите OK ещё раз». The second OK sends the vote.
3. **Climax: the results appear with the owner's choice marked, and focus stays on the option.**
- *Failure:* sending fails → an inline error, the previous state is kept, nothing is retried automatically.

### Flow 7 — Sign out (the owner)
1. Настройки → «Выйти из аккаунта» → the Dialog opens with focus on «Отмена».
2. → «Выйти», OK.
3. **Climax: Welcome appears; nothing of the account remains (tokens, phone, history, cache, filters).**

## Responsive & Platform

- **One logical layout (960×540 dp)** for 720p, 1080p and 4K outputs. [ASSUMPTION] Verify on the device.
- **Android only:** «Системный видеоплеер».

## Inspiration & Anti-patterns

- **Capability reference only: BoostBuddy.** Its anti-patterns to avoid:
  - website sign-in that needs a virtual cursor;
  - touch-style drawer navigation;
  - comment counters that lead to comments;
  - silent poll failures;
  - frequent logouts.
- **Rejected:**
  - an autoplaying hero;
  - global browse or recommendations;
  - polling live streams across all subscriptions;
  - payment prompts;
  - quality or track options that do not exist;
  - a custom on-screen keyboard (use the system IME).

## Visual references

| File (`../../design/claude-design-v1/`) | What it illustrates |
|---|---|
| `Boosty TV - A B C.dc.html` | Sign-in A1–A11, Главная B1–B6, Подписки C1–C3, 1280×720 adaptation |
| `Boosty TV - D-L.dc.html` | Автор, Поиск, Пост, Плеер, Аудио, Опросы, События, Настройки, Состояния (D–L) |
| `Boosty TV - Компоненты.dc.html` | Component state matrix |
| `Boosty TV - Прототип.dc.html` | Clickable prototype that uses the keyboard as the remote. Browser focus does not prove native focus. |
| `Post Screen.dc.html`, `Player Screen.dc.html`, `State Screen.dc.html` | Linked inline above |
| Other per-component `*.dc.html` files | Embedded in the overview files |
| `TV Keyboard.dc.html` | Illustrates the **system IME only. Do not implement it.** |
| `screenshots/` | Non-normative previews |
| `docs/focus-map.md` | Per-screen focus table; normative unless overridden here |
| `docs/handoff-rn-tv.md` | Focus ID scheme, virtualization assumptions, overlay layers |

**Overrides of the mocks and focus-map:**
- The LIVE card is removed from Главная (conditional).
- The «Авто · 1080p» suffix is conditional.
- The continue-watching history is account-scoped and wiped on sign-out or an account switch.
- The phone country code is editable.
- On A2 after A11, the initial focus is «Получить код».
- For more than 30 subscriptions, show «Показаны первые 30» instead of «28 из 55».
- **Superseded mock layouts (as built, 2026-10-31 reconcile):**
  - The post grids (Главная, Автор, Поиск) have **3 columns**, not the mocks' 4 (owner decision 2026-10-26; `Home Feed.dc.html`, `Author Page.dc.html`, `Search Screen.dc.html`, `Boosty TV - D-L.dc.html` D3, the 1280×720 notes in `Boosty TV - A B C.dc.html`).
  - Пост is **one column with the header on top**, not two columns (owner decision 2026-10-27; `Post Screen.dc.html`, F screens in `Boosty TV - D-L.dc.html`).
  - Автор and Пост show the Shell sidebar (ADR 0012).
  - The order of the post's elements is unchanged. See `DESIGN.md › Layout & Spacing`.

## Open items

- [ASSUMPTION] dp scale on the device (960×540).
- Unverified API details that drive states:
  - phone-auth error shapes, captcha and the code delivery channel;
  - the E18 events format;
  - subscriptions pagination;
  - video duration in the feed;
  - signed URL TTL;
  - 429 and 404 shapes.
  
  Tracked in `docs/api-contract.md` §8 and spike scenarios S2, S5, S7 and S11.
