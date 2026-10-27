/**
 * Story 3.4 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: Главная or Автор → OK on a card → Пост (E8 via
 * TanStack Query), every row of the spec's I/O matrix, the focus rules of
 * docs/focus-map.md §4 F (initial focus, the column guides, ParagraphStop),
 * the shared sidebar (ADR 0012), the author row (→ Автор, push or pop) and
 * Back to the same card. The keychain, BackHandler and the native focus
 * command are faked: these tests prove which element the app asks to focus
 * and which guide destinations it sets, not native focus movement (device
 * checks, docs/testing.md).
 */
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { StyleSheet } from 'react-native';
import App, { navigationRef } from '../src/app/App';
import { queryClient, resetQueryCache } from '../src/app/queryClient';
import { queryKeys } from '../src/shared/api';
import {
  type FixtureReply,
  type FixtureRequest,
  type FixtureTransport,
} from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { colors } from '../src/shared/ui';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { e3Body, syntheticBlogPosts } from '../src/test/authorFixtures';
import { E5_PATH, syntheticFeed } from '../src/test/feedFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import {
  blockEnd,
  e8Locked,
  e8MissingReply,
  paragraph,
  postDetail,
  text as textBlock,
} from '../src/test/postFixtures';
import { E2_PATH, blogUrlOf, subscriptionsBody } from '../src/test/subscriptionFixtures';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  focusableIds,
  installFixtureTransport,
  installNativeModules,
  lastFocusTarget,
  resetKeychain,
  text,
  unmount,
  visible,
} from '../src/test/flow';

jest.mock('react-native-keychain');
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));
jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

/** The last `destinations` each focus guide received, by testID. */
const mockGuideDestinations = new Map<string, unknown[] | undefined>();
jest.mock('react-native/Libraries/Components/TV/TVFocusGuideView', () => {
  const actual = jest.requireActual('react-native/Libraries/Components/TV/TVFocusGuideView');
  const React = jest.requireActual('react');
  const Real = actual.default;
  function RecordingGuide(props: { testID?: string; destinations?: unknown[] }) {
    if (props.testID) {
      mockGuideDestinations.set(props.testID, props.destinations);
    }
    return React.createElement(Real, props);
  }
  return { __esModule: true, default: RecordingGuide };
});

/**
 * The real FlashList with `onEndReached` held back (FlashList's Jest setup
 * measures every item 100 × 100, so the end would always be "reached"; as
 * homeFeedFlow), and its scroll calls recorded.
 */
const mockLists = { scrollToIndex: jest.fn() };
jest.mock('@shopify/flash-list', () => {
  const actual = jest.requireActual('@shopify/flash-list');
  const React = jest.requireActual('react');
  function RecordingFlashList(props: Record<string, any>) {
    const inner = React.useRef(null);
    React.useImperativeHandle(
      props.ref,
      () => ({
        scrollToOffset: (params: unknown) => inner.current?.scrollToOffset(params),
        scrollToIndex: (params: unknown) => {
          mockLists.scrollToIndex(params);
          return inner.current?.scrollToIndex(params) ?? Promise.resolve();
        },
      }),
      [],
    );
    return React.createElement(actual.FlashList, { ...props, ref: inner, onEndReached: undefined });
  }
  return { ...actual, FlashList: RecordingFlashList };
});

const focusMock = requestHostFocus as jest.Mock;

/** As authorFlow: 30 rounds, no timers unless a row needs the AD-6 backoff or a transition. */
const { settle, render, one, focusOn, press, back } = createFlow({
  settle: { rounds: 30, timerRounds: 0 },
  one: 'focusable',
  pressFocuses: true,
  submitSettles: false,
});
const WITH_TIMERS = { timerRounds: 30 };

const STORED = JSON.stringify({
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 4_000_000_000_000,
  accountId: '1001',
});
const E1 = '/v1/user/current';
/** The synthetic feed posts' blog (the live template's). */
const FEED_BLOG = 'synthetic-blog-1';
const FEED_ID = (n: number) => `feed-post-${n}`;
const FEED_CARD = (n: number) => `home/feed/${FEED_ID(n)}`;
const AUTHOR_BLOG = blogUrlOf(1);
const AUTHOR_CARD = (n: number) => `author/${AUTHOR_BLOG}/post/blog-post-${n}`;
const TILE = (n: number) => `subs/tile/${blogUrlOf(n)}`;
const AUTHOR = (postId: string) => `post/${postId}/author`;
const BLOCK = (postId: string, key: string) => `post/${postId}/block/${key}`;
const ACTION = 'state/post/action';
const E8_RE = /^\/v1\/blog\/([^/]+)\/post\/([^/]+)$/;

