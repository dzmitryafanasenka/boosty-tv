---
title: 'Story 11.2: The «Комментарии» block on Пост'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3e8b3fdc03db8083d42b2b643529c6fc15632bd4'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The comment entity exists (Story 11.1, E19 LIVE), but nothing on the TV shows comments. The owner wants to read a post's discussion with the remote, as in BoostBuddy (FR-58, COMM-01).

**Approach:** Show the comment count in the Пост header. Add a read-only «Комментарии» block after the post's blocks. It holds focusable comment rows, newest first, with «Показать ещё» (older comments), replies under each comment with «Ещё ответы», and in-block states.

## Boundaries & Constraints

**Always:**
- **Owner decisions 2026-11-02:**
  - Read-only. No posting, replying, liking, reporting or deleting.
  - The block sits at the bottom of Пост, after the blocks, and only when the post is accessible.
  - The header reads «date · N лайков · M комментариев». The count is not focusable, and it is left out when `count.comments` is missing. Cards show no count.
  - Comment events in События stay hidden.
  - **Order:** newest first. «Показать ещё» at the end of the list loads older comments below. Replies under a comment run oldest to newest, like a conversation.
- **Comment row:**
  - It is one focus stop with the id `post/<postId>/comment/<commentId>`.
  - It shows the avatar (or the placeholder), the name, «ответ <name>» for a reply, the content, and the date (`formatCardDate`).
  - The content is non-focusable: text with emoji and images through the shared pieces (`EmojiParagraph`, `TeaserImage`, from `postBodyItems(blocks, { images: true })` without `qr`). Links show as plain text.
  - Replies are indented one level (a token), each one its own stop.
- **Deleted or blocked comment** (`isDeleted` / `isBlocked` true; read both flags as optional): the row shows «Комментарий удалён» / «Комментарий скрыт» instead of the content. It keeps its author and date.
- **«Ещё ответы»** appears when `hasMoreReplies`. OK fetches the replies via `CommentRepository.replies` and replaces the inline replies with the merged list (deduped by id, oldest first). It stays while the server has more. Focus moves to the first reply that was not shown before.
- **«Показать ещё»** appears while `nextCursor` exists. OK appends the next older page. Focus moves to the first new comment. While loading, the row shows the spinner and keeps focus.
- **The first page** is fetched once the post is shown and accessible. A post with `isCommentsDenied: true` sends no request and shows «Автор отключил комментарии».
- **States inside the block only:**
  - loading (a spinner row);
  - empty («Комментариев пока нет»);
  - error («Не удалось загрузить комментарии» + «Повторить»);
  - `denied` («Комментарии недоступны»);
  - `notFound` (block hidden).

  A failed «Показать ещё» or «Ещё ответы» keeps the loaded list and turns its row into «Повторить».
- **Focus:**
  - Focus returns to the same comment id after the player; the fallback is the block's first row.
  - The vanished-focus fallback covers comment ids.
  - Back pops Пост as today.
  - The focus-map «F Пост» is updated.
- **Owner decision 2026-11-02 (after the device check), our improvement beyond parity: a full-screen image viewer, in this story.**
  - OK on a post image stop (`post/<postId>/block/image:<id>`, which today does nothing) opens the viewer on that image. Arrows ←/→ step through the post's images in post order.
  - OK on a comment row that has images opens the viewer on the comment's first image, and ←/→ step through that comment's images. A comment without images keeps OK as a no-op.
  - The viewer:
    - is a full-screen modal over Пост on a dark backdrop;
    - fits the image to the screen with its aspect kept (no zoom or pan);
    - shows «N / M» when there is more than one image, a spinner while loading, and «Изображение недоступно» on a failure.
  - ← on the first image and → on the last stay put. Back closes the viewer and returns focus to the stop that opened it.
  - The viewer uses plain `{uri}` with no auth headers, as inline images do, is read-only and adds no other controls.
  - A locked post's teaser images stay non-focusable and do not open.
