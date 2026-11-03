/**
 * Story 12.3 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: Главная's «в эфире» plaque (E2 + E15 for at most 10
 * subscribed authors, sequential, 5 min TTL), one test per row of the spec's
 * I/O matrix: nobody live, one live (with and without «Продолжить
 * просмотр»), several, not playable, the cap, the TTL (Главная reopened,
 * app resume), errors, OK → the live Player and Back → the plaque, the focus
 * rules, and the removal of События (4 sidebar items, no E18 anywhere).
 * Also the stale-resume request count that eventsFlow held (now without
 * E18). The keychain, BackHandler and the native focus command are faked:
 * these tests prove which element the app asks to focus, not native focus
 * movement (device checks, docs/testing.md).
 */
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { AppState } from 'react-native';
import App, { navigationRef } from '../src/app/App';
import { QUERY_STALE_TIME_MS, queryClient, resetQueryCache } from '../src/app/queryClient';
import { LIVE_PLAQUE_TTL_MS } from '../src/features/home';
import { type FixtureReply, type FixtureRequest, type FixtureTransport } from '../src/shared/api/fixtureTransport';
import { queryKeys } from '../src/shared/api';
import { accountScope } from '../src/shared/account';
import type { LivePlaqueItem } from '../src/features/home';
import { focusRestoration } from '../src/shared/focus';
import { logger } from '../src/shared/services/logger';
import { progressStore } from '../src/shared/services/progress';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { E5_PATH, cursorOf, e5Page, e5Posts } from '../src/test/feedFixtures';
import { e3Body, e4Path, e15None, e15Path, e15Stream, syntheticBlogPosts } from '../src/test/authorFixtures';
import { paragraph, postDetail } from '../src/test/postFixtures';
import { E2_PATH, blogUrlOf, e1NoBlogBody, subscriptionsBody } from '../src/test/subscriptionFixtures';
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
  resetKeychain,
  resetRecorders,
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
/** The live Player's engine (the PlayerEngine port, mocked). */
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));
/** The real FlashList behind the recorder `lists` (`src/test/flow`; `onEndReached` held back). */
jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());

const focusMock = requestHostFocus as jest.Mock;

const { settle, render, focusOn, press, back } = createFlow({
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
/** The retired E18 path: never requested any more. */
const E18 = '/v1/notification/standalone/event/';
const PLAQUE = (n: number) => `home/live/${blogUrlOf(n)}`;
const FIRST_CARD = () => `home/feed/${e5Posts()[0].id as string}`;
const E15_RE = /^\/v1\/blog\/([^/]+)\/video_stream$/;
const E8_RE = /^\/v1\/blog\/([^/]+)\/post\/([^/]+)$/;
/** A live stream with access and a live-edge URL (the synthetic fixture). */
const live = (title = 'Stream') => e15Stream('live', { title });

type Reply = FixtureReply | Promise<FixtureReply> | undefined;

let subscriptions: number;
let e15: (blogUrl: string, req: FixtureRequest) => Reply;
let e8: (blogUrl: string, postId: string) => Reply;
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
  subscriptions = 3;
  e15 = () => e15None();
  e8 = (blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, paragraph('Text')) });
  transport = installFixtureTransport(req => {
    const stream = E15_RE.exec(req.path);
    if (stream) {
      return e15(decodeURIComponent(stream[1]), req);
    }
    if (req.method === 'PUT' && /^\/v1\/blog\/[^/]+\/video_stream\/heartbeat\/viewer$/.test(req.path)) {
      return { status: 200 };
    }
    if (req.path === E1) {
      return { status: 200, body: e1NoBlogBody() };
    }
    if (req.path === E5_PATH) {
      return { status: 200, body: e5Page() };
    }
    if (req.path === E2_PATH) {
      return { status: 200, body: subscriptionsBody(subscriptions) };
    }
    const single = E8_RE.exec(req.path);
    if (single) {
      return e8(decodeURIComponent(single[1]), decodeURIComponent(single[2]));
    }
    const posts = /^\/v1\/blog\/([^/]+)\/post\/$/.exec(req.path);
    if (posts) {
      return syntheticBlogPosts({ blogUrl: posts[1], total: 6 })(req);
    }
    const blog = /^\/v1\/blog\/([^/]+)$/.exec(req.path);
    if (blog) {
      return { status: 200, body: e3Body(blog[1], { title: 'Blog Title', owner: { name: 'Owner', hasAvatar: false } }) };
    }
    return undefined;
  });
});

