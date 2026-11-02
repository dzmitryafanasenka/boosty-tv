---
title: 'Story 11.1: Comments endpoint probe and the comment entity'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '08cc6265ecb9be44ad03f6be5522d274a581f361'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Read-only comments (FR-58, COMM-01, owner decision 2026-11-02) depend on E19, `GET /v1/blog/{blogUrl}/post/{postId}/comment/`. E19 is known only from the reference's code (`limit`, `reply_limit`, `order=top`, `offset`, `parent_id`). Its response shape, paging, replies, errors and locked-post behaviour are unverified, so Story 11.2 cannot be built on evidence.

**Approach:** Run one temporary counts-only probe of E19 on the owner's account. Record E19 as LIVE in `docs/api-contract.md`. Then build a GET-only `shared/entities/comment` entity (schema, mapper, repository, query keys) with sanitized synthetic fixtures and tests. No UI.

## Boundaries & Constraints

**Always:**
- **Read-only.** E19 is sent as GET only. No other comment request exists: no posting, replying, liking or deleting.
- **The probe:**
  - It is temporary and carries a `TEMP111` marker.
  - It logs shapes, key names, types, counts and status codes only. It never logs text, names, ids, URLs, avatars or dates.
  - It runs only after the owner's OK at that moment.
  - It is removed before the commit: a grep of `src` for `TEMP111` finds 0, and so does a grep of the release Hermes bundle.
  - The probe covers:
    - an accessible post with comments (first page);
    - its second page via the `offset` the response gives;
    - one comment's replies via `parent_id`;
    - an accessible post without comments;
    - a locked post.
- **E19 record.** `docs/api-contract.md` E19 becomes LIVE with:
  - the request as sent;
  - the status codes;
  - the response key tree with types;
  - the cursor and the «has more» rule for comments and for replies;
  - how many replies arrive inline under `reply_limit`;
  - the locked-post and no-comments answers.
- **Entity:**
  - Mirror `entities/event` and post paging. The DTO goes in `src/shared/api/dto/comments.ts` as one Zod schema.
  - Comment content goes through the existing post block mapper `mapBlocks`, exported from `entities/post`. There is no second block parser.
  - A malformed comment is dropped and counted, never the page.
- **Repository outcomes** are modelled per page: `ok | denied | notFound | error(AppError)`. HTTP 403 is `denied`, never a session expiry. 401 goes through the existing single-flight refresh.
- **Query keys** `comments` and `commentReplies` in `queryKeys.ts` hold ids only, never a cursor or URL. Paging merges by comment id, keeping the first occurrence. Nothing is persisted. The account reset already clears the cache.
- **Fixtures** are synthetic and pass `npm run check:fixtures`. A demo-mode route answers E19 with synthetic comments.
- **E4–E8** keep `comments_limit=0`.

- **Owner decision 2026-11-02, where the probe runs:** on the pinned TV, in a temporary owner-signed `assembleRelease` armeabi-v7a build with the probe, installed with `adb install -r` with the session kept. The probe runs only on the release build path (it is not gated on `__DEV__`) and writes through the hidden diagnostics capture (Story 8.3). The agent turns capture on, reads the file over adb and turns capture off. Afterwards a clean owner-signed build without the probe is installed over it with `adb install -r`. A debug-key APK is never installed (it would need an uninstall). No second Boosty sign-in.

**Never:**
- Comment UI, the header counter or `focus-map` changes (Story 11.2).
- Logging or committing any real comment data.
- A debug-key build on the family TV. Uninstalling, clearing data or signing out.
- Inventing fields the probe did not see.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| First page | E19 200 with comments and a cursor | `ok`: comments in server order, each `{id, author{name, avatarUrl?}, replyTo?, blocks, createdAt, replyCount, replies, hasMoreReplies}`; `nextCursor` set | N/A |
| Last page | E19 200, the LIVE «last» signal | `nextCursor` null | N/A |
| Replies page | `parent_id` request | Replies mapped the same way; their own cursor | N/A |
| Merge | Page 2 repeats an id from page 1 | Kept once (first occurrence) | N/A |
| Malformed item | One comment missing its id or author | Dropped, counted in the log (count only); the rest kept | Never throws |
| Unknown block | A comment with an unknown block type | `{type:'unknown'}` via `mapBlocks`; comment kept | N/A |
| Denied | E19 403 (or the LIVE locked-post answer) | `denied` | Not retried, no refresh |
| Not found | E19 404 | `notFound` | Not retried |
| Shape change | 200 with a top-level shape the schema rejects | `error(Parse)` | No retry |
| Network | Transport failure | `error(Network)` after the shared GET retries | Bounded |

</frozen-after-approval>

## Code Map

