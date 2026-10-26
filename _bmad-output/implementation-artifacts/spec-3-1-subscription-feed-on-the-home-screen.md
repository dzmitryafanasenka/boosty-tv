---
title: 'Story 3.1: Subscription feed on the Home screen'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: '9b4e644c065dcac5c97697671581a087bed930f2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/adr/0008-api-request-profiles.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Главная still shows the «Лента появится здесь» placeholder; the family cannot see new posts from their subscriptions (FR13, FR14, FR38; epics.md Story 3.1).

**Approach:** Replace the placeholder with the «Новое в подписках» 4-column PostCard grid fed by E5 through TanStack Query `useInfiniteQuery` and a shared Post entity repository (one Zod schema, one mapper, `Block` union with `Unknown`), with skeleton, load-more retry, empty and error states, D-pad-safe focus, and an account-scoped query cache. Then prove E5 on the device with the content profile and measure release-build D-pad latency on a 300+ post feed.

## Boundaries & Constraints

**Always:**
- E5 only: `GET /v1/feed/post/?limit=10&comments_limit=0&reply_limit=0[&offset=<encoded>]`; the opaque `extra.offset` is passed back verbatim; paging stops on `isLast` or a missing `extra`/`offset`. Merge = append, dedupe by `post.id` keeping the first.
- The HTTP client comes from the active `session` (`src/app/session.ts`) via props/context; no `shared/api` singleton; no session concern added to `sessionManager.ts` (ADR 0009).
- Defensive parsing: a post missing `id`, `createdAt`, `int_id` or `user.name` is dropped and logged (no content, no ids beyond the post id); the page never fails for one bad post; unknown block types map to `Block.Unknown`. Missing `hasAccess` = true; empty `data` = locked.
- Domain `Post` exposes no raw DTO fields, no `timeCode`, no `playerUrls`, no `signedQuery`; nothing signed is logged, persisted, keyed or routed. Comments are ignored everywhere (no count, no request).
- PostCard per DESIGN.md PostCard / UX-DR6: 16:9 preview, type badge, 2-line title, avatar · author · date, duration only when the API gives it, locked = dimmed + lock glyph + «Нет доступа». Copy only from the `ru` catalog; tokens only from `shared/ui/tokens.ts`.
- Focus (focus-map §1.5, §3): ids `home/feed/<postId>`, `home/feed/retry`; ← from column 1 → `nav/home`; skeleton keeps focus on the sidebar; first load moves focus to the first card only if the user has not moved; pagination, refetch and image loads never move focus; retry success focuses the first new card. Restoration via `useFocusRestoration` on return to Главная.
- Query cache: `refetchOnWindowFocus: false`, `staleTime` 60 s, `gcTime` 10 min, keys only from `shared/api/queryKeys.ts`; registered with `AccountScope` (cancel, then clear) so sign-out/account switch wipe it.
- `@tanstack/react-query` pinned exactly at `5.104.2` (published 2026-10-11, peer `react ^18 || ^19`, pure JS), recorded in an ADR.
- Live checks: E5 with the content profile on the pinned device using the owner's existing session (no sign-in, no sign-out); D-pad latency on a 300+ fixture feed in a release build. Results recorded honestly (adb vs physical remote; host-only results never called device results).

**Never:**
- No other endpoint, no comment UI/requests, no player entry («Смотреть»), no filters/search/refresh button (Epics 4–5), no Post screen navigation target beyond what 3.4 adds (OK on a card does nothing yet, or is not wired).
- No price, payment or subscribe action on locked cards.
- No new native module, no NetInfo, no Zustand.

