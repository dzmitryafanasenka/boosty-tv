/**
 * Story 2.7 through the real App over FixtureTransport as the global
 * `fetch`: Настройки with the version and «Выйти из аккаунта», the sign-out
 * dialog (focus, Cancel and Back return to the row, the background hidden),
 * confirm → AccountScope.reset() → A1, a repeated OK, a failed SecureStore
 * clear, and a refresh in flight at confirm. No request is sent on
 * sign-out. The keychain, BackHandler and the native focus command are
 * faked: these tests prove what the app asks for, not native focus.
 */
import { act } from 'react';
import { type Root } from 'test-renderer';
import App, { SHELL_RESTORATION_KEY } from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
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
import backHandler from '../src/test/backHandlerMock';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  focusableIds,
  installFixtureTransport,
  installNativeModules,
  keychain as keychainMock,
  lastFocusTarget,
  resetKeychain,
  text,
  unmount,
  visible,
  type SettleOptions,
} from '../src/test/flow';
import { E5_PATH, e5Page } from '../src/test/feedFixtures';

jest.mock('react-native-keychain');
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

const keychain = keychainMock();
const focusMock = requestHostFocus as jest.Mock;

/** Lets promises, timers and renders run: 30 rounds, timers in each unless `NO_TIMERS`. */
const NO_TIMERS = { timerRounds: 0 };
const { settle, render, one, focusOn, press, type, submit, back } = createFlow({
  settle: { rounds: 30, timerRounds: 30 },
  one: 'focusableOrInput',
  pressFocuses: true,
  submitSettles: true,
});

const PHONE = '+375291234567';
const ACCOUNT = String(e1Ok.body.id);
const SESSION = 'boostytv.session';
const PHONE_SERVICE = 'boostytv.phone';
const STORED = JSON.stringify({
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 4_000_000_000_000,
  accountId: ACCOUNT,
});
const E1 = '/v1/user/current';
const TOKEN = '/oauth/token/';

const ROW = 'settings/row/signout';
const VERSION = 'settings/row/version';
const CANCEL = 'dialog/signout/cancel';
const CONFIRM = 'dialog/signout/confirm';

let handler: (req: FixtureRequest) => FixtureReply | Promise<FixtureReply> | undefined;
let transport: FixtureTransport;

const okRoute = (req: FixtureRequest): FixtureReply | undefined =>
  req.path === E1 ? { status: 200, body: e1Ok.body } : undefined;

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  focusMock.mockClear();
  backHandler.reset();
  resetKeychain({ [SESSION]: STORED, [PHONE_SERVICE]: PHONE });
  installNativeModules({
    AppInfo: { versionName: '1.0' },
    InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') },
  });
  handler = okRoute;
  // Story 3.1: Главная sends E5; a handler that does not answer it gets the
  // live feed page.
  transport = installFixtureTransport(async req => {
    const reply = await handler(req);
    return reply ?? (req.path === E5_PATH ? { status: 200, body: e5Page() } : undefined);
  });
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  authFlow.reset();
  jest.restoreAllMocks();
});

const renderApp = (settleOptions?: Partial<SettleOptions>) => render(<App />, settleOptions);

async function openSettings(root: Root) {
  await press(root, 'nav/settings');
}

async function openDialog(root: Root, settleOptions?: Partial<SettleOptions>) {
  await openSettings(root);
  await press(root, ROW, { settle: settleOptions });
}

describe('Настройки', () => {
  it('shows the version and «Выйти из аккаунта», focus on the version row', async () => {
    const root = await renderApp();
    await openSettings(root);
    expect(lastFocusTarget()).toBe(VERSION);
    expect(text(root)).toContain(t('settings.version'));
    expect(text(root)).toContain(t('settings.signOut.row'));
    const [settings] = byTestId(root, 'settings');
    const ids = focusableIds(settings);
    // Story 8.2: «Системный видеоплеер» is the first row; the version keeps the initial focus.
    expect(ids.slice(0, 3)).toEqual(['settings/row/external-player', VERSION, ROW]);
    expect(one(root, ROW).props.accessibilityLabel).toBe('Выйти из аккаунта');
    await unmount(root);
  });
});