- `src/shared/entities/event/{eventRepository.ts,mapEvents.ts,types.ts,index.ts}`, `src/shared/api/dto/events.ts`: the GET-only entity pattern. The repository takes `http` and a `logger` argument, and `mapEvents.ts:118-124` logs counts only.
- `src/shared/entities/post/postRepository.ts:74,98,169-179`: the cursor (`&offset=` encoded), `mergePosts` by id, `toPage` (`nextCursor` when not `isLast` and `offset` is present), dropped items counted.
- `src/shared/entities/post/mapPost.ts:236` `mapBlocks(raw, depth)`: export it from `entities/post/index.ts` and reuse it for comment content. `Block` is in `types.ts:29`.
- `src/shared/api/appError.ts:17,47,65,70`: `kindForStatus` maps 403 to `Client`. Distinguish 403 inside the comment repository's outcome; do not change the global mapping. `GET_RETRY_LIMIT` and `retriesFor` give the bounded retries.
- `src/shared/api/httpClient.ts:24-27`: the 401 refresh, then one retry.
- `src/shared/api/queryKeys.ts:~132`: add `comments(blogUrl, postId)` and `commentReplies(blogUrl, postId, commentId)`.
- `src/app/queryClient.ts:45-50`: the account-scoped cache reset. New keys need nothing more.
- `src/app/dev/demo.ts:494-513,720-790`: add `DEMO_COMMENTS_PATH` and a branch before `single` (`DEMO_POST_PATH` does not match `/comment/`).
- `scripts/check-fixtures.mjs`: the fixture rules (synthetic ids 1001–9999, `Sample text`, `https://example.invalid/`, times 1_700_000_000 + n·3600). Fixtures go in `src/test/fixtures/boosty/e19-*.json`.
- Diagnostics: seven OK presses on Настройки' «Версия» toggle capture (Story 8.3); the file is `/sdcard/Android/data/io.github.dzmitryafanasenka.boostytv/files/logs/boostytv.log`, read with `adb pull`. The probe's lines must pass the Logger's redaction and carry counts only.
- `src/shared/services/logger.ts:248`: `logger.info(scope, message, fields)`, where fields are primitives and output is redacted. Diagnostics capture is from Story 8.3 (`docs/testing.md` «Story 8.3»).
- Guards that stay: `postRepository.test.ts:150,516` (no `comment` path from E5/E6), `:438` and `mapPost.test.ts:39,350` (the post domain has no comments), `PostCard.test.tsx:106`, `AuthorCard.test.tsx:94`, `eventRepository.test.ts:170`. Add a guard that E19 is only sent from `entities/comment`.

## Tasks & Acceptance

**Execution:**
- [x] Probe (per the owner decision above): add the `TEMP111` probe, get the owner's OK, run it, read the counts, then remove it and grep for 0 in `src` and the release bundle. Turn diagnostics capture off if it was used.
- [x] `docs/api-contract.md`: E19 LIVE section; remove the UNVERIFIED stub.
- [x] `src/shared/api/dto/comments.ts`: the Zod schema from the LIVE shape.
- [x] `src/shared/entities/comment/{types.ts,mapComments.ts,commentRepository.ts,index.ts}` and the `mapBlocks` export: the domain types, the mapper and the repository with `page` and `replies`, plus `mergeComments`.
- [x] `src/shared/api/queryKeys.ts`: the two keys.
- [x] `src/test/fixtures/boosty/e19-*.json`: sanitized synthetic fixtures for every matrix row.
- [x] `src/app/dev/demo.ts`: the E19 demo route.
- [x] Tests: every matrix row, merge, the read-only guard (E19 only from `entities/comment`, GET only), and the existing exclusion guards unchanged.
- [x] `docs/feature-parity.md` COMM-01 evidence, `docs/testing.md` «Story 11.1» (probe environment and results, labelled), `CHANGELOG*` [Unreleased] (internal: nothing user-visible).

**Acceptance Criteria:**
- Given the probe results, when E19 is documented, then every entity field traces to a key the probe saw, and the fallback applies if E19 is unusable: the story ends with the finding and Story 11.2 is re-planned with the owner.
- Given the merged code, when `git grep TEMP111 -- src` runs and the release bundle is grepped, then both find 0 (this spec and `docs/testing.md` may name the marker).

## Implementation Notes