**Decisions (owner, 2026-10-26):**
- Card date: «сегодня, 14:30» / «вчера» / «12 окт» (current year) / «12 окт 2025» (device local time, from `publishTime`, else `createdAt`).
- Empty feed: StateView with one action «Обновить» (refetch).
- Spec kept whole (≈2200 tokens) despite the 1600 target.
- OK on a feed card is not wired until Story 3.4 opens Post; the card is focusable for reading only.
- Device review (owner, physical remote, 2026-10-26): the feed grid has **3 columns**, not 4 (bigger cards, less work per frame; DESIGN.md/focus-map updated; applies to the Author grid in 3.3 too). Returning to Главная (e.g. Back from Настройки) **keeps the scroll position and the remembered card**; focus stays on the sidebar and → returns to that card.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First load | signed in, E5 page 1 ok | skeleton (focus on `nav/home`) → 10 cards; focus → first card if untouched | — |
| User moved during load | focus moved off `nav/home` before data | cards render, focus stays where the user put it | — |
| Load more | focus within last row, `isLast=false` | next page appended, deduped, focus unchanged | — |
| Last page | `isLast=true` or no `extra` | no further request | — |
| Load-more failure | page N fails | inline `home/feed/retry` row; OK reloads page N only; success focuses first new card | loaded cards stay |
| Empty feed | `posts: []`, `isLast=true` | StateView empty, one action «Обновить» | — |
| Full-load failure | page 1 Network/Server/Client/Parse | StateView error + «Повторить» | AppError kind → `error.<kind>` copy |
| Malformed post | one post lacks `user.name` | dropped + logged, rest render | — |
| Unknown block | block `type: "foo"` | `Block.Unknown`, card still renders | — |
| Locked post | `hasAccess=false` or empty `data` | dimmed card, «Нет доступа» badge | — |
| Account switch / sign-out | cache holds A's feed | cache cancelled + cleared before B's data | — |

</frozen-after-approval>

## Code Map

