/**
 * Story 2.8 through the real App over FixtureTransport as the global
 * `fetch`: a different account wipes every account-scoped store
 * (`AccountScope.reset()`, the account-switch hook wired in bootstrap)
 * after E1 and before the new phone and session are written; the same
 * account wipes nothing; a failed reset fails the sign-in as spent with
 * nothing of the new account stored; a guarded write started under the old
 * account and answered after the switch is dropped. The keychain, BackHandler
 * and the native focus command are faked: these tests prove the app's order
 * of operations, not the device (owner decision 2026-10-26, no device run).
 */
import { act } from 'react';
import { AppState } from 'react-native';
import { type Root } from 'test-renderer';
import App, { SHELL_RESTORATION_KEY } from '../src/app/App';
import { authFlow } from '../src/features/auth/authFlow';
import { accountScope } from '../src/shared/account';
import { session } from '../src/app/session';
import {
  type FixtureReply,
  type FixtureRequest,
  type FixtureTransport,
} from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
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

jest.mock('react-native-keychain');
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

const keychain = keychainMock();
/** The manual mock's own implementation; `track()` wraps it, `afterEach` restores it. */
const keychainSet = keychain.setGenericPassword.getMockImplementation();
const focusMock = requestHostFocus as jest.Mock;

/** Lets promises, the AD-6 backoff timers and renders run: 30 rounds, timers in each. */
const { settle, render, focusOn, press, type, submit } = createFlow({
  settle: { rounds: 30, timerRounds: 30 },
  one: 'focusableOrInput',
  pressFocuses: true,
  submitSettles: true,
});

const SESSION_KEY = 'boostytv.session';
const PHONE_KEY = 'boostytv.phone';
/** A's stored phone; B signs in with PHONE_B. */
const PHONE_A = '+375291234567';
const PHONE_B = '+375297654321';
const OLD_ACCESS = 'a'.repeat(64);
const OLD_REFRESH = 'r'.repeat(64);
const NEW_ACCESS = 'n'.repeat(64);
const NEW_REFRESH = 'm'.repeat(64);
const CHALLENGE = 'c'.repeat(64);
const SMS_CODE = '482193';
const ACCOUNT_A = String(e1Ok.body.id);
const ACCOUNT_B = 2002;
const STORED_A = JSON.stringify({
  v: 1,
  accessToken: OLD_ACCESS,
  refreshToken: OLD_REFRESH,
  expiresAt: 4_000_000_000_000,
  accountId: ACCOUNT_A,
});
const MARKER_A = JSON.stringify({ v: 1, expired: true, accountId: ACCOUNT_A });
const E1 = '/v1/user/current';
const TOKEN = '/oauth/token/';
const SEND = '/auth/phone/verification_code/send';
const CONFIRM = '/auth/phone/verification_code/confirm';
/** Test-only: the slow response the guarded write waits for. */
const SLOW = '/v1/test/slow-progress';
/** A log line of the previous account, to see the ring wiped. */
const OLD_LOG_LINE = 'account A diagnostic line';

/** E1 with the new token answers with `newAccountId`; the old token is rejected. */
let newAccountId: number;
let handler: (req: FixtureRequest) => FixtureReply | Promise<FixtureReply> | undefined;
let transport: FixtureTransport;
let appStateHandlers: Array<(state: string) => void> = [];
/** Held until the test releases it: the "delayed fixture response". */
let releaseSlow: ((reply: FixtureReply) => void) | null = null;

function sendReply(phone: string): FixtureReply {
  return {
    status: 200,
    body: { data: { phoneCode: { code: CHALLENGE, expiresIn: 604800, phone, sentTransport: 'gate' } } },
  };
}

/** The old session is rejected (E1 401 → refresh 400 invalid_grant); sign-in works. */
function expiringRoute(req: FixtureRequest): FixtureReply | Promise<FixtureReply> | undefined {
  switch (req.path) {
    case E1:
      return req.headers.Authorization === `Bearer ${NEW_ACCESS}`
        ? { status: 200, body: { ...e1Ok.body, id: newAccountId } }
        : { status: e1Unauthorized.status, body: e1Unauthorized.body };
    case TOKEN:
      return { status: refreshRejected.status, body: refreshRejected.body };
    case SEND:
      return sendReply(req.form.phone ?? PHONE_A);
    case CONFIRM:
      return { status: 200, body: { access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 2592000 } };
    case SLOW:
      return new Promise<FixtureReply>(resolve => {
        releaseSlow = resolve;
      });
    default:
      return undefined;
  }
}

