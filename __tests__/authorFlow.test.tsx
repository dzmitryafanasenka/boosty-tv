/**
 * Story 3.3 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: Подписки → OK on a tile → Автор (E3 header + E4
 * posts via TanStack Query), every row of the spec's I/O matrix, the focus
 * rules of docs/focus-map.md §1.6 and §4 D, the shared sidebar (owner
 * decision 2026-10-27, option A), restoration on return, a 320-post blog and
 * the account-scoped cache. The keychain, BackHandler and the native focus
 * command are faked: these tests prove which element the app asks to focus,
 * not native focus movement (device checks, docs/testing.md).
 */
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { AppState, StyleSheet } from 'react-native';
import App, { navigationRef } from '../src/app/App';
import { phaseFlags } from '../src/app/phaseFlags';
import { LIVE_CARD_BLOCK_HEIGHT } from '../src/features/author/LiveCard';
import { queryClient, resetQueryCache } from '../src/app/queryClient';
import { accountScope } from '../src/shared/account';
import { QUERY_STALE_TIME_MS, queryKeys } from '../src/shared/api';
import {
  type FixtureReply,
  type FixtureRequest,
  type FixtureTransport,
} from '../src/shared/api/fixtureTransport';
import { DEFAULT_FILTER, filtersStore, getFilter } from '../src/shared/filters';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { formatCount } from '../src/shared/i18n/format';
import { logger } from '../src/shared/services/logger';
import { colors } from '../src/shared/ui';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { engine } from '../src/test/playerEngineMock';
import {
  blogPost,
  e3Body,
  e3MissingReply,
  e3Path,
  e4Page,
  e4Path,
  e15None,
  e15Path,
  e15Stream,
  syntheticBlogPosts,
} from '../src/test/authorFixtures';
import { E5_PATH, cursorFor, cursorOf, e5Page, lockedPost } from '../src/test/feedFixtures';
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
  gridRowItems,
  installFixtureTransport,
  installNativeModules,
  lastFocusTarget,
  listProps,
  lists,
  resetKeychain,
  resetRecorders,
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

jest.mock('react-native/Libraries/Components/TV/TVFocusGuideView', () =>
  require('../src/test/flow').recordingFocusGuideModule(),
);

/**
 * Story 7.1: the real LiveCard, plus a hook a test may set to run while the
 * card unmounts (its layout cleanup runs in the commit, before the page's
 * passive effects): Android moves native focus when the focused view goes.
 */
jest.mock('../src/features/author/LiveCard', () => {
  const actual = jest.requireActual('../src/features/author/LiveCard');
  const React = jest.requireActual('react');
  function LiveCard(props: Record<string, unknown>) {
    React.useLayoutEffect(
      () => () => {
        (globalThis as { onLiveCardUnmount?: () => void }).onLiveCardUnmount?.();
      },
      [],
    );
    return React.createElement(actual.LiveCard, props);
  }
  return { ...actual, LiveCard };
});

/** Story 7.2: the live Player's engine (the PlayerEngine port, mocked). */
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));

/**
 * Story 7.2: the QrRenderer port records the values it draws (as postFlow;
 * the test reads the QR target from here).
 */
const mockQrValues: string[] = [];
jest.mock('../src/shared/platform/qrRenderer', () => ({
  QR_QUIET_ZONE: 16,
  QrCode: (props: { value: string; testID?: string }) => {
    mockQrValues.push(props.value);
    return require('react').createElement('QrCodeMock', { testID: props.testID });
  },
}));

/** The real FlashList behind the recorder `lists` (`src/test/flow`; `onEndReached` held back). */
jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());

const focusMock = requestHostFocus as jest.Mock;

/** As subscriptionsFlow: 30 rounds, no timers unless a row needs the AD-6 backoff. */
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
const BLOG = blogUrlOf(1);
const TILE = (n: number) => `subs/tile/${blogUrlOf(n)}`;
const CARD = (postId: string, blogUrl: string = BLOG) => `author/${blogUrl}/post/${postId}`;
const SYN = (n: number) => CARD(`blog-post-${n}`);
const RETRY = `author/${BLOG}/retry`;
const ACTION = 'state/author/action';
const SIDEBAR_SUBS = 'author/nav/subs';
/** Story 5.7: the action row (the field's host view is the focus target). */
const FIELD = `author/${BLOG}/action/search`;
const FIELD_HOST = `${FIELD}/host`;
const CHIP = `author/${BLOG}/action/filters`;
const RESET = `author/${BLOG}/action/reset`;

type Reply = FixtureReply | Promise<FixtureReply> | undefined;
let e3: (req: FixtureRequest) => Reply;
let e4: (req: FixtureRequest) => Reply;
/** Story 5.7: E7 blog search and E14 blog tags. */
let e7: (req: FixtureRequest) => Reply;
let e14: (req: FixtureRequest) => Reply;
/** Story 7.1: E15 (the live stream); default the live 204 (no stream). */
let e15: (req: FixtureRequest) => Reply;
let transport: FixtureTransport;

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
  e3 = req => ({
    status: 200,
    body: e3Body(req.path.slice('/v1/blog/'.length), {
      title: 'Blog Title',
      owner: { name: 'Owner Name', hasAvatar: false },
    }),
  });
  e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 7 });
  e7 = () => undefined;
  e14 = () => undefined;
  e15 = () => e15None();
  transport = installFixtureTransport(req => {
    if (/^\/v1\/blog\/[^/]+\/video_stream$/.test(req.path)) {
      return e15(req);
    }
    // Story 7.3: the live Player's viewer heartbeat (E16) and its stop.
    if (req.method === 'PUT' && /^\/v1\/blog\/[^/]+\/video_stream\/heartbeat\/viewer$/.test(req.path)) {
      return { status: 200 };
    }
    if (req.path === '/v1/search/blog/post/') {
      return e7(req);
    }
    if (/^\/v1\/blog\/[^/]+\/post\/tag\/$/.test(req.path)) {
      return e14(req);
    }
    if (req.path === E1) {
      return { status: 200, body: e1NoBlogBody() };
    }
    if (req.path === E5_PATH) {
      return { status: 200, body: e5Page() };
    }
    if (req.path === E2_PATH) {
      return { status: 200, body: subscriptionsBody(9) };
    }
    if (/^\/v1\/blog\/[^/]+\/post\/$/.test(req.path)) {
      return e4(req);
    }
    if (/^\/v1\/blog\/[^/]+$/.test(req.path)) {
      return e3(req);
    }
    return undefined;
  });
});

afterEach(async () => {
  filtersStore.getState().clear();
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  jest.restoreAllMocks();
});

type Root = Awaited<ReturnType<typeof render>>;

const currentRoute = () => navigationRef.getCurrentRoute()?.name;
const routeNames = () => navigationRef.getRootState()?.routes.map(r => r.name);
const e3Calls = (blogUrl: string = BLOG) => transport.callsTo(e3Path(blogUrl));
const e4Calls = (blogUrl: string = BLOG) => transport.callsTo(e4Path(blogUrl));
const authorCards = (root: Root) =>
  focusableIds(root).filter(id => id?.startsWith(`author/${BLOG}/post/`));
/** The Author grid's FlashList props (last render). */
const grid = () => listProps('author/posts/list');
/** The post ids in the Author grid (its items are rows of up to 3). */
const gridPosts = () => gridRowItems<{ id: string }>('author/posts/list', 'posts').map(p => p.id);

/** The App on Подписки (9 tiles, focus on the first). */
async function openSubs() {
  const root = await render(<App />);
  await press(root, 'nav/subs');
  return root;
}

/** Подписки → OK on tile `n` → Автор. */
async function openAuthor(n = 1, settleOverrides?: { timerRounds: number }) {
  const root = await openSubs();
  focusMock.mockClear();
  await press(root, TILE(n), settleOverrides ? { settle: settleOverrides } : {});
  return root;
}

/** Replaces the cached E4 pages' posts (as a later refetch would), then settles. */
async function changeAuthorPosts(change: (ids: string[]) => string[]) {
  await act(async () => {
    type Data = { pages: Array<{ posts: Array<{ id: string }>; nextCursor: string | null }> };
    queryClient.setQueryData<Data>(queryKeys.authorPosts(BLOG, DEFAULT_FILTER), data => {
      if (!data) {
        return data;
      }
      const all = data.pages.flatMap(p => p.posts);
      const keep = change(all.map(p => p.id));
      return {
        ...data,
        pages: data.pages.map(page => ({
          ...page,
          posts: page.posts.filter(p => keep.includes(p.id)),
        })),
      };
    });
  });
  await settle();
}

describe('open from Подписки (matrix «Loaded»)', () => {
  it('OK on a tile: Автор with the header and the first page; E3 and E4 in parallel, content profile', async () => {
    e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 40 });
    const root = await openAuthor();
    expect(visible(root, 'author')).toBe(true);
    expect(e3Calls()).toHaveLength(1);
    expect(e4Calls()).toHaveLength(1);
    expect(e3Calls()[0].url).toBe(`https://api.boosty.to/v1/blog/${BLOG}`);
    expect(e4Calls()[0].url).toBe(
      `https://api.boosty.to/v1/blog/${BLOG}/post/?limit=20&comments_limit=0&reply_limit=0&is_only_allowed=true&only_bought=false`,
    );
    for (const call of [...e3Calls(), ...e4Calls()]) {
      expect(call.headers.Authorization).toBe(`Bearer ${'a'.repeat(64)}`);
      expect(call.headers['X-App']).toBeUndefined();
      expect(call.headers['X-From-Id']).toBeUndefined();
    }
    // No comment, search, tag or filter parameter, no other endpoint.
    expect(transport.calls.every(c => !/comment|search|tags|is_only_allowed|from_ts/.test(c.path))).toBe(true);
    // Story 5.7: the default Filter's access params only (owner decision Q2 a).
    expect(e4Calls()[0].url).not.toMatch(/tags_ids|from_ts|to_ts/);
    // Header: title and owner, not focusable; no price, cover or subscribe action.
    const header = byTestId(root, 'author/header')[0];
    expect(text(header)).toContain('Blog Title');
    expect(text(header)).toContain('Owner Name');
    expect(header.props.accessibilityLabel).toBe('Автор: Owner Name. Blog Title');
    expect(visible(root, 'author/header/avatar-placeholder')).toBe(true);
    expect(focusableIds(root, header)).toEqual([]);
    const page = text(byTestId(root, 'author/page')[0]);
    for (const forbidden of ['₽', 'RUB', 'USD', 'Оформить', 'Подписаться', 'коммент', 'Sample text']) {
      expect(page).not.toContain(forbidden);
    }
    // 20 posts, more pages: the partial row (18, 19) is held.
    expect(gridPosts()).toHaveLength(18);
    expect(lastFocusTarget()).toBe(SYN(0));
    // Every card has a Russian label.
    expect(one(root, SYN(0)).props.accessibilityLabel).toMatch(/^Видео\. Post 0\./);
    await unmount(root);
  });

  it('skeleton: the header skeleton and 2 rows; focus on the sidebar item «Подписки», then the first post', async () => {
    const header = deferred();
    const posts = deferred();
    e3 = () => header.promise;
    e4 = () => posts.promise;
    const root = await openAuthor();
    expect(visible(root, 'author/header-skeleton')).toBe(true);
    expect(visible(root, 'author/skeleton')).toBe(true);
    expect(focusableIds(root, byTestId(root, 'author/content')[0])).toEqual([]);
    // Focus leaves the covered Shell explicitly: the sidebar's current item.
    expect(lastFocusTarget()).toBe(SIDEBAR_SUBS);
    expect(one(root, SIDEBAR_SUBS).props.accessibilityState).toMatchObject({ selected: true });

    posts.resolve(syntheticBlogPosts({ blogUrl: BLOG, total: 7 })({ url: 'x' } as FixtureRequest));
    await settle();
    // The grid comes in while the header still loads.
    expect(visible(root, 'author/header-skeleton')).toBe(true);
    expect(authorCards(root)).toHaveLength(7);
    expect(lastFocusTarget()).toBe(SYN(0));
    header.resolve({ status: 200, body: e3Body(BLOG) });
    await settle();
    expect(visible(root, 'author/header')).toBe(true);
    await unmount(root);
  });

  it('the live E3 and E4 bodies: header from E3, 18 of 20 cards (row held), next page on focus in the last row', async () => {
    e3 = () => ({ status: 200, body: e3Body(BLOG) });
    e4 = req => ({ status: 200, body: cursorOf(req.url) === null ? e4Page(1) : e4Page(2, { isLast: true }) });
    const root = await openAuthor();
    expect(text(byTestId(root, 'author/header')[0])).toContain('redacted');
    expect(gridPosts()).toHaveLength(18);
    const ids = gridPosts();
    await focusOn(root, CARD(ids[15]));
    expect(e4Calls()).toHaveLength(2);
    // The opaque cursor goes back verbatim, URL-encoded.
    expect(e4Calls()[1].url).toContain('&offset=redacted');
    // The last page shows every post (no row held).
    expect(gridPosts()).toHaveLength(40);
    // Locked live posts are normal cards in the grid.
    const locked = e4Page(2).data.find(p => p.hasAccess === false) as { id: string };
    expect(gridPosts()).toContain(locked.id);
    await unmount(root);
  });

  it('the live pinned post (E4 isPinned) keeps Boosty\'s place and is marked with the pin badge (owner decisions 2026-10-27)', async () => {
    e4 = () => ({ status: 200, body: e4Page(2, { isLast: true }) });
    const root = await openAuthor();
    const [first, second] = gridPosts();
    expect(first).toBe((e4Page(2).data[0] as { id: string }).id);
    expect(visible(root, `${CARD(first)}/pin`)).toBe(true);
    expect(text(byTestId(root, `${CARD(first)}/date`)[0])).not.toContain('Закреплено');
    expect(one(root, CARD(first)).props.accessibilityLabel).toMatch(/^Закреплено\. /);
    expect(visible(root, `${CARD(second)}/pin`)).toBe(false);
    await unmount(root);
  });

  it('last page (isLast, 7 posts): 7 cards, nothing held, no further request', async () => {
    const root = await openAuthor();
    expect(gridPosts()).toHaveLength(7);
    await focusOn(root, SYN(6));
    await settle();
    expect(e4Calls()).toHaveLength(1);
    await unmount(root);
  });
});

