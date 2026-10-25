---
title: 'Story 1.5: Spike — entitlement, errors and events shapes'
type: 'chore'
created: '2026-10-25'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/testing.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Error states (AD-5), entitlement handling and fixtures rely on reference-derived guesses, which `docs/api-contract.md` §7/§8 mark as unverified. The guesses cover:
- accessible vs locked posts (`hasAccess`, `data` vs `teaser`, `playerUrls`, video duration);
- the 401/403/404 bodies;
- E8 with `comments_limit=0`;
- the E18 events shape.

**Approach:** On the throwaway branch `spike/1-5-entitlement-errors-events` (Story 1.4 spike + `main`), a spike screen «Контент: доступ, ошибки, события» runs a fixed, read-only request set with the owner's session.
- It records sanitized shapes on screen and in the log.
- It sanitizes the response bodies in memory into fixtures and writes only those to the app's external files directory. They are pulled to `src/test/fixtures`.
- A check script proves the fixtures are clean.
- The results go to `docs/api-contract.md` (`LIVE`) and `docs/testing.md`.

## Boundaries & Constraints

**Always:**
- **Allowed requests:** only GET endpoints already in `docs/api-contract.md`: E1, E2, E3, E4, E5, E8 (with `comments_limit=0&reply_limit=0`), E15 and E18.
- **Request budget:** at most 30 requests per run, each run once. Calls go through the Story 1.4 `refreshCoordinator`, except the deliberate no-token calls.
- **Raw bodies stay in memory.** They are never logged, written or displayed. On screen and in the log, only `describeShape` lines, statuses, counts and booleans appear.
- **Fixture sanitizer:**
  - every string becomes a placeholder, except allowlisted enum keys (`type`, `modificator`, `playerUrls[].type`, event `type`, `error`, `status`);
  - ids get synthetic stable values;
  - URLs become `https://example.invalid/<kind>`;
  - `signedQuery` becomes `?sig=REDACTED`;
  - text-block `content` becomes a synthetic valid `[text, style, ranges]` string;
  - numbers (durations, timestamps, counts, `hasAccess`) are kept.
- **Locked-post selection:** pick the first accessible post and the first locked post from E4 pages of the owner's subscriptions (E2), scanning at most 5 blogs. If none is found, record that and stop.
- **Device cleanup:** the fixture files are deleted from the device after pulling. The logcat scan (tokens, `Bearer `, phone digits, `signedQuery`, signed URLs) must be clean, and the buffer is cleared afterwards.

**Never:**
- Mutations (E9–E12, E16, E17).
- The comments endpoint.
- Guessed endpoints or guessed paging parameter names. An E18 second page is requested only with a cursor the response itself returns, under the §5 convention, and is labeled inferred.
- Triggering 429 on purpose.
- Production code; UI work beyond the spike screen.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Accessible post | E4 item with `hasAccess=true`, then E8 | `hasAccess`, `data`/`teaser` block types, `ok_video.playerUrls[].type` set, duration field presence recorded | — |
| Locked post | E4 item with `hasAccess=false`, then E8 + E5 entry if present | Same fields recorded; whether `playerUrls` are absent and `teaser` present | E8 non-200 recorded as the "locked resource" signal |
| Live stream | E15 for the chosen blog | 204 or the shape | — |
| No token | E1 and E8 (accessible post) without `Authorization` | Status + body shape | No refresh attempted |
| Missing | E8 with a random UUID post id; E3 with a random blog slug | Status + body shape (404 expected, not assumed) | — |
| Events | E18 once (+ one cursor page if offered) | Shape, `type` values, `count`, cursor fields; EVT-01 verified or not | Non-200 recorded |
| Unknown block | Any unrecognized `type` | Kept as-is in the fixture with placeholders | No crash |

## Decisions (owner, 2026-10-25)

- **Spec length:** keep it whole (about 1960 tokens, single goal).
- **`device_id` and refresh-token reuse re-test (open since 1.4):** closed as "not needed for production", with no requests. Production always sends the same install `device_id`, and a rotated-out refresh token fails anyway (single-use), so neither answer changes client behavior. Record this in api-contract §2.3/§8.

</frozen-after-approval>

## Code Map

- `src/app/spike/refreshCoordinator.ts` -- reuse `createRefreshCoordinator(...).callWithSession(build)`. Its `CallResult.response.json` gives the parsed body to the in-memory sanitizer.
- `src/app/spike/phoneAuthApi.ts` -- reuse `webHeaders`, `sanitizeResponse`/`describeShape`/`formatSanitized`, `execute`, `API_BASE`. Widen `ApiRequest['name']` with the new request names. Add `hasAccess`, `isLast` and `isOnline` to the recorded enums/booleans only if needed.
- `src/app/spike/SessionRefreshCheck.tsx` -- pattern for the coordinator plus `SpikeScreen`/`SpikeButton`/`SpikeLog`/`useBackToMenu` (`SpikeUi.tsx`), and `SESSION_SERVICE` from `PhoneAuthCheck.tsx`.
- `src/app/App.tsx` -- the spike menu; add the entry.
- `android/.../boostytv/InstallIdModule.kt`, `BoostyNativePackage.kt`, `src/app/spike/spikeNative.ts` -- pattern for a new `SpikeFiles` native module: `write(name, text)` and `clear()` under `getExternalFilesDir("fixtures")`.
- `src/test/fixtures/` -- currently only `.gitkeep` on main. `__tests__/fixtures/boundaries/...` is the boundary-lint test; do not touch it.
- Device: `adb-25311HFDD69E8B-SKv3Ox._adb-tls-connect._tcp`; release-like build, `-PreactNativeArchitectures=armeabi-v7a`. The owner first signs in on the «Вход по телефону» screen.

## Tasks & Acceptance

**Execution:**
- [ ] `src/app/spike/contentShapesApi.ts` + test -- request builders (E1–E5, E8, E15, E18, no-token variants), post picking (accessible/locked, by `hasAccess`) and `sanitizeFixture(json)` per the rules above. Tests prove that no input string survives except allowlisted enums.
- [ ] `SpikeFiles` native module + `spikeNative.ts` binding -- write/clear sanitized fixture files.
- [ ] `src/app/spike/ContentShapesCheck.tsx` + menu entry + test -- runs the matrix in order, shows shapes and the request count, and writes fixtures.
- [ ] `scripts/check-fixtures.mjs` + `npm run check:fixtures` (goes to `main`) -- fails on: 40+ char opaque runs, `Bearer`, URLs outside `example.invalid`, query strings other than `?sig=REDACTED`, 9+ digit runs, `@`-emails, or any string that is not a placeholder, synthetic value or allowlisted enum.
- [ ] On the device: the owner signs in; one run; pull the fixtures to `src/test/fixtures/boosty/`; delete them on the device; logcat scan.
- [ ] `docs/api-contract.md` §3/§4/§7/§8 and `docs/testing.md` -- `LIVE` results for S5/S11, the AD-5 mapping notes, and the closed `device_id`/reuse question (decision above); update the matching deferred-work entry note.

**Acceptance Criteria:**
- Given the owner's session, when the run completes, then each matrix row has a recorded status and shape, and the run sent at most 30 requests.
- Given the pulled fixtures, when `npm run check:fixtures` runs, then it passes; and it fails on a planted token, signed URL or phone number (test).
- Given the logcat captured during the story, when it is scanned, then nothing sensitive matches.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.
