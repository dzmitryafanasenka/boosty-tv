/**
 * Story 2.3 through the real App (NavigationContainer + JS stack): A5–A8
 * (code field, 60 s resend countdown, resend, A7 wrong code, A8 expired),
 * confirm → E1 → SecureStore → the Shell, and the startup gate.
 * `fetch`, the InstallId native module, react-native-keychain (root
 * `__mocks__`), BackHandler and the native focus command are faked; native
 * focus and the keychain itself are device checks.
 */
import { act } from 'react';
import { NativeModules } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import App from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
import { e5Page, e5Posts } from '../src/test/feedFixtures';
import { authFlow } from '../src/features/auth/authFlow';
import { t } from '../src/shared/i18n';
import { CONTENT_USER_AGENT } from '../src/shared/api/profiles';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  installNativeModules,
  keychain as keychainMock,
  lastFocusTarget,
  resetKeychain,
  text,
  topScreen as topScreenOf,
  unmount,
  visible,
} from '../src/test/flow';

// The root `__mocks__/react-native-keychain.js` (in-memory, per service).
jest.mock('react-native-keychain');

jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

const keychain = keychainMock();

const DEVICE_ID = '3f0c2a8e-1b7d-4c3a-9e2f-5a6b7c8d9e0f';
const PHONE = '+375291234567';
const CHALLENGE = 'c'.repeat(64);
const CHALLENGE_2 = 'd'.repeat(64);
const SMS_CODE = '482193';
const ACCESS = 'a'.repeat(64);
const REFRESH = 'r'.repeat(64);
const SEND_URL = 'https://api.boosty.to/auth/phone/verification_code/send';
const CONFIRM_URL = 'https://api.boosty.to/auth/phone/verification_code/confirm';
const E1_URL = 'https://api.boosty.to/v1/user/current';
/** Story 3.1: Главная's first feed page. */
const E5_URL = 'https://api.boosty.to/v1/feed/post/?limit=10&comments_limit=0&reply_limit=0';

const sendBody = (code: string) => ({
  data: { phoneCode: { code, expiresIn: 604800, phone: PHONE, sentTransport: 'gate' } },
});
const TOKENS = { access_token: ACCESS, refresh_token: REFRESH, expires_in: 2592000 };

type Reply = { status: number; body: unknown } | Error;

const focusMock = requestHostFocus as jest.Mock;
const fetchMock = jest.fn();
/** Read-only view for assertions; fakes go in through `installNativeModules`. */
const native = NativeModules as {
  KeychainStorageReset: { deleteKeychainStorage: jest.Mock };
};

/**
 * 20 rounds; timers stay off by default so the resend countdown never runs
 * down by accident. `settle(TIMERS)` runs them in the first 2 rounds, as
 * render and Back always do.
 */
const TIMERS = { timerRounds: 2 };
const { settle, render, one, press, type, submit, back } = createFlow({
  settle: { rounds: 20, timerRounds: 0 },
  renderSettle: TIMERS,
  backSettle: TIMERS,
  one: 'declaredOrInput',
  pressFocuses: false,
  submitSettles: false,
});

/** Replies per URL, in order; the last one repeats. */
let replies: Record<string, Reply[]> = {};

function route(url: string) {
  const queue = replies[url] ?? [];
  const reply = queue.length > 1 ? queue.shift() : queue[0];
  if (!reply) {
    return Promise.reject(new Error(`unexpected request ${url}`));
  }
  if (reply instanceof Error) {
    return Promise.reject(reply);
  }
  return Promise.resolve({
    status: reply.status,
    text: () =>
      Promise.resolve(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
  });
}

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
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => route(url));
  replies = {
    [SEND_URL]: [{ status: 200, body: sendBody(CHALLENGE) }],
    [CONFIRM_URL]: [{ status: 200, body: TOKENS }],
    [E1_URL]: [{ status: 200, body: { id: 1001, flags: {} } }],
    [E5_URL]: [{ status: 200, body: e5Page() }],
  };
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  installNativeModules({ InstallId: { getOrCreate: jest.fn().mockResolvedValue(DEVICE_ID) } });
  resetKeychain();
  backHandler.reset();
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  authFlow.reset();
  jest.restoreAllMocks();
});

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

