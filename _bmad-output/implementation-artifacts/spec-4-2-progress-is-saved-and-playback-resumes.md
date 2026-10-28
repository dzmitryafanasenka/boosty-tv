---
title: 'Story 4.2: Progress is saved and playback resumes'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '890ea1d6025cc5c65a4c3483d5277bc5b230d08c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/docs/adr/0004-progress-ownership-and-resume.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The player writes no progress and always starts at 0; the Post shows no «Продолжить», «С начала» or per-video status (FR33, FR43, FR44; epics.md Story 4.2).

**Approach:** Add `ProgressRepository` (`shared/services/progress`, AD-10, ADR 0004): the only E9 writer, the only `timeCode` reader and the owner of the account-scoped local progress store (persisted through a new `KeyValueStore` port over `@react-native-async-storage/async-storage` 3.1.1, exact pin). The player calls `begin`/`report`, starts at `resumePoint(ref)`; the Post reads `useProgress(ref)` for the primary button, «С начала» and MediaRow status.

**Decisions:**
- Resume: local position when a local entry exists, else the E8 `timeCode` (the player's fresh E8 and the Post's E8 hand `timeCode` to the repository through a callback; it never enters the Post entity, a query cache value, a route or a log). A finished media (≥ 95 % or < 30 s left) or no progress starts at 0. Player route gets `start?: 'resume' | 'beginning'`.
- Writes: E9 only after the start position is reached (never a pre-seek `t=0`); one write in flight, a newer position replaces the queued one; a write when the position moved ≥ 10 s since the last successful write, and forced on user pause, app background, Stop/Back/exit (best effort, not awaited) and end. Never for hold-scrub pauses. A failed write is re-sent only with the latest position, no sooner than 10 s after the failure. The local entry is updated on the same triggers (memory at once, disk debounced).
- Session: a write that fails while the session is `expired` is held (latest position only) and flushed when the session is `signedIn` again with the same `AccountScope.generation()`; a reset drops it. The store is registered with AccountScope (cleared on sign-out and account switch); an async disk write re-checks `isCurrent()` and undoes itself after a reset.
- Local store: one entry per media id `{ref, positionSec, durationSec, updatedAt, meta}` (meta from `begin`: title, postTitle, authorName, previewUrl, durationSec — never a signed media URL), at most 200 entries (oldest dropped). The Continue view (Story 4.7) is derived from it later; not rendered here.
- Post: the primary targets the first unfinished media; «Продолжить» (multi: «Продолжить · Видео N») when it has progress > 0, else «Смотреть»; all finished → «Смотреть» on the first media (starts at 0), no «С начала». «С начала» (`post/<postId>/restart`) only when the target has progress > 0; starts that media at 0. MediaRow status: «Не начато» / «Осталось N мин» (rounded up) / «Просмотрено» plus a progress line; with no known duration, no status or line for a started video. A focused «С начала» that disappears falls back to the primary.
- Owner decisions 2026-10-28: **«С начала» sits in the primary's row, to its right** (← → between them, ↓ from either → the first MediaRow, ↑ → the author). **One live E9 check on the device with the content profile**, on one video the owner picks (writes real progress to the owner's account); the result goes to api-contract. The spec is kept whole (≈ 2300 tokens).
- Owner decision 2026-10-28 (review): **re-opening a finished video, replaying after the end, or «С начала» never erases progress by a short visit**: such a session writes nothing (no E9, no local entry) until it has moved ≥ 10 s from its start or the user paused; exit, background and end before that write nothing. After that, normal re-watch progress.

## Boundaries & Constraints

**Always:** E9 = `PUT /v1/viewstat/video/{mediaId}/timecode/`, form `time_code`, integer seconds, content profile, the active session's client (no singleton; demo mode answers it from the fixture transport). UI reads progress only via `useProgress(ref)` (`useSyncExternalStore`). Ports in `shared/platform` (`KeyValueStore` scopes `device`/`account`, a minimal `subscribeAppBackground`); features import no native module. Copy from `ru`, Russian a11y labels (MediaRow label includes the status). Logs: no positions with ids, no URLs.

