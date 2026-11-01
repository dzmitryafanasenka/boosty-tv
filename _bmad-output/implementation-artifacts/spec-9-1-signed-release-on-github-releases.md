---
title: 'Story 9.1: Signed release on GitHub Releases'
type: 'feature'
created: '2026-11-01'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2e0701a4ea4ea838e53262efdd4507dd4e754e93'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/docs/testing.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The family TV runs a "release-like" APK signed with the SDK debug key, versioned `1.0` / `1`, with Story 1.1 placeholder branding. There is no documented way to produce, verify and publish a signed release that later releases can update in place.

**Approach:** Sign `release` from four owner-held Gradle properties when present (unsigned otherwise, so CI is unchanged). Use semantic `versionName` with a `versionCode` derived from it. Add the final neutral banner and adaptive icon, a changelog, and `docs/release.md`. Then build, install (one-time uninstall), verify in-place update, and publish the first GitHub Release.

## Boundaries & Constraints

**Always:**
- Owner decisions 2026-11-01: the name «Boosty TV» is final. The agent draws a new neutral banner and icon with no Boosty marks and shows them to the owner before committing. The owner creates the keystore outside the repository. The properties `BOOSTYTV_RELEASE_STORE_FILE`, `BOOSTYTV_RELEASE_STORE_PASSWORD`, `BOOSTYTV_RELEASE_KEY_ALIAS` and `BOOSTYTV_RELEASE_KEY_PASSWORD` live only in `~/.gradle/gradle.properties`. A one-time uninstall on the TV is approved (re-login; local progress and «Продолжить» are lost).
- The agent never reads, prints, greps or logs those property values or the keystore. Gradle may consume them.
- A release build with only some of the four properties fails with a message that names the missing keys, never their values.
- `checkDemoModeOff` still gates the release bundle.
- Tags are `v{versionName}`. `versionName` is `MAJOR.MINOR.PATCH`.
- Owner decisions 2026-11-01 (spec checkpoint):
  - The first release is `0.9.0`. `1.0.0` is reserved for the owner's acceptance in 9.5.
  - The changelog is kept in both languages: `CHANGELOG.md` (English) and `CHANGELOG.ru.md` (Russian), with the same versions. The release body has the Russian notes first, then a line `---`, then the English notes, so 9.2 can show the part before the first `---` on the TV.
  - After the key switch, the agent's device builds are `assembleRelease` signed by Gradle with the owner's key from `~/.gradle/gradle.properties`. The agent never sees the passwords. A branch build replaces the family build until the next release.
  - The agent publishes the GitHub Release with `gh release create`, but only after the owner's explicit OK on the final notes and APK.

**Never:**
- No signing in CI, and no keystore, passwords, certificate files, APKs, real account data or signed URLs in git or in the release notes.
- No Boosty logos, colors or wordmark styling in the artwork.
- No update-check code (Story 9.2).
- Do not publish the GitHub Release or push the tag without the owner's explicit OK at that step.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed | all 4 props set, demo off | `app-release.apk`, signed v2+, `apksigner verify` OK | N/A |
| CI / no props | none set | unsigned `app-release-unsigned.apk`, as today | N/A |
| Partial props | 1–3 set | build fails before packaging | message lists the missing key names |
| Demo on | `DEMO_MODE = true` | build fails (`checkDemoModeOff`) | unchanged |
| Bad version | `versionName` not `X.Y.Z` | build fails at configuration | message names the expected format |
| Update in place | same key, higher `versionCode` | `adb install -r` keeps the session | N/A |
| Key switch | TV has the debug-key build | `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | one-time uninstall (approved) |

</frozen-after-approval>

## Code Map

- `android/app/build.gradle:80-97` -- `defaultConfig` `versionCode 1` / `versionName "1.0"`; `buildTypes.release` has no `signingConfig`. `checkDemoModeOff` (≈l.105) is the pattern for a configuration guard.
- `android/app/src/main/AndroidManifest.xml` -- already `touchscreen`/`faketouch`/`leanback` `required=false`, LEANBACK_LAUNCHER, `@drawable/tv_banner`, `@mipmap/ic_launcher(_round)`. Keep it.
- `android/app/src/main/res/drawable/tv_banner.png` (320×180 placeholder) and `mipmap-*/ic_launcher*.png` (placeholder) -- replace them. minSdk is 24, so keep legacy PNGs and add `mipmap-anydpi-v26` adaptive icons. Move the banner to `drawable-xhdpi`.
- `src/shared/ui/tokens.ts` -- `bg #171615`, `accent #E8914A`, `accent-ink`. `android/app/src/main/assets/fonts/GolosText-SemiBold.ttf` is the font for the banner wordmark.
- `src/shared/platform/appInfo.ts`, `AppInfoModule.kt` -- «Версия» shows the native `versionName`. No code change is needed.
- `__tests__/androidManifest.test.js`, `demoModeOff.test.js`, `releaseBundle.test.js` -- extend the first for the banner and adaptive icon resources.
- `.gitignore` -- already ignores `*.keystore`, `*.jks`, `*.p12`, `keystore.properties`, `*.apk`.
- `.github/workflows/ci.yml:54` -- CI runs `assembleRelease` without properties. It must stay green and unsigned.
- `docs/testing.md:60` -- the "Variants" row says "unsigned in-repo". Update it.
- Device probe (2026-11-01, adb, read-only): the installed package is `versionCode=1 versionName=1.0`, with signature `f178bc3b` (the SDK debug key), first installed on 2026-10-25. No local raster tools other than Chrome. Render the artwork with headless Chrome from SVG/HTML sources.

