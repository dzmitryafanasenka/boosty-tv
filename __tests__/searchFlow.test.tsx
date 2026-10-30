/**
 * Story 5.6 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: «Поиск по подпискам» (E6), every row of the spec's
 * I/O matrix, the focus rules of docs/focus-map.md §4 E, the return from
 * Пост, the sidebar round trip and a 300-result list. The keychain,
 * BackHandler and the native focus command are faked: these tests prove
 * which element the app asks to focus, not native focus movement or the
 * system keyboard (device checks, docs/testing.md). The system keyboard is
 * the platform's: «Готово» is `onSubmitEditing`; Back with it open never
 * reaches JS.
 */
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { AppState } from 'react-native';
import type { Root } from 'test-renderer';
import App, { navigationRef } from '../src/app/App';
import { QUERY_STALE_TIME_MS, queryClient, resetQueryCache } from '../src/app/queryClient';
import { searchQueryStore } from '../src/features/search';
import { accountScope } from '../src/shared/account';
import { queryKeys } from '../src/shared/api';
import type { FixtureReply, FixtureRequest, FixtureTransport } from '../src/shared/api/fixtureTransport';
import { DEFAULT_FILTER, filtersStore, getFilter, type Filter } from '../src/shared/filters';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { progressStore } from '../src/shared/services/progress';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { E5_PATH, cursorFor, cursorOf, e5Page, feedPost } from '../src/test/feedFixtures';
import { paragraph, postDetail } from '../src/test/postFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import e6Search1 from '../src/test/fixtures/boosty/e6-feed-search-1.json';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  deferred,
  destinationIds,
  focusTargets,
  gridRowItems,
  installFixtureTransport,
  installNativeModules,
  lastFocusTarget,
  listProps,
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
jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () =>
  require('../src/test/tvEventMock'),
);
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));
jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());

const focusMock = requestHostFocus as jest.Mock;

const { settle, render, one, focusOn, press, type, submit, back } = createFlow({
  settle: { rounds: 30, timerRounds: 0 },
  one: 'focusableOrInput',
  pressFocuses: true,
  submitSettles: true,
});

const STORED = JSON.stringify({
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 4_000_000_000_000,
  accountId: '1001',
});
const E1 = '/v1/user/current';
const E6 = '/v1/search/feed/post/';
const E13 = '/v1/search/feed/tag/';
const FIELD = 'search/field';
const FIELD_HOST = 'search/field/host';
const CHIP = 'search/action/filters';
const RETRY = 'search/retry';
const RESET = 'search/reset-filters';
const LOAD_MORE_RETRY = 'search/results/retry';
const RESULT = (n: number) => `search/result/feed-post-${n}`;

type Reply = FixtureReply | Promise<FixtureReply> | undefined;
let search: (req: FixtureRequest) => Reply;
let other: (req: FixtureRequest) => Reply;
let transport: FixtureTransport;

/** The query an E6 request carries (decoded). */
const queryOf = (url: string) => {
  const match = /[?&]search_query=([^&]*)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
};

/** An E6 handler over `total` synthetic results in pages of 10 (cursor `cursor:<n>`). */
function syntheticSearch(total: number, { pageSize = 10, overlap = 0 } = {}) {
  return (request: FixtureRequest): FixtureReply => {
    const cursor = cursorOf(request.url);
    const start = cursor === null ? 0 : Math.max(0, cursor - overlap);
    const end = Math.min((cursor ?? 0) + pageSize, total);
    const searchPosts = Array.from({ length: Math.max(0, end - start) }, (_, i) => ({
      post: feedPost(start + i),
      rank: 5,
      headline: 'redacted',
    }));
    return {
      status: 200,
      body: { data: { blogs: [], searchPosts }, extra: { offset: cursorFor(end), isLast: end >= total } },
    };
  };
}

const emptySearch = (): FixtureReply => ({
  status: 200,
  body: { data: { blogs: [], searchPosts: [] }, extra: { offset: 'end', isLast: true } },
});

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
  search = syntheticSearch(25);
  other = () => undefined;
  transport = installFixtureTransport(req => {
    if (req.path === E1) {
      return { status: 200, body: e1Ok.body };
    }
    if (req.path === E5_PATH) {
      return { status: 200, body: e5Page() };
    }
    if (req.path === E6) {
      return search(req);
    }
    return other(req);
  });
});

