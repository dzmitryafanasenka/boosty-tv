---
type: architecture-review
lens: adversarial (compatible-by-letter, incompatible-in-fact unit pairs)
target: ../ARCHITECTURE-SPINE.md
inputs: [prd.md, EXPERIENCE.md, CLAUDE.md, docs/api-contract.md]
date: 2026-10-25
reviewer: adversarial spine reviewer (review only, no edits)
---

# Adversarial Review — Architecture Spine, Boosty TV

## Verdict

**Not yet a safe build substrate.** The spine's ADs are individually sound, but they leave the *seams between features* unspecified. Because AD-1 forbids feature-to-feature imports while AD-8 puts DTO→domain mapping in per-feature repositories, independent teams/agents obeying every AD will produce several Post mappers, two E15 owners, two poll caches, two progress truths and incompatible navigation params. Three gaps are critical (they block the P1 slice from composing at all or make Continue/resume unbuildable as written). All are closable with tightened or new ADs; none requires changing the paradigm.

| Severity | Count |
| --- | --- |
| Critical | 3 |
| High | 9 |
| Medium | 8 |
| Low | 3 |
| **Total** | **23** |

Format per finding: **Units A / B** · what each does while obeying the ADs · the clash · severity · AD to add or tighten.

---

## Critical

### C1 — Cross-feature composition is impossible under AD-1 (post ↔ polls/audio/player; home ↔ player; events ↔ author)
- **A: `features/post`** renders the post screen. FR-40/41 put the poll inside the post; FR-39 puts audio inside the post; FR-32/33 navigate to the player. AD-1: it may not import `features/polls` or `features/player`.
- **B: `features/polls`** builds `PollBlock` + `useVote` as its own slice (Capability map: "Polls → features/polls").
- **Clash:** Post cannot render PollBlock without importing polls. Each team "fixes" it legally but differently: post team copies a read-only poll renderer into `post/`; polls team moves PollBlock into `shared/ui` (which then needs hooks → `shared/ui` importing feature hooks is also illegal) — or `app/` injects a render-prop registry. Same for home/post/author → player navigation: route names and param types must live somewhere both can import; nothing says where, so each feature declares its own `PlayerParams` type.
- **Severity:** critical (blocks P1 slice: post → player; P2 polls/audio).
- **AD to add — AD-17 Composition & routes:** (a) `src/app/routes.ts` (or `shared/navigation/routes.ts`) is the *only* declaration of route names and typed params; features import it, never each other. (b) Embedded cross-feature widgets (PollBlock, AudioBlock) are injected via a slot registry composed in `app/` (`post` declares `renderPoll(postRef, poll)` slot, `app/` binds it to `features/polls`), **or** polls/audio are declared sub-modules of `features/post` — pick one and state it. Update the Structural Seed accordingly.

### C2 — N independent Post DTO→domain mappers (AD-8 + AD-1)
- **A: `features/home`** repository maps E5 `data.posts[]` → `Post`. **B: `features/author`** maps E4; **search** maps E6/E7 `searchPosts[].post`; **post** maps E8; **player/MediaResolver** maps E8 again to find the Media by id; **polls** maps E10 Poll and post maps embedded `post.poll`.
- **Clash:** AD-8 says "repositories map DTOs to domain types", and AD-1 forbids sharing repositories between features. Five mappers of the same `PostDto` diverge: one drops posts missing `int_id` (reference rule), another degrades the card; one keeps `ok_video` without preview, another drops it (contract §4.1); one stringifies `id` (conventions), another keeps the number for `pollId`; quality mapping (contract §6) duplicated in post and player. The same post renders differently in feed vs post screen, and media ids may not match across the two → progress lookups miss.
- **Severity:** critical (silently breaks AD-9 identity and AD-10 progress joins).
- **AD to tighten — AD-8:** "Exactly one mapper per DTO, located in `shared/api/mappers/` (`mapPost`, `mapBlock`, `mapMedia`, `mapPoll`, `mapStream`, `mapQuality`). Feature repositories compose endpoints and call these mappers; they never map DTO fields themselves." Optionally add `shared/api/repositories/` for endpoints used by ≥2 features (E8, E15) — see H4.

