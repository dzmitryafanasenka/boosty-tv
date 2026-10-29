---
title: 'Story 5.7: Search and filters inside an author'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: 'eb8e5cab35f14d478bbaf33df2c92229a7f5489e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A large author archive cannot be narrowed or searched. The Author page has no filters and no search (FR27, AUTH-PAGE-02/03; epics.md Story 5.7).

**Approach:** Add the action row above the Author grid (focus-map D, mocks D8–D11):
- «Поиск в блоге», a system-keyboard field labelled «В этом блоге»;
- the «Фильтры» chip, which opens the shared sheet with the route's own Filter scope and blog tags from E14 (one page);
- «Сбросить», shown only while a search or a filter is active, which clears both.

Posts use E4 with the Filter's params. A submitted query switches the grid to E7 (`/v1/search/blog/post/`, `blog_url` + `search_query` + the same params). Back first clears an active search and focuses the field.

**Decisions:**
- Owner decision 2026-10-29 (Q1 b): one story for both search and filters.
- Owner decision 2026-10-29 (Q2 a), parity with BoostBuddy and Главная: the Author page's default is «Доступные мне». E4 always sends `is_only_allowed` and `only_bought` (default `true`/`false`). Locked posts no longer show by default; «Все посты» shows them. Подписки's «Мой блог» check uses the default Filter.
- Owner decision 2026-10-29 (Q3 b), as the reference: a fresh Author route starts with the default Filter and no query. The Filter is dropped when the route unmounts. The Filter lives in `filtersStore` under a per-route scope `author:<routeKey>` (the sheet lives in the modal host), so two Author routes of one blog never share it. The query is the route's local state.
- Search reuses Story 5.6's rules: request on «Готово» only, trimmed, blank → back to the normal list; Back with the keyboard open closes it without searching; no background head refresh of search results; no session check. The normal (non-search) list keeps the reopen and resume head refresh, using its active Filter.
- Params as the reference (`BlogRepository`/`BoostyApi`, SHA `87c0852044d9b98b3ee1e94a544e78e250f4b5c9`): E4/E7 `is_only_allowed`, `only_bought`; `from_ts`/`to_ts` only for a period; `tags_ids` only with tags; limit 20. Before relying on them, verify live (debug build, counts and booleans only, log removed before the commit). Check that E4 honours access, period and tags; that E7 returns `data.searchPosts[].post` + `extra` with the params and pages; and that E14 returns `data[]{id,title}`. Record «E4 filters (LIVE)», «E7 (LIVE)» and «E14 (LIVE)». If any of them does not behave, stop and report.
- Live result (2026-10-29, see Implementation Notes): E4 honours `is_only_allowed`, period and `tags_ids`, but ignores `only_bought=true`; E7 ignores both access params. Owner decisions 2026-10-29 after the stop:
  - (A a) The Author scope offers only «Доступные мне» and «Все посты» in the sheet's «Доступ» section; «Только купленные» is not shown there (Главная and Поиск keep all three). E4/E7 send `only_bought=false` always.
  - (B a) Blog search under «Доступные мне» drops results with `hasAccess: false` on the client (E7 still gets `is_only_allowed=true`). Pages can be uneven; a page left empty with a next cursor uses the existing auto-fetch rule (at most 3 in a row, then «Ничего не найдено» until a user action). «Все посты» shows every result.

## Boundaries & Constraints

**Always:**
- Keys come from `queryKeys` only. The Filter is in the E4 key; blog search has its own `search`/`blog` root; keys never collide with feed or Поиск keys.
- Trim on change (`trimPostsToFirstPage`) when the Filter or query changes.
- Focus moves by explicit targets. Refetch, filter change and paging never move focus. Focus restore by id is kept after Post.
- Every state exists: skeleton, results, empty, filtered-empty with «Сбросить фильтры», error, load-more «Повторить».
- The query is never logged. Copy goes in `ru`; tokens come from `shared/ui`.

**Never:** No change to Главная or Поиск behaviour. No custom keyboard, debounce, history or suggestions. No persistence of an author's Filter or query beyond its route. No live card work (Epic 7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | fresh Author route | E4 with `is_only_allowed=true&only_bought=false`; action row; focus → first post | — |
| Filter | «Все посты» in the sheet | E4 refetch with `is_only_allowed=false`; focus stays in the sheet; chip shows the value | E4 error → page-1 error state |
| Access values | the sheet on Автор | «Доступные мне», «Все посты» only; no «Только купленные» | — |
| Search access | «Доступные мне» + search, E7 returns a locked post | the locked result is not shown; «Все посты» shows it | all-locked page → auto-fetch rule |
| Blog tags | «Теги» row | E14 once (no «Загрузить ещё»); toggles → `tags_ids` | E14 error → «Повторить» row |
| Search | «пирог» + «Готово» | E7 `blog_url` + `search_query` + Filter params; focus → first result | error → «Повторить» focused |
| Nothing found | `searchPosts: []` | «Ничего не найдено»; focus → field; with filters + «Сбросить фильтры» | — |
| Back, search active | Back | query cleared, normal list, focus → field | — |
| Back, no search | Back | route pops (as before) | — |
| «Сбросить» | query and/or Filter active | both cleared, normal list, focus → chip; hidden at default | — |
| Isolation | Filter set on author A | Главная, Поиск, another author and a reopened A all show their defaults | — |
| Return from Post | OK on a result/post, Back | same query, Filter, card | gone card → neighbour → first → field |

