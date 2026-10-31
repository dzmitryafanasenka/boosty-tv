/**
 * The shared setup of the player flow suites (Epic 8 retro A4, split from
 * `__tests__/playerFlow.test.tsx`): the flow instance, the stored session,
 * the route/test-id constants, the post fixtures, the FixtureTransport
 * routing (E1, E5, E8, E9, E15, E16, the token refresh) and the helpers
 * that open the Player and fire engine events.
 *
 * Each suite calls `setupPlayerFlowHarness()` at its top level, which
 * registers the hooks and returns `handlers`: the per-test E8/E9/E15/E16
 * replies, the held E1, the refresh reply and the installed transport. A
 * test changes a reply by assigning to it (`handlers.e8 = ...`); each
 * `beforeEach` resets them.
 *
 * `jest.mock(...)` is hoisted only inside the test file, so every suite
 * repeats the same mock block (the keychain, `requestHostFocus`,
 * BackHandler, TVEventHandler, TVFocusGuideView, FlashList and the
 * PlayerEngine port) before calling this.
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import App, { navigationRef } from '../app/App';
import { resetQueryCache } from '../app/queryClient';
import { type FixtureReply, type FixtureRequest, type FixtureTransport } from '../shared/api/fixtureTransport';
import { focusRestoration } from '../shared/focus';
import { logger } from '../shared/services/logger';
import { progressStore } from '../shared/services/progress';
import { externalPlayerPreference, qualityPreference, speedPreference } from '../features/player';
import { resetBreakSource } from '../features/player/debugBreakSource';
import { requestHostFocus } from '../shared/ui/requestHostFocus';
import backHandler from './backHandlerMock';
import { engine } from './playerEngineMock';
import { tvEvents } from './tvEventMock';
import { E5_PATH, syntheticFeed } from './feedFixtures';
import e1Ok from './fixtures/boosty/e1-user-current.json';
import { paragraph, postDetail } from './postFixtures';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  installFixtureTransport,
  installNativeModules,
  resetKeychain,
  resetRecorders,
  text,
} from './flow';

export const focusMock = requestHostFocus as jest.Mock;

export const { settle, render, one, focusOn, press, back, advance, key } = createFlow({
  settle: { rounds: 30, timerRounds: 0 },
  one: 'focusable',
  pressFocuses: true,
  submitSettles: false,
});

export const STORED = JSON.stringify({
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 4_000_000_000_000,
  accountId: '1001',
});
export const E1 = '/v1/user/current';
export const FEED_BLOG = 'synthetic-blog-1';
export const POST = 'feed-post-0';
export const FEED_CARD = `home/feed/${POST}`;
export const PRIMARY = `post/${POST}/primary`;
export const VIDEO = (mediaId: string) => `post/${POST}/video/${mediaId}`;
export const SURFACE = 'player/surface';
export const TIMELINE = 'player/timeline';
export const PLAYPAUSE = 'player/playpause';
export const SETTINGS = 'player/settings';
export const BACK10 = 'player/back10';
export const FORWARD10 = 'player/forward10';
export const RETRY = 'player/error/retry';
export const BACK = 'player/error/back';
export const E8_RE = /^\/v1\/blog\/([^/]+)\/post\/([^/]+)$/;
export const URL = 'https://example.invalid/player';

export type Reply = FixtureReply | Promise<FixtureReply> | undefined;
/** E9 (Story 4.2): `PUT /v1/viewstat/video/{mediaId}/timecode/`. */
export const E9_RE = /^\/v1\/viewstat\/video\/([^/]+)\/timecode\/$/;
/** E15 (Story 7.2): `GET /v1/blog/{blogUrl}/video_stream`; default 204 (no stream). */
export const E15_RE = /^\/v1\/blog\/([^/]+)\/video_stream$/;
/** E16 (Story 7.3): `PUT /v1/blog/{blogUrl}/video_stream/heartbeat/viewer[?stop=true]`; default 200. */
export const E16_RE = /^\/v1\/blog\/([^/]+)\/video_stream\/heartbeat\/viewer$/;

/** The mutable per-test replies and the installed transport; `beforeEach` resets them. */
export type PlayerFlowHandlers = {
  e8: (req: FixtureRequest, blogUrl: string, postId: string) => Reply;
  e9: (req: FixtureRequest) => Reply;
  e15: (req: FixtureRequest) => Reply;
  e16: (req: FixtureRequest) => Reply;
  /** Story 7.3: the refresh (`/oauth/token/`) reply, when a test sets one; else unhandled. */
  tokenReply: FixtureReply | undefined;
  transport: FixtureTransport;
  /** Story 4.4: E1 held by a test (the session check still running); null: 200 at once. */
  e1Hold: Promise<FixtureReply> | null;
};

const unset = () => undefined;
export const handlers: PlayerFlowHandlers = {
  e8: unset,
  e9: unset,
  e15: unset,
  e16: unset,
  tokenReply: undefined,
  // Installed by the harness' `beforeEach` before any test reads it.
  transport: undefined as unknown as FixtureTransport,
  e1Hold: null,
};

