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
 * E5 (the feed, Story 3.1) synthetic posts, E6 (Поиск, Story 5.6: a title
 * substring match over the feed posts with the same Filter params), E13 (feed tags, Story 5.5: two
 * pages of 8), E2 (Подписки, Story 3.2)
 * synthetic authors, E1 the account's own blog `demo-blog-2` (Story 5.2),
 * E3/E4 (Автор, Story 3.3: `demo-blog-1` 2 pages,
 * `demo-blog-3` no posts, the last demo blog missing; Story 5.7: the E4
 * Filter params, E7 blog search and E14 blog tags), E8 (Пост, Story 3.4:
 * every demo post with several paragraphs and a like count, every fourth
 * one also with image, audio, poll and unknown blocks, an inline link (a
 * LinkChip), a heading, a file and an external video (Story 6.3: QR chips;
 * their URLs are `example.invalid` placeholders, only drawn as a QR, and the
 * demo `signedQuery` is a fake; Story 6.4: an AudioBlock whose source is an
 * `example.invalid` URL, so playback ends in its error state);
 * `demo-post-9` answers 404 `not_found`; locked posts (every seventh) have a
 * teaser image without a URL, and `demo-post-6`/`-20` a level name while
 * `demo-post-13`/`-27` have none, Story 3.6), E9 progress writes 200 (Story
 * 4.2; demo videos have no `playerUrls`, so the player itself cannot play
 * them), E10–E12 (Story 6.6: the open demo polls take a vote, a change and
 * a retract, kept in memory for the app run), every other request a 404. The
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

/** Demo feed tags (E13, Story 5.5): 16 tags in two pages of 8. */
export const DEMO_TAGS = 16;
const DEMO_TAGS_PAGE = 8;
const demoTag = (id: number) => ({ id, title: `Демо-тег ${id}` });

/**
 * A demo post's tags: one of tags 1–4 and one of tags 5–7, so filtering by
 * two tags of one group finds nothing and tags 8–16 match no post.
 */
function demoPostTags(n: number) {
  return [demoTag((n % 4) + 1), demoTag((n % 3) + 5)];
}

/** The E13 page after `offset` (the demo cursor is the next tag index). */
function demoFeedTagsPage(url: string) {
  const match = /[?&]offset=([^&]*)/.exec(url);
  const start = match ? Number(decodeURIComponent(match[1])) || 0 : 0;
  const end = Math.min(start + DEMO_TAGS_PAGE, DEMO_TAGS);
  const searchTags = Array.from({ length: Math.max(0, end - start) }, (_, i) => ({
    tag: demoTag(start + i + 1),
    rank: 0,
  }));
  return { data: { searchTags }, extra: { offset: String(end), isLast: end >= DEMO_TAGS } };
}

/**
 * Story 6.5: a top-level `poll` (the live shape, api-contract §4.2) on
 * every odd post (every second one): an open one with the user's choice on
 * its second option (n % 4 = 1) or a finished one with no voters (n % 4 =
 * 3); none otherwise (a locked post never gets one).
 */
function demoPoll(n: number) {
  if (n % 4 === 1) {
    return demoOpenPoll(n);
  }
  if (n % 4 === 3) {
    return {
      id: 2000 + n,
      title: ['Тема следующего выпуска'],
      isMultiple: false,
      isFinished: true,
      counter: 0,
      defaultLang: 'ru',
      hasOther: false,
      options: [
        { id: 1, text: 'История', counter: 0, fraction: 0, voters: {} },
        { id: 2, text: 'Наука', counter: 0, fraction: 0, voters: {} },
      ],
    };
  }
  return undefined;
}

/** The open demo poll's id base: poll `2000 + n` belongs to demo post `n`. */
const DEMO_POLL_BASE = 2000;
/** The open demo poll's options: `[id, text, votes from others]`. */
const DEMO_OPEN_OPTIONS = [
  [1, 'Длинные разборы', 64],
  [2, 'Короткие выпуски', 47],
  [3, 'Прямые эфиры', 16],
] as const;
/**
 * Story 6.6: the demo user's choice per open poll (absent: the initial
 * choice, option 2), changed by the demo E11/E12. In memory only.
 */
