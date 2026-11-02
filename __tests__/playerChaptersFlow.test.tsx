/**
 * Story 10.1 (our improvement, owner decisions 2026-11-02) through the real
 * App: a post with «Таймкоды» links → the built-in player shows a mark per
 * chapter and the current chapter's name; ↑ on the focused timeline opens
 * the chapter strip (← → native, OK seeks and closes, Back / ↓ close
 * without a seek, no auto-hide while open); media Next / Previous jump
 * between chapters. A video without timestamps keeps the 1.0.0 behaviour.
 * The PlayerEngine port and native focus are mocked (src/test/flow): these
 * tests prove what the player asks of the engine and which element it asks
 * to focus, not native focus movement or decoding (device checks,
 * docs/testing.md «Story 10.1»).
 */
import { act } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { byTestId, installNativeModules, lastFocusTarget, text, unmount, visible } from '../src/test/flow';
import { engine } from '../src/test/playerEngineMock';
import { blockEnd, text as textBlock } from '../src/test/postFixtures';
import {
  ALL,
  E9_RE,
  FEED_BLOG,
  PLAYPAUSE,
  POST,
  SETTINGS,
  SURFACE,
  TIMELINE,
  VIDEO,
  advance,
  back,
  fire,
  focusMock,
  focusOn,
  key,
  okVideo,
  one,
  openPlayer,
  press,
  settle,
  setupPlayerFlowHarness,
  withData,
  type Root,
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

const SELF = `https://boosty.to/${FEED_BLOG}/posts/${POST}`;
const link = (s: string, url: string) => ({ type: 'link', content: JSON.stringify([s, 'unstyled', []]), url });
const ts = (sec: number, tmid = 'v1') => link(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, `${SELF}?t=${sec}&tmid=${tmid}`);
const STRIP = 'player/chapters';
const ITEM = (sec: number) => `player/chapters/${sec}`;
const marks = (root: Root) =>
  root.container
    .queryAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith('player/mark/'))
    .map(n => n.props.testID as string)
    .filter((id, i, all) => all.indexOf(id) === i);
const chapterName = (root: Root) => {
  const node = byTestId(root, 'player/chapter')[0];
  return node ? text(node) : null;
};
const e9Bodies = () =>
  handlers.transport.calls.filter(c => c.method === 'PUT' && E9_RE.test(c.path)).map(c => c.body);

/** The matrix «Happy path» post: three chapters of v1 (and one of v2), duration 20:00. */
const DATA = [
  okVideo('v1', ALL, { duration: 1200 }),
  okVideo('v2', ALL, { title: '' }),
  textBlock('Таймкоды:\n'),
  ts(0),
  textBlock(' Вступление\n'),
  ts(225),
  textBlock(' — Разбор\n'),
  ts(730),
  textBlock(' Итоги\n'),
  ts(100, 'v2'),
  textBlock(' Другое видео\n'),
  link('99:00', `${SELF}?t=5940&tmid=v1`),
  textBlock(' За концом'),
  blockEnd(),
];

/** The player on v1 (duration 1200), at `sec`, the overlay shown and the timeline focused. */
async function onTimeline(sec = 300): Promise<Root> {
  withData(DATA);
  const root = await openPlayer(VIDEO('v1'), { load: false });
  await focusOn(root, SURFACE);
  await fire('onLoad', { durationSec: 1200 });
  await fire('onBuffering', false);
  await advance(600);
  await fire('onProgress', sec);
  await key('up');
  expect(visible(root, 'player/overlay')).toBe(true);
  expect(lastFocusTarget()).toBe(TIMELINE);
  await focusOn(root, TIMELINE);
  return root;
}

