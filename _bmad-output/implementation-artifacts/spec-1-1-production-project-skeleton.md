---
title: 'Story 1.1: Production project skeleton'
type: 'chore'
created: '2026-10-25'
status: 'done'
baseline_commit: 'c71fb94d7c577be45a307a8f00de7dc6c043429a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/docs/adr/0001-react-native-tvos-0-87-bootstrap.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository holds only planning artifacts. Every later story needs one verified React Native TV foundation: pinned versions, TV manifest, folder layout with enforced boundaries, strict TypeScript, Jest and CI.

**Approach:**
1. Generate the RN Community CLI template 0.87.1 in a scratch folder.
2. Move it into the repo root without touching the existing `docs/`, `_bmad/`, `_bmad-output/`, `.claude/`, `CLAUDE.md` and `.gitignore`.
3. Alias `react-native` to `npm:react-native-tvos@0.87.1-1` (ADR 0001).
4. Port the two TV-specific deltas of `@react-native-tvos/template-tv`: the TV manifest and the banner.
5. Add the spine's `src/` layout, eslint-plugin-boundaries, CI and docs.

## Boundaries & Constraints

**Always:**
- Use npm with an exact-version `package-lock.json`. Node 24.
- TypeScript strict. New Architecture stays on.
- Version choices follow ADR 0001 and the spine Stack table.
- The manifest has:
  - `LEANBACK_LAUNCHER` and `LAUNCHER`;
  - `android:banner`;
  - `touchscreen`, `faketouch` and `leanback` features with `required=false`;
  - `allowBackup=false`.
- Cleartext traffic is off in `release`. In `debug` it stays on only for the Metro dev server, through the template's `usesCleartextTraffic` manifest placeholder.
- Banner and icon are neutral placeholders we make ourselves. No Boosty or BoostBuddy marks, and no RN logos.
- Every command used, the toolchain versions and the device dp go into `docs/testing.md`.

**Never:**
- Add production feature code, navigation or libraries beyond the template, `eslint-plugin-boundaries` and `test-renderer` (later stories add them).
- Commit signing material, secrets or a keystore.
- Push to the remote without the owner's explicit OK.
- Keep a mobile `ios/` target. It is removed now; a tvOS target is added in phase 4 from the TV template.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Boundary violation | `src/features/a` imports `src/features/b` (not allowlisted), or `src/shared` imports `src/features` | `npm run lint` fails with a boundaries error | Removing the import makes lint pass |
| Allowlisted edge | `src/features/post` imports `src/features/polls/index.ts` | Lint passes | A deep import into polls internals fails |
| Release variant | `assembleRelease` manifest | `usesCleartextTraffic=false` | — |

## Decisions (owner, 2026-10-25)

- **Toolchain:** the agent installs JDK 17 (`zulu@17`) and the Android command-line SDK (platform-tools, platforms 36/37, build-tools, NDK 27.1.12297006) via Homebrew. The owner approved these system changes outside the repo. Installed versions are recorded in `docs/testing.md`.
- **Device:** the owner connects the Chromecast over network `adb` during this story. The launch and dp check are part of this story's acceptance.
- **Identity:** applicationId is `io.github.dzmitryafanasenka.boostytv`. The launcher label is «Boosty TV» (working title, not approved branding).

</frozen-after-approval>

## Code Map

- `_bmad-output/implementation-artifacts/epic-1-context.md` -- distilled stack, layout, CI and secrets rules for Epic 1.
- Community template 0.87.1 (unpacked in scratchpad `ctpl/package/template`) -- base files: `package.json` (react 19.2.3, TS ^6.0.3, Jest ^29.6.3, `@react-native/jest-preset` 0.87.1, ESLint 8 + `@react-native/eslint-config`), `android/` (minSdk 24, compileSdk 37, targetSdk 36, NDK 27.1.12297006, Kotlin 2.2.0, Gradle 9.4.1).
- `@react-native-tvos/template-tv` 0.83 (scratchpad `tpl/`) -- the only deltas from the community template are `AndroidManifest.xml` (TV features, banner, LEANBACK) and `res/drawable/tv_banner.png`. Copy the manifest pattern, not the banner image.
- Existing `.gitignore` -- extend it, do not replace it. It already covers keystores, `.env`, personal BMAD config and the render cache.
- Do not modify `docs/` except `docs/testing.md`. Do not touch `_bmad/`, `_bmad-output/planning-artifacts/` or `.claude/`.

