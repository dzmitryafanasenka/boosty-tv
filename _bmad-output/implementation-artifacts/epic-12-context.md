# Epic 12 Context: Home and feed polish (our improvements)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make Главная and the post grids better for everyday use, based on the owner's daily viewing on the TV after the 1.2.0 release (owner decisions 2026-11-02). The viewer can remove videos they will not finish from «Продолжить просмотр» (one card by a long OK press, or all of them through a «Очистить всё» tile). Feed cards show local progress and «Просмотрено». The unused «События» section is replaced by a «в эфире» plaque on Главная that uses a bounded number of requests. A spike checks whether the owner's launcher (Aero TV) can show the Continue history through the system Watch Next channel. These are our improvements, not reference-parity obligations. Epics 1–11 and 13 are done and nothing in them is rolled back. Only the События section (EVT-01, Story 7.5) is removed.

## Stories

- Story 12.1: Remove videos from «Продолжить просмотр»
- Story 12.2: Progress and «Просмотрено» on feed cards
- Story 12.3: Replace «События» with a live plaque on Главная
- Story 12.4: Spike: the Continue history in the system Watch Next channel

## Requirements & Constraints

- **Removal from Continue (12.1):**
  - **Gate:** the story starts with a device probe. A temporary `__DEV__` probe logs the key events of a long OK press on a focused Continue card. It logs only key codes, `repeatCount` and timing. It must show whether a long press is reliably detectable on the pinned remote. On that remote OK may arrive as `DPAD_CENTER` with `repeatCount`, or as `ENTER`; this is unverified. If a long press is not reliably detectable, the story stops and the owner picks an alternative before any UI work. Running the probe needs the owner's OK.
  - **Long OK** on a Continue card opens a Dialog «Убрать из списка» / «Отмена» with focus on «Отмена». A short OK still opens the player.
  - **Confirming «Убрать из списка»:**
    - The entry leaves the local Continue history and the change is written at once.
    - No request is sent. The server `timeCode` is unchanged, so Пост still offers «Продолжить» from the server position.
    - Focus moves to the neighbour card, else to the first feed card.
  - **«Очистить всё»:**
    - When the row has entries, its last item is a «Очистить всё» tile.
    - OK on the tile opens a confirmation Dialog with focus on «Отмена».
    - Confirming clears the account's Continue history, hides the row and moves focus to the first feed card.
  - **Sign-out and account switch:** behaviour is unchanged (the AccountScope wipe).
  - **Device check:** on the release-like build, D-pad only. The long press on the physical remote is the owner's check and is labelled as such.
- **Feed card progress (12.2):**
  - Video post cards on Главная, Автор and Поиск show a progress line, as ContinueCard does, when a local progress entry exists.
  - A finished video shows «Просмотрено». Finished means ≥ 95 % watched or < 30 s left.
  - For a post with several videos, «Просмотрено» shows only when all of them are finished. Otherwise the card shows the progress of the first unfinished video, which is the target of «Продолжить · Видео N».
  - Without a local entry the card is unchanged.
  - No request is sent per card.
  - After the player, the card updates without a feed refetch and focus stays where it was.
  - The accessibility label includes «просмотрено» or «осталось N мин».
- **Live plaque (12.3):**
  - **Source:** pick it at spec time and record the choice and its evidence in `docs/api-contract.md`.
    - (a) E18, one request, if a live `video_stream_start` can be observed. So far it has never been observed live.
    - (b) Otherwise E15 for at most N subscribed authors per pass (N is chosen at spec time). Requests are sequential, the TTL is at least 5 minutes, and a refetch happens only on Главная focus or app resume after the TTL.
  - **Plaque:** it sits above «Продолжить просмотр» and shows the author, «в эфире» and the stream title. OK opens the live player as from the Author page. Several live authors give one plaque each, in a row.
  - **No live author or a failed check:** no plaque, no error and no placeholder. The check never delays Главная's initial focus or the feed.
  - **Removal of События:** the sidebar item, its route, `features/events`, the `events` flag and the `['events']` query are removed. The sidebar becomes Главная, Поиск, Подписки, Настройки.
  - **Docs:** update `docs/focus-map.md`. EVT-01 becomes «removed by owner decision 2026-11-02, replaced by the live plaque».
  - **Test:** a test asserts the request count per pass and the TTL. Unbounded per-author polling stays forbidden (no request storms).
