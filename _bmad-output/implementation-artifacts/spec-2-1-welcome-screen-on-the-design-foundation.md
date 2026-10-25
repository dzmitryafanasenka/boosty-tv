---
title: 'Story 2.1: Welcome screen on the design foundation'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: '5ed4742157c258f7adf5628160349bda0af7b953'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app still shows the Story 1.1 placeholder. No production UI foundation exists yet: there are no design tokens, no bundled font, no focus primitive, no string catalog. Every later screen needs these, and A1 Welcome is the first screen a family member sees.

**Approach:**
- Build the shared foundation in `src/shared`: `ui/tokens.ts` with every DESIGN.md token, bundled Golos Text, the `FocusableSurface` and `Button` primitives, a reduced-motion hook, the shared `Screen` wrapper (focus trap on all four sides, ADR 0007), and a typed `ru` catalog over the existing plural selector.
- Render A1 Welcome with it as the app's only screen: hero «Boosty TV», one primary «Войти в Boosty», the footer disclaimer.
- Session detection (2.5), navigation (2.2/2.4) and sign-in (2.2) are later stories.

## Boundaries & Constraints

**Always:**
- **Layout.** Design values ÷ 2 in dp/sp. A1 from the mock (`Auth Screen.dc.html`, A1 entry in `Boosty TV - A B C.dc.html`):
  - centered column 440 dp wide, top at 150 dp;
  - hero «Boosty» + accent « TV», `typography.hero`;
  - body «Видео из ваших подписок Boosty на телевизоре.» in `text-secondary`, 12 dp below;
  - the button 24 dp below;
  - footer «Неофициальный клиент, не связан с Boosty. Вход по номеру телефона и коду.» in `text-tertiary`, `typography.meta`, at the safe area (48 dp from left/right, 27 dp from the bottom);
  - background `colors.bg`; no wordmark in the corner (hero only).
- **Focus (`docs/focus-map.md` §1, §2 A1).** The button is the only focusable element and gets initial focus. OK does nothing yet (A2 lands in Story 2.2). Back is not intercepted, so Android exits the app.
- **FocusableSurface.**
  - Focused: a ring (`focus-ring`, width 2, offset 2, following the radius) plus the component's lift and scale.
  - The scale is a transform only, so neighbors never move and the ring is not clipped.
  - Pressed: scale 0.98 for `motion.press`.
  - Disabled: `focusable={false}` and `text-disabled`.
  - Transitions use `motion.focus` with the native driver. With «reduce motion» (`AccessibilityInfo`) the scale values stay and the animation is dropped.
  - No box shadow on buttons: DESIGN allows the shadow only on cards.
- **Button:** primary and secondary kinds, normal and small sizes, from DESIGN `components.button-*`. `accessibilityRole="button"`, and `accessibilityLabel` = its label.
  - `busy`: shows a spinner (`motion.spinner`), keeps focus, ignores OK and reports `accessibilityState.busy`.
- **Screen wrapper:** `shared/focus/Screen` is a `TVFocusGuideView` with `trapFocusUp/Down/Left/Right`, a `colors.bg` background and full size. Every screen uses it. Focus restoration is not part of it yet (FocusRestoration lands in Story 2.4).
- **Font:** Golos Text static TTFs, weights 400 and 600, from Google Fonts (OFL). Copied into `android/app/src/main/assets/fonts/` with the file basename = PostScript name, plus `OFL.txt`. Typography tokens set `fontFamily` per weight and no `fontWeight`, to avoid synthetic bold.
- **Strings:** only through the typed catalog. Keys include `welcome.*` and `error.<kind>` for every AD-5 kind, with EXPERIENCE › Voice and Tone copy. Plurals use `pluralRu`. The `react-native/no-raw-text` lint rule is on for `src/features` and `src/shared/ui`.

**Never:**
- navigation libraries;
- session or storage code;
- a sign-in screen or any API call;
- a sidebar;
- a debug screen in production code;
- text below 11 sp;
- literal UI strings in components.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Start | App launch | A1 shown, the button focused (`hasTVPreferredFocus`) | — |
| Focus states | Focused / pressed / disabled Button | Ring + lift + scale 1.04; pressed 0.98; disabled not focusable, no ring | — |
| Busy | `busy` Button, OK pressed | Spinner shown, focus kept, `onPress` not called | — |
| Reduce motion | `isReduceMotionEnabled` true, or a change event | Scale applied without animation | Query rejects → motion stays on |
| Plurals | `lesson` test key with 1, 2, 5, 21 | урок / урока / уроков / урок | Invalid count throws (existing contract) |
| Tokens | DESIGN.md frontmatter | Every color, typography, rounded, spacing, focus and motion key and value exists in `tokens.ts` | Test lists the mismatches |

</frozen-after-approval>

## Code Map

