import {
  audioFileCandidates,
  blockTypeSummary,
  buildBadTokenPostRequest,
  buildProgressRequest,
  describeSignedQuery,
  describeUrlShape,
  fileCandidates,
  findSameFile,
  findSameMedia,
  formatExpiry,
  mapPlayerUrls,
  mediaFileBlockCounts,
  nextPageOffset,
  PROGRESS_STEP_S,
  ProgressThrottle,
  randomOpaqueToken,
  redactForLog,
  REFERENCE_USER_AGENT,
  signedQueryExpiry,
  signedQuerySummary,
  signedUrl,
  videoCandidates,
  withApiProfile,
} from '../playbackApi';
import { buildBlogPostsRequest, buildPostRequest } from '../contentShapesApi';

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

// ------------------------------------------- Story 1.7: audio and files ----

describe('Story 1.7 audio_file / file helpers', () => {
  const SQ = '?expires=1761400000&sig=SQSECRETVALUE';
  const post = (extra: Record<string, unknown>) => ({
    id: 'post-1',
    title: 'Post Secret Title',
    hasAccess: true,
    signedQuery: SQ,
    user: { blogUrl: 'blog-x' },
    data: [
      { type: 'text', content: 'x' },
      {
        type: 'audio_file',
        id: 'a-1',
        url: 'https://cdn.example.invalid/audio/a1.mp3',
        title: 'Track Secret',
        duration: 245,
      },
      {
        type: 'file',
        id: 'f-1',
        url: 'https://cdn.example.invalid/file/f1.pdf',
        title: 'Doc Secret',
        size: 2_000_000,
      },
      { type: 'audio_file', url: '' },
    ],
    ...extra,
  });

  test('candidates: accessible posts only, url/title/duration/size, signedQuery kept', () => {
    const locked = post({
      id: 'post-2',
      hasAccess: false,
      signedQuery: '',
    });
    const missing = post({ id: 'post-3', hasAccess: undefined });
    const a = audioFileCandidates([locked, missing, post({})], 'fallback');
    expect(a).toEqual([
      {
        kind: 'audio',
        blogUrl: 'blog-x',
        postId: 'post-1',
        blockId: 'a-1',
        url: 'https://cdn.example.invalid/audio/a1.mp3',
        signedQuery: SQ,
        title: 'Track Secret',
        duration: 245,
        size: undefined,
      },
    ]);
    const f = fileCandidates([locked, post({})], 'fallback');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      kind: 'file',
      blockId: 'f-1',
      size: 2_000_000,
      duration: undefined,
      title: 'Doc Secret',
    });
  });

  test('candidates: empty or missing signedQuery is kept as empty; block title falls back to the post title', () => {
    const p = post({ signedQuery: undefined, user: {} });
    (p.data[1] as Record<string, unknown>).title = '';
    const [a] = audioFileCandidates([p], 'fallback');
    expect(a.signedQuery).toBe('');
    expect(a.blogUrl).toBe('fallback');
    expect(a.title).toBe('Post Secret Title');
    expect(signedUrl(a.url, a.signedQuery)).toBe(a.url);
  });

  test('signedUrl joins with ? or & correctly', () => {
    const u = 'https://h.example.invalid/p/a.mp3';
    expect(signedUrl(u, '?a=1&b=2')).toBe(`${u}?a=1&b=2`);
    expect(signedUrl(u, 'a=1')).toBe(`${u}?a=1`);
    expect(signedUrl(u, '&a=1')).toBe(`${u}?a=1`);
    expect(signedUrl(`${u}?x=0`, '?a=1')).toBe(`${u}?x=0&a=1`);
    expect(signedUrl(`${u}?x=0&`, '?a=1')).toBe(`${u}?x=0&a=1`);
    expect(signedUrl(`${u}?`, 'a=1')).toBe(`${u}?a=1`);
    expect(signedUrl(u, '')).toBe(u);
    expect(signedUrl(u, '?')).toBe(u);
  });

  test('the joined URL is fully redacted and its shapes reveal no values', () => {
    const joined = signedUrl('https://cdn.example.invalid/audio/a1.mp3', SQ);
    const line = redactForLog(`player error for ${joined} (${SQ})`);
    expect(line).not.toContain('SQSECRETVALUE');
    expect(line).not.toContain('cdn.example');
    expect(line).not.toContain('1761400000');
    const shape = describeSignedQuery(SQ);
    expect(shape).toBe(
      'lead=qmark query=[expires:digits(10),sig:opaque(13)] flags=[]',
    );
    expect(describeSignedQuery('')).toBe('empty');
    expect(describeUrlShape(joined)).not.toContain('SQSECRETVALUE');
  });

  test('signedQueryExpiry: expiry-like digit keys only, ms or s', () => {
    const now = 1_761_400_000_000 - 3600_000;
    expect(signedQueryExpiry(SQ, now)).toEqual([{ key: 'expires', inS: 3600 }]);
    expect(signedQueryExpiry('?exp=1761400000000', now)).toEqual([
      { key: 'exp', inS: 3600 },
    ]);
    expect(signedQueryExpiry('?sig=123456789012&id=1761400000', now)).toEqual(
      [],
    );
    expect(signedQueryExpiry('', now)).toEqual([]);
    // The live Post.signedQuery key (Story 1.7).
    expect(
      signedQueryExpiry('?user_id=1&expire_time=1761400000&sign=x', now),
    ).toEqual([{ key: 'expire_time', inS: 3600 }]);
    // One-letter keys are not taken as an expiry.
    expect(signedQueryExpiry('?e=1761400000&t=1761400000', now)).toEqual([]);
    // A past timestamp is reported as such, not as an expiry.
    const past = signedQueryExpiry('?expires=1761390000', now);
    expect(past).toEqual([{ key: 'expires', inS: -6400 }]);
    expect(formatExpiry(past)).toBe('expires past timestamp');
    expect(formatExpiry(signedQueryExpiry(SQ, now))).toBe('expires in 3600 s');
    expect(formatExpiry([])).toBe('no expiry field (unverified)');
  });

  test('signedQuerySummary: presence, distinct shapes, expiry min/max, no values', () => {
    const now = 1_761_400_000_000 - 3600_000;
    const posts = [
      post({}),
      post({ id: 'p2', signedQuery: '?expires=1761403600&sig=SQSECRETVALUE' }),
      post({ id: 'p3', signedQuery: '?expires=1761390000&sig=SQSECRETVALUE' }),
      post({ id: 'p4', signedQuery: '' }),
      post({ id: 'p5', hasAccess: false, signedQuery: '' }),
      post({ id: 'p6', signedQuery: 'token=OTHERSECRET' }),
    ];
    const line = signedQuerySummary(posts, now);
    expect(line).toBe(
      'accessible=5 nonEmpty=4 withExpiry=3 shapes=2 ' +
        '[{lead=qmark query=[expires:digits(10),sig:opaque(13)] flags=[]} ' +
        '{lead=none query=[token:opaque(11)] flags=[]}] ' +
        'expiry=expires:3600..7200 s past=1',
    );
    for (const secret of ['SQSECRET', 'OTHERSECRET', '17614', '17613']) {
      expect(line).not.toContain(secret);
    }
    expect(signedQuerySummary([], now)).toBe(
      'accessible=0 nonEmpty=0 withExpiry=0 shapes=0 [] expiry=none',
    );
  });

  test('audio_file / file nested in list items are candidates and counted', () => {
    const nested = post({
      id: 'p-list',
      data: [
        {
          type: 'list',
          items: [
            {
              data: [{ type: 'text' }],
              items: [
                {
                  data: [
                    {
                      type: 'audio_file',
                      id: 'a-n',
                      url: 'https://cdn.example.invalid/audio/n.mp3',
                      duration: 60,
                    },
                  ],
                  items: [],
                },
              ],
            },
          ],
        },
      ],
    });
    const a = audioFileCandidates([nested], 'fallback');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      blockId: 'a-n',
      duration: 60,
      signedQuery: SQ,
    });
    expect(fileCandidates([nested], 'fallback')).toEqual([]);
    expect(mediaFileBlockCounts([nested])).toEqual({
      audio: 1,
      file: 0,
      lockedPosts: 0,
    });
    expect(findSameFile(nested, a[0])).toMatchObject({
      kind: 'found',
      matchedBy: 'id',
    });
  });

  test('findSameFile: by block id first, else by url; locked → no-access', () => {
    const [orig] = audioFileCandidates([post({})], 'fallback');
    const fresh = post({ signedQuery: '?expires=1761500000&sig=NEW' });
    const byId = findSameFile(fresh, orig);
    expect(byId).toMatchObject({ kind: 'found', matchedBy: 'id' });
    expect(byId.kind === 'found' && byId.candidate.signedQuery).toBe(
      '?expires=1761500000&sig=NEW',
    );
    const noIds = post({});
    for (const b of noIds.data as Array<Record<string, unknown>>) {
      delete b.id;
    }
    expect(findSameFile(noIds, { ...orig, blockId: undefined })).toMatchObject({
      kind: 'found',
      matchedBy: 'url',
    });
    expect(findSameFile(noIds, orig)).toMatchObject({
      kind: 'found',
      matchedBy: 'url',
    });
    expect(
      findSameFile(post({}), { ...orig, blockId: 'zzz', url: 'other' }),
    ).toEqual({ kind: 'no-block' });
    expect(findSameFile(post({ hasAccess: false }), orig)).toEqual({
      kind: 'no-access',
    });
  });

  test('E4 paging: nextPageOffset and the offset argument', () => {
    expect(nextPageOffset({ extra: { offset: 'abc:1', isLast: false } })).toBe(
      'abc:1',
    );
    expect(
      nextPageOffset({ extra: { offset: 'abc:1', isLast: true } }),
    ).toBeUndefined();
    expect(nextPageOffset({ extra: {} })).toBeUndefined();
    expect(nextPageOffset({})).toBeUndefined();
    expect(buildBlogPostsRequest('b').url).toBe(
      `${BASE}/v1/blog/b/post/?limit=20&comments_limit=0&reply_limit=0`,
    );
    expect(buildBlogPostsRequest('b', 'x:1&y').url).toBe(
      `${BASE}/v1/blog/b/post/?limit=20&comments_limit=0&reply_limit=0&offset=x%3A1%26y`,
    );
  });

  test('mediaFileBlockCounts counts blocks and locked posts', () => {
    expect(
      mediaFileBlockCounts([post({}), post({ hasAccess: false, data: [] })]),
    ).toEqual({ audio: 2, file: 1, lockedPosts: 1 });
  });
});

test('blockTypeSummary: accessible posts only, nested list blocks, unsafe types masked', () => {
  const posts = [
    {
      hasAccess: true,
      data: [
        { type: 'text' },
        { type: 'audio_file' },
        { type: 'Weird Type!' },
        {
          type: 'list',
          items: [
            {
              data: [{ type: 'file' }],
              items: [{ data: [{ type: 'audio_file' }], items: [] }],
            },
          ],
        },
      ],
    },
    { hasAccess: false, data: [{ type: 'ok_video' }] },
  ];
  expect(blockTypeSummary(posts)).toBe(
    '<other>×1,audio_file×1,list×1,list>audio_file×1,list>file×1,text×1',
  );
  expect(blockTypeSummary([])).toBe('-');
});
