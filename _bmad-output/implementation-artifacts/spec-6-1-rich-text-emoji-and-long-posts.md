---
title: 'Story 6.1: Rich text, emoji and long posts'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: 'e2a572e5a981c19fd54dbd3e215569a0968bdbd7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Post text renders as plain paragraphs. Bold, italic and underline are lost, and inline emoji (`smile` blocks) show as placeholders or nothing (FR34, POST-*; epics.md Story 6.1).

**Approach:**
- The mapper keeps each `text`/`link` fragment's style ranges from `content` (`[text, ?, [[code, from, len], …]]`) and maps `smile` blocks to an inline emoji.
- The paragraph builder (`postBody.ts`) turns a paragraph into styled segments (text runs with bold/italic/underline flags, plus emoji) instead of one string.
- The 600-character stop split keeps the styles: a run that crosses a cut continues in the next stop.
- `PostBody` renders the segments as nested `Text` with inline emoji images at text size.

**Decisions:**
- Codes as in the reference and `docs/api-contract.md` §blocks: 0 bold, 2 italic, 4 underline. Any other code renders as normal text.
- `from`/`len` are JavaScript string offsets (UTF-16 code units, as the reference's Kotlin strings), counted from the start of the paragraph (owner decision 2026-10-29, after the live check: all 1 694 live ranges fit at paragraph offsets; the reference's `mergeText` does the same). Each fragment's ranges are clamped to that fragment (a range never styles another fragment); an empty or negative one is ignored. A smile counts as one offset unit.
- A `content` that is not a JSON array renders as plain text (as built). A malformed range list drops only the styles, never the text.
- Emoji: the `smile` block's image (`mediumUrl`, else `largeUrl`, else `smallUrl`) as a `{uri}` source with no auth headers, inline at the text's line height. If there is no URL or the image fails, the emoji takes no space and the paragraph is unaffected. An emoji counts as one character in the split budget.
- Links keep the as-built inline-text rule; their style ranges apply too. Link chips are Story 6.3.
- Owner decision 2026-10-29 (Q1 a): no collapse. Long text keeps the as-built rule (owner decision 2026-10-27, option A): every paragraph is a focus stop and ↓ walks the whole text. Story 6.1's «collapsed with an expand action» AC is reconciled to this; epics.md follows via Epic 5 retro item A5.
- Before relying on it, verify live (debug build, counts and booleans only, log removed before the commit): the style codes seen in the owner's posts, and the `smile` block's keys and URL presence. Record «Text styles and smile (LIVE)» in `docs/api-contract.md`. If no emoji is found live, the emoji path ships fixture-tested and is recorded as unverified.

## Boundaries & Constraints

**Always:**
- The mapper and builder stay pure and total: no block shape throws.
- Block keys and paragraph keys are unchanged (focus restore on Post must keep working).
- No text, URL or title is logged; only counts and types.
- Tokens come from `shared/ui`.
- The locked-post teaser and every other caller of the builder keep working.

**Never:** No link chips, images, files, audio or polls (Stories 6.2–6.7). No custom font loading. No HTML or markdown parsing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Styles | `["Привет мир", "unstyled", [[0,0,6],[2,7,3]]]` | «Привет» bold, «мир» italic | — |
| Unknown code | `[[7,0,3]]` | normal text | — |
| Bad ranges | ranges not an array / out of bounds | text intact; bad ranges ignored or clamped | — |
| Non-JSON content | `"plain"` | plain text | — |
| Emoji | text, `smile`, text, `BLOCK_END` | one paragraph with the emoji inline | image fails → no gap, text intact |
| Long styled | 1500 chars with a bold run across the 600 cut | 3 stops; the bold run continues in the next stop | — |
| Merge | styled fragments across `text`/`link` until `BLOCK_END` | one paragraph, each fragment's styles at its paragraph offsets, clamped to the fragment | — |

</frozen-after-approval>

## Code Map