afterEach(async () => {
  await resetQueryCache();
  await progressStore.reset();
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  jest.restoreAllMocks();
});

type Root = Awaited<ReturnType<typeof render>>;

const plaqueIds = (root: Root) => focusableIds(root).filter(id => id.startsWith('home/live/'));
const e15Calls = () => transport.calls.filter(c => E15_RE.test(c.path));
const e2Calls = () => transport.callsTo(E2_PATH);
const currentRoute = () => navigationRef.getCurrentRoute();

/** A local Continue entry (Story 4.2 shape). */
function seedContinue() {
  progressStore.put({
    ref: { blogUrl: blogUrlOf(1), postId: 'cw-post-1', mediaId: 'cw-v1' },
    positionSec: 600,
    durationSec: 3600,
    updatedAt: Date.now() - 60_000,
    meta: { title: 'Lesson 1', postTitle: 'Post 1', authorName: 'Author 1', previewUrl: null, durationSec: 3600 },
  });
}

/** Mocked AppState: `change(state)` drives the app's resume handler. */
function appStateDriver() {
  let handlers: Array<(state: string) => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
    handlers.push(listener);
    return { remove: () => { handlers = handlers.filter(h => h !== listener); } };
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

describe('matrix «События removed»', () => {
  it('the sidebar has Главная, Поиск, Подписки, Настройки; no E18 is sent', async () => {
    const root = await render(<App />);
    expect(focusableIds(root, byTestId(root, 'shell/sidebar')[0])).toEqual([
      'nav/home',
      'nav/search',
      'nav/subs',
      'nav/settings',
    ]);
    expect(transport.callsTo(E18)).toEqual([]);
    expect(queryClient.getQueryCache().findAll({ queryKey: ['events'] })).toEqual([]);
    await unmount(root);
  });
});

describe('matrix «Nobody live», «One live», «Several live», «Not playable»', () => {
  it('nobody live: E2 once and one E15 per author; no plaque row; initial focus on the first feed card', async () => {
    const root = await render(<App />);
    expect(e2Calls()).toHaveLength(1);
    expect(e15Calls().map(c => E15_RE.exec(c.path)?.[1])).toEqual([blogUrlOf(1), blogUrlOf(2), blogUrlOf(3)]);
    expect(visible(root, 'home/live')).toBe(false);
    expect(plaqueIds(root)).toEqual([]);
    expect(lastFocusTarget()).toBe(FIRST_CARD());
    await unmount(root);
  });

  it('one live, no Continue: the plaque sits above the feed title row (not in the list); initial focus unchanged', async () => {
    e15 = blog => (blog === blogUrlOf(2) ? live('Big stream') : e15None());
    const root = await render(<App />);
    expect(plaqueIds(root)).toEqual([PLAQUE(2)]);
    const ids = focusableIds(root);
    expect(ids.indexOf(PLAQUE(2))).toBeLessThan(ids.indexOf('home/refresh'));
    expect(byTestId(root, 'home/header')).toHaveLength(0);
    const plaque = byTestId(root, PLAQUE(2))[0];
    expect(plaque.props.accessibilityLabel).toBe('Owner 2 в эфире: Big stream');
    expect(lastFocusTarget()).toBe(FIRST_CARD());
    expect(focusTargets()).not.toContain(PLAQUE(2));
    await unmount(root);
  });

  it('one live with Continue: the plaque row is the first part of the list header, above «Продолжить просмотр»', async () => {
    seedContinue();
    e15 = blog => (blog === blogUrlOf(1) ? live() : e15None());
    const root = await render(<App />);
    const ids = focusableIds(root);
    expect(ids.indexOf(PLAQUE(1))).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(PLAQUE(1))).toBeLessThan(ids.indexOf('home/continue/cw-v1'));
    const header = byTestId(root, 'home/header')[0];
    expect(focusableIds(root, header)[0]).toBe(PLAQUE(1));
    // Initial focus: the first Continue card, as before.
    expect(lastFocusTarget()).toBe('home/continue/cw-v1');
    await unmount(root);
  });

  it('several live: one plaque each, in E2 order', async () => {
    e15 = blog => (blog === blogUrlOf(1) || blog === blogUrlOf(3) ? live() : e15None());
    const root = await render(<App />);
    expect(plaqueIds(root)).toEqual([PLAQUE(1), PLAQUE(3)]);
    await unmount(root);
  });

  it('not playable (locked, no live source, scheduled): no plaque', async () => {
    e15 = blog =>
      blog === blogUrlOf(1)
        ? e15Stream('locked')
        : blog === blogUrlOf(2)
          ? e15Stream('live', { data: [] })
          : e15Stream('scheduled');
    const root = await render(<App />);
    expect(plaqueIds(root)).toEqual([]);
    await unmount(root);
  });
});

