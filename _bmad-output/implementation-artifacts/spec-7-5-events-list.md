---
title: 'Story 7.5: Events list'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '51b40fce209499fcddc6411e0fd395835da0cb60'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The family learns about a stream only by opening each author (EVT-01, FR52, our approved addition, feature-parity §12 Q7).

**Approach:**
- New `entities/event` reads E18 `GET /v1/notification/standalone/event/` in one request with no params. Paging is unverified, so we do not guess its parameter names.
- A События sidebar section lists EventRows: unread dot, avatar, name and text on one ellipsized line, a «Эфир» chip for streams, and the time.
- OK opens the Author page with section `events`. For a live stream, 7.1's rule puts focus on the LiveCard; the player never starts from here.
- Back restores the same row by event id.
- The section is gated by the `events` phase flag.

**Owner decisions (2026-10-30):**
- **Q1 a.** The `events` flag is turned on after the live probe, if E18 answers in the documented shape (first page only, no load-more). If the shape differs, the flag stays off and the story reports why.
- **Q2 a.** The empty state is «Событий нет» with «Обновить» (focused; it refetches), as in the mock.
- **Q3 a.** Blog-owner event types are hidden: `donation_new`, `subscriber_new`, `blog_stat_report_*`, `post_buy`, `message_buy`, `bundle_buy`, `referal_*`, `support_ticket_update`, `level_subscribers_limit_reached`, `target_new`. Shown: `video_stream_start` («Начался эфир»), `post_new` and `promo_new` with their own text, and any type not in the known list with generic text.

## Boundaries & Constraints

**Always:**
- Parse defensively: a malformed event is dropped on its own. Comment types (`post_comment_new`, `post_comment_new_reply`) are never shown.
- `video_stream_start` reads «Начался эфир». Other shown types get generic text.
- The unread dot comes from `isRead`. No read mutation is sent, but OK marks the row read locally for this session (as in the design prototype).
- The row's blog comes from `blog.blogUrl`, else `target.bloggerUrl`, validated with `blogUrlSchema`. A row with no valid blog is shown, but OK does nothing.
- Keep the existing Author default origin `subs` for other callers.
- Counts-only logs: no names, URLs or tokens.
- Before UI work, run a live probe on the device: one E18 GET, counts and key sets only. Record the result in `docs/api-contract.md`.

**Never:**
- No guessed paging params, no read or unread mutation, and no player start from События.
- No change to Author's 7.1 initial-focus rule.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flag off | `events: false` | No sidebar item, no E18 | — |
| Loading | First open | A skeleton of rows | — |
| List | E18 with events | Rows newest first; initial focus on the first row; ↑ ↓ between rows; ← to the sidebar | — |
| Stream event | `video_stream_start` | «Начался эфир» plus the «Эфир» chip | — |
| Post / promo | `post_new`, `promo_new` | Their own short text | — |
| Owner-side type | the hidden list (Q3 a) | Not shown | — |
| Unknown type | A type not in the known list | Generic text | — |
| Comment type | `post_comment_*` | Not shown | — |
| Malformed | Missing id or type, or a bad time | That event is dropped | counts-only warn |
| OK | A row with a blog | Author (section `events`); the row is marked read locally; a live stream → focus on the LiveCard (7.1) | — |
| OK, no blog | No valid blog | Nothing happens | — |
| Back | From Author | The same row by event id, else the first row | — |
| Empty | No shown events | «Событий нет» with «Обновить» (focused; refetches) | — |
| Error | E18 fails | Error with «Повторить» (focused); retry refetches | no auto-retry |

</frozen-after-approval>

## Code Map

- `src/test/fixtures/boosty/e18-events.json`:
  - one `target_new` event with `id`, `type`, `eventTime` (epoch s), `isRead`, `author{id, name, avatarUrl, hasAvatar}`, `aggregation`, `target{bloggerUrl, …}`; no `blog`;
  - `count{unread, total, byEventType[]}`;
  - add synthetic fixtures for a stream event, a comment event and a malformed event (check-fixtures rules).
