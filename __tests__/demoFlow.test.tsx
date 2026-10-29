/**
 * Story 2.5 demo mode (debug-only) through the real App with
 * `DEMO_MODE = true`: a fixture-backed Shell, the persistent «ДЕМО» badge
 * (not focusable) and a SecureStore that is never read, written or cleared,
 * so a stored session survives. The release guard is __tests__/demoModeOff.test.js.
 */
import { act } from 'react';
import App from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
import { session } from '../src/app/session';
import { focusRestoration } from '../src/shared/focus';
import { DEFAULT_FILTER, filtersStore, formatDayKey, periodBounds } from '../src/shared/filters';
import { PostRepository } from '../src/shared/entities/post';
import { TagRepository } from '../src/shared/entities/tag';
import { t } from '../src/shared/i18n';
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { accountScope } from '../src/shared/account';
import { logger } from '../src/shared/services/logger';
import { progressStore } from '../src/shared/services/progress';
import { components, spacing } from '../src/shared/ui';
import {
  clearNativeModules,
  createFlow,
  installNativeModules,
  keychain as keychainMock,
  resetKeychain,
  topScreen,
} from '../src/test/flow';

jest.mock('react-native-keychain');
jest.mock('../src/app/appConfig', () => ({ DEMO_MODE: true }));
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

const keychain = keychainMock();
const STORED = JSON.stringify({ v: 1, accessToken: 'a'.repeat(64), refreshToken: 'r'.repeat(64), expiresAt: 1, accountId: '1001' });
const noNetwork = (_url: string, _init?: unknown): Promise<unknown> =>
  Promise.reject(new Error('no network in demo mode'));
const fetchMock = jest.fn(noNetwork);

/** 20 rounds, timers in each; `press()` focuses and clicks in one `act()`. */
const { settle, render, one, press, type } = createFlow({
  settle: { rounds: 20, timerRounds: 20 },
  one: 'focusableOrInput',
  pressFocuses: 'sameAct',
  submitSettles: false,
});

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.0' } });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  fetchMock.mockImplementation(noNetwork);
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);

test('fixture-backed Shell with the «ДЕМО» badge; SecureStore and the network untouched', async () => {
  const root = await renderApp();
  expect(root.container.queryAll(n => n.props.testID === 'shell').length).toBeGreaterThan(0);
  const [badge] = root.container.queryAll(n => n.props.testID === 'demo/badge');
  expect(badge).toBeDefined();
  expect(JSON.stringify(badge.toJSON())).toContain(t('demo.badge'));
  expect(badge.props.focusable).toBe(false);
  expect(badge.props.style).toMatchObject({
    position: 'absolute',
    top: spacing['safe-y'],
    right: spacing['safe-x'],
    height: components.badge.height,
    backgroundColor: components.badge.bg,
  });
  // The badge adds nothing focusable; Главная shows the demo feed (Story
  // 3.1), served by the demo's FixtureTransport.
  const focusable = root.container
    .queryAll(n => n.props.focusable === true)
    .map(n => n.props.testID as string);
  // Then «Фильтры» (Story 5.3) and «Обновить» (Story 5.1) in the feed's title row.
  expect(focusable.slice(0, 6)).toEqual([
    'nav/home',
    'nav/search',
    'nav/subs',
    'nav/settings',
    'home/filters',
    'home/refresh',
  ]);
  // Demo posts in order, under the default «Доступные мне» (Story 5.3: the
  // locked demo-post-6 is not in it). (FlashList's Jest measurements report
  // the list end at once, so further demo pages may already be loaded.)
  expect(focusable.slice(6, 15)).toEqual(
    [0, 1, 2, 3, 4, 5, 7, 8, 9].map(i => `home/feed/demo-post-${i}`),
  );
  expect(focusable.slice(6).every(id => id.startsWith('home/feed/demo-post-'))).toBe(true);
  // The demo's E1 is answered by FixtureTransport: no real request, no keychain.
  expect(fetchMock).not.toHaveBeenCalled();
  expect(keychain.getGenericPassword).not.toHaveBeenCalled();
  expect(keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
  expect(keychain.__values.get('boostytv.session')).toBe(STORED);
  await act(async () => {
    root.unmount();
  });
});

test('Story 3.2: Подписки shows the demo authors (E2 answered by the demo transport); Story 5.2: «Мой блог» first, once', async () => {
  fetchMock.mockClear();
  const root = await renderApp();
  await press(root, 'nav/subs');
  const tiles = root.container
    .queryAll(n => n.props.focusable === true)
    .map(n => n.props.testID as string)
    .filter(id => id.startsWith('subs/tile/') || id === 'subs/mine');
  // The demo account owns `demo-blog-2` (E1 `blogUrl`): its tile is first
  // as «Мой блог» and is not repeated among the subscriptions.
  expect(tiles.slice(0, 3)).toEqual([
    'subs/mine',
    'subs/tile/demo-blog-1',
    'subs/tile/demo-blog-3',
  ]);
  expect(tiles).not.toContain('subs/tile/demo-blog-2');
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});

test('Story 3.3: Автор answers E3/E4 in demo mode (2 pages, an empty blog, a missing blog)', async () => {
  fetchMock.mockClear();
  const root = await renderApp();
  const ids = () =>
    root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID as string);
  const text = () => JSON.stringify(root.container.toJSON());
  await press(root, 'nav/subs');
  await press(root, 'subs/tile/demo-blog-1');
  expect(text()).toContain('Демо-блог 1');
  expect(ids().filter(id => id.startsWith('author/demo-blog-1/post/')).length).toBeGreaterThan(0);
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });

  await resetQueryCache();
  const empty = await renderApp();
  await press(empty, 'nav/subs');
  await press(empty, 'subs/tile/demo-blog-3');
  expect(JSON.stringify(empty.container.toJSON())).toContain(t('author.emptyTitle'));
  await act(async () => {
    empty.unmount();
  });

  await resetQueryCache();
  const missing = await renderApp();
  await press(missing, 'nav/subs');
  await press(missing, 'subs/tile/demo-blog-8');
  expect(JSON.stringify(missing.container.toJSON())).toContain(t('author.unavailableTitle'));
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    missing.unmount();
  });
});

