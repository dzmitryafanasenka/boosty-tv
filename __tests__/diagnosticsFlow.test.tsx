/**
 * Story 8.3 through the real App with a stored session: the hidden
 * Diagnostics route behind seven OK presses on Настройки' «Версия» (each
 * < 2 s apart), slow presses, the flag off, the Back order (Diagnostics →
 * Настройки with focus on «Версия»), «Запись логов» (ring dump, then new
 * entries, to the LogFile native fake), «Очистить логи», and an account
 * reset clearing the ring and the file. The keychain, BackHandler, the
 * native focus command and the LogFile module are faked: these tests prove
 * what the app asks for, not native focus or the file on the device.
 */
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { act } from 'react';
import { type Root } from 'test-renderer';
import App, { navigationRef } from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
import { accountScope } from '../src/shared/account';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { DIAGNOSTICS_CAPTURE_KEY, diagnosticsCapture, logFileSink } from '../src/shared/services/logFileSink';
import { logger } from '../src/shared/services/logger';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { e5Page } from '../src/test/feedFixtures';
import {
  clearNativeModules,
  createFlow,
  installNativeModules,
  lastFocusTarget,
  resetKeychain,
  resetRecorders,
  text,
  unmount,
  visible,
} from '../src/test/flow';

jest.mock('react-native-keychain');

jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

/**
 * `mockFlags.diagnostics` false: the flag-off acceptance. Read on use; the
 * app's module-load reads (before this line runs) see the real flag.
 */
const mockFlags = { diagnostics: true };
jest.mock('../src/app/phaseFlags', () => {
  const actual = jest.requireActual('../src/app/phaseFlags');
  return {
    ...actual,
    phaseFlags: new Proxy(actual.phaseFlags, {
      get: (target, key) => (key === 'diagnostics' && typeof mockFlags !== 'undefined' ? mockFlags.diagnostics : target[key]),
    }),
  };
});

const focusMock = requestHostFocus as jest.Mock;

const { settle, render, one, press, back } = createFlow({
  settle: { rounds: 20, timerRounds: 2 },
  one: 'focusable',
  pressFocuses: true,
  submitSettles: false,
});

/** One OK with no timer run, so the clock (the 2 s gap) stays where it is. */
const QUICK = { settle: { rounds: 3, timerRounds: 0 } };

const VERSION = 'settings/row/version';
const CAPTURE = 'settings/diagnostics/capture';
const CLEAR = 'settings/diagnostics/clear';

const STORED = JSON.stringify({
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 1_900_000_000_000,
  accountId: '1001',
});

/** The LogFile native fake: calls in order, lines appended. */
const logFileCalls: string[] = [];
const appended: string[] = [];
const LOG_DIR = '/storage/emulated/0/Android/data/io.github.dzmitryafanasenka.boostytv/files/logs';

function installLogFile() {
  installNativeModules({
    LogFile: {
      append: jest.fn((lines: string[]) => {
        logFileCalls.push('append');
        appended.push(...lines);
        return Promise.resolve(true);
      }),
      clear: jest.fn(() => {
        logFileCalls.push('clear');
        appended.length = 0;
        return Promise.resolve(true);
      }),
      location: jest.fn(() => Promise.resolve(LOG_DIR)),
    },
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
  mockFlags.diagnostics = true;
  focusMock.mockClear();
  backHandler.reset();
  resetRecorders();
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.0' } });
  installLogFile();
  logFileCalls.length = 0;
  appended.length = 0;
  logFileSink.disable();
  logFileCalls.length = 0;
  appended.length = 0;
  await device().clear();
  diagnosticsCapture.forget();
  logger.clear();
  (globalThis as { fetch: unknown }).fetch = jest.fn((url: string) =>
    url === 'https://api.boosty.to/v1/user/current'
      ? Promise.resolve({ status: 200, text: () => Promise.resolve('{"id":1001}') })
      : url.startsWith('https://api.boosty.to/v1/feed/post/?')
        ? Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(e5Page())) })
        : Promise.reject(new Error('no request expected')),
  );
});

afterEach(async () => {
  logFileSink.disable();
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  jest.restoreAllMocks();
});

function currentRoute(): string | undefined {
  return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
}

