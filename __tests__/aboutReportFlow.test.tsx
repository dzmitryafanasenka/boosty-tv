/**
 * Story 15.1 (IMP-09, FR-66) through the real App with a stored session:
 * Настройки' «О приложении» and «Сообщить о проблеме» rows, their dialogs
 * in the modal host (the copy, the QR targets, «Закрыть» focused), closing
 * by «Закрыть» and by Back with focus back on the row, the unknown version
 * and device, a QR that cannot be drawn, and «Версия» keeping the initial
 * focus and its seven-press gesture. The keychain, BackHandler, the native
 * focus command, the QR renderer and the device adapter are faked: these
 * tests prove what the app asks for, not native focus or a scanned QR.
 */
import { type Root } from 'test-renderer';
import App, { navigationRef } from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { e5Page } from '../src/test/feedFixtures';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  focusTargets,
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

jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

/**
 * The QrRenderer port records the values it draws (as authorFlow); with
 * `mockQr.fail` it reports the value as not encodable, as the library does.
 */
const mockQrValues: string[] = [];
const mockQr = { fail: false };
jest.mock('../src/shared/platform/qrRenderer', () => ({
  QR_QUIET_ZONE: 16,
  QrCode: (props: { value: string; testID?: string; onError?: () => void }) => {
    mockQrValues.push(props.value);
    if (mockQr.fail) {
      props.onError?.();
    }
    return require('react').createElement('QrCodeMock', { testID: props.testID });
  },
}));

/** The device adapter (its parsing is unit-tested in shared/platform). */
const mockDevice: { value: string | null } = { value: 'Google Chromecast, Android 14' };
jest.mock('../src/shared/platform/deviceInfo', () => ({
  getDeviceDescription: () => mockDevice.value,
}));

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
const ABOUT = 'settings/row/about';
const REPORT = 'settings/row/report';
const SIGN_OUT = 'settings/row/signout';
const ABOUT_CLOSE = 'dialog/about/close';
const QR_CLOSE = 'dialog/qr/close';

const REPO_URL = 'https://github.com/dzmitryafanasenka/boosty-tv';
const ISSUE_URL = `${REPO_URL}/issues/new?template=bug_report.yml`;

const STORED = JSON.stringify({
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 1_900_000_000_000,
  accountId: '1001',
});

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  focusMock.mockClear();
  backHandler.reset();
  resetRecorders();
  mockQrValues.length = 0;
  mockQr.fail = false;
  mockDevice.value = 'Google Chromecast, Android 14';
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.2.0' } });
  logger.clear();
  // E1 and the feed answer; anything else (the update check on «Версия») fails.
  (globalThis as { fetch: unknown }).fetch = jest.fn((url: string) =>
    url === 'https://api.boosty.to/v1/user/current'
      ? Promise.resolve({ status: 200, text: () => Promise.resolve('{"id":1001}') })
      : url.startsWith('https://api.boosty.to/v1/feed/post/?')
        ? Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(e5Page())) })
        : Promise.reject(new Error('no request expected')),
  );
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  jest.restoreAllMocks();
});

async function openSettings(): Promise<Root> {
  const root = await render(<App />);
  await press(root, 'nav/settings');
  expect(lastFocusTarget()).toBe(VERSION);
  return root;
}

function modalContent(root: Root) {
  const [content] = byTestId(root, 'modal/content');
  return content;
}

/** No QR target is ever written as text or into the log ring. */
function expectNotPrinted(root: Root, value: string) {
  expect(text(root)).not.toContain(value);
  expect(JSON.stringify(logger.entries())).not.toContain('github.com');
}

describe('Настройки rows (Story 15.1)', () => {
  it('order: «Системный видеоплеер», «Версия», «О приложении», «Сообщить о проблеме», «Выйти из аккаунта»; «Версия» keeps the initial focus', async () => {
    const root = await openSettings();
    const [settings] = byTestId(root, 'settings');
    expect(focusableIds(settings).slice(0, 5)).toEqual([
      'settings/row/external-player',
      VERSION,
      ABOUT,
      REPORT,
      SIGN_OUT,
    ]);
    expect(text(settings)).toContain('О приложении');
    expect(text(settings)).toContain('Сообщить о проблеме');
    await unmount(root);
  });
});

