/**
 * Story 1.5 spike only (branch spike/1-5-entitlement-errors-events). A fixed,
 * read-only request set (api-contract §3: E1–E5, E8, E15, E18) that records
 * entitlement, error and events shapes, plus the in-memory fixture sanitizer.
 *
 * Raw response bodies stay in memory. Log lines carry only statuses,
 * `describeShape` lines, counts, booleans and allowlisted enum values.
 * Fixtures are built only from `createFixtureSanitizer` output.
 */
import {
  API_BASE,
  buildCurrentUserRequest,
  execute,
  formatSanitized,
  webHeaders,
  type ApiRequest,
  type ContentRequestName,
  type FetchLike,
  type SanitizedResponse,
} from './phoneAuthApi';
import type { CallResult } from './refreshCoordinator';

export const REQUEST_BUDGET = 30;
export const MAX_BLOGS_SCANNED = 5;

// ------------------------------------------------------------- requests ----

function get(name: ContentRequestName, path: string): ApiRequest {
  return {
    name,
    url: `${API_BASE}${path}`,
    method: 'GET',
    headers: webHeaders(),
  };
}

const seg = (value: string) => encodeURIComponent(value);
const NO_COMMENTS = 'comments_limit=0&reply_limit=0';

/** E2 `GET /v1/user/subscriptions?limit=30&with_follow=true`. */
export const buildSubscriptionsRequest = () =>
  get('E2', '/v1/user/subscriptions?limit=30&with_follow=true');

/** E3 `GET /v1/blog/{blogUrl}`. */
export const buildBlogRequest = (
  blogUrl: string,
  name: 'E3' | 'E3-missing' = 'E3',
) => get(name, `/v1/blog/${seg(blogUrl)}`);

/** E4 `GET /v1/blog/{blogUrl}/post/`, first page, no comments. */
export const buildBlogPostsRequest = (blogUrl: string) =>
  get('E4', `/v1/blog/${seg(blogUrl)}/post/?limit=20&${NO_COMMENTS}`);

/** E5 `GET /v1/feed/post/`, first page, no comments. */
export const buildFeedRequest = () =>
  get('E5', `/v1/feed/post/?limit=10&${NO_COMMENTS}`);

/** E8 `GET /v1/blog/{blogUrl}/post/{postId}` with `comments_limit=0`. */
export const buildPostRequest = (
  blogUrl: string,
  postId: string,
  name: 'E8' | 'E8-noauth' | 'E8-missing' = 'E8',
) => get(name, `/v1/blog/${seg(blogUrl)}/post/${seg(postId)}?${NO_COMMENTS}`);

/** E15 `GET /v1/blog/{blogUrl}/video_stream`. */
export const buildVideoStreamRequest = (blogUrl: string) =>
  get('E15', `/v1/blog/${seg(blogUrl)}/video_stream`);

/**
 * E18 `GET /v1/notification/standalone/event/`. Paging parameters are
 * unknown; a second page is requested only with a cursor the first response
 * returns (§5 `extra.offset` convention, inferred).
 */
export const buildEventsRequest = (offset?: string) =>
  offset === undefined
    ? get('E18', '/v1/notification/standalone/event/')
    : get(
        'E18-page2',
        `/v1/notification/standalone/event/?offset=${encodeURIComponent(
          offset,
        )}`,
      );

/** E1 without `Authorization` (deliberate no-token call). */
export const buildNoTokenCurrentUserRequest = () =>
  get('E1-noauth', '/v1/user/current');

