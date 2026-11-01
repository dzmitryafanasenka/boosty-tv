import {
  MAX_APK_BYTES,
  NOTES_MAX_CHARS,
  RELEASES_PAGE_URL,
  parseRelease,
  parseStoredRelease,
  pickInstallAsset,
  releaseNotes,
  type KnownRelease,
  type ReleaseAsset,
} from '../releaseInfo';
import { compareVersions, isNewerTag, parseTag, parseVersionName } from '../version';

const DIGEST = 'a'.repeat(64);
const BASE = 'https://github.com/dzmitryafanasenka/boosty-tv/releases/download/v0.9.1/';

function asset(name: string, overrides: Partial<ReleaseAsset> = {}): ReleaseAsset {
  return { name, url: `${BASE}${name}`, digest: `sha256:${DIGEST}`, size: 40_000_000, ...overrides };
}

function release(assets: ReleaseAsset[]): KnownRelease {
  return {
    tag: 'v0.9.1',
    version: '0.9.1',
    pageUrl: 'https://github.com/dzmitryafanasenka/boosty-tv/releases/tag/v0.9.1',
    notes: '',
    assets,
  };
}

describe('version rules (Story 9.2)', () => {
  it('parses the tag (`v` required) and the versionName (no `v`)', () => {
    expect(parseTag('v0.9.1')).toEqual([0, 9, 1]);
    expect(parseTag('0.9.1')).toBeNull();
    expect(parseTag('v1.0')).toBeNull();
    expect(parseTag('v1.0.0-rc1')).toBeNull();
    expect(parseTag('v01.0.0')).toBeNull();
    expect(parseVersionName('0.9.0')).toEqual([0, 9, 0]);
    expect(parseVersionName('v0.9.0')).toBeNull();
    expect(parseVersionName('1.0')).toBeNull();
    expect(parseVersionName(null)).toBeNull();
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions([0, 10, 0], [0, 9, 0])).toBeGreaterThan(0);
    expect(isNewerTag('v0.10.0', '0.9.0')).toBe(true);
    expect(isNewerTag('v0.9.1', '0.9.0')).toBe(true);
    expect(isNewerTag('v1.0.0', '0.99.99')).toBe(true);
  });

  it('equal, older or unparsable is never newer', () => {
    expect(isNewerTag('v0.9.0', '0.9.0')).toBe(false);
    expect(isNewerTag('v0.8.9', '0.9.0')).toBe(false);
    expect(isNewerTag('latest', '0.9.0')).toBe(false);
    expect(isNewerTag('v0.9.1', '1.0')).toBe(false);
    expect(isNewerTag('v0.9.1', null)).toBe(false);
  });
});

describe('releaseNotes', () => {
  it('keeps only the part before the first `---` line, as plain text', () => {
    const body = '## 0.9.1\r\n\r\n- **Исправлено** воспроизведение\n* [Ссылка](https://example.com)\n\n\n\nКонец\n\n---\n\n## 0.9.1 (English)\n- Fixed';
    expect(releaseNotes(body)).toBe('0.9.1\n\n• Исправлено воспроизведение\n• Ссылка\n\nКонец');
  });

  it('no `---`: the whole body; nothing: empty', () => {
    expect(releaseNotes('Только русский')).toBe('Только русский');
    expect(releaseNotes(null)).toBe('');
    expect(releaseNotes(undefined)).toBe('');
  });

  it('is capped', () => {
    const notes = releaseNotes('я'.repeat(NOTES_MAX_CHARS * 2));
    expect(notes.length).toBe(NOTES_MAX_CHARS);
    expect(notes.endsWith('…')).toBe(true);
  });
});

