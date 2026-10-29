---
title: 'Story 5.5: Filter by tags'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: 'cbea7fce1a50ecadeab6a1bda956726d985b6fd2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The feed cannot be narrowed to topics: there is no tag filter (FR30, FILTER-03; epics.md Story 5.5).

**Approach:** The filter sheet (Stories 5.3–5.4) gets a tag section for the `feed` scope. Feed tags load from E13 (`limit=100`, opaque offset, «Загрузить ещё» row while `isLast` is false) as check rows; each toggle applies at once and the feed behind refetches with comma-joined `tags_ids` on E5. A tag-list «Сбросить» clears tags only; the sheet's «Сбросить» resets every section. A failed tag page shows an inline «Повторить» row.

**Decisions:**
- Filter gains `tags: readonly {id, title}[]` (selection order; titles for labels, as the reference's `Tag(id, title)`). The query key and `tags_ids` use the ids sorted, titles excluded, so toggle order and a renamed tag never change the key. `activeFilterCount` counts the tag section once.
- Reference parity (`FilterTagsComponentImpl`): the selected tags are listed first, then loaded pages, deduped (by id); the tag-list «Сбросить» shows only while a tag is checked.
- Before relying on it, verify live (debug build, counts/booleans only, log removed before commit) the E13 shape (`data.searchTags[].tag{id,title}`, id type, `extra`) and that E5 honours `tags_ids` (one tag ⊂ unfiltered; two tags = union or intersection — record which); record «E13 (LIVE)» / «E5 tags (LIVE)» in `docs/api-contract.md`. If either does not behave, stop and report.
- Owner decision 2026-10-29 (Q1 a): a «Теги» nav row under «Период» (value: the selected titles joined, up to 2 lines, ellipsis; «Все» when none) opens a tag level (D11): «Сбросить» on top (only while a tag is checked), the check rows, then «Загрузить ещё» / «Повторить». It opens on the first row (the tag «Сбросить» when shown). Back: tag level → sheet on «Теги» → chip. When the tag «Сбросить» goes after a reset, focus → the first tag row.
- Owner decision 2026-10-29 (Q2 a): when tags are the one active section, the chip reads the title for one tag («Фильтры · Выпечка») and «Теги: N» for several; two or more active sections keep «Фильтры» + count.

## Boundaries & Constraints

**Always:** Filter stays plain serializable data; focus moves by explicit targets; the tag list is virtualized and focus-safe while pages load; tags are server state (TanStack Query, key from `queryKeys.ts`, account-scoped cache); copy in `ru`; tokens from `shared/ui`.

**Never:** No blog tags / Автор scope (5.7), no Поиск (5.6); no tag search field; no persistence across restart; no Apply button; no auto-load on scroll (explicit «Загрузить ещё» row).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open tags | first open | E13 `limit=100`; loading row, then check rows | E13 error → «Повторить» row; OK retries, focus stays |
| Toggle | check «A», then «B» | E5 `tags_ids` = sorted ids, each change refetches; focus stays on the row | E5 error → screen error behind |
| Load more | `isLast` false | «Загрузить ещё» at the end; OK → next page with the opaque offset; focus stays (moves to the first new row only if the row goes) | page error → «Повторить» replaces it |
| No tags | `searchTags: []` | «Тегов нет» info row | — |
| Tag reset | tags checked | tag «Сбросить» clears tags only, access/period kept | — |
| Sheet reset | access + tags | sheet «Сбросить» clears all | — |
| Key stability | A+B vs B+A | same query key | — |

</frozen-after-approval>

## Code Map

- `src/shared/filters/filter.ts` -- add `TagRef {id,title}`, `tags` to `Filter`/`DEFAULT_FILTER` (frozen `[]`), `tagIdsKey(filter)` (sorted ids), count update; tests in `__tests__/` (new `tags.test.ts`).
- `src/shared/filters/filtersStore.ts` -- `toggleTag(scope, tag)`, `clearTags(scope)` (no-op when empty).
- `src/shared/api/queryKeys.ts` -- `subscriptionFeed(filter)` keys on `{access, period, tagIds}` (not titles); `useSubscriptionFeed.ts:75` trim compare keeps working through the key; new `feedTags()` infinite-query key (own root).
- `src/shared/api/dto/` -- new `feedTags.ts` Zod schema (one malformed tag dropped, not the page; `extra` as `feedPageDtoSchema.shape.extra`).
- New `src/shared/entities/tag/` (`types.ts`, `tagRepository.ts`, `index.ts`, tests) on the `author`/`user` entity pattern: `feedTagsPage(http, cursor)` → `{tags, nextCursor}`.
- `src/shared/entities/post/postRepository.ts:41-50` `feedPath` -- append `&tags_ids=` (sorted, comma-joined, encoded) when tags are set.
- `src/shared/ui/SettingRow.tsx` -- add `check` kind (DESIGN.md SettingRow check; mock `Boosty TV - Компоненты.dc.html:203`), `accessibilityRole="checkbox"`, `checked` state; keep existing kinds intact.
- `src/shared/filters/FilterSheet.tsx` -- «Теги» row + `'tags'` level (pattern already there: `Level`, `levelRef`, one `BackHandler`, `focusSoon`); list via `FlatList` with stable `filters/tag/<id>` keys; ids `filters/tags` (row), `filters/tags/list` (level), `filters/tags/reset`, `filters/tags/load-more`, `filters/tags/retry`. Reset-focus rule (`focusAfterReset`) unchanged.
- `src/features/home/HomeScreen.tsx:160-185` `chipLabels` -- tag section value (one title / «Теги: N»).
- `src/shared/i18n/ru.ts` `filters.tags.*`.
- `src/app/dev/demo.ts:308` -- demo `/v1/search/feed/tag/` (two pages) and `tags_ids` filtering of demo posts.
- Fixtures: `src/test/fixtures/boosty/e13-feed-tags-*.json` (sanitized, `check:fixtures`).

## Tasks & Acceptance

**Execution:**
- [x] Live E13 / E5 `tags_ids` check; fixtures; api-contract.
- [x] Model, store, keys, DTO, tag repository, `feedPath`, demo transport.
- [x] SettingRow `check`; sheet tag section; chip labels.
- [x] Tests: `__tests__/homeFeedFlow.test.tsx` «Story 5.5» (every matrix row, Back levels, focus on toggle/load-more/retry, 300 tags render virtualized), unit tests for key normalization, store toggles, DTO drop rules, `feedPath`.
- [x] Docs: `docs/focus-map.md` D8 («Теги» row; the inline tags of the D5 mock are superseded) + D11 (tag level), `docs/feature-parity.md` FILTER-03 «Android (Story 5.5)», `docs/testing.md` Story 5.5.
- [x] Device (release-like, owner's session, adb; foreground activity first): open tags, toggle, load more if available, reset, Back; screenshots to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; `homeFeedFlow` and new suites 30/30; lint `--max-warnings 0`, typecheck, `check:fixtures` clean.

## Implementation Notes

- Live (debug build, counts-only temporary log, removed; release bundle has no marker): E13 returned 45 tags in one page, `tag.id` numbers, `extra{offset, isLast: true}`; E5 `tags_ids` **intersects** the listed tags (a post must carry every one); a literal and an encoded comma behave the same, order does not matter. Recorded in `docs/api-contract.md` «E13 (LIVE)», «E5 tags (LIVE)». The two-page fixture split is synthetic (no body captured).
- The tag level is `src/shared/filters/TagList.tsx` (+ `useFeedTags.ts`, an infinite query on `queryKeys.feedTags()`); `FilterSheet` takes `http` (the active session's client) from Главная. The checked tags at open are listed first and the order is fixed while the level is open, so a toggle never moves a row. Focus hand-over for rows that go away is explicit (`focusRow`, retried for up to 10 frame pairs until a virtualized row mounts).
- `SettingRow` gained `kind="check"` (`checkbox` role, `checked` state, accent check mark icon).
- Device bug fixed (release-like): the tag rows were invisible because the TV `VirtualizedList` wraps its ScrollView in an unstyled `TVFocusGuideView`, so `flex: 1` on the list collapsed it to 2 px. A `flex: 1` box (`filters/tags/box`) measures itself with `onLayout` and gives the list an explicit height; host test «the list takes its box's measured height». Jest has no layout, so this was device-only.
- The first implementation run was stopped mid-way by the owner; the remaining work (device run, the fix above, docs/testing.md, verification) was finished directly in the main session.
- Device (release-like, adb, owner's session): open, toggle, scroll to the end (45 tags, no footer), two tags (chip «Теги: 2», one post), Back levels, reopen on the tag «Сбросить» with the checked tags first, tag reset. Filters left at the default. «Загрузить ещё» / failed page not seen live.

## Spec Change Log

## Review Triage Log

Iteration 0 (layers: blind-hunter 14, edge-case-hunter 5, verification-gap 2 gaps). The step-03 implementation agent had been stopped, so the patches were applied in the main session.

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind | `epic-5-context.md` still says `tagIds: string[]` | low | patch | The model is `tags: readonly {id, title}[]`; 5.6/5.7 planning reads this file. |
| 2 | blind | `epic-5-context.md` UX says tags inline in one column; old id list | low | patch | Contradicts owner decision Q1 a and focus-map D11. |
| 3 | blind | FILTER-04 row not updated | low | patch | Row still said «access section only»; resets now cover period and tags plus the tag-only reset. |
| 4 | blind | `TagList` `rows` memo depends on the whole `feedTags` object (new every render) | low | patch | `useFeedTags` returns a fresh object; deps narrowed to the primitive fields. |
| 5 | blind, edge | A string tag id with a comma would split `tags_ids` | low | patch | `z.string().trim().min(1)` accepted `"1,2"`; live, a `%2C` separates ids. String ids now digits only. |
| 6 | blind | Repeated-cursor stop untested; api-contract credits it to `TagRepository` | low | patch | The check is `nextTagCursor` in `useFeedTags`; doc reworded, flow test added. |
| 7 | blind | No tag freshness policy; test comment says «Within staleTime» | low | patch (comment) | `refetchOnMount: false`: the comment now says so. Policy itself: the list refreshes after `gcTime` (10 min closed); reject (new tags rare, a policy adds surface). |
| 8 | blind | A checked tag's stored title beats the server's; a deleted tag stays checked | low | reject | Rename/delete during a session is rare; the row stays visible and can be unchecked; a fix rewrites store titles. |
| 9 | blind | No account-isolation test for tags | false | reject | Tags live inside the scope's Filter: `filtersStore.clear()` (AccountScope) sets `filters: {}`; the query cache reset is shared by every key. |
| 10 | blind | Filtered-empty view under tags untested | false | reject | «Сбросить фильтры» calls `reset(scope)`, which deletes the whole Filter (tags included); the empty view is filter-agnostic (Story 5.3 tests). |
| 11 | blind | Long single tag title in the chip unbounded | medium | patch | `FilterChip` label had no width limit, so `numberOfLines={1}` never truncated; label `maxWidth` 360 dp. Device: the longest 5.4 range label (≈ 295 dp) still shows whole, «Обновить» in the row. |
| 12 | blind | Focus fallbacks with checked tags (retry → `rows[0]` is the tag «Сбросить»; duplicate-only page) | false | reject | `rows[0]` is the documented D11 rule («the first row»); a duplicate-only page with more pages keeps «Загрузить ещё» (still focused), without more pages focus goes to the last row (a tag). |
| 13 | blind, edge | `HomeScreen` passes `httpRef.current` captured at open | maybe-false | reject (low if true) | The client changes only on a sign-in, which cannot happen while the sheet is open; would need a session swap under an open modal. |
| 14 | blind | `FilterSheet.tsx` doc comment not reflowed | low | patch | Line ran past the comment width. |
| 15 | edge | «Тегов нет» under listed checked tags when E13 returns none | low | patch | Condition used `feedTags.tags`; now the shown `tags`. |
| 16 | edge | Focus request dropped if the row never mounts within 10 frame pairs | low | reject | The target (first new tag) is where «Загрузить ещё» was, inside the render window; a fallback adds a branch for an unseen case. |
| 17 | edge | Non-forward refetch failure with pages loaded shows no «Повторить» | false | reject | The only full refetch is `retry()`, offered only when no page is loaded; no mount/focus refetch. |
| 18 | vgap | Demo E13 pages and demo `tags_ids` intersection untested | low | patch | `demoFlow` «Story 5.5»: 8 + 8 tags, `isLast`; tags 1+5 → posts 0/12/24; two tags of one group → none. |
| 19 | vgap | «Загрузить ещё» keep-in-view `scrollToEnd` not asserted | low | patch | Flow test spies `FlatList.prototype.scrollToEnd`: one call when the row stays, none when it goes. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass.

**Result (2026-10-29, after the device fix):** lint, typecheck, check:fixtures clean; `npm test` ×3: 1850 passed each; `homeFeedFlow` + `src/shared/filters` + `src/shared/entities/tag` + `src/shared/entities/post` + `queryKeys` + `src/shared/ui` ×30: 543 passed each run, 0 failed runs.

**Result (after the review patches, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 1853 passed each; `homeFeedFlow` + `demoFlow` + `src/shared/filters` + `src/shared/entities/tag` + `src/shared/entities/post` + `queryKeys` + `src/shared/ui` ×30: 554 passed each run, 0 failed runs. The installed release-like build includes every code patch.
