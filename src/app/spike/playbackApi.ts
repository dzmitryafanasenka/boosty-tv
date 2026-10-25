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
