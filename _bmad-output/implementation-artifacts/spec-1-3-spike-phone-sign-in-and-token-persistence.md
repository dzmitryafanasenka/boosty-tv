---
title: 'Story 1.3: Spike — phone sign-in and token persistence'
type: 'chore'
created: '2026-10-25'
status: 'done'
baseline_commit: 'd2f95fbbcff9d7f7baa029263adb5c668f1b06ac'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/android-tv-auth-playback-spike.md'
  - '{project-root}/docs/adr/0006-secure-storage-keychain-reset-helper.md'
  - '{project-root}/docs/testing.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The chosen sign-in, a phone number plus a one-time code via Boosty's phone-auth API, has never been run against the real API on the TV. Three things are unproven:
- the request and error shapes and any captcha requirement;
- that the session survives restarts and reboots in secure storage;
- the storage-reset helper from ADR 0006.

**Approach:** On the throwaway branch `spike/1-3-phone-auth`, add a spike-only «Вход по телефону» check screen where the owner signs in with the remote and the system keyboard. Store the tokens via react-native-keychain behind a spike SecureStore wrapper that includes the native storage-reset helper and the ADR 0006 error classification. Then:
- record sanitized response shapes as `LIVE` evidence in `docs/api-contract.md`;
- run the persistence and corruption matrix on the device;
- report a captcha, if one appears, as a release blocker.

## Boundaries & Constraints

**Always:**
- **Exactly the requests in `docs/api-contract.md` §2.2 and E1.** No other endpoints.
- **One install-scoped `device_id`.** A UUIDv4 generated once per install and kept in non-secret storage. Send it as `device_id` and `X-From-Id`.
- **No secrets in logs, recordings or the repo.** Never log, persist outside secure storage, print to logcat, put in docs or commit the phone number, challenge `code`, SMS code, `access_token` or `refresh_token`. Sanitized recordings keep only:
  - HTTP status;
  - top-level key names and value types;
  - non-identifying enums such as `sentTransport`.
- **Each error case triggered once, then stop.** Never retry automatically.
- **Captcha stops the sign-in work.** If Boosty asks for extra verification, stop sign-in attempts and report it to the owner. S1 website sign-in research only runs if the owner asks.
- **Device results only.** Results are recorded from the physical device, with owner-reported steps labeled as such.

**Never:**
- Production auth code.
- Refresh logic (that is Story 1.4).
- Storing tokens in plain storage.
- Showing the phone number or tokens on screen beyond masked hints.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Read: storage file unreadable | `CorruptionException` | Helper deletes the file, reset, «signed-out»; a later save+read works (same process, or the restart need is recorded) | No crash |
| Read: value undecryptable | `CryptoFailedException` / key invalidated | Reset, «signed-out» | No crash |
| Read: other error | Forced generic error | Data kept, «recoverable storage error» with one retry; not signed out | No crash |
| Masking | Phone `+375291234567` | Screen shows `+375 •• ••• 45 67`; never the full number in logs | — |

## Decisions (owner, 2026-10-25)

- **Repeated attempts:** not triggered. The "too many attempts" shape is recorded as unverified.
- **Phone linkage:** the owner confirmed that the `+375` number is linked to the Boosty account with the subscriptions.
- **Reboot:** the agent may reboot the Chromecast via `adb reboot` for the persistence check, after telling the owner. The owner sends the new wireless-debugging port.

</frozen-after-approval>

## Code Map