describe('content (matrix «No posts», «Locked posts», «Malformed post»)', () => {
  it('no posts: header + «Публикаций нет»; only the action row in content; focus stays on the sidebar', async () => {
    e4 = () => ({ status: 200, body: { data: [], extra: { isLast: true } } });
    const root = await openAuthor();
    expect(visible(root, 'author/header')).toBe(true);
    expect(visible(root, 'author/empty')).toBe(true);
    expect(text(root)).toContain(t('author.emptyTitle'));
    // The chip is focusable only while the action row has focus; the field is a text input.
    expect(focusableIds(root, byTestId(root, 'author/content')[0])).toEqual([]);
    expect(visible(root, FIELD)).toBe(true);
    expect(destinationIds('author/content')).toEqual([FIELD_HOST]);
    expect(focusTargets().filter(Boolean)).toEqual([SIDEBAR_SUBS]);
    await unmount(root);
  });

  it('locked posts: dimmed «Нет доступа» cards, focusable; never a session problem', async () => {
    e4 = () => ({
      status: 200,
      body: {
        data: [
          { ...lockedPost(), id: 'locked-1', user: { name: 'A', blogUrl: BLOG } },
          blogPost(BLOG, 1),
        ],
        extra: { isLast: true },
      },
    });
    const root = await openAuthor();
    expect(authorCards(root)).toEqual([CARD('locked-1'), SYN(1)]);
    expect(visible(root, `${CARD('locked-1')}/lock`)).toBe(true);
    expect(one(root, CARD('locked-1')).props.accessibilityLabel).toMatch(/^Нет доступа\./);
    expect(transport.callsTo('/oauth/token/')).toHaveLength(0);
    expect(visible(root, 'author')).toBe(true);
    await unmount(root);
  });

  it('page 1 all locked: ordinary for a blog; no session check (no E1, no refetch; Epic 3 retro A6)', async () => {
    e4 = () => ({
      status: 200,
      body: {
        data: [
          { ...lockedPost(), id: 'locked-1', user: { name: 'A', blogUrl: BLOG } },
          { ...lockedPost(), id: 'locked-2', user: { name: 'A', blogUrl: BLOG } },
        ],
        extra: { isLast: true },
      },
    });
    const root = await openAuthor();
    await settle();
    expect(authorCards(root)).toEqual([CARD('locked-1'), CARD('locked-2')]);
    expect(visible(root, `${CARD('locked-2')}/lock`)).toBe(true);
    // Only the cold-start E1, Подписки's profile E1 («Мой блог», Story 5.2)
    // and one E4; the Author page never asks for more.
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(e4Calls()).toHaveLength(1);
    expect(transport.callsTo('/oauth/token/')).toHaveLength(0);
    expect(visible(root, 'author')).toBe(true);
    await unmount(root);
  });

  it('a post without id or user.blogUrl is dropped and logged (post id only); the page never fails', async () => {
    e4 = () => ({
      status: 200,
      body: {
        data: [
          blogPost(BLOG, 0),
          blogPost(BLOG, 1, { id: undefined }),
          blogPost(BLOG, 2, { user: { name: 'X' } }),
          blogPost(BLOG, 3),
        ],
        extra: { isLast: true },
      },
    });
    const root = await openAuthor();
    expect(authorCards(root)).toEqual([SYN(0), SYN(3)]);
    const dropped = logger.entries().filter(e => e.scope === 'post');
    expect(dropped.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(dropped)).not.toContain('Post 1');
    await unmount(root);
  });
});

describe('errors (matrix «Missing blog», «E3 fails», «E4 page 1/N fails»)', () => {
  it('E3 404 blog_not_found: «Автор недоступен» + «Назад» (focused), no retry; «Назад» pops to the same tile', async () => {
    e3 = () => e3MissingReply();
    const root = await openAuthor(2);
    expect(visible(root, 'author/unavailable')).toBe(true);
    expect(text(root)).toContain(t('author.unavailableTitle'));
    expect(text(root)).not.toContain(t('common.retry'));
    expect(one(root, ACTION).props.accessibilityLabel).toBe(t('common.back'));
    expect(lastFocusTarget()).toBe(ACTION);
    expect(visible(root, 'author/header')).toBe(false);
    expect(e3Calls(blogUrlOf(2))).toHaveLength(1);
    focusMock.mockClear();
    await press(root, ACTION);
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(TILE(2));
    // Nothing was retried.
    expect(e3Calls(blogUrlOf(2))).toHaveLength(1);
    await unmount(root);
  });

  it('E3 404: Back pops too', async () => {
    e3 = () => e3MissingReply();
    const root = await openAuthor(2);
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(TILE(2));
    await unmount(root);
  });

  it.each([
    ['Network', (): FixtureReply => ({ network: true })],
    ['Server', (): FixtureReply => ({ status: 503, body: {} })],
    ['Parse', (): FixtureReply => ({ status: 200, body: { title: 'x' } })],
  ])('E3 %s: the full error StateView «Повторить»; retry refetches E3 only (E4 succeeded)', async (kind, reply) => {
    e3 = reply;
    const root = await openAuthor(1, WITH_TIMERS);
    expect(visible(root, 'author/error')).toBe(true);
    expect(visible(root, 'author/header')).toBe(false);
    expect(visible(root, 'author/posts/list')).toBe(false);
    expect(text(root)).toContain(t(`error.${kind}` as 'error.Network'));
    expect(one(root, ACTION).props.accessibilityLabel).toBe(t('common.retry'));
    expect(lastFocusTarget()).toBe(ACTION);
    const before = { e3: e3Calls().length, e4: e4Calls().length };
    e3 = () => ({ status: 200, body: e3Body(BLOG) });
    focusMock.mockClear();
    await press(root, ACTION);
    expect(e3Calls()).toHaveLength(before.e3 + 1);
    expect(e4Calls()).toHaveLength(before.e4);
    expect(visible(root, 'author/header')).toBe(true);
    expect(lastFocusTarget()).toBe(SYN(0));
    await unmount(root);
  });

  it('E3 and E4 both fail: «Повторить» refetches both', async () => {
    e3 = () => ({ status: 400, body: {} });
    e4 = () => ({ status: 400, body: {} });
    const root = await openAuthor();
    expect(visible(root, 'author/error')).toBe(true);
    e3 = () => ({ status: 200, body: e3Body(BLOG) });
    e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 7 });
    await press(root, ACTION);
    expect(e3Calls()).toHaveLength(2);
    expect(e4Calls()).toHaveLength(2);
    expect(authorCards(root)).toHaveLength(7);
    await unmount(root);
  });

  it('E3 retry succeeds while E4 page 1 still loads: the action is gone, focus → the search field (Story 5.7), then the first post', async () => {
    e3 = () => ({ status: 400, body: {} });
    const posts = deferred();
    e4 = () => posts.promise;
    const root = await openAuthor();
    expect(visible(root, 'author/error')).toBe(true);
    expect(lastFocusTarget()).toBe(ACTION);
    e3 = () => ({ status: 200, body: e3Body(BLOG) });
    focusMock.mockClear();
    await press(root, ACTION);
    expect(visible(root, 'author/skeleton')).toBe(true);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    posts.resolve(syntheticBlogPosts({ blogUrl: BLOG, total: 7 })({ url: 'x' } as FixtureRequest));
    await settle();
    expect(lastFocusTarget()).toBe(SYN(0));
    await unmount(root);
  });

  it('E3 retry in flight keeps the busy action; a second failure keeps the error and focus', async () => {
    e3 = () => ({ status: 503, body: {} });
    const root = await openAuthor(1, WITH_TIMERS);
    expect(visible(root, 'author/error')).toBe(true);
    const reply = deferred();
    e3 = () => reply.promise;
    focusMock.mockClear();
    await press(root, ACTION);
    expect(visible(root, 'author/error')).toBe(true);
    expect(byTestId(root, ACTION).some(n => n.props.accessibilityState?.busy === true)).toBe(true);
    expect(focusTargets()).toEqual([]);
    reply.resolve({ status: 400, body: {} });
    await settle();
    expect(visible(root, 'author/error')).toBe(true);
    expect(visible(root, ACTION)).toBe(true);
    expect(focusTargets().filter(id => id !== ACTION)).toEqual([]);
    await unmount(root);
  });

  it('E4 page 1 fails, «Повторить» returns no posts: «Публикаций нет», focus → the search field (Story 5.7)', async () => {
    e4 = () => ({ status: 400, body: {} });
    const root = await openAuthor();
    expect(visible(root, 'author/posts-error')).toBe(true);
    e4 = () => ({ status: 200, body: { data: [], extra: { isLast: true } } });
    focusMock.mockClear();
    await press(root, ACTION);
    expect(visible(root, 'author/empty')).toBe(true);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    await unmount(root);
  });

  it('E4 page 1 fails: the header + the posts error StateView; retry reloads page 1 only', async () => {
    e4 = () => ({ status: 400, body: {} });
    const root = await openAuthor();
    expect(visible(root, 'author/header')).toBe(true);
    expect(visible(root, 'author/posts-error')).toBe(true);
    expect(text(root)).toContain(t('author.postsErrorTitle'));
    expect(lastFocusTarget()).toBe(ACTION);
    e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 7 });
    focusMock.mockClear();
    await press(root, ACTION);
    expect(e3Calls()).toHaveLength(1);
    expect(e4Calls()).toHaveLength(2);
    expect(cursorOf(e4Calls()[1].url)).toBeNull();
    expect(lastFocusTarget()).toBe(SYN(0));
    await unmount(root);
  });

  it('E4 page N fails: inline «Повторить» row, cards stay; retry reloads that page only and focuses the first new card', async () => {
    // Pages of 10 (the handler's size, not the request's): the first new
    // card is mounted in Jest's fixed FlashList window.
    const pages = syntheticBlogPosts({ blogUrl: BLOG, total: 30, pageSize: 10 });
    let fail = true;
    e4 = req => (cursorOf(req.url) === 10 && fail ? { status: 400, body: {} } : pages(req));
    const root = await openAuthor();
    // Post 9 (a partial row) is held while more pages may come.
    expect(gridPosts()).toHaveLength(9);
    await focusOn(root, SYN(8));
    expect(visible(root, RETRY)).toBe(true);
    expect(text(byTestId(root, 'author/posts/retry-row')[0])).toContain(t('author.loadMoreError'));
    expect(one(root, RETRY).props.accessibilityLabel).toBe(t('common.retry'));
    // Loaded cards stay; the held partial row shows while the next page fails.
    expect(gridPosts()).toHaveLength(10);
    // Focus in the last row does not retry by itself.
    await focusOn(root, SYN(8));
    expect(e4Calls()).toHaveLength(2);
    fail = false;
    focusMock.mockClear();
    await press(root, RETRY);
    expect(e4Calls().map(c => cursorOf(c.url))).toEqual([null, 10, 10]);
    expect(visible(root, RETRY)).toBe(false);
    expect(lastFocusTarget()).toBe(SYN(10));
    expect(e3Calls()).toHaveLength(1);
    await unmount(root);
  });
});