const okRoute = (req: FixtureRequest): FixtureReply | Promise<FixtureReply> | undefined =>
  req.path === E1 ? { status: 200, body: e1Ok.body } : expiringRoute(req);

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
  resetKeychain({ [SESSION_KEY]: STORED_A, [PHONE_KEY]: PHONE_A });
  installNativeModules({
    AppInfo: { versionName: '1.0' },
    InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') },
  });
  newAccountId = ACCOUNT_B;
  releaseSlow = null;
  handler = okRoute;
  transport = installFixtureTransport(req => handler(req));
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
  clearNativeModules();
  focusRestoration.clear();
  authFlow.reset();
  logger.clear();
  keychain.setGenericPassword.mockImplementation(keychainSet);
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);

/** The topmost stack screen (the JS stack keeps covered screens mounted). */
function topScreen(root: Root): string | undefined {
  return topScreenOf(root, ['auth/expired', 'auth/welcome', 'auth/phone', 'auth/code', 'shell']);
}

async function changeAppState(state: string) {
  await act(async () => {
    for (const h of [...appStateHandlers]) {
      h(state);
    }
  });
  await settle();
}

/** Background → active with the old session now rejected: `expired` (A11). */
async function expireOnResume() {
  handler = expiringRoute;
  await changeAppState('background');
  await changeAppState('active');
}

/** In the Shell: remembers a Настройки focus for the current account. */
async function rememberSettingsFocus(root: Root) {
  await press(root, 'nav/settings');
  await focusOn(root, 'settings/row/version');
  expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')?.focusId).toBe('settings/row/version');
}

/** A2 (prefilled or empty) → `phone` typed → send → A5 → code → submit. */
async function signInOnA2(root: Root, phone: string) {
  expect(topScreen(root)).toBe('auth/phone');
  await type(root, 'auth/phone/country', '+375');
  await type(root, 'auth/phone/number', phone.slice(4));
  await press(root, 'auth/phone/send');
  expect(topScreen(root)).toBe('auth/code');
  await type(root, 'auth/code/field', SMS_CODE);
  await submit(root, 'auth/code/field');
}

/**
 * What every account-scoped store held when B's phone write ran, and the
 * order of the keychain calls (with their services) since `track()`.
 */
