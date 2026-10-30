---
title: 'Story 7.1: Live stream card on the author page'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2ab2d0e199004f298dc46931bde2ace819170cbb'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Author page does not show that an author is streaming or has a stream scheduled (LIVE-01, FR21), so the family misses live broadcasts.

**Approach:**
- A new `entities/stream` reads E15 (`['stream', blogUrl]`). A 204 means there is no stream.
- Behind a new `live` phase flag, the Author page shows a LiveCard between the action row and the post grid. It has three states: live, scheduled, and needs a level.
- Initial focus goes to the card when the stream is live. When the card goes away, focus falls back to the first post.
- Watching is Story 7.2; like and share are Story 7.4.

**Owner decisions (2026-10-30):**
- **Q1 a.** E15 is refetched every 30 s while the page is focused, for both a live and a scheduled stream, so an ended stream's card disappears within 30 s.
- **Q2 b.** OK on the LiveCard does nothing in 7.1. The card is a focus stop; Story 7.2 adds watching and the QR fallback.
- **Q3 a.** The `live` flag ships on (`true`).

## Boundaries & Constraints

**Always:**
- Parse E15 defensively. A malformed 200 means no card plus a counts-only warning, never a crash.
- `hasAccess: false` is not an error and not a session problem.
- Show the level name only, never a price.
- The live, scheduled and needs-level wording follows UX-DR8, with Russian copy in `ru.ts`.
- Use the existing tokens (`components['live-card']`, `colors.live`, `focus['scale-live-card']`).
- A refetch never moves focus, except when the card disappears while focused.
- The card adds no new code to the outcome machinery: search and filter outcomes work as before.

**Never:**
- No E15 calls from Главная, Подписки or Поиск.
- No heartbeat, like, share or player route.
- No logging of a stream URL, `signedQuery`, token or title (counts and booleans only).
- No `events` flag change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No stream | E15 204 | No card. Layout and focus exactly as today | — |
| Live | 200, `isOnline: true` | Card: LIVE badge (`colors.live`), title, viewers and likes (`formatCount`), cover. Initial focus on the card | — |
| Scheduled | 200, `isTemplate: true`, not online | Card: «Запланирован» with the start date and time, no viewer count | — |
| Polling | a card is shown (live or scheduled) and the page is focused | E15 refetched every 30 s; it stops on blur and unmount | a failed poll keeps the last card |
| Needs level | 200, `hasAccess: false` | Card with the level name («Нужен уровень «X»»), no price | — |
| Malformed | 200, missing `id` or unknown types | No card | counts-only warn |
| E15 fails | network / 5xx / 401 on the first load | No card; the page works as with no stream | no retry, no error UI |
| Stream ends | the card was shown, a refetch returns 204 | The card goes away. If it was focused, focus goes to the first post (`restoration.focusInitial`) | — |
| Flag off | `live: false` | No E15 request, no card | — |
| OK on the card | focus on the card | Nothing happens (no route, no request) | — |

</frozen-after-approval>

## Code Map

- `src/shared/entities/poll/` -- pattern to copy: repository (path built after a `blogUrlSchema` check, else `AppError('Client')`), defensive mapper returning null, `index.ts`, tests with `createFixtureTransport`.
- `src/shared/api/httpClient.ts:100,229-238` -- any 2xx passes. A schema with an empty body throws `Parse`, so E15 must call `http.get(path)` with no schema, treat 204 or a null/undefined body as no stream, then map.
- `src/test/fixtures/boosty/e15-video-stream-{1,2}.json` -- existing 204 fixtures. Rules for a new synthetic 200 file are in `scripts/check-fixtures.mjs`:
  - URLs: `https://example.invalid/...?sig=REDACTED`;
  - ids: 1001–9999;
  - `startTime`: 1_700_000_000 + n·3600;
  - other numbers: 0 or 5;
  - strings: `redacted` / `synthetic-*`.
