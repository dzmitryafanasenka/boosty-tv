/**
 * Story 3.2 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: Подписки (E2 via TanStack Query), every row of the
 * spec's I/O matrix, the focus rules of docs/focus-map.md §1.6 and §3
 * (C1–C3), restoration by `blogUrl` on return, a 55-author grid and the
 * account-scoped cache. The keychain, BackHandler and the native focus
 * command are faked: these tests prove which element the app asks to focus,
 * not native focus movement (device checks, docs/testing.md).
 */
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import App, { navigationRef } from '../src/app/App';
import { queryClient, resetQueryCache } from '../src/app/queryClient';
import { accountScope } from '../src/shared/account';
import { DEFAULT_FILTER } from '../src/shared/filters';
import { queryKeys } from '../src/shared/api';
import { type FixtureReply, type FixtureRequest, type FixtureTransport } from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { E5_PATH, e5Page } from '../src/test/feedFixtures';
import { e3Body, e3MissingReply, e3Path, e4Page, e4Path } from '../src/test/authorFixtures';
import {
  E2_PATH,
  E2_URL,
  blogUrlOf,
  e1NoBlogBody,
  e2Body,
  subscription,
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

/** `phaseFlags.myBlog` (Story 5.2), switchable per test (the Shell reads it at render). */
const mockMyBlogFlag = { on: true };
jest.mock('../src/app/phaseFlags', () => {
  const actual = jest.requireActual('../src/app/phaseFlags');
  return {
    ...actual,
    phaseFlags: {
      ...actual.phaseFlags,
      get myBlog() {
        return mockMyBlogFlag.on;
      },
    },
  };
});

/** The real FlashList behind the recorder `lists` (`src/test/flow`; `onEndReached` held back). */
jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());

const focusMock = requestHostFocus as jest.Mock;

/** As homeFeedFlow: 30 rounds, no timers unless a row needs the AD-6 backoff. */
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
const TILE = (n: number) => `subs/tile/${blogUrlOf(n)}`;

type Reply = FixtureReply | Promise<FixtureReply> | undefined;
let subs: (req: FixtureRequest) => Reply;
/** E1 (the cold-start validate and Подписки's profile E1): no `blogUrl` by default. */
let e1: (req: FixtureRequest) => Reply;
/** E3/E4 (any blog); unset: no answer (a test bug, a network failure). */
let blog: (req: FixtureRequest) => Reply;
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
  mockMyBlogFlag.on = true;
  subs = () => ({ status: 200, body: subscriptionsBody(3) });
  e1 = () => ({ status: 200, body: e1NoBlogBody() });
  blog = () => undefined;
  transport = installFixtureTransport(req => {
    if (req.path === E1) {
      return e1(req);
    }
    if (req.path.startsWith('/v1/blog/')) {
      return blog(req);
    }
    if (req.path === E5_PATH) {
      return { status: 200, body: e5Page() };
    }
    if (req.path === E2_PATH) {
      return subs(req);
    }
    return undefined;
  });
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  jest.restoreAllMocks();
});

type Root = Awaited<ReturnType<typeof render>>;

const subsCalls = () => transport.callsTo(E2_PATH);
/** The grid's tiles: author tiles and «Мой блог» (`subs/mine`, Story 5.2). */
const tileIds = (root: Root) =>
  focusableIds(root).filter(id => id.startsWith('subs/tile/') || id === 'subs/mine');
/** The Подписки grid's FlashList props (last render). */
const grid = () => listProps('subs/list');
/** The blogUrls in the grid (its items are rows of up to 3). */
const gridBlogs = () =>
  gridRowItems<{ blogUrl: string }>('subs/list', 'authors').map(a => a.blogUrl);

type CachedList = { authors: Array<{ blogUrl: string }>; received: number; total: number | null };

/** Replaces the cached E2 authors (as a background refetch would), then settles. */
async function changeAuthors(change: (authors: CachedList['authors']) => CachedList['authors']) {
  await act(async () => {
    const cached = queryClient.getQueryData<CachedList>(queryKeys.subscriptions());
    queryClient.setQueryData(queryKeys.subscriptions(), {
      ...cached,
      authors: change(cached?.authors ?? []),
    });
  });
  await settle();
}

/** The App on Главная, then OK on «Подписки». */
async function openSubs(settleOverrides?: { timerRounds: number }) {
  const root = await render(<App />);
  focusMock.mockClear();
  await press(root, 'nav/subs', settleOverrides ? { settle: settleOverrides } : {});
  return root;
}

describe('sidebar (phase flag)', () => {
  it('Подписки is in the sidebar after Главная and Поиск, before Настройки; focus alone sends nothing', async () => {
    const root = await render(<App />);
    expect(focusableIds(root, byTestId(root, 'shell/sidebar')[0])).toEqual([
      'nav/home',
      'nav/search',
      'nav/subs',
      'nav/settings',
    ]);
    await focusOn(root, 'nav/subs');
    await settle();
    expect(visible(root, 'subs')).toBe(false);
    expect(subsCalls()).toHaveLength(0);
    await unmount(root);
  });
});

