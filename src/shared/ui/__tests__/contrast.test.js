/**
 * Story 9.4: every row of the DESIGN.md contrast table (Colors), computed
 * from the values in tokens.ts with the WCAG 2.x relative luminance, meets
 * its target. The rows are parsed from DESIGN.md, so a new row is checked
 * without a test change (the parse check only asserts that every table line
 * with a `{colors.` cell was parsed). A color with alpha (`overlay-badge`, «over any
 * video») is composited over both black and white, and the worse ratio
 * counts. Plus the DESIGN.md rule that `text-tertiary` sits only on `bg`,
 * `bg-sidebar` and `surface`: the ratio there is at least 4.5 too, and the
 * pairs the components draw that the table lacks.
 */
const fs = require('fs');
const path = require('path');
const { colors } = require('../tokens');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const designPath = path.join(
  repoRoot,
  '_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md',
);

function rgba(hex) {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!match) {
    throw new Error(`Not a hex color: ${hex}`);
  }
  const byte = i => parseInt(match[1].slice(i, i + 2), 16);
  return {
    r: byte(0),
    g: byte(2),
    b: byte(4),
    a: match[2] ? parseInt(match[2], 16) / 255 : 1,
  };
}

function over(top, under) {
  const mix = (t, u) => t * top.a + u * (1 - top.a);
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 };
}

function luminance({ r, g, b }) {
  const channel = v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratioOf(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const BLACK = rgba('#000000');
const WHITE = rgba('#FFFFFF');

/** The worst ratio of `fg` on `bg`; a translucent background is tried over black and white. */
function contrast(fgToken, bgToken) {
  const fg = rgba(colors[fgToken]);
  const bg = rgba(colors[bgToken]);
  const backs = bg.a < 1 ? [over(bg, BLACK), over(bg, WHITE)] : [bg];
  return Math.min(...backs.map(back => ratioOf(fg.a < 1 ? over(fg, back) : fg, back)));
}

/** DESIGN.md «Contrast (WCAG 2.x, checked)» rows: [{ fg, bgs, target, row }]. */
function contrastRows(markdown) {
  const section = /Contrast \(WCAG[^\n]*\n([\s\S]*?)\n\n/.exec(markdown);
  if (!section) {
    throw new Error('No contrast table in DESIGN.md');
  }
  const rows = [];
  for (const line of section[1].split('\n')) {
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 4 || !cells[1].includes('{colors.')) {
      continue;
    }
    const [pair, , target] = [cells[1], cells[2], cells[3]];
    const [fgPart, bgPart] = pair.split(' on ');
    const fg = /\{colors\.([\w-]+)\}/.exec(fgPart)[1];
    const bgs = [...bgPart.matchAll(/\{colors\.([\w-]+)\}/g)].map(m => m[1]);
    const min = Number(/≥\s*([\d.]+)/.exec(target)[1]);
    rows.push({ fg, bgs, target: min, row: line });
  }
  return rows;
}

const markdown = fs.readFileSync(designPath, 'utf8');
const rows = contrastRows(markdown);
/** Table lines with a `{colors.` pair cell, counted independently of the parser. */
const tableLines = /Contrast \(WCAG[^\n]*\n([\s\S]*?)\n\n/
  .exec(markdown)[1]
  .split('\n')
  .filter(line => line.startsWith('|') && (line.split('|')[1] ?? '').includes('{colors.'));

describe('DESIGN.md contrast pairs (Story 9.4)', () => {
  it('parses every table line with a `{colors.` cell (at least the 7 rows of 2026-11-01)', () => {
    expect(rows.map(r => r.row)).toEqual(tableLines);
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const r of rows) {
      expect(r.bgs.length).toBeGreaterThan(0);
    }
  });

  it.each(rows.flatMap(r => r.bgs.map(bg => [r.fg, bg, r.target])))(
    '%s on %s ≥ %s',
    (fg, bg, target) => {
      expect(colors[fg]).toBeDefined();
      expect(colors[bg]).toBeDefined();
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(target);
    },
  );

  it.each(['bg', 'bg-sidebar', 'surface'])('text-tertiary on %s ≥ 4.5 (its only allowed backgrounds)', bg => {
    expect(contrast('text-tertiary', bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('secondary text in a focused row or tile (text-secondary, and text-meta where kept) on surface-focus-row ≥ 4.5', () => {
    expect(contrast('text-secondary', 'surface-focus-row')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('text-meta', 'surface-focus-row')).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    // LiveCard «needs level» details line on the focused card.
    ['accent-text', 'surface-focus-row'],
    // EventRow's text line on the focused row.
    ['text-card', 'surface-focus-row'],
  ])('drawn but not in the table: %s on %s ≥ 4.5', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('matches the ratios DESIGN.md prints (to 0.1; «≈» rows to 1) for an opaque pair', () => {
    for (const r of rows) {
      const printed = r.row.split('|')[2].trim().split('/').map(s => s.trim());
      r.bgs.forEach((bg, i) => {
        const value = printed[i] ?? printed[0];
        const approx = value.startsWith('≈');
        const number = Number(value.replace('≈', '').trim());
        if (rgba(colors[bg]).a < 1) {
          // Printed over black; the check above uses the worse of black and white.
          expect(ratioOf(rgba(colors[r.fg]), over(rgba(colors[bg]), BLACK))).toBeCloseTo(number, approx ? -1 : 0);
          return;
        }
        expect(Math.abs(contrast(r.fg, bg) - number)).toBeLessThanOrEqual(approx ? 1 : 0.1);
      });
    }
  });

  it('the computation itself: black on white is 21, white on white is 1', () => {
    expect(ratioOf(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(ratioOf(WHITE, WHITE)).toBeCloseTo(1, 5);
  });
});
