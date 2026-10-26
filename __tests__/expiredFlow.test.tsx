/**
 * Story 2.6 through the real App over FixtureTransport as the global
 * `fetch`: A11 «Сессия истекла» from any screen (modal closed first, before
 * the navigator is ready), the cold start after an expiry, the A11 → A2
 * prefill and its focus, Back, the same/different account landing, the
 * offline view after an expiry, and the debug in-memory trigger. The
 * keychain, BackHandler and the native focus command are faked: these tests
 * prove what the app asks for, not native focus or real network behavior.
 */
import { act } from 'react';
import { AppState } from 'react-native';
import { type Root } from 'test-renderer';
import App, { SHELL_RESTORATION_KEY } from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
import { authFlow } from '../src/features/auth/authFlow';
import { session } from '../src/app/session';
import {
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
import backHandler from '../src/test/backHandlerMock';
import {
  clearNativeModules,
  createFlow,
  installFixtureTransport,
  installNativeModules,
  keychain as keychainMock,
  lastFocusTarget,
  resetKeychain,
  text,
  topScreen as topScreenOf,
  unmount,
  visible,
} from '../src/test/flow';
import { E5_PATH, e5Page, e5Posts } from '../src/test/feedFixtures';

jest.mock('react-native-keychain');
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

const keychain = keychainMock();
const focusMock = requestHostFocus as jest.Mock;

/** Lets promises, the AD-6 backoff timers and renders run: 30 rounds, timers in each. */
const { settle, render, one, focusOn, press, type, submit, back } = createFlow({
  settle: { rounds: 30, timerRounds: 30 },
  one: 'focusableOrInput',
  pressFocuses: true,
  submitSettles: true,
});

const PHONE = '+375291234567';
const OLD_ACCESS = 'a'.repeat(64);
const OLD_REFRESH = 'r'.repeat(64);
const NEW_ACCESS = 'n'.repeat(64);
const NEW_REFRESH = 'm'.repeat(64);
const CHALLENGE = 'c'.repeat(64);
const SMS_CODE = '482193';
const ACCOUNT = String(e1Ok.body.id);
const STORED = JSON.stringify({
  v: 1,
  accessToken: OLD_ACCESS,
  refreshToken: OLD_REFRESH,
  expiresAt: 4_000_000_000_000,
  accountId: ACCOUNT,
});
const MARKER = JSON.stringify({ v: 1, expired: true, accountId: ACCOUNT });
const E1 = '/v1/user/current';
const TOKEN = '/oauth/token/';
const SEND = '/auth/phone/verification_code/send';
const CONFIRM = '/auth/phone/verification_code/confirm';

/** E1 with the new token answers with `newAccountId`; the old token is rejected. */
let newAccountId: number;
let handler: (req: FixtureRequest) => FixtureReply | Promise<FixtureReply> | undefined;
let transport: FixtureTransport;
let appStateHandlers: Array<(state: string) => void> = [];

/** The old session is rejected (E1 401 → refresh 400 invalid_grant); sign-in works. */
function expiringRoute(req: FixtureRequest): FixtureReply | undefined {
  switch (req.path) {
    case E1:
      return req.headers.Authorization === `Bearer ${NEW_ACCESS}`
        ? { status: 200, body: { ...e1Ok.body, id: newAccountId } }
        : { status: e1Unauthorized.status, body: e1Unauthorized.body };
    case TOKEN:
      return { status: refreshRejected.status, body: refreshRejected.body };
    case SEND:
      return {
        status: 200,
        body: { data: { phoneCode: { code: CHALLENGE, expiresIn: 604800, phone: PHONE, sentTransport: 'gate' } } },
      };
    case CONFIRM:
      return { status: 200, body: { access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 2592000 } };
    default:
      return undefined;
  }
}

const okRoute = (req: FixtureRequest): FixtureReply | undefined =>
  req.path === E1 ? { status: 200, body: e1Ok.body } : undefined;

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
  backHandler.reset();
  resetKeychain({ 'boostytv.session': STORED, 'boostytv.phone': PHONE });
  installNativeModules({
    AppInfo: { versionName: '1.0' },
    InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') },
  });
  newAccountId = e1Ok.body.id;
  handler = okRoute;
  // Story 3.1: Главная sends E5; a handler that does not answer it gets the
  // live feed page.
  transport = installFixtureTransport(async req => {
    const reply = await handler(req);
    return reply ?? (req.path === E5_PATH ? { status: 200, body: e5Page() } : undefined);
  });
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

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  authFlow.reset();
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);

/** The topmost stack screen (the JS stack keeps covered screens mounted). */
function topScreen(root: Root): string | undefined {
  return topScreenOf(root, ['auth/expired', 'auth/welcome', 'auth/phone', 'auth/code', 'shell', 'dev/focus']);
}

