---
title: 'Story 4.4: Recover from expired links and playback errors'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '7660249075de74ac6f2e8ea1af3c8cf55abce989'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Any engine error (an expired 24 h signed URL after a long pause, a CDN or decoder failure) drops straight to «Не удалось воспроизвести видео»; «Повторить» restarts from the lagging resume point, and a chosen quality the decoder cannot play fails forever in this run (FR48, PLAY-10; epics.md Story 4.4; deferred-work).

**Approach:** On the first engine error the player shows «Восстанавливаем воспроизведение…», sends one fresh E8 through `MediaResolver` (content profile), finds the same media by id, keeps the same quality (else the default order) and resumes at the current second. A failed recovery or a second error shows the error state with «Повторить» focused.

**Decisions:**
- Budget: one automatic recovery per error episode; the budget comes back after the recovered source has played 30 s. An error before the first `onLoad` (a start failure) counts too.
- Position: the current position, or a pending seek target, or the pending start (resume point / «С начала» 0) when the error came before the start was reached; through the existing start gate (no t=0). Progress: the session continues (no `begin`, the short-visit rule is not restarted); no E9 is written for the error itself.
- Quality: the same quality key (`auto` or the height) when the fresh E8 has it; otherwise the default order (HLS, else DASH, else the nearest progressive ≤ 1080p). The preference is not changed.
- After a failed recovery, «Повторить» (a manual retry: one fresh E8) plays the default order when the failed source had been chosen by a non-`auto` quality (the in-memory choice for this run becomes `auto`; the stored value is not changed), otherwise the same rules as recovery; it resumes at the same position.
- Fresh E8 results during recovery: ok → play; `locked` → the SessionCheck port first (Epic 3 retro A6), then (owner decision 2026-10-28) the player exits to the Post at once: the Post's E8 query is invalidated, it refetches and shows its own locked notice, focus on the author (the video row is gone); `unavailable` → «Видео недоступно» + «Назад»; E8 failure → the error state.
- «Восстанавливаем воспроизведение…» has no focusable action (focus on the surface); Back exits the player (with the usual exit report); the overlay and the settings sheet close; remote keys other than Back are ignored.

## Boundaries & Constraints

**Always:** Signed URLs memory-only; no headers to the CDN; the fresh E8 only through `PostRepository.videoSources` (content profile); 403/locked is never treated as an expired token without the SessionCheck; copy from `ru`; logs carry no URL, ids or positions.

**Never:** No retry loops (at most one automatic E8 per episode, then the user decides); no background-wake handling (Story 4.6); no Ended flow (4.5); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Expired URL | playing at 5:12, engine error | «Восстанавливаем…», one E8, new engine seeks 312, plays | — |
| Integration | FixtureTransport: source 1 fails, the fresh E8's source loads | exactly one automatic recovery, position kept | — |
| Second error | recovered source errors within 30 s | error state, focus «Повторить»; no more E8 | — |
| Budget back | recovered source plays 30 s, then errors | one more automatic recovery | — |
| Recovery E8 fails | Network on the fresh E8 | error state «Повторить»/«Назад» | «Повторить» → one E8 |
| Same quality | 720p chosen, fresh E8 has 720p | plays 720p | — |
| Quality gone | 720p chosen, fresh E8 has no 720p | default order | preference kept |
| Bad pick | 1440p picked, fails, recovery fails | error; «Повторить» → default order, in-memory `auto` | stored value unchanged |
| Start failure | error before the first `onLoad` | recovery to the pending start (resume point) | — |
| Unavailable | fresh E8 404 / video gone | «Видео недоступно» + «Назад» | no retry |
| No access | fresh E8 locked, session ok | exit to the Post; Post refetches, locked notice, focus author | no retry |
| Back while recovering | Back | exits the player, exit report | — |

</frozen-after-approval>

## Code Map

