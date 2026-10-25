/**
 * Story 1.6 spike only (branch spike/1-6-playback). Pure helpers for the
 * playback, expiry and progress spike screen (PlaybackCheck.tsx):
 * - E9 progress write and the corrupted-Bearer E8 request builders;
 * - `playerUrls` → playable sources (api-contract §6 table);
 * - video candidates from E4 pages and the same-media lookup after an E8
 *   re-fetch (re-resolve by `ok_video.id` and `playerUrls` type);
 * - the E9 cadence rule (`ProgressThrottle`);
 * - `redactForLog` for every log line and on-screen error text.
 *
 * Signed media URLs stay in memory only. Nothing here logs.
 */
import {
  API_BASE,
  encodeForm,
  webHeaders,
  type ApiRequest,
} from './phoneAuthApi';
import { buildPostRequest } from './contentShapesApi';
import { withBearer } from './refreshCoordinator';

/** API requests (refreshes and direct calls included) per app run. */
export const RUN_REQUEST_BUDGET = 150;
export const MAX_CANDIDATES = 5;
/** Reference cadence: write when the position moved this much (seconds). */
export const PROGRESS_STEP_S = 10;
export const SEEK_STEP_S = 10;

// ------------------------------------------------------------- requests ----

const seg = (value: string) => encodeURIComponent(value);

/** E9 `PUT /v1/viewstat/video/{videoId}/timecode/`, form `time_code`. */
export function buildProgressRequest(
  videoId: string,
  seconds: number,
): ApiRequest {
  return {
    name: 'E9',
    url: `${API_BASE}/v1/viewstat/video/${seg(videoId)}/timecode/`,
    method: 'PUT',
    headers: {
      ...webHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm([['time_code', String(Math.max(0, Math.floor(seconds)))]]),
  };
}

const TOKEN_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A synthetic random 64-character token (the live tokens are 64-character
 * opaque strings, api-contract §2.2). Never derived from a real token.
 */
export function randomOpaqueToken(random: () => number = Math.random): string {
  return Array.from(
    { length: 64 },
    () => TOKEN_CHARS[Math.floor(random() * TOKEN_CHARS.length)],
  ).join('');
}

/**
 * E8 with a synthetic Bearer, sent directly (no coordinator, no refresh):
 * does a content endpoint answer 401 or an anonymous 200 for a bad token?
 */
export function buildBadTokenPostRequest(
  blogUrl: string,
  postId: string,
  random: () => number = Math.random,
): ApiRequest {
  return withBearer(
    buildPostRequest(blogUrl, postId, 'E8-badtoken'),
    randomOpaqueToken(random),
  );
}

// ------------------------------------------------------------- sources ----

export type SourceKind = 'hls' | 'dash' | 'progressive';

export type PlayerSource = {
  /** Boosty `playerUrls[].type`, an enum safe for logs. */
  type: string;
  kind: SourceKind;
  /** Vertical resolution for progressive (MP4) sources. */
  height?: number;
  label: string;
  /** Signed CDN URL. Memory only: never logged, shown or persisted. */
  url: string;
};

const PROGRESSIVE_HEIGHT: Record<string, number> = {
  tiny: 144,
  mobile: 144,
  lowest: 240,
  low: 360,
  sd: 480,
  medium: 480,
  hd: 720,
  high: 720,
  full: 1080,
  full_hd: 1080,
  fullhd: 1080,
  quad: 1440,
  quad_hd: 1440,
  quadhd: 1440,
  ultra: 2160,
  ultra_hd: 2160,
  ultrahd: 2160,
};
const HLS_TYPES = new Set([
  'hls',
  'live_hls',
  'live_playback_hls',
  'live_ondemand_hls',
  'ondemand_hls',
  'ondemand_hls_live',
]);
const DASH_TYPES = new Set([
  'dash',
  'dash_uni',
  'dash_sep',
  'live_dash',
  'live_playback_dash',
  'ondemand_dash',
  'ondemand_dash_live',
]);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined;
const arr = (v: unknown): unknown[] | undefined =>
  Array.isArray(v) ? v : undefined;

const KIND_ORDER: Record<SourceKind, number> = {
  hls: 0,
  progressive: 1,
  dash: 2,
};

/**
 * `ok_video.playerUrls[]` → playable sources per the api-contract §6 table.
 * Empty URLs and unmapped types (`mp4`, `webm`, `live_cmaf`, unknown) are
 * skipped; one entry per type. Order: HLS, MP4 by height, DASH.
 */
export function mapPlayerUrls(block: unknown): PlayerSource[] {
  const out: PlayerSource[] = [];
  for (const entry of arr(obj(block)?.playerUrls) ?? []) {
    const e = obj(entry);
    const type = e?.type;
    const url = e?.url;
    if (typeof type !== 'string' || typeof url !== 'string' || url === '') {
      continue;
    }
    if (out.some(s => s.type === type)) {
      continue;
    }
    if (HLS_TYPES.has(type)) {
      out.push({ type, kind: 'hls', label: 'HLS', url });
    } else if (DASH_TYPES.has(type)) {
      out.push({ type, kind: 'dash', label: 'DASH', url });
    } else if (Object.hasOwn(PROGRESSIVE_HEIGHT, type)) {
      const height = PROGRESSIVE_HEIGHT[type];
      out.push({
        type,
        kind: 'progressive',
        height,
        label: `MP4 ${height}p`,
        url,
      });
    }
  }
  return out.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.height ?? 0) - (b.height ?? 0),
  );
}