/** Random UUIDv4 for the "missing post" call. Never logged. */
export function randomUuidV4(random: () => number = Math.random): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(random() * 16).toString(16),
    ).join('');
  const variant = (8 + Math.floor(random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

/** Random blog slug for the "missing blog" call. */
export function randomBlogSlug(random: () => number = Math.random): string {
  const letters = Array.from({ length: 12 }, () =>
    String.fromCharCode(97 + Math.floor(random() * 26)),
  ).join('');
  return `spike-missing-${letters}`;
}

// ------------------------------------------------------------ analysis ----

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined;
const arr = (v: unknown): unknown[] | undefined =>
  Array.isArray(v) ? v : undefined;

const ENUM_VALUE = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
/** An enum value fit for a log line, or a neutral marker. */
const enumOrMarker = (v: unknown) =>
  typeof v === 'string' && ENUM_VALUE.test(v) ? v : `<${typeof v}>`;

export const KNOWN_BLOCK_TYPES = new Set([
  'text',
  'link',
  'smile',
  'image',
  'ok_video',
  'ok_stream',
  'video',
  'audio_file',
  'file',
]);

/** E2 `data[].blog.blogUrl`, deduplicated, in response order. */
export function subscriptionBlogUrls(json: unknown): string[] {
  const out: string[] = [];
  for (const item of arr(obj(json)?.data) ?? []) {
    const url = obj(obj(item)?.blog)?.blogUrl;
    if (typeof url === 'string' && url.length > 0 && !out.includes(url)) {
      out.push(url);
    }
  }
  return out;
}

/** Posts of an E4 page (`data[]`) or an E5 page (`data.posts[]`). */
export function postsOf(json: unknown, endpoint: 'E4' | 'E5'): Obj[] {
  const data = obj(json)?.data;
  const list = endpoint === 'E4' ? arr(data) : arr(obj(data)?.posts);
  return (list ?? []).map(obj).filter((p): p is Obj => p !== undefined);
}

export type PostRef = {
  blogUrl: string;
  postId: string;
  hasVideo: boolean;
};

const blocksOf = (post: Obj, key: 'data' | 'teaser') =>
  (arr(post[key]) ?? []).map(obj).filter((b): b is Obj => b !== undefined);

const hasVideoBlock = (post: Obj) =>
  blocksOf(post, 'data').some(b => b.type === 'ok_video');

function refOf(post: Obj, fallbackBlog: string): PostRef | undefined {
  const id = post.id;
  if (typeof id !== 'string' || id.length === 0) {
    return undefined;
  }
  const blog = obj(post.user)?.blogUrl;
  return {
    blogUrl: typeof blog === 'string' && blog.length > 0 ? blog : fallbackBlog,
    postId: id,
    hasVideo: hasVideoBlock(post),
  };
}

/**
 * First accessible (`hasAccess === true`, preferring one with an `ok_video`
 * in `data`) and first locked (`hasAccess === false`) post of one page.
 * A missing `hasAccess` counts as neither.
 */
export function pickPosts(
  posts: readonly Obj[],
  blogUrl: string,
): { accessible?: PostRef; locked?: PostRef; missingHasAccess: number } {
  let accessible: PostRef | undefined;
  let accessibleVideo: PostRef | undefined;
  let locked: PostRef | undefined;
  let missingHasAccess = 0;
  for (const post of posts) {
    if (post.hasAccess === true) {
      const ref = refOf(post, blogUrl);
      accessible = accessible ?? ref;
      if (ref?.hasVideo) {
        accessibleVideo = accessibleVideo ?? ref;
      }
    } else if (post.hasAccess === false) {
      locked = locked ?? refOf(post, blogUrl);
    } else {
      missingHasAccess += 1;
    }
  }
  return {
    accessible: accessibleVideo ?? accessible,
    locked,
    missingHasAccess,
  };
}

function blockTypeSummary(blocks: readonly Obj[]): string {
  const counts = new Map<string, number>();
  for (const b of blocks) {
    const t = enumOrMarker(b.type);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].map(([t, n]) => `${t}×${n}`).join(', ') || '—';
}

function describeVideoBlock(where: string, b: Obj): string {
  const urls = (arr(b.playerUrls) ?? []).map(obj).filter(Boolean) as Obj[];
  const nonEmpty = urls.filter(u => typeof u.url === 'string' && u.url !== '');
  const types = [...new Set(nonEmpty.map(u => enumOrMarker(u.type)))];
  const keys = Object.keys(b)
    .filter(k => /^[A-Za-z_]{1,30}$/.test(k))
    .sort();
  const duration =
    typeof b.duration === 'number'
      ? `duration=${b.duration}`
      : `duration ${b.duration === undefined ? 'absent' : typeof b.duration}`;
  return (
    `${where} ${enumOrMarker(b.type)}: playerUrls=${urls.length} ` +
    `(non-empty ${nonEmpty.length}) types=[${types.join(',')}]; ${duration}; ` +
    `timeCode=${typeof b.timeCode}; preview=${typeof b.preview}; ` +
    `keys=[${keys.join(',')}]`
  );
}

/** Entitlement-relevant facts of one post object; values never leave. */
export function describePost(post: Obj): string[] {
  const hasAccess =
    typeof post.hasAccess === 'boolean'
      ? String(post.hasAccess)
      : `missing (${typeof post.hasAccess})`;
  const data = blocksOf(post, 'data');
  const teaser = blocksOf(post, 'teaser');
  const lines = [
    `hasAccess=${hasAccess}; signedQuery=${typeof post.signedQuery}` +
      (typeof post.signedQuery === 'string'
        ? ` (empty=${post.signedQuery === ''})`
        : '') +
      `; poll=${post.poll ? 'present' : 'absent'}`,
    `data: ${Array.isArray(post.data) ? data.length : typeof post.data} ` +
      `blocks [${blockTypeSummary(data)}]`,
    `teaser: ${
      Array.isArray(post.teaser) ? teaser.length : typeof post.teaser
    } ` + `blocks [${blockTypeSummary(teaser)}]`,
  ];
  for (const [where, blocks] of [
    ['data', data],
    ['teaser', teaser],
  ] as const) {
    for (const b of blocks) {
      if (b.type === 'ok_video' || b.type === 'ok_stream') {
        lines.push(describeVideoBlock(where, b));
      }
    }
  }
  return lines;
}

/** Block types outside KNOWN_BLOCK_TYPES found in any post-like body. */
export function unknownBlockTypes(json: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8) {
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(x => walk(x, depth + 1));
      return;
    }
    const o = obj(v);
    if (!o) {
      return;
    }
    const postLike = 'hasAccess' in o || 'teaser' in o;
    for (const key of postLike ? ['data', 'teaser'] : []) {
      for (const b of arr(o[key]) ?? []) {
        const t = obj(b)?.type;
        if (typeof t === 'string' && !KNOWN_BLOCK_TYPES.has(t)) {
          found.add(enumOrMarker(t));
        }
      }
    }
    Object.values(o).forEach(x => walk(x, depth + 1));
  };
  walk(json, 0);
  return [...found].sort();
}

