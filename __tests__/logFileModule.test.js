/**
 * Story 8.3: source-level guard for the native diagnostics log file
 * (`LogFileModule.kt`). No JVM unit tests run here, so this pins the
 * properties the JS side relies on: registration, app-specific external
 * storage on API 29+ (adb-pullable on a release build; internal below 29), the 256 KB cap with one
 * rotated copy, one serial thread, and no logging or readback of the content.
 * The rotation itself is a device check (docs/testing.md Story 8.3).
 */
const fs = require('fs');
const path = require('path');

const pkg = path.join('java', 'io', 'github', 'dzmitryafanasenka', 'boostytv');
const src = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', ...parts), 'utf8');

const module_ = src('main', pkg, 'LogFileModule.kt');
const nativePackage = src('main', pkg, 'BoostyNativePackage.kt');
const manifest = fs.readFileSync(
  path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  'utf8',
);

describe('LogFileModule (Story 8.3)', () => {
  it('is registered as `LogFile` with append, clear and location', () => {
    expect(nativePackage).toContain('LogFileModule(reactContext)');
    expect(module_).toContain('const val NAME = "LogFile"');
    for (const method of ['fun append(lines: ReadableArray, promise: Promise)', 'fun clear(promise: Promise)', 'fun location(promise: Promise)']) {
      expect(module_).toContain(method);
    }
  });

  it('writes logs/boostytv.log in getExternalFilesDir(null), rotating to boostytv.log.1 at 256 KB', () => {
    expect(module_).toContain('getExternalFilesDir(null)');
    expect(module_).toContain('DIR_NAME = "logs"');
    expect(module_).toContain('FILE_NAME = "boostytv.log"');
    expect(module_).toContain('ROTATED_NAME = "boostytv.log.1"');
    expect(module_).toContain('MAX_BYTES = 256L * 1024L');
    expect(module_).toMatch(/size \+ bytes\.size > MAX_BYTES\) \{\s*rotate\(dir, file\)/);
  });

  it('review: below API 29 the internal filesDir (external files are shared storage there)', () => {
    expect(module_).toMatch(/Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.Q\) context\.getExternalFilesDir\(null\) else context\.filesDir/);
  });

  it('review: a failed rename truncates the current file instead of throwing', () => {
    const rotate = module_.slice(module_.indexOf('private fun rotate'), module_.indexOf('private fun clearFiles'));
    expect(rotate).toContain('FileOutputStream(file, false)');
    expect(rotate).not.toContain('throw');
  });

  it('runs every call on one serial thread', () => {
    expect(module_).toContain('Executors.newSingleThreadExecutor()');
    expect(module_).not.toMatch(/newFixedThreadPool|newCachedThreadPool|Thread\(/);
  });

  it('never logs, reads back or returns the content; rejections carry the class name only', () => {
    expect(module_).not.toMatch(/\bLog\.|println|readText|readLines|FileInputStream|bufferedReader/);
    const rejects = module_.match(/promise\.reject\([^)]*\)/g) ?? [];
    expect(rejects.length).toBeGreaterThan(0);
    for (const call of rejects) {
      expect(call).toBe('promise.reject(E_LOG_FILE, error.javaClass.simpleName)');
    }
  });

  it('needs no storage permission and keeps allowBackup=false', () => {
    expect(manifest).not.toMatch(/WRITE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/);
    expect(manifest).toContain('android:allowBackup="false"');
  });
});
