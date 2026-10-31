/**
 * Story 4.2 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: progress and resume (local entries, E9 server
 * timecodes, the resume choice, throttled writes). Split from
 * playerFlow.test.tsx (Epic 8 retro A4); the shared setup is
 * `src/test/playerFlowHarness`. The PlayerEngine port is mocked: these tests
 * prove what the player asks of the engine, not native playback.
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { act } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { navigationRef } from '../src/app/App';
import { queryClient } from '../src/app/queryClient';
import { queryKeys } from '../src/shared/api';
import { logger } from '../src/shared/services/logger';
import { progressStore } from '../src/shared/services/progress';
import { engine } from '../src/test/playerEngineMock';
import { paragraph } from '../src/test/postFixtures';
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
  PRIMARY,
  VIDEO,
  SURFACE,
  TIMELINE,
  PLAYPAUSE,
  RETRY,
  E9_RE,
  okVideo,
  ALL,
  withData,
  currentRoute,
  e8Calls,
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

describe('progress and resume (Story 4.2)', () => {
  const RESTART = `post/${POST}/restart`;
  const REF1 = { blogUrl: FEED_BLOG, postId: POST, mediaId: 'v1' };
  const META = { title: 'Title v1', postTitle: `Title of ${POST}`, authorName: 'redacted', previewUrl: null, durationSec: 600 };
  const e9Calls = () => handlers.transport.calls.filter(c => c.method === 'PUT' && E9_RE.test(c.path));
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
    handlers.e9 = () => ({ network: true });
    const root = await openPlayer();
    await ticks(0, 10);
    expect(e9Sent()).toEqual(['v1@10']);
    handlers.e9 = () => ({ status: 200 });
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
    handlers.e9 = () => ({ network: true });
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
