/**
 * Story 7.5 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: События (E18 via TanStack Query), one test per row
 * of the spec's I/O matrix, the focus rules of docs/focus-map.md §5 J, OK →
 * Автор (section `events`, the LiveCard for a live stream), Back → the same
 * row, and the account-scoped read marks. The keychain, BackHandler and the
 * native focus command are faked: these tests prove which element the app
 * asks to focus, not native focus movement (device checks, docs/testing.md).
 */
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { AppState, StyleSheet } from 'react-native';
import App, { navigationRef } from '../src/app/App';
import { QUERY_STALE_TIME_MS, queryClient, resetQueryCache } from '../src/app/queryClient';
import { eventReadMarksStore } from '../src/features/events';
import { accountScope } from '../src/shared/account';
import { type FixtureReply, type FixtureRequest, type FixtureTransport } from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { colors } from '../src/shared/ui';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { E5_PATH, e5Page } from '../src/test/feedFixtures';
import { e3Body, e4Path, e15None, e15Path, e15Stream, syntheticBlogPosts } from '../src/test/authorFixtures';
import { cursorOf } from '../src/test/feedFixtures';
import { paragraph, postDetail } from '../src/test/postFixtures';
import { E2_PATH, blogUrlOf, e1NoBlogBody, subscriptionsBody } from '../src/test/subscriptionFixtures';
import e18Live from '../src/test/fixtures/boosty/e18-events.json';
import e18Synthetic from '../src/test/fixtures/boosty/e18-events-synthetic.json';
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
/** The live Player's engine is never reached from События; mocked in case. */
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));

/** `phaseFlags.events`, switchable per test (the Shell and Автор read the sections at mount). */
const mockEventsFlag = { on: true };
jest.mock('../src/app/phaseFlags', () => {
  const actual = jest.requireActual('../src/app/phaseFlags');
  const flags = {
    ...actual.phaseFlags,
    get events() {
      return mockEventsFlag.on;
    },
  };
  return {
    ...actual,
    phaseFlags: flags,
    enabledSections: (f: Record<string, boolean> = flags) => actual.enabledSections(f),
  };
});

/** The real FlashList behind the recorder `lists` (`src/test/flow`; `onEndReached` held back). */
jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());

const focusMock = requestHostFocus as jest.Mock;

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
const E18 = '/v1/notification/standalone/event/';
const ROW = (id: number | string) => `events/row/${id}`;
const ACTION = 'state/events/action';
const LIVE_BLOG = blogUrlOf(1);
const BLOG2 = blogUrlOf(2);

type Json = Record<string, unknown>;
type Reply = FixtureReply | Promise<FixtureReply> | undefined;

/** One synthetic E18 event; `n` sets the id (5000 + n) and the time (newer for a larger n). */
function event(n: number, overrides: Json = {}): Json {
  return {
    id: 5000 + n,
    type: 'post_new',
    eventTime: 1_790_000_000 + n * 3600,
    isRead: true,
    author: { id: 1001, name: `Author ${n}`, avatarUrl: 'https://example.invalid/avatar', hasAvatar: true },
    blog: { blogUrl: BLOG2 },
    aggregation: { id: 1002, type: 'x' },
    ...overrides,
  };
}
const e18Body = (events: unknown[]): Json => ({
  data: { notificationStandalone: { events, count: { total: events.length, unread: 0, byEventType: [] }, updateTime: 0 } },
});

