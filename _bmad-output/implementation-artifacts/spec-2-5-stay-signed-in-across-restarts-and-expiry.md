---
title: 'Story 2.5: Stay signed in across restarts and expiry'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: '3e7b792a87368184e3192e1ab6f63af1e5a056fe'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/adr/0008-api-request-profiles.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The stored session is trusted blindly at startup. Nothing refreshes it, so after 30 days, or after a server-side invalidation, the app silently acts as an anonymous viewer (content endpoints answer 200 for a bad token). There is no error taxonomy or retry policy for later content calls. There is no offline start state and no way to run the app on fixtures.

**Approach:** Build the production session core in `shared/api`:
- `HttpClient` takes its token from `SessionManager`;
- a single-flight refresh coordinator follows the binding rules in `docs/api-contract.md` §2.3;
- `AppError` plus the AD-6 retries;
- E1 validation at cold start and on resume, with an offline StateView on Главная;
- one `FixtureTransport` seam for integration tests and a debug-only demo mode with the «ДЕМО» badge.

## Boundaries & Constraints

**Always:**
- **Token ownership (AD-3).** `SessionManager` is the only token reader and writer.
  - It keeps the session in memory after `restore()`.
  - `HttpClient` requests the token through an injected `getAccessToken()`, never from callers.
  - Status: `signedOut | signedIn | expired`.