- `src/app/App.tsx` -- Story 1.1 placeholder; replace its body with `<WelcomeScreen />` and `StatusBar hidden`. `__tests__/App.test.tsx` tests the placeholder: rewrite it for A1.
- `src/shared/i18n/plural.ts` -- existing `pluralRu(n, forms)` and `selectRuPluralCategory`; reuse, do not change. Add `ru.ts` (catalog) and `index.ts` (`t(key)`, `tp(key, n)`), typed so unknown keys fail typecheck.
- `src/shared/ui/` -- new: `tokens.ts`, `FocusableSurface.tsx`, `Button.tsx`, `useReducedMotion.ts`, `Text.tsx` (a thin `Text` that takes a typography token name), `index.ts`.
- `src/shared/focus/` -- empty today (`.gitkeep`); add `Screen.tsx` + `index.ts`. `TVFocusGuideView` comes from `react-native` (react-native-tvos); see the Story 1.2 spike usage on `spike/1-2-library-compat` (`git show origin/spike/1-2-library-compat:src/app/spike/JsStackCheck.tsx`) for the trap props.
- `src/features/auth/` -- new `WelcomeScreen.tsx`, plus `index.ts` exporting it. The boundaries lint (`.eslintrc.js`) allows app → feature index and feature → shared.
- `.eslintrc.js` -- add an `overrides` entry turning on `react-native/no-raw-text` for `src/features/**` and `src/shared/ui/**`. The plugin already ships with `@react-native/eslint-config`.
- `android/app/src/main/assets/fonts/` -- new: font files and `OFL.txt`. RN Android resolves `fontFamily` by asset file name, so no native code is needed.
- `docs/testing.md` -- add a Story 2.1 results section (device checks).
- Tests use `test-renderer` the way `__tests__/App.test.tsx` does (no RNTL). A token test reads `DESIGN.md` from the repo, regex-parses the frontmatter groups and compares them with `tokens.ts`.
- Device: release-like build `./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a`, `zipalign` + `apksigner` with the SDK debug key outside the repo, then `adb install -r`. The spike builds share the package id `io.github.dzmitryafanasenka.boostytv`, so this replaces the spike app but keeps its data, including the owner's stored session used by later spike re-runs. **Never uninstall and never clear app data.** The device serial is in `docs/testing.md` (wireless adb; the port changes after a reboot).

## Tasks & Acceptance

**Execution:**
- [x] `android/app/src/main/assets/fonts/*` -- fetch the Golos Text 400/600 static TTFs and `OFL.txt` (google/fonts `ofl/golostext`). Record the source URL and the PostScript names in Implementation Notes.
- [x] `src/shared/ui/tokens.ts` + `__tests__` token test -- all DESIGN.md token groups as typed `as const` objects.
- [x] `src/shared/i18n/ru.ts`, `index.ts` + tests -- welcome copy, `error.<kind>` copy, a `test.lesson` plural entry; `t`/`tp` typed.
- [x] `src/shared/ui/useReducedMotion.ts`, `FocusableSurface.tsx`, `Button.tsx`, `Text.tsx`, `index.ts` + component tests -- the focused, pressed, disabled, busy and reduced-motion states (the matrix rows).
- [x] `src/shared/focus/Screen.tsx`, `index.ts` + test -- the trap props are set on all four sides.
- [x] `src/features/auth/WelcomeScreen.tsx` (inside `Screen`), `index.ts`, `src/app/App.tsx`, `__tests__/App.test.tsx` -- A1; the test checks the single focusable element, initial focus, label text from the catalog, and the accessibility label.
- [x] `.eslintrc.js` -- the no-raw-text override; prove it fires on a raw literal (a test like `__tests__/boundaries.test.js`).
- [x] Device -- install and launch from the home screen. Check by screenshot and uiautomator: font rendered, layout inside the safe area, focus ring and scale; OK changes nothing; Back exits to the launcher; uiautomator `content-desc` = «Войти в Boosty». TalkBack announcement and the physical-remote look are owner checks. Record the results in `docs/testing.md`.

**Acceptance Criteria:**
- Given a fresh launch, when A1 appears, then «Войти в Boosty» has focus and matches DESIGN.md, and Back exits the app.
- Given `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures`, when run, then all pass.
- Given a raw text literal in a feature component, when lint runs, then it fails.

## Design Notes

The ring is an absolutely positioned sibling inside the scaled wrapper: inset `-(offset + width)`, `borderWidth` = width, `borderRadius` = radius + offset + width. It scales together with the surface, and the wrapper keeps its layout size. The scale is an `Animated.Value` with `useNativeDriver: true`.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.

## Implementation Notes

- **Font source.** `google/fonts` `ofl/golostext` ships only the variable `GolosText[wght].ttf`, no static files. The static TTFs come from the upstream Google Fonts project that `ofl/golostext/METADATA.pb` pins (`source.repository_url` + `commit`):
  - `https://raw.githubusercontent.com/googlefonts/golos-text/cf2e27222937d97c2d858fff0499bcc667a64e9d/fonts/ttf/GolosText-Regular.ttf` — PostScript name `GolosText-Regular` (weight 400), sha256 `7149e646874639bca27661d2cf8a0728f84c8c5e426b63a99f8fd8c6ae1039a7`
  - `.../fonts/ttf/GolosText-SemiBold.ttf` — PostScript name `GolosText-SemiBold` (weight 600), sha256 `95887436ca7a31987ee2c77f9f11b90221b535125d5f54d6faa34afee2e8f676`
  - `.../OFL.txt` (same text as `google/fonts` `ofl/golostext/OFL.txt`), sha256 `ff532f9e8789f09a9fdffc3c0954eedfb0a48be77b2e2eb90f5f82e4f347f50c`
  - PostScript names read with `fc-scan`; both files include the `ru` language coverage.