- `src/shared/api/queryKeys.ts` -- add `stream(blogUrl)`. The whole cache is account-scoped (`src/app/queryClient.ts:50`), so no registration is needed.
- `src/app/phaseFlags.ts:22` and `src/app/__tests__/phaseFlags.test.ts` -- add `live` (a capability, not a section). `src/app/stackRoutes.tsx:291` passes `liveEnabled` like `searchEnabled`.
- `src/app/App.tsx:371-384` -- the resume refresh: also invalidate the observed `['stream']` queries.
- `src/features/author/AuthorScreen.tsx`:
  - the card slot is between the action row (469-488) and `AuthorListState` (489);
  - `listHeight` (210-215) subtracts the card's height and gap when the card is shown;
  - the grid-phase focus (`usePhaseChange` 360-391) runs `latch.auto(liveId)` before `restoreOrFirst`;
  - card loss copies the `contentLost` pattern (366-370).
  - Keep AuthorScreen small: put the card in `LiveCard.tsx` and its data and focus glue in `useAuthorLive.ts`.
- `src/features/author/useAuthorAutoFocus.ts`:
  - `canFocus` (163-179) allows the live id;
  - `focusAbove`/`focusAfterLoss` (140-158) prefer the card when it is shown.
- `src/features/author/useAuthorActionRowFocus.ts` and the grid guide (`AuthorScreen` 430-444, 504-507) -- ↓ from the row goes to the card when it is shown, ↓ from the card goes to the grid, and ↑ from the first grid row goes to the card.
- `src/features/author/authorIds.ts` -- `authorLiveId(blogUrl)` = `author/<blogUrl>/live`.
- `src/shared/ui/PostCard.tsx:170-280`, `FocusableSurface.tsx:94` -- card, ring, scale, badge and image placeholder patterns.
- `src/shared/i18n/format.ts:107` `formatCount`; `ru.ts` `author` section (219-247) -- add `author.live.*`.
- `src/app/dev/demo.ts:486-489,611` -- add `DEMO_STREAM_PATH`: 200 for one demo blog, 204 for the rest.
- `__tests__/authorFlow.test.tsx:152-175` -- **add a default E15 → 204 handler** (an unmatched path is a Network failure); `src/test/authorFixtures.ts` gets `e15Path`.

## Tasks & Acceptance

**Execution:**
- [x] Live probe (device, debug build, temporary counts-only `__DEV__` probe, removed before the commit) -- E15 for every subscribed blog. Record the status counts and, if any 200 appears, its key set and types (never values) in `docs/api-contract.md` «E15 (LIVE)». -- check the shape before building UI.
- [x] `src/shared/entities/stream/{streamRepository,mapStream,index}.ts` + tests + `src/test/fixtures/boosty/e15-video-stream-live.json`, `-scheduled.json`, `-locked.json` (synthetic, labelled) -- the `Stream` domain type `{id, title, status: 'live'|'scheduled', hasAccess, startTime, viewers, likes, coverUrl|null, levelName|null}`; every matrix row for 204, malformed and failure.
- [x] `src/shared/api/queryKeys.ts`, `src/app/phaseFlags.ts` (+ test), `src/app/stackRoutes.tsx`, `src/app/App.tsx` -- the key, the flag (on), the prop, and the resume invalidation.
- [x] `src/features/author/useAuthorLive.ts`, `LiveCard.tsx`, `authorIds.ts`, `AuthorScreen.tsx`, `useAuthorAutoFocus.ts`, `useAuthorActionRowFocus.ts` -- the query (30 s polling while focused and a card is shown), the card states, the focus rules, and `listHeight`.
- [x] `src/shared/i18n/ru.ts` -- the card copy (LIVE, «Запланирован …», viewers/likes plurals, «Нужен уровень «…»», a11y label).
- [x] `src/app/dev/demo.ts` + `__tests__/demoFlow.test.tsx` -- a live stream on one demo blog.
- [x] `__tests__/authorFlow.test.tsx` -- «Story 7.1» block, one test per matrix row: initial focus, ↑/↓ transitions, the ring with no reflow, card loss → first post, 30 s polling with fake timers (stops on blur; a failed poll keeps the card), OK inert, flag off → no E15. Existing tests pass with the default 204.
- [x] Docs: `docs/api-contract.md`, `docs/feature-parity.md` (LIVE-01 Android status), `docs/focus-map.md` (Author section D), `docs/testing.md`.

