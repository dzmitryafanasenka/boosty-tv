# ADR 0007: Navigation with the React Navigation JS stack; react-native-screens not rendered

- Status: accepted (owner decision 2026-10-25: try the JS stack first, own minimal stack only if it fails on the device)
- Date: 2026-10-25
- Supersedes: [ADR 0005](0005-native-stack-debug-build-push-defect.md)
- Amends: [ADR 0003](0003-navigation-react-navigation.md) (the root navigator type; Shell, modal host, route params and FocusRestoration stay)

## Context
In Story 1.2, `@react-navigation/native-stack` 7.21.0 with `react-native-screens` 4.30.0 intermittently failed to show a pushed screen on the Chromecast with Google TV 4K (react-native-tvos 0.87.1-1, New Architecture). The JS stack changed, but the new screen stayed invisible, and logcat showed `SurfaceMountingManager:MissingViewState`. This happened in debug builds every time, and in release-like builds after a cold start (owner with the physical remote, then reproduced with injected keys after a reboot). The root cause is in the react-native-screens / Fabric mounting path and is not understood.

The same A/B scenario was then built with `@react-navigation/stack` 7.12.1 (JS stack) and `react-native-gesture-handler` 3.4.0. RNGH's own `compatibility.json` lists 3.4.x for RN 0.85–0.88. Results are in `docs/testing.md` (Story 1.2). With keys injected via adb, after each OK uiautomator confirmed that B was visible and focused, and after each Back that focus was on A's item 2:
- release-like build: 50/50 push/pop cycles (20 after a cold start, then 3 × 10 after force-stop and cold start), no `MissingViewState`, no exceptions;
- debug build (Metro): the same 50/50, with no errors.

Two TV focus findings came with it:
- The JS stack keeps the previous screen mounted under the top one. Android focus search reached A's items from B on D-pad. Wrapping each screen in a `TVFocusGuideView` with `trapFocusUp/Down/Left/Right` stopped it (0 escapes in both builds).
- After a pop, Android moves focus to the first focusable view of A (item 1). Focus returns to item 2 only through explicit restoration: on blur, remember the last focused item; on focus, give it `hasTVPreferredFocus`.

## Decision
- The root navigator is `createStackNavigator` from `@react-navigation/stack`, with `detachInactiveScreens={false}`, `headerShown: false` and `gestureEnabled: false`. With `detachInactiveScreens={false}` the stack renders plain Views, not `RNSScreenContainer` / `RNSScreen`. A global `enableScreens(false)` was not needed.
- `@react-navigation/native-stack` is dropped from the plan.
- `react-native-screens` stays installed only because it is a peer dependency of `@react-navigation/stack`; the app never renders its views. The `RNScreensFragmentFactory` step in `MainActivity` is **not** carried to production (spike branch only).
- `react-native-gesture-handler` 3.4.0 is added (required peer). Gestures are disabled; no touch interaction is used.
- Every stack screen sits inside a focus-trapping `TVFocusGuideView`. Return focus is owned by FocusRestoration (ADR 0003), which must restore the remembered content id when a screen regains focus. Android's fallback focus is never relied on.

## Consequences
- Inactive screens stay mounted. Memory and render cost grow with stack depth. The planned stack is shallow (Shell → Author/Post → Player), so this is acceptable, but it is **unmeasured** on this 32-bit device with ~350 MB free. Story 9.3 measures memory with Shell + Post + Player mounted; if it is too high, unmount heavy content (images, players) of covered screens, or revisit this ADR.
- The focus trap and the restoration hook are mandatory parts of the shared screen wrapper in `shared/focus`, and need component tests plus a device check.
- The spike restored focus by item index in a static three-item list. Production restores by content id (AD-12). In virtualized lists the remembered card may be unmounted on return, so restoration must scroll it into view first and use the documented fallback chain. Story 2.4 must verify this on a long virtualized list on the device, and `docs/focus-map.md` (Story 1.8) must include the screen-level trap and the restoration rule.
- If the JS stack shows a device defect later (pushed screen not visible, focus loss, Back misrouting), switch to the own minimal stack behind the same `app/routes.ts` contract (ADR 0003 fallback) with a new ADR.
- The owner's physical-remote check of the JS stack passed (2026-10-25): no focus escape from B, Back returns focus to item 2, and Back again leaves the check.