function track() {
  keychain.setGenericPassword.mockClear();
  keychain.resetGenericPassword.mockClear();
  const atPhoneWrite: {
    focus?: unknown;
    draft?: unknown;
    challenge?: unknown;
    oldLog?: boolean;
    session?: string;
  } = {};
  keychain.setGenericPassword.mockImplementation(
    async (username: string, password: string, options: { service: string }) => {
      if (options.service === PHONE_KEY && password === PHONE_B && atPhoneWrite.session === undefined) {
        atPhoneWrite.focus = focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings');
        atPhoneWrite.draft = authFlow.getDraft();
        atPhoneWrite.challenge = authFlow.getChallenge();
        atPhoneWrite.oldLog = JSON.stringify(logger.entries()).includes(OLD_LOG_LINE);
        atPhoneWrite.session = keychain.__values.get(SESSION_KEY) ?? 'none';
      }
      return keychainSet?.(username, password, options);
    },
  );
  /** `reset:<service>` / `set:<service>`, in call order. */
  const order = () =>
    [
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
  return { atPhoneWrite, order };
}

function resetLogged(): boolean {
  return logger.entries().some(e => e.scope === 'account' && e.message === 'reset');
}

/**
 * Test-only account-scoped writer (as E9 progress or history will be): it
 * captures `accountScope.guard()` when the work starts, waits for a delayed
 * fixture response, then commits. Not registered with AccountScope (it is
 * sealed by bootstrap); only its guarded commit is under test.
 */
function startSlowWrite() {
  let stored: string | null = null;
  const write = accountScope.guard<string>('testProgress', value => {
    stored = value;
  });
  // The transport directly, with a signal that never aborts: the content
  // client's timeout would otherwise fire under fake timers.
  const done = transport(`https://api.boosty.to${SLOW}`, {
    method: 'GET',
    headers: {},
    credentials: 'omit',
    signal: new AbortController().signal,
  })
    .then(response => response.text())
    .then(body => write.commit(body));
  return { done, stored: () => stored };
}

describe('a different account', () => {
  it('from A11 mid-session: E1 → reset → phone write → session write; every store empty; fresh Главная', async () => {
    const root = await renderApp();
    await rememberSettingsFocus(root);
    logger.info('test', OLD_LOG_LINE);
    await expireOnResume();
    expect(topScreen(root)).toBe('auth/expired');
    expect(keychain.__values.get(SESSION_KEY)).toBe(MARKER_A);
    const sentBefore = transport.calls.length;
    const { atPhoneWrite, order } = track();
    await press(root, 'auth/expired/relogin');
    await signInOnA2(root, PHONE_B);

    // E1 for B ran before the reset: the gate's clears follow the last E1.
    const e1 = transport.callsTo(E1);
    expect(e1[e1.length - 1].headers.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
    expect(order()).toEqual([
      `reset:${PHONE_KEY}`,
      `reset:${SESSION_KEY}`,
      `set:${PHONE_KEY}`,
      `set:${SESSION_KEY}`,
    ]);
    // At B's phone write, A's data was gone: marker, FocusRestoration, draft,
    // challenge and log ring.
    expect(atPhoneWrite.session).toBe('none');
    expect(atPhoneWrite.focus).toBeUndefined();
    expect(atPhoneWrite.draft).toEqual({ countryCode: '+7', number: '' });
    expect(atPhoneWrite.challenge).toBeNull();
    expect(atPhoneWrite.oldLog).toBe(false);

    expect(keychain.__values.get(PHONE_KEY)).toBe(PHONE_B);
    expect(JSON.parse(keychain.__values.get(SESSION_KEY) ?? '{}')).toMatchObject({
      accessToken: NEW_ACCESS,
      accountId: String(ACCOUNT_B),
    });
    expect(session.getStatus()).toBe('signedIn');
    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'auth/welcome')).toBe(false);
    expect(visible(root, 'home/placeholder')).toBe(true);
    expect(lastFocusTarget()).toBe('nav/home');
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')).toBeUndefined();
    expect(resetLogged()).toBe(true);
    // Logs: `accountChanged` and store names only; never a phone or account id.
    const dump = JSON.stringify(logger.entries());
    for (const secret of [PHONE_A, PHONE_B, ACCOUNT_A, String(ACCOUNT_B), SMS_CODE, CHALLENGE]) {
      expect(dump).not.toContain(secret);
    }
    // No server call on switch: after A11 only send, confirm and B's E1.
    expect(transport.calls.slice(sentBefore).map(call => call.path)).toEqual([SEND, CONFIRM, E1]);
    await unmount(root);
  });

  it('from A11 after a restart (the marker holds A): the reset runs before B is stored', async () => {
    keychain.__values.set(SESSION_KEY, MARKER_A);
    focusRestoration.remember(SHELL_RESTORATION_KEY, 'settings', 'settings/row/version', 0);
    handler = expiringRoute;
    const root = await renderApp();
    expect(topScreen(root)).toBe('auth/expired');
    const { atPhoneWrite, order } = track();
    await press(root, 'auth/expired/relogin');
    await signInOnA2(root, PHONE_B);
    expect(order()).toEqual([
      `reset:${PHONE_KEY}`,
      `reset:${SESSION_KEY}`,
      `set:${PHONE_KEY}`,
      `set:${SESSION_KEY}`,
    ]);
    expect(atPhoneWrite.session).toBe('none');
    expect(atPhoneWrite.focus).toBeUndefined();
    expect(topScreen(root)).toBe('shell');
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')).toBeUndefined();
    await unmount(root);
  });

  it('from A1 with nothing stored (no previous id): the reset runs harmlessly, then B is stored', async () => {
    keychain.__values.clear();
    handler = expiringRoute;
    const root = await renderApp();
    expect(topScreen(root)).toBe('auth/welcome');
    const { order } = track();
    await press(root, 'auth/welcome/signin');
    await signInOnA2(root, PHONE_B);
    expect(order()).toEqual([
      `reset:${PHONE_KEY}`,
      `reset:${SESSION_KEY}`,
      `set:${PHONE_KEY}`,
      `set:${SESSION_KEY}`,
    ]);
    expect(resetLogged()).toBe(true);
    expect(keychain.__values.get(PHONE_KEY)).toBe(PHONE_B);
    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'auth/welcome')).toBe(false);
    await unmount(root);
  });
});

describe('the same account', () => {
  it('nothing is wiped: no keychain clear, FocusRestoration kept, Главная with its saved state', async () => {
    newAccountId = e1Ok.body.id;
    const root = await renderApp();
    await rememberSettingsFocus(root);
    const remembered = focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings');
    logger.info('test', OLD_LOG_LINE);
    await expireOnResume();
    const { order } = track();
    await press(root, 'auth/expired/relogin');
    await press(root, 'auth/phone/send');
    await type(root, 'auth/code/field', SMS_CODE);
    await submit(root, 'auth/code/field');
    expect(order()).toEqual([`set:${PHONE_KEY}`, `set:${SESSION_KEY}`]);
    expect(resetLogged()).toBe(false);
    expect(JSON.stringify(logger.entries())).toContain(OLD_LOG_LINE);
    expect(topScreen(root)).toBe('shell');
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')).toEqual(remembered);
    expect(keychain.__values.get(PHONE_KEY)).toBe(PHONE_A);
    await unmount(root);
  });
});