describe('matrix «Cap» and «Errors»', () => {
  it('15 subscriptions: E15 for the first 10 only, one at a time', async () => {
    subscriptions = 15;
    let inFlight = 0;
    let maxInFlight = 0;
    e15 = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return e15None();
    };
    const root = await render(<App />);
    expect(e15Calls().map(c => E15_RE.exec(c.path)?.[1])).toEqual(
      Array.from({ length: 10 }, (_, i) => blogUrlOf(i + 1)),
    );
    expect(maxInFlight).toBe(1);
    await unmount(root);
  });

  it('one E15 fails: that author is skipped, the others show', async () => {
    e15 = blog => (blog === blogUrlOf(1) ? { status: 500 } : live());
    const root = await render(<App />);
    expect(plaqueIds(root)).toEqual([PLAQUE(2), PLAQUE(3)]);
    expect(visible(root, 'home/feed/error')).toBe(false);
    await unmount(root);
  });

  it('429: the pass stops; nothing is shown; no error UI; no retry', async () => {
    e15 = blog => (blog === blogUrlOf(1) ? live() : { status: 429 });
    const root = await render(<App />);
    expect(e15Calls()).toHaveLength(2);
    expect(plaqueIds(root)).toEqual([]);
    expect(lastFocusTarget()).toBe(FIRST_CARD());
    expect(JSON.stringify(logger.entries())).not.toMatch(/synthetic-blog|Owner/);
    await unmount(root);
  });

  it('E2 fails: no E15, nothing shown, the feed as usual', async () => {
    transport = installFixtureTransport(req => (req.path === E2_PATH ? { status: 503 } : req.path === E5_PATH ? { status: 200, body: e5Page() } : req.path === E1 ? { status: 200, body: e1NoBlogBody() } : undefined));
    const root = await render(<App />);
    expect(e15Calls()).toHaveLength(0);
    expect(plaqueIds(root)).toEqual([]);
    expect(lastFocusTarget()).toBe(FIRST_CARD());
    await unmount(root);
  });
});

describe('matrix «TTL»', () => {
  it('Главная left and reopened within 5 min: no new E2/E15; after 5 min: one new pass', async () => {
    e15 = blog => (blog === blogUrlOf(2) ? live() : e15None());
    const root = await render(<App />);
    expect(e15Calls()).toHaveLength(3);
    await press(root, 'nav/subs');
    await press(root, 'nav/home');
    expect(e15Calls()).toHaveLength(3);
    expect(plaqueIds(root)).toEqual([PLAQUE(2)]);
    await press(root, 'nav/subs');
    jest.setSystemTime(Date.now() + LIVE_PLAQUE_TTL_MS + 1_000);
    await press(root, 'nav/home');
    expect(e15Calls()).toHaveLength(6);
    await unmount(root);
  });

  it('app resume: no pass within 5 min; one pass after 5 min; never polling while Главная is open', async () => {
    const change = appStateDriver();
    const root = await render(<App />);
    expect(e15Calls()).toHaveLength(3);
    // No polling: time passes with Главная open and nothing is sent.
    await act(async () => {
      jest.advanceTimersByTime(LIVE_PLAQUE_TTL_MS * 2);
    });
    await settle();
    expect(e15Calls()).toHaveLength(3);
    // The cached pass is now old: a resume runs one new pass (E2 is fresh-checked).
    await change('background');
    await change('active');
    expect(e15Calls()).toHaveLength(6);
    // A second resume right away: within the TTL, nothing.
    await change('background');
    await change('active');
    expect(e15Calls()).toHaveLength(6);
    await unmount(root);
  });

  it('the plaque key is not under `stream`: invalidating every stream does not refetch it', async () => {
    const root = await render(<App />);
    expect(e15Calls()).toHaveLength(3);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.allStreams() });
    });
    await settle();
    expect(e15Calls()).toHaveLength(3);
    await unmount(root);
  });
});

