/**
 * Story 12.5 through the real App with a stored session, over
 * FixtureTransport as the global `fetch` and a fake `LauncherChannel` native
 * module: the channel sync from the app (the Continue history, then the
 * neutral card after «Выйти»), and every pending-open row of the spec's I/O
 * matrix (cold start, warm start, stale/foreign/malformed refs, signed out,
 * the neutral card, Back from the Player to Главная's card). The native
 * intent handling and Aero TV are device checks (docs/testing.md Story
 * 12.5); these tests prove what the app asks to show and focus.
 */
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { AppState } from 'react-native';
import type { Root } from 'test-renderer';
import App, { navigationRef } from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
import { focusRestoration } from '../src/shared/focus';
import { progressStore } from '../src/shared/services/progress';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { engine } from '../src/test/playerEngineMock';
import { paragraph, postDetail } from '../src/test/postFixtures';
import { E5_PATH, e5Page } from '../src/test/feedFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import {
  clearNativeModules,
  createFlow,
  installFixtureTransport,
  installNativeModules,
  lastFocusTarget,
  resetKeychain,
  unmount,
} from '../src/test/flow';
import type { FixtureRequest } from '../src/shared/api/fixtureTransport';

jest.mock('react-native-keychain');
jest.mock('../src/app/phaseFlags', () =>
  require('../src/test/phaseFlagsMock').phaseFlagsWith({ livePlaque: false }),
);
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));
jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);
jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () =>
  require('../src/test/tvEventMock'),
);
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));

const focusMock = requestHostFocus as jest.Mock;

const { settle, render, focusOn, press, back, advance } = createFlow({
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
  accountId: String(e1Ok.body.id),
});
const E1 = '/v1/user/current';
const BLOG = 'synthetic-blog-1';
const DURATION = 3600;
const SURFACE = 'player/surface';
const E8_RE = /^\/v1\/blog\/([^/]+)\/post\/cw-post-(\d+)$/;
const E9_RE = /^\/v1\/viewstat\/video\/([^/]+)\/timecode\/$/;

const cwRef = (n: number) => ({ blogUrl: BLOG, postId: `cw-post-${n}`, mediaId: `cw-v${n}` });
const card = (n: number) => `home/continue/cw-v${n}`;
const routes = () => navigationRef.getRootState()?.routes.map(r => r.name);
const currentRoute = () => navigationRef.getCurrentRoute()?.name;

function seed(n: number, positionSec: number, ageMs: number) {
  progressStore.put({
    ref: cwRef(n),
    positionSec,
    durationSec: DURATION,
    updatedAt: Date.now() - ageMs,
    meta: {
      title: `Lesson ${n}`,
      postTitle: `Post ${n}`,
      authorName: `Author ${n}`,
      previewUrl: `https://img.example.invalid/${n}.jpg`,
      durationSec: DURATION,
    },
  });
}

/** The fake native module: the pending open (taken once) and the syncs. */
let pending: Record<string, unknown> | null;
let sync: jest.Mock;
const mediaOpen = (ref: Record<string, unknown>) => ({ target: 'media', ...ref });

let appStateHandlers: Array<(state: string) => void> = [];
async function changeAppState(state: string) {
  await act(async () => {
    for (const h of [...appStateHandlers]) {
      h(state);
    }
  });
  await settle();
}
/** A launcher card while the app runs: `onNewIntent` stashes it, then the app is in the foreground again. */
async function warmOpen(open: Record<string, unknown>) {
  await changeAppState('background');
  pending = open;
  await changeAppState('active');
}