describe('Story 10.1: chapter marks and the name', () => {
  it('matrix «Happy path» / «Two videos» / «Out of range»: a mark per v1 chapter inside the duration (none at 0); at 5:00 «Разбор»', async () => {
    const root = await onTimeline(300);
    expect(marks(root)).toEqual(['player/mark/225', 'player/mark/730']);
    expect(chapterName(root)).toContain('Разбор');
    expect(one(root, TIMELINE).props.accessibilityLabel).toBe('Позиция 5:00 из 20:00. Глава: Разбор');
    await unmount(root);
  });

  it('matrix «Duration unknown»: no marks and no name before the engine reports the duration', async () => {
    withData(DATA);
    const root = await openPlayer(VIDEO('v1'), { load: false });
    await focusOn(root, SURFACE);
    await advance(600);
    await key('up');
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(marks(root)).toEqual([]);
    expect(visible(root, 'player/chapter')).toBe(false);
    await fire('onLoad', { durationSec: 1200 });
    expect(marks(root)).toEqual(['player/mark/225', 'player/mark/730']);
    await unmount(root);
  });

  it('a D-pad scrub: the name follows the pending target; the commit is a normal seek', async () => {
    const root = await onTimeline(220);
    expect(chapterName(root)).toContain('Вступление');
    await key('right');
    expect(chapterName(root)).toContain('Разбор');
    // The elapsed time is still the position until the seek lands.
    expect(text(byTestId(root, 'player/elapsed')[0])).toContain('3:40');
    await advance(600);
    expect(engine.seek).toHaveBeenLastCalledWith(225);
    await unmount(root);
  });

  it('a video without timestamps: no marks, no name, ↑ twice opens nothing; Next is a 5 s step as before', async () => {
    withData([okVideo('v1', ALL), textBlock('Без таймкодов'), blockEnd()]);
    const root = await openPlayer();
    await fire('onProgress', 200);
    await key('up');
    await focusOn(root, TIMELINE);
    await key('up');
    expect(marks(root)).toEqual([]);
    expect(visible(root, 'player/chapter')).toBe(false);
    expect(visible(root, STRIP)).toBe(false);
    await key('next');
    await advance(600);
    expect(engine.seek).toHaveBeenLastCalledWith(205);
    await unmount(root);
  });

  it('another video of the post (v2) shows only its own chapter', async () => {
    withData(DATA);
    const root = await openPlayer(VIDEO('v2'), { load: false });
    await focusOn(root, SURFACE);
    await fire('onLoad', { durationSec: 600 });
    await advance(600);
    await fire('onProgress', 150);
    await key('up');
    expect(marks(root)).toEqual(['player/mark/100']);
    expect(chapterName(root)).toContain('Другое видео');
    await unmount(root);
  });
});

