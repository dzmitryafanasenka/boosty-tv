import { act, createElement } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import {
  corruptToken,
  randomUuidV4,
  SessionRefreshCheck,
} from '../SessionRefreshCheck';

/**
 * Story 1.4 screen flow with a fake server and a mocked keychain: the matrix
 * runs in the decided order, each scenario once, and logout leaves the store
 * empty with the device_id unchanged. Fake values only; asserts no token or
 * device id reaches console output or rendered text.
 */

const SERVICE = 'io.github.dzmitryafanasenka.boostytv.spike.session';
const DEVICE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const tok = (kind: string, n: number) => `${kind}${n}`.padEnd(64, 'x');

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
  readInstallIdUncached: jest.fn(
    async () => '0f8fad5b-d9cb-469f-a165-70867728950e',
  ),
  keychainStorageReset: { deleteKeychainStorage: jest.fn(async () => true) },
}));

jest.mock('../SpikeUi', () => {
  const actual = jest.requireActual('../SpikeUi');
  const react = jest.requireActual('react');
  return {
    ...actual,
    SpikeButton: (props: Record<string, unknown>) =>
      react.createElement('SpikeButtonMock', props),
  };
});

/** Rotating fake server: each refresh invalidates the used refresh token. */
function fakeServer() {
  let n = 0;
  const access = new Set([tok('acc', 0)]);
  const refresh = new Set([tok('ref', 0)]);
  const calls: Array<{ path: string; deviceId?: string }> = [];
  const issued: string[] = [tok('acc', 0), tok('ref', 0)];
  const fn = jest.fn(
    async (
      url: string,
      init: { body?: string; headers: Record<string, string> },
    ) => {
      const path = url.replace('https://api.boosty.to', '');
      const reply = (status: number, body: unknown) => ({
        status,
        headers: {
          get: (h: string) =>
            h === 'content-type' ? 'application/json' : null,
        },
        text: async () => JSON.stringify(body),
      });
      if (path === '/oauth/token/') {
        const form = new URLSearchParams(init.body);
        calls.push({ path, deviceId: form.get('device_id') ?? undefined });
        const used = form.get('refresh_token') ?? '';
        if (!refresh.has(used)) {
          return reply(400, { error: 'invalid_grant' });
        }
        refresh.delete(used);
        n += 1;
        access.add(tok('acc', n));
        refresh.add(tok('ref', n));
        issued.push(tok('acc', n), tok('ref', n));
        return reply(200, {
          access_token: tok('acc', n),
          refresh_token: tok('ref', n),
          expires_in: 2_592_000,
        });
      }
      calls.push({ path });
      const bearer = init.headers.Authorization?.replace('Bearer ', '');
      return access.has(bearer ?? '')
        ? reply(200, { id: 1 })
        : reply(401, { error: 'unauthorized' });
    },
  );
  (globalThis as { fetch: unknown }).fetch = fn;
  return { calls, issued };
}

const byId = (root: Root, id: string): TestInstance => {
  const found = root.container.queryAll(node => node.props.testID === id);
  if (found.length === 0) {
    throw new Error(`no ${id}`);
  }
  return found[0];
};

function allText(root: Root): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      out.push(node);
    } else if (node && typeof node === 'object') {
      (node as { children?: unknown[] | null }).children?.forEach(walk);
    }
  };
  walk(root.container.toJSON());
  return out.join('\n');
}

const status = (root: Root) =>
  String(byId(root, 'sr-status').props.children ?? '');

async function press(root: Root, id: string) {
  await act(async () => {
    await (byId(root, id).props.onPress as () => Promise<void>)();
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

async function mount() {
  const root = createRoot();
  mounted.push(root);
  await act(async () => {
    root.render(createElement(SessionRefreshCheck, { onExit: () => {} }));
  });
  return root;
}

function seed() {
  mockStored[SERVICE] = JSON.stringify({
    v: 1,
    accessToken: tok('acc', 0),
    refreshToken: tok('ref', 0),
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
    savedAt: Math.floor(Date.now() / 1000),
  });
}

test('helpers: corruption keeps length and changes every alphanumeric', () => {
  const t = tok('acc', 7);
  const c = corruptToken(t);
  expect(c).toHaveLength(t.length);
  [...t].forEach((ch, i) => expect(c[i]).not.toBe(ch));
  expect(randomUuidV4()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test('full matrix in order, each once, then logout', async () => {
  seed();
  const server = fakeServer();
  const root = await mount();
  expect(status(root)).toContain('stored session: signed-in');
  expect(server.calls).toHaveLength(0);

  // Order is enforced.
  await press(root, 'sr-reactive');
  expect(status(root)).toContain('сначала proactive');
  expect(server.calls).toHaveLength(0);

  await press(root, 'sr-check');
  expect(status(root)).toContain('HTTP 200');

  await press(root, 'sr-proactive');
  expect(status(root)).toContain(
    'proactive: PASS — refresh requests=1, E1 requests=5, E1 200=5/5',
  );

  await press(root, 'sr-proactive');
  expect(status(root)).toContain('уже выполнено');

  await press(root, 'sr-reactive');
  expect(status(root)).toMatch(
    /reactive: PASS .*refresh requests=1, E1 requests=2/,
  );

  await press(root, 'sr-rotation');
  expect(status(root)).toContain('rotated=yes');
  expect(status(root)).toContain('old token: rejected HTTP 400');
  expect(status(root)).toContain('E1 after: HTTP 200');

  const before = server.calls.length;
  await press(root, 'sr-network');
  expect(status(root)).toMatch(/network: PASS .*stored tokens kept=true/);
  expect(server.calls.length).toBe(before);

  await press(root, 'sr-rejected');
  expect(status(root)).toMatch(/rejected: PASS .*no new request=true/);
  expect(allText(root)).toContain('restore check: E1 HTTP 200');

  await press(root, 'sr-deviceid');
  expect(status(root)).toContain(
    'device_id: refresh with a different device_id → refreshed HTTP 200',
  );
  const refreshes = server.calls.filter(c => c.path === '/oauth/token/');
  expect(refreshes.at(-1)?.deviceId).not.toBe(DEVICE);
  expect(refreshes.slice(0, -1).every(c => c.deviceId === DEVICE)).toBe(true);

  // Logout needs a second press.
  await press(root, 'sr-logout');
  expect(mockStored[SERVICE]).toBeDefined();
  await press(root, 'sr-logout');
  expect(status(root)).toMatch(
    /logout: PASS .*read back=empty.*device_id unchanged=true.*requests=0/,
  );
  expect(mockStored[SERVICE]).toBeUndefined();

  const text = `${allText(root)}\n${logSpy.mock.calls
    .map(args => args.join(' '))
    .join('\n')}`;
  for (const secret of [...server.issued, DEVICE]) {
    expect(text).not.toContain(secret);
    expect(text).not.toContain(corruptToken(secret));
  }
  expect(text).not.toMatch(/Bearer /);
});

test('no stored session: scenarios refuse without requests', async () => {
  const server = fakeServer();
  const root = await mount();
  await press(root, 'sr-proactive');
  expect(status(root)).toContain('нет сохранённой сессии');
  expect(server.calls).toHaveLength(0);
});
