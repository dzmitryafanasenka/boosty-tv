import { z } from 'zod';
import { parseTag, tagVersion } from './version';

/**
 * The GitHub release the update check reads (Story 9.2, FR-56, UPD-01/02):
 * `GET /repos/dzmitryafanasenka/boosty-tv/releases/latest`. Only the fields
 * below are read; anything else is ignored. A response without a valid
 * `vX.Y.Z` tag is no release. The repository is fixed: no other host or
 * repository (never BoostBuddy's) is ever read, downloaded or shown.
 */

/** The only repository the app checks (Story 9.1 publishes there). */
export const UPDATE_REPOSITORY = 'dzmitryafanasenka/boosty-tv';
/** The fixed check endpoint. */
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;
/** The QR fallback when the release has no usable page URL. */
export const RELEASES_PAGE_URL = `https://github.com/${UPDATE_REPOSITORY}/releases/latest`;
/** Every asset the app downloads lives under this prefix (HTTPS, this repository). */
export const ASSET_URL_PREFIX = `https://github.com/${UPDATE_REPOSITORY}/releases/download/`;

const RELEASE_PAGE = /^https:\/\/github\.com\/dzmitryafanasenka\/boosty-tv\/releases\/tag\/[A-Za-z0-9._-]+$/;
const ASSET_URL = /^https:\/\/github\.com\/dzmitryafanasenka\/boosty-tv\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const SHA256_DIGEST = /^sha256:([0-9a-fA-F]{64})$/;

/** The changelog shown on the TV is capped at this many characters. */
export const NOTES_MAX_CHARS = 1200;
/** An APK larger than this is not downloaded (a bound, not a real-size estimate). */
export const MAX_APK_BYTES = 300 * 1024 * 1024;

export type ReleaseAsset = {
  name: string;
  url: string;
  /** GitHub's asset digest as given (`sha256:<hex>`), or null. */
  digest: string | null;
  size: number | null;
};

/** A release newer than the installed version, as the app keeps it. */
export type KnownRelease = {
  /** `vX.Y.Z`. */
  tag: string;
  /** `X.Y.Z`. */
  version: string;
  /** The release page for the QR (this repository only). */
  pageUrl: string;
  /** The Russian part of the notes as capped plain text; may be empty. */
  notes: string;
  assets: readonly ReleaseAsset[];
};

const assetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string(),
  digest: z.string().nullable().optional(),
  size: z.number().optional(),
});

const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string().optional(),
  body: z.string().nullable().optional(),
  assets: z.array(z.unknown()).optional(),
});

/**
 * The part of the release body before the first line that is only `---`
 * (docs/release.md: the Russian notes come first), as plain text: headings,
 * emphasis, inline code and link targets are dropped, list markers become
 * «•», blank runs collapse, and the result is capped at `NOTES_MAX_CHARS`.
 */
export function releaseNotes(body: string | null | undefined): string {
  if (typeof body !== 'string') {
    return '';
  }
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const end = lines.findIndex(line => /^\s*---\s*$/.test(line));
  const text = (end === -1 ? lines : lines.slice(0, end))
    .map(line =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^(\s*)[-*+]\s+/, '$1• ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*|__|`/g, '')
        .trimEnd(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > NOTES_MAX_CHARS ? `${text.slice(0, NOTES_MAX_CHARS - 1).trimEnd()}…` : text;
}

/** The release page for the QR: GitHub's page of this tag, or the fixed releases page. */
function pageUrlOf(htmlUrl: string | undefined): string {
  return htmlUrl !== undefined && RELEASE_PAGE.test(htmlUrl) ? htmlUrl : RELEASES_PAGE_URL;
}

/** A `releases/latest` body → the release, or null (no valid tag, wrong shape). */
export function parseRelease(raw: unknown): KnownRelease | null {
  const parsed = releaseSchema.safeParse(raw);
  if (!parsed.success || parseTag(parsed.data.tag_name) === null) {
    return null;
  }
  const { tag_name: tag, html_url: htmlUrl, body, assets = [] } = parsed.data;
  const parsedAssets: ReleaseAsset[] = [];
  for (const item of assets) {
    const asset = assetSchema.safeParse(item);
    if (asset.success) {
      parsedAssets.push({
        name: asset.data.name,
        url: asset.data.browser_download_url,
        digest: asset.data.digest ?? null,
        size: asset.data.size ?? null,
      });
    }
  }
  return {
    tag,
    version: tagVersion(tag),
    pageUrl: pageUrlOf(htmlUrl),
    notes: releaseNotes(body),
    assets: parsedAssets,
  };
}

/** The stored copy (the device preference): the same shape, checked again on read. */
const storedReleaseSchema = z.object({
  tag: z.string(),
  version: z.string(),
  pageUrl: z.string(),
  notes: z.string(),
  assets: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      digest: z.string().nullable(),
      size: z.number().nullable(),
    }),
  ),
});

