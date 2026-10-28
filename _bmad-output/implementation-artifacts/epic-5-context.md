# Epic 5 Context: Search, filters and refresh (P2)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The family can pull fresh posts into Главная with an explicit «Обновить», the owner sees «Мой блог» first in Подписки, and anyone can narrow the subscription feed or a single author's posts by access, period and tags, and search either the subscription feed («по подпискам») or one author. Search has exactly two scopes, the subscription feed and a single blog. There is no global search for authors and no sorting, because the reference has neither. This completes the feed/search/filter part of BoostBuddy parity on top of the Epic 3–4 feed, Author page, Post, Player and continue row. Comments stay excluded everywhere.

## Stories

- Story 5.1: Refresh the feed
- Story 5.2: My-blog tile in Subscriptions
- Story 5.3: Filter the feed by access
- Story 5.4: Filter by period
- Story 5.5: Filter by tags
- Story 5.6: Search in subscriptions
- Story 5.7: Search and filters inside an author

## Requirements & Constraints

- **Refresh:** «Обновить» reloads the feed **and** subscriptions. The label reads «Обновляем…» while it runs, and the button keeps focus (busy button). The remembered card id is kept, so ↓ returns to that card or follows the fallback chain. A failed refresh keeps the existing items and shows an inline error, never a full-screen error.
- **My blog:** shown only when E1 has a `blogUrl` and that blog has at least one post (E3, then E4 with `limit=1`). It is the first tile, carries the tint «Мой блог» label and opens Автор. No blog, or a blog with no posts, means no tile.
- **Access filter:** «Доступные мне» (default), «Все посты», «Только купленные». The feed (E5/E6) uses `only_allowed`; a blog (E4/E7) uses `is_only_allowed`; both use `only_bought`. «Все посты» sends both flags as `false`. Today's E5/E4 requests send no access params at all, so adding the default changes what the existing feed sends. Verify live what each value returns before relying on it.
- **Period filter:** presets «За всё время», «Последние 7 дней», «Последние 30 дней», «Последние 3 месяца» and «Свой период…» (D-pad steppers for day, month and year). An invalid range (from after to) cannot be confirmed. The period resolves to local start and end of day, sent as epoch-second `from_ts`/`to_ts`.
- **Tags:** multi-select, sent as comma-joined `tags_ids`. Feed tags come from E13 (`limit=100`, opaque offset cursor, «Загрузить ещё» row while more pages exist). Blog tags come from E14 (one page). A failed tag load shows a «Повторить» row inside the list. The tags-only «Сбросить» clears only tags.
- **Filter behavior:** every change applies immediately (no Apply button) and refetches the list behind the sheet. «Сбросить» appears only for non-default filters. The «Фильтры» chip shows the active count. A filtered empty result shows «Ничего не найдено» + «Сбросить фильтры».
- **Search:** E6 searches the feed with the E5 params plus `search_query`. E7 searches a blog with `blog_url`, `search_query` and the E4 params (including `is_only_allowed`). Both responses are `data.searchPosts[].post` + `extra`. Each is combined with its scope's active filter. Use the system keyboard only (no custom keyboard, no voice). Hint before the first query. Query, filter and the focused result survive opening a post and coming back.
- **Evidence gap:** E6, E7, E13 and E14 are reference-only (`REF`), never exercised live. Each story verifies its endpoints live with the content request profile (ADR 0008), adds sanitized fixtures and updates `docs/api-contract.md`. Do not invent params or response fields.
- **Pagination:** opaque cursor (`extra.offset` passed back verbatim, stop on `isLast`), dedupe by post id, inline load-more «Повторить». It must stay smooth with hundreds of results.
- **States:** every list has skeleton, empty, recoverable error and locked handling. Unknown blocks never crash a list.
- **Docs:** each story updates `docs/focus-map.md` with any focus change and adds an «Android (Story 5.x)» note to the FEED-03/04, SEARCH-SCOPES, FILTER-01..04, SUB-02 and AUTH-PAGE-02/03 rows in `docs/feature-parity.md`. Device checks are recorded honestly in `docs/testing.md`. Host-only results are never reported as device results.

## Technical Decisions

- **Filter model (AD-18):** `Filter {access: 'allowed'|'all'|'bought', period: {kind:'all'} | {kind:'preset', days} | {kind:'custom', fromDay, toDay}, tagIds: string[]}`. One Zustand `filtersStore` in `shared/filters` keeps one Filter per scope: `feed`, `search`, `author:<blogUrl>`. The store is in memory and account-scoped (registered in AccountScope): it survives a same-account re-login and is wiped on sign-out or account switch, not persisted across restart. The FilterPanel UI also lives in `shared/filters`. `shared/filters` is empty today.
- **Symbolic period:** the period stays symbolic in state and in query keys. Repositories turn it into `from_ts`/`to_ts` at request time, so query keys never change every second.
- **Server state (AD-7, ADR 0010):** TanStack Query only. Keys come from `shared/api/queryKeys.ts`. The Filter is part of list keys, and the search keys never collide with the author keys. Lists use `useInfiniteQuery` with `staleTime` 60 s, `gcTime` 10 min and no focus refetch. The feed sets `refetchOnMount: false` on purpose, because refetching an infinite query reloads every loaded page (about 31 E5 calls for 300 posts). Story 5.1 must define refresh semantics that avoid that storm, for example reusing or extending the shared `refreshPostsHead` or resetting to page 1. Decide in the story and record it in ADR 0010.
- **Existing refresh mechanics:** a resume head refresh already runs for Главная and Автор (after a resume E1 `ok`, cache ≥ 60 s old, single-flight, page 1 merged on top, focus kept by id). Open deferred edges that touch 5.1:
  - a head refresh merges while the load-more «Повторить» has focus (owner decision pending);
  - a deleted head post survives a head refresh;
  - an empty last page 1 empties Главная and leaves focus nowhere;
  - an anonymous (all-locked) E5 page is not invalidated after a token refresh.
