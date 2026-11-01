/**
 * Version rules of the update check (Story 9.2, FR-56, UPD-01). Releases are
 * tagged `vMAJOR.MINOR.PATCH` (docs/release.md); the installed version is
 * the native `versionName` (`MAJOR.MINOR.PATCH`, no `v`). Parts compare
 * numerically (`0.10.0` > `0.9.0`). Anything that does not parse is never
 * newer, so a malformed tag or an unknown installed version shows nothing.
 */

export type Version = readonly [number, number, number];

const PART = '(0|[1-9]\\d{0,3})';
const VERSION_NAME = new RegExp(`^${PART}\\.${PART}\\.${PART}$`);
const TAG = new RegExp(`^v${PART}\\.${PART}\\.${PART}$`);

function toVersion(match: RegExpExecArray | null): Version | null {
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `0.9.0` → [0, 9, 0]; anything else (a `v`, a suffix, junk) → null. */
export function parseVersionName(name: string | null | undefined): Version | null {
  return typeof name === 'string' ? toVersion(VERSION_NAME.exec(name)) : null;
}

/** `v0.9.0` → [0, 9, 0]; anything else (no `v`, `v1.0`, `v1.0.0-rc1`) → null. */
export function parseTag(tag: string | null | undefined): Version | null {
  return typeof tag === 'string' ? toVersion(TAG.exec(tag)) : null;
}

/** Negative: a < b; 0: equal; positive: a > b. */
export function compareVersions(a: Version, b: Version): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

/** The tag is a valid release tag strictly newer than the installed `versionName`. */
export function isNewerTag(tag: string | null | undefined, installed: string | null | undefined): boolean {
  const latest = parseTag(tag);
  const current = parseVersionName(installed);
  return latest !== null && current !== null && compareVersions(latest, current) > 0;
}

/** `v0.9.1` → `0.9.1` (the tag is already valid). */
export function tagVersion(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}
