---
title: 'Story 3.2: Subscriptions grid'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: '16566745ac98286ceba5fe6c3922acba93490ff3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/adr/0011-feed-list-flashlist.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The family cannot see the authors they follow; the Подписки section is off (`phaseFlags.subs = false`) (FR18, UX-DR7; epics.md Story 3.2).

**Approach:** Enable Подписки in the sidebar and show a 3-column AuthorCard grid (avatar, blog title, owner name) loaded once via E2 through a shared Author entity and TanStack Query, with skeleton, empty, error and «Показаны первые 30» states and the 3.1 focus rules; prove E2 with the content profile on the device.

**Decisions:**
- «Показаны первые {n}» shows when E2 returned the full 30 and `total > 30` (newer EXPERIENCE/focus-map override the epic's "exactly 30"; refined in review because the live `total` ≠ `data.length`); n = tiles shown. Not focusable. No paging beyond 30 (unverified).
- OK on a tile is not wired until Story 3.3 opens Автор (as feed cards before 3.4); tiles are focusable.

## Boundaries & Constraints

**Always:**
- E2 only: `GET /v1/user/subscriptions?limit=30&with_follow=true`, content profile, HTTP client from the active session (props/context, no singleton). One request per load; key from `shared/api/queryKeys.ts`; account-scoped cache (existing `queryCache` store); `refetchOnMount` default is fine (single request).
- Shared Author entity in `src/shared/entities/author`: lenient Zod DTO, one mapper; drop+log an item without a valid `blog.blogUrl`; a blank or missing `blog.title` shows «Без названия» (owner decision 2026-10-26, review); owner name optional (empty → no line), avatar optional (placeholder). Never parse or show price/subscription money fields.
- AuthorCard (DESIGN.md: avatar, blog title max 2 lines, owner name) with 3.1 lessons: `resizeMethod="resize"`, `fadeDuration={0}`, flat native tree, `FocusableSurface` states, Russian a11y label «{title}. {owner}».
- Grid: 3 columns (owner decision, 3.1), keys and focus ids `subs/tile/<blogUrl>`, slot padding so the scaled tile and ring stay visible, bounded viewport. Focus (focus-map C1–C3): opened with OK → first tile once loaded (if the user has not moved); ← from column 1 → `nav/subs`; Back → sidebar → Главная (existing Shell); restoration by `blogUrl` on return to the section.
- States: skeleton (focus stays on `nav/subs`); empty «Подписок пока нет» + explanation, no CTA, nothing focusable (C3); error StateView with «Повторить».
- Comments, prices, subscribe/manage actions: none.

**Never:**
- No «Мой блог» tile, search, filters or Author screen (later stories); no paging; no changes to the feed's behaviour or `sessionManager.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Loaded | E2 200, 3 items, total 3 | 3 tiles; no «первые 30» note | — |
| Many | 30 items, total 55 | 30 tiles + «Показаны первые 30» | — |
| Exactly 30 | 30 items, total 30 | 30 tiles, no note | — |
| Empty | `data: []` | «Подписок пока нет» + explanation; focus stays on `nav/subs` | — |
| Malformed item | one item without `blog.blogUrl` | dropped + logged; others shown | — |
| No owner/avatar | owner missing | tile without owner line; avatar placeholder | — |
| Error | Network/Server/Parse | error StateView «Повторить»; retry reloads | AppError kind copy |
| Fixture 55 authors | virtualized grid | keys `blogUrl`, smooth focus, column kept on fast ↓ | — |

</frozen-after-approval>

## Code Map

- `src/app/phaseFlags.ts` -- `subs: false` → true (sidebar order already includes it; `nav/subs` id exists in `Shell.tsx:51-54`).
- `src/app/Shell.tsx:282-330` `SectionContent` -- `case 'subs'` currently grouped with disabled sections; render the new screen with `http`, `routeKey`, `focusContent` and a focus-info object like Главная's `HomeFocusInfo` (`isActive`, `current`, section item, `focusSidebar`). `INITIAL_CONTENT_ID` (`:60`).
- `src/features/home/*` -- the 3.1 patterns to mirror (not import: features may not import features): `HomeScreen` phase/focus effects, `FeedGrid` (FlashList over 3-post rows, `FEED_SLOT_PADDING`, card width 221, `getItemLayout` fallback), `useSubscriptionFeed` (query hook shape). Shared pieces to reuse: `src/shared/focus` (`useFocusRestoration` with `canFocus`, `FocusZone`/`useZoneItem`), `src/shared/ui` (`FocusableSurface` `resetKey`, `useItemState`, `StateView`, `Text`, tokens, `PostCardSkeleton` pattern).
- `src/shared/api/dto/*`, `queryKeys.ts` -- add `dto/subscriptions.ts` and `queryKeys.subscriptions()`.
- `src/shared/entities/post/*` -- entity layout to mirror for `entities/author`.
- `src/shared/i18n/ru.ts` -- `subs.*` copy (title «Подписки», empty title/body, «Показаны первые 30», a11y).
- `src/test/fixtures/boosty/e2-subscriptions.json` -- live shape (`{offset, limit, total, data[].blog{title, blogUrl, owner{name, avatarUrl, hasAvatar}}}` + money fields to ignore); 55-author fixture generated in memory in `src/test/` (check-fixtures forbids non-JSON there; ids within rules).
- `src/app/dev/demo.ts` -- demo transport: answer E2 inline.
- `__tests__/shellFlow.test.tsx` and other flows that assert the sidebar has only Главная/Настройки -- update for `nav/subs`.
- `docs/api-contract.md` §1 -- record the E2 content-profile device result.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/api/dto/subscriptions.ts`, `queryKeys.ts`, `src/shared/entities/author/*` (+ unit tests) -- DTO, mapper, `AuthorRepository.subscriptions(http)` → `{authors, total}`.
- [x] `src/shared/ui/AuthorCard.tsx` (+ skeleton, tests incl. native-view budget like PostCard) -- the tile.
- [x] `src/features/subscriptions/*` -- `useSubscriptions` hook, `SubscriptionsGrid` (FlashList rows of 3), `SubscriptionsScreen` states and focus rules, restoration.
- [x] `src/app/phaseFlags.ts`, `Shell.tsx`, `dev/demo.ts`, `ru.ts` -- enable and wire.
- [x] Tests: every matrix row; focus (OK-open → first tile; skeleton keeps `nav/subs`; ← → sidebar; return restores by `blogUrl`; empty → nothing focusable); account switch clears the subscriptions cache; existing flow tests updated for the extra sidebar item.
- [x] Docs: focus-map §3 C notes, api-contract E2 profile result (recorded after the device run), testing.md Story 3.2.
- [x] Device: release-like build, owner's session — E2 with the content profile (record result; on rejection stop and ask, ADR 0008), the grid with the owner's subscriptions, sidebar ↕ to Подписки, OK → first tile, ←, Back.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new flow tests 30/30; lint, typecheck, check:fixtures pass.

## Implementation Notes

- Layout: `dto/subscriptions.ts` (`subscriptionsDtoSchema`, `blogDtoSchema`, `subscriptionDtoSchema`), `shared/entities/author` (`mapSubscription`, `authorFromBlog` for E3 in 3.3, `AuthorRepository.subscriptions`, `SUBSCRIPTIONS_PATH`), `queryKeys.subscriptions()` (`['subscriptions']`), `shared/ui/AuthorCard.tsx`, `features/subscriptions/*`.
- Mapper (after review): a blank or missing title is kept as `''` and shown as «Без названия»; `blogUrl` is trimmed and rejected with whitespace, `/`, `?`, `#`, `%` or `..`; `owner.hasAvatar: false` → no avatar; items are deduped by `blogUrl` (first kept). A missing or wrong-typed `total` → null → no note. Drops log `scope=author`, `message=dropped` with the failing field names only.
- Tile geometry: 224 × 76 (the token width 232 leaves no headroom with 3 columns), row gap `author-tile-gap` 12, slot padding 6 (≥ the 1.05 scale + ring growth, 5.9 dp; tested). Focused surface `surface-focus-row` (the design's #34302C has no token). Native views per tile: 5 (budget test).
- «Показаны первые 30» sits next to the header (where the design had «28 из 55»), plain text. The header has no author count (the design's «8 авторов» is not in the spec).
- Empty copy drops the design's «нажмите «Обновить»» (C3 has no CTA): «Подписаться на авторов можно на сайте или в приложении Boosty. После этого авторы появятся здесь.» A new subscription shows on the next visit after `staleTime` (60 s).
- The Shell's content zone no longer focuses its target on mount for `subs` (as for `home`): the screen owns content focus (`SELF_FOCUS_SECTIONS`).
- Demo transport answers E2 with 8 synthetic authors (the 3 feed blogs first, no avatars).
- Fixtures: `src/test/subscriptionFixtures.ts` builds items from the live `e2-subscriptions.json` (synthetic `synthetic-blog-<n>`, `Blog <n>`, `Owner <n>`); the 55-author grid is generated in memory.
- Device run and the api-contract §1 E2 entry: done by the orchestrator (see below and `docs/testing.md` Story 3.2).

- **Device (orchestrator, adb, release-like, owner's session, 2026-10-26):** E2 with the content profile HTTP 200 (3 subscriptions shown with avatars, titles, owners; recorded in `docs/api-contract.md` §1). `nav/home` ↓ → `nav/subs`; OK → first tile focused; → next tile; ← ← → `nav/subs`; Back → `nav/home`. Owner physical-remote check: "everything works" (2026-10-26).

## Spec Change Log

- 2026-10-26, review pass 1: the «первые 30» rule (frozen: `total > 30`) is refined because the live `total` ≠ `data.length` (5 vs 3): the note shows only when E2 returned the full 30 **and** `total > 30`, with the shown count in the copy. Within the frozen intent (the note never shows for ≤ 30 subscriptions). KEEP: the rest of the implementation.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Refetch turns the grid empty while a tile is focused → focus lost (blind, edge) | medium | patch: focus `nav/subs` |
| 2 | Pending cached-grid restore not re-run when a refetch changes ids (edge) | low | patch |
| 3 | «Первые 30» relies on `total` whose meaning is unverified (live 5 vs 3); copy overstates the count (blind, edge) | medium | patch: full 30 raw AND total > 30; shown count in copy (Spec Change Log) |
| 4 | Blank title drops a real subscription (blind) | medium | patch: fallback title |
| 5 | `blogUrl` unvalidated (whitespace, path characters) — becomes an id and a 3.3 path segment (blind, edge) | medium | patch: trim + reject unsafe |
| 6 | Re-focus after refetch reorder/removal and deep-tile return on a long grid untested (verification-gap, blind) | medium | patch: tests |
| 7 | AuthorCard tests: no-op test, leaked root, hardcoded ring allowance (blind) | low | patch |
| 8 | Bottom inset possibly doubled (blind) | maybe-false | patch: verify and fix if doubled |
| 9 | `stateActionRef` depends on the whole zone object (blind) | maybe-false | patch: depend on `.ref` |
| 10 | Drop log empty fields for a root issue (edge) | low | patch |
| 11 | Spec/docs inconsistent (device task, notes, epic context contradiction, testing.md missing, 55-author grid not device-measured) (blind) | low | patch: orchestrator (spec, epic context) + implementer (testing.md, api-contract) |
| 12 | Epic-context rewrite dropped "refetch never moves focus / no post-pop fallback" and the a11y-label rule (blind) | low | patch: restored by the orchestrator |
| 13 | Tiles announced as buttons while OK is unwired (blind) | low | rejected: Story 3.3 wires OK next; TalkBack is already an open device item |
| 14 | Demo authors have no avatars; `avatarUrl` scheme unchecked (blind) | low | rejected: images carry no auth headers (content profile only for `api.boosty.to`); demo coverage is cosmetic |
| 15 | Spec `in-review` vs sprint `in-progress` (blind) | false | the workflow sets sprint `review` at completion |
| 16 | 3.1 → done bundled into this change (blind) | false | PR #24 merged; the workflow records it at the start of the next story |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass.
