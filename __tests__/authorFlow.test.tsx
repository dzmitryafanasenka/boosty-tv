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
import { AppState } from 'react-native';
import App, { navigationRef } from '../src/app/App';
import { queryClient, resetQueryCache } from '../src/app/queryClient';
import { accountScope } from '../src/shared/account';
import { QUERY_STALE_TIME_MS, queryKeys } from '../src/shared/api';
import {
  type FixtureReply,
  type FixtureRequest,
  type FixtureTransport,
} from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import {
  blogPost,
  e3Body,
  e3MissingReply,
  e3Path,
  e4Page,
  e4Path,
  syntheticBlogPosts,
} from '../src/test/authorFixtures';
import { E5_PATH, cursorFor, cursorOf, e5Page, lockedPost } from '../src/test/feedFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
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
 * The real FlashList behind a recorder: the test reads the last props of
 * each list (by testID) and the scroll calls made through its ref.
 * `onEndReached` is held back from the real list and called by the test
 * (FlashList's Jest setup measures every item 100 × 100, so the end would
 * always be "reached"; as homeFeedFlow).
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

type Reply = FixtureReply | Promise<FixtureReply> | undefined;
let e3: (req: FixtureRequest) => Reply;
let e4: (req: FixtureRequest) => Reply;
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
  mockGuideDestinations.clear();
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
  transport = installFixtureTransport(req => {
    if (req.path === E1) {
      return { status: 200, body: e1Ok.body };
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
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  jest.restoreAllMocks();
});

type Root = Awaited<ReturnType<typeof render>>;

const currentRoute = () => navigationRef.getCurrentRoute()?.name;
const e3Calls = (blogUrl: string = BLOG) => transport.callsTo(e3Path(blogUrl));
const e4Calls = (blogUrl: string = BLOG) => transport.callsTo(e4Path(blogUrl));
const authorCards = (root: Root) =>
  focusableIds(root).filter(id => id.startsWith(`author/${BLOG}/post/`));
const focusTargets = () =>
  focusMock.mock.calls.map(c => (c[0] as { props?: { testID?: string } } | null)?.props?.testID);
function destinationIds(guide: string): string[] {
  return (mockGuideDestinations.get(guide) ?? []).map(
    view => (view as { props?: { testID?: string } }).props?.testID as string,
  );
}
/** The Author grid's FlashList props (last render). */
function grid(): Record<string, any> {
  const props = mockLists.props.get('author/posts/list');
  if (!props) {
    throw new Error('no Author grid rendered');
  }
  return props;
}
/** The post ids in the Author grid (its items are rows of up to 3). */
const gridPosts = () =>
  (grid().data as Array<{ posts: Array<{ id: string }> }>).flatMap(r => r.posts.map(p => p.id));

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
    queryClient.setQueryData<Data>(queryKeys.authorPosts(BLOG), data => {
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
      `https://api.boosty.to/v1/blog/${BLOG}/post/?limit=20&comments_limit=0&reply_limit=0`,
    );
    for (const call of [...e3Calls(), ...e4Calls()]) {
      expect(call.headers.Authorization).toBe(`Bearer ${'a'.repeat(64)}`);
      expect(call.headers['X-App']).toBeUndefined();
      expect(call.headers['X-From-Id']).toBeUndefined();
    }
    // No comment, search, tag or filter parameter, no other endpoint.
    expect(transport.calls.every(c => !/comment|search|tags|is_only_allowed|from_ts/.test(c.path))).toBe(true);
    expect(e4Calls()[0].url).not.toMatch(/is_only_allowed|tags_ids|from_ts|to_ts/);
    // Header: title and owner, not focusable; no price, cover or subscribe action.
    const header = byTestId(root, 'author/header')[0];
    expect(text(header)).toContain('Blog Title');
    expect(text(header)).toContain('Owner Name');
    expect(header.props.accessibilityLabel).toBe('Автор: Blog Title. Owner Name');
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

  it('the live pinned post (E4 isPinned) keeps Boosty\'s place and is marked «Закреплено» (owner decision 2026-10-27)', async () => {
    e4 = () => ({ status: 200, body: e4Page(2, { isLast: true }) });
    const root = await openAuthor();
    const [first, second] = gridPosts();
    expect(first).toBe((e4Page(2).data[0] as { id: string }).id);
    expect(text(byTestId(root, `${CARD(first)}/date`)[0])).toContain('Закреплено');
    expect(one(root, CARD(first)).props.accessibilityLabel).toMatch(/^Закреплено\. /);
    expect(text(byTestId(root, `${CARD(second)}/date`)[0])).not.toContain('Закреплено');
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
  it('no posts: header + «Публикаций нет»; nothing focusable in content; focus stays on the sidebar', async () => {
    e4 = () => ({ status: 200, body: { data: [], extra: { isLast: true } } });
    const root = await openAuthor();
    expect(visible(root, 'author/header')).toBe(true);
    expect(visible(root, 'author/empty')).toBe(true);
    expect(text(root)).toContain(t('author.emptyTitle'));
    expect(focusableIds(root, byTestId(root, 'author/content')[0])).toEqual([]);
    expect(destinationIds('author/content')).toEqual([]);
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

  it('E3 retry succeeds while E4 page 1 still loads: the action is gone, focus → author/nav/subs', async () => {
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
    expect(lastFocusTarget()).toBe(SIDEBAR_SUBS);
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

  it('E4 page 1 fails, «Повторить» returns no posts: «Публикаций нет», focus → author/nav/subs', async () => {
    e4 = () => ({ status: 400, body: {} });
    const root = await openAuthor();
    expect(visible(root, 'author/posts-error')).toBe(true);
    e4 = () => ({ status: 200, body: { data: [], extra: { isLast: true } } });
    focusMock.mockClear();
    await press(root, ACTION);
    expect(visible(root, 'author/empty')).toBe(true);
    expect(lastFocusTarget()).toBe(SIDEBAR_SUBS);
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
    mockLists.scrollToIndex.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(TILE(5));
    // Same index: no scroll by index.
    expect(mockLists.scrollToIndex).not.toHaveBeenCalled();
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
    expect(queryClient.getQueryData(queryKeys.authorPosts(BLOG))).toBeDefined();
    await unmount(root);
    await accountScope.reset();
    expect(queryClient.getQueryData(queryKeys.author(BLOG))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.authorPosts(BLOG))).toBeUndefined();
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
    mockLists.scrollToIndex.mockClear();
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
        mockLists.scrollToOffset.mockClear();
        mockLists.scrollToIndex.mockClear();
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
        `https://api.boosty.to/v1/blog/${BLOG}/post/?limit=20&comments_limit=0&reply_limit=0`,
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
      mockLists.scrollToOffset.mock.calls.some(
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
      expect(mockLists.scrollToIndex).not.toHaveBeenCalled();
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
      mockLists.scrollToOffset.mockClear();
      reply.resolve(twoNew());
      await settle();
      expect(gridPosts().slice(0, 3)).toEqual(['new-0', 'new-1', 'blog-post-0']);
      expect(focusTargets()).toEqual([CARD('new-0')]);
      expect(scrolledToTop()).toBe(true);
      expect(mockLists.scrollToIndex).not.toHaveBeenCalled();
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
        mockLists.scrollToOffset.mockClear();
        reply.resolve(twoNew());
        await settle();
        expect(gridPosts().indexOf(target.slice(CARD('').length))).toBe(index);
        expect(focusTargets()).toEqual([target]);
        // The grid scrolls by row (3 cards each).
        expect(mockLists.scrollToIndex).toHaveBeenCalledWith(
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
      mockLists.scrollToIndex.mockClear();
      await back();
      expect(currentRoute()).toBe('Author');
      expect(lastFocusTarget()).toBe(SYN(0));
      expect(mockLists.scrollToIndex).toHaveBeenCalledWith(
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
        queryKeys.authorPosts(BLOG),
      );
      expect(cached?.pages.flatMap(p => p.posts.map(x => x.id))).toEqual(
        Array.from({ length: 40 }, (_, i) => `blog-post-${i}`),
      );
      expect(queryClient.getQueryState(queryKeys.authorPosts(BLOG))?.dataUpdatedAt).toBe(Date.now());
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
      const before = queryClient.getQueryState(queryKeys.authorPosts(BLOG))?.dataUpdatedAt ?? 0;
      await reopen();
      expect(e4Calls()).toHaveLength(3);
      expect(gridPosts()).toEqual(Array.from({ length: 40 }, (_, i) => `blog-post-${i}`));
      expect(queryClient.getQueryState(queryKeys.authorPosts(BLOG))?.dataUpdatedAt).toBeGreaterThan(
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
      expect(mockLists.scrollToIndex).toHaveBeenCalledWith(
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
      mockLists.scrollToIndex.mockClear();
      head = () => headPage([newPost(0), ...known(0, 18)], 18);
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(e4Calls()).toHaveLength(calls + 1);
      // 19 posts with more pages: post 17 alone in the held row, but shown.
      const ids = gridPosts();
      expect(ids).toHaveLength(19);
      expect(ids[18]).toBe('blog-post-17');
      expect(mockLists.scrollToIndex).toHaveBeenCalledWith(
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
      expect(queryClient.getQueryData(queryKeys.authorPosts(BLOG))).toBeUndefined();
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
      mockLists.scrollToOffset.mockClear();
      mockLists.scrollToIndex.mockClear();
      return root;
    }
    const scrolledToTopOnResume = () =>
      mockLists.scrollToOffset.mock.calls.some(
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
        expect(mockLists.scrollToIndex).not.toHaveBeenCalled();
        await unmount(root);
      },
    );

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
        queryKeys.authorPosts(BLOG),
        { pages: [{ posts: [], nextCursor: null }], pageParams: [null] },
        { updatedAt: Date.now() },
      );
      await backgroundFor(QUERY_STALE_TIME_MS + 1_000);
      expect(e4Calls()).toHaveLength(1);
      await unmount(root);
    });
  });
});
