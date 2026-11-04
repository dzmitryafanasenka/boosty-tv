import { reportIssueUrl, repositoryUrl } from '../reportIssueUrl';

/** Node's fs and path (the app's tsconfig has no Node types; Jest runs on Node). */
const { existsSync, readFileSync }: {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
} = require('fs');
const { join }: { join(...parts: string[]): string } = require('path');
declare const __dirname: string;

const REPO = 'dzmitryafanasenka/boosty-tv';
/** The query as decoded pairs (no URL polyfill needed). */
const query = (url: string) =>
  url
    .slice(url.indexOf('?') + 1)
    .split('&')
    .map(pair => pair.split('=').map(decodeURIComponent));

const BASE = 'https://github.com/dzmitryafanasenka/boosty-tv/issues/new?template=bug_report.yml';

test('the repository page', () => {
  expect(repositoryUrl(REPO)).toBe('https://github.com/dzmitryafanasenka/boosty-tv');
});

test('the bug form with the version and the device, encoded', () => {
  expect(reportIssueUrl(REPO, { version: '1.2.0', device: 'Google Chromecast, Android 14' })).toBe(
    `${BASE}&version=1.2.0&device=Google%20Chromecast%2C%20Android%2014`,
  );
});

test('reserved characters in a value are encoded', () => {
  const url = reportIssueUrl(REPO, { version: '1.2.0-rc+1', device: 'A&B=C?#/ Ü' });
  expect(url).toBe(`${BASE}&version=1.2.0-rc%2B1&device=A%26B%3DC%3F%23%2F%20%C3%9C`);
  expect(query(url)).toEqual([
    ['template', 'bug_report.yml'],
    ['version', '1.2.0-rc+1'],
    ['device', 'A&B=C?#/ Ü'],
  ]);
});

test.each([
  ['unknown version', { version: null, device: 'Google Chromecast, Android 14' }, `${BASE}&device=Google%20Chromecast%2C%20Android%2014`],
  ['blank version', { version: ' ', device: 'X' }, `${BASE}&device=X`],
  ['unknown device', { version: '1.2.0', device: null }, `${BASE}&version=1.2.0`],
  ['blank device', { version: '1.2.0', device: '' }, `${BASE}&version=1.2.0`],
  ['both unknown', { version: null, device: null }, BASE],
])('%s: the parameter is left out', (_name, info, expected) => {
  expect(reportIssueUrl(REPO, info)).toBe(expected);
});

test('only template, version and device are sent', () => {
  const keys = query(reportIssueUrl(REPO, { version: '1.2.0', device: 'X' })).map(([key]) => key);
  expect(keys).toEqual(['template', 'version', 'device']);
});

test('the template and the prefilled keys match .github/ISSUE_TEMPLATE/bug_report.yml', () => {
  const [[, template], ...prefilled] = query(reportIssueUrl(REPO, { version: '1.2.0', device: 'X' }));
  const file = join(__dirname, '../../../../.github/ISSUE_TEMPLATE', template);
  expect(existsSync(file)).toBe(true);
  const yml = readFileSync(file, 'utf8');
  for (const [key] of prefilled) {
    expect(yml).toMatch(new RegExp(`^\\s*id:\\s*${key}\\s*$`, 'm'));
  }
  expect(prefilled.map(([key]) => key)).toEqual(['version', 'device']);
});
