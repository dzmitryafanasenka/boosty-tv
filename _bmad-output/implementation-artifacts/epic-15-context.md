# Epic 15 Context: Settings additions (our improvements)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Add three small rows to Настройки so that a viewer who got the app from someone else can see what the app is, report a bug usefully, and know which account «Выйти» will sign out (owner decisions 2026-11-02). They are our improvements beyond BoostBuddy parity (FR-66; FR-53 amended; parity rows IMP-09 and IMP-10). They are separate rows, not one combined screen. No new Boosty endpoint: the About and report rows are local, and the account name reuses E1 (`GET /v1/user/current`), whose display-name field is not yet verified.

## Stories

- Story 15.1: «О приложении» and «Сообщить о проблеме»
- Story 15.2: Account name next to «Выйти из аккаунта»

## Requirements & Constraints

- **«О приложении» (15.1):** shows the app name, the version, «Неофициальный клиент Boosty, не связан с Boosty», «Лицензия MIT» (the repo's `LICENSE` is MIT) and a QR to the public GitHub repository (`dzmitryafanasenka/boosty-tv`). It can be a screen or a dialog (decided at spec time).
- **«Сообщить о проблеме» (15.1):** a QrDialog with a URL that opens a new GitHub issue using the bug template (`.github/ISSUE_TEMPLATE/bug_report.yml`, whose fields include `version` and `device`). The version and device model are prefilled only if GitHub issue forms support URL-parameter prefill. This is unverified and must be checked at spec time. The URL never carries account data: no name, id, phone or tokens.
- **Account name (15.2):** first, a temporary probe of E1 on the owner's session records in `docs/api-contract.md` which field carries the display name. Record keys and types only and never log a value. Remove the probe before the commit. If no such field exists, the story stops and the owner decides.
- With a name, the «Выйти из аккаунта» row shows it as secondary text. A missing or blank name leaves the row unchanged (today it is a nav row with no subtitle).
- Never show the phone number. The name is account-scoped and never logged.
- Copy is Russian and i18n-ready. Code and docs are English. Do not present capabilities the app lacks.

## Technical Decisions

- Capability map: FR-66 maps to `features/settings`, with `entities/user` for E1, bound by AD-4 and AD-14.
- **AD-4 Account scope:** the name is account data. It must come from the E1-backed `UserRepository` / `me` query, which is already used for «Мой блог». It must live only in the account-scoped query cache, which `AccountScope.reset()` clears on sign-out and account switch, so no other account ever sees it. Do not add a separate store. If one is ever needed, register it at bootstrap.
- E1 parsing today is tolerant: only `id` (and `blogUrl?`) is required, and the rest of the body is ignored. Add the name as an optional, defensively parsed field. A malformed or absent name must never break sign-in or session validation.
- **AD-14 Secrets and diagnostics:** the Logger redacts tokens, phone numbers and signed URLs. A display name is personal data, so it never goes into logs, diagnostics or fixtures. Sanitize any fixture you add.
- Platform access: the version comes from `getVersionName` (`shared/platform/appInfo`). A device model, if prefilled, must also come through a narrow `shared/platform` adapter. No feature touches `NativeModules` directly.
- The QR is rendered on the device by the existing `QrRenderer` (`shared/platform/qrRenderer.tsx`), and the URL is never logged.
- Hidden phase flags gate the existing Настройки rows (`externalPlayer`, `diagnostics`, `updateCheck`). Follow the same pattern if a new row needs a flag.

## UX & Interaction Patterns

- Настройки is a vertical list of SettingRows, moved with ↑ ↓ and no wrap. ← goes to the sidebar. The row kinds are nav, toggle, radio, check and info. Current rows: «Системный видеоплеер» (toggle), «Версия» (info, the initial focus; 7 OKs open Diagnostics, and the first OK can open the update dialog), «Выйти из аккаунта» (nav, opens the sign-out Dialog with focus on «Отмена»), and debug-only rows after them. The new rows are nav rows. «Версия» keeps the initial focus, and its press gestures must keep working.
- QrDialog: it traps focus, its only action is «Закрыть», and Back also closes it. Focus returns to the initiating row. It shows a title and the target description «Откроется на телефоне», with the QR on `qr-bg`. Never print the URL in full.
- All overlays use the single modal host (AD-13). The modal host's Back contract applies, and screens add no Back listener while a dialog is open.
- If «О приложении» is a pushed route rather than a dialog, Back pops to Настройки with focus on «О приложении», as Diagnostics does with «Версия».
- Use the existing tokens and primitives (SettingRow description/value for the secondary text, Dialog, QrDialog). No new visual primitives are planned.

## Cross-Story Dependencies

- The two stories are independent. 15.1 needs no API work. 15.2 is gated on the E1 probe result and may stop for an owner decision.
- 15.1 reuses QrDialog and `QrRenderer` (Epics 6/13) and the version source used by «Версия» (Stories 2.4, 9.2).
- 15.2 depends on the E1 `UserRepository` / `me` query (Story 5.2) and the sign-out flow and AccountScope wipe (Stories 2.7–2.8).
- After each story, update the parity rows IMP-09 and IMP-10 in `docs/feature-parity.md`, the Настройки rows in `docs/focus-map.md`, `docs/api-contract.md` (E1 name field, 15.2), `docs/testing.md` device rows, and the wiki.
