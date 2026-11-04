---
title: 'Story 15.2: Account name next to «Выйти из аккаунта»'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '6e3c2cc7c6ea2f34294f0018dbe7b9e130a8d6f3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Настройки does not say which account is signed in, so the viewer cannot tell what «Выйти из аккаунта» will sign out.

**Approach:** The «Выйти из аккаунта» row shows the account's display name as secondary text (our improvement IMP-10, FR-66). The name comes from E1 `name`, found by a temporary probe on the owner's session on 2026-11-04 (release-like build, pinned TV; keys and types only were printed, no value; the probe was removed): E1 200 has a top-level `name: string` (non-empty for the owner), next to `id`, `blogUrl`, `avatarUrl` and many other fields.

**Owner decision 2026-11-04:** the name is right-aligned on the same line as «Выйти из аккаунта» (the SettingRow `value`, like «1.2.0» on «Версия»); the row keeps its height; a long name is ellipsized.

## Boundaries & Constraints

**Always:** the name is read by `UserRepository.current` (the only E1 profile reader) into `CurrentUser.name: string | null`, parsed defensively (missing, non-string, blank → null; trimmed; never a parse failure, so sign-in, session validation and «Мой блог» never fail on it); Настройки observes the shared `queryKeys.me()` query (the account-scoped cache, cleared by `AccountScope.reset()` on sign-out and account switch), `retry: false`, `retryOnMount: false`, no new store; while loading, on error or with no name the row looks exactly as today; a name that looks like a phone number (only digits, spaces, `+`, `-`, `(`, `)`, with 7+ digits) is treated as no name; the name is never logged, never in a URL, and fixtures use a synthetic value; the spoken label includes the name; one line, ellipsized when long.

**Never:** showing the phone number (stored or from E1); a new endpoint or extra request beyond one E1 for a cold `me` cache; changing the row's focus id, order or the sign-out dialog; the session's own E1 (`SessionManager`) reading the name.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Name known | E1 `name: "Анна"` | Row «Выйти из аккаунта» with «Анна» right-aligned (value) | N/A |
| No name | `name` missing / `""` / `"  "` / not a string | Row as today (no secondary text) | Never a parse failure |
| Phone-like name | `name: "+7 900 123-45-67"` | Row as today | N/A |
| E1 loading or failed | `me` pending / error | Row as today; no retry on mount | No error UI |
| Cache already filled | Подписки filled `me` earlier | Name shown, no extra E1 | N/A |
| Sign out, other account | sign-out → sign-in as B | B's name (or none); A's name never shown | `AccountScope.reset()` clears `me` |
| Long name | 80 characters | One line, the value ellipsized, the label never truncated; row height unchanged; focus ring not clipped | N/A |

</frozen-after-approval>

## Code Map

- `src/shared/api/dto/userCurrent.ts` -- `userCurrentSchema`: add `name` optional with `.catch(undefined)` like `blogUrl`.
- `src/shared/entities/user/types.ts`, `userRepository.ts` -- `CurrentUser.name`; map trimmed/blank/phone-like → null here or in a small pure helper next to it.
- `src/features/subscriptions/useSubscriptions.ts:106-115` -- `useMyBlog`'s `me` query: reuse the same key and fn; do not change its options or the `myBlog` gating.
- `src/app/Shell.tsx:516-530` -- `SettingsSection` already has the hooks; it has no `http` yet: pass `http` from `SectionContent` (it has it) and add the `me` observer here, then a prop `accountName?: string` to `SettingsScreen`.
- `src/features/settings/SettingsScreen.tsx` -- the sign-out row (`SETTINGS_SIGN_OUT_ID`): `value` (right-aligned, one line); `SettingRow` (`src/shared/ui/SettingRow.tsx`) supports both and `accessibilityLabel`.
- `src/shared/account` -- verify `me` is in the cleared query cache (do not add a store).
- `src/test/fixtures/boosty/e1-user-current.json` -- add a synthetic `name` that passes `npm run check:fixtures`.
- `src/app/dev/demo.ts` -- the demo E1; no name needed (row unchanged).
- Tests: `src/shared/api/dto/__tests__` / `entities/user/__tests__` (parse cases), `__tests__/signOutFlow.test.tsx` and `__tests__/aboutReportFlow.test.tsx` (row order/labels), a flow test for every matrix row including account switch.
- Docs: `docs/api-contract.md` §3 E1 row (l.245: `name` + probe evidence, keys/types only), `docs/feature-parity.md` IMP-10 (l.192), `docs/focus-map.md` Настройки rows, `docs/testing.md`, EXPERIENCE.md Настройки row, CHANGELOG pair.

## Tasks & Acceptance

