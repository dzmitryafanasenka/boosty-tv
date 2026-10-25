# Review: version and reality check of committed decisions

- Spine: `ARCHITECTURE-SPINE.md` (Stack table, AD-2, AD-12, AD-13, Conventions)
- Lens: whether each committed decision was checked against the web or the current starter, or asserted from training data
- Date: 2026-10-25
- Method: `npm view` (read-only), `npm pack` of the two templates into a scratchpad outside the repo, GitHub API (`gh api`), and web fetches. Nothing was installed into the project.

## Verdict

**Pass with required fixes.** The npm versions in the Stack table are accurate as of today, and every named library still exists and is published. Two committed decisions do not hold up against reality:
1. The i18n convention relies on `Intl.PluralRules`, which Hermes does not provide.
2. The Stack defers TypeScript and Jest to "the RN TV template", but there is no TV template for 0.87.

Several compatibility claims remain unverified. The spine already labels them [ASSUMPTION] and defers them to the spike, which is acceptable, but the spike plan should name the specific risks listed below.

| Severity | Count |
| --- | --- |
| High | 2 |
| Medium | 4 |
| Low | 5 |
| Confirmed OK | listed at end |

## High

### H1. `Intl.PluralRules` is not implemented in Hermes, so the i18n convention fails on device
- **Spine:** Conventions table, i18n row: "A typed `ru` catalog in `shared/i18n` plus `Intl.PluralRules`." The memlog also says "own typed ru catalog + Intl.PluralRules".
- **Evidence:**
  - Hermes `doc/Features.md`, section "Planned Features": "Expanded `Intl` Functionality: Support for APIs such as `DisplayNames`, `ListFormat`, `PluralRules`, `RelativeTimeFormat`, `Locale`". The implemented list contains only basic `DateTimeFormat`, `NumberFormat`, and `Collator`. Source: https://github.com/facebook/hermes/blob/main/doc/Features.md
  - The tracking issue is still open: https://github.com/facebook/hermes/issues/1462 "Intl.PluralRules support" (state: open). It recommends the `intl-pluralrules` polyfill.
  - https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md does not list PluralRules.
- **Why it is High:** Jest runs on Node, where `Intl.PluralRules` exists, so unit tests pass. On the device, `new Intl.PluralRules('ru')` throws a `TypeError` (or is `undefined`). The failure appears only on the Android TV build, and it hits every Russian count string.
- **Fix:** Replace the convention with one of these and record the choice in an ADR:
  - (a) a hand-written `ru` plural selector (one / few / many / other; about 10 lines, unit-tested), or
  - (b) the `intl-pluralrules` polyfill loaded in `index.js`.
  
  Add a device check to the spike.

