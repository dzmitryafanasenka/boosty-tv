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
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { AppState, FlatList, StyleSheet } from 'react-native';
import App, { navigationRef } from '../src/app/App';
import { HomeScreen, type HomeFocusInfo } from '../src/features/home';
import type { HttpClient } from '../src/shared/api';
import { QUERY_STALE_TIME_MS, queryClient, resetQueryCache } from '../src/app/queryClient';
import { DEFAULT_FILTER, filtersStore, getFilter } from '../src/shared/filters';
import { queryKeys } from '../src/shared/api';
import {
  type FixtureReply,
  type FixtureRequest,
  type FixtureTransport,
} from '../src/shared/api/fixtureTransport';
import { ModalHostProvider, focusRestoration } from '../src/shared/focus';
import { logger } from '../src/shared/services/logger';
import { progressStore } from '../src/shared/services/progress';
import { engine } from '../src/test/playerEngineMock';
import { e8Locked, e8MissingReply, paragraph, postDetail } from '../src/test/postFixtures';
import { t, tf, tp } from '../src/shared/i18n';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import type { Root } from 'test-renderer';
import backHandler from '../src/test/backHandlerMock';
import { tvEvents } from '../src/test/tvEventMock';
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
import { E2_PATH, e2Body } from '../src/test/subscriptionFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import e1Unauthorized from '../src/test/fixtures/boosty/e1-no-token.json';
import refreshRejected from '../src/test/fixtures/boosty/refresh-invalid-grant.json';
import refreshOk from '../src/test/fixtures/boosty/refresh-ok.json';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  deferred,
  destinationIds,
  focusableIds,
  focusTargets,
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
// Story 4.7: a Continue card opens the Player (its engine and raw keys mocked).
jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () =>
  require('../src/test/tvEventMock'),
);
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));

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

/** The real FlashList behind the recorder `lists` (`src/test/flow`; `onEndReached` held back). */
jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());

const focusMock = requestHostFocus as jest.Mock;

/**
 * 30 rounds, no timers by default: a pending timer run would also fire the
 * 30 s request timeouts and move the fake clock past `staleTime`. Rows that
 * need the AD-6 backoff pass `WITH_TIMERS`. TanStack's notifications are
 * moved from a 0 ms timer to a microtask (below), so no timer is needed.
 */
const { settle, render, one, focusOn, press, back, advance } = createFlow({
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
/** Story 4.7: other endpoints (E8, E9) a test answers; undefined: none. */
let other: (req: FixtureRequest) => Reply;
let transport: FixtureTransport;

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
  resetRecorders();
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.0' } });
  feed = () => ({ status: 200, body: e5Page() });
  other = () => undefined;
  engine.reset();
  transport = installFixtureTransport(req => {
    if (req.path === E1) {
      return { status: 200, body: e1Ok.body };
    }
    if (req.path === E5_PATH) {
      return feed(req);
    }
    return other(req);
  });
});

