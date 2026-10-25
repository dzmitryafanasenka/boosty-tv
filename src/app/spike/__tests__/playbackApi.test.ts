import {
  buildBadTokenPostRequest,
  buildProgressRequest,
  describeUrlShape,
  findSameMedia,
  mapPlayerUrls,
  PROGRESS_STEP_S,
  ProgressThrottle,
  randomOpaqueToken,
  redactForLog,
  REFERENCE_USER_AGENT,
  videoCandidates,
  withApiProfile,
} from '../playbackApi';
import { buildPostRequest } from '../contentShapesApi';

/**
 * Story 1.6 spike: E9 and corrupted-Bearer builders, the api-contract §6
 * quality mapping, candidate picking, the same-media lookup, the E9 cadence
 * rule and log redaction. Fake data only.
 */

const BASE = 'https://api.boosty.to';
const U = (n: string) =>
  `https://cdn.example.invalid/${n}?sig=0123456789abcdef`;

const videoBlock = (id: string, urls: Array<[string, string]>, extra = {}) => ({
  type: 'ok_video',
  id,
  title: 'Secret Title',
  timeCode: 120,
  duration: 600,
  playerUrls: urls.map(([type, url]) => ({ type, url })),
  ...extra,
});

// Mirrors the live E8 `playerUrls` (Story 1.5): 19 entries, 9 non-empty.
const LIVE_LIKE: Array<[string, string]> = [
  ['live_playback_hls', ''],
  ['live_hls', ''],
  ['live_playback_dash', ''],
  ['lowest', U('lowest')],
  ['dash_uni', ''],
  ['dash', U('dash')],
  ['ondemand_dash', ''],
  ['medium', U('medium')],
  ['live_ondemand_hls', ''],
  ['live_cmaf', ''],
  ['quad_hd', U('quad')],
  ['tiny', U('tiny')],
  ['full_hd', U('full')],
  ['high', U('high')],
  ['ultra_hd', ''],
  ['low', U('low')],
  ['live_dash', ''],
  ['hls', U('hls')],
  ['ondemand_hls', ''],
];