- **Data hygiene:** `useInfiniteQuery` on `queryKeys.comments`; the account reset clears it. Nothing is logged or persisted. All comment requests go through `entities/comment`.
- **Lists grow only by the user's «Показать ещё»,** 20 at a time, inside Пост's ScrollView (which is not virtualized). A flow test renders 300 comments and focus stays stable.

**Never:**
- Comment-writing controls, comment counts on cards, Автор or Поиск, or comment events.
- Focusable link chips or QR inside comments.
- An auto-load of older pages without the user's OK press.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Header | `count.comments` 29 / missing | «… · 29 комментариев» (Russian plural) / no comment part | N/A |
| First page | ok, 20 comments, cursor | 20 rows newest first, then «Показать ещё» | N/A |
| Show more | OK on «Показать ещё» | 20 older rows appended below; focus on the first new | Failure: the row becomes «Повторить», the list is kept |
| Last page | `nextCursor` null | No «Показать ещё» | N/A |
| Replies | A comment with 2 inline of 5, OK on «Ещё ответы» | 5 replies oldest first, no duplicates; focus on the first new | Failure: «Повторить» in place |
| Empty | ok, 0 comments | «Комментариев пока нет» | N/A |
| Denied | `denied` | «Комментарии недоступны» | No retry |
| Author off | `isCommentsDenied: true` | «Автор отключил комментарии»; no request | N/A |
| Error | `error` | «Не удалось загрузить комментарии» + «Повторить» | «Повторить» refetches page 1 |
| Deleted | `isDeleted: true` | «Комментарий удалён», author and date kept | N/A |
| Locked post | `hasAccess: false` | No block, no request | N/A |
| Player return | The player was opened from Пост; focus was on a comment | Back from the player: focus on that comment | Gone: the first row of the block |
| Image viewer, post | OK on the 2nd of 3 post images | Viewer on image 2, «2 / 3»; ← to 1, → to 3; Back: focus on the 2nd image stop | Load failure: «Изображение недоступно», arrows still work |
| Image viewer, comment | OK on a comment with 2 images | Viewer on its first image, «1 / 2»; Back: focus on that comment row | A comment without images: OK does nothing |

</frozen-after-approval>

## Code Map

- `src/features/post/PostScreen.tsx`:
  - `:54-67`: the id helpers; add `postCommentPrefix`.
  - `:390-403`: `useColumnStop` / `onStopView` / `onStopFocus`. Every comment row and action row uses it.
  - `:565-597`: the vanished-focus fallback; add the comment prefix with `focusLaidOut(gone, candidates)` (`:536`).
  - `:732-746`: the order; add `<PostComments/>` after `<PostBody/>` when `post.hasAccess`.
  - `:684,692`: the column guide and the ScrollView.