afterEach(async () => {
  // Story 4.7: no local progress leaks between tests.
  await progressStore.reset();
  // Story 5.3: nor a Filter.
  filtersStore.getState().clear();
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);
const feedCalls = () => transport.callsTo(E5_PATH);
const cardIds = (root: Parameters<typeof visible>[0]) =>
  focusableIds(root).filter(id => id.startsWith('home/feed/') && id !== 'home/feed/retry');
/** The feed grid's FlashList props (last render). */
function grid(_root?: unknown): { props: Record<string, any> } {
  const props = lists.props.get('home/feed/list');
  if (!props) {
    throw new Error('no feed grid rendered');
  }
  return { props };
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
    // One E5 request, with the content profile, comments off and the
    // default «Доступные мне» access params (Story 5.3).
    expect(feedCalls()).toHaveLength(1);
    expect(feedCalls()[0].url).toBe(
      'https://api.boosty.to/v1/feed/post/?limit=10&comments_limit=0&reply_limit=0&only_allowed=true&only_bought=false',
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
    // Story 5.3: the «Фильтры» chip above the empty view (an empty
    // «Доступные мне» feed may have posts under «Все посты»).
    expect(focusableIds(root, content)).toEqual(['home/filters', 'state/home/action']);
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

describe('page 1 all locked checks the session first (Epic 3 retro A6)', () => {
  const TOKEN = '/oauth/token/';
  const REFRESHED = `Bearer ${refreshOk.body.access_token}`;
  const locked = (n: number) => ({ ...lockedPost(), id: `locked-${n}` });
  /** The token died after the cold-start E1: E1 401 (or `e1Reply`). */
  let dead: boolean;
  let e1Reply: () => FixtureReply | Promise<FixtureReply>;
  let firstPage: { promise: Promise<FixtureReply>; resolve: (reply: FixtureReply) => void };
  /** Page 1 for the refreshed token (default: the live page). */
  let refreshedPage: () => unknown;

  function install(refresh: FixtureReply) {
    dead = false;
    e1Reply = () => ({ status: e1Unauthorized.status, body: e1Unauthorized.body });
    firstPage = deferred();
    refreshedPage = () => e5Page();
    installNativeModules({
      InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') },
    });
    transport = installFixtureTransport(req => {
      const refreshed = req.headers.Authorization === REFRESHED;
      if (req.path === TOKEN) {
        return refresh;
      }
      if (req.path === E1) {
        return dead && !refreshed ? e1Reply() : { status: 200, body: e1Ok.body };
      }
      if (req.path === E5_PATH) {
        // Page 1 is held until the test releases it (after the cold-start E1).
        return refreshed ? { status: 200, body: refreshedPage() } : firstPage.promise;
      }
      return undefined;
    });
  }

  /** Cold start (E1 200); then the token dies and page 1 arrives with `posts`. */
  async function loadDead(posts: unknown[]) {
    const root = await renderApp();
    expect(transport.callsTo(E1)).toHaveLength(1);
    dead = true;
    firstPage.resolve({ status: 200, body: { data: { posts }, extra: { isLast: true } } });
    await settle();
    return root;
  }

  it('dead session (E1 401 → refresh invalid_grant): A11, the locked feed gone', async () => {
    install({ status: refreshRejected.status, body: refreshRejected.body });
    const root = await loadDead([locked(0), locked(1)]);
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(transport.callsTo(TOKEN)).toHaveLength(1);
    expect(feedCalls()).toHaveLength(1);
    // The reset's transition (timers) unmounts the Shell.
    await settle(WITH_TIMERS);
    expect(navigationRef.getRootState()?.routes.map(r => r.name)).toEqual(['Expired']);
    expect(visible(root, 'shell')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    await unmount(root);
  });

  it('silent refresh (E1 401 → refresh ok → 200): one feed refetch with the new token; the cards are open', async () => {
    install({ status: refreshOk.status, body: refreshOk.body });
    const root = await loadDead([locked(0), locked(1)]);
    expect(transport.callsTo(TOKEN)).toHaveLength(1);
    expect(feedCalls()).toHaveLength(2);
    expect(feedCalls()[1].headers.Authorization).toBe(REFRESHED);
    expect(cardIds(root)).toHaveLength(10);
    expect(visible(root, 'home/feed/locked-0')).toBe(false);
    expect(visible(root, `home/feed/${e5Posts()[0].id}/lock`)).toBe(false);
    expect(visible(root, 'auth/expired')).toBe(false);
    await unmount(root);
  });

  it('truly locked (E1 200): one refetch, the locked cards stay; no loop', async () => {
    install({ status: refreshOk.status, body: refreshOk.body });
    e1Reply = () => ({ status: 200, body: e1Ok.body });
    const root = await loadDead([locked(0), locked(1)]);
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(transport.callsTo(TOKEN)).toHaveLength(0);
    expect(feedCalls()).toHaveLength(2);
    expect(visible(root, 'home/feed/locked-0/lock')).toBe(true);
    expect(visible(root, 'home/feed/locked-1/lock')).toBe(true);
    await settle();
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(feedCalls()).toHaveLength(2);
    await unmount(root);
  });

  it('silent refresh: focus stays on the same card id across the feed refetch', async () => {
    install({ status: refreshOk.status, body: refreshOk.body });
    // The same posts: locked for the dead token, open for the refreshed one.
    const ids = [0, 1, 2, 3, 4, 5];
    refreshedPage = () => ({ data: { posts: ids.map(n => feedPost(n)) }, extra: { isLast: true } });
    const e1 = deferred();
    e1Reply = () => e1.promise;
    const root = await loadDead(ids.map(n => feedPost(n, { hasAccess: false, data: [] })));
    expect(visible(root, 'home/feed/feed-post-4/lock')).toBe(true);
    await focusOn(root, 'home/feed/feed-post-4');
    focusMock.mockClear();
    e1.resolve({ status: e1Unauthorized.status, body: e1Unauthorized.body });
    await settle();
    expect(transport.callsTo(TOKEN)).toHaveLength(1);
    expect(feedCalls()).toHaveLength(2);
    expect(visible(root, 'home/feed/feed-post-4')).toBe(true);
    expect(visible(root, 'home/feed/feed-post-4/lock')).toBe(false);
    // No focus request: native focus stays on the same card (same id, same view).
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it.each([
    ['E1 200: one feed refetch, the cards stay locked', 200],
    ['E1 401 → refresh invalid_grant: A11', 401],
  ])('page 1 all locked while the cold-start E1 runs: one E1 shared — %s', async (_name, status) => {
    install({ status: refreshRejected.status, body: refreshRejected.body });
    const e1 = deferred();
    e1Reply = () => e1.promise;
    // Dead from the start: the cold-start E1 is the held one.
    dead = true;
    firstPage.resolve({ status: 200, body: { data: { posts: [locked(0), locked(1)] }, extra: { isLast: true } } });
    const root = await renderApp();
    expect(transport.callsTo(E1)).toHaveLength(1);
    expect(feedCalls()).toHaveLength(1);
    e1.resolve(
      status === 200
        ? { status: 200, body: e1Ok.body }
        : { status: e1Unauthorized.status, body: e1Unauthorized.body },
    );
    await settle();
    expect(transport.callsTo(E1)).toHaveLength(1);
    if (status === 200) {
      expect(feedCalls()).toHaveLength(2);
      expect(visible(root, 'home/feed/locked-0/lock')).toBe(true);
      expect(visible(root, 'auth/expired')).toBe(false);
    } else {
      expect(transport.callsTo(TOKEN)).toHaveLength(1);
      expect(feedCalls()).toHaveLength(1);
      await settle(WITH_TIMERS);
      expect(navigationRef.getRootState()?.routes.map(r => r.name)).toEqual(['Expired']);
    }
    await unmount(root);
  });

  it('page 1 accessible with a next cursor, page 2 all locked: no E1, exactly 2 feed calls', async () => {
    feed = req =>
      cursorOf(req.url) === null
        ? {
            status: 200,
            body: {
              data: { posts: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => feedPost(n)) },
              extra: { offset: cursorFor(9), isLast: false },
            },
          }
        : { status: 200, body: { data: { posts: [locked(0), locked(1), locked(2)] }, extra: { isLast: true } } };
    const root = await renderApp();
    expect(feedCalls()).toHaveLength(1);
    await focusOn(root, 'home/feed/feed-post-8');
    await settle();
    expect(feedCalls()).toHaveLength(2);
    expect(visible(root, 'home/feed/locked-2/lock')).toBe(true);
    expect(transport.callsTo(E1)).toHaveLength(1);
    await unmount(root);
  });

  it('page 1 partly locked (one accessible post): no E1, no refetch', async () => {
    install({ status: refreshRejected.status, body: refreshRejected.body });
    const root = await loadDead([locked(0), feedPost(1)]);
    expect(transport.callsTo(E1)).toHaveLength(1);
    expect(transport.callsTo(TOKEN)).toHaveLength(0);
    expect(feedCalls()).toHaveLength(1);
    expect(visible(root, 'home/feed/locked-0/lock')).toBe(true);
    expect(visible(root, 'auth/expired')).toBe(false);
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
    const scrolled = lists.scrollToOffset;
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
    expect(queryClient.getQueryData(queryKeys.subscriptionFeed(DEFAULT_FILTER))).toBeUndefined();
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
    lists.scrollToIndex.mockClear();
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
    expect(lists.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 5, animated: false }),
    );
    expect(focusTargets()).toEqual(['home/feed/feed-post-13']);
    // The next page still continues from the last loaded page.
    await focusOn(root, 'home/feed/feed-post-18');
    expect(cursorOf(feedCalls()[feedCalls().length - 1].url)).toBe(20);
    await unmount(root);
  });

  it('Epic 3 retro V1: stale resume while Пост covers Главная: the covered feed is merged but takes no focus; Back → the same card at its new index', async () => {
    const root = await deepInTheFeed();
    const e8Re = /^\/v1\/blog\/([^/]+)\/post\/([^/]+)$/;
    other = req => {
      const single = e8Re.exec(req.path);
      return single
        ? { status: 200, body: postDetail(decodeURIComponent(single[1]), decodeURIComponent(single[2]), paragraph('Text')) }
        : undefined;
    };
    await press(root, 'home/feed/feed-post-13');
    expect(navigationRef.getCurrentRoute()?.name).toBe('Post');
    const e8Calls = () => transport.calls.filter(c => e8Re.test(c.path));
    expect(e8Calls()).toHaveLength(1);
    focusMock.mockClear();
    lists.scrollToIndex.mockClear();
    head = () => headPage([newPost(0), newPost(1), ...Array.from({ length: 8 }, (_, i) => feedPost(i))], 8);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    // One E5 page 1 for the covered feed; the Пост is not fetched again.
    expect(feedCalls()).toHaveLength(3);
    expect(cursorOf(feedCalls()[2].url)).toBeNull();
    expect(e8Calls()).toHaveLength(1);
    const ids = gridPosts(root).map(p => p.id);
    expect(ids.slice(0, 3)).toEqual(['new-0', 'new-1', 'feed-post-0']);
    expect(ids.indexOf('feed-post-13')).toBe(15);
    // Covered: Главная neither focuses nor scrolls; Пост keeps the route.
    expect(navigationRef.getCurrentRoute()?.name).toBe('Post');
    expect(focusTargets().filter(id => id?.startsWith('home/'))).toEqual([]);
    expect(lists.scrollToIndex).not.toHaveBeenCalled();
    focusMock.mockClear();
    await back();
    expect(navigationRef.getCurrentRoute()?.name).toBe('Shell');
    // Back: the same card by id, scrolled to its new row 5 (index 15).
    expect(lastFocusTarget()).toBe('home/feed/feed-post-13');
    expect(lists.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 5, animated: false }));
    expect(e8Calls()).toHaveLength(1);
    expect(feedCalls()).toHaveLength(3);
    await unmount(root);
  });

  it('stale return, nothing new: no visible change, focus unchanged', async () => {
    const root = await deepInTheFeed();
    const before = gridPosts(root).map(p => p.id);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(feedCalls()).toHaveLength(3);
    expect(gridPosts(root).map(p => p.id)).toEqual(before);
    expect(focusMock).not.toHaveBeenCalled();
    expect(lists.scrollToIndex).not.toHaveBeenCalled();
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
    expect(lists.scrollToIndex).toHaveBeenCalledWith(
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
    lists.scrollToIndex.mockClear();
    head = () => headPage([newPost(0), ...Array.from({ length: 9 }, (_, i) => feedPost(i))], 9);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    expect(feedCalls()).toHaveLength(calls + 1);
    // 10 posts with more pages: post 8 is alone in the held row, but shown.
    const ids = gridPosts(root).map(p => p.id);
    expect(ids).toHaveLength(10);
    expect(ids[9]).toBe('feed-post-8');
    expect(lists.scrollToIndex).toHaveBeenCalledWith(
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
    lists.scrollToIndex.mockClear();
    const calls = feedCalls().length;
    head = () => headPage([newPost(0), newPost(1), ...Array.from({ length: 8 }, (_, i) => feedPost(i))], 8);
    await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
    // The feed query is in an error state: no E5 request; the retry row stays.
    expect(feedCalls()).toHaveLength(calls);
    expect(gridPosts(root)[0].id).toBe('feed-post-0');
    expect(visible(root, 'home/feed/retry')).toBe(true);
    expect(focusMock).not.toHaveBeenCalled();
    expect(lists.scrollToIndex).not.toHaveBeenCalled();
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
      lists.scrollToOffset.mock.calls.some(
        ([params]) => (params as { offset: number }).offset === 0,
      );
    /** 30 posts, page 1 loaded; Главная focused the first card by itself. */
    async function untouched() {
      feed = feedWithHead();
      const root = await renderApp();
      expect(lastFocusTarget()).toBe('home/feed/feed-post-0');
      focusMock.mockClear();
      lists.scrollToOffset.mockClear();
      lists.scrollToIndex.mockClear();
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
      expect(lists.scrollToIndex).not.toHaveBeenCalled();
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
      expect(lists.scrollToIndex).not.toHaveBeenCalled();
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
      lists.scrollToOffset.mockClear();
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
      lists.scrollToOffset.mockClear();
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
      lists.scrollToOffset.mockClear();
      lists.scrollToIndex.mockClear();
      head = () =>
        headPage([feedPost(0), newPost(0), ...Array.from({ length: 8 }, (_, i) => feedPost(i + 1))], 9);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      const ids = gridPosts(root).map(p => p.id);
      expect(ids.slice(0, 3)).toEqual(['feed-post-0', 'new-0', 'feed-post-1']);
      expect(ids.indexOf('feed-post-4')).toBe(5);
      // The first card is unchanged: no head-follow; row 1 regrouped.
      expect(lists.scrollToIndex).toHaveBeenCalledWith(
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
      lists.scrollToOffset.mockClear();
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
      expect(lists.scrollToIndex).toHaveBeenCalledWith(
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
      expect(lists.scrollToIndex).toHaveBeenCalledWith(
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
      lists.scrollToOffset.mockClear();
      lists.scrollToIndex.mockClear();
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
      lists.scrollToOffset.mockClear();
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
    expect(lists.scrollToIndex).not.toHaveBeenCalled();
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

describe('Story 5.1: «Обновить» in the feed title row', () => {
  const REFRESH = 'home/refresh';
  /** 30 synthetic posts; page 1 answered by `head` once set. */
  let head: ((req: FixtureRequest) => Reply) | null;
  function feedWithHead() {
    const pages = syntheticFeed({ total: 30 });
    head = null;
    return (req: FixtureRequest): Reply =>
      cursorOf(req.url) === null && head ? head(req) : pages(req);
  }
  const headPage = (posts: Record<string, unknown>[], next: number): FixtureReply => ({
    status: 200,
    body: { data: { posts, blogs: [], counters: {} }, extra: { offset: cursorFor(next), isLast: false } },
  });
  const newPost = (n: number) => feedPost(1000 + n, { id: `new-${n}`, title: `New ${n}` });
  const e2Calls = () => transport.callsTo(E2_PATH);
  const button = (root: Root) => one(root, REFRESH);

  beforeEach(() => {
    other = req => (req.path === E2_PATH ? { status: 200, body: e2Body() } : undefined);
  });

  /** The feed loaded, Подписки visited once (E2 cached), back on Главная on card `n`, then on «Обновить». */
  async function onTheButton(n = 1) {
    feed = feedWithHead();
    const root = await renderApp();
    await press(root, 'nav/subs');
    expect(e2Calls()).toHaveLength(1);
    await press(root, 'nav/home');
    await focusOn(root, `home/feed/feed-post-${n}`);
    await focusOn(root, REFRESH);
    focusMock.mockClear();
    lists.scrollToIndex.mockClear();
    return root;
  }

  it('the title row: «Новое в подписках» + «Обновить» (secondary small, a11y «Обновить ленту»); ↑ from the feed guides to it', async () => {
    const root = await renderApp();
    expect(text(root)).toContain(t('home.feed.title'));
    expect(button(root).props.accessibilityLabel).toBe(t('home.refreshA11y'));
    expect(text(button(root))).toContain(t('home.refresh'));
    // Story 5.3: no title-row control focused yet → the row guides to the
    // «Фильтры» chip (the first control); after «Обновить» had focus, to it.
    expect(destinationIds('home/title-row')).toEqual(['home/filters']);
    // Not on the button: the ↓ band is no guide (↑ from a card is not caught by it).
    expect(destinationIds('home/refresh/down-guide')).toEqual([]);
    await unmount(root);
  });

  it('press: one E5 page 1 + one E2; «Обновляем…» while it runs; new posts on top, pages kept; focus stays on the button; ↓ → the remembered card', async () => {
    const root = await onTheButton(4);
    // A second page loaded (focus in the last row), then back up to card 4.
    await focusOn(root, 'home/feed/feed-post-8');
    await focusOn(root, 'home/feed/feed-post-13');
    await focusOn(root, 'home/feed/feed-post-4');
    await focusOn(root, REFRESH);
    const calls = feedCalls().length;
    expect(calls).toBe(2);
    const reply = deferred();
    head = () => reply.promise;
    await press(root, REFRESH);
    expect(feedCalls()).toHaveLength(calls + 1);
    expect(cursorOf(feedCalls()[calls].url)).toBeNull();
    expect(button(root).props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    // The visible label «Обновляем…»; TalkBack hears «Обновляем ленту…».
    expect(button(root).props.accessibilityLabel).toBe(t('home.refreshingA11y'));
    expect(text(byTestId(root, `${REFRESH}/busy-label`)[0])).toContain(t('home.refreshing'));
    expect(visible(root, `${REFRESH}/busy-label`)).toBe(true);
    // OK again while it runs: nothing.
    await press(root, REFRESH);
    expect(feedCalls()).toHaveLength(calls + 1);

    reply.resolve(headPage([newPost(0), newPost(1), ...Array.from({ length: 8 }, (_, i) => feedPost(i))], 8));
    await settle();
    expect(feedCalls()).toHaveLength(calls + 1);
    expect(e2Calls()).toHaveLength(2);
    const ids = gridPosts(root).map(p => p.id);
    expect(ids.slice(0, 3)).toEqual(['new-0', 'new-1', 'feed-post-0']);
    expect(ids).toContain('feed-post-18');
    expect(button(root).props.accessibilityState).toEqual(expect.objectContaining({ busy: false }));
    expect(button(root).props.accessibilityLabel).toBe(t('home.refreshA11y'));
    expect(visible(root, `${REFRESH}/error`)).toBe(false);
    // Focus stays on the button: the page requests no focus and no scroll.
    expect(focusMock).not.toHaveBeenCalled();
    expect(lists.scrollToIndex).not.toHaveBeenCalled();
    // ↓ from the button: the remembered card (by id, now at index 6).
    expect(destinationIds('home/refresh/down-guide')).toEqual(['home/feed/feed-post-4']);
    expect(text(root)).not.toContain(t('home.feed.errorTitle'));
    await unmount(root);
  });

  it('a gap (page 1 shares no post): the feed is page 1 alone; focus stays on the button; ↓ → the neighbour by index', async () => {
    const root = await onTheButton(4);
    head = () => headPage(Array.from({ length: 10 }, (_, i) => newPost(i)), 10);
    await press(root, REFRESH);
    expect(gridPosts(root).map(p => p.id)).toEqual(Array.from({ length: 9 }, (_, i) => `new-${i}`));
    expect(focusMock).not.toHaveBeenCalled();
    expect(destinationIds('home/refresh/down-guide')).toEqual(['home/feed/new-4']);
    await unmount(root);
  });

  it('nothing remembered: ↓ from the button → the first card', async () => {
    feed = feedWithHead();
    const root = await renderApp();
    // The page focused the first card itself; the user goes ↑ to the button.
    await focusOn(root, REFRESH);
    expect(destinationIds('home/refresh/down-guide')).toEqual(['home/feed/feed-post-0']);
    await unmount(root);
  });

  it('a failure keeps every card and shows the inline error (never the full-screen error); the next press tries again', async () => {
    const root = await onTheButton();
    const before = gridPosts(root).map(p => p.id);
    logger.clear();
    head = () => ({ status: 500, body: {} });
    await press(root, REFRESH, { settle: WITH_TIMERS });
    expect(gridPosts(root).map(p => p.id)).toEqual(before);
    expect(visible(root, `${REFRESH}/error`)).toBe(true);
    expect(text(root)).toContain(t('home.refreshFailed'));
    expect(text(root)).not.toContain(t('home.feed.errorTitle'));
    expect(button(root).props.accessibilityState).toEqual(expect.objectContaining({ busy: false }));
    expect(focusMock).not.toHaveBeenCalled();
    expect(logger.entries()).toContainEqual(
      expect.objectContaining({ scope: 'feed', message: 'manual refresh failed', fields: { kind: 'Server' } }),
    );
    // The next press: one more request; success clears the error.
    const calls = feedCalls().length;
    head = () => headPage([newPost(0), ...Array.from({ length: 9 }, (_, i) => feedPost(i))], 9);
    await press(root, REFRESH);
    expect(feedCalls()).toHaveLength(calls + 1);
    expect(visible(root, `${REFRESH}/error`)).toBe(false);
    expect(gridPosts(root)[0].id).toBe('new-0');
    await unmount(root);
  });

  it('the inline error clears when the feed data changes (e.g. a later resume refresh)', async () => {
    const root = await onTheButton();
    head = () => ({ status: 500, body: {} });
    await press(root, REFRESH, { settle: WITH_TIMERS });
    expect(visible(root, `${REFRESH}/error`)).toBe(true);
    jest.setSystemTime(Date.now() + 1_000);
    await act(async () => {
      queryClient.setQueryData(queryKeys.subscriptionFeed(DEFAULT_FILTER), (data: any) => ({
        ...data,
        pages: [{ ...data.pages[0], posts: [...data.pages[0].posts] }, ...data.pages.slice(1)],
      }));
    });
    await settle();
    expect(visible(root, `${REFRESH}/error`)).toBe(false);
    await unmount(root);
  });

  it('without the Continue row: ↑ from the first feed row → «Обновить» (the row guide); ↓ back → the remembered card', async () => {
    const root = await onTheButton(2);
    expect(visible(root, 'home/continue')).toBe(false);
    await focusOn(root, 'home/feed/feed-post-1');
    // ↑ from the first row: the title row (above the grid) guides to the
    // button, the row's last focused control (Story 5.3: else the chip).
    expect(destinationIds('home/title-row')).toEqual([REFRESH]);
    expect(focusableIds(root, byTestId(root, 'home/title-row')[0])).toEqual(['home/filters', REFRESH]);
    await focusOn(root, REFRESH);
    expect(destinationIds('home/refresh/down-guide')).toEqual(['home/feed/feed-post-1']);
    await unmount(root);
  });

  it('grid → offline while «Обновить» has focus: the offline «Повторить» takes focus', async () => {
    // The feed cached by a first run, then Главная alone with a fake Shell.
    const app = await renderApp();
    await unmount(app);
    let current: string | null = REFRESH;
    const info: HomeFocusInfo = {
      isActive: () => true,
      current: () => current,
      sectionItemId: 'nav/home',
      focusSidebar: () => {},
      onFocusChange: () => () => {},
    };
    const screen = (offline?: { retrying: boolean; onRetry: () => void }) => (
      <QueryClientProvider client={queryClient}>
        <ModalHostProvider>
          <HomeScreen http={{} as HttpClient} routeKey="shell" focus={info} offline={offline} />
        </ModalHostProvider>
      </QueryClientProvider>
    );
    const root = await render(screen());
    expect(byTestId(root, REFRESH).length).toBeGreaterThan(0);
    current = REFRESH;
    focusMock.mockClear();
    await act(async () => {
      root.render(screen({ retrying: false, onRetry: () => {} }));
    });
    await settle();
    expect(lastFocusTarget()).toBe('home/offline/retry');
    await unmount(root);
  });

  it('Back from the button → nav/home (a content zone item); the sidebar is not taken by the refresh', async () => {
    const root = await onTheButton();
    await back();
    expect(lastFocusTarget()).toBe('nav/home');
    await unmount(root);
  });

  it('an empty last page 1 while the button has focus: the empty StateView takes focus', async () => {
    const root = await onTheButton();
    head = () => ({
      status: 200,
      body: { data: { posts: [], blogs: [], counters: {} }, extra: { offset: cursorFor(0), isLast: true } },
    });
    await press(root, REFRESH);
    expect(visible(root, 'home/feed/empty')).toBe(true);
    expect(byTestId(root, REFRESH)).toHaveLength(0);
    expect(lastFocusTarget()).toBe('state/home/action');
    await unmount(root);
  });
});

describe('Story 4.7: «Продолжить просмотр» on Главная', () => {
  const PREFIX = 'home/continue/';
  const BLOG = 'synthetic-blog-1';
  const cwRef = (n: number) => ({ blogUrl: BLOG, postId: `cw-post-${n}`, mediaId: `cw-v${n}` });
  const card = (n: number) => `${PREFIX}cw-v${n}`;
  const SURFACE = 'player/surface';
  const E8_RE = /^\/v1\/blog\/([^/]+)\/post\/cw-post-(\d+)$/;
  const E9_RE = /^\/v1\/viewstat\/video\/([^/]+)\/timecode\/$/;
  const DURATION = 3600;
  /** A test's own E8 answer for the Continue posts (null: the playable post). */
  let cwE8: ((blogUrl: string, n: string) => Reply) | null = null;

  /** A local entry (Story 4.2 shape) for video `n`. */
  function seed(n: number, positionSec: number, ageMs: number, meta: Record<string, unknown> = {}) {
    progressStore.put({
      ref: cwRef(n),
      positionSec,
      durationSec: DURATION,
      updatedAt: Date.now() - ageMs,
      meta: {
        title: `Lesson ${n}`,
        postTitle: `Post ${n}`,
        authorName: `Author ${n}`,
        previewUrl: null,
        durationSec: DURATION,
        ...meta,
      },
    });
  }
  const rowIds = (root: Root) => focusableIds(root).filter(id => id.startsWith(PREFIX));
  const currentRoute = () => navigationRef.getCurrentRoute()?.name;
  const e9Sent = () =>
    transport.calls
      .filter(c => c.method === 'PUT' && E9_RE.test(c.path))
      .map(c => `${E9_RE.exec(c.path)?.[1]}@${(c.form as Record<string, string>).time_code}`);

  async function fire<K extends 'onLoad' | 'onProgress' | 'onSeekDone' | 'onEnd' | 'onBuffering'>(
    name: K,
    ...args: Parameters<NonNullable<NonNullable<typeof engine.props>[K]>>
  ) {
    await act(async () => {
      const handler = engine.props?.[name] as ((...a: unknown[]) => void) | undefined;
      expect(handler).toBeDefined();
      handler?.(...args);
    });
    await settle();
  }
  /** OK on a Continue card → the Player, loaded, started at `startSec` (seek done). */
  async function openFromCard(root: Root, id: string, startSec: number) {
    await focusOn(root, id);
    await press(root, id);
    expect(currentRoute()).toBe('Player');
    await focusOn(root, SURFACE);
    await advance(600);
    await fire('onLoad', { durationSec: DURATION });
    await fire('onBuffering', false);
    await fire('onSeekDone', startSec);
  }

  beforeEach(() => {
    cwE8 = null;
    other = req => {
      const single = E8_RE.exec(req.path);
      if (single && cwE8) {
        return cwE8(decodeURIComponent(single[1]), single[2]);
      }
      if (single) {
        const n = single[2];
        return {
          status: 200,
          body: postDetail(decodeURIComponent(single[1]), `cw-post-${n}`, [
            {
              type: 'ok_video',
              id: `cw-v${n}`,
              title: `Video ${n}`,
              duration: DURATION,
              playerUrls: [{ type: 'hls', url: 'https://example.invalid/player' }],
            },
            ...paragraph('Body'),
          ]),
        };
      }
      if (req.method === 'PUT' && E9_RE.test(req.path)) {
        return { status: 200 };
      }
      return undefined;
    };
  });

  it('matrix «Empty»: no unfinished entries → no row; the feed title on top; focus on the first feed card', async () => {
    seed(1, 3590, 1000); // finished (< 30 s left)
    seed(2, 0, 2000); // never started
    const root = await renderApp();
    expect(visible(root, 'home/continue')).toBe(false);
    expect(rowIds(root)).toEqual([]);
    expect(text(root)).toContain(t('home.feed.title'));
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    await unmount(root);
  });

  it('matrix «Shown»: 3 unfinished + 1 finished → 3 cards, newest first, above the feed; focus on the first card', async () => {
    seed(1, 600, 3000);
    seed(2, 720, 2000, { title: 'Видео 2' });
    seed(3, 1800, 1000);
    seed(4, 3500, 500); // ≥ 95 %: finished
    const root = await renderApp();
    expect(rowIds(root)).toEqual([card(3), card(2), card(1)]);
    expect(lastFocusTarget()).toBe(card(3));
    // The section title with its scope, then the row, then «Новое в подписках» (in the grid's header).
    const header = byTestId(root, 'home/header')[0];
    expect(text(header)).toContain(t('home.continue.title'));
    expect(text(header)).toContain(t('home.feed.title'));
    expect(text(header).indexOf(t('home.continue.title'))).toBeLessThan(text(header).indexOf(t('home.feed.title')));
    // Title (a generic video title → the post title), author, «Осталось N мин», the progress line.
    expect(one(root, card(3)).props.accessibilityLabel).toBe('Lesson 3. Author 3. Осталось 30 мин');
    expect(one(root, card(2)).props.accessibilityLabel).toBe('Post 2. Author 2. Осталось 48 мин');
    expect(text(byTestId(root, `${card(2)}/left`)[0])).toContain('Осталось 48 мин');
    expect(visible(root, `${card(2)}/progress`)).toBe(true);
    // No preview stored and none in memory: a neutral plate.
    expect(visible(root, `${card(2)}/preview-placeholder`)).toBe(true);
    await unmount(root);
  });

  it('a started video without a known duration: no remaining time and no progress line (never a fake status)', async () => {
    progressStore.put({
      ref: cwRef(1),
      positionSec: 300,
      durationSec: null,
      updatedAt: Date.now(),
      meta: { title: 'Lesson 1', postTitle: 'Post 1', authorName: 'Author 1', previewUrl: 'https://example.invalid/p.jpg', durationSec: null },
    });
    const root = await renderApp();
    expect(one(root, card(1)).props.accessibilityLabel).toBe('Lesson 1. Author 1');
    expect(visible(root, `${card(1)}/left`)).toBe(false);
    expect(visible(root, `${card(1)}/progress`)).toBe(false);
    expect(byTestId(root, `${card(1)}/preview`)[0].props.source).toEqual({ uri: 'https://example.invalid/p.jpg' });
    await unmount(root);
  });

  it('matrix «Cap»: 25 unfinished → 20 cards', async () => {
    for (let n = 1; n <= 25; n += 1) {
      seed(n, 100, n * 1000);
    }
    const root = await renderApp();
    expect(rowIds(root)).toHaveLength(20);
    expect(rowIds(root)[0]).toBe(card(1));
    await unmount(root);
  });

  it('matrix «Open»: OK on a card at 12:00 of 60:00 → the Player for that video, which starts at 12:00', async () => {
    seed(1, 720, 1000);
    const root = await renderApp();
    expect(lastFocusTarget()).toBe(card(1));
    await press(root, card(1));
    expect(currentRoute()).toBe('Player');
    // Ids only: the media identity and the origin (Главная's restoration section).
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      ref: cwRef(1),
      origin: { routeKey: 'shell', sectionId: 'home', focusId: card(1) },
    });
    await focusOn(root, SURFACE);
    await advance(600);
    await fire('onLoad', { durationSec: DURATION });
    expect(engine.seek).toHaveBeenCalledWith(720);
    await unmount(root);
  });

  it('matrix «Return»: Back from that player → focus on the same card, now first', async () => {
    seed(1, 600, 1000);
    seed(2, 720, 2000);
    const root = await renderApp();
    expect(rowIds(root)).toEqual([card(1), card(2)]);
    await openFromCard(root, card(2), 720);
    for (let sec = 720; sec <= 732; sec += 1) {
      await fire('onProgress', sec);
    }
    expect(e9Sent()).toContain('cw-v2@730');
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(rowIds(root)).toEqual([card(2), card(1)]);
    expect(lastFocusTarget()).toBe(card(2));
    await unmount(root);
  });

  it('matrix «Finished at end»: the video ends → its card is gone; focus on the next card', async () => {
    seed(1, 600, 1000);
    seed(2, 720, 2000);
    seed(3, 900, 3000);
    const root = await renderApp();
    expect(rowIds(root)).toEqual([card(1), card(2), card(3)]);
    await openFromCard(root, card(2), 720);
    await fire('onProgress', 3599);
    focusMock.mockClear();
    await fire('onEnd');
    expect(currentRoute()).toBe('Shell');
    expect(rowIds(root)).toEqual([card(1), card(3)]);
    expect(lastFocusTarget()).toBe(card(3));
    await unmount(root);
  });

  it('«Finished at end» on the last card → the previous card; on the only card → the first feed card', async () => {
    seed(1, 600, 1000);
    seed(2, 720, 2000);
    const root = await renderApp();
    await openFromCard(root, card(2), 720);
    await fire('onProgress', 3599);
    focusMock.mockClear();
    await fire('onEnd');
    expect(rowIds(root)).toEqual([card(1)]);
    expect(lastFocusTarget()).toBe(card(1));

    await openFromCard(root, card(1), 600);
    await fire('onProgress', 3599);
    focusMock.mockClear();
    await fire('onEnd');
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'home/continue')).toBe(false);
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    await unmount(root);
  });

  const lockedCwPost = (blogUrl: string, n: string) => ({
    status: 200,
    body: { ...e8Locked(), id: `cw-post-${n}`, user: { ...(e8Locked().user as object), blogUrl } },
  });

  it('owner decision 2026-10-28: the post is locked (session checked) → the entry is dropped; back on Главная the card is gone, focus on its neighbour', async () => {
    seed(1, 600, 1000);
    seed(2, 720, 2000);
    seed(3, 900, 3000);
    const root = await renderApp();
    cwE8 = lockedCwPost;
    await focusOn(root, card(2));
    await press(root, card(2));
    expect(currentRoute()).toBe('Player');
    expect(text(byTestId(root, 'player/page')[0])).toContain('Нет доступа к этому видео');
    expect(progressStore.get('cw-v2')).toBeUndefined();
    focusMock.mockClear();
    await press(root, 'player/error/back');
    expect(currentRoute()).toBe('Shell');
    expect(rowIds(root)).toEqual([card(1), card(3)]);
    expect(lastFocusTarget()).toBe(card(3));
    expect(e9Sent()).toEqual([]);
    await unmount(root);
  });

  it('owner decision 2026-10-28: the video is unavailable (E8 404) → the only card is dropped; focus on the first feed card', async () => {
    seed(1, 600, 1000);
    const root = await renderApp();
    cwE8 = () => e8MissingReply();
    await press(root, card(1));
    expect(text(byTestId(root, 'player/page')[0])).toContain('Видео недоступно');
    expect(progressStore.get('cw-v1')).toBeUndefined();
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'home/continue')).toBe(false);
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    await unmount(root);
  });

  it('owner decision 2026-10-28: the 4.4 no-access exit (locked on the recovery E8 after playback) drops the entry; Главная focuses the neighbour', async () => {
    seed(1, 600, 1000);
    seed(2, 720, 2000);
    const root = await renderApp();
    await openFromCard(root, card(2), 720);
    for (let sec = 720; sec <= 732; sec += 1) {
      await fire('onProgress', sec);
    }
    expect(progressStore.get('cw-v2')?.positionSec).toBe(730);
    cwE8 = lockedCwPost;
    focusMock.mockClear();
    await act(async () => {
      (engine.props?.onError as ((code: string | null) => void) | undefined)?.('decoder');
    });
    await settle();
    expect(currentRoute()).toBe('Shell');
    expect(progressStore.get('cw-v2')).toBeUndefined();
    expect(rowIds(root)).toEqual([card(1)]);
    expect(lastFocusTarget()).toBe(card(1));
    await unmount(root);
  });

  it('both titles and the author empty: «Без названия»; the label leaves the author out', async () => {
    seed(1, 720, 1000, { title: '', postTitle: '', authorName: '' });
    const root = await renderApp();
    expect(one(root, card(1)).props.accessibilityLabel).toBe('Без названия. Осталось 48 мин');
    expect(text(byTestId(root, `${card(1)}/title`)[0])).toContain('Без названия');
    await unmount(root);
  });

  it('a focused card that leaves in the same update as a reorder → its neighbour by id; the row guide agrees', async () => {
    seed(1, 600, 3000);
    seed(2, 600, 2000);
    seed(3, 600, 1000);
    const root = await renderApp();
    expect(rowIds(root)).toEqual([card(3), card(2), card(1)]);
    await focusOn(root, card(2));
    focusMock.mockClear();
    await act(async () => {
      seed(2, 3500, 0); // finished: leaves
      seed(1, 650, 0); // watched: moves first
    });
    await settle();
    expect(rowIds(root)).toEqual([card(1), card(3)]);
    // Card 2's next card in the previous order was card 1 (index 1 now holds card 3).
    expect(lastFocusTarget()).toBe(card(1));
    expect(destinationIds('home/continue/guide')).toEqual([card(1)]);
    await unmount(root);
  });

  it('a resume refresh with a new feed head keeps focus on the Continue card the page focused', async () => {
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
    const appState = async (state: string) => {
      await act(async () => {
        for (const h of [...handlers]) {
          h(state);
        }
      });
      await settle();
    };
    const pages = syntheticFeed({ total: 30 });
    let head: FixtureReply | null = null;
    feed = req => (cursorOf(req.url) === null && head ? head : pages(req));
    seed(1, 600, 1000);
    const root = await renderApp();
    expect(lastFocusTarget()).toBe(card(1));
    focusMock.mockClear();
    head = {
      status: 200,
      body: {
        data: {
          posts: [feedPost(1000, { id: 'new-0' }), ...Array.from({ length: 9 }, (_, i) => feedPost(i))],
          blogs: [],
          counters: {},
        },
        extra: { offset: cursorFor(9), isLast: false },
      },
    };
    await appState('background');
    jest.setSystemTime(Date.now() + QUERY_STALE_TIME_MS + 1_000);
    await appState('active');
    expect(gridPosts(root)[0].id).toBe('new-0');
    expect(focusTargets()).toEqual([]);
    expect(lastFocusTarget()).toBeUndefined();
    await unmount(root);
  });

  it('an entry only on disk (cold start): the first card takes the initial focus', async () => {
    await createAsyncStorage('boostytv-account').setItem(
      'progress.v1',
      JSON.stringify({
        v: 1,
        entries: [
          {
            ref: cwRef(7),
            positionSec: 720,
            durationSec: DURATION,
            updatedAt: 1,
            meta: { title: 'Lesson 7', postTitle: 'Post 7', authorName: 'Author 7', previewUrl: null, durationSec: DURATION },
          },
        ],
      }),
    );
    const root = await renderApp();
    expect(rowIds(root)).toEqual([card(7)]);
    expect(lastFocusTarget()).toBe(card(7));
    await unmount(root);
  });

  it('matrix «Reset»: the history is wiped (sign-out / account switch) → the row is empty; a focused card → the first feed card', async () => {
    seed(1, 600, 1000);
    const root = await renderApp();
    expect(lastFocusTarget()).toBe(card(1));
    await focusOn(root, card(1)); // native focus arrived
    focusMock.mockClear();
    await act(async () => {
      await progressStore.reset();
    });
    await settle();
    expect(visible(root, 'home/continue')).toBe(false);
    expect(visible(root, 'home/feed/list')).toBe(true);
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    await unmount(root);
  });

  it('matrix «↑ ↓»: the row guide points at the remembered card (↑ from the feed lands there); the columns line up with the grid', async () => {
    seed(1, 600, 1000);
    seed(2, 600, 2000);
    seed(3, 600, 3000);
    seed(4, 600, 4000);
    const root = await renderApp();
    expect(destinationIds('home/continue/guide')).toEqual([card(1)]);
    await focusOn(root, card(2));
    expect(destinationIds('home/continue/guide')).toEqual([card(2)]);
    // ↓ to the feed and back ↑: the guide still names card 2.
    await focusOn(root, `home/feed/${e5Posts()[1].id}`);
    expect(destinationIds('home/continue/guide')).toEqual([card(2)]);
    // Geometry: with the row flush at the left, card i starts where grid column i starts.
    const step = (id: string) => StyleSheet.flatten(one(root, id).props.style) as Record<string, number>;
    const first = step(card(1));
    const next = step(card(2));
    const outer = first.paddingLeft + 221 + first.paddingRight;
    expect(first.paddingLeft).toBe(12);
    expect(outer + next.marginLeft).toBe(221 + 16);
    // Flush at the right: card 3 of the visible three ends 12 dp before the 720 dp edge.
    expect(720 - first.paddingRight - (12 + 2 * (221 + 16) + 221)).toBe(0);
    await unmount(root);
  });

  it('reacts to the store while shown: a newer entry moves first with focus kept; a finished focused card → its neighbour', async () => {
    seed(1, 600, 3000);
    seed(2, 600, 2000);
    seed(3, 600, 1000);
    const root = await renderApp();
    expect(rowIds(root)).toEqual([card(3), card(2), card(1)]);
    await focusOn(root, card(2));
    focusMock.mockClear();
    await act(async () => {
      seed(1, 650, 0);
    });
    await settle();
    expect(rowIds(root)).toEqual([card(1), card(3), card(2)]);
    expect(focusMock).not.toHaveBeenCalled();
    await act(async () => {
      seed(2, 3500, 0);
    });
    await settle();
    expect(rowIds(root)).toEqual([card(1), card(3)]);
    // card 2 was at index 2 (the last): its neighbour is the previous card.
    expect(lastFocusTarget()).toBe(card(3));
    await unmount(root);
  });

  it('a preview URL comes from the stored entry, else from the in-memory feed post', async () => {
    const post = feedPost(1, {
      data: [
        {
          type: 'ok_video',
          id: 'feed-video',
          title: '',
          duration: DURATION,
          preview: 'https://example.invalid/mem.jpg',
          playerUrls: [],
        },
      ],
    });
    progressStore.put({
      ref: { blogUrl: BLOG, postId: post.id as string, mediaId: 'feed-video' },
      positionSec: 100,
      durationSec: DURATION,
      updatedAt: Date.now(),
      meta: { title: '', postTitle: 'P', authorName: 'A', previewUrl: null, durationSec: DURATION },
    });
    feed = () => {
      const body = e5Page() as { data: { posts: unknown[] } };
      body.data.posts = [post, ...body.data.posts];
      return { status: 200, body };
    };
    const root = await renderApp();
    expect(byTestId(root, `${PREFIX}feed-video/preview`)[0].props.source).toEqual({
      uri: 'https://example.invalid/mem.jpg',
    });
    await unmount(root);
  });

  it('Story 5.1: the title row sits under the row; on a Continue card it is no guide and «Обновить» is not focusable (↓ keeps the column)', async () => {
    seed(1, 600, 1000);
    seed(2, 600, 2000);
    const root = await renderApp();
    expect(lastFocusTarget()).toBe(card(1));
    await focusOn(root, card(1));
    // The title row is in the list header, under the Continue row.
    const header = byTestId(root, 'home/header')[0];
    expect(focusableIds(root, header)).not.toContain('home/refresh');
    // Story 5.3: nor is the chip.
    expect(focusableIds(root, header)).not.toContain('home/filters');
    expect(byTestId(root, 'home/title-row').length).toBeGreaterThan(0);
    expect(destinationIds('home/title-row')).toEqual([]);
    expect(destinationIds('home/refresh/down-guide')).toEqual([]);
    expect(destinationIds('home/filters/down-guide')).toEqual([]);
    // ↓ to the first feed row (native), then ↑: the row guides to the chip
    // (no title-row control focused yet, Story 5.3).
    await focusOn(root, `home/feed/${e5Posts()[1].id}`);
    expect(focusableIds(root, header)).toContain('home/refresh');
    expect(focusableIds(root, header)).toContain('home/filters');
    expect(destinationIds('home/title-row')).toEqual(['home/filters']);
    // On the button: ↓ → the remembered feed card; ↑ → the Continue row's remembered card.
    await focusOn(root, 'home/refresh');
    expect(destinationIds('home/refresh/down-guide')).toEqual([`home/feed/${e5Posts()[1].id}`]);
    expect(destinationIds('home/continue/guide')).toEqual([card(1)]);
    // Back to the feed: ↑ now guides to «Обновить» (the row's last control).
    await focusOn(root, `home/feed/${e5Posts()[1].id}`);
    expect(destinationIds('home/title-row')).toEqual(['home/refresh']);
    await unmount(root);
  });
});

describe('Story 5.3: filter the feed by access', () => {
  const CHIP = 'home/filters';
  const REFRESH = 'home/refresh';
  const SHEET = 'filters/sheet';
  const ALLOWED = 'filters/access/allowed';
  const ALL = 'filters/access/all';
  const BOUGHT = 'filters/access/bought';
  const RESET = 'filters/reset';
  const ACTION = 'state/home/action';
  const ALL_PARAMS = 'only_allowed=false&only_bought=false';
  /** The access a request asked for (by its E5 params). */
  const accessOf = (url: string) =>
    /only_bought=true/.test(url)
      ? 'bought'
      : /only_allowed=true/.test(url)
        ? 'allowed'
        : /only_allowed=false/.test(url)
          ? 'all'
          : 'none';
  const allPage = (): FixtureReply => ({
    status: 200,
    body: {
      data: { posts: Array.from({ length: 10 }, (_, i) => feedPost(i, { id: `all-${i}` })), blogs: [], counters: {} },
      extra: { offset: 'redacted', isLast: true },
    },
  });
  const emptyPage = (): FixtureReply => ({
    status: 200,
    body: { data: { posts: [], blogs: [], counters: {} }, extra: { isLast: true } },
  });
  /** The E5 answer per access value (the test may replace one). */
  let byAccess: Record<string, () => Reply>;
  const chip = (root: Root) => one(root, CHIP);
  const firstCard = () => `home/feed/${e5Posts()[0].id}`;

  beforeEach(() => {
    byAccess = {
      allowed: () => ({ status: 200, body: e5Page() }),
      all: allPage,
      bought: emptyPage,
    };
    feed = req => byAccess[accessOf(req.url)]?.();
    other = req => (req.path === E2_PATH ? { status: 200, body: e2Body() } : undefined);
  });

  /** Главная loaded (default Filter), the user on card `n`, then OK on «Фильтры». */
  async function openSheet(n = 0) {
    const root = await renderApp();
    await focusOn(root, `home/feed/${e5Posts()[n].id}`);
    await focusOn(root, CHIP);
    focusMock.mockClear();
    await press(root, CHIP);
    expect(visible(root, SHEET)).toBe(true);
    return root;
  }

  it('matrix «Open»: the chip reads «Фильтры · Доступные мне» (no count); OK → the sheet with focus on the selected value', async () => {
    const root = await renderApp();
    expect(text(chip(root))).toContain(tf('filters.chip', { value: t('filters.access.allowed') }));
    expect(chip(root).props.accessibilityLabel).toBe(
      tf('filters.chipA11y', { value: t('filters.access.allowed') }),
    );
    expect(byTestId(root, `${CHIP}/count`)).toHaveLength(0);
    await unmount(root);

    const sheet = await openSheet();
    expect(text(byTestId(sheet, SHEET)[0])).toContain(t('filters.title'));
    // The three values and «Период» (Story 5.4), no «Сбросить» (the
    // default); the sheet is the only focusable content in the modal (the
    // host's trap holds it).
    expect(
      byTestId(sheet, 'modal/content')[0]
        .queryAll(n => n.props.focusable === true)
        .map(n => n.props.testID),
    ).toEqual([ALLOWED, ALL, BOUGHT, 'filters/period', 'filters/tags']);
    expect(focusTargets()).toContain(ALLOWED);
    expect(one(sheet, ALLOWED).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(one(sheet, ALL).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
    // No E5 by opening.
    expect(feedCalls()).toHaveLength(1);
    await unmount(sheet);
  });

  it('matrix «Select»: «Все посты» → one E5 page 1 with both flags false; focus stays in the sheet; «Сбросить» appears; the chip counts 1', async () => {
    const root = await openSheet();
    focusMock.mockClear();
    await press(root, ALL);
    expect(feedCalls()).toHaveLength(2);
    expect(feedCalls()[1].url).toContain(ALL_PARAMS);
    expect(cursorOf(feedCalls()[1].url)).toBeNull();
    // Nothing requested focus: it stays on «Все посты» in the sheet.
    expect(focusTargets()).toEqual([]);
    expect(visible(root, SHEET)).toBe(true);
    expect(one(root, ALL).props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(visible(root, RESET)).toBe(true);
    // Behind the sheet: the «Все посты» feed and the chip with its count.
    expect(cardIds(root)[0]).toBe('home/feed/all-0');
    expect(text(chip(root))).toContain(tf('filters.chip', { value: t('filters.access.all') }));
    expect(text(byTestId(root, `${CHIP}/count`)[0])).toContain('1');
    expect(chip(root).props.accessibilityLabel).toBe(
      tf('filters.chipA11yCount', {
        value: t('filters.access.all'),
        count: `1 ${tp('filters.activeCount', 1)}`,
      }),
    );
    // The same value again: nothing.
    await press(root, ALL);
    expect(feedCalls()).toHaveLength(2);
    await unmount(root);
  });

  it('matrix «Select», E5 fails: the error state behind; the sheet stays usable', async () => {
    byAccess.all = () => ({ status: 403, body: {} });
    const root = await openSheet();
    await press(root, ALL);
    expect(visible(root, 'home/feed/error')).toBe(true);
    expect(visible(root, SHEET)).toBe(true);
    // The chip stays above the error view (the sheet's initiator).
    expect(byTestId(root, CHIP).length).toBeGreaterThan(0);
    // The page took no focus out of the sheet.
    expect(focusTargets()).not.toContain(ACTION);
    await press(root, BOUGHT);
    expect(visible(root, 'home/feed/filtered-empty')).toBe(true);
    expect(visible(root, SHEET)).toBe(true);
    await back();
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(CHIP);
    await unmount(root);
  });

  it('reopened under «Все посты»: the sheet opens on «Все посты», not on «Доступные мне»', async () => {
    const root = await openSheet();
    await press(root, ALL);
    await back();
    expect(lastFocusTarget()).toBe(CHIP);
    focusMock.mockClear();
    await press(root, CHIP);
    expect(visible(root, SHEET)).toBe(true);
    expect(focusTargets()).toContain(ALL);
    expect(focusTargets()).not.toContain(ALLOWED);
    await unmount(root);
  });

  it('matrix «Reset»: OK «Сбросить» → the default from the cache (no E5); focus → «Доступные мне»', async () => {
    const root = await openSheet();
    await press(root, ALL);
    expect(feedCalls()).toHaveLength(2);
    await focusOn(root, RESET);
    focusMock.mockClear();
    await press(root, RESET);
    expect(feedCalls()).toHaveLength(2);
    expect(byTestId(root, RESET)).toHaveLength(0);
    expect(lastFocusTarget()).toBe(ALLOWED);
    expect(one(root, ALLOWED).props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(cardIds(root)[0]).toBe(firstCard());
    expect(byTestId(root, `${CHIP}/count`)).toHaveLength(0);
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    await unmount(root);
  });

  it('matrix «Back»: Back closes the sheet; focus → the chip; Back again → nav/home', async () => {
    const root = await openSheet();
    await press(root, ALL);
    focusMock.mockClear();
    await back();
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(CHIP);
    // The Filter stays (no Apply button).
    expect(getFilter('feed')).toEqual({ access: 'all', period: { kind: 'all' }, tags: [] });
    await focusOn(root, CHIP);
    await back();
    expect(lastFocusTarget()).toBe('nav/home');
    await unmount(root);
  });

  it('matrix «Empty»: «Только купленные», no posts → «Ничего не найдено» + «Сбросить фильтры»; OK → the default, focus → the first card', async () => {
    const root = await openSheet();
    await press(root, BOUGHT);
    expect(feedCalls()[1].url).toContain('only_allowed=false&only_bought=true');
    expect(visible(root, 'home/feed/filtered-empty')).toBe(true);
    expect(visible(root, 'home/feed/empty')).toBe(false);
    expect(text(root)).toContain(t('home.feed.filteredEmptyTitle'));
    expect(one(root, ACTION).props.accessibilityLabel).toBe(t('home.feed.filteredEmptyReset'));
    // Focus stayed in the sheet (the page takes no focus behind it).
    expect(focusTargets()).not.toContain(ACTION);
    await back();
    expect(lastFocusTarget()).toBe(CHIP);
    // ↓ to the action (native), OK.
    await focusOn(root, ACTION);
    focusMock.mockClear();
    await press(root, ACTION);
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    expect(feedCalls()).toHaveLength(2);
    expect(cardIds(root)[0]).toBe(firstCard());
    expect(lastFocusTarget()).toBe(firstCard());
    await unmount(root);
  });

  it('«Сбросить фильтры» with no cached default feed: the view stays (busy) until the cards arrive, then the first card', async () => {
    const root = await openSheet();
    await press(root, BOUGHT);
    await back();
    await act(async () => {
      queryClient.removeQueries({ queryKey: queryKeys.subscriptionFeed(DEFAULT_FILTER) });
    });
    const page = deferred();
    byAccess.allowed = () => page.promise;
    await focusOn(root, ACTION);
    focusMock.mockClear();
    await press(root, ACTION);
    expect(feedCalls()).toHaveLength(3);
    expect(visible(root, 'home/feed/skeleton')).toBe(false);
    expect(visible(root, 'home/feed/filtered-empty')).toBe(true);
    expect(one(root, ACTION).props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    page.resolve({ status: 200, body: e5Page() });
    await settle();
    expect(lastFocusTarget()).toBe(firstCard());
    await unmount(root);
  });

  it('«Сбросить фильтры» and the default feed is empty too: «Новых постов нет»; focus stays on the action', async () => {
    byAccess.allowed = emptyPage;
    const root = await renderApp();
    expect(visible(root, 'home/feed/empty')).toBe(true);
    await focusOn(root, CHIP);
    await press(root, CHIP);
    await press(root, BOUGHT);
    await back();
    expect(visible(root, 'home/feed/filtered-empty')).toBe(true);
    await focusOn(root, ACTION);
    focusMock.mockClear();
    await press(root, ACTION);
    expect(visible(root, 'home/feed/empty')).toBe(true);
    expect(text(root)).toContain(t('home.feed.emptyTitle'));
    // The same action view: nothing re-focuses it, nothing else takes focus.
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('matrix «Account»: sign-out → the Filter is back to the default', async () => {
    const root = await openSheet();
    await press(root, ALL);
    await back();
    expect(getFilter('feed')).toEqual({ access: 'all', period: { kind: 'all' }, tags: [] });
    await press(root, 'nav/settings');
    await press(root, 'settings/row/signout');
    await press(root, 'dialog/signout/confirm');
    expect(visible(root, 'auth/welcome')).toBe(true);
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    await unmount(root);
  });

  it('«Обновить» refreshes the active Filter’s feed (one E5 page 1 with its params)', async () => {
    const root = await openSheet();
    await press(root, ALL);
    await back();
    await focusOn(root, REFRESH);
    await press(root, REFRESH);
    expect(feedCalls()).toHaveLength(3);
    expect(feedCalls()[2].url).toContain(ALL_PARAMS);
    expect(cursorOf(feedCalls()[2].url)).toBeNull();
    await unmount(root);
  });

  it('the session check runs only under «Доступные мне»: an all-locked «Все посты» page sends no E1', async () => {
    byAccess.all = () => ({
      status: 200,
      body: {
        data: { posts: [1, 2, 3].map(n => ({ ...lockedPost(), id: `locked-${n}` })), blogs: [], counters: {} },
        extra: { isLast: true },
      },
    });
    const root = await openSheet();
    const e1 = transport.callsTo(E1).length;
    await press(root, ALL);
    await settle(WITH_TIMERS);
    expect(cardIds(root)).toEqual(['home/feed/locked-1', 'home/feed/locked-2', 'home/feed/locked-3']);
    expect(transport.callsTo(E1)).toHaveLength(e1);
    expect(feedCalls()).toHaveLength(2);
    await unmount(root);
  });

  it('the title row: «Фильтры» between the title and «Обновить» (← →); ↓ from the chip → the remembered card; ↑ from the feed → the last focused control', async () => {
    const root = await renderApp();
    const row = byTestId(root, 'home/title-row')[0];
    expect(focusableIds(root, row)).toEqual([CHIP, REFRESH]);
    // Nothing focused in the row yet: ↑ → the chip.
    expect(destinationIds('home/title-row')).toEqual([CHIP]);
    await focusOn(root, `home/feed/${e5Posts()[2].id}`);
    await focusOn(root, CHIP);
    expect(destinationIds('home/filters/down-guide')).toEqual([`home/feed/${e5Posts()[2].id}`]);
    expect(destinationIds('home/refresh/down-guide')).toEqual([]);
    await focusOn(root, REFRESH);
    expect(destinationIds('home/filters/down-guide')).toEqual([]);
    expect(destinationIds('home/refresh/down-guide')).toEqual([`home/feed/${e5Posts()[2].id}`]);
    await focusOn(root, CHIP);
    await focusOn(root, `home/feed/${e5Posts()[0].id}`);
    expect(destinationIds('home/title-row')).toEqual([CHIP]);
    await unmount(root);
  });

  it('a filter skeleton keeps the chip (the first load’s skeleton has none)', async () => {
    const page = deferred();
    byAccess.all = () => page.promise;
    const root = await openSheet();
    await press(root, ALL);
    expect(visible(root, 'home/feed/skeleton')).toBe(true);
    expect(byTestId(root, CHIP).length).toBeGreaterThan(0);
    await back();
    expect(lastFocusTarget()).toBe(CHIP);
    page.resolve(allPage());
    await settle();
    // The cards arrived while the user is on the chip: focus stays there.
    expect(cardIds(root)[0]).toBe('home/feed/all-0');
    expect(focusTargets().filter(id => id?.startsWith('home/feed/'))).toEqual([]);
    await unmount(root);
  });

  describe('matrix «Resume»', () => {
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

    it('a non-default Filter: the resume head refresh sends that Filter’s page 1 only; the default cache is untouched', async () => {
      const root = await openSheet();
      await press(root, ALL);
      await back();
      const defaultState = queryClient.getQueryState(queryKeys.subscriptionFeed(DEFAULT_FILTER));
      expect(feedCalls()).toHaveLength(2);
      await changeAppState('background');
      jest.setSystemTime(Date.now() + QUERY_STALE_TIME_MS + 1_000);
      await changeAppState('active');
      expect(feedCalls()).toHaveLength(3);
      expect(feedCalls()[2].url).toContain(ALL_PARAMS);
      expect(cursorOf(feedCalls()[2].url)).toBeNull();
      expect(queryClient.getQueryState(queryKeys.subscriptionFeed(DEFAULT_FILTER))?.dataUpdatedAt).toBe(
        defaultState?.dataUpdatedAt,
      );
      await unmount(root);
    });
  });

  it('switching back to a stale Filter sends one E5 page 1 (the left feed keeps its first page only)', async () => {
    const pages = syntheticFeed({ total: 30 });
    byAccess.allowed = () => undefined;
    feed = req => (accessOf(req.url) === 'allowed' ? pages(req) : byAccess[accessOf(req.url)]?.());
    const root = await renderApp();
    await focusOn(root, 'home/feed/feed-post-8');
    await focusOn(root, 'home/feed/feed-post-13');
    expect(feedCalls()).toHaveLength(2);
    await focusOn(root, CHIP);
    await press(root, CHIP);
    await press(root, ALL);
    expect(feedCalls()).toHaveLength(3);
    // The default feed left behind: page 1 only, its age kept.
    const data = queryClient.getQueryData<{ pages: unknown[] }>(queryKeys.subscriptionFeed(DEFAULT_FILTER));
    expect(data?.pages).toHaveLength(1);
    jest.setSystemTime(Date.now() + QUERY_STALE_TIME_MS + 1_000);
    await press(root, ALLOWED);
    expect(feedCalls()).toHaveLength(4);
    expect(accessOf(feedCalls()[3].url)).toBe('allowed');
    expect(cursorOf(feedCalls()[3].url)).toBeNull();
    expect(cardIds(root)[0]).toBe('home/feed/feed-post-0');
    await unmount(root);
  });

  it('phase flag off: no chip, the default Filter (whatever the store holds)', async () => {
    // The default feed cached by a first run, then Главная alone with the flag off.
    const app = await renderApp();
    await unmount(app);
    filtersStore.getState().setAccess('feed', 'all');
    const info: HomeFocusInfo = {
      isActive: () => true,
      current: () => null,
      sectionItemId: 'nav/home',
      focusSidebar: () => {},
      onFocusChange: () => () => {},
    };
    const root = await render(
      <QueryClientProvider client={queryClient}>
        <ModalHostProvider>
          <HomeScreen http={{} as HttpClient} routeKey="shell" focus={info} filtersEnabled={false} />
        </ModalHostProvider>
      </QueryClientProvider>,
    );
    expect(byTestId(root, CHIP)).toHaveLength(0);
    expect(cardIds(root)[0]).toBe(firstCard());
    expect(feedCalls()).toHaveLength(1);
    await unmount(root);
  });
});

describe('Story 5.4: filter by period', () => {
  const CHIP = 'home/filters';
  const SHEET = 'filters/sheet';
  const LIST = 'filters/period/list';
  const STEPPER = 'filters/period/stepper';
  const PERIOD = 'filters/period';
  const ALL_TIME_ROW = 'filters/period/all';
  const WEEK = 'filters/period/7d';
  const CUSTOM = 'filters/period/custom';
  const DONE = 'filters/period/custom/done';
  const RESET = 'filters/reset';
  const field = (group: 'from' | 'to', name: 'day' | 'month' | 'year') =>
    `filters/period/custom/${group}/${name}`;
  /** 28 Oct 2026, 14:30 local. */
  const NOW = new Date(2026, 9, 28, 14, 30).getTime();
  const sec = (y: number, m: number, d: number, h = 0, min = 0, s2 = 0) =>
    Math.floor(new Date(y, m - 1, d, h, min, s2).getTime() / 1000);
  const paramOf = (url: string, name: string) => {
    const match = new RegExp(`[?&]${name}=([^&]*)`).exec(url);
    return match ? Number(match[1]) : null;
  };
  const emptyPage = (): FixtureReply => ({
    status: 200,
    body: { data: { posts: [], blogs: [], counters: {} }, extra: { isLast: true } },
  });
  /** The E5 answer for a request with period params (the test may replace it). */
  let periodReply: () => Reply;

  beforeEach(() => {
    jest.setSystemTime(NOW);
    tvEvents.reset();
    periodReply = () => ({ status: 200, body: e5Page() });
    feed = req => (paramOf(req.url, 'from_ts') === null ? { status: 200, body: e5Page() } : periodReply());
  });

  /** Главная loaded, OK on «Фильтры» → the sheet. */
  async function openSheet() {
    const root = await renderApp();
    await focusOn(root, `home/feed/${e5Posts()[0].id}`);
    await focusOn(root, CHIP);
    await press(root, CHIP);
    expect(visible(root, SHEET)).toBe(true);
    return root;
  }

  /** The sheet open, OK on «Период» → the list. */
  async function openList() {
    const root = await openSheet();
    focusMock.mockClear();
    await press(root, PERIOD);
    expect(visible(root, LIST)).toBe(true);
    return root;
  }

  /** The list open, OK on «Свой период…» → the stepper. */
  async function openStepper() {
    const root = await openList();
    focusMock.mockClear();
    await press(root, CUSTOM);
    expect(visible(root, STEPPER)).toBe(true);
    return root;
  }

  /** `n` raw ↑ (+) or ↓ (−) key ups on the focused field. */
  async function step(n: number) {
    for (let i = 0; i < Math.abs(n); i += 1) {
      await act(async () => {
        tvEvents.emit({ eventType: n > 0 ? 'up' : 'down', eventKeyAction: 1 });
      });
    }
  }

  /** Focus a field from inside the fields, past the entry guard. */
  async function onField(root: Root, id: string) {
    await focusOn(root, id);
    jest.setSystemTime(Date.now() + 600);
  }

  const valueOf = (root: Root, id: string) =>
    text(byTestId(root, `${id}/value`)[0]).match(/"children":\["([^"]+)"\]/)?.[1];

  it('the sheet: «Период» under «Доступ» with the current period; OK → the list on the current period', async () => {
    const root = await openSheet();
    expect(one(root, PERIOD).props.accessibilityLabel).toBe(
      `${t('filters.period.title')} ${t('filters.period.all')}`,
    );
    focusMock.mockClear();
    await press(root, PERIOD);
    expect(visible(root, SHEET)).toBe(false);
    expect(text(byTestId(root, LIST)[0])).toContain(t('filters.period.title'));
    expect(
      byTestId(root, 'modal/content')[0]
        .queryAll(n => n.props.focusable === true)
        .map(n => n.props.testID),
    ).toEqual([ALL_TIME_ROW, WEEK, 'filters/period/30d', 'filters/period/90d', CUSTOM]);
    expect(lastFocusTarget()).toBe(ALL_TIME_ROW);
    expect(one(root, ALL_TIME_ROW).props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    // Opening the list sends nothing.
    expect(feedCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('matrix «Preset»: «Последние 7 дней» → one E5 with from_ts = 00:00 of today − 6 and to_ts = today 23:59:59; back on «Период»; count 1', async () => {
    const root = await openList();
    focusMock.mockClear();
    await press(root, WEEK);
    expect(feedCalls()).toHaveLength(2);
    const url = feedCalls()[1].url;
    expect(paramOf(url, 'from_ts')).toBe(sec(2026, 10, 22));
    expect(paramOf(url, 'to_ts')).toBe(sec(2026, 10, 28, 23, 59, 59));
    expect(url).toContain('only_allowed=true&only_bought=false&from_ts=');
    expect(cursorOf(url)).toBeNull();
    // Back on the sheet, focus on «Период» with its new value.
    expect(visible(root, SHEET)).toBe(true);
    expect(lastFocusTarget()).toBe(PERIOD);
    expect(one(root, PERIOD).props.accessibilityLabel).toBe(
      `${t('filters.period.title')} ${t('filters.period.preset.d7')}`,
    );
    expect(visible(root, RESET)).toBe(true);
    // The chip: the one active section's value and the count.
    const value = t('filters.period.preset.d7');
    expect(text(one(root, CHIP))).toContain(tf('filters.chip', { value }));
    expect(text(byTestId(root, `${CHIP}/count`)[0])).toContain('1');
    expect(one(root, CHIP).props.accessibilityLabel).toBe(
      tf('filters.chipA11yCount', { value, count: `1 ${tp('filters.activeCount', 1)}` }),
    );
    // Reopened, the list opens on «Последние 7 дней».
    focusMock.mockClear();
    await press(root, PERIOD);
    expect(lastFocusTarget()).toBe(WEEK);
    await unmount(root);
  });

  it('matrix «Preset», E5 fails: the error state behind; the sheet stays usable', async () => {
    periodReply = () => ({ status: 403, body: {} });
    const root = await openList();
    await press(root, WEEK);
    expect(visible(root, 'home/feed/error')).toBe(true);
    expect(visible(root, SHEET)).toBe(true);
    expect(lastFocusTarget()).toBe(PERIOD);
    // The page took no focus out of the sheet.
    expect(focusTargets()).not.toContain('state/home/action');
    await back();
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(CHIP);
    await unmount(root);
  });

  it('a period change never moves focus out of the sheet, even when the Shell last saw the sidebar (device: Story 5.4)', async () => {
    const page = deferred();
    periodReply = () => page.promise;
    const root = await openList();
    // Native focus fell back to the sidebar while the list unmounted.
    focusMock.mockClear();
    await press(root, WEEK);
    await focusOn(root, 'nav/home');
    page.resolve({ status: 200, body: e5Page() });
    await settle();
    // The sheet asked for «Период»; nothing on Главная asked for focus after it.
    expect(focusTargets()).toContain(PERIOD);
    expect(focusTargets().filter(id => id?.startsWith('home/') || id?.startsWith('nav/'))).toEqual([]);
    expect(lastFocusTarget()).toBe(PERIOD);
    await unmount(root);
  });

  it('matrix «Custom»: 1 авг 2026 – 25 сен 2026 through the stepper, «Готово» → E5 bounds 1 Aug 00:00:00 – 25 Sep 23:59:59 local', async () => {
    const root = await openStepper();
    // Opens on «С: день» with today − 30 → today.
    expect(lastFocusTarget()).toBe(field('from', 'day'));
    expect(valueOf(root, field('from', 'day'))).toBe('28');
    expect(valueOf(root, field('from', 'month'))).toBe(t('date.month.sep'));
    expect(valueOf(root, field('to', 'day'))).toBe('28');
    expect(valueOf(root, field('to', 'month'))).toBe(t('date.month.oct'));
    await onField(root, field('from', 'day'));
    await step(-27);
    await onField(root, field('from', 'month'));
    await step(-1);
    await onField(root, field('to', 'day'));
    await step(-3);
    await onField(root, field('to', 'month'));
    await step(-1);
    expect(text(byTestId(root, 'filters/period/custom/summary')[0])).toContain('1 августа 2026 — 25 сентября 2026');
    // No request while stepping.
    expect(feedCalls()).toHaveLength(1);
    // OK on a field → «Готово».
    focusMock.mockClear();
    await press(root, field('to', 'month'));
    expect(lastFocusTarget()).toBe(DONE);
    focusMock.mockClear();
    await press(root, DONE);
    expect(feedCalls()).toHaveLength(2);
    const url = feedCalls()[1].url;
    expect(paramOf(url, 'from_ts')).toBe(sec(2026, 8, 1));
    expect(paramOf(url, 'to_ts')).toBe(sec(2026, 9, 25, 23, 59, 59));
    expect(getFilter('feed').period).toEqual({ kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' });
    expect(visible(root, SHEET)).toBe(true);
    expect(lastFocusTarget()).toBe(PERIOD);
    expect(text(one(root, PERIOD))).toContain('1 августа 2026 — 25 сентября 2026');
    // The list: «Свой период…» selected with the range; the stepper reopens on it.
    focusMock.mockClear();
    await press(root, PERIOD);
    expect(lastFocusTarget()).toBe(CUSTOM);
    expect(one(root, CUSTOM).props.accessibilityLabel).toBe(
      `${t('filters.period.custom')} 1 августа 2026 — 25 сентября 2026`,
    );
    await press(root, CUSTOM);
    expect(valueOf(root, field('from', 'day'))).toBe('1');
    expect(valueOf(root, field('to', 'month'))).toBe(t('date.month.sep'));
    await unmount(root);
  });

  it('matrix «Invalid»: from after to → «Готово» disabled + hint; no request', async () => {
    const root = await openStepper();
    await onField(root, field('from', 'month'));
    await step(1);
    // 28 Oct — 28 Oct is valid; one more day is not.
    await onField(root, field('from', 'day'));
    await step(1);
    // The day stops at today: 28 Oct is the last reachable date.
    expect(valueOf(root, field('from', 'day'))).toBe('28');
    await onField(root, field('to', 'day'));
    await step(-1);
    expect(text(root)).toContain(t('filters.period.invalid'));
    const done = byTestId(root, DONE).filter(n => typeof n.props.onFocus === 'function');
    expect(done[0].props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(done[0].props.focusable).toBe(false);
    // OK on a field does nothing; nothing is sent.
    focusMock.mockClear();
    await press(root, field('to', 'day'));
    expect(focusTargets()).toEqual([]);
    expect(feedCalls()).toHaveLength(1);
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    await unmount(root);
  });

  it('matrix «Day clamp»: 31 + the month → февраль → 28', async () => {
    const root = await openStepper();
    await onField(root, field('from', 'month'));
    await step(-1);
    await onField(root, field('from', 'day'));
    await step(3);
    expect(valueOf(root, field('from', 'day'))).toBe('31');
    await onField(root, field('from', 'month'));
    await step(-6);
    expect(valueOf(root, field('from', 'month'))).toBe(t('date.month.feb'));
    expect(valueOf(root, field('from', 'day'))).toBe('28');
    await unmount(root);
  });

  it('matrix «Back»: stepper → list on «Свой период…» (edits discarded), list → sheet on «Период», sheet → the chip', async () => {
    const root = await openStepper();
    await onField(root, field('from', 'day'));
    await step(-5);
    focusMock.mockClear();
    await back();
    expect(visible(root, LIST)).toBe(true);
    expect(lastFocusTarget()).toBe(CUSTOM);
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    expect(feedCalls()).toHaveLength(1);
    // The edits are gone: the stepper opens on today − 30 again.
    await press(root, CUSTOM);
    expect(valueOf(root, field('from', 'day'))).toBe('28');
    await back();
    focusMock.mockClear();
    await back();
    expect(visible(root, SHEET)).toBe(true);
    expect(lastFocusTarget()).toBe(PERIOD);
    await back();
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(CHIP);
    await unmount(root);
  });

  it('matrix «Two sections»: «Все посты» + 7 days → chip «Фильтры» + 2; «Сбросить» resets both', async () => {
    const root = await openSheet();
    await press(root, 'filters/access/all');
    await press(root, PERIOD);
    await press(root, WEEK);
    const url = feedCalls()[feedCalls().length - 1].url;
    expect(url).toContain('only_allowed=false&only_bought=false&from_ts=');
    expect(text(one(root, CHIP))).toContain(t('filters.title'));
    expect(text(one(root, CHIP))).not.toContain('·');
    expect(text(byTestId(root, `${CHIP}/count`)[0])).toContain('2');
    expect(one(root, CHIP).props.accessibilityLabel).toBe(
      tf('filters.chipA11yMany', { count: `2 ${tp('filters.activeCount', 2)}` }),
    );
    focusMock.mockClear();
    await press(root, RESET);
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    expect(lastFocusTarget()).toBe('filters/access/allowed');
    expect(one(root, PERIOD).props.accessibilityLabel).toBe(
      `${t('filters.period.title')} ${t('filters.period.all')}`,
    );
    expect(byTestId(root, `${CHIP}/count`)).toHaveLength(0);
    await unmount(root);
  });

  it('matrix «Key stability»: the same preset as the clock moves keeps one query key (no time in it)', async () => {
    const root = await openList();
    await press(root, WEEK);
    const keys = () =>
      queryClient
        .getQueryCache()
        .findAll({ queryKey: queryKeys.allSubscriptionFeeds() })
        .map(q => JSON.stringify(q.queryKey));
    const before = keys();
    expect(before).toContain(
      JSON.stringify(queryKeys.subscriptionFeed({ access: 'allowed', period: { kind: 'preset', days: 7 }, tags: [] })),
    );
    jest.setSystemTime(NOW + 30 * 60 * 1000);
    // A re-render (the list again, the same preset again: a no-op).
    await press(root, PERIOD);
    await press(root, WEEK);
    expect(keys()).toEqual(before);
    expect(feedCalls()).toHaveLength(2);
    await unmount(root);
  });

  it('a filtered empty period: «Ничего не найдено» + «Сбросить фильтры» → the default', async () => {
    periodReply = emptyPage;
    const root = await openList();
    await press(root, WEEK);
    await back();
    expect(visible(root, 'home/feed/filtered-empty')).toBe(true);
    await focusOn(root, 'state/home/action');
    await press(root, 'state/home/action');
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    await unmount(root);
  });
});

describe('Story 5.5: filter by tags', () => {
  const CHIP = 'home/filters';
  const SHEET = 'filters/sheet';
  const TAGS_ROW = 'filters/tags';
  const LEVEL = 'filters/tags/list';
  const TAG_RESET = 'filters/tags/reset';
  const LOAD_MORE = 'filters/tags/load-more';
  const RETRY = 'filters/tags/retry';
  const LOADING = 'filters/tags/loading';
  const EMPTY = 'filters/tags/empty';
  const RESET = 'filters/reset';
  const E13 = '/v1/search/feed/tag/';
  const tagRow = (id: number | string) => `filters/tag/${id}`;
  const tagCalls = () => transport.callsTo(E13);
  const tagsParam = (url: string) => {
    const match = /[?&]tags_ids=([^&]*)/.exec(url);
    return match ? decodeURIComponent(match[1]) : null;
  };
  /** One E13 page: tags `from`…`to` («Тег N»), with a next cursor unless last. */
  const tagsPage = (from: number, to: number, next: string | null): FixtureReply => ({
    status: 200,
    body: {
      data: {
        searchTags: Array.from({ length: to - from + 1 }, (_, i) => ({
          tag: { id: from + i, title: `Тег ${from + i}` },
          rank: 0,
        })),
      },
      extra: next === null ? { offset: 'end', isLast: true } : { offset: next, isLast: false },
    },
  });
  let tags: (req: FixtureRequest) => Reply;

  beforeEach(() => {
    tags = () => tagsPage(1, 5, null);
    other = req => (req.path === E13 ? tags(req) : undefined);
  });

  async function openSheet() {
    const root = await renderApp();
    await focusOn(root, `home/feed/${e5Posts()[0].id}`);
    await focusOn(root, CHIP);
    await press(root, CHIP);
    expect(visible(root, SHEET)).toBe(true);
    return root;
  }

  async function openTags() {
    const root = await openSheet();
    focusMock.mockClear();
    await press(root, TAGS_ROW);
    expect(visible(root, LEVEL)).toBe(true);
    return root;
  }

  const levelFocusables = (root: Root) =>
    byTestId(root, 'modal/content')[0]
      .queryAll(n => n.props.focusable === true)
      .map(n => n.props.testID as string);

  it('the sheet: «Теги · Все» under «Период»; nothing is sent before the level opens', async () => {
    const root = await openSheet();
    expect(one(root, TAGS_ROW).props.accessibilityLabel).toBe(
      `${t('filters.tags.title')} ${t('filters.tags.none')}`,
    );
    expect(tagCalls()).toHaveLength(0);
    await unmount(root);
  });

  it('matrix «Open tags»: E13 limit=100, the loading row, then the check rows; focus on the first row', async () => {
    const page = deferred();
    tags = () => page.promise;
    const root = await openTags();
    expect(tagCalls()).toHaveLength(1);
    expect(tagCalls()[0].url).toBe(`https://api.boosty.to${E13}?limit=100`);
    // Story 5.7: the feed's tag level never asks for blog tags (E14).
    expect(transport.calls.some(c => c.path.includes('/post/tag/'))).toBe(false);
    expect(levelFocusables(root)).toEqual([LOADING]);
    expect(lastFocusTarget()).toBe(LOADING);
    expect(text(byTestId(root, LEVEL)[0])).toContain(t('filters.tags.title'));
    focusMock.mockClear();
    page.resolve(tagsPage(1, 3, null));
    await settle();
    expect(levelFocusables(root)).toEqual([tagRow(1), tagRow(2), tagRow(3)]);
    expect(lastFocusTarget()).toBe(tagRow(1));
    expect(one(root, tagRow(1)).props.accessibilityRole).toBe('checkbox');
    expect(one(root, tagRow(1)).props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    expect(one(root, tagRow(1)).props.accessibilityLabel).toBe('Тег 1');
    await unmount(root);
  });

  it('matrix «Open tags», E13 fails: «Повторить»; OK retries with focus on it; success → the first tag', async () => {
    tags = () => ({ status: 500, body: {} });
    const root = await openTags();
    await settle(WITH_TIMERS);
    expect(levelFocusables(root)).toEqual([RETRY]);
    expect(lastFocusTarget()).toBe(RETRY);
    expect(text(one(root, RETRY))).toContain(t('filters.tags.error'));
    const page = deferred();
    tags = () => page.promise;
    const calls = tagCalls().length;
    focusMock.mockClear();
    await press(root, RETRY);
    expect(tagCalls()).toHaveLength(calls + 1);
    // While it runs the row stays (focus kept, no loading row).
    expect(levelFocusables(root)).toEqual([RETRY]);
    expect(focusTargets()).toEqual([]);
    page.resolve(tagsPage(1, 2, null));
    await settle();
    expect(levelFocusables(root)).toEqual([tagRow(1), tagRow(2)]);
    expect(lastFocusTarget()).toBe(tagRow(1));
    await unmount(root);
  });

  it('matrix «No tags»: «Тегов нет»', async () => {
    tags = () => ({ status: 200, body: { data: { searchTags: [] }, extra: { offset: 'x', isLast: true } } });
    const root = await openTags();
    expect(levelFocusables(root)).toEqual([EMPTY]);
    expect(text(one(root, EMPTY))).toContain(t('filters.tags.empty'));
    expect(lastFocusTarget()).toBe(EMPTY);
    await unmount(root);
  });

  it('matrix «Toggle»: «Тег 4» then «Тег 2» → E5 tags_ids sorted, one page 1 each; focus stays; the chip and «Теги» follow', async () => {
    const root = await openTags();
    focusMock.mockClear();
    await press(root, tagRow(4));
    expect(feedCalls()).toHaveLength(2);
    expect(tagsParam(feedCalls()[1].url)).toBe('4');
    expect(cursorOf(feedCalls()[1].url)).toBeNull();
    expect(feedCalls()[1].url).toContain('only_allowed=true&only_bought=false&tags_ids=4');
    expect(one(root, tagRow(4)).props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    // The tag «Сбросить» appears on top; focus stays on the row; the order is unchanged.
    expect(levelFocusables(root)).toEqual([TAG_RESET, tagRow(1), tagRow(2), tagRow(3), tagRow(4), tagRow(5)]);
    expect(focusTargets()).toEqual([]);
    // One tag: the chip reads its title.
    expect(text(one(root, CHIP))).toContain(tf('filters.chip', { value: 'Тег 4' }));
    expect(text(byTestId(root, `${CHIP}/count`)[0])).toContain('1');
    await press(root, tagRow(2));
    expect(feedCalls()).toHaveLength(3);
    expect(tagsParam(feedCalls()[2].url)).toBe('2,4');
    expect(getFilter('feed').tags).toEqual([
      { id: '4', title: 'Тег 4' },
      { id: '2', title: 'Тег 2' },
    ]);
    expect(focusTargets()).toEqual([]);
    // Several tags, the only section: «Теги: 2», the count 1.
    const value = tf('filters.tags.chipMany', { n: '2' });
    expect(text(one(root, CHIP))).toContain(tf('filters.chip', { value }));
    expect(text(byTestId(root, `${CHIP}/count`)[0])).toContain('1');
    expect(one(root, CHIP).props.accessibilityLabel).toBe(
      tf('filters.chipA11yCount', { value, count: `1 ${tp('filters.activeCount', 1)}` }),
    );
    // Unchecking: the next refetch without it.
    await press(root, tagRow(4));
    expect(tagsParam(feedCalls()[feedCalls().length - 1].url)).toBe('2');
    // Back → the sheet on «Теги» with the titles; Back → the chip.
    focusMock.mockClear();
    await back();
    expect(visible(root, SHEET)).toBe(true);
    expect(lastFocusTarget()).toBe(TAGS_ROW);
    expect(one(root, TAGS_ROW).props.accessibilityLabel).toBe(`${t('filters.tags.title')} Тег 2`);
    await back();
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(CHIP);
    // Reopened: the checked tag first, then the loaded tags (deduped); focus on the tag «Сбросить».
    await press(root, CHIP);
    focusMock.mockClear();
    await press(root, TAGS_ROW);
    expect(levelFocusables(root)).toEqual([TAG_RESET, tagRow(2), tagRow(1), tagRow(3), tagRow(4), tagRow(5)]);
    expect(lastFocusTarget()).toBe(TAG_RESET);
    // The tag query is not refetched on mount (`refetchOnMount: false`): no second E13 while cached.
    expect(tagCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('matrix «Toggle», E5 fails: the error state behind; focus stays on the row', async () => {
    feed = req => (tagsParam(req.url) === null ? { status: 200, body: e5Page() } : { status: 403, body: {} });
    const root = await openTags();
    focusMock.mockClear();
    await press(root, tagRow(1));
    expect(visible(root, 'home/feed/error')).toBe(true);
    expect(visible(root, LEVEL)).toBe(true);
    expect(focusTargets().filter(id => id?.startsWith('home/') || id?.startsWith('state/'))).toEqual([]);
    await unmount(root);
  });

  it('matrix «Load more»: «Загрузить ещё» while isLast is false; next page with the opaque offset; focus stays, then the first new row when the row goes', async () => {
    tags = req => {
      const match = /[?&]offset=([^&]*)/.exec(req.url);
      const offset = match ? decodeURIComponent(match[1]) : null;
      return offset === null
        ? tagsPage(1, 3, 'p 2')
        : offset === 'p 2'
          ? tagsPage(3, 5, 'p3')
          : tagsPage(6, 7, null);
    };
    const root = await openTags();
    expect(levelFocusables(root)).toEqual([tagRow(1), tagRow(2), tagRow(3), LOAD_MORE]);
    expect(text(one(root, LOAD_MORE))).toContain(t('filters.tags.loadMore'));
    await focusOn(root, LOAD_MORE);
    focusMock.mockClear();
    await press(root, LOAD_MORE);
    expect(tagCalls()).toHaveLength(2);
    expect(tagCalls()[1].url).toBe(`https://api.boosty.to${E13}?limit=100&offset=p%202`);
    // Deduped (tag 3 twice); more pages: the row stays with focus.
    expect(levelFocusables(root)).toEqual([tagRow(1), tagRow(2), tagRow(3), tagRow(4), tagRow(5), LOAD_MORE]);
    expect(focusTargets()).toEqual([]);
    await press(root, LOAD_MORE);
    expect(tagCalls()[2].url).toContain('&offset=p3');
    expect(levelFocusables(root)).toEqual([1, 2, 3, 4, 5, 6, 7].map(tagRow));
    expect(lastFocusTarget()).toBe(tagRow(6));
    await unmount(root);
  });

  it('«Загрузить ещё» keeps focus after a page: the list scrolls to its end; a repeated cursor ends the paging', async () => {
    tags = req => {
      const match = /[?&]offset=([^&]*)/.exec(req.url);
      // Page 2 answers page 1's cursor again: no third request, no row.
      return match === null ? tagsPage(1, 3, 'c1') : tagsPage(4, 5, 'c1');
    };
    const root = await openTags();
    const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
    await focusOn(root, LOAD_MORE);
    await press(root, LOAD_MORE);
    expect(tagCalls()).toHaveLength(2);
    expect(levelFocusables(root)).toEqual([1, 2, 3, 4, 5].map(tagRow));
    expect(lastFocusTarget()).toBe(tagRow(4));
    // The row went (no scroll needed); with a page that keeps it, the scroll is asserted below.
    expect(scrollToEnd).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('«Загрузить ещё» stays focused when more pages remain: scrollToEnd keeps it in view', async () => {
    tags = req => {
      const match = /[?&]offset=([^&]*)/.exec(req.url);
      return match === null ? tagsPage(1, 3, 'c1') : tagsPage(4, 6, 'c2');
    };
    const root = await openTags();
    const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
    await focusOn(root, LOAD_MORE);
    await press(root, LOAD_MORE);
    expect(levelFocusables(root)).toEqual([...[1, 2, 3, 4, 5, 6].map(tagRow), LOAD_MORE]);
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('matrix «Load more», the page fails: «Повторить» replaces it with focus; OK reloads that page', async () => {
    let fail = true;
    tags = req =>
      /offset=/.test(req.url)
        ? fail
          ? { status: 500, body: {} }
          : tagsPage(3, 4, null)
        : tagsPage(1, 2, 'p2');
    const root = await openTags();
    await focusOn(root, LOAD_MORE);
    focusMock.mockClear();
    await press(root, LOAD_MORE);
    await settle(WITH_TIMERS);
    expect(levelFocusables(root)).toEqual([tagRow(1), tagRow(2), RETRY]);
    expect(lastFocusTarget()).toBe(RETRY);
    fail = false;
    focusMock.mockClear();
    await press(root, RETRY);
    expect(tagCalls()[tagCalls().length - 1].url).toContain('&offset=p2');
    expect(levelFocusables(root)).toEqual([1, 2, 3, 4].map(tagRow));
    expect(lastFocusTarget()).toBe(tagRow(3));
    await unmount(root);
  });

  it('matrix «Tag reset»: the tag «Сбросить» clears the tags only (access kept); focus → the first tag row', async () => {
    const root = await openSheet();
    await press(root, 'filters/access/all');
    focusMock.mockClear();
    await press(root, TAGS_ROW);
    await press(root, tagRow(2));
    await press(root, tagRow(3));
    expect(text(one(root, CHIP))).toContain(t('filters.title'));
    expect(text(byTestId(root, `${CHIP}/count`)[0])).toContain('2');
    focusMock.mockClear();
    const calls = feedCalls().length;
    await press(root, TAG_RESET);
    expect(getFilter('feed')).toEqual({ access: 'all', period: { kind: 'all' }, tags: [] });
    expect(visible(root, TAG_RESET)).toBe(false);
    expect(lastFocusTarget()).toBe(tagRow(1));
    // «Все посты» without tags was cached: no E5 (within staleTime).
    expect(feedCalls()).toHaveLength(calls);
    await back();
    expect(one(root, TAGS_ROW).props.accessibilityLabel).toBe(
      `${t('filters.tags.title')} ${t('filters.tags.none')}`,
    );
    expect(visible(root, RESET)).toBe(true);
    await unmount(root);
  });

  it('matrix «Sheet reset»: access + tags → the sheet «Сбросить» clears all; focus → «Доступные мне»', async () => {
    const root = await openSheet();
    await press(root, 'filters/access/bought');
    await press(root, TAGS_ROW);
    await press(root, tagRow(1));
    await back();
    focusMock.mockClear();
    await press(root, RESET);
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    expect(lastFocusTarget()).toBe('filters/access/allowed');
    expect(byTestId(root, `${CHIP}/count`)).toHaveLength(0);
    await unmount(root);
  });

  it('matrix «Key stability»: A+B and B+A are one query key (one E5)', async () => {
    const root = await openTags();
    await press(root, tagRow(1));
    await press(root, tagRow(2));
    await press(root, tagRow(1));
    await press(root, tagRow(1));
    expect(getFilter('feed').tags.map(tag => tag.id)).toEqual(['2', '1']);
    // A → A+B → B → B+A: the cached A+B key, no new request.
    const sent = feedCalls().map(call => tagsParam(call.url));
    expect(sent).toEqual([null, '1', '1,2', '2']);
    expect(JSON.stringify(queryKeys.subscriptionFeed(getFilter('feed')))).toBe(
      JSON.stringify(
        queryKeys.subscriptionFeed({
          ...DEFAULT_FILTER,
          tags: [
            { id: '1', title: 'x' },
            { id: '2', title: 'y' },
          ],
        }),
      ),
    );
    await unmount(root);
  });

  it('300 tags: a virtualized list with stable keys (not every row rendered)', async () => {
    tags = () => tagsPage(1, 300, null);
    const root = await openTags();
    const rendered = levelFocusables(root);
    expect(rendered[0]).toBe(tagRow(1));
    expect(rendered.length).toBeLessThan(300);
    expect(new Set(rendered).size).toBe(rendered.length);
    const list = byTestId(root, LEVEL)[0].queryAll(n => typeof n.props.keyExtractor === 'function')[0];
    expect(list.props.data).toHaveLength(300);
    expect(list.props.keyExtractor(list.props.data[299], 299)).toBe(tagRow(300));
    await unmount(root);
  });

  it('the list takes its box\'s measured height (device: the TV list wrapper ignores flex)', async () => {
    const root = await openTags();
    const listOf = () =>
      byTestId(root, LEVEL)[0].queryAll(n => typeof n.props.keyExtractor === 'function')[0];
    expect(StyleSheet.flatten(listOf().props.style).flex).toBe(1);
    await act(async () => {
      byTestId(root, 'filters/tags/box')[0].props.onLayout({ nativeEvent: { layout: { height: 480 } } });
    });
    const style = StyleSheet.flatten(listOf().props.style);
    expect(style.height).toBe(480);
    expect(style.flex).toBeUndefined();
    await unmount(root);
  });
});

describe('Epic 3 retro V3: no pin badge on Главная', () => {
  it('a pinned post (E5 isPinned) shows no pin badge and no «Закреплено» label (only Автор passes `showPinned`)', async () => {
    feed = () => ({
      status: 200,
      body: {
        data: { posts: [feedPost(0, { isPinned: true }), feedPost(1), feedPost(2)], blogs: [], counters: {} },
        extra: { offset: cursorFor(3), isLast: true },
      },
    });
    const root = await renderApp();
    expect(cardIds(root)).toEqual(['home/feed/feed-post-0', 'home/feed/feed-post-1', 'home/feed/feed-post-2']);
    expect(visible(root, 'home/feed/feed-post-0/pin')).toBe(false);
    const label = one(root, 'home/feed/feed-post-0').props.accessibilityLabel as string;
    expect(label).not.toContain(tf('postCard.a11yPinned', { label: '' }).trim());
    expect(label).not.toContain(t('postCard.pinned'));
    expect(text(root)).not.toContain(t('postCard.pinned'));
    await unmount(root);
  });
});