describe('parseRelease', () => {
  const raw = {
    tag_name: 'v0.9.1',
    html_url: 'https://github.com/dzmitryafanasenka/boosty-tv/releases/tag/v0.9.1',
    body: 'Русский\n\n---\n\nEnglish',
    assets: [
      {
        name: 'boosty-tv-0.9.1.apk',
        browser_download_url: `${BASE}boosty-tv-0.9.1.apk`,
        digest: `sha256:${DIGEST}`,
        size: 1234,
        uploader: { login: 'x' },
      },
      { name: 42 },
    ],
    author: { login: 'someone' },
  };

  it('reads the tag, the page, the Russian notes and the well-formed assets', () => {
    expect(parseRelease(raw)).toEqual({
      tag: 'v0.9.1',
      version: '0.9.1',
      pageUrl: raw.html_url,
      notes: 'Русский',
      assets: [{ name: 'boosty-tv-0.9.1.apk', url: `${BASE}boosty-tv-0.9.1.apk`, digest: `sha256:${DIGEST}`, size: 1234 }],
    });
  });

  it('a bad tag or shape is no release', () => {
    expect(parseRelease({ ...raw, tag_name: 'nightly' })).toBeNull();
    expect(parseRelease({ message: 'API rate limit exceeded' })).toBeNull();
    expect(parseRelease(undefined)).toBeNull();
  });

  it('a page URL off this repository falls back to the fixed releases page', () => {
    expect(parseRelease({ ...raw, html_url: 'https://github.com/slartus/BoostBuddy/releases/tag/v9.9.9' })?.pageUrl).toBe(
      RELEASES_PAGE_URL,
    );
    expect(parseRelease({ ...raw, html_url: undefined })?.pageUrl).toBe(RELEASES_PAGE_URL);
  });

  it('the stored copy is checked again', () => {
    const parsed = parseRelease(raw);
    expect(parseStoredRelease(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(parseStoredRelease({ tag: 'x' })).toBeNull();
    expect(parseStoredRelease({ ...parsed, tag: 'nightly' })).toBeNull();
  });
});

describe('pickInstallAsset (matrix «Install, allowed», «ABI fallback», «No digest / foreign URL»)', () => {
  const all = [
    asset('boosty-tv-0.9.1-armeabi-v7a.apk'),
    asset('boosty-tv-0.9.1-arm64-v8a.apk'),
    asset('boosty-tv-0.9.1.apk'),
  ];

  it('the first supported ABI that has an asset, in the device order', () => {
    expect(pickInstallAsset(release(all), ['arm64-v8a', 'armeabi-v7a', 'armeabi'])).toEqual({
      kind: 'ready',
      abi: 'arm64-v8a',
      asset: { name: 'boosty-tv-0.9.1-arm64-v8a.apk', url: `${BASE}boosty-tv-0.9.1-arm64-v8a.apk`, sha256: DIGEST, size: 40_000_000 },
    });
    expect(pickInstallAsset(release(all), ['armeabi-v7a', 'armeabi'])).toMatchObject({ abi: 'armeabi-v7a' });
    expect(pickInstallAsset(release(all), ['x86_64', 'armeabi-v7a'])).toMatchObject({ abi: 'armeabi-v7a' });
  });

  it('no asset for any supported ABI: the universal APK', () => {
    expect(pickInstallAsset(release(all), ['x86_64'])).toMatchObject({
      kind: 'ready',
      abi: null,
      asset: { name: 'boosty-tv-0.9.1.apk' },
    });
    expect(pickInstallAsset(release(all), [])).toMatchObject({ abi: null });
  });

  it('none at all: no download (the QR)', () => {
    expect(pickInstallAsset(release([asset('notes.txt')]), ['armeabi-v7a'])).toEqual({ kind: 'unavailable', reason: 'no_asset' });
  });

  it('no `sha256:` digest: no download', () => {
    for (const digest of [null, 'md5:abc', `sha256:${'a'.repeat(63)}`, DIGEST]) {
      expect(pickInstallAsset(release([asset('boosty-tv-0.9.1.apk', { digest })]), [])).toEqual({
        kind: 'unavailable',
        reason: 'no_digest',
      });
    }
  });

  it('a URL off this repository (or not HTTPS): no download', () => {
    for (const url of [
      'https://github.com/slartus/BoostBuddy/releases/download/v0.9.1/boosty-tv-0.9.1.apk',
      'http://github.com/dzmitryafanasenka/boosty-tv/releases/download/v0.9.1/boosty-tv-0.9.1.apk',
      'https://evil.example/dzmitryafanasenka/boosty-tv/releases/download/v0.9.1/boosty-tv-0.9.1.apk',
      `${BASE}../../x.apk`,
      `${BASE}boosty-tv-0.9.1.apk?x=1`,
    ]) {
      expect(pickInstallAsset(release([asset('boosty-tv-0.9.1.apk', { url })]), [])).toEqual({
        kind: 'unavailable',
        reason: 'foreign_url',
      });
    }
  });

  it('an unusable per-ABI asset does not fall back to the universal one', () => {
    const assets = [asset('boosty-tv-0.9.1-armeabi-v7a.apk', { digest: null }), asset('boosty-tv-0.9.1.apk')];
    expect(pickInstallAsset(release(assets), ['armeabi-v7a'])).toEqual({ kind: 'unavailable', reason: 'no_digest' });
  });

  it('a missing, zero or oversized size: no download', () => {
    for (const size of [null, 0, 1.5, MAX_APK_BYTES + 1]) {
      expect(pickInstallAsset(release([asset('boosty-tv-0.9.1.apk', { size })]), [])).toEqual({
        kind: 'unavailable',
        reason: 'bad_size',
      });
    }
  });

  it('the digest is passed on as lowercase hex', () => {
    const plan = pickInstallAsset(release([asset('boosty-tv-0.9.1.apk', { digest: `sha256:${'AB'.repeat(32)}` })]), []);
    expect(plan).toMatchObject({ kind: 'ready', asset: { sha256: 'ab'.repeat(32) } });
  });
});
