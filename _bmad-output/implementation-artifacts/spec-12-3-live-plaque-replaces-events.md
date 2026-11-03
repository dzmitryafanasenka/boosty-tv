---
title: 'Story 12.3: Replace «События» with a live plaque on Главная'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'fac38150880e2f6bc8c9770bb40ba5b6644aaa22'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The owner never opens «События», yet rare live streams of subscribed authors are easy to miss; finding one means opening each Author page.

**Approach:** Remove the «События» section entirely and show a «в эфире» plaque on Главная, above «Продолжить просмотр», for each subscribed author who is live now. Source: capped sequential E15 (option b) — E18 `video_stream_start` was never observed live and is only a start notice (owner decision 2026-11-02, FR-61; our improvement IMP-03).

## Boundaries & Constraints

**Always:** one pass = E2 (reuse the `subscriptions` cache when fresh) + E15 for at most the first `LIVE_PLAQUE_MAX_AUTHORS = 10` authors in E2 order, sequentially; TTL 5 min (`staleTime` 300 000) on its own query key (not under `['stream']`, so the resume `allStreams()` and Player-exit invalidations do not touch it); a new pass only on Главная mount/focus or app resume when the TTL has passed; a pass stops on `RateLimited` or `SessionExpired`; a failed author is skipped; a failed pass renders nothing (no error, no placeholder); the pass never gates Главная's loading phase or initial focus; a plaque shows only a playable live stream (`liveCardPlayable`: live, access, live sources; owner decision 2026-11-03: locked or source-less live streams get no plaque) and OK opens the live Player exactly as Author's `onOpenLive` (origin Главная, Back returns to the plaque); avatar/name from E2's Author, title from E15; plaque focus ids `home/live/<blogUrl>`; tokens only (`colors.live` badge); Russian copy and a11y label «<имя> в эфире: <название>»; account-scoped cache.

**Never:** E18 for the plaque; polling while Главная is open; more than one pass per TTL; showing scheduled, ended, locked or source-less streams; a plaque in Поиск/Подписки; keeping any События code, route, flag, query, invalidation, i18n block, fixture or test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nobody live | E15 204 for every author | No plaque row; Главная as today | N/A |
| One live | author 2 E15 200 live, playable | Row above Continue (or above the feed title without Continue) with one plaque | N/A |
| Several live | 2 playable live authors | Two plaques in E2 order, ← → between them | N/A |
| Not playable | live but `hasAccess:false` or no live sources; scheduled | No plaque for it | N/A |
| Cap | 15 subscriptions | E15 sent for the first 10 only, one at a time | N/A |
| TTL | Главная left and reopened / app resumed < 5 min later | No new E2/E15 | After 5 min: one new pass |
| Errors | one E15 fails; or 429 | Failed author skipped; on 429/expired the pass stops, no plaque from it | Nothing shown, logged without names/URLs |
| OK | OK on a plaque | Live Player for that blog; Back → Главная with focus on the plaque | Player errors as today |
| Focus | Главная opens | Initial focus unchanged (remembered item, else Continue, else feed); ↑ from the first row below reaches the plaque row; Back from a plaque → `nav/home` | N/A |
| События removed | Sidebar | Главная, Поиск, Подписки, Настройки; no `events` route, flag, query or E18 request anywhere | N/A |

</frozen-after-approval>

## Code Map

