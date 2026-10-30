---
title: 'Story 7.4: Like and share a live stream'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e7aaf77f552bc8f8571009e0293ea4f4b11baea8'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-7-2-watch-a-live-stream.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The family cannot like a live stream or send its link to a phone from the TV (LIVE-04, LIVE-05; FR24, FR25).

**Approach:**
- Two TV buttons sit to the right of the LiveCard in a vertical column, inside the card's 120 dp block, so the layout height does not change: «Нравится» on top, «Поделиться» below (DESIGN mock).
- → from the card goes to «Нравится», and ↓ from «Нравится» goes to «Поделиться». ← returns to the card. ↓ from «Поделиться» goes to the grid.
- Like is an optimistic E17 toggle (`POST` to like, `DELETE` to unlike): one request in flight, rollback on failure, no automatic retry. The failure line keeps the `AppErrorKind`.
- Share opens the stream page QR, and focus returns to «Поделиться» when it closes.

**Owner decisions (2026-10-30):**
- **Q1 a.** The like button is a heart icon plus the count, as in the mock: «♡ 357» not liked, «♥ 358» liked, in the accent. It needs a new heart SVG icon in `shared/ui/icons`. The card's details line drops its likes figure, so the number is not shown twice. The button's a11y label still says «Нравится, N» or «Вам нравится, N».
- **Q2 a.** The like shows only for a live card with access. «Поделиться» shows for every card: live, scheduled and needs level. Without the like, «Поделиться» is the only button; → from the card reaches it, and ↓ from it goes to the grid.

## Boundaries & Constraints

**Always:**
- Before the optimistic write, cancel the `['stream', blogUrl]` query. A poll result that lands while the like request runs must not undo the optimistic state: hold it until the request settles. After success, keep the state; the next poll reconciles.
- Capture the account generation. After a sign-out or switch there is no request, rollback or error.
- `isLiked` is read from E15 (lenient: anything but `true` is `false`). `likes` ± 1 is clamped at ≥ 0.
- The card's OK behaviour, initial focus on the card, the card's guide entry, `LIVE_CARD_BLOCK_HEIGHT` and the 7.1–7.3 rules are unchanged.
- Card loss, return focus, `canFocus` and head-follow treat the like and share ids like the card id.

**Never:**
- No automatic retry, no request replay, no like from Главная or the player.
- A real E17 on the device is sent only with the owner's approval.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Like | not liked, OK on like | Liked state and likes + 1 at once; one `POST …/video_stream/like` | — |
| Unlike | liked, OK | Not liked, likes − 1 at once; one `DELETE` | — |
| In flight | OK again while the request runs | Ignored (no second request, no flip) | — |
| Failure | E17 5xx / network / 429 / 401 | State and count roll back; an inline line with the kind's copy (`error.<kind>`); the next OK clears it | no retry |
| Poll during request | E15 poll lands mid-request | The optimistic state stays until the request settles | — |
| Account change | sign-out or switch mid-request | No rollback, no error, nothing more sent | — |
| Share | OK on «Поделиться» | QrDialog with `https://boosty.to/{blog}/streams/video_stream`; close or Back → focus on «Поделиться» | — |
| Focus | → from the card, ↓ from like, ← from either, ↓ from share | like, share, card, grid | no like shown → → reaches share |
| States | live + access / scheduled / needs level | heart + share / share only / share only | — |
| Card goes | the stream ends while like or share has focus | Focus → first post (the 7.1 card-loss rule) | — |
| Demo | demo mode | E17 answered locally, the like kept in memory across polls | — |

</frozen-after-approval>

## Code Map

- `src/features/author/LiveCard.tsx` -- the card (520×120 `FocusableSurface`). `liveCardBlockStyle` (236-242) has horizontal room right of the card and 120 + headroom height; the buttons go there. `liveCardDetails` renders likes.
- `src/features/author/useAuthorLive.tsx`:
  - `useAuthorLiveCard` (85-98, zone item + host refs) -- copy it for the two buttons;
  - card loss (168-188) -- also counts like/share focus;
  - `openLiveQr` (230-240) -- take the initiator ref (share button), keeping the card ref for the 7.2 player-return QR.
