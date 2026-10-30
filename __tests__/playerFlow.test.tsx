/**
 * Story 4.1 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: Главная → Пост → «Смотреть» or a MediaRow → Player
 * (a fresh E8, the source order), the overlay, remote seeking, auto-hide,
 * the spinner, Back, origin focus, the error states and the PlaybackArbiter
 * slot. Every row of the spec's I/O matrix. The PlayerEngine port is
 * mocked (`src/test/playerEngineMock`): these tests prove what the player
 * asks of the engine and which element it asks to focus, not native
 * playback, decoding or focus movement (device checks, docs/testing.md).
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { AppState, DeviceEventEmitter, StyleSheet } from 'react-native';
import { StackActions } from '@react-navigation/native';
import App, { navigationRef } from '../src/app/App';
import { progress } from '../src/app/progress';
import { queryClient, resetQueryCache } from '../src/app/queryClient';
import { queryKeys } from '../src/shared/api';
import { type FixtureReply, type FixtureRequest, type FixtureTransport } from '../src/shared/api/fixtureTransport';
import { accountScope } from '../src/shared/account';
import { focusRestoration } from '../src/shared/focus';
import { t as translate } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { progressStore } from '../src/shared/services/progress';
import { QUALITY_PREFERENCE_KEY, debugBreakNextVideoSource, qualityPreference } from '../src/features/player';
import { resetBreakSource } from '../src/features/player/debugBreakSource';
import { playbackArbiter } from '../src/shared/platform/playbackArbiter';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { engine } from '../src/test/playerEngineMock';
import { tvEvents } from '../src/test/tvEventMock';
import { E5_PATH, syntheticFeed } from '../src/test/feedFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import e15LiveFixture from '../src/test/fixtures/boosty/e15-video-stream-live.json';
import e15LockedFixture from '../src/test/fixtures/boosty/e15-video-stream-locked.json';
import e1Unauthorized from '../src/test/fixtures/boosty/e1-no-token.json';
import e8NoToken from '../src/test/fixtures/boosty/e8-no-token.json';
import refreshRejected from '../src/test/fixtures/boosty/refresh-invalid-grant.json';
import refreshOk from '../src/test/fixtures/boosty/refresh-ok.json';
import {
  blockEnd,
  e8Accessible,
  e8Locked,
  e8MissingReply,
  paragraph,
  postDetail,
  text as textBlock,
} from '../src/test/postFixtures';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  deferred,
  focusTargets,
  installFixtureTransport,
  installNativeModules,
  lastFocusTarget,
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
jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () =>
  require('../src/test/tvEventMock'),
);
jest.mock('react-native/Libraries/Components/TV/TVFocusGuideView', () =>
  require('../src/test/flow').recordingFocusGuideModule(),
);
jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));

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
const FEED_BLOG = 'synthetic-blog-1';
const POST = 'feed-post-0';
const FEED_CARD = `home/feed/${POST}`;
const PRIMARY = `post/${POST}/primary`;
const VIDEO = (mediaId: string) => `post/${POST}/video/${mediaId}`;
const SURFACE = 'player/surface';
const TIMELINE = 'player/timeline';
const PLAYPAUSE = 'player/playpause';
const SETTINGS = 'player/settings';
const BACK10 = 'player/back10';
const FORWARD10 = 'player/forward10';
const RETRY = 'player/error/retry';
const BACK = 'player/error/back';
const E8_RE = /^\/v1\/blog\/([^/]+)\/post\/([^/]+)$/;
const URL = 'https://example.invalid/player';

type Reply = FixtureReply | Promise<FixtureReply> | undefined;
let e8: (req: FixtureRequest, blogUrl: string, postId: string) => Reply;
/** E9 (Story 4.2): `PUT /v1/viewstat/video/{mediaId}/timecode/`. */
const E9_RE = /^\/v1\/viewstat\/video\/([^/]+)\/timecode\/$/;
let e9: (req: FixtureRequest) => Reply;
/** E15 (Story 7.2): `GET /v1/blog/{blogUrl}/video_stream`; default 204 (no stream). */
const E15_RE = /^\/v1\/blog\/([^/]+)\/video_stream$/;
let e15: (req: FixtureRequest) => Reply;
/** E16 (Story 7.3): `PUT /v1/blog/{blogUrl}/video_stream/heartbeat/viewer[?stop=true]`; default 200. */
const E16_RE = /^\/v1\/blog\/([^/]+)\/video_stream\/heartbeat\/viewer$/;
let e16: (req: FixtureRequest) => Reply;
/** Story 7.3: the refresh (`/oauth/token/`) reply, when a test sets one; else unhandled. */
let tokenReply: FixtureReply | undefined;
let transport: FixtureTransport;
/** Story 4.4: E1 held by a test (the session check still running); null: 200 at once. */
let e1Hold: Promise<FixtureReply> | null;

const okVideo = (id: string, playerUrls: unknown[], more: Record<string, unknown> = {}) => ({
  type: 'ok_video',
  id,
  title: `Title ${id}`,
  duration: 600,
  playerUrls,
  ...more,
});
const ALL = [
  { type: 'dash', url: URL },
  { type: 'full_hd', url: URL },
  { type: 'hls', url: URL },
  { type: 'ultra_hd', url: '' },
];
const ONE = [okVideo('v1', ALL), ...paragraph('Body')];
const TWO = [okVideo('v1', ALL), okVideo('v2', ALL, { title: '' }), ...paragraph('Body')];
const withData = (data: unknown[]) => {
  e8 = (_req, blogUrl, postId) => ({ status: 200, body: postDetail(blogUrl, postId, data) });
};

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
  e9 = () => ({ status: 200 });
  e15 = () => ({ status: 204 });
  e16 = () => ({ status: 200 });
  tokenReply = undefined;
  e1Hold = null;
  const feed = syntheticFeed({ total: 3 });
  transport = installFixtureTransport((req: FixtureRequest): Reply => {
    if (req.path === E1) {
      return e1Hold ?? { status: 200, body: e1Ok.body };
    }
    if (req.path === E5_PATH) {
      return feed(req);
    }
    const single = E8_RE.exec(req.path);
    if (single) {
      return e8(req, decodeURIComponent(single[1]), decodeURIComponent(single[2]));
    }
    // Story 4.2: E9 progress writes.
    if (req.method === 'PUT' && E9_RE.test(req.path)) {
      return e9(req);
    }
    // Story 7.2: the live player's E15.
    if (req.method === 'GET' && E15_RE.test(req.path)) {
      return e15(req);
    }
    // Story 7.3: the live viewer heartbeat (`req.path` has no query; `req.url` has `?stop=true`).
    if (req.method === 'PUT' && E16_RE.test(req.path)) {
      return e16(req);
    }
    if (req.path === '/oauth/token/') {
      return tokenReply;
    }
    return undefined;
  });
});

afterEach(async () => {
  // Story 4.2: no progress (local entries, server values, held writes) leaks between tests.
  await progressStore.reset();
  // Story 4.3: nor the device's quality preference.
  qualityPreference.forget();
  // Story 4.4: the debug-only broken-source flag.
  resetBreakSource();
  await createAsyncStorage('boostytv-device').clear();
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  jest.restoreAllMocks();
});

type Root = Awaited<ReturnType<typeof render>>;

const currentRoute = () => navigationRef.getCurrentRoute()?.name;
const routeNames = () => navigationRef.getRootState()?.routes.map(r => r.name);
const e8Calls = () => transport.calls.filter(c => E8_RE.test(c.path));
const playerText = (root: Root) => text(byTestId(root, 'player/page')[0]);

/** Advance fake time (timers and `Date.now`), then settle. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

/** A raw remote key (key up unless `action` says otherwise). */
async function key(eventType: string, action = 1) {
  await act(async () => {
    tvEvents.emit({ eventType, eventKeyAction: action });
  });
  await settle();
}

/** Engine events through the mocked port. */
async function fire<
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
async function failPastRecovery(code: string | null = 'decoder') {
  const mounts = engine.mounts;
  await fire('onError', code);
  expect(engine.mounts).toBe(mounts + 1);
  await fire('onError', code);
}

/** Главная → OK on the first card → Пост. */
async function openPost(): Promise<Root> {
  const root = await render(<App />);
  await focusOn(root, FEED_CARD);
  await press(root, FEED_CARD);
  expect(currentRoute()).toBe('Post');
  return root;
}

/** Пост → OK on `from` → Player; the engine loaded (600 s), past the entry guard. */
async function openPlayer(from = VIDEO('v1'), { load = true } = {}): Promise<Root> {
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

describe('Пост: «Смотреть» and MediaRows (Story 4.1, owner decision option A)', () => {
  it('«Смотреть» right under the header, before the rows; initial focus on it; ↑ the author, ↓ the rows', async () => {
    const root = await openPost();
    const column = byTestId(root, 'post/column')[0];
    const ids = column
      .queryAll(n => n.props.focusable === true)
      .map(n => n.props.testID as string);
    expect(ids).toEqual([`post/${POST}/author`, PRIMARY, VIDEO('v1'), `post/${POST}/block/text@1`]);
    expect(one(root, PRIMARY).props.accessibilityLabel).toBe('Смотреть');
    expect(one(root, PRIMARY).props.accessibilityRole).toBe('button');
    expect(lastFocusTarget()).toBe(PRIMARY);
    // The rows are buttons now.
    expect(one(root, VIDEO('v1')).props.accessibilityRole).toBe('button');
    await unmount(root);
  });

  it('a two-video post: «Смотреть · Видео 1», and it opens the first video', async () => {
    withData(TWO);
    const root = await openPost();
    expect(one(root, PRIMARY).props.accessibilityLabel).toBe('Смотреть · Видео 1');
    await press(root, PRIMARY);
    expect(currentRoute()).toBe('Player');
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      ref: { blogUrl: FEED_BLOG, postId: POST, mediaId: 'v1' },
      origin: { routeKey: expect.any(String), focusId: PRIMARY },
    });
    await unmount(root);
  });

  it('a locked post or a post without video: no «Смотреть»', async () => {
    e8 = () => ({ status: 200, body: e8Locked() });
    const locked = await openPost();
    expect(visible(locked, PRIMARY.replace(POST, (e8Locked() as { id: string }).id))).toBe(false);
    expect(text(byTestId(locked, 'post/page')[0])).not.toContain('Смотреть');
    await unmount(locked);
    withData(paragraph('Text only'));
    const plain = await openPost();
    expect(visible(plain, PRIMARY)).toBe(false);
    await unmount(plain);
  });
});

