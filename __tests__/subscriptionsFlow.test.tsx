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
import App from '../src/app/App';
import { queryClient, resetQueryCache } from '../src/app/queryClient';
import { accountScope } from '../src/shared/account';
import { queryKeys } from '../src/shared/api';
import { type FixtureReply, type FixtureRequest, type FixtureTransport } from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { E5_PATH, e5Page } from '../src/test/feedFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import {
  E2_PATH,
  E2_URL,
  blogUrlOf,
  e2Body,
  subscription,
  subscriptionsBody,
} from '../src/test/subscriptionFixtures';
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
 * The real FlashList behind a recorder: the test reads the last props of
 * each list (by testID) and the scroll calls made through its ref.
 */
const mockLists: {
  props: Map<string, Record<string, any>>;
  scrollToOffset: jest.Mock;
  scrollToIndex: jest.Mock;
} = { props: new Map(), scrollToOffset: jest.fn(), scrollToIndex: jest.fn() };
jest.mock('@shopify/flash-list', () => {
  const actual = jest.requireActual('@shopify/flash-list');
  const React = jest.requireActual('react');
  function RecordingFlashList(props: Record<string, any>) {
    mockLists.props.set(props.testID, props);
    const inner = React.useRef(null);
    React.useImperativeHandle(
      props.ref,
      () => ({
        scrollToOffset: (params: unknown) => {
          mockLists.scrollToOffset(params);
          return inner.current?.scrollToOffset(params);
        },
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
let transport: FixtureTransport;

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
  mockLists.props.clear();
  mockLists.scrollToIndex.mockClear();
  mockLists.scrollToOffset.mockClear();
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.0' } });
  subs = () => ({ status: 200, body: subscriptionsBody(3) });
  transport = installFixtureTransport(req => {
    if (req.path === E1) {
      return { status: 200, body: e1Ok.body };
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
const tileIds = (root: Root) => focusableIds(root).filter(id => id.startsWith('subs/tile/'));
const focusTargets = () =>
  focusMock.mock.calls.map(c => (c[0] as { props?: { testID?: string } } | null)?.props?.testID);
function destinationIds(guide: string): string[] {
  return (mockGuideDestinations.get(guide) ?? []).map(
    view => (view as { props?: { testID?: string } }).props?.testID as string,
  );
}
/** The Подписки grid's FlashList props (last render). */
function grid(): Record<string, any> {
  const props = mockLists.props.get('subs/list');
  if (!props) {
    throw new Error('no Подписки grid rendered');
  }
  return props;
}
/** The blogUrls in the grid (its items are rows of up to 3). */
const gridBlogs = () =>
  (grid().data as Array<{ authors: Array<{ blogUrl: string }> }>).flatMap(r =>
    r.authors.map(a => a.blogUrl),
  );

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
  it('Подписки is in the sidebar between Главная and Настройки; focus alone sends nothing', async () => {
    const root = await render(<App />);
    expect(focusableIds(root, byTestId(root, 'shell/sidebar')[0])).toEqual([
      'nav/home',
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
    // Tile label «{title}. {owner}».
    expect(one(root, TILE(1)).props.accessibilityLabel).toBe('Blog 1. Owner 1');
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
    expect(mockLists.scrollToIndex).toHaveBeenLastCalledWith(
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
    expect(mockLists.scrollToOffset).toHaveBeenCalledWith(
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
    mockLists.scrollToIndex.mockClear();
    await press(root, 'nav/subs');
    // The neighbor sits at index 53 (the remembered index 54 no longer exists).
    expect(mockLists.scrollToIndex).toHaveBeenCalledWith(
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
