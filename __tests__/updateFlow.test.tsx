/**
 * Story 9.2 through the real App with a stored session: the update check of
 * GitHub Releases on start (≤ 1 per day), the passive plaque (never
 * focusable, gone after about 10 s), «Версия» with the known release
 * («0.9.0 · доступна 0.9.1»), OK opening the update dialog and Back
 * returning focus to «Версия», the manual check on a single OK (≤ 1 per
 * 60 s, the seven-press gesture at most one request), the flag off and the
 * request's headers. The keychain, BackHandler, the native focus command
 * and the AppUpdater module are faked: these tests prove what the app asks
 * for, not native focus, the download or the installer on the device.
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { act } from 'react';
import { AppState, NativeModules } from 'react-native';
import { type Root } from 'test-renderer';
import App, { navigationRef } from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
import { updateChecker, updateStore } from '../src/app/update';
import {
  AUTO_INTERVAL_MS,
  UPDATE_CANCEL_ID,
  UPDATE_CLOSE_ID,
  UPDATE_INSTALL_ID,
  UPDATE_PLAQUE_MS,
  UPDATE_SETTINGS_ID,
} from '../src/features/update';
import { focusRestoration } from '../src/shared/focus';
import { t, tf } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { e5Page } from '../src/test/feedFixtures';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  focusableIds,
  installNativeModules,
  lastFocusTarget,
  resetKeychain,
  resetRecorders,
  text,
  unmount,
  visible,
} from '../src/test/flow';

jest.mock('react-native-keychain');
// The Player route (Story 9.2: no plaque over it) renders the mocked engine.
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));

jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

/** `mockFlags.updateCheck` false: the flag-off acceptance (read on use). */
const mockFlags = { updateCheck: true };
jest.mock('../src/app/phaseFlags', () => {
  const actual = jest.requireActual('../src/app/phaseFlags');
  return {
    ...actual,
    phaseFlags: new Proxy(actual.phaseFlags, {
      get: (target, key) => (key === 'updateCheck' && typeof mockFlags !== 'undefined' ? mockFlags.updateCheck : target[key]),
    }),
  };
});

const focusMock = requestHostFocus as jest.Mock;

const { settle, render, press, back } = createFlow({
  settle: { rounds: 20, timerRounds: 2 },
  one: 'focusable',
  pressFocuses: true,
  submitSettles: false,
});

/** One OK with no timer run, so the clock (the 2 s gap) stays where it is. */
const QUICK = { settle: { rounds: 3, timerRounds: 0 } };

const VERSION = 'settings/row/version';
const GITHUB = 'https://api.github.com/repos/dzmitryafanasenka/boosty-tv/releases/latest';
const DIGEST = 'd'.repeat(64);

const STORED = JSON.stringify({
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 1_900_000_000_000,
  accountId: '1001',
});

let latestTag = 'v0.9.1';
/** Rejects the pending fake download (the native cancel). */
let rejectDownload: ((error: unknown) => void) | null = null;
/** AppState listeners (the foreground return), as in sessionFlow. */
let appStateHandlers: Array<(state: string) => void> = [];

async function changeAppState(state: string) {
  await act(async () => {
    for (const h of [...appStateHandlers]) {
      h(state);
    }
  });
  await settle({ rounds: 10, timerRounds: 0 });
}

const updater = () => (NativeModules as Record<string, Record<string, jest.Mock>>).AppUpdater;
type Call = { url: string; init?: { headers?: Record<string, string>; credentials?: string } };
let calls: Call[] = [];
const githubCalls = () => calls.filter(c => c.url.startsWith('https://api.github.com/'));

function releaseJson(tag: string): string {
  const version = tag.slice(1);
  return JSON.stringify({
    tag_name: tag,
    html_url: `https://github.com/dzmitryafanasenka/boosty-tv/releases/tag/${tag}`,
    body: 'Исправлено воспроизведение\n\n---\n\nFixed playback',
    assets: [
      {
        name: `boosty-tv-${version}.apk`,
        browser_download_url: `https://github.com/dzmitryafanasenka/boosty-tv/releases/download/${tag}/boosty-tv-${version}.apk`,
        digest: `sha256:${DIGEST}`,
        size: 1000,
      },
    ],
  });
}

