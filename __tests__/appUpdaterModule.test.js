/**
 * Story 9.2: source-level guard for the native in-app update install
 * (`AppUpdaterModule.kt`, the manifest, the FileProvider paths and the ABI
 * splits). No JVM unit tests run here, so this pins what the JS side and
 * the owner decisions rely on: registration, the system installer through
 * `ACTION_INSTALL_PACKAGE` (never a PackageInstaller session), downloads
 * only from this repository over HTTPS with the GitHub CDN redirects, the
 * SHA-256 check, an app-private cache directory shared by a narrow
 * FileProvider, and nothing logged. The download and the installer are
 * device checks (docs/testing.md Story 9.2).
 */
const fs = require('fs');
const path = require('path');

const pkg = path.join('java', 'io', 'github', 'dzmitryafanasenka', 'boostytv');
const main = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
const read = (...parts) => fs.readFileSync(path.join(main, ...parts), 'utf8');

const module_ = read(pkg, 'AppUpdaterModule.kt');
const nativePackage = read(pkg, 'BoostyNativePackage.kt');
const manifest = read('AndroidManifest.xml');
const paths = read('res', 'xml', 'update_file_paths.xml');
const gradle = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'build.gradle'), 'utf8');

describe('AppUpdaterModule (Story 9.2)', () => {
  it('is registered as `AppUpdater` with the port methods', () => {
    expect(nativePackage).toContain('AppUpdaterModule(reactContext)');
    expect(module_).toContain('const val NAME = "AppUpdater"');
    for (const method of [
      'fun canRequestInstalls(promise: Promise)',
      'fun openInstallSettings(promise: Promise)',
      'fun download(url: String, sha256: String, size: Double, promise: Promise)',
      'fun cancel()',
      'fun install(fileRef: String, promise: Promise)',
      'fun cleanup(promise: Promise)',
    ]) {
      expect(module_).toContain(method);
    }
    expect(module_).toContain('Build.SUPPORTED_ABIS');
  });

  it('hands the APK to the system installer only: ACTION_INSTALL_PACKAGE with a FileProvider URI; no PackageInstaller session', () => {
    expect(module_).toContain('Intent.ACTION_INSTALL_PACKAGE');
    expect(module_).toContain('FileProvider.getUriForFile');
    expect(module_).toContain('FLAG_GRANT_READ_URI_PERMISSION');
    expect(module_).toContain('EXTRA_RETURN_RESULT');
    expect(module_).not.toMatch(/PackageInstaller\.|packageInstaller\b|createSession|ACTION_VIEW/);
    expect(module_).toContain('Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES');
    expect(module_).toContain('canRequestPackageInstalls()');
  });

  it('downloads only this repository over HTTPS; redirects by hand to GitHub hosts only', () => {
    expect(module_).toContain(
      'ASSET_URL_PREFIX = "https://github.com/dzmitryafanasenka/boosty-tv/releases/download/"',
    );
    expect(module_).toContain('instanceFollowRedirects = false');
    expect(module_).toContain('url.protocol != "https"');
    expect(module_).toContain(
      'setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")',
    );
    expect(module_).toContain('url.host.lowercase() in ALLOWED_HOSTS');
    expect(module_).not.toMatch(/endsWith\(/);
    expect(module_).toMatch(/MAX_REDIRECTS = \d/);
    expect(module_).not.toMatch(/Authorization|Cookie/);
    expect(module_).not.toMatch(/BoostBuddy|slartus/i);
  });

  it('verifies the SHA-256 and deletes the file on a mismatch, a cancel or a failure; one download at a time', () => {
    expect(module_).toContain('MessageDigest.getInstance("SHA-256")');
    expect(module_).toContain('is DigestMismatch -> E_DIGEST');
    expect(module_).toMatch(/if \(failure != null\) \{\s*file\.delete\(\)/);
    expect(module_).toContain('running.compareAndSet(false, true)');
    // `running` is cleared before the promise settles (an install right after is not refused).
    expect(module_).toMatch(/running\.set\(false\)\s*if \(failure == null\) \{\s*promise\.resolve\(FILE_NAME\)/);
  });

  it('a cancel disconnects the active connection and is checked before each redirect and after the digest', () => {
    expect(module_).toMatch(/cancelled\.set\(true\)[\s\S]{0,200}activeConnection\?\.disconnect\(\)/);
    expect(module_).toMatch(/while \(true\) \{\s*if \(cancelled\.get\(\)\) \{\s*throw Cancelled\(\)/);
    expect(module_).toMatch(/fetch\(url, file, expectedSize, expectedDigest\)[\s\S]{0,120}if \(cancelled\.get\(\)\) \{\s*throw Cancelled\(\)/);
  });

  it('logs nothing and keeps the URL and path out of rejections', () => {
    expect(module_).not.toMatch(/\bLog\.[dviwe]\(|println\(/);
    expect(module_).not.toMatch(/reject\([^)]*(url|file\.path|absolutePath|message)/);
  });

  it('the manifest: REQUEST_INSTALL_PACKAGES and a private FileProvider limited to cache/updates', () => {
    expect(manifest).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
    expect(manifest).not.toContain('android.permission.INSTALL_PACKAGES"');
    const provider = manifest.slice(manifest.indexOf('<provider'), manifest.indexOf('</provider>'));
    expect(provider).toContain('android:name="androidx.core.content.FileProvider"');
    expect(provider).toContain('android:authorities="${applicationId}.updates"');
    expect(provider).toContain('android:exported="false"');
    expect(provider).toContain('android:grantUriPermissions="true"');
    expect(provider).toContain('@xml/update_file_paths');
    expect(module_).toContain('AUTHORITY_SUFFIX = ".updates"');
    const entries = paths.match(/<[a-z-]+-path [^>]*>/g);
    expect(entries).toEqual(['<cache-path name="updates" path="updates/" />']);
    expect(module_).toContain('DIR_NAME = "updates"');
  });

  it('build.gradle: one APK per ABI plus the universal one, with the same versionCode', () => {
    expect(gradle).toMatch(/splits \{\s*abi \{\s*enable true\s*reset\(\)\s*include\(\*appArchitectures\(\)\)\s*universalApk true/);
    expect(gradle).not.toMatch(/versionCodeOverride|abiCodes/);
  });
});