- `src/features/post/PostHeader.tsx:31-34,88`: `postMetaLine`; add the comment part (`post.comments` plural) and fix the doc comment.
- `src/shared/api/dto/post.ts:18-24,50-53`: add `count.comments` (nonnegative int, nullish, caught). Read `isCommentsDenied` (boolean, optional).
- `src/shared/entities/post/types.ts:127-128` and `mapPost.ts:366`: add `commentCount: number | null` and `commentsDenied: boolean`. The guards `mapPost.test.ts:39` and `postRepository.test.ts:438` check for the substring `comments` in the domain JSON, so name the fields `commentCount` and `commentsDenied` and keep those guards green. Keep the card guards `PostCard.test.tsx:106` and `AuthorCard.test.tsx:94`.
- `src/shared/api/dto/comments.ts`, `entities/comment/{types,mapComments}.ts`: add optional `isDeleted` / `isBlocked` to the DTO and `hidden: 'deleted' | 'blocked' | null` to the domain.
- `src/shared/entities/comment`: `CommentRepository.page(http, blogUrl, postId, cursor)` and `.replies(http, blogUrl, postId, parentIntId, cursor)` return results and never reject. `mergeCommentPages(pagesInLoadOrder)` gives oldest first, so newest first is its reverse. Add a `useComments(http, blogUrl, postId, enabled)` hook (`useInfiniteQuery`, `retry: false`, `getNextPageParam` = `nextCursor`, the results turned into states) next to the entity, modelled on `entities/post/usePagedPosts.ts:81` and `useHeldError`. Replies use local state per comment (no persistence).
- `src/features/post/body/TextBlocks.tsx:77` `EmojiParagraph` (non-focusable), `ImageBlocks.tsx:32` `TeaserImage` (`maxHeight`, `columnWidth`), and `src/shared/entities/post/postBody.ts:536` `postBodyItems(blocks, { images: true })`.
- `src/shared/ui/AuthorCard.tsx:87` `AuthorAvatar`, `tokens.ts:364` `avatar.post`, `src/shared/i18n/format.ts:40` `formatCardDate`, plus `Spinner` and `FocusableSurface`. Add `comment-row` tokens (indent, gap, avatar size) to `tokens.ts` and the DESIGN.md frontmatter; the 9.4 guards check both.
- `src/features/polls/PollParts.tsx:75` `PollError` and `src/features/player/AudioBlock.tsx:72,454` model the in-block busy and error rows.
- `src/shared/i18n/ru.ts:350-428` (`post`): the block title, states, «Показать ещё», «Ещё ответы», «ответ {name}», the deleted and hidden notes, and the comments plural.
- `src/app/dev/demo.ts:588`: set the demo E8 `count.comments` from `demoCommentCount(n)` (`:663`). The E19 handler is at `:842`.
- `docs/focus-map.md:309-388` «F Пост»: rewrite `:386` and replace `:388`.
- Tests:
  - `__tests__/postFlow.test.tsx`: meta at `:266-330`, focus at `:859`, Back at `:1084`;
  - `__tests__/playerFlow.test.tsx:1127`: return to Пост;
  - `__tests__/demoFlow.test.tsx`;
  - the read-only guard `__tests__/commentsReadOnly.test.js` stays green.

## Tasks & Acceptance

