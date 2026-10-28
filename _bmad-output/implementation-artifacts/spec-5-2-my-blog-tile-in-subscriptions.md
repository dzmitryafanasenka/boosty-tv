---
title: 'Story 5.2: My-blog tile in Subscriptions'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '009991d6bf9c5c6572d0d8ebba9289db52ef0c4a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A family member who owns a Boosty blog cannot open it from the TV: Подписки lists only subscribed authors (FR19, SUB-02, UX-DR7; epics.md Story 5.2).

**Approach:** When Подписки loads, read the account's `blogUrl` from E1 (`GET /v1/user/current`, content profile, the active session's client), then the blog's header (E3) and whether it has at least one post (E4 page 1). If both succeed and there is a post, a «Мой блог» AuthorCard is the first tile of the grid (the blog's owner avatar, name and title, plus a tinted «Мой блог» label); OK opens the Author page for that `blogUrl`. No blog, no post, or any failure of these requests → no tile and no error (the subscriptions grid behaves as today).

**Decisions:**
- E1 for the profile goes through a small user repository (`shared/entities/user`, the one place that parses `blogUrl`), cached under its own query key (account-scoped cache); the session's validate E1 is unchanged.
- E3 and E4 reuse the Author page's queries (`queryKeys.author`, `queryKeys.authorPosts` page 1, limit 20) instead of a separate `limit=1` request, so opening «Мой блог» is instant; the reference's `limit=1` is a cost detail, recorded as our choice.
- Tile id `subs/tile/my-blog`; a phase flag `myBlog` (AD-20) on; initial focus on it when shown (focus-map C); return from Автор → the same tile; ← from it → the sidebar. The tile appears without moving focus if it arrives after the grid rendered (focus stays on the focused author tile).
- The «Мой блог» label: `accent-tint` background with `accent-text` (DESIGN.md tokens), a11y «Мой блог. {owner}. {title}».
- If the account's own blog is also in the subscriptions list, it is shown only once (as «Мой блог», first).
- Owner decisions 2026-10-28: the owner's account has no blog with posts, so no tile on the TV is correct; **the first Подписки load waits for the my-blog check** (skeleton until E1 → E3 + E4 settle; up to ≈ 3 s on a bad network) so the tile arrives first and takes the initial focus; the tile is shown to the owner in the debug demo mode.

</frozen-after-approval>

## Code Map

- `src/shared/api/dto/userCurrent.ts` -- add an optional `blogUrl` (`blogUrlSchema`, a bad value → absent); `src/shared/entities/user/` (new) -- `UserRepository.current(http)`; `src/shared/api/queryKeys.ts` -- `me()`.
- `src/features/subscriptions/SubscriptionsScreen.tsx`, `SubscriptionsGrid.tsx`, `useSubscriptions.ts` -- the my-blog hook (E1 → E3 + E4 page 1 via the existing author queries), the first tile, focus (initial, late arrival, return), dedupe.
- `src/shared/ui/AuthorCard.tsx` -- optional label prop (tinted); `src/shared/ui/tokens.ts` (`accent-tint`, `accent-text` exist).
- `src/app/phaseFlags.ts` -- `myBlog: true`; `src/shared/i18n/ru.ts` -- `subs.myBlog`, a11y.
- Fixtures: `e1-user-current.json` already has `blogUrl: synthetic-blog-1`; reuse `e3-blog.json` / `e4-blog-posts-*.json`; demo transport answers for the demo account.
- Tests: `__tests__/subscriptionsFlow.test.tsx` (or the existing Подписки flow): tile first with a post; no tile without `blogUrl`, with an empty E4, on E1/E3/E4 failure; OK → Автор; return focus; late arrival keeps focus; dedupe; unit test for the DTO.
- Docs: `docs/focus-map.md` C, `docs/feature-parity.md` SUB-02, `docs/api-contract.md` (E1 `blogUrl` read by the user repository; E3/E4 reuse), `docs/testing.md` Story 5.2.

## Tasks & Acceptance

