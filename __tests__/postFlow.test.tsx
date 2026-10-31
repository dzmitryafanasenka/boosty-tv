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
import { QUERY_STALE_TIME_MS, queryKeys } from '../src/shared/api';
import { QR_CLOSE_ID } from '../src/shared/ui';
import { DEFAULT_FILTER } from '../src/shared/filters';
import {
  type FixtureReply,
  type FixtureRequest,
  type FixtureTransport,
} from '../src/shared/api/fixtureTransport';
import { videoRowsOf, type Post } from '../src/shared/entities/post';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { progressStore } from '../src/shared/services/progress';
import { colors, spacing } from '../src/shared/ui';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { engine } from '../src/test/playerEngineMock';
import { playbackArbiter } from '../src/shared/platform/playbackArbiter';
import { e3Body, syntheticBlogPosts } from '../src/test/authorFixtures';
import { E5_PATH, syntheticFeed } from '../src/test/feedFixtures';
import e1Unauthorized from '../src/test/fixtures/boosty/e1-no-token.json';
import e8NoToken from '../src/test/fixtures/boosty/e8-no-token.json';
import refreshRejected from '../src/test/fixtures/boosty/refresh-invalid-grant.json';
import refreshOk from '../src/test/fixtures/boosty/refresh-ok.json';
import {
  blockEnd,
  e8Accessible,
  e8Locked,
  e8MissingReply,
  paragraph,
  postDetail,
  text as textBlock,
} from '../src/test/postFixtures';
import {
  E2_PATH,
  blogUrlOf,
  e1NoBlogBody,
  subscriptionsBody,
} from '../src/test/subscriptionFixtures';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  deferred,
  destinationIds,
  focusableIds,
  focusTargets,
  guideDestinations,
  installFixtureTransport,
  installNativeModules,
  lastFocusTarget,
  lists,
  resetKeychain,
  resetRecorders,
  text,
  unmount,
  visible,
} from '../src/test/flow';
import { frames, installFrameQueue } from '../src/test/frames';

jest.mock('react-native-keychain');
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));
jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

jest.mock('react-native/Libraries/Components/TV/TVFocusGuideView', () =>
  require('../src/test/flow').recordingFocusGuideModule(),
);
/** Story 6.4: the AudioBlock's (and the Player's) engine (`src/test/playerEngineMock`). */
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));
/** Remote keys for the AudioBlock's ← → (`key()`). */
jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () => require('../src/test/tvEventMock'));

/** The real FlashList behind the recorder `lists` (`src/test/flow`; `onEndReached` held back). */
jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());

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

/**
 * Story 6.3: the QrRenderer port records the values it draws (the test reads
 * the QR target from here; the host tree carries only a testID, so a signed
 * value never reaches the rendered JSON through the mock).
 */
const mockQrValues: string[] = [];
jest.mock('../src/shared/platform/qrRenderer', () => ({
  QR_QUIET_ZONE: 16,
  QrCode: (props: { value: string; testID?: string }) => {
    mockQrValues.push(props.value);
    return require('react').createElement('QrCodeMock', { testID: props.testID });
  },
}));

const focusMock = requestHostFocus as jest.Mock;

