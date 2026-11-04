---
title: 'Story 15.1: «О приложении» and «Сообщить о проблеме»'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '97de3e1924c4546679b26728c708a12ca8d4f57b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A viewer who got the app from someone else cannot see what it is (unofficial, MIT, where the code lives) or where to report a bug, and a bug report without the version and device is hard to act on.

**Approach:** Two new nav rows in Настройки (our improvement IMP-09, FR-66): «О приложении» opens a dialog with the app name, version, «Неофициальный клиент Boosty, не связан с Boosty», «Лицензия MIT» and a QR to the GitHub repository; «Сообщить о проблеме» opens a QrDialog whose QR opens a new GitHub issue with `bug_report.yml`, the `version` and `device` fields prefilled. GitHub supports this: an issue form field's `id` is its URL query parameter for prefill (docs.github.com, «Syntax for GitHub's form schema», `id` key; checked 2026-11-04).

**Owner decisions 2026-11-04:** «О приложении» is a dialog in the modal host (no new route; focus «Закрыть»). Row order: «Системный видеоплеер», «Версия», «О приложении», «Сообщить о проблеме», «Выйти из аккаунта», then the debug rows.

## Boundaries & Constraints

**Always:** both rows in the modal host (Back or «Закрыть» closes, focus returns to the row); the report URL is `https://github.com/dzmitryafanasenka/boosty-tv/issues/new?template=bug_report.yml&version=<versionName>&device=<manufacturer model, Android release>`, every value URL-encoded, a parameter left out when its value is unknown; the device text comes from a narrow `shared/platform` adapter over `Platform.constants` (no new native module); the repository URL is `https://github.com/dzmitryafanasenka/boosty-tv`, built from the existing `UPDATE_REPOSITORY`; QR values are only drawn, never printed in full, logged or stored; «Версия» keeps the initial focus and its press gestures; Russian copy in `ru.ts`.

**Never:** account data in any URL (no name, id, phone, tokens, blog URL); opening a browser on the TV; a new dependency; the debug rows' order or gating changed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open About | OK on «О приложении» | Dialog: «Boosty TV», «Версия 1.2.0», disclaimer, «Лицензия MIT», repo QR, «Откроется на телефоне», focus «Закрыть» | N/A |
| Close | Back or «Закрыть» in either dialog | Dialog closes, focus on its row | N/A |
| Open report | OK on «Сообщить о проблеме» | QrDialog «Сообщить о проблеме» with the issue URL QR | N/A |
| Unknown version | `getVersionName()` null | About shows «Версия неизвестна»; URL has no `version` | N/A |
| Unknown device | constants missing/blank | URL has no `device` (or only the known part) | N/A |
| QR fails | value cannot be encoded | «Не удалось показать QR-код» (existing QrCodeBox) | N/A |

</frozen-after-approval>

## Code Map

- `src/features/settings/SettingsScreen.tsx` -- rows and focus ids (l.9-21: add `SETTINGS_ABOUT_ID = 'settings/row/about'`, `SETTINGS_REPORT_ID = 'settings/row/report'`); the sign-out row's `useZoneItem` + host-view ref pattern (l.141-151) for initiators; new props `onOpenAbout(initiator)`, `onOpenReport(initiator)`.
- `src/app/Shell.tsx` -- pass-through props like `onOpenSignOut` (l.37, 125, 367, 394).
- `src/app/App.tsx` -- `onOpenSignOut` (l.396-407): `modal.open(<…/>, initiator)` template for both dialogs.
- `src/shared/ui/QrDialog.tsx` -- `QrDialog` (title, value, onClose) for the report; `QrCodeBox` for the About dialog's QR; `QR_CLOSE_ID`.
- `src/shared/platform/appInfo.ts` -- `getVersionName()`; add the device text here or in a new `deviceInfo.ts` (`Platform.constants` `Manufacturer`, `Model`, `Release`).
- `src/features/update/releaseInfo.ts:13` -- `UPDATE_REPOSITORY`; reuse, do not duplicate the slug.
- New `src/features/settings/AboutDialog.tsx`, `src/features/settings/reportIssueUrl.ts` (pure URL builder).
- `src/shared/i18n/ru.ts` -- `settings.*` (l.724-731), `qr.*` (l.287-292), `dialog.*` (l.771+); `wordmark: 'Boosty TV'` (l.77) as the app name.
- Tests: `__tests__/signOutFlow.test.tsx` (modal + focus return), `src/shared/ui/__tests__` QrDialog tests, `__tests__/releaseBundle.test.js` (release markers if needed).
- Docs: `docs/focus-map.md` l.564-569 (Настройки rows), `docs/feature-parity.md` l.191 (IMP-09), `docs/testing.md`, EXPERIENCE.md Настройки, CHANGELOG pair.

