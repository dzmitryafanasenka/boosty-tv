---
title: 'Story 3.3: Author page'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: '2e061b3faa29681a26a904fe4c6fd26b2a957d2a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/adr/0011-feed-list-flashlist.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** OK on an author tile in Подписки does nothing; the family cannot browse one creator's posts (FR20, AUTH-PAGE-01..03; epics.md Story 3.3).

**Approach:** Add the `Author {blogUrl}` stack route: a header from E3 (avatar, title, owner name) and the author's posts from E4 (paged, `limit=20`) in the same 3-column PostCard grid as Главная, with skeleton, empty, error and unavailable states and the 3.1/3.2 focus rules. OK on a Подписки tile opens it; Back pops to the same tile. Prove E3/E4 with the content profile on the device.

**Decisions:**
- OK on a post card on the Author page does nothing until Story 3.4 builds the Post route (as feed cards in 3.1). The return-from-post restoration (epic AC 2) is built and host-tested here with a stand-in pushed route; its device check lands with 3.4.
- No live card, search, «Фильтры», «Сбросить» (phase-gated: Epics 5, 7). Initial focus: the first post.
- Sidebar (owner decision 2026-10-27, option A): the Author page shows the same sidebar as the Shell (one shared component, enabled sections), current item = Подписки (the origin section). ← from column 1 → the sidebar's current item; → from the sidebar → the remembered post. OK on a sidebar item pops to the Shell and opens that section (on its sidebar item, as OK in the Shell). Back anywhere on Author (content or sidebar) pops (focus-map D). Story 3.4 Post follows the same pattern.

## Boundaries & Constraints

**Always:**
- E3 `GET /v1/blog/{blogUrl}` and E4 `GET /v1/blog/{blogUrl}/post/?limit=20&comments_limit=0&reply_limit=0[&offset=<encoded>]` only, through `AuthorRepository`/`PostRepository` with the active session's `http` (props, no singleton). `blogUrl` already passed `blogUrlSchema`; encode it as a path segment anyway.
- E4 paging = E5 rules: opaque cursor verbatim, stop on `isLast`/missing `extra`/used cursor, dedupe by `post.id`, auto-fetch of an empty page capped at 3, `refetchOnMount: false`, query-level `retry: false`. Keys from `queryKeys` (`author(blogUrl)`, `authorPosts(blogUrl)`): no cursor, no signed value.
- Reuse, not copy: Главная's grid and paging hook move to `shared` and serve both screens; Главная's behaviour and its tests stay unchanged.
- Header: avatar (placeholder), title («Без названия» fallback), owner name line only when present. No description, cover, counters, price or subscribe action.
- Ids: cards `author/<blogUrl>/post/<postId>`, the StateView action `state/author/action`, the load-more row `author/<blogUrl>/retry`. Every focusable has a Russian a11y label from `ru`.
- Focus: skeleton gives no content focus; the first post takes focus once loaded unless the user moved; pagination, refetch and images never move focus; restoration by post id with the fallback chain on return to the route.
- States: skeleton (header + 2 rows); empty «Публикаций нет»; error `error.<kind>` + «Повторить» (retries the failed request(s) only); E3 404 `blog_not_found` → «Автор недоступен» + «Назад» (pops), no retry. A locked post is a normal (dimmed) card; never a session problem.
- Subscriptions → Author: OK on a tile navigates with `{blogUrl}`; Back pops; the Shell refocuses the same tile (`subs/tile/<blogUrl>`).

**Never:**
- No Post route, comments, live card, search, filters, «Мой блог», likes. No changes to `sessionManager.ts`. No new endpoints or params (`is_only_allowed`, tags, dates stay unused).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Loaded | E3 200, E4 20 posts, `isLast=false` | header + 18 cards (partial row held), next page on focus in last row | — |
| Last page | E4 `isLast=true`, 7 posts | 7 cards (no hold) | — |
| No posts | E4 `data: []`, `isLast=true` | header + «Публикаций нет», nothing focusable in content | — |
| Locked posts | `hasAccess=false` items | dimmed «Нет доступа» cards, focusable | — |
| Missing blog | E3 404 `blog_not_found` | «Автор недоступен» + «Назад» | Back/«Назад» pop |
| E3 fails, other kind | Network/Server/Parse | full error StateView «Повторить» | retry refetches E3 (and E4 if it failed) |
| E4 page 1 fails | E3 ok | header + error StateView «Повторить» | retry page 1 |
| E4 page N fails | cards loaded | inline «Повторить» row, cards stay | retry that page only |
| Malformed post | no `id`/`user.blogUrl` | dropped + logged (post id only) | page never fails |
| Return | Back from Author | Подписки, focus on the same tile, same scroll | fallback chain if the tile is gone |

</frozen-after-approval>

## Code Map