**Execution:**
- [x] DTO, `CurrentUser.name`, mapping + unit tests (missing, non-string, blank, trimmed, phone-like, a malformed name does not fail the parse).
- [x] Настройки: `me` observer in `SettingsSection`, `http` pass-through, sign-out row value and spoken label.
- [x] Flow tests for every matrix row (including: a cache hit sends no E1; an account switch shows no stale name).
- [x] Fixture, api-contract E1 row, feature-parity IMP-10, focus-map, testing, EXPERIENCE.md, CHANGELOG pair.

**Acceptance Criteria:**
- Given the release-like build on the pinned TV, when the owner opens Настройки, then «Выйти из аккаунта» shows the account name and never the phone (owner's check; agent via adb).
- Given `npm run lint`, `npm run typecheck`, `npm test`, `npm run check:fixtures`, then all pass.

## Implementation Notes

- `useAccountName(http)` (`features/settings`) observes `queryKeys.me()` with `UserRepository.current`, `retry: false`, `retryOnMount: false` and also `refetchOnMount: false` (this observer only): without it a `me` cache older than the 60 s `staleTime` (filled by Подписки) would send an extra E1, against the matrix row «Cache already filled». `useMyBlog`'s options are unchanged.
- Name mapping is `accountDisplayName` in `entities/user/userRepository.ts` (trim; blank or phone-like → null). The DTO only reads `name` as an optional string with `.catch(undefined)`.
- `SettingRow` got an opt-in `valueYields` prop: the label keeps its natural width (`flexShrink: 0`, grows to fill) and the one-line value shrinks and is ellipsized; the default layout of other rows is unchanged. Without it a long value would squeeze the label (label `flex: 1`, value not shrinkable).
- The spoken label is SettingRow's default «<label> <value>», i.e. «Выйти из аккаунта <name>».
- Side effect: a visit to Настройки fills `me`, so Главная's «Обновить» (`recheckMyBlog`) may re-send E1 for an account without a blog after a Настройки visit, as it already did after a Подписки visit (documented in `feedRefresh.ts` and api-contract E1).
- Fixture `e1-user-current.json` uses the placeholder `"name": "redacted"` (the only free-text value `check:fixtures` allows here).

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind, edge | Phone-like check misses dots, masks, en/em dashes | medium | `PHONE_LIKE = /^[\d\s+()-]+$/` passes `900.123.45.67`, `+7 900 ***-**-67`; spec says never show the phone | patch |
| 2 | edge, vgap | With `myBlog` off, «Обновить» re-sends E1 after a Настройки visit; untested | medium | `recheckMyBlog` refetches a settled `me` without `blogUrl`; Настройки fills `me` regardless of the flag; no test visits only Настройки | patch |
| 3 | vgap | Label half of `valueYields` not asserted | low | Test checks only the value style | patch |
| 4 | blind | IMP-10 wording «as its value» | low | Should be «as its label» | patch |
| 5 | blind | testing.md header «all to check» vs filled rows; «as described (not confirmed)» | low | Self-contradicting | patch |
| 6 | blind | Overlong comment line in userRepository.ts | low | Formatting | patch |
| 7 | edge | Stray E1 after sign-out while Настройки is mounted | false | `signOutFlow` «clears … sends nothing» passes with the named fixture | rejected |
| 8 | edge | Focus/reconnect refetch defaults | false | `src/app/queryClient.ts` sets `refetchOnWindowFocus`/`refetchOnReconnect` false | rejected |
| 9 | blind | Late E1 of account A lands in B's scope | false | `client.clear()` removes the query; a late resolve writes into the removed query, not the cache | rejected |
| 10 | blind | Name may be persisted with the query cache | false | No query persister in `src` | rejected |
| 11 | blind, edge | Zero-width / bidi / control characters survive `trim()` | low | Unlikely in Boosty names; fix adds normalization | rejected |
| 12 | blind | `labelKept` `flexShrink: 0` with a longer translation or font scale | low | Russian label is short; i18n has one locale | rejected |
| 13 | blind | `valueYields` ignored with `valueLines > 1` | low | No caller combines them | rejected |
| 14 | blind | Two copies of the `me` query options | low | Same key and fn, observer flags differ on purpose; no named divergence | rejected |
| 15 | blind | Spoken label without a separator | low | Same composition as «Версия 1.2.0» | rejected |
| 16 | edge | gcTime: a failed E1 is re-asked after 10 min unobserved | low | Bounded, one request | rejected |
| 17 | blind | CHANGELOG omits the extra E1; EN/RU wording differs | low | Internal network detail; meaning equal | rejected |
| 18 | blind | Spec not in the diff | false | Excluded on purpose (claims go to the edge layer only) | rejected |

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run check:fixtures` -- all pass.
- `cd android && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- BUILD SUCCESSFUL.