- `docs/api-contract.md` -- E15 (l.453-475, 200 shape is REF: a live 200 was never seen), E18 (l.490-501), E2 (`limit=30`, no paging, no activity order). Rewrite the rule «Главная… never send E15» (l.462) and record the source choice and its evidence.
- `src/shared/entities/stream/streamRepository.ts` -- `fetchActive(blogUrl)` (null on 204/empty), `retry:false`; `types.ts` `Stream`, `LiveRef`.
- `src/features/author/LiveCard.tsx` -- `liveCardPlayable(stream)` (l.73); reuse via a shared location if needed (boundaries: features must not import each other except allowlisted edges).
- `src/features/author/useAuthorLive.tsx` -- pattern only (30 s polling is Author-only; do not copy).
- `src/shared/entities/author/authorRepository.ts` -- E2 `subscriptions`; `src/features/subscriptions/useSubscriptions.ts` uses `queryKeys.subscriptions()`.
- `src/shared/api/queryKeys.ts` -- add a live-plaque key; remove `events()`; `allStreams()` stays.
- `src/app/App.tsx` -- `onOpenPlayer` (l.257-268, MediaRef only) → add a live open for Главная (Player route already takes `LiveRef`); resume handler l.466-487: drop the `events()` invalidation, refetch the plaque only when stale.
- `src/app/Shell.tsx`, `Sidebar.tsx`, `phaseFlags.ts`, `bootstrap.ts` (`eventReadMarksAccountStore`), `src/app/dev/demo.ts` (demo E18 → demo E15 live for one author) -- События removal points listed in the investigation (Shell l.11, 92, 305-312, 409, 431-434, 484-494).
- Remove: `src/features/events/**`, `src/shared/entities/event/**`, `src/shared/api/dto/events.ts`, `src/test/fixtures/boosty/e18-events*.json` (update `checkFixtures` count), `__tests__/eventsFlow.test.tsx` (move its stale-resume request-count test to a home/resume flow without E18), i18n `shell.nav.events` + `events` block.
- `src/features/home/HomeScreen.tsx` -- header only when `phase==='grid' && showContinue` (`ContinueHeader` l.1141); the plaque row needs a slot also without Continue; `listHeight` (l.280) accounts for the row; `takeContentFocus` (l.451) unchanged; ↑ targets.
- Tests: `src/test/authorFixtures.ts` (`e15Path`, `e15None`, `e15Stream`), `subscriptionFixtures.ts`, `transport.callsTo`; sidebar-id lists in shell/subscriptions/code/demo/author/post flow tests; `phaseFlags.test.ts`, `queryKeys.test.ts`, `accountScopeRegistry.test.js`, `catalog.test.ts`.
- Docs: `docs/focus-map.md` (nav ids, §5 J removed, Главная plaque row), `docs/feature-parity.md` (EVT-01 removed, IMP-03 as built), `docs/testing.md`, `docs/adr/0010-…` resume bullet, DESIGN.md LivePlaque/sidebar rows, EXPERIENCE.md mentions, CHANGELOG pair.

## Tasks & Acceptance

**Execution:**
- [x] Live-plaque data (`src/features/home/useLivePlaque.ts` or a shared service + tests) -- the bounded pass, TTL key, stop rules, playable filter; unit tests for request count per pass, sequential order, cap, TTL, stop on 429/expired, skip on error.
- [x] `src/features/home/LivePlaque*.tsx`, `HomeScreen.tsx`, `App.tsx`/`Shell.tsx` -- row, focus, OK → live Player, Back restore.
- [x] События removal across app, shared, tests, fixtures, demo, i18n.
- [x] Flow tests for every matrix row (home flow + resume request counts).
- [x] Docs and changelog listed in the Code Map.

**Acceptance Criteria:**
- Given the release-like build on the pinned TV with nobody live, then Главная shows no plaque, the sidebar has 4 items, and no E18 is sent (logcat/request log); a live plaque is checked only when a subscribed author is live (owner, when it happens) or via demo mode.
- Given `npm run lint`, `npm run typecheck`, `npm test`, then all pass.

## Implementation Notes