function topScreen(root: Root): string | undefined {
  return topScreenOf(root, ['auth/welcome', 'auth/phone', 'auth/code', 'shell']);
}

function requestsTo(url: string) {
  return fetchMock.mock.calls.filter(([u]) => u === url);
}

const renderApp = () => render(<App />);

/** A1 → A2 → valid number → send → A5 (the countdown starts at 1:00). */
async function openCode() {
  const root = await renderApp();
  await press(root, 'auth/welcome/signin');
  await settle(TIMERS);
  await type(root, 'auth/phone/country', '+375');
  await type(root, 'auth/phone/number', '291234567');
  await press(root, 'auth/phone/send');
  await settle(TIMERS);
  expect(topScreen(root)).toBe('auth/code');
  return root;
}

function resendInText(root: Root): string | null {
  const nodes = byTestId(root, 'auth/code/resend-in');
  return nodes.length > 0 ? JSON.stringify(nodes[0].toJSON?.() ?? '') : null;
}

describe('A5 form and the countdown', () => {
  it('initial focus on the code field; masked phone; resend disabled with its sub-label', async () => {
    const root = await openCode();
    expect(lastFocusTarget()).toBe('auth/code/field/host');

    const field = one(root, 'auth/code/field');
    expect(field.props.accessibilityLabel).toBe(t('auth.code.fieldLabel'));
    expect(field.props.secureTextEntry).toBeFalsy();
    expect(field.props.value).toBe('');

    const code = byTestId(root, 'auth/code')[0];
    const all = JSON.stringify(code.toJSON?.() ?? null);
    expect(all).toContain('Код отправлен на +375 •• ••• •• 67.');
    expect(all).toContain(t('auth.code.channels'));
    expect(all).toContain(t('auth.code.title'));
    expect(all).not.toContain('291234567');
    expect(all).not.toContain(CHALLENGE);

    const resend = one(root, 'auth/code/resend');
    expect(resend.props.focusable).toBe(false);
    expect(resend.props.accessibilityState).toMatchObject({ disabled: true });
    expect(resendInText(root)).toMatch(/через [01]:\d\d/);
    expect(visible(root, 'auth/code/resend-hint')).toBe(false);
    expect(one(root, 'auth/code/submit').props.focusable).toBe(true);
    expect(one(root, 'auth/code/change-number').props.focusable).toBe(true);
    await unmount(root);
  });

  it('after 60 s «Выслать повторно» becomes focusable and the hint appears', async () => {
    const root = await openCode();
    await advance(61_000);
    const resend = one(root, 'auth/code/resend');
    expect(resend.props.focusable).toBe(true);
    expect(resendInText(root)).toBeNull();
    expect(visible(root, 'auth/code/resend-hint')).toBe(true);
    // Never sent by itself.
    expect(requestsTo(SEND_URL)).toHaveLength(1);
    await unmount(root);
  });

  it('resend: transport=gate, countdown restarts at 1:00 and ticks, focus to the field', async () => {
    replies[SEND_URL] = [
      { status: 200, body: sendBody(CHALLENGE) },
      { status: 200, body: sendBody(CHALLENGE_2) },
    ];
    const root = await openCode();
    await advance(61_000);
    await type(root, 'auth/code/field', '11');
    focusMock.mockClear();
    await press(root, 'auth/code/resend');

    const sends = requestsTo(SEND_URL);
    expect(sends).toHaveLength(2);
    expect(sends[1][1].body).toBe(
      `phone=%2B375291234567&transport=gate&device_os=web&device_id=${DEVICE_ID}`,
    );
    expect(authFlow.getChallenge()?.challenge).toBe(CHALLENGE_2);
    expect(lastFocusTarget()).toBe('auth/code/field/host');
    expect(one(root, 'auth/code/field').props.value).toBe('');
    expect(one(root, 'auth/code/resend').props.focusable).toBe(false);
    expect(resendInText(root)).toContain('через 1:00');

    await advance(18_000);
    expect(resendInText(root)).toContain('через 0:42');
    await unmount(root);
  });

  it('resend 429 sms_gate_ratelimit → inline TooManyAttempts, focus on the field, no retry', async () => {
    replies[SEND_URL] = [
      { status: 200, body: sendBody(CHALLENGE) },
      { status: 429, body: { error: 'sms_gate_ratelimit' } },
    ];
    const root = await openCode();
    await advance(61_000);
    focusMock.mockClear();
    await press(root, 'auth/code/resend');
    expect(topScreen(root)).toBe('auth/code');
    expect(text(root)).toContain(t('error.TooManyAttempts'));
    expect(lastFocusTarget()).toBe('auth/code/field/host');
    // The failed attempt restarts the cooldown too.
    expect(one(root, 'auth/code/resend').props.focusable).toBe(false);
    expect(resendInText(root)).toContain('через 1:00');
    await advance(120_000);
    expect(requestsTo(SEND_URL)).toHaveLength(2);
    expect(authFlow.getChallenge()?.challenge).toBe(CHALLENGE);
    await unmount(root);
  });

  it('resend Network failure: inline error.Network, the countdown restarts, focus on the field', async () => {
    replies[SEND_URL] = [
      { status: 200, body: sendBody(CHALLENGE) },
      new TypeError('Network request failed'),
    ];
    const root = await openCode();
    await advance(61_000);
    focusMock.mockClear();
    await press(root, 'auth/code/resend');
    expect(text(root)).toContain(t('error.Network'));
    expect(lastFocusTarget()).toBe('auth/code/field/host');
    expect(one(root, 'auth/code/resend').props.focusable).toBe(false);
    expect(resendInText(root)).toContain('через 1:00');
    await unmount(root);
  });

  it('sentTransport "sms": the SMS copy without the generic channels line', async () => {
    replies[SEND_URL] = [
      { status: 200, body: { data: { phoneCode: { code: CHALLENGE, sentTransport: 'sms' } } } },
    ];
    const root = await openCode();
    const body = JSON.stringify(byTestId(root, 'auth/code/body')[0].toJSON?.() ?? null);
    expect(body).toContain('Код отправлен по SMS на +375 •• ••• •• 67.');
    expect(body).not.toContain(t('auth.code.channels'));
    await unmount(root);
  });

  it('masking fallback (the phone does not match the country code): generic body, no digits', async () => {
    const root = await openCode();
    await unmount(root);
    // Mount A5 again over a challenge whose phone does not start with the
    // draft's country code: maskPhone gives '' and the body falls back.
    authFlow.setDraft({ countryCode: '+7', number: '291234567' });
    authFlow.setChallenge({ phone: PHONE, challenge: CHALLENGE, sentTransport: 'gate' });
    const { CodeScreen } = jest.requireActual('../src/features/auth/CodeScreen') as typeof import('../src/features/auth/CodeScreen');
    const { NavigationContainer } = jest.requireActual('@react-navigation/native') as typeof import('@react-navigation/native');
    const second = createRoot();
    await act(async () => {
      second.render(
        <NavigationContainer>
          <CodeScreen onChangeNumber={() => {}} onSignedIn={() => {}} signIn={() => Promise.reject(new Error("unused"))} resendCode={() => Promise.reject(new Error("unused"))} />
        </NavigationContainer>,
      );
    });
    await settle();
    const body = byTestId(second, 'auth/code/body')[0].children.join('');
    expect(body).toBe(t('auth.code.body'));
    expect(body).not.toMatch(/\d/);
    await unmount(second);
  });

  it('«Готово» with an empty code sends nothing and keeps focus on the field', async () => {
    const root = await openCode();
    focusMock.mockClear();
    await type(root, 'auth/code/field', '   ');
    await submit(root, 'auth/code/field');
    await settle();
    expect(requestsTo(CONFIRM_URL)).toHaveLength(0);
    expect(lastFocusTarget()).toBe('auth/code/field/host');
    await unmount(root);
  });

  it('Back → A2 with the number kept; «Изменить номер» too', async () => {
    const root = await openCode();
    await back();
    expect(topScreen(root)).toBe('auth/phone');
    expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');
    expect(authFlow.getChallenge()).toBeNull();

    await press(root, 'auth/phone/send');
    await settle(TIMERS);
    expect(topScreen(root)).toBe('auth/code');
    await press(root, 'auth/code/change-number');
    await settle(TIMERS);
    expect(topScreen(root)).toBe('auth/phone');
    expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
    await unmount(root);
  });
});

