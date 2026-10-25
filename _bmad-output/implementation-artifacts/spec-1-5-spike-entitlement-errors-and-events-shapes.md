---
title: 'Story 1.5: Spike — entitlement, errors and events shapes'
type: 'chore'
created: '2026-10-25'
status: 'done'
baseline_commit: '3e13e5db3d92bf51627f90fa30f7da7a3f71275a'
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

- **Fixture numbers (owner, after the first device run):** numbers are no longer kept verbatim. Publish times, counts, prices and exact durations could identify the owner's subscriptions in combination. Times become synthetic with their order kept, counts and money become 0 or 5, durations are rounded to whole minutes, sizes to 100 KiB, and structural numbers (paging, dimensions, statuses) are kept. `check:fixtures` enforces the same rules. The run is repeated once (about 15 requests, no sign-in).

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
- [x] `src/app/spike/contentShapesApi.ts` + test -- request builders (E1–E5, E8, E15, E18, no-token variants), post picking (accessible/locked, by `hasAccess`) and `sanitizeFixture(json)` per the rules above. Tests prove that no input string survives except allowlisted enums.
- [x] `SpikeFiles` native module + `spikeNative.ts` binding -- write/clear sanitized fixture files.
- [x] `src/app/spike/ContentShapesCheck.tsx` + menu entry + test -- runs the matrix in order, shows shapes and the request count, and writes fixtures.
- [x] `scripts/check-fixtures.mjs` + `npm run check:fixtures` (goes to `main`) -- fails on: 40+ char opaque runs, `Bearer`, URLs outside `example.invalid`, query strings other than `?sig=REDACTED`, 9+ digit runs, `@`-emails, or any string that is not a placeholder, synthetic value or allowlisted enum.
- [x] On the device: the owner signs in; one run; pull the fixtures to `src/test/fixtures/boosty/`; delete them on the device; logcat scan.
- [x] `docs/api-contract.md` §3/§4/§7/§8 and `docs/testing.md` -- `LIVE` results for S5/S11, the AD-5 mapping notes, and the closed `device_id`/reuse question (decision above); update the matching deferred-work entry note.

**Acceptance Criteria:**
- Given the owner's session, when the run completes, then each matrix row has a recorded status and shape, and the run sent at most 30 requests.
- Given the pulled fixtures, when `npm run check:fixtures` runs, then it passes; and it fails on a planted token, signed URL or phone number (test).
- Given the logcat captured during the story, when it is scanned, then nothing sensitive matches.

## Implementation Notes

- Sign-in was blocked for about 2 h by a server-side 429 `sms_gate_ratelimit` on the first send; the website got the same error. The spike sign-in screen now shows 429 details (limit headers, header names, safe `error_description`). The limit lifted at 19:45 (api-contract §2.2).
- Device runs: 2 (the second after the owner-decided number rules), 15 requests each, results identical. Started via adb keys after the owner signed in.
- Findings beyond the matrix: E8 without a token returns 200 as an anonymous viewer (`hasAccess=false`), not 401; a `list` content block exists; `ok_video.duration` is present in the feed; E2 returns `offset/limit/total`.

## Spec Change Log

- Owner decision after the first device run (recorded in Decisions): fixture numbers are no longer kept verbatim, and the run was repeated once. Trigger: the first fixtures carried exact publish times, counts, prices and durations that could identify the owner's subscriptions in combination. Amended: the sanitizer number rules and `check:fixtures`. Avoids: identifying data in a public repo. KEEP: string sanitizing and the request set unchanged.

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind, edge | 429 `error_description` filter could show a phone in short groups or a 4-digit code | medium | patch | Description now shown only with no digit and no `@`; only length and digit count otherwise; tests with a grouped phone and a 4-digit code |
| 2 | verification-gap | `check:fixtures` not run in CI or on the repo fixtures | medium | patch | Added to the CI `js` job and as a jest test on the repository fixtures |
| 3 | verification-gap | 429 header capture in `execute` untested | medium | patch | `execute` test with a 429 and `forEach` headers; cookie value absent |
| 4 | verification-gap | On-screen 429 summary not asserted | low | patch | One `toContain` in the existing resend test |
| 5 | blind | `total`/`unread` kept verbatim, against the owner's number rule (per-type event counts) | medium | patch | Removed from the kept keys in both copies; the 3 affected committed values were mapped with the same rule |
| 6 | edge, verification-gap | Sanitizer classifies a renamed key's number by the original key, the check by the synthetic key | low | patch | Sanitizer now classifies renamed keys as unknown (count rule); test added. Fail-closed before the fix |
| 7 | edge | Time sentinel 0 becomes a real-looking time | low | patch | 0 kept for time keys in both copies; committed fixtures predate it (noted in testing.md) |
| 8 | edge | Any `*.gitkeep` file bypasses the check; `.DS_Store` fails it | low | patch | Exact basenames only; tests added |
| 9 | blind | Test mocks return 401 for a no-token post, contradicting the live 200 | low | patch | Mocks follow the live behavior; the runner test now expects 200 |
| 10 | blind | Expired/invalid token on content endpoints untested | medium | defer | api-contract §7 row marked unverified; deferred-work entry (one E8 request settles it) |
| 11 | blind | No-token conclusion rests on one post | low | patch | api-contract §7 states the sample and marks the rule inferred |
| 12 | blind | New open questions missing from deferred-work | low | patch | Entries added: E18/E2 paging, send-limit window, cursor format, E15 200 shape |
| 13 | blind | testing.md Story 1.4 still says the `device_id` question is open | low | patch | Closure note added |
| 14 | blind | Number rules duplicated in two files | low | defer | Cross-check test exists; a shared module belongs to production tooling (deferred-work) |
| 15 | blind | Cursors erased, so fixtures cannot drive pagination tests | low | defer | deferred-work: record the cursor structure on a later run |
| 16 | blind | `checkFixtures.test.js` imports the spike sanitizer and breaks on `main` | medium | patch | The docs PR to `main` carries the script and the CLI tests without the spike-sanitizer case |
| 17 | blind | Frozen block edited after approval | false | reject | The owner made the decision in this session; it is recorded as an owner decision plus a change-log entry |
| 18 | blind | Status mismatch spec vs sprint-status | false | reject | Step 5 syncs sprint-status |
| 19 | blind | Envelope not validated; root resolves from cwd | low | reject | `npm run` always runs from the repo root; the envelope is written only by `buildFixtures` |
| 20 | edge | 40-char enums/keys, structural ≥1e8, id-space exhaustion | low | reject | All fail-closed (the check rejects; nothing leaks) and not met by real data |
| 21 | edge | E2 non-200 reported as "no posts", E18 offset 0, nested unknown blocks in `list`, stale device files, unmount during run, symlinks | low | reject | Spike-only runner/screen paths that did not occur; the device directory was deleted between runs |
| 22 | edge | Allowlisted enum keys keep any one-word value | low | reject | Audited the committed fixtures: only API enums under those keys |
| 23 | edge | Fixtures absent from the reviewed diff | false | reject | Excluded from the review diff on purpose (about 800 KB); they are committed and checked by `check:fixtures` |
| 24 | edge | Resend/confirm 429 without details | false | reject | Resend uses the same send path; confirm has never returned 429 |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.
