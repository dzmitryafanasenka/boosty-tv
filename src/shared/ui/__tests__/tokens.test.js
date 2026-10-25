/**
 * Every DESIGN.md frontmatter token exists in tokens.ts with the same value.
 * Plain JS so the test needs no Node type packages. The frontmatter is
 * regex-parsed: groups are top-level keys, entries are two-space-indented
 * `key: scalar` or `key: { flow map }` lines (no nested maps).
 */
const fs = require('fs');
const path = require('path');
const tokens = require('../tokens');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const designPath = path.join(
  repoRoot,
  '_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md',
);
const fontDir = path.join(repoRoot, 'android/app/src/main/assets/fonts');

const GROUPS = [
  'colors',
  'typography',
  'rounded',
  'spacing',
  'focus',
  'motion',
  'components',
];

function parseScalar(raw) {
  const value = raw.trim();
  const quoted = /^'(.*)'$/.exec(value);
  if (quoted) {
    return quoted[1];
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseFlowMap(body) {
  const map = {};
  const entry = /([\w-]+):\s*('[^']*'|[^,}]+)/g;
  let match;
  while ((match = entry.exec(body)) !== null) {
    map[match[1]] = parseScalar(match[2]);
  }
  return map;
}

function parseFrontmatter(markdown) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(markdown)[1];
  const groups = {};
  let current = null;
  for (const line of frontmatter.split('\n')) {
    const group = /^([\w-]+):\s*$/.exec(line);
    if (group) {
      current = GROUPS.includes(group[1]) ? group[1] : null;
      if (current) {
        groups[current] = {};
      }
      continue;
    }
    if (/^\S/.test(line)) {
      current = null;
      continue;
    }
    const entry = /^ {2}'?([\w-]+)'?:\s*(.+)$/.exec(line);
    if (current && entry) {
      const raw = entry[2].trim();
      groups[current][entry[1]] = raw.startsWith('{')
        ? parseFlowMap(raw.slice(1, -1))
        : parseScalar(raw);
    }
  }
  return groups;
}

function parseMs(value) {
  const match = /^(\d+)ms$/.exec(value);
  if (!match) {
    throw new Error(`Not a duration: ${value}`);
  }
  return Number(match[1]);
}

function parseEasing(value) {
  if (value === 'linear') {
    return 'linear';
  }
  const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(value);
  if (!bezier) {
    throw new Error(`Unknown easing: ${value}`);
  }
  return bezier[1].split(',').map(Number);
}

/** DESIGN entry -> the value tokens.ts is expected to hold. */
const expectedFor = {
  typography: design => {
    if (design.fontFamily !== tokens.fontFamilyName) {
      throw new Error(`Unexpected fontFamily ${design.fontFamily}`);
    }
    return {
      fontFamily: tokens.fontFiles[design.fontWeight],
      fontSize: design.fontSize,
      lineHeight: design.lineHeight,
    };
  },
  focus: design => {
    if (typeof design !== 'object') {
      return design;
    }
    const { note: _note, ...shadow } = design;
    return shadow;
  },
  motion: design => {
    const out = {};
    if (design.duration !== undefined) {
      out.duration = parseMs(design.duration);
    }
    if (design.easing !== undefined) {
      out.easing = parseEasing(design.easing);
    }
    if (design.delay !== undefined) {
      out.delay = parseMs(design.delay);
    }
    return out;
  },
  components: design => {
    const out = {};
    for (const [key, value] of Object.entries(design)) {
      const ref = typeof value === 'string' && /^\{(\w+)\.([\w-]+)\}$/.exec(value);
      out[key] = ref ? tokens[ref[1]][ref[2]] : value;
    }
    return out;
  },
};

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

const design = parseFrontmatter(fs.readFileSync(designPath, 'utf8'));

describe('design tokens', () => {
  it('parses every token group from DESIGN.md', () => {
    for (const group of GROUPS) {
      expect(Object.keys(design[group] ?? {}).length).toBeGreaterThan(0);
    }
  });

  it.each(GROUPS)('%s matches DESIGN.md exactly', group => {
    const mismatches = [];
    const toExpected = expectedFor[group] ?? (value => value);
    for (const [key, value] of Object.entries(design[group])) {
      const expected = normalize(toExpected(value));
      const actual = tokens[group][key];
      if (actual === undefined) {
        mismatches.push(`${group}.${key}: missing`);
      } else if (JSON.stringify(normalize(actual)) !== JSON.stringify(expected)) {
        mismatches.push(
          `${group}.${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
      }
    }
    for (const key of Object.keys(tokens[group])) {
      if (!(key in design[group])) {
        mismatches.push(`${group}.${key}: not in DESIGN.md`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('never sets fontWeight (no synthetic bold)', () => {
    for (const style of Object.values(tokens.typography)) {
      expect(style).not.toHaveProperty('fontWeight');
    }
  });

  it('keeps all text at 11 sp or larger', () => {
    for (const style of Object.values(tokens.typography)) {
      expect(style.fontSize).toBeGreaterThanOrEqual(11);
    }
  });

  it('bundles a font file for every fontFamily, plus the OFL', () => {
    for (const file of Object.values(tokens.fontFiles)) {
      expect(fs.existsSync(path.join(fontDir, `${file}.ttf`))).toBe(true);
    }
    expect(fs.existsSync(path.join(fontDir, 'OFL.txt'))).toBe(true);
  });
});
