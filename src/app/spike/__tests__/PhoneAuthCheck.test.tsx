import { act, createElement } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { PhoneAuthCheck } from '../PhoneAuthCheck';

/**
 * Flow test with a mocked fetch and keychain: send → code → confirm → E1 →
 * save → «Сессия сохранена», plus captcha stop and wrong-code handling.
 * Fake values only. Also asserts that no secret reaches console output or
 * any rendered text.
 */

const PHONE_INPUT = '375291234567';
const CHALLENGE = 'challenge-abcdef';
const SMS = '481516';
const ACCESS = 'eyJfakeaccesstoken0000000000';
const REFRESH = 'fakerefreshtoken1111111111';
const SECRETS = ['291234567', CHALLENGE, SMS, ACCESS, REFRESH];

let mockStored: Record<string, string> = {};
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
    service in mockStored ? { password: mockStored[service] } : false,
  ),
  setGenericPassword: jest.fn(
    async (_u: string, password: string, { service }: { service: string }) => {
      mockStored[service] = password;
      return { storage: 'KeystoreAESGCM_NoAuth' };
    },
  ),
  resetGenericPassword: jest.fn(async ({ service }: { service: string }) => {
    delete mockStored[service];
    return true;
  }),
}));

jest.mock('../spikeNative', () => ({
  getInstallId: jest.fn(async () => '0f8fad5b-d9cb-469f-a165-70867728950e'),
  keychainStorageReset: { deleteKeychainStorage: jest.fn(async () => true) },
}));

// Host stand-in exposing onPress, so the test can press buttons.
jest.mock('../SpikeUi', () => {
  const actual = jest.requireActual('../SpikeUi');
  const react = jest.requireActual('react');
  return {
    ...actual,
    SpikeButton: (props: Record<string, unknown>) =>
      react.createElement('SpikeButtonMock', props),
  };
});

type Reply = { status: number; body: unknown };

function mockFetch(replies: Reply[]) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fn = jest.fn(
    async (url: string, init: { method: string; body?: string }) => {
      calls.push({ url, method: init.method, body: init.body });
      const reply = replies.shift();
      if (!reply) {
        throw new Error('unexpected request');
      }
      return {
        status: reply.status,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(reply.body),
      };
    },
  );
  (globalThis as { fetch: unknown }).fetch = fn;
  return calls;
}

const byId = (root: Root, id: string): TestInstance => {
  const found = root.container.queryAll(n => n.props.testID === id);
  if (found.length === 0) {
    throw new Error(`no ${id}`);
  }
  return found[0];
};

/** Rendered strings only (Text children), not input `value` props. */
function allText(root: Root): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      out.push(node);
    } else if (node && typeof node === 'object') {
      const children = (node as { children?: unknown[] | null }).children;
      children?.forEach(walk);
    }
  };
  walk(root.container.toJSON());
  return out.join('\n');
}

async function press(root: Root, id: string) {
  await act(async () => {
    await (byId(root, id).props.onPress as () => Promise<void>)();
  });
}

async function type(root: Root, id: string, text: string) {
  await act(async () => {
    (byId(root, id).props.onChangeText as (t: string) => void)(text);
  });
}

let logSpy: jest.SpyInstance;
let mounted: Root[] = [];
beforeEach(() => {
  mockStored = {};
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  for (const root of mounted) {
    await act(async () => root.unmount());
  }
  mounted = [];
  logSpy.mockRestore();
});

function consoleText() {
  return logSpy.mock.calls.map(args => args.join(' ')).join('\n');
}

function expectNoSecrets(root: Root) {
  const text = `${allText(root)}\n${consoleText()}`;
  for (const secret of SECRETS) {
    expect(text).not.toContain(secret);
  }
}

async function mount() {
  const root = createRoot();
  mounted.push(root);
  await act(async () => {
    root.render(createElement(PhoneAuthCheck, { onExit: () => {} }));
  });
  return root;
}

const sendOk: Reply = {
  status: 200,
  body: {
    data: {
      phoneCode: { code: CHALLENGE, sentTransport: 'sms', expiresIn: 300000 },
    },
  },
};

