import { act, createElement } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import {
  AudioFilesCheck,
  __setAudioFilesRunStateForTests,
} from '../AudioFilesCheck';
import { REFERENCE_USER_AGENT } from '../playbackApi';

/**
 * Story 1.7 screen flow with a fake server, a mocked keychain, a mocked
 * `Video`, a mocked QR code and a fake XMLHttpRequest: the scan with E4
 * paging by `extra.offset`, audio pick → play `url + signedQuery`, one E8
 * re-resolve on a player error and a stop on the second, file pick → QR,
 * the status-only probe, the budget, and no URL, `signedQuery` value, title
 * or id in console output.
 */

const SERVICE = 'io.github.dzmitryafanasenka.boostytv.spike.session';
const ACCESS = 'acc0'.padEnd(64, 'x');
const REFRESH = 'ref0'.padEnd(64, 'y');
const AUDIO_TITLE = 'Very Private Track';
const FILE_TITLE = 'Very Private Document';
const POST_TITLE = 'Very Private Post';
const AUDIO_URL = 'https://cdn.example.invalid/audio/track-a1.mp3';
const FILE_URL = 'https://cdn.example.invalid/file/doc-f1.pdf';
const SQ = (n: number) => `?expires=176140000${n}&sig=SQSECRET${n}VALUE`;
const OFFSET = 'cursor:secret:1';

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

jest.mock('react-native-qrcode-svg', () => {
  const react = jest.requireActual('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      react.createElement('QRMock', { ...props, testID: 'qr' }),
  };
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
  headers: Record<string, string>;
};

function fakeServer() {
  const requests: Req[] = [];
  let generation = 0;
  const richPost = () => ({
    id: 'p-rich',
    title: POST_TITLE,
    hasAccess: true,
    signedQuery: SQ(generation),
    user: { blogUrl: 'blog-a' },
    data: [
      {
        type: 'audio_file',
        id: 'a-1',
        url: AUDIO_URL,
        title: AUDIO_TITLE,
        duration: 245,
      },
      { type: 'file', id: 'f-1', url: FILE_URL, title: FILE_TITLE, size: 3e6 },
    ],
  });
  const lockedPost = {
    id: 'p-locked',
    hasAccess: false,
    signedQuery: '',
    user: { blogUrl: 'blog-a' },
    data: [],
    teaser: [{ type: 'image', url: 'https://img.example.invalid/t.jpg' }],
  };
  const fn = jest.fn(
    async (
      url: string,
      init: { method: string; headers: Record<string, string> },
    ) => {
      const path = url.replace('https://api.boosty.to', '');
      requests.push({
        path,
        method: init.method,
        auth: init.headers.Authorization,
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
        return reply(200, {
          data: [
            { blog: { blogUrl: 'blog-a' } },
            { blog: { blogUrl: 'blog-b' } },
          ],
        });
      }
      if (path.startsWith('/v1/blog/blog-a/post/?')) {
        if (!path.includes('offset=')) {
          return reply(200, {
            data: [lockedPost],
            extra: { offset: OFFSET, isLast: false },
          });
        }
        return reply(200, {
          data: [richPost()],
          extra: { offset: 'cursor:secret:2', isLast: true },
        });
      }
      if (path.startsWith('/v1/blog/blog-b/post/?')) {
        return reply(200, { data: [], extra: { isLast: true } });
      }
      if (path.startsWith('/v1/blog/blog-a/post/p-rich?')) {
        generation += 1;
        return reply(200, richPost());
      }
      return reply(404, { error: 'not_found' });
    },
  );
  (globalThis as { fetch: unknown }).fetch = fn;
  return { requests };
}

/** Fake XHR: answers 206 audio/mpeg with Content-Range, records aborts. */
const xhrLog: Array<{ url: string; headers: Record<string, string> }> = [];
let aborts = 0;
class FakeXhr {
  readyState = 0;
  status = 0;
  withCredentials = true;
  responseText = 'BODY-MUST-NOT-BE-READ';
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private url = '';
  private headers: Record<string, string> = {};
  open(_m: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    if (name === 'Content-Type') {
      return 'audio/mpeg; name="secret.mp3"';
    }
    return name === 'Content-Range' ? 'bytes 0-0/3000000' : null;
  }
  send() {
    xhrLog.push({ url: this.url, headers: { ...this.headers } });
    setTimeout(() => {
      this.readyState = 2;
      this.status = 206;
      this.onreadystatechange?.();
    }, 0);
  }
  abort() {
    aborts += 1;
  }
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

const settle = () =>
  act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });

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
  await settle();
}

