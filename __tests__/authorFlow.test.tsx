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
import App, { navigationRef } from '../src/app/App';
import { queryClient, resetQueryCache } from '../src/app/queryClient';
import { accountScope } from '../src/shared/account';
import { queryKeys } from '../src/shared/api';
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
import { E5_PATH, cursorOf, e5Page, lockedPost } from '../src/test/feedFixtures';
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

  it('OK on a post does nothing yet (Post is Story 3.4)', async () => {
    const root = await openAuthor();
    focusMock.mockClear();
    const before = transport.calls.length;
    await press(root, SYN(1));
    expect(visible(root, 'author')).toBe(true);
    expect(focusTargets().filter(Boolean)).toEqual([]);
    expect(transport.calls).toHaveLength(before);
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
