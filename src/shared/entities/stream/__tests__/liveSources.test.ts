/**
 * Story 7.2: the player-only live sources (`liveSourcesOf`, `pickLiveSource`)
 * and `StreamRepository.liveSources` (E15 for the live player) over
 * FixtureTransport and the real HttpClient. One test per URL-filter row of
 * the spec's I/O matrix. The 200 fixture is synthetic (no live 200 was ever
 * observed; api-contract «E15 (LIVE)»).
 */
import { AppError } from '../../../api/appError';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15Live from '../../../../test/fixtures/boosty/e15-video-stream-live.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15Scheduled from '../../../../test/fixtures/boosty/e15-video-stream-scheduled.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15Locked from '../../../../test/fixtures/boosty/e15-video-stream-locked.json';
import { LIVE_EDGE_TYPES, liveSourcesOf, pickLiveSource } from '../liveSources';
import { mapStream } from '../mapStream';
import { StreamRepository } from '../streamRepository';
import { isLiveRef } from '../types';

function client(handler: FixtureHandler) {
  const transport = createFixtureTransport(handler);
  const http = createHttpClient({
    transport,
    tokens: fixedAccessToken('t'.repeat(64)),
    sleep: () => Promise.resolve(),
    logger: createLogger(),
  });
  return { http, transport };
}

const stream = (playerUrls: unknown, type = 'ok_stream') => [{ type, id: 'synthetic-id-72', playerUrls }];
const url = (name: string) => `https://example.invalid/${name}`;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('liveSourcesOf (the URL filter)', () => {
  it('the live-edge types are `live_hls` and `live_dash` only', () => {
    expect([...LIVE_EDGE_TYPES].sort()).toEqual(['live_dash', 'live_hls']);
  });

  it('the synthetic fixture: `live_hls` then `live_dash`; DVR, CMAF and an empty VOD entry dropped', () => {
    expect(liveSourcesOf(e15Live.body.data)).toEqual([
      { format: 'hls', type: 'live_hls', url: `${url('live-hls')}?sig=REDACTED` },
      { format: 'dash', type: 'live_dash', url: url('live-dash') },
    ]);
  });

  it('only absolute http(s) URLs: `file:`, relative and `javascript:` inputs are dropped', () => {
    expect(
      liveSourcesOf(
        stream([
          { type: 'live_hls', url: 'file:///sdcard/x.m3u8' },
          { type: 'live_hls', url: '/relative/live.m3u8' },
          // eslint-disable-next-line no-script-url -- an input the filter must reject
          { type: 'live_dash', url: 'javascript:alert(1)' },
          { type: 'live_dash', url: 'content://x/y' },
          { type: 'live_hls', url: url('ok') },
        ]),
      ),
    ).toEqual([{ format: 'hls', type: 'live_hls', url: url('ok') }]);
  });

  it('`live_playback_*` (the DVR window) is never a candidate', () => {
    expect(
      liveSourcesOf(
        stream([
          { type: 'live_playback_hls', url: url('a') },
          { type: 'live_playback_dash', url: url('b') },
        ]),
      ),
    ).toEqual([]);
  });

  it('empty or missing URLs are skipped', () => {
    expect(
      liveSourcesOf(
        stream([
          { type: 'live_hls', url: '' },
          { type: 'live_hls' },
          { type: 'live_dash', url: null },
          { type: 'live_dash', url: url('d') },
        ]),
      ),
    ).toEqual([{ format: 'dash', type: 'live_dash', url: url('d') }]);
  });

  it('VOD, on-demand, progressive and unknown types are not candidates', () => {
    expect(
      liveSourcesOf(
        stream([
          { type: 'hls', url: url('a') },
          { type: 'dash', url: url('b') },
          { type: 'live_ondemand_hls', url: url('c') },
          { type: 'ondemand_hls_live', url: url('d') },
          { type: 'hd', url: url('e') },
          { type: 'live_cmaf', url: url('f') },
          { type: 'webrtc', url: url('g') },
          { type: 'mystery', url: url('h') },
        ]),
      ),
    ).toEqual([]);
  });

  it('HLS is preferred: HLS entries first, then DASH, each in the API order', () => {
    const sources = liveSourcesOf(
      stream([
        { type: 'live_dash', url: url('d1') },
        { type: 'live_hls', url: url('h1') },
        { type: 'live_dash', url: url('d2') },
        { type: 'live_hls', url: url('h2') },
      ]),
    );
    expect(sources.map(s => s.url)).toEqual([url('h1'), url('h2'), url('d1'), url('d2')]);
    expect(pickLiveSource(sources)?.url).toBe(url('h1'));
  });

  it('only `ok_stream` blocks: an `ok_video` in the body (a recording) is ignored', () => {
    expect(liveSourcesOf(stream([{ type: 'live_hls', url: url('a') }], 'ok_video'))).toEqual([]);
  });

  it('malformed input never throws: bad entries skipped, not the list', () => {
    expect(liveSourcesOf(null)).toEqual([]);
    expect(liveSourcesOf(undefined)).toEqual([]);
    expect(liveSourcesOf([null, 5, 'x', { type: 'ok_stream' }, { type: 'ok_stream', playerUrls: 'no' }])).toEqual([]);
    expect(
      liveSourcesOf(stream([null, { type: 5, url: url('a') }, { type: 'live_hls', url: 7 }, { type: 'live_hls', url: url('ok') }])),
    ).toEqual([{ format: 'hls', type: 'live_hls', url: url('ok') }]);
  });

  it('no candidate left → `pickLiveSource` is null (the QR row)', () => {
    expect(pickLiveSource(liveSourcesOf(stream([{ type: 'live_playback_hls', url: url('a') }])))).toBeNull();
  });

  it('the Stream entity keeps only the `hasLiveSources` flag', () => {
    const body = e15Live.body as Record<string, unknown>;
    expect(mapStream(body, createLogger())?.hasLiveSources).toBe(true);
    expect(
      mapStream({ ...body, data: stream([{ type: 'live_playback_hls', url: url('a') }]) }, createLogger())
        ?.hasLiveSources,
    ).toBe(false);
  });
});

