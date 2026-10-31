---
title: 'Story 8.3: Hidden diagnostics for testing'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '61440e97e3530152ff8e0b587061fee4a71f4140'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The release build has no way to capture what happened on the TV, and the Logger's redaction misses cookies, non-Bearer Authorization, keyed tokens, `signedQuery` and secret field names (FR54, AD-14).

**Approach:** Seven OK presses on «Версия» open a hidden Diagnostics route. It has a «Запись логов» toggle, «Очистить логи» and adb retrieval steps. While capture is on, every redacted Logger entry also goes to a capped file written by a small native module. `AccountScope.reset()` clears the ring and the file.

## Boundaries & Constraints

**Always:**
- Gated by a new `phaseFlags.diagnostics` flag. The route ships in release; only the gesture reveals it.
- Seven presses within 2 s of each other open it; the count resets after a 2 s gap. A single press does nothing visible. The press handling lives in a reusable hook so Epic 9 can add the single-press update check (at most once per 60 s) without the gesture triggering more than one check.
- The capture toggle is device-scoped, default off, key `diagnostics.capture.v1`. Turning it on writes the current ring first, then streams new entries.
- Redaction happens before anything is stored (ring and file). New rules:
  - `Cookie:` / `Set-Cookie:` values;
  - any `Authorization:` value;
  - `access_token`, `refresh_token`, `token`, `signedQuery`, `sig`, `signature` as query or JSON keys;
  - a bare query string carrying `expires=` or `sig=`;
  - field keys named token / cookie / authorization / signedQuery / phone / code (any case) get their values redacted.
- The file is capped at 256 KB with one rotated copy (≤ 512 KB in total). Writes are batched (≤ 1 s or 20 entries) and run on one native serial thread, so a `clear` posted after an `append` always wins.
- Account scope: the log store is registered at bootstrap. On reset, JS drops queued entries of the old generation (`accountScope.guard`) and the native file is cleared. Entries written after the reset belong to the new account only.
- The file lives in app-specific external storage (`getExternalFilesDir(null)/logs/boostytv.log`, rotated `boostytv.log.1`) so `adb pull /sdcard/Android/data/io.github.dzmitryafanasenka.boostytv/files/logs/` works on a release build (owner decision 2026-10-31; release builds are not debuggable, so `run-as` cannot read internal storage).
- No share sheet, upload, telemetry or crash reporting. `allowBackup=false` stays.
- Copy in `ru.ts`.

**Never:**
- No logging of bodies, the phone, the challenge or the code by any caller: redaction is the safety net, not the policy.
- No readout of log lines on the TV screen.
- No new JS dependency (no react-native-fs).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gesture | 7 OK on «Версия», each < 2 s apart | Diagnostics opens; Back returns to Настройки with focus on «Версия» | — |
| Slow presses | 7 OK with a gap ≥ 2 s | Nothing opens; the count restarts | — |
| Capture on | Toggle → «Вкл» | The ring is dumped, then new entries are appended to the file | A native failure logs one warning (ring only) and the toggle stays on |
| Capture off | Default or toggled off | Nothing goes to the file; the ring works as today | — |
| Clear | «Очистить логи» | Ring and file empty | — |
| Reset | Sign-out or account switch | Ring and file empty; queued old-generation entries are dropped | A failed native clear is reported in `failed[]` like other stores |
| Cap | The file passes 256 KB | It rotates to `.1`; the oldest copy is replaced | — |
| Redaction | Each secret kind above in a message, a field value or a field key | Redacted marker in ring and file | — |

</frozen-after-approval>

## Code Map

- `src/shared/services/logger.ts` -- `createLogger`, `redact()` (l.41-49 regexes), the ring (200), `loggerAccountStore`. Add the new redaction rules, field-key redaction and an optional sink hook. Keep the existing behaviour and tests.
- `src/shared/services/__tests__/logger.test.ts` -- the redaction table; extend it with every new secret kind.
- `src/shared/account/accountScope.ts` -- `guard(store, write)` / `isCurrent()`. The file sink is its first async writer; follow its doc comment.
- `src/app/bootstrap.ts` l.36-47 and `__tests__/accountScopeRegistry.test.js` -- register the file-clearing store (or extend `loggerAccountStore` so it clears both).
- `android/.../KeychainStorageResetModule.kt` -- a `File` IO template. New `LogFileModule.kt` (append batch, clear, path; single-thread executor) registered in `BoostyNativePackage.kt`; the port goes in `src/shared/platform/logFile.ts`.
- `src/features/player/externalPlayerPreference.ts` -- the template for `diagnosticsCapturePreference` (device KV). Wire the demo store in `src/app/session.ts`.
- `src/shared/ui/SettingRow.tsx` l.79/100 -- `info` drops `onPress`. Allow an optional `onPress` on `info` without changing its look or role semantics.
- `src/features/settings/SettingsScreen.tsx` l.118-125 -- the «Версия» row. Wire `useVersionPresses` (new, `src/features/settings/`); the callback comes through `Shell.tsx` `SettingsSection` like `externalPlayer`.
- `src/app/routes.ts`, `App.tsx` `<Stack.Screen>` list, `src/app/dev/devFocus.tsx` (template) -- the new `Diagnostics` route in `src/features/settings/DiagnosticsScreen.tsx`, with a BackHandler pop like `stackRoutes`. Focus returns to «Версия».
- `__tests__/releaseBundle.test.js` -- Diagnostics must NOT be on the debug-only marker list.
- `src/app/phaseFlags.ts` + test -- `diagnostics: true`.
- `src/shared/i18n/ru.ts` -- `settings.diagnostics.*`; `__tests__/noRawText.test.js` forbids raw strings.

