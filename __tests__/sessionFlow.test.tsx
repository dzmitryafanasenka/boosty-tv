/**
 * Story 2.5 through the real App with a stored session, over FixtureTransport
 * as the global `fetch`: E1 in the background at cold start (focus never
 * moves), the offline StateView and «Повторить», E1 on resume, the `expired`
 * route to A1 «Войдите снова», the debug live-refresh row, and the demo mode
 * (badge, SecureStore untouched). The keychain and the native focus command
 * are faked: these tests prove what the app asks for, not native focus or
 * real network behavior.
 */
import { act } from 'react';
import { AppState, NativeModules } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import App from '../src/app/App';
import {
  createFixtureTransport,
  type FixtureReply,
  type FixtureRequest,
  type FixtureTransport,
} from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import e1Ok from '../src/test/fixtures/boosty/e1-user-current.json';
import e1Unauthorized from '../src/test/fixtures/boosty/e1-no-token.json';
import refreshRejected from '../src/test/fixtures/boosty/refresh-invalid-grant.json';

jest.mock('react-native-keychain');
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
type Node = ReturnType<Root['container']['queryAll']>[number];

const keychain = jest.requireMock('react-native-keychain') as KeychainMock;
const focusMock = requestHostFocus as jest.Mock;
const native = NativeModules as {
  AppInfo?: { versionName?: string };
  InstallId?: { getOrCreate: jest.Mock };
};

const OLD_ACCESS = 'a'.repeat(64);
const OLD_REFRESH = 'r'.repeat(64);
const NEW_ACCESS = 'n'.repeat(64);
const NEW_REFRESH = 'm'.repeat(64);
const STORED = JSON.stringify({
  v: 1,
  accessToken: OLD_ACCESS,
  refreshToken: OLD_REFRESH,
  expiresAt: 4_000_000_000_000,
  accountId: '1001',
});
const E1 = '/v1/user/current';
const TOKEN = '/oauth/token/';

let handler: (req: FixtureRequest) => FixtureReply | Promise<FixtureReply> | undefined;
let transport: FixtureTransport;
let appStateHandlers: Array<(state: string) => void> = [];

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  focusMock.mockClear();
  keychain.__reset();
  keychain.getGenericPassword.mockClear();
  keychain.setGenericPassword.mockClear();
  keychain.resetGenericPassword.mockClear();
  keychain.__values.set('boostytv.session', STORED);
  native.AppInfo = { versionName: '1.0' };
  native.InstallId = { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') };
  handler = req => (req.path === E1 ? { status: 200, body: e1Ok.body } : undefined);
  transport = createFixtureTransport(req => handler(req));
  (globalThis as { fetch: unknown }).fetch = transport;
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
});

afterEach(() => {
  delete native.AppInfo;
  delete native.InstallId;
  focusRestoration.clear();
  jest.restoreAllMocks();
});

/** Lets promises, the AD-6 backoff timers and renders run. */
async function settle() {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
  }
}

async function renderApp() {
  const root = createRoot();
  await act(async () => {
    root.render(<App />);
  });
  await settle();
  return root;
}

async function unmount(root: Root) {
  await act(async () => {
    root.unmount();
  });
}

function byTestId(root: Root, testID: string): Node[] {
  return root.container.queryAll(node => node.props.testID === testID);
}

function visible(root: Root, testID: string): boolean {
  return byTestId(root, testID).length > 0;
}

