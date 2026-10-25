---
title: 'Story 1.1: Production project skeleton'
type: 'chore'
created: '2026-10-25'
status: 'ready-for-dev'
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
- [ ] repo root -- generate the template 0.87.1 in a temp dir and move its files in. Set the applicationId `io.github.dzmitryafanasenka.boostytv` and the label «Boosty TV». Delete `ios/`. Adapt `README.md` to the project.
- [ ] `package.json` -- `"react-native": "npm:react-native-tvos@0.87.1-1"`, exact pins, scripts `lint`, `typecheck` (`tsc --noEmit`), `test`, `android`. Add `eslint-plugin-boundaries@7.3.x` and `test-renderer@1.3.x` (RNTL peer is installed later with RNTL).
- [ ] `android/app/src/main/AndroidManifest.xml` + `res/drawable/tv_banner.png` -- TV manifest per the constraints; generate a 320×180 neutral placeholder banner.
- [ ] `tsconfig.json` -- `strict: true`.
- [ ] `src/app`, `src/features`, `src/shared/{api,entities,services,filters,platform,focus,ui,i18n,storage}`, `src/test/fixtures` -- create the layout with `index.ts` stubs only where the lint rules need targets. Move `App.tsx` into `src/app/App.tsx`, showing a placeholder screen with one focusable button.
- [ ] `.eslintrc.js` -- boundaries element types (app, feature, shared) and rules: shared ✗→ features/app; features ✗→ app; feature→feature only via `index.ts` for `post→polls` and `post→player`.
- [ ] `__tests__/` -- one sample component test (App renders the button) and a lint fixture test that proves the boundaries rule fails on a forbidden import.
- [ ] `.github/workflows/ci.yml` -- on push/PR: `npm ci`, lint, typecheck, test, `./gradlew assembleDebug`. No secrets.
- [ ] `.gitignore` -- add RN/Android ignores (node_modules, build dirs, `local.properties`, `.gradle`, `*.apk` outputs).
- [ ] `docs/testing.md` -- bootstrap commands, Node/JDK/SDK versions, build config, and the device dp.

**Acceptance Criteria:**
- Given a clean clone, when `npm ci && npm run lint && npm run typecheck && npm test` runs, then all pass.
- Given the toolchain, when `cd android && ./gradlew assembleDebug` runs, then a debug APK is produced.
- Given `git status` after the work, when it is inspected, then no keystore, `.env`, `local.properties` or build output is staged.
- Given the owner has connected the Chromecast over adb, when the debug APK launches from the Google TV home screen, then the placeholder button is D-pad focusable and the reported dp is recorded.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm ci && npm run lint && npm run typecheck && npm test` -- expected: exit 0.
- `cd android && ./gradlew assembleDebug` -- expected: BUILD SUCCESSFUL.
- `npx react-native config | grep -i tvos` or `npm ls react-native` -- expected: resolves to react-native-tvos@0.87.1-1.

**Manual checks (if no CLI):**
- Merged manifest (`android/app/build/intermediates/merged_manifests`): LEANBACK, banner, `allowBackup=false`; release has no cleartext.
- On the device: the app appears in the Google TV launcher and the button is focusable by D-pad.