- **Session check:** Главная's page 1 with every post locked triggers an E1 check (a dead token answers 200 as anonymous). Revisit this trigger for non-default access filters and for search results. Never treat `hasAccess:false` or a 403 as session expiry.
- **Layering:** UI → feature hooks → repositories → HttpClient. No HTTP or DTO parsing in screens. Zod at the boundary only, one mapper per DTO, reusing the shared Post entity and mapper for search results.
- **Phase gating (AD-20):** `phaseFlags.search` is off today; Story 5.6 turns it on. The filter chip, «Обновить», «Мой блог» and Автор's action row (search, «Фильтры», «Сбросить») render only when their flag is on. A hidden entry point is never focusable.
- **i18n:** Russian copy goes in the typed ru catalog. Plurals use the hand-written ru selector (Hermes has no `Intl.PluralRules`).

## UX & Interaction Patterns

- **Главная:** the feed actions live in the feed's title row (owner decision 2026-10-28, Story 5.1): «Обновить» (`home/refresh`) sits to the right of «Новое в подписках». ↑ from the first feed row goes to the title row («Обновить»); ↑ from there goes to the «Продолжить» row; ↓ from «Обновить» goes to the remembered feed card (`docs/focus-map.md` §3, Story 5.1 notes). Story 5.3 decides where «Фильтры» goes in that row and its focus id.
- **Filter SideSheet (320 dp):**
  - Focus is trapped and nothing behind the sheet is focusable. It opens with focus on the selected «Доступ» value.
  - One column: access values, «Период», tags, «Загрузить ещё», «Сбросить». ← and → do nothing.
  - Back closes the deepest level first and returns focus to the «Фильтры» chip.
  - When «Сбросить» disappears after a reset, focus goes to «Доступные мне».
  - The same sheet serves Главная, Поиск and Автор, each with its own scope.
  - Ids: `filters/access/<value>`, `filters/period`, `filters/period/<preset>`, `filters/period/custom/<from|to>/<day|month|year>`, `filters/period/custom/done`, `filters/tag/<tagId>`, `filters/tags/load-more`, `filters/reset`.
- **Period list and stepper:** the list opens on the current period. Selecting a preset returns to the sheet with focus on «Период». In the stepper, ← and → move between fields and ↑ and ↓ change the value. The stepper is one of only three places allowed raw `useTVEventHandler`. On the pinned Chromecast remote, raw D-pad events arrive on key up only, and Story 5.4 must measure up/down and key repeat on the device. OK on a field goes to «Готово»; ↑ from «Готово» goes to the first field.
- **Поиск (E):**
  - Initial focus is the field labelled «Поиск по подпискам». From the field, → goes to «Фильтры», ↓ to the results and ← to the sidebar; ↑ from the first result row returns to the field.
  - «Готово» moves focus to the first result, or back to the field when there are none.
  - With the keyboard open, Back closes it; otherwise Back goes to the sidebar.
  - When nothing is found and filters are active, «Сбросить фильтры» gets the focus.
  - Ids: `search/field`, `search/action/filters`, `search/result/<postId>`.
- **Автор (D):**
  - The action row (search, «Фильтры», «Сбросить») sits above the grid.
  - With a search active, Back first clears the search and focuses the field; otherwise Back pops the route.
  - Ids: `author/<blogUrl>/action/search|filters|reset`.
- **Подписки:** «Мой блог» (`subs/tile/my-blog`) is the initial focus when shown and uses the AuthorCard's «Мой блог» label.
- **Focus invariants:**
  - Refetch, filter changes, pagination and refresh never move focus.
  - Restoration is by stable id with the fallback chain: neighbor, then first item, then the nearest action above.
  - Android's fallback focus is never relied on.
  - Focus scale uses transforms only.
  - Errors appear as inline or screen states, never toasts.

## Cross-Story Dependencies

- Story 5.3 creates the Filter model, `filtersStore`, the sheet and the chip. Stories 5.4 and 5.5 add sections to that sheet, and 5.6 and 5.7 reuse it with the `search` and `author:<blogUrl>` scopes.
- Story 5.7 reuses 5.6's search patterns, but the data comes from E7 and the tags from E14 (5.5 covers E13).
- Story 5.1 builds on the Epic 3 resume head refresh (`refreshPostsHead`) and the Story 4.7 continue row (↑/↓ order on Главная).
- Story 5.2 extends the Story 3.2 Подписки grid and its FocusRestoration by `blogUrl`.
- Stories 5.3 to 5.6 change Главная's request params and query keys, so the resume head refresh, the session check and the head-follow latch must keep working with the active Filter.
- The account-scope wiring (AccountScope, sign-out and account-switch reset from Epic 2) must include `filtersStore`.