describe('focus (focus-map §4 D, §1.6)', () => {
  it('the user moves during the skeleton: the first post does not take focus', async () => {
    const posts = deferred();
    e4 = () => posts.promise;
    const root = await openAuthor();
    await focusOn(root, 'author/nav/home');
    focusMock.mockClear();
    posts.resolve(syntheticBlogPosts({ blogUrl: BLOG, total: 7 })({ url: 'x' } as FixtureRequest));
    await settle();
    expect(authorCards(root)).toHaveLength(7);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('the sidebar: the same enabled sections, current = Подписки; ← from column 1 → it, → back to the card', async () => {
    const root = await openAuthor();
    expect(focusableIds(root, byTestId(root, 'author/sidebar')[0])).toEqual([
      'author/nav/home',
      'author/nav/search',
      'author/nav/subs',
      'author/nav/settings',
    ]);
    expect(visible(root, 'author/nav/subs/current')).toBe(true);
    expect(destinationIds('author/sidebar')).toEqual([SIDEBAR_SUBS]);
    await focusOn(root, SYN(4));
    expect(destinationIds('author/content')).toEqual([SYN(4)]);
    // The content zone traps ↑ ↓ only: ← leaves it for the sidebar guide.
    const [zone] = byTestId(root, 'author/content');
    expect(zone.props).toMatchObject({ trapFocusUp: true, trapFocusDown: true });
    expect(zone.props.trapFocusLeft).toBeFalsy();
    // The route is trapped on all four sides (the Shell stays mounted below).
    expect(byTestId(root, 'author')[0].props).toMatchObject({
      trapFocusUp: true,
      trapFocusDown: true,
      trapFocusLeft: true,
      trapFocusRight: true,
    });
    await unmount(root);
  });

  it('OK on a post opens Пост for that post, sidebar origin Подписки (Story 3.4; the flow is in postFlow)', async () => {
    const root = await openAuthor();
    await press(root, SYN(1));
    expect(currentRoute()).toBe('Post');
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      blogUrl: BLOG,
      postId: 'blog-post-1',
      section: 'subs',
    });
    await unmount(root);
  });

  it('Back from a card pops to Подписки with focus on the same tile (same scroll)', async () => {
    const root = await openAuthor(5);
    await focusOn(root, CARD('blog-post-2', blogUrlOf(5)));
    focusMock.mockClear();
    lists.scrollToIndex.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(TILE(5));
    // Same index: no scroll by index.
    expect(lists.scrollToIndex).not.toHaveBeenCalled();
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    // Подписки was not requested again.
    expect(transport.callsTo(E2_PATH)).toHaveLength(1);
    await unmount(root);
  });

  it('Back from the Author sidebar pops to the same tile', async () => {
    const root = await openAuthor(3);
    await focusOn(root, 'author/nav/settings');
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(TILE(3));
    await unmount(root);
  });

  it('OK on «Подписки» in the Author sidebar pops to the same tile', async () => {
    const root = await openAuthor(3);
    focusMock.mockClear();
    await press(root, SIDEBAR_SUBS);
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'subs')).toBe(true);
    expect(lastFocusTarget()).toBe(TILE(3));
    await unmount(root);
  });

  it('OK on «Главная» in the Author sidebar: the Shell on Главная, focus on nav/home, then its first card', async () => {
    const root = await openAuthor(3);
    focusMock.mockClear();
    await press(root, 'author/nav/home');
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'shell/content/home')).toBe(true);
    expect(visible(root, 'nav/home/current')).toBe(true);
    expect(focusTargets()).toContain('nav/home');
    // As OK on «Главная» in the Shell: the cached feed takes focus.
    expect(lastFocusTarget()).toMatch(/^home\/feed\//);
    await unmount(root);
  });

  it('OK on «Настройки» in the Author sidebar: the Shell on Настройки, focus on its first row', async () => {
    const root = await openAuthor(3);
    focusMock.mockClear();
    await press(root, 'author/nav/settings');
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'shell/content/settings')).toBe(true);
    expect(lastFocusTarget()).toBe('settings/row/version');
    await unmount(root);
  });

  it('two tile OKs before the transition settles: one Автор, for the first tile; Back → that tile (Epic 3 retro F8)', async () => {
    const root = await openSubs();
    await focusOn(root, TILE(1));
    await act(async () => {
      one(root, TILE(1)).props.onClick({ nativeEvent: {} });
      one(root, TILE(2)).props.onClick({ nativeEvent: {} });
    });
    await settle();
    const routes = navigationRef.getRootState()?.routes ?? [];
    const authors = routes.filter(r => r.name === 'Author');
    expect(authors).toHaveLength(1);
    expect((authors[0].params as { blogUrl: string }).blogUrl).toBe(blogUrlOf(1));
    expect(e3Calls(blogUrlOf(2))).toHaveLength(0);
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe(TILE(1));
    await unmount(root);
  });

  it('a double OK on the same tile: one Автор, one E3 (Epic 3 retro F8)', async () => {
    const root = await openSubs();
    await act(async () => {
      one(root, TILE(1)).props.onClick({ nativeEvent: {} });
      one(root, TILE(1)).props.onClick({ nativeEvent: {} });
    });
    await settle();
    const routes = navigationRef.getRootState()?.routes ?? [];
    expect(routes.filter(r => r.name === 'Author')).toHaveLength(1);
    expect(e3Calls(blogUrlOf(1))).toHaveLength(1);
    await unmount(root);
  });

  it('OK on «Главная» twice in a row: the Shell on Главная; a later Author + Back returns to the tile (no section switch)', async () => {
    const root = await openAuthor(3);
    await press(root, 'author/nav/home', { settle: { rounds: 1 } });
    // A second OK during the pop is ignored.
    await press(root, 'author/nav/home', { settle: WITH_TIMERS });
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'author')).toBe(false);
    expect(visible(root, 'shell/content/home')).toBe(true);
    expect(navigationRef.getRootState()?.routes.map(r => r.name)).toEqual(['Shell']);

    await press(root, 'nav/subs');
    await press(root, TILE(3));
    expect(currentRoute()).toBe('Author');
    focusMock.mockClear();
    await back(WITH_TIMERS);
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'subs')).toBe(true);
    expect(visible(root, 'shell/content/home')).toBe(false);
    expect(lastFocusTarget()).toBe(TILE(3));
    await unmount(root);
  });

  it('the tile is gone on return: its neighbor by index', async () => {
    const root = await openAuthor(5);
    await act(async () => {
      type List = { authors: Array<{ blogUrl: string }> };
      queryClient.setQueryData<List>(queryKeys.subscriptions(), data =>
        data ? { ...data, authors: data.authors.filter(a => a.blogUrl !== blogUrlOf(5)) } : data,
      );
    });
    await settle();
    focusMock.mockClear();
    await back();
    expect(visible(root, TILE(5))).toBe(false);
    expect(lastFocusTarget()).toBe(TILE(6));
    await unmount(root);
  });

  it('a pushed route, then Back: the same card by id; gone → its neighbor', async () => {
    e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 12 });
    const root = await openAuthor();
    await focusOn(root, SYN(7));
    // A stand-in for the Post route (Story 3.4).
    await act(async () => {
      navigationRef.navigate('DevFocusDetail', { id: 'stand-in' });
    });
    await settle();
    focusMock.mockClear();
    await back();
    expect(visible(root, 'author')).toBe(true);
    expect(lastFocusTarget()).toBe(SYN(7));

    await act(async () => {
      navigationRef.navigate('DevFocusDetail', { id: 'stand-in' });
    });
    await settle();
    await changeAuthorPosts(ids => ids.filter(id => id !== 'blog-post-7'));
    focusMock.mockClear();
    await back();
    expect(visible(root, SYN(7))).toBe(false);
    expect(lastFocusTarget()).toBe(SYN(8));
    await unmount(root);
  });

  it('Автор unmounts: its FocusRestoration entries are forgotten', async () => {
    const root = await openAuthor();
    await focusOn(root, SYN(2));
    const key = navigationRef.getCurrentRoute()?.key as string;
    expect(focusRestoration.peek(key, 'main')?.focusId).toBe(SYN(2));
    // The closing transition runs on timers; the route unmounts after it.
    await back(WITH_TIMERS);
    expect(visible(root, 'author')).toBe(false);
    expect(focusRestoration.peek(key, 'main')).toBeUndefined();
    await unmount(root);
  });

  it('reopening the same author within staleTime: from the cache, the first post takes focus', async () => {
    const root = await openAuthor();
    await back();
    focusMock.mockClear();
    await press(root, TILE(1));
    expect(e3Calls()).toHaveLength(1);
    expect(e4Calls()).toHaveLength(1);
    expect(lastFocusTarget()).toBe(SYN(0));
    await unmount(root);
  });
});

describe('320 posts (matrix «>300 posts»)', () => {
  it('paged in order without duplicates; stable keys; focus never moves during the paging', async () => {
    e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 320 });
    const root = await openAuthor();
    const list = grid();
    expect(list.removeClippedSubviews).toBe(false);
    expect(list.getItemType(list.data[0], 0)).toBe('row');
    expect(typeof list.style[1].height).toBe('number');
    for (let i = 0; i < 40 && gridPosts().length < 320; i += 1) {
      await act(async () => {
        grid().onEndReached();
      });
      await settle();
    }
    const ids = gridPosts();
    expect(ids).toEqual(Array.from({ length: 320 }, (_, i) => `blog-post-${i}`));
    expect(e4Calls().map(c => cursorOf(c.url))).toEqual([
      null,
      ...Array.from({ length: 15 }, (_, i) => (i + 1) * 20),
    ]);
    const rows = grid().data as Array<{ key: string; posts: Array<{ id: string }> }>;
    expect(rows.every(r => r.key === r.posts[0].id)).toBe(true);
    expect(authorCards(root).length).toBeLessThan(320);
    // Only the skeleton's sidebar item and the first post, at load.
    expect(focusTargets().filter(Boolean)).toEqual([SIDEBAR_SUBS, SYN(0)]);
    await unmount(root);
  });
});

describe('account scope', () => {
  it('an account reset (sign-out, account switch) clears the cached author and posts', async () => {
    const root = await openAuthor();
    expect(queryClient.getQueryData(queryKeys.author(BLOG))).toBeDefined();
    expect(queryClient.getQueryData(queryKeys.authorPosts(BLOG, DEFAULT_FILTER))).toBeDefined();
    await unmount(root);
    await accountScope.reset();
    expect(queryClient.getQueryData(queryKeys.author(BLOG))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.authorPosts(BLOG, DEFAULT_FILTER))).toBeUndefined();
  });
});

