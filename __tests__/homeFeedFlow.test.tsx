/**
 * Story 3.1 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: «Новое в подписках» on Главная (E5 via TanStack
 * Query), every row of the spec's I/O matrix, the focus rules of
 * docs/focus-map.md §1.6 and §3 (B1–B6), restoration on return to Главная,
 * and a 300-post feed. The keychain, BackHandler and the native focus
 * command are faked: these tests prove which element the app asks to focus,
 * not native focus movement or decoder behavior (device checks,
 * docs/testing.md).
 */
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { AppState } from 'react-native';
import App, { navigationRef } from '../src/app/App';
import { QUERY_STALE_TIME_MS, queryClient, resetQueryCache } from '../src/app/queryClient';
import { queryKeys } from '../src/shared/api';
import {
  type FixtureReply,
  type FixtureRequest,
  type FixtureTransport,
} from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { logger } from '../src/shared/services/logger';
import { t } from '../src/shared/i18n';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import type { Root } from 'test-renderer';
import backHandler from '../src/test/backHandlerMock';
import {
  E5_PATH,
  cursorFor,
  cursorOf,
  e5Page,
  e5Posts,
  feedPost,
  lockedPost,
  syntheticFeed,
} from '../src/test/feedFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import e1Unauthorized from '../src/test/fixtures/boosty/e1-no-token.json';
import refreshRejected from '../src/test/fixtures/boosty/refresh-invalid-grant.json';
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

/** PostCard renders per testID (the production memo, around a counter). */
const mockCardRenders = new Map<string, number>();
jest.mock('../src/shared/ui/PostCard', () => {
  const actual = jest.requireActual('../src/shared/ui/PostCard');
  const React = jest.requireActual('react');
  function CountedPostCard(props: { testID?: string }) {
    const id = props.testID ?? '';
    mockCardRenders.set(id, (mockCardRenders.get(id) ?? 0) + 1);
    return actual.PostCardView(props);
  }
  return { ...actual, PostCard: React.memo(CountedPostCard) };
});

/**
 * The real FlashList behind a recorder: the test reads its last props and
 * the scroll calls made through its ref. `onEndReached` is held back from
 * the real list and called by the test: FlashList's Jest setup measures
 * every item 100 × 100 in a 400 × 900 parent, so the end would always be
 * "reached" and every page would load at once (the device measures the
 * real rows). Paging by focus is unchanged.
 */
const mockFlashList: {
  props: Record<string, any> | null;
  scrollToOffset: jest.Mock;
  scrollToIndex: jest.Mock;
} = { props: null, scrollToOffset: jest.fn(), scrollToIndex: jest.fn() };
jest.mock('@shopify/flash-list', () => {
  const actual = jest.requireActual('@shopify/flash-list');
  const React = jest.requireActual('react');
  function RecordingFlashList(props: Record<string, any>) {
    mockFlashList.props = props;
    const inner = React.useRef(null);
    React.useImperativeHandle(
      props.ref,
      () => ({
        scrollToOffset: (params: unknown) => {
          mockFlashList.scrollToOffset(params);
          return inner.current?.scrollToOffset(params);
        },
        scrollToIndex: (params: unknown) => {
          mockFlashList.scrollToIndex(params);
          return inner.current?.scrollToIndex(params) ?? Promise.resolve();
        },
      }),
      [],
    );
    return React.createElement(actual.FlashList, {
      ...props,
      ref: inner,
      onEndReached: undefined,
    });
  }
  return { ...actual, FlashList: RecordingFlashList };
});

const focusMock = requestHostFocus as jest.Mock;

/**
 * 30 rounds, no timers by default: a pending timer run would also fire the
 * 30 s request timeouts and move the fake clock past `staleTime`. Rows that
 * need the AD-6 backoff pass `WITH_TIMERS`. TanStack's notifications are
 * moved from a 0 ms timer to a microtask (below), so no timer is needed.
 */
const { settle, render, one, focusOn, press, back } = createFlow({
  settle: { rounds: 30, timerRounds: 0 },
  one: 'focusable',
  pressFocuses: true,
  submitSettles: false,
});

const STORED = JSON.stringify({
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 4_000_000_000_000,
  accountId: '1001',
});
const E1 = '/v1/user/current';

type Reply = FixtureReply | Promise<FixtureReply> | undefined;
let feed: (req: FixtureRequest) => Reply;
let transport: FixtureTransport;

/** A reply the test releases by hand. */
function deferred() {
  let resolve!: (reply: FixtureReply) => void;
  const promise = new Promise<FixtureReply>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const WITH_TIMERS = { timerRounds: 30 };

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
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.0' } });
  feed = () => ({ status: 200, body: e5Page() });
  transport = installFixtureTransport(req => {
    if (req.path === E1) {
      return { status: 200, body: e1Ok.body };
    }
    if (req.path === E5_PATH) {
      return feed(req);
    }
    return undefined;
  });
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);
const feedCalls = () => transport.callsTo(E5_PATH);
const cardIds = (root: Parameters<typeof visible>[0]) =>
  focusableIds(root).filter(id => id.startsWith('home/feed/') && id !== 'home/feed/retry');
const focusTargets = () =>
  focusMock.mock.calls.map(c => (c[0] as { props?: { testID?: string } } | null)?.props?.testID);
function destinationIds(guide: string): string[] {
  return (mockGuideDestinations.get(guide) ?? []).map(
    view => (view as { props?: { testID?: string } }).props?.testID as string,
  );
}
/** The grid's FlashList props (last render). */
function grid(_root?: unknown): { props: Record<string, any> } {
  if (!mockFlashList.props) {
    throw new Error('no FlashList rendered');
  }
  return { props: mockFlashList.props };
}
/** The posts in the grid (its items are rows of up to 3). */
function gridPosts(root: Parameters<typeof visible>[0]): Array<{ id: string }> {
  return (grid(root).props.data as Array<{ posts: Array<{ id: string }> }>).flatMap(r => r.posts);
}

