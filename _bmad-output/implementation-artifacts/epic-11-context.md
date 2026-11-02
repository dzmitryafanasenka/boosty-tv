# Epic 11 Context: Comments (read-only) (P2, parity COMM-01)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Show a post's comments the way the reference does, read-only. A «Комментарии» block at the bottom of Пост lists the comments with «Показать ещё». Each comment's replies follow it, with «Ещё ответы». The Пост header shows the comment count next to the likes. The owner reversed the former comments exclusion on 2026-11-02, and comments are now a parity obligation. Comment writing stays excluded: no posting, replying, liking, reporting or deleting. The main risk is the comments endpoint. It is known only from the reference code and has never been sent by this project, so Story 11.1 must verify it live before any UI is built.

## Stories

- Story 11.1: Comments endpoint probe and the comment entity
- Story 11.2: The «Комментарии» block on Пост

## Requirements & Constraints

- **Read-only scope**, matching the reference (BoostBuddy `develop` at `87c0852`, `CommentsRepository.getComments` is its only method):
  - the comment list with «show more» paging;
  - replies under a comment with «show more replies»;
  - an empty-list placeholder.

  No writing control of any kind may appear.
- **Comment count:** only in the Пост header, as «date · N лайков · M комментариев». It is read-only and never focusable. Leave it out when `count.comments` is missing. Cards and Автор show no comment count. A count that is focusable or leads nowhere is an anti-pattern.
- **Comment events** in События stay hidden: any event type containing `comment` (re-affirmed 2026-11-02).
- **Block states:** loading (skeleton rows), empty («Комментариев пока нет»), error («Не удалось загрузить комментарии» + «Повторить»), and comments denied by the author (a note). Every state stays inside the block, and the rest of Пост keeps working. While «Показать ещё» or «Ещё ответы» loads, the row shows a spinner and keeps focus.
- **Personal data:** comment text, names and avatars are personal data. Never log them, never persist them, never put them unsanitized in fixtures. They are account-scoped and cleared on logout or account switch.
- **Long threads:** hundreds of comments must stay usable. The list is virtualized with stable keys (comment id), and focus stays stable while paging.
- **Probe method** (Story 6.3 / 7.5): a temporary `__DEV__` probe with a marker (e.g. `TEMPxx`), on the owner's session. Use the pinned device (Chromecast with Google TV 4K) or the emulator, with a debug build and Metro, installed with `adb install -r` so the session is kept.
  - Log only status codes, key sets with value types, counts and booleans. Never log text, names, ids, URLs or tokens.
  - Remove the probe before the commit. Grep the release Hermes bundle for the marker and expect 0.
  - Running the probe on the account needs the owner's OK.
- **What the probe must record**, as a LIVE E19 section in `docs/api-contract.md`:
  - status codes;
  - the response shape;
  - the paging cursor and the «has more» rule;
  - the replies shape (`parent_id`);
  - behaviour on a locked post.

  Probe accessible posts with and without comments, a reply thread, a second page and a locked post. If E19 is unusable (for example, it needs web-only auth), Story 11.1 ends with that finding, and Story 11.2 is re-planned with the owner.
- **Device rules apply** (`docs/testing.md` «Device rules»):
  - check that the app is in the foreground before every key batch;
  - take a screenshot before every OK, and check where focus went after the first key;
  - an agent player visit on the owner's content is one command (OK, a sleep of 5 s or less, Back);
  - outward actions need the owner's approval.

  The final D-pad check on the release build is the owner's, and is labelled as such.

## Technical Decisions

- **Endpoint E19:** `GET /v1/blog/{blogUrl}/post/{postId}/comment/`, content profile. Params come from the reference: `limit`, `reply_limit`, `order=top`, `offset?`, `parent_id?` (replies of one comment). The reference model is `Comment{id, intId, author{name, avatarUrl}, content[], replies{comments, hasMore}, replyCount, replyToUser, createdAt}`. All of it is UNVERIFIED until Story 11.1. Parse defensively.
- **Post requests stay small:** E4–E8 keep `comments_limit=0`. The post DTO's `comments` field stays ignored, because comments come only from E19. Story 11.2 starts reading `count.comments` for the header.
- **One owner** (single-owner rule for comment requests): one GET-only repository behind `shared/entities/comment`, with one Zod schema in `shared/api/dto` and one mapper. No comment request may exist outside this entity.
- **Comment entity shape:** `{id, author{name, avatarUrl?}, replyTo?, blocks, createdAt, replyCount, replies, hasMoreReplies}`. Domain types carry no raw DTO fields.
- **Comment content** goes through the shared post-block mapper:
  - unknown blocks become `Block.Unknown` and are skipped, never a crash;
  - a malformed comment is dropped and logged as a count, never failing the page.