describe('matrix «OK» and «Focus»', () => {
  it('OK on a plaque: the live Player for that blog (origin Главная); Back → Главная with focus on the plaque', async () => {
    e15 = blog => (blog === blogUrlOf(2) ? live() : e15None());
    const root = await render(<App />);
    await focusOn(root, PLAQUE(2));
    await press(root, PLAQUE(2));
    expect(currentRoute()?.name).toBe('Player');
    expect(currentRoute()?.params).toEqual({
      ref: { kind: 'live', blogUrl: blogUrlOf(2) },
      origin: { routeKey: 'shell', sectionId: 'home', focusId: PLAQUE(2) },
    });
    expect(JSON.stringify(currentRoute()?.params)).not.toMatch(/example\.invalid|sig=/);
    focusMock.mockClear();
    await back();
    expect(currentRoute()?.name).toBe('Shell');
    expect(lastFocusTarget()).toBe(PLAQUE(2));
    await unmount(root);
  });

  it('Back from a plaque → `nav/home`', async () => {
    e15 = blog => (blog === blogUrlOf(1) ? live() : e15None());
    const root = await render(<App />);
    await focusOn(root, PLAQUE(1));
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe('nav/home');
    await unmount(root);
  });

  it('↑ guides: the plaque row guide points at the remembered plaque (else the first)', async () => {
    e15 = blog => (blog === blogUrlOf(1) || blog === blogUrlOf(2) ? live() : e15None());
    const root = await render(<App />);
    expect(destinationIds('home/live')).toEqual([PLAQUE(1)]);
    await focusOn(root, PLAQUE(2));
    expect(destinationIds('home/live')).toEqual([PLAQUE(2)]);
    await unmount(root);
  });

  it('the focused plaque disappears after a new pass: focus → the next plaque, else the first feed card', async () => {
    e15 = blog => (blog === blogUrlOf(1) ? live() : e15None());
    const root = await render(<App />);
    await focusOn(root, PLAQUE(1));
    focusMock.mockClear();
    await act(async () => {
      queryClient.setQueryData(queryKeys.livePlaque(), []);
    });
    await settle();
    expect(plaqueIds(root)).toEqual([]);
    expect(lastFocusTarget()).toBe(FIRST_CARD());
    await unmount(root);
  });
});