describe('open the player (matrix «Open from a row», «Source order», «Progressive only»)', () => {
  it('OK on a row: Player route with ids only; a fresh E8 (content profile, comments off); HLS; plays; focus on the surface', async () => {
    withData(TWO);
    const root = await openPlayer(VIDEO('v2'), { load: false });
    expect(routeNames()).toEqual(['Shell', 'Post', 'Player']);
    const params = navigationRef.getCurrentRoute()?.params;
    expect(params).toEqual({
      ref: { blogUrl: FEED_BLOG, postId: POST, mediaId: 'v2' },
      origin: { routeKey: expect.any(String), focusId: VIDEO('v2') },
    });
    expect(JSON.stringify(params)).not.toMatch(/example\.invalid|playerUrls|signedQuery|timeCode/);
    // Пост's E8, then the player's own fresh E8.
    expect(e8Calls()).toHaveLength(2);
    const call = e8Calls()[1];
    expect(call.url).toBe(
      `https://api.boosty.to/v1/blog/${FEED_BLOG}/post/${POST}?comments_limit=0&reply_limit=0`,
    );
    expect(call.headers['X-App']).toBeUndefined();
    expect(call.headers.Referer).toBeUndefined();
    // The engine gets the HLS source and nothing else (no headers: the
    // player sends only its own UA; the CDN log is a device check).
    expect(engine.props?.source).toEqual({ uri: URL, format: 'hls' });
    expect(Object.keys(engine.props?.source ?? {}).sort()).toEqual(['format', 'uri']);
    expect(engine.props?.paused).toBe(false);
    expect(lastFocusTarget()).toBe(SURFACE);
    // No sidebar on the player.
    expect(visible(root, 'player/sidebar')).toBe(false);
    expect(byTestId(root, 'player').length).toBeGreaterThan(0);
    // The query key holds ids only.
    expect(JSON.stringify(queryKeys.mediaSource(FEED_BLOG, POST, 'v2'))).not.toMatch(/example|http/);
    await unmount(root);
  });

  it('only DASH + 720p/1080p progressive → DASH', async () => {
    withData([okVideo('v1', [{ type: 'high', url: URL }, { type: 'dash', url: URL }, { type: 'full_hd', url: URL }])]);
    const root = await openPlayer(VIDEO('v1'), { load: false });
    expect(engine.props?.source).toEqual({ uri: URL, format: 'dash' });
    await unmount(root);
  });

  it('progressive only (360p, 720p, 1080p) → 1080p', async () => {
    withData([
      okVideo('v1', [
        { type: 'low', url: `${URL}-360` },
        { type: 'full_hd', url: `${URL}-hd` },
        { type: 'high', url: `${URL}-720` },
      ]),
    ]);
    const root = await openPlayer(VIDEO('v1'), { load: false });
    expect(engine.props?.source).toEqual({ uri: `${URL}-hd`, format: 'progressive' });
    await unmount(root);
  });

  it('while the fresh E8 runs: a spinner, the surface focused, nothing else focusable', async () => {
    const pending = deferred();
    const root = await openPost();
    e8 = () => pending.promise;
    focusMock.mockClear();
    await press(root, VIDEO('v1'));
    expect(currentRoute()).toBe('Player');
    expect(visible(root, 'player/spinner')).toBe(true);
    expect(engine.props).toBeNull();
    const page = byTestId(root, 'player/page')[0];
    expect(page.queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([SURFACE]);
    expect(lastFocusTarget()).toBe(SURFACE);
    pending.resolve({ status: 200, body: postDetail(FEED_BLOG, POST, ONE) });
    await settle();
    expect(engine.props?.source.format).toBe('hls');
    await unmount(root);
  });
});

describe('a locked fresh E8 checks the session first (Epic 3 retro A6)', () => {
  const TOKEN = '/oauth/token/';
  const REFRESHED = `Bearer ${refreshOk.body.access_token}`;
  /** The stored token died after Пост opened: E1 401, E8 anonymous (locked). */
  let dead: boolean;
  let e1Reply: () => FixtureReply;
  /** E8 with the stale token (default: the anonymous locked post). */
  let staleE8: () => FixtureReply;
  const anonymous = (): FixtureReply => ({
    status: e8NoToken.status,
    body: { ...e8NoToken.body, id: POST, user: { ...(e8NoToken.body.user as object), blogUrl: FEED_BLOG } },
  });

  function install(refresh: FixtureReply) {
    dead = false;
    e1Reply = () => ({ status: e1Unauthorized.status, body: e1Unauthorized.body });
    staleE8 = anonymous;
    installNativeModules({
      InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') },
    });
    const feed = syntheticFeed({ total: 3 });
    transport = installFixtureTransport((req: FixtureRequest): Reply => {
      const stale = dead && req.headers.Authorization !== REFRESHED;
      if (req.path === TOKEN) {
        return refresh;
      }
      if (req.path === E1) {
        return stale ? e1Reply() : { status: 200, body: e1Ok.body };
      }
      if (req.path === E5_PATH) {
        return feed(req);
      }
      const single = E8_RE.exec(req.path);
      if (single) {
        return stale ? staleE8() : e8(req, decodeURIComponent(single[1]), decodeURIComponent(single[2]));
      }
      return undefined;
    });
  }

  /**
   * Пост opened alive; then the token dies and OK on the row opens the
   * player. `timers` only for the AD-6 backoff and the reset to A11.
   */
  async function playDead({ timers = false } = {}): Promise<Root> {
    // Story 4.7: a local entry that only a confirmed locked answer may drop.
    progressStore.put({
      ref: { blogUrl: FEED_BLOG, postId: POST, mediaId: 'v1' },
      positionSec: 120,
      durationSec: 600,
      updatedAt: Date.now(),
      meta: { title: 'Title v1', postTitle: `Title of ${POST}`, authorName: 'redacted', previewUrl: null, durationSec: 600 },
    });
    const root = await openPost();
    expect(transport.callsTo(E1)).toHaveLength(1);
    dead = true;
    focusMock.mockClear();
    await press(root, VIDEO('v1'), timers ? { settle: { timerRounds: 30 } } : undefined);
    return root;
  }

  it('dead session (E1 401 → refresh invalid_grant): A11, no player and no «Нет доступа» behind it', async () => {
    install({ status: refreshRejected.status, body: refreshRejected.body });
    const root = await playDead({ timers: true });
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(transport.callsTo(TOKEN)).toHaveLength(1);
    expect(e8Calls()).toHaveLength(2);
    expect(routeNames()).toEqual(['Expired']);
    expect(visible(root, 'player')).toBe(false);
    expect(engine.props).toBeNull();
    // The player's late focus retry does not pull focus back from A11.
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    await unmount(root);
  });

  it('silent refresh (E1 401 → refresh ok → 200): one refetch of the E8 with the new token → plays', async () => {
    install({ status: refreshOk.status, body: refreshOk.body });
    const root = await playDead();
    expect(transport.callsTo(TOKEN)).toHaveLength(1);
    expect(e8Calls()).toHaveLength(3);
    expect(e8Calls()[2].headers.Authorization).toBe(REFRESHED);
    expect(currentRoute()).toBe('Player');
    expect(engine.props?.source.format).toBe('hls');
    expect(playerText(root)).not.toContain('Нет доступа к этому видео');
    expect(lastFocusTarget()).toBe(SURFACE);
    // Story 4.7: not locked after all: the local entry stays.
    expect(progressStore.get('v1')).toBeDefined();
    await unmount(root);
  });

  it('truly locked (E1 200): one refetch, still locked, no loop; reopening within 5 min sends no E1', async () => {
    install({ status: refreshOk.status, body: refreshOk.body });
    e1Reply = () => ({ status: 200, body: e1Ok.body });
    const root = await playDead();
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(transport.callsTo(TOKEN)).toHaveLength(0);
    expect(e8Calls()).toHaveLength(3);
    expect(playerText(root)).toContain('Нет доступа к этому видео');
    expect(lastFocusTarget()).toBe(BACK);
    // Story 4.7 (owner decision 2026-10-28): confirmed locked drops the local entry.
    expect(progressStore.get('v1')).toBeUndefined();
    await press(root, BACK);
    expect(currentRoute()).toBe('Post');
    await press(root, VIDEO('v1'));
    expect(playerText(root)).toContain('Нет доступа к этому видео');
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(e8Calls()).toHaveLength(4);
    await unmount(root);
  });

  it('E1 200, the one refetch fails: «Нет доступа к этому видео» stays (no error copy, no retry)', async () => {
    install({ status: refreshOk.status, body: refreshOk.body });
    e1Reply = () => ({ status: 200, body: e1Ok.body });
    let n = 0;
    staleE8 = () => {
      n += 1;
      return n === 1 ? anonymous() : { status: 400, body: { error: 'bad_request' } };
    };
    const root = await playDead();
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(e8Calls()).toHaveLength(3);
    expect(playerText(root)).toContain('Нет доступа к этому видео');
    expect(playerText(root)).not.toContain('Не удалось воспроизвести видео');
    expect(visible(root, RETRY)).toBe(false);
    expect(lastFocusTarget()).toBe(BACK);
    await unmount(root);
  });

  it('offline (E1 Network): «Нет доступа к этому видео» as today, no refetch, no A11', async () => {
    install({ status: refreshOk.status, body: refreshOk.body });
    e1Reply = () => ({ network: true });
    const root = await playDead({ timers: true });
    // The cold-start E1, then the check's E1 with its AD-6 retries (3 attempts).
    expect(transport.callsTo(E1)).toHaveLength(4);
    expect(transport.callsTo(TOKEN)).toHaveLength(0);
    expect(e8Calls()).toHaveLength(2);
    expect(currentRoute()).toBe('Player');
    expect(playerText(root)).toContain('Нет доступа к этому видео');
    expect(lastFocusTarget()).toBe(BACK);
    // Story 4.7: the session check could not run: the local entry stays.
    expect(progressStore.get('v1')).toBeDefined();
    await unmount(root);
  });
});

describe('error states (matrix «No usable URL», «Locked on fresh E8», «E8 fails»)', () => {
  it('no usable URL: «Не удалось воспроизвести видео», «Повторить» focused / «Назад»; Повторить → exactly one fresh E8', async () => {
    const root = await openPost();
    e8 = () => ({
      status: 200,
      body: postDetail(FEED_BLOG, POST, [okVideo('v1', [{ type: 'hls', url: '' }, { type: 'mp4', url: URL }])]),
    });
    await press(root, VIDEO('v1'));
    expect(playerText(root)).toContain('Не удалось воспроизвести видео');
    expect(engine.props).toBeNull();
    expect(byTestId(root, 'player/page')[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
      RETRY,
      BACK,
    ]);
    expect(lastFocusTarget()).toBe(RETRY);
    const before = e8Calls().length;
    withData(ONE);
    await press(root, RETRY);
    expect(e8Calls()).toHaveLength(before + 1);
    expect(engine.props?.source.format).toBe('hls');
    expect(lastFocusTarget()).toBe(SURFACE);
    await unmount(root);
  });

  it('locked on the fresh E8: «Нет доступа к этому видео», only «Назад» (focused, no retry); OK → Пост, focus on the row', async () => {
    const root = await openPost();
    e8 = () => ({ status: 200, body: { ...e8Locked(), id: POST, user: { ...(e8Locked().user as object), blogUrl: FEED_BLOG } } });
    await focusOn(root, VIDEO('v1'));
    await press(root, VIDEO('v1'));
    expect(playerText(root)).toContain('Нет доступа к этому видео');
    expect(visible(root, RETRY)).toBe(false);
    expect(lastFocusTarget()).toBe(BACK);
    const before = e8Calls().length;
    focusMock.mockClear();
    await press(root, BACK);
    expect(currentRoute()).toBe('Post');
    expect(e8Calls()).toHaveLength(before);
    expect(lastFocusTarget()).toBe(VIDEO('v1'));
    await unmount(root);
  });

  it('E8 404 or the video gone: «Видео недоступно» + «Назад»', async () => {
    const root = await openPost();
    e8 = () => e8MissingReply();
    await press(root, VIDEO('v1'));
    expect(playerText(root)).toContain('Видео недоступно');
    expect(visible(root, RETRY)).toBe(false);
    await back();
    expect(currentRoute()).toBe('Post');
    withData([okVideo('other', ALL)]);
    // The Пост still shows v1 (its own cache); the player's E8 no longer has it.
    await press(root, VIDEO('v1'));
    expect(playerText(root)).toContain('Видео недоступно');
    await unmount(root);
  });

  it('E8 fails (Server): the error with «Повторить» (busy while it runs) / «Назад»; Повторить → E8 again → plays', async () => {
    const root = await openPost();
    e8 = () => ({ status: 503, body: {} });
    await press(root, VIDEO('v1'), { settle: { timerRounds: 30 } });
    expect(playerText(root)).toContain('Не удалось воспроизвести видео');
    expect(playerText(root)).toContain('Boosty сейчас не отвечает');
    expect(lastFocusTarget()).toBe(RETRY);
    const pending = deferred();
    e8 = () => pending.promise;
    await press(root, RETRY);
    expect(one(root, RETRY).props.accessibilityState).toMatchObject({ busy: true });
    pending.resolve({ status: 200, body: postDetail(FEED_BLOG, POST, ONE) });
    await settle();
    expect(engine.props?.source.format).toBe('hls');
    await unmount(root);
  });

  it('an engine error: one automatic recovery (Story 4.4); the second error: the error state; Повторить → one fresh E8 and a new engine; Back exits', async () => {
    const root = await openPlayer();
    expect(engine.mounts).toBe(1);
    const before = e8Calls().length;
    await fire('onError', '22004');
    expect(e8Calls()).toHaveLength(before + 1);
    expect(engine.mounts).toBe(2);
    await fire('onError', '22004');
    expect(engine.props).toBeNull();
    expect(e8Calls()).toHaveLength(before + 1);
    expect(playerText(root)).toContain('Не удалось воспроизвести видео');
    expect(lastFocusTarget()).toBe(RETRY);
    await press(root, RETRY);
    expect(e8Calls()).toHaveLength(before + 2);
    expect(engine.mounts).toBe(3);
    expect(engine.props?.paused).toBe(false);
    // The budget is still used (no 30 s of playback): the error state, no E8.
    await fire('onError', null);
    expect(e8Calls()).toHaveLength(before + 2);
    expect(visible(root, RETRY)).toBe(true);
    await back();
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });
});

describe('overlay, keys and seeking (matrix «Seek», «Auto-hide», «Back», «Buffering»)', () => {
  it('OK on the surface: pause and the overlay (author, titles, timeline, elapsed/remaining, play/pause); focus on the timeline', async () => {
    withData([okVideo('v1', ALL, { title: 'Видео часть' }), ...paragraph('Body')]);
    const root = await openPlayer();
    expect(visible(root, 'player/overlay')).toBe(false);
    focusMock.mockClear();
    await press(root, SURFACE);
    expect(engine.props?.paused).toBe(true);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(lastFocusTarget()).toBe(TIMELINE);
    const overlay = text(byTestId(root, 'player/overlay')[0]);
    expect(overlay).toContain('redacted'); // the author
    expect(overlay).toContain(`Title of ${POST}`);
    expect(overlay).toContain('Видео часть');
    expect(text(byTestId(root, 'player/elapsed')[0])).toContain('0:00');
    expect(text(byTestId(root, 'player/remaining')[0])).toContain('−10:00');
    expect(one(root, PLAYPAUSE).props.accessibilityLabel).toBe('Воспроизвести');
    expect(one(root, TIMELINE).props.accessibilityLabel).toBe('Позиция 0:00 из 10:00');
    // The surface is not focusable behind the overlay; −10 · play/pause · +10 · ⚙ (Story 4.3).
    expect(byTestId(root, 'player/page')[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
      TIMELINE,
      BACK10,
      PLAYPAUSE,
      FORWARD10,
      SETTINGS,
    ]);
    expect(overlay).toContain('Настройки');
    // OK on the timeline and on play/pause toggle.
    await press(root, TIMELINE);
    expect(engine.props?.paused).toBe(false);
    await press(root, PLAYPAUSE);
    expect(engine.props?.paused).toBe(true);
    expect(one(root, PLAYPAUSE).props.accessibilityLabel).toBe('Воспроизвести');
    await unmount(root);
  });

  it.each(['Video', 'Видео 1'])('a generic video title %p is hidden: only the post title', async title => {
    withData([okVideo('v1', ALL, { title })]);
    const root = await openPlayer();
    await key('up');
    expect(visible(root, 'player/video-title')).toBe(false);
    expect(text(byTestId(root, 'player/title')[0])).toContain(`Title of ${POST}`);
    await unmount(root);
  });

  it('the bubble time never wraps: one line in a box wide enough for «1:11:21»', async () => {
    withData([okVideo('v1', ALL, { duration: 7200 })]);
    const root = await openPlayer();
    await fire('onLoad', { durationSec: 7200 });
    await fire('onProgress', 4276);
    await key('right');
    const time = byTestId(root, 'player/bubble/time')[0];
    expect(text(time)).toContain('1:11:21');
    expect(time.props.numberOfLines).toBe(1);
    const box = StyleSheet.flatten(byTestId(root, 'player/bubble')[0].props.style);
    expect(box.width).toBeGreaterThanOrEqual(100);
    expect(box).toMatchObject({ alignItems: 'center', marginLeft: -(box.width as number) / 2 });
    await unmount(root);
  });

  it('the video title is not repeated when it equals the post title or is empty', async () => {
    withData([okVideo('v1', ALL, { title: `Title of ${POST}` })]);
    const root = await openPlayer();
    await key('up');
    expect(visible(root, 'player/video-title')).toBe(false);
    await unmount(root);
  });

  it('matrix «Seek»: → ×3 quickly → bubble +5, +10, +20 (accelerated), one engine seek 600 ms after the last; presses build on the in-flight target', async () => {
    const root = await openPlayer();
    await fire('onProgress', 100);
    await key('right');
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(text(byTestId(root, 'player/bubble')[0])).toContain('1:45');
    expect(StyleSheet.flatten(byTestId(root, 'player/bubble')[0].props.style)).toMatchObject({
      left: `${(105 / 600) * 100}%`,
      alignItems: 'center',
    });
    // The thumb and the fill follow the target (owner decision 2026-10-27).
    expect(StyleSheet.flatten(byTestId(root, 'player/thumb')[0].props.style)).toMatchObject({
      left: `${(105 / 600) * 100}%`,
    });
    expect(StyleSheet.flatten(byTestId(root, 'player/progress')[0].props.style)).toMatchObject({
      width: `${(105 / 600) * 100}%`,
    });
    await advance(200);
    await key('right');
    expect(text(byTestId(root, 'player/bubble')[0])).toContain('1:50');
    await advance(200);
    await key('right');
    expect(text(byTestId(root, 'player/bubble')[0])).toContain('2:00');
    expect(engine.seek).not.toHaveBeenCalled();
    await advance(599);
    expect(engine.seek).not.toHaveBeenCalled();
    await advance(1);
    expect(engine.seek).toHaveBeenCalledTimes(1);
    expect(engine.seek).toHaveBeenCalledWith(120);
    // In flight (the engine still reports 100): ← builds on 120.
    await key('left');
    expect(text(byTestId(root, 'player/bubble')[0])).toContain('1:55');
    await advance(600);
    expect(engine.seek).toHaveBeenLastCalledWith(115);
    await fire('onSeekDone', 115);
    expect(visible(root, 'player/bubble')).toBe(false);
    await fire('onProgress', 115);
    expect(StyleSheet.flatten(byTestId(root, 'player/thumb')[0].props.style)).toMatchObject({
      left: `${(115 / 600) * 100}%`,
    });
    expect(text(byTestId(root, 'player/elapsed')[0])).toContain('1:55');
    await unmount(root);
  });

  it('matrix «OK during a pending seek»: → ×3 then OK before 600 ms → one seek to the pending target at once, still playing; OK with no pending seek → pause', async () => {
    const root = await openPlayer();
    await fire('onProgress', 100);
    await key('right');
    await key('right');
    await key('right');
    expect(engine.seek).not.toHaveBeenCalled();
    await focusOn(root, TIMELINE);
    await press(root, TIMELINE);
    expect(engine.seek).toHaveBeenCalledTimes(1);
    expect(engine.seek).toHaveBeenCalledWith(120);
    expect(engine.props?.paused).toBe(false);
    await advance(600);
    expect(engine.seek).toHaveBeenCalledTimes(1);
    await fire('onSeekDone', 120);
    await press(root, TIMELINE);
    expect(engine.props?.paused).toBe(true);
    await unmount(root);
  });

  it('Play/Pause key during a pending seek: commits it first, then toggles', async () => {
    const root = await openPlayer();
    await fire('onProgress', 100);
    await key('right');
    await key('playPause');
    expect(engine.seek).toHaveBeenCalledWith(105);
    expect(engine.props?.paused).toBe(true);
    await unmount(root);
  });

  it('−10 · play/pause · +10 centered under the timeline; the gear «Настройки» at the right end of the same row (Story 4.3 owner decision)', async () => {
    const root = await openPlayer();
    await key('up');
    const row = byTestId(root, 'player/controls')[0];
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row', justifyContent: 'center' });
    const center = byTestId(root, 'player/controls/center')[0];
    expect(center.queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([BACK10, PLAYPAUSE, FORWARD10]);
    const end = byTestId(root, 'player/controls/end')[0];
    expect(StyleSheet.flatten(end.props.style)).toMatchObject({ position: 'absolute', right: 0 });
    expect(end.queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([SETTINGS]);
    expect(one(root, SETTINGS).props.accessibilityLabel).toBe('Настройки');
    expect(one(root, BACK10).props.accessibilityLabel).toBe('Назад на 10 секунд');
    expect(one(root, FORWARD10).props.accessibilityLabel).toBe('Вперёд на 10 секунд');
    // SVG icons (ADR 0013), not Unicode glyphs.
    expect(byTestId(root, `${SETTINGS}/icon`).length).toBeGreaterThan(0);
    expect(byTestId(root, `${BACK10}/icon`).length).toBeGreaterThan(0);
    expect(byTestId(root, `${FORWARD10}/icon`).length).toBeGreaterThan(0);
    expect(text(one(root, SETTINGS))).not.toContain('⚙');
    await unmount(root);
  });

  it('±10 s: OK moves the target by exactly 10 s, quick OKs accumulate, one seek 600 ms after the last; clamped', async () => {
    const root = await openPlayer();
    await fire('onProgress', 100);
    await key('up');
    await focusOn(root, FORWARD10);
    engine.seek.mockClear();
    await press(root, FORWARD10);
    expect(text(byTestId(root, 'player/bubble')[0])).toContain('1:50');
    await advance(300);
    await press(root, FORWARD10);
    await press(root, FORWARD10);
    expect(text(byTestId(root, 'player/bubble')[0])).toContain('2:10');
    await advance(599);
    expect(engine.seek).not.toHaveBeenCalled();
    await advance(1);
    expect(engine.seek).toHaveBeenCalledTimes(1);
    expect(engine.seek).toHaveBeenCalledWith(130);
    expect(engine.props?.paused).toBe(false);
    await fire('onSeekDone', 130);
    // −10 builds the same way; clamped at 0.
    await fire('onProgress', 5);
    engine.seek.mockClear();
    await press(root, BACK10);
    await press(root, BACK10);
    await advance(600);
    expect(engine.seek).toHaveBeenCalledWith(0);
    await fire('onSeekDone', 0);
    // Clamped at the end (duration 600: the last whole second).
    await fire('onProgress', 595);
    engine.seek.mockClear();
    await press(root, FORWARD10);
    await advance(600);
    expect(engine.seek).toHaveBeenCalledWith(599);
    await unmount(root);
  });

  it('raw ← → on −10, +10 and ⚙ never seek (focus moves natively)', async () => {
    const root = await openPlayer();
    await fire('onProgress', 100);
    await key('up');
    engine.seek.mockClear();
    for (const id of [BACK10, FORWARD10, SETTINGS]) {
      await focusOn(root, id);
      await key('right');
      await key('left');
    }
    await advance(1_000);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(visible(root, 'player/bubble')).toBe(false);
    await unmount(root);
  });

  it('the entry guard also ignores OK on the surface inside the window', async () => {
    const root = await openPlayer(VIDEO('v1'), { load: false });
    await fire('onLoad', { durationSec: 600 });
    await focusOn(root, SURFACE);
    await press(root, SURFACE, { focus: false });
    expect(engine.props?.paused).toBe(false);
    expect(visible(root, 'player/overlay')).toBe(false);
    await press(root, SURFACE, { focus: false });
    expect(engine.props?.paused).toBe(true);
    await unmount(root);
  });

  it('seek presses before the duration is known only show the overlay', async () => {
    const root = await openPlayer(VIDEO('v1'), { load: false });
    await advance(600);
    await key('right');
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(visible(root, 'player/bubble')).toBe(false);
    await advance(700);
    expect(engine.seek).not.toHaveBeenCalled();
    await fire('onLoad', { durationSec: 600 });
    await key('right');
    expect(visible(root, 'player/bubble')).toBe(true);
    await unmount(root);
  });

  it('media keys play/pause commit a pending seek first', async () => {
    const root = await openPlayer();
    await fire('onProgress', 100);
    await key('right');
    await key('pause');
    expect(engine.seek).toHaveBeenCalledWith(105);
    expect(engine.props?.paused).toBe(true);
    await fire('onSeekDone', 105);
    await key('right');
    await key('play');
    expect(engine.seek).toHaveBeenLastCalledWith(110);
    expect(engine.props?.paused).toBe(false);
    await unmount(root);
  });

  it('a late seek report of an earlier seek does not end the newer seek (the bubble stays)', async () => {
    const root = await openPlayer();
    await fire('onProgress', 100);
    await key('right');
    await advance(600); // 105 in flight
    await fire('onSeekDone', 105);
    await key('right');
    await advance(600); // 110 in flight
    await fire('onSeekDone', 105);
    expect(text(byTestId(root, 'player/bubble')[0])).toContain('1:50');
    await fire('onSeekDone', 110);
    expect(visible(root, 'player/bubble')).toBe(false);
    await unmount(root);
  });

  describe('hold-to-seek (native seek keys)', () => {
    const setEnabled = jest.fn();
    const native = async (dpad: 'left' | 'right', action: 'down' | 'up', repeat = 0) => {
      await act(async () => {
        DeviceEventEmitter.emit('seekKey', { key: dpad, action, repeat });
      });
      await settle();
    };
    beforeEach(() => {
      setEnabled.mockClear();
      installNativeModules({ SeekKeys: { setEnabled } });
    });

    /** Hold → from 100 s: down, 8 repeats 50 ms apart, release, React Native's key up → target 120. */
    const holdRight = async () => {
      await native('right', 'down', 0);
      for (let i = 1; i <= 8; i += 1) {
        await advance(50);
        await native('right', 'down', i);
      }
      await native('right', 'up');
      await key('right'); // React Native's key up of the same press: not another press
    };
    const leftOf = (root: Root, id: string) =>
      StyleSheet.flatten(byTestId(root, id)[0].props.style) as { left?: string; width?: string };

    it('enabled only while the player shows; a hold seeks with a growing step and pauses; the release does not commit (owner decisions 2026-10-27)', async () => {
      const root = await openPlayer();
      expect(setEnabled).toHaveBeenLastCalledWith(true);
      await fire('onProgress', 100);
      await native('right', 'down', 0);
      expect(text(byTestId(root, 'player/bubble')[0])).toContain('1:45');
      await holdRightRest();
      // 400 ms of repeats at most every 200 ms: two more presses (+5, +10).
      expect(text(byTestId(root, 'player/bubble')[0])).toContain('2:00');
      await advance(4_000);
      expect(engine.seek).not.toHaveBeenCalled();
      // The hold-scrub paused playback (owner decision 2026-10-27).
      expect(engine.props?.paused).toBe(true);
      expect(visible(root, 'player/overlay')).toBe(true);
      await back(); // cancels the held target
      await back(); // hides the overlay
      await back(); // exits
      await advance(1_000);
      expect(setEnabled).toHaveBeenLastCalledWith(false);
      await unmount(root);

      async function holdRightRest() {
        for (let i = 1; i <= 8; i += 1) {
          await advance(50);
          await native('right', 'down', i);
        }
        await native('right', 'up');
        await key('right');
      }
    });

    it('a held target: OK commits exactly one seek to it and playback continues', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      await holdRight();
      expect(engine.seek).not.toHaveBeenCalled();
      await focusOn(root, TIMELINE);
      await press(root, TIMELINE);
      expect(engine.seek).toHaveBeenCalledTimes(1);
      expect(engine.seek).toHaveBeenCalledWith(120);
      expect(engine.props?.paused).toBe(false);
      await advance(6_000);
      expect(engine.seek).toHaveBeenCalledTimes(1);
      await unmount(root);
    });

    it('a held target: the Play/Pause key acts like OK (commit, keep playing)', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      await holdRight();
      await key('playPause');
      expect(engine.seek).toHaveBeenCalledWith(120);
      expect(engine.props?.paused).toBe(false);
      await unmount(root);
    });

    it('a held target: 5 s without input cancels it (no seek; thumb and fill back at the position)', async () => {
      const root = await openPlayer();
      await fire('onProgress', 300);
      await holdRight();
      expect(leftOf(root, 'player/thumb').left).toBe(`${(320 / 600) * 100}%`);
      await advance(4_999);
      expect(visible(root, 'player/bubble')).toBe(true);
      await advance(1);
      expect(visible(root, 'player/bubble')).toBe(false);
      expect(engine.seek).not.toHaveBeenCalled();
      expect(leftOf(root, 'player/thumb').left).toBe('50%');
      expect(leftOf(root, 'player/progress').width).toBe('50%');
      await unmount(root);
    });

    it('a held target: Back cancels it, the player and the overlay stay', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      await holdRight();
      await back();
      expect(currentRoute()).toBe('Player');
      expect(visible(root, 'player/bubble')).toBe(false);
      expect(visible(root, 'player/overlay')).toBe(true);
      await advance(6_000);
      expect(engine.seek).not.toHaveBeenCalled();
      await unmount(root);
    });

    it('a held target: a ← press builds on it and restarts the 5 s timeout', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      await holdRight();
      await advance(4_000);
      await native('left', 'down', 0);
      await native('left', 'up');
      await key('left');
      expect(text(byTestId(root, 'player/bubble')[0])).toContain('1:55');
      await advance(4_000); // 8 s after the hold, 4 s after the press
      expect(visible(root, 'player/bubble')).toBe(true);
      expect(engine.seek).not.toHaveBeenCalled();
      await advance(1_000);
      expect(visible(root, 'player/bubble')).toBe(false);
      expect(engine.seek).not.toHaveBeenCalled();
      await unmount(root);
    });

    it('hold-scrub pauses playback; OK commits and resumes at the target (owner decision 2026-10-27)', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      await native('right', 'down', 0);
      expect(engine.props?.paused).toBe(false);
      await advance(50);
      await native('right', 'down', 1); // the hold starts
      expect(engine.props?.paused).toBe(true);
      expect(one(root, PLAYPAUSE).props.accessibilityLabel).toBe('Воспроизвести');
      await native('right', 'up');
      await key('right');
      await advance(4_999);
      expect(engine.props?.paused).toBe(true);
      // Never auto-hides while the scrub is pending.
      expect(visible(root, 'player/overlay')).toBe(true);
      await unmount(root);
    });

    it('hold-scrub: OK commits and resumes; Back or the timeout cancel and resume without a seek', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      await holdRight();
      expect(engine.props?.paused).toBe(true);
      expect(visible(root, 'player/overlay')).toBe(true);
      await focusOn(root, TIMELINE);
      await press(root, TIMELINE);
      expect(engine.seek).toHaveBeenCalledWith(120);
      expect(engine.props?.paused).toBe(false);
      await fire('onSeekDone', 120);
      await fire('onProgress', 120);
      // Back cancels: no seek, playback resumes.
      await holdRight();
      expect(engine.props?.paused).toBe(true);
      await back();
      expect(engine.props?.paused).toBe(false);
      expect(currentRoute()).toBe('Player');
      // The 5 s idle cancels the same way.
      await holdRight();
      expect(engine.props?.paused).toBe(true);
      await advance(5_000);
      expect(engine.props?.paused).toBe(false);
      expect(engine.seek).toHaveBeenCalledTimes(1);
      await unmount(root);
    });

    it('hold-scrub: paused before the hold stays paused after a commit and after a cancel', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      await key('playPause');
      expect(engine.props?.paused).toBe(true);
      await holdRight();
      await key('playPause'); // acts like OK on a held target
      expect(engine.seek).toHaveBeenCalledWith(120);
      expect(engine.props?.paused).toBe(true);
      await fire('onSeekDone', 120);
      await holdRight();
      await back();
      expect(engine.props?.paused).toBe(true);
      expect(engine.seek).toHaveBeenCalledTimes(1);
      await unmount(root);
    });

    it('a hold that starts during a quick-press target becomes a held scrub (pauses, no auto-commit)', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      await native('right', 'down', 0);
      await native('right', 'up');
      await key('right');
      await advance(300);
      await native('right', 'down', 0);
      await advance(50);
      await native('right', 'down', 1);
      expect(engine.props?.paused).toBe(true);
      await native('right', 'up');
      await key('right');
      await advance(1_000);
      expect(engine.seek).not.toHaveBeenCalled();
      await unmount(root);
    });

    it('quick presses never pause', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      for (let i = 0; i < 3; i += 1) {
        await native('right', 'down', 0);
        expect(engine.props?.paused).toBe(false);
        await native('right', 'up');
        await key('right');
      }
      await advance(600);
      expect(engine.seek).toHaveBeenCalledWith(120);
      expect(engine.props?.paused).toBe(false);
      await unmount(root);
    });

    it('the accent fill follows the pending target, like the thumb', async () => {
      const root = await openPlayer();
      await fire('onProgress', 300);
      await key('right');
      expect(leftOf(root, 'player/progress').width).toBe(`${(305 / 600) * 100}%`);
      expect(leftOf(root, 'player/thumb').left).toBe(`${(305 / 600) * 100}%`);
      await advance(600);
      await fire('onSeekDone', 305);
      expect(leftOf(root, 'player/progress').width).toBe(`${(305 / 600) * 100}%`);
      await fire('onProgress', 306);
      expect(leftOf(root, 'player/progress').width).toBe(`${(306 / 600) * 100}%`);
      await unmount(root);
    });

    it('quick presses (down/up, no repeats) keep the 600 ms bubble window', async () => {
      const root = await openPlayer();
      await fire('onProgress', 100);
      for (let i = 0; i < 3; i += 1) {
        await native('right', 'down', 0);
        await native('right', 'up');
        await key('right');
      }
      expect(text(byTestId(root, 'player/bubble')[0])).toContain('2:00');
      expect(engine.seek).not.toHaveBeenCalled();
      await advance(600);
      expect(engine.seek).toHaveBeenCalledTimes(1);
      expect(engine.seek).toHaveBeenCalledWith(120);
      await unmount(root);
    });
  });

  it('keys act on key up only; ← → on play/pause do not seek; ↑ ↓ show the overlay', async () => {
    const root = await openPlayer();
    await key('right', 0);
    expect(visible(root, 'player/overlay')).toBe(false);
    await key('down');
    expect(visible(root, 'player/overlay')).toBe(true);
    await focusOn(root, PLAYPAUSE);
    await key('right');
    await advance(700);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(visible(root, 'player/bubble')).toBe(false);
    await focusOn(root, TIMELINE);
    await key('right');
    await advance(600);
    expect(engine.seek).toHaveBeenCalledWith(5);
    await unmount(root);
  });

  it('the entry guard: the first key up right after focus lands on the player is ignored', async () => {
    const root = await openPlayer(VIDEO('v1'), { load: false });
    await fire('onLoad', { durationSec: 600 });
    await focusOn(root, SURFACE);
    await key('right');
    expect(visible(root, 'player/overlay')).toBe(false);
    await key('right');
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(visible(root, 'player/bubble')).toBe(true);
    // Near the start the bubble aligns with the track's start (never past the safe area).
    expect(StyleSheet.flatten(byTestId(root, 'player/bubble')[0].props.style)).toMatchObject({
      left: 0,
      alignItems: 'flex-start',
    });
    await unmount(root);
  });

  it('media keys: Play/Pause, Play, Pause toggle; FF/Next forward, Rew/Prev back; Stop exits', async () => {
    const root = await openPlayer();
    await key('playPause');
    expect(engine.props?.paused).toBe(true);
    expect(visible(root, 'player/overlay')).toBe(true);
    await key('play');
    expect(engine.props?.paused).toBe(false);
    await key('pause');
    expect(engine.props?.paused).toBe(true);
    await fire('onProgress', 200);
    for (const [k, target] of [
      ['fastForward', 205],
      ['next', 205],
      ['rewind', 195],
      ['previous', 195],
    ] as const) {
      await key(k);
      await advance(600);
      expect(engine.seek).toHaveBeenLastCalledWith(target);
      await fire('onSeekDone', target);
      await fire('onProgress', 200);
    }
    focusMock.mockClear();
    await key('stop');
    expect(currentRoute()).toBe('Post');
    // The stack's pop transition runs on timers; then the player is gone.
    await advance(1_000);
    expect(engine.props).toBeNull();
    expect(lastFocusTarget()).toBe(VIDEO('v1'));
    await unmount(root);
  });

  it('matrix «Auto-hide»: playing, 5 s idle → hides (focus → the surface); never while paused or seeking', async () => {
    const root = await openPlayer();
    await key('up');
    expect(visible(root, 'player/overlay')).toBe(true);
    await advance(4999);
    expect(visible(root, 'player/overlay')).toBe(true);
    focusMock.mockClear();
    await advance(1);
    expect(visible(root, 'player/overlay')).toBe(false);
    expect(lastFocusTarget()).toBe(SURFACE);
    // Input restarts the timer.
    await key('up');
    await advance(4000);
    await key('down');
    await advance(4000);
    expect(visible(root, 'player/overlay')).toBe(true);
    // Paused: never.
    await key('playPause');
    await advance(20_000);
    expect(visible(root, 'player/overlay')).toBe(true);
    // Seeking (in flight, not reported done): never.
    await key('playPause');
    await key('right');
    await advance(600);
    await advance(4_000);
    expect(visible(root, 'player/overlay')).toBe(true);
    await fire('onSeekDone', 5);
    await advance(5_000);
    expect(visible(root, 'player/overlay')).toBe(false);
    await unmount(root);
  });

  it('matrix «Back»: overlay shown → hide it (focus → the surface); hidden → exit, focus on the origin element', async () => {
    withData(TWO);
    const root = await openPost();
    await focusOn(root, VIDEO('v2'));
    await press(root, VIDEO('v2'));
    await fire('onLoad', { durationSec: 600 });
    await advance(600);
    await key('up');
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Player');
    expect(visible(root, 'player/overlay')).toBe(false);
    expect(lastFocusTarget()).toBe(SURFACE);
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Post');
    expect(routeNames()).toEqual(['Shell', 'Post']);
    expect(lastFocusTarget()).toBe(VIDEO('v2'));
    // After the pop transition the engine is released; the player's E8
    // entry is dropped soon after.
    await advance(1_000);
    expect(engine.props).toBeNull();
    expect(engine.unmounts).toBe(1);
    await advance(2_000);
    expect(queryClient.getQueryData(queryKeys.mediaSource(FEED_BLOG, POST, 'v2'))).toBeUndefined();
    await unmount(root);
  });

  it('exit from «Смотреть» returns focus to «Смотреть»', async () => {
    const root = await openPlayer(PRIMARY);
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Post');
    expect(lastFocusTarget()).toBe(PRIMARY);
    await unmount(root);
  });

  it('matrix «Buffering»: the spinner only after 500 ms', async () => {
    const root = await openPlayer();
    expect(visible(root, 'player/spinner')).toBe(false);
    await fire('onBuffering', true);
    await advance(499);
    expect(visible(root, 'player/spinner')).toBe(false);
    await advance(1);
    expect(visible(root, 'player/spinner')).toBe(true);
    await fire('onBuffering', false);
    expect(visible(root, 'player/spinner')).toBe(false);
    // A short stall never shows it.
    await fire('onBuffering', true);
    await advance(300);
    await fire('onBuffering', false);
    await advance(1_000);
    expect(visible(root, 'player/spinner')).toBe(false);
    await unmount(root);
  });

  it('Story 4.5: the end exits to the Post (no autoplay); focus on the next unfinished MediaRow', async () => {
    withData(TWO);
    const root = await openPlayer();
    await fire('onProgress', 599);
    focusMock.mockClear();
    await fire('onEnd');
    expect(currentRoute()).toBe('Post');
    expect(navigationRef.getRootState()?.routes.some(r => r.name === 'Player')).toBe(false);
    expect(lastFocusTarget()).toBe(VIDEO('v2'));
    await unmount(root);
  });

  it('Story 4.5: a finished next row is skipped; the first unfinished one after the ended video gets focus', async () => {
    withData([okVideo('v1', ALL), okVideo('v2', ALL, { title: '' }), okVideo('v3', ALL, { title: '' }), ...paragraph('Body')]);
    progressStore.put({
      ref: { blogUrl: FEED_BLOG, postId: POST, mediaId: 'v2' },
      positionSec: 590,
      durationSec: 600,
      updatedAt: Date.now(),
      meta: { title: '', postTitle: '', authorName: '', previewUrl: null, durationSec: 600 },
    });
    const root = await openPlayer();
    await fire('onProgress', 599);
    focusMock.mockClear();
    await fire('onEnd');
    expect(currentRoute()).toBe('Post');
    expect(lastFocusTarget()).toBe(VIDEO('v3'));
    await unmount(root);
  });

  it('Story 4.5: the end of the last unfinished video returns focus to the primary', async () => {
    withData(TWO);
    const root = await openPlayer(VIDEO('v2'));
    await fire('onProgress', 599);
    focusMock.mockClear();
    await fire('onEnd');
    expect(currentRoute()).toBe('Post');
    expect(lastFocusTarget()).toBe(PRIMARY);
    await unmount(root);
  });

  it('Story 4.5: Back before the end still returns to the origin element', async () => {
    withData(TWO);
    const root = await openPlayer();
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Post');
    expect(lastFocusTarget()).toBe(VIDEO('v1'));
    await unmount(root);
  });
});

