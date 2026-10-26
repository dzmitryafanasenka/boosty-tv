/**
 * Story 2.5 release guard (CI): the committed app config keeps the demo mode
 * off. android/app/build.gradle (`checkDemoModeOff`) applies the same rule
 * before every release JS bundle, so a release build fails while it is on.
 */
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = path.resolve(__dirname, '../src/app/appConfig.ts');
/** Keep in sync with `checkDemoModeOff` in android/app/build.gradle. */
const OFF = /^export const DEMO_MODE = false;$/m;
const ANY = /^export const DEMO_MODE\b/gm;

test('DEMO_MODE is false and declared exactly once', () => {
  const source = fs.readFileSync(CONFIG, 'utf8');
  expect(source.match(ANY)).toHaveLength(1);
  expect(OFF.test(source)).toBe(true);
});