describe('stale resume request count (moved from eventsFlow, without E18)', () => {
  it('Подписки → Автор A → Пост → Автор B; one stale resume sends E1, then E5 + E4×2 + E15×2 and nothing else (Главная unmounted: no plaque pass, no E18)', async () => {
    const change = appStateDriver();
    const POST_ID = 'blog-post-0';
    // The post's author row points to another blog (distinct E4 and E15 keys).
    e8 = (_blogUrl, postId) => ({ status: 200, body: postDetail(blogUrlOf(2), postId, paragraph('Text')) });
    const root = await render(<App />);
    await press(root, 'nav/subs');
    await press(root, `subs/tile/${blogUrlOf(1)}`);
    await press(root, `author/${blogUrlOf(1)}/post/${POST_ID}`);
    await press(root, `post/${POST_ID}/author`);
    expect(navigationRef.getRootState()?.routes.map(r => r.name)).toEqual(['Shell', 'Author', 'Post', 'Author']);
    const before = transport.calls.length;
    // Главная is unmounted (the Shell shows Подписки): the plaque has no observer.
    expect(queryClient.getQueryCache().find({ queryKey: queryKeys.livePlaque() })?.isActive()).toBe(false);
    await change('background');
    jest.setSystemTime(Date.now() + Math.max(QUERY_STALE_TIME_MS, LIVE_PLAQUE_TTL_MS) + 1_000);
    await change('active');
    const sent = transport.calls.slice(before);
    const count = (path: string, pageOne = false) =>
      sent.filter(c => c.path === path && (!pageOne || cursorOf(c.url) === null)).length;
    expect(count(E1)).toBe(1);
    // The cached feed's head refresh (ADR 0010), as before.
    expect(count(E5_PATH, true)).toBe(1);
    expect(count(e4Path(blogUrlOf(1)), true)).toBe(1);
    expect(count(e4Path(blogUrlOf(2)), true)).toBe(1);
    expect(count(e15Path(blogUrlOf(1)))).toBe(1);
    expect(count(e15Path(blogUrlOf(2)))).toBe(1);
    expect(count(E18)).toBe(0);
    expect(count(E2_PATH)).toBe(0);
    expect(sent).toHaveLength(1 + 1 + 2 + 2);
    await unmount(root);
  });

  it('on Главная with Пост on top: one stale resume after the TTL sends E1, E5 and one plaque pass (E2 + E15×3)', async () => {
    const change = appStateDriver();
    const root = await render(<App />);
    await press(root, FIRST_CARD());
    expect(currentRoute()?.name).toBe('Post');
    const before = transport.calls.length;
    await change('background');
    jest.setSystemTime(Date.now() + LIVE_PLAQUE_TTL_MS + 1_000);
    await change('active');
    const sent = transport.calls.slice(before);
    expect(sent.filter(c => c.path === E1)).toHaveLength(1);
    expect(sent.filter(c => c.path === E5_PATH && cursorOf(c.url) === null)).toHaveLength(1);
    // The plaque pass: E2 (its cache is older than 60 s) and one E15 per author.
    expect(sent.filter(c => c.path === E2_PATH)).toHaveLength(1);
    expect(sent.filter(c => E15_RE.test(c.path))).toHaveLength(3);
    expect(sent.filter(c => c.path === E18)).toHaveLength(0);
    expect(sent).toHaveLength(1 + 1 + 1 + 3);
    await unmount(root);
  });
});

/** A cached plaque entry (the pass's result shape). */
const item = (n: number): LivePlaqueItem => ({ blogUrl: blogUrlOf(n), name: `Owner ${n}`, avatarUrl: null, title: 'Stream' });
async function setPlaques(items: LivePlaqueItem[]) {
  await act(async () => {
    queryClient.setQueryData(queryKeys.livePlaque(), items);
  });
  await settle();
}

