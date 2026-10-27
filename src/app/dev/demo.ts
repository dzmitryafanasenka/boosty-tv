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
 * E5 (the feed, Story 3.1) synthetic posts, E2 (Подписки, Story 3.2)
 * synthetic authors, E3/E4 (Автор, Story 3.3: `demo-blog-1` 2 pages,
 * `demo-blog-3` no posts, the last demo blog missing), every other request
 * a 404. The
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

/** One synthetic E5/E4 post (shape of `src/test/fixtures/boosty/e5-feed.json`). */
function demoPost(n: number, blog?: { blogUrl: string; index: number }) {
  const blogUrl = blog?.blogUrl ?? DEMO_BLOGS[n % DEMO_BLOGS.length];
  const authorIndex = blog?.index ?? n % DEMO_BLOGS.length;
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
    user: { name: `Демо-автор ${authorIndex + 1}`, blogUrl },
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

/** Demo subscriptions: the feed's authors first, then a few more (no avatars). */
export const DEMO_SUBSCRIPTIONS = 8;

/** The E2 body (shape of `src/test/fixtures/boosty/e2-subscriptions.json`). */
function demoSubscriptions() {
  return {
    offset: 0,
    limit: 30,
    total: DEMO_SUBSCRIPTIONS,
    data: Array.from({ length: DEMO_SUBSCRIPTIONS }, (_, i) => ({
      id: 2000 + i,
      blog: {
        title:
          i < DEMO_BLOGS.length
            ? `Демо-блог ${i + 1}`
            : `Демо-блог ${i + 1} с длинным названием для двух строк`,
        blogUrl: i < DEMO_BLOGS.length ? DEMO_BLOGS[i] : `demo-blog-${i + 1}`,
        owner: { name: `Демо-автор ${i + 1}`, hasAvatar: false },
      },
    })),
  };
}

/** Demo blog `blogUrl` → its post count (E4); absent: 5. */
const DEMO_BLOG_POSTS: Record<string, number> = {
  'demo-blog-1': 30,
  'demo-blog-2': 7,
  'demo-blog-3': 0,
};
const BLOG_PAGE = 20;
/** The demo blog whose E3 answers 404 `blog_not_found` («Автор недоступен»). */
const DEMO_MISSING_BLOG = `demo-blog-${DEMO_SUBSCRIPTIONS}`;

function demoBlogIndex(blogUrl: string): number {
  return Number(blogUrl.slice('demo-blog-'.length)) - 1;
}

/** E3 (shape of `src/test/fixtures/boosty/e3-blog.json`, only the read fields). */
function demoBlog(blogUrl: string) {
  const index = demoBlogIndex(blogUrl);
  return {
    blogUrl,
    title: `Демо-блог ${index + 1}`,
    owner: { name: `Демо-автор ${index + 1}`, hasAvatar: false },
  };
}

/** The E4 page after `offset` (the demo cursor is the next post number). */
function demoBlogPage(url: string, blogUrl: string) {
  const total = DEMO_BLOG_POSTS[blogUrl] ?? 5;
  const match = /[?&]offset=([^&]*)/.exec(url);
  const start = match ? Number(decodeURIComponent(match[1])) || 0 : 0;
  const end = Math.min(start + BLOG_PAGE, total);
  const index = demoBlogIndex(blogUrl);
  const data = Array.from({ length: Math.max(0, end - start) }, (_, i) =>
    demoPost(start + i, { blogUrl, index }),
  ).map(post => ({ ...post, id: `${blogUrl}-post-${post.int_id}` }));
  return { data, extra: { offset: String(end), isLast: end >= total } };
}

const DEMO_BLOG_PATH = /^\/v1\/blog\/(demo-blog-\d+)(\/post\/)?$/;

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
    const blog = DEMO_BLOG_PATH.exec(request.path);
    if (blog) {
      const [, blogUrl, posts] = blog;
      if (blogUrl === DEMO_MISSING_BLOG) {
        return { status: 404, body: { error: 'blog_not_found' }, delayMs: 300 };
      }
      return posts
        ? { status: 200, body: demoBlogPage(request.url, blogUrl), delayMs: 300 }
        : { status: 200, body: demoBlog(blogUrl), delayMs: 300 };
    }
    switch (request.path) {
      case '/v1/feed/post/':
        return { status: 200, body: demoFeedPage(request.url, DEMO_FEED_POSTS), delayMs: 300 };
      case '/v1/user/subscriptions':
        return { status: 200, body: demoSubscriptions(), delayMs: 300 };
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