- `src/shared/entities/post/mapPost.ts:26-41` (`textOf`) -- add `styledTextOf(content) → {text, spans: {style:'bold'|'italic'|'underline', from, len}[]}`. Unknown codes are dropped, ranges clamped. Keep `textOf` for callers that need plain text (titles).
- `src/shared/entities/post/types.ts:15-25` -- `text`/`link` blocks gain `spans`. A new `{type: 'smile'; name: string; url: string | null}` block.
- `src/shared/api/dto/post.ts` -- `smileBlockDtoSchema` (`name`, `smallUrl?`, `mediumUrl?`, `largeUrl?`), parsed like the other blocks. An unknown shape becomes `Block.Unknown`.
- `src/shared/entities/post/postBody.ts` -- the paragraph item becomes `{kind:'paragraph'; key; segments: Segment[]}` with `Segment = {kind:'text'; text; bold; italic; underline} | {kind:'emoji'; key; url}`. Add a `text` accessor for existing callers (accessibility labels, tests). `splitParagraph` cuts on the plain text and maps the cut back to segments. List items follow the same path.
- `src/features/post/PostBody.tsx` -- ParagraphStop renders segments as nested `Text`. Emoji are an inline `Image` sized to `typography.body.lineHeight`, `onError` → hidden. The accessibility label stays the plain text.
- Other `postBody` consumers (locked teaser in `PostScreen.tsx`, tests) -- keep compiling via the `text` accessor.
- Fixtures: extend a sanitized post fixture with styled ranges (bold already appears live: 64 ranges, code 0) and a synthetic `smile` block marked as such.
- Tests: `mapPost.test.ts` (styles, unknown code, bad ranges, non-JSON), `postBody.test.ts` (merge across fragments, styles across the 600 cut, emoji in the budget), `__tests__/postFlow.test.tsx` (rendered spans, emoji failure).

## Tasks & Acceptance

**Execution:**
- [x] Live check of style codes and `smile` shape (counts-only probe, removed); `docs/api-contract.md`.
- [x] Mapper, types, DTO, builder segments and split; consumers.
- [x] `PostBody` styled rendering and inline emoji.
- [x] Tests for every matrix row; docs: `docs/feature-parity.md` POST rows «Android (Story 6.1)», `docs/testing.md` Story 6.1.
- [x] Device (release-like, adb, owner's session): a post with bold text and, if found, emoji; ↓ through a long styled post; screenshots to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then everything passes; the touched suites pass 30/30; lint `--max-warnings 0`, typecheck and `check:fixtures` are clean.

## Implementation Notes

- Mapper: `styledTextOf(content) → {text, spans}` (`textOf` kept as its `.text`); known codes only, integer `from`/`len`, `from ≥ 0`, `len > 0` (other ranges dropped); ranges are NOT clamped to the fragment there (see the change log). `smile` → `{type:'smile', name, url}` (`mediumUrl` → `largeUrl` → `smallUrl` → null); every field optional, so a `smile` never becomes `Block.Unknown` unless it is not an object.
- Builder: a paragraph is a `Line` (segments, plain text with U+FFFC per shown emoji, style offset). Each fragment's ranges are placed at the line's offset and clamped to the fragment; a smile adds one offset unit (shown or not). The 600 split runs on the plain text (`splitRanges`, the same cut rules as `splitParagraph`) and maps each part back to segments; adjacent runs with equal styles merge. `text` is the plain text without emoji, trimmed (accessibility label, existing callers); `isFocusStop` is false for a paragraph without text (emoji only), which `PostBody` renders as non-focusable content and `PostScreen` never picks as the initial target. `listItemTexts` was removed. Keys and the split of unstyled text are unchanged.
- `PostBody`: nested RN `Text` per styled run (bold = `fontFiles[600]`, no `fontWeight`; italic = synthesized `fontStyle`; underline = `textDecorationLine`); `InlineEmoji` = plain `{uri}` `Image`, 22 × 22 (`typography.body.lineHeight`), not focusable or accessible, removed on `onError` (per URL).
- Live findings beyond 6.1 (types only, for later stories): 9 `file` blocks and 42 `header` blocks in the owner's posts (`header` renders as the unsupported placeholder today).

## Spec Change Log

- 2026-10-29 (implementation; ratified by the owner 2026-10-29, option a, frozen Decisions and matrix amended): the live check showed that a fragment's style range counts from the **start of its paragraph** (UTF-16), not from the fragment: all 1 694 live ranges fit their fragment's slot at paragraph offsets; 762 fall outside the fragment at fragment offsets (every later fragment, e.g. every underlined link after «→ »). The reference (`mergeText`) applies them at paragraph offsets too. Reading the Decisions «`from`/`len` … A range outside the fragment is clamped» literally would have dropped those styles, so the builder places each fragment's ranges at its paragraph offset and clamps them to the fragment (a range never styles another fragment). The matrix row «Merge … each fragment's styles at its own offsets» is implemented as «each fragment's styles at the offsets it carries, placed in the paragraph». A smile counts as one offset unit (the reference's inline content; unverified live: no smile was seen). 