- `src/shared/entities/stream/streamRepository.ts` -- the repository pattern (`http.request({path, retry: false})`). Add a new `src/shared/entities/event/` (repository, mapper, types, index) and the DTO in `src/shared/api/dto/`.
- `src/shared/api/queryKeys.ts` -- `events()` with its own root. The whole cache is account-scoped, so no registration is needed.
- `src/app/phaseFlags.ts` (`events`, `SECTION_ORDER` already has it) + `src/app/__tests__/phaseFlags.test.ts`; `src/app/Sidebar.tsx:8` `nav/events`; `ru.ts:82` label.
- `src/app/Shell.tsx`:
  - `SectionContent` `case 'events'` (~431);
  - `SELF_FOCUS_SECTIONS` (76);
  - the FocusInfo memo like `subsFocus` (~275) and `searchFocus` (~287);
  - `onOpenAuthor`.
- `src/app/App.tsx:209` `onOpenAuthor(blogUrl)` → also take a section (as `onOpenPost`, :219); `routes.ts:28` `Author.section`; `stackRoutes.tsx:60` `AUTHOR_ORIGIN`.
- Patterns to copy:
  - `src/features/subscriptions/useSubscriptions.ts:45` (query + `useHeldError`);
  - `SubscriptionsScreen.tsx` (`useFocusRestoration`, `restoreElseFirst`, `setReturnFocus` ~303, skeleton/error/empty StateViews ~403-440);
  - `SearchScreen.tsx:340-355` (restoring by remembered id);
  - FlashList (ADR 0011) for the list.
- `src/features/author/useAuthorLive.tsx:138-177` -- the live initial focus already fires on the page's first E15; no route param is needed.
- `src/shared/i18n/format.ts:40` `formatCardDate` for the time; `src/shared/ui/AuthorCard.tsx:87` `AuthorAvatar`.
- Tokens: `colors.accent` (dot), `surface-focus-row`, `focus['scale-row']`. Add an `event-row` token to `tokens.ts` **and** the DESIGN.md frontmatter (`tokens.test.js` checks they match): about 720×56 dp, avatar 32, dot 6.
- Demo `src/app/dev/demo.ts` (path switch ~714): events including a `video_stream_start` for `demo-blog-1` (live). `__tests__/demoFlow.test.tsx`.
- `__tests__/shellFlow.test.tsx:145-153` asserts `nav/events` is hidden; update it (the item is shown once the flag is on).

## Tasks & Acceptance

**Execution:**
- [x] Live probe (device, debug build, temporary counts-only `__DEV__` probe, removed): one E18 GET; record status, event count, types, key sets and any cursor-like field in `docs/api-contract.md`. -- confirm the shape first.
- [x] `src/shared/entities/event/` + DTO + fixtures -- `Event {id, type, kind: 'stream'|'generic', time, isRead, authorName, avatarUrl, blogUrl|null}`, the filters (comments and owner-side types hidden), tests for every mapper row.
- [x] `src/features/events/EventsScreen.tsx`, `EventRow.tsx`, `useEvents.ts` (new feature) -- the list, states, focus restoration and local read marks.
- [x] `src/app/Shell.tsx`, `App.tsx`, `stackRoutes.tsx`, `routes.ts`, `phaseFlags.ts` (+ test), `src/shared/api/queryKeys.ts` -- wiring, `onOpenAuthor(blogUrl, section)`, the flag on after the probe confirms the shape.
- [x] `src/shared/ui/tokens.ts` + DESIGN.md frontmatter -- `event-row`.
- [x] `src/shared/i18n/ru.ts` -- «Начался эфир», the generic texts, the «Эфир» chip, empty/error copy, a11y labels.
- [x] `__tests__/eventsFlow.test.tsx` (new) -- one test per matrix row, including OK → Author with focus on the LiveCard and Back → the same row.
- [x] Demo + `demoFlow`; `shellFlow` (`nav/events` now shown).
- [x] Docs: `docs/api-contract.md` E18, `docs/feature-parity.md` EVT-01, `docs/focus-map.md` J, `docs/testing.md`.

**Acceptance Criteria:**
- Given the flag on, when События opens, then rows show the avatar, text, name, time and unread dot, with «Начался эфир» for streams and generic text otherwise.
- Given OK on a «Начался эфир» row whose author is live, when the Author page opens, then focus is on its LiveCard.
- Given empty or failing E18, when it answers, then «Событий нет» or an error with «Повторить» shows.
- Given lint, typecheck, `check:fixtures` and `npm test` ×3, when run, then all are clean; the touched suites pass ×30.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean
- `npm test` ×3 -- expected: all pass
- `eventsFlow`, `shellFlow`, `demoFlow`, `authorFlow`, `src/shared/entities/event`, `phaseFlags` ×30 -- expected: 0 failed runs