/** As authorFlow: 30 rounds, no timers unless a row needs the AD-6 backoff or a transition. */
const { settle, render, one, focusOn, press, back, key: remoteKey } = createFlow({
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
/** Story 6.6: an open single-choice poll's option stop. */
const OPTION = (postId: string, optionId: string) => `post/${postId}/poll/option/${optionId}`;
const ACTION = 'state/post/action';
const E8_RE = /^\/v1\/blog\/([^/]+)\/post\/([^/]+)$/;

type Reply = FixtureReply | Promise<FixtureReply> | undefined;
/** E8 by `{blogUrl, postId}`; default: 3 paragraphs and 5 likes. */
let e8: (req: FixtureRequest, blogUrl: string, postId: string) => Reply;
let transport: FixtureTransport;
/** The default transport handler (E1, E5, E2, E3, E4, E8), set in `beforeEach`. */
let fullHandler: (req: FixtureRequest) => Reply;

const THREE = [...paragraph('First'), ...paragraph('Second'), ...paragraph('Third')];

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
  resetRecorders();
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
      return { status: 200, body: e1NoBlogBody() };
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
  // Story 4.2: no progress (local entries, server values, held writes) leaks between tests.
  await progressStore.reset();
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
  it('image, audio (the player off, Story 6.4), poll, unknown: one non-focusable placeholder each, in order; text (and a standalone link\'s text, with its chip) and a file chip (Story 6.3) between them; the video is a MediaRow on top', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [
        { type: 'ok_video', id: 'v1', title: 'Video', playerUrls: [{ type: 'hd', url: '' }] },
        ...paragraph('Between'),
        // No URL: still a placeholder (an image with a URL is a stop, Story 6.2).
        { type: 'image', id: 'i1' },
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
      BLOCK(id, 'link@4/link/0'),
      BLOCK(id, 'file:f1'),
      BLOCK(id, 'text@9'),
    ]);
    expect(one(root, BLOCK(id, 'link@4')).props.accessibilityLabel).toBe('Link');
    expect(one(root, BLOCK(id, 'file:f1')).props.accessibilityLabel).toBe('File. Показать QR-код');
    // Order on the page: Between, image, link (as text), file, audio, poll, unknown, After.
    const order = byTestId(root, 'post/body')[0]
      .queryAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith(`post/${id}/block/`) && !n.props.testID.endsWith('/scale'))
      .map(n => n.props.testID as string);
    expect([...new Set(order)].filter(o => !/\/(links|busy|guide|play|time|bar)$|\/link\/0$/.test(o))).toEqual([
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

  it('an inline link (matrix «Inline link»): one paragraph with the link text, no placeholder; its LinkChip under it (Story 6.3)', async () => {
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
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@0'), BLOCK(id, 'text@0/link/0')]);
    expect(one(root, BLOCK(id, 'text@0')).props.accessibilityLabel).toBe('Подробнее здесь и ниже.');
    expect(pageText(root)).not.toContain('Ссылка');
    await unmount(root);
  });

  it('styled text and an inline emoji (Story 6.1, matrix «Styles», «Emoji»): nested runs, emoji at text size; a failed emoji leaves no gap', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [
        { type: 'text', content: JSON.stringify(['Привет мир ', 'unstyled', [[0, 0, 6], [2, 7, 3]]]), modificator: '' },
        // Live, ranges count from the paragraph start: «ссылка» starts at 11.
        { type: 'link', content: JSON.stringify(['ссылка', 'unstyled', [[4, 11, 6]]]), url: 'https://example.invalid/link' },
        { type: 'smile', name: 'smile', mediumUrl: 'https://example.invalid/emoji' },
        textBlock(' хвост'),
        blockEnd(),
      ]),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const block = BLOCK(id, 'text@0');
    expect(contentIds(root)).toEqual([AUTHOR(id), block, `${block}/link/0`]);
    // The accessibility label stays the plain text (the emoji left out).
    expect(one(root, block).props.accessibilityLabel).toBe('Привет мир ссылка хвост');
    const node = byTestId(root, block)[0];
    const runs = node
      .queryAll((n: any) => (n.type === 'RCTText' || n.type === 'Text') && n.children.every((c: unknown) => typeof c === 'string'))
      .map((n: any) => ({ text: n.children.join(''), style: StyleSheet.flatten(n.props.style) ?? {} }));
    const styleOf = (s: string) => runs.find(r => r.text === s)?.style as Record<string, unknown> | undefined;
    expect(styleOf('Привет')).toMatchObject({ fontFamily: 'GolosText-SemiBold' });
    expect(styleOf('Привет')?.fontWeight).toBeUndefined();
    expect(styleOf('мир')).toMatchObject({ fontStyle: 'italic' });
    expect(styleOf('ссылка')).toMatchObject({ textDecorationLine: 'underline' });
    expect(styleOf(' хвост')?.fontStyle).toBeUndefined();
    // The emoji: a plain {uri} image (no headers) at the body line height, not focusable.
    const emojiId = `${block}/emoji/smile@2`;
    const emoji = byTestId(root, emojiId)[0];
    expect(emoji.props.source).toEqual({ uri: 'https://example.invalid/emoji' });
    expect(StyleSheet.flatten(emoji.props.style)).toMatchObject({ width: 22, height: 22 });
    expect(emoji.props.focusable).toBe(false);
    await act(async () => emoji.props.onError({ nativeEvent: {} }));
    expect(byTestId(root, emojiId)).toHaveLength(0);
    expect(one(root, block).props.accessibilityLabel).toBe('Привет мир ссылка хвост');
    expect(text(byTestId(root, block)[0])).toContain('хвост');
    expect(contentIds(root)).toEqual([AUTHOR(id), block, `${block}/link/0`]);
    await unmount(root);
  });

  it('an emoji-only paragraph (Story 6.1): shown, never a focus stop, also after its image fails', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [
        { type: 'smile', name: 'smile', mediumUrl: 'https://example.invalid/emoji' },
        blockEnd(),
        ...paragraph('Text'),
      ]),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const emojiId = `${BLOCK(id, 'smile@0')}/emoji/smile@0`;
    expect(byTestId(root, emojiId)).toHaveLength(1);
    expect(byTestId(root, BLOCK(id, 'smile@0'))[0].props.focusable).toBe(false);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@2')]);
    await act(async () => byTestId(root, emojiId)[0].props.onError({ nativeEvent: {} }));
    expect(byTestId(root, emojiId)).toHaveLength(0);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@2')]);
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
    // Still signed in: no A11. The session check (A6, below) ran one E1 and
    // its one refetch, which is locked again: nothing more.
    expect(currentRoute()).toBe('Post');
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(e8Calls()).toHaveLength(2);
    await unmount(root);
  });

  describe('a locked E8 checks the session first (Epic 3 retro A6)', () => {
    const TOKEN = '/oauth/token/';
    const REFRESHED = `Bearer ${refreshOk.body.access_token}`;
    /** The stored token died after the cold start: E1 401, E8 anonymous (locked). */
    let dead: boolean;
    let e1Reply: () => FixtureReply;

    /** The live no-token E8 (200, `hasAccess=false`, empty `data`) for this post. */
    const anonymous = (blogUrl: string, postId: string): FixtureReply => ({
      status: e8NoToken.status,
      body: { ...e8NoToken.body, id: postId, user: { ...(e8NoToken.body.user as object), blogUrl } },
    });

    function install(refresh: FixtureReply) {
      dead = false;
      e1Reply = () => ({ status: e1Unauthorized.status, body: e1Unauthorized.body });
      installNativeModules(INSTALL_ID);
      transport = installFixtureTransport(req => {
        const stale = dead && req.headers.Authorization !== REFRESHED;
        if (req.path === TOKEN) {
          return refresh;
        }
        if (stale && req.path === E1) {
          return e1Reply();
        }
        const single = E8_RE.exec(req.path);
        if (stale && single) {
          return anonymous(decodeURIComponent(single[1]), decodeURIComponent(single[2]));
        }
        return fullHandler(req);
      });
    }

    /**
     * Cold start (E1 200), then the token dies and OK on a card opens Пост.
     * `timers` only for the AD-6 backoff and the reset to A11: running every
     * pending timer also moves the fake clock past the 5 min window (the
     * query gc timers).
     */
    async function openDead({ timers = false } = {}) {
      const root = await render(<App />);
      expect(transport.callsTo(E1)).toHaveLength(1);
      dead = true;
      await focusOn(root, FEED_CARD(0));
      await press(root, FEED_CARD(0), timers ? { settle: WITH_TIMERS } : undefined);
      return root;
    }

    it('dead session (E1 401 → refresh invalid_grant): A11, no «Нет доступа» behind it', async () => {
      install({ status: refreshRejected.status, body: refreshRejected.body });
      const root = await openDead({ timers: true });
      expect(transport.callsTo(E1)).toHaveLength(2);
      expect(transport.callsTo(TOKEN)).toHaveLength(1);
      expect(e8Calls()).toHaveLength(1);
      expect(routeNames()).toEqual(['Expired']);
      expect(visible(root, 'post')).toBe(false);
      expect(lastFocusTarget()).toBe('auth/expired/relogin');
      await unmount(root);
    });

    it('silent refresh (E1 401 → refresh ok → 200): one refetch with the new token, the post opens', async () => {
      install({ status: refreshOk.status, body: refreshOk.body });
      const root = await openDead();
      expect(transport.callsTo(TOKEN)).toHaveLength(1);
      expect(e8Calls()).toHaveLength(2);
      expect(e8Calls()[1].headers.Authorization).toBe(REFRESHED);
      expect(currentRoute()).toBe('Post');
      expect(visible(root, BLOCK(FEED_ID(0), 'text@0'))).toBe(true);
      expect(visible(root, 'auth/expired')).toBe(false);
      await unmount(root);
    });

    it('truly locked (E1 200): one refetch, still locked; no E1 for another locked post within 5 min, one after', async () => {
      install({ status: refreshOk.status, body: refreshOk.body });
      e1Reply = () => ({ status: 200, body: e1NoBlogBody() });
      const root = await openDead();
      expect(transport.callsTo(E1)).toHaveLength(2);
      expect(transport.callsTo(TOKEN)).toHaveLength(0);
      expect(e8Calls()).toHaveLength(2);
      expect(visible(root, 'post/header')).toBe(true);
      expect(visible(root, BLOCK(FEED_ID(0), 'text@0'))).toBe(false);
      await back();
      // Another locked post inside the window: its E8 only.
      await focusOn(root, FEED_CARD(1));
      await press(root, FEED_CARD(1));
      expect(transport.callsTo(E1)).toHaveLength(2);
      expect(e8Calls()).toHaveLength(3);
      await back();
      // Past the window: one E1 and one refetch again.
      await act(async () => {
        jest.advanceTimersByTime(5 * 60 * 1000);
      });
      await focusOn(root, FEED_CARD(2));
      await press(root, FEED_CARD(2));
      expect(transport.callsTo(E1)).toHaveLength(3);
      expect(e8Calls()).toHaveLength(5);
      expect(visible(root, 'auth/expired')).toBe(false);
      await unmount(root);
    });

    it('a failed E1 drops the window; a cached locked post re-opened within staleTime sends no E1 (and no E8)', async () => {
      install({ status: refreshOk.status, body: refreshOk.body });
      // 403 → `Client`: not retried (AD-6), the session is kept.
      e1Reply = () => ({ status: 403, body: { error: 'forbidden' } });
      const root = await openDead();
      expect(transport.callsTo(E1)).toHaveLength(2);
      expect(e8Calls()).toHaveLength(1);
      expect(visible(root, 'post/header')).toBe(true);
      await back();
      // Cached and fresh: no queryFn, so no check.
      await focusOn(root, FEED_CARD(0));
      await press(root, FEED_CARD(0));
      expect(currentRoute()).toBe('Post');
      expect(e8Calls()).toHaveLength(1);
      expect(transport.callsTo(E1)).toHaveLength(2);
      await back();
      // Stale: a fresh E8, locked again; the dropped window lets it check at once.
      await act(async () => {
        jest.advanceTimersByTime(QUERY_STALE_TIME_MS + 1);
      });
      await focusOn(root, FEED_CARD(0));
      await press(root, FEED_CARD(0));
      expect(e8Calls()).toHaveLength(2);
      expect(transport.callsTo(E1)).toHaveLength(3);
      expect(visible(root, 'auth/expired')).toBe(false);
      await unmount(root);
    });

    it('offline (E1 Network): the locked post as today, no refetch, no A11', async () => {
      install({ status: refreshOk.status, body: refreshOk.body });
      e1Reply = () => ({ network: true });
      const root = await openDead({ timers: true });
      // The cold-start E1, then the check's E1 with its AD-6 retries (3 attempts).
      expect(transport.callsTo(E1)).toHaveLength(4);
      expect(transport.callsTo(TOKEN)).toHaveLength(0);
      expect(e8Calls()).toHaveLength(1);
      expect(currentRoute()).toBe('Post');
      expect(visible(root, 'post/header')).toBe(true);
      expect(visible(root, 'post/error')).toBe(false);
      expect(lastFocusTarget()).toBe(AUTHOR(FEED_ID(0)));
      await unmount(root);
    });
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

  it.each([
    ['focus still tracked on the vanished paragraph → a second request two frames later', false, 2],
    ['the user focused another stop meanwhile → no second request', true, 1],
  ] as const)('a refetch that drops the focused paragraph (`focusAfterUnmount`): %s', async (_name, movedAway, requests) => {
    installFrameQueue();
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
    // Sent at once (device: a request in the unmount's commit can be lost) …
    expect(focusTargets()).toEqual([BLOCK(id, 'text@0')]);
    if (movedAway) {
      await focusOn(root, AUTHOR(id));
    }
    await frames(1);
    expect(focusTargets()).toHaveLength(1);
    // … and once more two frames later while the tracked id is still the vanished one.
    await frames(1);
    expect(focusTargets()).toEqual(Array(requests).fill(BLOCK(id, 'text@0')));
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
    lists.scrollToIndex.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(FEED_CARD(5));
    // Same index: no scroll by index.
    expect(lists.scrollToIndex).not.toHaveBeenCalled();
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    // Главная was not requested again.
    expect(transport.callsTo(E5_PATH)).toHaveLength(1);
    await unmount(root);
  });

  it('Главная: the card is gone on return → its neighbor by index', async () => {
    const root = await openFromHome(5);
    await act(async () => {
      type Data = { pages: Array<{ posts: Array<{ id: string }> }> };
      queryClient.setQueryData<Data>(queryKeys.subscriptionFeed(DEFAULT_FILTER), data =>
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
      queryClient.setQueryData<Data>(queryKeys.authorPosts(AUTHOR_BLOG, DEFAULT_FILTER), data =>
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
      'post/nav/search',
      'post/nav/subs',
      'post/nav/events',
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

  it('`phaseFlags.player` reaches the rows: off → the text role, no «Смотреть»; on → the button role and «Смотреть» (Story 4.1, playerFlow)', async () => {
    withData(TWO);
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(one(root, VIDEO(id, 'v1')).props.accessibilityRole).toBe('text');
    expect(one(root, VIDEO(id, 'v1')).props.onPress).toBeUndefined();
    expect(pageText(root)).not.toContain('Смотреть');
    expect(visible(root, `post/${id}/primary`)).toBe(false);
    await unmount(root);
    mockPlayerFlag.on = true;
    try {
      const on = await openFromHome();
      expect(one(on, VIDEO(id, 'v1')).props.accessibilityRole).toBe('button');
      expect(one(on, `post/${id}/primary`).props.accessibilityLabel).toBe('Смотреть · Видео 1');
      await unmount(on);
    } finally {
      mockPlayerFlag.on = false;
    }
  });

  it('Story 4.2: the server `timeCode` shows a status and «Продолжить» only while the player is on', async () => {
    withData([
      { type: 'ok_video', id: 'v1', title: 'Часть первая', duration: 600, timeCode: 590 },
      { type: 'ok_video', id: 'v2', title: '', duration: 600, timeCode: 120 },
      ...paragraph('Текст'),
    ]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    for (const forbidden of ['Продолжить', 'С начала', 'Не начато', 'Осталось', 'Просмотрено']) {
      expect(pageText(root)).not.toContain(forbidden);
    }
    expect(visible(root, `${VIDEO(id, 'v1')}/progress`)).toBe(false);
    await unmount(root);
    mockPlayerFlag.on = true;
    try {
      const on = await openFromHome();
      expect(one(on, `post/${id}/primary`).props.accessibilityLabel).toBe('Продолжить · Видео 2');
      expect(one(on, `post/${id}/restart`).props.accessibilityLabel).toBe('С начала');
      expect(lineOf(on, `${VIDEO(id, 'v1')}/status`)).toBe('Просмотрено');
      expect(lineOf(on, `${VIDEO(id, 'v2')}/status`)).toBe('Осталось 8 мин');
      expect(visible(on, `${VIDEO(id, 'v1')}/progress`)).toBe(true);
      // Initial focus stays on the primary; «С начала» is its right neighbour.
      expect(lastFocusTarget()).toBe(`post/${id}/primary`);
      await unmount(on);
    } finally {
      mockPlayerFlag.on = false;
    }
  });

  it('Story 4.2: a started video without a duration: «Продолжить» and «С начала», no status, no line, no status in the label', async () => {
    withData([{ type: 'ok_video', id: 'v1', title: 'Часть первая', timeCode: 120 }, ...paragraph('Текст')]);
    mockPlayerFlag.on = true;
    try {
      const root = await openFromHome();
      const id = FEED_ID(0);
      expect(one(root, `post/${id}/primary`).props.accessibilityLabel).toBe('Продолжить');
      expect(visible(root, `post/${id}/restart`)).toBe(true);
      expect(visible(root, `${VIDEO(id, 'v1')}/status`)).toBe(false);
      expect(visible(root, `${VIDEO(id, 'v1')}/progress`)).toBe(false);
      expect(one(root, VIDEO(id, 'v1')).props.accessibilityLabel).toBe('Видео 1. Часть первая');
      await unmount(root);
    } finally {
      mockPlayerFlag.on = false;
    }
  });

  it('player off: OK on a row does nothing: no request, no route, no focus move', async () => {
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
        // Placeholders only (a file is a chip stop since Story 6.3, audio an AudioBlock since 6.4).
        body: postDetail(blogUrl, postId, [{ type: 'brand_new_block' }, { type: 'poll', id: 1 }]),
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

describe('Story 6.2: images in a post', () => {
  const IMG = 'https://example.invalid/image';
  const flat = (node: { props: Record<string, unknown> }) =>
    (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

  it('an image is a focus stop between paragraphs: column-capped, aspect kept, max 300 dp, skeleton until loaded; loading never moves focus', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [
        ...paragraph('Before'),
        { type: 'image', id: 'i1', url: IMG, width: 800, height: 600 },
        ...paragraph('After'),
      ]),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const image = BLOCK(id, 'image:i1');
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@0'), image, BLOCK(id, 'text@3')]);
    expect(lastFocusTarget()).toBe(BLOCK(id, 'text@0'));
    expect(one(root, image).props.accessibilityLabel).toBe('Изображение');
    const img = byTestId(root, `${image}/image`)[0];
    expect(img.props.source).toEqual({ uri: IMG });
    // 4:3 at most 300 dp tall → 400 × 300 (under the 600 dp text measure).
    const box = () => flat(byTestId(root, `${image}/box`)[0]);
    expect(box()).toMatchObject({ width: 400, height: 300, backgroundColor: colors.skeleton });
    focusMock.mockClear();
    // The real image is 16:9: the box follows it (600 × 337.5 under the 300 cap → 533.3 × 300).
    await act(async () => img.props.onLoad({ nativeEvent: { source: { width: 1600, height: 900 } } }));
    expect(box().height).toBe(300);
    expect(box().width as number).toBeCloseTo(533.33, 1);
    expect(box().backgroundColor).toBe(colors.surface);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('a failed image: «Изображение недоступно» in the same stop; the rest of the post unaffected', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [
        { type: 'image', id: 'i1', url: IMG },
        ...paragraph('After'),
      ]),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const image = BLOCK(id, 'image:i1');
    // No video, the image first: the image is the initial focus.
    expect(lastFocusTarget()).toBe(image);
    focusMock.mockClear();
    await act(async () => byTestId(root, `${image}/image`)[0].props.onError({ nativeEvent: {} }));
    expect(byTestId(root, `${image}/image`)).toHaveLength(0);
    expect(text(byTestId(root, `${image}/failed`)[0])).toContain('Изображение недоступно');
    expect(one(root, image).props.accessibilityLabel).toBe('Изображение недоступно');
    // A neutral box (not the loading skeleton), large enough for the message.
    const failedBox = flat(byTestId(root, `${image}/box`)[0]);
    expect(failedBox.backgroundColor).toBe(colors.surface);
    expect(failedBox.height as number).toBeGreaterThanOrEqual(96);
    expect(contentIds(root)).toEqual([AUTHOR(id), image, BLOCK(id, 'text@1')]);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('no size in the block: a 16:9 box (533 × 300); an onLoad without a size keeps it and clears the skeleton', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [{ type: 'image', id: 'i1', url: IMG }, ...paragraph('After')]),
    });
    const root = await openFromHome();
    const image = BLOCK(FEED_ID(0), 'image:i1');
    const box = () => flat(byTestId(root, `${image}/box`)[0]);
    expect(box().height).toBe(300);
    expect(box().width as number).toBeCloseTo(533.33, 1);
    await act(async () => byTestId(root, `${image}/image`)[0].props.onLoad({ nativeEvent: {} }));
    expect(box().width as number).toBeCloseTo(533.33, 1);
    expect(box().backgroundColor).toBe(colors.surface);
    await unmount(root);
  });
});

/* eslint-disable no-script-url -- Story 6.3: unsafe URLs are inputs the code must reject */
describe('Story 6.3: links, files and external videos via QR', () => {
  const SECRET = 'SECRETSIGNATURE';
  const SIGNED = `?user_id=1001&content_id=1002&expire_time=1700003600&sign=${SECRET}`;
  const FILE_URL = 'https://example.invalid/file/report';
  const link = (s: string, url: string) => ({ type: 'link', content: JSON.stringify([s, 'unstyled', []]), url });
  const lastQr = () => mockQrValues[mockQrValues.length - 1];
  const dialogOpen = (root: Root) => visible(root, 'dialog/qr');
  const allLogs = () =>
    JSON.stringify([
      logger.entries(),
      (console.log as jest.Mock).mock.calls,
      (console.warn as jest.Mock).mock.calls,
      (console.error as jest.Mock).mock.calls,
    ]);
  const cacheText = () => JSON.stringify(queryClient.getQueryCache().getAll().map(q => q.state.data ?? null));

  beforeEach(() => {
    mockQrValues.length = 0;
  });

  const BLOCKS = [
    textBlock('Читайте '),
    link('тут', 'https://example.invalid/a'),
    textBlock(', '),
    link('там', 'https://example.invalid/b'),
    textBlock(' и снова '),
    link('тут ещё', 'https://example.invalid/a'),
    textBlock(' '),
    link('скрипт', 'javascript:alert(1)'),
    blockEnd(),
    { type: 'header', content: JSON.stringify(['Раздел', 'unstyled', []]), modificator: '' },
    ...paragraph('После заголовка'),
    { type: 'file', id: 'f1', title: 'report.pdf', size: 204800, url: FILE_URL },
    { type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' },
    { type: 'video', url: 'https://example.invalid/video' },
  ];
  const withBlocks = (data: unknown[] = BLOCKS) => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, data, { signedQuery: SIGNED }),
    });
  };
  const ids = (id: string) => ({
    para: BLOCK(id, 'text@0'),
    linkA: BLOCK(id, 'text@0/link/0'),
    linkB: BLOCK(id, 'text@0/link/1'),
    heading: BLOCK(id, 'header@9'),
    after: BLOCK(id, 'text@10'),
    file: BLOCK(id, 'file:f1'),
    youtube: BLOCK(id, 'video@13'),
    other: BLOCK(id, 'video@14'),
  });

  it('matrix «Link», «Header»: inline text + 2 chips (the repeat collapsed, no chip for javascript:); a bold non-focusable heading; chips, file and videos are stops in column order', async () => {
    withBlocks();
    const root = await openFromHome();
    const id = FEED_ID(0);
    const b = ids(id);
    expect(contentIds(root)).toEqual([AUTHOR(id), b.para, b.linkA, b.linkB, b.after, b.file, b.youtube, b.other]);
    expect(one(root, b.para).props.accessibilityLabel).toBe('Читайте тут, там и снова тут ещё скрипт');
    expect(one(root, b.linkA).props.accessibilityLabel).toBe('тут. Показать QR-код');
    expect(one(root, b.linkB).props.accessibilityLabel).toBe('там. Показать QR-код');
    expect(text(byTestId(root, b.linkA)[0])).toContain('QR');
    // LinkChip: a 32 dp pill on `surface-raised`.
    const surface = byTestId(root, `${b.linkA}/scale`)[0];
    expect(StyleSheet.flatten(surface.props.style)).toMatchObject({ height: 32, backgroundColor: colors['surface-raised'] });
    // The heading: shown, bold (section, SemiBold), never focusable; the next paragraph is separate.
    const heading = byTestId(root, b.heading)[0];
    expect(heading.props.focusable).toBe(false);
    expect(text(heading)).toContain('Раздел');
    const headingText = heading.queryAll((n: any) => n.props.accessibilityRole === 'header')[0];
    expect(StyleSheet.flatten(headingText.props.style)).toMatchObject({ fontFamily: 'GolosText-SemiBold' });
    expect(one(root, b.after).props.accessibilityLabel).toBe('После заголовка');
    // Initial focus unchanged: the first stop (the paragraph).
    expect(lastFocusTarget()).toBe(b.para);
    await unmount(root);
  });

  it('matrix «Open QR», «Close»: OK on a link chip → the QrDialog (title, QR of the URL, «Откроется на телефоне», «Закрыть» focused, trapped); Back closes it, focus back on the chip; the next Back pops', async () => {
    withBlocks();
    const root = await openFromHome();
    const b = ids(FEED_ID(0));
    focusMock.mockClear();
    await press(root, b.linkB);
    expect(dialogOpen(root)).toBe(true);
    expect(currentRoute()).toBe('Post');
    expect(lastQr()).toBe('https://example.invalid/b');
    const [content] = byTestId(root, 'modal/content');
    const dialogText = text(content);
    expect(dialogText).toContain('там');
    expect(dialogText).toContain('Откроется на телефоне');
    expect(focusableIds(root, content)).toEqual([QR_CLOSE_ID]);
    expect(one(root, QR_CLOSE_ID).props.hasTVPreferredFocus).toBe(true);
    expect(focusTargets()).toContain(QR_CLOSE_ID);
    const [trap] = byTestId(root, 'modal/trap');
    expect(trap.props).toMatchObject({ trapFocusUp: true, trapFocusDown: true, trapFocusLeft: true, trapFocusRight: true });
    expect(byTestId(root, 'modal/background')[0].props.importantForAccessibility).toBe('no-hide-descendants');
    // Nothing was requested and nothing opened on the TV.
    expect(e8Calls()).toHaveLength(1);
    focusMock.mockClear();
    await back();
    expect(dialogOpen(root)).toBe(false);
    expect(currentRoute()).toBe('Post');
    expect(lastFocusTarget()).toBe(b.linkB);
    await back();
    expect(currentRoute()).toBe('Shell');
    await unmount(root);
  });

  it('device fix: every chip sits in a full-measure autoFocus guide (↓ from a wide paragraph reaches a narrow chip right below it)', async () => {
    withBlocks();
    const root = await openFromHome();
    const b = ids(FEED_ID(0));
    for (const guide of [`${b.linkA}/guide`, `${b.file}/guide`, `${b.youtube}/guide`, `${b.other}/guide`]) {
      const [node] = byTestId(root, guide);
      expect(node.props.autoFocus).toBe(true);
      expect(StyleSheet.flatten(node.props.style)).toMatchObject({ alignSelf: 'stretch', maxWidth: spacing['text-measure'] });
    }
    // Both link chips share their paragraph's guide.
    const [row] = byTestId(root, `${b.linkA}/guide`);
    expect(focusableIds(root, row)).toEqual([b.linkA, b.linkB]);
    await unmount(root);
  });

  it('«Закрыть» closes the dialog, focus back on the chip', async () => {
    withBlocks();
    const root = await openFromHome();
    const b = ids(FEED_ID(0));
    await press(root, b.linkA);
    expect(lastQr()).toBe('https://example.invalid/a');
    focusMock.mockClear();
    await press(root, QR_CLOSE_ID);
    expect(dialogOpen(root)).toBe(false);
    expect(lastFocusTarget()).toBe(b.linkA);
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('matrix «File», «Privacy»: «report.pdf · 200 КБ»; OK → one fresh E8 → QR of url + signedQuery, never in text, logs or the cache; close → the chip', async () => {
    withBlocks();
    const root = await openFromHome();
    const b = ids(FEED_ID(0));
    expect(text(byTestId(root, b.file)[0])).toContain('report.pdf · 200 КБ');
    expect(one(root, b.file).props.accessibilityLabel).toBe('report.pdf · 200 КБ. Показать QR-код');
    expect(e8Calls()).toHaveLength(1);
    focusMock.mockClear();
    await press(root, b.file);
    expect(e8Calls()).toHaveLength(2);
    expect(dialogOpen(root)).toBe(true);
    expect(lastQr()).toBe(`${FILE_URL}${SIGNED}`);
    expect(text(byTestId(root, 'modal/content')[0])).toContain('report.pdf');
    // The signed value is drawn only: not in the tree, the logs or any query cache entry.
    expect(text(root)).not.toContain(SECRET);
    expect(text(root)).not.toContain(FILE_URL);
    expect(allLogs()).not.toContain(SECRET);
    expect(allLogs()).not.toContain(FILE_URL);
    expect(cacheText()).not.toContain(SECRET);
    expect(cacheText()).not.toContain(FILE_URL);
    await back();
    expect(dialogOpen(root)).toBe(false);
    expect(lastFocusTarget()).toBe(b.file);
    await unmount(root);
  });

  it('matrix «File» error: busy while E8 runs (a second OK sends nothing); a failure → «Не удалось открыть файл» on the chip, no dialog; OK again retries', async () => {
    withBlocks();
    const root = await openFromHome();
    const b = ids(FEED_ID(0));
    const pending = deferred();
    e8 = () => pending.promise as never;
    await press(root, b.file);
    expect(visible(root, `${b.file}/busy`)).toBe(true);
    expect(one(root, b.file).props.accessibilityLabel).toBe('report.pdf · 200 КБ. Загружаем ссылку');
    await press(root, b.file);
    expect(e8Calls()).toHaveLength(2);
    await act(async () => pending.resolve({ status: 500, body: {} }));
    await settle(WITH_TIMERS);
    expect(dialogOpen(root)).toBe(false);
    expect(visible(root, `${b.file}/busy`)).toBe(false);
    expect(text(byTestId(root, `${b.file}/error`)[0])).toContain('Не удалось открыть файл');
    expect(one(root, b.file).props.accessibilityLabel).toBe('report.pdf · 200 КБ. Не удалось открыть файл. Показать QR-код');
    // The chip and the focus order are unchanged.
    expect(contentIds(root)).toContain(b.file);
    withBlocks();
    await press(root, b.file);
    expect(dialogOpen(root)).toBe(true);
    expect(visible(root, `${b.file}/error`)).toBe(false);
    expect(lastQr()).toBe(`${FILE_URL}${SIGNED}`);
    await unmount(root);
  });

  it('an id-less file (`file@<n>`): OK opens the dialog with url + signedQuery (found by index and title)', async () => {
    withBlocks([...paragraph('Файл без id'), { type: 'file', title: 'report.pdf', size: 204800, url: FILE_URL }]);
    const root = await openFromHome();
    const chip = BLOCK(FEED_ID(0), 'file@2');
    expect(one(root, chip).props.accessibilityLabel).toBe('report.pdf · 200 КБ. Показать QR-код');
    await press(root, chip);
    expect(dialogOpen(root)).toBe(true);
    expect(lastQr()).toBe(`${FILE_URL}${SIGNED}`);
    await unmount(root);
  });

  it('a file gone from the fresh E8 (or a locked one) → the inline error, no dialog', async () => {
    withBlocks();
    const root = await openFromHome();
    const b = ids(FEED_ID(0));
    withBlocks(paragraph('Файл удалён'));
    await press(root, b.file);
    expect(dialogOpen(root)).toBe(false);
    expect(visible(root, `${b.file}/error`)).toBe(true);
    expect(mockQrValues).toHaveLength(0);
    await unmount(root);
  });

  it('a locked fresh E8 → «Нет доступа к файлу» on the chip (not the generic error), no dialog', async () => {
    withBlocks();
    const root = await openFromHome();
    const b = ids(FEED_ID(0));
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [], { hasAccess: false, signedQuery: '' }),
    });
    await press(root, b.file);
    expect(dialogOpen(root)).toBe(false);
    expect(text(byTestId(root, `${b.file}/error`)[0])).toContain('Нет доступа к файлу');
    expect(text(byTestId(root, `${b.file}/error`)[0])).not.toContain('Не удалось открыть файл');
    expect(one(root, b.file).props.accessibilityLabel).toBe('report.pdf · 200 КБ. Нет доступа к файлу. Показать QR-код');
    expect(mockQrValues).toHaveLength(0);
    await unmount(root);
  });

  it('a file E8 that lands after Пост lost focus (a Boosty post link pushed another Пост): no dialog, no QR value, no focus jump', async () => {
    const LINKED = 'linked-post';
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body:
        postId === LINKED
          ? postDetail(blogUrl, postId, paragraph('Связанный пост'))
          : postDetail(blogUrl, postId, [
              textBlock('См. '),
              link('другой пост', `https://boosty.to/${FEED_BLOG}/posts/${LINKED}`),
              blockEnd(),
              { type: 'file', id: 'f1', title: 'report.pdf', size: 204800, url: FILE_URL },
            ], { signedQuery: SIGNED }),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const fileChip = BLOCK(id, 'file:f1');
    const postChip = BLOCK(id, 'text@0/link/0');
    const pending = deferred();
    const live = e8;
    e8 = (req, blogUrl, postId) => (postId === id ? (pending.promise as never) : live(req, blogUrl, postId));
    await press(root, fileChip);
    expect(visible(root, `${fileChip}/busy`)).toBe(true);
    await press(root, postChip);
    expect(routeNames()).toEqual(['Shell', 'Post', 'Post']);
    focusMock.mockClear();
    await act(async () =>
      pending.resolve({
        status: 200,
        body: postDetail(FEED_BLOG, id, [{ type: 'file', id: 'f1', title: 'report.pdf', url: FILE_URL }], { signedQuery: SIGNED }),
      }),
    );
    await settle(WITH_TIMERS);
    expect(dialogOpen(root)).toBe(false);
    expect(mockQrValues).toHaveLength(0);
    expect(focusTargets()).toEqual([]);
    expect(routeNames()).toEqual(['Shell', 'Post', 'Post']);
    await unmount(root);
  });

  it('matrix «YouTube»: a chip with the thumbnail (plain {uri}, no headers); a failed thumbnail leaves the text; OK → QR of the page, never played', async () => {
    withBlocks();
    const root = await openFromHome();
    const b = ids(FEED_ID(0));
    const thumb = byTestId(root, `${b.youtube}/thumb`)[0];
    expect(thumb.props.source).toEqual({ uri: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
    expect(thumb.props.focusable).toBe(false);
    expect(one(root, b.youtube).props.accessibilityLabel).toBe('Видео на YouTube. Показать QR-код');
    await act(async () => thumb.props.onError({ nativeEvent: {} }));
    expect(visible(root, `${b.youtube}/thumb`)).toBe(false);
    expect(text(byTestId(root, b.youtube)[0])).toContain('Видео на YouTube');
    await press(root, b.youtube);
    expect(lastQr()).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(currentRoute()).toBe('Post');
    await back();
    expect(lastFocusTarget()).toBe(b.youtube);
    await unmount(root);
  });

  it('matrix «Other video»: a text chip («Внешнее видео»), no thumbnail; QR to the page', async () => {
    withBlocks();
    const root = await openFromHome();
    const b = ids(FEED_ID(0));
    expect(visible(root, `${b.other}/thumb`)).toBe(false);
    expect(text(byTestId(root, b.other)[0])).toContain('Внешнее видео');
    await press(root, b.other);
    expect(lastQr()).toBe('https://example.invalid/video');
    await unmount(root);
  });

  it('matrix «Boosty post link» (owner decision 2026-10-29): «<text> · Открыть», no QR; OK pushes that Пост (same sidebar origin); Back → the same chip; a link to the current post stays a QR chip', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body:
        postId === 'linked-post'
          ? postDetail(blogUrl, postId, paragraph('Связанный пост'))
          : postDetail(blogUrl, postId, [
              textBlock('См. '),
              link('другой пост', `https://boosty.to/${FEED_BLOG}/posts/linked-post?share=post_link`),
              textBlock(' и '),
              link('этот пост', `https://boosty.to/${FEED_BLOG}/posts/${postId}`),
              textBlock(' и '),
              link('блог', `https://boosty.to/${FEED_BLOG}`),
              blockEnd(),
            ]),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const other = BLOCK(id, 'text@0/link/0');
    const self = BLOCK(id, 'text@0/link/1');
    const blog = BLOCK(id, 'text@0/link/2');
    expect(text(byTestId(root, other)[0])).toContain('другой пост');
    expect(text(byTestId(root, `${other}/action`)[0])).toContain('· Открыть');
    expect(text(byTestId(root, other)[0])).not.toContain('"QR"');
    expect(one(root, other).props.accessibilityLabel).toBe('другой пост. Открыть пост');
    expect(one(root, self).props.accessibilityLabel).toBe('этот пост. Показать QR-код');
    expect(one(root, blog).props.accessibilityLabel).toBe('блог. Показать QR-код');
    // The current post and a blog page keep the QR.
    await press(root, self);
    expect(dialogOpen(root)).toBe(true);
    expect(lastQr()).toBe(`https://boosty.to/${FEED_BLOG}/posts/${id}`);
    await back();
    expect(dialogOpen(root)).toBe(false);
    expect(routeNames()).toEqual(['Shell', 'Post']);
    // OK on the other post's chip: that Пост on top, no dialog, same sidebar origin.
    await press(root, other);
    expect(dialogOpen(root)).toBe(false);
    expect(routeNames()).toEqual(['Shell', 'Post', 'Post']);
    expect(navigationRef.getCurrentRoute()?.params).toEqual({ blogUrl: FEED_BLOG, postId: 'linked-post', section: 'home' });
    expect(e8Calls().map(c => c.path)).toContain(`/v1/blog/${FEED_BLOG}/post/linked-post`);
    expect(visible(root, 'post/nav/home/current')).toBe(true);
    focusMock.mockClear();
    await back();
    expect(routeNames()).toEqual(['Shell', 'Post']);
    expect(lastFocusTarget()).toBe(other);
    await unmount(root);
  });

  it('matrix «Timestamp» with the player off (phaseFlags): a timestamp link to this post\'s video keeps its QR chip', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [
        { type: 'ok_video', id: 'v1', title: 'Video', playerUrls: [] },
        textBlock('Таймкоды: '),
        link('3:45 Тема', `https://boosty.to/${blogUrl}/posts/${postId}?t=225&tmid=v1`),
        blockEnd(),
      ]),
    });
    const root = await openFromHome();
    const chip = BLOCK(FEED_ID(0), 'text@1/link/0');
    expect(one(root, chip).props.accessibilityLabel).toBe('3:45 Тема. Показать QR-код');
    await press(root, chip);
    expect(dialogOpen(root)).toBe(true);
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('a locked post keeps Story 3.6: its teaser link stays inline text, no chip', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [], {
        hasAccess: false,
        signedQuery: '',
        teaser: [textBlock('Тизер '), link('ссылка', 'https://example.invalid/a'), blockEnd()],
      }),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@0')]);
    expect(visible(root, BLOCK(id, 'text@0/link/0'))).toBe(false);
    await unmount(root);
  });
});

describe('Story 6.4: inline audio', () => {
  const SECRET = 'SECRETSIGNATURE';
  const SIGNED = `?user_id=1001&content_id=1002&expire_time=1700003600&sign=${SECRET}`;
  const AUDIO_URL = 'https://example.invalid/audio/track';
  const AUDIO = { type: 'audio_file', id: 'a1', title: 'Метроном', duration: 192, url: AUDIO_URL };
  const allLogs = () =>
    JSON.stringify([
      logger.entries(),
      (console.log as jest.Mock).mock.calls,
      (console.warn as jest.Mock).mock.calls,
      (console.error as jest.Mock).mock.calls,
    ]);
  const cacheText = () => JSON.stringify(queryClient.getQueryCache().getAll().map(q => q.state.data ?? null));
  const withAudio = (data: unknown[] = [...paragraph('До'), AUDIO, ...paragraph('После')], extra = {}) => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, data, { signedQuery: SIGNED, ...extra }),
    });
  };

  beforeEach(() => {
    engine.reset();
    // The AudioBlock plays through the PlayerEngine: the player capability (AD-20).
    mockPlayerFlag.on = true;
  });
  afterEach(() => {
    mockPlayerFlag.on = false;
  });

  it('the player capability off: audio stays the neutral placeholder (no AudioBlock, no E8 on OK)', async () => {
    mockPlayerFlag.on = false;
    withAudio();
    const root = await openFromHome();
    const id = FEED_ID(0);
    const [node] = byTestId(root, BLOCK(id, 'audio_file:a1'));
    expect(node.props.focusable).toBe(false);
    expect(node.props.accessibilityLabel).toBe('Аудио');
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@0'), BLOCK(id, 'text@3')]);
    await unmount(root);
  });

  it('route blur: audio plays → OK on a Boosty post link chip (Пост pushed) → the first post\'s engine pauses; Back → still paused', async () => {
    const LINKED = 'linked-post';
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(
        blogUrl,
        postId,
        postId === LINKED
          ? paragraph('Связанный пост')
          : [
              textBlock('См. '),
              { type: 'link', content: JSON.stringify(['другой пост', 'unstyled', []]), url: `https://boosty.to/${FEED_BLOG}/posts/${LINKED}` },
              blockEnd(),
              AUDIO,
            ],
        { signedQuery: SIGNED },
      ),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const audio = BLOCK(id, 'audio_file:a1');
    await press(root, audio);
    expect(engine.props?.paused).toBe(false);
    await press(root, BLOCK(id, 'text@0/link/0'));
    expect(routeNames()).toEqual(['Shell', 'Post', 'Post']);
    expect(engine.props?.paused).toBe(true);
    expect(engine.unmounts).toBe(0);
    await back();
    expect(routeNames()).toEqual(['Shell', 'Post']);
    expect(engine.props?.paused).toBe(true);
    expect(visible(root, `${audio}/play`)).toBe(true);
    await unmount(root);
  });

  it('matrix «Render», «Play», «Leave»: one focus stop between the paragraphs; OK → one fresh E8 → the hidden engine plays url + signedQuery (never in text, logs or the cache); Back → the engine stops, the slot is free, nothing persisted', async () => {
    withAudio();
    const root = await openFromHome();
    const id = FEED_ID(0);
    const audio = BLOCK(id, 'audio_file:a1');
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@0'), audio, BLOCK(id, 'text@3')]);
    expect(one(root, audio).props.accessibilityLabel).toBe('Аудио. Метроном. 0:00 / 3:12. Воспроизвести');
    // Initial focus is unchanged: the first paragraph.
    expect(lastFocusTarget()).toBe(BLOCK(id, 'text@0'));
    expect(e8Calls()).toHaveLength(1);
    expect(engine.mounts).toBe(0);
    await press(root, audio);
    expect(e8Calls()).toHaveLength(2);
    expect(engine.props?.source).toEqual({ uri: `${AUDIO_URL}${SIGNED}`, format: 'progressive' });
    expect(engine.props?.paused).toBe(false);
    expect(visible(root, `${audio}/pause`)).toBe(true);
    expect(text(root)).not.toContain(SECRET);
    expect(allLogs()).not.toContain(SECRET);
    expect(allLogs()).not.toContain(AUDIO_URL);
    expect(cacheText()).not.toContain(SECRET);
    expect(cacheText()).not.toContain(AUDIO_URL);
    expect(playbackArbiter.current()).not.toBeNull();
    // OK pauses (no new E8), OK plays again.
    await press(root, audio);
    expect(engine.props?.paused).toBe(true);
    await press(root, audio);
    expect(engine.props?.paused).toBe(false);
    expect(e8Calls()).toHaveLength(2);
    // Leave the post: the AudioBlock unmounts, the engine with it.
    await back();
    await settle(WITH_TIMERS);
    expect(currentRoute()).not.toBe('Post');
    expect(visible(root, 'post/page')).toBe(false);
    expect(engine.unmounts).toBe(1);
    expect(playbackArbiter.current()).toBeNull();
    expect(cacheText()).not.toContain(SECRET);
    await unmount(root);
  });

  it('matrix «Play» error: an empty signedQuery on the fresh E8 → «Не удалось воспроизвести», no bare URL played; OK retries', async () => {
    withAudio(undefined, { signedQuery: '' });
    const root = await openFromHome();
    const audio = BLOCK(FEED_ID(0), 'audio_file:a1');
    await press(root, audio);
    expect(engine.mounts).toBe(0);
    expect(text(byTestId(root, `${audio}/error`)[0])).toContain('Не удалось воспроизвести');
    withAudio();
    await press(root, audio);
    expect(engine.props?.source.uri).toBe(`${AUDIO_URL}${SIGNED}`);
    expect(visible(root, `${audio}/error`)).toBe(false);
    await unmount(root);
  });

  it('«Смотреть» opens the Player: the playing audio pauses at once (route blur or the arbiter; this flow cannot tell them apart, the arbiter path is unit-tested in AudioBlock.test.tsx) and does not resume on return', async () => {
    withAudio([{ type: 'ok_video', id: 'v1', title: 'Видео', playerUrls: [{ type: 'hd', url: '' }] }, AUDIO]);
    mockPlayerFlag.on = true;
    try {
      const root = await openFromHome();
      const id = FEED_ID(0);
      const audio = BLOCK(id, 'audio_file:a1');
      await press(root, audio);
      expect(visible(root, `${audio}/pause`)).toBe(true);
      await press(root, `post/${id}/primary`);
      expect(currentRoute()).toBe('Player');
      expect(visible(root, `${audio}/pause`)).toBe(false);
      expect(visible(root, `${audio}/play`)).toBe(true);
      await back();
      expect(currentRoute()).toBe('Post');
      expect(visible(root, `${audio}/play`)).toBe(true);
      await unmount(root);
    } finally {
      mockPlayerFlag.on = false;
    }
  });

  it('a locked post\'s teaser keeps audio as the neutral placeholder (no AudioBlock)', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [], { hasAccess: false, signedQuery: '', teaser: [AUDIO] }),
    });
    const root = await openFromHome();
    const audio = BLOCK(FEED_ID(0), 'audio_file:a1');
    const [node] = byTestId(root, audio);
    expect(node.props.focusable).toBe(false);
    expect(node.props.accessibilityLabel).toBe('Аудио');
    await unmount(root);
  });
});

