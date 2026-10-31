/**
 * Story 4.3 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: quality selection, the device preference and the
 * source it picks. Split from playerFlow.test.tsx (Epic 8 retro A4); the
 * shared setup is `src/test/playerFlowHarness`. The PlayerEngine port is
 * mocked: these tests prove what the player asks of the engine, not native
 * playback.
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { act } from 'react';
import { DeviceEventEmitter, StyleSheet } from 'react-native';
import { logger } from '../src/shared/services/logger';
import { progressStore } from '../src/shared/services/progress';
import { QUALITY_PREFERENCE_KEY, qualityPreference } from '../src/features/player';
import { engine } from '../src/test/playerEngineMock';
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
  one,
  focusOn,
  press,
  back,
  advance,
  key,
  FEED_BLOG,
  POST,
  VIDEO,
  SURFACE,
  SETTINGS,
  BACK10,
  FORWARD10,
  RETRY,
  URL,
  E9_RE,
  okVideo,
  withData,
  currentRoute,
  e8Calls,
  fire,
  failPastRecovery,
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

describe('quality (Story 4.3)', () => {
  const SHEET = 'player/sheet';
  const QUALITY = 'player/sheet/quality';
  const MENU = 'player/sheet/quality/menu';
  const Q = (quality: string | number) => `${QUALITY}/${quality}`;
  const device = () => createAsyncStorage('boostytv-device');
  const e9Sent = () =>
    handlers.transport.calls
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
    // The sheet is the only focusable content in the modal (the trap holds it);
    // Story 8.1 added «Скорость» under «Качество» for recordings.
    expect(byTestId(root, 'modal/content')[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
      QUALITY,
      'player/sheet/speed',
    ]);
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