- `src/features/player/PlayerScreen.tsx` -- a `recovering` phase; `onError` → recovery when the budget allows (else the error state); the explicit start target through the start gate (as `pickQuality` does); no `progress.begin` on a recovery resolution (`begin` is keyed on `ready.resolution` today: keep one progress session per player opening); budget reset after 30 s of playback; Back while recovering exits; keys ignored; sheet closed (existing).
- `src/features/player/mediaResolver.ts` -- `retry()` is the one fresh E8; picking with the quality key (`pickSource(sources, {preference})`, `qualityOf`) and the default-order fallback; expose which source was chosen by a non-`auto` preference.
- `src/features/player/qualityPreference.ts` -- `remember('auto')` for the in-memory fallback; never writes the store here.
- `src/app/stackRoutes.tsx` / Post refetch -- the no-access exit: pop to the Post and invalidate `queryKeys.post` so it refetches (focus on the author via the Post's vanished-focus fallback).
- `src/shared/i18n/ru.ts` -- `player.recovering`.
- Tests: `__tests__/playerFlow.test.tsx` (every matrix row; the integration row with FixtureTransport answering two E8s), unit tests where logic is pure (target selection, fallback pick).
- Docs: `docs/focus-map.md` G Recovering row and notes, `docs/feature-parity.md` PLAY-10, `docs/testing.md` Story 4.4 (incl. how the expired-URL path was or was not provoked on the device), `deferred-work.md`.

## Tasks & Acceptance

**Execution:**
- [x] Resolver: quality-keyed pick with fallback; retry semantics.
- [x] Player: recovering phase, budget, target, progress continuity, Back, keys; manual retry fallback after a bad pick.
- [x] No-access path: exit to the Post, refetch, locked notice.
- [x] Tests (matrix + FixtureTransport integration); docs.
- [x] Device (release-like, owner's session): provoke an engine error (e.g. adb network toggle or a debug-only source corruption — debug build only, never in release) and observe one recovery at the same second; the error state after a second failure; screenshot of «Восстанавливаем…» to the owner before the review loop. A real 24 h expiry is not waited for (record as unverified).

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new/changed flow suites 30/30; lint `--max-warnings 0`, typecheck, `check:fixtures` clean; release bundle without debug-only code.

## Implementation Notes

- Final verification (2026-10-28, after the review patches): lint `--max-warnings 0`, typecheck, check:fixtures clean; `npm test` ×3: 1593 passed each; playerFlow + player suites 30×: 0 failed runs. Device (debug build with Metro, adb + logcat + screencap): the debug trigger «Сломать следующую ссылку видео» (host `boostytv-debug-broken.invalid`; an extra path segment was still served by the CDN) → `UnknownHostException` → «Восстанавливаем воспроизведение…» (kept until the start position, screenshot shown to the owner) → one fresh E8 → playback at the resume point with audio. Not on the device: an error mid-playback, the second error, Back while recovering, the no-access exit, a real 24 h expiry. The release-like build was reinstalled afterwards.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | «Восстанавливаем…» disappears when the fresh E8 lands (≈ 0.5 s on the device), the spinner shows until the new source starts; the flow test pins that (blind; coordinator device run) | medium | patch: keep the copy until the recovered source's start gate is `started` or an error |
| 2 | An error while paused (the typical expired-URL case after a long pause) resumes playing after the recovery: the resolution effect sets `paused` false (blind) | medium | patch: a recovery keeps the paused state |
| 3 | Locked branch where the post-E1 refetch fails is not tested in a recovery (verification-gap) | medium | patch: test |
| 4 | Locked after a manual «Повторить», session check pending: the generic error with an active «Повторить» shows (edge 4) | low | patch: «Повторить» busy while the locked answer is unconfirmed |
| 5 | «Восстанавливаем…» not announced by TalkBack (blind) | low | patch: `accessibilityLiveRegion="polite"` |
| 6 | Docs: testing.md status line and deferred-work say no device run; the break mechanism described as a path segment (also a test comment); releaseBundle marker without a debug control (blind, verification-gap) | low | patch: docs/test comment/marker |
| 7 | Session check `expired` during recovery leaves the player on «Восстанавливаем…» under A11 (blind) | false | `expired` resets the stack to `[Expired]` (`navigationRef.reset`, App.tsx), the player unmounts |
| 8 | `confirmed` on a failed refetch exits to Post on a network error (blind, edge 3) | false | intended (Epic 3 retro A6): after E1 ok a failed refetch keeps the locked answer; the locked data came from a valid-session E8 |
| 9 | Engine error code ignored: a decoder failure spends the recovery on the same quality (blind) | low | rejected: the spec keeps the quality; the manual retry then falls back to the default order |
| 10 | The in-memory `auto` after a failed non-auto source applies for the whole run (blind) | low | rejected: spec decision (owner-approved); stored value unchanged |
| 11 | Side effects during render (`everReady`, debug `isBroken`) (blind) | low | rejected: no observed double-render issue; debug-only for the flag |
| 12 | No-access exit dropped when the route is not focused; `goBack` assumes Post (blind, edge 1, 2, 7) | low | rejected: the player is the focused route while recovering (the sheet closes on error); Story 4.7 revisits the origin |
| 13 | Budget-back test counts E8 across two opens (blind) | low | rejected: deterministic fixtures |
| 14 | Recovery target ignores a user seek pending during the initial start gate (edge 5) | low | rejected: the initial seek lasts milliseconds |
| 15 | Debug break also breaks a quality switch on that resolution (edge 6) | low | rejected: debug-only |
| 16 | Spec/sprint status mismatch, empty notes (blind) | low | rejected: step 5 syncs the statuses; notes filled at completion |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `playerFlow` and the player suites 30×.
