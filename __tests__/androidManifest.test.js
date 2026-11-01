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

const main = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
const res = path.join(main, 'res');
const manifest = fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  expect(buf.toString('latin1', 1, 4)).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

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

  it('Story 8.2: declares the VIEW video/* query (other players are visible on Android 11+), nothing broader', () => {
    const queries = manifest.slice(manifest.indexOf('<queries>'), manifest.indexOf('</queries>'));
    expect(queries.length).toBeGreaterThan(0);
    const intents = queries.split('<intent>').slice(1);
    expect(intents.length).toBeGreaterThan(0);
    for (const intent of intents) {
      expect(intent).toContain('<action android:name="android.intent.action.VIEW" />');
      expect(intent).toContain('android:mimeType="video/*"');
    }
    expect(queries).toContain('android:scheme="https"');
    expect(queries).not.toContain('<package');
    expect(manifest).not.toContain('QUERY_ALL_PACKAGES');
  });

  it('Story 9.1: the banner resolves to one 320x180 xhdpi PNG', () => {
    const banners = [...manifest.matchAll(/android:banner="([^"]*)"/g)].map(m => m[1]);
    expect(banners.length).toBeGreaterThan(0);
    expect(new Set(banners)).toEqual(new Set(['@drawable/tv_banner']));
    const found = fs
      .readdirSync(res)
      .filter(dir => dir.startsWith('drawable'))
      .filter(dir => fs.readdirSync(path.join(res, dir)).some(f => f.startsWith('tv_banner.')));
    expect(found).toEqual(['drawable-xhdpi']);
    expect(pngSize(path.join(res, 'drawable-xhdpi', 'tv_banner.png'))).toEqual({
      width: 320,
      height: 180,
    });
  });

  it('Story 9.1: the launcher icon is adaptive on API 26+ with legacy PNGs below', () => {
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"');
    for (const name of ['ic_launcher', 'ic_launcher_round']) {
      const xml = fs.readFileSync(path.join(res, 'mipmap-anydpi-v26', `${name}.xml`), 'utf8');
      expect(xml).toContain('<adaptive-icon');
      expect(xml).toContain('@color/ic_launcher_background');
      expect(xml).toContain('@drawable/ic_launcher_foreground');
    }
    expect(fs.existsSync(path.join(res, 'drawable', 'ic_launcher_foreground.xml'))).toBe(true);
    expect(fs.readFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), 'utf8')).toContain(
      'name="ic_launcher_background"',
    );
    const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    for (const [density, size] of Object.entries(sizes)) {
      for (const name of ['ic_launcher', 'ic_launcher_round']) {
        expect(pngSize(path.join(res, `mipmap-${density}`, `${name}.png`))).toEqual({
          width: size,
          height: size,
        });
      }
    }
  });
});