describe('head refresh on reopen and resume (spec-author-posts-refresh)', () => {
  let appStateHandlers: Array<(state: string) => void> = [];

  beforeEach(() => {
    appStateHandlers = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      listener: (state: string) => void,
    ) => {
      appStateHandlers.push(listener);
      return {
        remove: () => {
          appStateHandlers = appStateHandlers.filter(h => h !== listener);
        },
      };
    }) as unknown as typeof AppState.addEventListener);
  });

  async function changeAppState(state: string) {
    await act(async () => {
      for (const h of [...appStateHandlers]) {
        h(state);
      }
    });
    await settle();
  }

  /** HOME, `ms` later back: the clock moves without firing timers. */
  async function backgroundFor(ms: number) {
    await changeAppState('background');
    jest.setSystemTime(Date.now() + ms);
    await changeAppState('active');
  }

  /** `total` synthetic posts; page 1 answered by `head` once set. */
  let head: ((req: FixtureRequest) => Reply) | null;
  function postsWithHead(total: number) {
    const pages = syntheticBlogPosts({ blogUrl: BLOG, total });
    head = null;
    return (req: FixtureRequest): Reply => (cursorOf(req.url) === null && head ? head(req) : pages(req));
  }
  /** A page-1 reply with these posts and the next cursor `cursor:<next>`. */
  const headPage = (posts: Record<string, unknown>[], next: number): FixtureReply => ({
    status: 200,
    body: { data: posts, extra: { offset: cursorFor(next), isLast: false } },
  });
  const newPost = (n: number) => blogPost(BLOG, 1000 + n, { id: `new-${n}`, title: `New ${n}` });
  const known = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => blogPost(BLOG, from + i));
  const pageOneCalls = () => e4Calls().filter(c => cursorOf(c.url) === null);

  /** 60 posts; two pages loaded (40 posts, 39 shown); focus on post 13. */
  async function deepInTheAuthor() {
    e4 = postsWithHead(60);
    const root = await openAuthor();
    await focusOn(root, SYN(15));
    expect(e4Calls()).toHaveLength(2);
    await focusOn(root, SYN(13));
    focusMock.mockClear();
    lists.scrollToIndex.mockClear();
    return root;
  }

  /** Open, load page 2 (40 posts), Back, then `ms` later OK on the same tile. */
  async function reopenAfter(ms: number) {
    e4 = postsWithHead(40);
    const root = await openAuthor();
    await focusOn(root, SYN(15));
    // No timers: they would also run the query cache's gc of the popped posts.
    await back();
    expect(currentRoute()).toBe('Shell');
    return {
      root,
      reopen: async () => {
        jest.setSystemTime(Date.now() + ms);
        focusMock.mockClear();
        lists.scrollToOffset.mockClear();
        lists.scrollToIndex.mockClear();
        await press(root, TILE(1));
        expect(currentRoute()).toBe('Author');
      },
    };
  }

  describe('reopen', () => {
    it('fresh cache (< 60 s): no E4 request', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS - 5_000);
      await reopen();
      expect(e4Calls()).toHaveLength(2);
      expect(gridPosts()).toHaveLength(40);
      expect(lastFocusTarget()).toBe(SYN(0));
      await unmount(root);
    });

    it('stale cache, 2 new posts: one E4 page 1 (no cursor); on top; both loaded pages kept', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      head = () => headPage([newPost(0), newPost(1), ...known(0, 18)], 18);
      await reopen();
      expect(e4Calls()).toHaveLength(3);
      expect(e4Calls()[2].url).toBe(
        `https://api.boosty.to/v1/blog/${BLOG}/post/?limit=20&comments_limit=0&reply_limit=0&is_only_allowed=true&only_bought=false`,
      );
      const ids = gridPosts();
      expect(ids.slice(0, 3)).toEqual(['new-0', 'new-1', 'blog-post-0']);
      expect(ids).toHaveLength(42);
      expect(new Set(ids).size).toBe(42);
      expect(ids).toContain('blog-post-39');
      expect(visible(root, 'author/error')).toBe(false);
      await unmount(root);
    });

    // Reopen focus (owner decision 2026-10-27, review loop 1, option 1).
    const twoNew = () => headPage([newPost(0), newPost(1), ...known(0, 18)], 18);
    const scrolledToTop = () =>
      lists.scrollToOffset.mock.calls.some(
        ([params]) => (params as { offset: number }).offset === 0,
      );

    it('new posts, the user has not moved, the reply before the mount focus event: the new first post, at the top', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      head = twoNew;
      await reopen();
      expect(e4Calls()).toHaveLength(3);
      // The automatic focus of the first cached post had not reached JS.
      expect(lastFocusTarget()).toBe(CARD('new-0'));
      expect(scrolledToTop()).toBe(true);
      expect(lists.scrollToIndex).not.toHaveBeenCalled();
      // The native events of both automatic focus requests arrive late, in
      // order: neither is a user move, so the next head change (a resume
      // refresh on the same page) still follows the head.
      await focusOn(root, SYN(0));
      await focusOn(root, CARD('new-0'));
      focusMock.mockClear();
      head = () => headPage([newPost(2), newPost(0), newPost(1), ...known(0, 17)], 17);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts()[0]).toBe('new-2');
      expect(focusTargets()).toEqual([CARD('new-2')]);
      await unmount(root);
    });

    it('new posts, the user has not moved, the reply after the mount focus event: the new first post, at the top', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      const reply = deferred();
      head = () => reply.promise;
      await reopen();
      expect(lastFocusTarget()).toBe(SYN(0));
      await focusOn(root, SYN(0));
      focusMock.mockClear();
      lists.scrollToOffset.mockClear();
      reply.resolve(twoNew());
      await settle();
      expect(gridPosts().slice(0, 3)).toEqual(['new-0', 'new-1', 'blog-post-0']);
      expect(focusTargets()).toEqual([CARD('new-0')]);
      expect(scrolledToTop()).toBe(true);
      expect(lists.scrollToIndex).not.toHaveBeenCalled();
      await unmount(root);
    });

    it.each([
      ['a D-pad move to card 1', async (root: Root) => focusOn(root, SYN(1)), SYN(1), 3],
      [
        '→ then ← back to the first card',
        async (root: Root) => {
          await focusOn(root, SYN(1));
          await focusOn(root, SYN(0));
        },
        SYN(0),
        2,
      ],
    ])(
      'new posts after the user moved (%s): the focused card keeps focus at its new row',
      async (_name, move, target, index) => {
        const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
        const reply = deferred();
        head = () => reply.promise;
        await reopen();
        await focusOn(root, SYN(0));
        await move(root);
        focusMock.mockClear();
        lists.scrollToOffset.mockClear();
        reply.resolve(twoNew());
        await settle();
        expect(gridPosts().indexOf(target.slice(CARD('').length))).toBe(index);
        expect(focusTargets()).toEqual([target]);
        // The grid scrolls by row (3 cards each).
        expect(lists.scrollToIndex).toHaveBeenCalledWith(
          expect.objectContaining({ index: Math.floor(index / 3), animated: false }),
        );
        expect(scrolledToTop()).toBe(false);
        await unmount(root);
      },
    );

    it('OK on an Автор card is a move: OK on the first card, Back while the head reply is pending, then the reply → that card at index 2 (not the new first post)', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      const reply = deferred();
      head = () => reply.promise;
      await reopen();
      await focusOn(root, SYN(0));
      await press(root, SYN(0));
      expect(currentRoute()).toBe('Post');
      await back();
      expect(currentRoute()).toBe('Author');
      focusMock.mockClear();
      reply.resolve(twoNew());
      await settle();
      expect(gridPosts().indexOf('blog-post-0')).toBe(2);
      expect(focusTargets()).not.toContain(CARD('new-0'));
      expect(lastFocusTarget()).toBe(SYN(0));
      await unmount(root);
    });

    it('new posts while Пост (opened with OK on the first card) covers Автор: no focus taken; Back restores that card at its new row', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      const reply = deferred();
      head = () => reply.promise;
      await reopen();
      await focusOn(root, SYN(0));
      await press(root, SYN(0));
      expect(currentRoute()).toBe('Post');
      focusMock.mockClear();
      reply.resolve(twoNew());
      await settle();
      expect(gridPosts().indexOf('blog-post-0')).toBe(2);
      expect(focusTargets().filter(id => id?.startsWith('author/'))).toEqual([]);
      lists.scrollToIndex.mockClear();
      await back();
      expect(currentRoute()).toBe('Author');
      expect(lastFocusTarget()).toBe(SYN(0));
      expect(lists.scrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 0, animated: false }),
      );
      await unmount(root);
    });

    it.each([
      ['a network failure', (): FixtureReply => ({ network: true }), 3, 'Network'],
      ['a 5xx', (): FixtureReply => ({ status: 503, body: { error: 'unavailable' } }), 2, 'Server'],
      ['a 400', (): FixtureReply => ({ status: 400, body: { error: 'bad_request' } }), 1, 'Client'],
    ])('the reopen refresh ends in %s: silent; the cache and focus stay', async (_name, reply, attempts, kind) => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      logger.clear();
      head = reply;
      await reopen();
      await settle(WITH_TIMERS);
      // Page 1 of the first open, then the refresh with its AD-6 retries.
      expect(pageOneCalls()).toHaveLength(1 + attempts);
      expect(e4Calls()).toHaveLength(2 + attempts);
      expect(gridPosts()).toEqual(Array.from({ length: 40 }, (_, i) => `blog-post-${i}`));
      expect(focusTargets()).toEqual([SYN(0)]);
      expect(visible(root, 'author/error')).toBe(false);
      expect(visible(root, 'author/posts-error')).toBe(false);
      expect(visible(root, 'author/posts/retry-row')).toBe(false);
      expect(logger.entries().filter(e => e.scope === 'author')).toEqual([
        expect.objectContaining({ message: 'head refresh failed', fields: { kind } }),
      ]);
      await unmount(root);
    });

    it('a failed page append, «Повторить» focused, then a stale resume: the refresh is skipped; the retry row and focus stay', async () => {
      const pages = syntheticBlogPosts({ blogUrl: BLOG, total: 60 });
      head = null;
      let failPage2 = true;
      e4 = req =>
        cursorOf(req.url) === null && head
          ? head(req)
          : cursorOf(req.url) === 20 && failPage2
            ? { status: 400, body: { error: 'bad_request' } }
            : pages(req);
      const root = await openAuthor();
      await focusOn(root, SYN(15));
      expect(visible(root, 'author/posts/retry-row')).toBe(true);
      await focusOn(root, RETRY);
      const calls = e4Calls().length;
      focusMock.mockClear();
      head = () => headPage([newPost(0), ...known(0, 19)], 19);
      failPage2 = false;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(e4Calls()).toHaveLength(calls);
      expect(gridPosts()[0]).toBe('blog-post-0');
      expect(visible(root, RETRY)).toBe(true);
      expect(focusMock).not.toHaveBeenCalled();
      await unmount(root);
    });

    it('an empty fresh page 1 with more pages: the cached posts stay (no gap wipe); fresh until a staleTime later', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      head = () => ({ status: 200, body: { data: [], extra: { offset: cursorFor(0), isLast: false } } });
      await reopen();
      expect(e4Calls()).toHaveLength(3);
      expect(visible(root, 'author/empty')).toBe(false);
      expect(authorCards(root)).toContain(SYN(0));
      const cached = queryClient.getQueryData<{ pages: Array<{ posts: Array<{ id: string }> }> }>(
        queryKeys.authorPosts(BLOG, DEFAULT_FILTER),
      );
      expect(cached?.pages.flatMap(p => p.posts.map(x => x.id))).toEqual(
        Array.from({ length: 40 }, (_, i) => `blog-post-${i}`),
      );
      expect(queryClient.getQueryState(queryKeys.authorPosts(BLOG, DEFAULT_FILTER))?.dataUpdatedAt).toBe(Date.now());
      expect(focusTargets()).toEqual([SYN(0)]);
      // The next reopen within a staleTime sends nothing.
      await back();
      await press(root, TILE(1));
      expect(e4Calls()).toHaveLength(3);
      await unmount(root);
    });

    it('an empty last page 1 (the author has no posts now): «Публикаций нет»', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      head = () => ({ status: 200, body: { data: [], extra: { isLast: true } } });
      await reopen();
      expect(e4Calls()).toHaveLength(3);
      expect(visible(root, 'author/empty')).toBe(true);
      expect(authorCards(root)).toEqual([]);
      await unmount(root);
    });

    it('stale cache, nothing new: no visible change; the fresh copies are written', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      const before = queryClient.getQueryState(queryKeys.authorPosts(BLOG, DEFAULT_FILTER))?.dataUpdatedAt ?? 0;
      await reopen();
      expect(e4Calls()).toHaveLength(3);
      expect(gridPosts()).toEqual(Array.from({ length: 40 }, (_, i) => `blog-post-${i}`));
      expect(queryClient.getQueryState(queryKeys.authorPosts(BLOG, DEFAULT_FILTER))?.dataUpdatedAt).toBeGreaterThan(
        before,
      );
      expect(lastFocusTarget()).toBe(SYN(0));
      await unmount(root);
    });

    it('a gap (page 1 shares no post): the cache is page 1 alone', async () => {
      const { root, reopen } = await reopenAfter(QUERY_STALE_TIME_MS + 1_000);
      head = () => headPage(Array.from({ length: 20 }, (_, i) => newPost(i)), 20);
      await reopen();
      expect(e4Calls()).toHaveLength(3);
      // 20 posts, more pages: the partial row held.
      expect(gridPosts()).toEqual(Array.from({ length: 18 }, (_, i) => `new-${i}`));
      // The user has not moved: the new first post.
      expect(lastFocusTarget()).toBe(CARD('new-0'));
      await unmount(root);
    });

    it('a first open without a cache loads normally (one E4 page 1)', async () => {
      jest.setSystemTime(Date.now() + 10 * QUERY_STALE_TIME_MS);
      e4 = postsWithHead(7);
      const root = await openAuthor();
      expect(pageOneCalls()).toHaveLength(1);
      expect(gridPosts()).toHaveLength(7);
      await unmount(root);
    });
  });

  describe('resume', () => {
    it('quick return (< 60 s): no E4 request', async () => {
      const root = await deepInTheAuthor();
      await backgroundFor(QUERY_STALE_TIME_MS - 5_000);
      expect(e4Calls()).toHaveLength(2);
      expect(focusMock).not.toHaveBeenCalled();
      await unmount(root);
    });

    it('stale, Автор open, 2 new posts: one E4 page 1; on top; card 13 keeps focus at its new row', async () => {
      const root = await deepInTheAuthor();
      head = () => headPage([newPost(0), newPost(1), ...known(0, 18)], 18);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(e4Calls()).toHaveLength(3);
      expect(cursorOf(e4Calls()[2].url)).toBeNull();
      const ids = gridPosts();
      expect(ids.slice(0, 3)).toEqual(['new-0', 'new-1', 'blog-post-0']);
      // 42 posts, more pages: 42 shown (a multiple of 3); page 2 kept.
      expect(ids).toHaveLength(42);
      expect(ids).toContain('blog-post-39');
      // Post 13 moved from row 4 to row 5: scrolled into view, focused again.
      expect(ids.indexOf('blog-post-13')).toBe(15);
      expect(lists.scrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 5, animated: false }),
      );
      expect(focusTargets()).toEqual([SYN(13)]);
      // The next page still continues from the last loaded page.
      await focusOn(root, SYN(39));
      expect(cursorOf(e4Calls()[e4Calls().length - 1].url)).toBe(40);
      await unmount(root);
    });

    it('a 1-post prepend moves the focused last-row card into the held partial row: it stays shown and focused', async () => {
      // Page 1: posts 0–17 (a multiple of 3). Later pages only repeat them
      // with fresh cursors, so the auto-paging stops with more pages "possible".
      head = null;
      e4 = req => {
        const n = cursorOf(req.url);
        if (n === null && head) {
          return head(req);
        }
        return headPage(known(0, 18), n === null ? 18 : n + 1);
      };
      const root = await openAuthor();
      await focusOn(root, SYN(17));
      await settle();
      expect(gridPosts()).toHaveLength(18);
      const calls = e4Calls().length;
      focusMock.mockClear();
      lists.scrollToIndex.mockClear();
      head = () => headPage([newPost(0), ...known(0, 18)], 18);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(e4Calls()).toHaveLength(calls + 1);
      // 19 posts with more pages: post 17 alone in the held row, but shown.
      const ids = gridPosts();
      expect(ids).toHaveLength(19);
      expect(ids[18]).toBe('blog-post-17');
      expect(lists.scrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 6, animated: false }),
      );
      expect(focusTargets()).toEqual([SYN(17)]);
      await unmount(root);
    });

    it('a gap: the cache is page 1 alone; focus follows the fallback chain', async () => {
      const root = await deepInTheAuthor();
      head = () => headPage(Array.from({ length: 20 }, (_, i) => newPost(i)), 20);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts()).toEqual(Array.from({ length: 18 }, (_, i) => `new-${i}`));
      // Post 13 (index 13) is gone: its neighbor by index.
      expect(lastFocusTarget()).toBe(CARD('new-13'));
      await unmount(root);
    });

    it('the refresh fails: nothing changes; only the error kind is logged', async () => {
      const root = await deepInTheAuthor();
      const before = gridPosts();
      logger.clear();
      head = () => ({ status: 400, body: { error: 'bad_request' } });
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(e4Calls()).toHaveLength(3);
      expect(gridPosts()).toEqual(before);
      expect(focusMock).not.toHaveBeenCalled();
      expect(logger.entries()).toContainEqual(
        expect.objectContaining({ scope: 'author', message: 'head refresh failed', fields: { kind: 'Client' } }),
      );
      // The refresh's own entry carries the kind only (no blog, no content).
      expect(JSON.stringify(logger.entries().filter(e => e.scope === 'author'))).not.toContain(BLOG);
      await unmount(root);
    });

    it.each([
      ['a network failure', (): FixtureReply => ({ network: true }), 3],
      ['a 5xx', (): FixtureReply => ({ status: 503, body: { error: 'unavailable' } }), 2],
    ])('the refresh E4 ends in %s: nothing changes', async (_name, reply, attempts) => {
      const root = await deepInTheAuthor();
      const before = gridPosts();
      head = reply;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      await settle(WITH_TIMERS);
      // Page 1 of the open, then the refresh with its AD-6 retries
      // (Network: 1 + 2, Server: 1 + 1).
      expect(pageOneCalls()).toHaveLength(1 + attempts);
      expect(gridPosts()).toEqual(before);
      expect(focusMock).not.toHaveBeenCalled();
      await unmount(root);
    });

    it('a page append in flight: the refresh is skipped', async () => {
      e4 = postsWithHead(60);
      const pages = e4;
      const next = deferred();
      e4 = req => (cursorOf(req.url) === 20 ? next.promise : pages(req));
      const root = await openAuthor();
      await focusOn(root, SYN(15));
      expect(e4Calls()).toHaveLength(2);
      head = () => headPage([newPost(0), ...known(0, 19)], 19);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(pageOneCalls()).toHaveLength(1);
      next.resolve(syntheticBlogPosts({ blogUrl: BLOG, total: 60 })({ url: `x?offset=${cursorFor(20)}` } as FixtureRequest));
      await settle();
      expect(gridPosts()[0]).toBe('blog-post-0');
      await unmount(root);
    });

    it('an account reset before the reply: the reply is dropped', async () => {
      const root = await deepInTheAuthor();
      const reply = deferred();
      head = () => reply.promise;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(e4Calls()).toHaveLength(3);
      await unmount(root);
      await accountScope.reset();
      reply.resolve(headPage([newPost(0), ...known(0, 19)], 19));
      await act(async () => {
        await Promise.resolve();
      });
      expect(queryClient.getQueryData(queryKeys.authorPosts(BLOG, DEFAULT_FILTER))).toBeUndefined();
    });

    it('focus on the Author sidebar: the data is merged, focus stays', async () => {
      const root = await deepInTheAuthor();
      await focusOn(root, SIDEBAR_SUBS);
      focusMock.mockClear();
      head = () => headPage([newPost(0), newPost(1), ...known(0, 18)], 18);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts()[0]).toBe('new-0');
      expect(focusTargets()).toEqual([]);
      await unmount(root);
    });

    it('a route above Автор (covered): the data is merged, Автор takes no focus; Back restores the card', async () => {
      const root = await deepInTheAuthor();
      await act(async () => {
        navigationRef.navigate('DevFocusDetail', { id: 'stand-in' });
      });
      await settle();
      focusMock.mockClear();
      head = () => headPage([newPost(0), newPost(1), ...known(0, 18)], 18);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(pageOneCalls()).toHaveLength(2);
      expect(gridPosts()[0]).toBe('new-0');
      expect(focusTargets().filter(id => id?.startsWith('author/'))).toEqual([]);
      focusMock.mockClear();
      await back();
      expect(lastFocusTarget()).toBe(SYN(13));
      await unmount(root);
    });

    /**
     * A first open without a cache: the skeleton's automatic sidebar focus,
     * then E4 page 1 (20 of 60 posts) and
     * the automatic first-post focus. `sidebarEventFirst`: the native event
     * of the sidebar focus reaches JS before the E4 reply, else after it.
     */
    async function firstOpenUntouched(sidebarEventFirst: boolean) {
      const pages = postsWithHead(60);
      const firstPage = deferred();
      let held = true;
      e4 = req => (held && cursorOf(req.url) === null ? firstPage.promise : pages(req));
      const root = await openAuthor();
      expect(lastFocusTarget()).toBe(SIDEBAR_SUBS);
      if (sidebarEventFirst) {
        await focusOn(root, SIDEBAR_SUBS);
      }
      held = false;
      firstPage.resolve(pages({ url: e4Calls()[0].url } as FixtureRequest) as FixtureReply);
      await settle();
      expect(lastFocusTarget()).toBe(SYN(0));
      if (!sidebarEventFirst) {
        // The late native event of the automatic sidebar focus.
        await focusOn(root, SIDEBAR_SUBS);
      }
      await focusOn(root, SYN(0));
      focusMock.mockClear();
      lists.scrollToOffset.mockClear();
      lists.scrollToIndex.mockClear();
      return root;
    }
    const scrolledToTopOnResume = () =>
      lists.scrollToOffset.mock.calls.some(
        ([params]) => (params as { offset: number }).offset === 0,
      );

    it.each([
      ['before', true],
      ['after', false],
    ])(
      'first open without a cache, untouched (sidebar event %s the E4 reply), stale resume with 2 new posts: the new first post, at the top',
      async (_order, sidebarEventFirst) => {
        const root = await firstOpenUntouched(sidebarEventFirst);
        head = () => headPage([newPost(0), newPost(1), ...known(0, 18)], 18);
        await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
        expect(gridPosts().slice(0, 3)).toEqual(['new-0', 'new-1', 'blog-post-0']);
        expect(focusTargets()).toEqual([CARD('new-0')]);
        expect(scrolledToTopOnResume()).toBe(true);
        expect(lists.scrollToIndex).not.toHaveBeenCalled();
        await unmount(root);
      },
    );

    it('Story 7.1: the live card holds the automatic focus: a stale resume with a new first post leaves it there', async () => {
      e15 = () => e15Stream('live');
      e4 = postsWithHead(60);
      const root = await openAuthor();
      expect(lastFocusTarget()).toBe(`author/${BLOG}/live`);
      // The native event of the page's own card focus.
      await focusOn(root, `author/${BLOG}/live`);
      focusMock.mockClear();
      head = () => headPage([newPost(0), newPost(1), ...known(0, 18)], 18);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts()[0]).toBe('new-0');
      expect(focusTargets()).not.toContain(CARD('new-0'));
      expect(focusTargets()).toEqual([]);
      await unmount(root);
    });

    it('Story 7.1: a scheduled card, the first post auto-focused: a stale resume still follows the new first post', async () => {
      e15 = () => e15Stream('scheduled');
      const root = await firstOpenUntouched(true);
      expect(visible(root, `author/${BLOG}/live`)).toBe(true);
      head = () => headPage([newPost(0), newPost(1), ...known(0, 18)], 18);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts().slice(0, 3)).toEqual(['new-0', 'new-1', 'blog-post-0']);
      expect(focusTargets()).toEqual([CARD('new-0')]);
      await unmount(root);
    });

    it('a deliberate move to another sidebar item latches: a stale resume leaves focus on the user\'s item', async () => {
      const root = await firstOpenUntouched(true);
      await focusOn(root, 'author/nav/home');
      focusMock.mockClear();
      head = () => headPage([newPost(0), newPost(1), ...known(0, 18)], 18);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts()[0]).toBe('new-0');
      expect(focusTargets()).toEqual([]);
      expect(scrolledToTopOnResume()).toBe(false);
      await unmount(root);
    });

    it('a popped Автор (no observer) is not refreshed on resume', async () => {
      e4 = postsWithHead(7);
      const root = await openAuthor();
      // The route unmounts after the closing transition (timers; they also
      // run the gc of its posts, so the cache is seeded again, stale).
      await back(WITH_TIMERS);
      expect(visible(root, 'author')).toBe(false);
      queryClient.setQueryData(
        queryKeys.authorPosts(BLOG, DEFAULT_FILTER),
        { pages: [{ posts: [], nextCursor: null }], pageParams: [null] },
        { updatedAt: Date.now() },
      );
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(e4Calls()).toHaveLength(1);
      await unmount(root);
    });
  });
});

