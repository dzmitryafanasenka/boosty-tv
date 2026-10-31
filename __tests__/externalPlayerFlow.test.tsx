/**
 * Story 8.2 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: the system video player hand-off and its setting
 * (PLAY-13, SET-02). Split from playerFlow.test.tsx (Epic 8 retro A4); the
 * shared setup is `src/test/playerFlowHarness`. The PlayerEngine port and
 * the hand-off are mocked: these tests prove what the app asks for, not the
 * external app on the device.
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { StackActions } from '@react-navigation/native';
import App, { navigationRef } from '../src/app/App';
import { phaseFlags } from '../src/app/phaseFlags';
import { accountScope } from '../src/shared/account';
import { t as translate } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { progressStore } from '../src/shared/services/progress';
import {
  EXTERNAL_PLAYER_PREFERENCE_KEY,
  QUALITY_PREFERENCE_KEY,
  externalPlayerPreference,
  qualityPreference,
} from '../src/features/player';
import { EXTERNAL_LAUNCH_DELAY_MS } from '../src/features/player/ExternalHandoff';
import { colors } from '../src/shared/ui';
import { engine } from '../src/test/playerEngineMock';
import e15LiveFixture from '../src/test/fixtures/boosty/e15-video-stream-live.json';
import { e8MissingReply, paragraph, postDetail } from '../src/test/postFixtures';
import {
  byTestId,
  clearNativeModules,
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
  FEED_BLOG,
  POST,
  FEED_CARD,
  VIDEO,
  TIMELINE,
  URL,
  E9_RE,
  okVideo,
  withData,
  currentRoute,
  e8Calls,
  playerText,
  fire,
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

describe('Story 8.2: the system video player (PLAY-13, SET-02)', () => {
  const ROW = 'settings/row/external-player';
  const VERSION = 'settings/row/version';
  const SHEET = 'player/external/sheet';
  const LOADING = 'player/external/surface';
  const Q = (quality: string | number) => `player/external/quality/${quality}`;
  const MIXED = [
    { type: 'hls', url: `${URL}-hls` },
    { type: 'high', url: `${URL}-720` },
    { type: 'low', url: `${URL}-360` },
  ];
  const device = () => createAsyncStorage('boostytv-device');
  const e9Sent = () => handlers.transport.calls.filter(c => c.method === 'PUT' && E9_RE.test(c.path));
  let prepare: jest.Mock;
  let launch: jest.Mock;
  const sheetRows = (root: Root) =>
    byTestId(root, SHEET)[0]
      .queryAll(n => n.props.focusable === true)
      .map(n => n.props.testID as string);
  const valueText = (root: Root) => byTestId(root, `${ROW}/value`)[0].props.children as string;

  beforeEach(() => {
    prepare = jest.fn().mockResolvedValue('ready');
    launch = jest.fn().mockResolvedValue('opened');
    installNativeModules({ ExternalPlayer: { prepare, launch } });
  });

  /** The toggle is on (stored), then Пост → OK on v1 → the hand-off list. */
  async function openHandoff(sources: unknown[] = MIXED): Promise<Root> {
    await device().setItem(EXTERNAL_PLAYER_PREFERENCE_KEY, 'on');
    externalPlayerPreference.forget();
    withData([okVideo('v1', sources), ...paragraph('Body')]);
    const root = await openPost();
    focusMock.mockClear();
    await press(root, VIDEO('v1'));
    expect(currentRoute()).toBe('Player');
    await advance(50);
    return root;
  }

  describe('Настройки toggle', () => {
    it('matrix «Toggle»: the first row, «Выкл» by default with the description; OK flips «Вкл» at once (accent, checked) and stores it; OK again → «Выкл»', async () => {
      const root = await render(<App />);
      await press(root, 'nav/settings');
      expect(lastFocusTarget()).toBe(VERSION);
      const ids = byTestId(root, 'settings')[0]
        .queryAll(n => n.props.focusable === true)
        .map(n => n.props.testID as string);
      expect(ids.slice(0, 2)).toEqual([ROW, VERSION]);
      expect(valueText(root)).toBe('Выкл');
      expect(one(root, ROW).props.accessibilityRole).toBe('switch');
      expect(one(root, ROW).props.accessibilityState).toMatchObject({ checked: false });
      const description = byTestId(root, `${ROW}/description`)[0].props.children as string;
      expect(description).toBe(translate('settings.externalPlayer.description'));
      expect(description).toContain('Прогресс просмотра в этом режиме не сохраняется');
      expect(one(root, ROW).props.accessibilityLabel).toBe(
        `Системный видеоплеер Выкл ${translate('settings.externalPlayer.description')}`,
      );
      await press(root, ROW);
      expect(valueText(root)).toBe('Вкл');
      expect(StyleSheet.flatten(byTestId(root, `${ROW}/value`)[0].props.style).color).toBe(colors.accent);
      expect(one(root, ROW).props.accessibilityState).toMatchObject({ checked: true });
      expect(await device().getItem(EXTERNAL_PLAYER_PREFERENCE_KEY)).toBe('on');
      await press(root, ROW);
      expect(valueText(root)).toBe('Выкл');
      expect(await device().getItem(EXTERNAL_PLAYER_PREFERENCE_KEY)).toBe('off');
      await unmount(root);
    });

    it('a stored `on` reads «Вкл» after a restart; an account reset (sign-out) keeps it (device scope)', async () => {
      await device().setItem(EXTERNAL_PLAYER_PREFERENCE_KEY, 'on');
      const root = await render(<App />);
      await press(root, 'nav/settings');
      expect(valueText(root)).toBe('Вкл');
      await unmount(root);
      await act(async () => {
        await accountScope.reset();
      });
      expect(await device().getItem(EXTERNAL_PLAYER_PREFERENCE_KEY)).toBe('on');
      expect(externalPlayerPreference.peek()).toBe(true);
    });

    it('the `externalPlayer` phase flag off: no row, the value never read', async () => {
      const flag = jest.replaceProperty(phaseFlags, 'externalPlayer', false as never);
      try {
        const read = jest.spyOn(externalPlayerPreference, 'read');
        const root = await render(<App />);
        await press(root, 'nav/settings');
        expect(visible(root, ROW)).toBe(false);
        expect(lastFocusTarget()).toBe(VERSION);
        expect(read).not.toHaveBeenCalled();
        await unmount(root);
      } finally {
        flag.restore();
      }
    });
  });

  describe('hand-off', () => {
    it('matrix «Hand-off»: loading, then the «Качество» list (focus on the preferred quality); OK opens the chooser with that URL and the title; the route exits to the origin; no engine, no progress, no E9', async () => {
      await device().setItem(QUALITY_PREFERENCE_KEY, '720');
      const pending = deferred();
      await device().setItem(EXTERNAL_PLAYER_PREFERENCE_KEY, 'on');
      // The app warms the value at startup (off before this test stored it).
      externalPlayerPreference.forget();
      withData([okVideo('v1', MIXED), ...paragraph('Body')]);
      const root = await openPost();
      handlers.e8 = () => pending.promise;
      focusMock.mockClear();
      await press(root, VIDEO('v1'));
      expect(currentRoute()).toBe('Player');
      expect(visible(root, LOADING)).toBe(true);
      expect(visible(root, SHEET)).toBe(false);
      expect(lastFocusTarget()).toBe(LOADING);
      pending.resolve({ status: 200, body: postDetail(FEED_BLOG, POST, [okVideo('v1', MIXED), ...paragraph('Body')]) });
      await settle();
      await advance(50);
      expect(visible(root, SHEET)).toBe(true);
      expect(text(byTestId(root, SHEET)[0])).toContain('Качество');
      // Only the list's rows are focusable on the route (the loading surface is gone).
      expect(
        byTestId(root, 'player')[0]
          .queryAll(n => n.props.focusable === true)
          .map(n => n.props.testID),
      ).toEqual([Q('auto'), Q(720), Q(360)]);
      expect(sheetRows(root).map(id => one(root, id).props.accessibilityLabel)).toEqual(['Авто', '720p', '360p']);
      expect(one(root, Q(720)).props.accessibilityState).toMatchObject({ selected: true });
      expect(lastFocusTarget()).toBe(Q(720));
      focusMock.mockClear();
      await press(root, Q(360));
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(prepare).toHaveBeenCalledWith(`${URL}-360`, expect.any(String), 'Открыть в');
      expect(prepare.mock.calls[0][1]).not.toBe('');
      // The route pops first and the origin gets its focus back; the player
      // starts only after that (Story 8.2 device run: a restoration sent
      // while the external activity covered the app was lost).
      expect(currentRoute()).toBe('Post');
      expect(lastFocusTarget()).toBe(VIDEO('v1'));
      expect(launch).not.toHaveBeenCalled();
      let focusAtLaunch: string | undefined;
      launch.mockImplementation(async () => {
        focusAtLaunch = lastFocusTarget();
        return 'opened';
      });
      await advance(EXTERNAL_LAUNCH_DELAY_MS);
      expect(launch).toHaveBeenCalledTimes(1);
      expect(focusAtLaunch).toBe(VIDEO('v1'));
      expect(engine.mounts).toBe(0);
      await advance(60_000);
      expect(e9Sent()).toHaveLength(0);
      expect(progressStore.get('v1')).toBeUndefined();
      // The pick is not the stored (or this run's) preference.
      expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBe('720');
      expect(qualityPreference.peek()).toBe(720);
      // Outcome only: no URL in any log entry.
      const entries = logger.entries();
      expect(entries.filter(e => e.message === 'external player hand-off').map(e => e.fields)).toEqual([
        { outcome: 'opened' },
      ]);
      expect(JSON.stringify(entries)).not.toContain('example.invalid');
      // Nor in the route params.
      expect(JSON.stringify(navigationRef.getRootState())).not.toContain('example.invalid');
      await unmount(root);
    });

    it('no stored quality: focus on «Авто» (the default order picks HLS); OK hands the HLS URL over', async () => {
      const root = await openHandoff();
      expect(lastFocusTarget()).toBe(Q('auto'));
      await press(root, Q('auto'));
      expect(prepare).toHaveBeenCalledWith(`${URL}-hls`, expect.any(String), 'Открыть в');
      expect(currentRoute()).toBe('Post');
      await unmount(root);
    });

    it('a resume point or a timestamp start is not passed (owner decision 2026-10-31): only the URL, the title and the chooser title', async () => {
      const root = await openHandoff();
      await press(root, Q(720));
      expect(prepare.mock.calls[0]).toHaveLength(3);
      await unmount(root);
    });

    it('matrix «Back in list»: Back exits to the origin; nothing is launched or written', async () => {
      const root = await openHandoff();
      expect(visible(root, SHEET)).toBe(true);
      focusMock.mockClear();
      await back();
      expect(currentRoute()).toBe('Post');
      expect(lastFocusTarget()).toBe(VIDEO('v1'));
      expect(prepare).not.toHaveBeenCalled();
      expect(engine.mounts).toBe(0);
      await advance(60_000);
      expect(e9Sent()).toHaveLength(0);
      expect(progressStore.get('v1')).toBeUndefined();
      await unmount(root);
    });

    it.each([
      ['the module answers `none` (only this app or the TV stub)', () => jest.fn().mockResolvedValue('none')],
      ['the launch throws', () => jest.fn().mockRejectedValue(new Error(`ActivityNotFoundException ${URL}-720`))],
    ])('matrix «No player» (%s): the built-in player at the picked quality with «Внешний плеер не найден»; progress as usual; the stored quality unchanged', async (_name, make) => {
      prepare = make();
      installNativeModules({ ExternalPlayer: { prepare, launch } });
      const root = await openHandoff();
      const e8Before = e8Calls().length;
      await press(root, Q(720));
      await settle();
      expect(currentRoute()).toBe('Player');
      // PlayerScreen resolves E8 again (fresh signed URLs).
      expect(e8Calls()).toHaveLength(e8Before + 1);
      expect(engine.props?.source).toEqual({ uri: `${URL}-720`, format: 'progressive' });
      // The overlay shows once at the start, so the hint is read; then the usual auto-hide.
      expect(visible(root, 'player/overlay')).toBe(true);
      expect(lastFocusTarget()).toBe(TIMELINE);
      await fire('onLoad', { durationSec: 600 });
      await fire('onBuffering', false);
      await advance(600);
      expect(visible(root, 'player/overlay')).toBe(true);
      expect(byTestId(root, 'player/notice')[0].props.children).toBe('Внешний плеер не найден');
      for (let sec = 0; sec <= 40; sec += 1) {
        await fire('onProgress', sec);
      }
      expect(e9Sent().length).toBeGreaterThan(0);
      expect(progressStore.get('v1')).toBeDefined();
      expect(await device().getItem(QUALITY_PREFERENCE_KEY)).toBeNull();
      expect(logger.entries().filter(e => e.message === 'external player hand-off').map(e => e.fields)).toEqual([
        { outcome: 'none' },
      ]);
      expect(JSON.stringify(logger.entries())).not.toContain('example.invalid');
      await unmount(root);
    });

    it('Back while the launch is in flight is ignored (the outcome decides): `none` then mounts the fallback with «Внешний плеер не найден»', async () => {
      const preparing = deferred<string>();
      prepare = jest.fn(() => preparing.promise);
      installNativeModules({ ExternalPlayer: { prepare, launch } });
      const root = await openHandoff();
      await press(root, Q(720));
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(visible(root, LOADING)).toBe(true);
      await back();
      expect(currentRoute()).toBe('Player');
      expect(engine.mounts).toBe(0);
      preparing.resolve('none');
      await settle();
      expect(currentRoute()).toBe('Player');
      expect(engine.props?.source).toEqual({ uri: `${URL}-720`, format: 'progressive' });
      expect(byTestId(root, 'player/notice')[0].props.children).toBe('Внешний плеер не найден');
      await unmount(root);
    });

    it('Back while the fresh E8 is pending pops to the origin; nothing is launched', async () => {
      const pending = deferred();
      await device().setItem(EXTERNAL_PLAYER_PREFERENCE_KEY, 'on');
      const root = await openPost();
      handlers.e8 = () => pending.promise;
      focusMock.mockClear();
      await press(root, VIDEO('v1'));
      await advance(50);
      expect(visible(root, LOADING)).toBe(true);
      await back();
      expect(currentRoute()).toBe('Post');
      expect(lastFocusTarget()).toBe(VIDEO('v1'));
      pending.resolve({ status: 200, body: postDetail(FEED_BLOG, POST, [okVideo('v1', MIXED), ...paragraph('Body')]) });
      await settle();
      expect(prepare).not.toHaveBeenCalled();
      expect(currentRoute()).toBe('Post');
      await unmount(root);
    });

    it('a launch that fails after the pop is only logged (outcome, no URL); the origin keeps focus, no fallback, no retry', async () => {
      launch.mockResolvedValue('none');
      const root = await openHandoff();
      await press(root, Q(720));
      expect(currentRoute()).toBe('Post');
      await advance(EXTERNAL_LAUNCH_DELAY_MS);
      await settle();
      expect(launch).toHaveBeenCalledTimes(1);
      expect(currentRoute()).toBe('Post');
      expect(engine.mounts).toBe(0);
      const messages = logger.entries().map(e => e.message);
      expect(messages).toContain('external player launch failed');
      expect(JSON.stringify(logger.entries())).not.toContain('example.invalid');
      await unmount(root);
    });

    it('no native module (another platform, tests): the same fallback', async () => {
      clearNativeModules();
      installNativeModules({ AppInfo: { versionName: '1.0' } });
      const root = await openHandoff();
      await press(root, Q('auto'));
      expect(currentRoute()).toBe('Player');
      expect(engine.props?.source.format).toBe('hls');
      await unmount(root);
    });

    it('matrix «Not ready»: E8 404 → PlayerScreen owns the state («Видео недоступно»); nothing launched', async () => {
      await device().setItem(EXTERNAL_PLAYER_PREFERENCE_KEY, 'on');
      const root = await openPost();
      handlers.e8 = () => e8MissingReply();
      await press(root, VIDEO('v1'));
      await advance(50);
      expect(currentRoute()).toBe('Player');
      expect(visible(root, SHEET)).toBe(false);
      expect(playerText(root)).toContain('Видео недоступно');
      expect(prepare).not.toHaveBeenCalled();
      await unmount(root);
    });

    it('matrix «Toggle off»: the built-in player as today (no list)', async () => {
      await device().setItem(EXTERNAL_PLAYER_PREFERENCE_KEY, 'off');
      withData([okVideo('v1', MIXED), ...paragraph('Body')]);
      const root = await openPlayer();
      expect(visible(root, SHEET)).toBe(false);
      expect(engine.props?.source.format).toBe('hls');
      expect(visible(root, 'player/notice')).toBe(false);
      expect(prepare).not.toHaveBeenCalled();
      await unmount(root);
    });

    it('matrix «Flag off»: a stored `on` is ignored, the value never read; the built-in player', async () => {
      const flag = jest.replaceProperty(phaseFlags, 'externalPlayer', false as never);
      try {
        await device().setItem(EXTERNAL_PLAYER_PREFERENCE_KEY, 'on');
        const read = jest.spyOn(externalPlayerPreference, 'read');
        withData([okVideo('v1', MIXED), ...paragraph('Body')]);
        const root = await openPlayer();
        expect(visible(root, SHEET)).toBe(false);
        expect(engine.props?.source.format).toBe('hls');
        expect(read).not.toHaveBeenCalled();
        expect(prepare).not.toHaveBeenCalled();
        await unmount(root);
      } finally {
        flag.restore();
      }
    });

    it('matrix «Live»: the toggle on → a live stream plays in the built-in player', async () => {
      await device().setItem(EXTERNAL_PLAYER_PREFERENCE_KEY, 'on');
      handlers.e15 = () => ({ status: 200, body: e15LiveFixture.body });
      const root = await render(<App />);
      await focusOn(root, FEED_CARD);
      const routeKey = navigationRef.getCurrentRoute()?.key ?? '';
      await act(async () => {
        navigationRef.dispatch(
          StackActions.push('Player', {
            ref: { kind: 'live', blogUrl: FEED_BLOG },
            origin: { routeKey, focusId: `author/${FEED_BLOG}/live` },
          }),
        );
      });
      await settle();
      expect(currentRoute()).toBe('Player');
      expect(visible(root, SHEET)).toBe(false);
      expect(engine.mounts).toBe(1);
      expect(prepare).not.toHaveBeenCalled();
      await unmount(root);
    });
  });
});