/** E18: event count, types, counters and cursor fields. */
export function describeEvents(json: unknown): {
  lines: string[];
  verified: boolean;
  cursor?: string;
} {
  const root = obj(json);
  const ns = obj(obj(root?.data)?.notificationStandalone);
  const events = arr(ns?.events);
  const types = new Map<string, number>();
  for (const e of events ?? []) {
    const t = enumOrMarker(obj(e)?.type);
    types.set(t, (types.get(t) ?? 0) + 1);
  }
  const count = obj(ns?.count);
  const num = (v: unknown) => (typeof v === 'number' ? String(v) : typeof v);
  const extra = obj(root?.extra);
  const offset = extra?.offset;
  const isLast = extra?.isLast;
  const cursor =
    (typeof offset === 'string' && offset.length > 0) ||
    typeof offset === 'number'
      ? String(offset)
      : undefined;
  const lines = [
    `events: ${events ? events.length : 'absent'}; types=[${[...types]
      .map(([t, n]) => `${t}×${n}`)
      .join(', ')}]`,
    `count: total=${num(count?.total)}, unread=${num(
      count?.unread,
    )}, byEventType=${
      Array.isArray(count?.byEventType)
        ? `array(${(count?.byEventType as unknown[]).length})`
        : typeof count?.byEventType
    }; updateTime=${typeof ns?.updateTime}`,
    `cursor: extra=${extra ? 'present' : 'absent'}, offset=${
      offset === undefined ? 'absent' : `${typeof offset}`
    }, isLast=${typeof isLast === 'boolean' ? isLast : typeof isLast}; ` +
      `other top-level keys=[${Object.keys(root ?? {})
        .filter(k => k !== 'data' && /^[A-Za-z_]{1,30}$/.test(k))
        .join(',')}]`,
  ];
  return {
    lines,
    verified: events !== undefined,
    cursor: isLast === true ? undefined : cursor,
  };
}