**Execution:**
- [x] DTO, domain and mapper: `commentCount`, `commentsDenied`, the comment `hidden` flag; tests.
- [x] `PostHeader.tsx` + `ru.ts`: the meta line with the plural; tests.
- [x] `useComments` hook and the replies loader; tests for page, merge order (newest first), more, error and denied.
- [x] `src/features/post/comments/{PostComments,CommentRow,CommentActionRow}.tsx`: the block, rows, states and focus; tokens.
- [x] `PostScreen.tsx`: mount the block, the id prefix and the vanished-focus fallback.
- [x] `demo.ts`: the comment count in E8.
- [x] Flow tests: every matrix row, 300 comments, the player return, Back; a guard that no comment-writing text or control exists.
- [x] Docs: `focus-map.md` «F Пост», `feature-parity.md` COMM-01 / POST-10 status, `testing.md` «Story 11.2», `EXPERIENCE.md` (as built), `CHANGELOG*` [Unreleased]. Close the three Story 11.1 entries in `deferred-work.md`.
- [x] Image viewer: `src/features/post/ImageViewer.tsx` (modal through the app's modal or route pattern), opened from the post image stops and comment rows with images; tests for both matrix rows, Back and focus return; `feature-parity.md` POST-03 (our improvement), `focus-map.md`.
- [x] Device: owner-signed release build, installed with `adb install -r`. The agent may open one post with comments and dump focus ids only (no player visit). The owner reads a thread, presses «Показать ещё» and «Ещё ответы» with the remote, and reports.

**Acceptance Criteria:**
- Given the release build on the pinned TV, when the owner reads comments with the remote, then the rows, «Показать ещё» and «Ещё ответы» work with the D-pad only, and the result is labelled as the owner's.
- Given every other screen, when compared with 1.1.0, then no comment count or comment UI appears outside Пост.

## Implementation Notes

## Spec Change Log

- 2026-11-02, after the owner's device check («всё окей», but images in comments cannot be opened to enlarge): the owner chose to add a full-screen image viewer for post and comment images to this story (it did not exist anywhere; POST-03 had «OK does nothing»). The frozen intent was amended by the owner's decision; the matrix gained two viewer rows. KEEP: the whole comments block as built and checked on the device (rows, order, «Показать ещё», «Ещё ответы», states, focus); only add the viewer.

## Review Triage Log

Iteration 0 (blind-hunter BH, edge-case-hunter EC, verification-gap VG):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| EC1 / EC12 | A vanished «Показать ещё» / «Повторить» / «Ещё ответы» row has no focus fallback | medium | The prefix `post/<id>/comment/` does not match the action-row ids | patch |
| EC2–EC4 | The pending «focus the first new» survives a press that started no load, or a state change | medium | `pendingMore` / `pending` are set before `loadMore` decides to run, and are never cleared | patch |
| EC5 / BH7 | Replies `denied` / `notFound` become a «Повторить» that always fails | low | `useCommentReplies` maps every non-ok outcome to `failed` | patch |
| EC6 | An older page answering 403/404 leaves a «Повторить» that never succeeds | low | `moreFailed` covers `CommentsUnavailable` too | patch |
| EC8 | The header shows «N комментариев» next to «Автор отключил комментарии» | low | `postMetaLine` ignores `commentsDenied` | patch |
| EC9 | The row's spoken label can hold empty parts | low | Emoji-only items map to '' | patch |
| BH3 | Comment images are sized to the column, not the row's content area | medium | `textWidth = columnWidth - ROW.indent` leaves out the surface padding; `TeaserImage` caps at 600 | patch |
| VG1 | The viewer's native SeekKeys path has no test | medium | Pre-verified: no viewer test installs SeekKeys | patch (test) |
| VG2 | «A return to Пост keeps the pages» has no test | medium | Pre-verified: no reopen test counts E19 calls | patch (test) |
| BH1 / BH2 | `feature-parity.md` still says «device pending»; the CommentRow docs say «no OK action» | low | The owner passed both checks; rows with images open the viewer | patch (docs) |
| BH6 | Replies past one page may merge with a gap | maybe-false | Only a one-page thread was seen live | patch (doc: unverified in api-contract) |
| BH12 | `queryKeys.commentReplies` is documented but unused | low | Replies live in component state, cleared on unmount | patch (doc note) |
| EC7 | A stalled image keeps the spinner | low | Needs a timer; the RN image fires onError on network failure | reject (low) |
| EC10 | A failed image stop still opens the viewer | low | The viewer shows «Изображение недоступно» and the arrows still work | reject (low) |
| EC11 | Refetch while the viewer is open keeps the old URLs | low | Plain public image URLs; a modal over Пост | reject (low) |
| BH4 | The vanished-comment fallback is the block's first row, not the nearest | low | The frozen spec defines that fallback | reject (spec) |
| BH5 | No virtualization and no ADR | low | Recorded in the frozen spec: growth only by «Показать ещё», 300-row test | reject (spec) |
| BH8 | `memo(ImageStop)` is defeated by new callbacks | low | No measured cost; posts hold few images | reject (low) |
| BH9 | The viewer's failure is sticky and there is no prefetch | low | Cosmetic | reject (low) |
| BH10 | No unit test for `ModalHost` `fill` | low | The flow tests cover the viewer through the host; VG1 adds keys | reject (low) |
| BH11 | The read-only guard's import stripping is broad | low | A backstop; behavioural GET tests exist | reject (low) |
| BH13 | Spec and sprint statuses differ | false | The sprint stays in-progress until the story closes; the spec is in review | reject |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures`: all green.
- `(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a)`: the owner-signed device build.