describe('Story 5.7: search and filters inside an author', () => {
  /** The same flow with text input (the field) and a settling «Готово». */
  const f = createFlow({
    settle: { rounds: 30, timerRounds: 0 },
    one: 'focusableOrInput',
    pressFocuses: true,
    submitSettles: true,
  });
  const E7 = '/v1/search/blog/post/';
  const E14 = e4Path(BLOG).replace(/post\/$/, 'post/tag/');
  const STATE = ACTION;
  const searchCalls = () => transport.callsTo(E7);
  const tagCalls = () => transport.callsTo(E14);
  const queryOf = (url: string) => {
    const match = /[?&]search_query=([^&]*)/.exec(url);
    return match ? decodeURIComponent(match[1]) : null;
  };
  /** The locked twin of blog post `n` (E7 ignores the access params, live). */
  const lockedBlogPost = (n: number) => ({
    ...lockedPost(),
    id: `blog-post-${n}`,
    user: { name: 'A', blogUrl: BLOG },
  });
  /** An E7 handler over `total` results (pages of 20); `locked(n)` makes result n locked. */
  function syntheticBlogSearch(total: number, locked: (n: number) => boolean = () => false) {
    return (req: FixtureRequest): FixtureReply => {
      const start = cursorOf(req.url) ?? 0;
      const end = Math.min(start + 20, total);
      const searchPosts = Array.from({ length: Math.max(0, end - start) }, (_, i) => ({
        post: locked(start + i) ? lockedBlogPost(start + i) : blogPost(BLOG, start + i),
        rank: 5,
        headline: 'redacted',
        blog: { blogUrl: BLOG },
      }));
      return {
        status: 200,
        body: { data: { searchPosts }, extra: { offset: cursorFor(end), isLast: end >= total } },
      };
    };
  }
  const emptySearch = (): FixtureReply => ({
    status: 200,
    body: { data: { searchPosts: [] }, extra: { offset: 'end', isLast: true } },
  });
  const scope = () => {
    const key = navigationRef.getCurrentRoute()?.key;
    return `author:${key}` as const;
  };

  /** Type `query` into the field and press «Готово». */
  async function runSearch(root: Root, query: string) {
    await f.focusOn(root, FIELD);
    await f.type(root, FIELD, query);
    await f.submit(root, FIELD);
  }
  /** ↑ to the field, → the chip, OK: the sheet. */
  async function openSheet(root: Root) {
    await f.focusOn(root, FIELD);
    await f.focusOn(root, CHIP);
    await f.press(root, CHIP);
    expect(visible(root, 'filters/sheet')).toBe(true);
  }

  beforeEach(() => {
    e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 30 });
    e7 = syntheticBlogSearch(25);
    e14 = () => ({
      status: 200,
      body: {
        data: [
          { id: 7, title: 'Тег 7', count: 5 },
          { id: 3, title: 'Тег 3', count: 5 },
        ],
      },
    });
  });

  it('Open: E4 with the default access params; the action row (field, chip); no «Сбросить»; focus → the first post', async () => {
    const root = await openAuthor();
    expect(e4Calls()[0].url).toContain('&is_only_allowed=true&only_bought=false');
    expect(visible(root, 'author/action-row')).toBe(true);
    expect(f.one(root, FIELD).props.accessibilityLabel).toBe(t('author.search.fieldLabel'));
    expect(text(root)).toContain(t('author.search.fieldLabel'));
    expect(visible(root, CHIP)).toBe(true);
    expect(visible(root, RESET)).toBe(false);
    expect(lastFocusTarget()).toBe(SYN(0));
    // The chip is focusable only while the row has focus (Поиск's device lesson).
    expect(focusableIds(root)).not.toContain(CHIP);
    await f.focusOn(root, FIELD);
    expect(focusableIds(root)).toContain(CHIP);
    // ↑ from the first row: the field (the row guide's destination).
    expect(destinationIds('author/action-row')).toEqual([FIELD_HOST]);
    expect(searchCalls()).toHaveLength(0);
    await unmount(root);
  });

  it('Access values: the Author sheet offers «Доступные мне» and «Все посты» only (owner decision A a)', async () => {
    const root = await openAuthor();
    await openSheet(root);
    expect(visible(root, 'filters/access/allowed')).toBe(true);
    expect(visible(root, 'filters/access/all')).toBe(true);
    expect(visible(root, 'filters/access/bought')).toBe(false);
    await unmount(root);
  });

  it('Filter: «Все посты» refetches E4 behind the sheet; focus stays; the chip and «Сбросить»; the old list trimmed; Back → the chip', async () => {
    const root = await openAuthor();
    await focusOn(root, SYN(15));
    expect(e4Calls()).toHaveLength(2);
    const defaultKey = queryKeys.authorPosts(BLOG, DEFAULT_FILTER);
    expect(queryClient.getQueryData<{ pages: unknown[] }>(defaultKey)?.pages).toHaveLength(2);
    await openSheet(root);
    focusMock.mockClear();
    await f.press(root, 'filters/access/all');
    const url = e4Calls()[e4Calls().length - 1].url;
    expect(url).toContain('&is_only_allowed=false&only_bought=false');
    expect(cursorOf(url)).toBeNull();
    expect(focusTargets()).toEqual([]);
    expect(visible(root, 'filters/sheet')).toBe(true);
    expect(getFilter(scope()).access).toBe('all');
    // Главная's and Поиск's Filters are untouched.
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    expect(getFilter('search')).toEqual(DEFAULT_FILTER);
    expect(queryClient.getQueryData<{ pages: unknown[] }>(defaultKey)?.pages).toHaveLength(1);
    expect(byTestId(root, `${CHIP}/count`).length).toBeGreaterThan(0);
    await back();
    expect(visible(root, 'filters/sheet')).toBe(false);
    expect(lastFocusTarget()).toBe(CHIP);
    expect(visible(root, RESET)).toBe(true);
    await unmount(root);
  });

  it('Filter: an E4 error under the new Filter → the page-1 error state behind the sheet', async () => {
    const root = await openAuthor();
    await openSheet(root);
    e4 = () => ({ status: 400, body: {} });
    focusMock.mockClear();
    await f.press(root, 'filters/access/all');
    expect(visible(root, 'author/posts-error')).toBe(true);
    // The sheet keeps focus; nothing behind it is focused.
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('Blog tags: E14 once (no «Загрузить ещё», no E13); a toggle sends `tags_ids` on E4; reopening the level sends nothing', async () => {
    const root = await openAuthor();
    await openSheet(root);
    await f.press(root, 'filters/tags');
    expect(tagCalls()).toHaveLength(1);
    expect(transport.callsTo('/v1/search/feed/tag/')).toHaveLength(0);
    expect(visible(root, 'filters/tag/7')).toBe(true);
    expect(visible(root, 'filters/tag/3')).toBe(true);
    expect(visible(root, 'filters/tags/load-more')).toBe(false);
    await f.press(root, 'filters/tag/7');
    expect(e4Calls()[e4Calls().length - 1].url).toContain('&tags_ids=7');
    expect(getFilter(scope()).tags).toEqual([{ id: '7', title: 'Тег 7' }]);
    await back();
    await f.press(root, 'filters/tags');
    expect(tagCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('Blog tags: an E14 error → the «Повторить» row; OK reloads E14', async () => {
    e14 = () => ({ status: 400, body: {} });
    const root = await openAuthor();
    await openSheet(root);
    await f.press(root, 'filters/tags');
    expect(visible(root, 'filters/tags/retry')).toBe(true);
    e14 = () => ({ status: 200, body: { data: [{ id: 7, title: 'Тег 7', count: 5 }] } });
    await f.press(root, 'filters/tags/retry');
    expect(tagCalls()).toHaveLength(2);
    expect(visible(root, 'filters/tag/7')).toBe(true);
    await unmount(root);
  });

  it('Search: «пирог» + «Готово» → E7 (blog_url, trimmed query, Filter params); skeleton; focus → the first result', async () => {
    const page = deferred();
    e7 = () => page.promise;
    const root = await openAuthor();
    const e1Before = transport.callsTo(E1).length;
    await runSearch(root, '  пирог ');
    expect(searchCalls()).toHaveLength(1);
    const url = searchCalls()[0].url;
    expect(queryOf(url)).toBe('пирог');
    expect(url).toContain(`blog_url=${BLOG}&limit=20&comments_limit=0&reply_limit=0&is_only_allowed=true&only_bought=false`);
    expect(cursorOf(url)).toBeNull();
    expect(visible(root, 'author/skeleton')).toBe(true);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    expect(visible(root, RESET)).toBe(true);
    await act(async () => {
      page.resolve(syntheticBlogSearch(25)({ url } as FixtureRequest));
    });
    await settle();
    expect(lastFocusTarget()).toBe(SYN(0));
    expect(gridPosts().slice(0, 3)).toEqual(['blog-post-0', 'blog-post-1', 'blog-post-2']);
    // No session check for search results.
    expect(transport.callsTo(E1)).toHaveLength(e1Before);
    await unmount(root);
  });

  it('Search: an E7 error → «Повторить» focused; retry → the first result', async () => {
    e7 = () => ({ status: 400, body: {} });
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    expect(visible(root, 'author/search-error')).toBe(true);
    expect(lastFocusTarget()).toBe(STATE);
    e7 = syntheticBlogSearch(5);
    await f.press(root, STATE);
    expect(lastFocusTarget()).toBe(SYN(0));
    await unmount(root);
  });

  it('«Готово» from the error view on a slow device (the settle frame fires before the fetching render): the outcome still lands on the fetched results', async () => {
    e7 = () => ({ status: 400, body: {} });
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    expect(lastFocusTarget()).toBe(STATE);
    const reply = deferred();
    let pending: FixtureRequest | null = null;
    e7 = req => {
      pending = req;
      return reply.promise;
    };
    // TanStack's notifications are held: the render still shows the error
    // (not fetching) when the next frames fire.
    const held: Array<() => void> = [];
    notifyManager.setScheduler(callback => {
      held.push(callback);
    });
    try {
      await runSearch(root, 'пирог');
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      expect(visible(root, 'author/search-error')).toBe(true);
      expect(queryClient.isFetching({ queryKey: queryKeys.blogSearch(BLOG, 'пирог', DEFAULT_FILTER) })).toBe(1);
    } finally {
      notifyManager.setScheduler(callback => {
        Promise.resolve().then(callback);
      });
    }
    focusMock.mockClear();
    await act(async () => {
      held.splice(0).forEach(callback => callback());
    });
    reply.resolve(syntheticBlogSearch(5)(pending as unknown as FixtureRequest));
    await f.settle();
    expect(focusTargets()).not.toContain(STATE);
    expect(lastFocusTarget()).toBe(SYN(0));
    await unmount(root);
  });

  it.each([
    ['Back', async (_root: Root) => f.back()],
    ['a blank «Готово»', async (root: Root) => runSearch(root, '  ')],
  ])(
    'leaving a search while its E7 is pending (%s): the cached posts return, focus stays on the field, no card takes it',
    async (_label, leave) => {
      const root = await openAuthor();
      const reply = deferred();
      let pending: FixtureRequest | null = null;
      e7 = req => {
        pending = req;
        return reply.promise;
      };
      await runSearch(root, 'пирог');
      expect(visible(root, 'author/skeleton')).toBe(true);
      expect(pending).not.toBeNull();
      focusMock.mockClear();
      await leave(root);
      await f.settle();
      expect(currentRoute()).toBe('Author');
      expect(gridPosts()).toHaveLength(18);
      expect(lastFocusTarget()).toBe(FIELD_HOST);
      expect(focusTargets().filter(id => id?.startsWith(`author/${BLOG}/post/`))).toEqual([]);
      // The late E7 reply moves nothing either.
      reply.resolve(syntheticBlogSearch(5)(pending as unknown as FixtureRequest));
      await f.settle();
      expect(lastFocusTarget()).toBe(FIELD_HOST);
      expect(focusTargets().filter(id => id?.startsWith(`author/${BLOG}/post/`))).toEqual([]);
      await unmount(root);
    },
  );

  it('Search access (owner decision B a): «Доступные мне» drops locked results; «Все посты» shows them', async () => {
    e7 = syntheticBlogSearch(6, n => n % 2 === 1);
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    expect(gridPosts()).toEqual(['blog-post-0', 'blog-post-2', 'blog-post-4']);
    await openSheet(root);
    await f.press(root, 'filters/access/all');
    expect(searchCalls()[searchCalls().length - 1].url).toContain('is_only_allowed=false');
    expect(gridPosts()).toHaveLength(6);
    await unmount(root);
  });

  it('Search access: an all-locked page with more pages goes through the auto-fetch rule (3 more), then «Ничего не найдено»', async () => {
    e7 = syntheticBlogSearch(200, () => true);
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    expect(searchCalls()).toHaveLength(4);
    expect(visible(root, 'author/search-empty')).toBe(true);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    await unmount(root);
  });

  it('Nothing found: «Ничего не найдено», focus → the field; with filters → «Сбросить фильтры» focused, OK resets the scope and re-runs', async () => {
    e7 = emptySearch;
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    expect(visible(root, 'author/search-empty')).toBe(true);
    expect(text(root)).toContain(t('author.search.emptyTitle'));
    expect(visible(root, STATE)).toBe(false);
    expect(lastFocusTarget()).toBe(FIELD_HOST);

    await openSheet(root);
    await f.press(root, 'filters/access/all');
    await back();
    await runSearch(root, 'пирог');
    expect(lastFocusTarget()).toBe(STATE);
    expect(text(root)).toContain(t('author.search.resetFilters'));
    e7 = syntheticBlogSearch(3);
    await f.press(root, STATE);
    expect(getFilter(scope())).toEqual(DEFAULT_FILTER);
    expect(searchCalls()[searchCalls().length - 1].url).toContain('is_only_allowed=true');
    expect(lastFocusTarget()).toBe(SYN(0));
    await unmount(root);
  });

  it('«Сбросить фильтры» onto a cached, also empty default list (no fetch, no phase change): the outcome settles, focus stays on the field; a later change moves nothing', async () => {
    e4 = () => ({ status: 200, body: { data: [], extra: { isLast: true } } });
    const root = await openAuthor();
    expect(visible(root, 'author/empty')).toBe(true);
    await openSheet(root);
    await f.press(root, 'filters/access/all');
    await back();
    // The modal host's delayed return of focus to the chip runs first.
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    expect(visible(root, 'author/filtered-empty')).toBe(true);
    const before = e4Calls().length;
    await f.press(root, STATE);
    // The action goes with the view: the field takes focus natively.
    await f.focusOn(root, FIELD);
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    await settle();
    expect(e4Calls()).toHaveLength(before);
    expect(visible(root, 'author/empty')).toBe(true);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    // A later, unrelated change of the list (posts arrive): no outcome is
    // pending any more, so focus is not moved off the field.
    focusMock.mockClear();
    await act(async () => {
      queryClient.setQueryData(queryKeys.authorPosts(BLOG, DEFAULT_FILTER), {
        pages: [{ posts: [], nextCursor: null }],
        pageParams: [null],
      });
    });
    e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 7 });
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: queryKeys.authorPosts(BLOG, DEFAULT_FILTER) });
    });
    await settle();
    expect(visible(root, 'author/posts/list')).toBe(true);
    expect(focusTargets().filter(id => id?.startsWith(`author/${BLOG}/post/`))).toEqual([]);
    await unmount(root);
  });

  it('Trim: a multi-page search whose key changes keeps its first page only', async () => {
    e7 = syntheticBlogSearch(60);
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    await focusOn(root, SYN(15));
    expect(searchCalls()).toHaveLength(2);
    const key = queryKeys.blogSearch(BLOG, 'пирог', DEFAULT_FILTER);
    expect(queryClient.getQueryData<{ pages: unknown[] }>(key)?.pages).toHaveLength(2);
    await openSheet(root);
    await f.press(root, 'filters/access/all');
    expect(queryClient.getQueryData<{ pages: unknown[] }>(key)?.pages).toHaveLength(1);
    await unmount(root);
  });

  it('Filtered posts empty: «Ничего не найдено» + «Сбросить фильтры» (no search)', async () => {
    const root = await openAuthor();
    await openSheet(root);
    e4 = () => ({ status: 200, body: { data: [], extra: { isLast: true } } });
    await f.press(root, 'filters/access/all');
    await back();
    expect(visible(root, 'author/filtered-empty')).toBe(true);
    expect(text(root)).toContain(t('author.search.resetFilters'));
    await unmount(root);
  });

  it('Blank «Готово»: no request, the normal list; also after results', async () => {
    const root = await openAuthor();
    await runSearch(root, '   ');
    expect(searchCalls()).toHaveLength(0);
    await runSearch(root, 'пирог');
    expect(searchCalls()).toHaveLength(1);
    await runSearch(root, ' ');
    expect(searchCalls()).toHaveLength(1);
    expect(visible(root, RESET)).toBe(false);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    await unmount(root);
  });

  it('Back, search active: query cleared, the normal list, focus → the field; Back again pops', async () => {
    e7 = syntheticBlogSearch(2);
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    expect(gridPosts()).toEqual(['blog-post-0', 'blog-post-1']);
    focusMock.mockClear();
    await f.back();
    expect(currentRoute()).toBe('Author');
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    // The normal list again (page 1: 18 of 20 shown, the partial row held).
    expect(gridPosts()).toHaveLength(18);
    expect(f.one(root, FIELD).props.value).toBe('');
    expect(visible(root, RESET)).toBe(false);
    await f.back();
    expect(currentRoute()).toBe('Shell');
    await unmount(root);
  });

  it('«Сбросить»: clears the query and the Filter, focus → the chip; hidden at the default', async () => {
    const root = await openAuthor();
    await openSheet(root);
    await f.press(root, 'filters/access/all');
    await back();
    await runSearch(root, 'пирог');
    await f.focusOn(root, FIELD);
    await f.focusOn(root, CHIP);
    await f.focusOn(root, RESET);
    focusMock.mockClear();
    const before = e4Calls().length;
    await f.press(root, RESET);
    expect(focusTargets()[0]).toBe(CHIP);
    expect(getFilter(scope())).toEqual(DEFAULT_FILTER);
    expect(visible(root, RESET)).toBe(false);
    expect(gridPosts()).toHaveLength(18);
    // The default list is cached (it was the first one): at most one request.
    expect(e4Calls().length - before).toBeLessThanOrEqual(1);
    await unmount(root);
  });

  it('Isolation: a Filter on author A leaves Главная, Поиск and another author at the default; a reopened A starts at the default', async () => {
    const root = await openAuthor();
    await openSheet(root);
    await f.press(root, 'filters/access/all');
    await back();
    const scopeA = scope();
    expect(getFilter(scopeA).access).toBe('all');
    // The closing transition runs on timers; the route unmounts after it.
    await back(WITH_TIMERS);
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'author')).toBe(false);
    // Dropped on unmount.
    expect(filtersStore.getState().filters[scopeA]).toBeUndefined();
    expect(Object.keys(filtersStore.getState().filters)).toEqual([]);
    await press(root, TILE(1));
    expect(getFilter(scope())).toEqual(DEFAULT_FILTER);
    expect(visible(root, RESET)).toBe(false);
    expect(e4Calls()[e4Calls().length - 1].url).toContain('is_only_allowed=true');
    await back();
    await press(root, TILE(2));
    expect(getFilter(scope())).toEqual(DEFAULT_FILTER);
    await unmount(root);
  });

  it('Return from Post: the same query, Filter and card (no new E7); a gone card → its neighbour', async () => {
    e7 = syntheticBlogSearch(6);
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    const calls = searchCalls().length;
    await press(root, SYN(4));
    expect(currentRoute()).toBe('Post');
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Author');
    expect(lastFocusTarget()).toBe(SYN(4));
    expect(searchCalls()).toHaveLength(calls);
    expect(f.one(root, FIELD).props.value).toBe('пирог');

    await press(root, SYN(4));
    await act(async () => {
      type Data = { pages: Array<{ posts: Array<{ id: string }> }> };
      queryClient.setQueryData<Data>(queryKeys.blogSearch(BLOG, 'пирог', DEFAULT_FILTER), data =>
        data
          ? { ...data, pages: data.pages.map(p => ({ ...p, posts: p.posts.filter(x => x.id !== 'blog-post-4') })) }
          : data,
      );
    });
    await settle();
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe(SYN(5));
    await unmount(root);
  });

  it('Keys: the blog search key never collides with Поиск or the author posts; the Filter is in the E4 key', async () => {
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    expect(queryClient.getQueryData(queryKeys.blogSearch(BLOG, 'пирог', DEFAULT_FILTER))).toBeDefined();
    expect(queryClient.getQueryData(queryKeys.feedSearch('пирог', DEFAULT_FILTER))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.authorPosts(BLOG, DEFAULT_FILTER))).toBeDefined();
    expect(transport.callsTo('/v1/search/feed/post/')).toHaveLength(0);
    await unmount(root);
  });

  it('300 results: paged by the opaque cursor without duplicates; stable row keys; focus never moves', async () => {
    e7 = syntheticBlogSearch(300);
    const root = await openAuthor();
    await runSearch(root, 'пирог');
    focusMock.mockClear();
    for (let i = 0; i < 30 && gridPosts().length < 300; i += 1) {
      await act(async () => {
        grid().onEndReached();
      });
      await settle();
    }
    const ids = gridPosts();
    expect(ids).toEqual(Array.from({ length: 300 }, (_, i) => `blog-post-${i}`));
    expect(searchCalls().map(c => cursorOf(c.url))).toEqual([
      null,
      ...Array.from({ length: 14 }, (_, i) => (i + 1) * 20),
    ]);
    expect(searchCalls().every(c => queryOf(c.url) === 'пирог')).toBe(true);
    const rows = grid().data as Array<{ key: string; posts: Array<{ id: string }> }>;
    expect(rows.every(r => r.key === r.posts[0].id)).toBe(true);
    expect(authorCards(root).length).toBeLessThan(300);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  describe('resume', () => {
    let appStateHandlers: Array<(state: string) => void> = [];
    beforeEach(() => {
      appStateHandlers = [];
      jest.spyOn(AppState, 'addEventListener').mockImplementation(((
        _type: string,
        listener: (state: string) => void,
      ) => {
        appStateHandlers.push(listener);
        return {
          remove: () => {
            appStateHandlers = appStateHandlers.filter(h => h !== listener);
          },
        };
      }) as unknown as typeof AppState.addEventListener);
    });
    async function changeAppState(state: string) {
      await act(async () => {
        for (const h of [...appStateHandlers]) {
          h(state);
        }
      });
      await settle();
    }

    it('the head refresh uses the active Filter (E4 page 1 with is_only_allowed=false); the search results are never refreshed', async () => {
      const root = await openAuthor();
      await openSheet(root);
      await f.press(root, 'filters/access/all');
      await back();
      await runSearch(root, 'пирог');
      const e7Before = searchCalls().length;
      // Leave the search so the posts list is shown, then go stale.
      await f.back();
      const before = e4Calls().length;
      await changeAppState('background');
      jest.setSystemTime(Date.now() + QUERY_STALE_TIME_MS + 1_000);
      await changeAppState('active');
      const fresh = e4Calls().slice(before);
      expect(fresh).toHaveLength(1);
      expect(fresh[0].url).toContain('&is_only_allowed=false&only_bought=false');
      expect(cursorOf(fresh[0].url)).toBeNull();
      expect(searchCalls()).toHaveLength(e7Before);
      await unmount(root);
    });
  });
});

