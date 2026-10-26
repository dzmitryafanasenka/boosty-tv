import {
  createAuthApiClient,
  createHttpClient,
  createSessionManager,
  type SessionManager,
} from '../../shared/api';
import { createFixtureTransport } from '../../shared/api/fixtureTransport';
import type { ReadResult, SecureStore } from '../../shared/platform/secureStore';

/**
 * Debug builds only (Story 2.5 demo mode; required under `__DEV__ &&
 * DEMO_MODE`, so release bundles never contain it). A SessionManager over
 * `FixtureTransport` and in-memory stores: a synthetic session, E1 answers
 * 200 with a synthetic id, send-code answers a synthetic challenge and
 * confirm synthetic tokens (so a demo sign-in on A5 lands; the id differs
 * from the stored `demo`, so it runs the account-switch hook, Story 2.8),
 * E5 (the feed, Story 3.1) synthetic posts, every other request a 404. The
 * keychain is never touched, so the owner's stored session survives a demo
 * run.
 *
 * The app cannot import `src/test`, so the feed posts are generated here, in
 * the E5 shape (no URLs: previews show the placeholder, nothing is fetched
 * from a CDN).
 */

/** Demo feed: 3 pages. */
export const DEMO_FEED_POSTS = 30;
const FEED_PAGE = 10;
const DEMO_BLOGS = ['demo-blog-1', 'demo-blog-2', 'demo-blog-3'];
/** Fixed base so the demo dates are stable: 2026-10-01 00:00 UTC. */
const DEMO_FEED_START = 1_790_812_800;

/** One synthetic E5 post (shape of `src/test/fixtures/boosty/e5-feed.json`). */
function demoPost(n: number) {
  const blogUrl = DEMO_BLOGS[n % DEMO_BLOGS.length];
  const createdAt = DEMO_FEED_START - n * 3600;
  const locked = n % 7 === 6;
  const videos = n % 5 === 4 ? 2 : n % 3 === 2 ? 0 : 1;
  const data = locked
    ? []
    : [
        ...Array.from({ length: videos }, (_, v) => ({
          type: 'ok_video',
          id: `demo-video-${n}-${v}`,
          title: `Видео ${v + 1}`,
          duration: 600 + ((n * 137) % 3000),
        })),
        { type: 'text', content: '["Демо-текст поста","unstyled",[]]', modificator: '' },
        { type: 'text', content: '', modificator: 'BLOCK_END' },
      ];
  return {
    id: `demo-post-${n}`,
    int_id: 100000 + n,
    title: `Демо-пост ${n + 1}`,
    createdAt,
    publishTime: createdAt,
    hasAccess: !locked,
    user: { name: `Демо-автор ${(n % DEMO_BLOGS.length) + 1}`, blogUrl },
    data,
    teaser: [],
  };
}

/** The E5 page after `offset` (the demo cursor is the next post number). */
function demoFeedPage(url: string, total: number) {
  const match = /[?&]offset=([^&]*)/.exec(url);
  const start = match ? Number(decodeURIComponent(match[1])) || 0 : 0;
  const end = Math.min(start + FEED_PAGE, total);
  const posts = Array.from({ length: Math.max(0, end - start) }, (_, i) => demoPost(start + i));
  return {
    data: { posts, blogs: [], counters: {} },
    extra: { offset: String(end), isLast: end >= total },
  };
}

const DEMO_SESSION = JSON.stringify({
  v: 1,
  accessToken: 'demo-access-token',
  refreshToken: 'demo-refresh-token',
  // Far ahead: the demo never refreshes.
  expiresAt: Date.now() + 365 * 24 * 3600 * 1000,
  accountId: 'demo',
});

function memoryStore(initial: string | null): SecureStore {
  let value = initial;
  return {
    read: async (): Promise<ReadResult> =>
      value === null ? { kind: 'empty' } : { kind: 'value', value },
    write: async next => {
      value = next;
    },
    clear: async () => {
      value = null;
    },
  };
}

export function createDemoSessionManager(): SessionManager {
  const transport = createFixtureTransport(request => {
    switch (request.path) {
      case '/v1/feed/post/':
        return { status: 200, body: demoFeedPage(request.url, DEMO_FEED_POSTS), delayMs: 300 };
      case '/v1/user/current':
        return { status: 200, body: { id: 1001 }, delayMs: 300 };
      case '/auth/phone/verification_code/send':
        return {
          status: 200,
          body: {
            data: {
              phoneCode: { code: 'demo-challenge', sentTransport: 'gate', expiresIn: 604800 },
            },
          },
        };
      case '/auth/phone/verification_code/confirm':
        return {
          status: 200,
          body: {
            access_token: 'demo-access-token-2',
            refresh_token: 'demo-refresh-token-2',
            expires_in: 2592000,
          },
        };
      default:
        return { status: 404, body: { error: 'not_found' } };
    }
  });
  return createSessionManager({
    authApi: createAuthApiClient({ transport, getDeviceId: async () => 'demo-device' }),
    createHttp: tokens => createHttpClient({ transport, tokens }),
    sessionStore: memoryStore(DEMO_SESSION),
    phoneStore: memoryStore(null),
  });
}
