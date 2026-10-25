import { act, createElement } from 'react';
import { AppState } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { REFERENCE_USER_AGENT } from '../playbackApi';
import { PlaybackCheck, __setRunStateForTests } from '../PlaybackCheck';

/**
 * Story 1.6 screen flow with a fake server, a mocked keychain and a mocked
 * `Video`: find → pick → play, E9 cadence and exit write, one automatic
 * recovery by the same media id and type and a stop on the second failure,
 * the per-run request budget, the corrupted-Bearer call (direct, no
 * refresh), and no URL, query, token or title in console output.
 */

const SERVICE = 'io.github.dzmitryafanasenka.boostytv.spike.session';
const ACCESS = 'acc0'.padEnd(64, 'x');
const REFRESH = 'ref0'.padEnd(64, 'y');
const SECRET_TITLE = 'Very Private Title';
const SIGNED = (n: number, type: string) =>
  `https://vd${n}.okcdn.example/${type}/video?expires=1761&sig=SIGNED${n}SECRET`;

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

const mockSeek = jest.fn();
jest.mock('react-native-video', () => {
  const react = jest.requireActual('react');
  const Video = react.forwardRef(
    (props: Record<string, unknown>, ref: unknown) => {
      react.useImperativeHandle(ref, () => ({ seek: mockSeek }));
      return react.createElement('VideoMock', { ...props, testID: 'video' });
    },
  );
  return { __esModule: true, default: Video };
});

jest.mock('../SpikeUi', () => {
  const actual = jest.requireActual('../SpikeUi');
  const react = jest.requireActual('react');
  return {
    ...actual,
    SpikeButton: (props: Record<string, unknown>) =>
      react.createElement('SpikeButtonMock', props),
  };
});

type Req = {
  path: string;
  method: string;
  auth?: string;
  body?: string;
  headers: Record<string, string>;
};

function fakeServer() {
  const requests: Req[] = [];
  let generation = 0;
  const post = () => ({
    id: 'p1',
    hasAccess: true,
    title: SECRET_TITLE,
    user: { blogUrl: 'blog-a' },
    data: [
      {
        type: 'ok_video',
        id: 'media-1',
        title: SECRET_TITLE,
        timeCode: 40,
        duration: 600,
        playerUrls: [
          { type: 'hls', url: SIGNED(generation, 'hls') },
          { type: 'medium', url: SIGNED(generation, 'medium') },
          { type: 'dash', url: SIGNED(generation, 'dash') },
          { type: 'ultra_hd', url: '' },
        ],
      },
    ],
  });
  const fn = jest.fn(
    async (
      url: string,
      init: { method: string; headers: Record<string, string>; body?: string },
    ) => {
      const path = url.replace('https://api.boosty.to', '');
      requests.push({
        path,
        method: init.method,
        auth: init.headers.Authorization,
        body: init.body,
        headers: { ...init.headers },
      });
      const reply = (status: number, body?: unknown) => ({
        status,
        headers: {
          get: (h: string) =>
            h === 'content-type' ? 'application/json' : null,
        },
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
      });
      if (init.headers.Authorization !== `Bearer ${ACCESS}`) {
        return reply(401, { error: 'unauthorized', error_description: 'x' });
      }
      if (path.startsWith('/v1/user/subscriptions')) {
        return reply(200, { data: [{ blog: { blogUrl: 'blog-a' } }] });
      }
      if (path.startsWith('/v1/blog/blog-a/post/?')) {
        return reply(200, { data: [post()] });
      }
      if (path.startsWith('/v1/blog/blog-a/post/p1?')) {
        generation += 1;
        return reply(200, post());
      }
      if (path.startsWith('/v1/viewstat/video/media-1/timecode/')) {
        return reply(200, {});
      }
      return reply(404, { error: 'not_found' });
    },
  );
  (globalThis as { fetch: unknown }).fetch = fn;
  return { requests };
}

const all = (root: Root, id: string) =>
  root.container.queryAll(node => node.props.testID === id);
const byId = (root: Root, id: string): TestInstance => {
  const found = all(root, id);
  if (found.length === 0) {
    throw new Error(`no ${id}`);
  }
  return found[0];
};
const text = (root: Root, id: string) =>
  String(byId(root, id).props.children ?? '');

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

async function press(root: Root, id: string) {
  await act(async () => {
    await (byId(root, id).props.onPress as () => Promise<void>)();
  });
}

async function video(root: Root, event: string, payload?: unknown) {
  await act(async () => {
    (byId(root, 'video').props[event] as (e: unknown) => void)(payload);
    await Promise.resolve();
  });
  // Let the async E9/E8 calls settle.
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
}

let logSpy: jest.SpyInstance;
let mounted: Root[] = [];
beforeEach(() => {
  __setRunStateForTests(0);
  mockSeek.mockClear();
  mockStored = {
    [SERVICE]: JSON.stringify({
      v: 1,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: Math.floor(Date.now() / 1000) + 86_400,
      savedAt: Math.floor(Date.now() / 1000),
    }),
  };
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
    root.render(createElement(PlaybackCheck, { onExit: () => {} }));
  });
  return root;
}