## Review Triage Log

Iteration 0 (layers: blind-hunter 14, edge-case-hunter 6, verification-gap 1 gap + 2 other).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge, vgap | An emoji-only paragraph (or split part) becomes a focus stop with an empty label; a failed image leaves a blank stop | medium | patch | `postBody.test.ts` «a smile can start a paragraph» yields `{key:'smile@0', text:''}`; `ParagraphStop` renders it focusable. Fix: a stop without plain text is not focusable. |
| 2 | edge, blind | A negative `from` is clamped to 0 and kept; the Decisions say ignored | low | patch | `spansOf` uses `Math.max(0, from)`; direct correction. |
| 3 | edge, blind | `listItemTexts` has no production caller and strips every U+FFFC | low | patch | Grep: only tests and the `index.ts` export; deletion. |
| 4 | blind | The emoji failure / no-space rule and the 22 dp box are proven in JS only (inline image spans on Android) | maybe-false | patch (doc) | No smile seen live; docs now mark it native-unverified. |
| 5 | blind | `epic-6-context.md` lacks the paragraph-offset rule that Story 6.3 needs | low | patch | Direct doc correction. |
| 6 | blind | `focus-map.md` lacks the `smile@<index>` key and the no-text rule | low | patch | Direct doc correction. |
| 7 | blind | 42 live `header` blocks render as the unsupported placeholder and are untracked | low | defer | Probe count in Implementation Notes; reference behaviour not audited. |
| 8 | blind, edge | A smile is assumed to be one offset unit; unverified, and an image-less smile at a paragraph start shifts later ranges if wrong | maybe-false | defer | No live smile; settle with the first live sample. |
| 9 | blind | `smile.name` unused; the label has a double space where the emoji was | low | reject | Cosmetic; TalkBack reads the text. |
| 10 | blind | Underlined link text looks actionable before Story 6.3's chips | low | reject | The next story adds the chips; the underline is Boosty's own style. |
| 11 | blind | Spec status mismatch; empty triage log | false | reject | Sprint status moves at step-05; the log is written now. |
| 12 | blind | The live fixture now carries synthetic ranges and a smile without an in-JSON marker | low | reject | Provenance is documented in `src/test/postFixtures.ts`; `check:fixtures` passes. |
| 13 | blind | Malformed offsets can split a surrogate pair | low | reject | Needs malformed server offsets; none seen in 1 694 live ranges. |
| 14 | vgap | Per-URL emoji retry after a refetch is untested | low | reject | Smile URLs are static; no smile seen live. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean.
- `npm test` ×3 -- expected: all pass.

**Result (after the review patches, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 1987 passed each; `postFlow` + `playerFlow` + `src/shared/entities/post` + `src/features/post` ×30: 443 passed each run, 0 failed runs. The installed release-like build predates the review patches (host-tested only).
