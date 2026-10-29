# Epic 5 Context: Search, filters and refresh (P2)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The family can pull fresh posts into Главная with «Обновить», the owner sees «Мой блог» first in Подписки, and anyone can narrow the subscription feed or a single author's posts by access, period and tags, and search either the subscription feed («по подпискам») or one author. Search has exactly two scopes: the subscription feed and a single blog. There is no global author search and no sorting, because the reference has neither. This completes the feed, search and filter part of BoostBuddy parity on top of the Epic 3–4 feed, Author page, Post, Player and continue row. Comments stay excluded everywhere. Stories 5.1–5.4 are done. 5.5–5.7 remain and build on the filter sheet and model already shipped for Главная.

## Stories

- Story 5.1: Refresh the feed
- Story 5.2: My-blog tile in Subscriptions
- Story 5.3: Filter the feed by access
- Story 5.4: Filter by period
- Story 5.5: Filter by tags
- Story 5.6: Search in subscriptions
- Story 5.7: Search and filters inside an author

## Requirements & Constraints

- **Refresh (done):** «Обновить» refreshes the feed and subscriptions. It shows «Обновляем…» while busy and keeps focus on the button. A failure keeps every card and shows an inline «Не удалось обновить».
- **My blog (done):** the tile appears only when the profile has a `blogUrl` and that blog has at least one post. It is the first tile, carries the tinted «Мой блог» label and opens Автор. Any failure means no tile and no error.
- **Access filter (done for the feed, verified live):** «Доступные мне» (default), «Все посты» and «Только купленные». The feed always sends `only_allowed` and `only_bought`. A blog uses `is_only_allowed` instead of `only_allowed`, plus `only_bought`, and that has not been verified live yet.
- **Period filter (done for the feed, verified live):** presets «За всё время», 7 days, 30 days, 3 months, plus «Свой период…». Values are epoch seconds, and both bounds are inclusive. The from value is local 00:00:00 of the first day, the to value is local 23:59:59 of the last day. Nothing is sent for «За всё время». Blog `from_ts`/`to_ts` is unverified.
- **Tags:** multi-select, sent as comma-joined `tags_ids`. Feed tags come from the feed-tag search endpoint: `limit=100`, an opaque offset cursor and a «Загрузить ещё» row while more pages exist. Blog tags come in one page from the blog-tag endpoint. A failed tag load shows a «Повторить» row inside the list. The tag list's own «Сбросить» clears tags only, while the sheet's «Сбросить» resets every section.
- **Filter behavior:** every change applies immediately (no Apply button) and refetches the list behind the sheet. «Сбросить» shows only while the filter is not the default. The chip shows the value of the single active section, or «Фильтры» plus a count when two or more sections are active. A filtered empty result shows «Ничего не найдено» + «Сбросить фильтры».
- **Search:**
  - Feed search uses the feed params plus `search_query`. Blog search uses `blog_url`, `search_query` and the blog params. Both return `data.searchPosts[].post` + `extra`.
  - Each search combines with its own scope's Filter.
  - Use the system keyboard only (no custom keyboard, no voice). Show a hint before the first query.
  - Query, filter and focused result survive opening a post and coming back. Clearing the query returns to the normal list.
- **Evidence gap:** feed search, blog search, feed tags and blog tags are reference-only and have never been exercised live. Blog access and period params are unverified too. Each story verifies its endpoints live with a counts-only temporary debug log, removed before the commit. It also adds sanitized fixtures and updates `docs/api-contract.md`. Never invent params or response fields.
- **Pagination and states:** use an opaque cursor (`extra.offset` passed back verbatim, stop on `isLast`), dedupe by post id, and an inline load-more «Повторить». Lists stay smooth with hundreds of results. Every list has skeleton, empty, recoverable-error and locked states. Unknown blocks never crash a list.
- **Docs per story:** update `docs/focus-map.md`, add an «Android (Story 5.x)» note to the affected parity rows (FILTER-03, FEED-04, SEARCH-SCOPES, AUTH-PAGE-02/03, FILTER-01/02/04 for new scopes) and record device checks honestly in `docs/testing.md`. Never report host or adb results as physical-remote results.

## Technical Decisions

- **Filter model:** `Filter {access: 'allowed'|'all'|'bought', period: {kind:'all'} | {kind:'preset', days} | {kind:'custom', fromDay, toDay}, tags: readonly {id, title}[]}` (tags in selection order; query keys and `tags_ids` use the sorted ids only, never titles — Story 5.5).
  - One Zustand `filtersStore` in `shared/filters` holds one Filter per scope: `feed`, `search`, `author:<blogUrl>`.
  - The store is in memory and account-scoped. It survives a same-account re-login and is wiped on sign-out or account switch. It is not persisted.
  - The sheet UI and the period stepper live in `shared/filters`.
