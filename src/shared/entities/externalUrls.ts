import { blogUrlSchema } from '../api/dto/subscriptions';

/**
 * External URLs (Story 6.3, epic-6-context «External URLs»): the one place
 * that builds a QR target. Nothing here opens a URL on the TV: every target
 * is shown only as a QR code (owner decision 2026-10-25, feature-parity §12).
 * Pure and total: no input throws.
 *
 * A file target carries `Post.signedQuery` (the account's user id and a
 * 24 h signature): the caller keeps it in memory for the QR only, never in
 * the Post entity, a query cache, storage, a log or a fixture.
 */

/**
 * The URL when it is an absolute `http:`/`https:` URL with a host, else null
 * (empty, relative, `javascript:`, `data:`, `intent:`, …). Surrounding
 * whitespace is trimmed; whitespace or a control character inside rejects it.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const url = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (url.length === 0 || /[\s\u0000-\u001f\u007f]/.test(url)) {
    return null;
  }
  // A non-empty host (`https://:80/x` has none), an optional port.
  return /^https?:\/\/[^/?#@\s:]+(?::\d*)?(?:[/?#]|$)/i.test(url) ? url : null;
}

/** The host of a safe URL, lower case, without port and user info. */
function hostOf(url: string): string {
  const authority = /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? '';
  return authority.replace(/^.*@/, '').replace(/:\d*$/, '').toLowerCase();
}

/** The path of a safe URL (no query or fragment). */
function pathOf(url: string): string {
  return /^https?:\/\/[^/?#]+([^?#]*)/i.exec(url)?.[1] ?? '';
}

/** The query of a safe URL, without `?` (no fragment). */
function queryOf(url: string): string {
  return /\?([^#]*)/.exec(url)?.[1] ?? '';
}

/** A YouTube video id: 11 characters of `[A-Za-z0-9_-]`. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/**
 * The YouTube video id of a `youtube.com/watch?v=<id>`, `youtu.be/<id>`,
 * `youtube.com/embed/<id>`, `youtube.com/shorts/<id>` or `youtube.com/live/<id>` URL; null for any
 * other URL or a malformed id.
 */
export function youtubeId(raw: string | null | undefined): string | null {
  const url = safeHttpUrl(raw);
  if (url === null) {
    return null;
  }
  const host = hostOf(url);
  const segments = pathOf(url).split('/').filter(s => s.length > 0);
  let id: string | undefined;
  if (host === 'youtu.be') {
    id = segments[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments.length === 1 && segments[0] === 'watch') {
      const v = queryOf(url)
        .split('&')
        .find(pair => pair.startsWith('v='));
      id = v?.slice(2);
    } else if (segments[0] === 'embed' || segments[0] === 'shorts' || segments[0] === 'live') {
      id = segments[1];
    }
  }
  return id !== undefined && YOUTUBE_ID.test(id) ? id : null;
}

/** The YouTube thumbnail of a video id: a plain image URL, loaded with no headers. */
export function youtubeThumbnail(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

/**
 * A file's QR target (api-contract §4.1, «File and video blocks (LIVE)»):
 * the block `url` plus `Post.signedQuery`. A leading `?`/`&` of the query is
 * dropped and the two are joined with `?` (the URL has no query) or `&`.
 * A fragment of the URL is dropped. Null when the URL is not a safe http(s) URL. An empty query gives the URL
 * as is; the file host answers 403 to it (live), so a caller must not show a
 * QR for a file without a query (`PostRepository.fileTarget` returns
 * `unavailable` then).
 */
export function fileTarget(url: string | null | undefined, signedQuery: string | null | undefined): string | null {
  const safe = safeHttpUrl(url);
  if (safe === null) {
    return null;
  }
  // A fragment would swallow the query after it.
  const base = safe.split('#')[0];
  const query = (signedQuery ?? '').trim().replace(/^[?&]+/, '');
  if (query.length === 0) {
    return base;
  }
  if (!base.includes('?')) {
    return `${base}?${query}`;
  }
  return /[?&]$/.test(base) ? `${base}${query}` : `${base}&${query}`;
}

/** A Boosty post a link points to (Story 6.3, owner decision 2026-10-29). */
export type BoostyPostRef = { blogUrl: string; postId: string };

const BOOSTY_HOSTS: ReadonlySet<string> = new Set(['boosty.to', 'www.boosty.to']);

/**
 * The post of a `https://(www.)boosty.to/<blogUrl>/posts/<postId>` link
 * (query and fragment ignored; a trailing slash allowed), else null: a blog
 * page, any other Boosty URL, another host, `http:`, a `blogUrl` that fails
 * `blogUrlSchema` or a `postId` that is not a plain segment. The owner
 * decided such a link opens the post in the app instead of a QR (our
 * improvement over the reference).
 */
export function boostyPostRef(raw: string | null | undefined): BoostyPostRef | null {
  const url = safeHttpUrl(raw);
  if (url === null || !/^https:/i.test(url) || !BOOSTY_HOSTS.has(hostOf(url))) {
    return null;
  }
  if (/^https:\/\/[^/?#]*:/i.test(url)) {
    // An explicit port is not a Boosty post page.
    return null;
  }
  const path = pathOf(url).replace(/\/$/, '');
  const match = /^\/([^/]+)\/posts\/([^/]+)$/.exec(path);
  if (!match) {
    return null;
  }
  let blogUrl: string;
  let postId: string;
  try {
    blogUrl = decodeURIComponent(match[1]);
    postId = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (blogUrl !== blogUrl.trim() || !blogUrlSchema.safeParse(blogUrl).success) {
    return null;
  }
  if (postId.length === 0 || /^\.{1,2}$/.test(postId) || /[\s/?#%\\]/.test(postId)) {
    return null;
  }
  return { blogUrl, postId };
}

/** A timestamp link's target in the current post (Story 6.3, owner decision 2026-10-29, option b). */
export type TimestampRef = { mediaId: string; seconds: number };

/**
 * A timestamp link to a video of the current post (api-contract §4.1
 * «Timestamp links (LIVE)»): `https://(www.)boosty.to/<blogUrl>/posts/<postId>?t=<seconds>&tmid=<ok_video id>`
 * where the post is `post` (the blog compared case-insensitively) and
 * `tmid` is one of `post.mediaIds`. `t` must be whole seconds (digits only,
 * the only live format). Anything else (another post, another or no video,
 * no or another time format) is null: the link keeps its normal chip.
 */
export function timestampRef(
  raw: string | null | undefined,
  post: { blogUrl: string; postId: string; mediaIds: readonly string[] },
): TimestampRef | null {
  const ref = boostyPostRef(raw);
  if (ref === null || ref.blogUrl.toLowerCase() !== post.blogUrl.toLowerCase() || ref.postId !== post.postId) {
    return null;
  }
  const params = new Map<string, string>();
  for (const pair of queryOf(safeHttpUrl(raw) ?? '').split('&')) {
    const at = pair.indexOf('=');
    if (at > 0) {
      let value: string;
      try {
        value = decodeURIComponent(pair.slice(at + 1));
      } catch {
        return null;
      }
      params.set(pair.slice(0, at), value);
    }
  }
  const t = params.get('t');
  const mediaId = params.get('tmid');
  if (t === undefined || !/^\d{1,6}$/.test(t) || mediaId === undefined || !post.mediaIds.includes(mediaId)) {
    return null;
  }
  return { mediaId, seconds: Number(t) };
}
