# Sprint Change Proposal: read-only comments (2026-11-02)

Status: approved by the owner 2026-11-02 (batch mode). Author: correct-course run, owner Dzmitry.

## 1. Issue Summary

**Trigger.** A new requirement from the stakeholder, not a defect. After Epics 1–10 and the 1.1.0 release, the owner reversed the project's comments exclusion (2026-11-02). Until now, comments were excluded everywhere (CLAUDE.md, PRD §6, feature-parity COMM-01 «X»).

**Owner decisions (2026-11-02):**
1. Comments are no longer excluded.
2. Scope is the reference's scope, which is read-only:
   - a post's comment list with «show more» paging;
   - replies under each comment with «show more replies».

   There is no posting, no likes and no deletion.
3. Placement: a «Комментарии» block at the bottom of the Пост screen, after the text, media and polls.
4. Comment count: shown in the Пост header next to the likes, read-only and not focusable. Cards show no count.
5. The comment event types in События stay hidden.

**Evidence: the reference is read-only.** BoostBuddy `develop` at `87c0852`, 2026-04-09:
- `CommentsRepository.getComments(url, postId, offsetId, parentCommentId)` is its only method.
- `PostComponent` offers `onMoreCommentsClicked` and `onMoreRepliesClicked`.
- `Comment` has `{id, intId, author{name, avatarUrl}, content: List<Content>, replies{comments, hasMore}, replyCount, replyToUser, createdAt}`.
- `PostScreen` renders the avatar, name, content blocks and date, then the replies indented, with «ещё ответы» when `replies.hasMore`. An empty list shows a placeholder.

**Unknowns.**
- The comments endpoint is recorded only as a path and parameter names taken from the reference code (`api-contract.md` «never call» table): `GET /v1/blog/{blogUrl}/post/{postId}/comment/`, with `limit`, `reply_limit`, `order=top`, `offset` and `parent_id`.
- Its response shape, paging, errors and entitlement behaviour are not verified.
- The fixtures show only E8's empty `comments: {data: [], extra: {isFirst, isLast}}`, plus `count.comments`, `isCommentsDenied` and the blog's `canCreateComments`.

## 2. Impact Analysis

**Epics.**
- Epics 1–10 are done and none is invalidated.
- Epic 3 (FR14, the cards) keeps «no comment counts on cards».
- Epic 6 «The complete post» is the closest theme, but it is closed. A new epic is cleaner.
- Epic 7 Story 7.5: the decision that comment events stay hidden is unchanged and re-affirmed.

**Stories.** New Epic 11 with two stories (§4.1). No completed story is rolled back.

**Artifacts to change.**

| Artifact | Places |
|---|---|
| `CLAUDE.md` | lines 9, 29, 114, 127, 148 |
| PRD `prd.md` | §1 (l.33), FR-14 (l.171), FR-32 (l.254), new FR-58 in §4.7, §6 (l.418, l.431), §7, §10 (new question) |
| `epics.md` | FR inventory (FR14, FR32, new FR58), FR coverage map, Epic List, new Epic 11 |
| `ARCHITECTURE-SPINE.md` | FR→module mapping (l.455): `entities/comment` + query key; a short AD for comment paging |
| UX `EXPERIENCE.md` | Пост inventory (l.40) and states (l.126), anti-pattern (l.257) |
| UX `DESIGN.md` | LikeCount (l.253), «Don't» (l.277), new CommentRow / CommentReplies / ShowMore components |
| `docs/feature-parity.md` | COMM-01 (l.171) X→P (read-only), POST-10 (l.89), POST-11 (l.90) |
| `docs/api-contract.md` | move `…/comment/` from «never call» (l.289) to a new E19 section (LIVE after Story 11.1); E8 `comments` field note (l.282) |
| `docs/focus-map.md` | F Пост (l.309): comment rows and «show more» stops |
| Wiki | decision «Комментарии исключены» → superseded; new decision after Epic 11 |

