/**
 * scripts/check-fixtures.mjs: passes on clean fixtures, fails on a planted
 * token, signed URL, phone number, email or free-form string. Runs the real
 * CLI on temporary directories.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-fixtures.mjs');

function run(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixtures-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(
        path.join(dir, name),
        typeof content === 'string'
          ? content
          : JSON.stringify(content, null, 2),
      );
    }
    try {
      const out = execFileSync(process.execPath, [SCRIPT, dir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out };
    } catch (error) {
      return { code: error.status, out: `${error.stdout}${error.stderr}` };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const clean = {
  case: 'e8-post-accessible',
  status: 200,
  body: {
    id: 'synthetic-id-1',
    int_id: 1001,
    createdAt: 1700003600,
    hasAccess: true,
    signedQuery: '?sig=REDACTED',
    title: 'redacted',
    user: { blogUrl: 'synthetic-blog-1', name: 'redacted' },
    data: [
      {
        type: 'text',
        modificator: 'BLOCK_END',
        content: '["Sample text","unstyled",[[0,0,6]]]',
      },
      {
        type: 'ok_video',
        duration: 780,
        playerUrls: [{ type: 'hd', url: 'https://example.invalid/player' }],
      },
      { type: 'file', size: 204800, url: '' },
      { type: 'text', count: { likes: 5, comments: 0 } },
    ],
    'synthetic-key-1': null,
  },
};

const withBody = patch => ({ ...clean, body: { ...clean.body, ...patch } });

test('a poll answer of synthetic option ids passes (Story 6.6)', () => {
  expect(run({ 'boosty/a.json': withBody({ answer: [1021] }) }).code).toBe(0);
});

test('clean fixtures pass; empty directory passes', () => {
  expect(run({ 'boosty/a.json': clean, '.gitkeep': '' })).toEqual({
    code: 0,
    out: 'check-fixtures: 1 JSON fixture(s) clean\n',
  });
  expect(run({ '.gitkeep': '' }).code).toBe(0);
});

test.each([
  ['token', withBody({ title: 'a'.repeat(64) }), 'opaque 40+ run'],
  ['Bearer', withBody({ title: 'Bearer x' }), 'Bearer'],
  [
    'signed URL',
    withBody({ preview: 'https://vd.okcdn.ru/v?expires=1&sig=abc' }),
    'URL outside example.invalid',
  ],
  [
    'query on a placeholder host',
    withBody({ preview: 'https://example.invalid/player?sig=abc' }),
    'query string',
  ],
  ['phone string', withBody({ phone: '+79991234567' }), '9+ digit run'],
  ['phone number', withBody({ phone: 79991234567 }), 'phone number not zeroed'],
  [
    'real timestamp',
    withBody({ createdAt: 1792843537 }),
    'time is not synthetic',
  ],
  ['real count', withBody({ likes: 313 }), 'not 0 or the synthetic count'],
  ['real price', withBody({ price: 500 }), 'not 0 or the synthetic count'],
  ['exact duration', withBody({ duration: 3903 }), 'not whole minutes'],
  ['real poll percent', withBody({ fraction: 38 }), 'percent is not 0 or 100'],
  ['real poll answer id', withBody({ answer: [48211] }), 'id number is not synthetic'],
  [
    'real id number',
    withBody({ ownerId: 48211 }),
    'id number is not synthetic',
  ],
  ['email', withBody({ mail: 'user@example.com' }), 'email'],
  ['free-form string', withBody({ title: 'Real title' }), 'not a placeholder'],
  [
    'enum under a non-enum key',
    withBody({ name: 'ivan' }),
    'not a placeholder',
  ],
  ['unsafe key', withBody({ 'user 12345678': 1 }), 'unsafe key'],
  [
    'real text content',
    withBody({ data: [{ type: 'text', content: '["Hello","unstyled",[]]' }] }),
    'not a placeholder',
  ],
])('fails on a planted %s', (_name, fixture, rule) => {
  const result = run({ 'boosty/bad.json': fixture });
  expect(result.code).toBe(1);
  expect(result.out).toContain(rule);
});

test('fails on non-JSON files and never prints the value', () => {
  expect(run({ 'notes.txt': 'x' }).code).toBe(1);
  const secret = `tok${'z'.repeat(60)}`;
  const result = run({ 'bad.json': withBody({ title: secret }) });
  expect(result.code).toBe(1);
  expect(result.out).not.toContain(secret);
});

test('only exact .gitkeep and .DS_Store are skipped', () => {
  expect(run({ 'boosty/a.json': clean, '.DS_Store': 'x' }).code).toBe(0);
  const result = run({ 'dump.gitkeep': 'Real title +79991234567' });
  expect(result.code).toBe(1);
  expect(result.out).toContain('not a .json fixture');
});

test('the committed repository fixtures pass', () => {
  const out = execFileSync(process.execPath, [SCRIPT], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  expect(out).toMatch(/fixture\(s\) clean/);
});
