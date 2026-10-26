---
title: 'Story 2.4: The app shell — sidebar, Back and focus'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: 'e151abcce2eaf400d12935294934133bdd7f2f5f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/adr/0007-navigation-js-stack.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After sign-in the app shows a temporary «Вход выполнен» screen with nothing to do. There is no sidebar, no defined Back order, no modal host and no focus restoration. Every later screen depends on these.

**Approach:**
- Replace SignedIn with the Shell. The Shell has an always-expanded sidebar gated by `app/phaseFlags.ts` (Главная, Настройки) and swaps section content in place.
- Главная shows the neutral StateView «Лента появится здесь». Настройки shows one focusable info row «Версия <versionName>».
- Add these in `shared/focus`:
  - **FocusRestoration:** `{focusId, scrollOffset}` per route key and section, with a fallback chain;
  - **the modal host:** focus trap, Back closes it first, focus returns to the initiator;
  - **the Shell Back order.**
- Prove them on the device with a debug-only «Проверка фокуса» screen.

## Boundaries & Constraints

**Always:**
- **Sidebar (`docs/focus-map.md` §3, DESIGN NavItem).**
  - Wordmark «Boosty TV», then the items from `phaseFlags`. Only `home` and `settings` are on in Epic 2. `search`, `subs` and `events` are defined but off and not rendered.
  - Current item: `surface-current` with an accent bar. Focused item: ring plus `surface-focus-row`. These look different.
  - ↑ ↓ move between items with no wrap. A section opens only on OK.
  - → returns to the section's remembered content focus. If there is no focusable content, focus stays on the sidebar.
  - Focus ids: `nav/home`, `nav/settings`.
  - Layout: sidebar width `spacing.sidebar-width`, background `bg-sidebar`, content from `spacing.content-x`, and the DESIGN safe area (48/27 dp) for all text and focusables.
- **Initial focus.** Shell opens on Главная with focus on `nav/home`, because the content has no focusable element. Settings content initial focus is `settings/row/version`.
- **Back in Shell (AD-13 order):**
  1. the modal host, if open: closes it, and focus returns to the initiator;
  2. content focus → the sidebar's current item;
  3. sidebar on another section → Главная selected with focus on `nav/home`;
  4. sidebar on Главная → the app exits.
- **Zones.** ← from the first content column moves to the current sidebar item, through `TVFocusGuideView` destinations. There is no wrap at any edge.
- **FocusRestoration (AD-12).**
  - It is a single store with the API `remember(routeKey, sectionId, focusId, scrollOffset)`, `setReturnFocus(routeKey, focusId)` and `restore(routeKey, sectionId)`.
  - On return: restore the scroll first, then scroll a virtualized item into view by its current index (found by id), then focus it with `requestHostFocus`.
  - Fallback chain: the neighbor by index → the first item of the zone → the nearest action above, given by the screen.
  - Android's fallback focus is never relied on.
- **Modal host:** one host rendered above the stack. `open(content, initiatorRef)` shows `content` inside a 4-side trap on `colors.scrim`. Back closes it, and focus returns to the initiator. Background controls receive no focus while it is open.
- **Settings row:** an info SettingRow, focusable, `setting-row` tokens. OK does nothing. The version comes from the native `versionName`.
- **StateView** (`shared/ui`): icon, `title-s` title, `body-s` text and an optional single action. Главная uses it with no action.
- **Debug «Проверка фокуса»** (`__DEV__` only; the release bundle must not include it):
  - reached from Настройки by a debug-only row;
  - a FlatList of 300 cards with ids `dev/list/<n>`;
  - OK on a card pushes a detail route; Back pops and restores focus to that card;
  - deleting the focused card before the return shows the fallback;
  - a button opens a test dialog through the modal host.
- **Edge-to-edge (deferred decision).** Check on the device whether `edgeToEdgeEnabled=true` clips content or the safe area. Keep it if not; otherwise set it false. Record the result in `docs/testing.md`.
- **Signed-in boot:** the startup gate opens `Shell` (the `SignedIn` route and screen are removed). Copy goes through the `ru` catalog (`shell.*`, `home.placeholder.*`, `settings.version`).

