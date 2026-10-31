---
title: 'Epic 8 retro A5: diagnostics polish'
type: 'bugfix'
created: '2026-10-31'
status: 'done'
route: 'oneshot'
baseline_commit: '1cf8eac2e57bc94e9c1cbdcec1bcdd91700a1124'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three small Epic 8 leftovers (retro X3, X4 and the A1-arch finding; `epic-8-retro-item-43`):
- the main video's engine error never reaches the log, so the diagnostics file has no engine code at all for a video failure;
- the 8.2 fallback notice «Внешний плеер не найден» stays on every overlay show for the whole visit;
- `logFileSink` subscribes to `AppState` directly instead of through the `appLifecycle` port.

**Approach:**
- `usePlaybackSession.onError` takes the engine's safe short code (already reduced by `PlayerEngineView`) and logs it as `{ error }` on both failure lines.
- `PlayerScreen` drops the notice once the overlay that showed it hides while the video plays.
- `createLogFileSink` takes `subscribeBackground` (default `subscribeAppBackground`) in place of `appState`.
- Docs follow: PLAY-13, `docs/testing.md` Story 8.2, and the AD-2 exception note.

</frozen-after-approval>

## Implementation Notes

- `src/features/player/usePlaybackSession.ts`: `onError(code?)`; `{ error: code ?? 'none' }` on «playback failed; recovering» and «… again; waiting for the user». The key `error` survives redaction (`loggerFieldKeys.test.js` green). The code is `PlayerEngineView`'s short `SHORT_CODE` value or null, never a URL.
- `src/features/player/PlayerScreen.tsx`: `noticeOverlayOpen` / `noticeDone`. The notice is dropped when the overlay that showed it hides while `playing` (the auto-hide or Back). A hide by an error, a recovery or leaving playback resets the open flag, so the next show of a playing video counts again. That case is host-untested: the harness could not show the overlay again after a recovery.
- `src/shared/services/logFileSink.ts`: `subscribeBackground` option, no `react-native` import; the test fakes the port.
- Tests:
  - `externalPlayerFlow` «No player»: after the auto-hide (`OVERLAY_HIDE_MS`), ↑ shows the overlay with no notice. Mutation check: with the notice always passed, the two «No player» cases fail directly, and five later tests in the file fail from the leaked root.
  - `playerRecoveryFlow` «Expired URL»: the line carries `{ error: 'http' }`.
  - `logFileSink.test.ts`: the background flush goes through the fake port.
- The sink's background flush now uses `subscribeAppBackground`. It snapshots `AppState.currentState` at `enable()` and fires on a transition to `background`, so a repeated `background` event no longer flushes twice, and capture enabled while already in the background flushes on the next transition. The `inactive`-does-not-flush rule is covered by `appLifecycle.test.ts`.
- The engine code limit: `PlayerEngineView` reduces the error to a short code or null, and `none` covers both "no code" and "a code not safe to log". Codes such as `22004` do not carry the HTTP status.
- Checks: lint `--max-warnings 0` and typecheck clean; `npm test` ×3: 3104 passed after the review patch; the touched suites ×30: 0 failed runs (65 each). No device check: the fallback path needs a TV with no real player, and the log code is host-tested.

## Review Triage Log

Blind Hunter (1 layer):

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | The notice drops on any hide (Back, background, error or recovery), not only the first auto-hide | medium | patched: dropped only on a hide while playing; a non-playing hide resets the open flag |
| 2 | Only the auto-hide path is tested | low | Tried a recovery test; the harness could not re-show the overlay after recovery. Recorded as host-untested |
| 3 | Other fallback paths do not assert that the notice goes | low | They share the same PlayerScreen path; rejected |
| 4 | The mutation claim is not explained | low | Re-run: 2 direct failures plus 5 cascade; recorded |
| 5 | Hardcoded `advance(6000)` | low | patched: `OVERLAY_HIDE_MS + 100` |
| 6 | `none` hides "code dropped for safety" | low | A port contract change; rejected, documented |
| 7 | The spec overstated decoder vs expired URL | low | patched (claim softened, limit in SET-05) |
| 8 | No tests for the "again" line, null → `none`, an overlong code | low | One assertion pins the field; rejected |
| 9 | The sink's background flush semantics changed silently | low | Documented above |
| 10 | SET-05/PLAY-10/testing docs miss the error code | low | patched (SET-05) |
| 11 | The spec lacked checks and device status | low | patched |