- `src/features/author/AuthorScreen.tsx`:
  - live guide (562-565, destination = card) and card slot (610-626) -- put the buttons as siblings of the card in a row wrapper inside the guide;
  - return focus (382-406) -- explicit branches for like/share;
  - `followHeadUnlessLive` (488-492).
- `src/features/author/useAuthorAutoFocus.ts:223-236` `canFocus`; `useAuthorActionRowFocus.ts:73,78` `setLiveFocus` → ↓ from share (and the card) reaches the grid.
- `src/features/author/authorIds.ts:12` -- add `authorLiveLikeId`, `authorLiveShareId`.
- `src/shared/api/dto/stream.ts`, `src/shared/entities/stream/{types,mapStream}.ts` -- add `isLiked`.
- `src/shared/entities/stream/streamRepository.ts:87-100` -- `likePath`, `like(http, blogUrl, liked)` (`POST`/`DELETE`, `retry: false`), as `heartbeat`.
- `src/features/polls/usePollVote.ts` -- pattern: module single flight keyed by generation, `useSyncExternalStore` busy, `current()` guard, `finally` cleanup. Store the `AppError.kind`, and add no re-fetch.
- `src/shared/ui/Button.tsx` (label, kind, size, busy; no icon prop) -- the like needs an icon + count variant; `src/shared/ui/icons/index.tsx` -- add a heart (outline and filled), as the existing Skip/Gear/Check.
- `src/shared/i18n/ru.ts:251-264` `author.live.*` -- like/share copy and a11y.
- Tests: `__tests__/authorFlow.test.tsx` (router 199-227: add an E17 handler; Story 7.1 block 2128, 7.2 block 2552; `e15Stream(kind, overrides)` in `src/test/authorFixtures.ts:102`), `src/features/author/__tests__/LiveCard.test.tsx`, `src/shared/entities/stream/__tests__/`.
- Demo: `src/app/dev/demo.ts` (router 664-673, `DEMO_HEARTBEAT_PATH` 502, `demoStream()` 585 rebuilt per poll) -- `DEMO_LIKE_PATH` plus an in-memory like; `__tests__/demoFlow.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] Stream entity, DTO and repository -- `isLiked`, `like()`; tests: paths, methods, no retry, no replay after 401.
- [x] `src/features/author/useLiveLike.ts` (new) -- the optimistic toggle per the matrix (cancel, write, hold against polls, rollback, generation guard, kind).
- [x] `LiveCard.tsx`, `useAuthorLive.tsx`, `AuthorScreen.tsx`, `useAuthorAutoFocus.ts`, `useAuthorActionRowFocus.ts`, `authorIds.ts` -- the buttons (heart + count, like only live with access, share always), focus moves, share QR, card-loss and return rules.
- [x] `src/shared/i18n/ru.ts` + the heart icon -- copy and a11y.
- [x] `__tests__/authorFlow.test.tsx` «Story 7.4» -- one test per matrix row; `LiveCard.test.tsx` -- button states.
- [x] Demo + `demoFlow` -- the like toggles and survives a poll; nothing reaches Boosty.
- [x] Docs: `docs/api-contract.md` E17, `docs/feature-parity.md` LIVE-04/05, `docs/focus-map.md` (D, G10), `docs/testing.md`.

**Acceptance Criteria:**
- Given a LiveCard with the like shown, when OK is pressed on it, then the like toggles at once, one E17 goes out, and a failure rolls back with no retry.
- Given «Поделиться», when OK is pressed, then the QrDialog shows the stream page URL and focus returns to «Поделиться» on close.
- Given lint, typecheck, `check:fixtures` and `npm test` ×3, when run, then all are clean; the touched suites pass ×30.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean
- `npm test` ×3 -- expected: all pass
- `authorFlow`, `demoFlow`, `src/features/author`, `src/shared/entities/stream` ×30 -- expected: 0 failed runs

**Manual checks:**
- Device, demo debug build (agent over adb): → / ↓ / ← moves, the like toggles and survives a poll, share QR → close → «Поделиться».
- Release-like build: a no-stream author is unchanged.
- No real E17.

## Implementation Notes

- **Entity:** `Stream.isLiked` (E15 `isLiked`, `z.unknown()` in the DTO; the mapper keeps only a literal `true`). `StreamRepository.like(http, blogUrl, liked)` sends `POST` / `DELETE` to `likePath(blogUrl)` (`…/video_stream/like`, validated through `streamPath`), `retry: false`, body discarded.
- **Toggle (`src/features/author/useLiveLike.ts`):** an optimistic overlay `{streamId, isLiked, likes}` (see the Review Triage Log for the success write, the stream id and the lifecycle fixes) in a module store keyed by `<generation>:<blogUrl>` (`useSyncExternalStore`, as `usePollVote`), applied over the `['stream', blogUrl]` query's value; the page renders the overlaid stream. OK: ignored when no like is shown or a request runs; else `cancelQueries` (exact key, TanStack reverts a running poll), the overlay set at once, `setError(null)`, one E17. Success (same generation): `setQueryData` with the optimistic values and the overlay marked settled; the settled overlay is dropped when the page's stream value next changes (the write itself, a poll, or none), so no frame shows the old value. Failure: the overlay deleted (the query's current value shows: the rollback, also over a poll that landed meanwhile) and `error` = the `AppErrorKind` (`Client` for a non-AppError). Generation changed: nothing written, no error; the old entry is deleted. `liveLikeShown(stream)` = live and `hasAccess` (Q2 a).
- **Reading of "The card's details line drops its likes figure" (Q1 a):** dropped only where «Нравится» shows (live with access: the line is the viewer count alone). A scheduled card keeps «N лайков» (no like button there, so the number is not shown twice); a needs-level card shows the level line, as before.
- **UI:** `LiveCardActions` (in `LiveCard.tsx`): a `TVFocusGuideView` column (`author/live/actions`, destination = «Нравится», else «Поделиться») right of the card, `ACTIONS_WIDTH` = the block's width − 520 − 16, height 120, top-aligned with the card (so its buttons never become a ↓ candidate from the card); secondary small Buttons (32 dp). «Нравится»: `HeartIcon` (new, outline / filled, `shared/ui/icons`) + `formatCount(likes)`, liked in the accent (`selected`), a11y «Нравится, N» / «Вам нравится, N». «Поделиться»: a11y «Поделиться эфиром: QR-код со ссылкой» (our copy). The failure line is a fixed two-line slot (`LIKE_ERROR_HEIGHT`, `error-text`) under the buttons (polite live region, empty when none); while E17 runs the like keeps `onPress` and reports busy (`accessibilityBusy`). `Button` gained `icon?: ReactNode` and `selected?: boolean` plus `buttonInk()`; existing buttons are unchanged (no `selected` key in their a11y state).
- **Focus:** `authorLiveLikeId` / `authorLiveShareId`; the buttons reuse `useAuthorLiveCard` (zone item + host view). `canFocus`, `followHeadUnlessLive`, `useAuthorActionRowFocus` (↓ target while any of the three has focus) and the card-loss render check count both ids as the card. Return focus: the remembered button if still shown; «Нравится» gone while covered → «Поделиться»; else the card if shown, else the first post. Extra (not in the matrix): «Нравится» going while focused with the card still shown (lost access / not live) → «Поделиться». `openLiveQr(initiator = card ref)`; share passes its own ref, so the modal host returns focus to «Поделиться». OK on «Нравится» is a latch move only when the toggle ran.
- **Next OK clears the error:** OK on «Нравится» only (as the poll error); OK on «Поделиться» leaves the line.
- **HttpClient timeout:** a held E17 that outlives the HttpClient's request timeout fails as `Network` (seen in the host tests with a 30 s fake-timer poll; the poll rows trigger the refetch directly instead).
- **Demo:** `DEMO_LIKE_PATH`; `createDemoSessionManager` keeps `streamLiked` in its closure; `demoStream(liked)` reports `isLiked` and `likes` 42 + 1.
- **Tests:** `streamRepository.test.ts` «E17 like» (8) + `isLiked` rows; `LiveCard.test.tsx` (+10); `Button.test.tsx` (+1); `icons.test.tsx` (+2); `authorFlow.test.tsx` «Story 7.4» (28 after the review fixes) and the 7.1 «Live» row updated (no likes in the details); `demoFlow.test.tsx` (+1, and the 7.1 demo label updated).
- **Checks run:** lint (`--max-warnings 0`), typecheck, `check:fixtures` (29 clean); `npm test` ×3: 113 suites, 2532 passed each; touched suites ×30: 0 failed runs (271 passed each).
- **Device (2026-10-30, pinned Chromecast, agent over adb, a screenshot of the focused element before every OK in the app):** demo debug build (local `DEMO_MODE = true`, reverted to `false`): layout, → / ↓ / ← / ↑ moves, like → «♥ 43» → survives a poll (one E15 GET in logcat) → unlike «♡ 42», share → QR → Back / «Закрыть» → «Поделиться». Release-like build: a real no-stream author unchanged. No real E17. Pre-existing (reproduced with this story stashed): the first ↑ from a first-row grid card is swallowed by a 2 px list scroll; the second reaches the card. Process slip: one key series reached the Google TV launcher after an app restart (two OKs there without a screenshot: the account chooser's "continue with the current account" and «Заставка»; nothing visibly changed); recorded in `docs/testing.md`.

## Spec Change Log

## Review Triage Log

Coordinator review (pass 1), all **patched**:

- **Success write could be reverted by a poll started mid-flight, and overwrote a newer count with absolute values.** `useLiveLike`: on success, `await cancelQueries` (exact key), then write relative to the cached value (`isLiked` = target; `likes` ± 1 only when the cached `isLiked` differs; ≥ 0), then mark the overlay settled. Tests: a poll started mid-flight answering after E17 200 → still liked; a reply held from before the press → not written (both fail without the pre-write cancel); a newer poll count is kept (357 → poll 400 → 401). Note: the OK-time cancel is not separately observable in host tests (the pre-write cancel and the overlay cover the same outcomes); it is kept as specified.
- **A new stream id while E17 runs got the old optimistic state.** The overlay and the error carry `streamId`; applied and written only to the same id. Test.
- **Lifecycle: settled overlay left in the module map on unmount; `error` survived a hidden like and an account change.** The blog's settled overlay is dropped on unmount; the error is cleared when the like is hidden and shown only for the same generation and stream id. Test: lost access → like reappears without the old line.
- **«Account change mid-request, success» test was vacuous.** It now puts the new account's stream back into the cache before E17 200 and asserts `isLiked: false`, likes 357, unconditionally.
- **Return-focus branches untested; «like gone while covered» fell back to the card.** `AuthorScreen` now falls back to «Поделиться» (as when uncovered); tests for return → «Нравится» / «Поделиться» and like gone while covered → «Поделиться».
- **LiveCard:** the like keeps `onPress` while sending and reports `accessibilityState.busy` (new `Button` prop `accessibilityBusy`, no spinner); the heart uses `buttonInk({kind: 'secondary', selected})` in both states (asserted); the failure line uses `error-text` (as the poll error line); the slot has a fixed height of two `meta` lines (`LIKE_ERROR_HEIGHT`) and the column is asserted to fit 120 dp.
- **`author.live.stats` unused** (the scheduled card uses the likes plural directly): removed from `ru.ts`.
- **Docs:** api-contract E17 and feature-parity LIVE-04 note the known limitations (a timeout / network failure rolls back although Boosty may have applied the like; a 401 after a renewed token shows `error.Client`, the next OK works); the `liveLikeA11yLabel` comment; the focus-map 7.4 «Arrows» bullet; the LiveCard test count; the duplicate `react-native` import in `Button.test.tsx`; `demoFlow` in the LIVE-05 tests cell.