- **Refresh.**
  - `AuthApiClient.refresh` sends `POST /oauth/token/` with `grant_type=refresh_token`, `refresh_token`, `device_id` (the install's own id) and `device_os=web`, using the auth profile.
  - It is single-flight. A proactive refresh runs when < 300 s remain. After a 401 at most one refresh runs, followed by one retry of the original request.
  - On a 401, refresh only if the failed request used the token that is still current. Otherwise retry with the new one.
- **Only refresh HTTP 400 with `error === "invalid_grant"` sets `expired`.**
  - Every other result keeps the tokens and stays `signedIn`, and the request surfaces its own kind. This covers other 4xx, 401, 403, 429, 5xx, timeouts, transport errors and an unparseable 200.
  - Never match on `error_description`.
- **Rotation.**
  - Persist the new pair to SecureStore **before** adopting it.
  - A save failure is a distinct result: the old state is kept and an error is logged.
  - A missing `refresh_token` keeps the old one.
  - Accept `expires_in` only if it is finite and > 300 s; otherwise keep the previous expiry.
  - An unparseable 200 or a lost response keeps state, with no loop.
- **Generation guard.** Sign-out, reload and sign-in bump a generation.
  - A late refresh outcome from an older generation is dropped and logged.
  - A late rejection never turns `signedOut` into `expired`.
- **Timeouts.** Every request has an `AbortController` timeout, so a hung refresh never holds the single flight.
- **Errors (AD-5/AD-6).**
  - `AppError` (`SessionExpired, NoAccess, MediaUrlExpired, NotFound, RateLimited, Client, Server, Network, Parse`) is built only in `shared/api`, from verified shapes. A 403 is never expiry.
  - GET retries: Network ≤ 2 with exponential backoff, Server ≤ 1, none otherwise. Mutations are never retried.
- **Startup and resume.**
  - With a stored session the Shell opens at once, as today.
  - E1 then runs in the background at cold start and on every `AppState` → `active`. It is single-flight and never moves focus.
  - E1 `Network` (after retries) at cold start → Главная shows the StateView «Нет подключения к интернету» with «Повторить» (it gets focus only when OK opens Главная's content, per focus-map §3). The session is kept and this is not A11.
  - «Повторить» re-runs E1; on success the placeholder comes back.
  - E1 failures on resume change nothing visible unless the status becomes `expired`.
- **Expired before A11 exists (owner decision).** When the status becomes `expired`, the stack resets to A1 with «Войдите снова» (existing route and copy). Story 2.6 replaces this with A11.
- **FixtureTransport.**
  - One transport replaces only `HttpClient`'s and `AuthApiClient`'s network layer (`fetch`).
  - It serves the integration tests: refresh single-flight, staggered late 401s, sign-out during refresh, save failure on adopt, `expires_in` edges, expiry, offline start.
  - Fixtures obey `check:fixtures`.
- **Demo mode.**
  - `app/appConfig.ts` has `DEMO_MODE = false`; demo requires `__DEV__`.
  - Demo boots a synthetic in-memory session and **never writes or clears SecureStore**, so the owner's stored session survives.
  - A persistent «ДЕМО» badge shows in the top-right corner inside the safe area, using DESIGN Badge tokens. It is not focusable.
  - The release build fails when `DEMO_MODE` is true: a Gradle check before the release JS bundle, plus a CI test.
- Copy goes through the `ru` catalog. Nothing is logged in the clear: no token, `Bearer`, phone or E1 body.

**Never:**
- the A11 screen or quick re-login (Story 2.6);
- sign-out UI (Story 2.7);
- AccountScope or account switch (2.7, 2.8);
- NetInfo or other new dependencies;
- a second HTTP mocking library;
- replaying mutations;
- treating 403 or an anonymous 200 as expiry;
- uninstalling, clearing data, signing the owner out, or spending a sign-in.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Cold start | Stored session, E1 200 | Shell at once, stays signedIn | — |
| Proactive | < 300 s left, 5 concurrent GETs | 1 refresh, then all 5 sent with the new token | — |
| 401 | GET → 401 | 1 refresh, 1 retry → 200 | A 401 on the retry → fails with `Client`, stays `signedIn`, no 2nd refresh |
| Staggered 401 | 401 arrives after another call's refresh finished | Retry with the current token, no refresh | — |
| Rejected | Refresh 400 `invalid_grant` | `expired`; nothing further sent | No loop |
| Recoverable | Refresh 5xx / 429 / 400 other / 401 / timeout / network / bad 200 | Tokens kept, `signedIn`, the request fails with its kind | — |
| Save fails | Refresh 200, SecureStore write throws | Old tokens kept in memory and storage, error logged | — |
| Sign-out race | Sign-out or reload while a refresh is in flight | Late result dropped; `signedOut` stays | — |
| Offline start | Stored session, E1 Network ×3 | Главная offline StateView + «Повторить»; session kept | «Повторить» → E1 again |
| Demo | `DEMO_MODE` on, debug build | Fixture-backed Shell, «ДЕМО» badge, SecureStore untouched | Release build fails |
| Expired route | Status becomes `expired` from any screen | Stack reset to A1 with «Войдите снова» | — |

## Decisions (owner, 2026-10-26)

- `expired` in 2.5 → A1 «Войдите снова»; A11 comes in Story 2.6.
- One live refresh on the device: a debug-only trigger replaces the access token **in memory only** with a corrupt value, then E1 → 401 → real refresh → retry → 200. Run it only after every host check passes, once. If it burns the session, the owner signs in again once.
- Offline cold start is verified with FixtureTransport only (host tests, demo mode); no device offline run.
- The spec is kept whole (~3500 tokens), demo mode included.

</frozen-after-approval>

## Code Map

- `src/shared/api/httpClient.ts` -- GET only, timeout, content profile, resolves any status. Add: an injectable transport (`fetch`), `getAccessToken` plus refresh hooks, AppError mapping, AD-6 retries, and non-GET support with no retry. Keep the header rules (`profiles.ts`) and `credentials:'omit'`.
- `src/shared/api/authApiClient.ts` -- add `refresh(refreshToken)`, reusing `request()` (L105) with its timeout and the auth profile. Never retried.
- `src/shared/api/dto/tokens.ts` -- confirm schema (`MIN_EXPIRES_IN_S`). Refresh needs a lenient variant: `refresh_token` and `expires_in` optional, and an invalid `expires_in` keeps the previous expiry.
- `src/shared/api/sessionManager.ts` -- extend:
  - `SessionStatus` gets `expired`;
  - `readSession` (L119) keeps the session in memory;
  - add the coordinator (new `refreshCoordinator.ts` beside it), the generation counter, `getAccessToken()`, `validate()` (E1, single-flight) and a lifecycle hook.
  - The stored `expiresAt` is epoch **ms**. `signIn` order stays unchanged.
- Port from `git show spike/1-4-refresh-logout:src/app/spike/refreshCoordinator.ts` and its `__tests__/refreshCoordinator.test.ts`:
  - port the single-flight logic, the `usedToken` check on 401, `sessionAfterRefresh` and the test scenarios;
  - fix the spike's gaps: adopt-before-save, no timeout, no generation guard, seconds-based expiry.
- `src/shared/api/appError.ts` (new) -- `AppError(kind)`, `isAppError`, status mapping and the retry table. `authError.ts` stays for the auth flows.
- `src/shared/platform/secureStore.ts` -- `sessionSecureStore.write/read`, `ReadResult`. Reuse as is.
- `src/app/App.tsx` -- the startup gate (L105-122). Add the E1 kick-off after boot, the `AppState` listener, demo wiring and the badge overlay. Do not change the splash and Welcome paths.
- `src/features/home/HomeScreen.tsx` -- add an offline StateView variant with «Повторить» (`useZoneItem`, so the Shell's FocusZone can focus it). The Shell (`src/app/Shell.tsx`) passes the status down through props; features do not import `app`.
- Debug-only live-refresh trigger: a `__DEV__`-only Настройки row like «Проверка фокуса» (`src/features/settings/SettingsScreen.tsx`, `SETTINGS_FOCUS_CHECK_ID` pattern, App passes the callback only under `__DEV__`). It calls a dev-only `SessionManager` hook that corrupts the in-memory access token and then runs `validate()`. Extend `__tests__/releaseBundle.test.js` markers with its id.
- `src/shared/ui/StateView.tsx`, `tokens.ts` (`overlay-badge`, `typography.badge`) -- reuse.
- `src/shared/i18n/ru.ts` -- `error.*` exists. Add `home.offline.title` («Нет подключения к интернету»), `home.offline.body`, `common.retry` («Повторить») and `demo.badge` («ДЕМО»).
- `src/test/fixtures/boosty/` -- `{case,status,body}`. Add E1 200 and refresh 200/400 fixtures with tokens set to `redacted`; `invalid_grant` is allowed as an `error` enum.
- `android/app/build.gradle` (release block L91), `.github/workflows/ci.yml` (L31 bundle, L54 assembleRelease) -- the demo-flag release guard.
- Deferred items this story closes: restore flow tests, staggered 401 / sign-out during refresh / save-failure / `expires_in` tests, E1 at start and on resume, and "restore ignores a past `expiresAt`" (a past expiry → proactive refresh at the first request).

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/api/appError.ts`, `httpClient.ts` + tests -- AppError mapping, AD-6 retries (GET only), transport seam, token from SessionManager, 401 → refresh hook.
- [x] `src/shared/api/authApiClient.ts`, `dto/tokens.ts`, `refreshCoordinator.ts`, `sessionManager.ts` + tests -- refresh, single-flight, persist-before-adopt, generation guard, `expired`, `validate()`; every matrix row from Proactive through Sign-out race, plus the spike scenarios and no secret in logs.
- [x] `src/shared/api/fixtureTransport.ts`, fixtures -- one transport for tests and demo; `npm run check:fixtures` clean.
- [x] `src/app/App.tsx`, `src/app/appConfig.ts`, `Shell.tsx`, `src/features/home`, `ru.ts`, the badge -- E1 at start and resume, the offline StateView, demo mode and badge, the `expired` route per the owner's answer; flow tests (offline start, «Повторить», resume, demo badge, no SecureStore write in demo).
- [x] `android/app/build.gradle`, CI -- the release build fails with `DEMO_MODE = true` (prove it once by flipping the flag locally, then revert).
- [x] Device (release-like, `adb install -r`): cold start → Shell with no sign-in, E1 live in logcat (path and status only); resume (Home → app) runs E1; on the **debug** build (Metro on a free port + `adb reverse`), the one live refresh via the debug-only trigger: logcat shows E1 401 → `/oauth/token/` 200 → E1 200 (paths and statuses only), then a cold start of the release-like build still opens the Shell with the rotated session. The trigger is `__DEV__`-only and absent from the release bundle. Record in `docs/testing.md` and update `docs/api-contract.md` §2.3 if anything new is observed.

**Acceptance Criteria:**
- Given the owner's stored session on the device, when the app cold-starts or resumes, then the Shell is shown without sign-in and E1 runs once, with no visible change.
- Given the full check suite and the release bundle, when run, then all pass, and the release build fails if `DEMO_MODE` is true.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL with `DEMO_MODE = false`; FAILED with `true`.

## Spec Change Log

- 2026-10-26, review loop 1. Two intent gaps raised by review were resolved by the owner and applied as patches (no revert; the rest of the implementation is kept as is):
  - Refresh cooldown: after a refresh `failed` outcome the coordinator does not start another refresh for 30 s; requests in that window fail with the same kind at once. Avoids sequential refresh storms when `expiresAt` is past and the token endpoint answers 429/5xx/network.
  - `expired` wipes the stored session (SecureStore session entry only; the phone entry is kept for re-login). The next cold start opens A1 «Войдите снова» directly, with no Shell flash. Triggered only by a real refresh 400 `invalid_grant`.

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|---|---|---|---|
| 1 | edge | `signOut` bumps generation before clearing; a refresh started in that window persists with the new generation after the clear | high | patch: `host.current()` still returns the session while status is `signedIn`, so `persist(next, G+1)` passes its check and writes after `clear` |
| 2 | blind+edge | Proactive refresh failure fails the request even when the token is not yet expired | medium | patch: `getAccessToken` throws on `failed` regardless of `expiresAt`; the spec says tokens are kept and the request surfaces its own kind |
| 3 | blind | No cooldown between sequential failed refreshes (request storm) | medium | intent gap → owner: 30 s cooldown (Change Log) |
| 4 | blind | Expired session stays in storage; every cold start flashes the Shell, then A1 | medium | intent gap → owner: wipe the session entry on `expired` (Change Log) |
| 5 | blind+edge | `openSignInAgain` is dropped when the navigator is not ready | low | patch: `onNavigationReady` must reset to A1 when the status is already `expired` |
| 6 | verification-gap | «Повторить» busy state is untested | gap | patch: test |
| 7 | verification-gap | Offline view only for `Network` is untested (Server/Parse/Client must keep the placeholder) | gap | patch: test |
| 8 | blind | `RefreshCoordinator.refresh()` is unused public surface | low | patch: delete |
| 9 | edge | FixtureTransport `hang` never settles when the signal is already aborted | low | patch: one-line check |
| 10 | blind+edge | `saveFailed` / unparseable 200 keep a refresh token the server may have spent | low | rejected: the frozen intent mandates keeping the old state; the outcome is a later `invalid_grant` → `expired` → re-login, which is safe and loop-free |
| 11 | blind | A 401 that persists after a successful refresh stays `signedIn` silently | false | rejected: the matrix row «401» mandates `Client`, `signedIn`, no second refresh |
| 12 | blind | Demo mode does not swap the module-level `httpClient` export | medium | defer: no consumer imports `httpClient` yet; Epic 3 repositories must take the client from the active session (deferred-work) |
| 13 | verification-gap | `expired` clearing `homeOffline` is untested | gap | defer per filed disposition (A1 route is replaced by A11 in 2.6) |
| 14 | blind | `signOut` phone-clear failure leaves storage and memory out of sync | low | rejected: no sign-out UI until 2.7; 2.7 owns sign-out semantics |
| 15 | blind | No loading indication during a long background E1 | false | rejected: the intent says E1 runs in the background with no visible change |
| 16 | blind | `useZoneItem('')` in release | false | `itemRef('')` returns a ref callback that is never attached (the row is not rendered); no registration happens |
| 17 | blind | Release-like E1 only indirectly verified | false | docs/testing.md already states it explicitly |
| 18 | blind | `refreshed` flag overloaded by `fixedAccessToken` | low | rejected: documented at the call site; renaming adds surface for no observed defect |
| 19 | blind | Docs inconsistencies (sprint status, 2.4 done, 10-year `expires_in` cap) | false | sprint status is workflow-managed; 2.4 `done` was the owner's uncommitted edit before this story; `MAX_EXPIRES_IN_S` predates the diff |
| 20 | blind | `ci.yml` unchanged; CRLF | false | `npm test -- --ci` runs `demoModeOff.test.js` in CI; the repo has no CRLF policy |
| 21 | blind | Debug session-check row shows no on-screen result | low | rejected: dev-only, verified via logcat as the spec prescribes |
| 22 | edge | `signIn` over a live session refreshes the old pair | false | `signIn` runs only from A1–A3, where the status is `signedOut`/`expired` and `host.current()` is null |
| 23 | edge | Repeated `restore()` while signed in sends requests without a token | false | `restore()` is called once at boot; no caller re-invokes it while signed in |
| 24 | edge | AppState emits background→active at cold start → double E1 | maybe-false, low | rejected: not observed on the device (one E1 in logcat at cold start) |
| 25 | edge | `decodeForm` with `=` or bad percent-encoding | false | values come from `encodeForm`, which percent-encodes `=` |
| 26 | verification-gap | Gradle hook relies on the task name `createBundleReleaseJsAndAssets` | low | rejected: the manual flip check is recorded; the Jest guard covers CI |
