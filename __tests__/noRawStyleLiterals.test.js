/**
 * Story 9.4: components use tokens only. Scans every non-test source under
 * src/ for
 * - a hex color or an rgb()/rgba() color in a string literal, and
 * - a non-zero number literal given to a size style property (`width: 12`,
 *   `borderRadius: 4`, `gap: 3`, …) or to a JSX size prop (`size={16}`).
 * Values come from src/shared/ui/tokens.ts, which mirrors the DESIGN.md
 * frontmatter (src/shared/ui/__tests__/tokens.test.js), so a new size needs
 * a DESIGN.md entry first.
 *
 * Allowed: `0`, `StyleSheet.hairlineWidth` (not a literal), and the QR
 * code's black modules on `qr-bg` (src/shared/platform/qrRenderer.tsx).
 * Not scanned: tokens.ts itself, the SVG glyph geometry in
 * src/shared/ui/icons/ (viewBox drawing coordinates, not layout), the demo
 * API data in src/app/dev/demo.ts (DTO fields such as an image's width),
 * tests and test helpers. Named module constants (`const COLUMN_WIDTH =
 * 440`) are outside this scan: they are reviewed by hand (docs/testing.md,
 * Story 9.4).
 *
 * Known blind spots (a line-based regex, not a parser):
 * - named CSS colors (`'red'`, `'black'`) and `hsl()` / `hsla()`;
 * - transform `scale` (a multiplier, e.g. the spinner's `scale: 2`);
 * - a value after a ternary (`width: a ? 12 : 16`) or on the next line;
 * - a string that contains a comment opener («slash star»; e.g. the
 *   «star slash star» ACCEPT header in `profiles.ts`) starts a «comment» for
 *   the stripper, which blanks every line up to the next comment closer.
 */
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(repoRoot, 'src');

const SIZE_PROPS = [
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'top', 'left', 'right', 'bottom', 'start', 'end', 'inset',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'paddingHorizontal', 'paddingVertical', 'paddingStart', 'paddingEnd',
  'gap', 'rowGap', 'columnGap',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
  'outlineWidth', 'outlineOffset',
  'fontSize', 'lineHeight', 'letterSpacing',
  'translateX', 'translateY', 'shadowRadius', 'elevation',
];

const STYLE_LITERAL = new RegExp(`\\b(${SIZE_PROPS.join('|')})\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\b`, 'g');
const JSX_SIZE_LITERAL = /\b(size|width|height|fontSize|strokeWidth)=\{\s*(-?\d+(?:\.\d+)?)\s*\}/g;
const COLOR_LITERAL = /(['"`])#[0-9a-fA-F]{3,8}\1|\brgba?\(/g;

const SKIP_FILES = new Set([
  'src/shared/ui/tokens.ts',
  'src/app/dev/demo.ts',
]);
const SKIP_DIRS = new Set(['__tests__', 'src/test', 'src/shared/ui/icons']);
/** file:line text fragments allowed by the spec (Story 9.4). */
const ALLOWED = [{ file: 'src/shared/platform/qrRenderer.tsx', text: 'color="#000000"' }];

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !SKIP_DIRS.has(rel)) {
        sources(full, out);
      }
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name) && !SKIP_FILES.has(rel)) {
      out.push(rel);
    }
  }
  return out;
}

/** Blanks comments (keeping line breaks), so prose numbers never count. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (_m, lead) => lead);
}

function findings(rel, source) {
  const out = [];
  const lines = stripComments(source).split('\n');
  lines.forEach((line, i) => {
    const where = `${rel}:${i + 1}`;
    for (const re of [STYLE_LITERAL, JSX_SIZE_LITERAL]) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line)) !== null) {
        if (Number(match[2]) !== 0) {
          out.push(`${where}: ${match[0]}`);
        }
      }
    }
    COLOR_LITERAL.lastIndex = 0;
    let color;
    while ((color = COLOR_LITERAL.exec(line)) !== null) {
      const allowed = ALLOWED.some(a => a.file === rel && line.includes(a.text));
      if (!allowed) {
        out.push(`${where}: ${color[0]}`);
      }
    }
  });
  return out;
}

describe('tokens-only styling (Story 9.4)', () => {
  it('finds no raw color or non-zero size literal in src/', () => {
    const all = sources(srcRoot).flatMap(rel =>
      findings(rel, fs.readFileSync(path.join(repoRoot, rel), 'utf8')),
    );
    expect(all).toEqual([]);
  });

  it.each([
    ['a hex color', "const s = { color: '#FFAA00' };", 'src/features/a/Probe.tsx:1'],
    ['an rgba color', "const s = { color: 'rgba(0,0,0,0.5)' };", 'src/features/a/Probe.tsx:1'],
    ['a size literal', 'const s = StyleSheet.create({ a: { width: 12 } });', 'src/features/a/Probe.tsx:1'],
    ['a negative margin', 'const s = { marginTop: -4 };', 'src/features/a/Probe.tsx:1'],
    ['a JSX size prop', 'const e = <Icon size={16} />;', 'src/features/a/Probe.tsx:1'],
    ['an off-allowlist QR color', 'const e = <QRCode color="#000000" />;', 'src/features/a/Probe.tsx:1'],
  ])('fails on %s, naming the file and line', (_name, body, where) => {
    const found = findings('src/features/a/Probe.tsx', body);
    expect(found).toHaveLength(1);
    expect(found[0].startsWith(where)).toBe(true);
  });

  it.each([
    ['zero', 'const s = { top: 0, left: 0 };'],
    ['hairline', 'const s = { borderWidth: StyleSheet.hairlineWidth };'],
    ['a token', "const s = { width: spacing['card-width'] };"],
    ['a comment', '// width: 12 and #FFFFFF in prose'],
    ['a block comment', '/* gap: 3, rgba(0,0,0) */'],
    ['flex and opacity (not sizes)', 'const s = { flex: 1, opacity: 0.4 };'],
  ])('passes %s', (_name, body) => {
    expect(findings('src/features/a/Probe.tsx', body)).toEqual([]);
  });

  it('allows the QR code black modules only in qrRenderer.tsx', () => {
    expect(findings('src/shared/platform/qrRenderer.tsx', '      color="#000000"')).toEqual([]);
  });
});