describe('the reset fails', () => {
  it('the gate clear rejects: sign-in fails as spent (A8, error.Unknown); nothing of B stored; A kept', async () => {
    keychain.__values.set(SESSION_KEY, MARKER_A);
    focusRestoration.remember(SHELL_RESTORATION_KEY, 'settings', 'settings/row/version', 0);
    handler = expiringRoute;
    const root = await renderApp();
    await press(root, 'auth/expired/relogin');
    expect(topScreen(root)).toBe('auth/phone');
    await type(root, 'auth/phone/number', PHONE_B.slice(4));
    await press(root, 'auth/phone/send');
    expect(topScreen(root)).toBe('auth/code');
    await type(root, 'auth/code/field', SMS_CODE);
    keychain.setGenericPassword.mockClear();
    // The gate's first clear (the phone) fails with a non-recoverable error.
    keychain.__failNext('resetGenericPassword', new Error('keystore busy'));
    focusMock.mockClear();
    await submit(root, 'auth/code/field');

    expect(topScreen(root)).toBe('auth/code');
    expect(text(root)).toContain(t('error.Unknown'));
    expect(visible(root, 'auth/code/submit')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/code/new-code');
    expect(authFlow.getChallenge()).toBeNull();
    // Nothing of B: no keychain write; A's marker and phone stay.
    expect(keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(keychain.__values.get(SESSION_KEY)).toBe(MARKER_A);
    expect(keychain.__values.get(PHONE_KEY)).toBe(PHONE_A);
    expect(session.getStatus()).toBe('expired');
    expect(resetLogged()).toBe(false);
    // The gate failed first, so no other store was touched.
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')?.focusId).toBe('settings/row/version');
    expect(JSON.stringify(root.container.toJSON())).not.toContain(NEW_ACCESS);
    await unmount(root);
  });
});

describe('a partial reset', () => {
  it('a non-gate store fails on switch: sign-in fails as spent; nothing of B stored', async () => {
    keychain.__values.set(SESSION_KEY, MARKER_A);
    handler = expiringRoute;
    const root = await renderApp();
    await press(root, 'auth/expired/relogin');
    await type(root, 'auth/phone/number', PHONE_B.slice(4));
    await press(root, 'auth/phone/send');
    expect(topScreen(root)).toBe('auth/code');
    await type(root, 'auth/code/field', SMS_CODE);
    keychain.setGenericPassword.mockClear();
    jest.spyOn(focusRestoration, 'clear').mockImplementationOnce(() => {
      throw new Error('focus store broken');
    });
    await submit(root, 'auth/code/field');

    expect(topScreen(root)).toBe('auth/code');
    expect(text(root)).toContain(t('error.Unknown'));
    expect(visible(root, 'auth/code/submit')).toBe(false);
    // The gate ran (A's marker and phone are gone), but nothing of B is stored.
    expect(keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(keychain.__values.has(SESSION_KEY)).toBe(false);
    expect(keychain.__values.has(PHONE_KEY)).toBe(false);
    expect(session.getStatus()).toBe('signedOut');
    expect(JSON.stringify(logger.entries())).not.toContain('accountChanged');
    await unmount(root);
  });
});

describe('guarded writes (AccountScope.guard)', () => {
  it('started under A, answered after B signed in: dropped and logged with the store name only', async () => {
    const root = await renderApp();
    const slow = startSlowWrite();
    await settle();
    expect(transport.callsTo(SLOW)).toHaveLength(1);
    await expireOnResume();
    await press(root, 'auth/expired/relogin');
    await signInOnA2(root, PHONE_B);
    expect(topScreen(root)).toBe('shell');
    expect(session.getStatus()).toBe('signedIn');

    await act(async () => {
      releaseSlow?.({ status: 200, body: { position: 'account-A-secret' } });
    });
    await settle();
    await expect(slow.done).resolves.toBe(false);
    expect(slow.stored()).toBeNull();
    const dropped = logger.entries().filter(e => e.message === 'stale write dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0].fields).toEqual({ store: 'testProgress' });
    expect(JSON.stringify(logger.entries())).not.toContain('account-A-secret');
    await unmount(root);
  });

  it('the same account in between (no reset): committed', async () => {
    newAccountId = e1Ok.body.id;
    const root = await renderApp();
    const slow = startSlowWrite();
    await settle();
    await expireOnResume();
    await press(root, 'auth/expired/relogin');
    await press(root, 'auth/phone/send');
    await type(root, 'auth/code/field', SMS_CODE);
    await submit(root, 'auth/code/field');
    expect(topScreen(root)).toBe('shell');

    await act(async () => {
      releaseSlow?.({ status: 200, body: { position: 42 } });
    });
    await settle();
    await expect(slow.done).resolves.toBe(true);
    expect(slow.stored()).toBe(JSON.stringify({ position: 42 }));
    await unmount(root);
  });
});
