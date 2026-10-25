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