const demoPollAnswers = new Map<number, number | null>();

/**
 * An open single-choice demo poll (n % 4 = 1): the others' votes plus the
 * demo user's current choice (initially option 2), with integer fractions
 * as live.
 */
function demoOpenPoll(n: number) {
  const id = DEMO_POLL_BASE + n;
  const answer = demoPollAnswers.has(id) ? (demoPollAnswers.get(id) ?? null) : 2;
  const counts = DEMO_OPEN_OPTIONS.map(([optionId, , others]) => others + (optionId === answer ? 1 : 0));
  const counter = counts.reduce((sum, c) => sum + c, 0);
  return {
    id,
    title: ['Какой формат выпусков удобнее?'],
    isMultiple: false,
    isFinished: false,
    counter,
    ...(answer === null ? {} : { answer: [answer] }),
    defaultLang: 'ru',
    hasOther: false,
    options: DEMO_OPEN_OPTIONS.map(([optionId, text], i) => ({
      id: optionId,
      text,
      counter: counts[i],
      fraction: counter === 0 ? 0 : Math.round((counts[i] / counter) * 100),
      voters: {},
    })),
  };
}

/**
 * Story 6.6: the demo E10/E11/E12 for an open demo poll (`2000 + n`, n % 4
 * = 1); null for any other poll id (404). E11 takes `answer` = one known
 * option id (else 400), E12 clears the choice.
 */
function demoPollReply(
  method: string,
  pollId: string,
  form: Record<string, string>,
): { status: number; body?: unknown } | null {
  const id = Number(pollId);
  const n = id - DEMO_POLL_BASE;
  if (!Number.isInteger(n) || n < 0 || n % 4 !== 1) {
    return null;
  }
  if (method === 'GET') {
    return { status: 200, body: { data: { poll: demoOpenPoll(n) } } };
  }
  if (method === 'DELETE') {
    demoPollAnswers.set(id, null);
    return { status: 200, body: {} };
  }
  const answer = Number(form.answer);
  if (method !== 'POST' || !DEMO_OPEN_OPTIONS.some(([optionId]) => optionId === answer)) {
    return { status: 400, body: { error: 'bad_request' } };
  }
  demoPollAnswers.set(id, answer);
  return { status: 200, body: {} };
}

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
    ...(locked ? {} : { poll: demoPoll(n) }),
    tags: demoPostTags(n),
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
 * them (the demo posts are from 30 Sep – 1 Oct 2026, UTC). Story 5.5:
 * `tags_ids` keeps the posts that carry every listed tag (the live server
 * intersects them, api-contract §3 «E5 tags»).
 */
function demoFeedPage(url: string, total: number) {
  const page = demoPage(url, demoFilteredPosts(url, total));
  return {
    data: { posts: page.posts, blogs: [], counters: {} },
    extra: { offset: page.offset, isLast: page.isLast },
  };
}

/** The demo posts that pass the E5 Filter params of `url` (shared by E5 and E6). */
function demoFilteredPosts(url: string, total: number) {
  const onlyAllowed = !/[?&]only_allowed=false(&|$)/.test(url);
  const onlyBought = /[?&]only_bought=true(&|$)/.test(url);
  const fromTs = numberParam(url, 'from_ts') ?? -Infinity;
  const toTs = numberParam(url, 'to_ts') ?? Infinity;
  const tagsMatch = /[?&]tags_ids=([^&]*)/.exec(url);
  const tagIds = tagsMatch
    ? decodeURIComponent(tagsMatch[1]).split(',').filter(id => id !== '')
    : [];
  return onlyBought
    ? []
    : Array.from({ length: total }, (_, n) => demoPost(n)).filter(
        post =>
          (!onlyAllowed || post.hasAccess) &&
          post.publishTime >= fromTs &&
          post.publishTime <= toTs &&
          tagIds.every(id => post.tags.some(tag => String(tag.id) === id)),
      );
}

/** The page of `all` after the demo cursor `offset` (the next index). */
function demoPage<T>(url: string, all: readonly T[]) {
  const match = /[?&]offset=([^&]*)/.exec(url);
  const start = match ? Number(decodeURIComponent(match[1])) || 0 : 0;
  const end = Math.min(start + FEED_PAGE, all.length);
  return { posts: all.slice(start, end), offset: String(end), isLast: end >= all.length };
}