afterEach(async () => {
  await progressStore.reset();
  filtersStore.getState().clear();
  searchQueryStore.getState().clear();
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  jest.restoreAllMocks();
});

const searchCalls = () => transport.callsTo(E6);
const resultIds = (root: Root) =>
  root.container
    .queryAll(n => n.props.focusable === true && typeof n.props.testID === 'string')
    .map(n => n.props.testID as string)
    .filter(id => id.startsWith('search/result/'));
/** The results grid's FlashList props (last render). */
const grid = () => listProps('search/results/list');
const gridPosts = () => gridRowItems<{ id: string }>('search/results/list', 'posts');

/** The App on Главная, then OK on «Поиск». */
async function openSearch() {
  const root = await render(<App />);
  focusMock.mockClear();
  await press(root, 'nav/search');
  expect(visible(root, 'search/screen')).toBe(true);
  return root;
}

/** Type `query` into the field (it has focus) and press «Готово». */
async function runSearch(root: Root, query: string) {
  await focusOn(root, FIELD);
  await type(root, FIELD, query);
  await submit(root, FIELD);
}

describe('matrix «Open»', () => {
  it('OK on «Поиск»: focus on the field, the hint, the chip; no request', async () => {
    const root = await openSearch();
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    expect(visible(root, 'search/hint')).toBe(true);
    expect(text(root)).toContain(t('search.hint'));
    expect(one(root, FIELD).props.accessibilityLabel).toBe(t('search.fieldLabel'));
    expect(text(root)).toContain(t('search.fieldLabel'));
    expect(visible(root, CHIP)).toBe(true);
    expect(searchCalls()).toHaveLength(0);
    // Typing alone sends nothing (no search-as-you-type, no debounce).
    await focusOn(root, FIELD);
    await type(root, FIELD, 'капу');
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    await settle();
    expect(searchCalls()).toHaveLength(0);
    expect(navigationRef.getCurrentRoute()?.name).toBe('Shell');
    await unmount(root);
  });

  it('focus is not stolen when opened by focus alone (no OK)', async () => {
    const root = await render(<App />);
    focusMock.mockClear();
    await focusOn(root, 'nav/search');
    expect(visible(root, 'search/screen')).toBe(false);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });
});

