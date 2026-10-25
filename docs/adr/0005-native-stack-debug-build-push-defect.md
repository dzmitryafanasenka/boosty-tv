# ADR 0005: Keep React Navigation native-stack despite a debug-build push defect

- Status: superseded by [ADR 0007](0007-navigation-js-stack.md) (owner decision 2026-10-25). The defect also reproduced in the release-like build (owner-reported intermittent freeze, then reproduced via adb after a reboot), so the premise "release works" is false; see `docs/testing.md`, Story 1.2.
- Date: 2026-10-25
- Relates to: [ADR 0003](0003-navigation-react-navigation.md)

## Context

> **Superseded.** The premise below ("the release-like build works") was disproved on 2026-10-25: the same defect appeared in the release-like build (owner-reported, then reproduced). See [ADR 0007](0007-navigation-js-stack.md).

Story 1.2 ran a two-screen native-stack check (`@react-navigation/native-stack` 7.21.0, `react-native-screens` 4.30.0, `@react-navigation/native` 7.5.1) on the Chromecast with Google TV 4K, react-native-tvos 0.87.1-1, New Architecture. Results are in `docs/testing.md` (Story 1.2).

- **Release-like build** (release variant, Hermes bytecode, signed locally with the SDK debug key): push, Back-pop and focus return to the pushing item all work. Five push/pop cycles in a row, no Fabric errors in logcat. Keys injected via adb.
- **Debug build** (debug variant, JS from Metro): `navigate('B')` updates the JS stack (`A > B`) and B's button receives an `onFocus`, but B never appears on screen. logcat shows `ReactNoCrashSoftException: Unable to find viewState for tag ... for addViewAt / updateProps / updateLayout` (`SurfaceMountingManager:MissingViewState`), and the accessibility tree contains a zero-height B. It reproduces with stack animation off, without `hasTVPreferredFocus` on B, with the `RNScreensFragmentFactory` install step in `MainActivity`, and with JS dev mode off (so it follows the debug native build, not `__DEV__`). Once, after a Fast Refresh, Back crashed with `IndexOutOfBoundsException` in `ScreenContainer.getScreenAt` (via `ScreenStackViewManager.removeViewAt`).

ADR 0003 names the fallback (own minimal stack) for the case where "Back or focus misbehaves on the device". In the build that ships, they do not.

## Decision
Keep React Navigation native-stack and react-native-screens at the pinned versions. Do not switch to the own minimal stack now.

Mitigations:
- Any navigation (push/pop/focus-return) acceptance check runs on a release-like build. Debug builds are fine for single-screen work only.
- The production `MainActivity` keeps the `RNScreensFragmentFactory` install step from the react-native-screens README.
- Re-test the debug build on every react-native-screens or react-native-tvos upgrade.

## Revisit triggers (switch to the own minimal stack behind `app/routes.ts`)
- The push defect, a `MissingViewState` error or the `getScreenAt` crash is seen in a release build.
- The physical-remote check (owner) shows focus not returning after Back in the release build.
- The debug-only defect blocks development of the Epic 2 screens and no upstream fix exists.

## Consequences
- Developers cannot see pushed screens in debug builds. Navigation flows need a release-like build (`assembleRelease` plus local `apksigner` with the SDK debug key, or a locally configured signing; never committed).
- The root cause is not known. It may be a race in the debug native build that a slower path exposes; a release-build recurrence is the main risk and is covered by the triggers above.