**Never:**
- a JS focus engine;
- raw D-pad handlers;
- sign-out (Story 2.7), search, subscriptions or events content;
- dev screens in release;
- wrap-around;
- touching the owner's stored session: no uninstall, no clear data, no sign-out.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Open Shell | Signed-in boot | Главная current, focus `nav/home`, StateView shown | — |
| Open section | Focus `nav/settings`, OK | Настройки current, focus moves to `settings/row/version` | Focus alone does not switch |
| Back from content | Focus on the version row | Focus `nav/settings` | — |
| Back from sidebar | `nav/settings` current, Back | Главная current, focus `nav/home` | — |
| Back at root | `nav/home` on Главная, Back | App exits | — |
| Edges | ↑ on the first item, ↓ on the last | Focus stays | No wrap |
| Restore | Push from `dev/list/150`, pop | Card 150 scrolled into view and focused | — |
| Restore fallback | Card 150 removed before pop | Card 151 (neighbor) focused; empty list → nearest action above | — |
| Modal | Dialog open, Back | Dialog closed, focus on the initiator | Background unfocusable while open |

## Decisions (owner, 2026-10-26)

- Device proof of restoration, modal trap and push/pop uses a debug-only «Проверка фокуса» screen. It is not in release builds.
- Настройки in 2.4 shows one focusable info row «Версия». Sign-out arrives in Story 2.7.

</frozen-after-approval>

## Code Map

- `src/app/App.tsx`, `src/app/routes.ts` -- the root stack and the startup gate (`boot.initial` = `SignedIn` today). Replace `SignedIn` with `Shell`. Add the dev routes `DevFocus` and `DevFocusDetail` registered only under `__DEV__`. Screens receive navigation callbacks via props; features cannot import `app` (boundaries lint).
- `src/features/auth/SignedInScreen.tsx` (+ its export and tests) -- delete it.
- New: `src/app/phaseFlags.ts` (AD-20: a capability → enabled map; Epic 2 enables `home` and `settings`), `src/app/Shell.tsx` (sidebar plus content swap; section state lives in Shell, not in the stack).
- New: `src/features/home/HomeScreen.tsx` (the StateView placeholder) and `src/features/settings/SettingsScreen.tsx` (the version row and the debug row). Each feature has an `index.ts`.
- `src/shared/focus/` -- `Screen.tsx` (the 4-side trap, Story 2.1) is reused by every stack screen. Add `focusRestoration.ts` (store + `useFocusRestoration` hook), `ModalHost.tsx` (provider + `useModal`), `NavItem` / `Sidebar` (or put NavItem in `shared/ui`).
- `src/shared/ui/` -- reuse `FocusableSurface`, `Text`, `requestHostFocus`, tokens (`components.nav-item`, `setting-row`, `state-view`, `dialog`). Add `StateView.tsx`, `SettingRow.tsx`, `NavItem.tsx`.
- Version: read `versionName` natively. `NativeModules.PlatformConstants` is not enough; add a `getVersionName` method to the existing `BoostyNativePackage` (`android/.../`), or use `BuildConfig.VERSION_NAME` through a small module. `android/app/build.gradle` has `versionName "1.0"`.
- `__tests__/codeFlow.test.tsx` and `signInFlow.test.tsx` expect `auth/signed-in` after sign-in; update them to the Shell (`shell/sidebar`, focus `nav/home`).
- `android/gradle.properties` -- `edgeToEdgeEnabled=true` (from the template; the decision is deferred to here).
- Device: the release-like build for the Shell, plus a **debug build** for «Проверка фокуса» (Metro on a free port with `adb reverse`; the stale Metro on 8081 is left alone). The owner is signed in, so Shell opens directly. `adb install -r` only.

## Tasks & Acceptance

**Execution:**
- [x] `src/app/phaseFlags.ts`, `Shell.tsx`, `src/shared/ui/NavItem.tsx`, `StateView.tsx`, `SettingRow.tsx`, `src/features/home`, `src/features/settings`, the native version, the `ru` catalog + tests -- the open, open-section, edges and Back rows of the matrix.
- [x] `src/shared/focus/focusRestoration.ts`, `ModalHost.tsx` + tests -- the restore, fallback and modal rows.
- [x] `src/app/App.tsx`, `routes.ts`, remove SignedIn, update the flow tests -- sign-in lands in Shell.
- [x] Debug «Проверка фокуса» (dev routes + screen under `__DEV__`) + a test that the release bundle has no dev route (grep the `--dev false` bundle for its id).
- [x] Device: on the release-like build, the Shell rows of the matrix with injected keys plus a screenshot; on the debug build, restore on the 300-card list, the fallback and the modal; the edge-to-edge decision. Record everything in `docs/testing.md`, update `docs/focus-map.md` notes. The owner checks the sidebar with the physical remote.