### H2. No react-native-tvos TV template exists for 0.87, so "TypeScript/Jest = template version" is undefined
- **Spine:** Stack table: "TypeScript: the version pinned by the RN TV template (strict)" and "Jest: template version". Memlog: "TypeScript version from the RN TV template (not TS 7)". The Stack table also pins `react-native-tvos 0.87.x`.
- **Evidence:**
  - The README documents this command: `npx @react-native-community/cli@latest init TVTest --template @react-native-tvos/template-tv` (https://github.com/react-native-tvos/react-native-tvos).
  - `npm view @react-native-tvos/template-tv versions` returns `0.75.2-0 … 0.81.0-0, 0.83.0-0`. The `latest` tag is `0.83.0-0`, published 2025-12-17. There is no 0.84–0.88 template.
  - The `template-tv@0.83.0-0` `template/package.json` contains `"react-native": "npm:react-native-tvos@0.83.0-0"`, `react 19.2.0`, `typescript ^5.8.3`, `jest ^29.6.3`, `react-test-renderer 19.2.0`, `eslint ^8.19.0`, and `@react-native-community/cli 20.0.0`.
  - For comparison, the core `@react-native-community/template@0.87.1` contains `react-native 0.87.1`, `react 19.2.3`, `typescript ^6.0.3`, `jest ^29.6.3`, `@react-native/jest-preset 0.87.1`, `react-test-renderer 19.2.3`, `eslint ^8.19.0`, `cli 20.2.0`, and `node >= 22.11.0`.
- **Impact:** Running the documented TV init today produces an RN-TV **0.83** project. Its TypeScript (5.8) does not match the 0.87 toolchain (6.0). The spine's rule "TS from the template" can therefore mean either 5.8 or 6.0, depending on how the spike bootstraps.
- **Fix:** In the spine or the spike plan, state the bootstrap path explicitly and record the resulting exact versions:
  - Option A: TV template 0.83, then upgrade to `react-native-tvos@0.87.1-1` with the Upgrade Helper.
  - Option B: core community template `--version 0.87.1`, then alias `react-native` to `npm:react-native-tvos@0.87.1-1` as the README describes (`"react-native": "npm:react-native-tvos@latest"` pattern) and add the TV-specific Android manifest/banner pieces by hand.
  
  Replace "template version" with the concrete versions once the spike has run.

## Medium

### M1. react-native-keychain 10.0.0 is a stale release with open Android DataStore defects; the TurboModule port is unreleased
- **Spine:** Stack `react-native-keychain 10.0.x`; AD-2 `SecureStore` port; memlog "fallback own Kotlin Keystore module".
- **Evidence:**
  - `npm view react-native-keychain time`: `10.0.0` published 2025-03-23. That is the last release, about 19 months ago, and it declares no peerDependencies.
  - `gh api repos/oblador/react-native-keychain`: `archived:false`, `pushed_at 2026-04-29`, 197 open issues. Main has `feat: turbo module (#761)` from 2026-03-23, which is **not published**. On RN 0.87, 10.0.0 therefore runs through the New-Architecture interop layer.
  - Open Android issues that touch our use case:
    - #820 (2026-10-16): a corrupt `RN_KEYCHAIN.preferences_pb` makes every get, set, and reset fail permanently (`CorruptionException`, no `corruptionHandler`). The user would be stuck signed-out with no way to recover inside the app.
    - #801: a DataStore is created per module instance, causing `IllegalStateException: multiple DataStores active`. This can be triggered by a second React instance, such as a dev reload or host recreation.
    - #818: the bundled `datastore-preferences:1.1.1` fails the GNU_RELRO alignment check, which is fixed in DataStore 1.2.1.
  - The Android storage is Keystore-backed. v10 `KeychainModule.kt` defines `KeystoreAESGCM` and `KeystoreAESGCM_NoAuth` ciphers, and `types.ts` documents `storage` "@default 'Best available storage'". StrongBox is used when available (`isStrongboxAvailable`). The Keystore requirement in CLAUDE.md is therefore met.
- **Fix:** Keep the `SecureStore` port. Make the spike test sign-in → kill → relaunch → reload (two React instances), and add a recovery path where `SecureStore` failure is mapped to `signedOut` with the corrupt store cleared. Pre-authorize the own-Kotlin-Keystore fallback in the ADR if #820 or #801 reproduces.

### M2. AsyncStorage 3.x does not list tvOS as a supported platform
- **Spine:** Stack `@react-native-async-storage/async-storage 3.1.x`; AD-2 `KeyValueStore` port; the phase-4 portability intent.
- **Evidence:** The async-storage README's "Supported platforms" lists Android (SQLite), iOS, macOS, visionOS, Web, and Windows, but **not tvOS**. Minimum RN for Android is 0.76. v3 also changes the API surface: `createAsyncStorage("appDB")` and multi-database support. Source: https://github.com/react-native-async-storage/async-storage (README).
- **Impact:** None for Android phase 1, where RN 0.87 is at least 0.76. This is a known phase-4 risk, and the port isolates it. The v3 API also differs from the v1/v2 examples that most training data shows.
- **Fix:** Note in Deferred / tvOS adapters that the `KeyValueStore` tvOS adapter may need a different backend. Write the Android adapter against the v3 API (`createAsyncStorage`), not the legacy default export.

### M3. @testing-library/react-native 14.1 needs `test-renderer`, not the template's `react-test-renderer`
- **Spine:** Stack "Jest / @testing-library/react-native: template version / 14.1.x".
- **Evidence:**
  - `npm view @testing-library/react-native@14.1.0 peerDependencies` returns `{ jest: ">=29.0.0", react: ">=19.0.0", "react-native": ">=0.78", "test-renderer": "^1.0.0" }` and `engines.node: "^22.13.0 || >=24"`.
  - Both templates ship `react-test-renderer` instead.
  - `test-renderer` exists on npm (1.3.1, peer `react ^19.0.0`).
- **Fix:** Add `test-renderer` to the Stack table and drop `react-test-renderer`. Confirm in the spike that `@react-native/jest-preset` (0.87) plus RTL 14 runs.

### M4. react-native-safe-area-context is a required peer but is missing from the Stack table
- **Evidence:** `npm view @react-navigation/native-stack@7.21.0 peerDependencies` includes `"react-native-safe-area-context": ">= 4.0.0"` and `"react-native-screens": ">= 4.0.0"`. Both templates include `react-native-safe-area-context ^5.5.2`, and npm `latest` is `5.10.1`.
- **Fix:** Add `react-native-safe-area-context 5.x` to the Stack table.

## Low

### L1. react-native-tvos 0.88 is now the `latest` stable, so the choice of 0.87 should be explicit
- `npm view react-native-tvos dist-tags` returns `latest: 0.88.0-0`, `0.88-stable: 0.88.0-0` (published 2026-10-17), and `0.87-stable: 0.87.1-1` (published 2026-09-18). Core `react-native` `latest` is `0.88.0` (2026-10-15).
- Choosing 0.87 as "0.88 too fresh" is defensible. Note that `npx …@latest init` and `npm:react-native-tvos@latest` will resolve to 0.88, so the exact pin matters (see H2).

### L2. React Native 0.87 is New-Architecture-only; the spine does not state this
- The RN 0.82 release notes say `newArchEnabled=false` and `RCT_NEW_ARCH_ENABLED=0` "will be ignored", making the New Architecture the only one (https://reactnative.dev/blog/2025/10/08/react-native-0.82). The react-native-tvos README still describes an opt-out, which is stale for 0.82+.
- Every native dependency must work on Fabric/TurboModules or the interop layer:
  - `react-native-screens`: the README says 4.25.0+ drops Paper, and 4.26.0+ supports RN 0.84+, so 4.30 is fine.
  - `react-native-video`: 6.19.x is current.
  - `react-native-keychain`: interop only (see M1).
- Add one line to the spine: "New Architecture only (RN ≥ 0.82)".

### L3. react-native-video: 6.x is now a support branch
- `npm view react-native-video dist-tags` returns `latest 6.19.3` (2026-09-18) and `beta 7.0.0-beta.12`, with peers `react: *` and `react-native: *` (no declared RN range). The GitHub release list shows 6.x patch releases continuing (6.19.2 in April, 6.19.3 in September) alongside v7 betas. Issue #5050 refers to a `support/6.x.x` branch.
- The 6.19.3 notes include Android Media3 1.9 support.
- Known iOS RN 0.87 build issue #5084 concerns the NitroModules (v7) header. It is irrelevant to Android 6.x but relevant to phase 4.
- There is no documented Android TV statement. Open tvOS issue #3516 (fullscreen) is irrelevant because we render our own controls.
- 6.x is the right choice for now. Record that a v7 migration will likely be needed before phase 4.

### L4. React Navigation 7 / native-stack on TV is not a documented supported target
- There is no TV mention in the navigation docs. Related issues:
  - react-navigation #13034 (tvOS blank screen with `usePreventRemove`, closed)
  - #12881 ("[tvos] Navigation issues", closed)
  - react-native-screens #1706 ("[ANDROID TV] Focus gets lost between page transitions", closed 2023)
  - react-native-screens #4618 (tvOS Menu pops native-stack screen before the app can handle it; matters for phase 4 Back handling under AD-13)
- The spine already defines a fallback through an ADR. Make sure the spike explicitly tests focus restoration across push and pop on Android TV.

### L5. Template tooling: ESLint 8 and the unnamed boundary plugin
- Both templates pin `eslint ^8.19.0`, which is end-of-life upstream. AD-1 commits to "an ESLint import-boundary rule" without naming a plugin or checking its compatibility with ESLint 8 and the `@react-native/eslint-config` 0.87.1 flat-config status.
- Name the plugin and verify it during bootstrap.
- Zod 4 under Hermes: Zod 4 uses a JIT (`new Function`) fast path with a fallback. I found no confirmed Hermes issue. Include one Zod parse in the device spike, or set `z.config({ jitless: true })`.

## Confirmed OK (checked today)

| Item | Evidence |
| --- | --- |
| react-native-tvos 0.87.1-1 → core 0.87.1 | Deps `@react-native/codegen 0.87.1` and related packages, `@react-native-tvos/virtualized-lists 0.87.1-1`; peer `react ^19.2.3`; engines `node ^22.13.0 \|\| ^24.3.0 \|\| >=26` (Node 24 OK). README: "0.xx.x-y … derives from core 0.xx.x"; do not combine with core `react-native`. |
| TV APIs in AD-12 exist in 0.87.1-1 | unpkg `react-native-tvos@0.87.1-1/index.js` exports `TVFocusGuideView`, `useTVEventHandler`, and `TVEventControl` (TVMenuControl deprecated → TVEventControl). |
| react-native-screens 4.30.0 | 2026-10-13, peers `*`. README: 4.26.0+ supports RN 0.84+ and lists tvOS as a supported platform. |
| @react-navigation/native 7.5.1 / native-stack 7.21.0 | 2026-10-13, peer `react >= 18.2.0`. v8 is alpha only. |
| react-native-svg 15.16.0 / react-native-qrcode-svg 6.3.27 | 2026-10-15 and 2026-10-21; qrcode peers `react-native >=0.63.4`, `react-native-svg >=14`. |
| @tanstack/react-query 5.104.5 | 2026-10-19, peer `react ^18 \|\| ^19`. Fine with React 19.2.3. |
| zod 4.6.7 | 2026-10-12, no peers. |
| zustand 5.0.16 | 2026-10-22, peer `react >=18`. |
| async-storage 3.1.1 | 2026-05-29, peers `*`, Android minimum RN 0.76 (see M2 for tvOS). |
| Expo not used | Consistent with CLAUDE.md. The README notes that Expo is recommended for new TV projects, so declining it needs owner approval, which CLAUDE.md already requires. |