// ----------------------------------------------------------- sanitizer ----

const FIXTURE_ENUM_KEYS = new Set(['type', 'modificator', 'error', 'status']);
const ID_KEY = /^(id|int_id|vid|uuid)$|Id$|_id$/;
const BLOG_KEY = /^(blogUrl|blog_url)$/;
const PHONE_KEY = /phone/i;
/*
 * Numbers can identify the owner's subscriptions in combination (publish
 * times, view and like counts, prices, exact durations), so none is kept
 * verbatim except structural ones. The same rules are enforced by
 * scripts/check-fixtures.mjs.
 */
const TIME_KEY = /(At|Time|_at|_time|_ts|Timestamp|timestamp)$/;
const SIZE_KEY = /^(size|fileSize|file_size)$/;
const DURATION_KEY = /^(duration|timeCode|time_code)$/;
/** Structural numbers kept as-is (paging, dimensions, statuses, units). */
const KEEP_NUMBER_KEY =
  /^(status|statusCode|width|height|total|offset|limit|unread|period|priority|showcase|expiresIn|expires_in)$/;
/** Synthetic times: base + rank * 1 h, order kept across the whole run. */
export const SYNTHETIC_TIME_BASE = 1_700_000_000;
export const SYNTHETIC_TIME_STEP = 3600;
export const SIZE_STEP = 102_400;
/** Every other positive number (counts, money, sort orders) becomes this. */
export const SYNTHETIC_COUNT = 5;

/** Distinct time values in the bodies, for the order-preserving mapping. */
function collectTimes(bodies: readonly unknown[]): number[] {
  const out = new Set<number>();
  const walk = (v: unknown, key: string) => {
    if (typeof v === 'number') {
      if (TIME_KEY.test(key) && Number.isFinite(v)) {
        out.add(v);
      }
    } else if (Array.isArray(v)) {
      v.forEach(x => walk(x, key));
    } else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Obj)) {
        walk(child, k);
      }
    }
  };
  bodies.forEach(b => walk(b, ''));
  return [...out].sort((a, b) => a - b);
}
const URL_VALUE = /^(https?:)?\/\//i;
const SAFE_KEY = /^[A-Za-z_$][\w$-]{0,40}$/;
const URL_KINDS = new Set([
  'image',
  'ok_video',
  'ok_stream',
  'video',
  'audio_file',
  'file',
  'link',
  'smile',
]);

export const PLACEHOLDER = 'redacted';
export const SIGNED_QUERY_PLACEHOLDER = '?sig=REDACTED';
export const SYNTHETIC_TEXT = 'Sample text';

/** `[text, style, ranges]` with synthetic text; style codes kept. */
function syntheticContent(raw: string): string {
  let style = 'unstyled';
  const codes: number[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (typeof parsed[1] === 'string' && /^[a-z_]{0,20}$/.test(parsed[1])) {
        style = parsed[1];
      }
      for (const r of arr(parsed[2]) ?? []) {
        const code = arr(r)?.[0];
        if (
          typeof code === 'number' &&
          Number.isInteger(code) &&
          code >= 0 &&
          code < 100 &&
          !codes.includes(code) &&
          codes.length < 5
        ) {
          codes.push(code);
        }
      }
    }
  } catch {
    // Raw (non-JSON) text: synthetic content with no ranges.
  }
  return JSON.stringify([
    SYNTHETIC_TEXT,
    style,
    codes.map(code => [code, 0, 6]),
  ]);
}

export type FixtureSanitizer = (json: unknown) => unknown;

/**
 * One sanitizer per run so synthetic ids stay consistent across fixtures
 * (the same post id in E4, E5 and E8 maps to the same synthetic id).
 */
/**
 * `corpus`: every body that will be sanitized in this run, so synthetic
 * times keep their relative order across fixtures.
 */
