/**
 * Story 7.1: StreamRepository (E15) over FixtureTransport and the real
 * HttpClient, and the one mapper (`mapStream`). Every row of the spec's I/O
 * matrix the entity owns: 204 (the live fixtures), live, scheduled, needs
 * level, malformed, failure. The 200 fixtures are synthetic (no live 200
 * was ever observed; api-contract «E15 (LIVE)»).
 */
import { AppError } from '../../../api/appError';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15None1 from '../../../../test/fixtures/boosty/e15-video-stream-1.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15None2 from '../../../../test/fixtures/boosty/e15-video-stream-2.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15Live from '../../../../test/fixtures/boosty/e15-video-stream-live.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15Scheduled from '../../../../test/fixtures/boosty/e15-video-stream-scheduled.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15Locked from '../../../../test/fixtures/boosty/e15-video-stream-locked.json';
import { mapStream } from '../mapStream';
import { StreamRepository, streamPath } from '../streamRepository';

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

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof AppError ? error.kind : 'other';
  }
};

describe('path', () => {
  it('`/v1/blog/{blogUrl}/video_stream`, the blog encoded as a segment', () => {
    expect(streamPath('synthetic-blog')).toBe('/v1/blog/synthetic-blog/video_stream');
  });

  it('an unsafe blogUrl is `Client` before any request', async () => {
    expect(() => streamPath('a/b')).toThrow(AppError);
    expect(() => streamPath('..')).toThrow(AppError);
    const { http, transport } = client(() => ({ status: 204 }));
    expect(await kindOf(StreamRepository.fetchActive(http, 'a/b'))).toBe('Client');
    expect(transport.calls).toHaveLength(0);
  });
});