**Code and tests that enforce the exclusion.** These change only in the stories, not in this proposal:
- `src/shared/api/dto/post.ts:23-24`: `count.comments` is dropped. Story 11.2 reads it for the header.
- `src/shared/entities/post/types.ts:8` and the domain comment.
- `src/shared/ui/PostCard.tsx:25`, `src/features/post/PostHeader.tsx:92`, `src/shared/i18n/ru.ts:305`: the rule is stated only in comments.
- These tests assert the exclusion, so their «no request path contains `comment`» guards narrow to «no comment request outside `entities/comment`, and no comment UI outside Пост»:
  - `postRepository.test.ts:150,516,438`;
  - `mapPost.test.ts:39,350`;
  - `PostCard.test.tsx:106`;
  - `AuthorCard.test.tsx:94`.
- These stay as they are:
  - E8, E4–E7 keep `comments_limit=0`: comments come from their own endpoint, so post requests stay small;
  - `mapEvents.ts` keeps hiding comment events;
  - `eventRepository.test.ts` keeps asserting it.
- Demo mode (`src/app/dev/demo.ts`) needs synthetic comments.

**Technical risk.**
- **The unverified endpoint is the main risk.** Story 11.1 goes first and blocks 11.2. If the endpoint needs auth semantics we cannot meet, or denies access for locked posts in an unexpected way, Story 11.2 is re-planned with the owner.
- Comment text, names and avatars are personal data. They are never logged, never put in fixtures unsanitized, and cleared on logout. They are account-scoped, like other server state.
- Long threads need a virtualized list inside the Пост scroll, and focus has to stay stable through paging.

## 3. Recommended Approach

**Option 1, Direct Adjustment: add Epic 11 within the existing plan. Recommended.**
- Effort: Medium.
- Risk: Medium, all of it in the unverified endpoint.

**Option 2, Rollback: not viable.** Nothing done needs reverting.

**Option 3, MVP review: not needed.** P1–P3 are released and accepted. Comments are a post-1.0 parity addition.

Rationale:
- The change is additive and isolated to Пост plus a new entity.
- The existing post-body renderer (text, emoji, images) can render comment content.
- The poll and paging patterns give the shape for loading, error and «show more».
- The probe-first order follows CLAUDE.md: never invent endpoints.

## 4. Detailed Change Proposals

### 4.1 Epics (`epics.md`)

**Add to the Epic List** after Epic 10:

```
NEW:
### Epic 11: Comments (read-only) (P2, parity COMM-01)
A post's comments as in the reference: the list, «show more», replies with «show more replies», at the bottom of Пост, plus the comment count in the Пост header. No posting, likes or deletion (owner decision 2026-11-02, reversing the former exclusion).
**FRs covered:** FR58; FR14 and FR32 amended
```

**New Story 11.1: Comments endpoint probe and the comment entity**

As the developer, I want the comments endpoint verified on the live account and a tested comment entity, so that the comments UI is built on evidence and not on guesses.

Acceptance Criteria:
- **Given** the owner's session on the pinned device or the emulator, **When** a temporary `__DEV__` probe sends `GET /v1/blog/{blogUrl}/post/{postId}/comment/` for accessible posts with and without comments, a reply thread (`parent_id`), a second page (`offset`), and a locked post, **Then** `docs/api-contract.md` gets a new E19 section with the status codes, the response shape, the paging cursor and «has more» rule, the replies shape and the locked-post behaviour. The probe logs shapes and counts only, never text, names, ids or URLs, and is removed before the commit (the Story 6.3 method).
- **Given** E19, **When** `entities/comment` maps a page, **Then** each comment becomes `{id, author{name, avatarUrl?}, replyTo?, blocks, createdAt, replyCount, replies, hasMoreReplies}`.
  - `blocks` go through the shared post-block mapper. Unknown blocks are skipped and never crash.
  - A malformed comment is dropped, never the page.
- **Given** the repository, **When** pages are fetched, **Then**:
  - the query key is account-scoped `['comments', blogUrl, postId]`;
  - paging merges by comment id;
  - retries are bounded and the call is a GET only;
  - 401 goes to the refresh coordinator, and 403/404 are modelled distinctly.