async function fire<K extends 'onLoad' | 'onSeekDone' | 'onBuffering' | 'onProgress'>(
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

/** The Player is up: its surface focused, loaded. */
async function loadPlayer(root: Root) {
  await focusOn(root, SURFACE);
  await advance(600);
  await fire('onLoad', { durationSec: DURATION });
  await fire('onBuffering', false);
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
  focusMock.mockClear();
  backHandler.reset();
  engine.reset();
  resetKeychain({ 'boostytv.session': STORED });
  pending = null;
  sync = jest.fn().mockResolvedValue('synced');
  installNativeModules({
    AppInfo: { versionName: '1.0' },
    LauncherChannel: {
      sync,
      takePendingOpen: jest.fn(async () => {
        const open = pending;
        pending = null;
        return open;
      }),
    },
  });
  installFixtureTransport((req: FixtureRequest) => {
    if (req.path === E1) {
      return { status: 200, body: e1Ok.body };
    }
    if (req.path === E5_PATH) {
      return { status: 200, body: e5Page() };
    }
    const single = E8_RE.exec(req.path);
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
  });
});

afterEach(async () => {
  await progressStore.reset();
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);
/** The cards of the last sync (title + target). */
const lastSync = () => {
  const calls = sync.mock.calls;
  return calls[calls.length - 1] as [string, Array<Record<string, unknown>>] | undefined;
};

describe('Story 12.5: the channel sync from the app', () => {
  it('the Continue history is published newest first; «Выйти» publishes the neutral card', async () => {
    seed(1, 600, 2000);
    seed(2, 720, 1000);
    const root = await renderApp();
    expect(lastSync()?.[0]).toBe('Продолжить просмотр');
    expect(lastSync()?.[1].map(c => [c.target, c.title, c.description, c.mediaId])).toEqual([
      ['media', 'Lesson 2', 'Author 2', 'cw-v2'],
      ['media', 'Lesson 1', 'Author 1', 'cw-v1'],
    ]);
    const before = sync.mock.calls.length;
    await press(root, 'nav/settings');
    await press(root, 'settings/row/signout');
    await press(root, 'dialog/signout/confirm');
    expect(routes()).toEqual(['Welcome']);
    expect(sync.mock.calls.length).toBe(before + 1);
    expect(lastSync()?.[1]).toEqual([{ target: 'home', title: 'Откройте Boosty TV', description: null, posterUrl: null }]);
    await unmount(root);
  });
});

describe('Story 12.5: opening a launcher card', () => {
  it('matrix «OK, cold start, signed in»: [Shell, Player] at the resume point; Back → Главная on that card', async () => {
    seed(1, 600, 2000);
    seed(2, 720, 1000);
    pending = mediaOpen(cwRef(1));
    const root = await renderApp();
    expect(routes()).toEqual(['Shell', 'Player']);
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      ref: cwRef(1),
      origin: { routeKey: 'shell', sectionId: 'home', focusId: card(1) },
    });
    await loadPlayer(root);
    expect(engine.seek).toHaveBeenCalledWith(600);
    focusMock.mockClear();
    await back();
    expect(routes()).toEqual(['Shell']);
    expect(lastFocusTarget()).toBe(card(1));
    await unmount(root);
  });

  it('matrix «OK, warm start»: the app on Настройки; the card replaces the stack with [Shell, Player]; Back → Главная on that card', async () => {
    seed(1, 600, 2000);
    seed(2, 720, 1000);
    const root = await renderApp();
    await press(root, 'nav/settings');
    expect(routes()).toEqual(['Shell']);
    await warmOpen(mediaOpen(cwRef(2)));
    expect(routes()).toEqual(['Shell', 'Player']);
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      ref: cwRef(2),
      origin: { routeKey: 'shell', sectionId: 'home', focusId: card(2) },
    });
    await loadPlayer(root);
    expect(engine.seek).toHaveBeenCalledWith(720);
    focusMock.mockClear();
    await back();
    expect(routes()).toEqual(['Shell']);
    expect(lastFocusTarget()).toBe(card(2));
    await unmount(root);
  });

  it('a warm start while another video plays: [Shell, Player B]; Back → Главная on B\'s card; A\'s progress kept (exit write)', async () => {
    seed(1, 600, 2000);
    seed(2, 720, 1000);
    const root = await renderApp();
    await focusOn(root, card(1));
    await press(root, card(1));
    expect(routes()).toEqual(['Shell', 'Player']);
    await loadPlayer(root);
    await fire('onSeekDone', 600);
    for (let sec = 600; sec <= 620; sec += 1) {
      await fire('onProgress', sec);
    }
    await warmOpen(mediaOpen(cwRef(2)));
    expect(routes()).toEqual(['Shell', 'Player']);
    expect((navigationRef.getCurrentRoute()?.params as { ref: unknown }).ref).toEqual(cwRef(2));
    // A's last position is kept (the old Player left through its exit path).
    expect(progressStore.get('cw-v1')?.positionSec).toBe(620);
    await loadPlayer(root);
    expect(engine.seek).toHaveBeenLastCalledWith(720);
    focusMock.mockClear();
    await back();
    expect(routes()).toEqual(['Shell']);
    expect(lastFocusTarget()).toBe(card(2));
    await unmount(root);
  });

  it('a warm start from a Пост: the stack is replaced (no Пост under the Player)', async () => {
    seed(1, 600, 2000);
    const root = await renderApp();
    await act(async () => {
      navigationRef.navigate('Post', { blogUrl: BLOG, postId: 'cw-post-1', section: 'home' });
    });
    await settle();
    expect(routes()).toEqual(['Shell', 'Post']);
    await warmOpen(mediaOpen(cwRef(1)));
    expect(routes()).toEqual(['Shell', 'Player']);
    await unmount(root);
  });

  it('matrix «Stale / foreign / malformed ref»: Главная (cold start: the Shell stays)', async () => {
    seed(1, 600, 2000);
    for (const open of [
      mediaOpen({ ...cwRef(9) }), // not in the history
      mediaOpen({ ...cwRef(1), blogUrl: 'other-blog' }), // foreign
      mediaOpen({ ...cwRef(1), mediaId: '' }), // malformed
      { target: 'media', blogUrl: BLOG }, // malformed
    ]) {
      pending = open;
      const root = await renderApp();
      expect(routes()).toEqual(['Shell']);
      expect(pending).toBeNull();
      await unmount(root);
    }
  });

  it('a finished video (no longer in Continue): Главная, warm start from the Player → [Shell]', async () => {
    seed(1, 3590, 2000); // finished
    seed(2, 720, 1000);
    pending = mediaOpen(cwRef(2));
    const root = await renderApp();
    expect(routes()).toEqual(['Shell', 'Player']);
    await warmOpen(mediaOpen(cwRef(1)));
    expect(routes()).toEqual(['Shell']);
    expect(currentRoute()).toBe('Shell');
    await unmount(root);
  });

  it('matrix «Neutral card / channel link»: Главная; warm start from Настройки → a fresh Shell on Главная', async () => {
    pending = { target: 'home' };
    const root = await renderApp();
    expect(routes()).toEqual(['Shell']);
    await press(root, 'nav/settings');
    const before = navigationRef.getRootState()?.routes[0].key;
    await warmOpen({ target: 'home' });
    expect(routes()).toEqual(['Shell']);
    // A new Shell route (its sections start on Главная).
    expect(navigationRef.getRootState()?.routes[0].key).not.toBe(before);
    expect(root.container.queryAll(n => n.props.testID === 'shell/content/home').length).toBeGreaterThan(0);
    await unmount(root);
  });

  it('matrix «signed out»: Welcome stays; the card is dropped (not applied after a sign-in)', async () => {
    resetKeychain({});
    seed(1, 600, 2000);
    pending = mediaOpen(cwRef(1));
    const root = await renderApp();
    expect(routes()).toEqual(['Welcome']);
    expect(pending).toBeNull();
    await warmOpen({ target: 'home' });
    expect(routes()).toEqual(['Welcome']);
    await unmount(root);
  });

  it('a foreground return without a card changes nothing', async () => {
    seed(1, 600, 2000);
    const root = await renderApp();
    await press(root, 'nav/settings');
    await changeAppState('background');
    await changeAppState('active');
    expect(routes()).toEqual(['Shell']);
    expect(root.container.queryAll(n => n.props.testID === 'shell/content/settings').length).toBeGreaterThan(0);
    await unmount(root);
  });
});