describe('E15 fetchActive', () => {
  it.each([
    ['e15-video-stream-1', e15None1],
    ['e15-video-stream-2', e15None2],
  ])('the live 204 (%s): no stream; one GET with the content profile', async (_name, fixture) => {
    const { http, transport } = client(() => ({ status: fixture.status }));
    expect(await StreamRepository.fetchActive(http, 'synthetic-blog')).toBeNull();
    expect(transport.calls.map(c => [c.method, c.path])).toEqual([
      ['GET', '/v1/blog/synthetic-blog/video_stream'],
    ]);
    expect(transport.calls[0].headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
  });

  it('a 200 with an empty body is no stream too', async () => {
    const { http } = client(() => ({ status: 200 }));
    expect(await StreamRepository.fetchActive(http, 'synthetic-blog')).toBeNull();
  });

  it('live (synthetic fixture): mapped; no URL, signed query or price in the entity', async () => {
    const { http } = client(() => ({ status: 200, body: e15Live.body }));
    const stream = await StreamRepository.fetchActive(http, 'synthetic-blog');
    expect(stream).toEqual({
      id: 'synthetic-id-71',
      title: 'redacted',
      status: 'live',
      hasAccess: true,
      startTime: 1_700_018_000,
      viewers: 5,
      likes: 5,
      coverUrl: 'https://example.invalid/cover',
      levelName: null,
      hasLiveSources: true,
    });
    expect(JSON.stringify(stream)).not.toMatch(/sig=|currency|RUB|preview|live-hls|live-dash|example\.invalid\/live/);
  });

  it('scheduled (synthetic fixture): `isTemplate` and not online', async () => {
    const { http } = client(() => ({ status: 200, body: e15Scheduled.body }));
    expect(await StreamRepository.fetchActive(http, 'synthetic-blog')).toMatchObject({
      status: 'scheduled',
      hasAccess: true,
      startTime: 1_700_018_000,
      viewers: 0,
    });
  });

  it('needs a level (synthetic fixture): `hasAccess: false` is a result, not an error; the level name only', async () => {
    const { http } = client(() => ({ status: 200, body: e15Locked.body }));
    const stream = await StreamRepository.fetchActive(http, 'synthetic-blog');
    expect(stream).toMatchObject({ status: 'live', hasAccess: false, levelName: 'redacted' });
    expect(Object.keys(stream ?? {})).not.toContain('price');
  });

  it('a malformed 200 is no stream, logged with the issue count only', async () => {
    const logger = createLogger();
    const { http } = client(() => ({
      status: 200,
      body: { ...e15Live.body, id: undefined, title: 'Secret title' },
    }));
    expect(await StreamRepository.fetchActive(http, 'synthetic-blog', logger)).toBeNull();
    const entries = logger.entries();
    expect(entries).toEqual([
      expect.objectContaining({ level: 'warn', scope: 'stream', message: 'dropped', fields: { issues: '1' } }),
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/Secret|example\.invalid|sig=/);
  });

  it.each([
    ['5xx', { status: 503 }, 'Server'],
    ['network', { network: true as const }, 'Network'],
    ['401 (no renewal)', { status: 401 }, 'Client'],
    ['403', { status: 403 }, 'Client'],
  ])('a %s failure is sent once (no AD-6 retry) and rejects', async (_name, reply, kind) => {
    const { http, transport } = client(() => reply);
    expect(await kindOf(StreamRepository.fetchActive(http, 'synthetic-blog'))).toBe(kind);
    expect(transport.calls).toHaveLength(1);
  });
});

describe('mapStream', () => {
  const live = e15Live.body as Record<string, unknown>;
  const map = (raw: unknown) => mapStream(raw, createLogger());

  it.each([
    ['no id', { ...live, id: undefined }],
    ['an empty id', { ...live, id: '' }],
    ['a non-finite id', { ...live, id: Number.NaN }],
    ['isOnline not a boolean', { ...live, isOnline: 'yes' }],
    ['no isOnline', { ...live, isOnline: undefined }],
    ['hasAccess not a boolean', { ...live, hasAccess: 1 }],
    ['no hasAccess', { ...live, hasAccess: undefined }],
    ['an array', [live]],
    ['a string', 'stream'],
    ['null', null],
  ])('%s → null (no card)', (_name, raw) => {
    expect(map(raw)).toBeNull();
  });

  it('neither online nor scheduled (a stream that just ended) → null, logged at info (not the malformed warning) with the two booleans only', () => {
    const logger = createLogger();
    expect(mapStream({ ...live, isOnline: false, isTemplate: false }, logger)).toBeNull();
    expect(logger.entries()).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'not live or scheduled',
        fields: { isOnline: false, isTemplate: false },
      }),
    ]);
  });

  it.each([
    ['milliseconds', 1_700_018_000_000],
    ['far out of range', 1e15],
    ['negative', -5],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('a start time in %s is no start time (epoch seconds only)', (_name, startTime) => {
    expect(map({ ...live, startTime })?.startTime).toBeNull();
  });

  it('online wins over isTemplate; a numeric id becomes a string', () => {
    expect(map({ ...live, id: 1071, isTemplate: true })).toMatchObject({ id: '1071', status: 'live' });
  });

  it('optional fields fall back: no title, counts or level; bad counts → 0; a bad start time → null', () => {
    expect(
      map({
        id: 'synthetic-id-1',
        isOnline: true,
        hasAccess: false,
        title: 5,
        startTime: 'soon',
        count: { viewers: -3, likes: 2.5 },
        subscriptionLevel: { name: '   ' },
        teaser: 'none',
        data: null,
      }),
    ).toEqual({
      id: 'synthetic-id-1',
      title: '',
      status: 'live',
      hasAccess: false,
      startTime: null,
      viewers: 0,
      likes: 0,
      coverUrl: null,
      levelName: null,
      hasLiveSources: false,
    });
    expect(map({ ...live, startTime: 0 })?.startTime).toBeNull();
    expect(map({ ...live, title: '  Эфир  ' })?.title).toBe('Эфир');
  });

  it('cover: the first teaser image, else a block preview; unknown blocks are ignored; only http(s)', () => {
    expect(
      map({
        ...live,
        teaser: [{ type: 'text' }, 5, { type: 'image', url: 'ftp://example.invalid/cover' }],
        data: [{ type: 'mystery_block' }, { type: 'ok_stream', preview: 'https://example.invalid/preview' }],
      })?.coverUrl,
    ).toBe('https://example.invalid/preview');
    expect(map({ ...live, teaser: [], data: [] })?.coverUrl).toBeNull();
  });
});
