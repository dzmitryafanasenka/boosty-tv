/**
 * Story 14.2 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: the sleep timer (our improvement IMP-08, FR-64). The
 * shared setup is `src/test/playerFlowHarness`. The PlayerEngine port is
 * mocked: these tests prove what the player asks of the engine and which E9
 * writes it sends, not native playback.
 */
import { act } from 'react';
import { AccessibilityInfo, AppState, DeviceEventEmitter } from 'react-native';
import { StackActions } from '@react-navigation/native';
import App, { navigationRef } from '../src/app/App';
import { engine } from '../src/test/playerEngineMock';
import e15LiveFixture from '../src/test/fixtures/boosty/e15-video-stream-live.json';
import { byTestId, deferred, installNativeModules, lastFocusTarget, text, unmount, visible } from '../src/test/flow';
import { type FixtureReply } from '../src/shared/api/fixtureTransport';
import { blockEnd, postDetail, text as textBlock } from '../src/test/postFixtures';
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
  SURFACE,
  SETTINGS,
  PLAYPAUSE,
  URL,
  E9_RE,
  RETRY,
  okVideo,
  withData,
  failPastRecovery,
  currentRoute,
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

const T0 = Date.UTC(2026, 10, 3, 20, 0, 0);
const MIN = 60_000;
const SHEET = 'player/sheet';
const SLEEP = 'player/sheet/sleep';
const MENU = `${SLEEP}/menu`;
const S = (choice: string | number) => `${SLEEP}/${choice}`;
const MIXED = [
  { type: 'hls', url: `${URL}-hls` },
  { type: 'high', url: `${URL}-720` },
];

const e9Sent = () =>
  handlers.transport.calls
    .filter(c => c.method === 'PUT' && E9_RE.test(c.path))
    .map(c => `${E9_RE.exec(c.path)?.[1]}@${c.form.time_code}`);
const label = (root: Root, id: string) => one(root, id).props.accessibilityLabel as string;
const indicator = (root: Root) => (visible(root, 'player/sleep') ? text(byTestId(root, 'player/sleep')[0]) : null);
const menuRows = (root: Root) =>
  byTestId(root, MENU)[0]
    .queryAll(n => n.props.focusable === true)
    .map(n => n.props.testID as string);

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

async function openSleepMenu(root: Root) {
  await openSheet(root);
  focusMock.mockClear();
  await press(root, SLEEP);
  await advance(50);
  expect(visible(root, MENU)).toBe(true);
}

async function pickSleep(root: Root, choice: string | number) {
  await openSleepMenu(root);
  focusMock.mockClear();
  await press(root, S(choice));
}

/** AppState listeners (Story 4.6 lifecycle): the tests drive background/active. */
function mockAppState() {
  let listeners: Array<(state: string) => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter(h => h !== listener);
      },
    };
  }) as unknown as typeof AppState.addEventListener);
  return async (state: string) => {
    await act(async () => {
      for (const h of [...listeners]) {
        h(state);
      }
    });
    await settle();
  };
}

beforeEach(() => {
  jest.setSystemTime(T0);
});

