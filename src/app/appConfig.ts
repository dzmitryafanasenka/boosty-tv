/**
 * Build-time app switches.
 *
 * `DEMO_MODE`: the debug-only demo (Story 2.5). When true **and** `__DEV__`,
 * the app boots a synthetic in-memory session over `FixtureTransport` and
 * shows the «ДЕМО» badge; SecureStore is never read, written or cleared, so
 * a stored session survives. Release builds ignore it, and the release build
 * fails while it is true: `checkDemoModeOff` in android/app/build.gradle
 * runs before the release JS bundle, and __tests__/demoModeOff.test.js fails
 * CI. Keep the line below exactly in this form; the Gradle check reads it.
 */
export const DEMO_MODE = false;