describe('Story 10.1: the chapter strip (owner decision 2026-11-02)', () => {
  it('AC 1: ↑ on the focused timeline opens the strip on the current chapter; → then OK seeks to the next chapter, closes the strip, the name updates', async () => {
    const root = await onTimeline(300);
    focusMock.mockClear();
    await key('up');
    expect(visible(root, STRIP)).toBe(true);
    expect(lastFocusTarget()).toBe(ITEM(225));
    const items = byTestId(root, STRIP)[0]
      .queryAll(n => n.props.focusable === true)
      .map(n => n.props.testID as string);
    expect(items).toEqual([ITEM(0), ITEM(225), ITEM(730)]);
    expect(one(root, ITEM(225)).props.accessibilityLabel).toBe('3:45. Разбор');
    // Nothing else in the overlay is focusable behind the strip in its trapped directions.
    const guide = byTestId(root, STRIP)[0];
    expect(guide.props).toMatchObject({ trapFocusUp: true, trapFocusDown: true, trapFocusLeft: true, trapFocusRight: true });
    await focusOn(root, ITEM(225));
    // → moves focus natively (here: the focus event); the key itself never seeks.
    await key('right');
    await focusOn(root, ITEM(730));
    await advance(700);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(visible(root, 'player/bubble')).toBe(false);
    focusMock.mockClear();
    await press(root, ITEM(730));
    expect(engine.seek).toHaveBeenCalledTimes(1);
    expect(engine.seek).toHaveBeenCalledWith(730);
    expect(visible(root, STRIP)).toBe(false);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(lastFocusTarget()).toBe(TIMELINE);
    await fire('onSeekDone', 730);
    await fire('onProgress', 731);
    expect(chapterName(root)).toContain('Итоги');
    await unmount(root);
  });

  it('before the first chapter the first chapter is selected', async () => {
    withData([okVideo('v1', ALL), ts(60), textBlock(' A\n'), ts(120), textBlock(' B'), blockEnd()]);
    const root = await openPlayer();
    await fire('onProgress', 10);
    await key('up');
    await focusOn(root, TIMELINE);
    await key('up');
    expect(lastFocusTarget()).toBe(ITEM(60));
    expect(visible(root, 'player/chapter')).toBe(false);
    await unmount(root);
  });

  it('matrix «Strip and Back»: Back closes the strip, the overlay stays on the timeline, no seek; the next Back hides the overlay', async () => {
    const root = await onTimeline(300);
    await key('up');
    await focusOn(root, ITEM(225));
    focusMock.mockClear();
    await back();
    expect(visible(root, STRIP)).toBe(false);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(lastFocusTarget()).toBe(TIMELINE);
    expect(engine.seek).not.toHaveBeenCalled();
    await focusOn(root, TIMELINE);
    await back();
    expect(visible(root, 'player/overlay')).toBe(false);
    await unmount(root);
  });

  it('↓ closes the strip without a seek; ↑ inside it does nothing', async () => {
    const root = await onTimeline(300);
    await key('up');
    await focusOn(root, ITEM(225));
    await key('up');
    expect(visible(root, STRIP)).toBe(true);
    focusMock.mockClear();
    await key('down');
    expect(visible(root, STRIP)).toBe(false);
    expect(lastFocusTarget()).toBe(TIMELINE);
    expect(engine.seek).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('while the strip is open the overlay does not auto-hide', async () => {
    const root = await onTimeline(300);
    await key('up');
    await focusOn(root, ITEM(225));
    await advance(20_000);
    expect(visible(root, STRIP)).toBe(true);
    expect(visible(root, 'player/overlay')).toBe(true);
    await back();
    await focusOn(root, TIMELINE);
    await advance(5_000);
    expect(visible(root, 'player/overlay')).toBe(false);
    await unmount(root);
  });

  it('the ↑ that moves focus from the controls up to the timeline does not open the strip; the next ↑ does', async () => {
    const root = await onTimeline(300);
    await focusOn(root, PLAYPAUSE);
    // Native focus moved on key down; the key up arrives after the timeline's onFocus.
    await focusOn(root, TIMELINE);
    await key('up');
    expect(visible(root, STRIP)).toBe(false);
    await advance(400);
    await key('up');
    expect(visible(root, STRIP)).toBe(true);
    await unmount(root);
  });

  it('Menu closes the strip and opens the settings sheet', async () => {
    const root = await onTimeline(300);
    await key('up');
    await focusOn(root, ITEM(225));
    await key('menu');
    expect(visible(root, STRIP)).toBe(false);
    expect(visible(root, 'player/sheet')).toBe(true);
    expect(visible(root, SETTINGS)).toBe(true);
    await unmount(root);
  });

  it('a hold-scrub then the strip: Back closes the strip first, then cancels the held target', async () => {
    installNativeModules({ SeekKeys: { setEnabled: jest.fn() } });
    const root = await onTimeline(300);
    const native = async (action: 'down' | 'up', repeat = 0) => {
      await act(async () => {
        DeviceEventEmitter.emit('seekKey', { key: 'right', action, repeat });
      });
      await settle();
    };
    await native('down', 0);
    for (let i = 1; i <= 4; i += 1) {
      await advance(50);
      await native('down', i);
    }
    await native('up');
    await key('right'); // React Native's key up of the same press: swallowed
    expect(visible(root, 'player/bubble')).toBe(true);
    await key('up');
    expect(visible(root, STRIP)).toBe(true);
    // In the strip the native ← → never seek or extend the held target.
    const held = text(byTestId(root, 'player/bubble/time')[0]);
    await native('down', 0);
    await native('up');
    expect(text(byTestId(root, 'player/bubble/time')[0])).toBe(held);
    await back();
    expect(visible(root, STRIP)).toBe(false);
    expect(visible(root, 'player/bubble')).toBe(true);
    await back();
    expect(visible(root, 'player/bubble')).toBe(false);
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(engine.seek).not.toHaveBeenCalled();
    await unmount(root);
  });
});

describe('Story 10.1: the strip with the native seek keys and the lifecycle', () => {
  it('strip open, no held target: a native → down/up never seeks and shows no bubble', async () => {
    installNativeModules({ SeekKeys: { setEnabled: jest.fn() } });
    const root = await onTimeline(300);
    await key('up');
    await focusOn(root, ITEM(225));
    await act(async () => {
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'down', repeat: 0 });
      DeviceEventEmitter.emit('seekKey', { key: 'right', action: 'up', repeat: 0 });
    });
    await settle();
    await advance(700);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(visible(root, 'player/bubble')).toBe(false);
    expect(visible(root, STRIP)).toBe(true);
    await unmount(root);
  });

  it('strip open, background then foreground (Story 4.6): the overlay shows, the strip is gone, focus on the timeline', async () => {
    let appState: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
      appState.push(listener);
      return {
        remove: () => {
          appState = appState.filter(h => h !== listener);
        },
      };
    }) as unknown as typeof AppState.addEventListener);
    const lifecycle = async (state: string) => {
      await act(async () => {
        for (const h of [...appState]) {
          h(state);
        }
      });
      await settle();
    };
    const root = await onTimeline(300);
    await key('up');
    await focusOn(root, ITEM(225));
    expect(visible(root, STRIP)).toBe(true);
    await lifecycle('background');
    focusMock.mockClear();
    await lifecycle('active');
    expect(visible(root, 'player/overlay')).toBe(true);
    expect(visible(root, STRIP)).toBe(false);
    expect(lastFocusTarget()).toBe(TIMELINE);
    await unmount(root);
  });
});