- Pass and hook: `src/features/home/livePlaque.ts` (`runLivePlaquePass`, `refreshLivePlaque`, `useLivePlaque`; `LIVE_PLAQUE_MAX_AUTHORS` 10, `LIVE_PLAQUE_TTL_MS` 300 000, key `queryKeys.livePlaque()` = `['livePlaque']`). The pass never rejects (a failure is an empty result), so the TTL also holds after a failure and a remount never retries early. It waits for Главная's grid phase. The Shell-focus trigger listens to the navigation `focus` event through `NavigationContext` (no hard dependency on a navigator, so a HomeScreen rendered alone still works).
- The query fn does not read TanStack's `signal` (a consumed signal cancels and reverts the query when Главная unmounts, which would start a second pass on return); a started pass completes, and only an AccountScope generation change stops it between authors.
- A live Player opened from a plaque that finds the stream unplayable invalidates `['livePlaque']`, so a new pass drops the stale plaque at once.
- `isPlayableLive` moved to `src/shared/entities/stream/types.ts`; `liveCardPlayable` delegates to it.
- Row: `src/features/home/LivePlaqueRow.tsx`, `live-plaque` tokens (replaces `event-row`). With Continue it is the first part of the list header; without Continue it sits above the title row outside the list (the list height drops by `LIVE_PLAQUE_ROW_HEIGHT`). Grid phase only.
- New capability flag `phaseFlags.livePlaque` (on): App passes `onOpenLive` only with `player && live && livePlaque`. Flow tests whose subject is not the plaque turn it off via `src/test/phaseFlagsMock.ts`, so their request counts stay as they were; the plaque's own flow test is `__tests__/livePlaqueFlow.test.tsx` (replaces `eventsFlow`).
- Live Player opened from Главная that finds the stream unplayable at resolve time only leaves (no pending QR for the Shell; `origin.sectionId` set).
- Removed: `src/features/events`, `src/shared/entities/event`, `src/shared/api/dto/events.ts`, `e18-events*.json`, `eventsFlow`, `shell.nav.events` and the `events` i18n block, `NAV_ID.events`, `phaseFlags.events`, `queryKeys.events()`, the resume `events()` invalidation, the demo E18.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | edge | `queryFn` consumes TanStack's `signal`: unmount mid-pass cancels and reverts the query, so each remount starts a new pass (breaks one pass per TTL) | medium | TanStack v5 cancels a query whose fn consumed the signal when all observers unmount; `useLivePlaque` passes `signal` to `runLivePlaquePass` | patch |
| 2 | edge, blind | A plaque whose stream became unplayable bounces back silently and stays up to 5 min | medium | `onLiveUnplayable` with `origin.sectionId` only `goBack()`s; `['livePlaque']` is not invalidated | patch |
| 3 | vgap, blind | Unplayable-from-Главная exit untested | medium | No test covers the `origin.sectionId` branch | patch |
| 4 | vgap | Shell `focus` listener refresh after the TTL untested | medium | Tests pass with the effect deleted | patch |
| 5 | vgap | Plaque focus fallbacks (neighbour plaque, Continue, Back after removal) untested | medium | Only the single-plaque → feed path is asserted | patch |
| 6 | blind | Account isolation of `['livePlaque']` untested | medium | No sign-out / switch case with plaques | patch |
| 7 | edge | Row remounts between slots when Continue toggles while a plaque has focus | low | Continue changes only from playback, removal (focus on the Continue row) or reset; a live plaque's player writes no progress | rejected (unlikely) |
| 8 | edge | Focused plaque removed with no feed card | false | Plaques render only in the grid phase, which has feed cards | rejected |
| 9 | blind | `origin.sectionId` as the Author/Главная discriminator is fragile | low | Works today; an explicit flag adds route surface | rejected |
| 10 | blind | In-flight E15 is not aborted; JSDoc says «sends nothing more» | low | At most one request; fix the wording | patch |
| 11 | blind | A failed pass hides lives for the whole TTL; the 10-author cap is invisible | low | Spec-mandated trade-offs, not documented as known limits | patch (docs) |
| 12 | blind | Plaque × filter change / Continue removal flows untested | low | Focus is on the chip or the Continue row in those actions | rejected |
| 13 | blind | `autoContinue` reused for plaques | low | Naming only, no named failure | rejected |
| 14 | blind | `author.live.untitled` used from Главная | low | Cross-feature i18n coupling; direct fix | patch |
| 15 | blind | DESIGN.md still lists `event-row.skeletonLine` | low | Stale doc text | patch |
| 16 | blind | «в эфире» badge contrast unverified | maybe-false | `colors.live` pair used by the Author live badge already; a live device screenshot settles it | rejected (needs a live stream) |
| 17 | blind | Statuses / AC1 pending | false | Synced at present; device check runs before the PR | rejected |
| 18 | blind | Expired-session test mocks `http.request` internals | low | Test style; works | rejected |

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test` -- expected: all pass.
- `cd android && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- BUILD SUCCESSFUL; Hermes bundle: `nav/events` 0, `notification/standalone` 0.

**Manual checks (if no CLI):**
- adb (foreground checked): sidebar items, Главная without a plaque, Back/focus unchanged.
