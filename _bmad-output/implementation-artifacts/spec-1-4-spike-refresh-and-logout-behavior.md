---
title: 'Story 1.4: Spike — refresh and logout behavior'
type: 'chore'
created: '2026-10-25'
status: 'done'
baseline_commit: 'a2ff49239af13996e5572244b72baa8b26264602'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/testing.md'
  - '{project-root}/docs/adr/0006-secure-storage-keychain-reset-helper.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AD-3 needs facts about token refresh on the real API that have not been observed yet:
- single-flight refresh under concurrency;
- the 401 → refresh → retry path;
- what a rejected refresh looks like;
- behavior on network loss;
- refresh-token rotation and the `device_id` dependency;
- that logout leaves nothing behind.

**Approach:**
1. On the throwaway branch `spike/1-4-refresh-logout` (built on the Story 1.3 spike, which already holds the owner's session), add a spike refresh coordinator and a «Сессия: обновление и выход» check screen.
2. Use them to run each scenario once against the real API with the stored session.
3. Record sanitized results (status, shapes, rotation yes/no) in `docs/api-contract.md` §2.3 and `docs/testing.md`.

## Boundaries & Constraints

**Always:**
- Only the endpoints in `docs/api-contract.md`: `POST /oauth/token/` with the §2.3 form fields and headers, and E1 as the probe call.
- Single-flight: one shared promise for concurrent callers. At most one refresh per trigger; at most one retry of the original request; no loops.
- Corruption is simulated only in the stored copy on the device: alter the stored access or refresh token value. Never send another person's token.
- Keep the previous valid tokens in memory until the corruption checks are over, so the session can be restored. If a check leaves the account signed out, report it; the owner signs in again with the Story 1.3 screen.
- The same rules as Story 1.3: no tokens, phone or codes in logs, docs or the repo; sanitized recordings only; each case once.

**Never:**
- Production auth code.
- Server-side revoke calls (`DELETE /oauth/token` is unverified, so it is not used).
- Deleting or changing anything outside this app's own storage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Proactive refresh | Stored expiry forced into the past; 5 concurrent E1 calls | Exactly 1 refresh request; 5 E1 → 200 | — |
| Reactive refresh | Stored access token corrupted | E1 401 → 1 refresh → 1 retry → 200 | No second refresh |
| Rejected refresh | Stored refresh token corrupted (and access token corrupted) | 1 refresh → recorded 4xx shape → «expired» | No loop; no retry storm |
| Network loss | Refresh request fails at the transport level (simulated in the coordinator) | Tokens kept; status stays signed-in; error kind Network | No sign-out |
| Logout | «Выйти» | Secure store empty, in-memory session cleared, `device_id` kept (device-scoped) | — |

## Decisions (owner, 2026-10-25)

- **Logout on the device**, as the very last check. The owner signs in again by phone (Story 1.3 screen) before Story 1.5.
- **`device_id` dependency:** test it once, as the last check before logout: send one refresh with a different `device_id`. If Boosty rejects it or the session becomes invalid, record that; the logout check still runs afterwards.
- **Check order:** proactive → reactive → rotation → network loss → rejected refresh (restore the valid tokens from memory afterwards) → `device_id` → logout.

</frozen-after-approval>

## Code Map

- Base: branch `spike/1-4-refresh-logout` = Story 1.3 spike + `main`. Reuse `src/app/spike/phoneAuthApi.ts` (web headers, sanitizers), `spikeSecureStore.ts`, `spikeNative.getInstallId`, and the Story 1.3 session format (`sessionFromTokens`/`decodeSession`).
- `src/app/spike/refreshCoordinator.ts` (new) -- single-flight refresh. Exposes `callWithSession(fn)`, which attaches the Bearer token, refreshes proactively when fewer than 300 s remain, and reacts to a 401 with one refresh and one retry. The "refresh rejected" signal is configurable until it is observed. A transport error during refresh keeps the tokens and returns Network.
- `src/app/spike/SessionRefreshCheck.tsx` (new) + menu entry -- buttons for each matrix row, plus «Выйти». Shows sanitized results and request counts.
- `docs/api-contract.md` §2.3, `docs/testing.md` -- `LIVE` evidence rows.
- Device: `adb-25311HFDD69E8B-SKv3Ox._adb-tls-connect._tcp`, release-like build signed locally with the SDK debug key, `-PreactNativeArchitectures=armeabi-v7a`.

## Tasks & Acceptance

**Execution:**
- [x] `refreshCoordinator.ts` + unit tests -- single-flight, proactive, reactive, rejected (no loop) and network (tokens kept), with mocked fetch.
- [x] `SessionRefreshCheck.tsx` + menu entry -- runs the matrix on the device and shows request counts.
- [x] On the device: each matrix row once, using the stored session; record rotation (does refresh return a new `refresh_token`? does the old one still work?) and the `device_id` result (last check before logout).
- [x] `docs/api-contract.md` §2.3, `docs/testing.md` -- results.

**Acceptance Criteria:**
- Given the forced-expiry state, when 5 E1 calls start together, then the device log shows exactly 1 refresh request and 5 successful E1 calls.
- Given a corrupted refresh token, when an API call runs, then exactly 1 refresh is sent, its status and shape are recorded, and no further request follows.
- Given logout, when the store is read back, then it is empty and `device_id` is unchanged.
- Given the logcat captured during the story, when it is scanned for tokens (60+ char runs), full or partial phone numbers and `Bearer `, then nothing matches.

## Implementation Notes

- Device run 2026-10-25 (release-like, keys injected via adb): all matrix rows passed; rotation yes, rotated-out token → 400 `invalid_grant`; rejected refresh signal = 400 `invalid_grant`; different `device_id` → 400 `invalid_grant` (ambiguous, see `docs/api-contract.md` §2.3); logout clean, `device_id` kept. The account is signed out on the device.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind, edge | The default rejection predicate treated every 400/401 from refresh as «expired»; a non-`invalid_grant` 4xx would sign the user out | high | patch | `defaultIsRefreshRejected` narrowed to `400 && error === "invalid_grant"`; tests cover other 4xx |
| 2 | verification-gap | No test for "proactive refresh, then 401 on the probe" (must not refresh twice) | medium | patch | Test added in `refreshCoordinator.test.ts` |
| 3 | blind, edge | No timeout or abort on refresh; a hung request holds the single-flight promise | medium | patch | Production requirement in api-contract §2.3; deferred-work |
| 4 | blind | New pair adopted in memory even if the save fails; refresh tokens are single-use, so the session is lost on restart | high | patch | "Persist before adopt" requirement in api-contract §2.3 |
| 5 | edge | An unparseable 200, or a lost response after the server processed the refresh, burns the refresh token | medium | patch | "Burned-token risk" requirement in api-contract §2.3 |
| 6 | edge | signOut or reload during an in-flight refresh can turn «signed-out» into «expired» or resurrect the session | medium | patch | Generation-guard requirement in api-contract §2.3; tests deferred |
| 7 | blind | `expires_in` not validated; 0 or NaN would cause a refresh storm | medium | patch | Validation requirement in api-contract §2.3 |
| 8 | blind | Logout clears memory before the store; a failed clear leaves tokens on disk silently | low | patch | Logout-order requirement in api-contract §2.3 |
| 9 | verification-gap | Network-loss row is simulated in JS; a real network drop was not tested | medium | patch | Labeled in testing.md; deferred-work |
| 10 | verification-gap | The `device_id` result is confounded by the earlier reuse of a rotated-out token | medium | defer | api-contract §2.3 marks it ambiguous; deferred-work (re-test at Story 1.5 with owner approval) |
| 11 | blind | The `device_id` suffix is logged; earlier scans missed partial phone numbers | low | patch | testing.md log-hygiene note; the Story 1.4 scan included partial numbers |
| 12 | verification-gap | Second-account isolation (S10) not tested | low | defer | deferred-work (Story 2.8) |
| 13 | edge, blind | Spike-only screen issues (button busy guards, result overwrite, restore helper edge cases) | low | reject | Throwaway spike; production stories get their own specs and tests |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.
