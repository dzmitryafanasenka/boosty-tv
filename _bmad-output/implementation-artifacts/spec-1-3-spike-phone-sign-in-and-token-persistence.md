---
title: 'Story 1.3: Spike — phone sign-in and token persistence'
type: 'chore'
created: '2026-10-25'
status: 'draft'
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
- [ ] `KeychainStorageResetModule.kt` + registration -- native delete helper.
- [ ] `src/app/spike/spikeSecureStore.ts` + unit tests -- classification per the matrix (helper mocked).
- [ ] `src/app/spike/phoneAuthApi.ts` + unit tests -- request building (form encoding, headers, E.164) and sanitizers (no values leak).
- [ ] `src/app/spike/PhoneAuthCheck.tsx` + menu entry -- the flow above, D-pad usable, masked phone.
- [ ] On device with the owner: sign-in; the wrong-code, expired-code and too-soon-resend cases (repeated attempts not triggered); kill / cold start / reboot persistence; corruption matrix.
- [ ] `docs/api-contract.md`, `docs/testing.md`, ADR 0006 status -- record results.

**Acceptance Criteria:**
- Given the owner's phone and code entered with the remote, when sign-in completes, then E1 succeeds and «Сессия сохранена» shows.
- Given each error case triggered once, when its response arrives, then the status and sanitized shape are recorded with `LIVE` evidence.
- Given a saved session, when the app is killed, cold-started and the device rebooted, then «Проверить сессию» succeeds without signing in again.
- Given `adb logcat` captured during the whole story, when it is searched for the phone digits, the SMS code and token prefixes, then nothing matches.
- Given a captcha appears, when it is detected, then work stops and the owner gets the observation as a release blocker.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test` -- expected: exit 0.
- `cd android && ./gradlew assembleDebug assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.
- `adb logcat -d | grep -E '<phone digits>|<code>|eyJ'` (run locally, never recorded) -- expected: no matches.