let logSpy: jest.SpyInstance;
let mounted: Root[] = [];
const realXhr = (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest;
beforeEach(() => {
  __setAudioFilesRunStateForTests(0);
  mockSeek.mockClear();
  xhrLog.length = 0;
  aborts = 0;
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
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
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = realXhr;
});

async function mount() {
  const root = createRoot();
  mounted.push(root);
  await act(async () => {
    root.render(createElement(AudioFilesCheck, { onExit: () => {} }));
  });
  return root;
}

const logged = () => logSpy.mock.calls.map(c => c.join(' ')).join('\n');

test('scan with offset paging, audio play + single re-resolve, file QR, probe, no leaks', async () => {
  const server = fakeServer();
  const root = await mount();
  expect(text(root, 'af-status')).toContain('stored session: signed-in');
  expect(server.requests).toHaveLength(0);

  // Scan: E2, blog-a page 1, page 2 with the returned offset, blog-b page 1.
  await press(root, 'af-find');
  expect(server.requests.map(r => r.path)).toEqual([
    '/v1/user/subscriptions?limit=30&with_follow=true',
    '/v1/blog/blog-a/post/?limit=20&comments_limit=0&reply_limit=0',
    `/v1/blog/blog-a/post/?limit=20&comments_limit=0&reply_limit=0&offset=${encodeURIComponent(
      OFFSET,
    )}`,
    '/v1/blog/blog-b/post/?limit=20&comments_limit=0&reply_limit=0',
  ]);
  expect(all(root, 'af-audio-0')).toHaveLength(1);
  expect(all(root, 'af-file-0')).toHaveLength(1);
  expect(text(root, 'af-status')).toContain('audio_file: 1');
  expect(text(root, 'af-status')).toContain('file: 1');

  // Pick audio: fresh E8 with the reference profile; plays url + signedQuery.
  await press(root, 'af-audio-0');
  const e8 = () =>
    server.requests.filter(r =>
      r.path.startsWith('/v1/blog/blog-a/post/p-rich?'),
    );
  expect(e8()).toHaveLength(1);
  expect(e8()[0].path).toContain('comments_limit=0&reply_limit=0');
  expect(e8()[0].headers['User-Agent']).toBe(REFERENCE_USER_AGENT);
  for (const h of ['X-App', 'X-Locale', 'Referer', 'Origin']) {
    expect(e8()[0].headers[h]).toBeUndefined();
  }
  const v1 = byId(root, 'video');
  expect(v1.props.source).toEqual({ uri: `${AUDIO_URL}${SQ(1)}` });
  await video(root, 'onLoad', { duration: 245, audioTracks: [{}] });
  expect(logged()).toContain('load audio duration=245');
  expect(logged()).toContain('expiry: expires past timestamp');
  // Post-level signedQuery facts per E4 page, shapes only.
  expect(logged()).toContain(
    'E4 blog #1 page #2 signedQuery: accessible=1 nonEmpty=1 withExpiry=1 ' +
      'shapes=1 [{lead=qmark query=[expires:digits(10),sig:opaque(14)] flags=[]}] ' +
      'expiry=expires:- past=1',
  );

  // Seek ±10 s from the buttons.
  await video(root, 'onProgress', { currentTime: 30 });
  await press(root, 'af-fwd10');
  expect(mockSeek).toHaveBeenLastCalledWith(40);
  await press(root, 'af-back10');
  expect(mockSeek).toHaveBeenLastCalledWith(30);
  await video(root, 'onSeek', { currentTime: 30 });

  // Pause / play.
  await press(root, 'af-pause');
  expect(byId(root, 'video').props.paused).toBe(true);
  await press(root, 'af-pause');
  expect(byId(root, 'video').props.paused).toBe(false);

  // Player error → one E8 re-resolve (same block id), fresh signedQuery,
  // resume at the last position.
  await video(root, 'onError', {
    error: {
      errorCode: '22004',
      errorString: `Response code: 403 for ${AUDIO_URL}${SQ(1)}`,
    },
  });
  expect(e8()).toHaveLength(2);
  expect(byId(root, 'video').props.source.uri).toBe(`${AUDIO_URL}${SQ(2)}`);
  expect(logged()).toContain('matched by id');
  mockSeek.mockClear();
  await video(root, 'onLoad', { duration: 245 });
  expect(mockSeek).toHaveBeenCalledWith(30);
  // The new source reports t=0 before its seek-after-load: ignored.
  await video(root, 'onProgress', { currentTime: 0 });
  expect(text(root, 'af-info')).toContain('0:30 / 4:05');
  expect(text(root, 'af-error')).not.toContain('example');

  // Second failure → stop, no further E8.
  await video(root, 'onError', { error: { errorString: 'again' } });
  expect(e8()).toHaveLength(2);
  expect(all(root, 'video')).toHaveLength(0);
  expect(text(root, 'af-status')).toContain('Аудио остановлено');

  // File: fresh E8, QR carries url + signedQuery; nothing downloaded.
  await press(root, 'af-file-0');
  expect(e8()).toHaveLength(3);
  expect(byId(root, 'qr').props.value).toBe(`${FILE_URL}${SQ(3)}`);

  // Probe: status only, Range 0-0, aborted, body never read.
  await act(async () => {
    const p = (byId(root, 'af-probe').props.onPress as () => Promise<void>)();
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    await p;
  });
  expect(xhrLog.map(x => x.url)).toEqual([
    `${AUDIO_URL}${SQ(2)}`,
    `${FILE_URL}${SQ(3)}`,
  ]);
  for (const x of xhrLog) {
    expect(x.headers).toEqual({ Range: 'bytes=0-0' });
  }
  expect(aborts).toBe(2);
  expect(logged()).toContain(
    'probe audio (Range 0-0, age 0 min) → HTTP 206 type=audio/mpeg contentRange=true',
  );
  expect(text(root, 'af-counts')).toBe('API: 7/100 · проб: 2');

  // No mutations and no comments endpoint.
  expect(server.requests.every(r => r.method === 'GET')).toBe(true);
  expect(server.requests.some(r => r.path.includes('/comment'))).toBe(false);
  expect(server.requests.some(r => r.path.includes('/viewstat/'))).toBe(false);

  // No URL, signedQuery value, cursor, title, id or token in console output.
  const out = logged();
  for (const secret of [
    ACCESS,
    REFRESH,
    AUDIO_TITLE,
    FILE_TITLE,
    POST_TITLE,
    'cdn.example',
    'track-a1',
    'doc-f1',
    'SQSECRET',
    '176140000',
    'cursor:secret',
    'p-rich',
    'blog-a',
    'a-1',
    'f-1',
    'Bearer ',
    'BODY-MUST-NOT-BE-READ',
    'secret.mp3',
  ]) {
    expect(out.includes(secret)).toBe(false);
  }
  // On screen: titles yes, URLs and signedQuery no (the URL is in the QR only).
  const screen = allText(root);
  expect(screen).toContain(AUDIO_TITLE);
  expect(screen).toContain(FILE_TITLE);
  for (const secret of ['cdn.example', 'SQSECRET', ACCESS]) {
    expect(screen.includes(secret)).toBe(false);
  }
});

test('empty signedQuery: the bare url is played and recorded', async () => {
  fakeServer();
  const fetchMock = (globalThis as unknown as { fetch: jest.Mock }).fetch;
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init: never) => {
    const r = await original(url, init);
    if (!url.includes('/post/')) {
      return r;
    }
    const body = JSON.parse(await r.text());
    const strip = (p: Record<string, unknown>) => ({ ...p, signedQuery: '' });
    // E4 pages wrap posts in `data[]`; E8 returns the post at the top level.
    const next = url.includes('/post/?')
      ? { ...body, data: body.data.map(strip) }
      : strip(body);
    return { ...r, text: async () => JSON.stringify(next) };
  });
  const root = await mount();
  await press(root, 'af-find');
  await press(root, 'af-audio-0');
  expect(byId(root, 'video').props.source.uri).toBe(AUDIO_URL);
  expect(logged()).toContain('signedQuery audio: empty');
  expect(logged()).toContain('signedQuery audio empty → bare url');
  expect(logged()).toContain('no expiry field (unverified)');
});