describe('matrix «Submit»', () => {
  it('«капуста» + «Готово»: E6 with search_query and the `search` Filter params; skeleton; focus → the first result', async () => {
    const page = deferred();
    search = () => page.promise;
    const root = await openSearch();
    await runSearch(root, '  капуста ');
    expect(searchCalls()).toHaveLength(1);
    const url = searchCalls()[0].url;
    expect(queryOf(url)).toBe('капуста');
    expect(url).toContain('only_allowed=true&only_bought=false');
    expect(url).toContain('limit=10&comments_limit=0&reply_limit=0');
    expect(cursorOf(url)).toBeNull();
    expect(visible(root, 'search/skeleton')).toBe(true);
    expect(visible(root, 'search/hint')).toBe(false);
    // The field keeps focus while it loads (the keyboard closed).
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    expect(searchQueryStore.getState().query).toBe('капуста');
    await act(async () => {
      page.resolve(syntheticSearch(25)({ url, path: E6 } as FixtureRequest));
    });
    await settle();
    expect(visible(root, 'search/skeleton')).toBe(false);
    expect(resultIds(root).slice(0, 3)).toEqual([RESULT(0), RESULT(1), RESULT(2)]);
    expect(lastFocusTarget()).toBe(RESULT(0));
    // The field keeps the submitted text.
    expect(one(root, FIELD).props.value).toBe('  капуста ');
    // Story 7.1 (Never-list): Поиск never asks for a live stream (E15).
    expect(transport.calls.filter(c => /\/video_stream$/.test(c.path))).toHaveLength(0);
    await unmount(root);
  });

  it('the live E6 shape (sanitized fixture) renders its posts', async () => {
    search = () => ({ status: 200, body: e6Search1.body });
    const root = await openSearch();
    await runSearch(root, 'q');
    const ids = e6Search1.body.data.searchPosts.map(item => `search/result/${item.post.id}`);
    expect(resultIds(root)).toEqual(ids);
    expect(lastFocusTarget()).toBe(ids[0]);
    await unmount(root);
  });

  it('E6 fails: «Не удалось выполнить поиск» + «Повторить» focused; the query is kept; retry → results, first result', async () => {
    search = () => ({ status: 403, body: {} });
    const root = await openSearch();
    await runSearch(root, 'капуста');
    expect(visible(root, 'search/error')).toBe(true);
    expect(text(root)).toContain(t('search.errorTitle'));
    expect(lastFocusTarget()).toBe(RETRY);
    expect(one(root, FIELD).props.value).toBe('капуста');
    expect(searchQueryStore.getState().query).toBe('капуста');
    const before = searchCalls().length;
    search = syntheticSearch(5);
    await press(root, RETRY);
    expect(searchCalls().length).toBe(before + 1);
    expect(queryOf(searchCalls()[searchCalls().length - 1].url)).toBe('капуста');
    expect(resultIds(root)).toEqual([0, 1, 2, 3, 4].map(RESULT));
    expect(lastFocusTarget()).toBe(RESULT(0));
    await unmount(root);
  });

  it('«Готово» from the error view on a slow device (the settle frame fires before the fetching render): the outcome still lands on the fetched results', async () => {
    search = () => ({ status: 400, body: {} });
    const root = await openSearch();
    await runSearch(root, 'капуста');
    expect(lastFocusTarget()).toBe(RETRY);
    const reply = deferred();
    let pending: FixtureRequest | null = null;
    search = req => {
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
      await runSearch(root, 'капуста');
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      expect(visible(root, 'search/error')).toBe(true);
      expect(queryClient.isFetching({ queryKey: queryKeys.feedSearch('капуста', DEFAULT_FILTER) })).toBe(1);
    } finally {
      notifyManager.setScheduler(callback => {
        Promise.resolve().then(callback);
      });
    }
    focusMock.mockClear();
    await act(async () => {
      held.splice(0).forEach(callback => callback());
    });
    reply.resolve(syntheticSearch(5)(pending as unknown as FixtureRequest));
    await settle();
    expect(focusTargets()).not.toContain(RETRY);
    expect(lastFocusTarget()).toBe(RESULT(0));
    await unmount(root);
  });

  it('«Повторить» fails again: focus stays on «Повторить»; the outcome is settled (a later change takes no focus)', async () => {
    search = () => ({ status: 403, body: {} });
    const root = await openSearch();
    await runSearch(root, 'капуста');
    expect(lastFocusTarget()).toBe(RETRY);
    const before = searchCalls().length;
    focusMock.mockClear();
    await press(root, RETRY);
    expect(searchCalls().length).toBe(before + 1);
    expect(visible(root, 'search/error')).toBe(true);
    expect(lastFocusTarget()).toBe(RETRY);
    // Settled: results arriving later (a Filter change) take no focus.
    search = syntheticSearch(5);
    focusMock.mockClear();
    await act(async () => {
      filtersStore.getState().setAccess('search', 'all');
    });
    await settle();
    expect(resultIds(root)).toHaveLength(5);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('«Готово» from the error view fails again: focus → «Повторить»', async () => {
    search = () => ({ status: 403, body: {} });
    const root = await openSearch();
    await runSearch(root, 'капуста');
    expect(visible(root, 'search/error')).toBe(true);
    const before = searchCalls().length;
    focusMock.mockClear();
    await runSearch(root, 'капуста');
    expect(searchCalls().length).toBe(before + 1);
    expect(visible(root, 'search/error')).toBe(true);
    expect(lastFocusTarget()).toBe(RETRY);
    // Settled: a later change takes no focus.
    search = syntheticSearch(5);
    focusMock.mockClear();
    await act(async () => {
      filtersStore.getState().setAccess('search', 'all');
    });
    await settle();
    expect(resultIds(root)).toHaveLength(5);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('the user moved away while it loaded: the results never take focus', async () => {
    const page = deferred();
    search = () => page.promise;
    const root = await openSearch();
    await runSearch(root, 'капуста');
    await focusOn(root, CHIP);
    focusMock.mockClear();
    await act(async () => {
      page.resolve(syntheticSearch(5)({ url: '', path: E6 } as FixtureRequest));
    });
    await settle();
    expect(resultIds(root)).toHaveLength(5);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });
});

describe('matrix «Nothing found»', () => {
  it('default Filter: «Ничего не найдено», no action; focus → the field', async () => {
    search = emptySearch;
    const root = await openSearch();
    await runSearch(root, 'zqxj');
    expect(visible(root, 'search/empty')).toBe(true);
    expect(text(root)).toContain(t('search.emptyTitle'));
    expect(visible(root, RESET)).toBe(false);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    await unmount(root);
  });

  it('filters active: + «Сбросить фильтры», focused; OK resets `search` only and re-runs', async () => {
    filtersStore.getState().setAccess('search', 'bought');
    filtersStore.getState().setAccess('feed', 'all');
    search = req => (/only_bought=true/.test(req.url) ? emptySearch() : syntheticSearch(5)(req));
    const root = await openSearch();
    await runSearch(root, 'капуста');
    expect(searchCalls()[0].url).toContain('only_allowed=false&only_bought=true');
    expect(visible(root, 'search/filtered-empty')).toBe(true);
    expect(text(root)).toContain(t('search.emptyTitle'));
    expect(one(root, RESET).props.accessibilityLabel).toBe(t('search.resetFilters'));
    expect(lastFocusTarget()).toBe(RESET);
    await press(root, RESET);
    expect(getFilter('search')).toEqual(DEFAULT_FILTER);
    // The feed's Filter is another scope: untouched.
    expect(getFilter('feed').access).toBe('all');
    expect(searchCalls()).toHaveLength(2);
    expect(searchCalls()[1].url).toContain('only_allowed=true&only_bought=false');
    expect(queryOf(searchCalls()[1].url)).toBe('капуста');
    expect(resultIds(root)).toHaveLength(5);
    expect(lastFocusTarget()).toBe(RESULT(0));
    await unmount(root);
  });
});

describe('Epic 5 retro A1: «Сбросить фильтры» re-runs the query under the default Filter', () => {
  /** Default search first (cached), then a Filter set behind it, a filtered empty result. */
  async function filteredEmptyOver(root: Root, query: string) {
    await runSearch(root, query);
    await act(async () => {
      filtersStore.getState().setAccess('search', 'all');
    });
    await settle();
    expect(visible(root, 'search/filtered-empty')).toBe(true);
    await focusOn(root, RESET);
    focusMock.mockClear();
  }

  it('onto a cached, also empty default result: E6 runs again with the default params; focus → the field; no stale outcome later', async () => {
    search = emptySearch;
    const root = await openSearch();
    await filteredEmptyOver(root, 'zqxj');
    const before = searchCalls().length;
    expect(searchCalls()[before - 1].url).toContain('only_allowed=false&only_bought=false');
    await press(root, RESET);
    // The action goes with the view: the field takes focus natively.
    await focusOn(root, FIELD);
    await settle();
    expect(getFilter('search')).toEqual(DEFAULT_FILTER);
    expect(searchCalls()).toHaveLength(before + 1);
    const url = searchCalls()[before].url;
    expect(url).toContain('only_allowed=true&only_bought=false');
    expect(queryOf(url)).toBe('zqxj');
    expect(cursorOf(url)).toBeNull();
    expect(visible(root, 'search/empty')).toBe(true);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    // A later, unrelated change (results arrive): no outcome is pending, so
    // focus is not moved off the field.
    focusMock.mockClear();
    search = syntheticSearch(4);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: queryKeys.feedSearch('zqxj', DEFAULT_FILTER) });
    });
    await settle();
    expect(resultIds(root)).toHaveLength(4);
    expect(focusTargets().filter(id => id?.startsWith('search/result/'))).toEqual([]);
    await unmount(root);
  });

  it('the re-run fails (5xx, after its retries): «Повторить» focused', async () => {
    search = emptySearch;
    const root = await openSearch();
    await filteredEmptyOver(root, 'zqxj');
    const before = searchCalls().length;
    search = () => ({ status: 503, body: {} });
    await press(root, RESET, { settle: { timerRounds: 30 } });
    await focusOn(root, FIELD);
    await settle({ timerRounds: 30 });
    expect(getFilter('search')).toEqual(DEFAULT_FILTER);
    // The re-run happened (with the AD-6 retries of a 5xx).
    expect(searchCalls().length).toBeGreaterThan(before);
    for (const call of searchCalls().slice(before)) {
      expect(call.url).toContain('only_allowed=true&only_bought=false');
      expect(queryOf(call.url)).toBe('zqxj');
    }
    expect(visible(root, 'search/error')).toBe(true);
    expect(lastFocusTarget()).toBe(RETRY);
    await unmount(root);
  });

  it('the default-Filter result is not cached: one E6 under the default Filter; focus → the first result', async () => {
    filtersStore.getState().setAccess('search', 'all');
    search = req => (/only_allowed=false/.test(req.url) ? emptySearch() : syntheticSearch(3)(req));
    const root = await openSearch();
    await runSearch(root, 'капуста');
    expect(visible(root, 'search/filtered-empty')).toBe(true);
    expect(queryClient.getQueryState(queryKeys.feedSearch('капуста', DEFAULT_FILTER))).toBeUndefined();
    expect(lastFocusTarget()).toBe(RESET);
    const before = searchCalls().length;
    await press(root, RESET);
    await focusOn(root, FIELD);
    await settle();
    expect(searchCalls()).toHaveLength(before + 1);
    expect(searchCalls()[before].url).toContain('only_allowed=true&only_bought=false');
    expect(queryOf(searchCalls()[before].url)).toBe('капуста');
    expect(lastFocusTarget()).toBe(RESULT(0));
    await unmount(root);
  });

  it('onto a cached default result with posts: E6 runs again; focus → the first result', async () => {
    search = req => (/only_allowed=false/.test(req.url) ? emptySearch() : syntheticSearch(5)(req));
    const root = await openSearch();
    await filteredEmptyOver(root, 'капуста');
    const before = searchCalls().length;
    await press(root, RESET);
    await focusOn(root, FIELD);
    await settle();
    expect(searchCalls()).toHaveLength(before + 1);
    expect(searchCalls()[before].url).toContain('only_allowed=true&only_bought=false');
    expect(queryOf(searchCalls()[before].url)).toBe('капуста');
    expect(resultIds(root)).toHaveLength(5);
    expect(lastFocusTarget()).toBe(RESULT(0));
    await unmount(root);
  });
});