test('E9 builder: PUT form time_code in integer seconds, documented path', () => {
  const r = buildProgressRequest('media/1', 125.9);
  expect(r.name).toBe('E9');
  expect(r.method).toBe('PUT');
  expect(r.url).toBe(`${BASE}/v1/viewstat/video/media%2F1/timecode/`);
  expect(r.body).toBe('time_code=125');
  expect(r.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  expect(r.headers.Authorization).toBeUndefined();
  expect(buildProgressRequest('m', -3).body).toBe('time_code=0');
});

test('corrupted-Bearer E8: synthetic 64-char token, no comments', () => {
  const token = randomOpaqueToken();
  expect(token).toMatch(/^[A-Za-z0-9]{64}$/);
  expect(randomOpaqueToken()).not.toBe(token);
  const r = buildBadTokenPostRequest('blog', 'p-1', () => 0.5);
  expect(r.name).toBe('E8-badtoken');
  expect(r.method).toBe('GET');
  expect(r.url).toBe(
    `${BASE}/v1/blog/blog/post/p-1?comments_limit=0&reply_limit=0`,
  );
  expect(r.headers.Authorization).toMatch(/^Bearer [A-Za-z0-9]{64}$/);
});

test('mapPlayerUrls: §6 table, empty URLs skipped, HLS → MP4 by height → DASH', () => {
  const sources = mapPlayerUrls(videoBlock('m', LIVE_LIKE));
  expect(sources.map(s => s.type)).toEqual([
    'hls',
    'tiny',
    'lowest',
    'low',
    'medium',
    'high',
    'full_hd',
    'quad_hd',
    'dash',
  ]);
  expect(sources.map(s => s.label)).toEqual([
    'HLS',
    'MP4 144p',
    'MP4 240p',
    'MP4 360p',
    'MP4 480p',
    'MP4 720p',
    'MP4 1080p',
    'MP4 1440p',
    'DASH',
  ]);
  expect(sources.every(s => s.url !== '')).toBe(true);
  // Unmapped types are ignored; garbage does not throw.
  expect(
    mapPlayerUrls(
      videoBlock('m', [
        ['mp4', U('a')],
        ['webm', U('b')],
        ['live_cmaf', U('c')],
        ['unknown', U('d')],
        ['constructor', U('e')],
        ['toString', U('f')],
        ['__proto__', U('g')],
      ]),
    ),
  ).toEqual([]);
  expect(mapPlayerUrls(undefined)).toEqual([]);
  expect(mapPlayerUrls({ playerUrls: [null, 5, { type: 'hls' }] })).toEqual([]);
  // Alternative names map to the same quality.
  expect(
    mapPlayerUrls(
      videoBlock('m', [
        ['ultrahd', U('u')],
        ['sd', U('s')],
        ['dash_sep', U('d')],
        ['ondemand_hls', U('h')],
      ]),
    ).map(s => [s.type, s.kind, s.height]),
  ).toEqual([
    ['ondemand_hls', 'hls', undefined],
    ['sd', 'progressive', 480],
    ['ultrahd', 'progressive', 2160],
    ['dash_sep', 'dash', undefined],
  ]);
});

test('videoCandidates: accessible posts only, every ok_video with a source', () => {
  const posts = [
    {
      id: 'p1',
      hasAccess: true,
      user: { blogUrl: 'blog-x' },
      data: [
        videoBlock('m1', [['hls', U('1')]]),
        { type: 'text' },
        videoBlock('m2', [['high', U('2')]], { title: '' }),
        videoBlock('m3', [['hls', '']]),
      ],
      title: 'Post Title',
    },
    { id: 'p2', hasAccess: false, data: [videoBlock('m4', [['hls', U('4')]])] },
    { id: 'p3', data: [videoBlock('m5', [['hls', U('5')]])] },
  ];
  const c = videoCandidates(posts, 'fallback');
  expect(c.map(x => [x.blogUrl, x.postId, x.mediaId, x.title])).toEqual([
    ['blog-x', 'p1', 'm1', 'Post Title'],
    ['blog-x', 'p1', 'm2', 'Post Title'],
  ]);
  // Without a post title, the block title is used.
  expect(
    videoCandidates(
      [
        {
          id: 'p9',
          hasAccess: true,
          data: [videoBlock('m9', [['hls', U('9')]])],
        },
      ],
      'fallback',
    ).map(x => x.title),
  ).toEqual(['Secret Title']);
});

test('findSameMedia: same id and same type after a re-fetch', () => {
  const post = {
    hasAccess: true,
    data: [videoBlock('other', [['hls', U('x')]]), videoBlock('m1', LIVE_LIKE)],
  };
  const r = findSameMedia(post, 'm1', 'medium');
  expect(r.kind).toBe('found');
  if (r.kind === 'found') {
    expect(r.source.type).toBe('medium');
    expect(r.source.url).toBe(U('medium'));
    expect(r.timeCode).toBe(120);
    expect(r.duration).toBe(600);
    expect(r.sources).toHaveLength(9);
  }
  const any = findSameMedia(post, 'm1');
  expect(any.kind === 'found' && any.source.type).toBe('hls');
  expect(findSameMedia(post, 'missing', 'hls').kind).toBe('no-media');
  expect(findSameMedia(post, 'm1', 'ultra_hd').kind).toBe('no-type');
  expect(findSameMedia({ ...post, hasAccess: false }, 'm1').kind).toBe(
    'no-access',
  );
  expect(findSameMedia(null, 'm1').kind).toBe('no-access');
  // Numeric ids compare as strings.
  expect(
    findSameMedia(
      { hasAccess: true, data: [videoBlock(7 as never, LIVE_LIKE)] },
      '7',
    ).kind,
  ).toBe('found');
});

test('ProgressThrottle: ≥10 s rule, event writes, failures not retried blindly', () => {
  const t = new ProgressThrottle();
  expect(PROGRESS_STEP_S).toBe(10);
  // First progress tick writes.
  expect(t.next(0.4, 'progress')).toBe(0);
  t.begin();
  // In flight: progress skipped, events still allowed.
  expect(t.next(30, 'progress')).toBeNull();
  expect(t.next(30, 'pause')).toBe(30);
  t.done(0, true);
  expect(t.getLastWritten()).toBe(0);
  for (const p of [1, 5, 9.99]) {
    expect(t.next(p, 'progress')).toBeNull();
  }
  expect(t.next(10.2, 'progress')).toBe(10);
  t.begin();
  t.done(10, true);
  // Backward seeks count as movement too.
  expect(t.next(0.5, 'progress')).toBe(0);
  expect(t.next(15, 'progress')).toBeNull();
  // A failed write moves the attempt mark: no write on every tick after it.
  expect(t.next(21, 'progress')).toBe(21);
  t.begin();
  t.done(21, false);
  expect(t.getLastWritten()).toBe(10);
  expect(t.next(22, 'progress')).toBeNull();
  expect(t.next(30.9, 'progress')).toBeNull(); // 9 s after the failed try
  expect(t.next(31.5, 'progress')).toBe(31);
  // Event writes skip only an identical second.
  t.begin();
  t.done(31, true);
  expect(t.next(31.7, 'exit')).toBeNull();
  expect(t.next(32, 'exit')).toBe(32);
  expect(t.next(32, 'background')).toBe(32);
  expect(t.next(Number.NaN, 'pause')).toBeNull();
  expect(t.next(-1, 'progress')).toBeNull();
});

test('redactForLog: signed URLs, queries, Bearer values and opaque runs', () => {
  const signed =
    'https://vd123.okcdn.ru/expires/1761000000/srcIp/1.2.3.4/sig/AbCdEf/video.m3u8?type=2&sig=QWERTY';
  const cases = [
    `HttpDataSource: Response code: 403 for ${signed}`,
    `failed to load (${signed})`,
    'GET //vd123.okcdn.ru/x/y.mp4?bytes=0-1&sig=zzz',
    'Bearer abcdefghijABCDEFGHIJabcdefghijABCDEFGHIJabcdefghij0123456789',
    `token ${'a1B2'.repeat(16)} end`,
  ];
  const out = cases.map(redactForLog);
  expect(out[0]).toBe('HttpDataSource: Response code: 403 for <url>');
  expect(out[1]).toBe('failed to load (<url>)');
  expect(out[2]).not.toMatch(/sig=|bytes=/);
  expect(out[3]).toBe('Bearer <redacted>');
  expect(out[4]).toBe('token <redacted> end');
  for (const line of out) {
    expect(line).not.toMatch(/okcdn|QWERTY|sig=|a1B2a1B2/);
  }
  // Ordinary log lines are unchanged.
  const plain = 'E9 progress t=120 → HTTP 200; TTFF hls 812 ms';
  expect(redactForLog(plain)).toBe(plain);
  for (const line of [
    'net host=api.boosty.to auth=true cookie=false status=200',
    'playing=true t=52; valid=1 grid=3',
    'source set hls (hls) start t=40',
  ]) {
    expect(redactForLog(line)).toBe(line);
  }
});

test('redactForLog: bare query fragments and scheme-less host/path runs', () => {
  const fragment = redactForLog(
    'params sig=abcDEF123&expires=1761400000000&srcIp=1.2.3.4&urls=x,y&ms=qY&id=123456&type=4',
  );
  expect(fragment).toBe(
    'params sig=<redacted>&expires=<redacted>&srcIp=<redacted>' +
      '&urls=<redacted>&ms=<redacted>&id=<redacted>&type=4',
  );
  const hostPath = redactForLog(
    'open vd123.okcdn.ru/video/AbCdEf/seg-1.ts failed; also cdn.example/x',
  );
  expect(hostPath).toBe('open <url> failed; also <url>');
  for (const out of [fragment, hostPath]) {
    expect(out).not.toMatch(/okcdn|abcDEF|1\.2\.3\.4|1761400000000|123456/);
  }
});

test('withApiProfile: reference UA without web headers; web unchanged', () => {
  const web = buildPostRequest('blog', 'p-1');
  expect(withApiProfile(web, 'web')).toBe(web);
  const ref = withApiProfile(web, 'reference');
  expect(ref.url).toBe(web.url);
  expect(ref.method).toBe('GET');
  expect(ref.headers['User-Agent']).toBe(REFERENCE_USER_AGENT);
  for (const h of ['X-App', 'X-Locale', 'Referer', 'Origin', 'Authorization']) {
    expect(ref.headers[h]).toBeUndefined();
  }
  expect(web.headers['X-App']).toBe('web');
});

test('describeUrlShape keeps structure and short enums, never secrets', () => {
  const sig = 'qYToevgVEZkLettersOnly';
  const url =
    `https://vd1.example.invalid/video/${sig}/?expires=1761400000000` +
    `&srcIp=192.168.1.2&srcAg=CHROME&type=4&sig=${sig}&ms=qYToevgVEZk&ct=0&id=123456`;
  const shape = describeUrlShape(url);
  expect(shape).toContain('scheme=https');
  expect(shape).toContain('srcAg:enum:CHROME');
  expect(shape).toContain('expires:digits(13)');
  expect(shape).not.toContain(sig);
  // A letters-only value under a non-allowlisted key is not shown.
  expect(shape).not.toContain('qYToevgVEZk');
  expect(shape).toContain('ms:opaque(11)');
  expect(shape).not.toContain('192.168');
  expect(shape).not.toContain('example.invalid');
  expect(shape).not.toMatch(/:\/\/|\?/);
  expect(redactForLog(shape)).toBe(shape);
});