export const okVideo = (id: string, playerUrls: unknown[], more: Record<string, unknown> = {}) => ({
  type: 'ok_video',
  id,
  title: `Title ${id}`,
  duration: 600,
  playerUrls,
  ...more,
});
export const ALL = [
  { type: 'dash', url: URL },
  { type: 'full_hd', url: URL },
  { type: 'hls', url: URL },
  { type: 'ultra_hd', url: '' },
];
export const ONE = [okVideo('v1', ALL), ...paragraph('Body')];
export const TWO = [okVideo('v1', ALL), okVideo('v2', ALL, { title: '' }), ...paragraph('Body')];
export const withData = (data: unknown[]) => {
  handlers.e8 = (_req, blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, data) });
};

/**
 * Registers the suite hooks (fake timers, the console spies, the mock
 * resets, the stored session, the transport routing and the per-test
 * cleanup); call once at the top level of each player flow suite. A second
 * call would register every hook twice, so it throws.
 */
let registered = false;
export function setupPlayerFlowHarness(): PlayerFlowHandlers {
  if (registered) {
    throw new Error('setupPlayerFlowHarness: call it once, at the top level of the suite');
  }
  registered = true;
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
    tvEvents.reset();
    engine.reset();
    resetRecorders();
    resetKeychain({ 'boostytv.session': STORED });
    installNativeModules({ AppInfo: { versionName: '1.0' } });
    withData(ONE);
    handlers.e9 = () => ({ status: 200 });
    handlers.e15 = () => ({ status: 204 });
    handlers.e16 = () => ({ status: 200 });
    handlers.tokenReply = undefined;
    handlers.e1Hold = null;
    const feed = syntheticFeed({ total: 3 });
    handlers.transport = installFixtureTransport((req: FixtureRequest): Reply => {
      if (req.path === E1) {
        return handlers.e1Hold ?? { status: 200, body: e1Ok.body };
      }
      if (req.path === E5_PATH) {
        return feed(req);
      }
      const single = E8_RE.exec(req.path);
      if (single) {
        return handlers.e8(req, decodeURIComponent(single[1]), decodeURIComponent(single[2]));
      }
      // Story 4.2: E9 progress writes.
      if (req.method === 'PUT' && E9_RE.test(req.path)) {
        return handlers.e9(req);
      }
      // Story 7.2: the live player's E15.
      if (req.method === 'GET' && E15_RE.test(req.path)) {
        return handlers.e15(req);
      }
      // Story 7.3: the live viewer heartbeat (`req.path` has no query; `req.url` has `?stop=true`).
      if (req.method === 'PUT' && E16_RE.test(req.path)) {
        return handlers.e16(req);
      }
      if (req.path === '/oauth/token/') {
        return handlers.tokenReply;
      }
      return undefined;
    });
  });

  afterEach(async () => {
    // Story 4.2: no progress (local entries, server values, held writes) leaks between tests.
    await progressStore.reset();
    // Story 4.3: nor the device's quality preference.
    qualityPreference.forget();
    // Story 8.1: nor the device's speed.
    speedPreference.forget();
    // Story 8.2: nor the «Системный видеоплеер» value.
    externalPlayerPreference.forget();
    // Story 4.4: the debug-only broken-source flag.
    resetBreakSource();
    await createAsyncStorage('boostytv-device').clear();
    await resetQueryCache();
    clearNativeModules();
    focusRestoration.clear();
    logger.clear();
    jest.restoreAllMocks();
  });

  return handlers;
}

export type Root = Awaited<ReturnType<typeof render>>;

export const currentRoute = () => navigationRef.getCurrentRoute()?.name;
export const routeNames = () => navigationRef.getRootState()?.routes.map(r => r.name);
export const e8Calls = () => handlers.transport.calls.filter(c => E8_RE.test(c.path));
export const playerText = (root: Root) => text(byTestId(root, 'player/page')[0]);

/** Engine events through the mocked port. */
export async function fire<
  K extends 'onLoad' | 'onProgress' | 'onBuffering' | 'onSeekDone' | 'onEnd' | 'onError' | 'onResolution' | 'onAudioFocusLost',
>(
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

/**
 * Story 4.4: the first engine error recovers by itself (one fresh E8, a new
 * engine); the recovered source's error within 30 s shows the error state.
 */
export async function failPastRecovery(code: string | null = 'decoder') {
  const mounts = engine.mounts;
  await fire('onError', code);
  expect(engine.mounts).toBe(mounts + 1);
  await fire('onError', code);
}

/** Главная → OK on the first card → Пост. */
export async function openPost(): Promise<Root> {
  const root = await render(<App />);
  await focusOn(root, FEED_CARD);
  await press(root, FEED_CARD);
  expect(currentRoute()).toBe('Post');
  return root;
}

/** Пост → OK on `from` → Player; the engine loaded (600 s), past the entry guard. */
export async function openPlayer(from = VIDEO('v1'), { load = true } = {}): Promise<Root> {
  const root = await openPost();
  focusMock.mockClear();
  await press(root, from);
  expect(currentRoute()).toBe('Player');
  if (load) {
    // Native focus lands on the surface at mount (the entry guard starts there).
    await focusOn(root, SURFACE);
    await fire('onLoad', { durationSec: 600 });
    await fire('onBuffering', false);
    await advance(600);
  }
  return root;
}
