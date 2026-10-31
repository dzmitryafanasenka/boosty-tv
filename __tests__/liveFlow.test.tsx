/**
 * Story 7.2 (and the 7.3 viewer heartbeat) through the real App with a
 * stored session, over FixtureTransport as the global `fetch`: watching a
 * live stream (LiveRef, E15, E16). Split from playerFlow.test.tsx (Epic 8
 * retro A4); the shared setup is `src/test/playerFlowHarness`. The
 * PlayerEngine port is mocked: these tests prove what the player asks of the
 * engine, not native playback.
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { act } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { StackActions } from '@react-navigation/native';
import App, { navigationRef } from '../src/app/App';
import { progress } from '../src/app/progress';
import { queryClient } from '../src/app/queryClient';
import { queryKeys } from '../src/shared/api';
import { type FixtureReply } from '../src/shared/api/fixtureTransport';
import { accountScope } from '../src/shared/account';
import { t as translate } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { StreamRepository } from '../src/shared/entities/stream';
import { QUALITY_PREFERENCE_KEY, qualityPreference } from '../src/features/player';
import { playbackArbiter } from '../src/shared/platform/playbackArbiter';
import { engine } from '../src/test/playerEngineMock';
import e15LiveFixture from '../src/test/fixtures/boosty/e15-video-stream-live.json';
import e15LockedFixture from '../src/test/fixtures/boosty/e15-video-stream-locked.json';
import refreshOk from '../src/test/fixtures/boosty/refresh-ok.json';
import {
  byTestId,
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
  focusOn,
  press,
  back,
  advance,
  key,
  FEED_CARD,
  SURFACE,
  TIMELINE,
  PLAYPAUSE,
  SETTINGS,
  BACK10,
  FORWARD10,
  RETRY,
  BACK,
  E9_RE,
  E15_RE,
  E16_RE,
  currentRoute,
  playerText,
  fire,
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

describe('Story 7.2: watch a live stream (LiveRef)', () => {
  const LIVE_BLOG = 'synthetic-blog-1';
  const LIVE_CARD_ID = `author/${LIVE_BLOG}/live`;
  const LIVE_HLS = 'https://example.invalid/live-hls?sig=REDACTED';
  const LIVE_DASH = 'https://example.invalid/live-dash';
  const ENDED = 'player/state/ended';
  const ERROR = 'player/state/error';
  const START = 1_700_018_000;
  const liveBody = (more: Record<string, unknown> = {}) => ({ ...(e15LiveFixture.body as Record<string, unknown>), ...more });
  const e15Calls = () => handlers.transport.calls.filter(c => E15_RE.test(c.path));
  const e9Calls = () => handlers.transport.calls.filter(c => c.method === 'PUT' && E9_RE.test(c.path));
  let progressSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    handlers.e15 = () => ({ status: 200, body: liveBody() });
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
    // Story 7.2 (liveCopy): the live surface's accessibility label while playing.
    expect(byTestId(root, SURFACE)[0].props.accessibilityLabel).toBe(translate('player.live.surface'));
    noProgress();
    await unmount(root);
  });

  it('URL filter: only `live_dash` among DVR/VOD/empty entries → DASH plays', async () => {
    handlers.e15 = () => ({
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
    handlers.e15 = () => ({ status: 200, body: e15LockedFixture.body });
    const locked = await openLive({ leaves: true });
    await settle();
    expect(currentRoute()).not.toBe('Player');
    expect(engine.mounts).toBe(0);
    await unmount(locked);
    handlers.e15 = () => ({ status: 200, body: liveBody({ data: [{ type: 'ok_stream', playerUrls: [{ type: 'live_playback_hls', url: LIVE_HLS }] }] }) });
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
    handlers.e15 = () => ({ status: 200, body: liveBody({ startTime: null }) });
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

  it('Quality pick (a live list with a real choice): the other quality replays at the edge; the playing one only closes the sheet', async () => {
    // The E15 parser yields only adaptive live-edge candidates today («Авто»
    // only, the test above), so the repository's result gets one extra 720p
    // candidate here to reach the live pick path (PlaybackMode `liveSwitch`).
    const LIVE_720 = 'https://example.invalid/live-720';
    const realLiveSources = StreamRepository.liveSources;
    jest.spyOn(StreamRepository, 'liveSources').mockImplementation(async (...args) => {
      const result = await realLiveSources(...args);
      return result.kind === 'ok'
        ? { ...result, sources: [...result.sources, { format: 'progressive', type: 'live_720', height: 720, url: LIVE_720 }] }
        : result;
    });
    const SHEET = 'player/sheet';
    const QUALITY = 'player/sheet/quality';
    const Q = (quality: string | number) => `${QUALITY}/${quality}`;
    const device = () => createAsyncStorage('boostytv-device');
    await qualityPreference.read();
    const peekBefore = qualityPreference.peek();
    expect(peekBefore).not.toBe(720);
    const storedBefore = await device().getItem(QUALITY_PREFERENCE_KEY);
    const root = await openLive();
    expect(engine.props?.source).toEqual({ uri: LIVE_HLS, format: 'hls' });
    const openSheet = async () => {
      await key('up');
      await focusOn(root, SETTINGS);
      focusMock.mockClear();
      await press(root, SETTINGS);
      await advance(50);
      expect(visible(root, SHEET)).toBe(true);
      await press(root, QUALITY);
    };
    await openSheet();
    engine.seek.mockClear();
    focusMock.mockClear();
    const mounts = engine.mounts;
    await press(root, Q(720));
    // A new engine with that candidate (the live edge): no seek, no new E15.
    expect(engine.mounts).toBe(mounts + 1);
    expect(engine.props?.source).toEqual({ uri: LIVE_720, format: 'progressive' });
    expect(engine.seek).not.toHaveBeenCalled();
    expect(e15Calls()).toHaveLength(1);
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    await advance(50);
    expect(lastFocusTarget()).toBe(SETTINGS);
    await fire('onLoad', { durationSec: 0 });
    expect(engine.seek).not.toHaveBeenCalled();
    // No stored preference for live (memory or device).
    expect(qualityPreference.peek()).toBe(peekBefore);
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe(storedBefore);
    // The playing quality: only the sheet closes.
    await advance(6_000);
    await openSheet();
    const mountsAfter = engine.mounts;
    focusMock.mockClear();
    await press(root, Q(720));
    expect(engine.mounts).toBe(mountsAfter);
    expect(engine.props?.source).toEqual({ uri: LIVE_720, format: 'progressive' });
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(e15Calls()).toHaveLength(1);
    expect(qualityPreference.peek()).toBe(peekBefore);
    expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe(storedBefore);
    noProgress();
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
    handlers.e15 = () => ({ status: 204 });
    const gone = await openLive({ load: false });
    await settle();
    expect(visible(gone, ENDED)).toBe(true);
    expect(lastFocusTarget()).toBe(BACK);
    expect(engine.mounts).toBe(0);
    await unmount(gone);
    handlers.e15 = () => ({ status: 200, body: liveBody({ isOnline: false, isTemplate: true }) });
    const scheduled = await openLive({ load: false });
    await settle();
    expect(visible(scheduled, ENDED)).toBe(true);
    await unmount(scheduled);
  });

  it('Stream gone during the recovery: the re-fetched E15 says 204 → «Стрим завершён»', async () => {
    const root = await openLive();
    handlers.e15 = () => ({ status: 204 });
    await fire('onError', 'http');
    expect(visible(root, ENDED)).toBe(true);
    await unmount(root);
  });

  it('A failed E15 at open: the error state with «Повторить» (one more E15) and «Назад»', async () => {
    handlers.e15 = () => ({ status: 500 });
    const root = await openLive({ load: false });
    await settle();
    expect(visible(root, ERROR)).toBe(true);
    expect(visible(root, RETRY)).toBe(true);
    expect(text(byTestId(root, ERROR)[0])).toContain(translate('error.Server'));
    handlers.e15 = () => ({ status: 200, body: liveBody() });
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
    const e16Calls = () => handlers.transport.calls.filter(c => c.method === 'PUT' && E16_RE.test(c.path));
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
      handlers.e15 = () =>
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
      handlers.e16 = () => ({ status: 500 });
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
      handlers.e16 = () => ({ status: 200 });
      await back();
      await back();
      await advance(1_000);
      expect(stops()).toHaveLength(1);
      await unmount(root);
    });

    it('The stop waits for a heartbeat still in flight: it goes out after that reply, exactly once', async () => {
      let release: () => void = () => {};
      handlers.e16 = req =>
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
      handlers.e16 = () => (held ? { hang: true } : { status: 200 });
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
      handlers.tokenReply = { status: refreshOk.status, body: refreshOk.body };
      handlers.e16 = () => ({ status: 401 });
      const root = await openLive();
      await advance(30_000);
      expect(beats()).toHaveLength(1);
      const warnings = logger.entries().filter(e => e.scope === 'live' && e.message === 'heartbeat failed');
      expect(warnings.map(w => w.fields)).toEqual([{ stop: false, failures: '1', kind: 'Client' }]);
      await advance(120_000);
      expect(beats()).toHaveLength(1);
      expect(handlers.transport.callsTo('/oauth/token/')).toHaveLength(1);
      expect(engine.props?.paused).toBe(false);
      await back();
      await back();
      await advance(1_000);
      expect(currentRoute()).not.toBe('Player');
      await unmount(root);
      expect(e16Calls()).toHaveLength(1);
    });

    it('Rate limited (429): the schedule stops for this playback; the stop still goes out on exit', async () => {
      handlers.e16 = req => (req.url.includes('stop=true') ? { status: 200 } : { status: 429 });
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
        handlers.e16 = req => (req.url.includes('stop=true') ? { status: 500 } : { status: 200 });
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
      handlers.e15 = () => ({ status: 200, body: e15LockedFixture.body });
      const locked = await openLive({ leaves: true });
      await settle();
      await unmount(locked);
      handlers.e15 = () => ({ status: 204 });
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