let e18: (req: FixtureRequest) => Reply;
let e15: (req: FixtureRequest) => Reply;
/** E8 (a single post), for the nested-stack resume test. */
let e8: (blogUrl: string, postId: string) => Reply;
const E8_RE = /^\/v1\/blog\/([^/]+)\/post\/([^/]+)$/;
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
  mockEventsFlag.on = true;
  e18 = () => ({ status: 200, body: e18Body([event(3, { type: 'video_stream_start', isRead: false, blog: { blogUrl: LIVE_BLOG } }), event(2), event(1, { type: 'promo_new' })]) });
  e15 = () => e15None();
  e8 = (blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, paragraph('Text')) });
  transport = installFixtureTransport(req => {
    if (req.path === E18) {
      return e18(req);
    }
    if (/^\/v1\/blog\/[^/]+\/video_stream$/.test(req.path)) {
      return e15(req);
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
      return { status: 200, body: subscriptionsBody(3) };
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
  eventReadMarksStore.getState().clear();
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  jest.restoreAllMocks();
});

type Root = Awaited<ReturnType<typeof render>>;

const e18Calls = () => transport.callsTo(E18);
const rowIds = (root: Root) => focusableIds(root).filter(id => id.startsWith('events/row/'));
const currentRoute = () => navigationRef.getCurrentRoute();
/** The plain strings of a rendered node (nested Text included), joined. */
function plain(json: unknown): string {
  if (typeof json === 'string') {
    return json;
  }
  if (Array.isArray(json)) {
    return json.map(plain).join('');
  }
  if (json && typeof json === 'object' && 'children' in json) {
    return plain((json as { children: unknown }).children ?? '');
  }
  return '';
}
const nodeText = (root: Root, testID: string) => plain(byTestId(root, testID)[0]?.toJSON?.());
const rowText = (root: Root, id: number | string) => nodeText(root, `${ROW(id)}/line`);

/** The App on Главная, then OK on «События». */
async function openEvents() {
  const root = await render(<App />);
  focusMock.mockClear();
  await press(root, 'nav/events');
  return root;
}

describe('matrix «Flag off»', () => {
  it('`events: false`: no sidebar item, no E18 (also not from Автор\'s sidebar)', async () => {
    mockEventsFlag.on = false;
    const root = await render(<App />);
    expect(focusableIds(root, byTestId(root, 'shell/sidebar')[0])).toEqual([
      'nav/home',
      'nav/search',
      'nav/subs',
      'nav/settings',
    ]);
    expect(visible(root, 'nav/events')).toBe(false);
    await press(root, 'nav/subs');
    await press(root, `subs/tile/${LIVE_BLOG}`);
    expect(currentRoute()?.name).toBe('Author');
    expect(visible(root, 'author/nav/events')).toBe(false);
    expect(e18Calls()).toHaveLength(0);
    await unmount(root);
  });

  it('flag on: «События» between Подписки and Настройки; focus alone sends nothing', async () => {
    const root = await render(<App />);
    expect(focusableIds(root, byTestId(root, 'shell/sidebar')[0])).toEqual([
      'nav/home',
      'nav/search',
      'nav/subs',
      'nav/events',
      'nav/settings',
    ]);
    expect(one(root, 'nav/events').props.accessibilityLabel).toBe(t('shell.nav.events'));
    await focusOn(root, 'nav/events');
    await settle();
    expect(visible(root, 'events')).toBe(false);
    expect(e18Calls()).toHaveLength(0);
    await unmount(root);
  });
});

describe('matrix «Loading» and «List»', () => {
  it('Loading: a skeleton of rows; focus stays on nav/events; nothing focusable in the content', async () => {
    const reply = deferred();
    e18 = () => reply.promise;
    const root = await openEvents();
    expect(visible(root, 'events/skeleton')).toBe(true);
    expect(text(root)).toContain(t('events.title'));
    expect(focusTargets()).toEqual([]);
    expect(focusableIds(root, byTestId(root, 'shell/content/events')[0])).toEqual([]);
    reply.resolve({ status: 200, body: e18Body([event(1)]) });
    await settle();
    expect(visible(root, 'events/skeleton')).toBe(false);
    expect(rowIds(root)).toEqual([ROW(5001)]);
    await unmount(root);
  });

  it('List: rows newest first; initial focus on the first row; one GET with no params and the content profile', async () => {
    e18 = () => ({ status: 200, body: e18Body([event(1), event(3), event(2)]) });
    const root = await openEvents();
    expect(rowIds(root)).toEqual([ROW(5003), ROW(5002), ROW(5001)]);
    expect(lastFocusTarget()).toBe(ROW(5003));
    expect(e18Calls()).toHaveLength(1);
    expect(e18Calls()[0].url).toBe(`https://api.boosty.to${E18}`);
    expect(e18Calls()[0].headers.Authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    expect(e18Calls()[0].headers['X-App']).toBeUndefined();
    // Every request is a GET; no read mutation, no comments request.
    expect(transport.calls.every(c => c.method === 'GET')).toBe(true);
    expect(transport.calls.every(c => !c.path.includes('comment'))).toBe(true);
    await unmount(root);
  });

  it('List: ↑ ↓ between rows (one column, the content zone traps ↑ ↓); ← to the sidebar (its destination is nav/events)', async () => {
    const root = await openEvents();
    const [zone] = byTestId(root, 'shell/content/events');
    expect(zone.props).toMatchObject({ trapFocusUp: true, trapFocusDown: true });
    expect(zone.props.trapFocusLeft).toBeFalsy();
    expect(destinationIds('shell/sidebar')).toEqual(['nav/events']);
    await focusOn(root, ROW(5002));
    expect(destinationIds('shell/content/events')).toEqual([ROW(5002)]);
    // One column: the list's items are the rows, newest first.
    expect(listProps('events/list').data.map((e: { id: string }) => e.id)).toEqual(['5003', '5002', '5001']);
    await unmount(root);
  });

  it('a row shows the avatar, name and text on one line, the time and the unread dot (accent); read rows have no dot', async () => {
    const root = await openEvents();
    expect(byTestId(root, `${ROW(5003)}/avatar`)[0].props.source).toEqual({ uri: 'https://example.invalid/avatar' });
    expect(byTestId(root, `${ROW(5003)}/line`)[0].props.numberOfLines).toBe(1);
    expect(rowText(root, 5003)).toBe(`Author 3 ${t('events.text.streamStart')}`);
    expect(visible(root, `${ROW(5003)}/time`)).toBe(true);
    const dot = byTestId(root, `${ROW(5003)}/dot`)[0];
    expect(StyleSheet.flatten(dot.props.style).backgroundColor).toBe(colors.accent);
    expect(visible(root, `${ROW(5002)}/dot`)).toBe(false);
    expect(one(root, ROW(5003)).props.accessibilityLabel).toMatch(/^Новое\. Author 3: Начался эфир\. Эфир\. /);
    expect(one(root, ROW(5002)).props.accessibilityLabel).toMatch(/^Author 2: Новый пост\. /);
    await unmount(root);
  });

  it('the focused row shows one ring and scales without reflow; the surface never clips the ring', async () => {
    const root = await openEvents();
    const before = StyleSheet.flatten(byTestId(root, `${ROW(5002)}/scale`)[0].props.style);
    await focusOn(root, ROW(5002));
    const after = StyleSheet.flatten(byTestId(root, `${ROW(5002)}/scale`)[0].props.style);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.overflow).toBeUndefined();
    expect(after.opacity).toBeUndefined();
    expect(after.backgroundColor).toBe(colors['surface-focus-row']);
    await unmount(root);
  });

  it('300 events: virtualized (fewer rows mounted), one request, no load-more', async () => {
    e18 = () => ({ status: 200, body: e18Body(Array.from({ length: 300 }, (_, i) => event(i + 1))) });
    const root = await openEvents();
    expect(listProps('events/list').data).toHaveLength(300);
    expect(rowIds(root).length).toBeLessThan(300);
    expect(lastFocusTarget()).toBe(ROW(5300));
    await focusOn(root, rowIds(root)[rowIds(root).length - 1]);
    await settle();
    expect(e18Calls()).toHaveLength(1);
    expect(listProps('events/list').onEndReached).toBeUndefined();
    await unmount(root);
  });
});

describe('matrix: event types', () => {
  it('Stream event: «Начался эфир» plus the «Эфир» chip (on colors.live)', async () => {
    const root = await openEvents();
    expect(rowText(root, 5003)).toContain(t('events.text.streamStart'));
    const chip = byTestId(root, `${ROW(5003)}/chip`)[0];
    expect(nodeText(root, `${ROW(5003)}/chip`)).toBe(t('events.streamChip'));
    expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe(colors.live);
    expect(visible(root, `${ROW(5002)}/chip`)).toBe(false);
    await unmount(root);
  });

  it('Post / promo: their own short text', async () => {
    const root = await openEvents();
    expect(rowText(root, 5002)).toContain(t('events.text.postNew'));
    expect(rowText(root, 5001)).toContain(t('events.text.promoNew'));
    await unmount(root);
  });

  it('Owner-side types (Q3 a): not shown', async () => {
    const owner = ['donation_new', 'subscriber_new', 'blog_stat_report_ok', 'post_buy', 'message_buy', 'bundle_buy', 'referal_new_user', 'support_ticket_update', 'level_subscribers_limit_reached', 'target_new'];
    e18 = () => ({ status: 200, body: e18Body([...owner.map((type, i) => event(i + 10, { type })), event(1)]) });
    const root = await openEvents();
    expect(rowIds(root)).toEqual([ROW(5001)]);
    await unmount(root);
  });

  it('the live E18 body (one `target_new`): no row, «Событий нет»', async () => {
    e18 = () => ({ status: 200, body: e18Live.body });
    const root = await openEvents();
    expect(visible(root, 'events/empty')).toBe(true);
    await unmount(root);
  });

  it('Unknown type: generic text', async () => {
    e18 = () => ({ status: 200, body: e18Body([event(1, { type: 'something_new' })]) });
    const root = await openEvents();
    expect(rowText(root, 5001)).toBe(`Author 1 ${t('events.text.generic')}`);
    expect(visible(root, `${ROW(5001)}/chip`)).toBe(false);
    await unmount(root);
  });

  it('Comment types: not shown; no comment text anywhere', async () => {
    e18 = () => ({
      status: 200,
      body: e18Body([event(2, { type: 'post_comment_new' }), event(3, { type: 'post_comment_new_reply' }), event(1)]),
    });
    const root = await openEvents();
    expect(rowIds(root)).toEqual([ROW(5001)]);
    expect(text(byTestId(root, 'events')[0])).not.toMatch(/коммент/i);
    await unmount(root);
  });

  it('Malformed (synthetic fixture: no id, a bad time): those events are dropped; a counts-only warning', async () => {
    e18 = () => ({ status: 200, body: e18Synthetic.body });
    const root = await openEvents();
    expect(rowIds(root)).toEqual([ROW(1184), ROW(1189), ROW(1191)]);
    const dropped = logger.entries().filter(e => e.scope === 'event' && e.message === 'dropped');
    expect(dropped).toEqual([expect.objectContaining({ level: 'warn', fields: { count: '2' } })]);
    // Every field but the wall-clock `time`, which can contain «1184» by chance.
    const logged = logger.entries().map(({ level, scope, message, fields }) => ({ level, scope, message, fields }));
    expect(JSON.stringify(logged)).not.toMatch(/synthetic-blog|example\.invalid|1184|post_comment|video_stream/);
    await unmount(root);
  });
});

describe('matrix «OK», «OK, no blog», «Back»', () => {
  it('OK on a stream row of a live author: Автор (section `events`); focus on its LiveCard; the row marked read locally, no request for it', async () => {
    e15 = () => e15Stream('live');
    const root = await openEvents();
    expect(visible(root, `${ROW(5003)}/dot`)).toBe(true);
    focusMock.mockClear();
    await press(root, ROW(5003));
    expect(currentRoute()?.name).toBe('Author');
    expect(currentRoute()?.params).toEqual({ blogUrl: LIVE_BLOG, section: 'events' });
    // Автор's sidebar: «События» is the current item.
    expect(visible(root, 'author/nav/events/current')).toBe(true);
    const targets = focusTargets().filter(Boolean);
    expect(targets[targets.length - 1]).toBe(`author/${LIVE_BLOG}/live`);
    // The player never starts from События.
    expect(routeNamesIncludePlayer()).toBe(false);
    expect(transport.calls.filter(c => c.method !== 'GET')).toEqual([]);
    expect(eventReadMarksStore.getState().ids.has('5003')).toBe(true);
    // Back: the same row by id, now without the dot (the local read mark).
    focusMock.mockClear();
    await back();
    expect(currentRoute()?.name).toBe('Shell');
    expect(lastFocusTarget()).toBe(ROW(5003));
    expect(visible(root, `${ROW(5003)}/dot`)).toBe(false);
    expect(one(root, ROW(5003)).props.accessibilityLabel).not.toMatch(/^Новое/);
    expect(e18Calls()).toHaveLength(1);
    await unmount(root);
  });

  it('OK on a row of an author without a stream: Автор with the first post focused (7.1 rule unchanged)', async () => {
    const root = await openEvents();
    focusMock.mockClear();
    await press(root, ROW(5002));
    expect(currentRoute()?.params).toEqual({ blogUrl: BLOG2, section: 'events' });
    expect(focusTargets().filter(Boolean).pop()).toBe(`author/${BLOG2}/post/blog-post-0`);
    await unmount(root);
  });

  it('OK on a stream row whose author\'s stream is scheduled (Epic 7 retro F6): the «Запланирован» card, focus on the first post; Back → the row', async () => {
    e15 = () => e15Stream('scheduled', { startTime: 1_790_100_000 });
    const root = await openEvents();
    focusMock.mockClear();
    await press(root, ROW(5003));
    expect(currentRoute()?.params).toEqual({ blogUrl: LIVE_BLOG, section: 'events' });
    const live = `author/${LIVE_BLOG}/live`;
    expect(visible(root, live)).toBe(true);
    expect(text(byTestId(root, `${live}/badge`)[0])).toContain(t('author.live.badgeScheduled'));
    // The 7.1 rule: a scheduled card never takes the initial focus.
    const targets = focusTargets().filter(Boolean);
    expect(targets[targets.length - 1]).toBe(`author/${LIVE_BLOG}/post/blog-post-0`);
    expect(targets).not.toContain(live);
    expect(transport.callsTo(`/v1/blog/${LIVE_BLOG}/video_stream`)).toHaveLength(1);
    expect(routeNamesIncludePlayer()).toBe(false);
    focusMock.mockClear();
    await back();
    expect(currentRoute()?.name).toBe('Shell');
    expect(lastFocusTarget()).toBe(ROW(5003));
    await unmount(root);
  });

  it('OK on a stream row whose stream ended between E18 and E15 (Epic 7 retro F6): no card, focus on the first post; Back → the row, read', async () => {
    // E18 still says «Начался эфир», E15 answers 204 (no stream).
    e15 = () => e15None();
    const root = await openEvents();
    expect(rowText(root, 5003)).toContain(t('events.text.streamStart'));
    focusMock.mockClear();
    await press(root, ROW(5003));
    expect(currentRoute()?.params).toEqual({ blogUrl: LIVE_BLOG, section: 'events' });
    expect(visible(root, `author/${LIVE_BLOG}/live`)).toBe(false);
    expect(focusTargets().filter(Boolean).pop()).toBe(`author/${LIVE_BLOG}/post/blog-post-0`);
    expect(transport.callsTo(`/v1/blog/${LIVE_BLOG}/video_stream`)).toHaveLength(1);
    expect(routeNamesIncludePlayer()).toBe(false);
    expect(eventReadMarksStore.getState().ids.has('5003')).toBe(true);
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe(ROW(5003));
    expect(visible(root, `${ROW(5003)}/dot`)).toBe(false);
    await unmount(root);
  });

  it('OK, no blog (missing or unsafe): nothing happens; the row stays unread', async () => {
    e18 = () => ({
      status: 200,
      body: e18Body([event(2, { blog: undefined, isRead: false }), event(1, { blog: { blogUrl: '../x' }, target: { bloggerUrl: 'a b' } })]),
    });
    const root = await openEvents();
    await press(root, ROW(5002));
    await press(root, ROW(5001));
    expect(currentRoute()?.name).toBe('Shell');
    expect(visible(root, `${ROW(5002)}/dot`)).toBe(true);
    expect(eventReadMarksStore.getState().ids.size).toBe(0);
    await unmount(root);
  });

  it('OK on a row whose blog comes from `target.bloggerUrl`: Автор of that blog', async () => {
    e18 = () => ({ status: 200, body: e18Body([event(1, { blog: undefined, target: { bloggerUrl: BLOG2 } })]) });
    const root = await openEvents();
    await press(root, ROW(5001));
    expect(currentRoute()?.params).toEqual({ blogUrl: BLOG2, section: 'events' });
    await unmount(root);
  });

  it('Back from Автор when the row is gone (a refetch meanwhile): the first row', async () => {
    const root = await openEvents();
    await press(root, ROW(5002));
    expect(currentRoute()?.name).toBe('Author');
    // The list changes while Автор covers it: event 5002 is gone, a new one is first.
    e18 = () => ({ status: 200, body: e18Body([event(9), event(3), event(1)]) });
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['events'] });
    });
    await settle();
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe(ROW(5009));
    await unmount(root);
  });

  it('Back inside События: row → nav/events → Главная; reopening restores the same row from the cache', async () => {
    const root = await openEvents();
    await focusOn(root, ROW(5001));
    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe('nav/events');
    await focusOn(root, 'nav/events');
    await back();
    expect(visible(root, 'shell/content/home')).toBe(true);
    await focusOn(root, 'nav/home');
    focusMock.mockClear();
    await press(root, 'nav/events');
    expect(lastFocusTarget()).toBe(ROW(5001));
    // `staleTime` 0: the reopen fetches E18 again (the cached rows show meanwhile).
    expect(e18Calls()).toHaveLength(2);
    await unmount(root);
  });

  it('a second OK during the transition to Автор (the Shell no longer focused) neither navigates nor marks another row', async () => {
    const root = await openEvents();
    await press(root, ROW(5003));
    expect(currentRoute()?.params).toEqual({ blogUrl: LIVE_BLOG, section: 'events' });
    // The covered Shell's row still receives the press: dropped by the app.
    await press(root, ROW(5001), { focus: false });
    expect(currentRoute()?.params).toEqual({ blogUrl: LIVE_BLOG, section: 'events' });
    expect([...eventReadMarksStore.getState().ids]).toEqual(['5003']);
    await unmount(root);
  });
});