const device = () => createAsyncStorage('boostytv-device');

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockFlags.updateCheck = true;
  latestTag = 'v0.9.1';
  calls = [];
  focusMock.mockClear();
  backHandler.reset();
  resetRecorders();
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({
    AppInfo: { versionName: '0.9.0' },
    AppUpdater: {
      supportedAbis: ['armeabi-v7a', 'armeabi'],
      canRequestInstalls: jest.fn(() => Promise.resolve(true)),
      openInstallSettings: jest.fn(() => Promise.resolve('opened')),
      download: jest.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectDownload = reject;
          }),
      ),
      cancel: jest.fn(() => rejectDownload?.(Object.assign(new Error('cancelled'), { code: 'E_CANCELLED' }))),
      install: jest.fn(() => Promise.resolve('cancelled')),
      cleanup: jest.fn(() => Promise.resolve(true)),
    },
  });
  rejectDownload = null;
  appStateHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: string) => void,
  ) => {
    appStateHandlers.push(listener);
    return {
      remove: () => {
        appStateHandlers = appStateHandlers.filter(h => h !== listener);
      },
    };
  }) as unknown as typeof AppState.addEventListener);
  await device().clear();
  updateChecker.reset();
  updateStore.hidePlaque();
  logger.clear();
  (globalThis as { fetch: unknown }).fetch = jest.fn((url: string, init?: Call['init']) => {
    calls.push({ url, init });
    if (url === GITHUB) {
      return Promise.resolve({ status: 200, text: () => Promise.resolve(releaseJson(latestTag)) });
    }
    return url === 'https://api.boosty.to/v1/user/current'
      ? Promise.resolve({ status: 200, text: () => Promise.resolve('{"id":1001}') })
      : url.startsWith('https://api.boosty.to/v1/feed/post/?')
        ? Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(e5Page())) })
        : Promise.reject(new Error('no request expected'));
  });
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  jest.restoreAllMocks();
});

function currentRoute(): string | undefined {
  return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
}

async function openSettings(root?: Root): Promise<Root> {
  const app = root ?? (await render(<App />));
  await press(app, 'nav/settings');
  expect(lastFocusTarget()).toBe(VERSION);
  return app;
}

/** `n` OK presses on «Версия», `gapMs` apart (the clock moves only by the gap). */
async function pressVersion(root: Root, n: number, gapMs = 100) {
  for (let i = 0; i < n; i += 1) {
    if (i > 0) {
      jest.setSystemTime(Date.now() + gapMs);
    }
    await press(root, VERSION, QUICK);
  }
}