- **Symbolic period:** the period stays symbolic in state and in query keys. The repository resolves it with the current time when it sends the request, so keys never change every second.
- **Server state:**
  - TanStack Query only, with keys from `shared/api/queryKeys.ts`. The Filter is part of list keys, and search keys never collide with author keys.
  - Lists use `useInfiniteQuery` with `staleTime` 60 s, `gcTime` 10 min and no focus refetch.
  - Refreshing an infinite query reloads every loaded page, so refresh and resume merge a fresh page 1 into the cached head (shared `refreshPostsHead`) instead of invalidating. This is a known deviation: a post deleted on the server can linger.
  - On a Filter change, the list left behind is trimmed to its first page (`trimPostsToFirstPage`). This avoids a page storm on a key change. New scopes must follow the same pattern.
  - The resume head refresh and «Обновить» use the active scope's key and params.
- **Session check:** an all-locked page 1 triggers a session (E1) check only on Главная, under «Доступные мне». An all-locked page is ordinary under other access values, on the Author page and, unless a story decides otherwise, for search results. Never treat `hasAccess:false` or a 403 as session expiry.
- **Layering:** UI → feature hooks → repositories → HttpClient. No HTTP or DTO parsing in screens. Zod validates at the boundary, with one schema and one mapper per DTO. Search results reuse the shared Post schema and mapper.
- **Phase gating:** `filters` and `myBlog` are on, and `search` is off until Story 5.6. Entry points (chip, «Обновить», «Мой блог», Автор's action row, the Поиск section) render only when their flag is on. A hidden entry point is never focusable.
- **Remote keys:** on the pinned remote, raw D-pad events reach JS on key up only. A long press arrives as `longUp`/`longDown` with no repeats. Holding a key to keep stepping goes through the native `SeekKeys` key path (now forwarding UP/DOWN too).
- **i18n:** Russian copy goes in the typed ru catalog. Plurals use the hand-written ru selector (Hermes has no `Intl.PluralRules`).

## UX & Interaction Patterns

- **FilterChip:** a 32 dp pill on `surface-raised` with the label and value. When filters are active, a count badge on `accent-tint` with `accent-text` digits. Focused: the ring, `surface-focus-button` and the button scale. One shared component.
- **Главная title row:** «Новое в подписках», then «Фильтры» (`home/filters`), then «Обновить» (`home/refresh`). ← and → move inside the row. ↑ from the first feed row goes to the row's last focused control, else the chip. ↓ from either control goes to the remembered feed card.
- **Filter sheet:**
  - A 320 dp SideSheet that traps focus. It opens on the selected «Доступ» value.
  - One column: the access values, «Период», «Теги», then «Сбросить». ← and → do nothing.
  - The sheet has levels (sheet → period list → stepper; sheet → tag level D11, owner decision 2026-10-29: the tag «Сбросить» on top, check rows, then «Загрузить ещё» / «Повторить» / «Тегов нет»). Back closes the deepest level first, and at the top it returns focus to the chip.
  - When «Сбросить» disappears after a reset, focus goes to «Доступные мне».
  - A Filter change never moves focus out of the open sheet, and the page behind never takes focus while a modal is open.
  - The same sheet serves Главная, Поиск and Автор, each with its own scope.
  - Ids: `filters/tags` (row), `filters/tags/list`, `filters/tags/reset`, `filters/tag/<tagId>`, `filters/tags/load-more`, `filters/tags/retry`, `filters/tags/loading`, `filters/tags/empty` and `filters/reset`, alongside the existing access and period ids.
- **TagRow:** a SettingRow check with the tag title, plus a «Загрузить ещё» row at the end while more pages exist.
- **Поиск:**
  - Initial focus is the field labelled «Поиск по подпискам» (`search/field`). From the field, → goes to «Фильтры» (`search/action/filters`), ↓ to the results and ← to the sidebar. ↑ from the first result returns to the field.
  - «Готово» moves focus to the first result, or back to the field when there are none.
  - Back closes the keyboard if it is open, otherwise it goes to the sidebar.
  - When nothing is found and filters are active, focus goes to «Сбросить фильтры».
  - Result ids: `search/result/<postId>`.
- **Автор:**
  - The action row sits above the grid: `author/<blogUrl>/action/search|filters|reset`.
  - With a search active, Back first clears the search and focuses the field; otherwise it pops the route.
  - Filters on one author never affect another author or Главная.
- **Focus invariants:**
  - Refetch, filter change, pagination and refresh never move focus.
  - Restoration goes by stable id with the fallback chain: neighbor, then first item, then the nearest action above.
  - Android's fallback focus is never relied on. Focus scale uses transforms only.
  - Errors appear inline or as screen states, never as toasts.

## Cross-Story Dependencies

- Story 5.5 adds the tag section to the existing sheet (5.3/5.4) for the `feed` scope (feed tags). Story 5.7 reuses it with blog tags.
- Story 5.6 turns on `phaseFlags.search`, creates the `search` scope and its keys, and reuses the sheet.
- Story 5.7 reuses 5.6's search patterns with blog search and the `author:<blogUrl>` scope, and must verify the blog access and period params live.
- Each new scope must keep the resume head refresh, the trim-on-change rule, focus restoration and the head-follow latch working with its active Filter.
- `filtersStore` is already registered in AccountScope. New scopes inherit the wipe on sign-out and account switch.
