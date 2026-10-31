---
title: 'Reconcile the planning artifacts with the Epics 3, 5–7 as-built'
type: 'chore'
created: '2026-10-31'
status: 'done'
route: 'oneshot'
baseline_commit: '48b1a22'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-retro-2026-10-30.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-retro-2026-10-30.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-retro-2026-10-29.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-retro-2026-10-27.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The planning artifacts (`epics.md`, `EXPERIENCE.md`, `DESIGN.md`, `ARCHITECTURE-SPINE.md`) were not updated during Epics 3, 5, 6 and 7, so they no longer match the code and the owner decisions recorded in the story specs and ADRs. The Epic 3 pass of `docs/feature-parity.md` was also deferred. Four action items track this drift:
- `epic-7-retro-item-35` (A3). It supersedes `epic-5-retro-item-23` (A5) and `epic-6-retro-item-30` (A5).
- `epic-3-retro-item-17` (A9).

**Approach:** One docs-only pass.
- **Owner-approved text:** keep it, and add an **As built** or *Superseded* note next to it that names its evidence (a story spec, an ADR, or the code).
- **No new behaviour:** nothing is invented. Every note was checked against `src/` or a recorded owner decision.
- **Untouched:** no code or tests, no DESIGN.md frontmatter tokens, no `sprint-status.yaml`, and no edits to the Claude Design mock HTML. The mocks are marked superseded in DESIGN.md and EXPERIENCE.md instead.

</frozen-after-approval>

## Changes and evidence

### `_bmad-output/planning-artifacts/epics.md`
- **Overview:** a note on the reconciliation convention (As built notes, evidence named).
- **FR notes:**
  - FR9 and FR52: E18 verified, События on (spec 7.5).
  - FR16: forced head refresh (spec 5.1, ADR 0010).
  - FR21: E15 polling for live and scheduled cards (spec 7.1 Q1 a).
  - FR24: like only on a live card with access (spec 7.4 Q2 a).
  - FR28: no «Только купленные» on Автор (spec 5.7 A a).
  - FR34: no collapse (spec 6.1 Q1 a).
  - FR35: post links and timestamp links (spec 6.3).
- **Additional Requirements:**
  - AD-7: resume head refresh, plus `staleTime: 0`, polling and resume invalidation for streams and events (ADR 0010; `useAuthorLive.tsx`, `useEvents.ts`, `App.tsx`).
  - Lists: FlashList (ADR 0011; `PostGrid.tsx`, `SubscriptionsGrid.tsx`, `EventsScreen.tsx`; `TagList.tsx` stays a FlatList).
  - AD-13: the JS stack, not a native stack (ADR 0007).
- **UX requirements:** UX-DR8 (LiveCard buttons, spec 7.4) and UX-DR10 (header on top, `spec-post-header-layout.md`).
- **Epic 3:**
  - Story 3.1: 3 columns, FlashList, resume head refresh (spec 3.1, ADR 0010/0011, `spec-feed-refresh-on-resume.md`).
  - Story 3.2: FlashList, name first (`spec-pin-icon-and-author-name-first.md`).
  - Story 3.3: sidebar on stack screens (ADR 0012), head refresh (`spec-author-posts-refresh.md`), pinned badge (`spec-pinned-post-label.md`, `spec-pin-icon-and-author-name-first.md`), name first.
  - Story 3.4: header on top, sidebar, paragraph stops, inline links (spec 3.4, `spec-post-header-layout.md`).
  - Story 3.6: teaser image (spec 3.6).
- **Epic 5:**
  - Story 5.1: head refresh, button placement, inline error.
  - Story 5.2: Author queries with `limit=20`; the first load waits for the check.
  - Story 5.3: chip placement and default.
  - Story 5.6: search on «Готово», query store, no refresh of results.
  - Story 5.7: `author:<routeKey>`, «Доступные мне» default, no «Только купленные», client-side drop (`src/shared/filters/filter.ts`, `useAuthorFilters.tsx`).
- **Epic 6:**
  - Story 6.1: no collapse.
  - Story 6.2: one-column width, no focus scale.
  - Story 6.3: «Открыть» / «Смотреть» chips, headings (`PostBody.tsx`, `ru.ts`).
  - Story 6.4: paused audio keeps the screen on (`deferred-work.md`, POST-06).
  - Story 6.5: per-option count, option drop.
  - Story 6.6: change vote, two-OK improvement, error collapse (`usePollVote.ts`).
- **Epic 7:**
  - Story 7.1: polling for live and scheduled cards, `staleTime: 0`, resume invalidation, failure handling, flag (`useAuthorLive.tsx`, `App.tsx`).
  - Story 7.2: quality rule (gear only with a real choice), invalidation on any exit, the playable rule (`stackRoutes.tsx`, `LiveCard.tsx`).
  - Story 7.4: like and share visibility, heart plus count, details line, focus (`LiveCard.tsx`, `useLiveLike.ts`).
  - Story 7.5: flag on, «Обновить» on empty, hidden owner and comment types, `staleTime: 0`, local read marks (`useEvents.ts`, spec 7.5).
