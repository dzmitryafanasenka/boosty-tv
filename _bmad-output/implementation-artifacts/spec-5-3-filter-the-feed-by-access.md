---
title: 'Story 5.3: Filter the feed by access'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '8f7098ff1c349a7594d49b07c7bae4e2c07835ae'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Главная always shows the server's default mix of posts; a family member cannot switch to only the posts they can open, all posts, or only purchased ones (FR17, FR28, FR31, FILTER-01; epics.md Story 5.3).

**Approach:** A «Фильтры» chip in the feed's title row opens the filter SideSheet (320 dp, focus trapped, opens on the selected value) with three access values «Доступные мне», «Все посты», «Только купленные». Selecting one applies at once: the feed refetches behind the sheet with the matching E5 params (`only_allowed` / `only_bought`; «Все посты» sends both `false`), focus stays in the sheet. A non-default value shows «Сбросить» in the sheet and a count on the chip. Back closes the sheet, focus → the chip. The Filter lives in a new `shared/filters` `filtersStore` (Zustand, scope `feed`, in memory, account-scoped via AccountScope). A filtered empty feed shows «Ничего не найдено» + «Сбросить фильтры».

**Decisions:**
- Filter model (AD-18) starts with `access: 'allowed' | 'all' | 'bought'` only; Stories 5.4/5.5 add `period` and `tagIds`. The Filter is part of the feed query key; every feed path (page loads, resume head refresh, «Обновить») uses the active `feed` Filter.
- Before relying on the params, verify live on the device (debug build, content profile, log only counts: posts per page, how many `hasAccess:false`) what E5 returns for: no params, each of the three values. Record in `docs/api-contract.md` E5 (LIVE) with sanitized fixtures; if a value does not behave as the reference says, stop and report.
- The locked-page session check (Story 3.1) runs only for `access: 'allowed'` (an all-locked page under «Все посты» / «Только купленные» is legitimate).
- Ids: chip `home/filters`; sheet `filters/access/<value>`, `filters/reset`. When «Сбросить» disappears after a reset, focus → `filters/access/allowed`.
- Filtered empty (non-default filter, page 1 empty): StateView «Ничего не найдено» with «Сбросить фильтры» (resets to defaults, focus → first feed card when it arrives, else stays on the state action). Default-filter empty keeps today's «Новых постов нет».
- Phase flag `filters: true` (AD-20) gates the chip; flag off → no chip, default filter.
- Owner decisions 2026-10-28: **the chip sits between the title and «Обновить»** («Новое в подписках» … [«Фильтры · Доступные мне»] [«Обновить»]; ← → between them); **the default access is «Доступные мне»** (the reference default; locked posts leave Главная by default).

## Boundaries & Constraints

**Always:** UI → hooks → repositories; no HTTP in screens; copy in `ru`; tokens from `shared/ui`; focus moves only by explicit targets (no reliance on Android fallback); refetch never moves focus out of the sheet.

**Never:** No period/tag sections, no Поиск/Автор filters (5.4–5.7); no persistence across restart; no Apply button; no comments.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | OK on chip | sheet, focus on the selected value | — |
| Select | «Все посты» | one E5 page 1 with `only_allowed=false&only_bought=false`; focus stays; «Сбросить» appears; chip count 1 | E5 fails → the screen's existing error state behind; sheet stays usable |
| Reset | OK «Сбросить» | default, E5 from cache or refetch; focus → «Доступные мне» | — |
| Back | sheet open | sheet closes, focus → chip | — |
| Empty | «Только купленные», no posts | «Ничего не найдено» + «Сбросить фильтры» | — |
| Account | sign-out / switch | filter back to default | — |
| Resume | non-default filter, resume refresh | head refresh of that filter's key only | — |

</frozen-after-approval>

## Code Map