describe('sign-out dialog', () => {
  it('opens with «Отмена» focused and the approved copy; the background is hidden', async () => {
    const root = await renderApp();
    await openDialog(root);
    expect(visible(root, 'dialog/signout')).toBe(true);
    const [content] = byTestId(root, 'modal/content');
    expect(focusableIds(content)).toEqual([CANCEL, CONFIRM]);
    expect(one(root, CANCEL).props.hasTVPreferredFocus).toBe(true);
    expect(one(root, CANCEL).props.accessibilityLabel).toBe('Отмена');
    expect(one(root, CONFIRM).props.accessibilityLabel).toBe('Выйти');
    const dialogText = JSON.stringify(content.toJSON());
    expect(dialogText).toContain('Выйти из аккаунта?');
    expect(dialogText).toContain(
      'Чтобы снова войти, понадобятся номер телефона и код из сообщения. Это коснётся всех, кто смотрит на этом телевизоре.',
    );
    const [background] = byTestId(root, 'modal/background');
    expect(background.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(lastFocusTarget()).toBe('modal/content');
    await unmount(root);
  });

  it('«Отмена» closes it, focus back on the row; nothing is cleared', async () => {
    const root = await renderApp();
    await openDialog(root);
    const generation = accountScope.generation();
    await press(root, CANCEL);
    expect(visible(root, 'dialog/signout')).toBe(false);
    expect(lastFocusTarget()).toBe(ROW);
    expect(keychain.__values.get(SESSION)).toBe(STORED);
    expect(keychain.__values.get(PHONE_SERVICE)).toBe(PHONE);
    expect(session.getStatus()).toBe('signedIn');
    expect(accountScope.generation()).toBe(generation);
    await unmount(root);
  });

  it('Back closes it, focus back on the row; the Shell stays on Настройки', async () => {
    const root = await renderApp();
    await openDialog(root);
    await back();
    expect(visible(root, 'dialog/signout')).toBe(false);
    expect(lastFocusTarget()).toBe(ROW);
    expect(visible(root, 'shell/content/settings')).toBe(true);
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    await unmount(root);
  });
});

describe('confirm', () => {
  it('clears SecureStore and every account-scoped store, sends nothing, then A1 with its initial focus', async () => {
    const root = await renderApp();
    await openDialog(root);
    authFlow.setDraft({ countryCode: '+375', number: '291234567' });
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')).toBeDefined();
    expect(logger.entries().length).toBeGreaterThan(0);
    const generation = accountScope.generation();
    const sent = transport.calls.length;

    await press(root, CONFIRM);

    expect(keychain.__values.has(SESSION)).toBe(false);
    expect(keychain.__values.has(PHONE_SERVICE)).toBe(false);
    expect(session.getStatus()).toBe('signedOut');
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')).toBeUndefined();
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'home')).toBeUndefined();
    expect(authFlow.getDraft()).toEqual({ countryCode: '+7', number: '' });
    expect(authFlow.getChallenge()).toBeNull();
    // The ring holds only what came after the wipe: the reset outcome first.
    expect(logger.entries()[0]).toMatchObject({ scope: 'account', message: 'reset' });
    expect(JSON.stringify(logger.entries())).not.toContain('signed out');
    expect(accountScope.generation()).toBe(generation + 1);
    expect(transport.calls.length).toBe(sent);

    expect(visible(root, 'dialog/signout')).toBe(false);
    expect(visible(root, 'shell')).toBe(false);
    expect(visible(root, 'auth/welcome')).toBe(true);
    expect(visible(root, 'auth/welcome/sign-in-again')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/welcome/signin');
    // A1 is the stack root: Back exits.
    await back();
    expect(backHandler.exitApp).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('a repeated OK while the reset runs signs out once', async () => {
    const root = await renderApp();
    await openDialog(root);
    const generation = accountScope.generation();
    keychain.resetGenericPassword.mockClear();
    // The session clear hangs until released.
    let release!: () => void;
    keychain.resetGenericPassword.mockImplementationOnce(async ({ service }: { service: string }) => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      keychain.__values.delete(service);
      return true;
    });
    await focusOn(root, CONFIRM);
    const confirm = one(root, CONFIRM);
    await act(async () => {
      confirm.props.onClick({ nativeEvent: {} });
      confirm.props.onClick({ nativeEvent: {} });
      // Back right after OK, before the busy state is rendered.
      backHandler.pressBack();
    });
    expect(visible(root, 'dialog/signout')).toBe(true);
    await settle();
    // Still running: busy; OK, «Отмена» and Back do nothing.
    const busy = one(root, CONFIRM);
    expect(busy.props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => {
      busy.props.onClick?.({ nativeEvent: {} });
      one(root, CANCEL).props.onClick({ nativeEvent: {} });
    });
    await back();
    expect(visible(root, 'dialog/signout')).toBe(true);
    expect(keychain.resetGenericPassword).toHaveBeenCalledTimes(1);

    release();
    await settle();
    expect(accountScope.generation()).toBe(generation + 1);
    const sessionClears = keychain.resetGenericPassword.mock.calls.filter(
      ([options]: [{ service: string }]) => options.service === SESSION,
    );
    expect(sessionClears).toHaveLength(1);
    expect(keychain.__values.has(SESSION)).toBe(false);
    expect(visible(root, 'auth/welcome')).toBe(true);
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('a failed SecureStore clear keeps the dialog with the error line, the session and the stores; a retry succeeds', async () => {
    const root = await renderApp();
    await openDialog(root);
    authFlow.setDraft({ countryCode: '+375', number: '291234567' });
    const remembered = focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings');
    keychain.__failNext('resetGenericPassword', new Error('keystore busy'));
    focusMock.mockClear();

    await press(root, CONFIRM);

    expect(visible(root, 'dialog/signout')).toBe(true);
    expect(text(root)).toContain('Не удалось выйти из аккаунта. Попробуйте ещё раз.');
    const [line] = byTestId(root, 'dialog/signout/error');
    expect(line.props.accessibilityLiveRegion).toBe('polite');
    // Focus is not moved: it stays on «Выйти».
    expect(focusMock).not.toHaveBeenCalled();
    expect(one(root, CONFIRM).props.accessibilityState).toMatchObject({ busy: false });
    expect(session.getStatus()).toBe('signedIn');
    expect(keychain.__values.get(SESSION)).toBe(STORED);
    expect(keychain.__values.get(PHONE_SERVICE)).toBe(PHONE);
    expect(focusRestoration.peek(SHELL_RESTORATION_KEY, 'settings')).toEqual(remembered);
    expect(authFlow.getDraft()).toEqual({ countryCode: '+375', number: '291234567' });
    expect(JSON.stringify(logger.entries())).toContain('"outcome":"kept"');

    await press(root, CONFIRM);
    expect(keychain.__values.has(SESSION)).toBe(false);
    expect(visible(root, 'auth/welcome')).toBe(true);
    await unmount(root);
  });

  it('a refresh in flight at confirm: signed out, the late result dropped, storage stays clear', async () => {
    let answerRefresh!: (reply: FixtureReply) => void;
    handler = req => {
      if (req.path === E1) {
        return { status: e1Unauthorized.status, body: e1Unauthorized.body };
      }
      if (req.path === TOKEN) {
        return new Promise<FixtureReply>(resolve => {
          answerRefresh = resolve;
        });
      }
      return undefined;
    };
    // No timers while the refresh hangs: its request timeout must not end it.
    const root = await renderApp(NO_TIMERS);
    expect(transport.callsTo(TOKEN)).toHaveLength(1);
    await openDialog(root, NO_TIMERS);
    // The request count when the status became signedOut.
    let sentAtSignOut: number | null = null;
    const unsubscribe = session.subscribe(status => {
      if (status === 'signedOut' && sentAtSignOut === null) {
        sentAtSignOut = transport.calls.length;
      }
    });
    await press(root, CONFIRM, { settle: NO_TIMERS });
    unsubscribe();
    expect(session.getStatus()).toBe('signedOut');
    expect(sentAtSignOut).not.toBeNull();
    expect(visible(root, 'auth/welcome')).toBe(true);

    answerRefresh({
      status: 200,
      body: { access_token: 'n'.repeat(64), refresh_token: 'm'.repeat(64), expires_in: 2592000 },
    });
    await settle();
    expect(session.getStatus()).toBe('signedOut');
    expect(keychain.__values.has(SESSION)).toBe(false);
    expect(keychain.__values.has(PHONE_SERVICE)).toBe(false);
    // Nothing at all after the sign-out: no E1 retry, nothing with Authorization.
    expect(transport.calls.slice(sentAtSignOut ?? 0)).toEqual([]);
    expect(
      transport.calls.slice(sentAtSignOut ?? 0).filter(c => c.headers.Authorization),
    ).toEqual([]);
    expect(visible(root, 'auth/welcome')).toBe(true);
    await unmount(root);
  });

  it('offline cold start → sign out → sign in again: Главная shows the feed, not the offline view', async () => {
    handler = () => ({ network: true });
    const root = await renderApp();
    expect(visible(root, 'home/offline')).toBe(true);
    await openDialog(root);
    await press(root, CONFIRM);
    expect(visible(root, 'auth/welcome')).toBe(true);

    const challenge = 'c'.repeat(64);
    const access = 'n'.repeat(64);
    handler = req => {
      switch (req.path) {
        case '/auth/phone/verification_code/send':
          return {
            status: 200,
            body: { data: { phoneCode: { code: challenge, expiresIn: 604800, phone: PHONE, sentTransport: 'gate' } } },
          };
        case '/auth/phone/verification_code/confirm':
          return { status: 200, body: { access_token: access, refresh_token: 'm'.repeat(64), expires_in: 2592000 } };
        case E1:
          return req.headers.Authorization === `Bearer ${access}`
            ? { status: 200, body: e1Ok.body }
            : { status: e1Unauthorized.status, body: e1Unauthorized.body };
        default:
          return undefined;
      }
    };
    await press(root, 'auth/welcome/signin');
    expect(visible(root, 'auth/phone')).toBe(true);
    await type(root, 'auth/phone/country', '+375');
    await type(root, 'auth/phone/number', '291234567');
    await press(root, 'auth/phone/send');
    expect(visible(root, 'auth/code')).toBe(true);
    await type(root, 'auth/code/field', '482193');
    await submit(root, 'auth/code/field');

    expect(visible(root, 'shell')).toBe(true);
    expect(session.getStatus()).toBe('signedIn');
    expect(visible(root, 'home/feed')).toBe(true);
    expect(visible(root, 'home/offline')).toBe(false);
    await unmount(root);
  });
});