describe('confirm and session creation', () => {
  it('success via «Готово»: confirm, E1 with the content profile, saved, then the Shell; Back exits', async () => {
    const root = await openCode();
    await type(root, 'auth/code/field', ` ${SMS_CODE} `);
    await submit(root, 'auth/code/field');
    await settle(TIMERS);

    const [confirm] = requestsTo(CONFIRM_URL);
    expect(confirm[1].method).toBe('PUT');
    expect(confirm[1].body).toBe(
      `phone=%2B375291234567&code=${CHALLENGE}&sms_code=${SMS_CODE}&device_os=web&device_id=${DEVICE_ID}`,
    );
    expect(confirm[1].headers).not.toHaveProperty('Authorization');

    const [e1] = requestsTo(E1_URL);
    expect(e1[1].method).toBe('GET');
    expect(e1[1].headers).toEqual({
      'User-Agent': CONTENT_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${ACCESS}`,
    });

    expect(JSON.parse(keychain.__values.get('boostytv.session') ?? '{}')).toMatchObject({
      v: 1,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      accountId: '1001',
    });
    expect(keychain.__values.get('boostytv.phone')).toBe(PHONE);
    expect(authFlow.getChallenge()).toBeNull();

    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'auth/code')).toBe(false);
    expect(visible(root, 'auth/phone')).toBe(false);
    expect(visible(root, 'shell/sidebar')).toBe(true);
    expect(text(root)).toContain(t('home.feed.title'));
    // Главная's initial focus: the first feed card (Story 3.1).
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[0].id}`);
    const sidebar = JSON.stringify(byTestId(root, 'shell/sidebar')[0].toJSON?.() ?? null);
    for (const personal of ['291234567', '1001', '•']) {
      expect(sidebar).not.toContain(personal);
    }
    // The sidebar, then the feed cards.
    expect(
      root.container
        .queryAll(node => node.props.focusable === true)
        .map(node => node.props.testID),
    ).toEqual([
      'nav/home',
      'nav/subs',
      'nav/settings',
      ...e5Posts().map(p => `home/feed/${p.id}`),
    ]);

    await back();
    expect(backHandler.exitApp).toHaveBeenCalled();
    await unmount(root);
  });

  it('double «Готово» and OK on «Войти» during confirm: one request; «Войти» busy', async () => {
    let release: () => void = () => {};
    const root = await openCode();
    fetchMock.mockImplementation((url: string) =>
      url === CONFIRM_URL
        ? new Promise(resolve => {
          release = () => resolve(route(url));
        })
        : route(url),
    );
    await type(root, 'auth/code/field', SMS_CODE);
    await submit(root, 'auth/code/field');
    await submit(root, 'auth/code/field');
    await press(root, 'auth/code/submit');
    expect(requestsTo(CONFIRM_URL)).toHaveLength(1);
    expect(one(root, 'auth/code/submit').props.accessibilityState).toMatchObject({ busy: true });

    await act(async () => {
      release();
    });
    await settle(TIMERS);
    expect(requestsTo(CONFIRM_URL)).toHaveLength(1);
    expect(topScreen(root)).toBe('shell');
    await unmount(root);
  });

  it('Back during confirm: the late success still opens the Shell (the session exists)', async () => {
    let release: () => void = () => {};
    const root = await openCode();
    fetchMock.mockImplementation((url: string) =>
      url === CONFIRM_URL
        ? new Promise(resolve => {
          release = () => resolve(route(url));
        })
        : route(url),
    );
    await type(root, 'auth/code/field', SMS_CODE);
    await press(root, 'auth/code/submit');
    await back();
    expect(topScreen(root)).toBe('auth/phone');
    await act(async () => {
      release();
    });
    await settle(TIMERS);
    expect(keychain.__values.has('boostytv.session')).toBe(true);
    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'auth/phone')).toBe(false);
    await unmount(root);
  });

  it('A7 wrong code: inline error.WrongCode, field cleared and focused, nothing saved, no retry', async () => {
    replies[CONFIRM_URL] = [{ status: 400, body: { error: 'invalid_sms_code' } }];
    const root = await openCode();
    await type(root, 'auth/code/field', '111111');
    focusMock.mockClear();
    await press(root, 'auth/code/submit');

    expect(topScreen(root)).toBe('auth/code');
    expect(text(root)).toContain(t('error.WrongCode'));
    expect(one(root, 'auth/code/field').props.value).toBe('');
    expect(lastFocusTarget()).toBe('auth/code/field/host');
    expect(requestsTo(CONFIRM_URL)).toHaveLength(1);
    expect(requestsTo(E1_URL)).toHaveLength(0);
    expect(keychain.__values.size).toBe(0);

    // The error clears on the next input; a new attempt is a new request.
    await type(root, 'auth/code/field', '2');
    expect(text(root)).not.toContain(t('error.WrongCode'));
    replies[CONFIRM_URL] = [{ status: 200, body: TOKENS }];
    await press(root, 'auth/code/submit');
    await settle(TIMERS);
    expect(topScreen(root)).toBe('shell');
    await unmount(root);
  });

  it.each([
    ['E1 401', { status: 401, body: { error: 'unauthorized' } } as Reply],
    ['E1 500', { status: 500, body: '' } as Reply],
    ['E1 network', new TypeError('Network request failed') as Reply],
  ])('%s: the spent challenge is cleared, A8 layout with error.Unknown, nothing saved', async (_name, reply) => {
    replies[E1_URL] = [reply];
    const root = await openCode();
    await type(root, 'auth/code/field', SMS_CODE);
    focusMock.mockClear();
    await press(root, 'auth/code/submit');
    expect(topScreen(root)).toBe('auth/code');
    expect(text(root)).toContain(t('error.Unknown'));
    expect(keychain.__values.size).toBe(0);
    expect(authFlow.getChallenge()).toBeNull();
    expect(visible(root, 'auth/code/submit')).toBe(false);
    expect(one(root, 'auth/code/new-code').props.focusable).toBe(true);
    expect(lastFocusTarget()).toBe('auth/code/new-code');
    await unmount(root);
  });

  it('post-confirm failure → «Выслать новый код» resends for the same phone and the form comes back', async () => {
    replies[E1_URL] = [{ status: 500, body: '' }, { status: 200, body: { id: 1001 } }];
    replies[SEND_URL] = [
      { status: 200, body: sendBody(CHALLENGE) },
      { status: 200, body: sendBody(CHALLENGE_2) },
    ];
    const root = await openCode();
    await type(root, 'auth/code/field', SMS_CODE);
    await press(root, 'auth/code/submit');
    await press(root, 'auth/code/new-code');
    expect(requestsTo(SEND_URL)[1][1].body).toContain('phone=%2B375291234567&transport=gate');
    expect(authFlow.getChallenge()?.challenge).toBe(CHALLENGE_2);
    expect(visible(root, 'auth/code/submit')).toBe(true);
    expect(lastFocusTarget()).toBe('auth/code/field/host');
    await unmount(root);
  });

  it('a keychain save failure (phone, then session): error.Unknown, nothing kept', async () => {
    const transient = () => Object.assign(new Error('x'), { code: 'E_KEYSTORE_ACCESS_ERROR' });
    keychain.__failNext('setGenericPassword', transient());
    keychain.__failNext('setGenericPassword', transient());
    const root = await openCode();
    await type(root, 'auth/code/field', SMS_CODE);
    await press(root, 'auth/code/submit');
    expect(topScreen(root)).toBe('auth/code');
    expect(text(root)).toContain(t('error.Unknown'));
    expect(keychain.__values.size).toBe(0);
    await unmount(root);
  });

  it.each([
    ['without access_token', { refresh_token: REFRESH, expires_in: 2592000 }],
    ['with expires_in = 300', { ...TOKENS, expires_in: 300 }],
  ])('a bad confirm body (%s): error.Unknown, no E1, nothing saved', async (_name, body) => {
    replies[CONFIRM_URL] = [{ status: 200, body }];
    const root = await openCode();
    await type(root, 'auth/code/field', SMS_CODE);
    await press(root, 'auth/code/submit');
    expect(text(root)).toContain(t('error.Unknown'));
    expect(requestsTo(E1_URL)).toHaveLength(0);
    expect(keychain.__values.size).toBe(0);
    await unmount(root);
  });

  it('confirm transport failure → error.Network', async () => {
    replies[CONFIRM_URL] = [new TypeError('Network request failed')];
    const root = await openCode();
    await type(root, 'auth/code/field', SMS_CODE);
    await press(root, 'auth/code/submit');
    expect(text(root)).toContain(t('error.Network'));
    expect(requestsTo(CONFIRM_URL)).toHaveLength(1);
    await unmount(root);
  });
});