type Reply = FixtureReply | Promise<FixtureReply> | undefined;
/** E8 by `{blogUrl, postId}`; default: 3 paragraphs and 5 likes. */
let e8: (req: FixtureRequest, blogUrl: string, postId: string) => Reply;
let transport: FixtureTransport;
/** The default transport handler (E1, E5, E2, E3, E4, E8), set in `beforeEach`. */
let fullHandler: (req: FixtureRequest) => Reply;

const THREE = [...paragraph('First'), ...paragraph('Second'), ...paragraph('Third')];

function deferred() {
  let resolve!: (reply: FixtureReply) => void;
  const promise = new Promise<FixtureReply>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeAll(() => {
  jest.useFakeTimers();
  notifyManager.setScheduler(callback => {
    Promise.resolve().then(callback);
  });
});

afterAll(() => {
  jest.useRealTimers();
  notifyManager.setScheduler(callback => setTimeout(callback, 0));
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  focusMock.mockClear();
  backHandler.reset();
  mockLists.scrollToIndex.mockClear();
  mockGuideDestinations.clear();
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.0' } });
  e8 = (_req, blogUrl, postId) => ({
    status: 200,
    body: postDetail(blogUrl, postId, THREE, { count: { likes: 5, comments: 7 } }),
  });
  const feed = syntheticFeed({ total: 9 });
  const blogPosts = syntheticBlogPosts({ blogUrl: AUTHOR_BLOG, total: 7 });
  fullHandler = (req: FixtureRequest): Reply => {
    if (req.path === E1) {
      return { status: 200, body: e1Ok.body };
    }
    if (req.path === E5_PATH) {
      return feed(req);
    }
    if (req.path === E2_PATH) {
      return { status: 200, body: subscriptionsBody(3) };
    }
    const single = E8_RE.exec(req.path);
    if (single) {
      return e8(req, decodeURIComponent(single[1]), decodeURIComponent(single[2]));
    }
    if (/^\/v1\/blog\/[^/]+\/post\/$/.test(req.path)) {
      const blogUrl = req.path.split('/')[3];
      return blogUrl === AUTHOR_BLOG
        ? blogPosts(req)
        : syntheticBlogPosts({ blogUrl, total: 4 })(req);
    }
    if (/^\/v1\/blog\/[^/]+$/.test(req.path)) {
      return { status: 200, body: e3Body(req.path.slice('/v1/blog/'.length)) };
    }
    return undefined;
  };
  transport = installFixtureTransport(fullHandler);
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  jest.restoreAllMocks();
});

type Root = Awaited<ReturnType<typeof render>>;

const currentRoute = () => navigationRef.getCurrentRoute()?.name;
const routeNames = () => navigationRef.getRootState()?.routes.map(r => r.name);
const e8Calls = () => transport.calls.filter(c => E8_RE.test(c.path));
const focusTargets = () =>
  focusMock.mock.calls.map(c => (c[0] as { props?: { testID?: string } } | null)?.props?.testID);
function destinationIds(guide: string): string[] {
  return (mockGuideDestinations.get(guide) ?? []).map(
    view => (view as { props?: { testID?: string } }).props?.testID as string,
  );
}
const contentIds = (root: Root) => focusableIds(root, byTestId(root, 'post/content')[0]);
const pageText = (root: Root) => text(byTestId(root, 'post/page')[0]);

/** Главная (9 cards, focus on the first) → focus card `n` → OK → Пост. */
async function openFromHome(n = 0) {
  const root = await render(<App />);
  await focusOn(root, FEED_CARD(n));
  focusMock.mockClear();
  await press(root, FEED_CARD(n));
  expect(currentRoute()).toBe('Post');
  return root;
}

/** Подписки → tile 1 → Автор → OK on post `n` → Пост. */
async function openFromAuthor(n = 1) {
  const root = await render(<App />);
  await press(root, 'nav/subs');
  await press(root, TILE(1));
  expect(currentRoute()).toBe('Author');
  focusMock.mockClear();
  await press(root, AUTHOR_CARD(n));
  expect(currentRoute()).toBe('Post');
  return root;
}

describe('open from Главная (matrix «Text post», «Likes»)', () => {
  it('OK on a feed card: E8 for that post (comments off, content profile); header left, paragraphs right; focus on the first paragraph', async () => {
    const root = await openFromHome(2);
    const id = FEED_ID(2);
    expect(e8Calls()).toHaveLength(1);
    const [call] = e8Calls();
    expect(call.url).toBe(
      `https://api.boosty.to/v1/blog/${FEED_BLOG}/post/${id}?comments_limit=0&reply_limit=0`,
    );
    expect(call.headers.Authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    expect(call.headers['X-App']).toBeUndefined();
    expect(call.headers['X-From-Id']).toBeUndefined();
    expect(transport.calls.every(c => !/comment/.test(c.path))).toBe(true);
    // Left: author row, title, date · likes (not focusable).
    expect(text(byTestId(root, AUTHOR(id))[0])).toContain('redacted');
    expect(one(root, AUTHOR(id)).props.accessibilityLabel).toBe(
      'Автор: redacted. Открыть страницу автора',
    );
    expect(text(byTestId(root, 'post/title')[0])).toContain(`Title of ${id}`);
    expect(byTestId(root, 'post/title')[0].props.numberOfLines).toBe(6);
    const meta = text(byTestId(root, 'post/meta')[0]);
    expect(meta).toMatch(/ · 5 лайков/);
    // Right: three paragraphs, each a focus stop, in order.
    expect(contentIds(root)).toEqual([
      AUTHOR(id),
      BLOCK(id, 'text@0'),
      BLOCK(id, 'text@2'),
      BLOCK(id, 'text@4'),
    ]);
    expect(one(root, BLOCK(id, 'text@2')).props.accessibilityLabel).toBe('Second');
    // No comment count (7 in the body), price, reaction or «Смотреть» anywhere.
    expect(byTestId(root, 'post/meta')[0].props.children).toMatch(/^[^·]+ · 5 лайков$/);
    for (const forbidden of ['коммент', '₽', 'RUB', 'Смотреть', 'Оформить', 'реакц']) {
      expect(pageText(root)).not.toContain(forbidden);
    }
    // Initial focus: the first paragraph (after the skeleton's sidebar item).
    expect(focusTargets()).toEqual(['post/nav/home', BLOCK(id, 'text@0')]);
    await unmount(root);
  });

  it.each([
    [1, '1 лайк'],
    [3, '3 лайка'],
    [0, '0 лайков'],
  ])('likes %i: «%s»', async (likes, label) => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, THREE, { count: { likes } }),
    });
    const root = await openFromHome();
    expect(text(byTestId(root, 'post/meta')[0])).toContain(` · ${label}`);
    await unmount(root);
  });

  it('no like count: the date alone (no like line)', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, THREE, { count: undefined }),
    });
    const root = await openFromHome();
    const meta = text(byTestId(root, 'post/meta')[0]);
    expect(meta).not.toContain('лайк');
    expect(meta).not.toContain(' · ');
    await unmount(root);
  });

  it.each([
    ['empty title: the first text', '', [...paragraph('  Opening line ')], 'Opening line'],
    ['no title, no text: «Без названия»', '', [{ type: 'image', id: 'i' }], 'Без названия'],
  ])('%s', async (_name, title, data, shown) => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, data, { title }),
    });
    const root = await openFromHome();
    expect(text(byTestId(root, 'post/title')[0])).toContain(shown);
    await unmount(root);
  });

  it('a ParagraphStop: focused = surface background and accent bar, no ring, no scale; OK does nothing', async () => {
    const root = await openFromHome();
    const id = BLOCK(FEED_ID(0), 'text@2');
    await focusOn(root, id);
    expect(visible(root, `${id}/ring`)).toBe(false);
    const style = StyleSheet.flatten(byTestId(root, `${id}/scale`)[0].props.style) as Record<string, unknown>;
    expect(style.backgroundColor).toBe(colors.surface);
    expect(style.borderLeftColor).toBe(colors.accent);
    expect(style.borderLeftWidth).toBe(2);
    expect(style.overflow).toBeUndefined();
    expect(style.opacity).toBeUndefined();
    // The bar's width is reserved unfocused too (no reflow).
    const other = StyleSheet.flatten(
      byTestId(root, `${BLOCK(FEED_ID(0), 'text@0')}/scale`)[0].props.style,
    ) as Record<string, unknown>;
    expect(other.borderLeftWidth).toBe(2);
    expect(other.borderLeftColor).toBe('transparent');
    const before = transport.calls.length;
    focusMock.mockClear();
    await press(root, id);
    expect(currentRoute()).toBe('Post');
    expect(transport.calls).toHaveLength(before);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });
});