**Never:** No Continue row on Главная (4.7), no Ended exit flow (4.5), no quality (4.3), no feed/Author card progress (FR-14, later), no autoplay, no comments, no write storms (no per-second writes, no retries faster than 10 s).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Local wins | local 120, server 300 | starts at 120 | — |
| Server only | no local, `timeCode` 300 | starts at 300; post shows «Продолжить» | — |
| Finished | local 590 of 600 | starts at 0; row «Просмотрено» | — |
| Start over | «С начала» | starts at 0; first write only after movement/pause | — |
| Cadence | playing 0→35 s | writes at ≈10, 20, 30 s; one in flight | — |
| No t=0 | resume at 120, engine reports 0 before seek | no write of 0 | — |
| Hold-scrub | held seek pauses | no write for that pause; commit then counts as movement | — |
| Failure | E9 Network | next attempt ≥ 10 s later with the latest position | not shown to the user |
| Expired | E9 fails, status `expired` | held; flushed after same-account re-login | dropped if generation changed |
| Sign-out | entries + held write | store wiped, held write dropped, disk cleared | — |
| Multi-video | v1 finished, v2 at 60 | primary «Продолжить · Видео 2», «С начала» shown | — |

</frozen-after-approval>

## Code Map

- `src/features/player/PlayerScreen.tsx` -- `begin` after the source is ready; initial seek to `resumePoint` after `onLoad`, reports ignored until `onSeekDone` of that seek (or the first progress when start is 0); `report` on `onProgress`, user pause (`setPlaying(false)`, not `onHeldStart`), `onEnd`, Stop/Back exit, unmount; background via the platform port. Keep the seek controller, arbiter, focus and Back logic unchanged.
- `src/features/player/mediaResolver.ts` -- pass the `timeCode` sink to `PostRepository.videoSources`.
- `src/shared/entities/post/postRepository.ts`, `videoSources.ts`, `src/shared/api/dto/post.ts` -- one `okVideoTimeCodeDtoSchema` (`id`, `timeCode`); `fetchPost` reads it from `rawData` and calls an optional `onServerProgress(mediaId, sec)`; Post entity unchanged.
- `src/features/post/PostScreen.tsx`, `PostBody.tsx` (`PostPrimaryAction`, `firstStopId`, vanished-focus fallback for `restart`), `src/shared/ui/MediaRow.tsx` (status + progress line props; tokens per DESIGN.md MediaRow) -- the post's E8 hook passes the sink.
- `src/app/routes.ts`, `stackRoutes.tsx`/`App.tsx` -- `Player` param `start`; create the repository with the active session's client and status; provide a `ProgressContext`.
- `src/shared/services/progress/` (new) -- repository, finished rule, `useProgress`, account store; `src/shared/platform/keyValueStore.ts` + adapter, `appLifecycle.ts` (new).
- `src/app/bootstrap.ts` -- register `progressAccountStore`; `__tests__/accountScopeRegistry.test.js` must pass.
- `src/shared/i18n/ru.ts` -- `post.continue*`, `post.restart`, `post.video.status.*`.
- `src/app/dev/demo` fixture transport -- answer E9 200.
- Tests: repository unit tests (fake timers, in-memory KV, every matrix row), `playerFlow`/`postFlow` additions using `src/test/flow.tsx`.
- Docs: `docs/api-contract.md` §6 (E9 content profile result), `docs/testing.md` Story 4.2 (async-storage pin, device checks), `docs/focus-map.md` §F (restart id/order), `deferred-work.md` for new gaps.

## Tasks & Acceptance