**Manual checks:**
- Device (agent over adb; check the app is in the foreground before every key batch, and screenshot before every OK). Demo debug build: the list, a stream row → Author on the LiveCard → Back → the same row; the empty and error states if reachable.
- Release-like build: the real События list from this account (or, if the probe failed, no События item).

## Implementation Notes

- **Live probe (2026-10-30):** debug APK + Metro (host port 8097) + a temporary counts-only `__DEV__` probe (`TEMP75` in `ShellRoute`, removed; release bundle `TEMP75` 0): one E18 GET, **HTTP 200**, the documented shape (`data.notificationStandalone{count, events, updateTime}`), 1 event (`target_new`, keys `aggregation, author, eventTime, id, isRead, target, type`, no `blog`), `count{byEventType, total, unread}`, **no cursor-like field**. Recorded in `docs/api-contract.md` «E18 (LIVE, Story 7.5)». Shape confirmed → `phaseFlags.events = true` (Q1 a). The device display was asleep during the first attempt (timers held); `KEYCODE_WAKEUP` let it finish.
- **Entity (`src/shared/entities/event/`):** `EventRepository.list(http)` → `GET /v1/notification/standalone/event/` with no params, `retry: false`, schema `eventsDtoSchema` (missing list → `Parse`). `mapEvents` parses each item with `eventDtoSchema` (required `id` string|number, non-blank `type`, finite `eventTime`; the mapper also requires `0 < eventTime < 1e11`), drops malformed items alone (one warn `event`/`dropped` with `count`), hides `post_comment_*` and the Q3 a owner types (`isHiddenEventType`: exact set + prefixes `blog_stat_report_`, `referal_`), keeps the first of a repeated id, sorts newest first (stable). `Event {id, type, kind, time, isRead, authorName, avatarUrl, blogUrl}`; `isRead` is false only for a literal `false`; the blog is `blog.blogUrl`, else `target.bloggerUrl`, through `blogUrlSchema`. Query key `queryKeys.events()` = `['events']`.
- **Feature (`src/features/events/`):** `useEvents` (useQuery + `useHeldError`, local read marks applied), `EventRow` (dot slot always reserved, `AuthorAvatar` 32, name in `card-title` + text in `body-s` on one ellipsized line via a nested Text, the «Эфир» chip on `colors.live` with the Badge text tokens, the time via `formatCardDate`), `EventsScreen` (FlashList, fixed 66 dp items, focus rules as Подписки). The single-line «name text» uses the catalog entry `events.afterName: ' {text}'` because literal strings are banned in JSX. Copy: «Начался эфир», «Новый пост» (`post_new`), «Новая акция» (`promo_new`), «Новое событие» (generic), «Событий нет» + the mock's explanation, «Обновить», «Не удалось загрузить события» + `error.<kind>`, a11y «{name}: {text}. {time}» / «Новое. …»; no name → «Автор».
- **Local read marks:** `eventReadMarksStore` (Zustand, in memory) is account-scoped (`defineAccountScoped('eventReadMarks')`, registered in `bootstrap.ts`, the registry test updated), so a mark never survives a sign-out or account switch and a refetch keeps it. OK on a row with a blog marks it, then opens Автор; a row without a valid blog does nothing (no mark).
- **Focus:** `events/row/<eventId>`, the StateView action `state/events/action` (both «Повторить» and «Обновить»). Restoration: the remembered row by id when still listed, else the first row (`restoreOrFirst`; deliberately not the shared neighbour-by-index fallback, per the matrix). The section is in `SELF_FOCUS_SECTIONS`; `EventsFocusInfo` mirrors Подписки's. A refetch that empties the list while a row has focus sends focus to «Обновить» (not in the matrix; the action exists, unlike Подписки' C3).
- **Wiring:** `Shell` `onOpenAuthor(blogUrl, section?)`; Подписки passes no section (Автор keeps its `subs` default), События passes `events`; `App.onOpenAuthor` navigates with `{blogUrl}` or `{blogUrl, section}`. No change to Автор's 7.1 initial-focus rule (the live card focus comes from the page's first E15, as before).
- **Token:** `event-row` `{width: 696, height: 56, avatar: 32, dot: 6, radius: rounded.lg, bg: surface, bgFocus: surface-focus-row, chip: live, scaleFocus: scale-row}` in `tokens.ts` and the DESIGN.md frontmatter (+ the EventRow component row). Width is the 720 dp content minus the 12 dp focus headroom on both sides (the spec's "about 720"), so the 1.02 scale and the ring stay inside the content.
- **Demo:** `demoEvents()` in `src/app/dev/demo.ts` (a `video_stream_start` of `demo-blog-1`, a `post_new` of `demo-blog-2`, a `promo_new` via `target.bloggerUrl`, an unknown type, a row without a blog, plus a hidden comment and donation).
- **Tests:** `eventRepository.test.ts` (48), `eventsFlow.test.tsx` (29, one per matrix row plus focus / account-scope rows), `demoFlow` (+1, and the sidebar slice), sidebar lists in `shellFlow`, `subscriptionsFlow`, `authorFlow`, `postFlow`, `codeFlow`; `phaseFlags` (+1), `accountScopeRegistry`. New synthetic fixture `src/test/fixtures/boosty/e18-events-synthetic.json` (a comment event, a stream event, an event without an id, an event with time 0).
- **Checks run:** lint (`--max-warnings 0`), typecheck, `check:fixtures` (30 clean); `npm test` ×3: 115 suites, 2621 passed each; touched suites (`eventsFlow`, `shellFlow`, `demoFlow`, `authorFlow`, `src/shared/entities/event`, `phaseFlags`) ×30: 0 failed runs (275 passed each). One `authorFlow` 7.4 test («Return to Автор with «Нравится» remembered…») failed once in the very first full run while the other suites were broken by the sidebar change (orphaned mounted Apps); it passed in isolation, in 3 full-file runs and in every later full run.
- **Device (2026-10-30, pinned Chromecast, agent over adb, foreground checked before every key batch, a screenshot of the focused element before every OK):** demo debug build (local `DEMO_MODE = true`, reverted): the list, arrows, OK on a no-blog row (nothing), the stream row → Автор with «События» current and focus on the LiveCard → Back → the same row without its dot; a no-stream author → the first post → Back → the row; empty («Обновить» focused, refetch) and error («Повторить» focused, one GET, retry) via local, reverted demo replies. Release-like build: the real События shows «Событий нет» with «Обновить» focused (the account's only event is the hidden `target_new`); Back order intact. Details in `docs/testing.md` «Story 7.5».
- **Not verified:** a live `video_stream_start` sample (fixture and demo only), paging (no cursor ever seen), a long real list, the physical remote.

## Spec Change Log

## Review Triage Log

Coordinator review (pass 1), all **patched**:

- **Comment and owner types matched too narrowly.** `isHiddenEventType` now lowercases the type: any type containing `comment` is hidden; the owner set and prefixes are compared case-insensitively. A counts-only info log `event`/`unknown types shown` reports how many generic rows were shown. Tests: `comment_reply_new`, upper/mixed-case comment and owner types, the unknown-type log.
- **`target.bloggerUrl` fallback for every type.** Now only for `video_stream_start`, `post_new`, `promo_new`; unknown types use `blog.blogUrl` only. Marked **inferred** in `docs/api-contract.md`. Tests for both; `e18-events-synthetic.json` gained a `promo_new` with only `target.bloggerUrl` and an unknown type with only `target` (→ no blog).
- **Row marked read before the navigation was accepted.** `App.onOpenAuthor` returns whether it navigated (`false` while the Shell is not focused); the Shell passes it through for События (Подписки ignores it); `EventsScreen` marks the row only on `true`. Test: a second OK during the transition neither navigates nor marks another row.
- **Nothing refreshed the list.** `useEvents` uses `staleTime: 0` (every section open fetches; the cached rows show meanwhile) and `refetch` is a `useCallback`; the App resume refresh invalidates `['events']` next to the stream invalidation (only an observed list refetches). The existing layout effect keeps the focused row by id. Tests: reopen sends E18 (2 calls), resume sends E18.
- **The a11y label omitted the visible «Эфир» chip.** Stream rows read «{name}: {text}. Эфир. {time}» (new `events.a11yStream` / `a11yStreamUnread`). Tests updated (`eventsFlow`, `demoFlow`).
- **Missing flow tests.** Added: the focused row moves under an active Shell → `scrollToIndex` to its new index and focus stays; the focused row removed → the first row; the list empties under a focused row → `events/empty` with focus on `state/events/action`; a refetch with the server still unread keeps the local read mark (no dot).

Checks run for this pass (only the covering suites): `eventsFlow`, `demoFlow`, `shellFlow`, `subscriptionsFlow`, `authorFlow`, `src/shared/entities/event` all pass; lint on the touched paths, typecheck and `check:fixtures` clean. Not re-run on the device.