export function createFixtureSanitizer(
  corpus: readonly unknown[] = [],
): FixtureSanitizer {
  const timeRank = new Map(collectTimes(corpus).map((v, i) => [v, i] as const));
  const syntheticTime = (v: number) =>
    SYNTHETIC_TIME_BASE + (timeRank.get(v) ?? 0) * SYNTHETIC_TIME_STEP;
  const stringIds = new Map<string, string>();
  const numberIds = new Map<number, number>();
  const blogs = new Map<string, string>();
  const keys = new Map<string, string>();

  const synthetic = (map: Map<string, string>, prefix: string, v: string) => {
    let out = map.get(v);
    if (!out) {
      out = `synthetic-${prefix}-${map.size + 1}`;
      map.set(v, out);
    }
    return out;
  };
  const syntheticNumber = (v: number) => {
    let out = numberIds.get(v);
    if (out === undefined) {
      out = 1000 + numberIds.size + 1;
      numberIds.set(v, out);
    }
    return out;
  };
  const safeKey = (k: string) =>
    SAFE_KEY.test(k) && !/\d{5,}/.test(k) ? k : synthetic(keys, 'key', k);

  const urlKind = (
    key: string,
    blockType: string | undefined,
    inPlayer: boolean,
  ) => {
    if (/avatar/i.test(key)) {
      return 'avatar';
    }
    if (/preview/i.test(key)) {
      return 'preview';
    }
    if (inPlayer) {
      return 'player';
    }
    if (blockType && URL_KINDS.has(blockType)) {
      return blockType.replace(/_/g, '-');
    }
    return 'url';
  };

  const walk = (
    v: unknown,
    key: string,
    blockType: string | undefined,
    inPlayer: boolean,
  ): unknown => {
    if (v === null || typeof v === 'boolean') {
      return v;
    }
    if (typeof v === 'number') {
      if (ID_KEY.test(key)) {
        return syntheticNumber(v);
      }
      if (PHONE_KEY.test(key) || !Number.isFinite(v)) {
        return 0;
      }
      if (TIME_KEY.test(key)) {
        return syntheticTime(v);
      }
      if (SIZE_KEY.test(key)) {
        return Math.ceil(v / SIZE_STEP) * SIZE_STEP;
      }
      if (DURATION_KEY.test(key)) {
        // duration rounds up and timeCode down, so timeCode <= duration holds.
        return key === 'duration'
          ? Math.ceil(v / 60) * 60
          : Math.floor(v / 60) * 60;
      }
      if (KEEP_NUMBER_KEY.test(key)) {
        return v;
      }
      return v === 0 ? 0 : SYNTHETIC_COUNT;
    }
    if (typeof v === 'string') {
      if (v === '') {
        return '';
      }
      if (key === 'signedQuery') {
        return SIGNED_QUERY_PLACEHOLDER;
      }
      if (PHONE_KEY.test(key)) {
        return PLACEHOLDER;
      }
      if (key === 'content' && (blockType === 'text' || blockType === 'link')) {
        return syntheticContent(v);
      }
      if (URL_VALUE.test(v)) {
        return `https://example.invalid/${urlKind(key, blockType, inPlayer)}`;
      }
      if (ID_KEY.test(key)) {
        return synthetic(stringIds, 'id', v);
      }
      if (BLOG_KEY.test(key)) {
        return synthetic(blogs, 'blog', v);
      }
      if (FIXTURE_ENUM_KEYS.has(key) && ENUM_VALUE.test(v)) {
        return v;
      }
      return PLACEHOLDER;
    }
    if (Array.isArray(v)) {
      return v.map(x => walk(x, key, blockType, inPlayer));
    }
    if (typeof v === 'object') {
      const o = v as Obj;
      const ownType =
        typeof o.type === 'string' && ENUM_VALUE.test(o.type)
          ? o.type
          : undefined;
      const out: Obj = {};
      for (const [k, child] of Object.entries(o)) {
        out[safeKey(k)] = walk(
          child,
          k,
          ownType ?? blockType,
          inPlayer || k === 'playerUrls',
        );
      }
      return out;
    }
    // undefined, functions, symbols, bigint: not JSON; drop to null.
    return null;
  };

  return json => walk(json, '', undefined, false);
}