## Tasks & Acceptance

**Execution:**
- [x] `android/app/build.gradle` -- `signingConfigs.release` from the 4 properties, applied only when all are present; fail on a partial set; `versionName "X.Y.Z"` and `versionCode = MAJOR*10000 + MINOR*100 + PATCH`, validated -- signed in-place updates, and the version always increases
- [x] `android/branding/` (SVG/HTML sources + `render.mjs` via headless Chrome) -- the reproducible source for the artwork
- [x] `android/app/src/main/res/{drawable-xhdpi/tv_banner.png, mipmap-*/ic_launcher*.png, mipmap-anydpi-v26/ic_launcher*.xml, drawable/ic_launcher_foreground.xml, values/ic_launcher_background.xml}` -- the final banner and icons
- [x] `__tests__/androidManifest.test.js` -- the banner resolves to a 320×180 PNG, the adaptive icon XML exists, and no touch is required
- [x] `__tests__/releaseSigning.test.js` -- a source check of `build.gradle`: the property names, no literal secrets, `signingConfig` gated
- [x] `CHANGELOG.md`, `CHANGELOG.ru.md` -- the `0.9.0` entry in both languages
- [x] `docs/release.md` -- the keytool command, the properties template, build, `apksigner verify --print-certs`, install and update, tag, `gh release create`, the secret checklist; link it from `docs/testing.md`
- [x] Device -- uninstall the debug-key build (approved), install the signed release, owner re-login, check the launcher banner and name; reinstall the same-key APK with `adb install -r` → the session is kept
- [x] GitHub -- after the owner's OK: tag and release with the APK and the changelog

**Acceptance Criteria:**
- Given the owner's keystore and properties, when the documented build runs, then `apksigner verify --print-certs` shows the release certificate, not `CN=Android Debug`.
- Given the installed release, when the Google TV home is viewed, then the new banner and «Boosty TV» are shown and «Версия» shows `0.9.0`.
- Given the published release, when its assets and the repository are inspected, then there are no secrets, keystore or account data, and `npm run check:fixtures` passes.

## Implementation Notes

- 2026-11-01: implemented by a subagent; host checks green (lint, typecheck, 147 suites / 3112 tests, check:fixtures). `assembleRelease` (armeabi-v7a) with empty `-P` overrides gives `app-release-unsigned.apk` (`versionCode 900`, `0.9.0`). With the owner's properties it gives `app-release.apk`: `apksigner` verifies v2, and the certificate is the owner's (`CN=Dzmitry Afanasenka`, …, SHA-256 `b7b8b0f1…47d59eb`). A partial set fails and names only the missing keys. A temporary `versionName "1.0"` fails at configuration.
- Owner approved the banner and the icon previews (2026-11-01). The owner keeps the certificate DN as is (name and city are visible to anyone who has the APK; accepted).
- Order: the code review runs before the Device task, because review fixes may change the build. The GitHub task runs after the PR merge, so the tag points at `main`. The public APK is built for all ABIs (`./gradlew clean assembleRelease`); the device check may use armeabi-v7a.