describe('Story 6.5: poll display', () => {
  /** The live poll shape (api-contract §4.2 «Polls (LIVE)»): top-level, no `answer` before a vote. */
  const option = (id: number, text_: string, counter: number, fraction: number) => ({
    counter,
    fraction,
    id,
    text: text_,
    voters: { data: {}, extra: {} },
  });
  const POLL = {
    counter: 21,
    defaultLang: 'ru',
    hasOther: false,
    id: 9,
    isFinished: false,
    isMultiple: false,
    options: [option(1, 'Длинные', 10, 48), option(2, 'Короткие', 8, 38), option(3, 'Эфиры', 3, 14)],
    title: ['Какой формат удобнее?'],
  };
  const POLL_KEY = 'poll:9';
  const withPoll = (poll: unknown, data: unknown[] = [...paragraph('До'), ...paragraph('После')]) => {
    e8 = (_req, blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, data, { poll }) });
  };
  const pollNode = (root: Root, id: string) =>
    byTestId(root, BLOCK(id, POLL_KEY)).find(n => n.props.focusable === true);
  const pollCalls = () => transport.calls.filter(c => c.path.includes('/poll'));
  const optionNode = (root: Root, id: string, optionId: string) =>
    byTestId(root, OPTION(id, optionId)).find(n => n.props.focusable === true);

  it('matrix «Open poll»: after the body, title, 3 rows with bars and %, «Проголосовали: N»; Story 6.6: each option a stop (the root is not); initial focus unchanged', async () => {
    withPoll(POLL);
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@0'), BLOCK(id, 'text@2'), OPTION(id, '1'), OPTION(id, '2'), OPTION(id, '3')]);
    expect(lastFocusTarget()).toBe(BLOCK(id, 'text@0'));
    const page = pageText(root);
    for (const s of ['Какой формат удобнее?', 'Длинные', 'Короткие', 'Эфиры', '48\u00A0% · 10', '38\u00A0% · 8', '14\u00A0% · 3', 'Проголосовали: 21']) {
      expect(page).toContain(s);
    }
    expect(page).not.toContain(t('poll.finished'));
    expect(byTestId(root, `${BLOCK(id, POLL_KEY)}/option/1/bar`)).toHaveLength(1);
    expect(pollNode(root, id)).toBeUndefined();
    expect(optionNode(root, id, '1')?.props.accessibilityLabel).toBe(
      'Опрос. Какой формат удобнее? Длинные, 48\u00A0%, 10 голосов',
    );
    expect(optionNode(root, id, '3')?.props.accessibilityLabel).toBe('Эфиры, 14\u00A0%, 3 голоса. Проголосовали: 21');
    // No poll request (no E10, no vote): the poll is the cached post's.
    expect(pollCalls()).toEqual([]);
    await unmount(root);
  });

  it('matrix «My choice»: the chosen option carries the accent check', async () => {
    withPoll({ ...POLL, answer: [2] });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(byTestId(root, `${BLOCK(id, POLL_KEY)}/option/2/chosen`)).toHaveLength(1);
    expect(byTestId(root, `${BLOCK(id, POLL_KEY)}/option/1/chosen`)).toHaveLength(0);
    expect(optionNode(root, id, '2')?.props.accessibilityLabel).toBe('Короткие, 38\u00A0%, 8 голосов, ваш выбор');
    await unmount(root);
  });

  it('matrix «Finished»: «Опрос завершен», the results; one stop', async () => {
    withPoll({ ...POLL, isFinished: true });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(contentIds(root).filter(c => c.startsWith(BLOCK(id, 'poll')))).toEqual([BLOCK(id, POLL_KEY)]);
    expect(pageText(root)).toContain(t('poll.finished'));
    expect(pageText(root)).toContain('48\u00A0%');
    await unmount(root);
  });

  it('matrix «Malformed option»: an option without `fraction` is dropped, the rest of the poll shown (owner decision, option a)', async () => {
    const broken: Record<string, unknown> = option(2, 'Короткие', 8, 38);
    delete broken.fraction;
    withPoll({ ...POLL, options: [option(1, 'Длинные', 10, 48), broken, option(3, 'Эфиры', 3, 14)] });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@0'), BLOCK(id, 'text@2'), OPTION(id, '1'), OPTION(id, '3')]);
    expect(byTestId(root, `${BLOCK(id, POLL_KEY)}/option/1`)).toHaveLength(1);
    expect(byTestId(root, `${BLOCK(id, POLL_KEY)}/option/2`)).toHaveLength(0);
    expect(byTestId(root, `${BLOCK(id, POLL_KEY)}/option/3`)).toHaveLength(1);
    expect(pageText(root)).not.toContain('Короткие');
    expect(pageText(root)).toContain('Проголосовали: 21');
    await unmount(root);
  });

  it('matrix «Malformed option», every option invalid → the «Опрос» placeholder, the rest of the post fine', async () => {
    const broken: Record<string, unknown> = option(2, 'Короткие', 8, 38);
    delete broken.fraction;
    withPoll({ ...POLL, options: [broken, { id: 3, text: 'Эфиры', fraction: 14 }] });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, 'text@0'), BLOCK(id, 'text@2')]);
    const [placeholder] = byTestId(root, BLOCK(id, 'poll@4'));
    expect(placeholder.props.focusable).toBe(false);
    expect(placeholder.props.accessibilityLabel).toBe(t('post.block.poll'));
    expect(pageText(root)).toContain('После');
    expect(pageText(root)).not.toContain('Проголосовали');
    await unmount(root);
  });

  it('matrix «Zero voters»: 0 % bars, «Проголосовали: 0»', async () => {
    withPoll({ ...POLL, counter: 0, options: [option(1, 'A', 0, 0), option(2, 'B', 0, 0)] });
    const root = await openFromHome();
    const id = FEED_ID(0);
    const bar = byTestId(root, `${BLOCK(id, POLL_KEY)}/option/1/bar`)[0];
    expect(StyleSheet.flatten(bar.props.style).width).toBe('0%');
    expect(pageText(root)).toContain('0\u00A0%');
    expect(pageText(root)).toContain('Проголосовали: 0');
    await unmount(root);
  });

  it('matrix «Locked post»: `hasAccess` false with a poll → no poll in the teaser; focus on the author', async () => {
    e8 = (_req, blogUrl, postId) => {
      const body = e8Locked();
      return {
        status: 200,
        body: { ...body, id: postId, user: { ...(body.user as object), blogUrl }, poll: POLL },
      };
    };
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(contentIds(root)).toEqual([AUTHOR(id)]);
    expect(lastFocusTarget()).toBe(AUTHOR(id));
    expect(byTestId(root, BLOCK(id, POLL_KEY))).toHaveLength(0);
    expect(pageText(root)).not.toContain('Проголосовали');
    await unmount(root);
  });

  it('a poll is a stop in body order: a heading and a finished poll only → initial focus on the poll', async () => {
    withPoll({ ...POLL, isFinished: true }, [{ type: 'header', content: JSON.stringify(['Опрос недели', 'unstyled', []]), modificator: '' }]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(contentIds(root)).toEqual([AUTHOR(id), BLOCK(id, POLL_KEY)]);
    expect(lastFocusTarget()).toBe(BLOCK(id, POLL_KEY));
    await unmount(root);
  });

  it('the live-sanitized fixture: its poll is the last stop, after the audio placeholder (player off)', async () => {
    e8 = (_req, blogUrl, postId) => {
      const body = e8Accessible();
      return { status: 200, body: { ...body, id: postId, user: { ...(body.user as object), blogUrl } } };
    };
    const root = await openFromHome();
    const id = FEED_ID(0);
    const ids = contentIds(root);
    // Story 6.6: an open single-choice poll: its options are the last stops.
    expect(ids.slice(-2)).toEqual([OPTION(id, '1021'), OPTION(id, '1022')]);
    expect(pageText(root)).toContain('Проголосовали: 5');
    await unmount(root);
  });
});

