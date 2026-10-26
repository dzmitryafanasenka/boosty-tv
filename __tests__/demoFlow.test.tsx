/**
 * Story 2.5 demo mode (debug-only) through the real App with
 * `DEMO_MODE = true`: a fixture-backed Shell, the persistent «ДЕМО» badge
 * (not focusable) and a SecureStore that is never read, written or cleared,
 * so a stored session survives. The release guard is __tests__/demoModeOff.test.js.
 */
import { act } from 'react';
import { NativeModules } from 'react-native';
import { createRoot } from 'test-renderer';
import App from '../src/app/App';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { components, spacing } from '../src/shared/ui';

jest.mock('react-native-keychain');
jest.mock('../src/app/appConfig', () => ({ DEMO_MODE: true }));
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

type KeychainMock = {
  __values: Map<string, string>;
  __reset(): void;
  getGenericPassword: jest.Mock;
  setGenericPassword: jest.Mock;
  resetGenericPassword: jest.Mock;
};

const keychain = jest.requireMock('react-native-keychain') as KeychainMock;
const native = NativeModules as { AppInfo?: { versionName?: string } };
const STORED = JSON.stringify({ v: 1, accessToken: 'a'.repeat(64), refreshToken: 'r'.repeat(64), expiresAt: 1, accountId: '1001' });
const fetchMock = jest.fn(() => Promise.reject(new Error('no network in demo mode')));

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  keychain.__reset();
  keychain.__values.set('boostytv.session', STORED);
  native.AppInfo = { versionName: '1.0' };
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterEach(() => {
  delete native.AppInfo;
  focusRestoration.clear();
  jest.restoreAllMocks();
});

async function renderApp() {
  const root = createRoot();
  await act(async () => {
    root.render(<App />);
  });
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
  }
  return root;
}

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