## Tasks & Acceptance

**Execution:**
- [x] repo root -- generate the template 0.87.1 in a temp dir and move its files in. Set the applicationId `io.github.dzmitryafanasenka.boostytv` and the label «Boosty TV». Delete `ios/`. Adapt `README.md` to the project.
- [x] `package.json` -- `"react-native": "npm:react-native-tvos@0.87.1-1"`, exact pins, scripts `lint`, `typecheck` (`tsc --noEmit`), `test`, `android`. Add `eslint-plugin-boundaries@7.3.x` and `test-renderer@1.3.x` (RNTL peer is installed later with RNTL).
- [x] `android/app/src/main/AndroidManifest.xml` + `res/drawable/tv_banner.png` -- TV manifest per the constraints; generate a 320×180 neutral placeholder banner.
- [x] `tsconfig.json` -- `strict: true`.
- [x] `src/app`, `src/features`, `src/shared/{api,entities,services,filters,platform,focus,ui,i18n,storage}`, `src/test/fixtures` -- create the layout with `index.ts` stubs only where the lint rules need targets. Move `App.tsx` into `src/app/App.tsx`, showing a placeholder screen with one focusable button.
- [x] `.eslintrc.js` -- boundaries element types (app, feature, shared) and rules: shared ✗→ features/app; features ✗→ app; feature→feature only via `index.ts` for `post→polls` and `post→player`.
- [x] `__tests__/` -- one sample component test (App renders the button) and a lint fixture test that proves the boundaries rule fails on a forbidden import.
- [x] `.github/workflows/ci.yml` -- on push/PR: `npm ci`, lint, typecheck, test, `./gradlew assembleDebug`. No secrets.
- [x] `.gitignore` -- add RN/Android ignores (node_modules, build dirs, `local.properties`, `.gradle`, `*.apk` outputs).
- [x] `docs/testing.md` -- bootstrap commands, Node/JDK/SDK versions, build config, and the device dp.

**Acceptance Criteria:**
- Given a clean clone, when `npm ci && npm run lint && npm run typecheck && npm test` runs, then all pass.
- Given the toolchain, when `cd android && ./gradlew assembleDebug` runs, then a debug APK is produced.
- Given `git status` after the work, when it is inspected, then no keystore, `.env`, `local.properties` or build output is staged.
- Given the owner has connected the Chromecast over adb, when the debug APK launches from the Google TV home screen, then the placeholder button is D-pad focusable and the reported dp is recorded.

## Implementation Notes

