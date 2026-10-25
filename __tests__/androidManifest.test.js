/**
 * Static guard for the Android TV manifest (Story 1.1).
 *
 * Cheap source-level guard. The release build gets usesCleartextTraffic=false
 * from the React Native Gradle plugin's build-type placeholder; this test makes
 * sure the source manifest keeps using that placeholder and the TV entries.
 * The merged release manifest itself is checked in CI (.github/workflows/ci.yml,
 * "Check release manifest").
 */
const fs = require('fs');
const path = require('path');

const manifest = fs.readFileSync(
  path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  'utf8',
);

describe('AndroidManifest.xml', () => {
  it('takes usesCleartextTraffic from the build-type placeholder', () => {
    expect(manifest).toContain('android:usesCleartextTraffic="${usesCleartextTraffic}"');
    expect(manifest).not.toMatch(/usesCleartextTraffic="true"/);
  });

  it('disables backup', () => {
    expect(manifest).toContain('android:allowBackup="false"');
  });

  it('is launchable from the Android TV launcher with a banner', () => {
    expect(manifest).toContain('android.intent.category.LEANBACK_LAUNCHER');
    expect(manifest).toContain('android:banner=');
  });

  it('does not require touch hardware or the leanback feature', () => {
    for (const feature of [
      'android.hardware.touchscreen',
      'android.hardware.faketouch',
      'android.software.leanback',
    ]) {
      const tag = manifest
        .split('<uses-feature')
        .slice(1)
        .map(chunk => chunk.slice(0, chunk.indexOf('>')))
        .find(attrs => attrs.includes(`android:name="${feature}"`));
      expect(tag).toBeDefined();
      expect(tag).toContain('android:required="false"');
    }
  });
});