- **Server state** is TanStack Query only, with keys from `shared/api/queryKeys.ts`:
  - comments: `['comments', blogUrl, postId]`;
  - replies: `['commentReplies', blogUrl, postId, commentId]`.

  Both are account-scoped and never persisted. Pages use `useInfiniteQuery` and are merged and deduplicated by comment id. The cursor is opaque and passed back verbatim, as with the other Boosty cursors; confirm the end-of-list rule for E19 in the probe.
- **Errors** are built only in `shared/api` as `AppError.kind`:
  - 401 goes to the refresh coordinator (one refresh, one retry);
  - 403 and 404 are modelled distinctly;
  - a 403 is never treated as an expired session;
  - unobserved 4xx map to `Client` and are not retried.

  Retries are bounded (network errors and 5xx only).
- **Anonymous answers:** a dead token answers content endpoints as anonymous (HTTP 200, not 401). If E19 behaves the same way, it should not be trusted alone. This is an inference from E8; verify it in the probe.
- **Exclusion guards:**
  - The old tests asserting «no request path contains `comment`» become «no comment request outside `entities/comment`, and no comment UI outside Пост». These are `postRepository.test.ts`, `mapPost.test.ts`, `PostCard.test.tsx` and `AuthorCard.test.tsx`.
  - `mapEvents.ts` and `eventRepository.test.ts` keep hiding comment events.
- **Fixtures:** sanitized and synthetic only, covering every mapper and paging row. `npm run check:fixtures` must stay clean.
- **Demo mode** (`src/app/dev/demo.ts`) needs synthetic comments.

## UX & Interaction Patterns

- **Placement:** the «Комментарии» block comes after all post blocks (text, media, polls), inside the single scrolling Пост column. Its first page is fetched when the block nears the viewport.
- **CommentRow** is one focus surface and uses the same focused style as other rows (ring plus row surface). It shows:
  - the round avatar, or a placeholder;
  - the name;
  - «ответ <name>» when it replies to someone;
  - the content: text, emoji and images, with links as the existing LinkChips;
  - the date in `meta` style.

  It has no reply, like or delete controls.
- **Replies** are CommentRows shifted right by one indent step. The indent never reflows the parent row.
- **ShowMoreRow** is a single focus stop: «Показать ещё» at the end of the list, «Ещё ответы» under a thread.
  - OK on «Показать ещё» appends the next page, and focus lands on the first new comment.
- **Tokens only:** no raw size or colour literals outside `src/shared/ui/tokens.ts`. Story 11.2 adds the comment token values.
- **Focus:**
  - Focus ids follow `<screen>/<zone>/<id>`, using the comment id.
  - Back from anywhere in the block returns to the origin card, as today.
  - After the player and back, focus returns to the same comment id. The fallback is the block's first row.
  - Native focus only: no D-pad handlers in the block.
- **Docs:** `docs/focus-map.md` «F Пост» gets the comment rows, «Ещё ответы» and «Показать ещё» as stops after the last block.

## Cross-Story Dependencies

- **11.1 blocks 11.2.** 11.2 builds only on the recorded LIVE E19 and on the comment entity and repository.
- **Reuse:**
  - the shared post-block mapper and renderers (Stories 6.1–6.3: rich text, emoji, images, LinkChips);
  - the Пост screen and header (Story 3.4: LikeCount meta, Back to the origin card);
  - FocusRestoration;
  - the account-scoped cache clearing on logout and account switch (Story 2.8);
  - the paging and «Повторить» patterns from the feed and polls.
- **Docs to update across the epic:**
  - `docs/api-contract.md`: E19 goes from UNVERIFIED to LIVE;
  - `docs/feature-parity.md`: COMM-01 and POST-10 status and evidence;
  - `docs/focus-map.md`;
  - `docs/testing.md`: probe and device sections.
- Update the wiki after each story (propose, then approve). Mark the decision «Комментарии исключены» as superseded.