### C3 — Continue history entry and resume cannot be built from the declared interfaces
- **A: `features/player`** obeys AD-10: calls only `ProgressRepository.report(mediaId, positionSec, event)`.
- **B: `features/home`** renders the «Продолжить» card (FR-14/15: preview, title, author, «осталось 12 мин», progress bar) and, on OK, opens the player, whose `MediaResolver` (AD-11) takes `{postId | blogUrl-stream, mediaId, preferredQuality}`.
- **Clash:** (1) `report()` carries no title/preview/author/duration/postId/blogUrl, so the sole writer of Continue history cannot create a renderable entry; teams will either widen `report` ad hoc or have home re-fetch E8 per card (request storm, breaks offline Continue). (2) E8 is `GET /v1/blog/{blogUrl}/post/{postId}` — `MediaResolver`'s input lacks `blogUrl`, so home cannot resolve the media at all. (3) AD-10 "finished ≥95 % or <30 s left" is computed "only here" but `ProgressRepository` never receives duration.
- **Severity:** critical (FR-15, FR-43, FR-49 are P1).
- **AD to tighten — AD-10 + AD-11:** define the types in `shared/domain`:
  - `MediaRef = { blogUrl, postId, mediaId }` (stream: `{ blogUrl, streamId, mediaId }`) — the only player/resolver/navigation input; `MediaResolver.resolve(ref, preferredQuality)`.
  - `ProgressRepository.begin(ref, meta: { postTitle, mediaTitle?, authorName, previewUrl (unsigned), durationSec })` once at playback start, then `report(mediaId, positionSec, event)`. Continue entry = `{ ref, meta, positionSec, durationSec, updatedAtMs }`. Preview URLs stored must be verified unsigned (AD-9/AD-14).

---

## High

### H1 — Poll lives in two caches; vote updates only one
- **A: `features/polls`** obeys AD-6/AD-7: after E11/E12 it re-fetches E10 into `['poll', blogUrl, pollId]` (FR-41 "re-fetched after every response").
- **B: `features/post`** renders the poll from `post.poll` in `['post', postId]` (it is part of the Post domain type and E8 response).
- **Clash:** after voting, the post screen (or a re-open from cache) shows the stale poll from the post cache; whichever component reads `post.poll` contradicts the polls cache. Feed card «Опрос» badge reads the feed cache, a third copy. AD-7 says "a mutation invalidates or sets only keys from the factory" but not *which*.
- **Severity:** high.
- **AD to tighten — AD-7:** "An entity has exactly one canonical query key. Embedded copies are seeds only: `post.poll` seeds `['poll', blogUrl, pollId]` via `setQueryData` at post load, and UI always reads the poll through the poll key. Each mutation lists its invalidation set in `queryKeys.ts` (vote → `poll` key; `setQueryData` patch of `['post', postId].poll`)." Same rule for stream like (H4).

