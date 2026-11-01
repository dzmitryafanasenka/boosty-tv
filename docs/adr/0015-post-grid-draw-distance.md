# ADR 0015: The post grid draws 2 rows beyond the viewport

- Status: proposed (Story 9.3 device profiling; awaiting the owner's physical-remote check)
- Date: 2026-11-01
- Supersedes in part: [ADR 0011](0011-feed-list-flashlist.md) «Setup», `drawDistance` 3 rows
- Relates to: `_bmad-output/implementation-artifacts/spec-9-3-performance-on-the-device.md`, `docs/testing.md` «Story 9.3», `docs/focus-map.md` §1.5

## Context

Story 9.3 measured the feed grid (`src/shared/ui/PostGrid.tsx`, Главная and Автор) on the pinned Chromecast with Google TV. It used an owner-signed release build and the owner's real feed. The agent drove it over adb.

atrace showed that every long frame came 0.3–0.5 s after an E5 page response. The new rows mounted in one Fabric batch: `IntBufferBatchMountItem::mountViews` took up to 205 ms, `preMountItems` up to 107 ms, and the first draw took about 70 ms. With `drawDistance` at 3 rows, a page that arrives while focus is near the end of the list falls inside the draw window, so all its rows (about 3.3 rows per 10-post page) mount at once.

## Options measured on the device

Each option ran with the same method: a cold start, then ↓ held for 20 s (about 16 key events per second) or 40 single ↓ steps 0.5 s apart. `dumpsys gfxinfo` counts the frames; atrace measures the longest frames in the single steps.

| Option | Held ↓: janky / frames ≥ 300 ms | Single steps: janky / longest frames |
|---|---|---|
| ADR 0011 setup (`drawDistance` 3 rows) | 19.9–20.9 %; 1–5 per run | 5.3–5.5 %; 312–336 ms |
| Earlier prefetch (end threshold 2.5 viewports, card trigger 6 rows from the end) | 27.7 %; 1 | 9.4 %; not traced |
| Images not keyed by URL (recycled image views) | 18.2–26.4 %; 1–3 | 4.9 %; one frame ≥ 300 ms |
| E5 page size 30 instead of 10 | 19.1–20.1 %; 5–6 | 7.4 %; one frame ≥ 300 ms |
| `drawDistance` 1 row | 25.1–27.3 %; 0 | 6.9 %; none ≥ 300 ms |
| **`drawDistance` 2 rows** | **14.8–21.2 %; 0–2 per run** | **4.4–5.3 %; 140–148 ms** |

Only the 2-row window improved every measure. The other options were reverted. The page size and the image keys stay as they were. ADR 0011's stale-image guard is unchanged.

## Decision

`POST_GRID_DRAW_DISTANCE` is 2 rows. The Автор grid shares the constant (the same `PostGrid`) but was not measured separately; every number here is from Главная. The recycle pool (6 rows), the row model, the keys and `removeClippedSubviews={false}` stay as ADR 0011 describes them.

| Check | Result (agent over adb, release build) |
|---|---|
| Columns on a fast ↓ | Column 3 kept for 60 ↓ at 0.15 s, 60 ↓ at 0.3 s and a burst of 20. Column 1 kept for a 15 s hold. Column 2 kept for a 10 s hold |
| Single steps | The longest frame fell from 312–336 ms to 140–148 ms. The sum of frames over 100 ms fell from 1.15–1.40 s to 0.37–0.80 s per 40 rows |
| Focus stability tests | `homeFeedFlow` and `authorFlow` (the PostGrid flows; there is no separate `postGridFlow` suite) pass unchanged |

## Consequences

- A held ↓ still misses the scroll target. Janky frames are 15–21 % against the 10 % target, and a frame of 300 ms or more remains in some runs. During a long hold, focus also waits at the end of the list for each E5 page, about 1.2 s per page (the network round trip). This is the documented exception in `docs/testing.md` «Story 9.3».
- The Автор grid gets the same window without its own measurement.
- Подписки and События keep their own `drawDistance` values. Story 9.3 did not change them.
- **Rollback:** set `POST_GRID_DRAW_DISTANCE` back to `3 * POST_GRID_ROW_HEIGHT`.
- **Rollback trigger:** a focus jump or a column change on a fast ↓ that the 3-row window does not show.