describe('PlaybackArbiter and logs (matrix «Arbiter», «CDN headers»)', () => {
  it('another playback holding the slot is stopped when the player starts; exit releases the slot', async () => {
    const other = { stop: jest.fn() };
    const release = playbackArbiter.claim(other);
    const root = await openPlayer();
    expect(other.stop).toHaveBeenCalledTimes(1);
    expect(playbackArbiter.current()).not.toBe(other);
    // Someone else takes the slot: the player pauses.
    const third = { stop: jest.fn() };
    let releaseThird = () => {};
    await act(async () => {
      releaseThird = playbackArbiter.claim(third);
    });
    await settle();
    expect(third.stop).not.toHaveBeenCalled();
    expect(engine.props?.paused).toBe(true);
    releaseThird();
    await back();
    expect(currentRoute()).toBe('Post');
    await advance(1_000);
    expect(playbackArbiter.current()).toBeNull();
    release();
    await unmount(root);
  });

  it('no signed URL in the log ring, the player route or the post query', async () => {
    const root = await openPlayer();
    await fire('onError', 'x'.repeat(40));
    const all = JSON.stringify(logger.entries());
    expect(all).not.toMatch(/example\.invalid\/player/);
    const post = queryClient.getQueryData(queryKeys.post(FEED_BLOG, POST));
    expect(JSON.stringify(post)).not.toMatch(/example\.invalid\/player|playerUrls/);
    await unmount(root);
  });

  it('the live E8 shape plays its HLS entry', async () => {
    e8 = (_req, blogUrl, postId) => {
      const body = e8Accessible();
      return { status: 200, body: { ...body, id: postId, user: { ...(body.user as object), blogUrl } } };
    };
    const root = await openPost();
    await press(root, VIDEO('synthetic-id-7'));
    expect(engine.props?.source).toEqual({ uri: URL, format: 'hls' });
    expect(focusTargets()).toContain(SURFACE);
    await unmount(root);
  });
});

