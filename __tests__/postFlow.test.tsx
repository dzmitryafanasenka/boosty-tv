/**
 * Story 3.4 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: Главная or Автор → OK on a card → Пост (E8 via
 * TanStack Query), every row of the spec's I/O matrix, the focus rules of
 * docs/focus-map.md §4 F (initial focus, the column guide, ParagraphStop),
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
import { videoRowsOf, type Post } from '../src/shared/entities/post';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { colors, spacing } from '../src/shared/ui';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { e3Body, syntheticBlogPosts } from '../src/test/authorFixtures';
import { E5_PATH, syntheticFeed } from '../src/test/feedFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import {
  blockEnd,
  e8Accessible,
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

/** `phaseFlags.player`, switchable per test (the app reads it at render). */
const mockPlayerFlag = { on: false };
jest.mock('../src/app/phaseFlags', () => {
  const actual = jest.requireActual('../src/app/phaseFlags');
  return {
    ...actual,
    phaseFlags: {
      ...actual.phaseFlags,
      get player() {
        return mockPlayerFlag.on;
      },
    },
  };
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
const VIDEO = (postId: string, mediaId: string) => `post/${postId}/video/${mediaId}`;
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
/** The descendants of `node` with this testID. */
const within = (node: { queryAll: (p: (n: any) => boolean) => unknown[] }, testID: string) =>
  node.queryAll((n: any) => n.props.testID === testID);

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
  it('OK on a feed card: E8 for that post (comments off, content profile); header on top, paragraphs below; focus on the first paragraph', async () => {
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
  it('image, file, audio, poll, unknown: one non-focusable placeholder each, in order; text (and a standalone link\'s text) between them; the video is a MediaRow on top', async () => {
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
    expect(visible(root, BLOCK(id, 'ok_video:v1'))).toBe(false);
    const placeholders = [
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
      // Body placeholders are capped at the text measure, as paragraphs.
      expect((StyleSheet.flatten(node.props.style) as Record<string, unknown>).maxWidth).toBe(
        spacing['text-measure'],
      );
    }
    expect(contentIds(root)).toEqual([
      AUTHOR(id),
      VIDEO(id, 'v1'),
      BLOCK(id, 'text@1'),
      BLOCK(id, 'link@4'),
      BLOCK(id, 'text@9'),
    ]);
    expect(one(root, BLOCK(id, 'link@4')).props.accessibilityLabel).toBe('Link');
    // Order on the page: Between, image, link (as text), file, audio, poll, unknown, After.
    const order = byTestId(root, 'post/body')[0]
      .queryAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith(`post/${id}/block/`) && !n.props.testID.endsWith('/scale'))
      .map(n => n.props.testID as string);
    expect([...new Set(order)]).toEqual([
      BLOCK(id, 'text@1'),
      BLOCK(id, 'image:i1'),
      BLOCK(id, 'link@4'),
      BLOCK(id, 'file:f1'),
      BLOCK(id, 'audio_file:a1'),
      BLOCK(id, 'poll:7'),
      BLOCK(id, 'brand_new_block@8'),
      BLOCK(id, 'text@9'),
    ]);
    // No block image is loaded (only the author's avatar; the video has no preview); no «Смотреть».
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

  it('a post with neither a video row nor text: focus on the author; → has no destination', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [{ type: 'image', id: 'i1' }, { type: 'ok_video', title: 'no id' }]),
    });
    const root = await openFromHome();
    expect(lastFocusTarget()).toBe(AUTHOR(FEED_ID(0)));
    expect(destinationIds('post/column')).toEqual([AUTHOR(FEED_ID(0))]);
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

  it('locked: header + the teaser image, no error, focus on the author', async () => {
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
    // The StateView replaces the column: no column, no header or skeleton.
    expect(byTestId(root, 'post/column')).toHaveLength(0);
    expect(byTestId(root, 'post/header')).toHaveLength(0);
    expect(byTestId(root, 'post/header-skeleton')).toHaveLength(0);
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
    expect(byTestId(root, 'post/column')).toHaveLength(0);
    expect(byTestId(root, 'post/header')).toHaveLength(0);
    expect(byTestId(root, 'post/header-skeleton')).toHaveLength(0);
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
    // Matrix «States»: the skeleton is the single column (header, then body).
    const [column] = byTestId(root, 'post/column');
    expect(within(column, 'post/header-skeleton')).toHaveLength(1);
    expect(within(column, 'post/body-skeleton')).toHaveLength(1);
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

  it('one column (owner decision 2026-10-27): header on top, then the body, in one guide that traps ↑ ↓; its destination is the last focused element, else the initial one', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    // No left/right columns any more.
    expect(byTestId(root, 'post/left')).toHaveLength(0);
    expect(byTestId(root, 'post/right')).toHaveLength(0);
    const [column] = byTestId(root, 'post/column');
    expect(column.props).toMatchObject({ trapFocusUp: true, trapFocusDown: true });
    expect(column.props.trapFocusLeft).toBeFalsy();
    expect(column.props.trapFocusRight).toBeFalsy();
    // The header is the first child of the scrolling column (not pinned).
    const [scroll] = byTestId(root, 'post/body');
    expect(within(scroll, 'post/header')).toHaveLength(1);
    expect(scroll.props.stickyHeaderIndices).toBeUndefined();
    expect(focusableIds(column)).toEqual([
      AUTHOR(id),
      BLOCK(id, 'text@0'),
      BLOCK(id, 'text@2'),
      BLOCK(id, 'text@4'),
    ]);
    expect(destinationIds('post/column')).toEqual([BLOCK(id, 'text@0')]);
    await focusOn(root, BLOCK(id, 'text@2'));
    await focusOn(root, BLOCK(id, 'text@4'));
    expect(destinationIds('post/column')).toEqual([BLOCK(id, 'text@4')]);
    await focusOn(root, AUTHOR(id));
    expect(destinationIds('post/column')).toEqual([AUTHOR(id)]);
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

  it('long text (matrix «Long text»): ↓ walks 30 paragraphs to the end with the header scrolling away; ↑ walks back to the author', async () => {
    const many = Array.from({ length: 30 }, (_, i) => paragraph(`Paragraph ${i}`)).flat();
    e8 = (_req, blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, many) });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const [scroll] = byTestId(root, 'post/body');
    // The header is inside the scrolling column, so it scrolls away (never pinned).
    expect(within(scroll, 'post/header')).toHaveLength(1);
    expect(scroll.props.stickyHeaderIndices).toBeUndefined();
    const stops = focusableIds(byTestId(root, 'post/column')[0]);
    expect(stops).toEqual([AUTHOR(id), ...Array.from({ length: 30 }, (_, i) => BLOCK(id, `text@${i * 2}`))]);
    for (const stop of stops.slice(1)) {
      await focusOn(root, stop);
      expect(destinationIds('post/column')).toEqual([stop]);
    }
    for (const stop of [...stops].reverse()) {
      await focusOn(root, stop);
      expect(destinationIds('post/content')).toEqual([stop]);
    }
    expect(destinationIds('post/column')).toEqual([AUTHOR(id)]);
    await unmount(root);
  });

  it('the sidebar (matrix «Sidebar»): ← from a paragraph leaves the column for `post/nav/<origin>`; → returns to that paragraph', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    const [column] = byTestId(root, 'post/column');
    // The sidebar is outside the column, and the column does not trap ← →.
    expect(within(column, 'post/nav/home')).toHaveLength(0);
    expect(column.props.trapFocusLeft).toBeFalsy();
    await focusOn(root, BLOCK(id, 'text@2'));
    await focusOn(root, 'post/nav/home');
    expect(currentRoute()).toBe('Post');
    // → from the sidebar: the content zone's (and the column's) remembered paragraph.
    expect(destinationIds('post/content')).toEqual([BLOCK(id, 'text@2')]);
    expect(destinationIds('post/column')).toEqual([BLOCK(id, 'text@2')]);
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


describe('media rows (Story 3.5, focus-map §4 F)', () => {
  const PREVIEW = 'https://example.invalid/preview';
  const okVideo = (id: string | undefined, more: Record<string, unknown> = {}) => ({
    type: 'ok_video',
    ...(id === undefined ? {} : { id }),
    ...more,
  });
  const TWO = [
    okVideo('v1', { title: 'Часть первая', duration: 754, preview: PREVIEW }),
    ...paragraph('First'),
    okVideo('v2', { title: '' }),
    ...paragraph('Second'),
  ];
  const withData = (data: unknown[]) => {
    e8 = (_req, blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, data) });
  };
  /** A row's text line (label, title or duration). */
  const lineOf = (root: Root, testID: string) => byTestId(root, testID)[0]?.props.children;
  /** The column's stops below the header, in page order (rows, then paragraphs). */
  const bodyStops = (root: Root, id: string) =>
    focusableIds(root, byTestId(root, 'post/body')[0]).filter(
      x => x.startsWith(`post/${id}/`) && x !== AUTHOR(id),
    );

  it('two videos + text (matrix «Two videos»): «Видео 1», «Видео 2» on top in block order, then the paragraphs; focus on row 1', async () => {
    withData(TWO);
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(bodyStops(root, id)).toEqual([
      VIDEO(id, 'v1'),
      VIDEO(id, 'v2'),
      BLOCK(id, 'text@1'),
      BLOCK(id, 'text@4'),
    ]);
    expect(contentIds(root)[0]).toBe(AUTHOR(id));
    expect(lineOf(root, `${VIDEO(id, 'v1')}/label`)).toBe('Видео 1');
    expect(lineOf(root, `${VIDEO(id, 'v2')}/label`)).toBe('Видео 2');
    expect(lineOf(root, `${VIDEO(id, 'v1')}/title`)).toBe('Часть первая');
    // Matrix «Duration»: 754 s → «12:34»; missing → nothing.
    expect(lineOf(root, `${VIDEO(id, 'v1')}/duration`)).toBe('12:34');
    expect(visible(root, `${VIDEO(id, 'v2')}/duration`)).toBe(false);
    // Matrix «No title»: «Видео N» only.
    expect(visible(root, `${VIDEO(id, 'v2')}/title`)).toBe(false);
    expect(one(root, VIDEO(id, 'v1')).props.accessibilityLabel).toBe('Видео 1. Часть первая. 12:34');
    expect(one(root, VIDEO(id, 'v2')).props.accessibilityLabel).toBe('Видео 2');
    // No video placeholders, no action, status or progress (Epic 4).
    expect(visible(root, BLOCK(id, 'ok_video:v1'))).toBe(false);
    for (const forbidden of ['Смотреть', 'Продолжить', 'С начала', 'Не начато', 'Осталось', 'Просмотрено']) {
      expect(pageText(root)).not.toContain(forbidden);
    }
    // Initial focus: the first row (after the skeleton's sidebar item).
    expect(focusTargets()).toEqual(['post/nav/home', VIDEO(id, 'v1')]);
    expect(destinationIds('post/column')).toEqual([VIDEO(id, 'v1')]);
    // Layout: the header first, then the rows at full width, then the text capped at the measure.
    const [scroll] = byTestId(root, 'post/body');
    expect(focusableIds(scroll)[0]).toBe(AUTHOR(id));
    const outer = (testID: string) =>
      StyleSheet.flatten(byTestId(root, testID)[0].props.style) as Record<string, unknown>;
    expect(outer(VIDEO(id, 'v1')).maxWidth).toBeUndefined();
    expect(outer(BLOCK(id, 'text@1')).maxWidth).toBe(spacing['text-measure']);
    await unmount(root);
  });

  it('one video (matrix «One video»): one row «Видео 1», focused', async () => {
    withData([okVideo('solo', { title: 'Solo', duration: 60 })]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(bodyStops(root, id)).toEqual([VIDEO(id, 'solo')]);
    expect(lineOf(root, `${VIDEO(id, 'solo')}/label`)).toBe('Видео 1');
    expect(lastFocusTarget()).toBe(VIDEO(id, 'solo'));
    await unmount(root);
  });

  it('thumbnails (matrix «No preview»): the preview URL with no headers; missing or failed → the placeholder', async () => {
    withData(TWO);
    const root = await openFromHome();
    const id = FEED_ID(0);
    const [thumb] = byTestId(root, `${VIDEO(id, 'v1')}/thumb`);
    expect(thumb.props.source).toEqual({ uri: PREVIEW });
    expect(thumb.props.resizeMethod).toBe('resize');
    expect(thumb.props.fadeDuration).toBe(0);
    expect(visible(root, `${VIDEO(id, 'v2')}/thumb-placeholder`)).toBe(true);
    await act(async () => thumb.props.onError({ nativeEvent: {} }));
    expect(visible(root, `${VIDEO(id, 'v1')}/thumb`)).toBe(false);
    expect(visible(root, `${VIDEO(id, 'v1')}/thumb-placeholder`)).toBe(true);
    // Images never go through the API transport.
    expect(transport.calls.every(c => !c.url.includes('example.invalid'))).toBe(true);
    await unmount(root);
  });

  it('a video without an id (matrix «No id»): a neutral placeholder, no row; it does not count for «Видео N»', async () => {
    withData([okVideo(undefined, { title: 'No id' }), okVideo('v2'), ...paragraph('Text')]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    const [placeholder] = byTestId(root, BLOCK(id, 'ok_video@0'));
    expect(placeholder.props.focusable).toBe(false);
    expect(placeholder.props.accessibilityLabel).toBe('Видео');
    expect(bodyStops(root, id)).toEqual([VIDEO(id, 'v2'), BLOCK(id, 'text@2')]);
    expect(lineOf(root, `${VIDEO(id, 'v2')}/label`)).toBe('Видео 1');
    await unmount(root);
  });

  it('a duplicate id (matrix «Duplicate id»): one row (the first)', async () => {
    withData([okVideo('v1', { title: 'A' }), okVideo('v1', { title: 'B' }), ...paragraph('Text')]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(bodyStops(root, id)).toEqual([VIDEO(id, 'v1'), BLOCK(id, 'text@2')]);
    expect(byTestId(root, VIDEO(id, 'v1')).filter(n => n.props.focusable === true)).toHaveLength(1);
    expect(lineOf(root, `${VIDEO(id, 'v1')}/title`)).toBe('A');
    await unmount(root);
  });

  it('locked (matrix «Locked»): no rows; focus on the author', async () => {
    e8 = (_req, blogUrl, postId) => {
      const body = e8Locked();
      return {
        status: 200,
        body: {
          ...body,
          id: postId,
          user: { ...(body.user as object), blogUrl },
          teaser: [okVideo('teaser-video'), ...(body.teaser as unknown[])],
        },
      };
    };
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(focusableIds(root).filter(x => x.startsWith(`post/${id}/video/`))).toEqual([]);
    // A teaser video is a neutral placeholder, not a row.
    expect(byTestId(root, BLOCK(id, 'ok_video:teaser-video'))[0].props.focusable).toBe(false);
    expect(contentIds(root)).toEqual([AUTHOR(id)]);
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    await unmount(root);
  });

  it('domain shape (matrix «Domain shape», live E8): no timeCode, playerUrls or signedQuery in the Post, the rows\' props, the query key or the route', async () => {
    e8 = (_req, blogUrl, postId) => {
      const body = e8Accessible();
      return { status: 200, body: { ...body, id: postId, user: { ...(body.user as object), blogUrl } } };
    };
    const root = await openFromHome();
    const id = FEED_ID(0);
    const rows = bodyStops(root, id).filter(x => x.includes('/video/'));
    expect(rows).toEqual([VIDEO(id, 'synthetic-id-7')]);
    expect(lineOf(root, `${VIDEO(id, 'synthetic-id-7')}/duration`)).toBe('1:06:00');
    const forbidden = /timeCode|playerUrls|signedQuery|example\.invalid\/player/;
    const cached = queryClient.getQueryData(queryKeys.post(FEED_BLOG, id));
    expect(JSON.stringify(cached)).not.toMatch(forbidden);
    expect(JSON.stringify(queryKeys.post(FEED_BLOG, id))).not.toMatch(forbidden);
    expect(JSON.stringify(navigationRef.getCurrentRoute()?.params)).not.toMatch(forbidden);
    // The rows' data (what MediaRow receives) and every host prop under a row.
    const post = (cached as { post: Post }).post;
    expect(JSON.stringify(videoRowsOf(post))).not.toMatch(forbidden);
    const rowNodes = root.container.queryAll(
      n => typeof n.props.testID === 'string' && n.props.testID.startsWith(`post/${id}/video/`),
    );
    expect(rowNodes.length).toBeGreaterThan(0);
    for (const node of rowNodes) {
      const props = Object.entries(node.props).filter(([key]) => key !== 'children');
      expect(JSON.stringify(props)).not.toMatch(forbidden);
    }
    expect(JSON.stringify(root.container.toJSON())).not.toMatch(forbidden);
    await unmount(root);
  });

  it('↑ ↓ through the author, the rows, then the paragraphs in one column (matrix «Up to author»); the guide remembers the last one', async () => {
    withData(TWO);
    const root = await openFromHome();
    const id = FEED_ID(0);
    const column = byTestId(root, 'post/column')[0];
    // One trapped column: ↑ from the first row reaches the author above it.
    expect(focusableIds(column)).toEqual([
      AUTHOR(id),
      VIDEO(id, 'v1'),
      VIDEO(id, 'v2'),
      BLOCK(id, 'text@1'),
      BLOCK(id, 'text@4'),
    ]);
    expect(column.props).toMatchObject({ trapFocusUp: true, trapFocusDown: true });
    await focusOn(root, VIDEO(id, 'v2'));
    expect(destinationIds('post/content')).toEqual([VIDEO(id, 'v2')]);
    expect(destinationIds('post/column')).toEqual([VIDEO(id, 'v2')]);
    await focusOn(root, BLOCK(id, 'text@1'));
    await focusOn(root, VIDEO(id, 'v2'));
    await focusOn(root, VIDEO(id, 'v1'));
    await focusOn(root, AUTHOR(id));
    expect(destinationIds('post/column')).toEqual([AUTHOR(id)]);
    expect(destinationIds('post/content')).toEqual([AUTHOR(id)]);
    await unmount(root);
  });

  it('`phaseFlags.player` reaches the rows: off → the text role and no action; on → the button role, still no action', async () => {
    withData(TWO);
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(one(root, VIDEO(id, 'v1')).props.accessibilityRole).toBe('text');
    expect(one(root, VIDEO(id, 'v1')).props.onPress).toBeUndefined();
    await unmount(root);
    mockPlayerFlag.on = true;
    try {
      const on = await openFromHome();
      expect(one(on, VIDEO(id, 'v1')).props.accessibilityRole).toBe('button');
      expect(one(on, VIDEO(id, 'v1')).props.onPress).toBeUndefined();
      expect(pageText(on)).not.toContain('Смотреть');
      await unmount(on);
    } finally {
      mockPlayerFlag.on = false;
    }
  });

  it('OK on a row does nothing (no player before Epic 4): no request, no route, no focus move', async () => {
    withData(TWO);
    const root = await openFromHome();
    const id = FEED_ID(0);
    await focusOn(root, VIDEO(id, 'v1'));
    const before = transport.calls.length;
    focusMock.mockClear();
    await press(root, VIDEO(id, 'v1'));
    expect(currentRoute()).toBe('Post');
    expect(routeNames()).toEqual(['Shell', 'Post']);
    expect(transport.calls).toHaveLength(before);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('Back from a row → the origin card; Автор from the author row and Back → the author row', async () => {
    withData(TWO);
    const root = await openFromHome(5);
    const id = FEED_ID(5);
    await focusOn(root, VIDEO(id, 'v2'));
    await focusOn(root, AUTHOR(id));
    await press(root, AUTHOR(id));
    expect(currentRoute()).toBe('Author');
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Post');
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    // The column remembers the author (the last focused element).
    expect(destinationIds('post/column')).toEqual([AUTHOR(id)]);
    await focusOn(root, VIDEO(id, 'v2'));
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(FEED_CARD(5));
    await unmount(root);
  });

  it('a refetch that drops the focused row: the initial target (the first row)', async () => {
    withData(TWO);
    const root = await openFromHome();
    const id = FEED_ID(0);
    await focusOn(root, VIDEO(id, 'v2'));
    focusMock.mockClear();
    await act(async () => {
      queryClient.setQueryData(queryKeys.post(FEED_BLOG, id), (data: any) => ({
        ...data,
        post: {
          ...data.post,
          blocks: data.post.blocks.filter((b: { type: string; id?: string }) => b.id !== 'v2'),
        },
      }));
    });
    await settle();
    expect(visible(root, VIDEO(id, 'v2'))).toBe(false);
    expect(focusTargets()).toEqual([VIDEO(id, 'v1')]);
    await unmount(root);
  });

  it('reopening the post within staleTime: from the cache, the first row at once', async () => {
    withData(TWO);
    const root = await openFromHome();
    await back();
    focusMock.mockClear();
    await press(root, FEED_CARD(0));
    expect(e8Calls()).toHaveLength(1);
    expect(focusTargets()).toEqual([VIDEO(FEED_ID(0), 'v1')]);
    await unmount(root);
  });
});

describe('locked posts (Story 3.6, focus-map §4 F)', () => {
  const TEASER_IMAGE = 'image:synthetic-id-107';
  const LIVE_LEVEL = 'redacted';
  const COPY_WITH = (level: string) =>
    `Нет доступа. Этот пост доступен подписчикам уровня «${level}». Оформить подписку можно на сайте или в приложении Boosty.`;
  const COPY_NO_LEVEL =
    'Нет доступа. Этот пост доступен подписчикам автора. Оформить подписку можно на сайте или в приложении Boosty.';
  /** The live locked E8 for any post, with these overrides. */
  const withLocked = (overrides: Record<string, unknown> = {}) => {
    e8 = (_req, blogUrl, postId) => {
      const body = e8Locked();
      return {
        status: 200,
        body: { ...body, id: postId, user: { ...(body.user as object), blogUrl }, ...overrides },
      };
    };
  };
  const copyOf = (root: Root) => byTestId(root, 'post/locked')[0];
  /** The header, the copy and the body's blocks, in page order (host views, deduped). */
  const columnOrder = (root: Root, id: string) => {
    const blocks = `post/${id}/block/`;
    const ids = byTestId(root, 'post/body')[0]
      .queryAll((n: any) => typeof n.type === 'string' && typeof n.props.testID === 'string')
      .map((n: any) => n.props.testID as string)
      .filter(
        x =>
          x === 'post/header' ||
          x === 'post/locked' ||
          (x.startsWith(blocks) && !x.slice(blocks.length).includes('/')),
      );
    return ids.filter((x, i) => ids.indexOf(x) === i);
  };

  it('with a level (matrix «Locked with level»): header, then the copy with the level, then the teaser image; focus on the author', async () => {
    const level = 'Базовый';
    withLocked({ subscriptionLevel: { ...(e8Locked().subscriptionLevel as object), name: level } });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const copy = copyOf(root);
    expect(copy.props.accessibilityLabel).toBe(COPY_WITH(level));
    expect(copy.props.accessible).toBe(true);
    expect(copy.props.focusable).toBe(false);
    expect(text(copy)).toContain(COPY_WITH(level));
    expect(columnOrder(root, id)).toEqual(['post/header', 'post/locked', BLOCK(id, TEASER_IMAGE)]);
    // The copy is not a focus stop; the author is the only one.
    expect(contentIds(root)).toEqual([AUTHOR(id)]);
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    expect(destinationIds('post/column')).toEqual([AUTHOR(id)]);
    await unmount(root);
  });

  it('the live locked E8: the copy names its level; the teaser image (non-focusable, no headers, capped)', async () => {
    withLocked();
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(copyOf(root).props.accessibilityLabel).toBe(COPY_WITH(LIVE_LEVEL));
    // The accessible, non-focusable box (a View: an accessible Image is a
    // D-pad stop on Android) and the Image inside it (not accessible).
    const [box] = byTestId(root, BLOCK(id, TEASER_IMAGE));
    expect(box.props.focusable).toBe(false);
    expect(box.props.accessible).toBe(true);
    expect(box.props.accessibilityLabel).toBe(t('post.block.image'));
    const [image] = byTestId(root, `${BLOCK(id, TEASER_IMAGE)}/image`);
    expect(image.props.source).toEqual({ uri: 'https://example.invalid/image' });
    expect(image.props.resizeMethod).toBe('resize');
    expect(image.props.fadeDuration).toBe(0);
    expect(image.props.accessible).toBeFalsy();
    expect(focusableIds(root).filter(x => x.includes('/block/image'))).toEqual([]);
    // Until the image loads: the block's 1111 × 625 aspect; an explicit box.
    const boxSize = StyleSheet.flatten(box.props.style);
    expect((boxSize.width as number) / (boxSize.height as number)).toBeCloseTo(1111 / 625);
    await unmount(root);
  });

  describe('the teaser fits the screen (owner decision 2026-10-27)', () => {
    /** The pinned device's column viewport: 720 × 486 dp (540 − 2 × 27 safe area). */
    const VIEWPORT = { width: 720, height: 486 };
    const scroll = (root: Root) => byTestId(root, 'post/body')[0];
    const boxStyle = (root: Root, key = TEASER_IMAGE) => {
      const style = StyleSheet.flatten(byTestId(root, BLOCK(FEED_ID(0), key))[0].props.style);
      const width = style.width as number;
      const height = style.height as number;
      return { width, height, aspectRatio: width / height };
    };
    /** The ScrollView's layout (the viewport). */
    const layoutColumn = (root: Root, size: { width: number; height: number }) =>
      act(async () =>
        scroll(root).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...size } } }),
      );
    /** The ScrollView's content height. */
    const contentSize = (root: Root, height: number) =>
      act(async () => scroll(root).props.onContentSizeChange(VIEWPORT.width, height));
    /** The copy's layout in the column: its bottom at `bottom`. */
    const layoutCopy = (root: Root, bottom: number) =>
      act(async () =>
        copyOf(root).props.onLayout({
          nativeEvent: { layout: { x: 12, y: bottom - 60, width: 600, height: 60 } },
        }),
      );

    it('the cap follows the measured viewport and the copy: header + copy + image fit (≈ 239 dp on the pinned device)', async () => {
      withLocked();
      const root = await openFromHome();
      await layoutColumn(root, VIEWPORT);
      // Before the copy is measured: half the viewport.
      expect(boxStyle(root).height).toBeCloseTo(243);
      // The device's layout: the copy ends at 192 dp in the column → 486 − 192 − 16 − 12 − 27 = 239.
      await layoutCopy(root, 192);
      expect(boxStyle(root).height).toBeCloseTo(239);
      expect(boxStyle(root).width).toBeCloseTo(239 * (1111 / 625));
      // A taller viewport leaves more room (the width stays under the measure).
      await layoutColumn(root, { width: 720, height: 666 });
      expect(boxStyle(root).width).toBeCloseTo(Math.min(600, (666 - 192 - 16 - 12 - 27) * (1111 / 625)));
      await unmount(root);
    });

    it('the copy measure is forgotten when the post unlocks (a refetch): a later lock measures again', async () => {
      withLocked();
      const root = await openFromHome();
      await layoutColumn(root, VIEWPORT);
      await layoutCopy(root, 470);
      expect(boxStyle(root).height).toBeCloseTo(96);
      const key = queryKeys.post(FEED_BLOG, FEED_ID(0));
      const locked = queryClient.getQueryData(key) as any;
      await act(async () => {
        queryClient.setQueryData(key, { ...locked, post: { ...locked.post, hasAccess: true } });
      });
      await settle();
      expect(visible(root, 'post/locked')).toBe(false);
      await act(async () => {
        queryClient.setQueryData(key, locked);
      });
      await settle();
      // Not the stale 470 (→ 96): half the viewport until the copy is measured again.
      expect(boxStyle(root).height).toBeCloseTo(243);
      await unmount(root);
    });

    it('a column narrower than the measure: the box shrinks with its aspect (no bars)', async () => {
      withLocked();
      const root = await openFromHome();
      await layoutColumn(root, { width: 424, height: 486 });
      await layoutCopy(root, 192);
      // 424 − 2 × 12 = 400 wide → 400 × 225 (16:9-ish block aspect kept).
      expect(boxStyle(root).width).toBeCloseTo(400);
      expect(boxStyle(root).aspectRatio).toBeCloseTo(1111 / 625);
      await unmount(root);
    });

    it('the loaded image\'s real aspect replaces the block\'s (no letterbox bars)', async () => {
      withLocked({ teaser: [{ type: 'image', id: 'synthetic-id-107', url: 'https://example.invalid/image', width: 4, height: 3 }] });
      const root = await openFromHome();
      await layoutColumn(root, VIEWPORT);
      await layoutCopy(root, 192);
      expect(boxStyle(root).aspectRatio).toBeCloseTo(4 / 3);
      expect(boxStyle(root).height).toBeCloseTo(239);
      await act(async () =>
        byTestId(root, `${BLOCK(FEED_ID(0), TEASER_IMAGE)}/image`)[0].props.onLoad({
          nativeEvent: { source: { width: 1920, height: 1080, uri: 'x' } },
        }),
      );
      expect(boxStyle(root).aspectRatio).toBeCloseTo(16 / 9);
      expect(boxStyle(root).height).toBeCloseTo(239);
      await unmount(root);
    });

    it('a locked post whose content fits with nothing focusable below the author: no scrolling, not focusable', async () => {
      withLocked();
      const root = await openFromHome();
      // Not measured yet: scrolling stays on.
      expect(scroll(root).props.scrollEnabled).toBe(true);
      await layoutColumn(root, VIEWPORT);
      await contentSize(root, VIEWPORT.height);
      // RN Android: `scrollEnabled={false}` makes the ScrollView non-focusable.
      expect(scroll(root).props.scrollEnabled).toBe(false);
      expect(focusableIds(root)).not.toContain('post/body');
      expect(destinationIds('post/column')).toEqual([AUTHOR(FEED_ID(0))]);
      await unmount(root);
    });

    it('a locked post with two teaser images overflows: it scrolls', async () => {
      withLocked({
        teaser: [
          { type: 'image', id: 'a', url: 'https://example.invalid/a', width: 16, height: 9 },
          { type: 'image', id: 'b', url: 'https://example.invalid/b', width: 16, height: 9 },
        ],
      });
      const root = await openFromHome();
      await layoutColumn(root, VIEWPORT);
      await layoutCopy(root, 192);
      await contentSize(root, 192 + 16 + 2 * (239 + 12) + 27);
      expect(scroll(root).props.scrollEnabled).toBe(true);
      await unmount(root);
    });

    it('a placeholder-only post: scrolls when it overflows, not when it fits', async () => {
      e8 = (_req, blogUrl, postId) => ({
        status: 200,
        body: postDetail(blogUrl, postId, [{ type: 'file', id: 'f1' }, { type: 'poll', id: 1 }]),
      });
      const root = await openFromHome();
      await layoutColumn(root, VIEWPORT);
      await contentSize(root, 900);
      expect(scroll(root).props.scrollEnabled).toBe(true);
      await contentSize(root, 300);
      expect(scroll(root).props.scrollEnabled).toBe(false);
      await unmount(root);
    });

    it.each([
      ['a video-only post', [{ type: 'ok_video', id: 'v1', title: 'V' }]],
      ['a text post', [...paragraph('One'), ...paragraph('Two')]],
    ])('%s (a stop below the author): scrolling stays on even when it fits', async (_name, data) => {
      e8 = (_req, blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, data) });
      const root = await openFromHome();
      await layoutColumn(root, VIEWPORT);
      await contentSize(root, 300);
      expect(scroll(root).props.scrollEnabled).toBe(true);
      await unmount(root);
    });
  });

  it.each([
    ['no subscriptionLevel', { subscriptionLevel: undefined }],
    ['a null subscriptionLevel', { subscriptionLevel: null }],
    ['a blank name', { subscriptionLevel: { name: '  ' } }],
    ['a malformed level', { subscriptionLevel: { name: 5 } }],
  ])('without a level (matrix «Locked, no level», %s): the copy without a level', async (_name, overrides) => {
    withLocked(overrides);
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(copyOf(root).props.accessibilityLabel).toBe(COPY_NO_LEVEL);
    expect(columnOrder(root, id)).toEqual(['post/header', 'post/locked', BLOCK(id, TEASER_IMAGE)]);
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    await unmount(root);
  });

  it('empty data (matrix «Empty data»): hasAccess true but data [] → treated as locked: copy + teaser', async () => {
    withLocked({ hasAccess: true, data: [] });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(copyOf(root).props.accessibilityLabel).toBe(COPY_WITH(LIVE_LEVEL));
    expect(visible(root, BLOCK(id, TEASER_IMAGE))).toBe(true);
    expect(contentIds(root)).toEqual([AUTHOR(id)]);
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    await unmount(root);
  });

  it('teaser image failure (matrix «Teaser kinds»): the neutral «Изображение» placeholder', async () => {
    withLocked();
    const root = await openFromHome();
    const id = FEED_ID(0);
    await act(async () =>
      byTestId(root, `${BLOCK(id, TEASER_IMAGE)}/image`)[0].props.onError({ nativeEvent: {} }),
    );
    expect(visible(root, `${BLOCK(id, TEASER_IMAGE)}/image`)).toBe(false);
    const [placeholder] = byTestId(root, BLOCK(id, TEASER_IMAGE));
    expect(placeholder.props.source).toBeUndefined();
    expect(placeholder.props.focusable).toBe(false);
    expect(placeholder.props.accessibilityLabel).toBe(t('post.block.image'));
    expect(text(placeholder)).toContain('Изображение');
    expect(contentIds(root)).toEqual([AUTHOR(id)]);
    await unmount(root);
  });

  it('teaser kinds (matrix «Teaser kinds»): an image without a URL → placeholder; text → a paragraph stop; video → placeholder; focus still on the author', async () => {
    withLocked({
      teaser: [
        { type: 'image', id: 'no-url', width: 100, height: 100 },
        ...paragraph('Teaser text'),
        { type: 'ok_video', id: 'teaser-video', title: 'T' },
      ],
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const [noUrl] = byTestId(root, BLOCK(id, 'image:no-url'));
    expect(noUrl.props.source).toBeUndefined();
    expect(noUrl.props.accessibilityLabel).toBe(t('post.block.image'));
    expect(one(root, BLOCK(id, 'text@1')).props.accessibilityLabel).toBe('Teaser text');
    expect(byTestId(root, BLOCK(id, 'ok_video:teaser-video'))[0].props.focusable).toBe(false);
    expect(focusableIds(root).filter(x => x.startsWith(`post/${id}/video/`))).toEqual([]);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@1')]);
    expect(columnOrder(root, id)).toEqual([
      'post/header',
      'post/locked',
      BLOCK(id, 'image:no-url'),
      BLOCK(id, 'text@1'),
      BLOCK(id, 'ok_video:teaser-video'),
    ]);
    // Locked → the author, even with a teaser paragraph.
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    await unmount(root);
  });

  it('no teaser (matrix «Teaser kinds», none): header and copy only', async () => {
    withLocked({ teaser: [] });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(columnOrder(root, id)).toEqual(['post/header', 'post/locked']);
    expect(contentIds(root)).toEqual([AUTHOR(id)]);
    await unmount(root);
  });

  it('price fields (matrix «Price fields»): never shown; no subscribe action, QR or level list; no refresh, A11 or extra E1', async () => {
    withLocked({ price: 990, currencyPrices: { RUB: 990, USD: 11, EUR: 10 }, promo: { price: 1 } });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const e1Calls = transport.callsTo(E1).length;
    const page = pageText(root);
    for (const forbidden of ['990', '₽', 'RUB', 'USD', 'EUR', 'руб', 'Подписаться', 'QR', 'коммент']) {
      expect(page).not.toContain(forbidden);
    }
    // The only button on the page is the author row; the copy is text.
    const buttons = byTestId(root, 'post/page')[0]
      .queryAll((n: any) => typeof n.type === 'string' && n.props.accessibilityRole === 'button')
      .map((n: any) => n.props.testID);
    expect(buttons).toEqual([AUTHOR(id)]);
    expect(copyOf(root).props.accessibilityRole).toBe('text');
    expect(transport.callsTo('/oauth/token/')).toHaveLength(0);
    expect(visible(root, 'auth/expired')).toBe(false);
    expect(visible(root, 'post/error')).toBe(false);
    expect(currentRoute()).toBe('Post');
    await settle();
    expect(transport.callsTo(E1)).toHaveLength(e1Calls);
    await unmount(root);
  });

  it('an accessible post has no locked copy', async () => {
    const root = await openFromHome();
    expect(visible(root, 'post/locked')).toBe(false);
    await unmount(root);
  });

  it('from Автор (matrix «Card»): the locked copy, focus on the author; Back → the same card', async () => {
    withLocked();
    const root = await openFromAuthor(2);
    const id = 'blog-post-2';
    expect(copyOf(root).props.accessibilityLabel).toBe(COPY_WITH(LIVE_LEVEL));
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Author');
    expect(lastFocusTarget()).toBe(AUTHOR_CARD(2));
    await unmount(root);
  });
});