describe('the start-up check and the plaque (Story 9.2)', () => {
  it('matrix «Newer on start»: one anonymous GitHub request; the plaque; it is never focusable', async () => {
    // No timer runs: the plaque's 10 s timer must not fire during the settle.
    const root = await render(<App />, { rounds: 20, timerRounds: 0 });
    expect(githubCalls()).toHaveLength(1);
    const [{ init }] = githubCalls();
    // Acceptance: no Boosty headers, cookies or account data.
    expect(init?.headers).toEqual({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
    expect(init?.credentials).toBe('omit');
    expect(JSON.stringify(init)).not.toContain('a'.repeat(64));
    expect(calls.filter(c => !c.url.startsWith('https://api.boosty.to/') && c.url !== GITHUB)).toEqual([]);

    expect(visible(root, 'update/plaque')).toBe(true);
    expect(text(root)).toContain(tf('update.plaque', { version: '0.9.1' }));
    const [plaque] = byTestId(root, 'update/plaque');
    expect(plaque.props.focusable).toBe(false);
    expect(plaque.props.pointerEvents).toBe('none');
    expect(plaque.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(focusableIds(plaque)).toEqual([]);
    // Acceptance: focus behaves as if it were absent.
    expect(focusMock.mock.calls.some(call => (call[0] as { props?: { testID?: string } })?.props?.testID === 'update/plaque')).toBe(false);
    await press(root, 'nav/settings');
    expect(lastFocusTarget()).toBe(VERSION);

    await act(async () => {
      jest.advanceTimersByTime(UPDATE_PLAQUE_MS);
    });
    expect(visible(root, 'update/plaque')).toBe(false);
    await unmount(root);
  });

  it('matrix «Within a day»: a restart within 24 h sends no request; the row still shows the stored release', async () => {
    const first = await render(<App />);
    expect(githubCalls()).toHaveLength(1);
    await unmount(first);
    updateChecker.reset();
    const root = await openSettings();
    expect(githubCalls()).toHaveLength(1);
    expect(text(root)).toContain(tf('settings.versionUpdate', { current: '0.9.0', version: '0.9.1' }));
    expect(visible(root, 'update/plaque')).toBe(false);
    await unmount(root);
  });

  it('matrix «Same»: latest = installed shows nothing', async () => {
    latestTag = 'v0.9.0';
    const root = await openSettings();
    expect(githubCalls()).toHaveLength(1);
    expect(visible(root, 'update/plaque')).toBe(false);
    expect(text(root)).not.toContain('доступна');
    await unmount(root);
  });

  it('acceptance: the flag off sends no request and shows nothing', async () => {
    mockFlags.updateCheck = false;
    const root = await openSettings();
    await pressVersion(root, 1);
    await settle({ rounds: 10, timerRounds: 0 });
    expect(githubCalls()).toEqual([]);
    expect(visible(root, 'update/plaque')).toBe(false);
    expect(visible(root, 'dialog/update')).toBe(false);
    await unmount(root);
  });
});

describe('«Версия» and the update dialog (Story 9.2)', () => {
  it('the row hint and a11y label; OK opens the dialog («Закрыть» focused); Back closes it, focus back on «Версия»', async () => {
    const root = await openSettings();
    const [row] = byTestId(root, VERSION).filter(n => n.props.focusable === true);
    expect(row.props.accessibilityLabel).toBe(tf('settings.versionUpdateA11y', { current: '0.9.0', version: '0.9.1' }));
    expect(text(root)).toContain(tf('settings.versionUpdate', { current: '0.9.0', version: '0.9.1' }));

    await pressVersion(root, 1);
    await settle({ rounds: 5, timerRounds: 1 });
    expect(visible(root, 'dialog/update')).toBe(true);
    expect(text(root)).toContain('Исправлено воспроизведение');
    await settle({ rounds: 3, timerRounds: 3 });
    expect(text(root)).not.toContain('Fixed playback');
    expect(text(root)).toContain(t('update.dialog.install'));
    expect(lastFocusTarget()).toBe(UPDATE_CLOSE_ID);
    // The known release: no extra request.
    expect(githubCalls()).toHaveLength(1);

    focusMock.mockClear();
    await back();
    expect(visible(root, 'dialog/update')).toBe(false);
    expect(lastFocusTarget()).toBe(VERSION);
    expect(currentRoute()).toBe('Shell');
    await unmount(root);
  });

  it('nothing is downloaded before «Скачать и установить»; after it the native download gets the repository URL', async () => {
    const root = await openSettings();
    await pressVersion(root, 1);
    await settle({ rounds: 5, timerRounds: 1 });
    const native = (jest.requireActual('react-native') as { NativeModules: Record<string, { download: jest.Mock }> })
      .NativeModules.AppUpdater;
    expect(native.download).not.toHaveBeenCalled();
    await press(root, UPDATE_INSTALL_ID);
    await settle({ rounds: 5, timerRounds: 0 });
    expect(native.download).toHaveBeenCalledTimes(1);
    expect(native.download.mock.calls[0]).toEqual([
      'https://github.com/dzmitryafanasenka/boosty-tv/releases/download/v0.9.1/boosty-tv-0.9.1.apk',
      DIGEST,
      1000,
    ]);
    await unmount(root);
  });

  it('matrix «Manual OK»: no newer known → one request; newer → the dialog', async () => {
    latestTag = 'v0.9.0';
    const root = await openSettings();
    expect(githubCalls()).toHaveLength(1);
    latestTag = 'v0.9.2';
    await pressVersion(root, 1);
    await settle({ rounds: 10, timerRounds: 1 });
    expect(githubCalls()).toHaveLength(2);
    expect(visible(root, 'dialog/update')).toBe(true);
    expect(text(root)).toContain(tf('update.dialog.title', { version: '0.9.2' }));
    await unmount(root);
  });

  it('matrix «Gesture»: seven presses send at most one request and still open Diagnostics; < 60 s later none', async () => {
    latestTag = 'v0.9.0';
    const root = await openSettings();
    const before = githubCalls().length;
    await pressVersion(root, 7);
    await settle({ rounds: 10, timerRounds: 0 });
    expect(currentRoute()).toBe('Diagnostics');
    expect(githubCalls().length - before).toBe(1);
    expect(visible(root, 'dialog/update')).toBe(false);
    await back();
    expect(lastFocusTarget()).toBe(VERSION);
    // A new series after the 2 s gap but within 60 s: no request.
    jest.setSystemTime(Date.now() + 5000);
    await pressVersion(root, 1);
    await settle({ rounds: 10, timerRounds: 0 });
    expect(githubCalls().length - before).toBe(1);
    await unmount(root);
  });

  it('a failed manual check shows nothing and writes one log entry', async () => {
    latestTag = 'v0.9.0';
    const root = await openSettings();
    (globalThis as unknown as { fetch: jest.Mock }).fetch.mockImplementation((url: string) => {
      calls.push({ url });
      return url === GITHUB ? Promise.reject(new TypeError('Network request failed')) : new Promise(() => {});
    });
    logger.clear();
    await pressVersion(root, 1);
    await settle({ rounds: 10, timerRounds: 0 });
    expect(visible(root, 'dialog/update')).toBe(false);
    expect(logger.entries().filter(e => e.scope === 'update')).toEqual([
      expect.objectContaining({ message: 'update check failed', fields: { reason: 'network', status: null } }),
    ]);
    await unmount(root);
  });
});

describe('the App wiring (Story 9.2)', () => {
  it('a return to the foreground after more than 24 h sends a second request and shows the plaque; within a day none', async () => {
    const root = await render(<App />, { rounds: 20, timerRounds: 0 });
    expect(githubCalls()).toHaveLength(1);
    await act(async () => updateStore.hidePlaque());
    await changeAppState('background');
    await changeAppState('active');
    expect(githubCalls()).toHaveLength(1);
    jest.setSystemTime(Date.now() + AUTO_INTERVAL_MS + 1000);
    await changeAppState('background');
    await changeAppState('active');
    expect(githubCalls()).toHaveLength(2);
    expect(visible(root, 'update/plaque')).toBe(true);
    await unmount(root);
  });

  it('matrix «Player on top»: no plaque (the one found then is dropped)', async () => {
    const root = await render(<App />, { rounds: 20, timerRounds: 0 });
    await act(async () => updateStore.hidePlaque());
    await act(async () => {
      navigationRef.navigate('Player', {
        ref: { kind: 'video', postId: 'p1', mediaId: 'm1', blogUrl: 'blog' },
        origin: { routeKey: 'shell', focusId: 'x' },
      } as never);
    });
    await settle({ rounds: 10, timerRounds: 0 });
    expect(currentRoute()).toBe('Player');
    jest.setSystemTime(Date.now() + AUTO_INTERVAL_MS + 1000);
    await changeAppState('background');
    await changeAppState('active');
    expect(githubCalls()).toHaveLength(2);
    expect(visible(root, 'update/plaque')).toBe(false);
    expect(updateStore.get().plaque).toBeNull();
    await unmount(root);
  });

  it('no plaque on the sign-in screen (no session)', async () => {
    resetKeychain({});
    const root = await render(<App />, { rounds: 20, timerRounds: 0 });
    expect(currentRoute()).toBe('Welcome');
    expect(githubCalls()).toHaveLength(1);
    expect(visible(root, 'update/plaque')).toBe(false);
    await unmount(root);
  });

  it('old update files are deleted once on start; not with the flag off', async () => {
    const root = await render(<App />);
    expect(updater().cleanup).toHaveBeenCalledTimes(1);
    await unmount(root);
    mockFlags.updateCheck = false;
    updater().cleanup.mockClear();
    const off = await render(<App />);
    expect(updater().cleanup).not.toHaveBeenCalled();
    await unmount(off);
  });

  it('Back during a download inside the modal host: the dialog stays, the download is cancelled, focus on a dialog button', async () => {
    const root = await openSettings();
    await pressVersion(root, 1);
    await settle({ rounds: 5, timerRounds: 1 });
    await press(root, UPDATE_INSTALL_ID);
    await settle({ rounds: 5, timerRounds: 0 });
    expect(updater().download).toHaveBeenCalledTimes(1);
    expect(text(root)).toContain(t('update.dialog.cancel'));
    focusMock.mockClear();
    await back();
    await settle({ rounds: 5, timerRounds: 3 });
    expect(visible(root, 'dialog/update')).toBe(true);
    expect(updater().cancel).toHaveBeenCalledTimes(1);
    expect([UPDATE_CLOSE_ID, UPDATE_INSTALL_ID, UPDATE_CANCEL_ID, UPDATE_SETTINGS_ID]).toContain(lastFocusTarget());
    expect(currentRoute()).toBe('Shell');
    await unmount(root);
  });

  it('a double OK on «Скачать и установить» starts one download', async () => {
    const root = await openSettings();
    await pressVersion(root, 1);
    await settle({ rounds: 5, timerRounds: 1 });
    const [install] = byTestId(root, UPDATE_INSTALL_ID).filter(n => n.props.focusable === true);
    await act(async () => {
      install.props.onClick({ nativeEvent: {} });
      install.props.onClick({ nativeEvent: {} });
    });
    await settle({ rounds: 5, timerRounds: 0 });
    expect(updater().canRequestInstalls).toHaveBeenCalledTimes(1);
    expect(updater().download).toHaveBeenCalledTimes(1);
    await unmount(root);
  });
});