const logged = () => logSpy.mock.calls.map(c => c.join(' ')).join('\n');

test('find, pick, play, E9 cadence, single recovery, stop, exit write, no leaks', async () => {
  const server = fakeServer();
  const root = await mount();
  expect(text(root, 'pb-status')).toContain('stored session: signed-in');
  expect(server.requests).toHaveLength(0);

  await press(root, 'pb-find');
  expect(server.requests.map(r => r.path.split('?')[0])).toEqual([
    '/v1/user/subscriptions',
    '/v1/blog/blog-a/post/',
  ]);
  expect(all(root, 'pb-pick-0')).toHaveLength(1);

  await press(root, 'pb-pick-0');
  const e8 = () =>
    server.requests.filter(r => r.path.startsWith('/v1/blog/blog-a/post/p1?'));
  expect(e8()).toHaveLength(1);
  expect(e8()[0].path).toContain('comments_limit=0&reply_limit=0');
  // HLS first, resume at the server timeCode after load.
  const v1 = byId(root, 'video');
  expect(v1.props.source).toEqual({ uri: SIGNED(1, 'hls'), type: 'm3u8' });
  expect(v1.props.source.headers).toBeUndefined();
  await video(root, 'onLoad', {
    duration: 600,
    naturalSize: { width: 1280, height: 720 },
  });
  expect(mockSeek).toHaveBeenLastCalledWith(40);
  await video(root, 'onReadyForDisplay');
  expect(logged()).toMatch(/TTFF hls \d+ ms/);
  // Source buttons: HLS, MP4 480p, DASH (empty URL skipped).
  expect(all(root, 'pb-src-hls')).toHaveLength(1);
  expect(all(root, 'pb-src-medium')).toHaveLength(1);
  expect(all(root, 'pb-src-dash')).toHaveLength(1);
  expect(all(root, 'pb-src-ultra_hd')).toHaveLength(0);

  // E9 cadence: first tick writes, then only after ≥10 s of movement.
  const e9 = () =>
    server.requests.filter(r => r.path.startsWith('/v1/viewstat/'));
  for (const t of [40.2, 41, 45, 49.9, 50.3, 52]) {
    await video(root, 'onProgress', { currentTime: t });
  }
  expect(e9().map(r => [r.method, r.body])).toEqual([
    ['PUT', 'time_code=40'],
    ['PUT', 'time_code=50'],
  ]);

  // Pause writes once.
  await press(root, 'pb-pause');
  expect(e9().map(r => r.body)).toEqual([
    'time_code=40',
    'time_code=50',
    'time_code=52',
  ]);
  await press(root, 'pb-pause');

  // Quality switch keeps the position (seek after load).
  await press(root, 'pb-src-medium');
  const v2 = byId(root, 'video');
  expect(v2.props.source.uri).toBe(SIGNED(1, 'medium'));
  // A new source reports t=0 before its seek-after-load: no E9 write, and
  // the kept position stays 52.
  await video(root, 'onProgress', { currentTime: 0 });
  expect(e9().map(r => r.body)).toEqual([
    'time_code=40',
    'time_code=50',
    'time_code=52',
  ]);
  await video(root, 'onLoad', {
    duration: 600,
    naturalSize: { width: 854, height: 480 },
  });
  expect(mockSeek).toHaveBeenLastCalledWith(52);
  await video(root, 'onProgress', { currentTime: 53 });

  // Player error → one E8 re-fetch, same media id and type, resume.
  await video(root, 'onError', {
    error: {
      errorCode: '22004',
      errorString: `Response code: 403 for ${SIGNED(1, 'medium')}`,
      errorException: `HttpDataSourceException ${SIGNED(1, 'medium')}`,
    },
  });
  expect(e8()).toHaveLength(2);
  // Default profile 'reference': the pick and the recovery E8 carry the
  // reference UA and no web-style headers.
  for (const r of e8()) {
    expect(r.headers['User-Agent']).toBe(REFERENCE_USER_AGENT);
    for (const h of ['X-App', 'X-Locale', 'Referer', 'Origin']) {
      expect(r.headers[h]).toBeUndefined();
    }
    expect(r.auth).toBe(`Bearer ${ACCESS}`);
  }
  const v3 = byId(root, 'video');
  expect(v3.props.source.uri).toBe(SIGNED(2, 'medium'));
  await video(root, 'onLoad', {
    duration: 600,
    naturalSize: { width: 854, height: 480 },
  });
  expect(mockSeek).toHaveBeenLastCalledWith(53);
  expect(text(root, 'pb-error')).toContain('<url>');
  expect(text(root, 'pb-error')).not.toContain('okcdn');

  // Second failure before playback recovered → stop, no further E8.
  await video(root, 'onError', {
    error: { errorCode: '22004', errorString: `again ${SIGNED(2, 'medium')}` },
  });
  expect(e8()).toHaveLength(2);
  expect(all(root, 'video')).toHaveLength(0);
  expect(text(root, 'pb-status')).toContain('Остановлено');

  // API counter: E2, E4, 2× E8, 3× E9.
  expect(text(root, 'pb-counts')).toBe('API: 7/150 · проб: 0');
  expect(server.requests.some(r => r.path.includes('/comment'))).toBe(false);
  expect(server.requests.some(r => r.path.includes('/oauth/'))).toBe(false);

  // No URL, query, token, title or id in console output; no URL on screen.
  const out = logged();
  for (const secret of [
    ACCESS,
    REFRESH,
    SECRET_TITLE,
    'okcdn',
    'sig=',
    'SECRET',
    'media-1',
    'blog-a',
    'Bearer ',
  ]) {
    expect(out.includes(secret)).toBe(false);
  }
  const screen = allText(root);
  for (const secret of [ACCESS, 'okcdn', 'sig=', 'SECRET']) {
    expect(screen.includes(secret)).toBe(false);
  }
  // The title may be shown on screen.
  expect(screen).toContain(SECRET_TITLE);
});