describe('refresh and data changes under focus', () => {
  type Row = { id: string; isRead: boolean };
  const cached = () => queryClient.getQueryData<Row[]>(['events']) ?? [];
  async function setRows(change: (rows: Row[]) => Row[]) {
    await act(async () => {
      queryClient.setQueryData(['events'], change(cached()));
    });
    await settle();
  }

  it('resume (app back to the foreground, E1 ok): the shown list sends E18 again', async () => {
    let handlers: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
      handlers.push(listener);
      return { remove: () => { handlers = handlers.filter(h => h !== listener); } };
    }) as unknown as typeof AppState.addEventListener);
    const root = await openEvents();
    expect(e18Calls()).toHaveLength(1);
    for (const state of ['background', 'active']) {
      await act(async () => {
        for (const h of [...handlers]) {
          h(state);
        }
      });
      await settle();
    }
    expect(e18Calls()).toHaveLength(2);
    await unmount(root);
  });

  it('the focused row moves (a refetch reorders): scrolled to its new index, focus stays on it', async () => {
    const root = await openEvents();
    await focusOn(root, ROW(5002));
    focusMock.mockClear();
    lists.scrollToIndex.mockClear();
    await setRows(rows => [rows[0], rows[2], rows[1]]);
    expect(listProps('events/list').data.map((e: Row) => e.id)).toEqual(['5003', '5001', '5002']);
    expect(lists.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 2, animated: false }));
    expect(lastFocusTarget()).toBe(ROW(5002));
    await unmount(root);
  });

  it('the focused row is removed: the first row', async () => {
    const root = await openEvents();
    await focusOn(root, ROW(5002));
    focusMock.mockClear();
    await setRows(rows => rows.filter(r => r.id !== '5002'));
    expect(lastFocusTarget()).toBe(ROW(5003));
    await unmount(root);
  });

  it('the list empties under a focused row: «Событий нет» with focus on «Обновить»', async () => {
    const root = await openEvents();
    await focusOn(root, ROW(5002));
    focusMock.mockClear();
    await setRows(() => []);
    expect(visible(root, 'events/empty')).toBe(true);
    expect(lastFocusTarget()).toBe(ACTION);
    await unmount(root);
  });

  it('a refetch keeps the local read mark while the server still says unread (no dot)', async () => {
    const root = await openEvents();
    await press(root, ROW(5003));
    await back();
    expect(visible(root, `${ROW(5003)}/dot`)).toBe(false);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['events'] });
    });
    await settle();
    expect(e18Calls()).toHaveLength(2);
    expect(cached().find(r => r.id === '5003')?.isRead).toBe(false);
    expect(visible(root, `${ROW(5003)}/dot`)).toBe(false);
    await unmount(root);
  });
});

