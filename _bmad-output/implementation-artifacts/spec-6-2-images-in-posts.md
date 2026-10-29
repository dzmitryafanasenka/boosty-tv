---
title: 'Story 6.2: Images in posts'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: 'e24a373'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Images inside an accessible post render as the neutral «Изображение» placeholder (FR36, POST-*; epics.md Story 6.2).

**Approach:**
- An accessible post's `image` blocks with a URL become inline image focus stops, using the Story 3.6 teaser image path for layout.
- Width is the column capped at the text measure (the single-column layout replaced «right-column width»).
- The aspect ratio is kept, the maximum height is 300 dp, and a skeleton shows while the image loads.
- A failed image shows «Изображение недоступно» and leaves the rest of the post unaffected.
- The source is a plain `{uri}` with no auth headers.
- OK does nothing; there is no full-screen viewer. This matches the reference (`PostDataImageView`: a focusable box with no click action).
- A locked post's teaser images keep their Story 3.6 behaviour: not focusable, fitted to the screen.
- An image stop takes part in initial focus and in restore, like a paragraph. Image loading never moves focus.

</frozen-after-approval>

## Implementation Notes

- Builder: `images` accepts `'stops'` (accessible post) besides `true` (teaser); an `image` item carries `stop`; `isFocusStop` includes image stops, so an image can be the initial focus and drives the column's scroll stops (`src/shared/entities/post/postBody.ts`). `PostScreen` passes `images: 'stops'` for the accessible body.
- `ImageStop` in `src/features/post/PostBody.tsx`: a FocusableSurface (ring, no scale) around an explicit box `min(column, text-measure, 300 × aspect)`, the teaser's aspect rule (real after load, else the block's, else 16:9); `colors.skeleton` until `onLoad`; `onError` → «Изображение недоступно» (`post.imageUnavailable`) in the same box, the stop kept. Per-URL failure/size state. No OK action (reference `PostDataImageView`).
- Tests: builder and postFlow «Story 6.2»; the «Mixed blocks» placeholder row now uses an image without a URL; teaser tests carry `stop: false`.
- Docs: feature-parity POST-03, focus-map F (image stop), testing.md Story 6.2.
- Device: release-like build, adb, the owner's session: a portrait photo shows as a 300 dp focus stop with the ring; OK does nothing; Back returns to the same feed card. A failure and the skeleton were not seen live.

## Review Triage Log

Oneshot review (blind-hunter, 10 findings; edge-case and verification-gap layers are not part of the oneshot route).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A failed image keeps the loading skeleton colour behind «Изображение недоступно» | low | patch | `loaded` stays null after `onError`; the box now drops the skeleton when failed (test asserts `colors.surface`). |
| 2 | The failure message can be clipped for extreme aspect ratios | low | patch | The failed box keeps the image size with `overflow: hidden`; now at least 280 × 96 dp. |
| 3 | No focus scale, against DESIGN's `focus.scale-row`, with no recorded reason | low | patch (doc) | Reason recorded in the code and focus-map: a 600 dp image scaled past the column overlaps the text. |
| 4 | OK gives press feedback though it does nothing | low | patch | `scalePressed={1}` added (as the player timeline). |
| 5 | `ImageStop` duplicates `TeaserImage`'s box logic | low | reject | Two small components; the one difference (a null real aspect clears the skeleton) is intended. |
| 6 | Focus restore onto an image untested | low | reject | Restore goes by id through the same `onStopView` path as paragraphs (tested). |
| 7 | Sizing branches untested (no size, `onLoad` without a size, narrow column, new URL after failure) | low | patch (partly) | Test added for no size and `onLoad` without a size; the narrow column and URL change follow the teaser's tested rule. |
| 8 | `testing.md` lacks the checks run | low | patch | Host checks recorded. |
| 9 | Many large images in one post decode eagerly (not virtualized) | maybe-false | defer | A gallery post on the Chromecast would settle it; `resizeMethod="resize"` downsamples. |
| 10 | Status files disagree; the AC's «right-column width» | false | reject | Statuses move at finalize; the Approach records the one-column width (owner decision 2026-10-27). |

**Verification (2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 1992 passed each; `postFlow` + `src/shared/entities/post` + `src/features/post` ×30: 324 passed each run. Device: the pre-review build (portrait photo as a 300 dp stop, OK inert, Back to the same card).

