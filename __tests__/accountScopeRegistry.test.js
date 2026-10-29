/**
 * AD-4 / Story 2.7: every account-scoped store declared anywhere in `src/`
 * is registered, exactly once, by `src/app/bootstrap.ts`, and the session
 * is the first (the gate). A store declared but not registered would
 * survive a sign-out, so this test fails the build. Plain JS so the test
 * needs no Node type packages (as __tests__/boundaries.test.js).
 */
const fs = require('node:fs');
const path = require('node:path');
require('../src/app/bootstrap');
const { accountScope } = require('../src/shared/account');

const SRC = path.resolve(__dirname, '../src');
/** The definition itself (`export function defineAccountScoped(`). */
const DEFINITION = path.join(SRC, 'shared', 'account', 'defineAccountScoped.ts');
const CALL = /defineAccountScoped\(/g;
const LITERAL_NAME = /^defineAccountScoped\(\s*(['"])([^'"\n]+)\1/;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    if (full === DEFINITION || /\.test\.[jt]sx?$/.test(entry.name)) {
      return [];
    }
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Every call in `src/`; `name` is null when the first argument is not a string literal. */
function declarations() {
  return sourceFiles(SRC).flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    return [...source.matchAll(CALL)].map(match => {
      const literal = LITERAL_NAME.exec(source.slice(match.index));
      return { name: literal ? literal[2] : null, file: path.relative(SRC, file) };
    });
  });
}

function declaredNames() {
  return declarations().filter(d => d.name !== null);
}

test('every declaration names its store with a string literal', () => {
  expect(declarations().filter(d => d.name === null)).toEqual([]);
});

test('the scan finds the known declarations', () => {
  expect(declaredNames().map(d => d.name).sort()).toEqual(
    ['authFlow', 'filters', 'focusRestoration', 'logger', 'progress', 'queryCache', 'searchQuery', 'session'].sort(),
  );
});

test('every declared store is registered by the bootstrap, once', () => {
  const registered = accountScope.registeredNames();
  const missing = declaredNames().filter(d => !registered.includes(d.name));
  expect(missing).toEqual([]);
  expect(new Set(registered).size).toBe(registered.length);
});

test('each name is declared in one place only', () => {
  const names = declaredNames().map(d => d.name);
  expect(new Set(names).size).toBe(names.length);
});

test('the session is the gate (first) and the scope is sealed', () => {
  expect(accountScope.registeredNames()[0]).toBe('session');
  expect(() => accountScope.register({ name: 'late', reset: () => {} })).toThrow(/sealed/);
});