describe('blocks (matrix «Mixed blocks», «Malformed block»)', () => {
  it('video, image, file, audio, poll, unknown: one non-focusable placeholder each, in order; text (and a standalone link\'s text) between them', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [
        { type: 'ok_video', id: 'v1', title: 'Video', playerUrls: [{ type: 'hd', url: '' }] },
        ...paragraph('Between'),
        { type: 'image', id: 'i1', url: 'https://example.invalid/image' },
        { type: 'link', content: '["Link","unstyled",[]]', url: 'https://example.invalid/link' },
        { type: 'file', id: 'f1', title: 'File' },
        { type: 'audio_file', id: 'a1', title: 'Audio' },
        { type: 'poll', id: 7 },
        { type: 'brand_new_block' },
        ...paragraph('After'),
      ]),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const placeholders = [
      [BLOCK(id, 'ok_video:v1'), 'Видео'],
      [BLOCK(id, 'image:i1'), 'Изображение'],
      [BLOCK(id, 'file:f1'), 'Файл'],
      [BLOCK(id, 'audio_file:a1'), 'Аудио'],
      [BLOCK(id, 'poll:7'), 'Опрос'],
      [BLOCK(id, 'brand_new_block@8'), 'Блок'],
    ];
    for (const [testID, label] of placeholders) {
      const [node] = byTestId(root, testID);
      expect(node.props.focusable).toBe(false);
      expect(node.props.accessibilityLabel).toBe(label);
      expect(text(node)).toContain(label);
    }
    expect(contentIds(root)).toEqual([
      AUTHOR(id),
      BLOCK(id, 'text@1'),
      BLOCK(id, 'link@4'),
      BLOCK(id, 'text@9'),
    ]);
    expect(one(root, BLOCK(id, 'link@4')).props.accessibilityLabel).toBe('Link');
    // Order on the page: video, Between, image, link (as text), file, audio, poll, unknown, After.
    const order = byTestId(root, 'post/body')[0]
      .queryAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith(`post/${id}/block/`) && !n.props.testID.endsWith('/scale'))
      .map(n => n.props.testID as string);
    expect([...new Set(order)]).toEqual([
      BLOCK(id, 'ok_video:v1'),
      BLOCK(id, 'text@1'),
      BLOCK(id, 'image:i1'),
      BLOCK(id, 'link@4'),
      BLOCK(id, 'file:f1'),
      BLOCK(id, 'audio_file:a1'),
      BLOCK(id, 'poll:7'),
      BLOCK(id, 'brand_new_block@8'),
      BLOCK(id, 'text@9'),
    ]);
    // No block image is loaded (only the author's avatar); no «Смотреть».
    const images = byTestId(root, 'post/page')[0]
      .queryAll(n => n.props.source !== undefined)
      .map(n => n.props.testID);
    expect([...new Set(images)]).toEqual([`${AUTHOR(id)}/avatar`]);
    expect(pageText(root)).not.toContain('Смотреть');
    await unmount(root);
  });

  it('an inline link (matrix «Inline link»): one paragraph with the link text, no placeholder', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [
        textBlock('Подробнее '),
        { type: 'link', content: '["здесь","unstyled",[]]', url: 'https://example.invalid/link' },
        textBlock(' и ниже.'),
        blockEnd(),
      ]),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@0')]);
    expect(one(root, BLOCK(id, 'text@0')).props.accessibilityLabel).toBe('Подробнее здесь и ниже.');
    expect(pageText(root)).not.toContain('Ссылка');
    await unmount(root);
  });

  it('malformed blocks (no type, bad content, null, a string): placeholders or text, no crash', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [
        { content: 'no type' },
        { type: 'text', content: { not: 'a string' } },
        null,
        'a string',
        { type: 'list', items: [{ data: [textBlock('Item')], items: 'bad' }] },
        textBlock('Tail'),
        blockEnd(),
      ]),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(visible(root, 'post/error')).toBe(false);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'list@4'), BLOCK(id, 'text@5')]);
    expect(text(byTestId(root, BLOCK(id, 'list@4'))[0])).toContain('Item');
    await unmount(root);
  });

  it('a post without text: focus on the author; → has no destination', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [{ type: 'ok_video', id: 'v1' }]),
    });
    const root = await openFromHome();
    expect(lastFocusTarget()).toBe(AUTHOR(FEED_ID(0)));
    expect(destinationIds('post/right')).toEqual([]);
    await unmount(root);
  });
});

