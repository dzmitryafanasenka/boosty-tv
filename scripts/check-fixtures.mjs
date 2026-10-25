#!/usr/bin/env node
/**
 * Fixture sanitization check (Story 1.5, epic-1-context "Fixtures").
 *
 * Usage: node scripts/check-fixtures.mjs [dir]   (default: src/test/fixtures)
 *
 * Fails (exit 1) when any JSON fixture contains:
 * - an opaque run of 40+ token characters, or `Bearer`;
 * - a URL outside `https://example.invalid/`;
 * - a query string other than `?sig=REDACTED`;
 * - a run of 9+ digits in a string or key (phone-like), or a 9+ digit
 *   integer under a key that is not a timestamp or size;
 * - an `@`-email;
 * - any string that is not a placeholder, a synthetic value or an
 *   allowlisted enum.
 * Files other than `*.json` (and `.gitkeep`) also fail.
 * Output names the file, the JSON path and the rule, never the value.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'src/test/fixtures');

const PLACEHOLDER = 'redacted';
const SIGNED_QUERY = '?sig=REDACTED';
const SYNTHETIC = /^synthetic-(id|blog|key)-\d{1,4}$/;
const URL_PLACEHOLDER = /^https:\/\/example\.invalid\/[a-z-]{1,20}$/;
const SYNTHETIC_TEXT = 'Sample text';
const ENUM_KEYS = new Set(['type', 'modificator', 'error', 'status']);
const ENUM_VALUE = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
const CASE_VALUE = /^[a-z0-9-]{1,40}$/;
const SAFE_KEY = /^[A-Za-z_$][\w$-]{0,40}$/;
const TIME_OR_SIZE_KEY =
  /(At|Time|_at|_time|_ts|Timestamp|timestamp)$|^(size|fileSize|file_size)$/;

const RAW_RULES = [
  ['opaque 40+ run', /[A-Za-z0-9_\-+/=.~%]{40,}/],
  ['Bearer', /bearer/i],
  ['URL outside example.invalid', /(https?:)?\/\/(?!example\.invalid\/)[^\s"]/i],
  ['query string', /\?(?!sig=REDACTED")[^"\s]*=/],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
];

function isSyntheticContent(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  return (
    Array.isArray(parsed) &&
    parsed.length === 3 &&
    parsed[0] === SYNTHETIC_TEXT &&
    typeof parsed[1] === 'string' &&
    /^[a-z_]{0,20}$/.test(parsed[1]) &&
    Array.isArray(parsed[2]) &&
    parsed[2].every(
      r =>
        Array.isArray(r) &&
        r.length === 3 &&
        r.every(n => Number.isInteger(n) && n >= 0 && n < 100),
    )
  );
}

function allowedString(value, key, path) {
  if (
    value === '' ||
    value === PLACEHOLDER ||
    value === SIGNED_QUERY ||
    SYNTHETIC.test(value) ||
    URL_PLACEHOLDER.test(value)
  ) {
    return true;
  }
  if (ENUM_KEYS.has(key) && ENUM_VALUE.test(value)) {
    return true;
  }
  if (key === 'content' && isSyntheticContent(value)) {
    return true;
  }
  return path === 'case' && CASE_VALUE.test(value);
}

export function checkJson(json) {
  const problems = [];
  const walk = (value, key, path) => {
    if (typeof value === 'string') {
      if (/\d{9,}/.test(value)) {
        problems.push([path, '9+ digit run']);
      }
      if (!allowedString(value, key, path)) {
        problems.push([path, 'string is not a placeholder, synthetic value or allowlisted enum']);
      }
      return;
    }
    if (typeof value === 'number') {
      if (
        Number.isFinite(value) &&
        Math.abs(Math.trunc(value)) >= 1e8 &&
        !TIME_OR_SIZE_KEY.test(key)
      ) {
        problems.push([path, '9+ digit number outside a timestamp/size key']);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, key, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        const childPath = path ? `${path}.${k}` : k;
        if (!(SYNTHETIC.test(k) || (SAFE_KEY.test(k) && !/\d{5,}/.test(k)))) {
          problems.push([path || '<root>', 'unsafe key']);
          walk(v, '<unsafe>', `${path}.<unsafe>`);
          continue;
        }
        walk(v, k, childPath);
      }
    }
  };
  walk(json, '', '');
  return problems;
}

export function checkText(text) {
  const problems = [];
  for (const [rule, re] of RAW_RULES) {
    if (re.test(text)) {
      problems.push(['<raw>', rule]);
    }
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    problems.push(['<raw>', 'not valid JSON']);
    return problems;
  }
  return problems.concat(checkJson(json));
}

function listFiles(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out = out.concat(listFiles(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

function main() {
  let files;
  try {
    files = listFiles(root);
  } catch {
    console.error(`check-fixtures: cannot read ${root}`);
    process.exit(1);
  }
  let failed = 0;
  let checked = 0;
  for (const file of files) {
    const rel = relative(root, file);
    if (file.endsWith('.gitkeep')) {
      continue;
    }
    if (!file.endsWith('.json')) {
      console.error(`FAIL ${rel}: not a .json fixture`);
      failed += 1;
      continue;
    }
    checked += 1;
    const problems = checkText(readFileSync(file, 'utf8'));
    for (const [path, rule] of problems) {
      console.error(`FAIL ${rel} ${path}: ${rule}`);
    }
    if (problems.length > 0) {
      failed += 1;
    }
  }
  if (failed > 0) {
    console.error(`check-fixtures: ${failed} file(s) failed, ${checked} JSON checked`);
    process.exit(1);
  }
  console.log(`check-fixtures: ${checked} JSON fixture(s) clean`);
}

main();
