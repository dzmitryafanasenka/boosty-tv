# ADR 0011: The feed grid uses FlashList 2.3.3 (view recycling)

- Status: accepted (owner decision 2026-10-26, Story 3.1 device profiling; the owner accepted it on the device 2026-10-26)
- Date: 2026-10-26
- Relates to: `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md` (Spec Change Log, 2026-10-26 device profiling), `docs/focus-map.md` §3, [ADR 0010](0010-server-state-tanstack-query.md)

## Context

On the pinned Chromecast with Google TV (release build, atrace, 20× ↓) the feed stuttered on every page arrival. Each page mounted about 3 rows in one Fabric batch (`mountViews` 150–220 ms + `preMountItems` 100–150 ms), so frames took 330–510 ms. The total was about 2.1–2.8 s per ~60 cards, about 37 ms of native work per card; about half of it was Text creation and measurement (`createViewUnsafe(RCTText)` ≈ 1.8 ms each).

Already applied and measured on the device:
- `resizeMethod="resize"`: kept. Graphics 325 → 37 MB, janky frames 100 → 9 %.
- `fadeDuration={0}`: kept, neutral.
- Card flattening (13 → 9 native views): kept, −8 %.
- A narrower window or smaller batches: worse, reverted.
- `textBreakStrategy="simple"`: neutral, reverted.

For comparison, the Google TV launcher: median 32 ms, 0 % janky. FlatList creates the native views of every row it mounts. A recycling list reuses the off-screen rows' views for new rows, so a page arrival no longer creates them.

## Decision

The «Новое в подписках» grid (`src/features/home/FeedGrid.tsx`) renders with `@shopify/flash-list` **2.3.3**, pinned exactly.

| Check | Evidence |
|---|---|
| Version | `2.3.3`, published 2026-10-01, `latest` at adoption (npm registry) |
| Peer dependencies | `react: *`, `react-native: *`, `@babel/runtime: *` |
| Code | Pure JS (ESM `dist`), no native module. v2 targets the New Architecture only; the app runs Fabric |
| RN 0.87 / react-native-tvos | **Not stated by the project; unverified.** The Metro release bundle builds (`__tests__/releaseBundle.test.js`); everything else waits for the device |