**Acceptance Criteria:**
- Given the Author page, when E15 answers, then a 204 shows no card and a 200 shows a card in exactly one of the live, scheduled or needs-level states.
- Given a live stream, when the page opens, then focus is on the LiveCard, and ↓ reaches the first post.
- Given the card is shown, when a refresh finds no stream, then the card is gone, and if it had focus, the first post is focused.
- Given lint, typecheck, `check:fixtures` and `npm test` ×3, when run, then all are clean; the touched suites pass ×30.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean
- `npm test` ×3 -- expected: all pass
- `authorFlow`, `demoFlow`, `src/shared/entities/stream`, `phaseFlags` ×30 -- expected: 0 failed runs

**Manual checks:**
- Device (release-like build, agent over adb): an author with no stream shows no card and unchanged focus. A live or scheduled stream exists only if the probe finds one; otherwise the card is checked in the demo debug build, and the report says so.

## Implementation Notes

- **Live probe (2026-10-30):** debug APK + Metro + a temporary counts-only `__DEV__` probe (`TEMP71`, removed; release bundle `TEMP71` 0): 3 subscribed blogs, 3 × E15 204 with an empty body. No 200 was seen, so the 200 shape stays `REF`; recorded in `docs/api-contract.md` «E15 (LIVE)». The UI was built from the reference field list and the synthetic fixtures.
- **Entity:** `src/shared/entities/stream/` (`StreamRepository.fetchActive`, `mapStream`, `streamPath`, types) and the lenient DTO `src/shared/api/dto/stream.ts`. E15 goes through `http.request({ path, retry: false })` (no schema; 204 or an empty body → null). "No retry" from the matrix is read as no AD-6 retry and no query-level retry: one request per load/poll.
- **Malformed:** "missing `id` or unknown types" is read as: `id` missing/empty/non-finite, or `isOnline` / `hasAccess` missing or not booleans. Those three are required; every other field falls back. A stream that is neither online nor `isTemplate` is also no card (warned with the two booleans only). Warnings carry counts and booleans only.
- **States:** exactly one per card: `hasAccess: false` → needs level (either status; the badge still says LIVE / «Запланирован», the counts line is replaced by «Нужен уровень «X»», or «Нет доступа» with no level name); else live or scheduled. Scheduled shows «Начало {when}» (`formatStreamStart`: «сегодня в 19:00», «завтра в …», «12 окт в …») and the likes only. Every state is a focus stop; only a live stream takes initial focus (the design's "scheduled card not focusable" note is superseded by the spec's ↓-from-the-row rule).
- **Cover:** the first `teaser[]` image `url`, else a `data[]` block's `preview` / `defaultPreview` (http(s) only). Which field the reference card shows is not verified.
- **Polling:** `refetchInterval` returns 30 s only while `useIsFocused()` and the cached data is a stream; TanStack keeps the last data on a failed poll. The resume refresh in `App.tsx` invalidates `queryKeys.allStreams()` (observed queries only).
- **Focus:** the card is a content zone item inside its own guide (`author/live/guide`, destination = the card) between the action row and the grid. The grid guide's destination is set while the card has focus (or the row has focus with no card). `useAuthorAutoFocus` gained `autoFocusLive`; `focusAbove` / `focusAfterLoss` prefer the card; `canFocus` allows the live id. Initial focus: the grid-phase rule picks the card while live, and `useAuthorLiveFocus` decides once on the first E15 answer (a stream appearing on a later refetch never takes focus). Head refresh does not follow the head while a card is shown. Card loss while focused → `restoration.focusInitial()`; covered → handled on return.
- **Device lesson (demo debug build):** the first run left focus on the sidebar item: E15 and E4 answered together and the card's focus request went to a view mounted in the same commit (no layout yet). `autoFocusLive` now repeats the request two frames later while focus is still the page's own (or none) and no modal is open; host-tested, re-checked on the device.
- **Demo:** `DEMO_STREAM_PATH` — `demo-blog-1` live (no URLs, no level), other demo blogs 204.
- **Tests:** `streamRepository.test.ts` (27), `format.test.ts` «formatStreamStart», `phaseFlags.test.ts`, `authorFlow.test.tsx` «Story 7.1» (19) with a default E15 → 204 handler, `demoFlow.test.tsx` (1), `subscriptionsFlow.test.tsx` (the tile → Автор call list now includes E15).
- **Checks run:** lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; `npm test` ×3: 109 suites, 2390 passed each; touched suites (`authorFlow`, `demoFlow`, `src/shared/entities/stream`, `phaseFlags`; 160 tests per run) ×30: 0 failed runs.
- **Device:** release-like build, a real author with no stream: no card, focus on the first post, ↑ field / ↓ first post, Back → tile. Demo debug build: the live card, initial focus, ↓ / ↑ / ← / → moves, OK inert, return from Пост. Not checked on the device: a real live/scheduled stream (none running), polling, card loss, the physical remote, TalkBack.

