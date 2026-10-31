/**
 * Story 4.4 and 4.6 through the real App with a stored session, over
 * FixtureTransport as the global `fetch`: source recovery, the debug-only
 * broken next video URL, sleep, background and audio focus. Split from
 * playerFlow.test.tsx (Epic 8 retro A4); the shared setup is
 * `src/test/playerFlowHarness`. The PlayerEngine port is mocked: these tests
 * prove what the player asks of the engine, not native playback or lifecycle.
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { act } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import App from '../src/app/App';
import { type FixtureReply } from '../src/shared/api/fixtureTransport';
import { logger } from '../src/shared/services/logger';
import {
  QUALITY_PREFERENCE_KEY,
  debugBreakNextVideoSource,
  qualityPreference,
} from '../src/features/player';
import { engine } from '../src/test/playerEngineMock';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import { e8Locked, e8MissingReply, paragraph, postDetail } from '../src/test/postFixtures';
import {
  byTestId,
  deferred,
  installNativeModules,
  lastFocusTarget,
  text,
  unmount,
  visible,
} from '../src/test/flow';
import {
  focusMock,
  settle,
  render,
  one,
  focusOn,
  press,
  back,
  advance,
  key,
  E1,
  FEED_BLOG,
  POST,
  FEED_CARD,
  VIDEO,
  SURFACE,
  TIMELINE,
  PLAYPAUSE,
  SETTINGS,
  RETRY,
  BACK,
  URL,
  E9_RE,
  okVideo,
  ALL,
  ONE,
  withData,
  currentRoute,
  routeNames,
  e8Calls,
  playerText,
  fire,
  failPastRecovery,
  openPost,
  openPlayer,
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

describe('recovery (Story 4.4)', () => {
  const RECOVERING = 'player/state/recovering';
  const AUTHOR = `post/${POST}/author`;
  const device = () => createAsyncStorage('boostytv-device');
  const e9Sent = () =>
    handlers.transport.calls
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
    handlers.e8 = (_req, blogUrl, postId) => {
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
    const answer = handlers.e8;
    handlers.e8 = (req, blogUrl, postId) => pending.promise.then(() => answer(req, blogUrl, postId) as FixtureReply);
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
    // Every field but the wall-clock `time`, which can contain «312» by chance.
    const logged = playerLogs.map(({ level, scope, message, fields }) => ({ level, scope, message, fields }));
    expect(JSON.stringify(logged)).not.toMatch(/example\.invalid|312|v1/);
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
    handlers.e8 = () => ({ network: true });
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
      const answer = handlers.e8;
      handlers.e8 = () => ({ status: 503, body: {} });
      await fire('onError', 'decoder');
      await settle({ timerRounds: 30 });
      handlers.e8 = answer;
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
    handlers.e8 = () => e8MissingReply();
    await fire('onError', 'http');
    expect(playerText(root)).toContain('Видео недоступно');
    expect(focusables(root)).toEqual([BACK]);
    expect(lastFocusTarget()).toBe(BACK);
    await unmount(root);
  });

  it('matrix «No access»: the fresh E8 locked, session ok (E1 200) → exit to the Post at once; the Post refetches, its locked notice, focus on the author', async () => {
    const root = await playTo(40);
    const e1Before = handlers.transport.callsTo(E1).length;
    const postE8Before = e8Calls().length;
    handlers.e8 = () => lockedE8();
    focusMock.mockClear();
    await fire('onError', 'http');
    await advance(50);
    // The session was checked (E1) before the locked answer was trusted.
    expect(handlers.transport.callsTo(E1).length).toBeGreaterThan(e1Before);
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
    handlers.e8 = () => lockedE8();
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
    handlers.e8 = () => {
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
    handlers.e8 = () => lockedE8();
    // Hold the check's E1.
    handlers.e1Hold = check.promise;
    await press(root, RETRY);
    expect(currentRoute()).toBe('Player');
    expect(one(root, RETRY).props.accessibilityState).toMatchObject({ busy: true });
    const e8Before = e8Calls().length;
    await press(root, RETRY);
    expect(e8Calls()).toHaveLength(e8Before);
    handlers.e1Hold = null;
    check.resolve({ status: 200, body: e1Ok.body });
    await settle();
    await advance(50);
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('matrix «Back while recovering»: Back exits the player with the exit report; keys other than Back are ignored', async () => {
    const root = await playTo(312);
    const pending = deferred();
    handlers.e8 = () => pending.promise;
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
    handlers.e8 = (_req, blogUrl, postId) => {
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
    handlers.transport.calls.filter(c => c.method === 'PUT' && E9.test(c.path)).map(c => `${E9.exec(c.path)?.[1]}@${c.form.time_code}`);
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