describe('matrix «Blank»', () => {
  it('«   » + «Готово»: the hint, no request; focus stays on the field', async () => {
    const root = await openSearch();
    await runSearch(root, '   ');
    expect(searchCalls()).toHaveLength(0);
    expect(visible(root, 'search/hint')).toBe(true);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    expect(searchQueryStore.getState().query).toBeNull();
    await unmount(root);
  });

  it('a blank «Готово» after results: back to the hint, the results gone, no request', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    expect(resultIds(root).length).toBeGreaterThan(0);
    await runSearch(root, ' ');
    expect(searchCalls()).toHaveLength(1);
    expect(visible(root, 'search/hint')).toBe(true);
    expect(resultIds(root)).toHaveLength(0);
    await unmount(root);
  });
});

describe('matrix «Back with keyboard open» and Back', () => {
  it('typing without «Готово» sends nothing; Back (keyboard closed by the system) → the sidebar on «Поиск»', async () => {
    const root = await openSearch();
    await focusOn(root, FIELD);
    await type(root, FIELD, 'капуста');
    // The system keyboard's Back never reaches JS: no submit, no request.
    expect(searchCalls()).toHaveLength(0);
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe('nav/search');
    expect(searchCalls()).toHaveLength(0);
    expect(one(root, FIELD).props.value).toBe('капуста');
    // Back again: Главная.
    await focusOn(root, 'nav/search');
    await back();
    expect(lastFocusTarget()).toBe('nav/home');
    expect(visible(root, 'search/screen')).toBe(false);
    await unmount(root);
  });

  it('Back from a result → the sidebar on «Поиск»', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    await focusOn(root, RESULT(4));
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe('nav/search');
    await unmount(root);
  });
});

