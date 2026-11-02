/**
 * Story 11.1 (FR-58, COMM-01, single-owner rule): comments are read-only and
 * E19 has one owner. No `.ts`/`.tsx` file under `src` outside
 * `src/shared/entities/comment` (and the DTO's doc comment) names a comment
 * path (import specifiers aside: a `comments` source folder is not a
 * path), and the comment repository sends GET only: no `method`, no form
 * body, no `http.request`. Tests are not scanned. Plain JS so the test needs
 * no Node type packages.
 */
const fs = require('node:fs');
const path = require('node:path');

const srcRoot = path.resolve(__dirname, '..', 'src');
const OWNER_DIR = path.join(srcRoot, 'shared', 'entities', 'comment');
const DTO_FILE = path.join(srcRoot, 'shared', 'api', 'dto', 'comments.ts');
const REPOSITORY = path.join(OWNER_DIR, 'commentRepository.ts');
/** A comment path: `…/post/<id>/comment…`, or a `/comment/` or `/comment?` segment anywhere. */
const COMMENT_PATH = /\/post\/[^\s'"`]*\/comments?\b|\/comments?[/?]/i;

/**
 * Story 11.2: module specifiers (`from './comments/PostComments'`) name a
 * source folder, not a request path; they are blanked before the scan.
 */
const withoutModuleSpecifiers = text => text.replace(/\bfrom\s+(['"])[^'"]*\1/g, 'from \'\'');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('comments are read-only, with one owner (Story 11.1)', () => {
  it('no source outside entities/comment names a comment path', () => {
    const offenders = sourceFiles(srcRoot)
      .filter(file => !file.startsWith(OWNER_DIR + path.sep) && file !== DTO_FILE)
      .filter(file => COMMENT_PATH.test(withoutModuleSpecifiers(fs.readFileSync(file, 'utf8'))))
      .map(file => path.relative(srcRoot, file));
    expect(offenders).toEqual([]);
  });

  it('the comment repository sends GET only', () => {
    const text = fs.readFileSync(REPOSITORY, 'utf8');
    expect(text).toMatch(/http\.get\(/);
    expect(text).not.toMatch(/http\.request\(/);
    expect(text).not.toMatch(/\bmethod\s*:/);
    expect(text).not.toMatch(/\bform\s*:/);
    expect(text).not.toMatch(/'(POST|PUT|DELETE|PATCH)'/);
  });

  it('the scan sees the owner (the pattern matches its path)', () => {
    expect(COMMENT_PATH.test(fs.readFileSync(REPOSITORY, 'utf8'))).toBe(true);
  });
});