async function openSettings(): Promise<Root> {
  const root = await render(<App />);
  await press(root, 'nav/settings');
  expect(lastFocusTarget()).toBe(VERSION);
  return root;
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

async function openDiagnostics(): Promise<Root> {
  const root = await openSettings();
  focusMock.mockClear();
  await pressVersion(root, 7);
  await settle({ rounds: 10, timerRounds: 0 });
  expect(currentRoute()).toBe('Diagnostics');
  return root;
}

describe('the «Версия» gesture (Story 8.3)', () => {
  it('matrix «Gesture»: 7 OK, each < 2 s apart, open Diagnostics with focus on «Запись логов»; Back returns to Настройки on «Версия»', async () => {
    const root = await openDiagnostics();
    expect(visible(root, 'settings/diagnostics')).toBe(true);
    expect(lastFocusTarget()).toBe(CAPTURE);
    expect(text(root)).toContain(t('settings.diagnostics.title'));
    expect(text(root)).toContain(t('settings.diagnostics.adb.command'));

    focusMock.mockClear();
    await back();
    expect(currentRoute()).toBe('Shell');
    expect(lastFocusTarget()).toBe(VERSION);
    // Back again: the Shell's own order (content → the current item).
    await back();
    expect(lastFocusTarget()).toBe('nav/settings');
    await unmount(root);
  });

  it('a single press, and six quick presses, open nothing', async () => {
    const root = await openSettings();
    await pressVersion(root, 1);
    await settle({ rounds: 5, timerRounds: 0 });
    expect(currentRoute()).toBe('Shell');
    await pressVersion(root, 5);
    await settle({ rounds: 5, timerRounds: 0 });
    expect(currentRoute()).toBe('Shell');
    await unmount(root);
  });

  it('matrix «Slow presses»: a gap of 2 s restarts the count', async () => {
    const root = await openSettings();
    await pressVersion(root, 7, 2000);
    await settle({ rounds: 5, timerRounds: 0 });
    expect(currentRoute()).toBe('Shell');
    // Six more quick ones complete a fresh series of seven (the last slow press was 1).
    await pressVersion(root, 6);
    await settle({ rounds: 10, timerRounds: 0 });
    expect(currentRoute()).toBe('Diagnostics');
    await unmount(root);
  });

  it('acceptance: with the flag off, «Версия» opens nothing on any number of presses', async () => {
    mockFlags.diagnostics = false;
    const root = await openSettings();
    await pressVersion(root, 21);
    await settle({ rounds: 10, timerRounds: 0 });
    expect(currentRoute()).toBe('Shell');
    expect(visible(root, 'settings/diagnostics')).toBe(false);
    await unmount(root);
  });
});

describe('Diagnostics (Story 8.3)', () => {
  it('«Запись логов»: «Выкл» by default; on dumps the ring, then streams new entries; off stops', async () => {
    logger.info('t', 'before capture');
    const root = await openDiagnostics();
    expect(one(root, CAPTURE).props.accessibilityState).toMatchObject({ checked: false });
    expect(text(root)).toContain(t('settings.diagnostics.capture.off'));
    expect(appended).toEqual([]);

    await press(root, CAPTURE);
    expect(one(root, CAPTURE).props.accessibilityState).toMatchObject({ checked: true });
    expect(text(root)).toContain(t('settings.diagnostics.capture.on'));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(appended.some(line => line.includes('before capture'))).toBe(true);
    await expect(device().getItem(DIAGNOSTICS_CAPTURE_KEY)).resolves.toBe('on');

    logger.info('t', 'while on');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(appended.some(line => line.includes('while on'))).toBe(true);
    // Log lines are never shown on the TV.
    expect(text(root)).not.toContain('while on');

    await press(root, CAPTURE);
    expect(text(root)).toContain(t('settings.diagnostics.capture.off'));
    const count = appended.length;
    logger.info('t', 'while off');
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(appended).toHaveLength(count);
    await expect(device().getItem(DIAGNOSTICS_CAPTURE_KEY)).resolves.toBe('off');
    await unmount(root);
  });

  it('the adb steps name the folder the app reports', async () => {
    const root = await openDiagnostics();
    expect(text(root)).toContain(LOG_DIR);
    await unmount(root);
  });

  it('matrix «Clear»: «Очистить логи» empties the ring and the file', async () => {
    const root = await openDiagnostics();
    await press(root, CAPTURE);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(appended.length).toBeGreaterThan(0);
    logFileCalls.length = 0;
    await press(root, CLEAR);
    expect(logFileCalls).toContain('clear');
    expect(appended).toEqual([]);
    expect(logger.entries()).toEqual([]);
    expect(text(root)).toContain(t('settings.diagnostics.clear.done'));
    await unmount(root);
  });

  it('matrix «Reset»: an account reset clears the ring and the file; capture stays on for the next account', async () => {
    const root = await openDiagnostics();
    await press(root, CAPTURE);
    logger.info('t', 'account A line');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(appended.some(line => line.includes('account A line'))).toBe(true);
    logger.info('t', 'account A queued');

    let failed: string[] = [];
    await act(async () => {
      ({ failed } = await accountScope.reset());
    });
    expect(failed).toEqual([]);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    const dump = appended.join('\n');
    expect(dump).not.toContain('account A');
    expect(logger.entries().map(e => e.message)).not.toContain('account A line');
    expect(logFileSink.isEnabled()).toBe(true);
    await unmount(root);
  });
});