describe('review fixes (Story 4.1)', () => {
  it('reopen of the same video within gcTime: no play of the cached URL; one more E8; the engine starts once with the new source', async () => {
    let n = 0;
    e8 = (_req, blogUrl, postId) => {
      n += 1;
      return {
        status: 200,
        body: postDetail(blogUrl, postId, [okVideo('v1', [{ type: 'hls', url: `${URL}-${n}` }])]),
      };
    };
    const root = await openPlayer();
    expect(engine.props?.source.uri).toBe(`${URL}-2`); // E8 #1 Пост, #2 player
    await back();
    for (let i = 0; i < 10 && engine.props !== null; i += 1) {
      await advance(50);
    }
    expect(engine.props).toBeNull();
    expect(queryClient.getQueryData(queryKeys.mediaSource(FEED_BLOG, POST, 'v1'))).toBeDefined();
    const mountsBefore = engine.mounts;
    const pending = deferred();
    e8 = () => pending.promise;
    await press(root, VIDEO('v1'));
    expect(currentRoute()).toBe('Player');
    expect(engine.props).toBeNull();
    expect(visible(root, 'player/spinner')).toBe(true);
    pending.resolve({
      status: 200,
      body: postDetail(FEED_BLOG, POST, [okVideo('v1', [{ type: 'hls', url: `${URL}-fresh` }])]),
    });
    await settle();
    expect(engine.mounts).toBe(mountsBefore + 1);
    expect(engine.props?.source.uri).toBe(`${URL}-fresh`);
    await unmount(root);
  });

  it('a retry whose fresh E8 fails shows that error kind (not the generic copy)', async () => {
    const root = await openPlayer();
    await failPastRecovery(null);
    expect(playerText(root)).toContain('Попробуйте ещё раз или вернитесь к посту.');
    e8 = () => ({ status: 503, body: {} });
    await press(root, RETRY, { settle: { timerRounds: 30 } });
    expect(playerText(root)).toContain('Не удалось воспроизвести видео');
    expect(playerText(root)).toContain('Boosty сейчас не отвечает');
    expect(visible(root, RETRY)).toBe(true);
    await unmount(root);
  });

  it('exit keeps the origin route\'s remembered scroll offset and index, pointing it at the origin element', async () => {
    const root = await openPlayer();
    const { origin } = navigationRef.getCurrentRoute()?.params as { origin: { routeKey: string; focusId: string } };
    // What Пост remembered for a row below the first screen.
    focusRestoration.remember(origin.routeKey, 'main', `post/${POST}/block/text@1`, 345, 2);
    await back();
    expect(currentRoute()).toBe('Post');
    expect(focusRestoration.peek(origin.routeKey, 'main')).toEqual({
      focusId: VIDEO('v1'),
      scrollOffset: 345,
      index: 2,
    });
    await unmount(root);
  });

  it('the origin is remembered when the route is removed by any path (not only the player\'s exit)', async () => {
    const root = await openPlayer();
    const { origin } = navigationRef.getCurrentRoute()?.params as { origin: { routeKey: string; focusId: string } };
    focusRestoration.remember(origin.routeKey, 'main', `post/${POST}/author`, 0);
    await act(async () => {
      navigationRef.goBack();
    });
    await settle();
    expect(currentRoute()).toBe('Post');
    expect(focusRestoration.peek(origin.routeKey, 'main')?.focusId).toBe(VIDEO('v1'));
    await unmount(root);
  });

  it('a double OK on «Смотреть»: one Player, one player E8', async () => {
    const root = await openPost();
    const before = e8Calls().length;
    const node = one(root, PRIMARY);
    await act(async () => {
      node.props.onClick({ nativeEvent: {} });
      node.props.onClick({ nativeEvent: {} });
    });
    await settle();
    expect(routeNames()).toEqual(['Shell', 'Post', 'Player']);
    expect(e8Calls()).toHaveLength(before + 1);
    await unmount(root);
  });

  it('a Пост refetch that removes the videos while «Смотреть» is focused: focus to the new initial target', async () => {
    const root = await openPost();
    await focusOn(root, PRIMARY);
    withData(paragraph('Only text'));
    focusMock.mockClear();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: queryKeys.post(FEED_BLOG, POST) });
    });
    await settle();
    expect(visible(root, PRIMARY)).toBe(false);
    expect(lastFocusTarget()).toBe(`post/${POST}/block/text@0`);
    await unmount(root);
  });
});

describe('progress and resume (Story 4.2)', () => {
  const RESTART = `post/${POST}/restart`;
  const REF1 = { blogUrl: FEED_BLOG, postId: POST, mediaId: 'v1' };
  const META = { title: 'Title v1', postTitle: `Title of ${POST}`, authorName: 'redacted', previewUrl: null, durationSec: 600 };
  const e9Calls = () => transport.calls.filter(c => c.method === 'PUT' && E9_RE.test(c.path));
  /** E9 positions sent, with their media ids. */
  const e9Sent = () => e9Calls().map(c => `${E9_RE.exec(c.path)?.[1]}@${c.form.time_code}`);
  const statusOf = (root: Root, mediaId: string) => text(byTestId(root, `${VIDEO(mediaId)}/status`)[0] ?? null);
  const label = (root: Root, id: string) => one(root, id).props.accessibilityLabel as string;
  const columnStops = (root: Root) =>
    byTestId(root, 'post/column')[0]
      .queryAll(n => n.props.focusable === true)
      .map(n => n.props.testID as string);
  /** Ticks from `from` to `to`, one a second. */
  async function ticks(from: number, to: number) {
    for (let sec = from; sec <= to; sec += 1) {
      await fire('onProgress', sec);
    }
  }
  /** Пост → OK on `from` → Player, focus on the surface, past the entry guard (not loaded). */
  async function enterPlayer(root: Root, from: string) {
    focusMock.mockClear();
    await press(root, from);
    expect(currentRoute()).toBe('Player');
    await focusOn(root, SURFACE);
    await advance(600);
  }

  it('matrix «Server only»: `timeCode` 300 → «Продолжить», «С начала», «Осталось 5 мин»; the player seeks to 300 and never writes the pre-seek t=0', async () => {
    withData([okVideo('v1', ALL, { timeCode: 300 }), ...paragraph('Body')]);
    const root = await openPost();
    expect(label(root, PRIMARY)).toBe('Продолжить');
    expect(label(root, RESTART)).toBe('С начала');
    // «С начала» is in the primary's row, to its right (owner decision 2026-10-28).
    expect(columnStops(root)).toEqual([`post/${POST}/author`, PRIMARY, RESTART, VIDEO('v1'), `post/${POST}/block/text@1`]);
    expect(byTestId(root, `${PRIMARY}-row`)[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
      PRIMARY,
      RESTART,
    ]);
    expect(statusOf(root, 'v1')).toContain('Осталось 5 мин');
    expect(visible(root, `${VIDEO('v1')}/progress`)).toBe(true);
    expect(label(root, VIDEO('v1'))).toBe('Видео 1. Title v1. 10:00. Осталось 5 мин');
    // The server value never enters the route or the query cache.
    const cached = JSON.stringify(queryClient.getQueryData(queryKeys.post(FEED_BLOG, POST)));
    expect(cached).not.toContain('timeCode');
    expect(cached).not.toContain('300');

    await enterPlayer(root, PRIMARY);
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      ref: REF1,
      origin: { routeKey: expect.any(String), focusId: PRIMARY },
    });
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledTimes(1);
    expect(engine.seek).toHaveBeenCalledWith(300);
    // A new source reports t=0 before the seek: never shown, never written.
    await fire('onProgress', 0);
    await fire('onProgress', 1);
    await press(root, SURFACE); // a pause before the start position: no write either
    await press(root, PLAYPAUSE);
    expect(e9Sent()).toEqual([]);
    await fire('onSeekDone', 300);
    await ticks(301, 312);
    expect(e9Sent()).toEqual(['v1@310']);
    // E9 is the content profile's PUT with the form field, integer seconds.
    const [write] = e9Calls();
    expect(write.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(write.headers.Authorization).toMatch(/^Bearer /);
    expect(write.body).toBe('time_code=310');
    // Back (overlay shown) hides it, then exits: a forced write.
    await back();
    await back();
    expect(currentRoute()).toBe('Post');
    expect(e9Sent()).toEqual(['v1@310', 'v1@312']);
    // The Post now reads the local entry: 312 of 600 → «Осталось 5 мин».
    expect(statusOf(root, 'v1')).toContain('Осталось 5 мин');
    expect(lastFocusTarget()).toBe(PRIMARY);
    await unmount(root);
  });

  it('matrix «Local wins»: local 120, server 300 → starts at 120', async () => {
    withData([okVideo('v1', ALL, { timeCode: 300 }), ...paragraph('Body')]);
    progressStore.put({ ref: REF1, positionSec: 120, durationSec: 600, updatedAt: Date.now(), meta: META });
    const root = await openPost();
    expect(statusOf(root, 'v1')).toContain('Осталось 8 мин');
    await enterPlayer(root, PRIMARY);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(120);
    expect(text(byTestId(root, 'player/page')[0])).not.toContain('5:00');
    await unmount(root);
  });

  it('matrix «Finished»: local 590 of 600 → «Просмотрено», «Смотреть», no «С начала»; starts at 0', async () => {
    progressStore.put({ ref: REF1, positionSec: 590, durationSec: 600, updatedAt: Date.now(), meta: META });
    const root = await openPost();
    expect(statusOf(root, 'v1')).toContain('Просмотрено');
    expect(label(root, PRIMARY)).toBe('Смотреть');
    expect(visible(root, RESTART)).toBe(false);
    await enterPlayer(root, PRIMARY);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).not.toHaveBeenCalled();
    // Starting at 0: the first progress starts reporting (no write until movement).
    await ticks(0, 9);
    expect(e9Sent()).toEqual([]);
    await ticks(10, 10);
    expect(e9Sent()).toEqual(['v1@10']);
    await unmount(root);
  });

  it('matrix «Multi-video» and «Start over»: v1 finished, v2 at 60 → «Продолжить · Видео 2»; «С начала» starts v2 at 0, the first write only after a pause', async () => {
    withData([
      okVideo('v1', ALL, { timeCode: 590 }),
      okVideo('v2', ALL, { title: '', timeCode: 60 }),
      ...paragraph('Body'),
    ]);
    const root = await openPost();
    expect(label(root, PRIMARY)).toBe('Продолжить · Видео 2');
    expect(label(root, RESTART)).toBe('С начала');
    expect(statusOf(root, 'v1')).toContain('Просмотрено');
    expect(statusOf(root, 'v2')).toContain('Осталось 9 мин');
    expect(label(root, VIDEO('v2'))).toBe('Видео 2. 10:00. Осталось 9 мин');
    // The primary targets v2.
    await enterPlayer(root, PRIMARY);
    expect(navigationRef.getCurrentRoute()?.params).toMatchObject({ ref: { mediaId: 'v2' } });
    await back();
    expect(currentRoute()).toBe('Post');
    // «С начала»: the same video, from 0.
    engine.reset();
    await enterPlayer(root, RESTART);
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      ref: { ...REF1, mediaId: 'v2' },
      origin: { routeKey: expect.any(String), focusId: RESTART },
      start: 'beginning',
    });
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).not.toHaveBeenCalled();
    await ticks(0, 5);
    expect(e9Sent()).toEqual([]);
    await press(root, SURFACE); // a user pause
    expect(e9Sent()).toEqual(['v2@5']);
    await unmount(root);
  });

  it('matrix «Hold-scrub»: the hold pause writes nothing; the commit then counts as movement', async () => {
    const setEnabled = jest.fn();
    installNativeModules({ SeekKeys: { setEnabled } });
    const native = async (dpad: 'left' | 'right', action: 'down' | 'up', repeat = 0) => {
      await act(async () => {
        DeviceEventEmitter.emit('seekKey', { key: dpad, action, repeat });
      });
      await settle();
    };
    const root = await openPlayer();
    await ticks(0, 3);
    expect(e9Sent()).toEqual([]);
    await native('right', 'down', 0);
    for (let i = 1; i <= 8; i += 1) {
      await advance(50);
      await native('right', 'down', i);
    }
    await native('right', 'up');
    await key('right');
    expect(engine.props?.paused).toBe(true);
    expect(e9Sent()).toEqual([]);
    // OK commits the held target (one seek) and resumes; the report there is movement.
    await press(root, TIMELINE);
    const target = engine.seek.mock.calls[0][0] as number;
    expect(target).toBeGreaterThanOrEqual(13);
    await fire('onSeekDone', target);
    await fire('onProgress', target);
    expect(e9Sent()).toEqual([`v1@${target}`]);
    await unmount(root);
  });

  it('background and the end write at once (after the first 10 s); the end marks the video watched', async () => {
    let appStateHandlers: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
      appStateHandlers.push(listener);
      return {
        remove: () => {
          appStateHandlers = appStateHandlers.filter(h => h !== listener);
        },
      };
    }) as unknown as typeof AppState.addEventListener);
    const root = await openPlayer();
    const background = async () => {
      await act(async () => {
        for (const state of ['background', 'active']) {
          for (const h of [...appStateHandlers]) {
            h(state);
          }
        }
      });
      await settle();
    };
    // A short visit (< 10 s from the start, no pause): background writes nothing.
    await ticks(0, 4);
    await background();
    expect(e9Sent()).toEqual([]);
    await ticks(5, 14);
    await background();
    expect(e9Sent()).toEqual(['v1@10', 'v1@14']);
    await fire('onProgress', 598);
    await fire('onEnd');
    expect(e9Sent()).toEqual(['v1@10', 'v1@14', 'v1@598', 'v1@600']);
    // Story 4.5: the end exits to the Post by itself.
    expect(currentRoute()).toBe('Post');
    expect(statusOf(root, 'v1')).toContain('Просмотрено');
    expect(label(root, PRIMARY)).toBe('Смотреть');
    await unmount(root);
  });

  it('a focused «С начала» that disappears (the video was finished) falls back to the primary', async () => {
    withData([okVideo('v1', ALL, { timeCode: 300 }), ...paragraph('Body')]);
    const root = await openPost();
    await focusOn(root, RESTART);
    await enterPlayer(root, RESTART);
    await fire('onLoad', { durationSec: 600 });
    await fire('onProgress', 0);
    await fire('onProgress', 599);
    focusMock.mockClear();
    await fire('onEnd');
    expect(currentRoute()).toBe('Post');
    expect(visible(root, RESTART)).toBe(false);
    expect(lastFocusTarget()).toBe(PRIMARY);
    await unmount(root);
  });

  it('a failed E9 is not shown and re-sent no sooner than 10 s, with the latest position', async () => {
    e9 = () => ({ network: true });
    const root = await openPlayer();
    await ticks(0, 10);
    expect(e9Sent()).toEqual(['v1@10']);
    e9 = () => ({ status: 200 });
    await ticks(11, 19);
    await advance(9_000);
    expect(e9Sent()).toEqual(['v1@10']);
    expect(text(byTestId(root, 'player/page')[0])).not.toContain('Не удалось');
    // 10 s after the failure: the latest position.
    await advance(1_000);
    expect(e9Sent()).toEqual(['v1@10', 'v1@19']);
    await unmount(root);
  });

  it('a cold start: the status and «Продолжить» come from the persisted local entry', async () => {
    // What an earlier run left on the disk (the `account` database).
    await createAsyncStorage('boostytv-account').setItem(
        'progress.v1',
        JSON.stringify({ v: 1, entries: [{ ref: REF1, positionSec: 120, durationSec: 600, updatedAt: 1, meta: META }] }),
      );
    const root = await openPost();
    expect(label(root, PRIMARY)).toBe('Продолжить');
    expect(statusOf(root, 'v1')).toContain('Осталось 8 мин');
    await enterPlayer(root, PRIMARY);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(120);
    await unmount(root);
  });

  it('the progress logs carry no ids, positions or URLs', async () => {
    e9 = () => ({ network: true });
    const root = await openPlayer();
    await ticks(0, 12);
    const progressLines = logger.entries().filter(e => e.scope === 'progress');
    expect(progressLines.length).toBeGreaterThan(0);
    const logged = JSON.stringify(progressLines);
    expect(logged).not.toContain('v1');
    expect(logged).not.toContain('time_code');
    expect(logged).not.toMatch(/\b10\b/);
    await unmount(root);
  });

  it('short visit (owner decision 2026-10-28): a finished video → «Смотреть» → Back after 2 s: still «Просмотрено», no E9', async () => {
    progressStore.put({ ref: REF1, positionSec: 600, durationSec: 600, updatedAt: Date.now(), meta: META });
    const root = await openPost();
    expect(statusOf(root, 'v1')).toContain('Просмотрено');
    await enterPlayer(root, PRIMARY);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).not.toHaveBeenCalled();
    await ticks(0, 2);
    await back();
    expect(currentRoute()).toBe('Post');
    expect(e9Sent()).toEqual([]);
    expect(statusOf(root, 'v1')).toContain('Просмотрено');
    expect(progressStore.get('v1')?.positionSec).toBe(600);
    await unmount(root);
  });

  it.each([
    ['«Смотреть»', PRIMARY],
    ['«С начала»', `post/${POST}/restart`],
  ])('«Повторить» after a player error (opened with %s) resumes at the last position; the new engine\'s t=0 is never written', async (_name, from) => {
    withData([okVideo('v1', ALL, { timeCode: 30 }), ...paragraph('Body')]);
    const root = await openPost();
    await enterPlayer(root, from);
    await fire('onLoad', { durationSec: 600 });
    if (from === PRIMARY) {
      expect(engine.seek).toHaveBeenCalledWith(30);
      await fire('onSeekDone', 30);
      await ticks(31, 120);
    } else {
      expect(engine.seek).not.toHaveBeenCalled();
      await ticks(0, 120);
    }
    expect(e9Sent()).toContain('v1@120');
    await failPastRecovery();
    expect(visible(root, RETRY)).toBe(true);
    engine.reset();
    await press(root, RETRY);
    expect(e8Calls().length).toBeGreaterThanOrEqual(3);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(120);
    await fire('onProgress', 0);
    await fire('onSeekDone', 120);
    await ticks(121, 131);
    expect(e9Sent()).not.toContain('v1@0');
    expect(e9Sent()).toContain('v1@130');
    await unmount(root);
  });
});