- `src/shared/entities/post/postRepository.ts` -- `feedPath(cursor)` l.24, `feedPage` l.78: add the access params (no params today).
- `src/shared/api/queryKeys.ts:9` -- `subscriptionFeed()` → `subscriptionFeed(filter)` (filter object, no URL/cursor in keys).
- `src/features/home/useSubscriptionFeed.ts` -- pass the filter to the fetcher and key; session check (l.38-44) only for `allowed`.
- `src/features/home/feedRefresh.ts` -- `refreshFeedHead` l.52, `manualRefreshFeed` l.85 take the filter; `src/app/App.tsx:378` resume handler reads `filtersStore.getState()`. `refreshPostsHead` unchanged (generic over key+fetcher).
- `src/shared/filters/` (new) -- `Filter` type, defaults, `isDefault`/`activeCount`, `filtersStore` (Zustand) with `defineAccountScoped`; register in `src/app/bootstrap.ts:33-41` (registry test `__tests__/accountScopeRegistry.test.js`). The filter sheet content (access radio rows, «Сбросить») lives here, built on `SideSheet variant="filters"` + `SettingRow kind="radio"`; open via `useModal().open(content, initiatorRef, {placement:'end'})` (`src/shared/focus/ModalHost.tsx`); initial focus like `PlayerSettingsSheet.tsx` (`requestHostFocus`, ~l.110).
- `src/shared/ui/` -- new `FilterChip` (tokens `filter-chip` in `tokens.ts:190`; label + value, count badge `accent-tint`); DESIGN.md FilterChip row.
- `src/features/home/HomeScreen.tsx` -- `FeedTitleRow` l.869-960 (add the chip; ↑ from the first feed row → the row's last focused control, else the chip; ↓ from the chip → remembered feed card like «Обновить»'s down guide; ← → between chip and «Обновить»); phase handling l.328-336 and empty StateView l.795-811 (filtered empty variant). Keep `useNotMovedLatch`, `useHeadChangeRefocus`, continue-row guides intact.
- `src/app/phaseFlags.ts` + `src/app/Shell.tsx:392` -- `filters` flag passed as a prop (like `myBlogEnabled`).
- `src/app/dev/demo.ts:279-282` -- demo E5 honours the params (allowed → accessible posts, all → everything, bought → empty) so the states are demonstrable.
- `package.json` -- add `zustand` exact 5.0.x (ARCHITECTURE-SPINE pin), a version published ≥ 14 days ago.
- `src/shared/i18n/ru.ts` -- `filters.*` (title, access labels, reset, chip label/a11y with count), `home.feed.filteredEmpty*`.

## Tasks & Acceptance

