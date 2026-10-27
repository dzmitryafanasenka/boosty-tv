---
title: 'Pin icon instead of «Закреплено»; author name first on tiles and the Author header'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: '7ab4c08b27c1e55ead62adae92c99e7d0ff95aaa'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (1) The pinned card's «Закреплено» text lengthens the meta line and truncates the author name; the owner wants a pin icon instead. (2) On Подписки tiles (and the Author header) the blog title, which is usually a tagline («Музыкант и Видеоблогер»), is the big line and the channel's name («Илья MJTV Соколов») the small one; the owner wants them the other way round.

**Approach (owner decisions 2026-10-27):**
- Pin: on the Author page a pinned card shows a small pin badge in the top-right corner of its preview (the 📌 glyph from the `ru` catalog on the badge background, like the type badge); the meta line is back to «author · date». The accessibility label keeps «Закреплено.» at the start. Главная shows nothing.
- Name first: the main (larger) line is the owner's name; the second (smaller) line is the blog title. Without an owner name the title (or «Без названия») is the main line and there is no second line; a title equal to the name is not repeated. Same order in the tile's and the header's accessibility labels («{name}. {title}»). Applies to AuthorCard (Подписки) and the Author page header.

</frozen-after-approval>

## Implementation Notes

- Pin: `PostCard` shows `postCard.pinned` (📌) on the badge background at the preview's top right when `showPinned && post.pinned`; the date line is back to « · {date}»; the a11y label keeps the «Закреплено.» prefix. `metaDatePinned` removed.
- Name first: `authorPrimaryName` / `authorSecondaryLine` in `src/shared/ui/AuthorCard.tsx` (the title is not repeated when it equals the name, ignoring case and spacing), used by AuthorCard and `AuthorHeader`; copy `authorCard.a11y` «{name}. {title}», `author.a11yHeader` «Автор: {name}. {title}», `author.a11yHeaderNameOnly`.
- Docs: focus-map §4 D header note, api-contract E4 row, DESIGN.md AuthorCard row.
- Device (2026-10-27, agent, adb, release-like, owner's session): Подписки tiles read «Алексей Антонов / наконец, полезный кон…», «Илья MJTV Соколов / Музыкант и Видеоблог…», «Стас Асафьев / Первый раз живу жизнь»; the Author header «Илья MJTV Соколов / Музыкант и Видеоблогер»; the pinned card shows 📌 top right, the meta line «Илья MJTV Соколов · 12 окт» is no longer truncated; the emoji renders inside the badge without clipping.
- Host: lint, typecheck, check:fixtures clean; `npm test` ×3: 1149 passed (before the review fixes; re-run below).

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Docs still describe the old order and «Закреплено» (focus-map, api-contract, DESIGN.md) | low | patch |
| 2 | Stale/orphaned comments in `ru.ts` | low | patch |
| 3 | Spec notes empty | low | patch |
| 4 | Emoji badge not checked on the TV; better drawn | low | rejected: checked on the device screenshot (renders whole inside the badge) |
| 5 | Name/title comparison is case- and space-sensitive | low | patch: compare lowercased with collapsed spaces |
| 6 | Second line uses `styles.owner` | low | patch: renamed `secondary` |
| 7 | `authorCardTitle` export now unused outside the file | low | rejected: harmless public helper |
| 8 | Test gaps: header branches, not-pinned with `showPinned` | low | patch: the pin case; header branches share the tested helpers |
| 9 | `a11yHeaderNoOwner` misnamed | low | patch: `a11yHeaderNameOnly` |