async function changeAppState(state: string) {
  await act(async () => {
    for (const h of [...appStateHandlers]) {
      h(state);
    }
  });
  await settle();
}

/** Background → active with the old session now rejected: `expired`. */
async function expireOnResume() {
  handler = expiringRoute;
  await changeAppState('background');
  await changeAppState('active');
}

/** `reset:<service>` / `set:<service>` keychain calls since the last mockClear, in order. */
function keychainOrder(): string[] {
  return [
    ...keychain.resetGenericPassword.mock.calls.map((call, i) => ({
      at: keychain.resetGenericPassword.mock.invocationCallOrder[i],
      op: `reset:${(call[0] as { service: string }).service}`,
    })),
    ...keychain.setGenericPassword.mock.calls.map((call, i) => ({
      at: keychain.setGenericPassword.mock.invocationCallOrder[i],
      op: `set:${(call[2] as { service: string }).service}`,
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map(entry => entry.op);
}

/** A11 → A2 (prefilled) → send → A5 → code → the Shell. */
async function relogin(root: Root) {
  await press(root, 'auth/expired/relogin');
  expect(topScreen(root)).toBe('auth/phone');
  await press(root, 'auth/phone/send');
  expect(topScreen(root)).toBe('auth/code');
  await type(root, 'auth/code/field', SMS_CODE);
  await submit(root, 'auth/code/field');
}

describe('A11 from any screen', () => {
  it('mid-session in the Shell (Настройки): stack = [Expired], focus «Войти снова», copy from the catalog', async () => {
    const root = await renderApp();
    await press(root, 'nav/settings');
    focusMock.mockClear();
    await expireOnResume();
    expect(session.getStatus()).toBe('expired');
    expect(visible(root, 'auth/expired')).toBe(true);
    expect(visible(root, 'shell')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    const button = one(root, 'auth/expired/relogin');
    expect(button.props.accessibilityLabel).toBe(t('auth.expired.relogin'));
    expect(text(root)).toContain(t('auth.expired.title'));
    expect(text(root)).toContain(t('auth.expired.body'));
    // Only «Войти снова» is focusable on A11.
    expect(root.container.queryAll(node => node.props.focusable === true).map(n => n.props.testID)).toEqual([
      'auth/expired/relogin',
    ]);
    // The stored session is now the token-free marker; the phone is kept.
    expect(keychain.__values.get('boostytv.session')).toBe(MARKER);
    expect(keychain.__values.get('boostytv.phone')).toBe(PHONE);
    // Nothing further is sent; no loop.
    expect(transport.callsTo(TOKEN)).toHaveLength(1);
    await unmount(root);
  });

  it('from a pushed screen with an open modal: the modal is closed first, then [Expired]', async () => {
    const root = await renderApp();
    await press(root, 'nav/settings');
    await press(root, 'settings/row/focus-check');
    expect(topScreen(root)).toBe('dev/focus');
    await press(root, 'dev/action/dialog');
    expect(visible(root, 'modal/scrim')).toBe(true);
    await expireOnResume();
    expect(visible(root, 'modal/scrim')).toBe(false);
    expect(visible(root, 'dev/focus')).toBe(false);
    expect(visible(root, 'shell')).toBe(false);
    expect(topScreen(root)).toBe('auth/expired');
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    await unmount(root);
  });

  it('expired before the navigator is ready → A11 once ready; the cold-start E1 is not sent', async () => {
    // Expire the moment the stored session is read: before restore() resolves,
    // so before the navigator is mounted.
    const stop = session.subscribe(status => {
      if (status === 'signedIn') {
        stop();
        session.debugExpireInMemory?.();
      }
    });
    const root = await renderApp();
    stop();
    expect(session.getStatus()).toBe('expired');
    expect(topScreen(root)).toBe('auth/expired');
    expect(visible(root, 'shell')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    expect(transport.calls).toHaveLength(0);
    await unmount(root);
  });
});

describe('cold start', () => {
  it('after an expiry (the marker + phone): boots into A11, nothing sent', async () => {
    keychain.__values.set('boostytv.session', MARKER);
    const root = await renderApp();
    expect(topScreen(root)).toBe('auth/expired');
    expect(visible(root, 'shell')).toBe(false);
    expect(visible(root, 'auth/welcome')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    expect(transport.calls).toHaveLength(0);
    await unmount(root);
  });

  it('a wiped (unreadable) store keeps A1 «Войдите снова»', async () => {
    keychain.__values.set('boostytv.session', 'garbage');
    const root = await renderApp();
    expect(topScreen(root)).toBe('auth/welcome');
    expect(visible(root, 'auth/welcome/sign-in-again')).toBe(true);
    expect(visible(root, 'auth/expired')).toBe(false);
    await unmount(root);
  });
});

describe('A11 → A2', () => {
  it('OK: A2 prefilled +375 / 291234567, focus «Получить код»', async () => {
    keychain.__values.set('boostytv.session', MARKER);
    const root = await renderApp();
    focusMock.mockClear();
    await press(root, 'auth/expired/relogin');
    expect(topScreen(root)).toBe('auth/phone');
    expect(one(root, 'auth/phone/country').props.value).toBe('+375');
    expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
    expect(lastFocusTarget()).toBe('auth/phone/send');
    expect(transport.calls).toHaveLength(0);
    await unmount(root);
  });

  it('double OK while the phone read is pending: busy meanwhile, A2 opened once', async () => {
    keychain.__values.set('boostytv.session', MARKER);
    const root = await renderApp();
    let release: (phone: string | null) => void = () => {};
    const read = jest.spyOn(session, 'getExpiredPhone').mockImplementation(
      () =>
        new Promise<string | null>(resolve => {
          release = resolve;
        }),
    );
    const node = one(root, 'auth/expired/relogin');
    await act(async () => {
      node.props.onClick({ nativeEvent: {} });
    });
    expect(one(root, 'auth/expired/relogin').props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => {
      one(root, 'auth/expired/relogin').props.onClick?.({ nativeEvent: {} });
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(topScreen(root)).toBe('auth/expired');
    await act(async () => {
      release(PHONE);
    });
    await settle();
    expect(topScreen(root)).toBe('auth/phone');
    expect(read).toHaveBeenCalledTimes(1);
    // One A2 on the stack: Back returns to A11, not to a second A2.
    await back();
    expect(topScreen(root)).toBe('auth/expired');
    expect(visible(root, 'auth/phone')).toBe(false);
    await unmount(root);
  });

  it.each([
    ['no stored phone', null],
    ['an unassigned country code', '+259123456789'],
  ])('%s: A2 empty (+7), focus on the number field', async (_name, phone) => {
    keychain.__values.set('boostytv.session', MARKER);
    if (phone === null) {
      keychain.__values.delete('boostytv.phone');
    } else {
      keychain.__values.set('boostytv.phone', phone);
    }
    const root = await renderApp();
    focusMock.mockClear();
    await press(root, 'auth/expired/relogin');
    expect(topScreen(root)).toBe('auth/phone');
    expect(one(root, 'auth/phone/country').props.value).toBe('+7');
    expect(one(root, 'auth/phone/number').props.value).toBe('');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');
    await unmount(root);
  });

  it('Back on A2 → A11 (focus «Войти снова»); Back on A11 exits the app', async () => {
    keychain.__values.set('boostytv.session', MARKER);
    const root = await renderApp();
    await press(root, 'auth/expired/relogin');
    expect(topScreen(root)).toBe('auth/phone');
    focusMock.mockClear();
    await back();
    expect(topScreen(root)).toBe('auth/expired');
    expect(visible(root, 'auth/phone')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    // OK again prefills again (leaving A2 reset the draft).
    await press(root, 'auth/expired/relogin');
    expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
    await back();
    await back();
    expect(backHandler.exitApp).toHaveBeenCalledTimes(1);
    await unmount(root);
  });
});

describe('A2 opened from A11, later steps', () => {
  it('A5 → Back → A2 focuses the number field, not «Получить код»', async () => {
    keychain.__values.set('boostytv.session', MARKER);
    handler = expiringRoute;
    const root = await renderApp();
    await press(root, 'auth/expired/relogin');
    expect(topScreen(root)).toBe('auth/phone');
    await press(root, 'auth/phone/send');
    expect(topScreen(root)).toBe('auth/code');
    focusMock.mockClear();
    await back();
    expect(topScreen(root)).toBe('auth/phone');
    expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');
    await unmount(root);
  });

  it('«Изменить номер» on A5 → A2 with focus on the number field as well', async () => {
    keychain.__values.set('boostytv.session', MARKER);
    handler = expiringRoute;
    const root = await renderApp();
    await press(root, 'auth/expired/relogin');
    await press(root, 'auth/phone/send');
    expect(topScreen(root)).toBe('auth/code');
    focusMock.mockClear();
    await press(root, 'auth/code/change-number');
    expect(topScreen(root)).toBe('auth/phone');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');
    await unmount(root);
  });

  it('A9 (429 sms_gate_ratelimit) «На первый экран» → A11 with focus «Войти снова»', async () => {
    keychain.__values.set('boostytv.session', MARKER);
    handler = req =>
      req.path === SEND ? { status: 429, body: { error: 'sms_gate_ratelimit' } } : expiringRoute(req);
    const root = await renderApp();
    await press(root, 'auth/expired/relogin');
    await press(root, 'auth/phone/send');
    expect(visible(root, 'auth/phone/too-many-attempts')).toBe(true);
    focusMock.mockClear();
    await press(root, 'auth/phone/to-welcome');
    expect(topScreen(root)).toBe('auth/expired');
    expect(visible(root, 'auth/phone/too-many-attempts')).toBe(false);
    expect(visible(root, 'auth/welcome')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/expired/relogin');
    // Only the one send was made; no retry.
    expect(transport.callsTo(SEND)).toHaveLength(1);
    await unmount(root);
  });
});

describe('re-login', () => {
  it('same account id: the Shell on Главная, FocusRestoration kept', async () => {
    const root = await renderApp();
    await press(root, 'nav/settings');
    await focusOn(root, 'settings/row/version');
    const remembered = focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings');
    expect(remembered?.focusId).toBe('settings/row/version');
    await expireOnResume();
    expect(topScreen(root)).toBe('auth/expired');
    keychain.setGenericPassword.mockClear();
    keychain.resetGenericPassword.mockClear();
    await relogin(root);
    // Story 2.8: the same account wipes nothing, so no keychain clear.
    expect(keychainOrder()).toEqual(['set:boostytv.phone', 'set:boostytv.session']);
    expect(session.getStatus()).toBe('signedIn');
    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'auth/expired')).toBe(false);
    expect(visible(root, 'home/feed')).toBe(true);
    // Главная's initial focus: the first feed card (Story 3.1).
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')).toEqual(remembered);
    expect(JSON.parse(keychain.__values.get('boostytv.session') ?? '{}')).toMatchObject({
      accessToken: NEW_ACCESS,
      accountId: ACCOUNT,
    });
    // Back on Главная exits (the Shell is the stack root).
    await back();
    expect(backHandler.exitApp).toHaveBeenCalled();
    await unmount(root);
  });

  it('same account after a restart (the marker holds the id): FocusRestoration kept', async () => {
    keychain.__values.set('boostytv.session', MARKER);
    focusRestoration.remember(SHELL_RESTORATION_KEY, 'settings', 'settings/row/version', 0);
    handler = expiringRoute;
    const root = await renderApp();
    await relogin(root);
    expect(topScreen(root)).toBe('shell');
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')?.focusId).toBe('settings/row/version');
    await unmount(root);
  });

  it('a different account id: the Shell on Главная, FocusRestoration cleared', async () => {
    const root = await renderApp();
    await press(root, 'nav/settings');
    await focusOn(root, 'settings/row/version');
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')).toBeDefined();
    newAccountId = 2002;
    await expireOnResume();
    keychain.setGenericPassword.mockClear();
    keychain.resetGenericPassword.mockClear();
    await relogin(root);
    // Story 2.8: AccountScope.reset() (its gate clears the phone, then the
    // marker) runs before the new phone and session are written.
    expect(keychainOrder()).toEqual([
      'reset:boostytv.phone',
      'reset:boostytv.session',
      'set:boostytv.phone',
      'set:boostytv.session',
    ]);
    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'home/feed')).toBe(true);
    // Главная's initial focus: the first feed card (Story 3.1).
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')).toBeUndefined();
    expect(JSON.parse(keychain.__values.get('boostytv.session') ?? '{}').accountId).toBe('2002');
    await unmount(root);
  });

  it('offline cold start → resume → invalid_grant → re-login: Главная (the feed), no offline view', async () => {
    handler = () => ({ network: true });
    const root = await renderApp();
    expect(visible(root, 'home/offline')).toBe(true);
    await expireOnResume();
    expect(topScreen(root)).toBe('auth/expired');
    await relogin(root);
    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'home/feed')).toBe(true);
    expect(visible(root, 'home/offline')).toBe(false);
    await unmount(root);
  });
});

it('debug row «Проверка: сессия истекла»: A11 in memory; SecureStore untouched, nothing sent; next cold start → Shell', async () => {
  const root = await renderApp();
  const sent = transport.calls.length;
  await press(root, 'nav/settings');
  expect(one(root, 'settings/row/expired-check').props.accessibilityLabel).toBe(t('dev.expiredCheck.row'));
  keychain.setGenericPassword.mockClear();
  keychain.resetGenericPassword.mockClear();
  await press(root, 'settings/row/expired-check');
  expect(topScreen(root)).toBe('auth/expired');
  expect(lastFocusTarget()).toBe('auth/expired/relogin');
  expect(keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
  expect(keychain.__values.get('boostytv.session')).toBe(STORED);
  expect(transport.calls).toHaveLength(sent);
  // A11 → A2 prefilled from the stored phone → Back → A11. No code is sent.
  await press(root, 'auth/expired/relogin');
  expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
  expect(lastFocusTarget()).toBe('auth/phone/send');
  await back();
  expect(topScreen(root)).toBe('auth/expired');
  expect(transport.calls).toHaveLength(sent);
  await unmount(root);

  // The next cold start reads the untouched session.
  const next = await renderApp();
  expect(topScreen(next)).toBe('shell');
  await unmount(next);
});
