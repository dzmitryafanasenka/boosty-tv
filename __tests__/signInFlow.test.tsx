/**
 * Story 2.2 sign-in flow through the real App (NavigationContainer + JS
 * stack): A1 → A2 → A5, A4, A9, A10, the «Готово» rule, focus targets and
 * Back. `fetch`, the InstallId native module, BackHandler and the native
 * focus command are faked; native focus itself is a device check.
 */
import { act } from 'react';
import { type Root } from 'test-renderer';
import App from '../src/app/App';
import { authFlow } from '../src/features/auth/authFlow';
import { t } from '../src/shared/i18n';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  installNativeModules,
  lastFocusTarget,
  topScreen as topScreenOf,
  unmount,
  visible,
} from '../src/test/flow';

jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

const DEVICE_ID = '3f0c2a8e-1b7d-4c3a-9e2f-5a6b7c8d9e0f';
const CHALLENGE = 'c'.repeat(64);
const OK_BODY = {
  data: { phoneCode: { code: CHALLENGE, expiresIn: 604800, phone: '+375291234567', sentTransport: 'gate' } },
};

const focusMock = requestHostFocus as jest.Mock;
const fetchMock = jest.fn();

/** Two rounds; timers run in both unless a call turns them off. */
const { settle, render, one, press, type, submit, back } = createFlow({
  settle: { rounds: 2, timerRounds: 2 },
  one: 'focusableOrInput',
  pressFocuses: false,
  submitSettles: false,
});

