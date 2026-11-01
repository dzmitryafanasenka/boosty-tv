/**
 * Story 9.1 source guard for release signing and versioning in
 * android/app/build.gradle. The real signing is checked by building with the
 * owner's properties and `apksigner verify --print-certs` (docs/release.md);
 * this test only keeps the build script honest: the four property names, no
 * literal signing secret, signing gated on all four, a partial-set check
 * before packaging, and a MAJOR.MINOR.PATCH version with a derived code.
 */
const fs = require('node:fs');
const path = require('node:path');

const gradle = fs.readFileSync(
  path.resolve(__dirname, '../android/app/build.gradle'),
  'utf8',
);

const KEYS = [
  'BOOSTYTV_RELEASE_STORE_FILE',
  'BOOSTYTV_RELEASE_STORE_PASSWORD',
  'BOOSTYTV_RELEASE_KEY_ALIAS',
  'BOOSTYTV_RELEASE_KEY_PASSWORD',
];

describe('android/app/build.gradle release signing', () => {
  it('reads exactly the four owner-held property names', () => {
    for (const key of KEYS) {
      expect(gradle).toContain(`"${key}"`);
    }
    const names = new Set(gradle.match(/BOOSTYTV_RELEASE_[A-Z_]+/g));
    expect([...names].sort()).toEqual([...KEYS].sort());
  });

  it('has no literal signing secret or keystore path', () => {
    // Every signing field takes its value from a property, never a literal.
    for (const field of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      const lines = gradle.split('\n').filter(line => line.trim().startsWith(`${field} `));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('releaseSigningValue("BOOSTYTV_RELEASE_');
    }
    expect(gradle).not.toMatch(/["'][^"'\n]*\.(jks|keystore|p12)["']/);
    expect(gradle).not.toMatch(/(store|key)Password\s*[=(]?\s*["']/);
    expect(gradle).not.toMatch(/\bSystem\.getenv\b/);
  });

  it('applies the release signingConfig only when all four are set', () => {
    expect(gradle).toMatch(
      /releaseSigningEnabled = missingReleaseSigningKeys\.isEmpty\(\)/,
    );
    expect(gradle).toMatch(
      /if \(releaseSigningEnabled\) \{\s*signingConfig signingConfigs\.release\s*\}/,
    );
    expect(gradle).toMatch(/signingConfigs \{\s*if \(releaseSigningEnabled\) \{\s*release \{/);
    // An empty value counts as not set (CI and the unsigned check build).
    // A blank value counts as not set; real values are not trimmed.
    expect(gradle).toContain('value.toString().trim().isEmpty() ? null : value.toString()');
    expect(gradle).not.toMatch(/return [^\n]*\.trim\(\)\s*$/m);
  });

  it('fails a partial set before packaging, naming keys and never values', () => {
    expect(gradle).toContain('tasks.register("checkReleaseSigning")');
    expect(gradle).toMatch(
      /tasks\.matching \{ it\.name == "preReleaseBuild" \}\.configureEach \{\s*dependsOn "checkReleaseSigning"/,
    );
    const task = gradle.slice(gradle.indexOf('tasks.register("checkReleaseSigning")'));
    const message = task.slice(0, task.indexOf('if (storeFilePath != null)'));
    expect(message).toContain('missing.join(", ")');
    expect(message.slice(message.indexOf('doLast'))).not.toMatch(
      /releaseSigningValue|findProperty|\bproperty\(/,
    );
    // A set store file must be an absolute path to an existing file; the
    // message names the key, never the path.
    expect(task).toContain(
      'def storeFilePath = releaseSigningEnabled ? releaseSigningValue("BOOSTYTV_RELEASE_STORE_FILE") : null',
    );
    expect(task).toContain('!storeFile.isAbsolute() || !storeFile.isFile()');
    const storeMessage = task.slice(task.indexOf('!storeFile.isAbsolute()'), task.indexOf('tasks.matching'));
    expect(storeMessage).toContain('BOOSTYTV_RELEASE_STORE_FILE must be an absolute path');
    expect(storeMessage).not.toMatch(/\$\{|storeFilePath|storeFile\.(path|absolutePath|toString)/);
    // Nothing in the script prints a property value.
    expect(gradle).not.toMatch(/\b(println|logger\.\w+)\b/);
  });

  it('keeps the demo-mode guard on the release bundle', () => {
    expect(gradle).toMatch(
      /tasks\.matching \{ it\.name == "createBundleReleaseJsAndAssets" \}\.configureEach \{\s*dependsOn "checkDemoModeOff"/,
    );
  });

  it('uses a MAJOR.MINOR.PATCH versionName and derives versionCode from it', () => {
    const match = gradle.match(/^def appVersionName = "([^"]+)"$/m);
    expect(match).not.toBeNull();
    const parts = match[1].match(/^(\d+)\.(\d+)\.(\d+)$/);
    expect(parts).not.toBeNull();
    expect(Number(parts[2])).toBeLessThan(100);
    expect(Number(parts[3])).toBeLessThan(100);
    expect(gradle).toMatch(/^\s*versionName appVersionName$/m);
    expect(gradle).toMatch(/^\s*versionCode appVersionCode$/m);
    expect(gradle).toMatch(
      /group\(1\)\.toInteger\(\) \* 10000 \+\s*appVersionParts\.group\(2\)\.toInteger\(\) \* 100 \+\s*appVersionParts\.group\(3\)\.toInteger\(\)/,
    );
    expect(gradle).toContain('throw new GradleException(\n        "versionName');
  });
});