describe('focus moves (focus-map §4 E)', () => {
  it('the field row is a guide to the field (↑ from the first row); the guide around the grid (↓ from the field row) → the remembered result, else the first', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    expect(destinationIds('search/field-row')).toEqual([FIELD_HOST]);
    // Nothing remembered since «Готово»: the first result.
    await focusOn(root, CHIP);
    await focusOn(root, FIELD);
    expect(destinationIds('search/results/guide')).toEqual([RESULT(0)]);
    await focusOn(root, RESULT(4));
    expect(destinationIds('search/results/guide')).toEqual([]);
    await focusOn(root, FIELD);
    expect(destinationIds('search/results/guide')).toEqual([RESULT(4)]);
    // The chip sits in the same row (→ from the field, natively); it is
    // focusable only while the row has focus, so ↑ from the third column
    // reaches the row guide (→ the field), not the chip (device check).
    const chipFocusable = () =>
      byTestId(root, 'search/field-row')[0].queryAll(
        n => n.props.testID === CHIP && n.props.focusable === true,
      ).length;
    expect(chipFocusable()).toBe(1);
    await focusOn(root, CHIP);
    expect(chipFocusable()).toBe(1);
    await focusOn(root, RESULT(2));
    expect(chipFocusable()).toBe(0);
    await focusOn(root, FIELD);
    expect(chipFocusable()).toBe(1);
    await unmount(root);
  });
});