describe('A8 (CodeExpired)', () => {
  // No verified shape maps to CodeExpired, so SessionManager is made to
  // return the kind directly to render the state.
  it('«Выслать новый код» focused, «Войти» hidden; OK → new code, form back, field cleared and focused', async () => {
    const api = jest.requireActual('../src/shared/api') as typeof import('../src/shared/api');
    const { session } = jest.requireActual('../src/app/session') as typeof import('../src/app/session');
    jest.spyOn(session, 'signIn').mockRejectedValueOnce(new api.AuthError('CodeExpired'));
    replies[SEND_URL] = [
      { status: 200, body: sendBody(CHALLENGE) },
      { status: 200, body: sendBody(CHALLENGE_2) },
    ];
    const root = await openCode();
    await type(root, 'auth/code/field', SMS_CODE);
    focusMock.mockClear();
    await press(root, 'auth/code/submit');

    expect(text(root)).toContain(t('error.CodeExpired'));
    expect(visible(root, 'auth/code/submit')).toBe(false);
    expect(visible(root, 'auth/code/resend')).toBe(false);
    expect(lastFocusTarget()).toBe('auth/code/new-code');

    await press(root, 'auth/code/new-code');
    expect(requestsTo(SEND_URL)[1][1].body).toContain('transport=gate');
    expect(visible(root, 'auth/code/submit')).toBe(true);
    expect(visible(root, 'auth/code/new-code')).toBe(false);
    expect(one(root, 'auth/code/field').props.value).toBe('');
    expect(lastFocusTarget()).toBe('auth/code/field/host');
    expect(text(root)).not.toContain(t('error.CodeExpired'));
    await unmount(root);
  });
});