- **Lint.** `react-native/no-raw-text` allows any element named `Text`, including the shared `Text`. The override (on `src/app/**`, `src/features/**`, `src/shared/ui/**`, `src/shared/focus/**`; tests excluded) therefore also sets `no-restricted-syntax` against literal JSX text, literal/template children (also as direct operands of a ternary, `&&`/`||` or `+`, and inside fragments) and literal `label` / `accessibilityLabel` / `accessibilityHint` / `placeholder` / `title` props. `__tests__/noRawText.test.js` has a failing probe per shape.
- **Small buttons** use `rounded.md` (DESIGN.md › Shapes: "small buttons"); `components.button-small` has no radius.
- **Busy Button** keeps the label rendered at opacity 0 and centers the spinner over it, so the width (and the focus ring) never changes. Text color and focus scale come from `components.button-*` (`button-secondary` has no `scaleFocus` in DESIGN.md, so it uses `focus.scale-button`).
- **Disabled Button background** is `colors.surface`: DESIGN.md has no disabled surface token (the mock's `#201E1C` is not a token).
- **Spinner** is a custom `Animated` ring rotating once per `motion.spinner` (900 ms, linear, native driver); `ActivityIndicator` cannot take a duration. It keeps spinning under «reduce motion», because it is a status indicator, not decoration.
- **Focus ids as testIDs.** The Welcome button's `testID` is its focus id `auth/welcome/signin` (docs/focus-map.md §1.5).
- **Reduced-motion test.** Native-driver updates do not re-render in `test-renderer`, so the tests assert `Animated.timing` calls (animated path) and `Animated.Value#setValue` (reduced path) instead of host styles.
- **Device.** Results in `docs/testing.md` › Story 2.1. Launched with the launcher intent via adb, not by remote navigation in the launcher. TalkBack and the physical-remote look remain owner checks.

- Coordinator re-check after the review patches (2026-10-26): lint, typecheck, 128 tests, check:fixtures pass; release-like build reinstalled with `adb install -r`; A1 screenshot matches the mock, uiautomator shows the focused node with content-desc «Войти в Boosty», Back returns to the Google TV home (agent via adb).

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | verification-gap | Reduce-motion event-before-query race untested | medium | patch | All three tests settle the query first; removing `&& !changed` passes |
| 2 | verification-gap, edge, blind | Catalog-only lint misses prop literals, ternary/&&/+ literals, fragment children; src/app and src/shared/focus not covered | medium | patch | Selectors only match direct JSX children; `<Button label="…" />` lints clean |
| 3 | blind | Busy toggles the button width, moving the focused ring | low | patch | Spinner + gap rendered beside the label |
| 4 | blind | Button text color and focus scale hard-coded instead of `components.*` | low | patch | Only bg/height/paddingX read from components |
| 5 | blind | App test's OK step skips the real `onClick` path | low | patch | Test sends only onPressIn/onPressOut |
| 6 | edge, blind | `t`/`tp` have no runtime guard for runtime-built keys | low | reject | Keys are typed; a cast key is a caller bug, and no caller builds keys at runtime |
| 7 | edge | Stale `focused` after disabled toggles while focused | low | reject | Render uses `focused && !disabled`; the re-enable-without-native-focus path is not shown reachable, and the fix adds a guard |
| 8 | edge | Pressed scale still plays while busy | low | reject | OK is ignored as specified; fixing needs a new surface prop |
| 9 | edge, blind | Spinner ignores reduce motion; no Spinner test | low | reject | Recorded implementation decision (a status indicator, not decoration); spec's reduce-motion rule targets focus transitions |
| 10 | edge | `hasTVPreferredFocus` with `disabled` | low | reject | No caller combines them |
| 11 | edge, blind | Large font scale may clip the Button or overlap A1 | maybe-false | defer | Needs a device check at max text size (deferred-work, Story 9.4) |
| 12 | edge | tokens test breaks on CRLF / missing frontmatter | low | reject | DESIGN.md is LF with frontmatter; a failure would be loud |
| 13 | blind | Catalog not locale-neutral | low | reject | One module owns the catalog and plural rule; adding a locale stays local to `shared/i18n` |
| 14 | blind | Brand split with a leading space in `welcome.titleAccent` | low | reject | Cosmetic; the space keeps the nested Text free of raw literals |
| 15 | blind | `wasPressed` ref mutated inside the effect (StrictMode) | low | reject | The app does not run StrictMode; only the release easing could differ |
| 16 | blind | Screen test relies on `isTVSelectable` | low | reject | Test-only coupling; an upgrade would fail loudly |
| 17 | blind | No ADRs; no tvOS font note; tokens test depends on `_bmad-output` path | low | defer (tvOS font) / reject (rest) | tvOS bundling deferred to phase 4; the token source path is the design spine by project rule |
