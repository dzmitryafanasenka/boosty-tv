---
title: 'Story 5.1: Refresh the feed'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'ad144d4e89e5c8744eb0ed73f60f77b0b5108561'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/adr/0010-server-state-tanstack-query.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** New posts reach Главная only after a resume refresh (≥ 60 s in the background) or a restart; there is no way to pull them in on demand (FR-16, FEED-03; epics.md Story 5.1).

**Approach:** A secondary small «Обновить» button in the feed's title row, to the right of «Новое в подписках» (owner decision 2026-10-28). OK runs a forced head refresh of the feed — the existing `refreshPostsHead` (Story 3.1 resume refresh) without the staleness check: one E5 page-1 request merged into the cached feed (new posts on top, loaded pages and positions kept) — and invalidates the subscriptions query (E2, one request). While it runs the button reads «Обновляем…» (busy, not pressable, focus stays on it); the remembered feed card (by `post.id`) is kept, so ↓ returns to it, or to the existing fallback chain when it is gone. A failure keeps every card and shows a short inline error next to the button (e.g. «Не удалось обновить»), never the full-screen error; the next press tries again.

**Decisions:**
- Focus: ↑ from the first feed row → «Обновить»; ↑ from «Обновить» → the continue row's remembered card (Story 4.7), when the row is shown; ↓ from «Обновить» → the remembered feed card, else the first feed card; ← from «Обновить» → the sidebar (`nav/home`), like ← from the first column. Id `home/refresh`; a11y «Обновить ленту».
- One request per press (single-flight: a press while it runs does nothing); a resume refresh running at the same time is not duplicated (reuse the same in-flight promise or skip).
- A head refresh with a gap (no overlap with the cached head) replaces the feed with page 1, as the resume refresh does; focus then follows the existing head-change rules (Epic 3 retro A3) only if the user has not moved since the press.
- The empty state's «Обновить» (StateView) keeps working as before.
- ADR 0010 gets a note: manual refresh = forced head refresh, never a full infinite-query refetch.

</frozen-after-approval>

## Code Map

- `src/features/home/feedRefresh.ts` (`refreshFeedHead`, `FEED_HEAD_OPTIONS`) and `src/shared/entities/post/postsHeadRefresh.ts` (`refreshPostsHead`, its age check) -- add a forced variant (no staleness check), reuse the merge and the error skip.
- `src/features/home/HomeScreen.tsx` -- the title row (today «Новое в подписках» as the FlashList header under the 4.7 continue row), the button, busy/inline error state, focus moves (`useNotMovedLatch`, `useHeadChangeRefocus`, `restoreContinue`, the 4.7 `TVFocusGuideView` targets), the empty StateView.
- `src/shared/ui/Button.tsx` (secondary small, `busy`), `src/shared/i18n/ru.ts` (`home.refresh`, `home.refreshing`, `home.refreshFailed`, a11y).
- `queryKeys.subscriptions()` invalidate through the app `queryClient` (the Shell/Home already receives it).
- Tests: `__tests__/homeFeedFlow.test.tsx` (press → one E5 page 1 + one E2, «Обновляем…», new head on top, focus stays on the button; ↓ returns to the remembered card / fallback; failure → inline error, cards kept; single-flight; ↑/↓/← moves with and without the continue row).
- Docs: `docs/focus-map.md` B, `docs/feature-parity.md` FEED-03, `docs/adr/0010-…md` note, `docs/testing.md` Story 5.1.

## Tasks & Acceptance

**Execution:**
- [x] Forced head refresh + subscriptions invalidate (single-flight).
- [x] «Обновить» in the title row, busy label, inline error, focus moves.
- [x] Tests; docs.
- [x] Device (release-like, owner's session, adb): press «Обновить», «Обновляем…» shows, the feed stays, focus stays on the button; ↓/↑ moves; screenshot to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; `homeFeedFlow` 30/30; lint `--max-warnings 0`, typecheck, `check:fixtures` clean.

## Implementation Notes

- Final verification (coordinator, 2026-10-28, after the review patches): lint, typecheck, check:fixtures clean; `npm test` ×3: 1673 passed each; home + post entity suites ×30: 0 failed runs (322 tests each); device re-run of «Обновить» passed (docs/testing.md Story 5.1). The owner accepted the button's look on the screenshots before the review loop.

- `refreshPostsHead` gained `force` (no age check; joins a running refresh of the same query through its promise, a non-forced call still skips). `manualRefreshFeed` (`feedRefresh.ts`) = forced feed head refresh + `invalidateQueries(subscriptions, refetchType: 'all')`, single-flight per client.
- Title row (grid phase only): a `TVFocusGuideView` → the button (↑ from any feed column), trapping →; a band under the button with its width → the remembered feed card while the button has focus (device lesson: a full-width band lost to the card below). On a Continue card the row has no destination and the button is `focusable={false}`, so ↓ from the row keeps its column (Story 4.7).
- The button reports focus to the content zone but does not register its view there (else it would become the zone's fallback destination before any card). `Button` gained `busyLabel`, `accessibilityLabel`, `focusable`; `ListRestoration` gained `viewOf(id)`.
- Device run (release-like, adb): `docs/testing.md` «Story 5.1»; screenshot of «Обновляем…» in the agent's scratchpad, to be shown to the owner before the review loop.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | A press during a page append or a load-more error is silently skipped (blind, edge ×2, verification-gap) | medium | patch: the forced path waits for a running fetch and ignores `skipWhileError`; `keepEmptyWithMore` kept; tests |
| 2 | The button stays busy until E2 settles; the invalidate is a prefix match (blind, edge) | medium | patch: E2 not awaited, `exact: true` |
| 3 | «Не удалось обновить» never clears (blind, edge) | low | patch: cleared on data update / leaving the grid |
| 4 | grid → offline with focus on «Обновить» loses focus (edge) | low | patch |
| 5 | Busy a11y label loses context (blind) | low | patch |
| 6 | No test: ↑ from the first feed row without the continue row (blind) | low | patch: test |
| 7 | epic-5-context still describes `home/action/*` (blind) | low | patch: doc |
| 8 | FEED-03 mixes reference evidence and our note; head-merge not marked as a deviation (blind ×2) | low | patch: doc |
| 9 | No phase flag for «Обновить» (AD-20) (blind) | false | AD-20 hides incomplete entry points; the refresh is complete and shipped on |
| 10 | Manual refresh after a dead token merges an anonymous page 1 (blind) | low | defer: the existing deferred item (anonymous E5 page after a token refresh) applies to the resume refresh too |
| 11 | Spec/sprint status mismatch, empty change log (blind) | low | rejected: synced at completion; the press latching «moved» matches «focus stays on the button» |
| 12 | Return focus to the button is not by id (zone memory) (blind) | low | rejected: documented trade-off (the button is not a zone item so the cards stay the fallback) |
| 13 | `lastFeedCard.index` falls back to 0 (blind) | low | rejected: the index only orders the fallback after a gap |
| 14 | Join logs «resume refresh failed» (blind, edge) | low | rejected: the run is the resume refresh; the outcome is shown inline |
| 15 | `manualRunning` across an account switch; remount while running (edge ×2) | low | rejected: the run settles in one request; a reset leaves Главная |
| 16 | ↓ target virtualized away (edge) | low | rejected: the button is at the top; the remembered card scrolled away falls back natively |
| 17 | `listHeight` vs header in non-grid phases (blind) | low | rejected: the list renders only in the grid phase |
| 18 | Test placed inside the 4.7 describe; Button test reformat (blind) | low | rejected: cosmetic |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `homeFeedFlow` 30×.