describe('first load (matrix «First load», «User moved during load»)', () => {
  it('skeleton with focus on nav/home → 10 cards; focus moves to the first card', async () => {
    const page = deferred();
    feed = () => page.promise;
    const root = await renderApp();
    expect(visible(root, 'home/feed/skeleton')).toBe(true);
    expect(text(root)).toContain(t('home.feed.title'));
    expect(lastFocusTarget()).toBe('nav/home');
    // The skeleton has nothing focusable.
    const content = byTestId(root, 'shell/content/home')[0];
    expect(focusableIds(root, content)).toEqual([]);

    page.resolve({ status: 200, body: e5Page() });
    await settle();
    expect(visible(root, 'home/feed/skeleton')).toBe(false);
    const ids = e5Posts().map(p => `home/feed/${p.id}`);
    expect(cardIds(root)).toEqual(ids);
    expect(lastFocusTarget()).toBe(ids[0]);
    // One E5 request, with the content profile and comments off.
    expect(feedCalls()).toHaveLength(1);
    expect(feedCalls()[0].url).toBe(
      'https://api.boosty.to/v1/feed/post/?limit=10&comments_limit=0&reply_limit=0',
    );
    expect(feedCalls()[0].headers['X-App']).toBeUndefined();
    expect(transport.calls.every(c => !c.path.includes('comment'))).toBe(true);
    await unmount(root);
  });

  it('the user moved focus during the load: cards render, focus stays where the user put it', async () => {
    const page = deferred();
    feed = () => page.promise;
    const root = await renderApp();
    await focusOn(root, 'nav/home');
    await focusOn(root, 'nav/settings');
    focusMock.mockClear();
    page.resolve({ status: 200, body: e5Page() });
    await settle();
    expect(cardIds(root)).toHaveLength(10);
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('focus still on nav/home (a real focus event) still moves to the first card', async () => {
    const page = deferred();
    feed = () => page.promise;
    const root = await renderApp();
    await focusOn(root, 'nav/settings');
    await focusOn(root, 'nav/home');
    page.resolve({ status: 200, body: e5Page() });
    await settle();
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    await unmount(root);
  });
});

describe('OK on Главная during the skeleton', () => {
  it('opened with OK from Настройки, the user moves to nav/settings during the skeleton: the page does not take focus', async () => {
    const page = deferred();
    feed = () => page.promise;
    const root = await renderApp();
    await press(root, 'nav/settings');
    await focusOn(root, 'nav/home');
    await press(root, 'nav/home');
    expect(visible(root, 'home/feed/skeleton')).toBe(true);
    await focusOn(root, 'nav/settings');
    focusMock.mockClear();
    page.resolve({ status: 200, body: e5Page() });
    await settle();
    expect(cardIds(root)).toHaveLength(10);
    expect(focusTargets().filter(id => id?.startsWith('home/feed/'))).toEqual([]);
    await unmount(root);
  });

  it('opened with OK from Настройки and focus still on nav/home: the page takes focus', async () => {
    const page = deferred();
    feed = () => page.promise;
    const root = await renderApp();
    await press(root, 'nav/settings');
    await focusOn(root, 'nav/home');
    await press(root, 'nav/home');
    page.resolve({ status: 200, body: e5Page() });
    await settle();
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    await unmount(root);
  });
});

describe('pages that add no card', () => {
  it('a first page whose posts are all dropped but has a next cursor: the next page loads (no «Новых постов нет»)', async () => {
    const pages = syntheticFeed({ total: 20 });
    feed = req => {
      if (cursorOf(req.url) === null) {
        const posts = e5Posts();
        posts.forEach(p => delete (p.user as Record<string, unknown>).name);
        return { status: 200, body: { data: { posts }, extra: { offset: cursorFor(10), isLast: false } } };
      }
      return pages(req);
    };
    const root = await renderApp();
    expect(visible(root, 'home/feed/empty')).toBe(false);
    expect(feedCalls().map(c => cursorOf(c.url))).toEqual([null, 10]);
    expect(cardIds(root)[0]).toBe('home/feed/feed-post-10');
    await unmount(root);
  });

  it('a later page of duplicates does not stall paging: the next page loads by itself', async () => {
    const pages = syntheticFeed({ total: 30 });
    feed = req =>
      cursorOf(req.url) === 10
        ? {
            status: 200,
            body: { data: { posts: [feedPost(8), feedPost(9)] }, extra: { offset: cursorFor(20), isLast: false } },
          }
        : pages(req);
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    expect(feedCalls().map(c => cursorOf(c.url))).toEqual([null, 10, 20]);
    expect(gridPosts(root)).toHaveLength(20);
    await unmount(root);
  });

  it('a cursor cycle A → B → A ends the paging', async () => {
    feed = req => {
      const n = cursorOf(req.url);
      const next = n === null || n === 2 ? cursorFor(1) : cursorFor(2);
      return {
        status: 200,
        body: { data: { posts: [feedPost(n ?? 0)] }, extra: { offset: next, isLast: false } },
      };
    };
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-0');
    await focusOn(root, 'home/feed/feed-post-1');
    await focusOn(root, 'home/feed/feed-post-2');
    await focusOn(root, 'home/feed/feed-post-2');
    expect(feedCalls().map(c => cursorOf(c.url))).toEqual([null, 1, 2]);
    await unmount(root);
  });
});

describe('load more (matrix «Load more», «Last page»)', () => {
  it('focus in the last row loads the next page; appended, deduped, focus unchanged', async () => {
    feed = syntheticFeed({ total: 30, overlap: 2 });
    const root = await renderApp();
    // 3 columns, more pages: post 9 (a partial row) is held; 6–8 is the last row.
    expect(cardIds(root)).toHaveLength(9);
    await focusOn(root, 'home/feed/feed-post-5');
    expect(feedCalls()).toHaveLength(1);
    focusMock.mockClear();
    await focusOn(root, 'home/feed/feed-post-8');
    expect(feedCalls()).toHaveLength(2);
    expect(cursorOf(feedCalls()[1].url)).toBe(10);
    expect(feedCalls()[1].url).toContain('&offset=cursor%3A10');
    // 20 posts, 2 held in a partial row: 18 shown, no duplicates.
    const ids = gridPosts(root).map(p => p.id);
    expect(ids).toHaveLength(18);
    expect(new Set(ids).size).toBe(18);
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('isLast: focusing the last row requests nothing more', async () => {
    feed = () => ({ status: 200, body: e5Page({ isLast: true }) });
    const root = await renderApp();
    const last = e5Posts()[9].id;
    await focusOn(root, `home/feed/${last}`);
    await settle();
    expect(feedCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('no extra in the page: no further request', async () => {
    feed = () => ({ status: 200, body: { data: { posts: e5Posts() } } });
    const root = await renderApp();
    await focusOn(root, `home/feed/${e5Posts()[9].id}`);
    expect(feedCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('a cursor that repeats itself stops the paging', async () => {
    feed = req => ({
      status: 200,
      body: {
        data: { posts: [feedPost(cursorOf(req.url) === null ? 0 : 1)] },
        extra: { offset: 'same', isLast: false },
      },
    });
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-0');
    await focusOn(root, 'home/feed/feed-post-1');
    await focusOn(root, 'home/feed/feed-post-1');
    expect(feedCalls()).toHaveLength(2);
    await unmount(root);
  });
});

describe('load-more failure (matrix «Load-more failure», B5)', () => {
  it('inline retry row; OK reloads page N only; success focuses the first new card', async () => {
    const pages = syntheticFeed({ total: 30 });
    let failSecond = true;
    feed = req => {
      if (cursorOf(req.url) === 10 && failSecond) {
        return { status: 503, body: {} };
      }
      return pages(req);
    };
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    await settle(WITH_TIMERS);
    expect(visible(root, 'home/feed/retry')).toBe(true);
    expect(text(byTestId(root, 'home/feed/retry-row')[0])).toContain(t('home.feed.loadMoreError'));
    // Loaded cards stay, and the held partial row (post 9) shows: it must
    // not stay hidden behind a failing «Повторить».
    expect(cardIds(root)).toHaveLength(10);
    expect(visible(root, 'home/feed/feed-post-9')).toBe(true);
    // 503 + one AD-6 retry, nothing else.
    expect(feedCalls().map(c => cursorOf(c.url))).toEqual([null, 10, 10]);

    // Focus in the last row does not retry by itself.
    await focusOn(root, 'home/feed/feed-post-8');
    expect(feedCalls()).toHaveLength(3);

    failSecond = false;
    focusMock.mockClear();
    await press(root, 'home/feed/retry');
    expect(feedCalls().map(c => cursorOf(c.url))).toEqual([null, 10, 10, 10]);
    expect(visible(root, 'home/feed/retry')).toBe(false);
    // 20 posts, 18 shown (post 9 stays: rows 0–17); the first new card is 10.
    expect(gridPosts(root)).toHaveLength(18);
    expect(lastFocusTarget()).toBe('home/feed/feed-post-10');
    await unmount(root);
  });

  it('a retry that adds no new card and ends the list: the held post shows and gets focus', async () => {
    const pages = syntheticFeed({ total: 30 });
    let failSecond = true;
    feed = req => {
      if (cursorOf(req.url) === 10) {
        return failSecond
          ? { status: 404, body: {} }
          : { status: 200, body: { data: { posts: [feedPost(8), feedPost(9)] }, extra: { isLast: true } } };
      }
      return pages(req);
    };
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    failSecond = false;
    focusMock.mockClear();
    await press(root, 'home/feed/retry');
    expect(visible(root, 'home/feed/retry')).toBe(false);
    expect(cardIds(root)).toHaveLength(10);
    expect(lastFocusTarget()).toBe('home/feed/feed-post-9');
    await unmount(root);
  });

  it('retry fails again: the row stays and nothing moves focus', async () => {
    const pages = syntheticFeed({ total: 30 });
    feed = req => (cursorOf(req.url) === 10 ? { status: 404, body: { error: 'not_found' } } : pages(req));
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    focusMock.mockClear();
    await press(root, 'home/feed/retry');
    expect(visible(root, 'home/feed/retry')).toBe(true);
    expect(focusMock).not.toHaveBeenCalled();
    // The held post shows while the next page fails.
    expect(cardIds(root)).toHaveLength(10);
    await unmount(root);
  });

  it('the retry succeeded after the user moved away: focus is not stolen', async () => {
    const pages = syntheticFeed({ total: 30 });
    const second = deferred();
    let failSecond = true;
    feed = req => {
      if (cursorOf(req.url) === 10) {
        return failSecond ? { status: 404, body: {} } : second.promise;
      }
      return pages(req);
    };
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    failSecond = false;
    await press(root, 'home/feed/retry');
    await focusOn(root, 'home/feed/feed-post-3');
    focusMock.mockClear();
    second.resolve(pages({ url: `https://api.boosty.to${E5_PATH}?offset=${encodeURIComponent(cursorFor(10))}` } as FixtureRequest) as FixtureReply);
    await settle();
    expect(gridPosts(root)).toHaveLength(18);
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });
});

describe('empty and full-load failure (matrix «Empty feed», «Full-load failure»)', () => {
  it('empty feed: StateView with one action «Обновить»; focus stays on the sidebar; OK refetches', async () => {
    feed = () => ({ status: 200, body: { data: { posts: [] }, extra: { isLast: true } } });
    const root = await renderApp();
    expect(visible(root, 'home/feed/empty')).toBe(true);
    expect(text(root)).toContain(t('home.feed.emptyTitle'));
    const content = byTestId(root, 'shell/content/home')[0];
    expect(focusableIds(root, content)).toEqual(['state/home/action']);
    expect(one(root, 'state/home/action').props.accessibilityLabel).toBe(t('home.feed.refresh'));
    expect(lastFocusTarget()).toBe('nav/home');
    // → from the sidebar reaches the action (zone destination).
    expect(destinationIds('shell/content/home')).toEqual(['state/home/action']);

    feed = () => ({ status: 200, body: e5Page() });
    await press(root, 'state/home/action');
    expect(feedCalls()).toHaveLength(2);
    expect(cardIds(root)).toHaveLength(10);
    // The action had focus and is gone: the first card.
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    await unmount(root);
  });

  it('empty feed, «Обновить» fails: the error StateView with «Повторить»', async () => {
    feed = () => ({ status: 200, body: { data: { posts: [] }, extra: { isLast: true } } });
    const root = await renderApp();
    expect(visible(root, 'home/feed/empty')).toBe(true);
    feed = () => ({ network: true });
    await press(root, 'state/home/action', { settle: WITH_TIMERS });
    expect(visible(root, 'home/feed/empty')).toBe(false);
    expect(visible(root, 'home/feed/error')).toBe(true);
    expect(text(root)).toContain(t('error.Network'));
    expect(one(root, 'state/home/action').props.accessibilityLabel).toBe(t('common.retry'));
    // The pressed action was replaced: the new one gets focus.
    expect(lastFocusTarget()).toBe('state/home/action');
    await unmount(root);
  });

  it.each([
    ['Network', (): FixtureReply => ({ network: true })],
    ['Server', (): FixtureReply => ({ status: 503, body: {} })],
    ['Client', (): FixtureReply => ({ status: 403, body: {} })],
    ['Parse', (): FixtureReply => ({ status: 200, body: { data: {} } })],
  ])('page 1 fails with %s: StateView error copy + «Повторить»; retry success → the first card', async (kind, reply) => {
    feed = reply;
    const root = await render(<App />, WITH_TIMERS);
    expect(visible(root, 'home/feed/error')).toBe(true);
    expect(text(root)).toContain(t('home.feed.errorTitle'));
    expect(text(root)).toContain(t(`error.${kind}` as 'error.Network'));
    expect(one(root, 'state/home/action').props.accessibilityLabel).toBe(t('common.retry'));
    expect(lastFocusTarget()).toBe('nav/home');
    // A 403 is not a session problem: no refresh, no A11.
    expect(transport.callsTo('/oauth/token/')).toHaveLength(0);
    expect(visible(root, 'shell')).toBe(true);

    feed = () => ({ status: 200, body: e5Page() });
    await press(root, 'state/home/action');
    expect(cardIds(root)).toHaveLength(10);
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    await unmount(root);
  });

  it('error → retry → still an error: focus stays on «Повторить»', async () => {
    feed = () => ({ status: 403, body: {} });
    const root = await renderApp();
    focusMock.mockClear();
    await press(root, 'state/home/action');
    expect(visible(root, 'home/feed/error')).toBe(true);
    expect(feedCalls()).toHaveLength(2);
    // The same action view stays mounted: nothing re-focuses it.
    expect(focusTargets().filter(Boolean)).toEqual([]);
    await unmount(root);
  });
});

describe('content (matrix «Malformed post», «Unknown block», «Locked post»)', () => {
  it('a post without user.name is dropped; the rest render', async () => {
    const posts = e5Posts();
    delete (posts[3].user as Record<string, unknown>).name;
    feed = () => ({ status: 200, body: { data: { posts }, extra: { isLast: true } } });
    const root = await renderApp();
    expect(cardIds(root)).toHaveLength(9);
    expect(visible(root, `home/feed/${posts[3].id}`)).toBe(false);
    await unmount(root);
  });

  it('an unknown block type: the card still renders', async () => {
    const post = feedPost(0);
    (post.data as unknown[]).push({ type: 'foo' });
    feed = () => ({ status: 200, body: { data: { posts: [post] }, extra: { isLast: true } } });
    const root = await renderApp();
    expect(cardIds(root)).toEqual(['home/feed/feed-post-0']);
    await unmount(root);
  });

  it('a locked post (hasAccess=false) and an empty-data post: dimmed card with «Нет доступа»', async () => {
    const locked = lockedPost();
    const empty = feedPost(1, { data: [] });
    feed = () => ({ status: 200, body: { data: { posts: [locked, empty] }, extra: { isLast: true } } });
    const root = await renderApp();
    for (const id of [locked.id as string, 'feed-post-1']) {
      expect(visible(root, `home/feed/${id}/lock`)).toBe(true);
      expect(one(root, `home/feed/${id}`).props.accessibilityLabel).toMatch(/^Нет доступа\./);
    }
    for (const id of [locked.id as string, 'feed-post-1']) {
      expect(text(one(root, `home/feed/${id}`))).not.toMatch(/₽|RUB|Оформить/);
    }
    await unmount(root);
  });

  it('OK on a card opens Пост for that post (Story 3.4; the flow is in postFlow)', async () => {
    const root = await renderApp();
    const post = e5Posts()[0] as { id: string; user: { blogUrl: string } };
    await press(root, `home/feed/${post.id}`);
    expect(visible(root, 'post')).toBe(true);
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      blogUrl: post.user.blogUrl,
      postId: post.id,
      section: 'home',
    });
    await unmount(root);
  });
});

describe('zones, Back and restoration', () => {
  it('← from column 1 lands on nav/home; Back from a card → nav/home', async () => {
    const root = await renderApp();
    const first = `home/feed/${e5Posts()[0].id}`;
    await focusOn(root, first);
    expect(destinationIds('shell/sidebar')).toEqual(['nav/home']);
    // → from the sidebar returns to the remembered card.
    await focusOn(root, `home/feed/${e5Posts()[5].id}`);
    expect(destinationIds('shell/content/home')).toEqual([`home/feed/${e5Posts()[5].id}`]);
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe('nav/home');
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    await focusOn(root, 'nav/home');
    await back();
    expect(backHandler.exitApp).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('Настройки and back to Главная with OK: the remembered card is restored from the cache', async () => {
    const root = await renderApp();
    const card = `home/feed/${e5Posts()[6].id}`;
    await focusOn(root, card);
    await back(); // → nav/home
    await focusOn(root, 'nav/settings');
    await press(root, 'nav/settings');
    expect(visible(root, 'shell/content/settings')).toBe(true);
    await focusOn(root, 'nav/home');
    focusMock.mockClear();
    await press(root, 'nav/home');
    expect(visible(root, 'shell/content/home')).toBe(true);
    // Served from the cache (staleTime 60 s): no skeleton, no new request.
    expect(visible(root, 'home/feed/skeleton')).toBe(false);
    expect(feedCalls()).toHaveLength(1);
    expect(lastFocusTarget()).toBe(card);
    await unmount(root);
  });

  it('Back from Настройки with the cache kept: Главная remounts with cards, focus stays on nav/home', async () => {
    const root = await renderApp();
    await focusOn(root, 'nav/settings');
    await press(root, 'nav/settings');
    await focusOn(root, 'settings/row/version');
    await back(); // → nav/settings
    focusMock.mockClear();
    await back(); // → Главная, nav/home
    expect(visible(root, 'shell/content/home')).toBe(true);
    expect(visible(root, 'home/feed/skeleton')).toBe(false);
    expect(cardIds(root)).toHaveLength(10);
    expect(feedCalls()).toHaveLength(1);
    expect(focusTargets()).toEqual(['nav/home']);
    await unmount(root);
  });

  it('back to Главная with OK and no remembered card: the first card', async () => {
    const root = await renderApp();
    await focusOn(root, 'nav/settings');
    await press(root, 'nav/settings');
    focusRestoration.clear();
    await focusOn(root, 'nav/home');
    focusMock.mockClear();
    await press(root, 'nav/home');
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    await unmount(root);
  });
});

describe('300-post feed', () => {
  it('stable post.id keys, one row type, pages requested in order, no duplicate cards', async () => {
    feed = syntheticFeed({ total: 310, overlap: 3 });
    const root = await renderApp();
    const list = grid(root);
    // 3 columns, more pages: 10 posts → 3 full rows; post 9 is held.
    expect(list.props.data).toHaveLength(3);
    expect(gridPosts(root)).toHaveLength(9);
    expect(list.props.removeClippedSubviews).toBe(false);
    expect(list.props.getItemType(list.props.data[0], 0)).toBe('row');
    expect(list.props.drawDistance).toBeGreaterThan(0);
    expect(list.props.maxItemsInRecyclePool).toBeGreaterThan(0);
    // Rows are keyed by their first post id (stable when a partial row grows).
    expect(list.props.data.map((r: { key: string }, i: number) => list.props.keyExtractor(r, i))).toEqual([
      'feed-post-0',
      'feed-post-3',
      'feed-post-6',
    ]);

    // Scroll to the end: the list reports end reached for every page.
    for (let i = 0; i < 40 && gridPosts(root).length < 310; i += 1) {
      await act(async () => {
        grid(root).props.onEndReached();
      });
      await settle();
    }
    const data = gridPosts(root);
    expect(data).toHaveLength(310);
    expect(new Set(data.map(p => p.id)).size).toBe(310);
    expect(data.map(p => p.id)).toEqual(Array.from({ length: 310 }, (_, i) => `feed-post-${i}`));
    const cursors = feedCalls().map(c => cursorOf(c.url));
    expect(cursors).toEqual([null, ...Array.from({ length: 30 }, (_, i) => (i + 1) * 10)]);
    // The last page: no more requests.
    await act(async () => {
      grid(root).props.onEndReached();
    });
    await settle();
    expect(feedCalls()).toHaveLength(31);
    // Virtualized: far fewer cards are mounted than loaded.
    expect(cardIds(root).length).toBeLessThan(310);
    // Focus never moved during the paging (only the first card at load).
    expect(focusTargets()).toEqual(['nav/home', 'home/feed/feed-post-0']);
    await unmount(root);
  });
});

describe('offline cold start (Story 2.5)', () => {
  it('the offline view hides the feed; after «Повторить» succeeds the feed loads', async () => {
    let online = false;
    feed = () => (online ? { status: 200, body: e5Page() } : { network: true });
    transport = installFixtureTransport(req => {
      if (!online) {
        return { network: true };
      }
      return req.path === E1 ? { status: 200, body: e1Ok.body } : feed(req);
    });
    const root = await render(<App />, WITH_TIMERS);
    expect(visible(root, 'home/offline')).toBe(true);
    expect(visible(root, 'home/feed')).toBe(false);
    online = true;
    await press(root, 'nav/home');
    await press(root, 'home/offline/retry', { settle: WITH_TIMERS });
    expect(visible(root, 'home/offline')).toBe(false);
    expect(cardIds(root)).toHaveLength(10);
    await unmount(root);
  });

  it('offline, Главная opened with OK from Настройки: focus goes to «Повторить»', async () => {
    transport = installFixtureTransport(() => ({ network: true }));
    const root = await render(<App />, WITH_TIMERS);
    expect(visible(root, 'home/offline')).toBe(true);
    await press(root, 'nav/settings');
    await focusOn(root, 'nav/home');
    focusMock.mockClear();
    await press(root, 'nav/home');
    expect(visible(root, 'home/offline')).toBe(true);
    expect(lastFocusTarget()).toBe('home/offline/retry');
    await unmount(root);
  });
});

describe('render cost (Story 3.1 device review)', () => {
  const snapshot = () => new Map(mockCardRenders);
  const rerendered = (before: Map<string, number>, ids: readonly string[]) =>
    ids.filter(id => (mockCardRenders.get(id) ?? 0) !== (before.get(id) ?? 0));

  it('a focus move re-renders at most the two cards involved', async () => {
    const root = await renderApp();
    const ids = cardIds(root);
    const before = snapshot();
    await focusOn(root, ids[0]);
    await focusOn(root, ids[1]);
    await focusOn(root, ids[4]);
    expect(rerendered(before, ids).length).toBeLessThanOrEqual(2);
    await unmount(root);
  });

  it('a page append does not re-render the cards already shown', async () => {
    feed = syntheticFeed({ total: 30 });
    const root = await renderApp();
    const ids = cardIds(root);
    expect(ids).toHaveLength(9);
    const before = snapshot();
    await focusOn(root, 'home/feed/feed-post-8');
    expect(gridPosts(root)).toHaveLength(18);
    expect(rerendered(before, ids)).toEqual([]);
    await unmount(root);
  });
});

describe('end of the list (Story 3.1 device review)', () => {
  it('↓ from the last row lands back on the focused card; the spinner is not focusable; the page does not move focus', async () => {
    const pages = syntheticFeed({ total: 30 });
    const second = deferred();
    feed = req => (cursorOf(req.url) === 10 ? second.promise : pages(req));
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    expect(visible(root, 'home/feed/loading-more')).toBe(true);
    const [spinner] = byTestId(root, 'home/feed/loading-more');
    expect(focusableIds(root, spinner)).toEqual([]);
    // The guide under the grid routes ↓ back to the focused last-row card.
    expect(destinationIds('home/feed/end-guide')).toEqual(['home/feed/feed-post-8']);
    focusMock.mockClear();
    second.resolve(pages({ url: `https://api.boosty.to${E5_PATH}?offset=${encodeURIComponent(cursorFor(10))}` } as FixtureRequest) as FixtureReply);
    await settle();
    expect(gridPosts(root)).toHaveLength(18);
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('the guide follows the focused card', async () => {
    const root = await renderApp();
    await focusOn(root, `home/feed/${e5Posts()[3].id}`);
    expect(destinationIds('home/feed/end-guide')).toEqual([`home/feed/${e5Posts()[3].id}`]);
    await unmount(root);
  });
});

describe('partial last row (Story 3.1 device run: column jumps)', () => {
  it('more pages: a trailing partial row is held; ↓ from the last full row hits the end guide, which keeps the focused card', async () => {
    feed = syntheticFeed({ total: 30 });
    const root = await renderApp();
    expect(gridPosts(root).map(p => p.id)).toEqual(
      Array.from({ length: 9 }, (_, i) => `feed-post-${i}`),
    );
    expect(visible(root, 'home/feed/feed-post-9')).toBe(false);
    await focusOn(root, 'home/feed/feed-post-8');
    expect(destinationIds('home/feed/end-guide')).toEqual(['home/feed/feed-post-8']);
    await unmount(root);
  });

  it('the last page shows the partial row', async () => {
    feed = () => ({ status: 200, body: e5Page({ isLast: true }) });
    const root = await renderApp();
    expect(gridPosts(root)).toHaveLength(10);
    expect(visible(root, `home/feed/${e5Posts()[9].id}`)).toBe(true);
    await unmount(root);
  });

  it('fewer than 3 posts with more pages: all are shown', async () => {
    feed = req =>
      cursorOf(req.url) === null
        ? { status: 200, body: { data: { posts: [feedPost(0), feedPost(1)] }, extra: { offset: cursorFor(2), isLast: false } } }
        : { status: 200, body: { data: { posts: [] }, extra: { isLast: true } } };
    const root = await renderApp();
    expect(gridPosts(root).map(p => p.id)).toEqual(['feed-post-0', 'feed-post-1']);
    await unmount(root);
  });

  it('a page whose new posts all go into the held row fetches the next page', async () => {
    const pages = syntheticFeed({ total: 30 });
    feed = req =>
      cursorOf(req.url) === 10
        ? { status: 200, body: { data: { posts: [feedPost(10)] }, extra: { offset: cursorFor(11), isLast: false } } }
        : cursorOf(req.url) === 11
          ? pages({ ...req, url: `https://api.boosty.to${E5_PATH}?offset=${encodeURIComponent(cursorFor(11))}` })
          : pages(req);
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    // Page 2 added post 10 only (held with 9): page 3 was fetched by itself.
    expect(feedCalls().map(c => cursorOf(c.url))).toEqual([null, 10, 11]);
    expect(gridPosts(root)).toHaveLength(21);
    await unmount(root);
  });

  it('a remembered card in a held row falls back by the chain (its neighbor by index)', async () => {
    feed = syntheticFeed({ total: 30 });
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-3');
    // Pretend the user had focused the held post 9 (remembered at index 9).
    focusRestoration.remember('shell', 'home', 'home/feed/feed-post-9', 0, 9);
    await focusOn(root, 'nav/settings');
    await press(root, 'nav/settings');
    await focusOn(root, 'nav/home');
    focusMock.mockClear();
    await press(root, 'nav/home');
    expect(lastFocusTarget()).toBe('home/feed/feed-post-8');
    await unmount(root);
  });
});

describe('keep scroll on return (owner decision 2026-10-26)', () => {
  it('Back from Настройки: the grid opens at the remembered offset, focus stays on nav/home, → lands on the remembered card', async () => {
    feed = syntheticFeed({ total: 30 });
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-7');
    // Native scroll to 300 while the card is focused.
    const [host] = byTestId(root, 'home/feed/list').filter(n => n.props.onScroll);
    await act(async () => {
      host.props.onScroll({
        nativeEvent: {
          contentOffset: { x: 0, y: 300 },
          contentSize: { width: 720, height: 4000 },
          layoutMeasurement: { width: 720, height: 486 },
          zoomScale: 1,
        },
        timeStamp: 1,
      });
    });
    await back(); // → nav/home
    await focusOn(root, 'nav/settings');
    await press(root, 'nav/settings');
    const scrolled = mockFlashList.scrollToOffset;
    scrolled.mockClear();
    focusMock.mockClear();
    await back(); // → Главная, focus on nav/home
    expect(visible(root, 'shell/content/home')).toBe(true);
    expect(focusTargets().filter(id => id?.startsWith('home/feed/'))).toEqual([]);
    // Opens at the remembered card's row (7 / 3 → row 2), then the exact offset.
    expect(grid(root).props.initialScrollIndex).toBe(2);
    expect(scrolled).toHaveBeenCalledWith({ offset: 300, animated: false });
    // → from the sidebar: the zone's destination is the remembered card.
    expect(destinationIds('shell/content/home')).toEqual(['home/feed/feed-post-7']);
    await unmount(root);
  });
});

describe('review pass 2', () => {
  it('auto-paging stops after 3 pages that show nothing (fresh cursors, every post dropped): the empty StateView', async () => {
    feed = req => {
      const n = cursorOf(req.url) ?? 0;
      const posts = e5Posts();
      posts.forEach(p => delete (p.user as Record<string, unknown>).name);
      return { status: 200, body: { data: { posts }, extra: { offset: cursorFor(n + 1), isLast: false } } };
    };
    const root = await renderApp();
    // Page 1 + 3 automatic pages, then stop.
    expect(feedCalls()).toHaveLength(4);
    await settle();
    expect(feedCalls()).toHaveLength(4);
    expect(visible(root, 'home/feed/skeleton')).toBe(false);
    expect(visible(root, 'home/feed/empty')).toBe(true);
    // «Обновить» is a user action: auto-paging may run again.
    await press(root, 'state/home/action');
    expect(feedCalls().length).toBeGreaterThan(4);
    await unmount(root);
  });

  it('refetchOnMount is off: 2 pages loaded, Настройки, past staleTime, back: no new E5', async () => {
    feed = syntheticFeed({ total: 30 });
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    expect(feedCalls()).toHaveLength(2);
    await back(); // → nav/home
    await focusOn(root, 'nav/settings');
    await press(root, 'nav/settings');
    await act(async () => {
      jest.advanceTimersByTime(QUERY_STALE_TIME_MS + 1000);
    });
    await focusOn(root, 'nav/home');
    await press(root, 'nav/home');
    await settle();
    expect(visible(root, 'shell/content/home')).toBe(true);
    expect(feedCalls()).toHaveLength(2);
    await unmount(root);
  });

  it('FocusZone destination: the empty-state action goes away → the destination falls back to a mounted card', async () => {
    feed = () => ({ status: 200, body: { data: { posts: [] }, extra: { isLast: true } } });
    const root = await renderApp();
    expect(destinationIds('shell/content/home')).toEqual(['state/home/action']);
    feed = () => ({ status: 200, body: e5Page() });
    await press(root, 'state/home/action');
    expect(cardIds(root)).toHaveLength(10);
    expect(destinationIds('shell/content/home')).toEqual([`home/feed/${e5Posts()[0].id}`]);
    await unmount(root);
  });

  it('an E5 reply in flight at sign-out: released afterwards, it is never cached or shown', async () => {
    const page = deferred();
    feed = () => page.promise;
    const root = await renderApp();
    await press(root, 'nav/settings');
    await press(root, 'settings/row/signout');
    await press(root, 'dialog/signout/confirm');
    expect(visible(root, 'auth/welcome')).toBe(true);
    page.resolve({ status: 200, body: e5Page() });
    await settle();
    expect(queryClient.getQueryData(queryKeys.subscriptionFeed())).toBeUndefined();
    expect(cardIds(root)).toEqual([]);
    await unmount(root);
  });

  it('E5 401 → one refresh → replayed → cards', async () => {
    const NEW = 'n'.repeat(64);
    transport = installFixtureTransport(req => {
      if (req.path === E1) {
        return { status: 200, body: e1Ok.body };
      }
      if (req.path === '/oauth/token/') {
        return { status: 200, body: { access_token: NEW, refresh_token: 'm'.repeat(64), expires_in: 2592000 } };
      }
      if (req.path === E5_PATH) {
        return req.headers.Authorization === `Bearer ${NEW}`
          ? { status: 200, body: e5Page() }
          : { status: 401, body: { error: 'unauthorized' } };
      }
      return undefined;
    });
    installNativeModules({ InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') } });
    const root = await render(<App />, WITH_TIMERS);
    expect(transport.callsTo('/oauth/token/')).toHaveLength(1);
    expect(feedCalls()).toHaveLength(2);
    expect(cardIds(root)).toHaveLength(10);
    await unmount(root);
  });

  it('E5 401 → refresh invalid_grant → A11; the feed keeps no focus behind it', async () => {
    transport = installFixtureTransport(req => {
      if (req.path === E1) {
        return { status: 200, body: e1Ok.body };
      }
      if (req.path === '/oauth/token/') {
        return { status: 400, body: { error: 'invalid_grant' } };
      }
      if (req.path === E5_PATH) {
        return { status: 401, body: { error: 'unauthorized' } };
      }
      return undefined;
    });
    installNativeModules({ InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') } });
    const root = await render(<App />, WITH_TIMERS);
    expect(visible(root, 'auth/expired')).toBe(true);
    expect(visible(root, 'shell')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    await unmount(root);
  });
});

describe('account scope', () => {
  it('sign-out clears the query cache (cancel, then clear)', async () => {
    const root = await renderApp();
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);
    await press(root, 'nav/settings');
    await press(root, 'settings/row/signout');
    await press(root, 'dialog/signout/confirm');
    expect(visible(root, 'auth/welcome')).toBe(true);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    await unmount(root);
  });
});

describe('refresh on resume (spec-feed-refresh-on-resume, AD-7)', () => {
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

  /** 30 synthetic posts; page 1 answered by `head` once set. */
  let head: ((req: FixtureRequest) => Reply) | null;
  function feedWithHead() {
    const pages = syntheticFeed({ total: 30 });
    head = null;
    return (req: FixtureRequest): Reply =>
      cursorOf(req.url) === null && head ? head(req) : pages(req);
  }
  /** A page-1 reply with these posts and the next cursor `cursor:<next>`. */
  const headPage = (posts: Record<string, unknown>[], next: number): FixtureReply => ({
    status: 200,
    body: { data: { posts, blogs: [], counters: {} }, extra: { offset: cursorFor(next), isLast: false } },
  });
  const newPost = (n: number) => feedPost(1000 + n, { id: `new-${n}`, title: `New ${n}` });

  /** Two pages loaded (20 posts), focus deep on post 13. */
  async function deepInTheFeed() {
    feed = feedWithHead();
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    await focusOn(root, 'home/feed/feed-post-13');
    expect(feedCalls()).toHaveLength(2);
    focusMock.mockClear();
    mockFlashList.scrollToIndex.mockClear();
    return root;
  }

  it('quick return (< 60 s since the feed loaded): no E5 request', async () => {
    const root = await deepInTheFeed();
    await backgroundFor(QUERY_STALE_TIME_MS - 5_000);
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(feedCalls()).toHaveLength(2);
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('stale return, 2 new posts: on top, loaded pages kept, the focused card keeps focus at its new row', async () => {
    const root = await deepInTheFeed();
    head = () => headPage([newPost(0), newPost(1), ...Array.from({ length: 8 }, (_, i) => feedPost(i))], 8);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    // One E5 request: page 1, no cursor.
    expect(feedCalls()).toHaveLength(3);
    expect(cursorOf(feedCalls()[2].url)).toBeNull();
    const ids = gridPosts(root).map(p => p.id);
    expect(ids.slice(0, 3)).toEqual(['new-0', 'new-1', 'feed-post-0']);
    // 22 posts, the trailing partial row held: 21 shown; both pages kept.
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
    expect(ids).toContain('feed-post-18');
    // The rows regrouped (post 13 moved from row 4 to row 5): it is
    // scrolled into view and focused again.
    expect(ids.indexOf('feed-post-13')).toBe(15);
    expect(mockFlashList.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 5, animated: false }),
    );
    expect(focusTargets()).toEqual(['home/feed/feed-post-13']);
    // The next page still continues from the last loaded page.
    await focusOn(root, 'home/feed/feed-post-18');
    expect(cursorOf(feedCalls()[feedCalls().length - 1].url)).toBe(20);
    await unmount(root);
  });

  it('stale return, nothing new: no visible change, focus unchanged', async () => {
    const root = await deepInTheFeed();
    const before = gridPosts(root).map(p => p.id);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(feedCalls()).toHaveLength(3);
    expect(gridPosts(root).map(p => p.id)).toEqual(before);
    expect(focusMock).not.toHaveBeenCalled();
    expect(mockFlashList.scrollToIndex).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('a gap (page 1 shares no post): the feed is page 1 alone; focus follows the fallback chain', async () => {
    const root = await deepInTheFeed();
    head = () => headPage(Array.from({ length: 10 }, (_, i) => newPost(i)), 10);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(feedCalls()).toHaveLength(3);
    const ids = gridPosts(root).map(p => p.id);
    // 10 posts, more pages: 9 shown.
    expect(ids).toEqual(Array.from({ length: 9 }, (_, i) => `new-${i}`));
    // Post 13 (index 13) is gone: its neighbor by index, the last shown card.
    expect(lastFocusTarget()).toBe('home/feed/new-8');
    await unmount(root);
  });

  it('the refresh fails: nothing changes; logged without content', async () => {
    const root = await deepInTheFeed();
    const before = gridPosts(root).map(p => p.id);
    logger.clear();
    head = () => ({ status: 400, body: { error: 'bad_request' } });
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(feedCalls()).toHaveLength(3);
    expect(gridPosts(root).map(p => p.id)).toEqual(before);
    expect(focusMock).not.toHaveBeenCalled();
    expect(logger.entries()).toContainEqual(
      expect.objectContaining({ scope: 'feed', message: 'resume refresh failed', fields: { kind: 'Client' } }),
    );
    await unmount(root);
  });

  it('the resume E1 fails: no E5 request', async () => {
    const root = await deepInTheFeed();
    transport = installFixtureTransport(req =>
      req.path === E1 ? { status: 400, body: { error: 'bad_request' } } : feed(req),
    );
    head = () => headPage([newPost(0), ...Array.from({ length: 9 }, (_, i) => feedPost(i))], 9);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(transport.callsTo(E1)).toHaveLength(1);
    expect(transport.callsTo(E5_PATH)).toHaveLength(0);
    expect(gridPosts(root)[0].id).toBe('feed-post-0');
    await unmount(root);
  });

  it('a 1-post prepend that adds no shown row sends no further E5 (only an append auto-fetches)', async () => {
    feed = feedWithHead();
    const root = await renderApp();
    // 10 posts, more pages: 9 shown, post 9 held.
    expect(gridPosts(root)).toHaveLength(9);
    head = () => headPage([newPost(0), ...Array.from({ length: 9 }, (_, i) => feedPost(i))], 9);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    // 11 posts: still 9 shown (2 held).
    expect(gridPosts(root)[0].id).toBe('new-0');
    expect(gridPosts(root)).toHaveLength(9);
    expect(feedCalls()).toHaveLength(2);
    await unmount(root);
  });

  it('a post inserted below an unchanged first post: the rows regroup, the focused card keeps focus', async () => {
    const root = await deepInTheFeed();
    head = () => headPage([feedPost(0), newPost(0), ...Array.from({ length: 8 }, (_, i) => feedPost(i + 1))], 9);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    const ids = gridPosts(root).map(p => p.id);
    expect(ids.slice(0, 3)).toEqual(['feed-post-0', 'new-0', 'feed-post-1']);
    expect(ids.indexOf('feed-post-13')).toBe(14);
    expect(mockFlashList.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 4, animated: false }),
    );
    expect(focusTargets()).toEqual(['home/feed/feed-post-13']);
    await unmount(root);
  });

  it('a 1-post prepend moves the focused last-row card into the held partial row: it stays shown and focused', async () => {
    // Page 1: posts 0–8 (a multiple of 3). Later pages only repeat them with
    // fresh cursors, so the auto-paging stops with more pages still "possible".
    head = null;
    feed = req => {
      const n = cursorOf(req.url);
      if (n === null && head) {
        return head(req);
      }
      const posts = Array.from({ length: 9 }, (_, i) => feedPost(i));
      return headPage(posts, n === null ? 9 : n + 1);
    };
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    await settle();
    expect(gridPosts(root)).toHaveLength(9);
    const calls = feedCalls().length;
    focusMock.mockClear();
    mockFlashList.scrollToIndex.mockClear();
    head = () => headPage([newPost(0), ...Array.from({ length: 9 }, (_, i) => feedPost(i))], 9);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(feedCalls()).toHaveLength(calls + 1);
    // 10 posts with more pages: post 8 is alone in the held row, but shown.
    const ids = gridPosts(root).map(p => p.id);
    expect(ids).toHaveLength(10);
    expect(ids[9]).toBe('feed-post-8');
    expect(mockFlashList.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 3, animated: false }),
    );
    expect(focusTargets()).toEqual(['home/feed/feed-post-8']);
    await unmount(root);
  });

  it('«Повторить» focused (a failed page append): the resume refresh is skipped; focus stays on it (Epic 3 retro A3)', async () => {
    const pages = syntheticFeed({ total: 30 });
    head = null;
    let failNext = true;
    feed = req => {
      const n = cursorOf(req.url);
      if (n === null && head) {
        return head(req);
      }
      return n !== null && failNext ? { status: 400, body: { error: 'bad_request' } } : pages(req);
    };
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    expect(visible(root, 'home/feed/retry')).toBe(true);
    await focusOn(root, 'home/feed/retry');
    failNext = false;
    focusMock.mockClear();
    mockFlashList.scrollToIndex.mockClear();
    const calls = feedCalls().length;
    head = () => headPage([newPost(0), newPost(1), ...Array.from({ length: 8 }, (_, i) => feedPost(i))], 8);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    // The feed query is in an error state: no E5 request; the retry row stays.
    expect(feedCalls()).toHaveLength(calls);
    expect(gridPosts(root)[0].id).toBe('feed-post-0');
    expect(visible(root, 'home/feed/retry')).toBe(true);
    expect(focusMock).not.toHaveBeenCalled();
    expect(mockFlashList.scrollToIndex).not.toHaveBeenCalled();
    // «Повторить» still works: the next page loads.
    await press(root, 'home/feed/retry');
    expect(visible(root, 'home/feed/retry')).toBe(false);
    expect(feedCalls()).toHaveLength(calls + 1);
    expect(cursorOf(feedCalls()[calls].url)).not.toBeNull();
    await unmount(root);
  });

  it('the resume E1 ends in expired (invalid_grant → A11): no E5 request', async () => {
    installNativeModules({ InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') } });
    const root = await deepInTheFeed();
    transport = installFixtureTransport(req =>
      req.path === E1
        ? { status: e1Unauthorized.status, body: e1Unauthorized.body }
        : req.path === '/oauth/token/'
          ? { status: refreshRejected.status, body: refreshRejected.body }
          : feed(req),
    );
    head = () => headPage([newPost(0), ...Array.from({ length: 9 }, (_, i) => feedPost(i))], 9);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    await settle(WITH_TIMERS);
    expect(transport.callsTo('/oauth/token/')).toHaveLength(1);
    expect(visible(root, 'auth/expired')).toBe(true);
    expect(transport.callsTo(E5_PATH)).toHaveLength(0);
    await unmount(root);
  });

  it.each([
    ['a network failure', (): FixtureReply => ({ network: true })],
    ['a 5xx', (): FixtureReply => ({ status: 503, body: { error: 'unavailable' } })],
  ])('the refresh E5 ends in %s (through the HttpClient retries): nothing changes', async (_name, reply) => {
    const root = await deepInTheFeed();
    const before = gridPosts(root).map(p => p.id);
    head = reply;
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    await settle(WITH_TIMERS);
    expect(feedCalls().length).toBeGreaterThan(3);
    expect(feedCalls().slice(2).every(c => cursorOf(c.url) === null)).toBe(true);
    expect(gridPosts(root).map(p => p.id)).toEqual(before);
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('focus on the sidebar: the data is merged, focus stays on nav/home', async () => {
    const root = await deepInTheFeed();
    await back(); // → nav/home
    await focusOn(root, 'nav/home'); // the native focus event of that move
    focusMock.mockClear();
    head = () => headPage([newPost(0), newPost(1), ...Array.from({ length: 8 }, (_, i) => feedPost(i))], 8);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(feedCalls()).toHaveLength(3);
    expect(gridPosts(root)[0].id).toBe('new-0');
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });
  // Epic 3 retro A3 (owner decision 2026-10-27): Главная follows a changed
  // head like Автор while the user has not moved since Главная took its
  // content focus by itself.
  describe('follow the head while the user has not moved (Epic 3 retro A3)', () => {
    const twoNew = () =>
      headPage([newPost(0), newPost(1), ...Array.from({ length: 8 }, (_, i) => feedPost(i))], 8);
    const scrolledToTop = () =>
      mockFlashList.scrollToOffset.mock.calls.some(
        ([params]) => (params as { offset: number }).offset === 0,
      );
    /** 30 posts, page 1 loaded; Главная focused the first card by itself. */
    async function untouched() {
      feed = feedWithHead();
      const root = await renderApp();
      expect(lastFocusTarget()).toBe('home/feed/feed-post-0');
      focusMock.mockClear();
      mockFlashList.scrollToOffset.mockClear();
      mockFlashList.scrollToIndex.mockClear();
      return root;
    }

    it('untouched, the reply before the auto-focus event: the new first post, at the top', async () => {
      const root = await untouched();
      head = twoNew;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(feedCalls()).toHaveLength(2);
      expect(gridPosts(root).slice(0, 3).map(p => p.id)).toEqual(['new-0', 'new-1', 'feed-post-0']);
      expect(focusTargets()).toEqual(['home/feed/new-0']);
      expect(scrolledToTop()).toBe(true);
      expect(mockFlashList.scrollToIndex).not.toHaveBeenCalled();
      // The native events of both automatic focus requests arrive late, in
      // order: neither is a move, so the next head change still follows.
      await focusOn(root, 'home/feed/feed-post-0');
      await focusOn(root, 'home/feed/new-0');
      focusMock.mockClear();
      head = () =>
        headPage([newPost(2), newPost(0), newPost(1), ...Array.from({ length: 7 }, (_, i) => feedPost(i))], 7);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts(root)[0].id).toBe('new-2');
      expect(focusTargets()).toEqual(['home/feed/new-2']);
      await unmount(root);
    });

    it('untouched, the reply after the auto-focus event: the same result', async () => {
      const root = await untouched();
      await focusOn(root, 'home/feed/feed-post-0');
      const reply = deferred();
      head = () => reply.promise;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(feedCalls()).toHaveLength(2);
      focusMock.mockClear();
      reply.resolve(twoNew());
      await settle();
      expect(gridPosts(root).slice(0, 3).map(p => p.id)).toEqual(['new-0', 'new-1', 'feed-post-0']);
      expect(focusTargets()).toEqual(['home/feed/new-0']);
      expect(scrolledToTop()).toBe(true);
      expect(mockFlashList.scrollToIndex).not.toHaveBeenCalled();
      await unmount(root);
    });

    it('untouched, focus event on nav/home during the skeleton, the reply before the card event: the new first post', async () => {
      feed = feedWithHead();
      const first = deferred();
      head = () => first.promise;
      const root = await renderApp();
      // The Shell's own nav/home focus reaches JS during the skeleton.
      await focusOn(root, 'nav/home');
      first.resolve(headPage(Array.from({ length: 10 }, (_, i) => feedPost(i)), 10));
      await settle();
      expect(lastFocusTarget()).toBe('home/feed/feed-post-0');
      head = twoNew;
      focusMock.mockClear();
      mockFlashList.scrollToOffset.mockClear();
      // The card's native event has not reached JS: the Shell still says nav/home.
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(focusTargets()).toEqual(['home/feed/new-0']);
      expect(scrolledToTop()).toBe(true);
      await unmount(root);
    });

    it('untouched after OK on «Главная» from Настройки (the remembered card restored): the new first post', async () => {
      feed = feedWithHead();
      const root = await renderApp();
      await focusOn(root, 'home/feed/feed-post-0');
      await focusOn(root, 'home/feed/feed-post-1');
      await focusOn(root, 'nav/home');
      await focusOn(root, 'nav/settings');
      await press(root, 'nav/settings');
      await focusOn(root, 'nav/home');
      focusMock.mockClear();
      await press(root, 'nav/home');
      // Главная took its content focus by itself: the remembered card.
      expect(lastFocusTarget()).toBe('home/feed/feed-post-1');
      await focusOn(root, 'home/feed/feed-post-1');
      focusMock.mockClear();
      mockFlashList.scrollToOffset.mockClear();
      head = twoNew;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(focusTargets()).toEqual(['home/feed/new-0']);
      expect(scrolledToTop()).toBe(true);
      await unmount(root);
    });

    it('armed on a restored card in row 1, posts inserted below the first post: that card is refocused at its new index', async () => {
      feed = feedWithHead();
      const root = await renderApp();
      await focusOn(root, 'home/feed/feed-post-0');
      await focusOn(root, 'home/feed/feed-post-4');
      await focusOn(root, 'nav/home');
      await focusOn(root, 'nav/settings');
      await press(root, 'nav/settings');
      await focusOn(root, 'nav/home');
      focusMock.mockClear();
      await press(root, 'nav/home');
      // Главная took its content focus by itself: the remembered card (row 1).
      expect(lastFocusTarget()).toBe('home/feed/feed-post-4');
      await focusOn(root, 'home/feed/feed-post-4');
      focusMock.mockClear();
      mockFlashList.scrollToOffset.mockClear();
      mockFlashList.scrollToIndex.mockClear();
      head = () =>
        headPage([feedPost(0), newPost(0), ...Array.from({ length: 8 }, (_, i) => feedPost(i + 1))], 9);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      const ids = gridPosts(root).map(p => p.id);
      expect(ids.slice(0, 3)).toEqual(['feed-post-0', 'new-0', 'feed-post-1']);
      expect(ids.indexOf('feed-post-4')).toBe(5);
      // The first card is unchanged: no head-follow; row 1 regrouped.
      expect(mockFlashList.scrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 1, animated: false }),
      );
      expect(focusTargets()).toEqual(['home/feed/feed-post-4']);
      expect(scrolledToTop()).toBe(false);
      await unmount(root);
    });

    it('full-error «Повторить» (focused by the page) → grid → resume: the new first post, at the top (late action event)', async () => {
      const pages = syntheticFeed({ total: 30 });
      let failing = true;
      head = null;
      feed = req => {
        if (failing) {
          return { status: 400, body: { error: 'bad_request' } };
        }
        return cursorOf(req.url) === null && head ? head(req) : pages(req);
      };
      const root = await renderApp();
      expect(visible(root, 'home/feed/error')).toBe(true);
      // Opened with OK from Настройки: the page focuses «Повторить» itself.
      await focusOn(root, 'nav/settings');
      await press(root, 'nav/settings');
      await focusOn(root, 'nav/home');
      focusMock.mockClear();
      await press(root, 'nav/home');
      expect(visible(root, 'home/feed/error')).toBe(true);
      expect(lastFocusTarget()).toBe('state/home/action');
      failing = false;
      const page1 = deferred();
      head = () => page1.promise;
      // OK reaches the action before its native focus event.
      await press(root, 'state/home/action', { focus: false });
      // The action's native focus event arrives late (while it still shows,
      // busy): not a move. (Once unmounted, FocusZone drops its events.)
      await focusOn(root, 'state/home/action');
      head = null;
      page1.resolve(headPage(Array.from({ length: 10 }, (_, i) => feedPost(i)), 10));
      await settle();
      expect(lastFocusTarget()).toBe('home/feed/feed-post-0');
      focusMock.mockClear();
      mockFlashList.scrollToOffset.mockClear();
      head = twoNew;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts(root)[0].id).toBe('new-0');
      expect(focusTargets()).toEqual(['home/feed/new-0']);
      expect(scrolledToTop()).toBe(true);
      await unmount(root);
    });

    it('a move to a deeper row (row 2): that card keeps focus at its new index', async () => {
      const root = await untouched();
      await focusOn(root, 'home/feed/feed-post-0');
      await focusOn(root, 'home/feed/feed-post-4');
      await focusOn(root, 'home/feed/feed-post-7');
      focusMock.mockClear();
      head = twoNew;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts(root).map(p => p.id).indexOf('feed-post-7')).toBe(9);
      expect(mockFlashList.scrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 3, animated: false }),
      );
      expect(focusTargets()).toEqual(['home/feed/feed-post-7']);
      expect(scrolledToTop()).toBe(false);
      await unmount(root);
    });

    it('a move to another sidebar item (nav/subs): nothing moves', async () => {
      const root = await untouched();
      await focusOn(root, 'home/feed/feed-post-0');
      await focusOn(root, 'nav/home');
      await focusOn(root, 'nav/subs');
      focusMock.mockClear();
      head = twoNew;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts(root)[0].id).toBe('new-0');
      expect(focusTargets()).toEqual([]);
      expect(scrolledToTop()).toBe(false);
      await unmount(root);
    });

    it.each([
      ['a D-pad move to card 1', async (root: Root) => focusOn(root, 'home/feed/feed-post-1'), 'feed-post-1', 3],
      [
        '→ then ← back to the first card',
        async (root: Root) => {
          await focusOn(root, 'home/feed/feed-post-1');
          await focusOn(root, 'home/feed/feed-post-0');
        },
        'feed-post-0',
        2,
      ],
    ])('the user moved (%s): the focused card keeps focus at its new row', async (_name, move, target, index) => {
      const root = await untouched();
      await focusOn(root, 'home/feed/feed-post-0');
      await move(root);
      focusMock.mockClear();
      head = twoNew;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts(root).map(p => p.id).indexOf(target)).toBe(index);
      expect(focusTargets()).toEqual([`home/feed/${target}`]);
      // The grid scrolls by row (3 cards each).
      expect(mockFlashList.scrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: Math.floor(index / 3), animated: false }),
      );
      expect(scrolledToTop()).toBe(false);
      await unmount(root);
    });

    it('the user went back to the sidebar (nav/home): nothing moves', async () => {
      const root = await untouched();
      await focusOn(root, 'home/feed/feed-post-0');
      await focusOn(root, 'nav/home');
      focusMock.mockClear();
      head = twoNew;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts(root)[0].id).toBe('new-0');
      expect(focusTargets()).toEqual([]);
      expect(scrolledToTop()).toBe(false);
      await unmount(root);
    });

    it('OK on a card is a move: Пост, Back, then a resume → that card keeps focus at index 2 (not the new first post)', async () => {
      const root = await untouched();
      await press(root, 'home/feed/feed-post-0');
      expect(visible(root, 'post')).toBe(true);
      await back();
      expect(lastFocusTarget()).toBe('home/feed/feed-post-0');
      focusMock.mockClear();
      mockFlashList.scrollToOffset.mockClear();
      mockFlashList.scrollToIndex.mockClear();
      head = twoNew;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts(root).map(p => p.id).indexOf('feed-post-0')).toBe(2);
      expect(focusTargets()).toEqual(['home/feed/feed-post-0']);
      expect(scrolledToTop()).toBe(false);
      await unmount(root);
    });

    it('mounted with cached cards (no self focus, focus on nav/home): a head change takes no focus', async () => {
      feed = feedWithHead();
      const root = await renderApp();
      await focusOn(root, 'home/feed/feed-post-0');
      await focusOn(root, 'nav/home');
      await focusOn(root, 'nav/settings');
      await press(root, 'nav/settings');
      await back(); // Back from Настройки → Главная, focus on nav/home
      await focusOn(root, 'nav/home');
      expect(gridPosts(root)).toHaveLength(9);
      focusMock.mockClear();
      mockFlashList.scrollToOffset.mockClear();
      head = twoNew;
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(gridPosts(root)[0].id).toBe('new-0');
      expect(focusTargets()).toEqual([]);
      expect(scrolledToTop()).toBe(false);
      await unmount(root);
    });
  });

  it('an empty page 1 with a next cursor: the cached feed stays (counted fresh); focus kept (Epic 3 retro A3)', async () => {
    const root = await deepInTheFeed();
    const before = gridPosts(root).map(p => p.id);
    head = () => headPage([], 10);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(feedCalls()).toHaveLength(3);
    expect(gridPosts(root).map(p => p.id)).toEqual(before);
    expect(focusMock).not.toHaveBeenCalled();
    expect(mockFlashList.scrollToIndex).not.toHaveBeenCalled();
    // Written back as fresh: a resume within staleTime sends nothing.
    await backgroundFor(QUERY_STALE_TIME_MS - 5_000);
    expect(feedCalls()).toHaveLength(3);
    await unmount(root);
  });

  it('an empty last page 1 (no next cursor): the cache is replaced; the empty state shows (Epic 3 retro A3)', async () => {
    const root = await deepInTheFeed();
    head = () => ({
      status: 200,
      body: { data: { posts: [], blogs: [], counters: {} }, extra: { offset: '', isLast: true } },
    });
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(feedCalls()).toHaveLength(3);
    expect(visible(root, 'home/feed/empty')).toBe(true);
    expect(visible(root, 'home/feed/list')).toBe(false);
    await unmount(root);
  });
});
