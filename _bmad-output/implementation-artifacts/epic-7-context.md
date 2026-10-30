# Epic 7 Context: Live streams and events (P2)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Add BoostBuddy's live-stream parity (LIVE-01..05) and our approved Events addition (EVT-01). An author's page shows a live or scheduled stream card. The family can watch the stream at the live edge with honest controls, the app sends the viewer heartbeat like the website does, and the family can like the stream or share it to a phone by QR. A gated События section lists recent events such as «Начался эфир» and leads to the author's live card. Live chat is not parity, and comments stay excluded. Most of this epic rests on reference code, not on live evidence: no stream was running during any check so far, so every story must keep "verified on the device" and "fixture or demo only" claims separate.

## Stories

- Story 7.1: Live stream card on the author page
- Story 7.2: Watch a live stream
- Story 7.3: Live viewer heartbeat
- Story 7.4: Like and share a live stream
- Story 7.5: Events list

## Requirements & Constraints

- **Stream fetch (E15, `GET /v1/blog/{blogUrl}/video_stream`):** a 204 with an empty body means there is no stream and no card (`LIVE`). The 200 shape comes from the reference only: `id`, `int_id`, `title`, `isOnline`, `isTemplate` (scheduled), `hasAccess`, `startTime` (epoch s), `signedQuery`, `isLiked`, `data[]` (with `ok_stream`/`ok_video`), `teaser[]`, `count{viewers, likes}`, `subscriptionLevel{name, currencyPrices}`. No live 200 body or fixture exists yet. Build a sanitized shape fixture from the reference, label it synthetic, and parse defensively.
- **LiveCard states:**
  - live: LIVE badge, title, viewers and likes;
  - scheduled: «Запланирован» with the start time (owner decision Q1 a: live and scheduled cards are both refetched every 30 s while the page is focused);
  - needs level: the level name only, never a price. The reference shows the RUB price, and we deliberately do not.
- **Watching:**
  - Play only when the stream is live, `hasAccess` is true and usable URLs exist. In every other case, OK shows a QR to `https://boosty.to/{blog}/streams/video_stream`.
  - Use live-edge `ok_stream` URLs only, and drop `live_playback_*` (DVR). Skip empty URLs.
  - The URLs are signed CDN URLs: send no Boosty `Authorization` to them, never persist them, and never put them in route params.
  - No seek track, no speed option (1× is fixed), no progress write. Pause is allowed, and play resumes at the live edge.
  - When the engine reports ended, show «Стрим завершён».
- **Heartbeat (E16, `PUT …/video_stream/heartbeat/viewer`):** send it every 30 s while playing, and exactly one `?stop=true` on exit or end, even if the screen unmounts. A failure is not retried immediately and never stops playback.
- **Like (E17, `POST`/`DELETE …/video_stream/like`):** optimistic toggle, at most one request in flight, rollback on failure, no automatic replay. The response body is discarded. The Epic 6 retro found that poll errors collapsed into one generic line. Keep the `AppErrorKind` for like failures instead of collapsing it.
- **Events (E18, `GET /v1/notification/standalone/event/`):**
  - The shape is `LIVE`: `data.notificationStandalone{events[]{id, isRead, type, eventTime, author?, blog?, aggregation?, target?}, count, updateTime}`.
  - Paging is unverified: one event was seen, with no cursor. `video_stream_start` itself was never observed live.
  - `video_stream_start` reads «Начался эфир». Other types get generic text. Comment event types are never shown.
  - Read and unread mutations are out of scope.
- **Entitlement:** an inaccessible stream is `hasAccess=false` plus `subscriptionLevel` (reference only). It is never an error and never a session problem. Do not treat a 403 as an expired session.
- **Tests:**
  - unit: status mapping (204, live, scheduled, needs level, malformed), live-edge URL filtering, heartbeat timing and the single stop, like with no replay and with rollback;
  - component: LiveCard states and focus, QR return, events empty/error/unknown type;
  - device: whatever a real stream allows, reported honestly.

## Technical Decisions

- **`entities/stream`** (repository plus mapper in `shared/entities`) owns E15 and the query key `['stream', blogUrl]`, added to `shared/api/queryKeys.ts`. Features never call E15 themselves. The player invalidates the key when the stream ends or the player exits. The key lives in the account-scoped query cache.
- **References:** a live item is `LiveRef {blogUrl}`. As built, the `Player` route takes `ref: MediaRef` only, and the architecture wants `MediaRef | LiveRef`. `MediaResolver` resolves a `LiveRef` through E15. Recovery runs once automatically (re-fetch E15, pick the same block id), then waits for the user. ProgressRepository never sees a `LiveRef`.
- **Single playback:** the live player claims the PlaybackArbiter slot like VOD. As built, the arbiter is in `src/shared/platform/playbackArbiter.ts`, not in `shared/services` as the architecture text says.
- **Mutations and async work:**
  - E16 and E17 follow the retry policy: no automatic retry, one request in flight per entity.
  - Capture the account generation when a heartbeat or like starts, and drop any work that outlives a sign-out or an account switch.
  - Epic 6 lesson: a follow-up request must not go out with the new account's token after a switch.