describe('load (matrix «Loaded», «Many», «Exactly 30», «Malformed», «No owner/avatar»)', () => {
  it('OK on «Подписки»: skeleton with focus on nav/subs → tiles; focus moves to the first tile', async () => {
    const reply = deferred();
    subs = () => reply.promise;
    const root = await openSubs();
    expect(visible(root, 'subs/skeleton')).toBe(true);
    expect(text(root)).toContain(t('subs.title'));
    // Focus stays on nav/subs (OK left it there; nothing moved it).
    expect(focusTargets()).toEqual([]);
    expect(focusableIds(root, byTestId(root, 'shell/content/subs')[0])).toEqual([]);
    expect(destinationIds('shell/content/subs')).toEqual([]);

    reply.resolve({ status: 200, body: subscriptionsBody(3) });
    await settle();
    expect(visible(root, 'subs/skeleton')).toBe(false);
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(lastFocusTarget()).toBe(TILE(1));
    expect(visible(root, 'subs/first-only')).toBe(false);
    // Exactly one E2, the verified request, content profile, nothing else.
    expect(subsCalls()).toHaveLength(1);
    expect(subsCalls()[0].url).toBe(E2_URL);
    expect(subsCalls()[0].headers.Authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    expect(subsCalls()[0].headers['X-App']).toBeUndefined();
    expect(transport.calls.every(c => !c.path.includes('comment'))).toBe(true);
    // Tile label «{name}. {title}» (owner's name first, owner decision 2026-10-27).
    expect(one(root, TILE(1)).props.accessibilityLabel).toBe('Owner 1. Blog 1');
    await unmount(root);
  });

  it('the live E2 body: 3 tiles, `total` 5 ≤ 30: no note; no price or subscribe copy', async () => {
    subs = () => ({ status: 200, body: e2Body() });
    const root = await openSubs();
    expect(tileIds(root)).toEqual(['synthetic-blog-1', 'synthetic-blog-2', 'synthetic-blog-3'].map(b => `subs/tile/${b}`));
    expect(visible(root, 'subs/first-only')).toBe(false);
    const shown = text(byTestId(root, 'subs')[0]);
    for (const forbidden of ['₽', 'RUB', 'USD', 'EUR', 'Оформить', 'Подписаться', 'коммент']) {
      expect(shown).not.toContain(forbidden);
    }
    await unmount(root);
  });

  it('30 items, total 55: 30 tiles and «Показаны первые 30» (not focusable); no further request', async () => {
    subs = () => ({ status: 200, body: subscriptionsBody(30, 55) });
    const root = await openSubs();
    expect(gridBlogs()).toHaveLength(30);
    const [note] = byTestId(root, 'subs/first-only');
    expect(text(note)).toContain('Показаны первые 30');
    expect(note.props.focusable).toBeUndefined();
    expect(focusableIds(root)).not.toContain('subs/first-only');
    await focusOn(root, tileIds(root)[tileIds(root).length - 1]);
    await settle();
    expect(subsCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('3 items, total 55 (`total` alone does not prove more than 30): no note', async () => {
    subs = () => ({ status: 200, body: subscriptionsBody(3, 55) });
    const root = await openSubs();
    expect(tileIds(root)).toHaveLength(3);
    expect(visible(root, 'subs/first-only')).toBe(false);
    await unmount(root);
  });

  it('30 raw items with one dropped, total 55: «Показаны первые 29» (the tiles shown)', async () => {
    const body = subscriptionsBody(30, 55);
    (body.data as Array<{ blog: Record<string, unknown> }>)[4].blog.blogUrl = undefined;
    subs = () => ({ status: 200, body });
    const root = await openSubs();
    expect(gridBlogs()).toHaveLength(29);
    expect(text(byTestId(root, 'subs/first-only')[0])).toContain('Показаны первые 29');
    await unmount(root);
  });

  it('exactly 30 items, total 30: 30 tiles, no note', async () => {
    subs = () => ({ status: 200, body: subscriptionsBody(30, 30) });
    const root = await openSubs();
    expect(gridBlogs()).toHaveLength(30);
    expect(visible(root, 'subs/first-only')).toBe(false);
    await unmount(root);
  });

  it('an item without blog.blogUrl is dropped and logged; the others are shown', async () => {
    const body = subscriptionsBody(3);
    (body.data as Array<{ blog: Record<string, unknown> }>)[1].blog.blogUrl = undefined;
    subs = () => ({ status: 200, body });
    const root = await openSubs();
    expect(tileIds(root)).toEqual([TILE(1), TILE(3)]);
    const dropped = logger.entries().filter(e => e.scope === 'author' && e.message === 'dropped');
    expect(dropped).toHaveLength(1);
    expect(JSON.stringify(dropped)).not.toContain('Blog 2');
    await unmount(root);
  });

  it('no owner and no avatar: a tile without the owner line, with the avatar placeholder', async () => {
    subs = () => ({
      status: 200,
      body: { offset: 0, limit: 30, total: 2, data: [subscription(1, { owner: undefined }), subscription(2)] },
    });
    const root = await openSubs();
    expect(visible(root, `${TILE(1)}/owner`)).toBe(false);
    expect(visible(root, `${TILE(1)}/avatar-placeholder`)).toBe(true);
    expect(one(root, TILE(1)).props.accessibilityLabel).toBe('Blog 1');
    expect(visible(root, `${TILE(2)}/owner`)).toBe(true);
    await unmount(root);
  });
});

describe('empty (matrix «Empty», focus-map C3)', () => {
  it('«Подписок пока нет» + explanation, no CTA; nothing focusable; focus stays on nav/subs', async () => {
    subs = () => ({ status: 200, body: { offset: 0, limit: 30, total: 0, data: [] } });
    const root = await openSubs();
    expect(visible(root, 'subs/empty')).toBe(true);
    expect(text(root)).toContain(t('subs.emptyTitle'));
    expect(text(root)).toContain(t('subs.emptyBody'));
    const content = byTestId(root, 'shell/content/subs')[0];
    expect(focusableIds(root, content)).toEqual([]);
    // → from the sidebar has nowhere to go.
    expect(destinationIds('shell/content/subs')).toEqual([]);
    // Focus stays on nav/subs: nothing moved it.
    expect(focusTargets()).toEqual([]);
    // OK on the current item again: still nothing to focus.
    focusMock.mockClear();
    await press(root, 'nav/subs');
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });
});

describe('errors (matrix «Error»)', () => {
  it.each([
    ['Network', (): FixtureReply => ({ network: true })],
    ['Server', (): FixtureReply => ({ status: 503, body: {} })],
    ['Parse', (): FixtureReply => ({ status: 200, body: { total: 3 } })],
  ])('%s: error StateView with «Повторить» (focused on open); retry success → the first tile', async (kind, reply) => {
    subs = reply;
    const root = await openSubs(WITH_TIMERS);
    expect(visible(root, 'subs/error')).toBe(true);
    expect(text(root)).toContain(t('subs.errorTitle'));
    expect(text(root)).toContain(t(`error.${kind}` as 'error.Network'));
    expect(one(root, 'state/subs/action').props.accessibilityLabel).toBe(t('common.retry'));
    // Opened with OK and the user has not moved: «Повторить» takes focus.
    expect(lastFocusTarget()).toBe('state/subs/action');
    expect(visible(root, 'shell')).toBe(true);
    expect(transport.callsTo('/oauth/token/')).toHaveLength(0);

    const before = subsCalls().length;
    subs = () => ({ status: 200, body: subscriptionsBody(3) });
    await press(root, 'state/subs/action');
    expect(subsCalls()).toHaveLength(before + 1);
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(lastFocusTarget()).toBe(TILE(1));
    await unmount(root);
  });

  it('retry still fails: the busy button keeps focus, nothing re-focuses', async () => {
    subs = () => ({ status: 404, body: {} });
    const root = await openSubs();
    expect(visible(root, 'subs/error')).toBe(true);
    focusMock.mockClear();
    await press(root, 'state/subs/action');
    expect(visible(root, 'subs/error')).toBe(true);
    expect(subsCalls()).toHaveLength(2);
    expect(focusTargets().filter(Boolean)).toEqual([]);
    await unmount(root);
  });

  it('retry returns no subscriptions: C3, focus goes to nav/subs (the button is gone)', async () => {
    subs = () => ({ status: 404, body: {} });
    const root = await openSubs();
    subs = () => ({ status: 200, body: { data: [] } });
    focusMock.mockClear();
    await press(root, 'state/subs/action');
    expect(visible(root, 'subs/empty')).toBe(true);
    expect(lastFocusTarget()).toBe('nav/subs');
    await unmount(root);
  });
});

describe('focus (focus-map §3 C, §1.6)', () => {
  it('the user moves to nav/settings during the skeleton: the tiles do not take focus', async () => {
    const reply = deferred();
    subs = () => reply.promise;
    const root = await openSubs();
    await focusOn(root, 'nav/settings');
    focusMock.mockClear();
    reply.resolve({ status: 200, body: subscriptionsBody(3) });
    await settle();
    expect(tileIds(root)).toHaveLength(3);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('← from the first column lands on nav/subs; → returns to the remembered tile', async () => {
    subs = () => ({ status: 200, body: subscriptionsBody(9) });
    const root = await openSubs();
    expect(destinationIds('shell/sidebar')).toEqual(['nav/subs']);
    await focusOn(root, TILE(4));
    expect(destinationIds('shell/content/subs')).toEqual([TILE(4)]);
    // The content zone traps ↑ ↓ only: ← leaves it for the sidebar guide.
    const [zone] = byTestId(root, 'shell/content/subs');
    expect(zone.props).toMatchObject({ trapFocusUp: true, trapFocusDown: true });
    expect(zone.props.trapFocusLeft).toBeFalsy();
    await unmount(root);
  });

  it('Back: tile → nav/subs → Главная (nav/home) → exit', async () => {
    const root = await openSubs();
    await focusOn(root, TILE(2));
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe('nav/subs');
    expect(visible(root, 'subs')).toBe(true);
    await focusOn(root, 'nav/subs');
    await back();
    expect(visible(root, 'subs')).toBe(false);
    expect(visible(root, 'shell/content/home')).toBe(true);
    expect(focusTargets()).toContain('nav/home');
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    await focusOn(root, 'nav/home');
    await back();
    expect(backHandler.exitApp).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('return to Подписки: the same tile by blogUrl, from the cache (no new request)', async () => {
    subs = () => ({ status: 200, body: subscriptionsBody(9) });
    const root = await openSubs();
    await focusOn(root, TILE(5));
    await back(); // → nav/subs
    await focusOn(root, 'nav/subs');
    await back(); // → Главная
    expect(visible(root, 'subs')).toBe(false);
    await focusOn(root, 'nav/home');
    focusMock.mockClear();
    await press(root, 'nav/subs');
    expect(lastFocusTarget()).toBe(TILE(5));
    expect(subsCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('the remembered tile is gone on return: its neighbor by index', async () => {
    subs = () => ({ status: 200, body: subscriptionsBody(9) });
    const root = await openSubs();
    await focusOn(root, TILE(5));
    await back();
    await focusOn(root, 'nav/subs');
    await back(); // → Главная
    // The cached list loses author 5 (as after a refetch on another visit).
    const cached = queryClient.getQueryData<{ authors: Array<{ blogUrl: string }>; total: number }>(
      queryKeys.subscriptions(),
    );
    queryClient.setQueryData(queryKeys.subscriptions(), {
      ...cached,
      authors: cached?.authors.filter(a => a.blogUrl !== blogUrlOf(5)),
    });
    await focusOn(root, 'nav/home');
    focusMock.mockClear();
    await press(root, 'nav/subs');
    expect(visible(root, TILE(5))).toBe(false);
    expect(lastFocusTarget()).toBe(TILE(6));
    await unmount(root);
  });

  it('the data changes under a focused tile: moved to another row → the same tile; removed → its neighbor', async () => {
    subs = () => ({ status: 200, body: subscriptionsBody(9) });
    const root = await openSubs();
    await focusOn(root, TILE(2));
    // Author 2 moves from row 1 to row 3 (index 7).
    focusMock.mockClear();
    await changeAuthors(authors => {
      const rest = authors.filter(a => a.blogUrl !== blogUrlOf(2));
      return [...rest.slice(0, 7), authors[1], ...rest.slice(7)];
    });
    expect(gridBlogs()[7]).toBe(blogUrlOf(2));
    expect(lists.scrollToIndex).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: Math.floor(7 / 3) }),
    );
    expect(lastFocusTarget()).toBe(TILE(2));

    // The focused tile disappears: its neighbor by index (author 9 now sits at 7).
    await focusOn(root, TILE(2));
    focusMock.mockClear();
    await changeAuthors(authors => authors.filter(a => a.blogUrl !== blogUrlOf(2)));
    expect(visible(root, TILE(2))).toBe(false);
    expect(lastFocusTarget()).toBe(TILE(9));
    await unmount(root);
  });

  it('the data empties under a focused tile: C3 and focus goes to nav/subs', async () => {
    const root = await openSubs();
    await focusOn(root, TILE(2));
    focusMock.mockClear();
    await changeAuthors(() => []);
    expect(visible(root, 'subs/empty')).toBe(true);
    expect(lastFocusTarget()).toBe('nav/subs');
    await unmount(root);
  });

  it('a cached-grid restore still waiting when the data changes: re-resolved against the new ids', async () => {
    subs = () => ({ status: 200, body: subscriptionsBody(9) });
    const root = await openSubs();
    await focusOn(root, TILE(5));
    await back();
    await focusOn(root, 'nav/subs');
    await back(); // → Главная
    await focusOn(root, 'nav/home');
    await press(root, 'nav/subs');
    // The restore asked for tile 5; the native focus event has not arrived.
    expect(lastFocusTarget()).toBe(TILE(5));
    focusMock.mockClear();
    await changeAuthors(authors => authors.filter(a => a.blogUrl !== blogUrlOf(5)));
    expect(lastFocusTarget()).toBe(TILE(6));
    await unmount(root);
  });

  it('OK on a tile opens Автор for that blogUrl (Story 3.3; the flow is authorFlow.test.tsx)', async () => {
    const root = await openSubs();
    await press(root, TILE(2));
    expect(visible(root, 'author')).toBe(true);
    // Подписки stays mounted below (the JS stack keeps covered screens).
    expect(visible(root, 'subs')).toBe(true);
    const blogCalls = transport.calls.filter(c => c.path.startsWith('/v1/blog/'));
    expect(blogCalls.map(c => c.path).sort()).toEqual([
      `/v1/blog/${blogUrlOf(2)}`,
      `/v1/blog/${blogUrlOf(2)}/post/`,
    ]);
    await unmount(root);
  });
});

describe('55 authors (matrix «Fixture 55 authors»)', () => {
  it('virtualized rows of 3 keyed by the first blogUrl; tiles keyed by blogUrl; bounded height', async () => {
    subs = () => ({ status: 200, body: subscriptionsBody(55) });
    const root = await openSubs();
    const props = grid();
    const rows = props.data as Array<{ key: string; authors: Array<{ blogUrl: string }> }>;
    expect(rows).toHaveLength(19);
    expect(rows.every(r => r.key === r.authors[0].blogUrl)).toBe(true);
    expect(rows[18].authors).toHaveLength(1);
    expect(gridBlogs()).toEqual(Array.from({ length: 55 }, (_, i) => blogUrlOf(i + 1)));
    expect(props.removeClippedSubviews).toBe(false);
    expect(props.getItemType()).toBe('row');
    expect(typeof props.style[1].height).toBe('number');
    // Virtualized: fewer tiles mounted than authors.
    expect(tileIds(root).length).toBeLessThan(55);
    expect(tileIds(root)[0]).toBe(TILE(1));
    // A focus move deep in the grid sends nothing and moves no focus itself.
    focusMock.mockClear();
    await focusOn(root, tileIds(root)[tileIds(root).length - 1]);
    expect(focusTargets()).toEqual([]);
    expect(subsCalls()).toHaveLength(1);
    await unmount(root);
  });
});

describe('55 authors: restoration of a deep tile', () => {
  /**
   * Opens a 55-author grid with focus on tile `n` (not mounted at the top:
   * Jest's FlashList does not scroll, so the entry a native focus on it
   * writes — id, index, offset — is put in FocusRestoration after a focus
   * on a mounted tile), then Back → Главная.
   */
  async function leaveFrom(n: number) {
    subs = () => ({ status: 200, body: subscriptionsBody(55) });
    const root = await openSubs();
    expect(visible(root, TILE(n))).toBe(false);
    await focusOn(root, TILE(1));
    focusRestoration.remember('shell', 'subs', TILE(n), 1600, n - 1);
    await back();
    await focusOn(root, 'nav/subs');
    await back(); // → Главная
    expect(visible(root, 'subs')).toBe(false);
    await focusOn(root, 'nav/home');
    return root;
  }

  it('the deep tile again, the grid opening at its row', async () => {
    const root = await leaveFrom(55);
    focusMock.mockClear();
    await press(root, 'nav/subs');
    expect(grid().initialScrollIndex).toBe(Math.floor(54 / 3));
    expect(lists.scrollToOffset).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 1600 }),
    );
    expect(lastFocusTarget()).toBe(TILE(55));
    expect(subsCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('the deep tile is gone: its neighbor, scrolled to by its row', async () => {
    const root = await leaveFrom(55);
    await changeAuthors(authors => authors.filter(a => a.blogUrl !== blogUrlOf(55)));
    focusMock.mockClear();
    lists.scrollToIndex.mockClear();
    await press(root, 'nav/subs');
    // The neighbor sits at index 53 (the remembered index 54 no longer exists).
    expect(lists.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: Math.floor(53 / 3) }),
    );
    expect(lastFocusTarget()).toBe(TILE(54));
    await unmount(root);
  });
});

describe('account scope', () => {
  it('an account reset (sign-out, account switch) clears the cached subscriptions', async () => {
    const root = await openSubs();
    expect(queryClient.getQueryData(queryKeys.subscriptions())).toBeDefined();
    await unmount(root);
    await accountScope.reset();
    expect(queryClient.getQueryData(queryKeys.subscriptions())).toBeUndefined();
  });
});

describe('«Мой блог» (Story 5.2, SUB-02, focus-map §3 C)', () => {
  /** The account's own blog (not among `subscriptionsBody`'s blogs). */
  const MINE = 'own-blog';
  const MY_TILE = 'subs/mine';
  const e1With = (blogUrl: string) => () => ({
    status: 200,
    body: { ...e1NoBlogBody(), blogUrl },
  });
  /** E3 for `MINE` (owner «Me», title «My blog title»), E4 page 1 the live page. */
  const ownBlog = (e4: () => Reply = () => ({ status: 200, body: e4Page(1) })) =>
    (req: FixtureRequest): Reply => {
      if (req.path === e3Path(MINE)) {
        return { status: 200, body: e3Body(MINE, { title: 'My blog title', owner: { name: 'Me' } }) };
      }
      if (req.path === e4Path(MINE)) {
        return e4();
      }
      return undefined;
    };
  const profileCalls = () => transport.callsTo(E1);
  /** The `me` query now names `blogUrl` (as a later E1 would), then settles. */
  async function setMe(blogUrl: string) {
    await act(async () => {
      queryClient.setQueryData(queryKeys.me(), { id: '1001', blogUrl });
    });
    await settle();
  }
  /** The own blog's cached E4 page 1 now has `posts` (as a refetch would), then settles. */
  async function setOwnPosts(blogUrl: string, posts: unknown[]) {
    await act(async () => {
      queryClient.setQueryData(queryKeys.authorPosts(blogUrl, DEFAULT_FILTER), {
        pages: [{ posts, nextCursor: null }],
        pageParams: [null],
      });
    });
    await settle();
  }
  const e3Calls = () => transport.callsTo(e3Path(MINE));
  const e4Calls = () => transport.callsTo(e4Path(MINE));

  it('a blog with a post: «Мой блог» is the first tile, tinted label, initial focus; one E1, E3 and E4 page 1', async () => {
    e1 = e1With(MINE);
    blog = ownBlog();
    const root = await openSubs();
    expect(tileIds(root)).toEqual([MY_TILE, TILE(1), TILE(2), TILE(3)]);
    expect(lastFocusTarget()).toBe(MY_TILE);
    expect(text(byTestId(root, `${MY_TILE}/label`)[0])).toContain(t('subs.myBlog'));
    expect(one(root, MY_TILE).props.accessibilityLabel).toBe('Мой блог. Me. My blog title');
    // Other tiles carry no label.
    expect(visible(root, `${TILE(1)}/label`)).toBe(false);
    // The cold-start validate and the profile E1; the Author page's E3 and E4 page 1.
    expect(profileCalls()).toHaveLength(2);
    expect(e3Calls()).toHaveLength(1);
    expect(e4Calls()).toHaveLength(1);
    expect(e4Calls()[0].url).toBe(
      `https://api.boosty.to/v1/blog/${MINE}/post/?limit=20&comments_limit=0&reply_limit=0&is_only_allowed=true&only_bought=false`,
    );
    for (const call of [...profileCalls(), ...e3Calls(), ...e4Calls()]) {
      expect(call.headers.Authorization).toBe(`Bearer ${'a'.repeat(64)}`);
      expect(call.headers['X-App']).toBeUndefined();
    }
    expect(transport.calls.every(c => !c.path.includes('comment'))).toBe(true);
    // The grid's first row starts with the own blog.
    expect(gridBlogs()[0]).toBe(MINE);
    await unmount(root);
  });

  it('the skeleton stays until the check settles; then «Мой блог» takes the initial focus', async () => {
    e1 = e1With(MINE);
    const e4 = deferred();
    blog = ownBlog(() => e4.promise);
    const root = await openSubs();
    // E2 answered, E4 not yet: still the skeleton, focus on nav/subs.
    expect(visible(root, 'subs/skeleton')).toBe(true);
    expect(focusTargets()).toEqual([]);
    e4.resolve({ status: 200, body: e4Page(1) });
    await settle();
    expect(tileIds(root)[0]).toBe(MY_TILE);
    expect(lastFocusTarget()).toBe(MY_TILE);
    await unmount(root);
  });

  it('no blogUrl in E1: no tile, no E3/E4; the grid as before', async () => {
    const root = await openSubs();
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(lastFocusTarget()).toBe(TILE(1));
    expect(transport.calls.filter(c => c.path.startsWith('/v1/blog/'))).toHaveLength(0);
    await unmount(root);
  });

  it('an unsafe blogUrl in E1 is absent: no tile, no E3/E4', async () => {
    e1 = e1With('../evil');
    const root = await openSubs();
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(transport.calls.filter(c => c.path.startsWith('/v1/blog/'))).toHaveLength(0);
    await unmount(root);
  });

  it('a blog without posts (empty E4 page 1): no tile, no error', async () => {
    e1 = e1With(MINE);
    blog = ownBlog(() => ({ status: 200, body: { data: [], extra: { isLast: true } } }));
    const root = await openSubs();
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(lastFocusTarget()).toBe(TILE(1));
    expect(visible(root, 'subs/error')).toBe(false);
    await unmount(root);
  });

  it.each([
    ['E1 404', 'e1' as const, (): FixtureReply => ({ status: 404, body: {} })],
    ['E1 Parse', 'e1' as const, (): FixtureReply => ({ status: 200, body: { blogUrl: MINE } })],
    ['E3 404 (blog_not_found)', 'e3' as const, () => e3MissingReply()],
    ['E3 Parse', 'e3' as const, (): FixtureReply => ({ status: 200, body: { title: 'x' } })],
    ['E4 404', 'e4' as const, (): FixtureReply => ({ status: 404, body: {} })],
    ['E4 Parse', 'e4' as const, (): FixtureReply => ({ status: 200, body: { posts: [] } })],
  ])('%s: no tile and no error; the grid as before', async (_name, step, reply) => {
    let calls = 0;
    // The first E1 is the cold-start validate: only the profile E1 fails.
    e1 = step === 'e1' ? () => (calls++ === 0 ? e1With(MINE)() : reply()) : e1With(MINE);
    const own = ownBlog(step === 'e4' ? reply : undefined);
    blog = step === 'e3' ? req => (req.path === e3Path(MINE) ? reply() : own(req)) : own;
    const root = await openSubs();
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(lastFocusTarget()).toBe(TILE(1));
    expect(visible(root, 'subs/error')).toBe(false);
    expect(visible(root, 'shell')).toBe(true);
    await unmount(root);
  });

  it('E1 Network (AD-6 retries): no tile, the grid after the retries', async () => {
    let calls = 0;
    e1 = () => (calls++ === 0 ? e1With(MINE)() : { network: true });
    const root = await openSubs(WITH_TIMERS);
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(visible(root, 'subs/error')).toBe(false);
    await unmount(root);
  });

  it('the own blog is also a subscription: shown once, as «Мой блог», first', async () => {
    e1 = e1With(blogUrlOf(2));
    blog = req =>
      req.path === e3Path(blogUrlOf(2))
        ? { status: 200, body: e3Body(blogUrlOf(2)) }
        : req.path === e4Path(blogUrlOf(2))
          ? { status: 200, body: e4Page(1) }
          : undefined;
    const root = await openSubs();
    expect(tileIds(root)).toEqual([MY_TILE, TILE(1), TILE(3)]);
    expect(gridBlogs()).toEqual([blogUrlOf(2), blogUrlOf(1), blogUrlOf(3)]);
    await unmount(root);
  });

  it('only the own blog and no subscriptions: the grid with «Мой блог» alone (not C3)', async () => {
    e1 = e1With(MINE);
    blog = ownBlog();
    subs = () => ({ status: 200, body: { offset: 0, limit: 30, total: 0, data: [] } });
    const root = await openSubs();
    expect(visible(root, 'subs/empty')).toBe(false);
    expect(tileIds(root)).toEqual([MY_TILE]);
    expect(lastFocusTarget()).toBe(MY_TILE);
    await unmount(root);
  });

  it('OK → Автор of the own blog from the cache (no new E3/E4); Back → the same tile', async () => {
    e1 = e1With(MINE);
    blog = ownBlog();
    const root = await openSubs();
    await press(root, MY_TILE);
    expect(visible(root, 'author')).toBe(true);
    expect(visible(root, 'author/header')).toBe(true);
    // The Author page reused Подписки's E3 and E4 page 1.
    expect(e3Calls()).toHaveLength(1);
    expect(e4Calls()).toHaveLength(1);
    focusMock.mockClear();
    await back();
    expect(navigationRef.getCurrentRoute()?.name).toBe('Shell');
    expect(lastFocusTarget()).toBe(MY_TILE);
    await unmount(root);
  });

  it('← from «Мой блог» (first column) leaves for nav/subs; Back → nav/subs', async () => {
    e1 = e1With(MINE);
    blog = ownBlog();
    const root = await openSubs();
    await focusOn(root, MY_TILE);
    const [zone] = byTestId(root, 'shell/content/subs');
    expect(zone.props.trapFocusLeft).toBeFalsy();
    expect(destinationIds('shell/sidebar')).toEqual(['nav/subs']);
    expect(destinationIds('shell/content/subs')).toEqual([MY_TILE]);
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe('nav/subs');
    await unmount(root);
  });

  it('the tile arrives after the grid rendered: focus stays on the focused author tile', async () => {
    const root = await openSubs();
    await focusOn(root, TILE(2));
    focusMock.mockClear();
    lists.scrollToIndex.mockClear();
    blog = ownBlog();
    // E1 now names the own blog (as a later refetch would).
    await setMe(MINE);
    expect(tileIds(root)).toEqual([MY_TILE, TILE(1), TILE(2), TILE(3)]);
    // Never the skeleton again.
    expect(visible(root, 'subs/skeleton')).toBe(false);
    // Tile 2 moved from index 1 to 2 (same row 0): scrolled to its row and
    // focused again by id (the Story 3.2 data-change rule), nothing else.
    expect(lists.scrollToIndex).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: Math.floor(2 / 3) }),
    );
    expect(focusTargets()).toEqual([TILE(2)]);
    await unmount(root);
  });

  it('focus on «Мой блог», then a refetch finds no post: the tile goes, focus → its neighbour by index (the first tile)', async () => {
    e1 = e1With(MINE);
    blog = ownBlog();
    const root = await openSubs();
    await focusOn(root, MY_TILE);
    focusMock.mockClear();
    await setOwnPosts(MINE, []);
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(lastFocusTarget()).toBe(TILE(1));
    await unmount(root);
  });

  it('the focused plain tile is the own blog and «Мой блог» arrives: focus moves to «Мой блог» (the same blog)', async () => {
    const root = await openSubs();
    await focusOn(root, TILE(2));
    focusMock.mockClear();
    blog = req =>
      req.path === e3Path(blogUrlOf(2))
        ? { status: 200, body: e3Body(blogUrlOf(2)) }
        : req.path === e4Path(blogUrlOf(2))
          ? { status: 200, body: e4Page(1) }
          : undefined;
    await setMe(blogUrlOf(2));
    expect(tileIds(root)).toEqual([MY_TILE, TILE(1), TILE(3)]);
    expect(lastFocusTarget()).toBe(MY_TILE);

    // And back: «Мой блог» goes (no post) while the blog is still a
    // subscription → its plain tile, at its own index.
    await focusOn(root, MY_TILE);
    focusMock.mockClear();
    await setOwnPosts(blogUrlOf(2), []);
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(lastFocusTarget()).toBe(TILE(2));
    await unmount(root);
  });

  it('E1 fails: the grid is shown; leave and come back: the grid at once, no skeleton, no new E1', async () => {
    let calls = 0;
    e1 = () => (calls++ === 0 ? e1With(MINE)() : { status: 404, body: {} });
    const root = await openSubs();
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    const profile = profileCalls().length;
    await focusOn(root, TILE(1));
    await back(); // → nav/subs
    await focusOn(root, 'nav/subs');
    await back(); // → Главная
    expect(visible(root, 'subs')).toBe(false);
    await focusOn(root, 'nav/home');
    focusMock.mockClear();
    await press(root, 'nav/subs');
    expect(visible(root, 'subs/skeleton')).toBe(false);
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    expect(lastFocusTarget()).toBe(TILE(1));
    // The failed check is settled: not asked again on mount.
    expect(profileCalls()).toHaveLength(profile);
    await unmount(root);
  });

  it('the tile arrives while focus is on the sidebar: no focus move', async () => {
    const root = await openSubs();
    // The initial focus landed on the first tile, then the user went ←.
    await focusOn(root, TILE(1));
    await focusOn(root, 'nav/subs');
    focusMock.mockClear();
    blog = ownBlog();
    await setMe(MINE);
    expect(tileIds(root)[0]).toBe(MY_TILE);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('flag off: no profile E1, no E3/E4, no tile', async () => {
    mockMyBlogFlag.on = false;
    e1 = e1With(MINE);
    blog = ownBlog();
    const root = await openSubs();
    expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
    // The cold-start validate only.
    expect(profileCalls()).toHaveLength(1);
    expect(transport.calls.filter(c => c.path.startsWith('/v1/blog/'))).toHaveLength(0);
    await unmount(root);
  });

  it('an account reset clears the cached profile', async () => {
    e1 = e1With(MINE);
    blog = ownBlog();
    const root = await openSubs();
    expect(queryClient.getQueryData(queryKeys.me())).toEqual({ id: '1001', blogUrl: MINE });
    await unmount(root);
    await accountScope.reset();
    expect(queryClient.getQueryData(queryKeys.me())).toBeUndefined();
  });

  describe('«Обновить» re-checks «Мой блог» (Epic 5 retro A3)', () => {
    const REFRESH = 'home/refresh';
    const emptyE4 = (): FixtureReply => ({ status: 200, body: { data: [], extra: { isLast: true } } });

    /** Подписки visited once (the check settled), then «Обновить» on Главная. */
    async function refreshFromHome(root: Root) {
      await press(root, 'nav/home');
      await press(root, REFRESH);
      await settle();
    }

    it('no tile, the first own post published: «Обновить» refetches own E4 page 1 only; the tile appears', async () => {
      e1 = e1With(MINE);
      let e4: () => FixtureReply = emptyE4;
      blog = ownBlog(() => e4());
      const root = await openSubs();
      expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
      const profile = profileCalls().length;
      e4 = () => ({ status: 200, body: e4Page(1) });
      await refreshFromHome(root);
      expect(e4Calls()).toHaveLength(2);
      expect(e4Calls()[1].url).toBe(e4Calls()[0].url);
      // E1 and E3 ended well: not asked again.
      expect(profileCalls()).toHaveLength(profile);
      expect(e3Calls()).toHaveLength(1);
      await press(root, 'nav/subs');
      expect(tileIds(root)[0]).toBe(MY_TILE);
      // Opening Подписки again sends nothing more.
      expect(e4Calls()).toHaveLength(2);
      await unmount(root);
    });

    it('the re-check fails: still no tile and no error', async () => {
      e1 = e1With(MINE);
      let e4: () => FixtureReply = emptyE4;
      blog = ownBlog(() => e4());
      const root = await openSubs();
      e4 = () => ({ status: 404, body: {} });
      await refreshFromHome(root);
      expect(e4Calls()).toHaveLength(2);
      await press(root, 'nav/subs');
      expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
      expect(visible(root, 'subs/error')).toBe(false);
      await unmount(root);
    });

    it('a multi-page empty own list is trimmed to page 1 first: one E4 request', async () => {
      e1 = e1With(MINE);
      blog = ownBlog(emptyE4);
      const root = await openSubs();
      const key = queryKeys.authorPosts(MINE, DEFAULT_FILTER);
      await act(async () => {
        queryClient.setQueryData(key, {
          pages: [
            { posts: [], nextCursor: 'c1' },
            { posts: [], nextCursor: null },
          ],
          pageParams: [null, 'c1'],
        });
      });
      const before = e4Calls().length;
      await refreshFromHome(root);
      expect(e4Calls()).toHaveLength(before + 1);
      expect(e4Calls()[before].url).not.toContain('offset=');
      await unmount(root);
    });

    it('the tile is shown: «Обновить» sends no E1, E3 or E4 for it', async () => {
      e1 = e1With(MINE);
      blog = ownBlog();
      const root = await openSubs();
      expect(tileIds(root)[0]).toBe(MY_TILE);
      const profile = profileCalls().length;
      await refreshFromHome(root);
      expect(profileCalls()).toHaveLength(profile);
      expect(e3Calls()).toHaveLength(1);
      expect(e4Calls()).toHaveLength(1);
      await unmount(root);
    });

    it('E3 unavailable: «Обновить» refetches E3 only', async () => {
      e1 = e1With(MINE);
      let missing = true;
      const own = ownBlog();
      blog = req => (req.path === e3Path(MINE) && missing ? e3MissingReply() : own(req));
      const root = await openSubs();
      expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
      missing = false;
      await refreshFromHome(root);
      expect(e3Calls()).toHaveLength(2);
      expect(e4Calls()).toHaveLength(1);
      await press(root, 'nav/subs');
      expect(tileIds(root)[0]).toBe(MY_TILE);
      await unmount(root);
    });

    it('the profile E1 failed: «Обновить» refetches it; on success the tile chain runs', async () => {
      let calls = 0;
      // The first E1 is the cold-start validate: only the profile E1 fails.
      e1 = () => (calls++ === 0 ? e1With(MINE)() : { status: 404, body: {} });
      blog = ownBlog();
      const root = await openSubs();
      expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
      expect(transport.calls.filter(c => c.path.startsWith('/v1/blog/'))).toHaveLength(0);
      const profile = profileCalls().length;
      e1 = e1With(MINE);
      await refreshFromHome(root);
      expect(profileCalls()).toHaveLength(profile + 1);
      expect(queryClient.getQueryData(queryKeys.me())).toEqual({ id: '1001', blogUrl: MINE });
      await press(root, 'nav/subs');
      expect(e3Calls()).toHaveLength(1);
      expect(e4Calls()).toHaveLength(1);
      expect(tileIds(root)[0]).toBe(MY_TILE);
      await unmount(root);
    });

    it('E1 had no blogUrl, the account has a blog now: «Обновить» sends one more profile E1; E3/E4 follow and the tile appears', async () => {
      blog = ownBlog();
      const root = await openSubs();
      expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
      const profile = profileCalls().length;
      e1 = e1With(MINE);
      await refreshFromHome(root);
      expect(profileCalls()).toHaveLength(profile + 1);
      await press(root, 'nav/subs');
      expect(e3Calls()).toHaveLength(1);
      expect(e4Calls()).toHaveLength(1);
      expect(tileIds(root)[0]).toBe(MY_TILE);
      await unmount(root);
    });

    it.each([
      ['E3 Parse', (): FixtureReply => ({ status: 200, body: { title: 'x' } })],
      ['E3 503', (): FixtureReply => ({ status: 503, body: {} })],
    ])('%s on the first load: «Обновить» refetches E3; the tile appears', async (_name, reply) => {
      e1 = e1With(MINE);
      let failing = true;
      const own = ownBlog();
      blog = req => (req.path === e3Path(MINE) && failing ? reply() : own(req));
      const root = await openSubs(WITH_TIMERS);
      expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
      const before = e3Calls().length;
      failing = false;
      await refreshFromHome(root);
      expect(e3Calls()).toHaveLength(before + 1);
      expect(e4Calls()).toHaveLength(1);
      await press(root, 'nav/subs');
      expect(tileIds(root)[0]).toBe(MY_TILE);
      await unmount(root);
    });

    it('E4 404 on the first load: «Обновить» sends one E4; the tile appears', async () => {
      e1 = e1With(MINE);
      let e4: () => FixtureReply = () => ({ status: 404, body: {} });
      blog = ownBlog(() => e4());
      const root = await openSubs();
      expect(tileIds(root)).toEqual([TILE(1), TILE(2), TILE(3)]);
      expect(e4Calls()).toHaveLength(1);
      e4 = () => ({ status: 200, body: e4Page(1) });
      await refreshFromHome(root);
      expect(e4Calls()).toHaveLength(2);
      expect(e3Calls()).toHaveLength(1);
      await press(root, 'nav/subs');
      expect(tileIds(root)[0]).toBe(MY_TILE);
      await unmount(root);
    });

    it('Подписки never visited: «Обновить» sends no profile E1, E3 or E4', async () => {
      e1 = e1With(MINE);
      blog = ownBlog();
      const root = await render(<App />);
      const profile = profileCalls().length;
      await press(root, REFRESH);
      await settle();
      expect(profileCalls()).toHaveLength(profile);
      expect(transport.calls.filter(c => c.path.startsWith('/v1/blog/'))).toHaveLength(0);
      await unmount(root);
    });
  });
});