describe('locked, missing, errors (matrix «Locked», «Not found», «Error»)', () => {
  const INSTALL_ID = { InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') } };

  it('E8 401 → the refresh path runs; refresh invalid_grant → A11, the Post shows no «Повторить»', async () => {
    installNativeModules(INSTALL_ID);
    const refresh = { status: 400, body: { error: 'invalid_grant' } };
    e8 = () => ({ status: 401, body: { error: 'unauthorized' } });
    transport = installFixtureTransport(req => (req.path === '/oauth/token/' ? refresh : fullHandler(req)));
    const root = await render(<App />);
    await focusOn(root, FEED_CARD(0));
    await press(root, FEED_CARD(0), { settle: WITH_TIMERS });
    expect(transport.callsTo('/oauth/token/')).toHaveLength(1);
    expect(visible(root, 'auth/expired')).toBe(true);
    expect(routeNames()).toEqual(['Expired']);
    expect(visible(root, ACTION)).toBe(false);
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    await unmount(root);
  });

  it('E8 401 → one refresh → replayed → the post', async () => {
    installNativeModules(INSTALL_ID);
    const NEW = 'n'.repeat(64);
    e8 = (req, blogUrl, postId) =>
      req.headers.Authorization === `Bearer ${NEW}`
        ? { status: 200, body: postDetail(blogUrl, postId, THREE) }
        : { status: 401, body: { error: 'unauthorized' } };
    transport = installFixtureTransport(req =>
      req.path === '/oauth/token/'
        ? { status: 200, body: { access_token: NEW, refresh_token: 'm'.repeat(64), expires_in: 2592000 } }
        : fullHandler(req),
    );
    const root = await render(<App />);
    await focusOn(root, FEED_CARD(0));
    await press(root, FEED_CARD(0), { settle: WITH_TIMERS });
    expect(transport.callsTo('/oauth/token/')).toHaveLength(1);
    expect(e8Calls()).toHaveLength(2);
    expect(lastFocusTarget()).toBe(BLOCK(FEED_ID(0), 'text@0'));
    await unmount(root);
  });

  it('E8 403: the generic error StateView («Повторить»); never expiry, A11 or a refresh', async () => {
    e8 = () => ({ status: 403, body: { error: 'forbidden' } });
    const root = await openFromHome();
    expect(visible(root, 'post/error')).toBe(true);
    expect(pageText(root)).toContain(t('error.Client'));
    expect(one(root, ACTION).props.accessibilityLabel).toBe(t('common.retry'));
    expect(transport.callsTo('/oauth/token/')).toHaveLength(0);
    expect(visible(root, 'auth/expired')).toBe(false);
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('locked: header + the teaser placeholder, no error, focus on the author', async () => {
    e8 = (_req, blogUrl, postId) => {
      const body = e8Locked();
      return {
        status: 200,
        body: { ...body, id: postId, user: { ...(body.user as object), blogUrl } },
      };
    };
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(visible(root, 'post/header')).toBe(true);
    expect(visible(root, 'post/error')).toBe(false);
    expect(visible(root, 'post/unavailable')).toBe(false);
    expect(byTestId(root, BLOCK(id, 'image:synthetic-id-107'))[0].props.accessibilityLabel).toBe(
      'Изображение',
    );
    expect(contentIds(root)).toEqual([AUTHOR(id)]);
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    // Still signed in: no A11, no extra E1.
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('E8 404 not_found: «Пост недоступен» + «Назад» (focused), no retry; «Назад» pops to the same card', async () => {
    e8 = () => e8MissingReply();
    const root = await openFromHome(4);
    expect(visible(root, 'post/unavailable')).toBe(true);
    expect(pageText(root)).toContain('Пост недоступен');
    expect(pageText(root)).not.toContain(t('common.retry'));
    expect(one(root, ACTION).props.accessibilityLabel).toBe(t('common.back'));
    expect(lastFocusTarget()).toBe(ACTION);
    expect(e8Calls()).toHaveLength(1);
    focusMock.mockClear();
    await press(root, ACTION);
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(FEED_CARD(4));
    expect(e8Calls()).toHaveLength(1);
    await unmount(root);
  });

  it('E8 404: Back pops too', async () => {
    e8 = () => e8MissingReply();
    const root = await openFromHome(1);
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(FEED_CARD(1));
    await unmount(root);
  });

  it.each([
    ['Network', (): FixtureReply => ({ network: true })],
    ['Server', (): FixtureReply => ({ status: 503, body: { error: 'unavailable' } })],
    ['Parse', (): FixtureReply => ({ status: 200, body: { id: 'no-user' } })],
    ['Client', (): FixtureReply => ({ status: 400, body: { error: 'bad_request' } })],
  ])('E8 %s: error.<kind> + «Повторить» (focused); retry refetches E8; success → the first paragraph', async (kind, failure) => {
    let fail = true;
    const ok = e8;
    e8 = (req, blogUrl, postId) => (fail ? failure() : ok(req, blogUrl, postId));
    const root = await render(<App />);
    await focusOn(root, FEED_CARD(0));
    await press(root, FEED_CARD(0), { settle: WITH_TIMERS });
    expect(visible(root, 'post/error')).toBe(true);
    expect(pageText(root)).toContain(t(`error.${kind}` as 'error.Network'));
    expect(one(root, ACTION).props.accessibilityLabel).toBe(t('common.retry'));
    expect(lastFocusTarget()).toBe(ACTION);
    const calls = e8Calls().length;
    fail = false;
    focusMock.mockClear();
    await press(root, ACTION);
    expect(e8Calls()).toHaveLength(calls + 1);
    expect(visible(root, 'post/error')).toBe(false);
    expect(lastFocusTarget()).toBe(BLOCK(FEED_ID(0), 'text@0'));
    await unmount(root);
  });

  it('a retry in flight keeps the busy action (focus kept); a second failure keeps the error', async () => {
    const reply = deferred();
    let calls = 0;
    e8 = () => {
      calls += 1;
      return calls === 1 ? { status: 400, body: {} } : reply.promise;
    };
    const root = await openFromHome();
    expect(lastFocusTarget()).toBe(ACTION);
    focusMock.mockClear();
    await press(root, ACTION);
    expect(visible(root, 'post/error')).toBe(true);
    expect(visible(root, 'post/header-skeleton')).toBe(false);
    reply.resolve({ status: 400, body: {} });
    await settle();
    expect(visible(root, 'post/error')).toBe(true);
    expect(focusTargets().filter(id => id !== ACTION)).toEqual([]);
    await unmount(root);
  });
});

describe('focus (focus-map §4 F)', () => {
  it('skeleton: nothing focusable in content, focus on the sidebar item; the first paragraph when E8 arrives', async () => {
    const reply = deferred();
    e8 = () => reply.promise;
    const root = await openFromHome();
    expect(visible(root, 'post/header-skeleton')).toBe(true);
    expect(visible(root, 'post/body-skeleton')).toBe(true);
    expect(contentIds(root)).toEqual([]);
    expect(lastFocusTarget()).toBe('post/nav/home');
    reply.resolve({ status: 200, body: postDetail(FEED_BLOG, FEED_ID(0), THREE) });
    await settle();
    expect(lastFocusTarget()).toBe(BLOCK(FEED_ID(0), 'text@0'));
    await unmount(root);
  });

  it('the user moves during the skeleton: the post does not take focus', async () => {
    const reply = deferred();
    e8 = () => reply.promise;
    const root = await openFromHome();
    await focusOn(root, 'post/nav/settings');
    focusMock.mockClear();
    reply.resolve({ status: 200, body: postDetail(FEED_BLOG, FEED_ID(0), THREE) });
    await settle();
    expect(contentIds(root)).toHaveLength(4);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('the columns: ← lands on the author (left guide), → on the last focused paragraph (right guide); each traps ↑ ↓', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(destinationIds('post/left')).toEqual([AUTHOR(id)]);
    expect(destinationIds('post/right')).toEqual([BLOCK(id, 'text@0')]);
    await focusOn(root, BLOCK(id, 'text@2'));
    await focusOn(root, BLOCK(id, 'text@4'));
    await focusOn(root, AUTHOR(id));
    expect(destinationIds('post/right')).toEqual([BLOCK(id, 'text@4')]);
    for (const guide of ['post/left', 'post/right']) {
      const [node] = byTestId(root, guide);
      expect(node.props).toMatchObject({ trapFocusUp: true, trapFocusDown: true });
      expect(node.props.trapFocusLeft).toBeFalsy();
      expect(node.props.trapFocusRight).toBeFalsy();
    }
    // The content zone: → from the sidebar returns to the remembered element.
    expect(destinationIds('post/content')).toEqual([AUTHOR(id)]);
    // The route is trapped on all sides (the Shell stays mounted below).
    expect(byTestId(root, 'post')[0].props).toMatchObject({
      trapFocusUp: true,
      trapFocusDown: true,
      trapFocusLeft: true,
      trapFocusRight: true,
    });
    await unmount(root);
  });

  it('↓ through the paragraphs: the column scrolls natively (a ScrollView); the zone remembers each one', async () => {
    const many = Array.from({ length: 40 }, (_, i) => paragraph(`Paragraph ${i}`)).flat();
    e8 = (_req, blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, many) });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(byTestId(root, 'post/body')[0].type).toBe('RCTScrollView');
    for (const i of [0, 1, 2, 39]) {
      await focusOn(root, BLOCK(id, `text@${i * 2}`));
      expect(destinationIds('post/content')).toEqual([BLOCK(id, `text@${i * 2}`)]);
    }
    await unmount(root);
  });

  it('a paragraph longer than one stop is split: ↓ walks its parts in order (keys `<key>#<n>`)', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `Предложение ${i} с несколькими словами для длины текста.`).join(' ');
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [textBlock(long), blockEnd(), ...paragraph('After')]),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const stops = contentIds(root).filter(x => x.startsWith(`post/${id}/block/`));
    expect(stops.length).toBeGreaterThan(3);
    expect(stops.slice(0, -1)).toEqual(
      stops.slice(0, -1).map((_, n) => BLOCK(id, n === 0 ? 'text@0' : `text@0#${n}`)),
    );
    expect(stops[stops.length - 1]).toBe(BLOCK(id, 'text@2'));
    expect(lastFocusTarget()).toBe(BLOCK(id, 'text@0'));
    const parts: string[] = [];
    for (const stop of stops.slice(0, -1)) {
      await focusOn(root, stop);
      expect(destinationIds('post/content')).toEqual([stop]);
      const node = one(root, stop);
      expect(node.props.accessibilityRole).toBe('text');
      parts.push(node.props.accessibilityLabel);
    }
    expect(parts.join(' ').split(/\s+/)).toEqual(long.split(/\s+/));
    await unmount(root);
  });

  it('a refetch that drops the focused paragraph: the initial target; others keep focus', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    await focusOn(root, BLOCK(id, 'text@2'));
    focusMock.mockClear();
    const key = queryKeys.post(FEED_BLOG, id);
    await act(async () => {
      queryClient.setQueryData(key, (data: any) => ({
        ...data,
        post: { ...data.post, blocks: data.post.blocks.slice(0, 2) },
      }));
    });
    await settle();
    expect(focusTargets()).toEqual([BLOCK(id, 'text@0')]);
    await focusOn(root, BLOCK(id, 'text@0'));
    focusMock.mockClear();
    await act(async () => {
      queryClient.setQueryData(key, (data: any) => ({ ...data, post: { ...data.post, title: 'New' } }));
    });
    await settle();
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('Пост unmounts: its FocusRestoration entries are forgotten', async () => {
    const root = await openFromHome();
    await focusOn(root, AUTHOR(FEED_ID(0)));
    const key = navigationRef.getCurrentRoute()?.key as string;
    expect(focusRestoration.peek(key, 'main')?.focusId).toBe(AUTHOR(FEED_ID(0)));
    await back(WITH_TIMERS);
    expect(visible(root, 'post')).toBe(false);
    expect(focusRestoration.peek(key, 'main')).toBeUndefined();
    await unmount(root);
  });

  it('reopening the same post within staleTime: from the cache, the first paragraph at once', async () => {
    const root = await openFromHome();
    await back();
    focusMock.mockClear();
    await press(root, FEED_CARD(0));
    expect(e8Calls()).toHaveLength(1);
    expect(focusTargets()).toEqual([BLOCK(FEED_ID(0), 'text@0')]);
    await unmount(root);
  });
});

describe('Back to the origin card (matrix «Back»)', () => {
  it('Главная: Back from a paragraph → the same card by id (deferred 3.1 item: through restore, not zone order)', async () => {
    const root = await openFromHome(5);
    await focusOn(root, BLOCK(FEED_ID(5), 'text@2'));
    focusMock.mockClear();
    mockLists.scrollToIndex.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(FEED_CARD(5));
    // Same index: no scroll by index.
    expect(mockLists.scrollToIndex).not.toHaveBeenCalled();
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    // Главная was not requested again.
    expect(transport.callsTo(E5_PATH)).toHaveLength(1);
    await unmount(root);
  });

  it('Главная: the card is gone on return → its neighbor by index', async () => {
    const root = await openFromHome(5);
    await act(async () => {
      type Data = { pages: Array<{ posts: Array<{ id: string }> }> };
      queryClient.setQueryData<Data>(queryKeys.subscriptionFeed(), data =>
        data
          ? { ...data, pages: data.pages.map(p => ({ ...p, posts: p.posts.filter(x => x.id !== FEED_ID(5)) })) }
          : data,
      );
    });
    await settle();
    focusMock.mockClear();
    await back();
    expect(visible(root, FEED_CARD(5))).toBe(false);
    expect(lastFocusTarget()).toBe(FEED_CARD(6));
    await unmount(root);
  });

  it('Главная: Back from the Post sidebar → the same card', async () => {
    const root = await openFromHome(3);
    await focusOn(root, 'post/nav/settings');
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(FEED_CARD(3));
    await unmount(root);
  });

  it('Автор: Back → the same post card; gone → its neighbor', async () => {
    const root = await openFromAuthor(2);
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Author');
    expect(lastFocusTarget()).toBe(AUTHOR_CARD(2));

    await press(root, AUTHOR_CARD(2));
    expect(currentRoute()).toBe('Post');
    await act(async () => {
      type Data = { pages: Array<{ posts: Array<{ id: string }> }> };
      queryClient.setQueryData<Data>(queryKeys.authorPosts(AUTHOR_BLOG), data =>
        data
          ? { ...data, pages: data.pages.map(p => ({ ...p, posts: p.posts.filter(x => x.id !== 'blog-post-2') })) }
          : data,
      );
    });
    await settle();
    focusMock.mockClear();
    await back();
    expect(visible(root, AUTHOR_CARD(2))).toBe(false);
    expect(lastFocusTarget()).toBe(AUTHOR_CARD(3));
    await unmount(root);
  });
});

describe('the author row (→ Автор)', () => {
  it('from Главная: OK pushes Автор (sidebar current = Главная); Back returns to Пост with focus on the author row', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    await press(root, AUTHOR(id));
    expect(currentRoute()).toBe('Author');
    expect(navigationRef.getCurrentRoute()?.params).toEqual({ blogUrl: FEED_BLOG, section: 'home' });
    expect(routeNames()).toEqual(['Shell', 'Post', 'Author']);
    expect(visible(root, 'author/nav/home/current')).toBe(true);
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Post');
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    await unmount(root);
  });

  it('from Автор (same blog below): OK pops to it, focus on the post card', async () => {
    const root = await openFromAuthor(3);
    focusMock.mockClear();
    await press(root, AUTHOR('blog-post-3'));
    expect(currentRoute()).toBe('Author');
    expect(routeNames()).toEqual(['Shell', 'Author']);
    expect(lastFocusTarget()).toBe(AUTHOR_CARD(3));
    await unmount(root);
  });

  it('a post of another blog below Автор: OK pushes that blog', async () => {
    e8 = (_req, _blogUrl, postId) => ({
      status: 200,
      body: postDetail('synthetic-blog-9', postId, THREE),
    });
    const root = await openFromAuthor(1);
    await press(root, AUTHOR('blog-post-1'));
    expect(routeNames()).toEqual(['Shell', 'Author', 'Post', 'Author']);
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      blogUrl: 'synthetic-blog-9',
      section: 'subs',
    });
    await unmount(root);
  });
});