/** `ok_video.id` as a string (the progress identity), or undefined. */
export function mediaIdOf(block: unknown): string | undefined {
  const id = obj(block)?.id;
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }
  return typeof id === 'number' && Number.isFinite(id) ? String(id) : undefined;
}

const videoBlocks = (post: Obj) =>
  (arr(post.data) ?? [])
    .map(obj)
    .filter((b): b is Obj => b !== undefined && b.type === 'ok_video');

export type VideoCandidate = {
  blogUrl: string;
  postId: string;
  mediaId: string;
  /** On screen only; never logged. */
  title: string;
  sourceCount: number;
};

/**
 * Accessible `ok_video` blocks of one E4 page, in order, with at least one
 * playable source. Locked posts (`hasAccess !== true`) are skipped.
 */
export function videoCandidates(
  posts: readonly Obj[],
  fallbackBlog: string,
): VideoCandidate[] {
  const out: VideoCandidate[] = [];
  for (const post of posts) {
    if (post.hasAccess !== true || typeof post.id !== 'string' || !post.id) {
      continue;
    }
    const blog = obj(post.user)?.blogUrl;
    const blogUrl =
      typeof blog === 'string' && blog.length > 0 ? blog : fallbackBlog;
    for (const block of videoBlocks(post)) {
      const mediaId = mediaIdOf(block);
      const sources = mapPlayerUrls(block);
      if (!mediaId || sources.length === 0) {
        continue;
      }
      // The post title identifies the video for the owner; the block title
      // is a generic "Video" in live data.
      const title =
        typeof post.title === 'string' && post.title.length > 0
          ? post.title
          : typeof block.title === 'string'
          ? block.title
          : '';
      out.push({
        blogUrl,
        postId: post.id,
        mediaId,
        title,
        sourceCount: sources.length,
      });
    }
  }
  return out;
}

export type SameMediaResult =
  | {
      kind: 'found';
      source: PlayerSource;
      sources: PlayerSource[];
      /** Server-side saved position (seconds), when present. */
      timeCode?: number;
      duration?: number;
    }
  | { kind: 'no-access' }
  | { kind: 'no-media' }
  | { kind: 'no-type'; sources: PlayerSource[] };