describe('«О приложении»', () => {
  it('matrix «Open About»: the name, the version, the disclaimer, MIT, the repository QR, «Откроется на телефоне», focus «Закрыть»', async () => {
    const root = await openSettings();
    await press(root, ABOUT);
    expect(visible(root, 'dialog/about')).toBe(true);
    const content = modalContent(root);
    expect(focusableIds(content)).toEqual([ABOUT_CLOSE]);
    const dialogText = text(content);
    expect(dialogText).toContain('Boosty TV');
    expect(dialogText).toContain('Версия 1.2.0');
    expect(dialogText).toContain('Неофициальный клиент Boosty, не связан с Boosty');
    expect(dialogText).toContain('Лицензия MIT');
    expect(dialogText).toContain('Откроется на телефоне');
    expect(dialogText).toContain('Закрыть');
    expect(mockQrValues[mockQrValues.length - 1]).toBe(REPO_URL);
    expectNotPrinted(root, REPO_URL);
    expect(focusTargets()).toContain(ABOUT_CLOSE);
    const [background] = byTestId(root, 'modal/background');
    expect(background.props.importantForAccessibility).toBe('no-hide-descendants');
    await unmount(root);
  });

  it('matrix «Close»: «Закрыть» closes it, focus back on «О приложении»', async () => {
    const root = await openSettings();
    await press(root, ABOUT);
    await press(root, ABOUT_CLOSE);
    expect(visible(root, 'dialog/about')).toBe(false);
    expect(lastFocusTarget()).toBe(ABOUT);
    await unmount(root);
  });

  it('matrix «Close»: Back closes it, focus back on «О приложении»; the Shell stays on Настройки', async () => {
    const root = await openSettings();
    await press(root, ABOUT);
    await back();
    expect(visible(root, 'dialog/about')).toBe(false);
    expect(lastFocusTarget()).toBe(ABOUT);
    expect(visible(root, 'shell/content/settings')).toBe(true);
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('matrix «Unknown version»: «Версия неизвестна»', async () => {
    installNativeModules({ AppInfo: {} });
    const root = await openSettings();
    await press(root, ABOUT);
    expect(text(modalContent(root))).toContain('Версия неизвестна');
    await unmount(root);
  });

  it('matrix «QR fails»: «Не удалось показать QR-код», «Закрыть» still closes', async () => {
    mockQr.fail = true;
    const root = await openSettings();
    await press(root, ABOUT);
    expect(text(modalContent(root))).toContain(t('qr.error'));
    await press(root, ABOUT_CLOSE);
    expect(visible(root, 'dialog/about')).toBe(false);
    expect(lastFocusTarget()).toBe(ABOUT);
    await unmount(root);
  });
});

describe('«Сообщить о проблеме»', () => {
  it('matrix «Open report»: the QrDialog with the bug form URL, version and device prefilled; no account data', async () => {
    const root = await openSettings();
    await press(root, REPORT);
    expect(visible(root, 'dialog/report')).toBe(true);
    const content = modalContent(root);
    expect(focusableIds(content)).toEqual([QR_CLOSE]);
    expect(text(content)).toContain('Сообщить о проблеме');
    expect(text(content)).toContain('Откроется на телефоне');
    const url = mockQrValues[mockQrValues.length - 1];
    expect(url).toBe(`${ISSUE_URL}&version=1.2.0&device=Google%20Chromecast%2C%20Android%2014`);
    // No account data: the stored account id and tokens never enter the URL.
    expect(url).not.toContain('1001');
    expect(url).not.toContain('aaaa');
    expectNotPrinted(root, url);
    await unmount(root);
  });

  it('matrix «Close»: «Закрыть» and Back close it, focus back on «Сообщить о проблеме»', async () => {
    const root = await openSettings();
    await press(root, REPORT);
    await press(root, QR_CLOSE);
    expect(visible(root, 'dialog/report')).toBe(false);
    expect(lastFocusTarget()).toBe(REPORT);
    await press(root, REPORT);
    expect(visible(root, 'dialog/report')).toBe(true);
    await back();
    expect(visible(root, 'dialog/report')).toBe(false);
    expect(lastFocusTarget()).toBe(REPORT);
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('matrix «Unknown version»: no `version` parameter', async () => {
    installNativeModules({ AppInfo: {} });
    const root = await openSettings();
    await press(root, REPORT);
    expect(mockQrValues[mockQrValues.length - 1]).toBe(
      `${ISSUE_URL}&device=Google%20Chromecast%2C%20Android%2014`,
    );
    await unmount(root);
  });

  it('matrix «Unknown device»: no `device` parameter', async () => {
    mockDevice.value = null;
    const root = await openSettings();
    await press(root, REPORT);
    expect(mockQrValues[mockQrValues.length - 1]).toBe(`${ISSUE_URL}&version=1.2.0`);
    await unmount(root);
  });

  it('matrix «QR fails»: «Не удалось показать QR-код»', async () => {
    mockQr.fail = true;
    const root = await openSettings();
    await press(root, REPORT);
    expect(text(modalContent(root))).toContain(t('qr.error'));
    await unmount(root);
  });
});

describe('«Версия» after the dialogs', () => {
  it('the seven-press gesture still opens Diagnostics after the About dialog was closed', async () => {
    const root = await openSettings();
    await press(root, ABOUT);
    await back();
    expect(lastFocusTarget()).toBe(ABOUT);
    for (let i = 0; i < 7; i += 1) {
      if (i > 0) {
        jest.setSystemTime(Date.now() + 100);
      }
      await press(root, VERSION, QUICK);
    }
    await settle({ rounds: 10, timerRounds: 0 });
    expect(navigationRef.getCurrentRoute()?.name).toBe('Diagnostics');
    await unmount(root);
  });
});
