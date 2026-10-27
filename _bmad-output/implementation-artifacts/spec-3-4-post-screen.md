---
title: 'Story 3.4: Post screen'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: 'b1c6172ecd82083418ffdfab544149010101651c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/adr/0012-sidebar-on-stack-screens.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** OK on a post card (Главная, Автор) does nothing; the family cannot open and read a post (FR32, FR38, UX-DR10/11; epics.md Story 3.4).

**Approach:** Add the `Post {blogUrl, postId}` stack route with the shared sidebar (ADR 0012): E8 fetched through `PostRepository`, a two-column layout (left: author row → Автор, title ≤ 6 lines, date · read-only like count; right: the blocks as plain paragraphs or neutral placeholders), skeleton / error / «Пост недоступен» states, and Back to the origin card with focus restored.

**Decisions:**
- Sidebar (owner decision 2026-10-27, ADR 0012): Post shows the shared sidebar; current item = the origin section (Главная from the feed; Подписки from Автор). OK on a sidebar item pops to the Shell and opens that section; Back anywhere pops.
- Long text before Story 6.1 (owner decision 2026-10-27, option A): every paragraph is a focus stop (ParagraphStop: subtle `surface` background + 2 dp accent bar, no scale); no collapse (6.1). ↓ ↑ move between paragraphs and the right column scrolls to the focused one; ← returns to the author. Initial focus: the first paragraph; a locked post or a post without text → the author. Placeholders stay non-focusable.
- Inline links (owner decision 2026-10-27, after the device run): a `link` block inside a paragraph (between text fragments before `BLOCK_END`) keeps its text in the paragraph as plain text; no placeholder, no action (LinkChip/QR is Story 6.3). A link without text is skipped. The same applies to link fragments in list items.
- Not in 3.4: MediaRows and «Смотреть» (3.5, Epic 4), locked copy (3.6), styles/emoji/collapse (6.1), images/links/files/audio/polls (Epic 6). `ok_video` blocks show the neutral placeholder until 3.5. A locked post shows its header and teaser placeholders; initial focus on the author.

## Boundaries & Constraints

**Always:**
- E8 `GET /v1/blog/{blogUrl}/post/{postId}?comments_limit=0&reply_limit=0` only, content profile, the active session's `http`, key `queryKeys.post(blogUrl, postId)` (no URL/signed value). Post at the top level; reuse `mapPost` (one mapper); add the like count (`count.likes`, optional) to the Post entity. Never read or show comments, prices, reactions other than likes, `playerUrls`, `signedQuery`, `timeCode`.
- Verified not-found: E8 404 → «Пост недоступен» + «Назад», no «Повторить». Other failures: `error.<kind>` + «Повторить». A locked post is never treated as a session problem.
- Paragraph text: `text` fragments merged until `BLOCK_END`, plain `typography.body`; `list` blocks render their nested text; every other or unknown block → one neutral non-focusable placeholder (type label from `ru`); nothing crashes on any block shape.
- Ids: `post/<postId>/author`, `post/<postId>/block/<blockKey>` (`<type>:<id>`, else `<type>@<index>`), `state/post/action`, sidebar `post/nav/<section>`. Russian a11y labels from `ru`.
- Back from Post: pop; the origin restores focus on the same card by id with the fallback chain (Автор already does; Главная must restore through `useFocusRestoration.restore()` with card-only memory — deferred-work item from Story 3.1).
- OK on a feed card and on an Author card opens Post. OK on the author row opens Автор; if the route below is Автор for the same `blogUrl`, pop to it instead of pushing.

**Never:** No comments, like/react action, «Смотреть», QR, image loading, audio, polls. No changes to `sessionManager.ts`. No new endpoints.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Text post | E8 200, text blocks | left header; right paragraphs | — |
| Mixed blocks | video, image, file, audio, poll, unknown | one placeholder each, in order; text between them | — |
| Inline link | text, link «здесь», text, BLOCK_END | one paragraph «… здесь …», no placeholder | — |
| Malformed block | block without `type` / bad `content` | placeholder or plain text, no crash | — |
| No title | empty title | first text, else «Без названия» (as PostCard) | — |
| Likes | `count.likes` 5 / missing | «5 лайков» / no like line | — |
| Locked | `hasAccess=false`, empty data | header + teaser placeholder; focus on author | — |
| Not found | E8 404 `not_found` | «Пост недоступен» + «Назад» | Back/«Назад» pop |
| Error | Network/Server/Parse | StateView «Повторить» | retry E8 |
| Back | from Post | origin, focus on the same card | fallback chain |

</frozen-after-approval>

## Code Map