/**
 * Re-resolve after an E8 re-fetch: the `ok_video` block with the same id in
 * `data`, and its source of the same `playerUrls` type. `type` undefined
 * means "any" (the first mapped source), used for the initial load.
 */
export function findSameMedia(
  post: unknown,
  mediaId: string,
  type?: string,
): SameMediaResult {
  const p = obj(post);
  if (!p || p.hasAccess !== true) {
    return { kind: 'no-access' };
  }
  const block = videoBlocks(p).find(b => mediaIdOf(b) === mediaId);
  if (!block) {
    return { kind: 'no-media' };
  }
  const sources = mapPlayerUrls(block);
  const source =
    type === undefined ? sources[0] : sources.find(s => s.type === type);
  if (!source) {
    return { kind: 'no-type', sources };
  }
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  return {
    kind: 'found',
    source,
    sources,
    timeCode: num(block.timeCode),
    duration: num(block.duration),
  };
}

// ------------------------------------------------------------- cadence ----

export type WriteReason = 'progress' | 'pause' | 'exit' | 'background';

/**
 * E9 cadence (reference): a progress write when the position moved at least
 * PROGRESS_STEP_S since the last successful write; event writes on pause,
 * exit and background. Integer seconds.
 *
 * Failures are never retried blindly: a failed progress write also moves
 * the attempt mark, so the next progress write needs another
 * PROGRESS_STEP_S of movement. Event writes are skipped only when the
 * position equals the last successful write. Progress writes are skipped
 * while another write is in flight; event writes are not.
 */
export class ProgressThrottle {
  private lastWritten: number | null = null;
  private lastFailedAttempt: number | null = null;
  private inflight = 0;

  constructor(private readonly step = PROGRESS_STEP_S) {}

  /** The integer second to write for `reason`, or null to skip. */
  next(position: number, reason: WriteReason): number | null {
    if (!Number.isFinite(position) || position < 0) {
      return null;
    }
    const s = Math.floor(position);
    if (reason !== 'progress') {
      return s === this.lastWritten ? null : s;
    }
    if (this.inflight > 0) {
      return null;
    }
    const moved = (mark: number | null) =>
      mark === null || Math.abs(s - mark) >= this.step;
    return moved(this.lastWritten) && moved(this.lastFailedAttempt) ? s : null;
  }

  begin() {
    this.inflight += 1;
  }

  done(seconds: number, ok: boolean) {
    this.inflight = Math.max(0, this.inflight - 1);
    if (ok) {
      this.lastWritten = seconds;
      this.lastFailedAttempt = null;
    } else {
      this.lastFailedAttempt = seconds;
    }
  }

  getLastWritten() {
    return this.lastWritten;
  }
}

// ------------------------------------------------------------ redaction ----

/**
 * Log and on-screen error redaction: URLs (with or without a scheme, and
 * bare `host.tld/path` runs), query strings, values of signed-URL query keys
 * without a leading `?` (`sig=…&expires=…`), `Bearer` values and opaque runs
 * of 40+ characters.
 */