- **Watch Next spike (12.4):**
  - A debug build gets a temporary native probe. It inserts one `WatchNextProgram` through `androidx.tvprovider`: title, a poster without a signed query, progress and a deep link. It uses synthetic data only and deletes the program afterwards.
  - With screenshots, record whether the program appears in Aero TV (`tv.aero.home`) and in the stock launcher on the pinned TV.
  - Output: a go/no-go research note in `docs/research/`. A go adds a follow-up story for sync with the history, including removal and «Очистить всё», the deep link with a cold-start session check, Back behaviour agreed with the owner, and the AccountScope wipe.
  - Google TV certification for its own row is not a goal.
- **Cross-cutting:**
  - No account data appears in logs, QR links or system channels.
  - Everything works with the D-pad only on the pinned device: Chromecast with Google TV 4K and its stock remote, which has no media keys.
  - A story that depends on platform behaviour probes it on the device while its spec is written.
  - Before every adb key batch, verify that the app is in the foreground.

## Technical Decisions

- **Progress ownership:**
  - ProgressRepository is the only writer of the Continue history and of E9, and the only reader of `timeCode`.
  - User removal adds `forget(ref)` for one entry and a clear-all for the account's history. Both are local, written at once and send no E9.
  - UI reads progress only through `useProgress(ref)`. Feed cards (12.2) use the same path.
  - "Finished" is computed only in ProgressRepository.
- **Account scope:** the Continue history is account-scoped and wiped only through `AccountScope.reset()`. Async writes capture the generation and are dropped if it has changed. A future Watch Next port would also need an AccountScope wipe.
- **Server state:**
  - TanStack Query, with keys only from `shared/api/queryKeys.ts`.
  - The live-plaque query (its key, TTL and cap) replaces `['events']` and the `events()` invalidation on resume. A failed check renders nothing.
  - The existing per-author stream key `['stream', blogUrl]` and the Author page's 30 s E15 polling stay as they are.
- **Platform:**
  - Native modules stay behind ports in `src/shared/platform`, and features never touch `NativeModules` directly.
  - JS D-pad handlers are allowed only in the player, the period stepper and the audio block. A long-OK detector on Continue cards is a new case and needs a justified, documented exception.
  - React Native does not give JS key repeats for held keys on the pinned remote. The player's hold-to-seek uses a native `dispatchKeyEvent` forwarder that reports `repeatCount`.
  - The `WatchNext` port (`androidx.tvprovider`) is deferred and added only if 12.4 is a go.
- **Focus:**
  - Focus IDs follow `<screen>/<zone>/<id>`. Continue cards use `home/continue/<mediaId>`.
  - FocusRestoration is the single return-focus store.
  - Native focus only.
  - Dialogs trap focus, give initial focus to the safe action and return focus to the initiator on close, unless the initiator was removed. In that case focus goes to the neighbour or the first feed card.

## UX & Interaction Patterns

- Главная order: the LivePlaque row (12.3), «Продолжить просмотр · на этом устройстве», then «Новое в подписках» with the 3-column feed grid. The Continue row appears only together with the feed grid.
- **ClearAllTile:**
  - It is the size of a ContinueCard, on `{colors.surface}`, and reads «Очистить всё».
  - It is the last item of the row.
  - OK opens the confirmation Dialog with focus on «Отмена».
- **Dialog:** centered, `{rounded.xl}`, above the scrim, with a title, a body and 2 actions. This is the same pattern as the sign-out Dialog.
- **PostCard progress:**
  - The accent progress line runs along the bottom edge of the preview.
  - A «Просмотрено» badge marks finished videos.
  - Cards never change height.
- **LivePlaque:**
  - A `{colors.live}` badge «в эфире», the author's avatar and name, and the stream title.
  - One focus stop per live author.
  - Hidden when nobody is live.
- After 12.3, the sidebar has 4 items. Update `docs/focus-map.md` in each story: the Главная plaque, «Очистить всё», removal focus moves and the sidebar.

## Cross-Story Dependencies

- 12.1 → 12.4: a Watch Next follow-up (if go) must mirror 12.1's removal and «Очистить всё».
- 12.2 reuses ContinueCard's progress line and the finished rule from the player (Epic 4). The multi-video target matches Пост's «Продолжить · Видео N» (Epic 13).
- 12.3 depends on the Epic 7 live player and the Author page's live entry. It retires Story 7.5 (События) and its resume invalidation (ADR 0010 path).
- All stories update the wiki after completion (standing owner rule), and per-release changelog pairs.