</frozen-after-approval>

## Code Map

- `src/shared/filters/filter.ts:57` -- `FilterScope = 'feed' | 'search' | \`author:${string}\``.
- `src/shared/filters/TagList.tsx:61-63`, `useFeedTags.ts` -- select the tag source by scope. `author:` uses new `useBlogTags(http, blogUrl)` (a single `useQuery`, `queryKeys.blogTags(blogUrl)`): no pages, no «Загрузить ещё». `FilterSheet` gains an optional `blogUrl`.
- `src/shared/entities/tag/tagRepository.ts:67` -- `blogTags(http, blogUrl)` for E14. Add a DTO in `src/shared/api/dto/` (drop a bad item, never the page).
- `src/shared/entities/post/postRepository.ts` -- `blogPostsPath(blogUrl, cursor, filter, now)` takes the blog access params (`is_only_allowed`, `only_bought`) plus the shared period and tag builders. Add `blogSearchPath` / `PostRepository.blogSearchPage` (E7, parsed like `feedSearchPage`, reusing `feedSearchPageDtoSchema`).
- `src/shared/api/queryKeys.ts` -- `authorPosts(blogUrl, filter)` → `['authorPosts', blogUrl, {access, period, tagIds}]` (the prefix `allAuthorPosts` stays). Add `blogSearch(blogUrl, query, filter)` → `['search','blog',blogUrl,{query,…}]` and `blogTags(blogUrl)`.
- `src/features/author/useAuthorPosts.ts`, `authorPostsRefresh.ts:24-62` -- take the Filter. The resume refresh rebuilds params from each observed key's `{access, period, tagIds}`. Trim the old key on change (`useSubscriptionFeed.ts` pattern).
- `src/features/subscriptions/useSubscriptions.ts:121-125` -- «Мой блог» uses `DEFAULT_FILTER` in the call and the key.
- New `src/features/author/useBlogSearch.ts` -- on `src/features/search/useFeedSearch.ts` (no refresh, `resetQueries` on «Готово»).
- `src/features/author/AuthorScreen.tsx` -- the action row above the grid (ids `author/<blogUrl>/action/search|filters|reset`; result cards reuse `author/<blogUrl>/post/<postId>`). Reduce `listHeight` by the row. `focusAbove` → the field. `canFocus`/`useNotMovedLatch` treat the row as content. Outcome focus as `SearchScreen.tsx` (`resolveOutcome` + settle effect). Reset the scope on unmount (`filtersStore.reset`). Search shows E7 results in the same `PostGrid`.
- `src/app/stackRoutes.tsx:253-280` -- pass `routeKey` (scope) and `onBackPress` (clear an active search, focus the field, return true).
- `src/shared/i18n/ru.ts` -- add `author.search.*` («Поиск в блоге», «В этом блоге», «Сбросить», empty and error copy).
- `src/app/dev/demo.ts` -- demo E4 params, E7 and E14.
- Fixtures: `e7-blog-search-1.json`, `e14-blog-tags.json`, plus updated E4 if the shape changes (sanitized, `check:fixtures`).
- Reuse, do not change: `FilterChip`, `chipLabels`, `PostGrid` hooks, `TextField` (`onFocus`, `hostRef`).

## Tasks & Acceptance