describe('Story 6.6: vote and retract in a single-choice poll', () => {
  const option = (id: number, text_: string, counter: number, fraction: number) => ({
    counter,
    fraction,
    id,
    text: text_,
    voters: { data: {}, extra: {} },
  });
  /** The live shape (api-contract §4.2), with `answer` when given. */
  const apiPoll = (answer: number[] | null, counts: [number, number, number] = [10, 8, 3]) => {
    const total = counts[0] + counts[1] + counts[2];
    const pct = (n: number) => Math.round((n / total) * 100);
    return {
      counter: total,
      defaultLang: 'ru',
      hasOther: false,
      id: 9,
      isFinished: false,
      isMultiple: false,
      options: [
        option(1, 'Длинные', counts[0], pct(counts[0])),
        option(2, 'Короткие', counts[1], pct(counts[1])),
        option(3, 'Эфиры', counts[2], pct(counts[2])),
      ],
      title: ['Какой формат удобнее?'],
      ...(answer === null ? {} : { answer }),
    };
  };
  const VOTE = '/v1/poll/9/vote';
  const E10 = `/v1/blog/${FEED_BLOG}/poll/9`;
  const POLL_ROOT = (postId: string) => BLOCK(postId, 'poll:9');

  /** The post's poll on E8; E10–E12 answered by `pollReply`. */
  let e8Poll: unknown;
  let pollReply: (req: FixtureRequest) => Reply;

  beforeEach(() => {
    e8Poll = apiPoll(null);
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [...paragraph('До'), ...paragraph('После')], { poll: e8Poll }),
    });
    pollReply = () => ({ status: 200, body: {} });
    transport = installFixtureTransport(req =>
      req.path === VOTE || req.path === E10 ? pollReply(req) : fullHandler(req),
    );
  });

  const pollCalls = () =>
    transport.calls
      .filter(c => c.path === VOTE || c.path === E10)
      .map(c => [c.method, c.path, c.method === 'POST' ? c.form : null]);
  /** The pending hint's text under the option ('' when not pending). */
  const hint = (root: Root, postId: string, optionId: string) => {
    const [node] = byTestId(root, `${POLL_ROOT(postId)}/option/${optionId}/pending`);
    return node ? text(node) : '';
  };
  const isPending = (root: Root, postId: string, optionId: string) =>
    byTestId(root, `${POLL_ROOT(postId)}/option/${optionId}/pending`).length > 0;
  const chosen = (root: Root, postId: string, optionId: string) =>
    byTestId(root, `${POLL_ROOT(postId)}/option/${optionId}/chosen`).length > 0;
  const errorShown = (root: Root, postId: string) => byTestId(root, `${POLL_ROOT(postId)}/error`).length > 0;
  const blurOption = async (root: Root, postId: string, optionId: string) => {
    await act(async () => {
      one(root, OPTION(postId, optionId)).props.onBlur({ nativeEvent: {} });
    });
  };

  it('matrix «Vote»: OK, OK on 2 → E11 `answer=2`, then E10 → applyPoll; check on 2, results updated, focus not moved', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = req => (req.method === 'GET' ? { status: 200, body: { data: { poll: apiPoll([2], [10, 9, 3]) } } } : { status: 200, body: {} });
    await press(root, OPTION(id, '2'));
    expect(isPending(root, id, '2')).toBe(true);
    expect(hint(root, id, '2')).toContain(t('poll.pendingVote'));
    expect(pollCalls()).toEqual([]);
    focusMock.mockClear();
    await press(root, OPTION(id, '2'));
    expect(pollCalls()).toEqual([
      ['POST', VOTE, { answer: '2' }],
      ['GET', E10, null],
    ]);
    expect(chosen(root, id, '2')).toBe(true);
    expect(pageText(root)).toContain('Проголосовали: 22');
    expect(isPending(root, id, '2')).toBe(false);
    // Focus stays on the option: the app asked to focus nothing else.
    expect(focusMock).not.toHaveBeenCalled();
    expect(byTestId(root, OPTION(id, '2')).length).toBeGreaterThan(0);
    // The cached post holds the E10 poll (no separate poll key).
    const cached = queryClient.getQueryData<{ kind: string; post: Post }>(queryKeys.post(FEED_BLOG, id));
    expect(cached?.post.poll?.answer).toEqual(['2']);
    expect(queryClient.getQueryCache().findAll({ queryKey: ['poll'] })).toHaveLength(0);
    await unmount(root);
  });

  it('matrix «Cancel»: OK on 1, then ↓ to 2 → 1 leaves pending; nothing is sent', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    await press(root, OPTION(id, '1'));
    expect(isPending(root, id, '1')).toBe(true);
    await blurOption(root, id, '1');
    await focusOn(root, OPTION(id, '2'));
    expect(isPending(root, id, '1')).toBe(false);
    expect(isPending(root, id, '2')).toBe(false);
    expect(pollCalls()).toEqual([]);
    await unmount(root);
  });

  it('matrix «Retract»: answer [2]; OK → «…, чтобы отозвать»; OK → E12, then E10; no check', async () => {
    e8Poll = apiPoll([2]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = req => (req.method === 'GET' ? { status: 200, body: { data: { poll: apiPoll(null, [10, 7, 3]) } } } : { status: 200 });
    expect(chosen(root, id, '2')).toBe(true);
    await press(root, OPTION(id, '2'));
    expect(hint(root, id, '2')).toContain(t('poll.pendingRetract'));
    await press(root, OPTION(id, '2'));
    expect(pollCalls()).toEqual([
      ['DELETE', VOTE, null],
      ['GET', E10, null],
    ]);
    expect(chosen(root, id, '2')).toBe(false);
    await unmount(root);
  });

  it('matrix «Change vote» (owner decision Q1 a): answer [1]; OK, OK on 2 → «Нажмите OK ещё раз», E11 `answer=2`, then E10', async () => {
    e8Poll = apiPoll([1]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = req => (req.method === 'GET' ? { status: 200, body: { data: { poll: apiPoll([2], [9, 9, 3]) } } } : { status: 200 });
    await press(root, OPTION(id, '2'));
    expect(hint(root, id, '2')).toContain(t('poll.pendingVote'));
    expect(hint(root, id, '2')).not.toContain(t('poll.pendingRetract'));
    await press(root, OPTION(id, '2'));
    expect(pollCalls()).toEqual([
      ['POST', VOTE, { answer: '2' }],
      ['GET', E10, null],
    ]);
    expect(chosen(root, id, '2')).toBe(true);
    expect(chosen(root, id, '1')).toBe(false);
    await unmount(root);
  });

  it.each([
    ['5xx', { status: 503 }],
    ['429', { status: 429 }],
    ['network', { network: true as const }],
    ['server refusal', { status: 400, body: { error: 'bad_request' } }],
  ])('matrix «Mutation fails» (%s): inline error, previous state, 1 request (no retry); the next OK clears it and starts pending', async (_name, reply) => {
    e8Poll = apiPoll([1]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = () => reply;
    await press(root, OPTION(id, '2'));
    await press(root, OPTION(id, '2'), { settle: WITH_TIMERS });
    expect(pollCalls()).toEqual([['POST', VOTE, { answer: '2' }]]);
    expect(errorShown(root, id)).toBe(true);
    expect(pageText(root)).toContain(t('poll.voteFailed'));
    expect(chosen(root, id, '1')).toBe(true);
    expect(chosen(root, id, '2')).toBe(false);
    await press(root, OPTION(id, '2'));
    expect(errorShown(root, id)).toBe(false);
    expect(isPending(root, id, '2')).toBe(true);
    expect(pollCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('matrix «Double press while sending»: a 3rd OK during the request is ignored; still 1 request', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    const held = deferred();
    pollReply = req => (req.method === 'POST' ? held.promise : { status: 200, body: { data: { poll: apiPoll([2], [10, 9, 3]) } } });
    await press(root, OPTION(id, '2'));
    await press(root, OPTION(id, '2'));
    expect(byTestId(root, `${POLL_ROOT(id)}/option/2/sending`).length).toBeGreaterThan(0);
    await press(root, OPTION(id, '2'));
    await press(root, OPTION(id, '2'));
    await press(root, OPTION(id, '1'));
    expect(pollCalls()).toEqual([['POST', VOTE, { answer: '2' }]]);
    held.resolve({ status: 200, body: {} });
    await settle();
    expect(pollCalls()).toEqual([
      ['POST', VOTE, { answer: '2' }],
      ['GET', E10, null],
    ]);
    expect(chosen(root, id, '2')).toBe(true);
    await unmount(root);
  });

  it('matrix «E10 fails»: E11 200, E10 error → the post`s E8 is re-sent and brings the poll; no error shown', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = req => (req.method === 'GET' ? { status: 404, body: { error: 'not_found' } } : { status: 200 });
    const before = e8Calls().length;
    e8Poll = apiPoll([2], [10, 9, 3]);
    await press(root, OPTION(id, '2'));
    await press(root, OPTION(id, '2'));
    expect(pollCalls()).toEqual([
      ['POST', VOTE, { answer: '2' }],
      ['GET', E10, null],
    ]);
    expect(e8Calls().length).toBe(before + 1);
    expect(errorShown(root, id)).toBe(false);
    expect(chosen(root, id, '2')).toBe(true);
    await unmount(root);
  });

  it.each([
    ['nothing else focused', null, true],
    ['Android moved focus to the author', 'author', true],
    ['the user moved to another stop', 'other', false],
  ] as const)('E10 returns the poll finished: the focused option is gone → two frames later focus goes to the poll`s block stop (not the top) — %s', async (_name, moved, expected) => {
    installFrameQueue();
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = req =>
      req.method === 'GET'
        ? { status: 200, body: { data: { poll: { ...apiPoll([2], [10, 9, 3]), isFinished: true } } } }
        : { status: 200 };
    await press(root, OPTION(id, '2'));
    focusMock.mockClear();
    await press(root, OPTION(id, '2'));
    expect(pollCalls()).toEqual([
      ['POST', VOTE, { answer: '2' }],
      ['GET', E10, null],
    ]);
    expect(contentIds(root).filter(c => c.includes('poll'))).toEqual([POLL_ROOT(id)]);
    // Deferred (device: a request to a view mounted in the same commit scrolls the column to its top).
    expect(focusTargets()).not.toContain(POLL_ROOT(id));
    if (moved === 'author') {
      await focusOn(root, AUTHOR(id));
    } else if (moved === 'other') {
      await focusOn(root, BLOCK(id, 'text@0'));
    }
    await frames(1);
    expect(focusTargets()).not.toContain(POLL_ROOT(id));
    await frames(1);
    if (expected) {
      expect(lastFocusTarget()).toBe(POLL_ROOT(id));
    } else {
      expect(focusTargets()).not.toContain(POLL_ROOT(id));
    }
    await unmount(root);
  });

  it('an open single-choice poll as the first stop: initial focus is its first option; a stray OK only reaches pending', async () => {
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [{ type: 'header', content: JSON.stringify(['Опрос недели', 'unstyled', []]), modificator: '' }], { poll: e8Poll }),
    });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(lastFocusTarget()).toBe(OPTION(id, '1'));
    await press(root, OPTION(id, '1'));
    expect(isPending(root, id, '1')).toBe(true);
    expect(pollCalls()).toEqual([]);
    await unmount(root);
  });

  describe('Epic 6 retro A4: story boundaries', () => {
    const SIGNED = '?user_id=1001&content_id=1002&expire_time=1700003600&sign=SECRETSIGNATURE';
    const AUDIO_URL = 'https://example.invalid/audio/track';
    const AUDIO = { type: 'audio_file', id: 'a1', title: 'Метроном', duration: 192, url: AUDIO_URL };

    beforeEach(() => {
      engine.reset();
      mockPlayerFlag.on = true;
      e8 = (_req, blogUrl, postId) => ({
        status: 200,
        body: postDetail(blogUrl, postId, [...paragraph('До'), AUDIO, ...paragraph('После')], {
          poll: e8Poll,
          signedQuery: SIGNED,
        }),
      });
    });
    afterEach(() => {
      mockPlayerFlag.on = false;
    });

    /** Пост with the poll and the audio; the audio plays (one fresh E8, one engine). */
    async function playingPost() {
      const root = await openFromHome();
      const id = FEED_ID(0);
      const audio = BLOCK(id, 'audio_file:a1');
      await press(root, audio);
      expect(engine.mounts).toBe(1);
      expect(engine.props?.paused).toBe(false);
      expect(engine.props?.source.uri).toBe(`${AUDIO_URL}${SIGNED}`);
      return { root, id, audio };
    }

    it('R4: audio keeps playing across a vote (E11 + E10 → applyPoll re-renders the post): same engine, not paused, no new audio E8', async () => {
      const { root, id, audio } = await playingPost();
      const e8Before = e8Calls().length;
      pollReply = req =>
        req.method === 'GET' ? { status: 200, body: { data: { poll: apiPoll([2], [10, 9, 3]) } } } : { status: 200, body: {} };
      await press(root, OPTION(id, '2'));
      await press(root, OPTION(id, '2'));
      expect(pollCalls()).toEqual([
        ['POST', VOTE, { answer: '2' }],
        ['GET', E10, null],
      ]);
      expect(chosen(root, id, '2')).toBe(true);
      expect(engine.mounts).toBe(1);
      expect(engine.unmounts).toBe(0);
      expect(engine.props?.paused).toBe(false);
      expect(engine.props?.source.uri).toBe(`${AUDIO_URL}${SIGNED}`);
      expect(e8Calls()).toHaveLength(e8Before);
      expect(visible(root, `${audio}/pause`)).toBe(true);
      await unmount(root);
    });

    it('R4: audio keeps playing across the E8 fallback (E10 fails → the post\'s E8 again re-renders it): same engine, not paused', async () => {
      const { root, id, audio } = await playingPost();
      const e8Before = e8Calls().length;
      pollReply = req => (req.method === 'GET' ? { status: 404, body: { error: 'not_found' } } : { status: 200 });
      e8Poll = apiPoll([2], [10, 9, 3]);
      await press(root, OPTION(id, '2'));
      await press(root, OPTION(id, '2'));
      expect(e8Calls()).toHaveLength(e8Before + 1);
      expect(chosen(root, id, '2')).toBe(true);
      expect(engine.mounts).toBe(1);
      expect(engine.unmounts).toBe(0);
      expect(engine.props?.paused).toBe(false);
      expect(visible(root, `${audio}/pause`)).toBe(true);
      await unmount(root);
    });

    it('R5: audio keeps playing under a chip\'s QrDialog; ← → do not seek it there; Back closes the dialog with focus on the chip', async () => {
      e8 = (_req, blogUrl, postId) => ({
        status: 200,
        body: postDetail(
          blogUrl,
          postId,
          [
            textBlock('См. '),
            { type: 'link', content: JSON.stringify(['страница', 'unstyled', []]), url: 'https://example.invalid/page' },
            blockEnd(),
            AUDIO,
          ],
          { signedQuery: SIGNED },
        ),
      });
      const root = await openFromHome();
      const id = FEED_ID(0);
      const audio = BLOCK(id, 'audio_file:a1');
      const chip = BLOCK(id, 'text@0/link/0');
      await press(root, audio);
      expect(engine.props?.paused).toBe(false);
      await act(async () => {
        engine.props?.onLoad?.({ durationSec: 192 });
      });
      // Control: while the block has focus, → seeks (the first key after focus is the entry guard).
      await remoteKey('right');
      await remoteKey('right');
      expect(engine.seek).toHaveBeenCalled();
      engine.seek.mockClear();
      // Native focus leaves the block for the chip, then OK opens the QR dialog.
      await act(async () => {
        one(root, audio).props.onBlur({ nativeEvent: {} });
      });
      await press(root, chip);
      expect(visible(root, 'dialog/qr')).toBe(true);
      expect(routeNames()).toEqual(['Shell', 'Post']);
      expect(engine.props?.paused).toBe(false);
      await remoteKey('right');
      await remoteKey('left');
      expect(engine.seek).not.toHaveBeenCalled();
      expect(engine.props?.paused).toBe(false);
      expect(engine.unmounts).toBe(0);
      focusMock.mockClear();
      await back();
      expect(visible(root, 'dialog/qr')).toBe(false);
      expect(lastFocusTarget()).toBe(chip);
      expect(engine.props?.paused).toBe(false);
      await unmount(root);
    });

    it('R6: Back after a vote returns focus to the same feed card by content id, while applyPoll rewrote that card in the feed cache', async () => {
      mockPlayerFlag.on = false;
      const feed = syntheticFeed({ total: 9 });
      // Feed post 2 carries the same poll, so applyPoll rewrites the list page too.
      const feedWithPoll = (req: FixtureRequest): FixtureReply => {
        const reply = feed(req) as { status: number; body: { data: { posts: Array<Record<string, unknown>> } } };
        reply.body.data.posts = reply.body.data.posts.map(p => (p.id === FEED_ID(2) ? { ...p, poll: apiPoll(null) } : p));
        return reply as FixtureReply;
      };
      pollReply = req =>
        req.method === 'GET' ? { status: 200, body: { data: { poll: apiPoll([2], [10, 9, 3]) } } } : { status: 200, body: {} };
      transport = installFixtureTransport(req =>
        req.path === E5_PATH ? feedWithPoll(req) : req.path === VOTE || req.path === E10 ? pollReply(req) : fullHandler(req),
      );
      const root = await openFromHome(2);
      const id = FEED_ID(2);
      type Feed = { pages: Array<{ posts: Post[] }> };
      const feedPollAnswer = () =>
        queryClient
          .getQueriesData<Feed>({ queryKey: ['feed'] })
          .flatMap(([, data]) => data?.pages.flatMap(page => page.posts) ?? [])
          .find(p => p.id === id)?.poll?.answer;
      expect(feedPollAnswer()).toEqual([]);
      await press(root, OPTION(id, '2'));
      await press(root, OPTION(id, '2'));
      expect(pollCalls()).toEqual([
        ['POST', VOTE, { answer: '2' }],
        ['GET', E10, null],
      ]);
      expect(feedPollAnswer()).toEqual(['2']);
      focusMock.mockClear();
      await back();
      expect(routeNames()).toEqual(['Shell']);
      expect(lastFocusTarget()).toBe(FEED_CARD(2));
      await unmount(root);
    });
  });

  it('matrix «Finished / multiple»: one stop, OK inert, nothing sent', async () => {
    // Story 6.7: an open multiple-choice poll takes votes now; a finished one stays inert.
    for (const overrides of [{ isFinished: true }, { isMultiple: true, isFinished: true }]) {
      e8Poll = { ...apiPoll(null), ...overrides };
      await resetQueryCache();
      const root = await openFromHome();
      const id = FEED_ID(0);
      expect(contentIds(root).filter(c => c.includes('poll'))).toEqual([POLL_ROOT(id)]);
      await press(root, POLL_ROOT(id));
      expect(pollCalls()).toEqual([]);
      await unmount(root);
    }
  });
});

