import {
  createAuthApiClient,
  createHttpClient,
  createSessionManager,
  type SessionManager,
} from '../../shared/api';
import { createFixtureTransport } from '../../shared/api/fixtureTransport';
import type { KeyValueStore } from '../../shared/platform/keyValueStore';
import type { ReadResult, SecureStore } from '../../shared/platform/secureStore';

/**
 * Debug builds only (Story 2.5 demo mode; required under `__DEV__ &&
 * DEMO_MODE`, so release bundles never contain it). A SessionManager over
 * `FixtureTransport` and in-memory stores: a synthetic session, E1 answers
 * 200 with a synthetic id, send-code answers a synthetic challenge and
 * confirm synthetic tokens (so a demo sign-in on A5 lands; the id differs
 * from the stored `demo`, so it runs the account-switch hook, Story 2.8),
 * E5 (the feed, Story 3.1) synthetic posts, E2 (Подписки, Story 3.2)
 * synthetic authors, E1 the account's own blog `demo-blog-2` (Story 5.2),
 * E3/E4 (Автор, Story 3.3: `demo-blog-1` 2 pages,
 * `demo-blog-3` no posts, the last demo blog missing), E8 (Пост, Story 3.4:
 * every demo post with several paragraphs and a like count, every fourth
 * one also with image, file, audio, poll and unknown blocks and an inline link;
 * `demo-post-9` answers 404 `not_found`; locked posts (every seventh) have a
 * teaser image without a URL, and `demo-post-6`/`-20` a level name while
 * `demo-post-13`/`-27` have none, Story 3.6), E9 progress writes 200 (Story
 * 4.2; demo videos have no `playerUrls`, so the player itself cannot play
 * them), every other request a 404. The
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
          // Story 3.5: the second video of a two-video post has no title
          // (its MediaRow reads «Видео 2» only).
          title: v === 0 ? `Демо-ролик ${n + 1}` : '',
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
    // Story 3.6: every other locked post names its level (only `name`; no
    // price fields in the demo), the rest show the copy without a level.
    ...(locked && n % 14 === 6 ? { subscriptionLevel: { name: 'Демо-уровень' } } : {}),
  };
}

/**
 * The E5 page after `offset` (the demo cursor is the next index in the
 * filtered list). Story 5.3: the access params are honoured, so every
 * filter state can be shown: `only_allowed=true` or no access params (the
 * live server default behaved like «Доступные мне», api-contract §3 E5) →
 * the accessible posts only, `only_bought=true` → nothing (the demo account
 * bought nothing), both `false` → every post. Story 5.4: `from_ts` and
 * `to_ts` (epoch seconds, both inclusive) keep the posts published inside
 * them (the demo posts are from 30 Sep – 1 Oct 2026, UTC).
 */
function demoFeedPage(url: string, total: number) {
  const match = /[?&]offset=([^&]*)/.exec(url);
  const start = match ? Number(decodeURIComponent(match[1])) || 0 : 0;
  const onlyAllowed = !/[?&]only_allowed=false(&|$)/.test(url);
  const onlyBought = /[?&]only_bought=true(&|$)/.test(url);
  const fromTs = numberParam(url, 'from_ts') ?? -Infinity;
  const toTs = numberParam(url, 'to_ts') ?? Infinity;
  const all = onlyBought
    ? []
    : Array.from({ length: total }, (_, n) => demoPost(n)).filter(
        post =>
          (!onlyAllowed || post.hasAccess) &&
          post.publishTime >= fromTs &&
          post.publishTime <= toTs,
      );
  const end = Math.min(start + FEED_PAGE, all.length);
  const posts = all.slice(start, end);
  return {
    data: { posts, blogs: [], counters: {} },
    extra: { offset: String(end), isLast: end >= all.length },
  };
}