## Tasks & Acceptance

**Execution:**
- [x] `logger.ts` + test -- redaction rules, field-key redaction, sink hook.
- [x] `LogFileModule.kt`, `BoostyNativePackage.kt`, `src/shared/platform/logFile.ts` + test -- `append(lines[])`, `clear()`, `location()`; rotation at 256 KB; never logs content.
- [x] `src/shared/services/logFileSink.ts` + test -- batching, generation guard, ring dump on enable, the capture preference, the reset store, bootstrap registration.
- [x] `useVersionPresses`, `SettingRow` info `onPress`, `SettingsScreen`, `Shell.tsx`, `DiagnosticsScreen.tsx`, route wiring, `ru.ts`, `phaseFlags` -- per the matrix.
- [x] Tests -- matrix rows; settings and diagnostics flow (gesture, slow presses, Back order, toggle, clear); reset clearing ring + file and dropping stale batches; release-bundle check.
- [x] Docs -- `docs/feature-parity.md` SET-04/SET-05, `EXPERIENCE.md` as-built, `docs/focus-map.md` Diagnostics, `docs/testing.md` Story 8.3 with the adb steps.

**Acceptance Criteria:**
- Given the flag off, when «Версия» is pressed any number of times, then nothing opens.
- Given capture on and a sign-out, when the next account logs, then the file holds no line from the previous account.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter B, Edge Case Hunter E, Verification Gap V):

| # | Finding | Verdict | Evidence / route |
|---|---------|---------|------------------|
| 1 | B2: http paths carry blog slugs and post ids (viewing history) into the file | high | `transport.ts` `logPath` strips host and query only; E3/E4/E8 paths name the author and post. CLAUDE.md: redact personal data from diagnostics. patch (mask path segments) |
| 2 | B1: API 24-28 external files dir readable by apps with READ_EXTERNAL_STORAGE | medium | minSdk 24; scoped storage starts at API 29. patch (internal `filesDir` below API 29, documented) |
| 3 | B3/E6: batched lines lost on background or kill | medium | 1 s timer, no AppState flush. patch (flush on background) |
| 4 | B4: turning capture off leaves the file on disk | medium | No delete on disable; the copy only says to turn it off. patch (disable clears the file; copy says so) |
| 5 | B5/E3/E13/E1: field keys sig/signature and compact keys (accesstoken, smscode, phonenumber); prefixed query keys (id_token=, api_sig=) | low | `isSecretFieldKey` word-split only; `\b` before keys. Direct regex fixes. patch |
| 6 | B6: the `code` key rule hides statusCode etc. | false | The spec mandates any-case `code`; current callers checked (only AudioBlock, renamed) |
| 7 | B7: no on-screen sign that writes fail | low | Rare; one warning in the ring. rejected |
| 8 | E8/B8: one rename failure stops the file for good | low | `rotate` throws on every append after. Direct fix (truncate on rename failure). patch |
| 9 | B9: clear status never resets / no live region | low | Cosmetic. rejected |
| 10 | B10: application id typed into the adb command copy | low | No flavors or suffix exist. rejected |
| 11 | B11: press counter uses Date.now and survives blur | low | Clock jumps mid-gesture are negligible. rejected |
| 12 | B12: info row role text / JSDoc wrap | low | Cosmetic; TalkBack not a release path. rejected |
| 13 | E2: JSON array or escaped quote under a secret key | low | No caller logs such shapes. rejected |
| 14 | E4: line cut inside a surrogate pair | low | Cosmetic replacement char. rejected |
| 15 | E5: `warned` never resets after recovery | low | Diagnostics-only. rejected |
| 16 | E7: clear with no external storage reports success | low | No storage means no file to leak. rejected |
| 17 | E9: per-instance executor across a bridge reload | low | Release builds do not reload. rejected |
| 18 | E10: DiagnosticsScreen `read()` rejection unhandled | low | Direct fix (catch → off). patch |
| 19 | E11: flag off leaves an old file | low | The flag is on; turning it off is a future build decision. rejected |
| 20 | E12: old-account in-flight logs after reset | maybe-false | Entries after the reset carry the new generation; would need caller-level guards. rejected (low if true) |
| 21 | V1: startup resume of capture untested | medium | Device run proved it works; no host test. patch (test) |
| 22 | V2: info row press scale untested | low | patch (test) |
| 23 | V3: clear-failed UI untested | low | patch (test) |
| 24 | V4: native rotation/order guarded only by source text | medium | No JVM test infra. defer |
| 25 | V5: AudioBlock `code`→`error` rename unpinned | low | patch (test) |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npx tsc --noEmit && npm run check:fixtures && npm test` -- expected: all clean and green.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL (avoid a slash-star inside Kotlin comments).

**Manual checks (if no CLI):**
- Chromecast: the gesture opens Diagnostics; capture on → the adb steps on screen retrieve a file whose lines contain no URL query, token or phone.
