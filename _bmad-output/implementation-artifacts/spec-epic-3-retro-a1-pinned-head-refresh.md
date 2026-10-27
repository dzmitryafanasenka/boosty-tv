---
title: 'Epic 3 retro A1: the pinned post must not break the Author head refresh'
type: 'bugfix'
created: '2026-10-27'
status: 'done'
baseline_commit: '38fa7e8aba07762bba6f69f80d4e4b42536a8191'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On the Author page E4 page 1 always starts with the author's pinned post (`isPinned`), so the head refresh (`mergePostsHead`) always finds an overlap with the cache: when 20+ posts appeared since the last load, page 1 is merged onto the old head and the posts in between are silently lost; and after the author re-pins another post, the cached copy of the old pin keeps `pinned: true`, so two pin badges show (Epic 3 retro F1, F2; `epic-3-retro-2026-10-27.md`).

**Approach:** For the Author refresh only (an option, Главная unchanged), the pinned posts of the fresh page do not count as overlap: when no non-pinned fresh post is in the cache, it is a gap and page 1 replaces the cache (as today for a gap). After a merge, a cached post that is no longer pinned in the fresh page loses its pin (only the fresh page's pins stay pinned). Tests: 20+ new posts with only the pin shared → replaced; a re-pin → one badge; an ordinary refresh with a shared non-pinned post still merges; Главная's behaviour and tests unchanged.

</frozen-after-approval>

## Implementation Notes

- `src/shared/entities/post/postsHeadRefresh.ts`: option `pinnedFirst` (Автор only, passed by `src/features/author/authorPostsRefresh.ts`). The gap test uses the non-pinned fresh posts; an empty fresh page stays a gap as before; a page of pins alone merges. After a merge, a cached post that was pinned and is not pinned on the fresh page leaves the merged first page (`dropStalePins`; its real date position is unknown, paging brings it back) and loses its pin on later pages. `kind` still compares post ids only.
- Tests (`postsHeadRefresh.test.ts`): 20+ new posts with only the pin shared → `replaced` (and `prepended` without the option, Главная); an ordinary refresh still merges; re-pin → one badge, the old pin leaves the head; unpin → no pin left; Главная leaves pin flags alone; the option passes through `refreshPostsHead`. The Author screen's focus on a `replaced` head was already covered by `authorFlow` («a gap: the cache is page 1 alone; focus follows the fallback chain»).
- Host: lint, typecheck clean; `npm test` ×3: 1154 passed (before the review fix), affected suites 246/246 after it; full run below.
- Device: not run — it needs an author with 20+ new posts since the last load or a re-pin; host tests only.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | After a re-pin the old pin stays in the head, moved behind the fresh posts (out of date order) | medium | patch: stale pins leave the merged first page |
| 2 | Fresh page 1 can duplicate ids that sit on later cached pages | low | rejected: pre-existing in `mergePostsHead` for both lists; `usePagedPosts` dedupes across pages (first kept) |
| 3 | F2's second half (a deleted head post stays cached) not addressed | low | defer: deferred-work entry |
| 4 | New `replaced` path on Автор without a focus test | false | `authorFlow` «a gap: the cache is page 1 alone; focus follows the fallback chain» covers it |
| 5 | Edge tests missing (unpin, Главная flags untouched) | low | patch: tests added |
| 6 | Comment wording («always starts with the pin», «proves no overlap») | low | patch |
| 7 | `kind` may say `unchanged` while pin flags changed | low | patch: documented (`kind` compares ids; only tests read it) |
| 8 | Spec notes empty | low | patch |
| 9 | No device check | low | recorded: not reproducible on demand |
