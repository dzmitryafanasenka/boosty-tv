---
title: 'PostCard placeholder for posts without a preview'
type: 'bugfix'
created: '2026-10-30'
status: 'done'
route: 'oneshot'
baseline_commit: 'a86c9ae7aa3fd56992de54652c7b91aedfcb5243'
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A post card with no preview, or with a preview that failed to load, draws the same plain `colors.skeleton` box as a card that is still loading (`src/shared/ui/PostCard.tsx`, the thumb fallback View). The family cannot tell «no picture» from «not loaded yet» (owner report, 2026-10-30). `DESIGN.md:235` already specifies «Polls and files without a preview show the author avatar on a plate», but it was never implemented.

**Approach (owner decisions, 2026-10-30):**
- Every card without a usable preview (`previewUrl` null, or the preview failed) shows a placeholder: the author's round avatar centred on a calm neutral plate (`colors['surface-raised']`, not the skeleton colour). The avatar size is derived from the thumb height (no new design token).
- If the author has no avatar, or it fails to load, the plate shows a small post-type icon instead (video, several videos, audio, text and photo, poll, file). These are new SVG glyphs in `src/shared/ui/icons`, drawn in the existing secondary text colour.
- A preview that exists but failed to load uses the same placeholder.
- Unchanged:
  - the loading state stays the skeleton (the card skeleton);
  - the badges, the pinned badge, the duration, the progress bar, the locked dim and the lock glyph (a locked card without a preview: the plate, then the lock glyph on top, as before);
  - card sizes, the focus ring and scale, and the a11y label.
- Applies wherever `PostCard` renders: Главная, Автор, Поиск, and the Continue row if it uses `PostCard`.

</frozen-after-approval>

## Implementation Notes

- **Files changed:** `src/shared/ui/PostCard.tsx` (the plate, `TypeIcon`, the local `Avatar` extended with `size`, `dimmed`, `fallback`, `testID`), `src/shared/ui/icons/index.tsx` (six new post-type glyphs on a shared `Glyph` wrapper), `src/shared/ui/__tests__/PostCard.test.tsx`, `src/shared/ui/__tests__/icons.test.tsx`, `docs/testing.md` (new section), DESIGN.md PostCard row (text only, no frontmatter change).
- **Decision: PostCard's own `Avatar`, not `AuthorAvatar`.** PostCard already had a local meta-row `Avatar` with the same failure handling (`useItemState` keyed by URL). Extending it with an optional `fallback` (rendered instead of the neutral circle when there is no URL or it failed) keeps `AuthorCard` and the Author header untouched and avoids a new cross-component prop. The meta-row avatar behaves as before (no `size`, no `fallback`).
- **Decision: sizes.** Avatar = `round(thumbHeight × 0.5)` (62 dp on a 221 dp card), icon = `round(thumbHeight × 0.3)` (37 dp). Ratios are local constants, no new tokens; `tokens.test.js` unchanged.
- **Decision: flat structure.** The placeholder is one plate View (`surface-raised`, centred children) with exactly one child: the avatar Image or the SVG icon. A preview card's native view count is unchanged; a placeholder card adds one view (budget test ≤ 10).
- **Decision: locked without a preview.** The plate, the avatar dimmed with the existing locked opacity (0.4) so the lock glyph stays legible, then the lock glyph on top (it is rendered after the plate). A `locked` kind has no type icon: with no avatar the plate shows only the lock glyph (the underlying type is unknown for a locked post).
- **Continue row:** uses `ContinueCard`, not `PostCard`, so it is out of scope per the spec and unchanged.
- **Icons are not exported from `src/shared/ui/index.ts`:** only PostCard uses them.
- **Device:** release-like build over adb, real «Текст и фото» posts without a preview on Главная show the avatar plate; focus ring/scale fine. The type-icon path and a locked placeholder were not reachable with real data (every author had an avatar); host-tested only. The demo build was not used.
- **Verification:** lint `--max-warnings 0`, typecheck, `check:fixtures` clean; `npm test` ×3 all green (2703); touched suites ×30 0 failed runs.
- **View budget and SVG:** the budget test counts host views; the type icon's SVG children (`Svg`, `Path`, `Rect`, `Circle`) are not counted there. They render only on a card with no preview and no avatar (rare in real data), so the cost was accepted without a separate budget.
- **Review fixes (2026-10-30):** the per-kind test now names the icon and compares the rendered glyph with a standalone render of the expected icon (the `TYPE_ICONS` mapping), and the distinct-glyph test covers all 6 kinds. The budget test now asserts exactly one more native view for the same card after its preview fails. Recycled-cell tests were added: preview ↔ no preview, author A's failed avatar → author B's working avatar, no preview → locked no preview. Locked with no avatar shows the plate and the lock only. The plate itself is not dimmed, while a locked preview Image is. The icon tests assert `accessibilityElementsHidden`. The PostCard docblock and the DESIGN.md PostCard row were rewritten as one rule for every kind.

## Review Triage Log

| Finding | Severity | Disposition |
|---|---|---|
| Per-kind test: the icon column was unused, the title printed an array, no check of the `TYPE_ICONS` mapping; the distinct-icon test skipped `text` | medium | Patched: the icon name is in the title, the glyph is compared with a standalone render of the expected icon, 6 distinct kinds |
| The budget test claimed «adds one view» but asserted only `≤ 10` | low | Patched: `placeholder.native === preview.native + 1` for the same card; the title says only that |
| No recycled-cell tests for the placeholder; no locked + no avatar test; the plate vs a locked preview dim not checked | medium | Patched |
| Icon tests did not assert `accessibilityElementsHidden` | low | Patched |
| PostCard docblock did not describe the placeholder | low | Patched |
| DESIGN.md PostCard row: the poll/file sentence plus an appended, contradicting rule; no icon size or locked no-avatar state | low | Patched: one rule for every kind, icon 0.3 of the thumb height, locked no avatar = the plate and the lock only |
| The same avatar URL is decoded twice (the plate and the meta row) | low | Rejected: accepted for now |
| SVG children are not in the view budget | low | Rejected: noted in Implementation Notes instead |