- **Story 9.3:** a note that FlashList was already adopted in Story 3.1.

### `_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/EXPERIENCE.md`
- **Frontmatter:** `updated` 2026-10-31.
- **Information Architecture:** the sidebar on Автор and Пост (ADR 0012). События verified and shown (`:42`).
- **Component Patterns:**
  - «Обновить»: forced head refresh, inline error.
  - LiveCard: playable rule, like and share visibility, focus (`:68`).
  - FilterChip: Author access values and the per-route Filter.
  - ParagraphStop: no collapse, the 600-character split, headings.
  - LinkChip: «Открыть» / «Смотреть».
  - Single-choice PollOption: change vote, error collapse.
  - QualityOption: the live gear rule.
  - EventRow: local read mark.
- **State Patterns:**
  - Resume from sleep: the as-built head refresh and invalidation, and what is not refreshed (`:113`).
  - Автор: polling for live and scheduled cards (`:124`).
  - Пост: no collapse (`:126`).
  - События: «Обновить» on empty, hidden types, first page only (`:128`).
- **Live player:** the quality gear rule.
- **Overrides of the mocks:** the superseded 4-column grids, the two-column Post and the sidebar on stack screens.

### `_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md` (frontmatter untouched)
- **Layout:**
  - The 4-column post grid is marked superseded by 3 × 221 dp (spec 3.1; `POST_GRID_COLUMNS = 3`).
  - A «Superseded mocks» note lists the 4-column and two-column mock files.
- **Components:**
  - The ≈ 260 dp post left-column estimate is marked obsolete.
  - LiveCard: the as-built states, details line and button column (`LiveCard.tsx`, now `:240`).
  - ImageBlock: one-column width, no focus scale (spec 6.2, now `:242`).
  - ParagraphStop: every paragraph (now `:243`).
  - LinkChip: the action suffixes.

### `_bmad-output/planning-artifacts/architecture/architecture-boosty-tv-2026-10-25/ARCHITECTURE-SPINE.md`
- **Frontmatter:** `updated` 2026-10-31.
- **AD-4:**
  - The as-built registered stores (`bootstrap.ts`).
  - The **generation-keyed module state exception** for `usePollVote` and `useLiveLike` through `src/shared/account/generationKeyed.ts`.
- **AD-5:** the accepted poll error collapse (Epic 6 retro A5).
- **AD-7:**
  - The stream query: `staleTime: 0`, `retry: false`, **E15 polling every 30 s**, invalidation on any live-player exit, and the own root for signed live URLs.
  - The `['events']` query.
  - **Resume:** a head refresh for paged lists (never an invalidation), plus invalidation of `allStreams()` and `events()`. What is not refreshed.
- **AD-8:**
  - Mapper file naming.
  - The **entity → entity edges** `entities/post → entities/poll` (Story 6.5) and `entities/stream → entities/post/videoSources` (Epic 7 retro).
- **AD-12:** the focus-id prefixes on stack screens, `setReturnFocus` as a Shell callback, and Пост's own focus memory (Epic 3 retro pattern divergence).
- **AD-17:** the `section` route param and `StackSidebarRoute` (ADR 0012).
- **AD-18:** tags as `{id, title}`, the per-route `author:<routeKey>` scope, Author access values, the client-side drop (Epic 5 retro A5).
- **Conventions › Lists:** FlashList (ADR 0011).
- **Stack:** the real svg and QR pins 6.3.26 / 15.15.5 (ADR 0013/0014; Epic 6 retro A5), plus a flash-list row.
- **Deferred:** the FlashList and events paging notes.

### `_bmad-output/implementation-artifacts/epic-5-context.md`, `epic-6-context.md`
- An «As-built reconciliation (2026-10-31)» section in each. Both files are named in the Epic 5 A5 and Epic 6 A5 action items.

### `docs/feature-parity.md` (the deferred Epic 3 pass)
- **Android notes and Tests cells:**
  - FEED-01 (Story 3.1);
  - FEED-02 (Stories 3.1, 3.3);
  - SUB-01 (Story 3.2);
  - AUTH-PAGE-01 (Story 3.3);
  - POST-01 and POST-11 (Story 3.4);
  - POST-04 (Story 3.5, base rows);
  - POST-09 (Stories 3.1, 3.4);
  - POST-10 (Story 3.4, read-only likes).
- **Evidence:** test names come from the flow `describe` blocks and unit test files in the repo. Device notes come from `docs/testing.md` «Story 3.1»–«Story 3.6».

## Checks

- `npm test -- tokens`: 11 passed (DESIGN.md frontmatter unchanged).
- `npm run check:fixtures`: 30 fixtures clean.
- The other suites that read DESIGN.md (`phaseFlags`, `seekController`, `FilterChip`) and `checkFixtures`/`noRawText`: passed.
- No lint or typecheck: docs only.

## Not reconciled

- Nothing from the A3/A9 lists is left open. While editing, one line outside their scope was also fixed: `epics.md` AD-13 «a root native-stack» now has an As built note (the JS stack, ADR 0007).
- `review-rubric.md`, `prd.md` and `brief.md` were not reviewed in this pass. A3/A9 do not list them.