- Base: branch `spike/1-3-phone-auth` = Story 1.2 spike (`src/app/spike/*`, spike menu in `src/app/App.tsx`, keychain 10.0.0, `KeychainCheck` patterns) merged with `main`.
- `src/app/spike/PhoneAuthCheck.tsx` (new) -- steps: phone field (system keyboard, OK opens it) → «Получить код» → code field → «Войти» → E1 check → «Сессия сохранена». Also «Проверить сессию» (read tokens → E1) and a debug panel with sanitized results.
- `src/app/spike/phoneAuthApi.ts` (new) -- `fetch` calls for send/confirm/E1 with the web header set (`X-App: web`, `X-Locale: ru_RU`, `Referer`/`Origin: https://boosty.to`, desktop UA). Unauthenticated, except E1 with Bearer. Returns `{status, shape}` sanitizers.
- `src/app/spike/spikeSecureStore.ts` (new) -- wraps keychain with the ADR 0006 classification and the helper.
- `android/app/src/main/java/io/github/dzmitryafanasenka/boostytv/KeychainStorageResetModule.kt` (+ package registration) -- `deleteKeychainStorage()` deletes `files/datastore/RN_KEYCHAIN.preferences_pb` (and only that file).
- `docs/api-contract.md` §2.2 -- add `LIVE` evidence rows (status + shapes, date, device).
- `docs/testing.md` -- Story 1.3 results table.
- `docs/adr/0006-…` -- record the gate result; if it fails, a new ADR for the own Keystore module.
- Device serial `adb-25311HFDD69E8B-SKv3Ox._adb-tls-connect._tcp`; build with `-PreactNativeArchitectures=armeabi-v7a`.

## Tasks & Acceptance

**Execution:**
- [x] `KeychainStorageResetModule.kt` + registration -- native delete helper.
- [x] `src/app/spike/spikeSecureStore.ts` + unit tests -- classification per the matrix (helper mocked).
- [x] `src/app/spike/phoneAuthApi.ts` + unit tests -- request building (form encoding, headers, E.164) and sanitizers (no values leak).
- [x] `src/app/spike/PhoneAuthCheck.tsx` + menu entry -- the flow above, D-pad usable, masked phone.
- [x] On device with the owner: sign-in; the wrong-code, expired-code and too-soon-resend cases (repeated attempts not triggered); kill / cold start / reboot persistence; corruption matrix.
- [x] `docs/api-contract.md`, `docs/testing.md`, ADR 0006 status -- record results.

**Acceptance Criteria:**
- Given the owner's phone and code entered with the remote, when sign-in completes, then E1 succeeds and «Сессия сохранена» shows.
- Given each error case triggered once, when its response arrives, then the status and sanitized shape are recorded with `LIVE` evidence.
- Given a saved session, when the app is killed, cold-started and the device rebooted, then «Проверить сессию» succeeds without signing in again.
- Given `adb logcat` captured during the whole story, when it is searched for the phone digits, the SMS code and token prefixes, then nothing matches.
- Given a captcha appears, when it is detected, then work stops and the owner gets the observation as a release blocker.

## Implementation Notes

