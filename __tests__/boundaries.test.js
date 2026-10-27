/**
 * Proves that the boundaries rules in .eslintrc.js reject forbidden imports
 * and accept allowed ones. Plain JS so the test needs no Node/ESLint type
 * packages. Sources are linted as virtual files placed inside
 * __tests__/fixtures/boundaries, whose import targets exist on disk.
 */
const path = require('node:path');
const { ESLint } = require('eslint');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'boundaries');

const projectConfig = require('../.eslintrc.js');

const eslint = new ESLint({
  cwd: fixtureRoot,
  useEslintrc: false,
  ignore: false,
  resolvePluginsRelativeTo: repoRoot,
  overrideConfig: {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins: projectConfig.plugins,
    settings: {
      ...projectConfig.settings,
      'boundaries/root-path': fixtureRoot,
    },
    rules: {
      'boundaries/dependencies': projectConfig.rules['boundaries/dependencies'],
      'boundaries/no-unknown-dependencies':
        projectConfig.rules['boundaries/no-unknown-dependencies'],
    },
  },
});

async function boundaryErrors(fromFile, importPath) {
  const [result] = await eslint.lintText(
    `import * as target from '${importPath}';\nexport const used = target;\n`,
    { filePath: path.join(fixtureRoot, fromFile) },
  );
  const fatal = result.messages.filter(m => m.fatal);
  if (fatal.length > 0) {
    throw new Error(`Lint parse failure: ${fatal[0].message}`);
  }
  return result.messages.filter(
    m => m.ruleId && m.ruleId.startsWith('boundaries/'),
  );
}

describe('architecture boundaries lint rules', () => {
  it.each([
    ['feature -> other feature', 'src/features/a/screen.tsx', '../b'],
    ['shared -> feature', 'src/shared/ui/Button.tsx', '../../features/a'],
    ['shared -> app', 'src/shared/ui/Button.tsx', '../../app'],
    ['feature -> app', 'src/features/a/screen.tsx', '../../app'],
    [
      'allowlisted edge, deep import into internals',
      'src/features/post/screen.tsx',
      '../polls/internal',
    ],
    [
      'reverse of an allowlisted edge',
      'src/features/polls/screen.tsx',
      '../post',
    ],
    [
      'allowlisted edge, deep import into player internals',
      'src/features/post/screen.tsx',
      '../player/internal',
    ],
    ['player -> post (not allowlisted)', 'src/features/player/screen.tsx', '../post'],
    ['feature -> test fixtures', 'src/features/a/screen.tsx', '../../test/fixtures/sample'],
    ['shared -> test fixtures', 'src/shared/ui/Button.tsx', '../../test/fixtures/sample'],
    ['app -> test fixtures', 'src/app/Shell.tsx', '../test/fixtures/sample'],
    [
      'unresolvable path into another feature (.js suffix)',
      'src/features/a/screen.tsx',
      '../b/index.js',
    ],
    [
      'unresolvable path from shared into a feature',
      'src/shared/ui/Button.tsx',
      '../../features/a/missing',
    ],
  ])('fails: %s', async (_name, fromFile, importPath) => {
    expect(await boundaryErrors(fromFile, importPath)).not.toHaveLength(0);
  });

  it.each([
    [
      'allowlisted edge post -> polls',
      'src/features/post/screen.tsx',
      '../polls',
    ],
    [
      'allowlisted edge post -> player',
      'src/features/post/screen.tsx',
      '../player/index',
    ],
    ['feature -> shared', 'src/features/a/screen.tsx', '../../shared/ui'],
    ['inside one feature', 'src/features/a/screen.tsx', './index'],
    ['app -> feature', 'src/app/Shell.tsx', '../features/a'],
    ['shared -> other shared module', 'src/shared/ui/Button.tsx', '../api'],
    ['external package', 'src/features/a/screen.tsx', 'react'],
  ])('passes: %s', async (_name, fromFile, importPath) => {
    expect(await boundaryErrors(fromFile, importPath)).toHaveLength(0);
  });
});

/** The project's no-restricted-imports overrides (ADR 0009 session rules). */
const sessionOverrides = projectConfig.overrides.filter(
  o => o.rules && o.rules['no-restricted-imports'],
);

const sessionEslint = new ESLint({
  cwd: fixtureRoot,
  useEslintrc: false,
  ignore: false,
  overrideConfig: {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    overrides: sessionOverrides,
  },
});

async function sessionImportErrors(fromFile, importPath) {
  const [result] = await sessionEslint.lintText(
    `import * as target from '${importPath}';\nexport const used = target;\n`,
    { filePath: path.join(fixtureRoot, fromFile) },
  );
  const fatal = result.messages.filter(m => m.fatal);
  if (fatal.length > 0) {
    throw new Error(`Lint parse failure: ${fatal[0].message}`);
  }
  return result.messages.filter(m => m.ruleId === 'no-restricted-imports');
}

describe('session module import rules (ADR 0009)', () => {
  test('the session overrides are present', () => {
    expect(sessionOverrides.length).toBeGreaterThan(0);
  });

  it.each([
    ['feature -> session/core', 'src/features/a/screen.tsx', '../../shared/api/session/core'],
    ['app -> session/types', 'src/app/Shell.tsx', '../shared/api/session/types'],
    ['shared/api index -> ./session/types', 'src/shared/api/index.ts', './session/types'],
    ['shared/api test -> ../session/core', 'src/shared/api/__tests__/x.test.ts', '../session/core'],
    ['other shared module -> session', 'src/shared/ui/Button.tsx', '../api/session/core'],
    ['signIn -> signOut', 'src/shared/api/session/signIn.ts', './signOut'],
    ['session module -> the facade', 'src/shared/api/session/signIn.ts', '../sessionManager'],
    ['session module -> the shared/api index', 'src/shared/api/session/signIn.ts', '..'],
    ['signIn -> ../session/signOut', 'src/shared/api/session/signIn.ts', '../session/signOut'],
    ['signIn -> ../../api/session/signOut', 'src/shared/api/session/signIn.ts', '../../api/session/signOut'],
    ['signIn -> ../session/core (up and back)', 'src/shared/api/session/signIn.ts', '../session/core'],
  ])('fails: %s', async (_name, fromFile, importPath) => {
    expect(await sessionImportErrors(fromFile, importPath)).not.toHaveLength(0);
  });

  it.each([
    ['facade -> session/core', 'src/shared/api/sessionManager.ts', './session/core'],
    ['signIn -> ./core', 'src/shared/api/session/signIn.ts', './core'],
    ['signIn -> ./codec', 'src/shared/api/session/signIn.ts', './codec'],
    ['signIn -> ./types', 'src/shared/api/session/signIn.ts', './types'],
    ['session module -> other shared/api code', 'src/shared/api/session/signIn.ts', '../httpClient'],
    ['session test -> any session module', 'src/shared/api/session/__tests__/signIn.test.ts', '../signIn'],
    ['feature -> shared/api', 'src/features/a/screen.tsx', '../../shared/api'],
    ['app -> its own session.ts', 'src/app/Shell.tsx', './session'],
    ['shared/api/x -> ./dto/session', 'src/shared/api/x.ts', './dto/session'],
    ['shared/api test -> ../dto/session', 'src/shared/api/__tests__/x.test.ts', '../dto/session'],
    ['feature -> its own session module', 'src/features/a/screen.tsx', './session/state'],
  ])('passes: %s', async (_name, fromFile, importPath) => {
    expect(await sessionImportErrors(fromFile, importPath)).toHaveLength(0);
  });
});