describe('isLiveRef', () => {
  it('a LiveRef has `kind: live`; a MediaRef has no kind', () => {
    expect(isLiveRef({ kind: 'live', blogUrl: 'b' })).toBe(true);
    expect(isLiveRef({ blogUrl: 'b', postId: 'p', mediaId: 'm' })).toBe(false);
  });
});

describe('StreamRepository.liveSources (E15 for the player)', () => {
  it('a live stream: `ok` with the stream and the live-edge sources; one GET, content profile', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e15Live.body }));
    const result = await StreamRepository.liveSources(http, 'synthetic-blog');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.stream).toMatchObject({ status: 'live', hasAccess: true, startTime: 1_700_018_000 });
      expect(result.sources.map(s => s.type)).toEqual(['live_hls', 'live_dash']);
    }
    expect(transport.calls.map(c => [c.method, c.path])).toEqual([['GET', '/v1/blog/synthetic-blog/video_stream']]);
  });

  it('a 204 (or an empty body) is `none`', async () => {
    expect(await StreamRepository.liveSources(client(() => ({ status: 204 })).http, 'b')).toEqual({ kind: 'none' });
    expect(await StreamRepository.liveSources(client(() => ({ status: 200 })).http, 'b')).toEqual({ kind: 'none' });
  });

  it('a scheduled stream, one no longer online or a malformed body is `none`', async () => {
    expect(await StreamRepository.liveSources(client(() => ({ status: 200, body: e15Scheduled.body })).http, 'b')).toEqual({
      kind: 'none',
    });
    const ended = { ...(e15Live.body as Record<string, unknown>), isOnline: false, isTemplate: false };
    expect(await StreamRepository.liveSources(client(() => ({ status: 200, body: ended })).http, 'b')).toEqual({
      kind: 'none',
    });
    expect(await StreamRepository.liveSources(client(() => ({ status: 200, body: { title: 'x' } })).http, 'b')).toEqual({
      kind: 'none',
    });
  });

  it('`hasAccess: false` is `ok` (the caller decides; no session check, no error)', async () => {
    const result = await StreamRepository.liveSources(client(() => ({ status: 200, body: e15Locked.body })).http, 'b');
    expect(result).toMatchObject({ kind: 'ok', stream: { hasAccess: false }, sources: [] });
  });

  it('a failure rejects with the HttpClient error; no retry', async () => {
    const { http, transport } = client(() => ({ status: 500 }));
    await expect(StreamRepository.liveSources(http, 'b')).rejects.toBeInstanceOf(AppError);
    expect(transport.calls).toHaveLength(1);
  });

  it('nothing is logged with a URL', async () => {
    const log = jest.spyOn(console, 'log');
    const warn = jest.spyOn(console, 'warn');
    await StreamRepository.liveSources(client(() => ({ status: 200, body: e15Live.body })).http, 'b');
    const logged = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toMatch(/example\.invalid|sig=/);
    expect(JSON.stringify(mapStream(e15Live.body, createLogger()))).not.toMatch(/sig=/);
  });
});