describe('Story 7.1: the live stream card on the author page', () => {
  const LIVE = `author/${BLOG}/live`;
  const LIVE_GUIDE = 'author/live/guide';
  const GRID_GUIDE = 'author/posts/guide';
  const streamCalls = (blogUrl: string = BLOG) => transport.callsTo(e15Path(blogUrl));
  const allStreamCalls = () => transport.calls.filter(c => /\/video_stream$/.test(c.path));
  const cardText = (root: Root) => text(byTestId(root, LIVE)[0]);
  const gridHeight = () => grid().style[1].height as number;
  /** The field is a text input (Story 5.7's profile). */
  const withInput = createFlow({
    settle: { rounds: 30, timerRounds: 0 },
    one: 'focusableOrInput',
    pressFocuses: true,
    submitSettles: true,
  });
  /** The 30 s poll (fake timers), then settle. */
  async function advance(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await settle();
  }

  beforeEach(() => {
    e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 12 });
  });

  it('No stream (E15 204): no card; one E15 with the content profile; layout and focus as before; none from Главная or Подписки', async () => {
    const root = await openSubs();
    expect(allStreamCalls()).toHaveLength(0);
    focusMock.mockClear();
    await press(root, TILE(1));
    expect(streamCalls()).toHaveLength(1);
    expect(streamCalls()[0].url).toBe(`https://api.boosty.to/v1/blog/${BLOG}/video_stream`);
    expect(streamCalls()[0].headers.Authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    expect(visible(root, LIVE)).toBe(false);
    expect(visible(root, LIVE_GUIDE)).toBe(false);
    expect(focusTargets().filter(Boolean)).toEqual([SIDEBAR_SUBS, SYN(0)]);
    const heightWithout = gridHeight();
    await unmount(root);

    // The same page with a card: the grid gives up exactly the card's block.
    await resetQueryCache();
    e15 = () => e15Stream('live');
    const withCard = await openAuthor();
    expect(gridHeight()).toBe(heightWithout - LIVE_CARD_BLOCK_HEIGHT);
    await unmount(withCard);
  });

  it('Live: LIVE badge on colors.live, title, viewers and likes, cover; initial focus on the card; the label', async () => {
    e15 = () => e15Stream('live', { count: { viewers: 1643, likes: 21 } });
    const root = await openAuthor();
    expect(visible(root, LIVE)).toBe(true);
    const badge = byTestId(root, `${LIVE}/badge`)[0];
    expect(text(badge)).toContain(t('author.live.badgeLive'));
    expect(StyleSheet.flatten(badge.props.style).backgroundColor).toBe(colors.live);
    expect(cardText(root)).toContain('redacted');
    expect(cardText(root)).toContain(t('author.live.statusLive'));
    expect(text(byTestId(root, `${LIVE}/details`)[0])).toContain(`${formatCount(1643)} зрителя · 21 лайк`);
    expect(byTestId(root, `${LIVE}/cover`)[0].props.source).toEqual({ uri: 'https://example.invalid/cover' });
    expect(focusableIds(root)).toContain(LIVE);
    // Initial focus: the card (after the skeleton's sidebar item), never the first post after it.
    const targets = focusTargets().filter(Boolean);
    expect(targets[targets.length - 1]).toBe(LIVE);
    expect(targets).not.toContain(SYN(0));
    expect(byTestId(root, LIVE).find(n => n.props.focusable)?.props.accessibilityLabel).toBe(
      `Эфир: redacted. Идёт эфир. ${formatCount(1643)} зрителя · 21 лайк`,
    );
    // No price anywhere on the card.
    expect(cardText(root)).not.toMatch(/₽|RUB|руб/);
    await unmount(root);
  });

  it('Live (device lesson): the card focus request is repeated two frames later (a view mounted in the same commit drops it); not after a user move', async () => {
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    const liveRequests = () => focusTargets().filter(id => id === LIVE).length;
    const before = liveRequests();
    expect(before).toBeGreaterThan(0);
    await advance(50);
    expect(liveRequests()).toBeGreaterThan(before);
    await unmount(root);

    // The user moves before the frames: no repeat.
    await resetQueryCache();
    focusRestoration.clear();
    const moved = await openAuthor();
    await focusOn(moved, SYN(2));
    focusMock.mockClear();
    await advance(50);
    expect(focusTargets()).not.toContain(LIVE);
    await unmount(moved);
  });

  it('Live: ↓ from the card → the grid (the remembered card, else the first post); ↑ from the grid → the card; ↓ from the row → the card', async () => {
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    // ↑ from any grid column enters the live guide: the card.
    expect(destinationIds(LIVE_GUIDE)).toEqual([LIVE]);
    await focusOn(root, LIVE);
    expect(destinationIds(GRID_GUIDE)).toEqual([SYN(0)]);
    await focusOn(root, SYN(4));
    expect(destinationIds(GRID_GUIDE)).toEqual([]);
    await focusOn(root, LIVE);
    expect(destinationIds(GRID_GUIDE)).toEqual([SYN(4)]);
    // On the row, the grid guide points nowhere: ↓ finds the card (the nearest stop below).
    await withInput.focusOn(root, FIELD);
    expect(destinationIds(GRID_GUIDE)).toEqual([]);
    // ↑ from the card: the row guide → the field (unchanged).
    expect(destinationIds('author/action-row')).toEqual([FIELD_HOST]);
    await unmount(root);
  });

  it('Live: the focused card shows one ring and scales without reflow (same layout size focused and not)', async () => {
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    const sizeOf = () => {
      const scale = StyleSheet.flatten(byTestId(root, `${LIVE}/scale`)[0].props.style);
      return [scale.width, scale.height];
    };
    const outer = () => StyleSheet.flatten(byTestId(root, LIVE).find(n => n.props.focusable)?.props.style);
    const before = { size: sizeOf(), outer: outer() };
    expect(visible(root, `${LIVE}/ring`)).toBe(false);
    await focusOn(root, LIVE);
    expect(byTestId(root, `${LIVE}/ring`)).toHaveLength(1);
    expect(sizeOf()).toEqual(before.size);
    expect(before.size).toEqual([520, 120]);
    expect(outer()).toEqual(before.outer);
    await unmount(root);
  });

  it('Scheduled: «Запланирован», the start date and time, no viewer count; initial focus stays on the first post', async () => {
    const start = new Date(2026, 9, 31, 19, 0).getTime() / 1000;
    e15 = () => e15Stream('scheduled', { startTime: start });
    const root = await openAuthor();
    expect(text(byTestId(root, `${LIVE}/badge`)[0])).toContain(t('author.live.badgeScheduled'));
    expect(StyleSheet.flatten(byTestId(root, `${LIVE}/badge`)[0].props.style).backgroundColor).not.toBe(colors.live);
    expect(text(byTestId(root, `${LIVE}/status`)[0])).toMatch(/Начало .* в 19:00/);
    expect(cardText(root)).not.toContain('зрител');
    expect(text(byTestId(root, `${LIVE}/details`)[0])).toContain('5 лайков');
    expect(lastFocusTarget()).toBe(SYN(0));
    // A focus stop: ↓ from the row reaches it, ↑ from the grid too.
    expect(focusableIds(root)).toContain(LIVE);
    expect(destinationIds(LIVE_GUIDE)).toEqual([LIVE]);
    await unmount(root);
  });

  it('Needs level (hasAccess false): «Нужен уровень «…»», no price, no counts; never a session check', async () => {
    e15 = () => e15Stream('locked', { subscriptionLevel: { name: 'Золото', currencyPrices: { RUB: 500 } } });
    const root = await openAuthor();
    const e1Before = transport.callsTo(E1).length;
    expect(text(byTestId(root, `${LIVE}/details`)[0])).toContain('Нужен уровень «Золото»');
    expect(cardText(root)).not.toMatch(/500|₽|RUB|зрител/);
    // Live and locked: still the LIVE badge and the initial focus (watching is Story 7.2).
    expect(text(byTestId(root, `${LIVE}/badge`)[0])).toContain('LIVE');
    expect(lastFocusTarget()).toBe(LIVE);
    await settle();
    expect(transport.callsTo(E1)).toHaveLength(e1Before);
    expect(currentRoute()).toBe('Author');
    await unmount(root);
  });

  it.each([
    ['no id', { id: undefined }],
    ['isOnline not a boolean', { isOnline: 'yes' }],
  ])('Malformed 200 (%s): no card; a counts-only warning; the page works', async (_name, overrides) => {
    e15 = () => e15Stream('live', overrides);
    const root = await openAuthor();
    expect(visible(root, LIVE)).toBe(false);
    expect(lastFocusTarget()).toBe(SYN(0));
    const warnings = logger.entries().filter(e => e.scope === 'stream');
    expect(warnings).toEqual([expect.objectContaining({ level: 'warn', message: 'dropped', fields: { issues: '1' } })]);
    expect(JSON.stringify(logger.entries())).not.toMatch(/example\.invalid|sig=/);
    await unmount(root);
  });

  it.each([
    ['5xx', { status: 503 }],
    ['network', { network: true as const }],
  ])('E15 fails on the first load (%s): no card, no error UI, sent once; no polling', async (_name, reply) => {
    e15 = () => reply;
    const root = await openAuthor();
    expect(visible(root, LIVE)).toBe(false);
    expect(visible(root, 'state/author/action')).toBe(false);
    expect(authorCards(root).length).toBeGreaterThan(0);
    expect(lastFocusTarget()).toBe(SYN(0));
    expect(streamCalls()).toHaveLength(1);
    await advance(60_000);
    expect(streamCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('Polling: every 30 s while focused (live and scheduled); stops on blur and unmount; a failed poll keeps the card', async () => {
    e15 = () => e15Stream('scheduled');
    const root = await openAuthor();
    expect(streamCalls()).toHaveLength(1);
    await advance(29_000);
    expect(streamCalls()).toHaveLength(1);
    await advance(1_000);
    expect(streamCalls()).toHaveLength(2);
    // The stream goes live: still polled, the card updates in place, no focus move.
    e15 = () => e15Stream('live');
    focusMock.mockClear();
    await advance(30_000);
    expect(streamCalls()).toHaveLength(3);
    expect(text(byTestId(root, `${LIVE}/badge`)[0])).toContain('LIVE');
    expect(focusTargets()).toEqual([]);
    // A failed poll keeps the last card; polling goes on.
    e15 = () => ({ status: 503 });
    await advance(30_000);
    expect(streamCalls()).toHaveLength(4);
    expect(visible(root, LIVE)).toBe(true);
    e15 = () => e15Stream('live');
    await advance(30_000);
    expect(streamCalls()).toHaveLength(5);
    // Blur (Пост on top): no poll.
    await press(root, SYN(1));
    expect(currentRoute()).toBe('Post');
    await advance(90_000);
    expect(streamCalls()).toHaveLength(5);
    // Back: polling again.
    await back();
    expect(currentRoute()).toBe('Author');
    await advance(30_000);
    expect(streamCalls()).toHaveLength(6);
    // Unmount (Back pops Автор): no more polls.
    await back();
    expect(currentRoute()).toBe('Shell');
    await advance(90_000);
    expect(streamCalls()).toHaveLength(6);
    await unmount(root);
  });

  it('Stream ends while the card has focus: the card goes and the first post takes focus', async () => {
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    await focusOn(root, LIVE);
    focusMock.mockClear();
    e15 = () => e15None();
    await advance(30_000);
    expect(visible(root, LIVE)).toBe(false);
    expect(visible(root, LIVE_GUIDE)).toBe(false);
    expect(lastFocusTarget()).toBe(SYN(0));
    // No card: no more polling.
    await advance(60_000);
    expect(streamCalls()).toHaveLength(2);
    await unmount(root);
  });

  it('Stream ends while a post has focus: the card goes, focus stays (no request)', async () => {
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    await focusOn(root, SYN(4));
    focusMock.mockClear();
    e15 = () => e15None();
    await advance(30_000);
    expect(visible(root, LIVE)).toBe(false);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('A stream that appears on a later refetch (resume) never takes focus', async () => {
    let appStateHandlers: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      listener: (state: string) => void,
    ) => {
      appStateHandlers.push(listener);
      return {
        remove: () => {
          appStateHandlers = appStateHandlers.filter(h => h !== listener);
        },
      };
    }) as unknown as typeof AppState.addEventListener);
    const changeAppState = async (state: string) => {
      await act(async () => {
        for (const h of [...appStateHandlers]) {
          h(state);
        }
      });
      await settle();
    };
    const root = await openAuthor();
    expect(visible(root, LIVE)).toBe(false);
    expect(lastFocusTarget()).toBe(SYN(0));
    focusMock.mockClear();
    e15 = () => e15Stream('live');
    // The resume invalidates the observed E15 (App), which now finds a live stream.
    await changeAppState('background');
    await changeAppState('active');
    expect(streamCalls()).toHaveLength(2);
    expect(visible(root, LIVE)).toBe(true);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  /** Capture AppState listeners (the App's resume and the poll's foreground state). */
  function captureAppState() {
    let handlers: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      listener: (state: string) => void,
    ) => {
      handlers.push(listener);
      return {
        remove: () => {
          handlers = handlers.filter(h => h !== listener);
        },
      };
    }) as unknown as typeof AppState.addEventListener);
    return async (state: string) => {
      await act(async () => {
        for (const h of [...handlers]) {
          h(state);
        }
      });
      await settle();
    };
  }

  it('Polling stops while the app is in the background; the resume fetches again and polling goes on', async () => {
    const changeAppState = captureAppState();
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    expect(streamCalls()).toHaveLength(1);
    await changeAppState('background');
    await advance(90_000);
    expect(streamCalls()).toHaveLength(1);
    await changeAppState('active');
    expect(streamCalls()).toHaveLength(2);
    await advance(30_000);
    expect(streamCalls()).toHaveLength(3);
    await unmount(root);
  });

  it('Every open sends one E15: a reopen within 60 s does not trust the cached answer', async () => {
    const root = await openAuthor();
    expect(streamCalls()).toHaveLength(1);
    await back();
    expect(currentRoute()).toBe('Shell');
    e15 = () => e15Stream('live');
    focusMock.mockClear();
    await press(root, TILE(1));
    expect(currentRoute()).toBe('Author');
    expect(streamCalls()).toHaveLength(2);
    // The stream that started meanwhile shows, with the initial focus.
    expect(visible(root, LIVE)).toBe(true);
    expect(lastFocusTarget()).toBe(LIVE);
    await unmount(root);
  });

  it('Stream ends while the card has focus, and Android moves native focus in the same commit: the first post still takes focus', async () => {
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    await focusOn(root, LIVE);
    focusMock.mockClear();
    const hook = globalThis as { onLiveCardUnmount?: () => void };
    hook.onLiveCardUnmount = () => {
      byTestId(root, SYN(5))
        .find(n => n.props.focusable)
        ?.props.onFocus({ nativeEvent: {} });
    };
    try {
      e15 = () => e15None();
      await advance(30_000);
    } finally {
      delete hook.onLiveCardUnmount;
    }
    expect(visible(root, LIVE)).toBe(false);
    expect(lastFocusTarget()).toBe(SYN(0));
    await unmount(root);
  });

  it('A post focused, then a filter change (the skeleton): focus goes to the live card (the nearest action above), not the field', async () => {
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    await focusOn(root, SYN(4));
    focusMock.mockClear();
    await act(async () => {
      filtersStore.getState().setAccess(`author:${navigationRef.getCurrentRoute()?.key}`, 'all');
    });
    await settle();
    expect(focusTargets()).toContain(LIVE);
    expect(focusTargets()).not.toContain(FIELD_HOST);
    await unmount(root);
  });

  it('Flag off (`live: false`): no E15 request, no card', async () => {
    jest.replaceProperty(phaseFlags, 'live', false as true);
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    expect(allStreamCalls()).toHaveLength(0);
    expect(visible(root, LIVE)).toBe(false);
    expect(lastFocusTarget()).toBe(SYN(0));
    await unmount(root);
  });

  it('A filter change (phase loading → grid) with the card focused keeps it; search outcomes work as before', async () => {
    e15 = () => e15Stream('live');
    e14 = () => ({ status: 200, body: { data: [] } });
    const root = await openAuthor();
    await focusOn(root, LIVE);
    focusMock.mockClear();
    await act(async () => {
      filtersStore.getState().setAccess(`author:${navigationRef.getCurrentRoute()?.key}`, 'all');
    });
    await settle();
    expect(e4Calls().some(c => c.url.includes('is_only_allowed=false'))).toBe(true);
    expect(focusTargets()).toEqual([]);
    expect(visible(root, LIVE)).toBe(true);
    await unmount(root);
  });

  it('Back on the card pops to Подписки (the card is a content zone item)', async () => {
    e15 = () => e15Stream('live');
    const root = await openAuthor();
    await focusOn(root, LIVE);
    expect(destinationIds('author/content')).toEqual([LIVE]);
    await back();
    expect(currentRoute()).toBe('Shell');
    await unmount(root);
  });
});