describe('quality (Story 4.3)', () => {
  const SHEET = 'player/sheet';
  const QUALITY = 'player/sheet/quality';
  const MENU = 'player/sheet/quality/menu';
  const Q = (quality: string | number) => `${QUALITY}/${quality}`;
  const device = () => createAsyncStorage('boostytv-device');
  const e9Sent = () =>
    transport.calls
      .filter(c => c.method === 'PUT' && E9_RE.test(c.path))
      .map(c => `${E9_RE.exec(c.path)?.[1]}@${c.form.time_code}`);
  /** HLS + DASH + 360/720/1080 progressive, each with its own URL. */
  const MIXED = [
    { type: 'low', url: `${URL}-360` },
    { type: 'hls', url: `${URL}-hls` },
    { type: 'full_hd', url: `${URL}-1080` },
    { type: 'dash', url: `${URL}-dash` },
    { type: 'high', url: `${URL}-720` },
  ];
  const menuRows = (root: Root) => byTestId(root, MENU)[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID as string);
  const label = (root: Root, id: string) => one(root, id).props.accessibilityLabel as string;
  async function ticks(from: number, to: number) {
    for (let sec = from; sec <= to; sec += 1) {
      await fire('onProgress', sec);
    }
  }
  /** Overlay up, OK on «Настройки»: the sheet. */
  async function openSheet(root: Root) {
    await key('up');
    await focusOn(root, SETTINGS);
    focusMock.mockClear();
    await press(root, SETTINGS);
    await advance(50);
  }

  it('matrix «Open sheet»: OK on «Настройки» → the right sheet in the modal host, focus «Качество · Авто»; the overlay stays, never auto-hides; playback continues', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSheet(root);
    expect(visible(root, SHEET)).toBe(true);
    expect(StyleSheet.flatten(byTestId(root, 'modal/scrim')[0].props.style)).toMatchObject({ alignItems: 'flex-end' });
    expect(StyleSheet.flatten(byTestId(root, SHEET)[0].props.style)).toMatchObject({ width: 340 });
    expect(text(byTestId(root, SHEET)[0])).toContain('Настройки');
    expect(label(root, QUALITY)).toBe('Качество Авто');
    expect(lastFocusTarget()).toBe(QUALITY);
    // The sheet is the only focusable content in the modal (the trap holds it).
    expect(byTestId(root, 'modal/content')[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([QUALITY]);
    await advance(20_000);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(engine.props?.paused).toBe(false);
    await unmount(root);
  });

  it('matrix «List»: hls + dash + 360/720/1080 → «Авто», «1080p», «720p», «360p»; the playing (Авто) is selected and focused', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    expect(engine.props?.source).toEqual({ uri: `${URL}-hls`, format: 'hls' });
    await openSheet(root);
    focusMock.mockClear();
    await press(root, QUALITY);
    await advance(50);
    expect(menuRows(root)).toEqual([Q('auto'), Q(1080), Q(720), Q(360)]);
    expect(menuRows(root).map(id => label(root, id))).toEqual(['Авто', '1080p', '720p', '360p']);
    expect(one(root, Q('auto')).props.accessibilityState).toMatchObject({ selected: true });
    expect(one(root, Q(720)).props.accessibilityState).toMatchObject({ selected: false });
    expect(one(root, Q('auto')).props.accessibilityRole).toBe('radio');
    expect(lastFocusTarget()).toBe(Q('auto'));
    await unmount(root);
  });

  it('matrix «Progressive only»: 480 (two types) + 720 → «720p», «480p», no «Авто»; 720p selected', async () => {
    withData([
      okVideo('v1', [
        { type: 'sd', url: `${URL}-480a` },
        { type: 'high', url: `${URL}-720` },
        { type: 'medium', url: `${URL}-480b` },
      ]),
    ]);
    const root = await openPlayer();
    await openSheet(root);
    expect(label(root, QUALITY)).toBe('Качество 720p');
    await press(root, QUALITY);
    await advance(50);
    expect(menuRows(root)).toEqual([Q(720), Q(480)]);
    expect(lastFocusTarget()).toBe(Q(720));
    await unmount(root);
  });

  it('matrix «Auto suffix»: «Авто» until the engine reports a height, then «Авто · 1080p»', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    expect(engine.props?.onResolution).toBeDefined();
    await openSheet(root);
    expect(label(root, QUALITY)).toBe('Качество Авто');
    await fire('onResolution', 1080);
    expect(label(root, QUALITY)).toBe('Качество Авто · 1080p');
    await press(root, QUALITY);
    expect(label(root, Q('auto'))).toBe('Авто · 1080p');
    // Only the «Авто» row carries it.
    expect(label(root, Q(1080))).toBe('1080p');
    await unmount(root);
  });

  it('matrix «Pick» and «Progress»: «720p» at 5:12 → the same E8\'s 720p, a seek to 312, preference `720`, sheet closed, focus «Настройки»; no E9 of 0, the session continues', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 312);
    expect(e9Sent()).toContain('v1@310');
    const e8Before = e8Calls().length;
    const sentBefore = e9Sent().length;
    await openSheet(root);
    await press(root, QUALITY);
    focusMock.mockClear();
    engine.seek.mockClear();
    const mounts = engine.mounts;
    await press(root, Q(720));
    // A new engine with the 720p source of the same E8 (no new request).
    expect(engine.mounts).toBe(mounts + 1);
    expect(engine.props?.source).toEqual({ uri: `${URL}-720`, format: 'progressive' });
    expect(e8Calls()).toHaveLength(e8Before);
    // Stored only once the new source loads (below).
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBeNull();
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    await advance(50);
    expect(lastFocusTarget()).toBe(SETTINGS);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(text(byTestId(root, 'player/elapsed')[0])).toContain('"5:12"');
    // The new source: t=0 before the seek is never shown or written.
    await fire('onProgress', 0);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledTimes(1);
    expect(engine.seek).toHaveBeenCalledWith(312);
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe('720');
    await fire('onProgress', 0);
    expect(text(byTestId(root, 'player/elapsed')[0])).toContain('"5:12"');
    await fire('onSeekDone', 312);
    await ticks(313, 323);
    // The session continued: 10 s after the last write (310), not 10 s after the switch.
    expect(e9Sent().slice(sentBefore)).toEqual(['v1@320']);
    expect(e9Sent()).not.toContain('v1@0');
    // Reopening the sheet: 720p selected.
    await openSheet(root);
    expect(label(root, QUALITY)).toBe('Качество 720p');
    await unmount(root);
  });

  it('a pick during a pending seek starts at its target; «Авто» clears the height and the old height suffix', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await fire('onResolution', 1080);
    await ticks(0, 100);
    await key('right'); // pending 105
    await key('menu'); // the sheet (Menu key)
    expect(visible(root, SHEET)).toBe(true);
    expect(label(root, QUALITY)).toBe('Качество Авто · 1080p');
    await press(root, QUALITY);
    await press(root, Q(360));
    engine.seek.mockClear();
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(105);
    await fire('onSeekDone', 105);
    await openSheet(root);
    await press(root, QUALITY);
    await press(root, Q('auto'));
    expect(engine.props?.source).toEqual({ uri: `${URL}-hls`, format: 'hls' });
    await fire('onLoad', { durationSec: 600 });
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe('auto');
    // Back on «Авто»: no suffix until the new engine reports a height.
    await openSheet(root);
    expect(label(root, QUALITY)).toBe('Качество Авто');
    await unmount(root);
  });

  it('a pick before the first onLoad keeps the resume point (local 120): the new engine seeks to 120', async () => {
    withData([okVideo('v1', MIXED)]);
    progressStore.put({
      ref: { blogUrl: FEED_BLOG, postId: POST, mediaId: 'v1' },
      positionSec: 120,
      durationSec: 600,
      updatedAt: Date.now(),
      meta: { title: 'Title v1', postTitle: `Title of ${POST}`, authorName: 'redacted', previewUrl: null, durationSec: 600 },
    });
    const root = await openPlayer(VIDEO('v1'), { load: false });
    await focusOn(root, SURFACE);
    await advance(600);
    await key('menu');
    await press(root, QUALITY);
    await press(root, Q(720));
    expect(engine.props?.source).toEqual({ uri: `${URL}-720`, format: 'progressive' });
    engine.seek.mockClear();
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledTimes(1);
    expect(engine.seek).toHaveBeenCalledWith(120);
    await unmount(root);
  });

  it('a pick while the initial resume seek is in flight starts the new source at that resume point', async () => {
    withData([okVideo('v1', MIXED, { timeCode: 300 })]);
    const root = await openPlayer(VIDEO('v1'), { load: false });
    await focusOn(root, SURFACE);
    await advance(600);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(300);
    await fire('onProgress', 0); // before the seek lands
    await key('menu');
    await press(root, QUALITY);
    await press(root, Q(720));
    engine.seek.mockClear();
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(300);
    await unmount(root);
  });

  it('a pick while a held scrub is pending resumes the video the scrub paused', async () => {
    withData([okVideo('v1', MIXED)]);
    installNativeModules({ SeekKeys: { setEnabled: jest.fn() } });
    const root = await openPlayer();
    await ticks(0, 100);
    await act(async () => {
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'down', repeat: 0 });
    });
    await advance(250);
    await act(async () => {
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'down', repeat: 1 });
    });
    await act(async () => {
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'up', repeat: 0 });
    });
    await settle();
    expect(engine.props?.paused).toBe(true);
    await key('menu');
    await press(root, QUALITY);
    await press(root, Q(720));
    expect(engine.props?.paused).toBe(false);
    expect(visible(root, 'player/bubble')).toBe(false);
    await unmount(root);
  });

  it('a switched source that fails before onLoad is never stored; one that loads is', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSheet(root);
    await press(root, QUALITY);
    await press(root, Q(1080));
    await failPastRecovery();
    expect(visible(root, RETRY)).toBe(true);
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBeNull();
    await unmount(root);
    await device().setItem(QUALITY_PREFERENCE_KEY, 'auto');
    qualityPreference.forget();
    engine.reset();
    const again = await openPlayer();
    await openSheet(again);
    await press(again, QUALITY);
    await press(again, Q(720));
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe('auto');
    await fire('onLoad', { durationSec: 600 });
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe('720');
    await unmount(again);
  });

  it('picking the already-selected row (Авто on HLS): no remount, no seek, focus «Настройки»; progress keeps being written', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 12);
    expect(e9Sent()).toEqual(['v1@10']);
    await openSheet(root);
    await press(root, QUALITY);
    const mounts = engine.mounts;
    engine.seek.mockClear();
    focusMock.mockClear();
    await press(root, Q('auto'));
    expect(engine.mounts).toBe(mounts);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    await ticks(13, 21);
    expect(e9Sent()).toEqual(['v1@10', 'v1@20']);
    await unmount(root);
  });

  it('native seek keys on −10, +10 and the gear: no seek, no bubble, not paused', async () => {
    withData([okVideo('v1', MIXED)]);
    installNativeModules({ SeekKeys: { setEnabled: jest.fn() } });
    const root = await openPlayer();
    await ticks(0, 100);
    await key('up');
    engine.seek.mockClear();
    const native = async (dpad: 'left' | 'right', action: 'down' | 'up', repeat = 0) => {
      await act(async () => {
        DeviceEventEmitter.emit('seekKey', { key: dpad, action, repeat });
      });
      await settle();
    };
    for (const id of [BACK10, FORWARD10, SETTINGS]) {
      await focusOn(root, id);
      for (const dpad of ['left', 'right'] as const) {
        await native(dpad, 'down', 0);
        await advance(250);
        await native(dpad, 'down', 3);
        await native(dpad, 'up');
        await key(dpad);
      }
    }
    await advance(6_000);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(visible(root, 'player/bubble')).toBe(false);
    expect(engine.props?.paused).toBe(false);
    await unmount(root);
  });

  it('matrix «Stored pref»: `720` and the video has 720p → plays it; `720` and no 720p → default order (HLS), preference kept', async () => {
    await device().setItem(QUALITY_PREFERENCE_KEY, '720');
    withData([okVideo('v1', MIXED)]);
    const has = await openPlayer(VIDEO('v1'), { load: false });
    expect(engine.props?.source).toEqual({ uri: `${URL}-720`, format: 'progressive' });
    expect(engine.mounts).toBe(1);
    await unmount(has);
    qualityPreference.forget();
    engine.reset();
    withData([okVideo('v1', [{ type: 'hls', url: `${URL}-hls` }, { type: 'full_hd', url: `${URL}-1080` }])]);
    const lacks = await openPlayer(VIDEO('v1'), { load: false });
    expect(engine.props?.source).toEqual({ uri: `${URL}-hls`, format: 'hls' });
    expect(visible(lacks, 'player/state/error')).toBe(false);
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe('720');
    await unmount(lacks);
  });

  it('a junk stored value is no preference (default order)', async () => {
    await device().setItem(QUALITY_PREFERENCE_KEY, 'https://example.invalid/x');
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer(VIDEO('v1'), { load: false });
    expect(engine.props?.source).toEqual({ uri: `${URL}-hls`, format: 'hls' });
    await unmount(root);
  });

  it('matrix «Back order»: submenu → sheet (focus «Качество») → close (focus «Настройки») → overlay → exit', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSheet(root);
    await press(root, QUALITY);
    expect(visible(root, MENU)).toBe(true);
    focusMock.mockClear();
    await back();
    await advance(50);
    expect(visible(root, MENU)).toBe(false);
    expect(visible(root, SHEET)).toBe(true);
    expect(lastFocusTarget()).toBe(QUALITY);
    focusMock.mockClear();
    await back();
    await advance(50);
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(currentRoute()).toBe('Player');
    await back();
    expect(visible(root, 'player/overlay')).toBe(false);
    expect(currentRoute()).toBe('Player');
    await back();
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('matrix «Keys behind»: with the sheet open ← → OK Play/Pause and native seek keys do nothing to playback', async () => {
    withData([okVideo('v1', MIXED)]);
    installNativeModules({ SeekKeys: { setEnabled: jest.fn() } });
    const root = await openPlayer();
    await ticks(0, 100);
    await openSheet(root);
    engine.seek.mockClear();
    await act(async () => {
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'down', repeat: 0 });
    });
    await key('right');
    await key('left');
    await key('playPause');
    await key('pause');
    await key('stop');
    await key('menu');
    await advance(2_000);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(engine.props?.paused).toBe(false);
    expect(visible(root, 'player/bubble')).toBe(false);
    expect(currentRoute()).toBe('Player');
    expect(visible(root, SHEET)).toBe(true);
    await unmount(root);
  });

  it('Menu / Info with the overlay hidden: the overlay shows and the sheet opens', async () => {
    withData([okVideo('v1', MIXED)]);
    for (const type of ['menu', 'info']) {
      const root = await openPlayer();
      expect(visible(root, 'player/overlay')).toBe(false);
      await key(type);
      expect(visible(root, 'player/overlay')).toBe(true);
      expect(visible(root, SHEET)).toBe(true);
      await back();
      await advance(50);
      expect(lastFocusTarget()).toBe(SETTINGS);
      await unmount(root);
      engine.reset();
    }
  });

  it('an engine error with the sheet open closes it; the recovery takes focus (the surface), a second error («Повторить»)', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSheet(root);
    focusMock.mockClear();
    await fire('onError', 'decoder');
    await advance(50);
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SURFACE);
    await fire('onError', 'decoder');
    await advance(50);
    expect(visible(root, RETRY)).toBe(true);
    expect(lastFocusTarget()).toBe(RETRY);
    await unmount(root);
  });

  it('the preference and the sheet carry no URL', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSheet(root);
    await press(root, QUALITY);
    await press(root, Q(1080));
    await fire('onLoad', { durationSec: 600 });
    const stored = await device().getItem(QUALITY_PREFERENCE_KEY);
    expect(stored).toBe('1080');
    expect(JSON.stringify(logger.entries())).not.toContain('example.invalid');
    await unmount(root);
  });
});