describe('review fixes (Story 12.3)', () => {
  it('leaving Главная mid-pass: the started pass completes once; back within the TTL → no second E2/E15 batch', async () => {
    const gate = deferred<void>();
    e15 = async () => {
      await gate.promise;
      return e15None();
    };
    const root = await render(<App />);
    expect(e2Calls()).toHaveLength(1);
    expect(e15Calls()).toHaveLength(1);
    await press(root, 'nav/subs');
    await act(async () => {
      gate.resolve();
    });
    await settle();
    expect(e15Calls()).toHaveLength(3);
    await press(root, 'nav/home');
    expect(e2Calls()).toHaveLength(1);
    expect(e15Calls()).toHaveLength(3);
    await unmount(root);
  });

  it('the Shell is focused again (Back from Пост, no AppState change): one new pass after the TTL, none within it', async () => {
    const root = await render(<App />);
    expect(e15Calls()).toHaveLength(3);
    await press(root, FIRST_CARD());
    expect(currentRoute()?.name).toBe('Post');
    await back();
    expect(currentRoute()?.name).toBe('Shell');
    expect(e2Calls()).toHaveLength(1);
    expect(e15Calls()).toHaveLength(3);
    await press(root, FIRST_CARD());
    jest.setSystemTime(Date.now() + LIVE_PLAQUE_TTL_MS + 1_000);
    await back();
    expect(e2Calls()).toHaveLength(2);
    expect(e15Calls()).toHaveLength(6);
    await unmount(root);
  });

  it('a plaque that turned unplayable: OK → the Player leaves, no QR; a new pass drops the plaque, focus → the fallback; a later Автор shows no stale QR', async () => {
    e15 = blog => (blog === blogUrlOf(2) ? live() : e15None());
    const root = await render(<App />);
    expect(plaqueIds(root)).toEqual([PLAQUE(2)]);
    expect(e15Calls()).toHaveLength(3);
    e15 = blog => (blog === blogUrlOf(2) ? e15Stream('locked') : e15None());
    await focusOn(root, PLAQUE(2));
    focusMock.mockClear();
    await press(root, PLAQUE(2));
    await settle();
    expect(currentRoute()?.name).toBe('Shell');
    expect(visible(root, 'dialog/qr')).toBe(false);
    // The Player's own E15, then a new pass (E15×3).
    expect(e15Calls()).toHaveLength(3 + 1 + 3);
    expect(plaqueIds(root)).toEqual([]);
    expect(lastFocusTarget()).toBe(FIRST_CARD());
    await press(root, 'nav/subs');
    await press(root, `subs/tile/${blogUrlOf(2)}`);
    expect(currentRoute()?.name).toBe('Author');
    expect(visible(root, 'dialog/qr')).toBe(false);
    await unmount(root);
  });

  it('two plaques, the focused first one removed by a pass → focus on the second', async () => {
    e15 = blog => (blog === blogUrlOf(1) || blog === blogUrlOf(2) ? live() : e15None());
    const root = await render(<App />);
    await focusOn(root, PLAQUE(1));
    focusMock.mockClear();
    await setPlaques([item(2)]);
    expect(lastFocusTarget()).toBe(PLAQUE(2));
    await unmount(root);
  });

  it('with Continue, the only (focused) plaque removed → the first Continue card', async () => {
    seedContinue();
    e15 = blog => (blog === blogUrlOf(1) ? live() : e15None());
    const root = await render(<App />);
    await focusOn(root, PLAQUE(1));
    focusMock.mockClear();
    await setPlaques([]);
    expect(lastFocusTarget()).toBe('home/continue/cw-v1');
    await unmount(root);
  });

  it('Back from the live Player after a pass dropped that plaque → the first remaining plaque', async () => {
    e15 = blog => (blog === blogUrlOf(1) || blog === blogUrlOf(2) ? live() : e15None());
    const root = await render(<App />);
    await press(root, PLAQUE(1));
    expect(currentRoute()?.name).toBe('Player');
    await setPlaques([item(2)]);
    focusMock.mockClear();
    await back();
    expect(currentRoute()?.name).toBe('Shell');
    expect(lastFocusTarget()).toBe(PLAQUE(2));
    await unmount(root);
  });

  it('Back from the live Player after a pass dropped every plaque → the first Continue card', async () => {
    seedContinue();
    e15 = blog => (blog === blogUrlOf(1) ? live() : e15None());
    const root = await render(<App />);
    await press(root, PLAQUE(1));
    expect(currentRoute()?.name).toBe('Player');
    await setPlaques([]);
    focusMock.mockClear();
    await back();
    expect(currentRoute()?.name).toBe('Shell');
    expect(lastFocusTarget()).toBe('home/continue/cw-v1');
    await unmount(root);
  });

  it('account isolation: A’s plaques are not shown for B within the TTL; B gets its own pass', async () => {
    e15 = blog => (blog === blogUrlOf(1) ? live() : e15None());
    const rootA = await render(<App />);
    expect(plaqueIds(rootA)).toEqual([PLAQUE(1)]);
    await unmount(rootA);
    // Account switch: AccountScope wipes every store (the query cache too).
    await act(async () => {
      await accountScope.reset();
    });
    expect(queryClient.getQueryData(queryKeys.livePlaque())).toBeUndefined();
    resetKeychain({ 'boostytv.session': STORED.replace('"1001"', '"1002"') });
    const before = e15Calls().length;
    e15 = blog => (blog === blogUrlOf(3) ? live() : e15None());
    const rootB = await render(<App />);
    expect(e15Calls().length - before).toBe(3);
    expect(plaqueIds(rootB)).toEqual([PLAQUE(3)]);
    await unmount(rootB);
  });

  it('an empty stream title reads «Эфир без названия»', async () => {
    e15 = blog => (blog === blogUrlOf(1) ? live('') : e15None());
    const root = await render(<App />);
    expect(byTestId(root, PLAQUE(1))[0].props.accessibilityLabel).toBe('Owner 1 в эфире: Эфир без названия');
    expect(JSON.stringify(byTestId(root, `${PLAQUE(1)}/title`)[0].toJSON())).toContain('Эфир без названия');
    await unmount(root);
  });
});