- JDK: the `zulu@17` cask needs `sudo` (pkg installer) and failed in the agent session; Homebrew `openjdk@17` 17.0.21 was used instead. CI uses Zulu 17 via `actions/setup-java`.
- `platforms;android-37` does not exist in sdkmanager; `platforms;android-37.0` was installed and satisfies compileSdk 37.
- npm `overrides.react-native = "$react-native"`: without it `@react-native-tvos/virtualized-lists` (peer `react-native: 0.87.1`) pulled a second, core `react-native@0.87.1` into `node_modules/react-native/node_modules`.
- npm `overrides.test-renderer.react-reconciler = "0.33.0"`: `test-renderer@1.3.1` wants reconciler 0.34 (React ^19.3); React is pinned to 19.2.3.
- No keystore in the repo: the template `debug.keystore` and `signingConfigs` were dropped; debug uses the SDK's per-machine debug keystore, release is unsigned.
- Template mipmaps (React Native logo) replaced with neutral generated placeholders, as was the banner.
- Template-only packages removed: `@react-native/new-app-screen`, `react-native-safe-area-context`, `react-test-renderer`, `@types/react-test-renderer`, `@react-native-community/cli-platform-ios`.
- The boundaries test is plain JS (`__tests__/boundaries.test.js`) so it needs no `@types/node`/ESLint type packages. Mutation check: with an empty policy list, all six "fails" cases fail.
- On-device (orchestrator + owner, physical Chromecast with Google TV 4K, Android TV OS 14): wireless adb paired; debug APK installed; the LEANBACK_LAUNCHER activity resolves with its banner; the app launches with the placeholder button focused; injected DPAD_CENTER presses it; window 1920×1080 px at density 320 = 960×540 dp. Recorded in `docs/testing.md`.
- Matrix row "Release variant" is covered by `__tests__/androidManifest.test.js` (the manifest must use the RN Gradle plugin's `${usesCleartextTraffic}` build-type placeholder, never a hardcoded value) plus the `aapt` check of the release APK.
- Review fixes applied (see triage log): release-manifest CI check, `no-unknown-dependencies`, src/test boundary, stronger tests. Verification after fixes: lint 0 warnings, typecheck clean, 3 suites / 25 tests pass, `assembleDebug` OK.
- Open: CI workflow not yet run on GitHub (needs a push); owner check of the home-screen tile + physical remote.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | verification-gap, blind, edge | Release-variant cleartext/TV manifest only checked by source-text test; no automated merged-manifest check | medium | patch | CI now runs assembleRelease + `aapt` "Check release manifest" (cleartext 0x0, allowBackup 0x0, LEANBACK, banner); validated locally, and the check rejects the debug APK |
| 2 | edge, blind | Unresolvable imports (`../b/index.js`, missing files) bypass boundaries under `default: 'allow'` | medium | patch | Probe confirmed; `boundaries/no-unknown-dependencies: 2` added; fails-cases for both added and pass |
| 3 | edge, blind | `src/test` fixtures importable from app/feature/shared | medium | patch | Policy added; three fails-cases (app/feature/shared → test) pass |
| 4 | blind, edge | Boundaries test lacked mirror/edge cases (player internals, player→post, shared→shared, externals) and allow-cases could pass vacuously | low | patch | Cases added; allow-cases are no longer vacuous because unresolved targets now error |
| 5 | blind | Component test weak (`focusable` not-false passes on undefined; no press check) | low | patch | Asserts `hasTVPreferredFocus`, `focusable === true`, and the press label change |
| 6 | blind | Manifest test regex depends on attribute order; title calls leanback "hardware" | low | patch | Rewritten to parse each `<uses-feature>` tag; title fixed |
| 7 | blind, verification-gap | `docs/testing.md` test counts stale | low | patch | Updated to 3 suites / 25 tests |
| 8 | blind, edge | Device results overstate: launched via `am start`, keys injected; home-tile + physical remote unverified | low | patch | Wording fixed; pending owner row added |
| 9 | blind | `git status` AC not recorded | low | patch | Staging check row added to `docs/testing.md` |
| 10 | blind | No Gradle wrapper validation in CI | low | patch | `gradle/actions/wrapper-validation@v4` added |
| 11 | blind | CI never run; runner SDK/NDK availability unverified | maybe-false | defer-to-push | Settled by the first CI run after the owner approves a push; one ABI (`x86_64`) added to keep it fast |
| 12 | blind | Release cannot be signed without code; procedure undocumented | medium | defer | Story 9.1 owns signing; logged in deferred-work.md |
| 13 | blind | `edgeToEdgeEnabled=true` unjustified on TV | maybe-false | defer | Overscan unverified; logged for Story 2.4 |
| 14 | blind | test-renderer reconciler override | low | defer | Logged; revisit with RNTL |
| 15 | blind | Template leftovers in android/, 4 ABIs, hardcoded versionCode | low | defer | Cosmetic; logged |
| 16 | blind | Actions pinned by tag, not SHA | low | reject | Low risk for a personal repo; adds maintenance without demonstrated harm |
| 17 | blind | Hardcoded strings/colors in placeholder App | low | reject | Placeholder by spec; Story 2.1 introduces tokens and the i18n catalog |
| 18 | blind | sprint-status `in-progress` vs spec `in-review` | false | reject | Workflow step 5 moves the story to `review`; not a defect |
| 19 | blind | Duplicate `includeBuild` in settings.gradle | false | reject | Present in the RN 0.87.1 community template as shipped |

## Verification

**Commands:**
- `npm ci && npm run lint && npm run typecheck && npm test` -- expected: exit 0.
- `cd android && ./gradlew assembleDebug` -- expected: BUILD SUCCESSFUL.
- `npx react-native config | grep -i tvos` or `npm ls react-native` -- expected: resolves to react-native-tvos@0.87.1-1.

**Manual checks (if no CLI):**
- Merged manifest (`android/app/build/intermediates/merged_manifests`): LEANBACK, banner, `allowBackup=false`; release has no cleartext.
- On the device: the app appears in the Google TV launcher and the button is focusable by D-pad.
