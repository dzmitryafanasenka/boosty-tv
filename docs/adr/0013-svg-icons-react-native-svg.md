# ADR 0013: SVG icons with react-native-svg

- Status: accepted (owner decision 2026-10-28)
- Date: 2026-10-28
- Relates to: `_bmad-output/implementation-artifacts/spec-4-3-choose-video-quality.md` (Decisions, owner decisions 2026-10-28), `docs/focus-map.md` §4 G (Story 4.3 notes), `docs/testing.md` «Story 4.3»

## Context

Story 4.3 added a player controls row «−10 с» · play/pause · «+10 с» and a gear «Настройки» control. The first version drew the icons with Unicode glyphs (↺/↻ with a small «10» on top, ⚙) to avoid a dependency. On the pinned Chromecast with Google TV the «10» overlapped the arrow and the ±10 icons were unreadable (owner device check, 2026-10-28). Views alone cannot draw a clean circular arrow with an arrowhead. The owner chose an SVG library.

## Decision

- Add `react-native-svg` **15.15.5** (licence MIT), exact pin (`package.json` + `package-lock.json`; published 2026-05-11, the newest release older than two weeks; its README claims React Native ≥ 0.78; peer dependencies `react: *`, `react-native: *`). Its transitive dependencies are `css-select` and `css-tree` (lockfile additions only; no other package version changed).
- Icons live in `src/shared/ui/icons/` (`SkipIcon`: a circular counter-clockwise or clockwise arrow with «10» centered, YouTube-like; `GearIcon`). They are drawn on a 24-unit grid for the 40 dp PlayerControl, take the control's ink as `color` (inverted when focused) and are hidden from accessibility (the control carries the label). The «10» comes from the `ru` catalog (no raw copy in UI code).
- Features import the icons from `shared/ui`, never `react-native-svg` directly.
- Jest uses a manual mock (`__mocks__/react-native-svg.js`) that renders plain host elements with the props as given; native drawing is a device check.

## Compatibility check

`cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` on react-native-tvos 0.87.1-1 (New Architecture): **BUILD SUCCESSFUL** (2026-10-28, host only). The check covered **armeabi-v7a only** (the pinned device's ABI); other ABIs were not built. The unsigned release APK contains `lib/armeabi-v7a/libreact_codegen_rnsvg.so`, the `com.horcrux.svg` classes in its dex, and the Hermes bundle references the `RNSVG*` components. The 15.16.0 fallback (RN ≥ 0.80) was not needed. Rendering on the TV is not yet checked (device row in `docs/testing.md` «Story 4.3»).

## Consequences

- One more native module in the app (codegen library, ≈ 0.6 MB `.so` per ABI). Upgrades follow the same rule: exact pin, a release older than two weeks, and a release build plus a device check.
- Other icons (lock, sidebar, etc.) may move to SVG later; each is its own change.