## Tasks & Acceptance

**Execution:**
- [x] `src/features/settings/reportIssueUrl.ts` + unit tests -- build the URL from version/device, encode, omit unknowns -- pure, testable, no account input in its signature.
- [x] `src/shared/platform` device adapter + test -- device text from `Platform.constants` -- platform access stays behind an adapter.
- [x] `AboutDialog.tsx`, rows in `SettingsScreen.tsx`, wiring in `Shell.tsx`/`App.tsx`, i18n -- the two dialogs.
- [x] Flow test for every matrix row (open, close via Back and «Закрыть», focus return, «Версия» still initial focus and its gestures).
- [x] Docs (focus-map, feature-parity IMP-09, testing device rows, EXPERIENCE.md) and the CHANGELOG pair.

**Acceptance Criteria:**
- Given the release-like build on the pinned TV, when the owner opens both rows and scans the report QR with a phone, then GitHub opens the bug form with the version and device filled in (owner's check; agent via adb for the rows and dialogs).
- Given `npm run lint`, `npm run typecheck`, `npm test`, then all pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | vgap, blind | Default `Platform.constants` read test always passes | medium | Asserts `null \|\| string`; preset constants lack the keys; flow test mocks the module | patch |
| 2 | vgap | Prefill keys not tied to `bug_report.yml` ids | medium | No test reads the template; a renamed id keeps every test green | patch |
| 3 | blind | Manufacturer-prefix check has no word boundary | low | `startsWith` drops «LG» for «LGenius»; one-condition fix | patch |
| 4 | blind | `dialog.about.close` duplicates `qr.close` | low | Same copy, two keys | patch |
| 5 | blind | focus-map Настройки paragraph keeps the old order; new K rows unnumbered; EXPERIENCE «K1–K4» | low | l.566, l.558-559, EXPERIENCE l.43 | patch |
| 6 | blind | testing.md lacks the actual check counts | low | Other stories record them | patch |
| 7 | edge | Whitespace-only version shown untrimmed in About | false | `versionName` comes from build.gradle; never blank in a build | rejected |
| 8 | blind | Add versionCode / build type to the report | low | Not in the intent; template asks the version only | rejected |
| 9 | blind | «Откроется на телефоне» stays when the QR fails | low | Same as the existing QrDialog | rejected |
| 10 | blind | No a11y label tests for the new rows; generic QR label | low | Rows use their visible label like the other nav rows | rejected |
| 11 | blind | AboutDialog reads the version itself, URL via prop | low | No named harm | rejected |
| 12 | blind | Mixed dialog / qr-dialog tokens | false | QrDialog uses the same mix (`components.dialog.maxWidth` + `qr-dialog` radius) | rejected |
| 13 | blind | Device text differs from the template placeholder; no length cap | low | Placeholder is a hint; Android model strings are short | rejected |
| 14 | blind | Sprint status in-progress; spec not in the diff | false | Status moves at the present step; spec excluded on purpose | rejected |
| 15 | blind | No gesture test after the report dialog; console not checked for the URL | low | Same modal host path as About; nothing logs the URL | rejected |

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test` -- all pass.
- `cd android && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- BUILD SUCCESSFUL.