/**
 * E6 «Поиск по подпискам» (Story 5.6): the E5 Filter params as above, plus
 * `search_query` as a case-insensitive title substring match (the demo has
 * no server search; «Демо» matches every post, «пост 1» posts 1, 10–19).
 */
function demoFeedSearchPage(url: string, total: number) {
  const match = /[?&]search_query=([^&]*)/.exec(url);
  const query = match ? decodeURIComponent(match[1].replace(/\+/g, ' ')).trim().toLowerCase() : '';
  const found = demoFilteredPosts(url, total).filter(
    post => query !== '' && post.title.toLowerCase().includes(query),
  );
  const page = demoPage(url, found);
  return {
    data: { searchPosts: page.posts.map(post => ({ post })) },
    extra: { offset: page.offset, isLast: page.isLast },
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

/**
 * The demo blog's posts that pass the E4 Filter params of `url` (Story 5.7,
 * as live, api-contract §3 «E4 filters (LIVE)»): `is_only_allowed=true` →
 * the accessible posts only, absent or `false` → every post (a blog's
 * server default is «Все посты»); `only_bought` is ignored; `from_ts` /
 * `to_ts` and `tags_ids` as on E5.
 */
function demoBlogPosts(url: string, blogUrl: string) {
  const total = DEMO_BLOG_POSTS[blogUrl] ?? 5;
  const index = demoBlogIndex(blogUrl);
  const onlyAllowed = /[?&]is_only_allowed=true(&|$)/.test(url);
  const fromTs = numberParam(url, 'from_ts') ?? -Infinity;
  const toTs = numberParam(url, 'to_ts') ?? Infinity;
  const tagsMatch = /[?&]tags_ids=([^&]*)/.exec(url);
  const tagIds = tagsMatch
    ? decodeURIComponent(tagsMatch[1]).split(',').filter(id => id !== '')
    : [];
  return Array.from({ length: total }, (_, n) => demoPost(n, { blogUrl, index }))
    .map(post => ({ ...post, id: `${blogUrl}-post-${post.int_id}` }))
    .filter(
      post =>
        (!onlyAllowed || post.hasAccess) &&
        post.publishTime >= fromTs &&
        post.publishTime <= toTs &&
        tagIds.every(id => post.tags.some(tag => String(tag.id) === id)),
    );
}

/** The page of `all` after the demo cursor `offset` (the next index), `size` per page. */
function demoSizedPage<T>(url: string, all: readonly T[], size: number) {
  const match = /[?&]offset=([^&]*)/.exec(url);
  const start = match ? Number(decodeURIComponent(match[1])) || 0 : 0;
  const end = Math.min(start + size, all.length);
  return { items: all.slice(start, end), extra: { offset: String(end), isLast: end >= all.length } };
}

/** The E4 page after `offset` (the demo cursor is the next index in the filtered list). */
function demoBlogPage(url: string, blogUrl: string) {
  const page = demoSizedPage(url, demoBlogPosts(url, blogUrl), BLOG_PAGE);
  return { data: page.items, extra: page.extra };
}

/**
 * E7 «Поиск в блоге» (Story 5.7): the blog's posts with the E4 period and
 * tag params, but every access value (as live: E7 ignores them), matched by
 * a case-insensitive title substring of `search_query`.
 */
function demoBlogSearchPage(url: string) {
  const blogMatch = /[?&]blog_url=([^&]*)/.exec(url);
  const blogUrl = blogMatch ? decodeURIComponent(blogMatch[1]) : '';
  const match = /[?&]search_query=([^&]*)/.exec(url);
  const query = match ? decodeURIComponent(match[1].replace(/\+/g, ' ')).trim().toLowerCase() : '';
  const all = DEMO_BLOGS.includes(blogUrl)
    ? demoBlogPosts(url.replace(/([?&])is_only_allowed=true/, '$1is_only_allowed=false'), blogUrl)
    : [];
  const found = all.filter(post => query !== '' && post.title.toLowerCase().includes(query));
  const page = demoSizedPage(url, found, BLOG_PAGE);
  return { data: { searchPosts: page.items.map(post => ({ post })) }, extra: page.extra };
}

/** E14 (Story 5.7): the tags carried by the demo blog's posts, one page. */
function demoBlogTags(blogUrl: string) {
  const seen = new Map<string, { id: number; title: string }>();
  for (const post of demoBlogPosts('', blogUrl)) {
    for (const tag of post.tags) {
      seen.set(String(tag.id), { id: tag.id, title: tag.title });
    }
  }
  return { data: [...seen.values()] };
}

const DEMO_BLOG_PATH = /^\/v1\/blog\/(demo-blog-\d+)(\/post\/)?$/;
/** E14 (Story 5.7). */
const DEMO_BLOG_TAGS_PATH = /^\/v1\/blog\/(demo-blog-\d+)\/post\/tag\/$/;
const DEMO_POST_PATH = /^\/v1\/blog\/(demo-blog-\d+)\/post\/([^/]+)$/;
/** E10 (Story 6.6). */
const DEMO_POLL_PATH = /^\/v1\/blog\/demo-blog-\d+\/poll\/([^/]+)$/;
/** E11 / E12 (Story 6.6). */
const DEMO_VOTE_PATH = /^\/v1\/poll\/([^/]+)\/vote$/;
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
          { type: 'link', content: '["ссылкой","unstyled",[]]', url: 'https://example.invalid/demo-link' },
          ...textBlock(' между заглушками.'),
          { type: 'header', content: '["Файлы и видео","unstyled",[]]', modificator: '' },
          {
            type: 'file',
            id: `demo-file-${n}`,
            title: 'Демо-файл.pdf',
            size: 1536000,
            url: 'https://example.invalid/demo-file',
          },
          { type: 'video', url: 'https://example.invalid/demo-video' },
          {
            type: 'audio_file',
            id: `demo-audio-${n}`,
            title: 'Демо-аудио',
            duration: 192,
            // Story 6.4: a synthetic host; the AudioBlock resolves it through
            // the demo E8, the engine cannot load it (one re-resolve, then
            // «Не удалось воспроизвести»).
            url: 'https://example.invalid/demo-audio.mp3',
          },
          { type: 'demo_unknown_block' },
        ]
      : [];
  return {
    ...base,
    data: base.hasAccess ? [...videos, ...DEMO_PARAGRAPHS.flatMap(textBlock), ...mixed] : [],
    teaser: base.hasAccess ? [] : [{ type: 'image', id: `demo-teaser-${n}`, width: 1280, height: 720 }],
    count: { likes: (n * 7) % 40, comments: 0 },
    // Stories 6.3–6.4: a fake signed query (the file QR's target, the demo
    // audio's source), never a real one.
    signedQuery: base.hasAccess ? '?demo=1' : '',
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
    // E10–E12 (Story 6.6): the open demo polls take votes in memory.
    const poll = DEMO_POLL_PATH.exec(request.path) ?? DEMO_VOTE_PATH.exec(request.path);
    if (poll) {
      const isRefresh = request.method === 'GET' && DEMO_POLL_PATH.test(request.path);
      const isVote = request.method !== 'GET' && DEMO_VOTE_PATH.test(request.path);
      const reply = isRefresh || isVote ? demoPollReply(request.method, decodeURIComponent(poll[1]), request.form) : null;
      return reply ? { ...reply, delayMs: 300 } : { status: 404, body: { error: 'not_found' }, delayMs: 300 };
    }
    const blogTags = DEMO_BLOG_TAGS_PATH.exec(request.path);
    if (blogTags) {
      return { status: 200, body: demoBlogTags(blogTags[1]), delayMs: 300 };
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
      case '/v1/search/feed/post/':
        return { status: 200, body: demoFeedSearchPage(request.url, DEMO_FEED_POSTS), delayMs: 300 };
      case '/v1/search/blog/post/':
        return { status: 200, body: demoBlogSearchPage(request.url), delayMs: 300 };
      case '/v1/search/feed/tag/':
        return { status: 200, body: demoFeedTagsPage(request.url), delayMs: 300 };
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