/** A stored release, or null when it is not one (junk, an old shape, a tag that does not parse). */
export function parseStoredRelease(raw: unknown): KnownRelease | null {
  const parsed = storedReleaseSchema.safeParse(raw);
  if (!parsed.success || parseTag(parsed.data.tag) === null) {
    return null;
  }
  return { ...parsed.data, pageUrl: pageUrlOf(parsed.data.pageUrl) };
}

/** The file the app downloads: a verified repository URL, its SHA-256 (lowercase hex) and size. */
export type InstallAsset = {
  name: string;
  url: string;
  sha256: string;
  size: number;
};

export type InstallPlanUnavailable = 'no_asset' | 'foreign_url' | 'no_digest' | 'bad_size';

export type InstallPlan =
  | { kind: 'ready'; asset: InstallAsset; abi: string | null }
  | { kind: 'unavailable'; reason: InstallPlanUnavailable };

/** `boosty-tv-0.9.1-arm64-v8a.apk`. */
export function abiAssetName(version: string, abi: string): string {
  return `boosty-tv-${version}-${abi}.apk`;
}

/** `boosty-tv-0.9.1.apk` (every ABI). */
export function universalAssetName(version: string): string {
  return `boosty-tv-${version}.apk`;
}

/**
 * The APK for this device: the first of `abis` (`Build.SUPPORTED_ABIS`, in
 * the device's order) that has an asset, else the universal APK. The picked
 * asset must be under this repository's download URL, carry a `sha256:`
 * digest and a positive size within `MAX_APK_BYTES`; otherwise nothing is
 * downloaded (the dialog shows the QR fallback). An unusable per-ABI asset
 * does not fall back to the universal one: a broken release is shown as it
 * is, not worked around.
 */
export function pickInstallAsset(release: KnownRelease, abis: readonly string[]): InstallPlan {
  const byName = new Map(release.assets.map(asset => [asset.name, asset]));
  let picked: ReleaseAsset | undefined;
  let abi: string | null = null;
  for (const candidate of abis) {
    picked = byName.get(abiAssetName(release.version, candidate));
    if (picked) {
      abi = candidate;
      break;
    }
  }
  picked ??= byName.get(universalAssetName(release.version));
  if (!picked) {
    return { kind: 'unavailable', reason: 'no_asset' };
  }
  if (!ASSET_URL.test(picked.url) || !picked.url.startsWith(ASSET_URL_PREFIX)) {
    return { kind: 'unavailable', reason: 'foreign_url' };
  }
  const digest = picked.digest === null ? null : SHA256_DIGEST.exec(picked.digest);
  if (!digest) {
    return { kind: 'unavailable', reason: 'no_digest' };
  }
  const size = picked.size;
  if (size === null || !Number.isInteger(size) || size <= 0 || size > MAX_APK_BYTES) {
    return { kind: 'unavailable', reason: 'bad_size' };
  }
  return {
    kind: 'ready',
    abi,
    asset: { name: picked.name, url: picked.url, sha256: digest[1].toLowerCase(), size },
  };
}