- Device work (agent, 2026-10-25): storage matrix on the debug build (transient, ciphertext and file corruption, kill/cold start; the ADR 0006 same-process gate passed) and D-pad reachability of the phone step on the release-like build.
- Owner session (2026-10-25, release-like, physical remote): sign-in passed (send 200, code via Telegram, `sentTransport=gate` even on the first send; resend at 32 s 200; resend at 2 s and 5 s 429 `sms_gate_ratelimit`; wrong code 400 `invalid_sms_code`; confirm 200 with 64-char opaque tokens, `expires_in=2592000`; E1 200). Kill/cold start and reboot passed, so the ADR 0006 gate is fully passed. logcat scan clean. No captcha observed.
- Not verified: expired challenge (the code was entered within the window), `expiresIn` units (604800), the confirm attempt limit (not triggered by owner decision). Deviation: resend-too-soon was triggered three times (pressed three times), not once.
- The tokens are not JWTs, so future logcat scans look for alphanumeric runs of 60+ characters and `Bearer `, not `eyJ`.
- Fix after the session: the send log line carried the masked phone hint (last 4 digits). The masked hint now stays on screen only; the log says "phone hint shown" (asserted in `PhoneAuthCheck.test.tsx`).
- `device_id` storage: there is no non-secret storage library on the branch, so a small native `InstallId` module keeps the UUIDv4 in an app-private SharedPreferences file. It is registered with the reset helper in `BoostyNativePackage.kt`. The reset helper still deletes only the keychain file, so `device_id` survives it.
- The phone field uses `keyboardType="number-pad"` + `secureTextEntry` (Android numberPassword). With `phone-pad` the field showed the digits in clear (found on the device). The phone is entered with the country code and without "+"; a "+" is accepted if typed. National formats are not guessed.
- Requests use `credentials: 'omit'`, because otherwise RN Android stores `Set-Cookie` in the shared native cookie jar (plain storage).
- Tokens are saved only after E1 returns 200, as one JSON value `{v, accessToken, refreshToken, expiresAt, savedAt}` in a dedicated keychain service. `expiresAt` treats `expires_in` as seconds (unverified).
- Any response body mentioning a captcha stops further sign-in requests on the screen until it is reopened.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind | ADR 0006 omits that file-level recovery wipes every keychain entry | medium | patch | Added to ADR 0006 Consequences |
| 2 | blind, verification-gap | Helper ignores the `file.delete()` result and the `.tmp` sibling; `fileDeleted` can be misleading | medium | patch | Recorded as a production-helper requirement in ADR 0006 (spike helper unchanged) |
| 3 | blind | Partial phone digits left in the device log buffer; no post-fix rescan; scan missed partial numbers | medium | patch | Buffer cleared, local copies deleted; testing.md records it and the partial-number scan rule |
| 4 | blind | Token scan pattern `[A-Za-z0-9]{60,}` may miss tokens with `-_.` | low | patch | Rescanned with `[A-Za-z0-9._~+/=-]{60,}` on app lines: only paths and package names |
| 5 | blind, edge | Captcha detection can false-positive on E1 or success bodies | medium | patch | Guidance in api-contract §2.2 for production; spike unchanged |
| 6 | blind | No resend cooldown caused the 429s | low | patch | Guidance: keep a 60 s cooldown in production |
| 7 | blind, edge | `busy` guard reads stale state (double OK sends twice) | medium | patch | Guidance: in-flight ref for non-idempotent auth requests |
| 8 | blind | `clear()` unverified on the device | low | patch | testing.md: handed to Story 1.4 |
| 9 | blind, edge | normalizePhone rejects valid short E.164 numbers and leading whitespace | medium | defer | deferred-work (Story 2.2) |
| 10 | blind | Flow-test fixtures differ from the live shapes | low | defer | deferred-work (Story 1.5) |
| 11 | verification-gap | Stored-session restore path and getInstallId memoization untested | medium | defer | deferred-work (production auth/platform) |
| 12 | blind | Expired-code task ticked though unverified | low | reject | The fix would edit this build's spec; unverified status is recorded in Implementation Notes, api-contract and testing.md |
| 13 | blind | sprint-status `in-progress` vs spec `in-review` | false | reject | Step 5 syncs the status |
| 14 | edge, blind | Spike-only UI issues: changeNumber during in-flight, retryStore overwrite, checkSession without catch, test buttons without busy guard, phoneRef retention, describeShape truncation/array enums, InstallId commit() result, E1 non-200 phase | low | reject | Throwaway spike screen; results were gathered deliberately; production stories get their own specs and tests |
| 15 | edge | Recordings walk nested paths, not top-level only as the spec says | low | reject | Nested shapes were needed to record `data.phoneCode.*`; values are still sanitized (types, lengths, allowlisted enums only) |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test` -- expected: exit 0.
- `cd android && ./gradlew assembleDebug assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.
- `adb logcat -d | grep -E '<phone digits>|<code>|[A-Za-z0-9]{60,}|Bearer '` (run locally, never recorded; the tokens are 64-char opaque strings, not JWTs) -- expected: no matches.