function respond(status: number, body: unknown) {
  return Promise.resolve({
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  // The logger prints in __DEV__; keep the test output readable.
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  focusMock.mockClear();
  backHandler.reset();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  installNativeModules({ InstallId: { getOrCreate: jest.fn().mockResolvedValue(DEVICE_ID) } });
});

afterEach(() => {
  clearNativeModules();
  authFlow.reset();
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);

/** Topmost stack screen (the JS stack keeps covered screens mounted). */
function topScreen(root: Root): string | undefined {
  return topScreenOf(root, ['auth/welcome', 'auth/phone', 'auth/phone/too-many-attempts', 'auth/phone/verification-required', 'auth/code']);
}

async function openPhone() {
  const root = await renderApp();
  await press(root, 'auth/welcome/signin');
  return root;
}

describe('A1 → A2', () => {
  it('A1 OK opens A2 with focus on the number field and +7 in the country code', async () => {
    const root = await openPhone();
    expect(topScreen(root)).toBe('auth/phone');
    expect(one(root, 'auth/phone/country').props.value).toBe('+7');
    expect(one(root, 'auth/phone/number').props.value).toBe('');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');

    const text = JSON.stringify(root.container.toJSON());
    for (const key of ['auth.phone.step', 'auth.phone.title', 'auth.phone.body', 'auth.phone.send', 'auth.phone.back'] as const) {
      expect(text).toContain(t(key));
    }
    await unmount(root);
  });

  it('fields are plain text, phone-pad, with labels', async () => {
    const root = await openPhone();
    for (const [id, label] of [
      ['auth/phone/country', t('auth.phone.countryLabel')],
      ['auth/phone/number', t('auth.phone.numberLabel')],
    ] as const) {
      const field = one(root, id);
      expect(field.props.secureTextEntry).toBeFalsy();
      expect(field.props.accessibilityLabel).toBe(label);
      expect(field.props.keyboardType).toBe('phone-pad');
    }
    // The ↓ / ↑ routing (focus guide destinations) is native-only: the
    // guide does not pass `destinations` to its host view, and the command
    // runs only on TV. Verified on the device (docs/testing.md, Story 2.2).
    await unmount(root);
  });

  it('Back on A2 → A1 with «Войти в Boosty» focused', async () => {
    const root = await openPhone();
    focusMock.mockClear();
    await back();
    expect(topScreen(root)).toBe('auth/welcome');
    expect(lastFocusTarget()).toBe('auth/welcome/signin');
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('«Назад» → A1 and the draft is forgotten', async () => {
    const root = await openPhone();
    await type(root, 'auth/phone/number', '291234567');
    await press(root, 'auth/phone/back');
    expect(topScreen(root)).toBe('auth/welcome');
    expect(lastFocusTarget()).toBe('auth/welcome/signin');
    expect(authFlow.getDraft()).toEqual({ countryCode: '+7', number: '' });
    await unmount(root);
  });
});

describe('phone input', () => {
  it('the country code keeps + and digits only', async () => {
    const root = await openPhone();
    await type(root, 'auth/phone/country', '+3a75');
    expect(one(root, 'auth/phone/country').props.value).toBe('+375');
    await type(root, 'auth/phone/country', '');
    expect(one(root, 'auth/phone/country').props.value).toBe('+');
    await unmount(root);
  });

  it.each([
    ['too short', '+7', '123456'],
    ['too long', '+1', '234567890123456'],
    ['empty', '+7', ''],
  ])('A4 (%s): field error, no request, focus on the number field', async (_n, cc, number) => {
    const root = await openPhone();
    await type(root, 'auth/phone/country', cc);
    await type(root, 'auth/phone/number', number);
    focusMock.mockClear();
    await press(root, 'auth/phone/send');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastFocusTarget()).toBe('auth/phone/number/host');
    const error = byTestId(root, 'auth/phone/number/error');
    expect(error).toHaveLength(1);
    expect(JSON.stringify(error[0].toJSON?.() ?? root.container.toJSON())).toContain(t('error.InvalidPhone'));
    expect(one(root, 'auth/phone/number').props.accessibilityHint).toBe(t('error.InvalidPhone'));

    // The error clears on the next input.
    await type(root, 'auth/phone/number', `${number}1`);
    expect(byTestId(root, 'auth/phone/number/error')).toHaveLength(0);
    await unmount(root);
  });

  it('«Готово» moves focus to «Получить код» if valid, otherwise back to the field', async () => {
    const root = await openPhone();
    await type(root, 'auth/phone/number', '91624');
    focusMock.mockClear();
    await submit(root, 'auth/phone/number');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');

    await type(root, 'auth/phone/country', '');
    await submit(root, 'auth/phone/country');
    expect(lastFocusTarget()).toBe('auth/phone/country/host');

    await type(root, 'auth/phone/country', '+375');
    await type(root, 'auth/phone/number', ' 29 123-45-67 ');
    await submit(root, 'auth/phone/number');
    expect(lastFocusTarget()).toBe('auth/phone/send');
    expect(fetchMock).not.toHaveBeenCalled();
    await unmount(root);
  });
});

describe('send', () => {
  async function phoneWithValidNumber() {
    const root = await openPhone();
    await type(root, 'auth/phone/country', '+375');
    await type(root, 'auth/phone/number', '291234567');
    return root;
  }

  it('valid send: busy, one request, then A5; the challenge is held in memory only', async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise(resolve => {
        release = resolve;
      }),
    );
    const root = await phoneWithValidNumber();
    await press(root, 'auth/phone/send');

    expect(one(root, 'auth/phone/send').props.accessibilityState).toMatchObject({ busy: true });
    expect(visible(root, 'auth/phone/send/spinner')).toBe(true);
    // Two more OKs while in flight: still one request.
    await press(root, 'auth/phone/send');
    await press(root, 'auth/phone/send');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.boosty.to/auth/phone/verification_code/send');
    expect(init.body).toBe(`phone=%2B375291234567&device_os=web&device_id=${DEVICE_ID}`);
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.credentials).toBe('omit');

    await act(async () => {
      release(await respond(200, OK_BODY));
    });
    await settle();

    expect(topScreen(root)).toBe('auth/code');
    expect(authFlow.getChallenge()).toEqual({
      phone: '+375291234567',
      challenge: CHALLENGE,
      sentTransport: 'gate',
      expiresIn: 604800,
    });
    const text = JSON.stringify(root.container.toJSON());
    expect(text).toContain(t('auth.code.title'));
    expect(text).toContain(t('auth.code.step'));
    expect(text).not.toContain(CHALLENGE);
    // A5 initial focus is the code field (Story 2.3: __tests__/codeFlow.test.tsx).
    expect(lastFocusTarget()).toBe('auth/code/field/host');
    await unmount(root);
  });

  it('A5 Back → A2 with the number kept, focus on the number; the challenge is cleared', async () => {
    fetchMock.mockImplementation(() => respond(200, OK_BODY));
    const root = await phoneWithValidNumber();
    await press(root, 'auth/phone/send');
    expect(topScreen(root)).toBe('auth/code');

    focusMock.mockClear();
    await back();
    expect(topScreen(root)).toBe('auth/phone');
    expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
    expect(one(root, 'auth/phone/country').props.value).toBe('+375');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');
    expect(authFlow.getChallenge()).toBeNull();

    // Then Back again → A1, focus on «Войти в Boosty».
    await back();
    expect(topScreen(root)).toBe('auth/welcome');
    expect(lastFocusTarget()).toBe('auth/welcome/signin');
    await unmount(root);
  });

  it('A5 «Изменить номер» → A2 with the number kept', async () => {
    fetchMock.mockImplementation(() => respond(200, OK_BODY));
    const root = await phoneWithValidNumber();
    await press(root, 'auth/phone/send');
    await press(root, 'auth/code/change-number');
    expect(topScreen(root)).toBe('auth/phone');
    expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
    await unmount(root);
  });

  it('429 sms_gate_ratelimit → A9, «Изменить номер» focused, no retry; → A2 with the number kept', async () => {
    fetchMock.mockImplementation(() =>
      respond(429, { error: 'sms_gate_ratelimit', error_description: 'To many attempts' }),
    );
    const root = await phoneWithValidNumber();
    await press(root, 'auth/phone/send');

    expect(topScreen(root)).toBe('auth/phone/too-many-attempts');
    const text = JSON.stringify(root.container.toJSON());
    expect(text).toContain(t('error.TooManyAttempts'));
    expect(text).not.toMatch(/\d:\d\d/); // no countdown
    expect(one(root, 'auth/phone/change-number').props.hasTVPreferredFocus).toBe(true);
    expect(lastFocusTarget()).toBe('auth/phone/change-number');
    expect(one(root, 'auth/phone/to-welcome').props.hasTVPreferredFocus).toBeFalsy();

    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    focusMock.mockClear();
    await press(root, 'auth/phone/change-number');
    expect(topScreen(root)).toBe('auth/phone');
    expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('Back on A9 → the A2 form; «На первый экран» → A1', async () => {
    fetchMock.mockImplementation(() => respond(429, { error: 'sms_gate_ratelimit' }));
    const root = await phoneWithValidNumber();
    await press(root, 'auth/phone/send');
    await back();
    expect(topScreen(root)).toBe('auth/phone');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');

    await press(root, 'auth/phone/send');
    expect(topScreen(root)).toBe('auth/phone/too-many-attempts');
    await press(root, 'auth/phone/to-welcome');
    expect(topScreen(root)).toBe('auth/welcome');
    await unmount(root);
  });

  it.each([
    ['fetch rejects', () => Promise.reject(new TypeError('Network request failed'))],
  ])('Network (%s): error.Network on A2, focus «Получить код», no retry', async (_n, impl) => {
    fetchMock.mockImplementation(impl);
    const root = await phoneWithValidNumber();
    focusMock.mockClear();
    await press(root, 'auth/phone/send');

    expect(topScreen(root)).toBe('auth/phone');
    expect(JSON.stringify(byTestId(root, 'auth/phone/error')[0].toJSON?.() ?? root.container.toJSON())).toContain(
      t('error.Network'),
    );
    expect(lastFocusTarget()).toBe('auth/phone/send');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('timeout after 30 s → error.Network', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    );
    const root = await phoneWithValidNumber();
    await press(root, 'auth/phone/send', { settle: { timerRounds: 0 } });
    expect(one(root, 'auth/phone/send').props.accessibilityState).toMatchObject({ busy: true });

    await act(async () => {
      jest.advanceTimersByTime(29_999);
    });
    await settle({ timerRounds: 0 });
    expect(one(root, 'auth/phone/send').props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await settle();
    expect(JSON.stringify(root.container.toJSON())).toContain(t('error.Network'));
    expect(one(root, 'auth/phone/send').props.accessibilityState).toMatchObject({ busy: false });
    await unmount(root);
  });

  it.each([
    ['400 with another error', 400, { error: 'invalid_phone' }],
    ['500', 500, ''],
    ['200 without code', 200, { data: { phoneCode: {} } }],
    ['captcha hint', 403, { error: 'captcha_required' }],
  ])('Unknown (%s): generic copy, focus «Получить код»', async (_n, status, body) => {
    fetchMock.mockImplementation(() => respond(status, body));
    const root = await phoneWithValidNumber();
    focusMock.mockClear();
    await press(root, 'auth/phone/send');

    expect(topScreen(root)).toBe('auth/phone');
    expect(JSON.stringify(root.container.toJSON())).toContain(t('error.Unknown'));
    expect(lastFocusTarget()).toBe('auth/phone/send');
    expect(visible(root, 'auth/phone/verification-required')).toBe(false);
    await unmount(root);
  });

  it('Back while sending: the late result opens nothing', async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise(resolve => {
        release = resolve;
      }),
    );
    const root = await phoneWithValidNumber();
    await press(root, 'auth/phone/send');
    await back();
    expect(topScreen(root)).toBe('auth/welcome');

    await act(async () => {
      release(await respond(200, OK_BODY));
    });
    await settle();
    expect(topScreen(root)).toBe('auth/welcome');
    expect(authFlow.getChallenge()).toBeNull();
    await unmount(root);
  });
});

describe('A10 (VerificationRequired)', () => {
  // No verified captcha shape maps to A10, so the client is made to return
  // the kind directly to render the state.
  async function openA10(results: Array<'VerificationRequired' | 'ok'>) {
    const api = jest.requireActual('../src/shared/api') as typeof import('../src/shared/api');
    const { session } = jest.requireActual('../src/app/session') as typeof import('../src/app/session');
    const spy = jest.spyOn(session.authApi, 'sendCode');
    for (const result of results) {
      if (result === 'ok') {
        spy.mockResolvedValueOnce({ challenge: CHALLENGE });
      } else {
        spy.mockRejectedValueOnce(new api.AuthError('VerificationRequired'));
      }
    }
    const root = await openPhone();
    await type(root, 'auth/phone/country', '+375');
    await type(root, 'auth/phone/number', '291234567');
    await press(root, 'auth/phone/send');
    return { root, spy };
  }

  it('renders A10 with «Попробовать снова» focused; one retry only', async () => {
    const { root, spy } = await openA10(['VerificationRequired', 'VerificationRequired']);
    expect(topScreen(root)).toBe('auth/phone/verification-required');
    expect(JSON.stringify(root.container.toJSON())).toContain(t('error.VerificationRequired'));
    expect(one(root, 'auth/phone/retry').props.hasTVPreferredFocus).toBe(true);
    expect(lastFocusTarget()).toBe('auth/phone/retry');

    await press(root, 'auth/phone/retry');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(topScreen(root)).toBe('auth/phone/verification-required');
    expect(byTestId(root, 'auth/phone/retry')).toHaveLength(0);
    expect(one(root, 'auth/phone/change-number').props.hasTVPreferredFocus).toBe(true);
    expect(lastFocusTarget()).toBe('auth/phone/change-number');

    await back();
    expect(topScreen(root)).toBe('auth/phone');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');
    await unmount(root);
  });

  it('a successful retry opens A5; Back → the A2 form with the number kept and focused', async () => {
    const { root } = await openA10(['VerificationRequired', 'ok']);
    await press(root, 'auth/phone/retry');
    expect(topScreen(root)).toBe('auth/code');
    expect(visible(root, 'auth/phone/verification-required')).toBe(false);
    expect(authFlow.getChallenge()).toMatchObject({ phone: '+375291234567', challenge: CHALLENGE });

    focusMock.mockClear();
    await back();
    expect(topScreen(root)).toBe('auth/phone');
    expect(visible(root, 'auth/phone/verification-required')).toBe(false);
    expect(one(root, 'auth/phone/number').props.value).toBe('291234567');
    expect(lastFocusTarget()).toBe('auth/phone/number/host');
    await unmount(root);
  });

  it('a retry that fails with Network → A2 form, error.Network, focus «Получить код»', async () => {
    const api = jest.requireActual('../src/shared/api') as typeof import('../src/shared/api');
    const { root, spy } = await openA10(['VerificationRequired']);
    spy.mockRejectedValueOnce(new api.AuthError('Network'));
    focusMock.mockClear();
    await press(root, 'auth/phone/retry');
    expect(topScreen(root)).toBe('auth/phone');
    expect(JSON.stringify(root.container.toJSON())).toContain(t('error.Network'));
    expect(lastFocusTarget()).toBe('auth/phone/send');
    await unmount(root);
  });

  it('a later A10 offers the retry again', async () => {
    const { root } = await openA10(['VerificationRequired', 'VerificationRequired', 'VerificationRequired']);
    await press(root, 'auth/phone/retry');
    expect(byTestId(root, 'auth/phone/retry')).toHaveLength(0);
    await press(root, 'auth/phone/change-number');
    expect(topScreen(root)).toBe('auth/phone');
    await press(root, 'auth/phone/send');
    expect(topScreen(root)).toBe('auth/phone/verification-required');
    expect(one(root, 'auth/phone/retry').props.hasTVPreferredFocus).toBe(true);
    await unmount(root);
  });
});