- `src/app/routes.ts`, `src/app/App.tsx` -- add `Author: { blogUrl: string }` and an `AuthorRoute` (like `ShellRoute`; `http={session.http}`, `routeKey={route.key}`, `onBack={navigation.goBack}`); `SHELL_RESTORATION_KEY` pattern for Shell. FocusRestoration `forget(route.key)` on Author unmount.
- `src/app/Shell.tsx` -- pass `onOpenAuthor(blogUrl)` to `SubscriptionsScreen`; on pop the existing `useFocusEffect` refocuses via `contentRef.focusTarget()` (FocusZone remembers the tile). Sidebar (decision A): extract the sidebar (`TVFocusGuideView` + wordmark + `NavItem` list, `NAV_ID`, `styles.sidebar`) into one shared component in `src/app` used by Shell and `AuthorRoute`; `AuthorScreen` (in `features`, cannot import app) gets the content area and a `focusSidebar`/sidebar-destination hookup through props. "OK on a sidebar item" on Author: pop, then tell the Shell to open that section (e.g. a pending section in the Shell route params or a small app-level handshake); OK on Подписки from Author = pop to the tile.
- `src/features/subscriptions/SubscriptionsGrid.tsx`, `SubscriptionsScreen.tsx` -- wire `onPress` on tiles to `onOpenAuthor`.
- `src/features/home/FeedGrid.tsx`, `useSubscriptionFeed.ts`, `HomeScreen.tsx` -- source of the grid (`visibleFeedPosts`, `feedRows`, row adapter, EndGuide, footer/RetryRow, FlashList params) and paging (`nextFeedCursor`, `MAX_AUTO_FETCHES`, `lastError`, auto-fetch). Move into `src/shared/ui/PostGrid.tsx` (ids/testIDs by prefix props) and `src/shared/entities/post/usePagedPosts.ts` (query key + page fn + enabled); Главная keeps its exports (`FEED_RETRY_ID`, `feedCardId`, constants) as re-exports or thin wrappers so `__tests__/homeFeedFlow.test.tsx` passes unchanged.
- `src/shared/entities/post/postRepository.ts` -- add `blogPostsPath(blogUrl, cursor)`, `BLOG_POSTS_PAGE_SIZE = 20`, `blogPage(http, blogUrl, cursor)`; E4 body `{data: Post[], extra}` → new `blogPostsPageDtoSchema` in `src/shared/api/dto/post.ts` or `feed.ts`.
- `src/shared/entities/author/*`, `src/shared/api/dto/subscriptions.ts` -- `AuthorRepository.blog(http, blogUrl)` via `blogDtoSchema` + `authorFromBlog` (already written for E3). E3 404 `blog_not_found` → a distinct result (`unavailable`), check how `HttpClient`/`AppError` exposes status/body (`src/shared/api/appError.ts`).
- `src/shared/api/queryKeys.ts` -- `author`, `authorPosts`.
- `src/features/author/` (new) -- `AuthorScreen`, `useAuthor` (E3 query), `useAuthorPosts` (paged), header component; reuse `AuthorCard` avatar pieces / `PostCardSkeleton`, `StateView`, `FocusableSurface`, `useFocusRestoration` (route key = `route.key`, section `MAIN_SECTION`), `useFocusEffect` → `restore()` on return.
- `src/shared/i18n/ru.ts` -- `author.*` (empty, unavailable title/body, a11y header, loading, load-more error), reuse `common.retry`, a «Назад» label.
- `src/app/dev/demo.ts` -- answer E3/E4 for the demo blogs (2 pages for one blog, empty for another).
- Fixtures: `src/test/fixtures/boosty/e3-blog.json`, `e3-missing-blog.json`, `e4-blog-posts-{1,2}.json` (live, sanitized); synthetic pages in memory (`src/test/feedFixtures.ts` pattern).
- Tests to mirror: `__tests__/subscriptionsFlow.test.tsx`, `homeFeedFlow.test.tsx` (harness `src/test/flow.tsx`, `backHandlerMock.ts`), `src/features/home/__tests__/feedPaging.test.ts`, entity repository tests.
- Docs: `docs/focus-map.md` §4 D implementation notes; `docs/api-contract.md` §1 E3/E4 content-profile result; `docs/testing.md` Story 3.3.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/entities/post/*`, `src/shared/api/dto/*`, `src/shared/entities/author/*`, `queryKeys.ts` (+ unit tests) -- E4 page, E3 blog with `unavailable` on 404 `blog_not_found`, keys.
- [x] `src/shared/ui/PostGrid.tsx`, `src/shared/entities/post/usePagedPosts.ts`, `src/features/home/*` -- extract the grid and paging; Главная unchanged in behaviour (existing tests green, unmodified except imports).
- [x] `src/features/author/*` -- screen, hooks, header, states, focus rules and restoration.
- [x] `src/app/routes.ts`, `App.tsx`, `Shell.tsx`, `src/features/subscriptions/*` -- route, tile OK → Author, Back → same tile; shared sidebar on Author (decision A).
- [x] `src/app/dev/demo.ts`, `ru.ts` -- demo answers, copy.
- [x] Tests -- every matrix row; focus: first post after load, user move wins, ← from column 1 → sidebar «Подписки» and → back to the card, OK on «Главная» in the Author sidebar → Shell on Главная, Back from the Author sidebar pops to the same tile, pushed stand-in route then pop restores the card by id (and neighbor when gone); account switch clears author caches; >300 posts paged without focus jumps.
- [x] Docs -- focus-map §4 D notes, api-contract §1, testing.md.
- [x] Device (release-like, owner's session) -- E3/E4 with the content profile (on rejection stop and ask, ADR 0008); Подписки → OK → Author → ↓ through pages → Back → same tile.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new/changed flow tests 30/30; lint, typecheck, check:fixtures clean.
- Given Главная, when its existing flow tests run after the extraction, then they pass without behaviour changes.

## Implementation Notes

- Implemented by the step-03 subagent; see `docs/focus-map.md` §4 D notes and `docs/testing.md` «Story 3.3» for the as-built behaviour and the adb device run (2026-10-27).

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | E3 retry in flight: no test holds the retry or retries into a second failure (verification-gap) | medium | patch: test (pre-verified gap) |
| 2 | E4 page-1 retry that returns empty: no test for focus → `author/nav/subs` (verification-gap) | medium | patch: test (pre-verified gap) |
| 3 | Demo «2 pages» test asserts only that cards exist (verification-gap) | low | defer (dev-only demo; real E4 paging covered) |
| 4 | Every E3 404 maps to `unavailable`, not only `blog_not_found`; docs promise the narrower rule (blind, edge, verification-gap) | medium | patch: docs state the as-built rule (HttpClient keeps no 404 body); keeping the error code → deferred-work |
| 5 | Full-page E3 retry succeeds while E4 is still loading: phase `error` → `loading`, the focused «Повторить» unmounts and nothing takes focus (edge) | medium | patch: `loading` with lost content focus → `author/nav/subs` |
| 6 | `pendingShellSection` can leak: a second OK during the pop, or a pop that does not reach the Shell, leaves it set; a later plain Back opens another section (edge, blind) | medium | patch: set only while the route is focused; clear on Back/«Назад» and on Author unmount |
| 7 | Return to Автор with the last focus on a non-Подписки sidebar item lands in content (edge) | false | unreachable: every sidebar OK pops; a pushed route above Автор is reached only from a card (Story 3.4) |
| 8 | Author posts never refresh: `refetchOnMount: false`, no resume refresh, no «Обновить» (edge, blind) | low | rejected: spec rule (as E5); «Обновить» is Epic 5; reopen after gcTime (10 min) refetches. Reported to the owner |
| 9 | E3 body `blogUrl` ≠ requested → another blog's header cached (edge) | maybe-false | rejected: no evidence the API ever answers another blog; a strict check could break a canonicalised slug |
| 10 | E4 for a missing blog unspecified (blind) | low | rejected: E3 404 wins the page (`unavailable` phase first); E4-only 404 shows a retryable error, acceptable |
| 11 | Spec `in-review` vs sprint `in-progress`; Device task ticked without caveat (blind) | false | sprint moves to review at completion; testing.md states adb-only and the unverified states |
| 12 | No ADR for the sidebar on stack screens and the Shell return handshake (blind) | medium | patch: ADR 0012 (proposed); Story 3.4 reuses the pattern |
| 13 | Layering: PostGrid hooks in `shared/ui`, `usePagedPosts` in entities (blind) | maybe-false | rejected: no named consumer that breaks; PostCard already depends on the Post entity |
| 14 | `author/nav/<section>` overlaps the `author/<blogUrl>/…` namespace (blind) | false | no id can collide: cards are `author/<blogUrl>/post/…`, retry `author/<blogUrl>/retry`; no section is named `post` or `retry` |
| 15 | api-contract marks E3/E4 `LIVE` though 200 is inferred from rendered data (blind) | low | patch: label `LIVE (inferred from the rendered page)` (direct correction) |
| 16 | Full-page «Повторить» busy only from E3 while E4 also retries (blind) | false | when E3 succeeds the page leaves the `error` phase (the button unmounts); no second press is possible |
| 17 | Test gaps: account switch/expiry with Автор open, double sidebar OK, failing background E3 refetch (blind) | low | double OK covered by #6's test; expiry resets the stack (`openExpired`); a failed refetch with data keeps the header (`shownError` needs no data) |
| 18 | Demo hardcodes page size 20, odd demo blog indexes (blind) | low | rejected: dev-only, no user impact |
| 19 | `lastError` hold duplicated in `useAuthor` and `usePagedPosts` (blind) | low | rejected: two small call sites, no divergence today |

## Design Notes

E3 and E4 run in parallel. The header renders when E3 is ready; the grid area shows its own skeleton/empty/error. A full-page StateView replaces both only when E3 fails (unavailable or error). «Повторить» refetches only the failed queries.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; new flow tests 30×.