describe('Story 14.2: sleep timer (IMP-08, FR-64)', () => {
  it('the sheet: «Таймер сна · Выкл» last; the submenu: Выкл, 15/30/60/90 мин, «До конца видео»; «Выкл» checked and focused', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSheet(root);
    expect(byTestId(root, 'modal/content')[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
      'player/sheet/quality',
      'player/sheet/speed',
      SLEEP,
    ]);
    expect(label(root, SLEEP)).toBe('Таймер сна Выкл');
    focusMock.mockClear();
    await press(root, SLEEP);
    await advance(50);
    expect(menuRows(root)).toEqual(['off', '15', '30', '60', '90', 'end'].map(S));
    expect(menuRows(root).map(id => label(root, id))).toEqual(['Выкл', '15 мин', '30 мин', '60 мин', '90 мин', 'До конца видео']);
    expect(one(root, S('off')).props.accessibilityState).toMatchObject({ selected: true });
    expect(lastFocusTarget()).toBe(S('off'));
    await unmount(root);
  });

  it('matrix «Pick 30 мин»: the sheet closes, focus «Настройки»; the overlay shows «Таймер сна · 30:00» counting down; the row shows «30 мин»', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await pickSleep(root, 30);
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    await advance(50);
    expect(lastFocusTarget()).toBe(SETTINGS);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(indicator(root)).toContain('Таймер сна · 30:00');
    // Plain text: not focusable, no live region.
    expect(byTestId(root, 'player/sleep')[0].props.accessibilityLiveRegion).toBeUndefined();
    expect(byTestId(root, 'player/sleep')[0].queryAll(n => n.props.focusable === true)).toHaveLength(0);
    await advance(1_000);
    expect(indicator(root)).toContain('Таймер сна · 29:59');
    expect(engine.props?.paused).toBe(false);
    await advance(6_000);
    await openSheet(root);
    expect(label(root, SLEEP)).toBe('Таймер сна 30 мин');
    focusMock.mockClear();
    await press(root, SLEEP);
    await advance(50);
    expect(lastFocusTarget()).toBe(S(30));
    await unmount(root);
  });

  it('matrix «Fires while playing»: 30 min later the video pauses at that position, one pause write, the overlay shows, the timer is «Выкл»', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 120);
    await pickSleep(root, 30);
    // The overlay auto-hides while playing.
    await advance(6_000);
    expect(visible(root, 'player/overlay')).toBe(false);
    await fire('onProgress', 125);
    const before = e9Sent().length;
    await advance(30 * MIN - 6_000 - 1_000);
    expect(engine.props?.paused).toBe(false);
    await advance(1_000);
    expect(engine.props?.paused).toBe(true);
    expect(e9Sent().slice(before)).toEqual(['v1@125']);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(indicator(root)).toBeNull();
    expect(visible(root, `${PLAYPAUSE}/play`)).toBe(true);
    // Nothing more fires.
    await advance(60 * MIN);
    expect(e9Sent().slice(before)).toEqual(['v1@125']);
    await openSheet(root);
    expect(label(root, SLEEP)).toBe('Таймер сна Выкл');
    await unmount(root);
  });

  it('matrix «Fires while paused»: the timer goes «Выкл», no extra write, stays paused', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 60);
    await pickSleep(root, 15);
    await key('playPause');
    expect(engine.props?.paused).toBe(true);
    const before = e9Sent().length;
    // Wall clock: also while paused.
    await advance(15 * MIN);
    expect(engine.props?.paused).toBe(true);
    expect(e9Sent().length).toBe(before);
    expect(indicator(root)).toBeNull();
    await unmount(root);
  });

  it('matrix «Fires in the background»: the background write only; no second write when it fires; stays paused', async () => {
    const lifecycle = mockAppState();
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 60);
    await pickSleep(root, 15);
    await fire('onProgress', 65);
    const before = e9Sent().length;
    await lifecycle('background');
    expect(engine.props?.paused).toBe(true);
    // The background write, at the position.
    expect(e9Sent().slice(before)).toEqual(['v1@65']);
    await advance(16 * MIN);
    await lifecycle('active');
    expect(engine.props?.paused).toBe(true);
    // No second write when the timer fired.
    expect(e9Sent().slice(before)).toEqual(['v1@65']);
    expect(indicator(root)).toBeNull();
    await unmount(root);
  });

  it('matrix «Fires during a hold-scrub»: the scrub is cancelled (no seek), the video stays paused, one pause write', async () => {
    installNativeModules({ SeekKeys: { setEnabled: jest.fn() } });
    const native = async (dpad: 'left' | 'right', action: 'down' | 'up', repeat = 0) => {
      await act(async () => {
        DeviceEventEmitter.emit('seekKey', { key: dpad, action, repeat });
      });
      await settle();
    };
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 100);
    await pickSleep(root, 15);
    await advance(6_000);
    await fire('onProgress', 101);
    await advance(15 * MIN - 6_000 - 2_000);
    // A hold (the warning keeps the overlay up; on the timeline): the scrub
    // pauses playback and keeps a pending target.
    await focusOn(root, 'player/timeline');
    await native('right', 'down', 0);
    await native('right', 'down', 1);
    await native('right', 'up');
    await key('right');
    expect(engine.props?.paused).toBe(true);
    expect(visible(root, 'player/bubble')).toBe(true);
    engine.seek.mockClear();
    const before = e9Sent().length;
    await advance(2_000);
    expect(visible(root, 'player/bubble')).toBe(false);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(engine.props?.paused).toBe(true);
    expect(e9Sent().slice(before)).toEqual(['v1@101']);
    // The fire ended the scrub: nothing resumes playback later.
    await advance(10_000);
    expect(engine.props?.paused).toBe(true);
    expect(e9Sent().slice(before)).toEqual(['v1@101']);
    await unmount(root);
  });

  it('matrix «Fires with the sheet open»: the sheet closes (focus «Настройки»), the video pauses', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 30);
    await pickSleep(root, 15);
    await advance(15 * MIN - 2_000);
    await openSheet(root);
    focusMock.mockClear();
    await advance(2_000);
    expect(visible(root, SHEET)).toBe(false);
    expect(engine.props?.paused).toBe(true);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(lastFocusTarget()).toBe(SETTINGS);
    await unmount(root);
  });

  it('Back order: submenu → sheet (focus «Таймер сна») → close (focus «Настройки») → overlay → exit; the choice is unchanged', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await openSleepMenu(root);
    focusMock.mockClear();
    await back();
    await advance(50);
    expect(visible(root, MENU)).toBe(false);
    expect(visible(root, SHEET)).toBe(true);
    expect(lastFocusTarget()).toBe(SLEEP);
    expect(label(root, SLEEP)).toBe('Таймер сна Выкл');
    focusMock.mockClear();
    await back();
    await advance(50);
    expect(visible(root, SHEET)).toBe(false);
    expect(lastFocusTarget()).toBe(SETTINGS);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(indicator(root)).toBeNull();
    await back();
    expect(visible(root, 'player/overlay')).toBe(false);
    expect(currentRoute()).toBe('Player');
    await back();
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('fires during a quality switch load: the switched source starts paused; no extra write before its start position', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 60);
    await pickSleep(root, 15);
    await advance(15 * MIN - 2_000);
    await openSheet(root);
    await press(root, 'player/sheet/quality');
    await advance(50);
    const mounts = engine.mounts;
    await press(root, 'player/sheet/quality/720');
    expect(engine.mounts).toBe(mounts + 1);
    const before = e9Sent().length;
    await advance(2_000);
    expect(engine.props?.paused).toBe(true);
    await fire('onLoad', { durationSec: 600 });
    await fire('onSeekDone', 60);
    await advance(1_000);
    expect(engine.props?.paused).toBe(true);
    expect(e9Sent().length).toBe(before);
    await unmount(root);
  });

  it('fires during an error recovery (a fresh E8 in flight): the recovered source starts paused', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 60);
    await pickSleep(root, 15);
    await advance(15 * MIN - 2_000);
    const held = deferred<FixtureReply>();
    handlers.e8 = () => held.promise;
    const mounts = engine.mounts;
    await fire('onError', 'decoder');
    expect(visible(root, 'player/state/recovering')).toBe(true);
    await advance(2_000);
    await act(async () => held.resolve({ status: 200, body: postDetail('synthetic-blog-1', 'feed-post-0', [okVideo('v1', MIXED)]) }));
    await settle();
    expect(engine.mounts).toBe(mounts + 1);
    expect(engine.props?.paused).toBe(true);
    await fire('onLoad', { durationSec: 600 });
    await fire('onSeekDone', 60);
    expect(engine.props?.paused).toBe(true);
    await unmount(root);
  });

  it('fires on the error screen: «Повторить» starts the next source paused', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 60);
    await pickSleep(root, 15);
    await advance(15 * MIN - 2_000);
    await failPastRecovery();
    expect(visible(root, RETRY)).toBe(true);
    await advance(2_000);
    const mounts = engine.mounts;
    await press(root, RETRY);
    expect(engine.mounts).toBe(mounts + 1);
    expect(engine.props?.paused).toBe(true);
    await fire('onLoad', { durationSec: 600 });
    await fire('onSeekDone', 60);
    expect(engine.props?.paused).toBe(true);
    await unmount(root);
  });

  it('matrix «Выкл»: picking «Выкл» cancels the timer; the indicator goes; nothing fires', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await pickSleep(root, 15);
    expect(indicator(root)).toContain('15:00');
    await advance(6_000);
    await pickSleep(root, 'off');
    expect(indicator(root)).toBeNull();
    await advance(20 * MIN);
    expect(engine.props?.paused).toBe(false);
    await unmount(root);
  });

  it('matrix «До конца видео»: the end writes `end`, the player stays paused at the end with the overlay (no exit); replay starts «Выкл»; Back exits to Пост', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 20);
    await pickSleep(root, 'end');
    expect(indicator(root)).toContain('Таймер сна · до конца');
    await advance(6_000);
    await fire('onProgress', 598);
    const before = e9Sent().length;
    await fire('onEnd');
    expect(e9Sent().slice(before)).toEqual(['v1@600']);
    expect(currentRoute()).toBe('Player');
    expect(engine.props?.paused).toBe(true);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(indicator(root)).toBeNull();
    // Replay: from 0, the timer is «Выкл», so the next end exits as usual.
    engine.seek.mockClear();
    await key('playPause');
    expect(engine.seek).toHaveBeenCalledWith(0);
    expect(engine.props?.paused).toBe(false);
    await advance(6_000);
    await openSheet(root);
    expect(label(root, SLEEP)).toBe('Таймер сна Выкл');
    await back();
    await advance(50);
    await back();
    await back();
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('matrix «До конца видео», Back after the end: the overlay hides, then the player exits to Пост', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 20);
    await pickSleep(root, 'end');
    await fire('onProgress', 599);
    await fire('onEnd');
    expect(currentRoute()).toBe('Player');
    await back();
    expect(visible(root, 'player/overlay')).toBe(false);
    await back();
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('no timer: the end still exits to Пост (the default is unchanged)', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer();
    await ticks(0, 20);
    await fire('onProgress', 599);
    await fire('onEnd');
    expect(currentRoute()).toBe('Post');
    await unmount(root);
  });

  it('matrix «До конца видео» availability: not offered before the duration is known', async () => {
    withData([okVideo('v1', MIXED)]);
    const root = await openPlayer(undefined, { load: false });
    await focusOn(root, SURFACE);
    await fire('onLoad', { durationSec: 0 });
    await fire('onBuffering', false);
    await advance(600);
    await openSleepMenu(root);
    expect(menuRows(root)).toEqual(['off', '15', '30', '60', '90'].map(S));
    await unmount(root);
  });

  it('matrix «Leave / new Player»: Back cancels the timer; the next Player starts «Выкл»', async () => {
    withData([okVideo('v1', MIXED)]);
    let root = await openPlayer();
    await pickSleep(root, 15);
    await back();
    await back();
    expect(currentRoute()).toBe('Post');
    await advance(20 * MIN);
    await unmount(root);
    root = await openPlayer();
    expect(engine.props?.paused).toBe(false);
    await openSheet(root);
    expect(label(root, SLEEP)).toBe('Таймер сна Выкл');
    await key('up');
    await unmount(root);
  });

  describe('the last-minute warning and the notice (owner decisions 2026-11-03, after review)', () => {
    const EXTEND = 'player/sleep/extend';
    const countdown = (root: Root) =>
      visible(root, 'player/sleep/countdown') ? text(byTestId(root, 'player/sleep/countdown')[0]) : null;
    const notice = (root: Root) => visible(root, 'player/sleep/notice');

    /** A playing VOD with a 15 мин timer, the overlay hidden, 1 s before the warning. */
    async function beforeWarning(data: unknown[] = [okVideo('v1', MIXED)], durationSec = 600): Promise<Root> {
      withData(data);
      const root = await openPlayer(undefined, { load: false });
      await focusOn(root, SURFACE);
      await fire('onLoad', { durationSec });
      await fire('onBuffering', false);
      await advance(600);
      await ticks(0, 60);
      await pickSleep(root, 15);
      await advance(6_000);
      expect(visible(root, 'player/overlay')).toBe(false);
      await advance(14 * MIN - 6_000 - 1_000);
      expect(visible(root, 'player/overlay')).toBe(false);
      await fire('onProgress', 65);
      return root;
    }

    it('at T−60 s the overlay opens with focus on «Ещё 15 мин» next to «Пауза через 1:00» (counting down); no auto-hide; without OK the pause comes at T with «Пауза по таймеру сна»; play → it goes', async () => {
      const root = await beforeWarning();
      focusMock.mockClear();
      await advance(1_000);
      expect(visible(root, 'player/overlay')).toBe(true);
      expect(lastFocusTarget()).toBe(EXTEND);
      expect(one(root, EXTEND).props.accessibilityLabel).toBe('Ещё 15 минут до паузы');
      expect(text(byTestId(root, EXTEND)[0])).toContain('Ещё 15 мин');
      expect(countdown(root)).toContain('Пауза через 1:00');
      expect(visible(root, 'player/sleep')).toBe(false);
      await advance(1_000);
      expect(countdown(root)).toContain('Пауза через 0:59');
      // No auto-hide during the warning.
      await advance(10_000);
      expect(visible(root, 'player/overlay')).toBe(true);
      expect(engine.props?.paused).toBe(false);
      const before = e9Sent().length;
      await advance(48_000);
      expect(engine.props?.paused).toBe(false);
      await advance(1_000);
      expect(engine.props?.paused).toBe(true);
      expect(e9Sent().slice(before)).toEqual(['v1@65']);
      expect(visible(root, EXTEND)).toBe(false);
      expect(notice(root)).toBe(true);
      expect(text(byTestId(root, 'player/sleep/notice')[0])).toContain('Пауза по таймеру сна');
      await key('playPause');
      expect(engine.props?.paused).toBe(false);
      expect(notice(root)).toBe(false);
      await unmount(root);
    });

    it('OK on «Ещё 15 мин»: the warning ends, the indicator shows the new time left, auto-hide resumes; the pause comes 15 min later', async () => {
      const root = await beforeWarning();
      await advance(1_000 + 20_000);
      expect(lastFocusTarget()).toBe(EXTEND);
      focusMock.mockClear();
      await press(root, EXTEND);
      expect(visible(root, EXTEND)).toBe(false);
      expect(countdown(root)).toBeNull();
      expect(indicator(root)).toContain('Таймер сна · 15:40');
      await advance(50);
      expect(lastFocusTarget()).toBe('player/timeline');
      await advance(6_000);
      expect(visible(root, 'player/overlay')).toBe(false);
      // The old deadline passes: nothing.
      await advance(40_000);
      expect(engine.props?.paused).toBe(false);
      // The next warning 1 min before the new deadline, then the pause.
      await advance(14 * MIN - 6_050 - 1);
      expect(visible(root, EXTEND)).toBe(false);
      await advance(1);
      expect(visible(root, EXTEND)).toBe(true);
      await advance(60_000);
      expect(engine.props?.paused).toBe(true);
      expect(notice(root)).toBe(true);
      await unmount(root);
    });

    it('the sheet open at T−60 s: no warning (no focus steal); the fire still closes the sheet and pauses', async () => {
      const root = await beforeWarning();
      await openSheet(root);
      focusMock.mockClear();
      await advance(1_000);
      expect(visible(root, SHEET)).toBe(true);
      expect(visible(root, EXTEND)).toBe(false);
      expect(lastFocusTarget()).not.toBe(EXTEND);
      await advance(60_000);
      expect(visible(root, SHEET)).toBe(false);
      expect(engine.props?.paused).toBe(true);
      expect(notice(root)).toBe(true);
      await unmount(root);
    });

    it('the sheet opened during the warning: the countdown goes on; closing it returns focus to «Настройки»; the pause at T', async () => {
      const root = await beforeWarning();
      await advance(1_000);
      expect(visible(root, EXTEND)).toBe(true);
      await focusOn(root, SETTINGS);
      await press(root, SETTINGS);
      await advance(50);
      expect(visible(root, SHEET)).toBe(true);
      await advance(10_000);
      focusMock.mockClear();
      await back();
      await advance(50);
      expect(lastFocusTarget()).toBe(SETTINGS);
      expect(countdown(root)).toContain('Пауза через 0:50');
      await advance(50_000);
      expect(engine.props?.paused).toBe(true);
      await unmount(root);
    });

    it('a manual pause during the warning ends it; the timer keeps running and its fire then only ends it (no write, no notice)', async () => {
      const root = await beforeWarning();
      await advance(1_000 + 10_000);
      expect(visible(root, EXTEND)).toBe(true);
      await key('playPause');
      expect(engine.props?.paused).toBe(true);
      expect(visible(root, EXTEND)).toBe(false);
      expect(indicator(root)).toContain('Таймер сна · 0:50');
      const before = e9Sent().length;
      await advance(50_000);
      expect(engine.props?.paused).toBe(true);
      expect(e9Sent().length).toBe(before);
      expect(indicator(root)).toBeNull();
      expect(notice(root)).toBe(false);
      await unmount(root);
    });

    it('Back during the warning hides the overlay (focus → the surface); shown again, the warning is there without a focus steal', async () => {
      const root = await beforeWarning();
      await advance(1_000);
      expect(lastFocusTarget()).toBe(EXTEND);
      focusMock.mockClear();
      await back();
      expect(visible(root, 'player/overlay')).toBe(false);
      expect(lastFocusTarget()).toBe(SURFACE);
      await advance(5_000);
      expect(visible(root, 'player/overlay')).toBe(false);
      focusMock.mockClear();
      await key('up');
      expect(visible(root, 'player/overlay')).toBe(true);
      expect(visible(root, EXTEND)).toBe(true);
      await advance(50);
      expect(lastFocusTarget()).toBe('player/timeline');
      await advance(60_000);
      expect(engine.props?.paused).toBe(true);
      await unmount(root);
    });

    it('announced once per warning: «Пауза через минуту. Ещё 15 минут — OK»', async () => {
      // The jest preset's AccessibilityInfo is already a mock: clear the calls of earlier tests.
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      const root = await beforeWarning();
      announce.mockClear();
      expect(announce).not.toHaveBeenCalled();
      await advance(1_000);
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Пауза через минуту. Ещё 15 минут — OK');
      await advance(20_000);
      expect(announce).toHaveBeenCalledTimes(1);
      // «Ещё 15 мин»: the next warning is announced once more.
      // Pressed at T−40 s: the new deadline is T+15 min, its warning at T+14 min.
      await press(root, EXTEND);
      await advance(15 * MIN - 20_000);
      expect(visible(root, EXTEND)).toBe(true);
      expect(announce).toHaveBeenCalledTimes(2);
      await unmount(root);
    });

    it('paused at T−61 s and resumed at T−50 s: the warning starts then (re-checked)', async () => {
      const root = await beforeWarning();
      await key('playPause');
      expect(engine.props?.paused).toBe(true);
      await advance(11_000);
      expect(visible(root, EXTEND)).toBe(false);
      focusMock.mockClear();
      await key('playPause');
      expect(engine.props?.paused).toBe(false);
      await advance(1_000);
      expect(visible(root, EXTEND)).toBe(true);
      expect(lastFocusTarget()).toBe(EXTEND);
      await unmount(root);
    });

    it('↑ on the timeline during the warning moves focus to «Ещё 15 мин» (no chapters)', async () => {
      const root = await beforeWarning();
      await advance(1_000);
      // Native focus lands on the button, then ↓ moves it to the timeline.
      await focusOn(root, EXTEND);
      await focusOn(root, 'player/timeline');
      focusMock.mockClear();
      await key('up');
      expect(lastFocusTarget()).toBe(EXTEND);
      await unmount(root);
    });

    describe('with chapters', () => {
      const SELF = 'https://boosty.to/synthetic-blog-1/posts/feed-post-0';
      const link = (caption: string, url: string) => ({ type: 'link', content: JSON.stringify([caption, 'unstyled', []]), url });
      const CHAPTERS = [
        okVideo('v1', MIXED, { duration: 1200 }),
        textBlock('Таймкоды:\n'),
        link('0:00', `${SELF}?t=0&tmid=v1`),
        textBlock(' Вступление\n'),
        link('3:45', `${SELF}?t=225&tmid=v1`),
        textBlock(' Разбор\n'),
        blockEnd(),
      ];

      it('↑ on the timeline during the warning → «Ещё 15 мин», not the chapter strip', async () => {
        const root = await beforeWarning(CHAPTERS, 1200);
        await advance(1_000);
        // Native focus lands on the button, then ↓ moves it to the timeline.
        await focusOn(root, EXTEND);
        await focusOn(root, 'player/timeline');
        expect(byTestId(root, 'player/mark/225').length).toBeGreaterThan(0);
        focusMock.mockClear();
        await key('up');
        expect(visible(root, 'player/chapters')).toBe(false);
        expect(lastFocusTarget()).toBe(EXTEND);
        await unmount(root);
      });

      it('the chapter strip open at T−60 s holds the warning back (no focus steal); after it closes the warning starts at the next check', async () => {
        const root = await beforeWarning(CHAPTERS, 1200);
        await key('up');
        await focusOn(root, 'player/timeline');
        // Past the strip's entry guard (focus came from «Настройки» earlier).
        await advance(400);
        await key('up');
        expect(visible(root, 'player/chapters')).toBe(true);
        focusMock.mockClear();
        await advance(1_000);
        expect(visible(root, EXTEND)).toBe(false);
        expect(lastFocusTarget()).not.toBe(EXTEND);
        await advance(10_000);
        expect(visible(root, EXTEND)).toBe(false);
        await key('down');
        expect(visible(root, 'player/chapters')).toBe(false);
        await advance(1_000);
        expect(visible(root, EXTEND)).toBe(true);
        await unmount(root);
      });
    });

    it('a deferred fire after the viewer paused (error screen): «Повторить» starts paused, no «Пауза по таймеру сна»', async () => {
      withData([okVideo('v1', MIXED)]);
      const root = await openPlayer();
      await ticks(0, 60);
      await pickSleep(root, 15);
      await key('playPause');
      expect(engine.props?.paused).toBe(true);
      await advance(15 * MIN - 70_000);
      await failPastRecovery();
      await advance(70_000);
      await press(root, RETRY);
      await fire('onLoad', { durationSec: 600 });
      await fire('onSeekDone', 60);
      expect(engine.props?.paused).toBe(true);
      await key('up');
      expect(visible(root, 'player/overlay')).toBe(true);
      expect(notice(root)).toBe(false);
      await unmount(root);
    });

    it('a deferred fire while held by the lifecycle (background on the error screen): no «Пауза по таймеру сна»', async () => {
      const lifecycle = mockAppState();
      withData([okVideo('v1', MIXED)]);
      const root = await openPlayer();
      await ticks(0, 60);
      await pickSleep(root, 15);
      await advance(15 * MIN - 70_000);
      await failPastRecovery();
      await lifecycle('background');
      await advance(70_000);
      await lifecycle('active');
      await press(root, RETRY);
      await fire('onLoad', { durationSec: 600 });
      await fire('onSeekDone', 60);
      expect(engine.props?.paused).toBe(true);
      await key('up');
      expect(visible(root, 'player/overlay')).toBe(true);
      expect(notice(root)).toBe(false);
      await unmount(root);
    });

    it('«До конца видео»: no warning; at the end hold «Пауза по таймеру сна» shows; replay → it goes', async () => {
      withData([okVideo('v1', MIXED)]);
      const root = await openPlayer();
      await ticks(0, 20);
      await pickSleep(root, 'end');
      await advance(6_000);
      await advance(30 * MIN);
      expect(visible(root, EXTEND)).toBe(false);
      await fire('onProgress', 599);
      await fire('onEnd');
      expect(notice(root)).toBe(true);
      await key('playPause');
      expect(engine.props?.paused).toBe(false);
      expect(notice(root)).toBe(false);
      await unmount(root);
    });

    it('a deferred fire (error screen): «Повторить» starts paused with «Пауза по таймеру сна»', async () => {
      withData([okVideo('v1', MIXED)]);
      const root = await openPlayer();
      await ticks(0, 60);
      await pickSleep(root, 15);
      await advance(6_000);
      await advance(15 * MIN - 6_000 - 70_000);
      await failPastRecovery();
      await advance(70_000);
      await press(root, RETRY);
      await fire('onLoad', { durationSec: 600 });
      await fire('onSeekDone', 60);
      expect(engine.props?.paused).toBe(true);
      await key('up');
      expect(notice(root)).toBe(true);
      await unmount(root);
    });
  });

  describe('live (Story 7.2)', () => {
    const LIVE_BLOG = 'synthetic-blog-1';

    beforeEach(() => {
      handlers.e15 = () => ({ status: 200, body: e15LiveFixture.body });
    });

    async function openLive(): Promise<Root> {
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
      await fire('onLoad', { durationSec: 0 });
      await fire('onBuffering', false);
      await advance(600);
      return root;
    }

    it('matrix «Live»: one quality → the gear shows; the sheet has «Таймер сна» only, no «До конца видео»; fire → a plain pause, no E9', async () => {
      const root = await openLive();
      await key('up');
      expect(visible(root, SETTINGS)).toBe(true);
      await focusOn(root, SETTINGS);
      focusMock.mockClear();
      await press(root, SETTINGS);
      await advance(50);
      expect(byTestId(root, 'modal/content')[0].queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
        SLEEP,
      ]);
      expect(lastFocusTarget()).toBe(SLEEP);
      focusMock.mockClear();
      await press(root, SLEEP);
      await advance(50);
      expect(menuRows(root)).toEqual(['off', '15', '30', '60', '90'].map(S));
      await press(root, S(15));
      expect(visible(root, SHEET)).toBe(false);
      expect(lastFocusTarget()).toBe(SETTINGS);
      expect(indicator(root)).toContain('Таймер сна · 15:00');
      await advance(15 * MIN);
      expect(engine.props?.paused).toBe(true);
      expect(visible(root, 'player/overlay')).toBe(true);
      expect(indicator(root)).toBeNull();
      expect(e9Sent()).toEqual([]);
      await unmount(root);
    });
  });
});