function routeNamesIncludePlayer(): boolean {
  return (navigationRef.getRootState()?.routes ?? []).some(r => r.name === 'Player');
}

describe('matrix «Empty» and «Error»', () => {
  it('Empty: «Событий нет» with «Обновить» (focused); OK refetches; events arriving → the first row', async () => {
    e18 = () => ({ status: 200, body: e18Body([]) });
    const root = await openEvents();
    expect(visible(root, 'events/empty')).toBe(true);
    expect(text(root)).toContain(t('events.emptyTitle'));
    expect(one(root, ACTION).props.accessibilityLabel).toBe(t('events.refresh'));
    expect(lastFocusTarget()).toBe(ACTION);
    e18 = () => ({ status: 200, body: e18Body([event(1)]) });
    await press(root, ACTION);
    expect(e18Calls()).toHaveLength(2);
    expect(rowIds(root)).toEqual([ROW(5001)]);
    expect(lastFocusTarget()).toBe(ROW(5001));
    await unmount(root);
  });

  it('Empty: «Обновить» still empty keeps focus on the button', async () => {
    e18 = () => ({ status: 200, body: e18Body([]) });
    const root = await openEvents();
    focusMock.mockClear();
    await press(root, ACTION);
    expect(e18Calls()).toHaveLength(2);
    expect(visible(root, 'events/empty')).toBe(true);
    expect(focusTargets().filter(id => id !== ACTION)).toEqual([]);
    await unmount(root);
  });

  it.each([
    ['Network', (): FixtureReply => ({ network: true })],
    ['Server', (): FixtureReply => ({ status: 503, body: {} })],
    ['Parse', (): FixtureReply => ({ status: 200, body: { data: {} } })],
  ])('Error (%s): the error with «Повторить» (focused); no automatic retry; «Повторить» refetches', async (kind, reply) => {
    e18 = reply;
    const root = await openEvents();
    expect(visible(root, 'events/error')).toBe(true);
    expect(text(root)).toContain(t('events.errorTitle'));
    expect(text(root)).toContain(t(`error.${kind}` as 'error.Network'));
    expect(one(root, ACTION).props.accessibilityLabel).toBe(t('common.retry'));
    expect(lastFocusTarget()).toBe(ACTION);
    expect(e18Calls()).toHaveLength(1);
    // Sent once: no AD-6 retry, no Query retry, even after timers run.
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await settle();
    expect(e18Calls()).toHaveLength(1);
    e18 = () => ({ status: 200, body: e18Body([event(1)]) });
    await press(root, ACTION);
    expect(e18Calls()).toHaveLength(2);
    expect(lastFocusTarget()).toBe(ROW(5001));
    await unmount(root);
  });

  it('Error, then the retry returns no event: «Обновить» takes focus (the new action)', async () => {
    e18 = () => ({ status: 503, body: {} });
    const root = await openEvents();
    e18 = () => ({ status: 200, body: e18Body([]) });
    focusMock.mockClear();
    await press(root, ACTION);
    expect(visible(root, 'events/empty')).toBe(true);
    expect(lastFocusTarget()).toBe(ACTION);
    await unmount(root);
  });

  it('the user moves to nav/settings during the skeleton: neither rows nor the action take focus', async () => {
    const reply = deferred();
    e18 = () => reply.promise;
    const root = await openEvents();
    await focusOn(root, 'nav/settings');
    focusMock.mockClear();
    reply.resolve({ status: 200, body: e18Body([event(1)]) });
    await settle();
    expect(rowIds(root)).toHaveLength(1);
    expect(focusTargets()).toEqual([]);
    await unmount(root);
  });
});