**Probe results (LIVE, 2026-11-02, the pinned TV, owner-signed release build with `TEMP111`, the owner's session, two runs with the owner's OK each; shapes and counts only, read from the diagnostics file, which was then turned off and cleared; the probe was removed, `git grep TEMP111` 0 and the release bundle count 0, and a clean build was installed with the session kept).** Requests were sent with the content profile as `GET /v1/blog/{blogUrl}/post/{postId}/comment/?limit=20&reply_limit=2&order=top[&offset=<intId>][&parent_id=<intId>]`.
- **200 body:** `{data: Comment[], extra: {isFirst: bool, isLast: bool}}`. No cursor field in `extra`.
- **Comment:** `{id: str, intId: num, author: {id: num, name: str, avatarUrl: str, hasAvatar: bool, isOfficial: bool}, createdAt: num (epoch s, inferred like posts), data: Block[] ({type: str, content: str, modificator: str}, the post block shape), isBlocked: bool, isDeleted: bool, isUpdated: bool, post: {id: str}, replyCount: num, replies: {data: Comment[], extra: {isFirst, isLast}}, reactions: {...}, reactionCounters: [...]}`. A reply additionally has `parentId: num`, `replyId: num` and `replyToUser: {id, name, avatarUrl, hasAvatar, isOfficial}`. `reactions` and `reactionCounters` are not read: there are no comment likes.
- **Inline replies:** up to `reply_limit` (2) under each comment, with `replies.extra.isLast` false when there are more. `parent_id=<comment intId>` returned all 5 replies of a comment with `replyCount` 5 and `isLast: true`. Paging of replies past one page was not seen. By the reference's rule (`offset` = the first reply's `intId`) it is the same scheme, unverified.
- **Paging (a post with 75 comments):**
  - Page 1 holds the newest 20, ordered by `intId` ascending (oldest to newest within the page), with `isLast: false`.
  - `offset=<the smallest intId of page 1>` returned the next 20 older comments. None of them overlapped page 1, all had `intId` below that offset, they were ascending, and `isLast` was false.
  - `offset=<the largest intId>` returned 19 of page 1 again, so it is not a cursor.
  - So the cursor is the smallest `intId` loaded, and «show more» loads older comments, placed before the loaded ones. This matches the reference (`fetchPost(offsetId = comments.firstOrNull().intId)`). `order=top` and no `order` gave the same result.
- **No comments:** 200 with `data: []` and `extra: {isFirst: true, isLast: true}`.
- **Locked post** (`hasAccess: false`): **403** (`AppError` `Client`, status 403), so the outcome is `denied`.
- Not seen: 404 (modelled as in the matrix), a deleted or blocked comment's content (`isDeleted` / `isBlocked` true), and non-text block types in comments (the shared `mapBlocks` handles them).
- **Entity shape beyond the matrix:** the domain `Comment` also carries `intId` (the API's numeric id), beyond the matrix's `{id, author, replyTo?, blocks, createdAt, replyCount, replies, hasMoreReplies}`, because the paging cursor (`offset`) and the replies' `parent_id` need it. The probe saw it on every comment and reply. `id` stays the only identity for keys, merge and focus.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter BH, edge-case-hunter EC, verification-gap VG):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| EC1 / BH1 | No guard when a page's smallest `intId` is not below the sent cursor: «show more» could loop | medium | `fetchPage` sets `nextCursor` whenever `isLast !== true` | patch |
| EC2 / BH3 | A missing `extra` ends paging, a malformed `isLast` (caught to undefined) continues it | low | `body.extra.isLast !== true`; one rule (`isLast === false` means more) is a direct fix | patch |
| BH2 | `isLast: false` with no usable `intId` ends paging silently | low | `smallestIntId` null gives `nextCursor` null with no log; a counts-only warn is a direct addition | patch |
| EC3 | A blogUrl with surrounding spaces passes the trimmed schema but the raw value is encoded | low | `blogUrlSchema.safeParse(blogUrl).success` then `encodeURIComponent(blogUrl)` | patch |
| EC4 / BH14 | `parentIntId` 0, negative or unsafe passes `Number.isInteger` | low | the cursor rule rejects these, the parent rule does not | patch |
| VG1 | The one-level reply rule has no failing test | medium | Pre-verified: every fixture reply has empty nested replies | patch (test) |
| VG2 | `isLast: true` over a larger `replyCount` is not pinned | medium | Pre-verified gap | patch (test) |
| BH4 | `mergeComments` appends, while older pages must go before; Story 11.2's pages come in load order | medium | `types.ts` / api-contract say «placed before»; the helper keeps call order | patch (a load-order helper) |
| BH13 | A non-AppError is turned into `error(Client)` without a log | low | `catch` branch | patch |
| BH11 | `intId` in the domain is not in the spec's entity shape | low | Needed for the cursor and `parent_id`; seen by the probe | patch (note in Implementation Notes) |
| BH7 | The dead-token behaviour of E19 is not in the api-contract open questions | low | Only «Not seen» mentions it | patch (doc) |
| BH5 | No rule for merging the inline replies with the `parent_id` list | medium | 11.2 behaviour; the `parent_id` page returned all replies | defer (Story 11.2) |
| BH8 | `isDeleted` / `isBlocked` not read | medium (unverified) | Never seen true live; the display rule belongs to 11.2 | defer (Story 11.2) |
| BH6 | All 403s map to `denied`; the body and an author-disabled case were not probed | maybe-false | Only a locked post was probed | defer (Story 11.2: probe or device check) |
| BH9 | `createdAt` unit inferred | low | The 11.2 device check shows dates; posts use epoch s | reject (low, seen in 11.2) |
| BH10 | `order=top` meaning unverified | low | Same result with and without it on a 75-comment post; documented | reject (low) |
| BH12 | The repeat fixture holds an id above the offset | low | The test checks the dedupe guard, not the live order | reject (low) |
| EC5–EC7 | The read-only source guard can be evaded (other files, escaped paths, DTO file) | low | Behavioural evidence: `transport.calls` assert GET; the guard is a backstop | reject (low) |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures`: all green.
- `git grep -n TEMP111 -- src`: no output; the release Hermes bundle grep for `TEMP111` counts 0.