/** Single-body convenience (fresh id maps). */
export const sanitizeFixture = (json: unknown) =>
  createFixtureSanitizer([json])(json);

// --------------------------------------------------------------- runner ----

export type Capture = {
  /** Fixture case name, e.g. `e8-post-locked`. */
  case: string;
  status: number;
  /** Parsed body, in memory only. Undefined for no or non-JSON body. */
  json: unknown;
};

export type MatrixRow = {
  id:
    | 'session'
    | 'accessible'
    | 'locked'
    | 'live'
    | 'no-token'
    | 'missing'
    | 'events'
    | 'unknown-block';
  summary: string;
};

export type RunReport = {
  requests: number;
  rows: MatrixRow[];
  captures: Capture[];
  stopped?: string;
};

export type SessionCaller = {
  callWithSession(build: () => ApiRequest): Promise<CallResult>;
  getCounts(): { refresh: number; api: number };
};

class BudgetExceeded extends Error {}
class Stop extends Error {}

/**
 * Runs the Story 1.5 matrix once, in order. At most REQUEST_BUDGET requests
 * (refreshes included); every authorized call goes through the coordinator,
 * the two no-token calls go straight to `execute` without `Authorization`.
 */
export async function runContentShapes({
  caller,
  fetchImpl,
  log,
  random = Math.random,
}: {
  caller: SessionCaller;
  fetchImpl: FetchLike;
  log: (line: string) => void;
  random?: () => number;
}): Promise<RunReport> {
  const base = caller.getCounts();
  let direct = 0;
  const sent = () => {
    const c = caller.getCounts();
    return c.api - base.api + (c.refresh - base.refresh) + direct;
  };
  const rows: MatrixRow[] = [];
  const captures: Capture[] = [];
  const row = (id: MatrixRow['id'], summary: string) => {
    rows.push({ id, summary });
    log(`ROW ${id}: ${summary}`);
  };

  const record = (caseName: string, s: SanitizedResponse, json: unknown) => {
    for (const line of formatSanitized(s)) {
      log(line);
    }
    captures.push({ case: caseName, status: s.status, json });
  };

  /** Authorized call; worst case 3 requests (401 → refresh → retry). */
  const call = async (caseName: string, build: () => ApiRequest) => {
    if (sent() + 3 > REQUEST_BUDGET) {
      throw new BudgetExceeded();
    }
    const r = await caller.callWithSession(build);
    if (r.kind !== 'response') {
      log(`${caseName}: ${r.kind}`);
      throw new Stop(`session call failed (${r.kind})`);
    }
    if (r.refreshed) {
      log(`${caseName}: refreshed=${r.refreshed}, retried=${r.retried}`);
    }
    record(caseName, r.sanitized, r.json);
    return { status: r.sanitized.status, json: r.json };
  };

  /** Deliberate no-token call: no `Authorization`, no refresh. */
  const noToken = async (caseName: string, request: ApiRequest) => {
    if (sent() + 1 > REQUEST_BUDGET) {
      throw new BudgetExceeded();
    }
    direct += 1;
    const r = await execute(request, fetchImpl);
    if (r.kind === 'network') {
      log(`${caseName}: network (${r.error})`);
      return { status: 0, shape: 'network' };
    }
    record(caseName, r.sanitized, r.json);
    return {
      status: r.sanitized.status,
      shape: r.sanitized.shape.slice(0, 4).join(' | '),
    };
  };

  try {
    // Session.
    const me = await call('e1-current-user', () => buildCurrentUserRequest(''));
    row('session', `E1 HTTP ${me.status}`);
    if (me.status !== 200) {
      throw new Stop('E1 not 200');
    }

    // Subscriptions and post picking.
    const subs = await call('e2-subscriptions', buildSubscriptionsRequest);
    const blogs = subscriptionBlogUrls(subs.json).slice(0, MAX_BLOGS_SCANNED);
    log(
      `E2: ${subscriptionBlogUrls(subs.json).length} blogs; scanning ${
        blogs.length
      }`,
    );
    let accessible: PostRef | undefined;
    let locked: PostRef | undefined;
    const e4Cases = new Map<string, string>();
    for (let i = 0; i < blogs.length && !(accessible && locked); i += 1) {
      const caseName = `e4-blog-posts-${i + 1}`;
      const page = await call(caseName, () => buildBlogPostsRequest(blogs[i]));
      const posts = postsOf(page.json, 'E4');
      const picked = pickPosts(posts, blogs[i]);
      log(
        `E4 blog #${i + 1}: posts=${posts.length}, accessible=${Boolean(
          picked.accessible,
        )}, locked=${Boolean(picked.locked)}, hasAccess missing=${
          picked.missingHasAccess
        }`,
      );
      if (!accessible && picked.accessible) {
        accessible = picked.accessible;
        e4Cases.set('accessible', caseName);
        log(
          `accessible post from blog #${i + 1}: ok_video in data=${
            accessible.hasVideo
          }`,
        );
      }
      if (!locked && picked.locked) {
        locked = picked.locked;
        e4Cases.set('locked', caseName);
      }
    }
    if (!accessible && !locked) {
      row('accessible', `not found in ${blogs.length} blogs`);
      row('locked', `not found in ${blogs.length} blogs`);
      throw new Stop('no accessible or locked post found');
    }

    // Feed (E5) once; look for both chosen posts.
    const feed = await call('e5-feed', buildFeedRequest);
    const feedPosts = postsOf(feed.json, 'E5');
    log(`E5: posts=${feedPosts.length}`);
    const inFeed = (ref?: PostRef) =>
      ref ? feedPosts.find(p => p.id === ref.postId) : undefined;

    // Blog header (E3) for the first chosen blog.
    const headerBlog = (accessible ?? locked) as PostRef;
    await call('e3-blog', () => buildBlogRequest(headerBlog.blogUrl));

    const postRow = async (kind: 'accessible' | 'locked', ref?: PostRef) => {
      if (!ref) {
        row(kind, `not found in ${blogs.length} blogs`);
        return;
      }
      const e4 = captures.find(c => c.case === e4Cases.get(kind));
      const e4Post = postsOf(e4?.json, 'E4').find(p => p.id === ref.postId);
      const lines: string[] = [];
      if (e4Post) {
        lines.push(...describePost(e4Post).map(l => `E4 ${l}`));
      }
      const feedPost = inFeed(ref);
      lines.push(`E5 first page contains it: ${Boolean(feedPost)}`);
      if (feedPost) {
        lines.push(...describePost(feedPost).map(l => `E5 ${l}`));
      }
      const single = await call(`e8-post-${kind}`, () =>
        buildPostRequest(ref.blogUrl, ref.postId),
      );
      if (single.status === 200) {
        lines.push(...describePost(obj(single.json) ?? {}).map(l => `E8 ${l}`));
      } else {
        lines.push(
          `E8 HTTP ${single.status} (non-200: "locked resource" signal)`,
        );
      }
      lines.forEach(l => log(`${kind}: ${l}`));
      row(
        kind,
        `E4 found=${Boolean(e4Post)}, E5 found=${Boolean(feedPost)}, E8 HTTP ${
          single.status
        }`,
      );
    };
    await postRow('accessible', accessible);
    await postRow('locked', locked);

    // Live stream (E15) for each chosen blog.
    const streamBlogs = [
      ...new Set([accessible?.blogUrl, locked?.blogUrl].filter(Boolean)),
    ] as string[];
    const liveParts: string[] = [];
    for (const [i, blog] of streamBlogs.entries()) {
      const caseName = `e15-video-stream-${i + 1}`;
      const s = await call(caseName, () => buildVideoStreamRequest(blog));
      if (s.status === 200) {
        const o = obj(s.json) ?? {};
        liveParts.push(
          `blog #${i + 1}: 200 hasAccess=${
            typeof o.hasAccess === 'boolean' ? o.hasAccess : typeof o.hasAccess
          }, isOnline=${
            typeof o.isOnline === 'boolean' ? o.isOnline : typeof o.isOnline
          }, data [${blockTypeSummary(
            (arr(o.data) ?? []).map(obj).filter(Boolean) as Obj[],
          )}]`,
        );
      } else {
        liveParts.push(`blog #${i + 1}: HTTP ${s.status}`);
      }
    }
    row('live', liveParts.join('; ') || 'no blog');

    // No token.
    const e1n = await noToken('e1-no-token', buildNoTokenCurrentUserRequest());
    const target = (accessible ?? locked) as PostRef;
    const e8n = await noToken(
      'e8-no-token',
      buildPostRequest(target.blogUrl, target.postId, 'E8-noauth'),
    );
    row(
      'no-token',
      `E1 HTTP ${e1n.status} [${e1n.shape}]; E8 (${
        accessible ? 'accessible' : 'locked'
      } post) HTTP ${e8n.status} [${e8n.shape}]`,
    );

    // Missing resources.
    const missingPost = await call('e8-missing-post', () =>
      buildPostRequest(target.blogUrl, randomUuidV4(random), 'E8-missing'),
    );
    const missingBlog = await call('e3-missing-blog', () =>
      buildBlogRequest(randomBlogSlug(random), 'E3-missing'),
    );
    row(
      'missing',
      `E8 random post id HTTP ${missingPost.status}; E3 random slug HTTP ${missingBlog.status}`,
    );

    // Events.
    const events = await call('e18-events', () => buildEventsRequest());
    let eventsSummary = `E18 HTTP ${events.status}`;
    if (events.status === 200) {
      const d = describeEvents(events.json);
      d.lines.forEach(l => log(`E18 ${l}`));
      eventsSummary += `; EVT-01 shape ${
        d.verified ? 'verified' : 'NOT verified'
      }`;
      if (d.cursor !== undefined) {
        const page2 = await call('e18-events-page2', () =>
          buildEventsRequest(d.cursor),
        );
        eventsSummary += `; page 2 via extra.offset (inferred) HTTP ${page2.status}`;
        if (page2.status === 200) {
          describeEvents(page2.json).lines.forEach(l => log(`E18 p2 ${l}`));
        }
      } else {
        eventsSummary += '; no cursor offered (no page 2 request)';
      }
    } else {
      eventsSummary += ' (non-200; EVT-01 NOT verified)';
    }
    row('events', eventsSummary);
  } catch (error) {
    const reason =
      error instanceof BudgetExceeded
        ? `request budget (${REQUEST_BUDGET}) reached`
        : error instanceof Stop
        ? error.message
        : `unexpected ${error instanceof Error ? error.name : '?'}`;
    log(`STOP: ${reason}`);
    const unknown = new Set(captures.flatMap(c => unknownBlockTypes(c.json)));
    row('unknown-block', `[${[...unknown].join(', ')}]`);
    return { requests: sent(), rows, captures, stopped: reason };
  }

  const unknown = new Set(captures.flatMap(c => unknownBlockTypes(c.json)));
  row(
    'unknown-block',
    unknown.size
      ? `[${[...unknown].join(', ')}] kept as-is in fixtures`
      : 'none seen',
  );
  return { requests: sent(), rows, captures };
}

// ------------------------------------------------------------- fixtures ----

/** Cases written as fixtures (E1 with a token is profile data: not written). */
const FIXTURE_CASE = /^(e2|e3|e4|e5|e8|e15|e18|e1-no-token)/;

/** Sanitized fixture files for the captured responses. */
export function buildFixtures(
  captures: readonly Capture[],
): Array<{ name: string; text: string }> {
  const written = captures.filter(c => FIXTURE_CASE.test(c.case));
  const sanitize = createFixtureSanitizer(written.map(c => c.json));
  return written.map(c => ({
    name: `${c.case}.json`,
    text:
      JSON.stringify(
        {
          case: c.case,
          status: c.status,
          body: c.json === undefined ? null : sanitize(c.json),
        },
        null,
        2,
      ) + '\n',
  }));
}