### H2 — Two sources of truth for displayed progress (post/home vs ProgressRepository)
- **A: `features/post`** shows MediaRow progress, «Просмотрено», picks "first unfinished Media" (FR-33) and the «Продолжить/С начала» split from `Media.timeCode` in the cached `['post', postId]` (it's in the domain Media via E8).
- **B: `ProgressRepository`** (AD-10) holds the newest local position and writes E9; it is not a TanStack mutation, so nothing invalidates `['post', postId]` or feed caches.
- **Clash:** returning from the player (FR-49 "focus on next unfinished Media"), the post screen still shows pre-playback timeCode; "first unfinished" and the restore target are wrong; feed cards show old bars. Teams either add invalidation inside ProgressRepository (shared → knows feature keys) or each screen refetches on focus (refetch moves focus, violating FR-11).
- **Severity:** high.
- **AD to tighten — AD-10:** "All progress *reads* (bars, finished badges, resume point, first-unfinished) go through `ProgressRepository` selectors (`useProgress(mediaId)`, `isFinished(mediaId)`), which merge server `timeCode` (fed to it by the shared Post mapper on every post load) with local state. Screens never read `Media.timeCode` directly." Also define "newer" (H7).

### H3 — Filter state: two owners, three shapes, unstable query keys
- **A: `features/home`** stores Feed Filters in Zustand (Conventions: "Filters per scope live in Zustand") with period as `{fromMs, toMs}` computed at selection.
- **B: `features/search`** stores filters in `shared/storage` (Capability map: "filter state in shared/storage"), period as preset `'last7d'`, tags as feed-tag ids; **`features/author`** stores author-scope filters keyed by `blogUrl`, tags from E14.
- **Clash:** (1) Two stores for one concept, contradictory per the spine itself. (2) Scope identity undefined: does Search «по подпискам» share the Feed filter? Is Author-search sharing Author filters? (3) A relative preset resolved at render ("last 7 days" → `Date.now()`) inside `['feed', filter]` changes the key each render → refetch loop and focus jumps. (4) Flow 3 requires filters to survive re-login (and implicitly restarts?) — persistence undefined. (5) Feed tags (E13) and Author tags (E14) are different id spaces; one shared `Filter.tags` field mixes them.
- **Severity:** high.
- **AD to add — AD-18 Filter model:** `Filter = { access: 'allowed'|'all'|'bought', period: {kind:'all'|'7d'|'30d'|'3m'} | {kind:'custom', fromDay, toDay /* local ISO date */}, tagIds: string[] }`, scoped by `FilterScope = 'feed' | 'search-feed' | {author: blogUrl}` (state explicitly whether feed and search-feed share). One Zustand store in `shared/storage/filters`, persisted or not (decide), registered with AccountScope. Conversion to `from_ts/to_ts` happens only in the repository at request time; query keys contain the *serializable filter*, never resolved timestamps.

### H4 — Live stream entity (E15) owned by both author and player
- **A: `features/author`** fetches E15 for the LiveCard (refresh every 30 s while scheduled), owns optimistic like (E17) on it.
- **B: `features/player`** `MediaResolver` re-fetches E15 for recovery (AD-11), owns heartbeat (E16), detects «Стрим завершён».
- **Clash:** each builds its own E15 repository/mapper (AD-1); one keeps `live_playback_*` DVR URLs, the other drops them (contract §4.1). The player learns the stream ended but cannot invalidate author's stream key (no factory key exists for streams), so Back lands on an author page still showing the LIVE card — contradicting Flow 5 "focus on first post where LiveCard used to be". The 30 s author poll keeps running under the player (native-stack keeps the screen mounted) alongside heartbeats.
- **Severity:** high.
- **AD to tighten — AD-7/AD-11:** add `['stream', blogUrl]` to the factory as the single owner (shared stream repository + `mapStream`). Player's end-of-stream sets/invalidates that key. Polling queries are disabled when their screen is not focused (`useIsFocused`/`enabled`).

### H5 — Audio "only one track app-wide" has no owner; collides with the video player
- **A: `features/post`** AudioBlock instantiates `PlayerEngine` (AD-2) and stops on post unmount.
- **B: `features/player`** instantiates its own `PlayerEngine` for video.
- **Clash:** opening a video from the same post pushes the player on top; the post is *not* unmounted in native-stack, so audio keeps playing under video. "Only one track app-wide" is unenforceable without a shared owner; two engines also compete for audio focus. Each team writes its own singleton.
- **Severity:** high (P2, but shapes the PlayerEngine port now).
- **AD to add — AD-19 Playback arbitration:** a `PlaybackArbiter` in `shared/services` grants one active session (`audio:<mediaId>` | `video:<mediaId>` | `live:<blogUrl>`); acquiring one stops the other. Audio stops on post blur (not only unmount).

### H6 — Player route params and origin/return contract undefined
- **A: `features/post`** navigates `Player` with the full `Media` object (already in hand, including `playerUrls`) and `startAt: 0` for «С начала».
- **B: `features/home`** navigates with `{mediaId}` only from the Continue card; **events/author** navigate with `{blogUrl}` for live.
- **Clash:** the player accepts one shape; whichever it picks, another origin breaks. Passing `Media` puts signed URLs in navigation state (persisted/serialized/dev-logged) — violates AD-9 "transient" and AD-14. FR-49 "exit to origin with focus on next unfinished Media" needs the player to tell the origin something, but the spine only has FocusRestoration saving the *clicked* row (see H8).
- **Severity:** high.
- **AD to tighten — AD-17 (routes) + AD-9:** `Player` params = `{ ref: MediaRef, start: 'resume'|'beginning', kind: 'vod'|'live' }` — ids only, no URLs, no DTOs. Navigation params are serializable ids everywhere (lint/type rule).

### H7 — `resumePoint` "newer of server and local" is undecidable; units of positions undefined
- **A: `ProgressRepository`** implements `resumePoint(mediaId)` = newer of server `timeCode` and local position (AD-10).
- **B: shared Post mapper / post feature** supplies `timeCode` (seconds, no timestamp).
- **Clash:** server `timeCode` carries no write time, so "newer" cannot be computed; implementers choose "max position" vs "local wins if exists" — opposite behaviors after «С начала» (max keeps the old far position). Plus Conventions say "times inside the app are epoch ms", which a player team reads as "positions in ms" while AD-10 says `positionSec`.
- **Severity:** high (SM-4 accuracy).
- **AD to tighten — AD-10 + Conventions:** state the precedence rule (e.g. "local entry with `updatedAtMs` wins if it exists and was written after the post was fetched; otherwise server") pending S8, and the unit table: instants = epoch ms; positions/durations = seconds (float in player, integer floor only at E9).

### H8 — FocusRestoration keyed by route key vs explicit return targets
- **A: `FocusRestoration`** (AD-12) saves `{focusId, scrollOffset}` per route key before forward navigation and restores on return.
- **B: `features/player`** at end of playback must land focus on the *next unfinished* MediaRow (FR-49) or the primary button; Flow 5 wants first post where the LiveCard was; Events wants the LiveCard focused on a fresh author route.
- **Clash:** two writers of the restore target — the saved clicked row vs the player's override — and no API for the override, so the player team writes into the store with a guessed focusId string, while post reads its own. Also: section switches via the sidebar may recreate routes (new keys) so "→ returns to the last content focus" and Главная restoration get lost depending on how each team implements section navigation (navigate vs reset).
- **Severity:** high.
- **AD to tighten — AD-12/AD-13:** (a) sections are a persistent root (tabs or one stack per section) so route keys survive section switches; (b) add `FocusRestoration.setReturnTarget(routeKey, focusId)` and a rule that the *origin* screen computes the fallback (e.g. post recomputes "next unfinished" via ProgressRepository on focus); (c) focus ids built only through `shared/focus` helpers (`focusId('post','media',mediaId)`), not string literals.

### H9 — AccountScope registration timing and in-flight work leak across accounts
- **A: `features/search`** creates its filter store lazily when the Search module first loads and registers with AccountScope then.
- **B: `features/auth`** on account switch calls `AccountScope.reset()` (AD-4).
- **Clash:** if Search was never opened this run, its persisted filters were never registered → not wiped → new account sees old filters. In-flight queries started under account A resolve after `reset()` and repopulate the cache; `ProgressRepository`'s pending "re-send latest position" E9 (AD-6) fires with account B's token → writes A's progress into B's account.
- **Severity:** high (FR-7, NFR-1 isolation).
- **AD to tighten — AD-4:** registration is static at app bootstrap (a registry list in `app/` or in `shared/services/accountScope.ts`), never lazy. `reset()` order: cancel queries (`queryClient.cancelQueries`) → drop pending mutation/E9 queues → clear stores → clear secure items; queued work is stamped with `accountId` and dropped on mismatch.

---

## Medium

### M1 — Sign-out "calls `AccountScope.reset()` only" vs SessionManager sole token writer
- **A: auth** calls only `AccountScope.reset()` (AD-4). **B: SessionManager** is the only token writer (AD-3); tokens are not on AD-4's list.
- **Clash:** either tokens survive sign-out, or AccountScope reaches into SecureStore keys owned by SessionManager. **Fix (AD-3/AD-4):** `SessionManager.signOut()` clears tokens and then invokes `AccountScope.reset()`; state that ordering.

### M2 — Stored phone and account id: writer and ordering
- **A: auth** stores the newly entered phone at sign-in. **B: account-switch detection** then runs `reset()`, which wipes the stored phone and the account id (AD-4, FR-7).
- **Clash:** new account ends with no stored phone and no stored id (next sign-in can't detect a switch). **Fix (AD-4):** sequence = E1 → compare → reset if different → *then* persist phone and `accountId`; name the single owner (SessionManager or an `AccountStore`).

### M3 — Session expiry vs player's best-effort write
- **A: app root** subscribes to `status: expired` and replaces the stack with A11. **B: player** must write progress first (FR-5) on unmount.
- **Clash:** unmount write goes out with the dead token → 401 → does it trigger a new refresh (AD-3 says reactive refresh once on 401)? Storm/loop risk; also race with navigation. **Fix (AD-3):** in `expired` state HttpClient rejects without refresh; progress for expired state is saved locally only (Continue history), E9 retried after re-login if same account.

### M4 — `sections` config gates sidebar only; sub-feature phase gating has no rule
- **A: author** shows search-in-author, filters and LiveCard (P2) behind its own flag. **B: home** hides filters/«Обновить» via `sections.home.filters`; **settings** shows «Системный видеоплеер» based on a third flag; **events** gating is "E18 verified" (runtime? build?).
- **Clash:** inconsistent gates → dead-end entry points (FR-9 "no dead-end sections"), e.g. EventRow → author page with LiveCard disabled. **Fix (AD-13):** `appConfig.capabilities` keyed by FR id (`FR-21: false`) is the single gate for sections *and* in-screen affordances; build-time only.

### M5 — QR handoff payload and web URLs built in multiple places
- **A: author** builds the stream page URL for «Поделиться» (FR-25). **B: player** builds it again for "not playable" (FR-22); **settings** builds the release URL; **post** builds file URLs (`url + signedQuery`).
- **Clash:** different URL formats for the same page; the web host isn't in `appConfig` (only API host); signed file URLs travel through the modal host params. **Fix (Conventions/AD-14):** `shared/domain/links.ts` builds every outward URL (`streamPageUrl(blogUrl)`, `postPageUrl`, `releaseUrl`) from `appConfig.webHost`; QR payload type = `{ url, kind, redact: boolean }`, never logged.

### M6 — Modal host ownership of feature content and state
- **A: app modal host** renders all overlays (AD-13). **B: home/search/author** each need the filter SideSheet with live state; player needs the settings sheet.
- **Clash:** teams either pass React elements (state ownership unclear, focus-return to initiator undefined) or register named modals with props; player builds its own in-screen sheet to keep controls synced, giving two Back handlers. **Fix (AD-13):** `useModal().open(id, props)` API in `shared`; modal content components are feature-provided via the C1 registry; initiator focusId passed and restored by host. State whether the player's settings sheet is an exception.

### M7 — Search feed scope and Author posts share/mismatch query keys
- **A: author** uses `['author', blogUrl, 'posts', filter, query]` with `query=undefined` for E4. **B: search** uses the same key with `query` for E7, but a different mapper/page shape (`searchPosts[].post` vs `data[]`); search-feed scope has no listed key and may reuse `['feed', filter]` + query → E5 vs E6 shapes under one key family.
- **Clash:** cache collisions or misses; two features owning one key. **Fix (AD-7):** enumerate all keys and the single feature/repository owning each; pages normalized to `Page<Post>` by the shared mapper.

### M8 — Time units at boundaries
- **A: author/search repositories** convert local day ranges to `from_ts/to_ts` (FR-29); **post** maps `createdAt` (s) and audio `duration` (s). **B: Conventions** "times inside the app are epoch ms".
- **Clash:** end-of-day rounding (`23:59:59.999` ms → floor vs ceil seconds), durations in s vs ms across Media/audio/player. **Fix (Conventions):** explicit unit table (instants ms; durations/positions s; conversion helpers in `shared/domain/time.ts`; `to_ts` = end of day floored to s, inclusive).

---

## Low

### L1 — i18n key naming for errors
Same `AppError.kind` needs different copy per surface («Не удалось загрузить ленту» vs «Не удалось воспроизвести видео», NotFound → «Пост недоступен»). "Copy keyed by kind" vs per-feature keys will diverge. **Fix:** key scheme `errors.<surface>.<kind>` with `errors.default.<kind>` fallback; plurals via a typed helper.

### L2 — UpdateChecker vs AD-1/AD-6
`UpdateChecker` is a service, not a repository, yet calls GitHub; it will either use `HttpClient` (inheriting Boosty retries/refresh semantics) or raw `fetch`. **Fix:** state that it uses a separate anonymous transport, no auth, no retries beyond the 1/day + 60 s throttle.

### L3 — Player preferences (quality, speed, system player) location
Settings writes «Системный видеоплеер», player writes quality/speed; both need them, neither may import the other; account-scoping unstated. **Fix:** `shared/storage/playerPrefs` (device-global, explicitly not account-scoped) and note it in AD-4.

---

## Suggested AD changes (summary)

| AD | Change |
| --- | --- |
| AD-1 / new AD-17 | Central typed routes; cross-feature widget slots composed in `app/`; nav params are ids only (C1, H6) |
| AD-8 | One mapper per DTO in `shared/api/mappers`; shared repositories for E8/E15 (C2, H4) |
| AD-10 / AD-11 | `MediaRef {blogUrl, postId, mediaId}`; `begin(ref, meta)`; progress reads only via ProgressRepository; precedence rule; units (C3, H2, H7) |
| AD-7 | Canonical key per entity; per-mutation invalidation sets; full key list with owners; stream key; pause polling off-screen (H1, H4, M7) |
| new AD-18 | Filter model, scope identity, storage, request-time timestamp resolution (H3) |
| new AD-19 | PlaybackArbiter for single active audio/video/live session (H5) |
| AD-12 / AD-13 | Persistent section roots; return-target API; focus-id helpers; modal host API; capability flags by FR id (H8, M4, M6) |
| AD-3 / AD-4 | Static registration; reset ordering incl. query cancel and queue drop; sign-out/token ordering; phone/accountId sequencing; expired-state no-refresh (H9, M1, M2, M3) |
| Conventions | Unit table; outward URL builders + webHost; i18n error key scheme (M5, M8, L1) |