describe('A8 resend lock', () => {
  it('a failed «Выслать новый код» locks it for 60 s and moves focus to the field', async () => {
    replies[E1_URL] = [{ status: 500, body: '' }];
    replies[SEND_URL] = [
      { status: 200, body: sendBody(CHALLENGE) },
      { status: 429, body: { error: 'sms_gate_ratelimit' } },
    ];
    const root = await openCode();
    await type(root, 'auth/code/field', SMS_CODE);
    await press(root, 'auth/code/submit');
    focusMock.mockClear();
    await press(root, 'auth/code/new-code');
    expect(text(root)).toContain(t('error.TooManyAttempts'));
    expect(one(root, 'auth/code/new-code').props.focusable).toBe(false);
    expect(resendInText(root)).toContain('через 1:00');
    expect(lastFocusTarget()).toBe('auth/code/field/host');
    await advance(61_000);
    expect(one(root, 'auth/code/new-code').props.focusable).toBe(true);
    expect(requestsTo(SEND_URL)).toHaveLength(2);
    await unmount(root);
  });
});

describe('startup gate', () => {
  const STORED = JSON.stringify({
    v: 1,
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresAt: 1_900_000_000_000,
    accountId: '1001',
  });

  it('shows a neutral splash with nothing focusable until restore resolves', async () => {
    let release: () => void = () => {};
    keychain.getGenericPassword.mockImplementationOnce(
      () => new Promise(resolve => {
        release = () => resolve(false);
      }),
    );
    const root = createRoot();
    await act(async () => {
      root.render(<App />);
    });
    expect(visible(root, 'app/splash')).toBe(true);
    expect(topScreen(root)).toBeUndefined();
    expect(root.container.queryAll(node => node.props.focusable === true)).toHaveLength(0);
    await act(async () => {
      release();
    });
    await settle(TIMERS);
    expect(visible(root, 'app/splash')).toBe(false);
    expect(topScreen(root)).toBe('auth/welcome');
    await unmount(root);
  });

  it('a stored session → the Shell on Главная, focus nav/home; then one background E1 (Story 2.5)', async () => {
    keychain.__values.set('boostytv.session', STORED);
    const root = await renderApp();
    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'auth/welcome')).toBe(false);
    // nav/home first; the first feed page then takes focus (Story 3.1).
    expect(focusMock.mock.calls.map(c => c[0]?.props?.testID)).toEqual([
      'nav/home',
      `home/feed/${e5Posts()[0].id}`,
    ]);
    // One E1, and Главная's E5; nothing else.
    expect(requestsTo(E1_URL)).toHaveLength(1);
    expect(requestsTo(E1_URL)[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls.map(c => c[0]).sort()).toEqual([E1_URL, E5_URL].sort());
    await unmount(root);
  });

  it('nothing stored → Welcome without «Войдите снова»', async () => {
    const root = await renderApp();
    expect(topScreen(root)).toBe('auth/welcome');
    expect(visible(root, 'auth/welcome/sign-in-again')).toBe(false);
    await unmount(root);
  });

  it('CorruptionException → the native helper deletes the file, wiped, Welcome with «Войдите снова», no crash', async () => {
    installNativeModules({ KeychainStorageReset: { deleteKeychainStorage: jest.fn().mockResolvedValue(true) } });
    keychain.__values.set('boostytv.session', STORED);
    keychain.__failNext(
      'getGenericPassword',
      Object.assign(new Error('androidx.datastore.core.CorruptionException: Unable to parse'), {
        code: 'E_UNKNOWN_ERROR',
      }),
    );
    const root = await renderApp();
    expect(topScreen(root)).toBe('auth/welcome');
    expect(visible(root, 'auth/welcome/sign-in-again')).toBe(true);
    expect(text(root)).toContain(t('auth.welcome.signInAgain'));
    expect(native.KeychainStorageReset.deleteKeychainStorage).toHaveBeenCalledTimes(1);
    expect(byTestId(root, 'auth/welcome/sign-in-again')[0].props.accessibilityLiveRegion).toBe('polite');
    expect(keychain.__values.has('boostytv.session')).toBe(false);
    await unmount(root);
  });

  it('a transient keychain error twice → Welcome without wiping (one retry)', async () => {
    keychain.__values.set('boostytv.session', STORED);
    const transient = () => Object.assign(new Error('busy'), { code: 'E_KEYSTORE_ACCESS_ERROR' });
    keychain.__failNext('getGenericPassword', transient());
    keychain.__failNext('getGenericPassword', transient());
    const root = await renderApp();
    expect(topScreen(root)).toBe('auth/welcome');
    expect(visible(root, 'auth/welcome/sign-in-again')).toBe(false);
    expect(keychain.__values.get('boostytv.session')).toBe(STORED);
    await unmount(root);
  });

  it('a transient keychain error once → the retry reads the session → the Shell', async () => {
    keychain.__values.set('boostytv.session', STORED);
    keychain.__failNext('getGenericPassword', Object.assign(new Error('busy'), { code: 'E_KEYSTORE_ACCESS_ERROR' }));
    const root = await renderApp();
    expect(topScreen(root)).toBe('shell');
    await unmount(root);
  });
});