export function redactForLog(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, '<url>')
    .replace(/(^|[\s("'=])\/\/[^\s"'<>)]+/g, '$1<url>')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s"'<>)]*/gi, '<url>')
    .replace(/\b(sig|srcIp|expires|urls|ms|id)=[^&\s"'<>)]*/g, '$1=<redacted>')
    .replace(/Bearer\s+\S+/g, 'Bearer <redacted>')
    .replace(/\?[^\s"'<>)]*/g, '?<query>')
    .replace(/[A-Za-z0-9._~+/=%:-]{40,}/g, '<redacted>');
}

/** Integer seconds for log lines. */
export const sec = (value: number) =>
  Number.isFinite(value) ? Math.floor(value) : -1;

// ------------------------------------------------------- URL diagnosis ----

const ENUM_VALUE = /^[A-Za-z_]{1,16}$/;
/**
 * Only these query keys may show their value (short letters-only enums).
 * A letters-only `sig` value is a signature fragment, so a value is never
 * shown because of its form alone.
 */
const ENUM_KEYS = new Set(['cmd', 'srcAg']);

/**
 * Structure of a signed media URL for logs, without its secrets: path
 * segment lengths, query keys with a value class (`digits(n)`, a short
 * letters-only enum under an ENUM_KEYS key, or `opaque(n)`) and encoding
 * flags. No host and no other values. Never contains `://` or `?`.
 */
export function describeUrlShape(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1] ?? '-';
  const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const q = rest.indexOf('?');
  const path = q >= 0 ? rest.slice(0, q) : rest;
  const query = q >= 0 ? rest.slice(q + 1) : '';
  const segs = path
    .split('/')
    .filter(Boolean)
    .map(s => String(s.length));
  const keys = query
    .split('&')
    .filter(Boolean)
    .map(pair => {
      const i = pair.indexOf('=');
      const key = i >= 0 ? pair.slice(0, i) : pair;
      const value = i >= 0 ? pair.slice(i + 1) : '';
      const safeKey = ENUM_VALUE.test(key) ? key : `key(${key.length})`;
      const cls = /^\d+$/.test(value)
        ? `digits(${value.length})`
        : ENUM_KEYS.has(key) && ENUM_VALUE.test(value)
        ? `enum:${value}`
        : `opaque(${value.length})`;
      return `${safeKey}:${cls}`;
    });
  const flags = [
    url.includes('&amp;') ? 'amp-entity' : '',
    /\s/.test(url) ? 'whitespace' : '',
    url.includes('%') ? 'percent' : '',
    url.includes('\\') ? 'backslash' : '',
  ].filter(Boolean);
  return (
    `scheme=${scheme} path=[${segs.join(',')}] ` +
    `query=[${keys.join(',')}] flags=[${flags.join(',')}]`
  );
}

/** Seconds until the URL's `expires` (epoch ms or s), or undefined. */
export function expiresInS(url: string, nowMs: number): number | undefined {
  const m = /[?&]expires=(\d+)/.exec(url);
  if (!m) {
    return undefined;
  }
  const raw = Number(m[1]);
  const ms = m[1].length >= 13 ? raw : raw * 1000;
  return Math.round((ms - nowMs) / 1000);
}

// ------------------------------------------------------ request profile ----

/** The reference client's API User-Agent (BoostBuddy `HttpClient.kt`). */
export const REFERENCE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

export type ApiProfile = 'web' | 'reference';

/**
 * E8 headers per profile. `web`: the spike's web-style set (desktop Chrome
 * UA, X-App, Referer, Origin). `reference`: as the reference client sends
 * content requests (mobile Android Chrome UA, no web headers). The Bearer
 * is added afterwards by the coordinator either way.
 */
export function withApiProfile(
  request: ApiRequest,
  profile: ApiProfile,
): ApiRequest {
  if (profile === 'web') {
    return request;
  }
  return {
    ...request,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': REFERENCE_USER_AGENT,
    },
  };
}

// ------------------------------------------- Story 1.7: audio and files ----
//
// Story 1.7 spike only (branch spike/1-7-audio-files). `audio_file` and
// `file` blocks (api-contract §4.1): the playable or downloadable URL is
// `url + Post.signedQuery`. Signed URLs stay in memory only.

export type MediaFileKind = 'audio' | 'file';

const BLOCK_TYPE: Record<MediaFileKind, string> = {
  audio: 'audio_file',
  file: 'file',
};

export type MediaFileCandidate = {
  kind: MediaFileKind;
  blogUrl: string;
  postId: string;
  /** Block `id` when present (re-resolve key); never logged. */
  blockId?: string;
  /** Block `url` without the signed query. Memory only. */
  url: string;
  /** `Post.signedQuery` as received (may be empty). Memory only. */
  signedQuery: string;
  /** On screen only; never logged. */
  title: string;
  /** `audio_file.duration` (seconds), when a finite number. */
  duration?: number;
  /** `file.size` (bytes, inferred), when a finite number. */
  size?: number;
};

const finite = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const blockIdOf = (block: Obj): string | undefined => {
  const id = block.id;
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }
  return typeof id === 'number' && Number.isFinite(id) ? String(id) : undefined;
};

/**
 * Blocks of `data[]` in order, with blocks nested in `list` items
 * (`items[]{data: ContentBlock[], items[]}`, recursively) right after
 * their list block.
 */
function flatBlocks(data: unknown): Obj[] {
  const out: Obj[] = [];
  const visit = (blocks: unknown) => {
    for (const block of (arr(blocks) ?? []).map(obj)) {
      if (block) {
        out.push(block);
        visitItems(block.items);
      }
    }
  };
  const visitItems = (items: unknown) => {
    for (const item of (arr(items) ?? []).map(obj)) {
      visit(item?.data);
      visitItems(item?.items);
    }
  };
  visit(data);
  return out;
}

function mediaFileCandidates(
  kind: MediaFileKind,
  posts: readonly Obj[],
  fallbackBlog: string,
): MediaFileCandidate[] {
  const out: MediaFileCandidate[] = [];
  for (const post of posts) {
    if (post.hasAccess !== true || typeof post.id !== 'string' || !post.id) {
      continue;
    }
    const blog = obj(post.user)?.blogUrl;
    const blogUrl =
      typeof blog === 'string' && blog.length > 0 ? blog : fallbackBlog;
    const signedQuery =
      typeof post.signedQuery === 'string' ? post.signedQuery : '';
    for (const block of flatBlocks(post.data)) {
      if (block.type !== BLOCK_TYPE[kind]) {
        continue;
      }
      if (typeof block.url !== 'string' || block.url === '') {
        continue;
      }
      const blockTitle =
        typeof block.title === 'string' && block.title.length > 0
          ? block.title
          : '';
      const postTitle = typeof post.title === 'string' ? post.title : '';
      out.push({
        kind,
        blogUrl,
        postId: post.id,
        blockId: blockIdOf(block),
        url: block.url,
        signedQuery,
        title: blockTitle || postTitle,
        duration: kind === 'audio' ? finite(block.duration) : undefined,
        size: kind === 'file' ? finite(block.size) : undefined,
      });
    }
  }
  return out;
}

/**
 * Accessible `audio_file` blocks of one E4 page, in order, including blocks
 * nested in `list` items. Locked posts (`hasAccess !== true`) and blocks
 * without a `url` are skipped.
 */
export const audioFileCandidates = (
  posts: readonly Obj[],
  fallbackBlog: string,
) => mediaFileCandidates('audio', posts, fallbackBlog);

/** Accessible `file` blocks of one E4 page, as `audioFileCandidates`. */
export const fileCandidates = (posts: readonly Obj[], fallbackBlog: string) =>
  mediaFileCandidates('file', posts, fallbackBlog);

/**
 * `url + signedQuery` with a correct separator: the query's own leading `?`
 * or `&` is dropped, then joined with `?` (no query in `url`) or `&`. An
 * empty `signedQuery` returns the bare `url`.
 */
export function signedUrl(url: string, signedQuery: string): string {
  const q = signedQuery.replace(/^[?&]+/, '');
  if (q === '') {
    return url;
  }
  if (!url.includes('?')) {
    return `${url}?${q}`;
  }
  return url.endsWith('?') || url.endsWith('&') ? `${url}${q}` : `${url}&${q}`;
}

/** Shape of a `signedQuery` for logs (keys and value classes, no values). */
export function describeSignedQuery(signedQuery: string): string {
  const q = signedQuery.replace(/^[?&]+/, '');
  if (q === '') {
    return 'empty';
  }
  // Words, not `?`/`&`: `redactForLog` would turn a bare `?` into `?<query>`.
  const lead =
    signedQuery[0] === '?' ? 'qmark' : signedQuery[0] === '&' ? 'amp' : 'none';
  const shape = describeUrlShape(`?${q}`).replace(/^scheme=- path=\[\] /, '');
  return `lead=${lead} ${shape}`;
}

/**
 * Expiry-like key names (`expire_time` is the key seen live on
 * `Post.signedQuery`, Story 1.7). One-letter keys (`e`, `t`) are not
 * accepted: they are as likely an issue or start time as an expiry.
 */
const EXPIRY_KEY =
  /^(expires?|exp|expiry|expire_?time|expire_at|expires_at|expiresAt|valid_?until|deadline)$/i;

export type ExpiryField = { key: string; inS: number };

/**
 * Expiry candidates in a `signedQuery`: keys that look like an expiry with
 * an all-digits value, as seconds until then (epoch ms when 13+ digits,
 * else epoch s). A negative `inS` is a past timestamp, not an expiry. An
 * empty list means no expiry field was found ("unverified").
 */
export function signedQueryExpiry(
  signedQuery: string,
  nowMs: number,
): ExpiryField[] {
  const out: ExpiryField[] = [];
  for (const pair of signedQuery.replace(/^[?&]+/, '').split('&')) {
    const i = pair.indexOf('=');
    if (i <= 0) {
      continue;
    }
    const key = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (!EXPIRY_KEY.test(key) || !/^\d{9,14}$/.test(value)) {
      continue;
    }
    const raw = Number(value);
    const ms = value.length >= 13 ? raw : raw * 1000;
    out.push({ key, inS: Math.round((ms - nowMs) / 1000) });
  }
  return out;
}

/** Log text for `signedQueryExpiry` results; never a value. */
export function formatExpiry(fields: readonly ExpiryField[]): string {
  if (fields.length === 0) {
    return 'no expiry field (unverified)';
  }
  return fields
    .map(f =>
      f.inS < 0 ? `${f.key} past timestamp` : `${f.key} in ${f.inS} s`,
    )
    .join(', ');
}

/**
 * Post-level `signedQuery` facts of one page, for logs: accessible posts,
 * how many have a non-empty `signedQuery`, the distinct shapes (keys and
 * value classes only, at most 3 listed) and the expiry fields as min/max
 * seconds until expiry per key, with past timestamps counted apart.
 */
export function signedQuerySummary(
  posts: readonly Obj[],
  nowMs: number,
): string {
  const accessible = posts.filter(p => p.hasAccess === true);
  const queries = accessible
    .map(p => (typeof p.signedQuery === 'string' ? p.signedQuery : ''))
    .filter(q => q.replace(/^[?&]+/, '') !== '');
  const shapes = [...new Set(queries.map(describeSignedQuery))];
  const perKey = new Map<string, { min: number; max: number; past: number }>();
  let withExpiry = 0;
  for (const q of queries) {
    const fields = signedQueryExpiry(q, nowMs);
    if (fields.length > 0) {
      withExpiry += 1;
    }
    for (const f of fields) {
      const e = perKey.get(f.key) ?? { min: Infinity, max: -Infinity, past: 0 };
      if (f.inS < 0) {
        e.past += 1;
      } else {
        e.min = Math.min(e.min, f.inS);
        e.max = Math.max(e.max, f.inS);
      }
      perKey.set(f.key, e);
    }
  }
  const expiry =
    perKey.size === 0
      ? 'none'
      : [...perKey]
          .map(
            ([k, e]) =>
              `${k}:${e.min === Infinity ? '-' : `${e.min}..${e.max} s`} past=${
                e.past
              }`,
          )
          .join(';');
  const listed = shapes.slice(0, 3).map(sh => `{${sh}}`);
  if (shapes.length > 3) {
    listed.push(`+${shapes.length - 3} more`);
  }
  return (
    `accessible=${accessible.length} nonEmpty=${queries.length} ` +
    `withExpiry=${withExpiry} shapes=${shapes.length} ` +
    `[${listed.join(' ')}] expiry=${expiry}`
  );
}

export type SameFileResult =
  | { kind: 'found'; candidate: MediaFileCandidate; matchedBy: 'id' | 'url' }
  | { kind: 'no-access' }
  | { kind: 'no-block' };

/**
 * Re-resolve after an E8 re-fetch: the block of the same kind with the same
 * block `id` (when the original had one), else with the same `url`. The
 * fresh candidate carries the fresh `signedQuery`.
 */
export function findSameFile(
  post: unknown,
  original: MediaFileCandidate,
): SameFileResult {
  const p = obj(post);
  if (!p || p.hasAccess !== true) {
    return { kind: 'no-access' };
  }
  const fresh = mediaFileCandidates(original.kind, [p], original.blogUrl);
  if (original.blockId !== undefined) {
    const byId = fresh.find(c => c.blockId === original.blockId);
    if (byId) {
      return { kind: 'found', candidate: byId, matchedBy: 'id' };
    }
  }
  const byUrl = fresh.find(c => c.url === original.url);
  return byUrl
    ? { kind: 'found', candidate: byUrl, matchedBy: 'url' }
    : { kind: 'no-block' };
}

/**
 * E4 next-page cursor: `extra.offset` (opaque, passed back verbatim) unless
 * `extra.isLast` is true or the offset is missing (api-contract §5).
 */
export function nextPageOffset(json: unknown): string | undefined {
  const extra = obj(obj(json)?.extra);
  if (!extra || extra.isLast === true) {
    return undefined;
  }
  const offset = extra.offset;
  if (typeof offset === 'string' && offset.length > 0) {
    return offset;
  }
  return typeof offset === 'number' && Number.isFinite(offset)
    ? String(offset)
    : undefined;
}

/**
 * Counts of `audio_file` / `file` blocks in a page (also inside `list`
 * items), accessible or not, and of locked posts.
 */
export function mediaFileBlockCounts(posts: readonly Obj[]) {
  const counts = { audio: 0, file: 0, lockedPosts: 0 };
  for (const post of posts) {
    if (post.hasAccess !== true) {
      counts.lockedPosts += 1;
    }
    for (const block of flatBlocks(post.data)) {
      if (block.type === 'audio_file') {
        counts.audio += 1;
      } else if (block.type === 'file') {
        counts.file += 1;
      }
    }
  }
  return counts;
}

const SAFE_TYPE = /^[a-z][a-z0-9_]{0,29}$/;

/**
 * Block types seen in `data[]` of accessible posts, including blocks nested
 * in `list` items, as `type×n` sorted by name. Types that are not short
 * lowercase enums are counted as `<other>`. Shows whether an audio or file
 * block exists under another type name or inside a list.
 */
export function blockTypeSummary(posts: readonly Obj[]): string {
  const counts = new Map<string, number>();
  const visit = (blocks: unknown, nested: boolean) => {
    for (const block of (arr(blocks) ?? []).map(obj)) {
      if (!block) {
        continue;
      }
      const t =
        typeof block.type === 'string' && SAFE_TYPE.test(block.type)
          ? block.type
          : '<other>';
      const key = nested ? `list>${t}` : t;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      visitItems(block.items);
    }
  };
  // `list` items: `{data: ContentBlock[], items: Item[]}`, nested.
  const visitItems = (items: unknown) => {
    for (const item of (arr(items) ?? []).map(obj)) {
      visit(item?.data, true);
      visitItems(item?.items);
    }
  };
  for (const post of posts) {
    if (post.hasAccess === true) {
      visit(post.data, false);
    }
  }
  return (
    [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, n]) => `${t}×${n}`)
      .join(',') || '-'
  );
}