- **Phase gating:**
  - The live card is an in-screen entry point with its own flag: `phaseFlags.live`, added in Story 7.1 and shipped on (owner decision 2026-10-30, Q3 a).
  - События uses the existing `events` flag, which is currently `false`. It stays off unless E18 is accepted as verified, and turning it on is an owner call.
- **QR:** «Поделиться» and the not-playable fallback use `externalUrls` (add a stream-page builder) and the existing QrDialog and `QrRenderer`.
- **Focus ids:** `author/<blogUrl>/live`, `author/<blogUrl>/live/like`, `author/<blogUrl>/live/share`, `events/row/<eventId>` and `nav/events`.
- **Tokens:**
  - `live-card`: 520×120, a 192×108 cover, focus scale 1.03;
  - `colors.live`: for the LIVE badge only;
  - Russian copy goes in `ru`.
- **Endpoints:** no new endpoints beyond E15–E18. The Home screen never fetches streams, because polling every subscription would cause a request storm.

## UX & Interaction Patterns

- **Author page:**
  - The order is: action row ↔ LiveCard ↔ the 3-column post grid.
  - Initial focus is the LiveCard when a stream is live, otherwise the first post.
  - From the LiveCard, → goes to «Нравится», and ↓ from «Нравится» goes to «Поделиться».
  - ← from the first column goes to the sidebar.
  - A hidden or absent card is skipped by every transition.
  - When the card disappears, focus falls back to the first post. Refetch never moves focus otherwise.
- **Live player:**
  - The overlay shows a LIVE badge and the elapsed time since `startTime`. There is no timeline.
  - The controls are play/pause, with ← → between controls only.
  - Back hides the overlay first, then exits.
- **Stream ended:** «Стрим завершён» with focus on «Назад». Exiting lands on the Author page with focus on the first post, where the card used to be.
- **QR dialog:** it traps focus in the modal host. «Закрыть» or Back closes it, and focus returns to the initiator («Поделиться» or the LiveCard).
- **События:**
  - It is a sidebar section, hidden while its flag is off.
  - The list shows a skeleton while loading, «Событий нет» when empty, and an error with «Повторить».
  - Initial focus is the first event. ↑ ↓ move between rows, and ← goes to the sidebar.
  - Each EventRow shows the avatar, the text, the author name, the time and an accent unread dot.
  - OK opens the Author page. For a live event, focus lands on the LiveCard. The player is never started directly from События.
  - Back from Автор restores the same row by event id.
- **Home:** no LIVE card on Главная. The family learns about a stream from События.

## Cross-Story Dependencies

- **7.1 comes first.** It creates `entities/stream`, the query key, the stream fixture, the `live` flag and the LiveCard. Stories 7.2, 7.4 and 7.5 depend on it.
- **7.2 extends the Player** (from Epic 4): the `LiveRef` route union, the `MediaResolver` live branch, the overlay without a seek bar, and the ended state. 7.3's heartbeat hooks into the 7.2 player lifecycle.
- **7.4 reuses QrDialog, `QrRenderer` and `externalUrls`** from Story 6.3. 7.2's not-playable QR shares the stream-page URL builder.
- **7.5 needs 7.1** so that a «Начался эфир» row can land on the LiveCard.
- **Epic 8 hides speed for live streams.** Keep a live/VOD distinction that it can read.
- **Docs to update:**
  - `docs/api-contract.md`: E15–E17 `LIVE` evidence when observed, and E18 paging;
  - `docs/feature-parity.md`: Android status for LIVE-01..05 and EVT-01;
  - `docs/focus-map.md`: sections D, G9–G11 and J;
  - `docs/testing.md`: device rows.

## Contradictions and open points (docs and as-built win)

- **Ending detection on the Author page (closed, owner decisions 2026-10-30):** Q1 a: E15 is polled every 30 s while the Author page is focused, for a live and a scheduled card alike (the reference polls only a scheduled stream), so an ended stream's card goes within 30 s. Q2 b: OK on the LiveCard does nothing in 7.1; watching and the QR fallback come with Story 7.2. Q3 a: the `live` flag ships on.
- **E18 status:** Story 7.5 assumes E18 was "verified in Story 1.5". The docs say the shape is `LIVE`, but paging and the `video_stream_start` type are not. Enabling the `events` flag needs an explicit owner decision.
- **No live stream sample:** the E15 200 body, `ok_stream` `playerUrls`, E16 and E17 are reference-only. A device check needs a subscribed blog that is streaming. Otherwise those paths are host-tested and demo-tested only, and must be reported as such.
- **As-built gaps the planning text assumes exist:** `Player.ref` limited to `MediaRef`, and the PlaybackArbiter location. (The `live` phase flag exists since Story 7.1.)