- `src/features/home/HomeScreen.tsx` -- placeholder + offline StateView (`HOME_OFFLINE_RETRY_ID`); keep the offline branch; replace the placeholder branch with the feed.
- `src/app/Shell.tsx:253` `SectionContent` renders HomeScreen; `:300-357` content `FocusZone` (`onItemFocus` must be called by grid cards so Back from a card works); `:54` `INITIAL_CONTENT_ID` has no `home`; `:172-187` offline→placeholder focus fix must survive.
- `src/app/App.tsx:357-398` -- boot branch: wrap with `QueryClientProvider`; `ShellRoute` (`:184`) passes props to Shell; `SessionUiContext` precedent in `src/app/sessionUi.ts`.
- `src/app/bootstrap.ts:31-37` -- `accountScope.register(...)`; add the query-cache store; `__tests__/accountScopeRegistry.test.js:52-53` hard-coded store list must be updated.
- `src/shared/api/httpClient.ts` -- `get<T>(path, schema?)` → `{status, body}`; no query/AbortSignal params (build the path, encode `offset`); GET retries Network ×2, Server ×1; schema mismatch → `AppError('Parse')`. `appError.ts:17` kinds. Content profile is applied automatically (`profiles.ts:68`).
- `src/shared/api/dto/userCurrent.ts` -- Zod DTO precedent. New: `dto/post.ts`, `dto/feed.ts`, `shared/api/queryKeys.ts`.
- `src/shared/entities/` (empty) -- new Post entity: domain types, mapper, `PostRepository.feedPage(http, cursor)`.
- `src/shared/focus/useFocusRestoration.ts:64`, `FocusZone.tsx` (`useZoneItem`), `src/app/dev/devFocus.tsx:186-204` -- FlatList grid pattern: explicit height (not `flex: 1`), `getItemLayout` incl. `focus-headroom`, `removeClippedSubviews={false}`, `useFocusEffect` → `restore()`/`focusInitial()`.
- `src/shared/ui/` -- `FocusableSurface`, `StateView`, `Spinner`, `Text`; `tokens.ts` `components['post-card']` (width 168, radius 7, scaleFocus 1.06), `spacing` (`card-gap-x` 16, `card-gap-y` 22, `focus-headroom` 12), `colors.skeleton`, `components.badge`. Note 4×168+3×16 = 720 = `content-width`: no horizontal headroom for the focus scale.
- `src/shared/i18n/ru.ts` -- add `home.feed.*`, badge, date, a11y strings; `catalog.test.ts:36-37` asserts `home.placeholder.*` (update if removed).
- `src/app/dev/demo.ts:46` -- demo transport 404s unknown paths: add an inline E5 answer (app cannot import `src/test`); `__tests__/releaseBundle.test.js` guards dev code.
- `src/test/fixtures/boosty/e5-feed.json`, `e8-post-locked.json`; `scripts/check-fixtures.mjs` (no non-JSON files under fixtures; strict value rules) -- generate the 300-post feed in memory in a `src/test/` helper.
- `src/test/flow.tsx` + `__tests__/shellFlow.test.tsx:62-110` template. Will break: `home/placeholder` assertions in `shellFlow`, `sessionFlow`, `expiredFlow`, `codeFlow`, `signOutFlow`, `accountSwitchFlow` (their transports reject non-E1 paths).
- `docs/api-contract.md:33` and §8 item 3 -- record the E5 content-profile device result.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`/lockfile + `docs/adr/0010-server-state-tanstack-query.md` -- add `@tanstack/react-query@5.104.2` exact; ADR: version evidence, RN setup (no focusManager/NetInfo), retry policy (no retry for `NoAccess`/`NotFound`/`Client`/`Parse`; transport retries stay in HttpClient), cache-clear order -- AD-7 dependency.
- [x] `src/shared/api/dto/post.ts`, `dto/feed.ts` -- lenient Zod schemas for E5/Post/blocks (per-post `safeParse`, unknown blocks pass through) -- defensive parsing.
- [x] `src/shared/entities/post/*` -- domain `Post`, `Block` union (text, image, ok_video, link, list, audio_file, file, poll, Unknown), `PostKind` for the badge, preview selection (first video preview → first image → teaser image → none), `mapPost`, `feedPage(http, cursor)` → `{posts, nextCursor | null}` with dedupe helper -- AD-8/AD-9 single mapper.
- [x] `src/shared/api/queryKeys.ts` + `src/app/queryClient.ts` (client factory, defaults, `queryCacheAccountStore`) + `bootstrap.ts` + `accountScopeRegistry.test.js` -- account-scoped cache.
- [x] `src/shared/ui/PostCard.tsx` + skeleton card -- anatomy, badge, duration, locked state, a11y label, focus states; grid fits 720 with focus headroom (shrink card width; document it).
- [x] `src/features/home/*` -- `useSubscriptionFeed` hook (`useInfiniteQuery`, `initialPageParam: null`), `FeedGrid` (3-column rows in FlashList 2.3.3 per ADR 0011 — originally FlatList `numColumns=4` with `getItemLayout`; end-reached prefetch, retry row), HomeScreen states, focus rules, restoration -- the feature.
- [x] `src/app/App.tsx`, `Shell.tsx` -- provider, pass `session.http`, zone wiring.
- [x] `src/app/dev/demo.ts` -- inline E5 demo page.
- [x] `src/shared/i18n/ru.ts` -- copy.
- [x] Tests: mapper/schema unit tests (every matrix parsing row, synthetic cursors), merge/dedupe, `PostCard` component tests (badge per kind, locked, no comment count, a11y label), `__tests__/homeFeedFlow.test.tsx` on the harness (each focus/matrix row, 300-post in-memory feed via `src/test/feedFixtures.ts`), account switch clears the cache; fix the six broken flow tests by answering E5 (fixture) instead of asserting the placeholder.
- [x] Device: release-like build on the pinned device with the owner's session — E5 with the content profile, cards visible; recorded in `docs/api-contract.md`. D-pad latency judged by the owner on the real feed (~480 posts with images) instead of the synthetic 300+ feed (owner-accepted, 2026-10-26) → `docs/testing.md` Story 3.1.

**Acceptance Criteria:**
- Given the full suite, when run 3×, then all pass; `homeFeedFlow` passes 30× in isolation; lint, typecheck, `check:fixtures` and the release-bundle test pass.
- Given a 300-post fixture feed, when the grid renders, then list items are stable rows keyed by their first `post.id` (cards inside a row are recycled per column, FlashList — ADR 0011), and scrolling to the end requests pages in order with no duplicate cards.
- Given the device run, when E5 is sent with the content profile, then the result (accepted or rejected) is recorded in `docs/api-contract.md`; on rejection the story stops and asks the owner (ADR 0008 amendment).
- Given the release build, when holding D-pad down through the 300+ feed, then latency is recorded (physical remote vs adb labelled) and judged with the owner.

## Implementation Notes

- **Dependency:** `@tanstack/react-query` `5.104.2` exact (`npm install --save-exact`); evidence and setup in `docs/adr/0010-server-state-tanstack-query.md`. Query-level retry is off entirely; HttpClient keeps the AD-6 retries.
- **Entity:** `src/shared/entities/post/` (`types.ts`, `mapPost.ts`, `postRepository.ts`). `PostRepository.feedPage(http, cursor)` → `{posts, nextCursor}`; `mergePosts` appends and dedupes. DTO schemas in `src/shared/api/dto/post.ts` and `feed.ts`.
- **Decision (not in the frozen list):** a post without `user.blogUrl` is also dropped and logged, because routes and keys are `{blogUrl, postId}` (AD-9). The four spec fields (`id`, `createdAt`, `int_id`, `user.name`) are dropped as specified.
- **Card:** `src/shared/ui/PostCard.tsx` (+ `PostCardSkeleton`), memoized. Width 221 = (720 − 2 × 12 headroom − 2 × 16 gap) / 3 (3 columns, owner device review; was 162 for 4); documented in `FeedGrid.tsx` and `docs/focus-map.md` §3. Title falls back to the post's first text, then «Без названия». Duration only for a single-video post with a known duration. Dates in `src/shared/i18n/format.ts` (no `Intl`).
- **Focus:** the Shell passes `HomeFocusInfo` (`isActive`, last focused id, `nav/home`). First cards take focus only while the Shell is active and focus is still on `nav/home` (or none yet) or on the pressed StateView action. Cached cards on remount do not take focus unless the section was opened with OK (then FocusRestoration restores). Empty/error StateViews never take focus by themselves (consistent with the Story 2.5 offline view; → / OK reach them). `useFocusRestoration` gained `focusItem(id)` for the retry-success focus.
- **Retry of a failed first page:** TanStack resets the query to `pending`; the hook keeps the last error while the retry runs, so the error StateView stays with a busy «Повторить».
- **Review fixes (iteration 1):** feed query `refetchOnMount: false` (a remount after `staleTime` would refetch every loaded page; ADR 0010: refresh only by explicit action); a failure with no cards (also a failed «Обновить») is the full error; `nextFeedCursor` stops on any already-used cursor (cycles); a page that adds no card but has a next cursor fetches the next page automatically, `empty` only without a next page; OK-opened Главная no longer steals focus after a sidebar move during the skeleton; OK-opened Главная while offline focuses «Повторить»; a completed load-more retry always clears its wait and, with no new card and the row gone, focuses the last card; `releaseBundle` markers are string literals of `demo.ts`.
- **Device review fixes (owner, 2026-10-26):** 3 columns; the list's items are rows keyed by their first post id (a growing last row no longer remounts and drops focus); focus room via slot padding (11 dp) for Android's native focus scroll instead of a JS `scrollToOffset` on focus (removed `offsetToReveal`: it raced native scrolling); `windowSize` 11, rows in small batches; an end guide under the last row returns ↓ to the focused card; the footer is a stable component fed by context; memoized `PostCard`/`FeedCard`/`FeedRow`; FocusZone refreshes its destination only when an (un)mounted item can change it; keep scroll on return (`initialScrollIndex` of the remembered row, then the remembered offset; no focus move). `resizeMethod="resize"` on the card images by the coordinator.
- **Column-jump root cause (device run, adb):** the 1-card partial last row (10-post pages, 3 columns). `visibleFeedPosts` holds a trailing partial row while `hasNextPage`; Главная's ids, restoration and the retry use the shown posts; a page whose new posts all land in the held row fetches the next page. `windowSize` stays 11 (comment corrected: memory was driven by the decoded-image cache).
- **Native view budget (device profiling, page-arrival mount hitches ≈ 37 ms native work per card):** FocusableSurface merges its scale and surface views (the ring's inset adds the surface border); PostCard's thumb is the Image itself (placeholder View without a preview), badges are single Texts with their own background, the lock glyph is 2 absolutely placed views. Video card: 13 → 9 native views (14 → 10 host nodes); locked card: 14 → 10 native views (now 11 host nodes). Guarded by `PostCard.test.tsx` «native view budget».
- **FlashList (owner decision, ADR 0011):** `@shopify/flash-list@2.3.3` exact replaces the FlatList over the same rows; `drawDistance` 3 rows, recycle pool 6 rows; cards keyed by column inside a row; `useItemState` + `FocusableSurface.resetKey` reset per-item state; preview/avatar `Image`s keyed by URL; `useFocusRestoration` focuses a pending target when it mounts (FlashList renders items after a layout pass). Device (adb, release-like, 2026-10-26): page-mount stall 1.15–1.47 s per 20 rows (FlatList 2.0–2.2 s), columns kept on fast ↓; #1843 not reproduced, so its frame-timed mitigation was removed (it reverted user ↓ moves during mount hitches; ADR 0011 «Device results»).
- **Debug/latency switch:** removed in review pass 2 (`LONG_FEED_CHECK`, the 320-post demo path and its guards): the latency check ran on the owner's real feed. Demo mode keeps its 30-post feed.
- **Tests changed for E5:** `shellFlow`, `sessionFlow`, `expiredFlow`, `codeFlow`, `signOutFlow`, `accountSwitchFlow`, `demoFlow` now answer E5 with the live fixture page and clear the query cache after each test; focus expectations after boot now include the first feed card. `accountSwitchFlow` asserts the query cache is empty at B's phone write.
- **Device runs:** done by the orchestrator with the owner (see `docs/testing.md` Story 3.1 and `docs/api-contract.md` §1).
- **Risk noted:** E5 is sent at Shell mount in parallel with the cold-start E1. With a token the server silently treats as invalid, E5 answers as anonymous (everything locked, api-contract §7) and that page stays cached for up to 60 s. Not addressed in this story.

## Spec Change Log

- 2026-10-26, device review by the owner (physical remote): heavy lag (adb gfxinfo: 100 % janky frames, median 150 ms, Graphics 325 MB, PSS 763 MB — full-resolution previews decoded for 162 px cards), focus jumping columns on fast scroll, a jump to the first card at the end of the list while loading, scroll reset on return. Amended (frozen, by the owner): 3 columns; keep scroll on return. KEEP: E5/paging/parsing, the review-iteration-1 fixes, the focus rules.

- 2026-10-26, device profiling (atrace, release, 20× ↓): page-arrival mount hitches of 300–500 ms remain (~2.1 s per ~60 cards; ~half is Text creation/measure; `createViewUnsafe(RCTText)` ≈ 1.8 ms each). Tried and measured: `resizeMethod="resize"` (kept: Graphics 325→37 MB, janky 100→9 %), `fadeDuration=0` (kept, neutral), card flattening 13→9 native views (kept, −8 %), narrower window / smaller batches (worse, reverted), `textBreakStrategy="simple"` (neutral, reverted). Google TV launcher baseline: median 32 ms, 0 % janky. Owner decision: replace FlatList with `@shopify/flash-list@2.3.3` (view recycling) in this story, with the TV focus risks verified on the device (FlashList #1843). KEEP: 3 columns, held partial row + end guide, restoration on return, focus rules.

- 2026-10-26, AC/Task restatement after the FlashList switch (owner-accepted): list items are 3-post rows keyed by their first post id (no `getItemLayout` in FlashList v2); the latency check ran on the owner's real feed (~480 posts) instead of the synthetic 300+ feed, so the `LONG_FEED_CHECK` switch was removed.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | A remount after `staleTime` refetches every loaded infinite page (≈31 E5 calls on 300 posts) (blind, edge) | medium | patch: `refetchOnMount: false`; freshness policy deferred |
| 2 | A refetch error with no posts (empty «Обновить» fails) shows nothing (blind) | medium | patch: no posts + error → error phase |
| 3 | First page with all posts dropped but a next cursor shows «empty»; a page that adds nothing stalls paging (blind, edge) | medium | patch: auto-fetch next while the list did not grow and `hasNextPage`; empty only when `!hasNextPage` |
| 4 | Cursor guard catches only an immediate repeat (A→B→A loops) (blind, edge) | low | patch: stop when the cursor is in `allPageParams` |
| 5 | With `pendingMountFocus`, arriving cards steal focus after the user moved within the sidebar (edge) | medium | patch: same "has not moved" check for the OK path |
| 6 | Offline Главная opened with OK from another section no longer focuses «Повторить» (Shell dropped `focusOnMount` for HOME) (edge) | medium | patch: offline phase takes the mount focus |
| 7 | Load-more retry that adds no ids leaves `retryFrom` set; focus lost if the row goes (blind, edge) | low | patch |
| 8 | Cached remount via Back is untested; `gridListAdapter` item→row conversion untested (verification-gap) | medium | patch: two tests |
| 9 | `'LONG_FEED_POSTS'` release marker is a minifiable identifier (blind, verification-gap) | low | patch: string literal |
| 10 | E5 races the cold-start E1 (anonymous page cached); same-account re-login keeps the cache; no resume invalidation (AD-7) (blind) | medium | defer: deferred-work "Feed freshness (AD-7)", owner policy needed |
| 11 | `FocusZone.focusTarget` for Главная ignores restoration; zone remembers retry/state ids over cards; `focusAbove` is null in the grid (edge) | low | defer: matters once Post returns exist (3.4); deferred-work entry |
| 12 | Demo/long-feed paging is tested only on page 1 (verification-gap) | low | defer: deferred-work entry; visible during the device run |
| 13 | `LONG_FEED_CHECK=true` would ship the demo session in release; guarded only by a test (blind, edge) | low | patch at the device step: release-checklist line in `docs/testing.md` |
| 14 | Device docs (api-contract E5, testing latency, feature-parity) missing while in review (blind) | false | the device task is the orchestrator's pending step with the owner; docs are written there before `done` |
| 15 | Spec `in-review` vs sprint `in-progress` (blind) | false | the workflow sets sprint `review` at completion (step 5) |
| 16 | Slow Back to Главная after `gcTime` lets the first card take focus (blind) | low | rejected: matches the spec rule (focus on `nav/home`, user has not moved since); same as cold start |
| 17 | Refetch grid→empty/error or reorder while a card is focused loses focus (edge) | false | after #1 and #2 no background refetch runs and an error with posts keeps the grid |
| 18 | `kindOf` defaults to «Текст и фото» for unknown-only posts; video nested in `list` not counted (blind, edge) | low | rejected: no such live shape in fixtures (list holds text, api-contract §4); cosmetic |
| 19 | Non-AppError mapped to `Client` copy (blind) | low | rejected: generic copy is correct for an unexpected failure; the error is logged |
| 20 | Card dates go stale after midnight until re-render (blind) | low | rejected: cards re-render on any return to Главная; a clock tick adds complexity for a cosmetic label |
| 21 | `useSubscriptionFeed` returns new closures each render (blind) | low | rejected: no measured cost; the release latency check is the arbiter |
| 22 | ADR 0009 accepted inside this story's change set (blind) | low | rejected: owner decision recorded in this run's checkpoint; noted in the PR |
| 23 | Pass 2: auto-fetch on "page added nothing" has no cap (request storm on schema drift) (blind, edge) | medium | patch: cap 3 consecutive no-growth fetches |
| 24 | Pass 2: pending restoration focus fires after the Shell is covered or the user moved to the sidebar; cancel only on unmount (blind, edge) | medium | patch: active/not-moved gate + cancel on blur |
| 25 | Pass 2: `focusAbove` in the grid focuses `null`; `focusInitial` give-up untested (verification-gap, edge) | low | patch: give up to `nav/home`; test (supersedes #11's `focusAbove` part) |
| 26 | Pass 2: held partial row stays hidden while load-more keeps failing (edge) | low | patch |
| 27 | Pass 2: FocusableSurface ring radius not derived from the new inset; overflow/opacity rule only a comment (blind, edge) | low | patch |
| 28 | Pass 2: `LONG_FEED_CHECK` unused yet a release hazard (blind, edge) | low | patch: machinery removed |
| 29 | Pass 2: stale docs/comments (focus-map FlatList bullets, ADR 0011 status/consequences/tvOS/rollback trigger, "4-column" comment, spec device task/AC) (blind, edge) | low | patch: docs by the implementer; spec Tasks/AC restated by the orchestrator (change log) |
| 30 | Pass 2: verification gaps — refetchOnMount after staleTime, FocusZone destination fallback on unmount, recycled-cell avatar/pressed/scale reset (verification-gap) | medium | patch: tests |
| 31 | Pass 2: account-scope "cancel, then clear" not tested with an in-flight E5; E5 401/SessionExpired paths untested (blind) | medium | patch: tests |
| 32 | Pass 2: PostCard without preview lacks the avatar plate (DESIGN.md) (blind) | low | defer: deferred-work entry (no poll/file posts seen yet) |
| 33 | Pass 2: retry row focus overwrites the remembered card (edge) | low | carried (#11, deferred) |
| 34 | Pass 2: focused card recycled loses its ring (edge) | false | the focused card is on screen; FlashList recycles only cells outside the draw distance |
| 35 | Pass 2: nested `list` blocks not counted for kind/preview (edge) | low | carried (#18, rejected) |
| 36 | Pass 2: retry-success effect may clear `retryFrom` before fetching starts (edge) | maybe-false | rejected: `fetchNextPage` sets `isFetchingNextPage` in the same render as the retry press; no repro; at most low |
| 37 | Pass 2: lockfile missing from the reviewed diff (blind) | false | excluded from the review diff only for size; committed with the change |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `for i in $(seq 30); do npx jest __tests__/homeFeedFlow.test.tsx --silent || break; done` -- 30/30.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- BUILD SUCCESSFUL.

**Manual checks:**
- Device (Chromecast with Google TV 4K): feed loads with the owner's session; ← to sidebar, Back, scroll, load-more; release latency on 300+ cards.