**Execution:**
- [x] Live E5 check (device, debug, counts only); api-contract E5 + fixtures.
- [x] Filter model + store + AccountScope; E5 params, query key, refresh paths, session-check rule; demo transport.
- [x] FilterChip, filter sheet, title-row focus, filtered empty state, phase flag.
- [x] Tests: `__tests__/homeFeedFlow.test.tsx` (every matrix row; existing exact-URL assertion l.215 updated; chip ↑↓←→; resume/«Обновить» use the active filter; session check skipped for non-default), store unit tests, FilterChip component test.
- [x] Docs: `docs/focus-map.md` B + D8 (Главная initiator, ids), `docs/feature-parity.md` FILTER-01 «Android (Story 5.3)», `docs/api-contract.md` E5, `docs/testing.md` Story 5.3.
- [x] Device (release-like, owner's session, adb; check the foreground activity first): open sheet, each value, Back → chip, reset; screenshot to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; `homeFeedFlow` and new suites 30/30; lint `--max-warnings 0`, typecheck, `check:fixtures` clean.

## Implementation Notes

- Final verification (coordinator, 2026-10-28, after the review patches): lint `--max-warnings 0`, typecheck, check:fixtures (18) clean; `npm test` ×3: 1755 passed each; homeFeedFlow + filters + FilterChip + post entity + queryKeys ×30: 0 failed runs. The owner accepted the chip and the sheet on the device screenshot before the review loop.
- Live E5 (debug build, counts only): no params and «Доступные мне» return the same page 1 (10 posts, 0 locked); «Все посты» 10 with 4 locked; «Только купленные» 1, `isLast`. The reference mapping holds; the default changes nothing on today's Главная. Details: `docs/api-contract.md` «E5 access params (LIVE)».
- `zustand` 5.0.15 (exact; 5.0.16 was under 14 days old). The Filter is the third element of the feed key (whole object, review finding 1).
- Beyond the letter of the spec: the chip is also shown above the empty and error views (an empty «Доступные мне» feed may have posts under «Все посты»), and above a skeleton after a Filter change. Leaving a Filter trims its cache to page 1 with its age (`trimPostsToFirstPage`): a key change ignores `refetchOnMount: false`, so switching back would refetch every loaded page (seen on the device as 2 E5 calls); recorded in ADR 0010 and focus-map.
- Device (release-like, adb): open, each value, Back → chip, reset → «Доступные мне», chip ↔ «Обновить» ↔ feed moves. Not run on the device: the filtered empty view, resume/«Обновить» under a non-default Filter, sign-out reset, the review patches (host-only), the physical remote, TalkBack.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Feed query key copies only `access`; later Filter fields would share one cache (blind) | low | patch: whole Filter in the key; key test |
| 2 | Demo E5 treats «no params» as «Все посты», against the live finding (blind) | low | patch |
| 3 | No dependency record for zustand (version, publish date) (blind) | low | patch: testing.md dependency line |
| 4 | Default params compared with no params on page 1 of one account only, not tracked (blind) | low | patch: testing.md open risk |
| 5 | Trimming the left feed can drop the remembered card; fallback undocumented (blind) | low | patch: focus-map note |
| 6 | No test reopens the sheet on a non-default value (verification-gap, blind) | medium | patch: flow test |
| 7 | `trimPostsToFirstPage` cancelling a running fetch untested (verification-gap) | medium | patch: unit test |
| 8 | Offline while the sheet is open / the chip focused unmounts the initiator (blind, edge, verification-gap) | false | `homeOffline` turns true only on the cold-start E1 or the offline view's «Повторить» (`App.tsx` `applyColdResult`); a resume never sets it, so no online phase with the chip can turn offline |
| 9 | Spec status / empty bookkeeping sections (blind) | low | rejected: synced at completion |
| 10 | Reviewed diff omits `package-lock.json` (blind) | false | the lockfile is in the working tree; only the review patch excluded it |
| 11 | «Kept across a same-account re-login» untested (blind) | low | rejected: AccountScope semantics (reset on sign-out/switch only) are tested in Epic 2 |
| 12 | FilterSheet has no own component test (blind) | low | rejected: every behaviour is covered in `homeFeedFlow` (finding 6 adds the missing one) |
| 13 | FilterChip has no pressed state (blind) | false | `FocusableSurface` applies `focus.pressed-scale` to every surface |
| 14 | `filterTouched` never resets: chip above later skeletons (blind) | low | rejected: the chip is a valid control there; the documented rule says «after a Filter change» |
| 15 | Empty → empty view switch after a reset not device-checked (blind) | low | rejected: testing.md lists the filtered empty view as not run on the device |
| 16 | Synthetic fixture has no marker (blind) | low | rejected: api-contract states it is built from `e5-feed.json` |
| 17 | API/entity layers import from `shared/filters` (blind) | low | rejected: type-only import of the plain `filter.ts`; lint boundaries pass |
| 18 | Chip a11y count concatenated in code (blind) | low | rejected: Russian-only catalog, the plural forms are in it |
| 19 | Held error of the previous Filter shown while a new Filter loads (edge) | low | rejected: shows as the busy error view until the new page 1 settles; needs switching from an error state |
| 20 | Auto-paging cap survives a Filter change (edge) | low | rejected: needs 3 all-dropped pages on the previous Filter |
| 21 | «Обновить» after a Filter change joins the previous Filter's run; its result shown (edge ×2) | low | rejected: one E5 request window; `refreshRunning` already ignores a second press |
| 22 | `focusFirstAfterReset` stays set after a reset onto an empty default feed (edge) | low | rejected: the move needs `mayTakeFocus()` (focus still on that action), where the first card is the right target |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `homeFeedFlow` 30×.
