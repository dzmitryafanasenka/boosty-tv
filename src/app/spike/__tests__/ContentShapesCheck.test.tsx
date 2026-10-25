import { act, createElement } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { ContentShapesCheck } from '../ContentShapesCheck';

/**
 * Story 1.5 screen flow with a fake server and a mocked keychain: one run of
 * the matrix in order, request count shown, sanitized fixtures written, a
 * second run refused. Asserts no token, raw value or URL reaches console
 * output, rendered text or a fixture file.
 */

const SERVICE = 'io.github.dzmitryafanasenka.boostytv.spike.session';
const ACCESS = 'acc0'.padEnd(64, 'x');
const REFRESH = 'ref0'.padEnd(64, 'y');
const SECRET_TITLE = 'Very Private Title';
const SECRET_URL = 'https://vd.okcdn.example/secret-signed?sig=abc';

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

const mockFiles: Record<string, string> = {};
jest.mock('../spikeNative', () => ({
  getInstallId: jest.fn(async () => '0f8fad5b-d9cb-469f-a165-70867728950e'),
  keychainStorageReset: { deleteKeychainStorage: jest.fn(async () => true) },
  spikeFiles: {
    write: jest.fn(async (name: string, text: string) => {
      mockFiles[name] = text;
      return true;
    }),
    clear: jest.fn(async () => {
      const n = Object.keys(mockFiles).length;
      for (const k of Object.keys(mockFiles)) {
        delete mockFiles[k];
      }
      return n;
    }),
  },
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

const post = (id: string, hasAccess: boolean) => ({
  id,
  int_id: 7,
  hasAccess,
  createdAt: 1_761_000_000,
  title: SECRET_TITLE,
  user: { name: 'Owner', blogUrl: 'blog-a' },
  data: hasAccess
    ? [
        {
          type: 'ok_video',
          id: 'media-1',
          duration: 600,
          playerUrls: [{ type: 'hd', url: SECRET_URL }],
        },
      ]
    : [],
  teaser: [{ type: 'image', url: SECRET_URL }],
});

function fakeServer() {
  const paths: string[] = [];
  const fn = jest.fn(
    async (url: string, init: { headers: Record<string, string> }) => {
      const path = url.replace('https://api.boosty.to', '');
      paths.push(path);
      const auth = init.headers.Authorization === `Bearer ${ACCESS}`;
      const reply = (status: number, body?: unknown) => ({
        status,
        headers: {
          get: (h: string) =>
            h === 'content-type' ? 'application/json' : null,
        },
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
      });
      if (!auth) {
        return reply(401, { error: 'unauthorized', error_description: 'x' });
      }
      if (path === '/v1/user/current') {
        return reply(200, { id: 1, name: 'Owner' });
      }
      if (path.startsWith('/v1/user/subscriptions')) {
        return reply(200, { data: [{ blog: { blogUrl: 'blog-a' } }] });
      }
      if (path.startsWith('/v1/blog/blog-a/post/?')) {
        return reply(200, { data: [post('p1', true), post('p2', false)] });
      }
      if (path.startsWith('/v1/feed/post/')) {
        return reply(200, { data: { posts: [] } });
      }
      if (path.startsWith('/v1/blog/blog-a/post/p1?')) {
        return reply(200, post('p1', true));
      }
      if (path.startsWith('/v1/blog/blog-a/post/p2?')) {
        return reply(200, post('p2', false));
      }
      if (path === '/v1/blog/blog-a') {
        return reply(200, { title: SECRET_TITLE });
      }
      if (path.endsWith('/video_stream')) {
        return reply(204);
      }
      if (path === '/v1/notification/standalone/event/') {
        return reply(200, {
          data: { notificationStandalone: { events: [{ type: 'post_new' }] } },
        });
      }
      return reply(404, { error: 'not_found' });
    },
  );
  (globalThis as { fetch: unknown }).fetch = fn;
  return { paths };
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
  String(byId(root, 'cs-status').props.children ?? '');

async function press(root: Root, id: string) {
  await act(async () => {
    await (byId(root, id).props.onPress as () => Promise<void>)();
  });
}

let logSpy: jest.SpyInstance;
let mounted: Root[] = [];
beforeEach(() => {
  mockStored = {};
  for (const k of Object.keys(mockFiles)) {
    delete mockFiles[k];
  }
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
    root.render(createElement(ContentShapesCheck, { onExit: () => {} }));
  });
  return root;
}

test('one run: matrix rows, request count, sanitized fixtures, no secrets', async () => {
  mockStored[SERVICE] = JSON.stringify({
    v: 1,
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
    savedAt: Math.floor(Date.now() / 1000),
  });
  const server = fakeServer();
  const root = await mount();
  expect(status(root)).toContain('stored session: signed-in');
  expect(server.paths).toHaveLength(0);

  await press(root, 'cs-run');
  expect(status(root)).toMatch(
    /^Готово — запросов 13\/30, фикстур записано 12\/12$/,
  );
  expect(String(byId(root, 'cs-counts').props.children)).toBe('Запросы: 13/30');
  const rows = root.container
    .queryAll(n => n.props.testID === 'cs-row')
    .map(n => String(n.props.children));
  expect(rows.map(r => r.split(':')[0])).toEqual([
    'session',
    'accessible',
    'locked',
    'live',
    'no-token',
    'missing',
    'events',
    'unknown-block',
  ]);
  expect(server.paths.some(p => p.includes('/comment'))).toBe(false);
  expect(Object.keys(mockFiles)).toContain('e8-post-accessible.json');
  expect(Object.keys(mockFiles)).not.toContain('e1-current-user.json');

  // Second run is refused without requests.
  const before = server.paths.length;
  await press(root, 'cs-run');
  expect(status(root)).toContain('Уже выполнено');
  expect(server.paths).toHaveLength(before);

  const logged = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
  const files = Object.values(mockFiles).join('\n');
  for (const haystack of [logged, allText(root), files]) {
    for (const secret of [
      ACCESS,
      REFRESH,
      SECRET_TITLE,
      SECRET_URL,
      'blog-a',
      'Bearer ',
    ]) {
      expect(haystack.includes(secret)).toBe(false);
    }
  }

  await press(root, 'cs-clear');
  expect(status(root)).toContain('удалены с устройства: 12');
  expect(Object.keys(mockFiles)).toHaveLength(0);
});

test('without a stored session the run sends nothing', async () => {
  const server = fakeServer();
  const root = await mount();
  expect(status(root)).toContain('stored session: signed-out');
  await press(root, 'cs-run');
  expect(status(root)).toContain('Нет сессии');
  expect(server.paths).toHaveLength(0);
});