test('happy path: tokens are saved only after E1 succeeds', async () => {
  const calls = mockFetch([
    sendOk,
    {
      status: 200,
      body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 },
    },
    { status: 200, body: { id: 1, name: 'x' } },
  ]);
  const root = await mount();

  expect(byId(root, 'pa-phone').props.secureTextEntry).toBe(true);
  await type(root, 'pa-phone', PHONE_INPUT);
  expect(allText(root)).toContain('+375 •• ••• 45 67');
  await press(root, 'pa-send');
  expect(calls[0]).toMatchObject({
    method: 'POST',
    url: 'https://api.boosty.to/auth/phone/verification_code/send',
  });
  expect(allText(root)).toContain('sentTransport=sms, expiresIn=300000');
  // Masked hint on screen only; logs carry no phone digits at all.
  expect(allText(root)).toContain('Код отправлен на +375 •• ••• 45 67');
  expect(consoleText()).toContain('phone hint shown');
  expect(consoleText()).not.toMatch(/\+375|45 67|4567/);

  expect(byId(root, 'pa-code').props.secureTextEntry).toBe(true);
  await type(root, 'pa-code', SMS);
  await press(root, 'pa-confirm');
  expect(calls.map(c => c.method)).toEqual(['POST', 'PUT', 'GET']);
  expect(calls[2].url).toBe('https://api.boosty.to/v1/user/current');
  expect(allText(root)).toContain('Сессия сохранена');

  const stored = JSON.parse(
    mockStored['io.github.dzmitryafanasenka.boostytv.spike.session'],
  );
  expect(stored).toMatchObject({
    accessToken: ACCESS,
    refreshToken: REFRESH,
  });
  expectNoSecrets(root);
});

test('E1 failure: nothing is saved', async () => {
  mockFetch([
    sendOk,
    { status: 200, body: { access_token: ACCESS, refresh_token: REFRESH } },
    { status: 401, body: { error: 'unauthorized' } },
  ]);
  const root = await mount();
  await type(root, 'pa-phone', PHONE_INPUT);
  await press(root, 'pa-send');
  await type(root, 'pa-code', SMS);
  await press(root, 'pa-confirm');
  expect(allText(root)).toContain('E1 не прошёл');
  expect(Object.keys(mockStored)).toEqual([]);
  expectNoSecrets(root);
});

test('wrong code: status and shape recorded, code can be retyped, no retry', async () => {
  const calls = mockFetch([
    sendOk,
    { status: 400, body: { error: 'invalid_code', error_description: 'x' } },
  ]);
  const root = await mount();
  await type(root, 'pa-phone', PHONE_INPUT);
  await press(root, 'pa-send');
  await type(root, 'pa-code', SMS);
  await press(root, 'pa-confirm');
  expect(calls).toHaveLength(2);
  expect(allText(root)).toContain('Вход не выполнен: HTTP 400');
  expect(consoleText()).toContain('error: string = invalid_code');
  expect(byId(root, 'pa-code').props.value).toBe('');
  expectNoSecrets(root);
});

test('captcha mention stops further sign-in requests', async () => {
  const calls = mockFetch([
    { status: 403, body: { error: 'captcha_required' } },
  ]);
  const root = await mount();
  await type(root, 'pa-phone', PHONE_INPUT);
  await press(root, 'pa-send');
  expect(allText(root)).toContain('КАПЧА');
  await press(root, 'pa-send');
  expect(calls).toHaveLength(1);
});

test('resend sends transport=gate with the same phone', async () => {
  const calls = mockFetch([
    sendOk,
    { status: 429, body: { error: 'too_many' } },
  ]);
  const root = await mount();
  await type(root, 'pa-phone', PHONE_INPUT);
  await press(root, 'pa-send');
  await press(root, 'pa-resend');
  expect(calls[1].body).toContain('transport=gate');
  expect(calls[1].body).toContain('phone=%2B375291234567');
  expect(allText(root)).toContain('Код не отправлен: HTTP 429');
  expectNoSecrets(root);
});

test('invalid phone sends nothing', async () => {
  const calls = mockFetch([]);
  const root = await mount();
  await type(root, 'pa-phone', '12345');
  await press(root, 'pa-send');
  expect(calls).toHaveLength(0);
  expect(allText(root)).toContain('Номер не распознан');
});