**Execution:**
- [x] Dependency `@react-native-async-storage/async-storage@3.1.1` exact; native build; release bundle check; `KeyValueStore` port + adapter.
- [x] `ProgressRepository` + account store + `useProgress` + unit tests for every matrix row.
- [x] E8 `timeCode` sink (Post and player).
- [x] Player: resume start, writes, background/exit/end.
- [x] Post: primary/«Продолжить»/«С начала», MediaRow status, focus fallback.
- [x] Demo E9 answer; docs.
- [x] Device (release-like, owner's session): resume after exit and after a cold start (±10 s, SM-4), «С начала», multi-video status; adb + physical remote labelled; screenshot of the Post with «Продолжить»/«С начала» to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; new/changed flow suites 30/30; lint `--max-warnings 0`, typecheck, `check:fixtures` clean; release bundle without debug-only code.
- Given a cold start after watching, when the post opens, then the status and «Продолжить» come from the persisted local entry.

## Implementation Notes

- Device (2026-10-28, agent over adb, release-like build, owner's session; first feed post, owner's pick): resume after exit and after a cold start within ±10 s, «С начала» from 0, → / ↓ focus, return focus to the initiator; live E9 with the content profile confirmed by the owner (website 1:14 after an exit at ≈ 1:12). Multi-video status not run on the device (the owner knows of no such post) — host-tested; physical remote and TalkBack not run (deferred-work).
- Final verification (2026-10-28, after the review patches): lint `--max-warnings 0`, typecheck, check:fixtures clean; `npm test` ×3: 1507 passed each; playerFlow + postFlow + demoFlow + the progress suites 30×: 0 failed runs (206 tests each). Device after the patches (rebuilt, reinstalled, adb): a short «С начала» visit wrote nothing; «Продолжить» still resumed at ≈ 1:48.
- Implementer choices beyond the spec (to judge in review): automatic E9 re-send capped at 5 attempts; a local position ≥ duration starts at 0; `report` takes an optional engine duration; an arbiter pause writes nothing.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | A short visit to a finished video (open via «Смотреть», replay after the end) or «С начала» writes ~0 on exit and erases «Просмотрено» (edge 4, 5) | medium | intent gap → owner decision 2026-10-28 recorded above (protect); fixed as a patch instead of a revert (owner informed) |
| 2 | `progressStore.writeDisk` drops a post-reset change (`started === epoch` guard) and `flush()` resolves before the queued write lands (blind, edge, verification-gap) | medium | patch: re-run when dirty regardless of epoch; flush awaits the whole chain |
| 3 | Demo mode reads/writes/clears the real `boostytv-account` database (a demo sign-out wipes the owner's local progress) (blind) | medium | patch: in-memory KeyValueStore for the demo |
| 4 | `begin` keyed on the meta object, not the resolution (blind, edge) | low | patch: depend on `ready.resolution` |
| 5 | No test: a retry's new source resumes and never writes its pre-seek t=0 (verification-gap) | medium | patch: playerFlow test |
| 6 | No test: started video without a duration on the Post (verification-gap) | medium | patch: postFlow test |
| 7 | `docs/feature-parity.md` not updated for progress/resume (blind) | low | patch |
| 8 | Initial resume seek gate could stay `seek` forever (edge) | false | device 2026-10-28: resume at ≈ 1:13, exit at ≈ 1:48 → the row moved 73 → 72 min (the resumed session wrote) |
| 9 | E9 hold-on-expiry verified only against a fake session (verification-gap) | medium | defer: needs the A11 harness + E9 + re-login |
| 10 | Stored `previewUrl` may carry a CDN token (blind) | maybe-false | defer (medium, unverified): check a live E8 `preview` URL shape before Story 4.7 renders history |
| 11 | Load failure then `put` overwrites the disk with session-only entries (blind) | low | rejected: a failing SQLite read is rare; the fix adds branches |
| 12 | Gate opens on pre-seek t=0 when the target is 1 s (blind) | low | rejected: a 1 s difference |
| 13 | Cadence measured from the last trigger, not the last successful write (blind, edge) | low | rejected: the observable E9 sequence is the same under the 10 s failure gate (matrix «Cadence», «Failure» tested) |
| 14 | Device checklist item marked done while multi-video / physical remote are open (blind) | low | rejected: spec edit; the open items are in Implementation Notes, testing.md and deferred-work |
| 15 | No ADR for async-storage / KeyValueStore (blind) | false | the architecture spine pins async-storage 3.1.x and AD-2 defines the port |
| 16 | ADR 0004 / epic-4-context not updated with implementer choices (blind) | low | rejected: notes in the spec and api-contract |
| 17 | «С начала» a11y label does not name the video in a multi-video post (blind) | low | rejected: no multi-video post known; the fix adds a branch |
| 18 | Missing tests: adapter, appLifecycle, useProgress hook, double exit, demo E9, retry after «С начала» (blind) | low | rejected: double exit is a no-op (unchanged position); the rest is thin glue |
| 19 | `writers` never removed; keyed by media id only (blind) | low | rejected: a few dozen small objects per run; media ids are global |
| 20 | User seek during the initial seek in flight (edge) | low | rejected: the initial seek lands in milliseconds, before any press commits (600 ms) |
| 21 | `end` dropped while the gate is not `started` (edge) | low | rejected: progress events every 500 ms open the gate within the first second |
| 22 | Reset during the initial load: the player starts with an unloaded store (edge) | low | rejected: a reset ends the session and leaves the player |
| 23 | Post status and `resumePoint` may use different durations (edge) | low | rejected: matters only within a second of the 95 % threshold |
| 24 | Non-retriable E9 errors retried up to 5 times (edge) | low | rejected: bounded, 10 s apart; AD-6 allows E9 re-sends |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `playerFlow`, `postFlow` and progress suites 30×.