describe('Story 7.2: OK on the live card (watch, or the QR)', () => {
  const LIVE = `author/${BLOG}/live`;
  const STREAM_PAGE = `https://boosty.to/${BLOG}/streams/video_stream`;
  const BACK = 'player/error/back';
  const streamCalls = () => transport.callsTo(e15Path(BLOG));
  const lastQr = () => mockQrValues[mockQrValues.length - 1];
  const dialogOpen = (root: Root) => visible(root, 'dialog/qr');
  const PLAYABLE = {
    data: [
      {
        type: 'ok_stream',
        id: 'synthetic-id-72',
        playerUrls: [{ type: 'live_hls', url: 'https://example.invalid/live-hls?sig=REDACTED' }],
      },
    ],
  };

  beforeEach(() => {
    mockQrValues.length = 0;
    engine.reset();
    e4 = syntheticBlogPosts({ blogUrl: BLOG, total: 12 });
  });

  async function advance(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await settle();
  }

  it('a live card with access and a live-edge URL: OK → the Player with `LiveRef` (ids only); it plays the HLS URL', async () => {
    e15 = () => e15Stream('live', PLAYABLE);
    const root = await openAuthor();
    expect(one(root, LIVE).props.accessibilityRole).toBe('button');
    await press(root, LIVE);
    expect(currentRoute()).toBe('Player');
    const params = navigationRef.getCurrentRoute()?.params;
    expect(params).toEqual({ ref: { kind: 'live', blogUrl: BLOG }, origin: { routeKey: expect.any(String), focusId: LIVE } });
    expect(JSON.stringify(params)).not.toMatch(/example\.invalid|signedQuery|sig=/);
    expect(JSON.stringify(queryClient.getQueryData(queryKeys.stream(BLOG)))).not.toMatch(/sig=|example\.invalid\/live/);
    expect(JSON.stringify(logger.entries())).not.toMatch(/sig=/);
    // The card's E15, then the player's own.
    expect(streamCalls()).toHaveLength(2);
    expect(engine.props?.source).toEqual({ uri: 'https://example.invalid/live-hls?sig=REDACTED', format: 'hls' });
    expect(mockQrValues).toHaveLength(0);
    await unmount(root);
  });

  it.each([
    ['scheduled', () => e15Stream('scheduled', PLAYABLE)],
    ['needs a level (`hasAccess: false`)', () => e15Stream('locked', PLAYABLE)],
    ['live without a live-edge URL', () => e15Stream('live', { data: [] })],
    ['live with DVR URLs only', () => e15Stream('live', { data: [{ type: 'ok_stream', playerUrls: [{ type: 'live_playback_hls', url: 'https://example.invalid/dvr' }] }] })],
  ])('not playable (%s): OK → the QrDialog with the stream page; Back closes it, focus back on the card', async (_name, reply) => {
    e15 = reply;
    const root = await openAuthor();
    await focusOn(root, LIVE);
    const calls = transport.calls.length;
    focusMock.mockClear();
    await press(root, LIVE);
    expect(currentRoute()).toBe('Author');
    expect(dialogOpen(root)).toBe(true);
    expect(lastQr()).toBe(STREAM_PAGE);
    expect(text(byTestId(root, 'modal/content')[0])).toContain(t('player.live.qrTitle'));
    expect(transport.calls).toHaveLength(calls);
    focusMock.mockClear();
    await back();
    expect(dialogOpen(root)).toBe(false);
    expect(currentRoute()).toBe('Author');
    expect(lastFocusTarget()).toBe(LIVE);
    await unmount(root);
  });

  it('return from the Player with the stream still live: focus back on the card; the card query is fetched again', async () => {
    e15 = () => e15Stream('live', PLAYABLE);
    const root = await openAuthor();
    await press(root, LIVE);
    expect(currentRoute()).toBe('Player');
    const before = streamCalls().length;
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Author');
    expect(streamCalls().length).toBe(before + 1);
    expect(visible(root, LIVE)).toBe(true);
    expect(lastFocusTarget()).toBe(LIVE);
    await unmount(root);
  });

  it('the stream ended in the Player: «Стрим завершён» → «Назад» → the card is gone, focus on the first post', async () => {
    e15 = () => e15Stream('live', PLAYABLE);
    const root = await openAuthor();
    await press(root, LIVE);
    expect(currentRoute()).toBe('Player');
    e15 = () => e15None();
    await act(async () => {
      engine.props?.onEnd?.();
    });
    await settle();
    expect(visible(root, 'player/state/ended')).toBe(true);
    focusMock.mockClear();
    await press(root, BACK);
    await advance(50);
    expect(currentRoute()).toBe('Author');
    expect(visible(root, LIVE)).toBe(false);
    // (Null requests are earlier tests' modal frames, run by the fake timers.)
    expect(focusTargets().filter(Boolean).pop()).toBe(SYN(0));
    await unmount(root);
  });

  it('the stream gone while covered (the refetch lands before the return): focus on the first post, not the remembered card', async () => {
    e15 = () => e15Stream('live', PLAYABLE);
    const root = await openAuthor();
    await press(root, LIVE);
    // The card disappears while the Player covers the page.
    await act(async () => {
      queryClient.setQueryData(queryKeys.stream(BLOG), null);
    });
    await settle();
    e15 = () => e15None();
    focusMock.mockClear();
    await back();
    await advance(50);
    expect(currentRoute()).toBe('Author');
    expect(visible(root, LIVE)).toBe(false);
    expect(focusTargets().filter(Boolean).pop()).toBe(SYN(0));
    expect(focusTargets()).not.toContain(LIVE);
    await unmount(root);
  });

  it('not playable at resolve, answered while the Player route is not focused: once it is focused, the player leaves and Автор shows the QR', async () => {
    e15 = () => e15Stream('live', PLAYABLE);
    const root = await openAuthor();
    const held = deferred();
    e15 = () => held.promise;
    await press(root, LIVE);
    expect(currentRoute()).toBe('Player');
    // A screen covers the Player before its E15 answers.
    await act(async () => {
      navigationRef.navigate('DevFocus');
    });
    await settle();
    expect(currentRoute()).toBe('DevFocus');
    e15 = () => e15Stream('locked', PLAYABLE);
    await act(async () => {
      held.resolve(e15Stream('locked', PLAYABLE));
    });
    await advance(50);
    // Not focused: the player stays (no leave yet).
    expect(routeNames()).toContain('Player');
    await act(async () => {
      navigationRef.goBack();
    });
    await advance(50);
    expect(currentRoute()).toBe('Author');
    expect(engine.mounts).toBe(0);
    expect(dialogOpen(root)).toBe(true);
    expect(lastQr()).toBe(STREAM_PAGE);
    await unmount(root);
  });

  it('not playable at resolve (the player\'s E15 says no access): the player leaves; Автор shows the QR over the card; close → the card', async () => {
    e15 = () => e15Stream('live', PLAYABLE);
    const root = await openAuthor();
    e15 = () => e15Stream('locked', PLAYABLE);
    await press(root, LIVE);
    await advance(50);
    expect(currentRoute()).toBe('Author');
    expect(engine.mounts).toBe(0);
    expect(dialogOpen(root)).toBe(true);
    expect(lastQr()).toBe(STREAM_PAGE);
    focusMock.mockClear();
    await back();
    expect(dialogOpen(root)).toBe(false);
    expect(lastFocusTarget()).toBe(LIVE);
    // A plain later return shows no QR again (the card's 30 s poll sees it playable).
    e15 = () => e15Stream('live', PLAYABLE);
    await advance(30_000);
    await press(root, LIVE);
    expect(currentRoute()).toBe('Player');
    await back();
    expect(currentRoute()).toBe('Author');
    expect(dialogOpen(root)).toBe(false);
    await unmount(root);
  });
});
