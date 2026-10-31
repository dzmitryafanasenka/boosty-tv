/**
 * Epic 8 retro A1: every literal field key passed to the logger in `src`
 * survives redaction (`isSecretFieldKey` is false), unless it is listed
 * below as an intended secret. A key the redaction would silently blank
 * (the AudioBlock `code` field in Story 8.3, `versionCode` for Epic 9)
 * fails here at authoring time. All `.ts`/`.tsx` files under `src` are
 * scanned except tests (the `src/test` helpers included). Plain JS so the
 * test needs no Node type packages; sources are parsed with the TypeScript
 * compiler.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { isSecretFieldKey } = require('../src/shared/services/logger');

const srcRoot = path.resolve(__dirname, '..', 'src');
const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
/** Keys deliberately logged under a secret name (their value is redacted). None today. */
const INTENDED_SECRETS = new Set([]);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const isLoggerCall = (node, source) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  LEVELS.has(node.expression.name.text) &&
  /logger$/i.test(node.expression.expression.getText(source));

/**
 * One file's logger field keys: `logger.<level>(scope, message, { key: … })`
 * and calls through a local wrapper that forwards a parameter as a spread
 * (`const log = (m, fields) => logger.info(s, m, { service, ...fields })`,
 * src/shared/platform/secureStore.ts). A fields argument the scan cannot
 * read (a variable, a spread of anything else, a computed key) is returned
 * as `unverified`, so a blind spot fails the test instead of passing.
 */
function scan(file) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const at = node => `${path.relative(srcRoot, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const keys = [];
  const unverified = [];
  // name → index of the forwarded fields parameter
  const wrappers = new Map();

  const readFields = (fields, forwarded) => {
    if (!ts.isObjectLiteralExpression(fields)) {
      unverified.push(at(fields));
      return;
    }
    for (const prop of fields.properties) {
      if (ts.isSpreadAssignment(prop)) {
        if (!(ts.isIdentifier(prop.expression) && forwarded.has(prop.expression.text))) {
          unverified.push(at(prop));
        }
        continue;
      }
      const name = prop.name;
      if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
        keys.push({ key: name.text, at: at(prop) });
      } else {
        unverified.push(at(prop));
      }
    }
  };

  const findWrappers = node => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isArrowFunction(node.initializer) &&
      isLoggerCall(node.initializer.body, source)
    ) {
      const params = node.initializer.parameters.map(p => p.name.getText(source));
      const fields = node.initializer.body.arguments[2];
      if (fields && ts.isObjectLiteralExpression(fields)) {
        fields.properties.forEach(prop => {
          if (ts.isSpreadAssignment(prop) && ts.isIdentifier(prop.expression) && params.includes(prop.expression.text)) {
            wrappers.set(node.name.text, params.indexOf(prop.expression.text));
          }
        });
      }
    }
    ts.forEachChild(node, findWrappers);
  };
  findWrappers(source);

  const visit = node => {
    if (isLoggerCall(node, source) && node.arguments.length >= 3) {
      const wrapper = node.parent && ts.isArrowFunction(node.parent) && node.parent.body === node ? node.parent : null;
      const forwarded = new Set(wrapper ? wrapper.parameters.map(p => p.name.getText(source)) : []);
      readFields(node.arguments[2], forwarded);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && wrappers.has(node.expression.text)) {
      const fields = node.arguments[wrappers.get(node.expression.text)];
      if (fields) {
        readFields(fields, new Set());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { keys, unverified };
}

const scans = sourceFiles(srcRoot).map(scan);
const all = scans.flatMap(s => s.keys);
const unverified = scans.flatMap(s => s.unverified);

describe('logger call-site field keys (Epic 8 retro A1)', () => {
  it('finds the logger calls with fields', () => {
    // A guard against the scan silently matching nothing.
    expect(all.length).toBeGreaterThan(20);
  });

  it('every fields argument is readable by the scan', () => {
    // A variable, a foreign spread or a computed key would hide keys from the check below.
    expect(unverified).toEqual([]);
  });

  it('covers the secureStore wrapper', () => {
    expect(all.some(({ key, at }) => key === 'fileDeleted' && at.startsWith('shared/platform/secureStore'))).toBe(true);
  });

  it('no field key is silently redacted', () => {
    const blanked = all.filter(({ key }) => isSecretFieldKey(key) && !INTENDED_SECRETS.has(key));
    expect(blanked).toEqual([]);
  });
});