- 2026-11-01: published on the owner's explicit OK: tag `v0.9.0` on `a4030ce` (`main`), GitHub Release «Boosty TV 0.9.0» with the all-ABI APK (`boosty-tv-0.9.0.apk`, 83 962 932 bytes, SHA-256 `8ae55394…8b9e4d96`, GitHub asset digest matches). `releases/latest` returns `v0.9.0`.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | verification-gap | Partial-set guard checked only by source text | medium | CI runs `assembleRelease` with no properties only; an AGP rename of `preReleaseBuild` would pass all tests. Patch: CI step runs `checkReleaseSigning` with one dummy property |
| 2 | verification-gap | Derived `versionCode`/`versionName` not checked in the built APK | medium | CI greps only manifest flags. Patch: `aapt dump badging` assertion in CI |
| 3 | verification-gap | Stale CI comment "release stays unsigned (the owner signs locally)" | low | `ci.yml:51`. Patch: direct correction |
| 4 | edge-case | Whitespace-only property counts as set | low | `releaseSigningValue` checks `isEmpty()` only. Patch: blank-trim check (values not trimmed) |
| 5 | edge-case / blind | Missing or relative `STORE_FILE` fails late and obscurely | medium | `file()` resolves relative to `android/app`; the doc warns `~` is not expanded. Patch: absolute + isFile check naming the key only |
| 6 | edge-case | `0.0.0` gives `versionCode 0` | low | Real, but no one releases 0.0.0. Rejected: unlikely, and the fix adds a guard |
| 7 | edge-case | `render.mjs` accepts unsupported SVG fills/attributes, no Chrome timeout, partial writes | low | Offline tool for the committed `icon.svg`, which uses only hex fills and paths. Rejected: unlikely in everyday use, the fixes add guards |
| 8 | edge-case / blind | `docs/release.md` blocks change cwd (`cd android`, then repo-root paths) | medium | Verified: Build ends in `android/`, Publish copies `android/app/...`. Patch |
| 9 | edge-case / blind | Publish does not tie the APK and the tag to `main`; temp files left in the repo root | medium | Verified: no checkout/clean check; `release-notes.md` is not gitignored. Patch: `switch main`, clean check, `mktemp -d` |
| 10 | edge-case / blind | Secret grep checks one file | medium | Verified: `grep ... android/gradle.properties` only. Patch: `git grep` over tracked files plus an all-ABI check |
| 11 | blind | `---` separator renders as a heading | medium | A `---` right under a text line is a setext H2 in GitHub Markdown; 9.2 parses it. Patch: blank lines around it |
| 12 | blind | No APK checksum or certificate digest in the release | low | Real for a public sideload. Patch: append both SHA-256 to the notes |
| 13 | blind | Digest truncation differs between the spec note and testing.md | false | Both are truncations of the same digest (`…c47d59eb` / `…47d59eb`); the fix would edit the spec |
| 14 | blind | Doc says "no private data in DN" while the DN has name and city | low | The owner accepted it. Patch: doc states the accepted decision |
| 15 | blind | Spec Verification line for the unsigned build is garbled | false | testing.md records the real procedure (four empty `-P` overrides); the fix would edit this build's spec. Rejected |
| 16 | blind | SVG path data in three copies can drift | low | Real but rare; the fix adds a generator or a test. Rejected |
| 17 | blind | Branch builds carry the release version; downgrade needs `install -r -d` | medium | Real: after the key switch a branch build shows `0.9.0` too. Not settled by the intent (the owner chose branch builds replacing the family build). Deferred |
| 18 | blind | CHANGELOG states "keep the session" before the device check; no link definition, no Unreleased | low | The device task verifies it before release; link style is cosmetic. Rejected |
| 19 | blind | sprint-status `in-progress` while in review | low | Patch: set `review` |
| 20 | blind | Source-scan tests tied to formatting | low | Brittle but fail loudly; CI behaviour steps (1, 2) now cover the logic. Rejected |
| 21 | blind | Hard-coded `build-tools/37.0.0`; banner comment 24..84 vs viewBox 26..82 | low | Verified both. Patch: direct corrections |
| 22 | blind | `androidManifest.test.js` does not look for `tv_banner` in `mipmap*` | low | No one puts a banner in mipmap. Rejected |
| 23 | edge-case | Nothing compares the version with the last released tag | low | The bump is a documented manual step; a forgotten bump fails visibly when the tag already exists. Rejected |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- all green
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- signed with the properties; unsigned without them (run with `-PBOOSTYTV_RELEASE_STORE_FILE=` overrides absent, using a scratch `GRADLE_USER_HOME` copy without them)
- `apksigner verify --print-certs app-release.apk` -- prints the certificate subject and digest only

**Manual checks:**
- The owner approves the banner and icon previews before the commit. On the device: the launcher row, an install over the previous build keeps the session.
