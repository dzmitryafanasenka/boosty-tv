/**
 * Proves the .eslintrc.js override that keeps literal UI strings out of
 * src/features and src/shared/ui (Story 2.1). Sources are linted as virtual
 * files with the real project config; they import only external packages.
 */
const path = require('node:path');
const { ESLint } = require('eslint');

const repoRoot = path.resolve(__dirname, '..');
const eslint = new ESLint({ cwd: repoRoot });

const COPY_RULES = ['react-native/no-raw-text', 'no-restricted-syntax'];

async function copyErrors(file, source) {
  const [result] = await eslint.lintText(source, {
    filePath: path.join(repoRoot, file),
  });
  const fatal = result.messages.filter(m => m.fatal);
  if (fatal.length > 0) {
    throw new Error(`Lint parse failure: ${fatal[0].message}`);
  }
  return result.messages.filter(m => COPY_RULES.includes(m.ruleId));
}

const header = "import { Text, View } from 'react-native';\n";

const RESTRICTED = 'no-restricted-syntax';

describe('no literal UI strings lint override', () => {
  it.each([
    ['raw text outside <Text> in a feature', 'src/features/a/Probe.tsx', 'export const P = () => <View>Привет</View>;', 'react-native/no-raw-text'],
    ['string literal outside <Text> in shared/ui', 'src/shared/ui/Probe.tsx', "export const P = () => <View>{'Привет'}</View>;", 'react-native/no-raw-text'],
    ['raw text in src/app', 'src/app/Probe.tsx', 'export const P = () => <View>Привет</View>;', 'react-native/no-raw-text'],
    ['raw text in shared/focus', 'src/shared/focus/Probe.tsx', 'export const P = () => <Text>Привет</Text>;', RESTRICTED],
    ['raw text inside <Text> in a feature', 'src/features/a/Probe.tsx', 'export const P = () => <Text>Привет</Text>;', RESTRICTED],
    ['template literal inside <Text>', 'src/features/a/Probe.tsx', 'export const P = () => <Text>{`Привет`}</Text>;', RESTRICTED],
    ['ternary with literals inside <Text>', 'src/features/a/Probe.tsx', "export const P = ({ a }: { a: boolean }) => <Text>{a ? 'Да' : 'Нет'}</Text>;", RESTRICTED],
    ['&& with a literal inside <Text>', 'src/features/a/Probe.tsx', "export const P = ({ a }: { a: boolean }) => <Text>{a && 'Да'}</Text>;", RESTRICTED],
    ['+ with a literal inside <Text>', 'src/features/a/Probe.tsx', "export const P = ({ n }: { n: string }) => <Text>{'Всего: ' + n}</Text>;", RESTRICTED],
    ['literal child of a fragment', 'src/features/a/Probe.tsx', "export const P = () => <Text><>{'Привет'}</></Text>;", RESTRICTED],
    ...['label', 'accessibilityLabel', 'accessibilityHint', 'placeholder', 'title'].flatMap(prop => [
      [`literal ${prop} prop`, 'src/features/a/Probe.tsx', `export const P = () => <View ${prop}="Привет" />;`, RESTRICTED],
      [`expression literal ${prop} prop`, 'src/features/a/Probe.tsx', `export const P = () => <View ${prop}={'Привет'} />;`, RESTRICTED],
      [`template ${prop} prop`, 'src/features/a/Probe.tsx', `export const P = () => <View ${prop}={\`Привет\`} />;`, RESTRICTED],
    ]),
  ])('fails: %s', async (_name, file, body, rule) => {
    const errors = await copyErrors(file, header + body + '\n');
    expect(errors.map(e => e.ruleId)).toContain(rule);
  });

  it.each([
    ['catalog lookup inside <Text>', 'src/features/a/Probe.tsx', "const t = (k: string) => k;\nexport const P = () => <Text>{t('welcome.signIn')}</Text>;"],
    ['catalog lookup in a copy prop', 'src/features/a/Probe.tsx', "const t = (k: string) => k;\nexport const P = () => <View accessibilityLabel={t('welcome.signIn')} />;"],
    ['catalog lookups in a ternary', 'src/features/a/Probe.tsx', "const t = (k: string) => k;\nexport const P = ({ a }: { a: boolean }) => <Text>{a ? t('x') : t('y')}</Text>;"],
    ['test files are excluded', 'src/features/a/__tests__/Probe.test.tsx', 'export const P = () => <Text>Привет</Text>;'],
  ])('passes: %s', async (_name, file, body) => {
    expect(await copyErrors(file, header + body + '\n')).toEqual([]);
  });
});