test('Story 3.4: Пост answers E8 in demo mode (paragraphs and likes, mixed blocks, a missing post)', async () => {
  fetchMock.mockClear();
  const root = await renderApp();
  const ids = () =>
    root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID as string);
  const text = () => JSON.stringify(root.container.toJSON());
  await press(root, 'home/feed/demo-post-1');
  // demo-post-1: 4 paragraphs, then the mixed placeholders and one more paragraph.
  expect(ids().filter(id => id.startsWith('post/demo-post-1/block/'))).toHaveLength(5);
  expect(text()).toContain('лайк');
  expect(text()).toContain(t('post.block.poll'));
  await act(async () => {
    root.unmount();
  });

  await resetQueryCache();
  const missing = await renderApp();
  await press(missing, 'home/feed/demo-post-9');
  expect(JSON.stringify(missing.container.toJSON())).toContain(t('post.unavailableTitle'));
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    missing.unmount();
  });
});

test('Story 3.5: a demo post with two videos shows two MediaRows on top (the second without a title)', async () => {
  fetchMock.mockClear();
  const root = await renderApp();
  const ids = () =>
    root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID as string);
  await press(root, 'home/feed/demo-post-4');
  const rows = ids().filter(id => id.startsWith('post/demo-post-4/video/'));
  expect(rows).toEqual([
    'post/demo-post-4/video/demo-video-4-0',
    'post/demo-post-4/video/demo-video-4-1',
  ]);
  const label = (id: string) =>
    root.container.queryAll(n => n.props.testID === id && n.props.focusable === true)[0].props
      .accessibilityLabel;
  // Story 4.2: the label ends with the progress status (nothing watched in the demo).
  expect(label(rows[0])).toMatch(/^Видео 1\. Демо-ролик 5\. \d+:\d\d\. Не начато$/);
  expect(label(rows[1])).toMatch(/^Видео 2\. \d+:\d\d\. Не начато$/);
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});

test('Story 5.4: the demo feed honours from_ts / to_ts (a custom day keeps only that day’s posts)', async () => {
  // The demo posts: 2026-10-01 00:00 UTC minus n hours (n = 0…29); the
  // local calendar day of post 0 (the zone of the test host).
  const start = 1_790_812_800;
  const first = new Date(start * 1000);
  const dayKey = formatDayKey({ year: first.getFullYear(), month: first.getMonth() + 1, day: first.getDate() });
  const period = { kind: 'custom', fromDay: dayKey, toDay: dayKey } as const;
  const bounds = periodBounds(period, Date.now())!;
  const expected = Array.from({ length: 30 }, (_, n) => n)
    .filter(n => n % 7 !== 6)
    .filter(n => start - n * 3600 >= bounds.fromTs && start - n * 3600 <= bounds.toTs)
    .map(n => `home/feed/demo-post-${n}`);
  filtersStore.getState().setPeriod('feed', period);
  try {
    const root = await renderApp();
    const cards = root.container
      .queryAll(n => n.props.focusable === true)
      .map(n => n.props.testID as string)
      .filter(id => id.startsWith('home/feed/demo-post-'));
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(26);
    expect(cards).toEqual(expected);
    await act(async () => {
      root.unmount();
    });
  } finally {
    filtersStore.getState().clear();
  }
});