**Acceptance Criteria:**
- Given the signed-in owner on the device, when the app starts, then Shell opens with Главная current and focus on `nav/home`, without signing in again.
- Given `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` and the release bundle, when run, then all pass and the bundle contains no `dev/` route id.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/rn-check.bundle && ! grep -q "DevFocus" /tmp/rn-check.bundle` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | verification-gap | Sidebar/FocusZone `destinations` never asserted | medium | Pre-verified: no test reads `destinations`; dropping `refreshDestination()` from `onItemFocus` stays green | patch |
| 2 | verification-gap | `AppInfo` native name/constant key checked only on the device | low | Pre-verified: JS tests fake `NativeModules.AppInfo`; no native tests in the repo | defer |
| 3 | blind | `hasTVPreferredFocus` always on `nav/home` fights restore | false | The prop is true from mount and never changes, so React never re-sends it; native applies it only on prop set | reject |
| 4 | blind | `restore()` overrides the remembered offset with `scrollToIndex(viewPosition 0.5)` | low | `useFocusRestoration.ts` calls both unconditionally; every return recentres the card instead of the user's position (device: "focused and centered") | patch |
| 5 | blind, edge | `scrollToIndex` without `getItemLayout`/`onScrollToIndexFailed` | low | The only consumer has `getItemLayout`; future variable-height lists would hit the VirtualizedList invariant. The requirement is undocumented | patch |
| 6 | blind, edge | Restore frame loop not cancelled on a user D-pad move, blur or unmount | medium | `attempt` bumps only in `restore()`; a move during the ≤30-frame wait is overridden, a covered screen can pull focus | patch |
| 7 | blind, edge | `focusRestoration.forget` never called; stale route entries | low | In-memory only, no persistence; account isolation needs `clear()` on sign-out | defer |
| 8 | blind | `setReturnFocus` override never consumed by Shell zones (`peek` only) | low | No caller targets the Shell route; harm only if a future caller does | reject |
| 9 | blind, edge | FocusZone remembers scroll 0 and no index, so no neighbor fallback | low | Today's zones hold two static rows; the difference from §1.6 is undocumented | patch |
| 10 | blind, edge | Modal close with a missing/unmounted initiator; reset or nested open while a modal is open | maybe-false (medium if true) | Not reachable in 2.4 (the only caller keeps its initiator mounted; no reset path while open). Settle when sign-out/expiry resets (2.5–2.7) can run with a dialog open | defer |
| 11 | blind | Modal Back priority relies on listener order | maybe-false (medium if true) | Today the modal listener is always newest; a screen registering a listener while a dialog is open would break it. Needs a documented contract | defer |
| 12 | blind | Open-dialog test does not check the focus target | low | `ModalHost.test.tsx` only asserts the target is not null | patch |
| 13 | blind | Sidebar left edge not trapped; unexplained ← jump on `nav/home` | medium | `shell/sidebar` has no `trapFocusLeft`; the spec says focus stays at every edge; device saw one jump to `nav/settings` | patch |
| 14 | blind, edge | Dev copy and `SETTINGS_FOCUS_CHECK_ID` ship in release | low | Strings only, nothing rendered or routable in release; fixing means splitting the typed catalog | reject |
| 15 | blind | `releaseBundle.test.js` builds two bundles inside `npm test` | low | The spec asks for this test; the full run took 3 s here with a warm cache | reject |
| 16 | blind | `AppInfoModule` uses a deprecated `getPackageInfo` overload | low | Works on the device; the spec allows either approach | reject |
| 17 | blind | Back right after OK, before the native focus event, skips a step | low | Needs Back within a few ms of OK; the fix adds state | reject |
| 18 | edge | `close()` before `open()` commits is a no-op (`modalRef` set on render) | low | Direct correction: set `modalRef.current` in `open()` | patch |
| 19 | edge | Modal content without a focusable element leaves focus behind | low | Dev-only content today, always has buttons | reject |
| 20 | edge | rAF focus after provider unmount | false | `requestHostFocus` on a detached view is a no-op; the provider is the app root | reject |
| 21 | edge | `phaseFlags.home` false breaks Shell | false | Главная is not phase-gated by design (focus-map §3); the flag exists only for the map shape | reject |
| 22 | edge | FocusZone cached ref callbacks keep a stale `refreshDestination` | false | The zone is keyed by section; `routeKey`, `sectionId`, `initialFocusId` never change for a mounted zone | reject |
| 23 | edge | Negative dev list height on a tiny window | false | Fixed TV window (540 dp); dev only | reject |
