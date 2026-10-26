/**
 * Story 2.5 demo mode (debug-only) through the real App with
 * `DEMO_MODE = true`: a fixture-backed Shell, the persistent «ДЕМО» badge
 * (not focusable) and a SecureStore that is never read, written or cleared,
 * so a stored session survives. The release guard is __tests__/demoModeOff.test.js.
 */
import { act } from 'react';
import App from '../src/app/App';
import { session } from '../src/app/session';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { components, spacing } from '../src/shared/ui';
import {
  clearNativeModules,
  createFlow,
  installNativeModules,
  keychain as keychainMock,
  resetKeychain,
  topScreen,
} from '../src/test/flow';

jest.mock('react-native-keychain');
jest.mock('../src/app/appConfig', () => ({ DEMO_MODE: true }));
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

const keychain = keychainMock();
const STORED = JSON.stringify({ v: 1, accessToken: 'a'.repeat(64), refreshToken: 'r'.repeat(64), expiresAt: 1, accountId: '1001' });
const noNetwork = (_url: string, _init?: unknown): Promise<unknown> =>
  Promise.reject(new Error('no network in demo mode'));
const fetchMock = jest.fn(noNetwork);

/** 20 rounds, timers in each; `press()` focuses and clicks in one `act()`. */
const { settle, render, one, press, type } = createFlow({
  settle: { rounds: 20, timerRounds: 20 },
  one: 'focusableOrInput',
  pressFocuses: 'sameAct',
  submitSettles: false,
});

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.0' } });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterEach(() => {
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  fetchMock.mockImplementation(noNetwork);
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);

test('fixture-backed Shell with the «ДЕМО» badge; SecureStore and the network untouched', async () => {
  const root = await renderApp();
  expect(root.container.queryAll(n => n.props.testID === 'shell').length).toBeGreaterThan(0);
  const [badge] = root.container.queryAll(n => n.props.testID === 'demo/badge');
  expect(badge).toBeDefined();
  expect(JSON.stringify(badge.toJSON())).toContain(t('demo.badge'));
  expect(badge.props.focusable).toBe(false);
  expect(badge.props.style).toMatchObject({
    position: 'absolute',
    top: spacing['safe-y'],
    right: spacing['safe-x'],
    height: components.badge.height,
    backgroundColor: components.badge.bg,
  });
  // The badge adds nothing focusable.
  expect(root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID)).toEqual([
    'nav/home',
    'nav/settings',
  ]);
  // The demo's E1 is answered by FixtureTransport: no real request, no keychain.
  expect(fetchMock).not.toHaveBeenCalled();
  expect(keychain.getGenericPassword).not.toHaveBeenCalled();
  expect(keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
  expect(keychain.__values.get('boostytv.session')).toBe(STORED);
  await act(async () => {
    root.unmount();
  });
});

test('Story 2.8: demo expiry → A11 → A2 → A5 → sign-in with another id: the demo hook wipes the stores; the keychain is never touched', async () => {
  // PhoneScreen's send still goes through the real AuthApiClient (global
  // fetch); answer it here. Confirm and E1 go to the demo's FixtureTransport.
  const SEND = '/auth/phone/verification_code/send';
  fetchMock.mockImplementation((url: string) =>
    url.endsWith(SEND)
      ? Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                data: { phoneCode: { code: 'c'.repeat(64), expiresIn: 604800, phone: '+375291234567', sentTransport: 'gate' } },
              }),
            ),
        })
      : noNetwork(url),
  );
  installNativeModules({ InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') } });
  fetchMock.mockClear();
  keychain.getGenericPassword.mockClear();
  keychain.setGenericPassword.mockClear();
  keychain.resetGenericPassword.mockClear();
  const root = await renderApp();
  const top = () => topScreen(root, ['auth/expired', 'auth/phone', 'auth/code', 'shell']);

  await press(root, 'nav/settings');
  focusRestoration.remember('shell', 'settings', 'settings/row/version', 0);
  logger.info('test', 'demo account line');
  await press(root, 'settings/row/expired-check');
  expect(top()).toBe('auth/expired');
  await press(root, 'auth/expired/relogin');
  expect(top()).toBe('auth/phone');
  await type(root, 'auth/phone/country', '+375');
  await type(root, 'auth/phone/number', '291234567');
  await press(root, 'auth/phone/send');
  expect(top()).toBe('auth/code');
  await type(root, 'auth/code/field', '482193');
  const field = one(root, 'auth/code/field');
  await act(async () => {
    field.props.onSubmitEditing({ nativeEvent: { text: '482193' } });
  });
  await settle();

  // Signed in on the demo session (E1 id 1001 ≠ stored `demo`): the hook ran.
  expect(top()).toBe('shell');
  expect(session.getStatus()).toBe('signedIn');
  expect(focusRestoration.peek('shell', 'settings')).toBeUndefined();
  expect(JSON.stringify(logger.entries())).not.toContain('demo account line');
  expect(logger.entries().some(e => e.scope === 'account' && e.message === 'reset')).toBe(true);
  // The keychain was never touched and the stored session survives.
  expect(keychain.getGenericPassword).not.toHaveBeenCalled();
  expect(keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
  expect(keychain.__values.get('boostytv.session')).toBe(STORED);
  // Nothing reached the global fetch: the send went through the demo
  // session's fixture transport (Epic 2 retro, item 1).
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});
