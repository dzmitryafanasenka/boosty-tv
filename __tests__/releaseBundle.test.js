/**
 * Story 2.4: the debug-only «Проверка фокуса» routes must not be in the
 * release bundle; Story 2.5: neither the live refresh trigger nor the demo
 * mode (FixtureTransport); Story 2.6: nor the in-memory A11 trigger.
 * Builds the Metro bundle with `--dev false` (and, as a control that the
 * grep can see them, `--dev true`) and searches it for the
 * dev route names and focus ids. Plain JS; runs the local react-native CLI.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const DEV_MARKERS = [
  'DevFocus',
  'dev/list/',
  'dev/focus',
  'dev/action/',
  'dev/dialog',
  // Story 2.5: the debug-only live refresh trigger and the demo mode.
  'settings/row/session-check',
  'access token corrupted',
  'createDemoSessionManager',
  'demo-access-token',
  'createFixtureTransport',
  // Story 2.6: the debug-only in-memory A11 trigger.
  'settings/row/expired-check',
  'debug: expired in memory',
  // Story 3.1: the demo E5 generator.
  'demo-post-',
  'demo-blog-',
  'demo-video-',
  // Story 4.2: the demo's in-memory progress storage.
  'createDemoKeyValueStore',
  // Story 4.4: the debug-only broken-next-video-URL trigger.
  'settings/row/break-video',
  'boostytv-debug-broken',
  'debug: next video source will be broken',
];

jest.setTimeout(240_000);

let dir;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boostytv-bundle-'));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function bundle(dev) {
  const out = path.join(dir, `index.${dev ? 'dev' : 'release'}.bundle`);
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules/react-native/cli.js'),
      'bundle',
      '--platform',
      'android',
      '--dev',
      String(dev),
      '--entry-file',
      'index.js',
      '--bundle-output',
      out,
    ],
    { cwd: repoRoot, stdio: 'pipe' },
  );
  return fs.readFileSync(out, 'utf8');
}

test('the release bundle has the Shell but no dev route or dev focus id', () => {
  const release = bundle(false);
  expect(release).toContain('nav/settings');
  for (const marker of DEV_MARKERS) {
    expect({ marker, found: release.includes(marker) }).toEqual({ marker, found: false });
  }
});

test('control: the debug bundle contains the dev routes', () => {
  const debug = bundle(true);
  expect(debug).toContain('DevFocus');
  expect(debug).toContain('dev/list/');
  expect(debug).toContain('settings/row/session-check');
  expect(debug).toContain('access token corrupted');
  expect(debug).toContain('settings/row/expired-check');
  expect(debug).toContain('debug: expired in memory');
  expect(debug).toContain('demo-post-');
  expect(debug).toContain('demo-blog-');
  expect(debug).toContain('demo-video-');
  expect(debug).toContain('settings/row/break-video');
  expect(debug).toContain('boostytv-debug-broken');
  expect(debug).toContain('debug: next video source will be broken');
});