**Execution:**
- [x] E1 `blogUrl` DTO + user repository + query key.
- [x] My-blog tile in Подписки (label, focus, dedupe, flag).
- [x] Tests; docs.
- [x] Device (release-like, owner's session, adb; check the foreground activity first): Подписки with or without «Мой блог» for the owner's account (record which), OK → Автор, Back → the tile; screenshot to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; the Подписки flow 30/30; lint `--max-warnings 0`, typecheck, `check:fixtures` clean.

## Implementation Notes

- Final verification (coordinator, 2026-10-28): `npm test` ×3: 1717 passed each; subscriptionsFlow + authorFlow + AuthorCard ×30: 0 failed runs. Device: the owner's account shows no tile (no own blog with posts, owner-confirmed); the tile was checked in the debug demo (first, labelled, focused; OK → Автор; Back → the tile).

- **Initial focus needs a hold.** On a cold open E2 and E1 run in parallel and E3/E4 follow E1, so the tile would almost always arrive after the grid took focus. To make «Мой блог» the initial focus, Подписки keeps its skeleton on the first load (E2 not cached when Подписки mounts) until both E2 and the my-blog check have settled (`useMyBlog().isPending`; the settled flag is state set in an effect). A failed E1/E3/E4 is a settled «no tile»: these queries use `retryOnMount: false` (new `usePagedPosts` option), so a later visit shows the cached grid at once and sends nothing. After the first settle a later check (a `blogUrl` that appears, a refetch) never brings the skeleton back: the tile just arrives and the Story 3.2 data-change rule keeps focus on the focused tile. Cost: the first grid waits for E1 → E3 + E4 (and, on a network failure, for the AD-6 retries of these requests).
- **E4 via the shared paged-posts hook.** `useMyBlog` reads page 1 through `usePagedPosts` with `queryKeys.authorPosts(blogUrl)` (the Author page's key and options), not `useAuthorPosts` (that would cross a feature boundary and run the Author page's head refresh). An E4 page 1 whose posts are all dropped but has a cursor auto-fetches up to `MAX_AUTO_FETCHES` more pages, as on the Author page.
- **E1 path in the user repository.** `src/shared/api/session/` is private (ADR 0009, lint), so `UserRepository` has its own `USER_CURRENT_PATH` constant (same path).
- **Tile identity (review finding 5).** The frozen Decisions name the tile `subs/tile/my-blog`; review moved it outside the `subs/tile/<blogUrl>` namespace to `subs/mine`, so no subscribed blog (e.g. one whose `blogUrl` is `my-blog`) can share it. The plain tile of the own blog and `subs/mine` count as the same tile when one replaces the other under focus.
- **Card height (review finding 1).** With the label the owner name is clamped to one line, so label + name + title always fit the fixed 76 dp card.
- **Tests outside Подписки.** `authorFlow` and `postFlow` answer E1 without `blogUrl` (`e1NoBlogBody()`), otherwise their Подписки would send E3/E4 for `synthetic-blog-1` and change their request counts; the demo account owns `demo-blog-2`.
- **Device.** The owner's account showed no «Мой блог» (no own blog with a post, or a failed request; not distinguishable in the release build), so the tile was not seen on the device.

## Spec Change Log

- 2026-10-28 (review finding 5): the tile id is `subs/mine`, not `subs/tile/my-blog` as the frozen Decisions say — a subscribed blog whose `blogUrl` is `my-blog` would collide in the `subs/tile/<blogUrl>` namespace. Behaviour unchanged; focus-map and tests use `subs/mine`. KEEP: one id outside the tile namespace.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | The labelled AuthorCard can exceed its fixed height with a two-line owner name (blind) | medium | patch: one owner line when labelled; budget test |
| 2 | Own blog's plain tile focused, then «Мой блог» arrives and dedupes it → focus to a neighbour (blind, edge ×2) | medium | patch: same-tile mapping |
| 3 | «Late arrival» test passes on an empty list; no test for the focused «Мой блог» disappearing (blind, verification-gap) | medium | patch: tests |
| 4 | After a failed check every visit re-holds the skeleton; `settledOnce` mutated in render (blind, edge ×2) | medium | patch: hold only the first load; errored = settled |
| 5 | `subs/tile/my-blog` can collide with a `blogUrl` «my-blog» (blind, edge) | low | patch: id outside the namespace |
| 6 | E3 row and the resume refresh of the own blog's E4 undocumented (blind, verification-gap) | low | patch: docs |
| 7 | E3 query options duplicated with `useAuthor` (blind) | low | rejected: same key and repository; one hook each |
| 8 | No dev diagnostics for «no tile» reasons; live E1 `blogUrl` unconfirmed (blind) | low | rejected: the owner confirmed no own blog with posts; the tile was checked in the demo |
| 9 | Sparse acceptance criteria; status mismatch (blind) | low | rejected: spec shape; synced at completion |
| 10 | Auto-paging when every post of page 1 is dropped holds the skeleton (blind) | low | rejected: the Author page rule; bounded at 3 pages |
| 11 | «Показаны первые 30» above 31 tiles (edge) | low | rejected: N counts subscriptions (E2 is truncated at 30); «Мой блог» is not a subscription |
| 12 | A zero-post cache never refreshes until restart (edge) | false | the resume head refresh refreshes `authorPosts(ownBlogUrl)` while Подписки is mounted (finding 6) |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; the Подписки flow 30×.