/** A numeric query param of `url`; null when absent or not a number. */
function numberParam(url: string, name: string): number | null {
  const match = new RegExp(`[?&]${name}=([^&]*)`).exec(url);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
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
/** The demo account's own blog (E1 `blogUrl`, Story 5.2 «Мой блог»). */
const DEMO_MY_BLOG = 'demo-blog-2';
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
const DEMO_POST_PATH = /^\/v1\/blog\/(demo-blog-\d+)\/post\/([^/]+)$/;
/** E9: `PUT /v1/viewstat/video/{mediaId}/timecode/` (Story 4.2). */
const DEMO_TIMECODE_PATH = /^\/v1\/viewstat\/video\/[^/]+\/timecode\/$/;
/** The demo post whose E8 answers 404 `not_found` («Пост недоступен»). */
const DEMO_MISSING_POST = 'demo-post-9';

const DEMO_PARAGRAPHS = [
  'Это демо-пост: в нём нет настоящих данных Boosty. Абзацы ниже нужны, чтобы проверить чтение текста пультом.',
  'Каждый абзац — отдельная остановка фокуса. Кнопки вверх и вниз переходят между абзацами, а колонка прокручивается к выбранному.',
  'Кнопка влево возвращает к автору поста. Кнопка «Назад» возвращает к карточке, с которой открыт пост.',
  'Последний абзац демо-текста. Под ним в некоторых постах есть заглушки блоков, которые появятся в следующих версиях.',
];

const textBlock = (text: string) => [
  { type: 'text', content: JSON.stringify([text, 'unstyled', []]), modificator: '' },
  { type: 'text', content: '', modificator: 'BLOCK_END' },
];

/** E8 for a demo post (shape of `src/test/fixtures/boosty/e8-post-accessible.json`, no URLs). */
function demoPostDetail(blogUrl: string, postId: string) {
  let base: ReturnType<typeof demoPost> | null = null;
  const feed = /^demo-post-(\d+)$/.exec(postId);
  const blog = new RegExp(`^${blogUrl}-post-(\\d+)$`).exec(postId);
  if (feed) {
    base = demoPost(Number(feed[1]));
  } else if (blog) {
    const n = Number(blog[1]) - 100000;
    base = { ...demoPost(n, { blogUrl, index: demoBlogIndex(blogUrl) }), id: postId };
  }
  if (base === null || base.user.blogUrl !== blogUrl) {
    return null;
  }
  const n = base.int_id - 100000;
  const videos = base.data.filter(block => block.type === 'ok_video');
  const mixed =
    n % 4 === 1
      ? [
          { type: 'image', id: `demo-image-${n}`, width: 1280, height: 720 },
          { type: 'text', content: '["Абзац со ","unstyled",[]]', modificator: '' },
          { type: 'link', content: '["ссылкой","unstyled",[]]' },
          ...textBlock(' между заглушками.'),
          { type: 'file', id: `demo-file-${n}`, title: 'Файл' },
          { type: 'audio_file', id: `demo-audio-${n}`, title: 'Аудио' },
          { type: 'poll', id: 1000 + n },
          { type: 'demo_unknown_block' },
        ]
      : [];
  return {
    ...base,
    data: base.hasAccess ? [...videos, ...DEMO_PARAGRAPHS.flatMap(textBlock), ...mixed] : [],
    teaser: base.hasAccess ? [] : [{ type: 'image', id: `demo-teaser-${n}`, width: 1280, height: 720 }],
    count: { likes: (n * 7) % 40, comments: 0 },
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

/**
 * The demo's progress storage (Story 4.2): in memory only, so the demo never
 * touches the owner's real local progress (as it never touches the keychain).
 */
export function createDemoKeyValueStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    get: async key => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async key => {
      values.delete(key);
    },
    clear: async () => {
      values.clear();
    },
  };
}

export function createDemoSessionManager(): SessionManager {
  const transport = createFixtureTransport(request => {
    // E9 (Story 4.2): progress writes answer 200 with no body, as live.
    if (request.method === 'PUT' && DEMO_TIMECODE_PATH.test(request.path)) {
      return { status: 200, delayMs: 300 };
    }
    const single = DEMO_POST_PATH.exec(request.path);
    if (single) {
      const [, blogUrl, postId] = single;
      const detail =
        postId === DEMO_MISSING_POST ? null : demoPostDetail(blogUrl, decodeURIComponent(postId));
      return detail
        ? { status: 200, body: detail, delayMs: 300 }
        : { status: 404, body: { error: 'not_found' }, delayMs: 300 };
    }
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
        // Story 5.2: the demo account owns `demo-blog-2` (7 posts, also a
        // subscription), so Подписки shows «Мой блог» first, once.
        return { status: 200, body: { id: 1001, blogUrl: DEMO_MY_BLOG }, delayMs: 300 };
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