describe('Story 6.7: multiple-choice poll', () => {
  const option = (id: number, text_: string, counter: number, fraction: number) => ({
    counter,
    fraction,
    id,
    text: text_,
    voters: { data: {}, extra: {} },
  });
  /** The live poll shape with `isMultiple` (no live multiple-choice sample: api-contract «Poll votes»). */
  const apiPoll = (answer: number[] | null, counts: [number, number, number] = [10, 8, 3]) => ({
    counter: 15,
    defaultLang: 'ru',
    hasOther: false,
    id: 9,
    isFinished: false,
    isMultiple: true,
    options: [
      option(1, 'Длинные', counts[0], Math.round((counts[0] / 15) * 100)),
      option(2, 'Короткие', counts[1], Math.round((counts[1] / 15) * 100)),
      option(3, 'Эфиры', counts[2], Math.round((counts[2] / 15) * 100)),
    ],
    title: ['Какие форматы удобнее?'],
    ...(answer === null ? {} : { answer }),
  });
  const VOTE = '/v1/poll/9/vote';
  const E10 = `/v1/blog/${FEED_BLOG}/poll/9`;
  const POLL_ROOT = (postId: string) => BLOCK(postId, 'poll:9');
  const SUBMIT = (postId: string) => `post/${postId}/poll/submit`;
  const RETRACT = (postId: string) => `post/${postId}/poll/retract`;

  let e8Poll: unknown;
  let pollReply: (req: FixtureRequest) => Reply;

  beforeEach(() => {
    e8Poll = apiPoll(null);
    e8 = (_req, blogUrl, postId) => ({
      status: 200,
      body: postDetail(blogUrl, postId, [...paragraph('До'), ...paragraph('После')], { poll: e8Poll }),
    });
    pollReply = () => ({ status: 200, body: {} });
    transport = installFixtureTransport(req =>
      req.path === VOTE || req.path === E10 ? pollReply(req) : fullHandler(req),
    );
  });

  const pollCalls = () =>
    transport.calls
      .filter(c => c.path === VOTE || c.path === E10)
      .map(c => [c.method, c.path, c.method === 'POST' ? c.form : null]);
  const pollIds = (root: Root, postId: string) =>
    contentIds(root).filter(c => c.startsWith(`post/${postId}/poll/`) || c.startsWith(POLL_ROOT(postId)));
  const checked = (root: Root, postId: string) =>
    ['1', '2', '3'].filter(o => byTestId(root, `${POLL_ROOT(postId)}/option/${o}/checked`).length > 0);
  const chosen = (root: Root, postId: string) =>
    ['1', '2', '3'].filter(o => byTestId(root, `${POLL_ROOT(postId)}/option/${o}/chosen`).length > 0);
  const errorShown = (root: Root, postId: string) => byTestId(root, `${POLL_ROOT(postId)}/error`).length > 0;
  const retractPending = (root: Root, postId: string) => byTestId(root, `${RETRACT(postId)}/pending`).length > 0;
  /**
   * Device fix (Story 6.7): the vote keeps focus on the same action control.
   * The column guide's destination (the last focused stop's host view) is the
   * very view that was «Проголосовать», now carrying `…/poll/retract` (the
   * tracked focus id followed it), and nothing asked to move focus (no
   * refetch fallback, no jump to the author).
   */
  const expectFocusKeptOnAction = async (root: Root, postId: string) => {
    // No deferred request either (the refetch fallback's frames have run).
    await frames(3);
    expect(guideDestinations.get('post/column')?.[0]).toBe(actionView);
    expect(destinationIds('post/column')).toEqual([RETRACT(postId)]);
    expect(focusMock).not.toHaveBeenCalled();
  };
  /** The column guide's destination right after OK on «Проголосовать» (that control's host view). */
  let actionView: unknown;

  it('not voted: the options are checkbox stops; «Проголосовать» is not focusable until an option is checked; matrix «Toggle» (1, 3, 1 → only 3; nothing sent)', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(pollIds(root, id)).toEqual([OPTION(id, '1'), OPTION(id, '2'), OPTION(id, '3')]);
    const [submit] = byTestId(root, SUBMIT(id));
    expect(submit.props.focusable).toBe(false);
    expect(submit.props.accessibilityState).toMatchObject({ disabled: true });
    expect(one(root, OPTION(id, '1')).props.accessibilityRole).toBe('checkbox');
    expect(one(root, OPTION(id, '1')).props.accessibilityState).toMatchObject({ checked: false });
    // Initial focus unchanged (the first paragraph).
    expect(lastFocusTarget()).toBe(BLOCK(id, 'text@0'));
    await press(root, OPTION(id, '1'));
    await press(root, OPTION(id, '3'));
    await press(root, OPTION(id, '1'));
    expect(checked(root, id)).toEqual(['3']);
    expect(one(root, OPTION(id, '3')).props.accessibilityState).toMatchObject({ checked: true });
    expect(pollIds(root, id)).toEqual([OPTION(id, '1'), OPTION(id, '2'), OPTION(id, '3'), SUBMIT(id)]);
    expect(pollCalls()).toEqual([]);
    await unmount(root);
  });

  it('matrix «Vote»: 1 and 3 checked, OK on «Проголосовать» → E11 `answer=1,3`, then E10; results with the checks; focus stays on the same control, now «Отозвать голос»', async () => {
    installFrameQueue();
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = req =>
      req.method === 'GET' ? { status: 200, body: { data: { poll: apiPoll([1, 3], [11, 8, 4]) } } } : { status: 200, body: {} };
    await press(root, OPTION(id, '3'));
    await press(root, OPTION(id, '1'));
    await focusOn(root, SUBMIT(id));
    actionView = guideDestinations.get('post/column')?.[0];
    expect(destinationIds('post/column')).toEqual([SUBMIT(id)]);
    focusMock.mockClear();
    await press(root, SUBMIT(id));
    expect(pollCalls()).toEqual([
      ['POST', VOTE, { answer: '1,3' }],
      ['GET', E10, null],
    ]);
    expect(pollIds(root, id)).toEqual([RETRACT(id)]);
    expect(chosen(root, id)).toEqual(['1', '3']);
    await expectFocusKeptOnAction(root, id);
    expect(pageText(root)).toContain(t('poll.retract'));
    const cached = queryClient.getQueryData<{ kind: string; post: Post }>(queryKeys.post(FEED_BLOG, id));
    expect(cached?.post.poll?.answer).toEqual(['1', '3']);
    await unmount(root);
  });

  it('matrix «Vote fails»: inline error, the checks kept, 1 request (no retry); the next OK clears the error', async () => {
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = () => ({ status: 503 });
    await press(root, OPTION(id, '1'));
    await press(root, OPTION(id, '3'));
    await press(root, SUBMIT(id), { settle: WITH_TIMERS });
    expect(pollCalls()).toEqual([['POST', VOTE, { answer: '1,3' }]]);
    expect(errorShown(root, id)).toBe(true);
    expect(pageText(root)).toContain(t('poll.voteFailed'));
    expect(checked(root, id)).toEqual(['1', '3']);
    expect(chosen(root, id)).toEqual([]);
    expect(pollIds(root, id)).toContain(SUBMIT(id));
    await press(root, OPTION(id, '2'));
    expect(errorShown(root, id)).toBe(false);
    expect(pollCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('matrix «Retract»: answer [1, 3]; «Отозвать голос» is the only stop; OK → pending hint; OK → E12, then E10; no checks; focus on the first option', async () => {
    e8Poll = apiPoll([1, 3], [11, 8, 4]);
    installFrameQueue();
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = req => (req.method === 'GET' ? { status: 200, body: { data: { poll: apiPoll(null) } } } : { status: 200 });
    expect(pollIds(root, id)).toEqual([RETRACT(id)]);
    expect(chosen(root, id)).toEqual(['1', '3']);
    await press(root, RETRACT(id));
    expect(retractPending(root, id)).toBe(true);
    expect(text(byTestId(root, `${RETRACT(id)}/pending`)[0])).toContain(t('poll.pendingRetract'));
    expect(pollCalls()).toEqual([]);
    focusMock.mockClear();
    await press(root, RETRACT(id));
    expect(pollCalls()).toEqual([
      ['DELETE', VOTE, null],
      ['GET', E10, null],
    ]);
    expect(chosen(root, id)).toEqual([]);
    expect(checked(root, id)).toEqual([]);
    // Device fix: the focused control (now a disabled «Проголосовать») stays
    // focusable while focus is handed to the first option. The request waits
    // for the options' layout: none on frame 1, from frame 2 on.
    expect(pollIds(root, id)).toEqual([OPTION(id, '1'), OPTION(id, '2'), OPTION(id, '3'), SUBMIT(id)]);
    expect(focusTargets()).toEqual([]);
    await frames(1);
    expect(focusTargets()).toEqual([]);
    await frames(1);
    expect(lastFocusTarget()).toBe(OPTION(id, '1'));
    expect(focusTargets()).not.toContain(AUTHOR(id));
    // The first option reports focus → «Проголосовать» turns non-focusable.
    await act(async () => {
      one(root, SUBMIT(id)).props.onBlur({ nativeEvent: {} });
    });
    await focusOn(root, OPTION(id, '1'));
    expect(pollIds(root, id)).toEqual([OPTION(id, '1'), OPTION(id, '2'), OPTION(id, '3')]);
    await unmount(root);
  });

  it('matrix «Retract» failure: inline error, the vote kept, 1 request', async () => {
    e8Poll = apiPoll([1, 3], [11, 8, 4]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = () => ({ network: true as const });
    await press(root, RETRACT(id));
    await press(root, RETRACT(id), { settle: WITH_TIMERS });
    expect(pollCalls()).toEqual([['DELETE', VOTE, null]]);
    expect(pageText(root)).toContain(t('poll.retractFailed'));
    expect(chosen(root, id)).toEqual(['1', '3']);
    expect(pollIds(root, id)).toEqual([RETRACT(id)]);
    await unmount(root);
  });

  it('matrix «Cancel retract»: OK on «Отозвать голос», then focus leaves → pending cleared; nothing sent', async () => {
    e8Poll = apiPoll([1, 3], [11, 8, 4]);
    const root = await openFromHome();
    const id = FEED_ID(0);
    await press(root, RETRACT(id));
    expect(retractPending(root, id)).toBe(true);
    await act(async () => {
      one(root, RETRACT(id)).props.onBlur({ nativeEvent: {} });
    });
    await focusOn(root, BLOCK(id, 'text@2'));
    expect(retractPending(root, id)).toBe(false);
    expect(pollCalls()).toEqual([]);
    await unmount(root);
  });

  it('E10 fails after the vote: the post`s E8 brings the voted poll; focus stays on the same control, now «Отозвать голос»; no error', async () => {
    installFrameQueue();
    const root = await openFromHome();
    const id = FEED_ID(0);
    pollReply = req => (req.method === 'GET' ? { status: 404, body: { error: 'not_found' } } : { status: 200 });
    const before = e8Calls().length;
    e8Poll = apiPoll([2], [10, 9, 3]);
    await press(root, OPTION(id, '2'));
    await focusOn(root, SUBMIT(id));
    actionView = guideDestinations.get('post/column')?.[0];
    focusMock.mockClear();
    await press(root, SUBMIT(id));
    expect(pollCalls()).toEqual([
      ['POST', VOTE, { answer: '2' }],
      ['GET', E10, null],
    ]);
    expect(e8Calls().length).toBe(before + 1);
    expect(errorShown(root, id)).toBe(false);
    expect(chosen(root, id)).toEqual(['2']);
    await expectFocusKeptOnAction(root, id);
    await unmount(root);
  });

  it('an open multiple-choice poll as the first stop: initial focus on its first option; once voted, on «Отозвать голос»', async () => {
    const header = [{ type: 'header', content: JSON.stringify(['Опрос недели', 'unstyled', []]), modificator: '' }];
    e8 = (_req, blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, header, { poll: e8Poll }) });
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(lastFocusTarget()).toBe(OPTION(id, '1'));
    await unmount(root);
    await resetQueryCache();
    e8Poll = apiPoll([1]);
    const voted = await openFromHome();
    expect(lastFocusTarget()).toBe(RETRACT(id));
    await unmount(voted);
  });

  it('matrix «Finished multi»: one inert stop', async () => {
    e8Poll = { ...apiPoll([1]), isFinished: true };
    const root = await openFromHome();
    const id = FEED_ID(0);
    expect(pollIds(root, id)).toEqual([POLL_ROOT(id)]);
    await press(root, POLL_ROOT(id));
    expect(pollCalls()).toEqual([]);
    await unmount(root);
  });
});