- **Review follow-ups (2026-10-30, host-tested only):** polling also requires the app in the foreground (`isAppActive` + background/foreground subscriptions in `useAuthorLiveStream`); `staleTime: 0` so every open sends E15, and `answered` / the grid's live check wait for this page's own answer (`isFetchedAfterMount`); card loss decides "had focus" in the render where the stream turns null; head-follow suppressed only when the focused id is the card; LiveCard role `summary` (not a button) while OK is inert; `startTime` only as seconds (< 1e11); the ended-stream log at info. New tests: `LiveCard.test.tsx` (7), authorFlow (+6, incl. 2 resume rows), mapper rows, `isAppActive`, the searchFlow E15 assertion. feature-parity keeps the documented convention (Android status as an Evidence-cell note: the matrix has no status column); its Tests cell now lists the real tests.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter, Edge Case Hunter, Verification Gap):

- **Head-follow is suppressed for any card, not only one the page focused** (BH2, EC1, VG other). **Medium.** A scheduled or needs-level page stops following a new first post on resume. Patch: suppress only when the page's auto focus is the card; tests for live and scheduled.
- **VG1. Head-refresh suppression with a live card has no test.** Patch together with the item above.
- **The 30 s poll runs in the background** (BH1, EC2). **Medium.** No `focusManager`/AppState wiring exists in `src/`. Patch: the interval also requires an active app; host test.
- **Mount uses a cached E15 within the 60 s staleTime** (BH3, EC3). **Medium.** Initial focus can go to an ended stream, and a cached «none» hides a new stream; Q3 expects one E15 per open. Patch: `staleTime: 0`.
- **Card-loss fallback depends on the tracked id after unmount** (BH14). **Medium, device-unverified.** The Story 6.7 lesson says Android moves focus first. Patch: decide from the id captured before the unmount; host test.
- **VG2. The live branch of `focusAfterLoss`/`focusAbove` is untested.** Patch: a test.
- **BH5 / VG3. LiveCard fallback branches are not asserted** (untitled, no time, no access, needs level + scheduled, cover error). **Low**, adding tests is direct. Patch.
- **BH6. The inert card has the button role.** **Low**, direct. Patch: a non-button role until 7.2.
- **EC4. A `startTime` in milliseconds renders nonsense.** **Low**, direct guard. Patch.
- **BH13. A just-ended 200 is logged at warn.** **Low**, direct. Patch: debug/info.
- **BH10. No assertion that Поиск sends no E15.** **Low**, direct. Patch.
- **BH11. LIVE-01 row format in feature-parity.** **Low**, doc. Patch.
- **BH12. `epic-7-context.md` is stale on Q1–Q3 and the flag.** **Low**, doc. Patch.
- **BH4. E15 is sent and polled on an E3 error or unavailable page.** **Low, rejected.** It is rare, the cost is one GET per 30 s, and the fix adds a parameter.
- **BH7 / EC5. «сегодня/завтра» goes stale across midnight.** **Low, rejected.** It needs a card left open across midnight, and the fix adds a ticking clock.
- **BH8. An overdue scheduled start still reads «Начало сегодня в …».** **Low, rejected.** No wording is defined, and the reference shows the time the same way. Revisit if the owner sees a delayed stream.
- **BH9. The return-to-card branches of `useFocusEffect` are unreachable in 7.1** (OK is inert, Back pops), and «ended while covered» restores rather than going to the first post. **Low, rejected for 7.1.** Story 7.2 makes them reachable and must test and settle the target.
- **BH15. No tests without the action row or above an empty grid.** **Low, rejected.** `phaseFlags.search` is on, and ↓ with no destination keeps focus.
- **EC6. Initial focus is settled even when the first answer comes while a modal is open or the route is inactive.** **Low, rejected.** It is rare, and re-arming risks focus jumps on later polls.