test('Story 5.5: the demo E13 answers two pages of 8; the demo feed intersects tags_ids', async () => {
  const root = await renderApp();
  try {
    // The demo transport delays each reply (fake timers here).
    const load = async (cursor: string | null) => {
      const pending = TagRepository.feedTagsPage(session.http, cursor);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      return pending;
    };
    const page1 = await load(null);
    expect(page1.tags).toHaveLength(8);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await load(page1.nextCursor);
    expect(page2.tags.map(tag => tag.id)).toEqual(['9', '10', '11', '12', '13', '14', '15', '16']);
    expect(page2.nextCursor).toBeNull();
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
  // Demo post n carries tags (n % 4) + 1 and (n % 3) + 5: tags 1 and 5 → n % 12 = 0
  // (locked posts, n % 7 = 6, are not «Доступные мне»).
  const cardsWith = async (tags: { id: string; title: string }[]) => {
    for (const tag of tags) {
      filtersStore.getState().toggleTag('feed', tag);
    }
    const app = await renderApp();
    const cards = app.container
      .queryAll(n => n.props.focusable === true)
      .map(n => n.props.testID as string)
      .filter(id => id.startsWith('home/feed/demo-post-'));
    await act(async () => {
      app.unmount();
    });
    filtersStore.getState().clear();
    await resetQueryCache();
    return cards;
  };
  try {
    expect(
      await cardsWith([
        { id: '1', title: 'Демо-тег 1' },
        { id: '5', title: 'Демо-тег 5' },
      ]),
    ).toEqual(['home/feed/demo-post-0', 'home/feed/demo-post-12', 'home/feed/demo-post-24']);
    // Two tags of one group never meet on a post: nothing.
    expect(
      await cardsWith([
        { id: '1', title: 'Демо-тег 1' },
        { id: '2', title: 'Демо-тег 2' },
      ]),
    ).toEqual([]);
  } finally {
    filtersStore.getState().clear();
  }
});

test('Story 5.6: the demo E6 matches titles (case-insensitive) with the feed\'s Filter params, in pages of 10', async () => {
  const root = await renderApp();
  try {
    const load = async (query: string, cursor: string | null, access: 'allowed' | 'all' = 'allowed') => {
      const pending = PostRepository.feedSearchPage(session.http, query, cursor, {
        ...DEFAULT_FILTER,
        access,
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      return pending;
    };
    // «пост 1»: posts 1 and 10–19 (titles «Демо-пост N+1»: n = 0, 9–18), minus locked n = 13.
    const page = await load('ПОСТ 1', null);
    expect(page.posts.map(p => p.id)).toEqual(
      [0, 9, 10, 11, 12, 14, 15, 16, 17, 18].map(n => `demo-post-${n}`),
    );
    expect(page.nextCursor).toBeNull();
    // «Все посты»: the locked one too (11: a second page of one).
    const all = await load('пост 1', null, 'all');
    expect(all.posts).toHaveLength(10);
    expect(all.posts.map(p => p.id)).toContain('demo-post-13');
    expect((await load('пост 1', all.nextCursor, 'all')).posts).toHaveLength(1);
    // Every post matches «демо»: three pages.
    const first = await load('демо', null);
    expect(first.posts).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    expect((await load('zzz', null)).posts).toEqual([]);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('Story 5.7: the demo E4 honours is_only_allowed (only_bought ignored), E7 ignores access (as live), E14 lists the blog tags', async () => {
  const root = await renderApp();
  try {
    const wait = async <T,>(pending: Promise<T>): Promise<T> => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      return pending;
    };
    const blog = 'demo-blog-1';
    const allowed = await wait(PostRepository.blogPage(session.http, blog, null, DEFAULT_FILTER));
    expect(allowed.posts.every(p => p.hasAccess)).toBe(true);
    expect(allowed.posts).toHaveLength(20);
    const all = await wait(PostRepository.blogPage(session.http, blog, null, { ...DEFAULT_FILTER, access: 'all' }));
    expect(all.posts.some(p => !p.hasAccess)).toBe(true);
    const tagged = await wait(
      PostRepository.blogPage(session.http, blog, null, { ...DEFAULT_FILTER, tags: [{ id: '1', title: '' }] }),
    );
    expect(tagged.posts.length).toBeGreaterThan(0);
    expect(tagged.posts.length).toBeLessThan(20);
    // E7 «пост 1»: posts n = 0, 9–18 (11), the locked n = 13 included under «Доступные мне».
    const found = await wait(PostRepository.blogSearchPage(session.http, blog, 'пост 1', null, DEFAULT_FILTER));
    expect(found.posts).toHaveLength(11);
    expect(found.posts.some(p => !p.hasAccess)).toBe(true);
    expect(found.nextCursor).toBeNull();
    const tags = await wait(TagRepository.blogTags(session.http, blog));
    expect(tags.map(tag => tag.id).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('Story 2.8: demo expiry → A11 → A2 → A5 → sign-in with another id: the demo hook wipes the stores; the keychain is never touched', async () => {
  // PhoneScreen's send still goes through the real AuthApiClient (global
  // fetch); answer it here. Confirm and E1 go to the demo's FixtureTransport.
  const SEND = '/auth/phone/verification_code/send';
  fetchMock.mockImplementation((url: string) =>
    url.endsWith(SEND)
      ? Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                data: { phoneCode: { code: 'c'.repeat(64), expiresIn: 604800, phone: '+375291234567', sentTransport: 'gate' } },
              }),
            ),
        })
      : noNetwork(url),
  );
  installNativeModules({ InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') } });
  fetchMock.mockClear();
  keychain.getGenericPassword.mockClear();
  keychain.setGenericPassword.mockClear();
  keychain.resetGenericPassword.mockClear();
  const root = await renderApp();
  const top = () => topScreen(root, ['auth/expired', 'auth/phone', 'auth/code', 'shell']);

  await press(root, 'nav/settings');
  focusRestoration.remember('shell', 'settings', 'settings/row/version', 0);
  logger.info('test', 'demo account line');
  await press(root, 'settings/row/expired-check');
  expect(top()).toBe('auth/expired');
  await press(root, 'auth/expired/relogin');
  expect(top()).toBe('auth/phone');
  await type(root, 'auth/phone/country', '+375');
  await type(root, 'auth/phone/number', '291234567');
  await press(root, 'auth/phone/send');
  expect(top()).toBe('auth/code');
  await type(root, 'auth/code/field', '482193');
  const field = one(root, 'auth/code/field');
  await act(async () => {
    field.props.onSubmitEditing({ nativeEvent: { text: '482193' } });
  });
  await settle();

  // Signed in on the demo session (E1 id 1001 ≠ stored `demo`): the hook ran.
  expect(top()).toBe('shell');
  expect(session.getStatus()).toBe('signedIn');
  expect(focusRestoration.peek('shell', 'settings')).toBeUndefined();
  expect(JSON.stringify(logger.entries())).not.toContain('demo account line');
  expect(logger.entries().some(e => e.scope === 'account' && e.message === 'reset')).toBe(true);
  // The keychain was never touched and the stored session survives.
  expect(keychain.getGenericPassword).not.toHaveBeenCalled();
  expect(keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
  expect(keychain.__values.get('boostytv.session')).toBe(STORED);
  // Nothing reached the global fetch: the send went through the demo
  // session's fixture transport (Epic 2 retro, item 1).
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});

test('Story 4.2: demo progress stays in memory; a demo sign-out never clears the real local progress', async () => {
  const real = createAsyncStorage('boostytv-account');
  await real.setItem('progress.v1', 'owner-real-progress');
  const root = await renderApp();
  const ref = { blogUrl: 'demo-blog-1', postId: 'demo-post-0', mediaId: 'demo-video-0-0' };
  await act(async () => {
    await progressStore.ready();
    progressStore.put(
      {
        ref,
        positionSec: 42,
        durationSec: 600,
        updatedAt: 1,
        meta: { title: 'Демо', postTitle: 'Демо', authorName: 'Демо', previewUrl: null, durationSec: 600 },
      },
      { flush: true },
    );
    await progressStore.flush();
  });
  // The demo neither read nor wrote the owner's database.
  expect(progressStore.get('demo-video-0-0')?.positionSec).toBe(42);
  expect(await real.getItem('progress.v1')).toBe('owner-real-progress');
  expect(await real.getAllKeys()).toEqual(['progress.v1']);
  // A demo sign-out (AccountScope reset) wipes the demo's progress only.
  await act(async () => {
    await accountScope.reset();
  });
  expect(progressStore.get('demo-video-0-0')).toBeUndefined();
  expect(await real.getItem('progress.v1')).toBe('owner-real-progress');
  await act(async () => {
    root.unmount();
  });
});
