/**
 * Story 8.1 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: playback speed (PLAY-07, SET-04). Split from
 * playerFlow.test.tsx (Epic 8 retro A4); the shared setup is
 * `src/test/playerFlowHarness`. The PlayerEngine port is mocked: these tests
 * prove what the player asks of the engine, not native playback.
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { act } from 'react';
import { StackActions } from '@react-navigation/native';
import App, { navigationRef } from '../src/app/App';
import { phaseFlags } from '../src/app/phaseFlags';
import { accountScope } from '../src/shared/account';
import { logger } from '../src/shared/services/logger';
import { StreamRepository } from '../src/shared/entities/stream';
import { SPEED_PREFERENCE_KEY, speedPreference } from '../src/features/player';
import { engine } from '../src/test/playerEngineMock';
import e15LiveFixture from '../src/test/fixtures/boosty/e15-video-stream-live.json';
import { byTestId, deferred, lastFocusTarget, text, unmount, visible } from '../src/test/flow';
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
  FEED_CARD,
  VIDEO,
  SURFACE,
  SETTINGS,
  FORWARD10,
  URL,
  E9_RE,
  okVideo,
  withData,
  currentRoute,
  e8Calls,
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

describe('Story 8.1: playback speed (PLAY-07, SET-04)', () => {
  const SHEET = 'player/sheet';
  const QUALITY = 'player/sheet/quality';
  const SPEED = 'player/sheet/speed';
  const MENU = `${SPEED}/menu`;
  const S = (speed: number) => `${SPEED}/${speed}`;
  const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
  const device = () => createAsyncStorage('boostytv-device');
  const e9Sent = () =>
    handlers.transport.calls
      .filter(c => c.method === 'PUT' && E9_RE.test(c.path))
      .map(c => `${E9_RE.exec(c.path)?.[1]}@${c.form.time_code}`);
  const MIXED = [
    { type: 'hls', url: `${URL}-hls` },
    { type: 'high', url: `${URL}-720` },
  ];
  const label = (root: Root, id: string) => one(root, id).props.accessibilityLabel as string;
  const menuRows = (root: Root) =>
    byTestId(root, MENU)[0]
      .queryAll(n => n.props.focusable === true)
      .map(n => n.props.testID as string);
  const speedBadge = (root: Root) => (visible(root, 'player/speed') ? text(byTestId(root, 'player/speed')[0]) : null);
  async function ticks(from: number, to: number) {
    for (let sec = from; sec <= to; sec += 1) {
      await fire('onProgress', sec);
    }
  }
  async function openSheet(root: Root) {
    await key('up');
    await focusOn(root, SETTINGS);
    focusMock.mockClear();
    await press(root, SETTINGS);
    await advance(50);
    expect(visible(root, SHEET)).toBe(true);
  }
  async function openSpeedMenu(root: Root) {
    await openSheet(root);
    focusMock.mockClear();
    await press(root, SPEED);
    await advance(50);
    expect(visible(root, MENU)).toBe(true);
  }

  it('matrix «First run»: no stored value → 1×; «Скорость · 1×» under «Качество»; the submenu lists the 8 presets, 1× checked and focused', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    expect(engine.props?.rate).toBe(1);
    await key('up');
    // No «N×» label at 1×.
    expect(speedBadge(root)).toBeNull();
    await openSheet(root);
    expect(byTestId(root, 'modal/content')[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
      QUALITY,
      SPEED,
    ]);
    expect(label(root, SPEED)).toBe('Скорость 1×');
    expect(lastFocusTarget()).toBe(QUALITY);
    focusMock.mockClear();
    await press(root, SPEED);
    await advance(50);
    expect(menuRows(root)).toEqual(PRESETS.map(S));
    expect(menuRows(root).map(id => label(root, id))).toEqual(['0.5×', '0.75×', '1×', '1.25×', '1.5×', '1.75×', '2×', '3×']);
    expect(one(root, S(1)).props.accessibilityState).toMatchObject({ selected: true });
    expect(one(root, S(1.5)).props.accessibilityState).toMatchObject({ selected: false });
    expect(one(root, S(1)).props.accessibilityRole).toBe('radio');
    expect(lastFocusTarget()).toBe(S(1));
    await unmount(root);
  });

  it('matrix «Pick»: 1.5× at 2:00 → rate 1.5 from 2:00 (no remount, no seek, no E8); the sheet closes, focus «Настройки»; stored; «1.5×» beside the elapsed media time', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 120);
    expect(e9Sent()).toContain('v1@120');
    const e8Before = e8Calls().length;
    const mounts = engine.mounts;
    await openSpeedMenu(root);
    engine.seek.mockClear();
    focusMock.mockClear();
    await press(root, S(1.5));
    expect(engine.props?.rate).toBe(1.5);
    expect(engine.mounts).toBe(mounts);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(e8Calls()).toHaveLength(e8Before);
    expect(engine.props?.paused).toBe(false);
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    await advance(50);
    expect(lastFocusTarget()).toBe(SETTINGS);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(await device().getItem(SPEED_PREFERENCE_KEY)).toBe('1.5');
    expect(speedPreference.peek()).toBe(1.5);
    // Media time: the engine's positions are shown and written as they are.
    await ticks(121, 130);
    expect(text(byTestId(root, 'player/elapsed')[0])).toContain('"2:10"');
    expect(speedBadge(root)).toContain('1.5×');
    expect(e9Sent()).toContain('v1@130');
    // ±10 s stays 10 media seconds.
    await focusOn(root, FORWARD10);
    engine.seek.mockClear();
    await press(root, FORWARD10);
    await advance(600);
    expect(engine.seek).toHaveBeenCalledWith(140);
    // The sheet shows the new speed; its submenu focuses it.
    await advance(6_000);
    await openSheet(root);
    expect(label(root, SPEED)).toBe('Скорость 1.5×');
    focusMock.mockClear();
    await press(root, SPEED);
    await advance(50);
    expect(lastFocusTarget()).toBe(S(1.5));
    expect(one(root, S(1.5)).props.accessibilityState).toMatchObject({ selected: true });
    await unmount(root);
  });

  it('matrix «Back order»: submenu → sheet (focus «Скорость») → close (focus «Настройки») → overlay → exit; the speed is unchanged', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSpeedMenu(root);
    focusMock.mockClear();
    await back();
    await advance(50);
    expect(visible(root, MENU)).toBe(false);
    expect(visible(root, SHEET)).toBe(true);
    expect(lastFocusTarget()).toBe(SPEED);
    focusMock.mockClear();
    await back();
    await advance(50);
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    expect(visible(root, 'player/overlay')).toBe(true);
    await back();
    expect(visible(root, 'player/overlay')).toBe(false);
    expect(currentRoute()).toBe('Player');
    expect(engine.props?.rate).toBe(1);
    await back();
    expect(currentRoute()).toBe('Post');
    expect(await device().getItem(SPEED_PREFERENCE_KEY)).toBeNull();
    await unmount(root);
  });

  it('the quality submenu\'s Back still returns to «Качество» after a visit to the speed submenu', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSpeedMenu(root);
    await back();
    await advance(50);
    expect(lastFocusTarget()).toBe(SPEED);
    await press(root, QUALITY);
    await advance(50);
    focusMock.mockClear();
    await back();
    await advance(50);
    expect(lastFocusTarget()).toBe(QUALITY);
    await unmount(root);
  });

  it('matrix «Next video»: stored `2` (after an app restart) → the new video starts at 2×; «Скорость · 2×»; «2×» in the overlay', async () => {
    await device().setItem(SPEED_PREFERENCE_KEY, '2');
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer(VIDEO('v1'), { load: false });
    // The first engine already has the stored rate (it waits for the read).
    expect(engine.mounts).toBe(1);
    expect(engine.props?.rate).toBe(2);
    await focusOn(root, SURFACE);
    await fire('onLoad', { durationSec: 600 });
    await fire('onBuffering', false);
    await advance(600);
    await key('up');
    expect(speedBadge(root)).toContain('2×');
    await openSheet(root);
    expect(label(root, SPEED)).toBe('Скорость 2×');
    await unmount(root);
  });

  it.each(['fast', '9'])('matrix «Bad store»: stored %p → 1×, no label', async raw => {
    await device().setItem(SPEED_PREFERENCE_KEY, raw);
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    expect(engine.props?.rate).toBe(1);
    await key('up');
    expect(speedBadge(root)).toBeNull();
    await openSheet(root);
    expect(label(root, SPEED)).toBe('Скорость 1×');
    await unmount(root);
  });

  it('matrix «Quality change / recovery»: at 1.25× a quality switch and an engine recovery keep 1.25× and never write the speed', async () => {
    await device().setItem(SPEED_PREFERENCE_KEY, '1.25');
    withData([okVideo('v1', MIXED)]);
    const write = jest.spyOn(speedPreference, 'write');
    const root = await openPlayer();
    expect(engine.props?.rate).toBe(1.25);
    await ticks(0, 60);
    await openSheet(root);
    await press(root, QUALITY);
    await advance(50);
    const mounts = engine.mounts;
    await press(root, `${QUALITY}/720`);
    expect(engine.mounts).toBe(mounts + 1);
    expect(engine.props?.source).toEqual({ uri: `${URL}-720`, format: 'progressive' });
    expect(engine.props?.rate).toBe(1.25);
    await fire('onLoad', { durationSec: 600 });
    await fire('onSeekDone', 60);
    await ticks(61, 70);
    // The recovery (Story 4.4): one fresh E8, a new engine, the same speed.
    await fire('onError', 'decoder');
    expect(engine.mounts).toBe(mounts + 2);
    expect(engine.props?.rate).toBe(1.25);
    // Speed is never stored (or logged as changed) by these paths.
    expect(write).not.toHaveBeenCalled();
    expect(logger.entries().filter(entry => entry.message === 'playback speed changed')).toHaveLength(0);
    expect(await device().getItem(SPEED_PREFERENCE_KEY)).toBe('1.25');
    await unmount(root);
  });

  it('picking the current speed (review): the sheet closes, focus «Настройки»; no log, no store write, no change', async () => {
    withData([okVideo('v1', MIXED)]);
    const write = jest.spyOn(speedPreference, 'write');
    const root = await openPlayer();
    await openSpeedMenu(root);
    focusMock.mockClear();
    await press(root, S(1));
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    expect(engine.props?.rate).toBe(1);
    expect(write).not.toHaveBeenCalled();
    expect(logger.entries().filter(entry => entry.message === 'playback speed changed')).toHaveLength(0);
    expect(await device().getItem(SPEED_PREFERENCE_KEY)).toBeNull();
    await unmount(root);
  });

  it('a pick while paused (review): the rate changes, the player stays paused', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await key('playPause');
    expect(engine.props?.paused).toBe(true);
    await openSpeedMenu(root);
    await press(root, S(2));
    expect(engine.props?.rate).toBe(2);
    expect(engine.props?.paused).toBe(true);
    expect(speedBadge(root)).toContain('2×');
    await unmount(root);
  });

  it('the first engine starts at the stored rate (review): no engine until the speed read resolves, then one mount at 2×', async () => {
    const held = deferred<'2'>();
    jest.spyOn(speedPreference, 'read').mockReturnValue(held.promise.then(() => 2 as const));
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer(VIDEO('v1'), { load: false });
    expect(engine.mounts).toBe(0);
    await act(async () => held.resolve('2'));
    await settle();
    expect(engine.mounts).toBe(1);
    expect(engine.props?.rate).toBe(2);
    await unmount(root);
  });

  it('the `speed` phase flag off (review): stored `2` → 1×, no «Скорость» row, no label, the speed never read', async () => {
    const flag = jest.replaceProperty(phaseFlags, 'speed', false as never);
    try {
      await device().setItem(SPEED_PREFERENCE_KEY, '2');
      const read = jest.spyOn(speedPreference, 'read');
      withData([okVideo('v1', MIXED)]);
      const root = await openPlayer();
      expect(engine.props?.rate).toBe(1);
      expect(read).not.toHaveBeenCalled();
      await key('up');
      expect(speedBadge(root)).toBeNull();
      await openSheet(root);
      expect(byTestId(root, 'modal/content')[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
        QUALITY,
      ]);
      await unmount(root);
    } finally {
      flag.restore();
    }
  });

  it('an account reset (sign-out) keeps the stored speed (device scope, not in the wipe)', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSpeedMenu(root);
    await press(root, S(0.75));
    await unmount(root);
    await act(async () => {
      await accountScope.reset();
    });
    expect(await device().getItem(SPEED_PREFERENCE_KEY)).toBe('0.75');
    expect(speedPreference.peek()).toBe(0.75);
  });

  it('the speed log carries the number only', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSpeedMenu(root);
    await press(root, S(1.75));
    const entries = logger.entries().filter(entry => entry.message === 'playback speed changed');
    expect(entries).toHaveLength(1);
    expect(entries[0].fields).toEqual({ speed: '1.75' });
    await unmount(root);
  });

  describe('live (Story 7.2)', () => {
    const LIVE_BLOG = 'synthetic-blog-1';
    const LIVE_720 = 'https://example.invalid/live-720';

    beforeEach(() => {
      handlers.e15 = () => ({ status: 200, body: e15LiveFixture.body });
      // A live list with a real choice, so the gear and the sheet show (see the
      // Story 7.2 «Quality pick» test): the sheet still has no «Скорость».
      const realLiveSources = StreamRepository.liveSources;
      jest.spyOn(StreamRepository, 'liveSources').mockImplementation(async (...args) => {
        const result = await realLiveSources(...args);
        return result.kind === 'ok'
          ? { ...result, sources: [...result.sources, { format: 'progressive', type: 'live_720', height: 720, url: LIVE_720 }] }
          : result;
      });
    });

    it('matrix «Live»: stored `2` → the stream plays at 1×; no «Скорость» row, no «N×» label', async () => {
      await device().setItem(SPEED_PREFERENCE_KEY, '2');
      // Review: live neither reads nor waits for the speed (a read that never
      // resolves does not hold the engine back).
      const read = jest.spyOn(speedPreference, 'read').mockReturnValue(new Promise(() => {}));
      const root = await render(<App />);
      await focusOn(root, FEED_CARD);
      const routeKey = navigationRef.getCurrentRoute()?.key ?? '';
      await act(async () => {
        navigationRef.dispatch(
          StackActions.push('Player', {
            ref: { kind: 'live', blogUrl: LIVE_BLOG },
            origin: { routeKey, focusId: `author/${LIVE_BLOG}/live` },
          }),
        );
      });
      await settle();
      expect(currentRoute()).toBe('Player');
      await focusOn(root, SURFACE);
      expect(engine.mounts).toBe(1);
      expect(read).not.toHaveBeenCalled();
      await fire('onLoad', { durationSec: 0 });
      await fire('onBuffering', false);
      await advance(600);
      expect(engine.props?.rate).toBe(1);
      await openSheet(root);
      expect(byTestId(root, 'modal/content')[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
        QUALITY,
      ]);
      expect(visible(root, SPEED)).toBe(false);
      await back();
      await advance(50);
      expect(speedBadge(root)).toBeNull();
      // A live quality switch stays at 1× too.
      await openSheet(root);
      await press(root, QUALITY);
      await advance(50);
      await press(root, `${QUALITY}/720`);
      expect(engine.props?.source).toEqual({ uri: LIVE_720, format: 'progressive' });
      expect(engine.props?.rate).toBe(1);
      expect(await device().getItem(SPEED_PREFERENCE_KEY)).toBe('2');
      await unmount(root);
    });
  });
});