describe('matrix «Filter change»', () => {
  it('a sheet toggle refetches behind the sheet with the new params; focus stays in the sheet; the old list keeps its first page', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    // Load page 2 (focus on the last row).
    await focusOn(root, RESULT(8));
    expect(searchCalls()).toHaveLength(2);
    const defaultKey = queryKeys.feedSearch('капуста', DEFAULT_FILTER);
    expect(queryClient.getQueryData<{ pages: unknown[] }>(defaultKey)?.pages).toHaveLength(2);
    // ↑ to the field (the row guide), → «Фильтры».
    await focusOn(root, FIELD);
    await focusOn(root, CHIP);
    await press(root, CHIP);
    expect(visible(root, 'filters/sheet')).toBe(true);
    focusMock.mockClear();
    await press(root, 'filters/access/all');
    expect(searchCalls()).toHaveLength(3);
    const url = searchCalls()[2].url;
    expect(url).toContain('only_allowed=false&only_bought=false');
    expect(queryOf(url)).toBe('капуста');
    expect(cursorOf(url)).toBeNull();
    expect(getFilter('search').access).toBe('all');
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    // Nothing behind the sheet took focus.
    expect(focusTargets()).toEqual([]);
    expect(visible(root, 'filters/sheet')).toBe(true);
    // The chip shows the `search` Filter.
    expect(byTestId(root, `${CHIP}/count`).length).toBeGreaterThan(0);
    // Trimmed to its first page (one request when switched back while stale).
    expect(queryClient.getQueryData<{ pages: unknown[] }>(defaultKey)?.pages).toHaveLength(1);
    await back();
    expect(visible(root, 'filters/sheet')).toBe(false);
    expect(lastFocusTarget()).toBe(CHIP);
    await unmount(root);
  });

  it('the `search` sheet offers the feed tags (E13) and sends `tags_ids` with the query', async () => {
    other = req =>
      req.path === E13
        ? {
            status: 200,
            body: {
              data: { searchTags: [{ tag: { id: 7, title: 'Тег 7' }, rank: 0 }] },
              extra: { offset: 'end', isLast: true },
            },
          }
        : undefined;
    const root = await openSearch();
    await runSearch(root, 'капуста');
    await focusOn(root, CHIP);
    await press(root, CHIP);
    await press(root, 'filters/tags');
    await press(root, 'filters/tag/7');
    expect(getFilter('search').tags).toEqual([{ id: '7', title: 'Тег 7' }]);
    // Story 5.7: the `search` tag level never asks for blog tags (E14).
    expect(transport.calls.some(c => c.path.includes('/post/tag/'))).toBe(false);
    const url = searchCalls()[searchCalls().length - 1].url;
    expect(url).toContain('tags_ids=7');
    expect(queryOf(url)).toBe('капуста');
    expect(getFilter('feed')).toEqual(DEFAULT_FILTER);
    await unmount(root);
  });
});

describe('matrix «Load more»', () => {
  it('focus in the last row loads the next page with the opaque offset; deduped by id; focus unchanged', async () => {
    search = syntheticSearch(25, { overlap: 2 });
    const root = await openSearch();
    await runSearch(root, 'капуста');
    focusMock.mockClear();
    await focusOn(root, RESULT(8));
    expect(searchCalls()).toHaveLength(2);
    expect(cursorOf(searchCalls()[1].url)).toBe(10);
    expect(queryOf(searchCalls()[1].url)).toBe('капуста');
    const ids = gridPosts().map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });

  it('a failed page: the inline «Повторить»; OK reloads that page; success → the first new result', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    search = () => ({ status: 403, body: {} });
    await focusOn(root, RESULT(8));
    expect(visible(root, LOAD_MORE_RETRY)).toBe(true);
    expect(resultIds(root)).toHaveLength(10);
    search = syntheticSearch(25);
    await focusOn(root, LOAD_MORE_RETRY);
    focusMock.mockClear();
    await press(root, LOAD_MORE_RETRY);
    expect(cursorOf(searchCalls()[searchCalls().length - 1].url)).toBe(10);
    expect(resultIds(root)).toContain(RESULT(10));
    expect(lastFocusTarget()).toBe(RESULT(10));
    await unmount(root);
  });
});

