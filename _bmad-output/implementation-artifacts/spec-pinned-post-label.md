---
title: 'Pinned post label on the Author page'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: 'bb04c201d17f28b6161eca7a1946ef86f985f78e'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On the Author page Boosty returns the author's pinned post first (E4 `isPinned: true`, seen live on 2 of 3 blogs, e.g. a March post above October ones); the app shows it without any mark, so the owner reads it as a sorting bug.

**Approach (owner decision 2026-10-27, option 1):** Keep Boosty's order and mark the pinned card on the Author page: the card's date line reads «Закреплено · {date}» and its accessibility label starts with «Закреплено.». `isPinned` is parsed leniently (missing or wrong type → false). The feed (Главная) shows no mark: there a pinned post sits at its date. No reordering anywhere.

</frozen-after-approval>

## Implementation Notes

- `isPinned` parsed leniently in `src/shared/api/dto/post.ts` → `Post.pinned` (`mapPost.ts`); `PostCard` `showPinned` prop («Закреплено» inside the existing date Text, no extra native view; a11y prefix); `PostGrid` passes `showPinned` through; only `AuthorScreen` sets it. Copy `postCard.metaDatePinned`, `postCard.a11yPinned`.
- Tests: mapPost (live E4 pinned post, older than the next one, stays first; missing/wrong type → false), PostCard (mark and label with/without `showPinned`), authorFlow (live E4 page: first card marked, second not).
- Device (2026-10-27, agent, adb, release-like, owner's session): Илья MJTV Соколов's page shows «… · Закреплено · 12 окт» on the first card («Содержание»); other cards and Главная show no mark. On the 3-column card the author name truncates («Илья MJTV С…») to keep the mark and date whole — acceptable on the author's own page.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Misindented `showPinned` props in PostGrid (prettier warn) | low | patch: indentation fixed (eslint clean; the repo does not run `prettier --check`) |
| 2 | The longer date line can truncate the author name | low | rejected: seen on the device («Илья MJTV С…»); on the Author page the name is the page's own author |
| 3 | `isPinned` not in api-contract; feature-parity not updated | low | patch: api-contract E4 row; feature-parity is the deferred Epic 3 pass |
| 4 | Spec Implementation Notes empty | low | patch: filled |
| 5 | Pinned post repeated on later pages untested | low | rejected: pages dedupe by `post.id` (tested); no live repeat seen |
| 6 | No grid-level test that Главная shows no mark | low | rejected: only AuthorScreen passes `showPinned`; card-level test covers the flag; device checked |
| 7 | Non-pinned a11y label not asserted | low | patch: assertion added |
| 8 | authorFlow test relies on fixture order | false | the live pinned post is older than the next one (now asserted in mapPost.test) and stays first |
| 9 | Mark is text only, same style as the date | low | rejected: owner chose the text mark; a glyph/colour can come with a design pass |
| 10 | mapPost test casts without a null check | low | patch: null check added |
