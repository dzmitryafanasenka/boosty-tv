import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e8Accessible, e8Locked, e8MissingReply, postDetail } from '../../../../test/postFixtures';
import { PostRepository } from '../postRepository';
import { mapPost } from '../mapPost';
import { videoSourceOf, videoSourcesOf } from '../videoSources';

const REF = { blogUrl: 'synthetic-blog-1', postId: 'p1', mediaId: 'synthetic-id-7' };
const URL = 'https://example.invalid/player';

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

describe('videoSourceOf (api-contract §6 mapping table)', () => {
  it.each([
    ['tiny', 144],
    ['mobile', 144],
    ['lowest', 240],
    ['low', 360],
    ['sd', 480],
    ['medium', 480],
    ['hd', 720],
    ['high', 720],
    ['full', 1080],
    ['full_hd', 1080],
    ['fullhd', 1080],
    ['quad', 1440],
    ['quad_hd', 1440],
    ['quadhd', 1440],
    ['ultra', 2160],
    ['ultra_hd', 2160],
    ['ultrahd', 2160],
  ])('progressive %s → %ip', (type, height) => {
    expect(videoSourceOf(type, URL)).toEqual({ format: 'progressive', type, height, url: URL });
  });

  it.each(['hls', 'live_hls', 'live_playback_hls', 'live_ondemand_hls', 'ondemand_hls', 'ondemand_hls_live'])(
    'HLS: %s',
    type => {
      expect(videoSourceOf(type, URL)).toEqual({ format: 'hls', type, url: URL });
    },
  );

  it.each(['dash', 'dash_uni', 'dash_sep', 'live_dash', 'live_playback_dash', 'ondemand_dash', 'ondemand_dash_live'])(
    'DASH: %s',
    type => {
      expect(videoSourceOf(type, URL)).toEqual({ format: 'dash', type, url: URL });
    },
  );

  it.each(['mp4', 'webm', 'av1', 'webrtc', 'rtmp', 'live_cmaf', 'something_new', ''])(
    'ignored type %p',
    type => {
      expect(videoSourceOf(type, URL)).toBeNull();
    },
  );

  it('an empty or missing URL is skipped', () => {
    expect(videoSourceOf('hls', '')).toBeNull();
    expect(videoSourceOf('hls', null)).toBeNull();
    expect(videoSourceOf('full_hd', undefined)).toBeNull();
  });
});

describe('videoSourcesOf', () => {
  it('the live E8: the 9 non-empty entries of the video, in API order (empty and unknown skipped)', () => {
    const body = e8Accessible() as { data: unknown[] };
    const sources = videoSourcesOf(body.data, 'synthetic-id-7');
    expect(sources?.map(s => s.type)).toEqual([
      'lowest',
      'dash',
      'medium',
      'quad_hd',
      'tiny',
      'full_hd',
      'high',
      'low',
      'hls',
    ]);
  });

  it('null when no ok_video has the id; malformed entries and blocks are tolerated', () => {
    const data = [
      { type: 'text', content: 'x' },
      { type: 'ok_video', id: 'a', playerUrls: [{ type: 7, url: URL }, { url: URL }, null, { type: 'hls', url: 5 }] },
      { type: 'ok_video', id: 'b', playerUrls: 'nope' },
      { nope: true },
    ];
    expect(videoSourcesOf(data, 'missing')).toBeNull();
    expect(videoSourcesOf(data, 'b')).toEqual([]);
    // Bad entries are skipped one by one; none of these is usable.
    expect(videoSourcesOf(data, 'a')).toEqual([]);
    expect(
      videoSourcesOf([{ type: 'ok_video', id: 'd', playerUrls: [null, 'x', { type: 'dash', url: URL }] }], 'd'),
    ).toEqual([{ format: 'dash', type: 'dash', url: URL }]);
    expect(
      videoSourcesOf([{ type: 'ok_video', id: 'c', playerUrls: [{ type: 7, url: URL }, { type: 'hls', url: URL }] }], 'c'),
    ).toEqual([{ format: 'hls', type: 'hls', url: URL }]);
  });
});

describe('PostRepository.videoSources (one fresh E8)', () => {
  it('sends E8 with the content profile and comments off; returns the post, the video title and the sources', async () => {
    const { http, transport } = client(() => ({
      status: 200,
      body: postDetail(REF.blogUrl, REF.postId, (e8Accessible() as { data: unknown[] }).data),
    }));
    const result = await PostRepository.videoSources(http, REF);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      return;
    }
    expect(result.post.id).toBe(REF.postId);
    expect(result.videoTitle).toBe('redacted');
    expect(result.sources).toHaveLength(9);
    const [call] = transport.calls;
    expect(call.url).toBe(
      `https://api.boosty.to/v1/blog/${REF.blogUrl}/post/${REF.postId}?comments_limit=0&reply_limit=0`,
    );
    expect(call.headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
    expect(call.headers['X-App']).toBeUndefined();
    expect(call.headers.Referer).toBeUndefined();
    expect(transport.calls).toHaveLength(1);
  });

  it('the Post entity never carries the sources (AD-9)', async () => {
    const { http } = client(() => ({ status: 200, body: e8Accessible() }));
    const result = await PostRepository.videoSources(http, { ...REF, blogUrl: 'synthetic-blog-1' });
    const post = result.kind === 'ok' ? result.post : null;
    expect(JSON.stringify(post)).not.toMatch(/playerUrls|example\.invalid\/player|signedQuery|timeCode/);
    expect(post).toEqual(mapPost(e8Accessible(), createLogger()));
  });

  it('locked on the fresh E8 (`hasAccess=false`) → locked', async () => {
    const { http } = client(() => ({ status: 200, body: e8Locked() }));
    const result = await PostRepository.videoSources(http, REF);
    expect(result.kind).toBe('locked');
  });

  it('`hasAccess: true` with empty `data` → locked (api-contract §7), not unavailable', async () => {
    const { http } = client(() => ({
      status: 200,
      body: postDetail(REF.blogUrl, REF.postId, [], { hasAccess: true }),
    }));
    expect((await PostRepository.videoSources(http, REF)).kind).toBe('locked');
  });

  it('E8 404 → unavailable; a video gone from the post → unavailable', async () => {
    const missing = client(() => e8MissingReply());
    expect((await PostRepository.videoSources(missing.http, REF)).kind).toBe('unavailable');
    const gone = client(() => ({ status: 200, body: e8Accessible() }));
    expect((await PostRepository.videoSources(gone.http, { ...REF, mediaId: 'other' })).kind).toBe(
      'unavailable',
    );
  });

  it('no usable URL → ok with no sources (the resolver shows the error)', async () => {
    const { http } = client(() => ({
      status: 200,
      body: postDetail(REF.blogUrl, REF.postId, [
        { type: 'ok_video', id: REF.mediaId, title: 'V', playerUrls: [{ type: 'hls', url: '' }, { type: 'mp4', url: URL }] },
      ]),
    }));
    const result = await PostRepository.videoSources(http, REF);
    expect(result).toMatchObject({ kind: 'ok', sources: [] });
  });

  it('E8 failures reject with their AppError kind', async () => {
    const { http } = client(() => ({ status: 500, body: {} }));
    await expect(PostRepository.videoSources(http, REF)).rejects.toMatchObject({ kind: 'Server' });
  });
});