describe('matrix «Return from Post»', () => {
  beforeEach(() => {
    other = req => {
      const match = /^\/v1\/blog\/([^/]+)\/post\/([^/]+)$/.exec(req.path);
      return match
        ? { status: 200, body: postDetail(match[1], decodeURIComponent(match[2]), paragraph('Текст')) }
        : undefined;
    };
  });

  it('OK on a result opens Пост (sidebar current: Поиск); Back → the same query, Filter and card', async () => {
    filtersStore.getState().setAccess('search', 'all');
    const root = await openSearch();
    await runSearch(root, 'капуста');
    await press(root, RESULT(4));
    expect(navigationRef.getCurrentRoute()?.name).toBe('Post');
    expect(navigationRef.getCurrentRoute()?.params).toEqual(
      expect.objectContaining({ postId: 'feed-post-4', section: 'search' }),
    );
    expect(visible(root, 'post/nav/search/current')).toBe(true);
    const calls = searchCalls().length;
    focusMock.mockClear();
    await back();
    expect(navigationRef.getCurrentRoute()?.name).toBe('Shell');
    expect(lastFocusTarget()).toBe(RESULT(4));
    expect(one(root, FIELD).props.value).toBe('капуста');
    expect(getFilter('search').access).toBe('all');
    // No new request: the results are a snapshot.
    expect(searchCalls()).toHaveLength(calls);
    await unmount(root);
  });

  it('the card is gone on return → its neighbour by index; every card gone → the field', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    await press(root, RESULT(4));
    const key = queryKeys.feedSearch('капуста', DEFAULT_FILTER);
    type Data = { pages: Array<{ posts: Array<{ id: string }> }> };
    await act(async () => {
      queryClient.setQueryData<Data>(key, data =>
        data
          ? { ...data, pages: data.pages.map(p => ({ ...p, posts: p.posts.filter(x => x.id !== 'feed-post-4') })) }
          : data,
      );
    });
    await settle();
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe(RESULT(5));
    // Every card gone: the field.
    await press(root, RESULT(5));
    await act(async () => {
      queryClient.setQueryData(key, { pages: [{ posts: [], nextCursor: null }], pageParams: [null] });
    });
    await settle();
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    await unmount(root);
  });
});

describe('matrix «Sidebar round trip»', () => {
  it('results → Главная → Поиск: the same query and results from the cache, focus on the field, no request', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    await focusOn(root, RESULT(2));
    await focusOn(root, 'nav/home');
    await press(root, 'nav/home');
    expect(visible(root, 'search/screen')).toBe(false);
    focusMock.mockClear();
    await press(root, 'nav/search');
    expect(one(root, FIELD).props.value).toBe('капуста');
    expect(resultIds(root).slice(0, 3)).toEqual([RESULT(0), RESULT(1), RESULT(2)]);
    expect(lastFocusTarget()).toBe(FIELD_HOST);
    expect(searchCalls()).toHaveLength(1);
    await unmount(root);
  });

  it('sign-out / account switch (AccountScope) wipes the query; a fresh Поиск shows the hint', async () => {
    searchQueryStore.getState().submit('капуста');
    await act(async () => {
      await accountScope.reset();
    });
    expect(searchQueryStore.getState().query).toBeNull();
  });
});

