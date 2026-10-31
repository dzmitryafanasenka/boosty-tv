/**
 * Story 4.1 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: Главная → Пост → «Смотреть» or a MediaRow → Player
 * (a fresh E8, the source order), the overlay, remote seeking, auto-hide,
 * the spinner, Back, origin focus, the error states and the PlaybackArbiter
 * slot. Every row of the spec's I/O matrix. Also the Story 4.5 end-exit
 * rows, the Epic 3 retro A6 locked-E8 session check and the Story 6.3
 * timestamp chips. Split from the original player flow file in Epic 8 retro
 * A4: progress, quality, recovery, live, speed and the system player have
 * their own `*Flow.test.tsx`; the shared setup is
 * `src/test/playerFlowHarness.tsx`. The PlayerEngine port is
 * mocked (`src/test/playerEngineMock`): these tests prove what the player
 * asks of the engine and which element it asks to focus, not native
 * playback, decoding or focus movement (device checks, docs/testing.md).
 */
import { act } from 'react';
import { DeviceEventEmitter, StyleSheet } from 'react-native';
import { navigationRef } from '../src/app/App';
import { queryClient } from '../src/app/queryClient';
import { queryKeys } from '../src/shared/api';
import { type FixtureReply, type FixtureRequest } from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { t as translate } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { progressStore } from '../src/shared/services/progress';
import { playbackArbiter } from '../src/shared/platform/playbackArbiter';
import { engine } from '../src/test/playerEngineMock';
import { E5_PATH, syntheticFeed } from '../src/test/feedFixtures';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
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
  deferred,
  focusTargets,
  installFixtureTransport,
  installNativeModules,
  lastFocusTarget,
  text,
  unmount,
  visible,
} from '../src/test/flow';
import {
  focusMock,
  settle,
  one,
  focusOn,
  press,
  back,
  advance,
  key,
  E1,
  FEED_BLOG,
  POST,
  PRIMARY,
  VIDEO,
  SURFACE,
  TIMELINE,
  PLAYPAUSE,
  SETTINGS,
  BACK10,
  FORWARD10,
  RETRY,
  BACK,
  E8_RE,
  URL,
  E9_RE,
  okVideo,
  ALL,
  ONE,
  TWO,
  withData,
  currentRoute,
  routeNames,
  e8Calls,
  playerText,
  fire,
  failPastRecovery,
  openPost,
  openPlayer,
  type Reply,
  type Root,
  setupPlayerFlowHarness,
} from '../src/test/playerFlowHarness';

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

const handlers = setupPlayerFlowHarness();

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
    handlers.e8 = () => ({ status: 200, body: e8Locked() });
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
    handlers.e8 = () => pending.promise;
    focusMock.mockClear();
    await press(root, VIDEO('v1'));
    expect(currentRoute()).toBe('Player');
    expect(visible(root, 'player/spinner')).toBe(true);
    expect(engine.props).toBeNull();
    const page = byTestId(root, 'player/page')[0];
    expect(page.queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([SURFACE]);
    expect(lastFocusTarget()).toBe(SURFACE);
    // The VOD surface's accessibility label while loading.
    expect(byTestId(root, SURFACE)[0].props.accessibilityLabel).toBe(translate('player.loading'));
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
    handlers.transport = installFixtureTransport((req: FixtureRequest): Reply => {
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
        return stale ? staleE8() : handlers.e8(req, decodeURIComponent(single[1]), decodeURIComponent(single[2]));
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
    expect(handlers.transport.callsTo(E1)).toHaveLength(1);
    dead = true;
    focusMock.mockClear();
    await press(root, VIDEO('v1'), timers ? { settle: { timerRounds: 30 } } : undefined);
    return root;
  }

  it('dead session (E1 401 → refresh invalid_grant): A11, no player and no «Нет доступа» behind it', async () => {
    install({ status: refreshRejected.status, body: refreshRejected.body });
    const root = await playDead({ timers: true });
    expect(handlers.transport.callsTo(E1)).toHaveLength(2);
    expect(handlers.transport.callsTo(TOKEN)).toHaveLength(1);
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
    expect(handlers.transport.callsTo(TOKEN)).toHaveLength(1);
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
    expect(handlers.transport.callsTo(E1)).toHaveLength(2);
    expect(handlers.transport.callsTo(TOKEN)).toHaveLength(0);
    expect(e8Calls()).toHaveLength(3);
    expect(playerText(root)).toContain('Нет доступа к этому видео');
    expect(lastFocusTarget()).toBe(BACK);
    // Story 4.7 (owner decision 2026-10-28): confirmed locked drops the local entry.
    expect(progressStore.get('v1')).toBeUndefined();
    await press(root, BACK);
    expect(currentRoute()).toBe('Post');
    await press(root, VIDEO('v1'));
    expect(playerText(root)).toContain('Нет доступа к этому видео');
    expect(handlers.transport.callsTo(E1)).toHaveLength(2);
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
    expect(handlers.transport.callsTo(E1)).toHaveLength(2);
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
    expect(handlers.transport.callsTo(E1)).toHaveLength(4);
    expect(handlers.transport.callsTo(TOKEN)).toHaveLength(0);
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
    handlers.e8 = () => ({
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
    handlers.e8 = () => ({ status: 200, body: { ...e8Locked(), id: POST, user: { ...(e8Locked().user as object), blogUrl: FEED_BLOG } } });
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
    handlers.e8 = () => e8MissingReply();
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
    handlers.e8 = () => ({ status: 503, body: {} });
    await press(root, VIDEO('v1'), { settle: { timerRounds: 30 } });
    expect(playerText(root)).toContain('Не удалось воспроизвести видео');
    expect(playerText(root)).toContain('Boosty сейчас не отвечает');
    expect(lastFocusTarget()).toBe(RETRY);
    const pending = deferred();
    handlers.e8 = () => pending.promise;
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
    handlers.e8 = (_req, blogUrl, postId) => {
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
    handlers.e8 = (_req, blogUrl, postId) => {
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
    handlers.e8 = () => pending.promise;
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
    handlers.e8 = () => ({ status: 503, body: {} });
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

describe('Story 6.3: timestamp link chips (owner decision 2026-10-29, option b)', () => {
  const REF = { blogUrl: FEED_BLOG, postId: POST, mediaId: 'v2' };
  const CHIP = (n: number) => `post/${POST}/block/text@2/link/${n}`;
  const link = (s: string, url: string) => ({ type: 'link', content: JSON.stringify([s, 'unstyled', []]), url });
  const e9Calls = () => handlers.transport.calls.filter(c => c.method === 'PUT' && E9_RE.test(c.path));
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