- `src/app/routes.ts`, `src/app/App.tsx` -- add `Post: { blogUrl; postId; section }` and `PostRoute` mirroring `AuthorRoute` (shared `Sidebar` with `idPrefix 'post/'`, `pendingShellSection` handshake, Back handler, `focusRestoration.forget(route.key)` on unmount). `section` = the origin Shell section for the sidebar's current item.
- `src/app/Shell.tsx`, `src/features/home/HomeScreen.tsx`, `src/shared/ui/PostGrid.tsx` -- `onCardPress` → `onOpenPost(post)`; Главная's return refocus: register a section restore with the Shell like Подписки's `setReturnFocus` (`src/features/subscriptions/SubscriptionsScreen.tsx`), card-only memory (`deferred-work.md` Story 3.1 item, `FocusZone.tsx:91-99`).
- `src/features/author/AuthorScreen.tsx` -- `onCardPress` today latches «moved» only; also call `onOpenPost`. Return restore already exists (`useFocusEffect` → `restoreOrFirst`).
- `src/shared/entities/post/*` -- `PostRepository.post(http, blogUrl, postId)` (E8 path, 404 → `{kind:'unavailable'}` like `AuthorRepository.blog`), `likeCount` in `types.ts`/`mapPost.ts`, paragraph grouping helper (text until `paragraphEnd`). DTO: `src/shared/api/dto/post.ts` (`count` lenient).
- `src/shared/api/queryKeys.ts` -- `post(blogUrl, postId)`.
- `src/features/post/` (new) -- `PostScreen`, `usePost`, left column, block list, placeholder; reuse `AuthorAvatar`, `formatCardDate`, `tp` plurals, `StateView`, `FocusableSurface`, `useZoneItem`.
- `src/shared/i18n/ru.ts` -- `post.*` (unavailable, error, likes plural, placeholder labels per type, a11y).
- `src/app/dev/demo.ts` -- answer E8 for demo posts (text, mixed blocks, one 404).
- Fixtures: `e8-post-accessible.json`, `e8-post-locked.json`, `e8-missing-post.json`.
- Tests: `__tests__/postFlow.test.tsx` (harness `src/test/flow.tsx`), mapper/repository unit tests; update `homeFeedFlow`/`authorFlow` «OK does nothing» tests.
- Docs: `docs/focus-map.md` §4 F notes, `docs/api-contract.md` §1 (E8 profile already LIVE), `docs/testing.md` Story 3.4, ADR 0012 (Post reuses it).

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/entities/post/*`, `dto/post.ts`, `queryKeys.ts` (+ unit tests) -- E8 repository, like count, paragraph grouping.
- [x] `src/features/post/*` -- screen, hook, columns, blocks, states, focus.
- [x] `src/app/*`, `src/features/home/*`, `src/features/author/*`, `src/shared/ui/PostGrid.tsx` -- route, OK on cards, author → Автор, Главная return refocus.
- [x] `src/app/dev/demo.ts`, `ru.ts` -- demo, copy.
- [x] Tests -- every matrix row; focus: initial focus (first paragraph; author when locked or no text), ↓ through paragraphs, ← / →, Back to the same card from Главная and Автор (gone → neighbor), author → Автор (push / pop), sidebar OK and Back.
- [x] Docs -- focus-map §4 F, testing.md, ADR 0012 note.
- [x] Device (release-like, owner's session) -- open a post from Главная and from Автор, read, Back → same card; author → Автор.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new/changed flow tests 30/30; lint, typecheck, check:fixtures clean.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | A paragraph (or a merged list) taller than the right column is one focus stop: Android scrolls to its top, the rest is unreachable and ↓ jumps past it (edge, blind) | high | patch: one stop per list item; a paragraph over a length budget is split into consecutive stops at sentence/line boundaries (serves the owner's decision A «↓ scrolls the right column») |
| 2 | OK on an Автор card as a «move» lost its only pinning test (verification-gap) | medium | patch: test with the head reply held through OK → Пост → Back |
| 3 | No E8 tests for 401/expiry and 403 (CLAUDE.md: never treat every 403 as expiry) (blind) | medium | patch: tests |
| 4 | `usePost.isPending` unused (blind) | low | patch: remove |
| 5 | HomeScreen/Подписки clear the Shell's shared `sectionReturn` unconditionally on unmount (blind) | low | patch: clear only their own registration |
| 6 | ParagraphStop has no accessibility role (blind) | low | patch: role text + label |
| 7 | testing.md row still describes «Ссылка» placeholders; Post not refreshed on resume undocumented (blind, verification-gap) | low | patch: docs |
| 8 | feature-parity.md not updated (blind) | medium | defer: no Epic 3 story updated it (3.1–3.4); one pass for the epic |
| 9 | Demo E8 for Автор posts untested; demo regex/decode fragile (verification-gap, blind) | low | defer (dev-only) |
| 10 | Account switch with Пост open untested (blind) | low | rejected: the cache reset is generic (AccountScope), tested in 2.8/3.3 |
| 11 | Locked post with a text teaser: focus rules untested (blind) | low | rejected: initial focus is the author by rule; → reaches the teaser paragraph like any paragraph |
| 12 | Like plural boundaries untested (blind) | false | `src/shared/i18n/__tests__/plural.test.ts` covers 11, 21, 111 |
| 13 | Back during the skeleton untested (blind) | low | rejected: the Back handler is route-level, independent of the phase |
| 14 | `MAX_LIST_DEPTH` drops deep levels silently (blind) | low | rejected: 8 levels; no real post seen deeper |
| 15 | `e8Path` test helper unused (blind) | low | rejected: cosmetic |
| 16 | Hundreds of blocks in a plain ScrollView (edge) | maybe-false | rejected for now: not measured; Story 9.3 measures performance |
| 17 | Post DTO now drops feed/author posts with an unsafe `blogUrl` (edge) | low | rejected: such a post cannot be routed safely; same rule as E2 |
| 18 | E8 body id ≠ requested id (edge) | low | rejected: no evidence the API does this |
| 19 | Spec/sprint statuses; Code Map names PostGrid (blind, edge) | false | statuses move at completion; Code Map wording is the spec's |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; new flow tests 30×.