describe('resume with nested stacks (Epic 3 retro V2, Epic 7 retro F5)', () => {
  let handlers: Array<(state: string) => void> = [];
  beforeEach(() => {
    handlers = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
      handlers.push(listener);
      return { remove: () => { handlers = handlers.filter(h => h !== listener); } };
    }) as unknown as typeof AppState.addEventListener);
  });
  async function changeAppState(state: string) {
    await act(async () => {
      for (const h of [...handlers]) {
        h(state);
      }
    });
    await settle();
  }
  const routeNames = () => navigationRef.getRootState()?.routes.map(r => r.name);
  const POST_ID = 'blog-post-0';

  /** События → OK on the stream row → Автор (LIVE_BLOG) → its first post → the post's author row → Автор (BLOG2). */
  async function nestedStack() {
    // Synthetic: the post's author row points to another blog, so the two
    // Автор routes observe distinct E4 and E15 keys (one request per key).
    e8 = (_blogUrl, postId) => ({ status: 200, body: postDetail(BLOG2, postId, paragraph('Text')) });
    const root = await openEvents();
    await press(root, ROW(5003));
    await press(root, `author/${LIVE_BLOG}/post/${POST_ID}`);
    expect(currentRoute()?.name).toBe('Post');
    await press(root, `post/${POST_ID}/author`);
    expect(routeNames()).toEqual(['Shell', 'Author', 'Post', 'Author']);
    expect(currentRoute()?.params).toEqual(expect.objectContaining({ blogUrl: BLOG2 }));
    return root;
  }

  it('one stale resume sends E1, then E5 + E4×2 + E15×2 + E18 at once (one per observed key, covered routes included) and nothing else', async () => {
    const root = await nestedStack();
    const before = transport.calls.length;
    focusMock.mockClear();
    await changeAppState('background');
    jest.setSystemTime(Date.now() + QUERY_STALE_TIME_MS + 1_000);
    await changeAppState('active');
    const sent = transport.calls.slice(before);
    const count = (path: string, pageOne = false) =>
      sent.filter(c => c.path === path && (!pageOne || cursorOf(c.url) === null)).length;
    expect(count(E1)).toBe(1);
    expect(count(E5_PATH, true)).toBe(1);
    expect(count(e4Path(LIVE_BLOG), true)).toBe(1);
    expect(count(e4Path(BLOG2), true)).toBe(1);
    expect(count(e15Path(LIVE_BLOG))).toBe(1);
    expect(count(e15Path(BLOG2))).toBe(1);
    expect(count(E18)).toBe(1);
    // The combined count: E1 + E5 + E4×N + E15×N + E18 with N = 2.
    expect(sent).toHaveLength(1 + 1 + 2 + 2 + 1);
    // No Пост E8, no E3, no page append.
    expect(sent.filter(c => E8_RE.test(c.path))).toEqual([]);
    // The covered routes (Shell, Автор A, Пост) take no focus; the top Автор keeps the route.
    expect(routeNames()).toEqual(['Shell', 'Author', 'Post', 'Author']);
    const targets = focusTargets().filter(Boolean) as string[];
    expect(targets.filter(id => id.startsWith('events/') || id.startsWith('home/') || id.startsWith('post/'))).toEqual([]);
    expect(targets.filter(id => id.startsWith(`author/${LIVE_BLOG}`))).toEqual([]);
    await unmount(root);
  });

  it('after the resume, Back per layer: Автор B → Пост (its author row) → Автор A (the post card) → События (the row)', async () => {
    const root = await nestedStack();
    await changeAppState('background');
    jest.setSystemTime(Date.now() + QUERY_STALE_TIME_MS + 1_000);
    await changeAppState('active');
    const sentBefore = transport.calls.length;
    focusMock.mockClear();
    await back();
    expect(routeNames()).toEqual(['Shell', 'Author', 'Post']);
    expect(lastFocusTarget()).toBe(`post/${POST_ID}/author`);
    focusMock.mockClear();
    await back();
    expect(routeNames()).toEqual(['Shell', 'Author']);
    expect(lastFocusTarget()).toBe(`author/${LIVE_BLOG}/post/${POST_ID}`);
    focusMock.mockClear();
    await back();
    expect(routeNames()).toEqual(['Shell']);
    expect(lastFocusTarget()).toBe(ROW(5003));
    // Nothing at all was sent by the three pops.
    expect(transport.calls).toHaveLength(sentBefore);
    await unmount(root);
  });
});

describe('account scope', () => {
  it('sign-out / account switch clears the local read marks', async () => {
    eventReadMarksStore.getState().mark('5003');
    await act(async () => {
      await accountScope.reset();
    });
    expect(eventReadMarksStore.getState().ids.size).toBe(0);
  });
});