function one(root: Root, testID: string): Node {
  const nodes = byTestId(root, testID).filter(node => node.props.focusable === true);
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

async function focusOn(root: Root, testID: string) {
  const node = one(root, testID);
  await act(async () => {
    node.props.onFocus({ nativeEvent: {} });
  });
}

async function press(root: Root, testID: string) {
  await focusOn(root, testID);
  const node = one(root, testID);
  await act(async () => {
    node.props.onClick({ nativeEvent: {} });
  });
  await settle();
}

function lastFocusTarget(): string | undefined {
  const calls = focusMock.mock.calls;
  const view = calls[calls.length - 1]?.[0] as { props?: { testID?: string } } | undefined;
  return view?.props?.testID;
}

function text(root: Root): string {
  return JSON.stringify(root.container.toJSON());
}

async function changeAppState(state: string) {
  await act(async () => {
    for (const h of [...appStateHandlers]) {
      h(state);
    }
  });
  await settle();
}

describe('cold start with a stored session', () => {
  it('opens the Shell at once and runs one E1 in the background; nothing visible changes, focus stays', async () => {
    const root = await renderApp();
    expect(visible(root, 'shell')).toBe(true);
    expect(visible(root, 'home/placeholder')).toBe(true);
    expect(transport.callsTo(E1)).toHaveLength(1);
    expect(transport.calls[0].headers.Authorization).toBe(`Bearer ${OLD_ACCESS}`);
    expect(focusMock.mock.calls.map(c => c[0]?.props?.testID)).toEqual(['nav/home']);
    expect(visible(root, 'demo/badge')).toBe(false);
    await unmount(root);
  });

  it('offline: E1 Network ×3 → Главная offline StateView with «Повторить»; focus stays on nav/home; session kept', async () => {
    handler = () => ({ network: true });
    const root = await renderApp();
    expect(transport.callsTo(E1)).toHaveLength(3);
    expect(visible(root, 'home/offline')).toBe(true);
    expect(visible(root, 'home/placeholder')).toBe(false);
    expect(text(root)).toContain(t('home.offline.title'));
    expect(text(root)).toContain(t('home.offline.body'));
    expect(text(root)).not.toContain(t('error.SessionExpired'));
    expect(one(root, 'home/offline/retry').props.accessibilityLabel).toBe(t('common.retry'));
    expect(lastFocusTarget()).toBe('nav/home');
    expect(keychain.__values.get('boostytv.session')).toBe(STORED);
    expect(visible(root, 'auth/welcome')).toBe(false);
    await unmount(root);
  });

  it('offline: OK on the current Главная item moves focus to «Повторить»', async () => {
    handler = () => ({ network: true });
    const root = await renderApp();
    focusMock.mockClear();
    await press(root, 'nav/home');
    expect(lastFocusTarget()).toBe('home/offline/retry');
    await unmount(root);
  });

  it('«Повторить» runs E1 again; still offline → stays; success → the placeholder, focus to nav/home', async () => {
    handler = () => ({ network: true });
    const root = await renderApp();
    await press(root, 'nav/home');
    await press(root, 'home/offline/retry');
    expect(transport.callsTo(E1)).toHaveLength(6);
    expect(visible(root, 'home/offline')).toBe(true);

    handler = req => (req.path === E1 ? { status: 200, body: e1Ok.body } : undefined);
    focusMock.mockClear();
    await press(root, 'home/offline/retry');
    expect(transport.callsTo(E1)).toHaveLength(7);
    expect(visible(root, 'home/offline')).toBe(false);
    expect(visible(root, 'home/placeholder')).toBe(true);
    expect(lastFocusTarget()).toBe('nav/home');
    await unmount(root);
  });
});

describe('cold start E1 failures other than Network keep the placeholder', () => {
  it.each<[string, (req: FixtureRequest) => FixtureReply | undefined]>([
    ['Server (503 ×2)', req => (req.path === E1 ? { status: 503 } : undefined)],
    ['Parse (bad 200 shape)', req => (req.path === E1 ? { status: 200, body: { name: 'x' } } : undefined)],
    [
      'Client (401 → refresh 503)',
      req => (req.path === E1 ? { status: 401, body: e1Unauthorized.body } : req.path === TOKEN ? { status: 503 } : undefined),
    ],
  ])('%s', async (_name, reply) => {
    handler = reply;
    const root = await renderApp();
    expect(transport.callsTo(E1).length).toBeGreaterThan(0);
    expect(visible(root, 'home/placeholder')).toBe(true);
    expect(visible(root, 'home/offline')).toBe(false);
    expect(visible(root, 'shell')).toBe(true);
    await unmount(root);
  });
});

it('«Повторить» is busy while E1 is pending and not busy after', async () => {
  handler = () => ({ network: true });
  const root = await renderApp();
  let release: (reply: FixtureReply) => void = () => {};
  let deferred = true;
  // Only the first retry attempt is held; its AD-6 retries fail at once.
  handler = () => {
    if (!deferred) {
      return { network: true };
    }
    deferred = false;
    return new Promise<FixtureReply>(resolve => {
      release = resolve;
    });
  };
  await press(root, 'home/offline/retry');
  expect(one(root, 'home/offline/retry').props.accessibilityState).toMatchObject({ busy: true });
  await act(async () => {
    release({ network: true });
  });
  await settle();
  // Still offline after the retries: the button is back and not busy.
  expect(one(root, 'home/offline/retry').props.accessibilityState).toMatchObject({ busy: false });
  await unmount(root);
});

it('next cold start after expiry (phone kept, no session) → Welcome with «Войдите снова»', async () => {
  keychain.__values.delete('boostytv.session');
  keychain.__values.set('boostytv.phone', '+375291234567');
  const root = await renderApp();
  expect(visible(root, 'auth/welcome')).toBe(true);
  expect(visible(root, 'auth/welcome/sign-in-again')).toBe(true);
  expect(transport.calls).toHaveLength(0);
  await unmount(root);
});

describe('resume', () => {
  it('background → active runs E1 once more; a failure changes nothing visible', async () => {
    const root = await renderApp();
    expect(transport.callsTo(E1)).toHaveLength(1);
    focusMock.mockClear();
    await changeAppState('background');
    expect(transport.callsTo(E1)).toHaveLength(1);
    handler = () => ({ network: true });
    await changeAppState('active');
    expect(transport.callsTo(E1)).toHaveLength(4);
    expect(visible(root, 'home/placeholder')).toBe(true);
    expect(visible(root, 'home/offline')).toBe(false);
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('a successful resume E1 clears the cold-start offline view', async () => {
    handler = () => ({ network: true });
    const root = await renderApp();
    expect(visible(root, 'home/offline')).toBe(true);
    handler = req => (req.path === E1 ? { status: 200, body: e1Ok.body } : undefined);
    await changeAppState('background');
    await changeAppState('active');
    expect(visible(root, 'home/placeholder')).toBe(true);
    await unmount(root);
  });
});

it('expired (refresh 400 invalid_grant): the stack resets to A1 with «Войдите снова»', async () => {
  handler = req =>
    req.path === E1
      ? { status: e1Unauthorized.status, body: e1Unauthorized.body }
      : req.path === TOKEN
        ? { status: refreshRejected.status, body: refreshRejected.body }
        : undefined;
  const root = await renderApp();
  expect(transport.callsTo(TOKEN)).toHaveLength(1);
  // The reset leaves Welcome as the only route (the Shell may still be
  // unmounting in the same frame).
  expect(visible(root, 'auth/welcome')).toBe(true);
  expect(visible(root, 'auth/welcome/sign-in-again')).toBe(true);
  expect(text(root)).toContain(t('auth.welcome.signInAgain'));
  // Nothing further is sent; no loop.
  expect(transport.calls).toHaveLength(2);
  await unmount(root);
});

it('debug row «Проверка обновления сессии»: corrupted in-memory token → E1 401 → refresh → E1 200, rotated pair saved', async () => {
  handler = req => {
    if (req.path === TOKEN) {
      return { status: 200, body: { access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 2592000 } };
    }
    if (req.path === E1) {
      const auth = req.headers.Authorization;
      return auth === `Bearer ${OLD_ACCESS}` || auth === `Bearer ${NEW_ACCESS}`
        ? { status: 200, body: e1Ok.body }
        : { status: 401, body: e1Unauthorized.body };
    }
    return undefined;
  };
  const root = await renderApp();
  await press(root, 'nav/settings');
  expect(one(root, 'settings/row/session-check').props.accessibilityLabel).toBe(t('dev.sessionCheck.row'));
  await press(root, 'settings/row/session-check');
  const paths = transport.calls.map(c => c.path);
  expect(paths).toEqual([E1, E1, TOKEN, E1]);
  expect(transport.calls[1].headers.Authorization).not.toBe(`Bearer ${OLD_ACCESS}`);
  expect(transport.calls[3].headers.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
  const saved = JSON.parse(keychain.__values.get('boostytv.session') ?? '{}');
  expect(saved).toMatchObject({ accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH });
  expect(visible(root, 'shell')).toBe(true);
  await unmount(root);
});