describe('the sidebar (ADR 0012)', () => {
  it('the same enabled sections; current = the origin section (Главная / Подписки)', async () => {
    const root = await openFromHome();
    expect(focusableIds(root, byTestId(root, 'post/sidebar')[0])).toEqual([
      'post/nav/home',
      'post/nav/subs',
      'post/nav/settings',
    ]);
    expect(visible(root, 'post/nav/home/current')).toBe(true);
    expect(destinationIds('post/sidebar')).toEqual(['post/nav/home']);
    await unmount(root);

    const fromAuthor = await openFromAuthor();
    expect(visible(fromAuthor, 'post/nav/subs/current')).toBe(true);
    await unmount(fromAuthor);
  });

  it('OK on the origin item (Главная): pop to the same card', async () => {
    const root = await openFromHome(4);
    focusMock.mockClear();
    await press(root, 'post/nav/home');
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(FEED_CARD(4));
    await unmount(root);
  });

  it('OK on «Настройки»: the Shell on Настройки, focus on its first row', async () => {
    const root = await openFromHome();
    focusMock.mockClear();
    await press(root, 'post/nav/settings');
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'shell/content/settings')).toBe(true);
    expect(lastFocusTarget()).toBe('settings/row/version');
    await unmount(root);
  });

  it('Пост over Автор, OK on «Подписки» (the origin): pops through Автор to the Shell, the same tile', async () => {
    const root = await openFromAuthor();
    focusMock.mockClear();
    await press(root, 'post/nav/subs', { settle: WITH_TIMERS });
    expect(currentRoute()).toBe('Shell');
    expect(routeNames()).toEqual(['Shell']);
    expect(visible(root, 'subs')).toBe(true);
    expect(lastFocusTarget()).toBe(TILE(1));
    await unmount(root);
  });

  it('Пост over Автор, OK on «Главная»: the Shell on Главная, focus on nav/home, then its card', async () => {
    const root = await openFromAuthor();
    focusMock.mockClear();
    await press(root, 'post/nav/home', { settle: WITH_TIMERS });
    expect(currentRoute()).toBe('Shell');
    expect(routeNames()).toEqual(['Shell']);
    expect(visible(root, 'shell/content/home')).toBe(true);
    expect(focusTargets()).toContain('nav/home');
    expect(lastFocusTarget()).toMatch(/^home\/feed\//);
    // A later Back from a new Пост returns to that card, not to Подписки.
    await press(root, FEED_CARD(2));
    focusMock.mockClear();
    await back(WITH_TIMERS);
    expect(visible(root, 'shell/content/home')).toBe(true);
    expect(lastFocusTarget()).toBe(FEED_CARD(2));
    await unmount(root);
  });

  it('Back from the Автор sidebar opened from a Пост pops one route (to Пост)', async () => {
    const root = await openFromHome();
    await press(root, AUTHOR(FEED_ID(0)));
    await focusOn(root, 'author/nav/settings');
    await back();
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });
});