describe('matrix «Same query again»', () => {
  it('«Готово» on the shown query: page 1 is refetched and the list is reset to it', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    await focusOn(root, RESULT(8));
    expect(searchCalls()).toHaveLength(2);
    expect(resultIds(root).length).toBeGreaterThan(10);
    focusMock.mockClear();
    await runSearch(root, 'капуста');
    expect(searchCalls()).toHaveLength(3);
    expect(cursorOf(searchCalls()[2].url)).toBeNull();
    const key = queryKeys.feedSearch('капуста', DEFAULT_FILTER);
    expect(queryClient.getQueryData<{ pages: unknown[] }>(key)?.pages).toHaveLength(1);
    expect(gridPosts()).toHaveLength(9);
    expect(lastFocusTarget()).toBe(RESULT(0));
    await unmount(root);
  });

  it('the refetch fails: «Повторить» with focus', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    search = () => ({ status: 403, body: {} });
    await runSearch(root, 'капуста');
    expect(visible(root, 'search/error')).toBe(true);
    expect(lastFocusTarget()).toBe(RETRY);
    await unmount(root);
  });

  it('another query: its own key and page 1; the old list is trimmed', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    await focusOn(root, RESULT(8));
    await runSearch(root, 'борщ');
    expect(queryOf(searchCalls()[searchCalls().length - 1].url)).toBe('борщ');
    const old = queryKeys.feedSearch('капуста', DEFAULT_FILTER);
    expect(queryClient.getQueryData<{ pages: unknown[] }>(old)?.pages).toHaveLength(1);
    expect(lastFocusTarget()).toBe(RESULT(0));
    await unmount(root);
  });
});

describe('matrix «Key isolation»', () => {
  it('the same Filter on `feed` and `search`: different keys; a `feed` change never refetches the search', async () => {
    const filter: Filter = { access: 'all', period: { kind: 'all' }, tags: [] };
    expect(JSON.stringify(queryKeys.feedSearch('q', filter))).not.toBe(
      JSON.stringify(queryKeys.subscriptionFeed(filter)),
    );
    const root = await openSearch();
    await runSearch(root, 'капуста');
    const e5 = transport.callsTo(E5_PATH).length;
    await act(async () => {
      filtersStore.getState().setAccess('feed', 'all');
    });
    await settle();
    expect(searchCalls()).toHaveLength(1);
    expect(transport.callsTo(E5_PATH).length).toBe(e5);
    await unmount(root);
  });

  it('no session check on an all-locked result page', async () => {
    search = () => ({
      status: 200,
      body: {
        data: {
          searchPosts: [0, 1, 2].map(n => ({ post: { ...feedPost(n), hasAccess: false, data: [] } })),
        },
        extra: { offset: 'x', isLast: true },
      },
    });
    const root = await openSearch();
    const e1 = transport.callsTo(E1).length;
    await runSearch(root, 'капуста');
    expect(resultIds(root)).toHaveLength(3);
    expect(transport.callsTo(E1).length).toBe(e1);
    await unmount(root);
  });
});

describe('owner decision Q2 a: no background refresh of the results', () => {
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

  it('a stale resume (background → active past staleTime) sends no E6; the grid is unchanged', async () => {
    const root = await openSearch();
    await runSearch(root, 'капуста');
    const before = gridPosts().map(p => p.id);
    const calls = searchCalls().length;
    expect(appStateHandlers.length).toBeGreaterThan(0);
    await changeAppState('background');
    jest.setSystemTime(Date.now() + QUERY_STALE_TIME_MS + 1_000);
    await changeAppState('active');
    expect(searchCalls()).toHaveLength(calls);
    expect(gridPosts().map(p => p.id)).toEqual(before);
    await unmount(root);
  });
});

describe('300 results', () => {
  it('stable post.id keys, one row type, pages in order with the opaque cursor, no duplicates', async () => {
    search = syntheticSearch(300);
    const root = await openSearch();
    await runSearch(root, 'капуста');
    for (let page = 1; page < 30; page += 1) {
      const props = grid();
      await act(async () => {
        props.onEndReached?.();
      });
      await settle();
    }
    expect(searchCalls()).toHaveLength(30);
    expect(searchCalls().map(c => cursorOf(c.url))).toEqual(
      [null, ...Array.from({ length: 29 }, (_, i) => (i + 1) * 10)],
    );
    const props = grid();
    const rows = props.data as Array<{ key: string; posts: Array<{ id: string }> }>;
    expect(rows).toHaveLength(100);
    expect(rows.map(r => r.key)).toEqual(rows.map(r => r.posts[0].id));
    expect(new Set(rows.map(r => props.getItemType(r))).size).toBe(1);
    const ids = rows.flatMap(r => r.posts.map(p => p.id));
    expect(new Set(ids).size).toBe(300);
    // Virtualized: far fewer cards are mounted than loaded.
    expect(resultIds(root).length).toBeLessThan(300);
    await unmount(root);
  });
});