- **Given** the tests, **Then** sanitized synthetic fixtures cover every mapper and paging row, and the narrowed exclusion guards pass.
- If the endpoint is not usable (e.g. it needs a web-only auth), the story ends with the finding, and Story 11.2 is re-planned with the owner.

**New Story 11.2: The «Комментарии» block on Пост**

As a family member, I want to read a post's comments with the remote, so that I see the discussion as on the website.

Acceptance Criteria:
- **Given** a post with comments, **When** Пост is shown, **Then** the header reads «date · N лайков · M комментариев» (the counter is read-only, not focusable, and left out when `count.comments` is missing). The blocks are followed by a «Комментарии» block, and its first page is fetched when the block nears the viewport.
- **Given** a comment row, **Then**:
  - it shows the avatar (or a placeholder), the name, «ответ <name>» when it is a reply to someone, the content (text, emoji, images; links as the existing chips), and the date;
  - it is one focus stop;
  - its replies follow it indented, with «Ещё ответы» when there are more.
- **Given** «Показать ещё» at the end of the list, **When** OK is pressed, **Then** the next page is appended and focus stays on the first new comment. While loading, the row shows a spinner and keeps focus.
- **Given** loading, empty («Комментариев пока нет»), error («Не удалось загрузить комментарии» + «Повторить») or comments denied by the author, **Then** each state is shown inside the block only. The rest of Пост keeps working.
- **Given** hundreds of comments, **Then**:
  - the list is virtualized with stable keys (comment id);
  - Back from anywhere in the block returns to the origin card, as today;
  - after leaving to the player and coming back, focus returns to the same comment id (fallback: the block's first row).
- **Given** logout or an account switch, **Then** cached comments are cleared, like other account-scoped server state.
- **Given** the release build on the pinned TV, **Then** the owner reads a thread and pages with the remote. The device check is labelled as the owner's.

### 4.2 PRD (`prd.md`)

```
§1 l.33 OLD: It does everything the only existing TV client (BoostBuddy) does, except comments, and adds…
§1 l.33 NEW: It does everything the only existing TV client (BoostBuddy) does (comments are read-only, as in the reference), and adds…

FR-14 l.171 OLD: - No comment count appears anywhere (POST-10 exclusion).
FR-14 l.171 NEW: - Cards show no comment count (the count appears only in the Пост header, FR-58).

FR-32 l.254 OLD: - The post is fetched fresh with `comments_limit=0` (E8).
FR-32 l.254 NEW: - The post is fetched fresh with `comments_limit=0` (E8); its comments come from E19 (FR-58).

§4.7 ADD after FR-39:
#### FR-58: Read-only comments [P2]
- The Пост header shows the comment count next to the likes (read-only, not focusable).
- A «Комментарии» block after the post's blocks lists the comments with «Показать ещё»; each comment's replies follow it with «Ещё ответы».
- No posting, liking or deleting comments. Loading, empty, error and denied states stay inside the block.
- Comment data is account-scoped and never logged.
- Parity: COMM-01 (reference: read-only list, show more, replies).

§6 l.418 OLD: - No comments anywhere: no screens, counters, actions or requests.
§6 l.418 NEW: - No comment writing: no posting, replying, liking, reporting or deleting comments (owner decision 2026-11-02; reading is FR-58).

§6 l.431 OLD: - comments (COMM-01);
§6 l.431 NEW: (removed)

§7 ADD: «Post-release (P2+): read-only comments, FR-58 (Epic 11).»

§10 ADD: N. What do E19's response, paging and locked-post behaviour look like? → Story 11.1 probe.
```

### 4.3 CLAUDE.md

```
l.9   OLD: - Product scope: feature parity with BoostBuddy, EXCEPT comments. No comment screens, comment actions, or comment API requests. Do not silently reduce parity to a video-only MVP.
l.9   NEW: - Product scope: feature parity with BoostBuddy, including read-only comments (owner decision 2026-11-02). No comment writing: no posting, replying, liking or deleting comments. Do not silently reduce parity to a video-only MVP.

l.29  OLD: 6. Mark comments as intentionally excluded. Do not omit other confirmed features…
l.29  NEW: 6. Comment writing is intentionally excluded; reading comments is parity (owner decision 2026-11-02). Do not omit other confirmed features…

l.114 OLD: - Comments are excluded everywhere. Do not add comment counters as dead-end navigation.
l.114 NEW: - Comments are read-only, in a «Комментарии» block at the bottom of Пост; the count appears only in the Пост header. No comment writing; no comment counters as dead-end navigation.

l.127 OLD: 2. Complete Android parity except comments: implement all confirmed remaining capabilities…
l.127 NEW: 2. Complete Android parity: implement all confirmed remaining capabilities…

l.148 OLD: - Do not add comments functionality, billing, donations, …
l.148 NEW: - Do not add comment writing (posting, replies, likes, deletion), billing, donations, …
```

### 4.4 Architecture (`ARCHITECTURE-SPINE.md`)

- FR→module table (l.455): add the row `FR-58 → entities/comment (E19 repository, mapper), features/post (CommentsBlock)`.
- Add **AD-21 Comments** (AD-20 is taken by «Phase gating»):
  - one GET-only repository behind `entities/comment`;
  - the account-scoped key `['comments', blogUrl, postId]` (replies `['commentReplies', blogUrl, postId, commentId]`);
  - id-merged paging, no persistence, cleared on logout;
  - comment blocks go through the shared block mapper;
  - no comment request outside `entities/comment`.

### 4.5 UX

- `EXPERIENCE.md`:
  - Пост inventory (l.40): add the «Комментарии» block after the blocks.
  - States table (l.126): add the comments loading, empty, error, denied and «Показать ещё» loading states.
  - Anti-pattern (l.257) becomes: «a comment count that is focusable or leads nowhere; any comment-writing control».
- `DESIGN.md`:
  - LikeCount (l.253): «…the comment count follows the likes in the Пост header only».
  - «Don't» (l.277): drop comment counts, keep «no counts on cards».
  - Add components: CommentRow (avatar, name, reply-to, content, date; focus surface), the reply indent, ShowMoreRow. Tokens only.

### 4.6 docs/

- **`feature-parity.md`:**
  - COMM-01 «X (excluded by CLAUDE.md)» becomes «P (Epic 11, read-only, owner decision 2026-11-02)», with the reference evidence above.
  - POST-10: the comment counter becomes P in the Пост header only.
  - POST-11: note E19.
- **`api-contract.md`:**
  - Remove `…/comment/` from the «never call» table.
  - Add an E19 stub marked UNVERIFIED (path and params from the reference) until Story 11.1 records it LIVE.
  - l.282: the post `comments` field is still ignored, because comments come from E19.
- **`focus-map.md` F Пост:** the comment rows, «Ещё ответы» and «Показать ещё» as stops after the last block. These are written in Story 11.2.

### 4.7 Sprint status and wiki

- `sprint-status.yaml` gets `epic-11: backlog`, `11-1-comments-endpoint-probe-and-entity: backlog`, `11-2-comments-block-on-post: backlog` and `epic-11-retrospective: optional`.
- In the wiki, «Комментарии исключены» becomes superseded with a note. This goes through propose → approve after the docs merge.

## 5. Implementation Handoff

**Scope: Moderate.**
- The backlog gains a new epic, and the planning docs and CLAUDE.md are amended.
- There is no fundamental replan.

**Steps:**
1. **Developer, this session:** apply §4.2–§4.6 and §4.7 sprint status as one docs PR after approval. No code changes.
2. **Developer:** Story 11.1 via `bmad-build`. The probe needs the owner's OK to run on the account.
3. **Developer:** Story 11.2 via `bmad-build`. The device check with the remote is the owner's.
4. **Owner:** approves the docs PR and the wiki changeset, and does the device checks.

**Success criteria:**
- The docs no longer contradict read-only comments.
- E19 is recorded LIVE.
- Comments read with D-pad only on the pinned TV.
- No comment-writing surface exists.
- Personal comment data is never logged or persisted.