describe('recovery (Story 4.4)', () => {
  const RECOVERING = 'player/state/recovering';
  const AUTHOR = `post/${POST}/author`;
  const device = () => createAsyncStorage('boostytv-device');
  const e9Sent = () =>
    transport.calls
      .filter(c => c.method === 'PUT' && E9_RE.test(c.path))
      .map(c => `${E9_RE.exec(c.path)?.[1]}@${c.form.time_code}`);
  const focusables = (root: Root) =>
    byTestId(root, 'player/page')[0]
      .queryAll(n => n.props.focusable === true)
      .map(n => n.props.testID as string);
  async function ticks(from: number, to: number) {
    for (let sec = from; sec <= to; sec += 1) {
      await fire('onProgress', sec);
    }
  }
  /** HLS + 720p + 1080p + 1440p, each with its own URL and the E8's number (`-n`). */
  const sourcesOf = (n: number, types = ['hls', 'high', 'full_hd', 'quad_hd']) =>
    types.map(type => ({ type, url: `${URL}-${type}-${n}` }));
  /** Every E8 answers with URLs of its own number (Пост: 1, the player: 2, the recovery: 3 …). */
  function numberedE8(types?: string[]) {
    let n = 0;
    e8 = (_req, blogUrl, postId) => {
      n += 1;
      return { status: 200, body: postDetail(blogUrl, postId, [okVideo('v1', sourcesOf(n, types))]) };
    };
  }
  const lockedE8 = (): FixtureReply => ({
    status: 200,
    body: { ...e8Locked(), id: POST, user: { ...(e8Locked().user as object), blogUrl: FEED_BLOG } },
  });
  /** The player at `at` s (the start reached, 0 → `at` played). */
  async function playTo(at: number) {
    const root = await openPlayer();
    await ticks(0, at);
    return root;
  }

  it('matrix «Expired URL» and «Integration»: at 5:12 an engine error → «Восстанавливаем…» (no action, focus on the surface), exactly one fresh E8, the new source seeks to 312 and plays; no E9 for the error, the session continues', async () => {
    numberedE8();
    const root = await playTo(312);
    expect(engine.props?.source.uri).toBe(`${URL}-hls-2`);
    expect(e9Sent()).toContain('v1@310');
    const sentBefore = e9Sent().length;
    const before = e8Calls().length;
    const pending = deferred();
    const answer = e8;
    e8 = (req, blogUrl, postId) => pending.promise.then(() => answer(req, blogUrl, postId) as FixtureReply);
    focusMock.mockClear();
    await fire('onError', 'http');
    expect(e8Calls()).toHaveLength(before + 1);
    expect(engine.props).toBeNull();
    expect(visible(root, RECOVERING)).toBe(true);
    expect(playerText(root)).toContain('Восстанавливаем воспроизведение…');
    expect(visible(root, 'player/spinner')).toBe(true);
    expect(focusables(root)).toEqual([SURFACE]);
    expect(lastFocusTarget()).toBe(SURFACE);
    expect(visible(root, RETRY)).toBe(false);
    // TalkBack announces the copy.
    expect(byTestId(root, RECOVERING)[0].queryAll(n => n.props.accessibilityLiveRegion === 'polite')).not.toHaveLength(0);
    pending.resolve({ status: 200 });
    await settle();
    // The fresh E8's own URL (the second engine of this opening); the copy
    // stays until the new source reached its start position.
    expect(engine.props?.source.uri).toBe(`${URL}-hls-3`);
    expect(visible(root, RECOVERING)).toBe(true);
    expect(focusables(root)).toEqual([SURFACE]);
    expect(e8Calls()).toHaveLength(before + 1);
    engine.seek.mockClear();
    await fire('onProgress', 0);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledTimes(1);
    expect(engine.seek).toHaveBeenCalledWith(312);
    expect(visible(root, RECOVERING)).toBe(true);
    await fire('onSeekDone', 312);
    expect(visible(root, RECOVERING)).toBe(false);
    expect(visible(root, 'player/overlay')).toBe(false);
    expect(lastFocusTarget()).toBe(SURFACE);
    await ticks(313, 321);
    expect(engine.props?.paused).toBe(false);
    // No E9 of the error, none of the new source's t=0; 10 s after the last write (310).
    expect(e9Sent().slice(sentBefore)).toEqual(['v1@320']);
    expect(e9Sent()).not.toContain('v1@0');
    expect(e8Calls()).toHaveLength(before + 1);
    // The player's recovery logs carry no URL, id or position.
    const playerLogs = logger.entries().filter(entry => entry.scope === 'player');
    expect(playerLogs.map(entry => entry.message)).toContain('playback failed; recovering');
    expect(JSON.stringify(playerLogs)).not.toMatch(/example\.invalid|312|v1/);
    expect(JSON.stringify(logger.entries())).not.toContain('example.invalid');
    await unmount(root);
  });

  it('matrix «Second error»: the recovered source errors within 30 s → the error state, «Повторить» focused; no more E8', async () => {
    const root = await playTo(100);
    const before = e8Calls().length;
    await fire('onError', 'http');
    expect(e8Calls()).toHaveLength(before + 1);
    await fire('onLoad', { durationSec: 600 });
    await fire('onSeekDone', 100);
    await ticks(101, 125);
    focusMock.mockClear();
    await fire('onError', 'http');
    await advance(50);
    expect(e8Calls()).toHaveLength(before + 1);
    expect(playerText(root)).toContain('Не удалось воспроизвести видео');
    expect(focusables(root)).toEqual([RETRY, BACK]);
    expect(lastFocusTarget()).toBe(RETRY);
    await unmount(root);
  });

  it('matrix «Budget back»: the recovered source plays 30 s, then errors → one more automatic recovery', async () => {
    const root = await playTo(100);
    const before = e8Calls().length;
    await fire('onError', 'http');
    await fire('onLoad', { durationSec: 600 });
    await fire('onSeekDone', 100);
    // A seek jump does not count as playback.
    await ticks(101, 110);
    await fire('onSeekDone', 300);
    // 10 + 18 s of playback: still under 30 s.
    await ticks(301, 318);
    await fire('onError', 'http');
    expect(visible(root, RETRY)).toBe(true);
    await unmount(root);

    const again = await playTo(100);
    const start = e8Calls().length;
    expect(start).toBe(before + 2);
    await fire('onError', 'http');
    await fire('onLoad', { durationSec: 600 });
    await fire('onSeekDone', 100);
    await ticks(101, 130);
    engine.seek.mockClear();
    await fire('onError', 'http');
    expect(e8Calls()).toHaveLength(start + 2);
    expect(visible(again, RETRY)).toBe(false);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(130);
    await unmount(again);
  });

  it('matrix «Recovery E8 fails»: Network on the fresh E8 → the error state «Повторить» / «Назад»; Повторить → one E8, plays at the same position', async () => {
    const root = await playTo(200);
    e8 = () => ({ network: true });
    await fire('onError', 'http');
    await settle({ timerRounds: 30 });
    expect(playerText(root)).toContain('Не удалось воспроизвести видео');
    expect(focusables(root)).toEqual([RETRY, BACK]);
    expect(lastFocusTarget()).toBe(RETRY);
    withData(ONE);
    const before = e8Calls().length;
    await press(root, RETRY);
    expect(e8Calls()).toHaveLength(before + 1);
    engine.seek.mockClear();
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(200);
    expect(engine.props?.source.format).toBe('hls');
    await unmount(root);
  });

  it('matrix «Same quality»: 720p chosen, the fresh E8 has 720p → plays 720p', async () => {
    await device().setItem(QUALITY_PREFERENCE_KEY, '720');
    numberedE8();
    const root = await playTo(50);
    expect(engine.props?.source.uri).toBe(`${URL}-high-2`);
    await fire('onError', 'http');
    expect(engine.props?.source.uri).toBe(`${URL}-high-3`);
    await unmount(root);
  });

  it('matrix «Quality gone»: 720p chosen, the fresh E8 has no 720p → the default order; the preference is kept', async () => {
    await device().setItem(QUALITY_PREFERENCE_KEY, '720');
    numberedE8();
    const root = await playTo(50);
    expect(engine.props?.source.uri).toBe(`${URL}-high-2`);
    numberedE8(['full_hd', 'hls']);
    await fire('onError', 'http');
    expect(engine.props?.source.format).toBe('hls');
    expect(qualityPreference.peek()).toBe(720);
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe('720');
    await unmount(root);
  });

  it.each([
    ['the recovered source fails again', 'second'],
    ['the recovery E8 fails', 'e8'],
  ])('matrix «Bad pick» (%s): 1440p picked fails → error; «Повторить» → the default order, in-memory `auto`, the stored value unchanged', async (_name, how) => {
    await device().setItem(QUALITY_PREFERENCE_KEY, '720');
    numberedE8();
    const root = await playTo(80);
    await key('up');
    await focusOn(root, SETTINGS);
    await press(root, SETTINGS);
    await advance(50);
    await press(root, 'player/sheet/quality');
    await press(root, 'player/sheet/quality/1440');
    expect(engine.props?.source.uri).toBe(`${URL}-quad_hd-2`);
    if (how === 'second') {
      await fire('onError', 'decoder');
      // The recovery keeps the picked quality.
      expect(engine.props?.source.uri).toBe(`${URL}-quad_hd-3`);
      await fire('onError', 'decoder');
    } else {
      const answer = e8;
      e8 = () => ({ status: 503, body: {} });
      await fire('onError', 'decoder');
      await settle({ timerRounds: 30 });
      e8 = answer;
    }
    expect(visible(root, RETRY)).toBe(true);
    engine.seek.mockClear();
    await press(root, RETRY);
    expect(engine.props?.source.format).toBe('hls');
    expect(qualityPreference.peek()).toBe('auto');
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe('720');
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(80);
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe('720');
    await unmount(root);
  });

  it('matrix «Start failure»: an error before the first onLoad → the recovery starts at the pending start (the resume point)', async () => {
    withData([okVideo('v1', ALL, { timeCode: 300 }), ...paragraph('Body')]);
    const root = await openPlayer(VIDEO('v1'), { load: false });
    await focusOn(root, SURFACE);
    await advance(600);
    const before = e8Calls().length;
    await fire('onError', 'source');
    expect(e8Calls()).toHaveLength(before + 1);
    engine.seek.mockClear();
    await fire('onProgress', 0);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(300);
    await fire('onSeekDone', 300);
    expect(text(byTestId(root, 'player/page')[0])).not.toContain('Не удалось');
    await unmount(root);
  });

  it('a start failure of «С начала» recovers to 0 (the pending start), never the resume point', async () => {
    withData([okVideo('v1', ALL, { timeCode: 300 }), ...paragraph('Body')]);
    const root = await openPost();
    await press(root, `post/${POST}/restart`);
    await focusOn(root, SURFACE);
    await advance(600);
    await fire('onError', 'source');
    engine.seek.mockClear();
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('matrix «Unavailable»: the fresh E8 404 → «Видео недоступно» + «Назад», no retry', async () => {
    const root = await playTo(40);
    e8 = () => e8MissingReply();
    await fire('onError', 'http');
    expect(playerText(root)).toContain('Видео недоступно');
    expect(focusables(root)).toEqual([BACK]);
    expect(lastFocusTarget()).toBe(BACK);
    await unmount(root);
  });

  it('matrix «No access»: the fresh E8 locked, session ok (E1 200) → exit to the Post at once; the Post refetches, its locked notice, focus on the author', async () => {
    const root = await playTo(40);
    const e1Before = transport.callsTo(E1).length;
    const postE8Before = e8Calls().length;
    e8 = () => lockedE8();
    focusMock.mockClear();
    await fire('onError', 'http');
    await advance(50);
    // The session was checked (E1) before the locked answer was trusted.
    expect(transport.callsTo(E1).length).toBeGreaterThan(e1Before);
    expect(currentRoute()).toBe('Post');
    expect(routeNames()).toEqual(['Shell', 'Post']);
    // The player's fresh E8, its one refetch after E1 ok, then the Post's own refetch.
    expect(e8Calls().length).toBeGreaterThanOrEqual(postE8Before + 3);
    expect(text(byTestId(root, 'post/page')[0])).toContain('Нет доступа. Этот пост доступен');
    expect(visible(root, VIDEO('v1'))).toBe(false);
    expect(lastFocusTarget()).toBe(AUTHOR);
    await unmount(root);
  });

  it('«Повторить» after the error state whose fresh E8 is locked (session ok): the same exit to the Post', async () => {
    const root = await playTo(40);
    await failPastRecovery('http');
    expect(visible(root, RETRY)).toBe(true);
    e8 = () => lockedE8();
    await press(root, RETRY);
    await advance(50);
    expect(currentRoute()).toBe('Post');
    expect(text(byTestId(root, 'post/page')[0])).toContain('Нет доступа. Этот пост доступен');
    expect(lastFocusTarget()).toBe(AUTHOR);
    await unmount(root);
  });

  it('an error while paused: the recovery keeps the pause (no play after it); the paused player shows its overlay; «Повторить» keeps it too', async () => {
    const root = await playTo(200);
    await focusOn(root, SURFACE);
    await press(root, SURFACE);
    expect(engine.props?.paused).toBe(true);
    await fire('onError', 'http');
    expect(engine.props?.paused).toBe(true);
    await fire('onLoad', { durationSec: 600 });
    await fire('onSeekDone', 200);
    expect(visible(root, RECOVERING)).toBe(false);
    expect(engine.props?.paused).toBe(true);
    expect(visible(root, 'player/overlay')).toBe(true);
    // A second error while paused → «Повторить» → still paused.
    await fire('onError', 'http');
    expect(visible(root, RETRY)).toBe(true);
    await press(root, RETRY);
    expect(engine.props?.paused).toBe(true);
    await unmount(root);
  });

  it('matrix «No access»: after playback, the fresh E8 locked, E1 200, the one refetch fails → Пост with its locked notice; nothing of the recovery left', async () => {
    const root = await playTo(40);
    let n = 0;
    e8 = () => {
      n += 1;
      // The recovery's E8: locked; the check's one refetch: fails; then (Пост) locked.
      return n === 2 ? { status: 400, body: { error: 'bad_request' } } : lockedE8();
    };
    await fire('onError', 'http');
    await advance(50);
    expect(currentRoute()).toBe('Post');
    expect(routeNames()).toEqual(['Shell', 'Post']);
    expect(visible(root, RECOVERING)).toBe(false);
    expect(visible(root, 'player')).toBe(false);
    expect(text(byTestId(root, 'post/page')[0])).toContain('Нет доступа. Этот пост доступен');
    expect(lastFocusTarget()).toBe(AUTHOR);
    await unmount(root);
  });

  it('«Повторить» answered locked: busy (not pressable) while the session check runs, then the exit to the Post', async () => {
    const root = await playTo(40);
    await failPastRecovery('http');
    const check = deferred();
    e8 = () => lockedE8();
    // Hold the check's E1.
    e1Hold = check.promise;
    await press(root, RETRY);
    expect(currentRoute()).toBe('Player');
    expect(one(root, RETRY).props.accessibilityState).toMatchObject({ busy: true });
    const e8Before = e8Calls().length;
    await press(root, RETRY);
    expect(e8Calls()).toHaveLength(e8Before);
    e1Hold = null;
    check.resolve({ status: 200, body: e1Ok.body });
    await settle();
    await advance(50);
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('matrix «Back while recovering»: Back exits the player with the exit report; keys other than Back are ignored', async () => {
    const root = await playTo(312);
    const pending = deferred();
    e8 = () => pending.promise;
    await fire('onError', 'http');
    expect(visible(root, RECOVERING)).toBe(true);
    engine.seek.mockClear();
    const sentBefore = e9Sent().length;
    await key('right');
    await key('playPause');
    await key('menu');
    await key('up');
    await advance(700);
    expect(visible(root, RECOVERING)).toBe(true);
    expect(visible(root, 'player/overlay')).toBe(false);
    expect(visible(root, 'player/sheet')).toBe(false);
    expect(e9Sent()).toHaveLength(sentBefore);
    await back();
    expect(currentRoute()).toBe('Post');
    expect(e9Sent().slice(sentBefore)).toEqual(['v1@312']);
    expect(lastFocusTarget()).toBe(VIDEO('v1'));
    pending.resolve({ status: 200, body: postDetail(FEED_BLOG, POST, ONE) });
    await settle();
    await unmount(root);
  });
});

describe('debug-only broken next video URL (Story 4.4 device check)', () => {
  const BROKEN = 'boostytv-debug-broken';

  it('the Настройки row arms it: exactly one resolution plays a broken URL; the recovery\'s fresh E8 plays normally; nothing logged with a URL', async () => {
    let n = 0;
    e8 = (_req, blogUrl, postId) => {
      n += 1;
      return { status: 200, body: postDetail(blogUrl, postId, [okVideo('v1', [{ type: 'hls', url: `${URL}-${n}` }])]) };
    };
    const root = await render(<App />);
    await press(root, 'nav/settings');
    expect(one(root, 'settings/row/break-video').props.accessibilityLabel).toBe('Сломать следующую ссылку видео');
    await press(root, 'settings/row/break-video');
    await press(root, 'nav/home');
    await focusOn(root, FEED_CARD);
    await press(root, FEED_CARD);
    await press(root, VIDEO('v1'));
    expect(currentRoute()).toBe('Player');
    // Пост's E8 is #1, the player's #2: only its URL is broken (its host becomes the reserved `boostytv-debug-broken.invalid`).
    expect(engine.props?.source.uri).toBe(`https://${BROKEN}.invalid/player-2`);
    const before = e8Calls().length;
    await fire('onError', 'http');
    expect(e8Calls()).toHaveLength(before + 1);
    expect(engine.props?.source.uri).toBe(`${URL}-3`);
    expect(JSON.stringify(logger.entries())).not.toMatch(/example\.invalid|boostytv-debug-broken/);
    await back();
    expect(currentRoute()).toBe('Post');
    for (let i = 0; i < 10 && engine.props !== null; i += 1) {
      await advance(50);
    }
    // The next opening is not broken (one-shot).
    await press(root, VIDEO('v1'));
    expect(engine.props?.source.uri).toBe(`${URL}-4`);
    await unmount(root);
  });

  it('not armed: no URL is touched', async () => {
    const root = await openPlayer();
    expect(engine.props?.source.uri).toBe(URL);
    await unmount(root);
  });

  it('armed directly: the first resolution is broken and stays broken across its re-renders', async () => {
    debugBreakNextVideoSource();
    const root = await openPlayer();
    expect(engine.props?.source.uri).toContain(BROKEN);
    await key('up');
    expect(engine.props?.source.uri).toContain(BROKEN);
    await unmount(root);
  });
});

describe('sleep, background and audio focus (Story 4.6)', () => {
  const RECOVERING = 'player/state/recovering';
  const E9 = /^\/v1\/viewstat\/video\/([^/]+)\/timecode\/$/;
  const e9Sent = () =>
    transport.calls.filter(c => c.method === 'PUT' && E9.test(c.path)).map(c => `${E9.exec(c.path)?.[1]}@${c.form.time_code}`);
  let appState: Array<(state: string) => void> = [];
  beforeEach(() => {
    appState = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
      appState.push(listener);
      return {
        remove: () => {
          appState = appState.filter(h => h !== listener);
        },
      };
    }) as unknown as typeof AppState.addEventListener);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  async function lifecycle(state: string) {
    await act(async () => {
      for (const h of [...appState]) {
        h(state);
      }
    });
    await settle();
  }
  async function ticks(from: number, to: number) {
    for (let sec = from; sec <= to; sec += 1) {
      await fire('onProgress', sec);
    }
  }

  it('background (sleep) pauses and writes; the foreground shows the overlay, still paused, focus on the timeline', async () => {
    const root = await openPlayer();
    await ticks(0, 14);
    expect(engine.props?.paused).toBe(false);
    await lifecycle('background');
    expect(engine.props?.paused).toBe(true);
    expect(e9Sent()).toContain('v1@14');
    focusMock.mockClear();
    await lifecycle('active');
    expect(engine.props?.paused).toBe(true);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(lastFocusTarget()).toBe(TIMELINE);
    await unmount(root);
  });

  it('audio focus loss pauses (a user pause: the progress write) and shows the overlay', async () => {
    const root = await openPlayer();
    await ticks(0, 12);
    await fire('onAudioFocusLost');
    expect(engine.props?.paused).toBe(true);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(e9Sent()).toEqual(['v1@10', 'v1@12']);
    await unmount(root);
  });

  it('play on a source resolved ≥ 23 h ago re-resolves first (one E8, «Восстанавливаем…»), then plays at the same second', async () => {
    const root = await openPlayer();
    await ticks(0, 40);
    await key('down'); // the overlay
    await focusOn(root, PLAYPAUSE);
    await press(root, PLAYPAUSE); // pause
    expect(engine.props?.paused).toBe(true);
    const before = e8Calls().length;
    const mounts = engine.mounts;
    jest.setSystemTime(Date.now() + 23 * 60 * 60 * 1000);
    await press(root, PLAYPAUSE); // play
    expect(e8Calls()).toHaveLength(before + 1);
    expect(visible(root, RECOVERING)).toBe(true);
    expect(engine.mounts).toBe(mounts + 1);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenLastCalledWith(40);
    await fire('onSeekDone', 40);
    expect(visible(root, RECOVERING)).toBe(false);
    expect(engine.props?.paused).toBe(false);
    await unmount(root);
  });

  it('background with the sheet open and a pending seek: the sheet closes, no seek is made; the foreground focuses the timeline', async () => {
    const root = await openPlayer();
    await ticks(0, 14);
    await key('down'); // the overlay
    await focusOn(root, SETTINGS);
    await press(root, SETTINGS);
    expect(visible(root, 'player/sheet')).toBe(true);
    await lifecycle('background');
    expect(visible(root, 'player/sheet')).toBe(false);
    expect(engine.props?.paused).toBe(true);
    focusMock.mockClear();
    await lifecycle('active');
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(lastFocusTarget()).toBe(TIMELINE);
    // A pending seek target is dropped without seeking.
    await key('right');
    await lifecycle('background');
    await advance(1_000);
    expect(engine.seek).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('background during a recovery: the recovered source starts paused (no autoplay on return)', async () => {
    const root = await openPlayer();
    await ticks(0, 30);
    await fire('onError', 'http');
    expect(visible(root, RECOVERING)).toBe(true);
    await lifecycle('background');
    await lifecycle('active');
    await fire('onLoad', { durationSec: 600 });
    await fire('onSeekDone', 30);
    expect(engine.props?.paused).toBe(true);
    await unmount(root);
  });

  it('audio focus lost during a hold-scrub: the scrub ending does not resume playback', async () => {
    installNativeModules({ SeekKeys: { setEnabled: jest.fn() } });
    const native = async (action: 'down' | 'up', repeat = 0) => {
      await act(async () => {
        DeviceEventEmitter.emit('seekKey', { key: 'right', action, repeat });
      });
      await settle();
    };
    const root = await openPlayer();
    await ticks(0, 12);
    await native('down', 0);
    for (let i = 1; i <= 6; i += 1) {
      await advance(50);
      await native('down', i);
    }
    await native('up');
    expect(engine.props?.paused).toBe(true); // the hold-scrub pause
    await fire('onAudioFocusLost');
    await back(); // cancels the held target: the scrub ends
    expect(engine.props?.paused).toBe(true);
    await unmount(root);
  });

  it('a younger source plays at once (no E8)', async () => {
    const root = await openPlayer();
    await ticks(0, 5);
    await key('down'); // the overlay
    await focusOn(root, PLAYPAUSE);
    await press(root, PLAYPAUSE);
    const before = e8Calls().length;
    jest.setSystemTime(Date.now() + 60 * 60 * 1000);
    await press(root, PLAYPAUSE);
    expect(e8Calls()).toHaveLength(before);
    expect(engine.props?.paused).toBe(false);
    await unmount(root);
  });
});


describe('Story 6.3: timestamp link chips (owner decision 2026-10-29, option b)', () => {
  const REF = { blogUrl: FEED_BLOG, postId: POST, mediaId: 'v2' };
  const CHIP = (n: number) => `post/${POST}/block/text@2/link/${n}`;
  const link = (s: string, url: string) => ({ type: 'link', content: JSON.stringify([s, 'unstyled', []]), url });
  const e9Calls = () => transport.calls.filter(c => c.method === 'PUT' && E9_RE.test(c.path));
  const label = (root: Root, id: string) => one(root, id).props.accessibilityLabel as string;
  const DATA = (t = '225') => [
    okVideo('v1', ALL),
    okVideo('v2', ALL, { title: '' }),
    textBlock('Таймкоды: '),
    link('3:45 Тема', `https://boosty.to/${FEED_BLOG}/posts/${POST}?t=${t}&tmid=v2`),
    textBlock(' '),
    link('чужое видео', `https://boosty.to/${FEED_BLOG}/posts/${POST}?t=10&tmid=zzz`),
    textBlock(' '),
    link('другой пост', `https://boosty.to/${FEED_BLOG}/posts/other-post?t=10&tmid=v1`),
    textBlock(' '),
    link('формат', `https://boosty.to/${FEED_BLOG}/posts/${POST}?t=1m2s&tmid=v1`),
    blockEnd(),
  ];

  it('matrix «Timestamp»: «<text> · Смотреть»; another video or format keeps the QR, another post «Открыть»', async () => {
    withData(DATA());
    const root = await openPost();
    expect(label(root, CHIP(0))).toBe('3:45 Тема. Смотреть видео с этого момента');
    expect(text(byTestId(root, CHIP(0))[0])).toContain('3:45 Тема');
    // The action word is its own text (a long link text is cut before it).
    expect(text(byTestId(root, `${CHIP(0)}/action`)[0])).toContain('· Смотреть');
    expect(text(byTestId(root, CHIP(0))[0])).not.toContain('"QR"');
    expect(label(root, CHIP(1))).toBe('чужое видео. Показать QR-код');
    expect(label(root, CHIP(2))).toBe('другой пост. Открыть пост');
    expect(label(root, CHIP(3))).toBe('формат. Показать QR-код');
    await unmount(root);
  });

  it('OK → the Player for that video starting at that second; a short visit writes nothing; Back → the same chip', async () => {
    withData(DATA());
    const root = await openPost();
    focusMock.mockClear();
    await press(root, CHIP(0));
    expect(currentRoute()).toBe('Player');
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      ref: REF,
      origin: { routeKey: expect.any(String), focusId: CHIP(0) },
      start: { atSec: 225 },
    });
    await focusOn(root, SURFACE);
    await advance(600);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(225);
    await fire('onSeekDone', 225);
    for (let sec = 225; sec <= 230; sec += 1) {
      await fire('onProgress', sec);
    }
    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Post');
    await advance(1_000);
    expect(e9Calls()).toEqual([]);
    expect(lastFocusTarget()).toBe(CHIP(0));
    await unmount(root);
  });

  it('a time past the end is kept inside the video (the last second)', async () => {
    withData(DATA('9999'));
    const root = await openPost();
    await press(root, CHIP(0));
    await focusOn(root, SURFACE);
    await advance(600);
    await fire('onLoad', { durationSec: 600 });
    expect(engine.seek).toHaveBeenCalledWith(599);
    await unmount(root);
  });
});

describe('Story 7.2: watch a live stream (LiveRef)', () => {
  const LIVE_BLOG = 'synthetic-blog-1';
  const LIVE_CARD_ID = `author/${LIVE_BLOG}/live`;
  const LIVE_HLS = 'https://example.invalid/live-hls?sig=REDACTED';
  const LIVE_DASH = 'https://example.invalid/live-dash';
  const ENDED = 'player/state/ended';
  const ERROR = 'player/state/error';
  const START = 1_700_018_000;
  const liveBody = (more: Record<string, unknown> = {}) => ({ ...(e15LiveFixture.body as Record<string, unknown>), ...more });
  const e15Calls = () => transport.calls.filter(c => E15_RE.test(c.path));
  const e9Calls = () => transport.calls.filter(c => c.method === 'PUT' && E9_RE.test(c.path));
  let progressSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    e15 = () => ({ status: 200, body: liveBody() });
    progressSpies = (['begin', 'report', 'forget', 'resumePoint', 'onServerProgress'] as const).map(name =>
      jest.spyOn(progress, name),
    );
  });

  const noProgress = () => {
    for (const spy of progressSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(e9Calls()).toHaveLength(0);
  };

  /** Главная, then the live Player pushed from the Shell (Автор's card is authorFlow's). */
  async function openLive({ load = true, leaves = false } = {}): Promise<Root> {
    const root = await render(<App />);
    await focusOn(root, FEED_CARD);
    const routeKey = navigationRef.getCurrentRoute()?.key ?? '';
    focusMock.mockClear();
    await act(async () => {
      navigationRef.dispatch(
        StackActions.push('Player', { ref: { kind: 'live', blogUrl: LIVE_BLOG }, origin: { routeKey, focusId: LIVE_CARD_ID } }),
      );
    });
    await settle();
    if (leaves) {
      return root;
    }
    expect(currentRoute()).toBe('Player');
    if (load) {
      await focusOn(root, SURFACE);
      await fire('onLoad', { durationSec: 0 });
      await fire('onBuffering', false);
      await advance(600);
    }
    return root;
  }

  it('Open live: one E15 (content profile); the live-edge HLS URL only, no headers to the engine; ids-only params', async () => {
    jest.setSystemTime((START + 65) * 1000);
    const root = await openLive();
    expect(e15Calls()).toHaveLength(1);
    expect(e15Calls()[0].url).toBe(`https://api.boosty.to/v1/blog/${LIVE_BLOG}/video_stream`);
    expect(e15Calls()[0].headers.Authorization).toMatch(/^Bearer /);
    // The engine gets the source URL only: no headers, so no Boosty Authorization reaches the CDN.
    expect(engine.props?.source).toEqual({ uri: LIVE_HLS, format: 'hls' });
    expect(Object.keys(engine.props ?? {})).not.toContain('headers');
    const params = navigationRef.getCurrentRoute()?.params;
    expect(params).toEqual({ ref: { kind: 'live', blogUrl: LIVE_BLOG }, origin: { routeKey: expect.any(String), focusId: LIVE_CARD_ID } });
    expect(JSON.stringify(params)).not.toMatch(/example\.invalid|playerUrls|signedQuery|sig=/);
    expect(JSON.stringify(logger.entries())).not.toMatch(/example\.invalid|sig=/);
    expect(JSON.stringify(queryClient.getQueryData(queryKeys.stream(LIVE_BLOG)) ?? null)).not.toMatch(/sig=/);
    expect(engine.props?.paused).toBe(false);
    noProgress();
    await unmount(root);
  });

  it('URL filter: only `live_dash` among DVR/VOD/empty entries → DASH plays', async () => {
    e15 = () => ({
      status: 200,
      body: liveBody({
        data: [
          {
            type: 'ok_stream',
            id: 'synthetic-id-72',
            playerUrls: [
              { type: 'live_playback_hls', url: 'https://example.invalid/dvr' },
              { type: 'hls', url: 'https://example.invalid/vod' },
              { type: 'live_hls', url: '' },
              { type: 'live_dash', url: LIVE_DASH },
            ],
          },
        ],
      }),
    });
    const root = await openLive();
    expect(engine.props?.source).toEqual({ uri: LIVE_DASH, format: 'dash' });
    await unmount(root);
  });

  it('Not playable at resolve (`hasAccess: false` or no live-edge URL): the player leaves at once, no engine', async () => {
    e15 = () => ({ status: 200, body: e15LockedFixture.body });
    const locked = await openLive({ leaves: true });
    await settle();
    expect(currentRoute()).not.toBe('Player');
    expect(engine.mounts).toBe(0);
    await unmount(locked);
    e15 = () => ({ status: 200, body: liveBody({ data: [{ type: 'ok_stream', playerUrls: [{ type: 'live_playback_hls', url: LIVE_HLS }] }] }) });
    const noUrl = await openLive({ leaves: true });
    await settle();
    expect(currentRoute()).not.toBe('Player');
    expect(engine.mounts).toBe(0);
    noProgress();
    await unmount(noUrl);
  });

  it('Overlay: the LIVE badge and the ticking elapsed time; no timeline, ±10 or gear; focus on play/pause', async () => {
    jest.setSystemTime((START + 3599) * 1000);
    const root = await openLive();
    focusMock.mockClear();
    await key('up');
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(lastFocusTarget()).toBe(PLAYPAUSE);
    expect(playerText(root)).toContain('LIVE');
    expect(playerText(root)).toContain('59:59');
    await advance(1_000);
    expect(playerText(root)).toContain('1:00:00');
    for (const id of [TIMELINE, BACK10, FORWARD10, SETTINGS, 'player/remaining']) {
      expect(visible(root, id)).toBe(false);
    }
    await unmount(root);
  });

  it('Overlay: a missing `startTime` shows no elapsed time', async () => {
    e15 = () => ({ status: 200, body: liveBody({ startTime: null }) });
    const root = await openLive();
    await key('up');
    expect(visible(root, 'player/live/badge')).toBe(true);
    expect(visible(root, 'player/live/elapsed')).toBe(false);
    await unmount(root);
  });

  it('Pause / play: the engine pauses; play remounts the source at the live edge (no seek, no new E15)', async () => {
    const root = await openLive();
    await key('up');
    await press(root, PLAYPAUSE);
    expect(engine.props?.paused).toBe(true);
    const mounts = engine.mounts;
    await press(root, PLAYPAUSE);
    expect(engine.mounts).toBe(mounts + 1);
    expect(engine.props?.paused).toBe(false);
    expect(engine.props?.source).toEqual({ uri: LIVE_HLS, format: 'hls' });
    expect(engine.seek).not.toHaveBeenCalled();
    expect(e15Calls()).toHaveLength(1);
    // The play/pause media key too.
    await key('playPause');
    expect(engine.props?.paused).toBe(true);
    await key('playPause');
    expect(engine.mounts).toBe(mounts + 2);
    expect(engine.props?.paused).toBe(false);
    expect(engine.seek).not.toHaveBeenCalled();
    noProgress();
    await unmount(root);
  });

  it('← → (raw and native, also held) and the seek media keys never seek: overlay only', async () => {
    const root = await openLive();
    await key('right');
    expect(visible(root, 'player/overlay')).toBe(true);
    await key('left');
    await key('fastForward');
    await key('rewind');
    await act(async () => {
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'down', repeat: 0 });
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'down', repeat: 1 });
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'down', repeat: 2 });
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'up', repeat: 0 });
    });
    await settle();
    await advance(1_000);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(visible(root, 'player/bubble')).toBe(false);
    // Back: the overlay first, then exit.
    await back();
    expect(visible(root, 'player/overlay')).toBe(false);
    expect(currentRoute()).toBe('Player');
    await back();
    expect(currentRoute()).not.toBe('Player');
    await unmount(root);
  });

  it('Quality: the live candidates give one entry («Авто») → no gear; Menu does not open the sheet', async () => {
    const root = await openLive();
    await key('up');
    expect(visible(root, SETTINGS)).toBe(false);
    await key('menu');
    expect(visible(root, 'player/sheet')).toBe(false);
    await unmount(root);
  });

  it('Ended: «Стрим завершён», focus on «Назад», the engine released; no auto-exit; exit invalidates the stream query', async () => {
    queryClient.setQueryData(queryKeys.stream(LIVE_BLOG), null);
    const root = await openLive();
    focusMock.mockClear();
    await fire('onEnd');
    expect(visible(root, ENDED)).toBe(true);
    expect(text(byTestId(root, ENDED)[0])).toContain('Стрим завершён');
    expect(lastFocusTarget()).toBe(BACK);
    expect(visible(root, RETRY)).toBe(false);
    expect(engine.props).toBeNull();
    await advance(10_000);
    expect(currentRoute()).toBe('Player');
    expect(playbackArbiter.current()).toBeNull();
    expect(queryClient.getQueryState(queryKeys.stream(LIVE_BLOG))?.isInvalidated).toBe(false);
    await press(root, BACK);
    expect(currentRoute()).not.toBe('Player');
    expect(queryClient.getQueryState(queryKeys.stream(LIVE_BLOG))?.isInvalidated).toBe(true);
    noProgress();
    await unmount(root);
  });

  it('Exit by Back also invalidates `[stream, blogUrl]`', async () => {
    queryClient.setQueryData(queryKeys.stream(LIVE_BLOG), null);
    const root = await openLive();
    await back();
    expect(currentRoute()).not.toBe('Player');
    expect(queryClient.getQueryState(queryKeys.stream(LIVE_BLOG))?.isInvalidated).toBe(true);
    await unmount(root);
  });

  it('Engine error: one automatic E15 and a replay at the edge; a second error → the error state with «Назад» only', async () => {
    const root = await openLive();
    const mounts = engine.mounts;
    await fire('onError', 'http');
    expect(e15Calls()).toHaveLength(2);
    expect(engine.mounts).toBe(mounts + 1);
    await fire('onLoad', { durationSec: 0 });
    expect(engine.seek).not.toHaveBeenCalled();
    focusMock.mockClear();
    await fire('onError', 'http');
    expect(visible(root, ERROR)).toBe(true);
    expect(text(byTestId(root, ERROR)[0])).toContain('Не удалось воспроизвести эфир');
    expect(text(byTestId(root, ERROR)[0])).toContain(translate('player.live.errorBody'));
    expect(visible(root, RETRY)).toBe(false);
    expect(lastFocusTarget()).toBe(BACK);
    expect(e15Calls()).toHaveLength(2);
    noProgress();
    await unmount(root);
  });

  it('Stream gone at resolve: E15 204, or the stream is not live → «Стрим завершён»', async () => {
    e15 = () => ({ status: 204 });
    const gone = await openLive({ load: false });
    await settle();
    expect(visible(gone, ENDED)).toBe(true);
    expect(lastFocusTarget()).toBe(BACK);
    expect(engine.mounts).toBe(0);
    await unmount(gone);
    e15 = () => ({ status: 200, body: liveBody({ isOnline: false, isTemplate: true }) });
    const scheduled = await openLive({ load: false });
    await settle();
    expect(visible(scheduled, ENDED)).toBe(true);
    await unmount(scheduled);
  });

  it('Stream gone during the recovery: the re-fetched E15 says 204 → «Стрим завершён»', async () => {
    const root = await openLive();
    e15 = () => ({ status: 204 });
    await fire('onError', 'http');
    expect(visible(root, ENDED)).toBe(true);
    await unmount(root);
  });

  it('A failed E15 at open: the error state with «Повторить» (one more E15) and «Назад»', async () => {
    e15 = () => ({ status: 500 });
    const root = await openLive({ load: false });
    await settle();
    expect(visible(root, ERROR)).toBe(true);
    expect(visible(root, RETRY)).toBe(true);
    expect(text(byTestId(root, ERROR)[0])).toContain(translate('error.Server'));
    e15 = () => ({ status: 200, body: liveBody() });
    await press(root, RETRY);
    expect(engine.props?.source).toEqual({ uri: LIVE_HLS, format: 'hls' });
    await unmount(root);
  });

  it('Progress: no ProgressRepository call through ticks, a pause, the background and the exit', async () => {
    const appState: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
      appState.push(listener);
      return { remove: () => {} };
    }) as unknown as typeof AppState.addEventListener);
    const root = await openLive();
    for (let sec = 0; sec <= 40; sec += 1) {
      await fire('onProgress', sec);
    }
    await key('up');
    await press(root, PLAYPAUSE);
    await act(async () => {
      for (const h of [...appState]) {
        h('background');
      }
    });
    await settle();
    expect(engine.props?.paused).toBe(true);
    await back();
    await back();
    expect(currentRoute()).not.toBe('Player');
    await advance(5_000);
    noProgress();
    await unmount(root);
  });

  it('The arbiter slot is claimed while the live stream plays and released on exit', async () => {
    const other = { stop: jest.fn() };
    const release = playbackArbiter.claim(other);
    const root = await openLive();
    expect(other.stop).toHaveBeenCalledTimes(1);
    await back();
    await advance(1_000);
    expect(playbackArbiter.current()).toBeNull();
    release();
    await unmount(root);
  });

  describe('Story 7.3: the live viewer heartbeat (E16)', () => {
    const e16Calls = () => transport.calls.filter(c => c.method === 'PUT' && E16_RE.test(c.path));
    const beats = () => e16Calls().filter(c => !c.url.includes('stop=true'));
    const stops = () => e16Calls().filter(c => c.url.includes('stop=true'));
    const HEARTBEAT_URL = `https://api.boosty.to/v1/blog/${LIVE_BLOG}/video_stream/heartbeat/viewer`;

    it('Watching: the first E16 30 s after start, then every 30 s; PUT, content profile, no stop', async () => {
      const root = await openLive();
      await advance(28_000);
      expect(e16Calls()).toHaveLength(0);
      await advance(2_000);
      expect(beats()).toHaveLength(1);
      expect(beats()[0].url).toBe(HEARTBEAT_URL);
      expect(beats()[0].headers.Authorization).toMatch(/^Bearer /);
      await advance(30_000);
      await advance(30_000);
      expect(beats()).toHaveLength(3);
      expect(stops()).toHaveLength(0);
      expect(engine.props?.paused).toBe(false);
      await unmount(root);
    });

    it('Exit within the first 30 s (Back): exactly one stop, no heartbeat; nothing after', async () => {
      const root = await openLive();
      await advance(10_000);
      await back();
      await back();
      await advance(1_000);
      expect(currentRoute()).not.toBe('Player');
      expect(beats()).toHaveLength(0);
      expect(stops()).toHaveLength(1);
      expect(stops()[0].url).toBe(`${HEARTBEAT_URL}?stop=true`);
      await advance(90_000);
      expect(e16Calls()).toHaveLength(1);
      await unmount(root);
      expect(e16Calls()).toHaveLength(1);
    });

    it('Pause stops the ticks with no stop; play restarts the 30 s schedule', async () => {
      const root = await openLive();
      await advance(30_000);
      expect(beats()).toHaveLength(1);
      await key('up');
      await press(root, PLAYPAUSE);
      expect(engine.props?.paused).toBe(true);
      await advance(120_000);
      expect(beats()).toHaveLength(1);
      expect(stops()).toHaveLength(0);
      await press(root, PLAYPAUSE);
      expect(engine.props?.paused).toBe(false);
      await advance(29_000);
      expect(beats()).toHaveLength(1);
      await advance(1_000);
      expect(beats()).toHaveLength(2);
      await unmount(root);
      expect(stops()).toHaveLength(1);
    });

    it('Background and audio-focus loss stop the ticks (no stop); the exit still sends one stop', async () => {
      const appState: Array<(state: string) => void> = [];
      jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
        appState.push(listener);
        return { remove: () => {} };
      }) as unknown as typeof AppState.addEventListener);
      const root = await openLive();
      await act(async () => {
        for (const h of [...appState]) {
          h('background');
        }
      });
      await settle();
      expect(engine.props?.paused).toBe(true);
      await advance(90_000);
      expect(e16Calls()).toHaveLength(0);
      await key('up');
      await press(root, PLAYPAUSE);
      expect(engine.props?.paused).toBe(false);
      await fire('onAudioFocusLost');
      expect(engine.props?.paused).toBe(true);
      await advance(90_000);
      expect(e16Calls()).toHaveLength(0);
      await back();
      await back();
      await advance(1_000);
      expect(currentRoute()).not.toBe('Player');
      expect(stops()).toHaveLength(1);
      expect(beats()).toHaveLength(0);
      await unmount(root);
    });

    it('Ended: exactly one stop at «Стрим завершён», none at the exit after it; no more ticks', async () => {
      const root = await openLive();
      await advance(30_000);
      await fire('onEnd');
      expect(visible(root, 'player/state/ended')).toBe(true);
      expect(stops()).toHaveLength(1);
      expect(beats()).toHaveLength(1);
      await advance(90_000);
      await press(root, BACK);
      expect(currentRoute()).not.toBe('Player');
      await unmount(root);
      expect(stops()).toHaveLength(1);
      expect(beats()).toHaveLength(1);
    });

    it('Stream gone during the recovery (E15 204 → «Стрим завершён»): one stop; the recovery itself sends no tick', async () => {
      const root = await openLive();
      await advance(20_000);
      let answer: (reply: FixtureReply) => void = () => {};
      e15 = () =>
        new Promise<FixtureReply>(resolve => {
          answer = resolve;
        });
      await fire('onError', 'http');
      // Past the 30 s mark of the watching start (the E15 stays under its 30 s timeout).
      await advance(20_000);
      expect(e16Calls()).toHaveLength(0);
      await act(async () => {
        answer({ status: 204 });
      });
      await settle();
      expect(visible(root, 'player/state/ended')).toBe(true);
      expect(stops()).toHaveLength(1);
      await unmount(root);
      expect(e16Calls()).toHaveLength(1);
    });

    it('A failed E16: not retried, a counts-only warning, playback untouched; the next tick goes out on schedule', async () => {
      e16 = () => ({ status: 500 });
      const root = await openLive();
      await advance(30_000);
      expect(beats()).toHaveLength(1);
      await advance(5_000);
      expect(beats()).toHaveLength(1);
      const warnings = logger.entries().filter(e => e.scope === 'live' && e.message === 'heartbeat failed');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].fields).toEqual({ stop: false, failures: '1', kind: 'Server' });
      expect(JSON.stringify(logger.entries())).not.toMatch(/heartbeat\/viewer|synthetic-blog|Bearer/);
      expect(engine.props?.paused).toBe(false);
      expect(visible(root, ERROR)).toBe(false);
      expect(currentRoute()).toBe('Player');
      await advance(25_000);
      expect(beats()).toHaveLength(2);
      e16 = () => ({ status: 200 });
      await back();
      await back();
      await advance(1_000);
      expect(stops()).toHaveLength(1);
      await unmount(root);
    });

    it('The stop waits for a heartbeat still in flight: it goes out after that reply, exactly once', async () => {
      let release: () => void = () => {};
      e16 = req =>
        req.url.includes('stop=true')
          ? { status: 200 }
          : new Promise<FixtureReply>(resolve => {
              release = () => resolve({ status: 200 });
            });
      const root = await openLive();
      await advance(30_000);
      expect(beats()).toHaveLength(1);
      await back();
      await back();
      await advance(1_000);
      expect(currentRoute()).not.toBe('Player');
      expect(stops()).toHaveLength(0);
      await act(async () => {
        release();
      });
      await settle();
      expect(stops()).toHaveLength(1);
      expect(e16Calls().map(c => c.url.includes('stop=true'))).toEqual([false, true]);
      await advance(90_000);
      await unmount(root);
      expect(stops()).toHaveLength(1);
      expect(beats()).toHaveLength(1);
    });

    it('In flight: a tick while the previous heartbeat still runs is skipped; the next tick after it settles goes out', async () => {
      let held = true;
      e16 = () => (held ? { hang: true } : { status: 200 });
      const root = await openLive();
      await advance(30_000);
      expect(beats()).toHaveLength(1);
      held = false;
      // The 60 s tick fires while the first heartbeat is still open (it ends at its 30 s request timeout).
      await advance(30_000);
      expect(beats()).toHaveLength(1);
      expect(logger.entries().filter(e => e.scope === 'live' && e.message === 'heartbeat failed')).toHaveLength(1);
      await advance(30_000);
      expect(beats()).toHaveLength(2);
      await unmount(root);
    });

    it('Unauthorized (a 401, the mutation not replayed after the renewal): the schedule stops; no stop on exit', async () => {
      installNativeModules({
        InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') },
      });
      tokenReply = { status: refreshOk.status, body: refreshOk.body };
      e16 = () => ({ status: 401 });
      const root = await openLive();
      await advance(30_000);
      expect(beats()).toHaveLength(1);
      const warnings = logger.entries().filter(e => e.scope === 'live' && e.message === 'heartbeat failed');
      expect(warnings.map(w => w.fields)).toEqual([{ stop: false, failures: '1', kind: 'Client' }]);
      await advance(120_000);
      expect(beats()).toHaveLength(1);
      expect(transport.callsTo('/oauth/token/')).toHaveLength(1);
      expect(engine.props?.paused).toBe(false);
      await back();
      await back();
      await advance(1_000);
      expect(currentRoute()).not.toBe('Player');
      await unmount(root);
      expect(e16Calls()).toHaveLength(1);
    });

    it('Rate limited (429): the schedule stops for this playback; the stop still goes out on exit', async () => {
      e16 = req => (req.url.includes('stop=true') ? { status: 200 } : { status: 429 });
      const root = await openLive();
      await advance(30_000);
      expect(beats()).toHaveLength(1);
      expect(logger.entries().filter(e => e.scope === 'live').map(e => e.fields)).toEqual([
        { stop: false, failures: '1', kind: 'RateLimited' },
      ]);
      await advance(120_000);
      expect(beats()).toHaveLength(1);
      // A pause and play does not restart it either.
      await key('up');
      await press(root, PLAYPAUSE);
      await press(root, PLAYPAUSE);
      await advance(60_000);
      expect(beats()).toHaveLength(1);
      await back();
      await back();
      await advance(1_000);
      expect(stops()).toHaveLength(1);
      await unmount(root);
      expect(e16Calls()).toHaveLength(2);
    });

    it('A failed stop: a counts-only warning with `stop: true`, no unhandled rejection', async () => {
      const unhandled = jest.fn();
      type Listener = (...args: unknown[]) => void;
      const proc = (globalThis as unknown as { process: { on(e: string, f: Listener): void; off(e: string, f: Listener): void } })
        .process;
      proc.on('unhandledRejection', unhandled);
      try {
        e16 = req => (req.url.includes('stop=true') ? { status: 500 } : { status: 200 });
        const root = await openLive();
        await back();
        await back();
        await advance(1_000);
        expect(stops()).toHaveLength(1);
        const warnings = logger.entries().filter(e => e.scope === 'live' && e.message === 'heartbeat failed');
        expect(warnings.map(w => w.fields)).toEqual([{ stop: true, failures: '1', kind: 'Server' }]);
        expect(JSON.stringify(logger.entries())).not.toMatch(/stop=true|heartbeat\/viewer|synthetic-blog|Bearer/);
        await unmount(root);
        await settle();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        proc.off('unhandledRejection', unhandled);
      }
    });

    it('Exit from the live error state (a second engine error): no tick during `error`, exactly one stop', async () => {
      const root = await openLive();
      await advance(20_000);
      await fire('onError', 'http');
      await fire('onLoad', { durationSec: 0 });
      await fire('onError', 'http');
      expect(visible(root, ERROR)).toBe(true);
      await advance(90_000);
      expect(e16Calls()).toHaveLength(0);
      await press(root, BACK);
      await advance(1_000);
      expect(currentRoute()).not.toBe('Player');
      expect(stops()).toHaveLength(1);
      await unmount(root);
      expect(e16Calls()).toHaveLength(1);
    });

    it('Never watched (not playable, or gone at resolve): no E16 at all', async () => {
      e15 = () => ({ status: 200, body: e15LockedFixture.body });
      const locked = await openLive({ leaves: true });
      await settle();
      await unmount(locked);
      e15 = () => ({ status: 204 });
      const gone = await openLive({ load: false });
      await settle();
      expect(visible(gone, ENDED)).toBe(true);
      await back();
      await unmount(gone);
      expect(e16Calls()).toHaveLength(0);
    });

    it('An account reset while watching: nothing more is sent, not even the stop; the next tick clears the schedule', async () => {
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
      const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
      const root = await openLive();
      const heartbeatTimers = () =>
        setIntervalSpy.mock.calls
          .map((call, n) => ({ ms: call[1], id: setIntervalSpy.mock.results[n].value as unknown }))
          .filter(t => t.ms === 30_000)
          .map(t => t.id);
      expect(heartbeatTimers()).toHaveLength(1);
      await advance(30_000);
      expect(beats()).toHaveLength(1);
      await act(async () => {
        await accountScope.reset();
      });
      await settle();
      // The Player stays mounted: the next tick sees the bumped generation and clears its interval.
      expect(currentRoute()).toBe('Player');
      await advance(30_000);
      expect(clearIntervalSpy.mock.calls.map(call => call[0])).toContain(heartbeatTimers()[0]);
      await advance(90_000);
      await unmount(root);
      expect(e16Calls()).toHaveLength(1);
    });

    it('A VOD player sends no E16', async () => {
      const root = await openPlayer();
      await advance(90_000);
      await back();
      await back();
      await unmount(root);
      expect(e16Calls()).toHaveLength(0);
    });
  });
});