Setup:
- Items are rows of 3 posts keyed by the first post id (`feedRows`), one item type (`getItemType` → `'row'`), with a fixed row height. v2 has no `getItemLayout`; it measures each row once.
- The trailing partial row is held back while more pages may come (`visibleFeedPosts`). The end guide stays in the footer.
- `drawDistance` is 3 rows (keeps the next row ready for Android's focus search on a fast ↓).
- `maxItemsInRecyclePool` is 6 rows (bounded for the 2 GB device).
- `removeClippedSubviews={false}`.
- Inside a row, cards are keyed by column, never by post id. A post-id key would remount the cards and defeat recycling.
- Restoration: an item-index → row-index adapter over the FlashList ref (`scrollToIndex`, `scrollToOffset`), `onScroll` → FocusRestoration, and `initialScrollIndex` + the remembered offset on a cached remount.
- Jest: `jest.config.js` transforms `@shopify/flash-list` and loads its `jestSetup.js` (fixed measurements).

## TV risks and mitigations

| Risk | Mitigation | Verified |
|---|---|---|
| **Recycled cells keep their React instance**: `useState` leaks to the next item (focus ring, pressed, a failed image) | `useItemState(initial, itemKey)` (`shared/ui`) resets per item without an extra render or a list relayout (FlashList's `useRecyclingState` asks the list to lay out on every change, too costly for focus). `FocusableSurface` takes `resetKey` (PostCard passes `post.id`; buttons pass nothing and keep plain state); the scale jumps to its rest value on an item change. PostCard's preview failure is keyed by post id, the avatar failure by URL | Host tests (`PostCard.test.tsx` «recycled cell») |
| RN `Image` shows the previous source until the new one loads | The preview and avatar `Image`s are keyed by their URL: only that one native view remounts on a recycle, never the cell | Host only; the visible result needs the device |
| **FlashList #1843** (Android TV, v2, RNTV 0.79.5): focus moves to another item when data updates with a stable `keyExtractor` (repro `douglowder/flash-list-tv-focus-test`) | **None: not reproduced here, and the earlier mitigation was removed** (see «Device results» below). If a data-change focus jump is ever observed, the fix must key off D-pad events (`TVEventHandler`: a focus change without a preceding key press), never off frame timing | **Device (adb, release-like, 2026-10-26): not reproduced** |
| Items render after a layout pass, so a focus request at data arrival finds nothing mounted | `useFocusRestoration` focuses a pending target when its view mounts (`itemRef`), and `focusInitial` waits like `restore` | Host tests |
| `nextFocus*` tags pointing at recycled cells | None used: the end guide's destination is the focused card's view, updated on every card focus | Host tests |
| Native focus search across recycled rows on a fast ↓ (column jumps) | Held partial row + `drawDistance`; slot padding keeps the focus ring inside the native focus scroll | **Device (adb, 2026-10-26): column 3 kept on fast ↓** |

## Device results (2026-10-26, adb, release-like build, pinned Chromecast with Google TV)

- **Performance:** page-mount stall 1.15–1.47 s per 20 rows with FlashList, against 2.0–2.2 s with FlatList; top frame about 300 ms, against 400–450 ms. Columns stay on fast ↓.
- **#1843 not reproduced** on react-native-tvos 0.87.1-1 + FlashList 2.3.3, in a variant built without the mitigation:
  - 60 single ↓ steps with about 18 page appends, focus checked 1.5 s after each step: focus never moved without a key press;
  - fast ↓ every 0.15 s and every 0.3 s, 60 presses, 2 runs each: column 3 kept throughout.
- **The mitigation was removed.** It re-checked focus «two frames» after a data change and put it back on the previous card. During a 300 ms mount hitch, two frames last up to about 0.6 s, so the user's own ↓ in that window was reverted. That matched the owner's report «sometimes on a long scroll down focus seems to jump to another card».

## Rollback

FlatList. The row model (`feedRows`, `visibleFeedPosts`, row keys, `feedRowLayout` as `getItemLayout`, `gridListAdapter`) is list-agnostic. To roll back:
- swap `<FlashList>` for `<FlatList>` with `getItemLayout={feedRowLayout}`, `initialNumToRender={6}`, `maxToRenderPerBatch={4}`, `updateCellsBatchingPeriod={30}`, `windowSize={11}`;
- change the ref type;
- remove the FlashList props.

The recycling guards (`resetKey`, image keys) are harmless with FlatList.

## Consequences

- Story 3.3 (2026-10-27): the grid moved to `src/shared/ui/PostGrid.tsx` and serves Главная (`features/home/FeedGrid.tsx` is now a thin wrapper with Главная's ids) and the Author page with the same setup; the paging hook moved to `src/shared/entities/post/usePagedPosts.ts`. The rollback below applies to `PostGrid` (`postGridRows`, `postGridRowLayout`, `postGridListAdapter`).

- Device checks (2026-10-26, owner with the physical remote and adb runs):
  - **done:** columns kept on fast ↓; the end guide; restoration on return; no focus jump on page appends (#1843 not reproduced, see «Device results»); performance against the FlatList baseline;
  - **not done:** TalkBack on cards; a stale image on a recycled cell was not checked separately.
- In Jest, FlashList's fixed 100 × 100 measurements report the list end at once. `homeFeedFlow.test.tsx` keeps `onEndReached` away from the real list and calls it itself; other flow tests may load further pages by themselves.
- **Rollback trigger:** a reproducible focus defect caused by recycling that a fix keyed off D-pad events (`TVEventHandler`) cannot solve, or a FlashList regression on react-native-tvos. Rollback = the FlatList steps above.
- **tvOS (phase 4):** FlashList v2 is New-Architecture JS with no native code, but tvOS uses a different focus engine (UIKit focus, Siri Remote). Re-verify recycling, focus search across recycled rows, the end guide and restoration on tvOS before phase 4; nothing here is validated for tvOS.