describe('Story 10.1: media Next / Previous jump between chapters', () => {
  it('Next → the next chapter (quick presses walk them), one commit; Previous follows the YouTube rule; past the ends nothing', async () => {
    const root = await onTimeline(300);
    await key('next');
    await advance(600);
    expect(engine.seek).toHaveBeenLastCalledWith(730);
    await fire('onSeekDone', 730);
    await fire('onProgress', 740);
    // More than 3 s into «Итоги»: Previous → its own start.
    await key('previous');
    await advance(600);
    expect(engine.seek).toHaveBeenLastCalledWith(730);
    await fire('onSeekDone', 730);
    await fire('onProgress', 731);
    // Within 3 s: the previous chapter; a quick second press builds on the pending target.
    await key('previous');
    await key('previous');
    await advance(600);
    expect(engine.seek).toHaveBeenLastCalledWith(0);
    await fire('onSeekDone', 0);
    await fire('onProgress', 1);
    const calls = engine.seek.mock.calls.length;
    await key('previous');
    await advance(600);
    expect(engine.seek.mock.calls.length).toBe(calls);
    await unmount(root);
  });

  it('progress follows the usual rules after a jump (the exit write has the new position)', async () => {
    const root = await onTimeline(300);
    await key('next');
    await advance(600);
    await fire('onSeekDone', 730);
    for (let sec = 730; sec <= 745; sec += 1) {
      await fire('onProgress', sec);
    }
    await back(); // hides the overlay
    await back(); // exits
    await advance(1_000);
    expect(e9Bodies().at(-1)).toBe('time_code=745');
    await unmount(root);
  });
});