**Execution:**
- [x] Live E4 params / E7 / E14 check; fixtures; `docs/api-contract.md` entries.
- [x] Scope type, keys, DTOs, repository paths, tag source, «Мой блог» default, demo.
- [x] Author action row, search, sheet wiring, Back, scope reset; route wiring.
- [x] Tests: `__tests__/authorFlow.test.tsx` «Story 5.7» covering every matrix row, the head refresh using the active Filter, and 300 results virtualized. Unit tests for `blogPostsPath`/`blogSearchPath` (params, encoding), the E14 DTO, key non-collision (feed, search, author, blog search) and the scope reset. Update tests that expect locked posts on Автор by default.
- [x] Docs: `docs/focus-map.md` D (action row, D8–D11 for Автор, Back), `docs/feature-parity.md` AUTH-PAGE-02/03, FILTER-01..04 «Android (Story 5.7)», `docs/testing.md` Story 5.7.
- [x] Device (release-like, adb, owner's session): Автор filter (access, tags), search + Back, «Сбросить», Post round trip, reopen resets. Send screenshots to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then everything passes; the new and touched suites pass 30/30; lint `--max-warnings 0`, typecheck and `check:fixtures` are clean.
- Given a release-like build on the pinned device, when the Author page is used with the remote, then the matrix rows Open, Filter, Search, Back and «Сбросить» behave as specified (recorded honestly in `docs/testing.md`).

## Implementation Notes

- **HALTED at the live check (2026-10-29), per Decisions: "If any of them does not behave, stop and report."** Debug build with Metro, the owner's session, pinned device, a temporary counts-only `TEMP57` probe (removed; the release-like Story 5.6 build reinstalled afterwards, session kept). Three subscribed blogs (A: no locked posts, B: 14 of 20 locked on page 1, C: no locked posts) plus the blog of the account's one purchased post (D, not subscribed; found through E5 «Только купленные»). HTTP 200 everywhere; only keys, types, counts and booleans were logged.
  - E4 `is_only_allowed`: honoured. Without access params B returned 20 posts with 14 locked (the server default on a blog is «Все посты», unlike E5); `is_only_allowed=true&only_bought=false` → 20, 0 locked (6 shared with the no-params page); `false/false` → the no-params page. D: the same split (3 locked → 0).
  - **E4 `only_bought`: ignored.** `is_only_allowed=false&only_bought=true` returned exactly the «Все посты» page on every blog (B: 20 with 14 locked; D: 20 with 3 locked, the purchased post not among them). `only_bought=true` alone → the same; `is_only_allowed=true&only_bought=true` → the «Доступные мне» page. The reference sends the same params, so its blog «Только купленные» behaves the same way.
  - E4 period: honoured (both bounds inclusive: `T..T` → 1 post, the newest; `T−30 d..T−1` → posts all inside, not the newest; `T+1..T+30 d` → 0; presets 7/30/90 days → every post inside the bounds; A, B, C).
  - E4 `tags_ids`: honoured and intersected (A: tag X → 20 posts all carrying X, including the 8 unfiltered ones; tag Y never on an X post → 16 all carrying Y; `X,Y` → 0; C similar; B's page-1 posts carry no tags, a tag still returned 2 locked posts carrying it).
  - E7: shape as E6 (`{data{searchPosts[]{post, rank, headline, blog}}, extra{offset: string, isLast}}`, every `post` an object of that blog; `PostRepository`-style parsing → 20 mapped posts and a cursor); page 2 by `offset` → 18, no overlap, last; period presets → every result inside the bounds; a tag carried by a result → every result carries it; a nonsense query → 0, last page.
  - **E7 access params: ignored.** On D the same query returned the identical page (20 results, 1 locked, the purchased post included) for «Доступные мне», «Все посты», «Только купленные», `only_bought=true` alone and `true/true`: `is_only_allowed=true` still returned a locked post. A and B gave identical counts per access value too.
  - E14: `{data[]{id, title, count}}`, one page, ids numbers and distinct, titles non-blank (13, 23 and 10 tags); every tag seen on a post was in E14.
  - Not proven broken, just not observed: an E4/E7 error, an E14 failure.
- Resumed after the owner's decisions A a and B a (recorded in Decisions and the matrix). The WIP repository layer was re-applied; `only_bought` is always `false` on E4/E7; `accessValuesFor(scope)` gives an Author scope «Доступные мне» and «Все посты» only; `useBlogSearch` drops `hasAccess: false` results under «Доступные мне» before the shared paging, so an emptied page goes through the existing auto-fetch rule.
- `TagList` / `FilterSheet` take an optional `blogUrl`: the blog's E14 tags (`useBlogTags`, one `useQuery`) instead of E13 (`useFeedTags` gained `enabled`).
- Focus choice: a card or action lost to a skeleton or an empty view now goes to the search field (the fallback chain's «nearest action above»), recorded as the page's own focus, so the first post still takes it when posts arrive. Two Story 3.3 tests that expected the sidebar item were updated.
- «Сбросить фильтры» while searching re-runs the query under the default Filter (`resetQueries`), so a cached empty result for it is not reused.
- Device fix: the action row has the content width and the field shrinks (440 → at least 160 dp), so a long chip label never pushes «Сбросить» off the screen.
- Device observation (not fixed): after the grid scrolled to a second row and back, ↑ from the first row first scrolls the list back by a few pixels; the next ↑ reaches the field. Documented in `docs/focus-map.md` D.
- Not seen on the device: E4/E7/E14 errors, a load-more failure, a dropped locked search result, a Cyrillic query, the physical remote, TalkBack.

## Spec Change Log

## Review Triage Log

Iteration 0 (layers: blind-hunter 14, edge-case-hunter 5, verification-gap 2 gaps).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | edge, blind | `pendingOutcome` stays armed when «Сбросить фильтры» (or another `awaitOutcome`) is followed by no fetch and no phase change | medium | patch | A filtered «Ничего не найдено» whose default-Filter list is cached and empty: empty → empty, no `isFetching` cycle; a later phase change then moves focus off the field. |
| 2 | edge | `isPeriod` hardcodes 7/30/90 | low | patch | A direct correction to `PERIOD_PRESET_DAYS`; a new preset would drop the route from the resume refresh. |
| 3 | vgap | Blog-search trim on key change is untested | low | patch | No test loads 2 search pages then changes the key; deleting the trim would pass. |
| 4 | vgap | No assertion that Главная/Поиск tag levels send no E14 | low | patch | `TagList` mounts `useBlogTags` disabled; flipping `enabled` would pass every feed/search tag test. |
| 5 | blind | `docs/feature-parity.md` SEARCH-SCOPES / AUTH-PAGE-02/03 / FILTER-01 rows stale or incomplete | low | patch | Contradictory SEARCH-SCOPES text; Tests columns not updated; the A a decision is only in api-contract. |
| 6 | blind | One of 30 runs ran 24 fewer tests (unexplained) | low | defer | Settled by a full log in the post-review 30× batch: a jest worker died with SIGSEGV before `postsHeadRefresh.test.ts` ran (a host Node crash, no failing test); pre-existing, recorded in deferred-work. |
| 7 | edge | E3 error/unavailable arriving while an outcome is pending focuses a missing field | low | reject | Needs an E3 refetch failing during «Готово»/«Сбросить фильтры»; unlikely in use. |
| 8 | edge | `searchEnabled=false` leaves focus nowhere after a reset | low | reject | The flag is on in every shipped build. |
| 9 | edge | With filters, «Nothing found» focuses «Сбросить фильтры», not the field | false | reject | The same rule as Поиск (focus-map E «Nothing found»: «Сбросить фильтры» when filters are active). |
| 10 | blind | Frozen block edited without a Spec Change Log entry; status mismatch | false | reject | The owner renegotiated the intent (A a, B a); the change log is for review loopbacks; sprint status moves at step-05. |
| 11 | blind | Blog search under «Доступные мне» can stop at «Ничего не найдено» with more pages | low | reject | The owner's decision B a accepts the auto-fetch rule and this stop. |
| 12 | blind | The hidden posts list refetches on a Filter change during a search | low | reject | One page-1 E4 per toggle, not a storm; it pre-loads the list shown after leaving the search. |
| 13 | blind | A Filter change during a search reuses a cached key without a request | false | reject | Standard `staleTime` reuse, as on Поиск; the sheet never moves focus (matrix «Filter»). |
| 14 | blind | Route caches are left after unmount | low | reject | Collected after `gcTime`; no visible effect. |
| 15 | blind | Trim effect duplication, no deps, empty-query key subscribed | low | reject | Same pattern as `useFeedSearch`; a disabled entry has no effect. |
| 16 | blind | Chip and «Сбросить» not registered as zone views | false | reject | Intended, as on Поиск: the zone's destination must never be a non-focusable chip. |
| 17 | blind | A `bought` Filter on an Author scope is not rejected by the store | low | reject | No UI path sets it (`accessValuesFor`). |
| 18 | blind | Blog tags never refreshed; dead disabled cache entries | low | reject | As Story 5.5's feed tags; tags change rarely. |
| 19 | blind | Missing tests: Back with the sheet open during a search, logout while mounted, query not logged | low | reject | The modal host's Back listener is newer and runs first; AccountScope clears the whole cache; E7 failures log only the kind. |
| 20 | blind | Decision B a not verified on the device | low | reject | Host-tested; recorded as not verified in `docs/testing.md`. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean.
- `npm test` ×3 -- expected: all pass.

**Result (2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 98 suites, 1944 passed each; the new and touched suites ×30: a first batch had 29 × 572 passed and one run with 548 passed and no failure in the kept `Tests:` line (unexplained); a second batch of 30 with full logs: 572 passed every run. Release-like build checked on the pinned device over adb (`docs/testing.md` «Story 5.7»).

**Result (after the review patches, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 1946 passed each; `authorFlow` + `homeFeedFlow` + `searchFlow` + `demoFlow` + `subscriptionsFlow` + `src/features/author` + `src/shared/filters` + `src/shared/entities` + `queryKeys` ×30: 677 passed in 29 runs; in 1 run a jest worker died with SIGSEGV before `postsHeadRefresh.test.ts` started (651 passed, no test failed; host crash, see deferred-work). The installed release-like build predates the review patches (host-tested only).