test('a recovered playback re-arms recovery; exit writes E9', async () => {
  const server = fakeServer();
  const root = await mount();
  await press(root, 'pb-find');
  await press(root, 'pb-pick-0');
  // Positions count only once the player reached the start (timeCode 40).
  await video(root, 'onProgress', { currentTime: 40 });
  await video(root, 'onProgress', { currentTime: 100 });
  await video(root, 'onError', { error: { errorString: 'x' } });
  await video(root, 'onProgress', { currentTime: 100 });
  await video(root, 'onProgress', { currentTime: 106 });
  expect(logged()).toContain('re-armed');
  await video(root, 'onError', { error: { errorString: 'y' } });
  const e8 = server.requests.filter(r =>
    r.path.startsWith('/v1/blog/blog-a/post/p1?'),
  );
  expect(e8).toHaveLength(3);
  expect(all(root, 'video')).toHaveLength(1);

  await video(root, 'onProgress', { currentTime: 108 });
  const before = server.requests.length;
  await act(async () => root.unmount());
  mounted = [];
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  const exit = server.requests.slice(before);
  expect(exit.map(r => [r.path.split('?')[0], r.body])).toEqual([
    ['/v1/viewstat/video/media-1/timecode/', 'time_code=108'],
  ]);
});

test('AppState background writes E9 with the current second; active does not', async () => {
  // The jest preset's AppState.addEventListener is already a jest.fn.
  const addListener = AppState.addEventListener as unknown as jest.Mock;
  addListener.mockClear();
  {
    const server = fakeServer();
    const root = await mount();
    const listeners = addListener.mock.calls
      .filter(([type]) => type === 'change')
      .map(([, cb]) => cb as (state: string) => void);
    await press(root, 'pb-find');
    await press(root, 'pb-pick-0');
    await video(root, 'onProgress', { currentTime: 40 });
    await video(root, 'onProgress', { currentTime: 47.6 });
    const e9 = () =>
      server.requests.filter(r =>
        r.path.startsWith('/v1/viewstat/video/media-1/timecode/'),
      );
    expect(e9().map(r => r.body)).toEqual(['time_code=40']);
    expect(listeners.length).toBeGreaterThan(0);
    const fire = async (state: string) => {
      await act(async () => {
        for (const cb of listeners) {
          cb(state);
        }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });
    };
    await fire('active');
    expect(e9()).toHaveLength(1);
    await fire('background');
    expect(e9().map(r => [r.method, r.body])).toEqual([
      ['PUT', 'time_code=40'],
      ['PUT', 'time_code=47'],
    ]);
    // Settle the exit write here so it cannot leak into the next test.
    await act(async () => root.unmount());
    mounted = [];
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
  }
});

test('budget: nothing is sent past 150 requests per app run', async () => {
  const server = fakeServer();
  __setRunStateForTests(148);
  const root = await mount();
  await press(root, 'pb-find');
  expect(server.requests).toHaveLength(0);
  expect(text(root, 'pb-counts')).toBe('API: 148/150 · проб: 0');
  expect(text(root, 'pb-status')).toContain('E2');
  expect(logged()).toContain('budget: 148/150 reached, not sent');
});

test('corrupted Bearer: one direct E8, synthetic token, no refresh', async () => {
  const server = fakeServer();
  const root = await mount();
  await press(root, 'pb-find');
  const before = server.requests.length;
  await press(root, 'pb-badtoken');
  const sent = server.requests.slice(before);
  expect(sent).toHaveLength(1);
  expect(sent[0].path).toBe(
    '/v1/blog/blog-a/post/p1?comments_limit=0&reply_limit=0',
  );
  expect(sent[0].auth).toMatch(/^Bearer [A-Za-z0-9]{64}$/);
  expect(sent[0].auth).not.toBe(`Bearer ${ACCESS}`);
  expect(text(root, 'pb-status')).toBe(
    'E8-badtoken → HTTP 401; hasAccess=- data=- error=unauthorized',
  );
  expect(text(root, 'pb-counts')).toBe('API: 3/150 · проб: 0');
  expect(logged()).not.toContain(sent[0].auth?.slice(7) ?? '?');
});