test('no sample: recorded per kind', async () => {
  const server = fakeServer();
  const fetchMock = (globalThis as unknown as { fetch: jest.Mock }).fetch;
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init: never) => {
    if (url.includes('/blog/blog-a/post/?')) {
      return original(url.replace('blog-a', 'blog-b'), init);
    }
    return original(url, init);
  });
  const root = await mount();
  await press(root, 'af-find');
  expect(server.requests).toHaveLength(3);
  expect(text(root, 'af-status')).toContain('audio_file: no sample');
  expect(text(root, 'af-status')).toContain('file: no sample');
});

test('a failed E4 page makes the scan incomplete, not «no sample»', async () => {
  fakeServer();
  const fetchMock = (globalThis as unknown as { fetch: jest.Mock }).fetch;
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init: never) => {
    if (url.includes('/blog/blog-a/post/?')) {
      const r = await original(url.replace('blog-a', 'blog-b'), init);
      return { ...r, status: 500 };
    }
    return original(url, init);
  });
  const root = await mount();
  await press(root, 'af-find');
  const status = text(root, 'af-status');
  expect(status).toContain('Скан неполный (ошибок E4: 1, бюджет: ok)');
  expect(status).toContain('audio_file: 0 (скан неполный)');
  expect(status).not.toContain('no sample');
});

test('a scan cut short by the budget is incomplete, not «no sample»', async () => {
  const server = fakeServer();
  __setAudioFilesRunStateForTests(95);
  const root = await mount();
  await press(root, 'af-find');
  // E2 and both blog-a pages fit (each call reserves 3); blog-b would not.
  expect(server.requests).toHaveLength(3);
  const status = text(root, 'af-status');
  expect(status).toContain('бюджет: исчерпан');
  expect(status).not.toContain('no sample');
});

test('budget: nothing is sent past 100 requests per app run', async () => {
  const server = fakeServer();
  __setAudioFilesRunStateForTests(98);
  const root = await mount();
  await press(root, 'af-find');
  expect(server.requests).toHaveLength(0);
  expect(text(root, 'af-counts')).toBe('API: 98/100 · проб: 0');
  expect(logged()).toContain('budget: 98/100 reached, not sent');
});
