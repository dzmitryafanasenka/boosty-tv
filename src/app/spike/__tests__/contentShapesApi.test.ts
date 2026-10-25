import {
  buildBlogPostsRequest,
  buildBlogRequest,
  buildEventsRequest,
  buildFeedRequest,
  buildFixtures,
  buildNoTokenCurrentUserRequest,
  buildPostRequest,
  buildSubscriptionsRequest,
  buildVideoStreamRequest,
  createFixtureSanitizer,
  describeEvents,
  describePost,
  pickPosts,
  postsOf,
  randomBlogSlug,
  randomUuidV4,
  REQUEST_BUDGET,
  runContentShapes,
  sanitizeFixture,
  subscriptionBlogUrls,
  unknownBlockTypes,
  type SessionCaller,
} from '../contentShapesApi';
import type { ApiRequest, FetchLike } from '../phoneAuthApi';
import type { CallResult } from '../refreshCoordinator';

/**
 * Story 1.5 spike: request builders, post picking, analysis lines, the
 * fixture sanitizer (no input string survives except allowlisted enums) and
 * the runner (order, budget, no-token calls) with fake responses only.
 */

const BASE = 'https://api.boosty.to';

test('builders: read-only GETs on documented paths, comments disabled', () => {
  const all: ApiRequest[] = [
    buildSubscriptionsRequest(),
    buildBlogRequest('some-blog'),
    buildBlogPostsRequest('some-blog'),
    buildFeedRequest(),
    buildPostRequest('some-blog', 'p-1'),
    buildVideoStreamRequest('some-blog'),
    buildEventsRequest(),
    buildEventsRequest('cursor/1'),
    buildNoTokenCurrentUserRequest(),
  ];
  for (const r of all) {
    expect(r.method).toBe('GET');
    expect(r.body).toBeUndefined();
    expect(r.headers.Authorization).toBeUndefined();
    expect(r.url.startsWith(`${BASE}/v1/`)).toBe(true);
    expect(r.url).not.toMatch(/comment\//);
  }
  expect(all.map(r => r.url.replace(BASE, ''))).toEqual([
    '/v1/user/subscriptions?limit=30&with_follow=true',
    '/v1/blog/some-blog',
    '/v1/blog/some-blog/post/?limit=20&comments_limit=0&reply_limit=0',
    '/v1/feed/post/?limit=10&comments_limit=0&reply_limit=0',
    '/v1/blog/some-blog/post/p-1?comments_limit=0&reply_limit=0',
    '/v1/blog/some-blog/video_stream',
    '/v1/notification/standalone/event/',
    '/v1/notification/standalone/event/?offset=cursor%2F1',
    '/v1/user/current',
  ]);
  expect(buildPostRequest('a/b', 'c?d').url).toBe(
    `${BASE}/v1/blog/a%2Fb/post/c%3Fd?comments_limit=0&reply_limit=0`,
  );
  expect(randomUuidV4()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(randomBlogSlug()).toMatch(/^spike-missing-[a-z]{12}$/);
});

const video = (urls: Array<[string, string]>, extra = {}) => ({
  type: 'ok_video',
  id: 'media-1',
  playerUrls: urls.map(([type, url]) => ({ type, url })),
  ...extra,
});

const post = (id: string, hasAccess: boolean | undefined, data: unknown[]) => ({
  id,
  int_id: 1,
  hasAccess,
  createdAt: 1_761_000_000,
  user: { name: 'Author', blogUrl: 'author-blog' },
  data,
  teaser: [{ type: 'image', url: 'https://images.example/t.jpg' }],
});

test('subscriptions and posts extraction', () => {
  expect(
    subscriptionBlogUrls({
      data: [
        { blog: { blogUrl: 'a' } },
        { blog: { blogUrl: 'b' } },
        { blog: { blogUrl: 'a' } },
        { blog: {} },
        'junk',
      ],
    }),
  ).toEqual(['a', 'b']);
  expect(subscriptionBlogUrls(null)).toEqual([]);
  expect(postsOf({ data: [{ id: 'x' }, 3] }, 'E4')).toHaveLength(1);
  expect(postsOf({ data: { posts: [{ id: 'y' }] } }, 'E5')).toHaveLength(1);
  expect(postsOf({ data: [] }, 'E5')).toHaveLength(0);
});

test('pickPosts: by hasAccess, preferring an accessible ok_video post', () => {
  const posts = [
    post('none', undefined, []),
    post('acc-text', true, [{ type: 'text', content: '[]' }]),
    post('locked', false, []),
    post('acc-video', true, [video([['hd', 'https://cdn.example/v']])]),
  ];
  const picked = pickPosts(posts, 'fallback');
  expect(picked.accessible).toEqual({
    blogUrl: 'author-blog',
    postId: 'acc-video',
    hasVideo: true,
  });
  expect(picked.locked?.postId).toBe('locked');
  expect(picked.missingHasAccess).toBe(1);
  expect(pickPosts([post('a', true, [])], 'x').accessible?.postId).toBe('a');
  expect(pickPosts([], 'x')).toEqual({
    accessible: undefined,
    locked: undefined,
    missingHasAccess: 0,
  });
});

test('describePost and describeEvents carry no values except enums/numbers', () => {
  const p = post('secret-post-id', true, [
    video(
      [
        ['hd', 'https://cdn.example/secret-signed?x=1'],
        ['dash', ''],
      ],
      { duration: 754, title: 'Secret title' },
    ),
    { type: 'text', content: '["Secret body", "unstyled", []]' },
  ]);
  const text = describePost({ ...p, signedQuery: '?secret=1' }).join('\n');
  expect(text).toContain('hasAccess=true');
  expect(text).toContain('data: 2 blocks [ok_video×1, text×1]');
  expect(text).toContain('types=[hd]');
  expect(text).toContain('duration=754');
  expect(text).toContain('signedQuery=string');
  for (const secret of ['secret', 'Secret', 'cdn.example', 'Author']) {
    expect(text).not.toContain(secret);
  }

  const events = describeEvents({
    data: {
      notificationStandalone: {
        events: [
          { type: 'video_stream_start', blog: { blogUrl: 'secret' } },
          { type: 'post_new' },
          { type: 'post_new' },
        ],
        count: { total: 3, unread: 1, byEventType: [] },
        updateTime: 1,
      },
    },
    extra: { offset: 'opaque-cursor', isLast: false },
  });
  expect(events.verified).toBe(true);
  expect(events.cursor).toBe('opaque-cursor');
  const eventText = events.lines.join('\n');
  expect(eventText).toContain('video_stream_start×1, post_new×2');
  expect(eventText).toContain('total=3, unread=1');
  expect(eventText).not.toContain('secret');
  expect(eventText).not.toContain('opaque-cursor');
  expect(describeEvents({ extra: { offset: 'c', isLast: true } }).cursor).toBe(
    undefined,
  );
  expect(describeEvents({ data: {} }).verified).toBe(false);
});

test('unknownBlockTypes lists only unrecognized block types', () => {
  expect(
    unknownBlockTypes({
      data: [post('a', true, [{ type: 'text' }, { type: 'quiz_new' }])],
    }),
  ).toEqual(['quiz_new']);
  expect(unknownBlockTypes({ data: [{ type: 'subscription' }] })).toEqual([]);
});

// ----------------------------------------------------------- sanitizer ----

const SECRET_STRINGS = [
  'Real Post Title',
  'Ivan Ivanov',
  'ivan-blog',
  '0b6f3c1e-5a4d-4c2e-9f1a-2b3c4d5e6f70',
  'https://images.boosty.to/image/abc?change_time=1',
  'https://vd.okcdn.ru/?expires=1&sig=abcdef',
  '//cdn.example/protocol-relative',
  '&sig=deadbeef&expires=1761000000',
  '+79991234567',
  'user@example.com',
  'a'.repeat(64),
  'Bearer abc',
  '["Secret paragraph", "unstyled", [[0, 0, 6]]]',
  'mp3',
  'free form status words',
  'raw text content, not json',
];

function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    out.push(v);
  } else if (Array.isArray(v)) {
    v.forEach(x => collectStrings(x, out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      collectStrings(x, out);
    }
  }
  return out;
}

function collectKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) {
    v.forEach(x => collectKeys(x, out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      collectKeys(x, out);
    }
  }
  return out;
}

const sample = () => ({
  data: [
    {
      id: SECRET_STRINGS[3],
      int_id: 123456789012,
      title: SECRET_STRINGS[0],
      createdAt: 1_761_000_000,
      hasAccess: true,
      signedQuery: SECRET_STRINGS[7],
      user: {
        name: SECRET_STRINGS[1],
        blogUrl: SECRET_STRINGS[2],
        avatarUrl: SECRET_STRINGS[4],
        phone: SECRET_STRINGS[8],
        email: SECRET_STRINGS[9],
      },
      data: [
        {
          type: 'text',
          content: SECRET_STRINGS[12],
          modificator: 'BLOCK_END',
        },
        { type: 'text', content: SECRET_STRINGS[15], modificator: '' },
        { type: 'link', content: SECRET_STRINGS[12], url: SECRET_STRINGS[4] },
        {
          type: 'ok_video',
          id: 'media-xyz',
          vid: '9876',
          title: SECRET_STRINGS[0],
          duration: 754,
          timeCode: 12,
          preview: SECRET_STRINGS[4],
          playerUrls: [
            { type: 'hd', url: SECRET_STRINGS[5] },
            { type: 'dash', url: '' },
          ],
        },
        {
          type: 'audio_file',
          url: SECRET_STRINGS[6],
          fileType: SECRET_STRINGS[13],
          size: 12_345_678_901,
        },
        { type: 'brand_new_block', payload: SECRET_STRINGS[10] },
      ],
      teaser: [],
      count: { likes: 5, comments: 2 },
    },
  ],
  extra: { offset: SECRET_STRINGS[11], isLast: false },
  status: SECRET_STRINGS[14],
  error: 'invalid_grant',
  [`key ${SECRET_STRINGS[8]}`]: 1,
});

test('sanitizer: no input string survives except allowlisted enums', () => {
  const out = sanitizeFixture(sample());
  const strings = collectStrings(out);
  for (const secret of SECRET_STRINGS) {
    for (const s of strings) {
      expect(s.includes(secret)).toBe(false);
    }
  }
  const sourceKeys = new Set(collectKeys(sample()));
  const allowedValues = new Set([
    'text',
    'BLOCK_END',
    'link',
    'ok_video',
    'hd',
    'dash',
    'audio_file',
    'brand_new_block',
    'invalid_grant',
    'redacted',
    '?sig=REDACTED',
    '',
  ]);
  for (const s of strings) {
    const ok =
      allowedValues.has(s) ||
      /^synthetic-(id|blog|key)-\d+$/.test(s) ||
      /^https:\/\/example\.invalid\/[a-z-]+$/.test(s) ||
      s.startsWith('["Sample text"') ||
      (sourceKeys.has(s) && /^[A-Za-z_$][\w$-]*$/.test(s));
    expect({ s, ok }).toEqual({ s, ok: true });
  }
  expect(JSON.stringify(out)).not.toMatch(/\d{9,}"/);
});

test('sanitizer: rules for ids, urls, signedQuery, content, numbers', () => {
  const sanitize = createFixtureSanitizer();
  const out = sanitize(sample()) as {
    data: Array<
      Record<string, unknown> & { data: Array<Record<string, unknown>> }
    >;
    extra: Record<string, unknown>;
    status: unknown;
    error: unknown;
  };
  const p = out.data[0];
  expect(p.id).toBe('synthetic-id-1');
  expect(p.int_id).toBe(1001);
  expect(p.createdAt).toBe(1_761_000_000);
  expect(p.hasAccess).toBe(true);
  expect(p.signedQuery).toBe('?sig=REDACTED');
  expect(p.title).toBe('redacted');
  expect(p.user).toEqual({
    name: 'redacted',
    blogUrl: 'synthetic-blog-1',
    avatarUrl: 'https://example.invalid/avatar',
    phone: 'redacted',
    email: 'redacted',
  });
  const [text, raw, link, vid, audio, unknown] = p.data;
  expect(JSON.parse(text.content as string)).toEqual([
    'Sample text',
    'unstyled',
    [[0, 0, 6]],
  ]);
  expect(text.modificator).toBe('BLOCK_END');
  expect(JSON.parse(raw.content as string)).toEqual([
    'Sample text',
    'unstyled',
    [],
  ]);
  expect(link.url).toBe('https://example.invalid/link');
  expect(vid).toMatchObject({
    type: 'ok_video',
    id: 'synthetic-id-2',
    vid: 'synthetic-id-3',
    duration: 754,
    timeCode: 12,
    preview: 'https://example.invalid/preview',
    playerUrls: [
      { type: 'hd', url: 'https://example.invalid/player' },
      { type: 'dash', url: '' },
    ],
  });
  expect(audio).toEqual({
    type: 'audio_file',
    url: 'https://example.invalid/audio-file',
    fileType: 'redacted',
    size: 12_345_678_901,
  });
  expect(unknown).toEqual({ type: 'brand_new_block', payload: 'redacted' });
  expect(out.extra).toEqual({ offset: 'redacted', isLast: false });
  expect(out.status).toBe('redacted');
  expect(out.error).toBe('invalid_grant');
  expect(Object.keys(out)).toContain('synthetic-key-1');

  // Stable ids within one sanitizer.
  expect((sanitize({ id: SECRET_STRINGS[3] }) as { id: string }).id).toBe(
    'synthetic-id-1',
  );
});

// --------------------------------------------------------------- runner ----

type Route = (
  path: string,
  auth: boolean,
) => { status: number; body?: unknown };

function fakeCaller(route: Route) {
  const counts = { refresh: 0, api: 0 };
  const paths: string[] = [];
  const respond = (request: ApiRequest, auth: boolean) => {
    const path = request.url.replace(BASE, '');
    paths.push(`${auth ? 'auth' : 'noauth'} ${request.name} ${path}`);
    const { status, body } = route(path, auth);
    const text = body === undefined ? '' : JSON.stringify(body);
    return {
      status,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'application/json' : null),
      },
      text: async () => text,
    };
  };
  const fetchImpl: FetchLike = async (url, init) =>
    respond(
      { name: 'E1-noauth', url, method: 'GET', headers: init.headers },
      'Authorization' in init.headers,
    );
  const caller: SessionCaller = {
    getCounts: () => ({ ...counts }),
    async callWithSession(build): Promise<CallResult> {
      counts.api += 1;
      const request = build();
      const r = respond(request, true);
      const raw = await r.text();
      return {
        kind: 'response',
        sanitized: {
          request: request.name,
          status: r.status,
          contentType: 'application/json',
          isJson: raw !== '',
          shape: [],
          captchaMentioned: false,
        },
        json: raw ? JSON.parse(raw) : undefined,
        refreshed: false,
        retried: false,
      };
    },
  };
  return { caller, fetchImpl, paths };
}

const happyRoute: Route = (path, auth) => {
  if (!auth) {
    return {
      status: 401,
      body: { error: 'unauthorized', error_description: 'x' },
    };
  }
  if (path === '/v1/user/current') {
    return { status: 200, body: { id: 1 } };
  }
  if (path.startsWith('/v1/user/subscriptions')) {
    return {
      status: 200,
      body: {
        data: [{ blog: { blogUrl: 'b1' } }, { blog: { blogUrl: 'b2' } }],
      },
    };
  }
  if (path.startsWith('/v1/blog/b1/post/?')) {
    return {
      status: 200,
      body: { data: [post('acc', true, [video([['hd', 'https://x/y']])])] },
    };
  }
  if (path.startsWith('/v1/blog/b2/post/?')) {
    return { status: 200, body: { data: [post('lock', false, [])] } };
  }
  if (path.startsWith('/v1/feed/post/')) {
    return {
      status: 200,
      body: { data: { posts: [post('lock', false, [])] } },
    };
  }
  if (path === '/v1/blog/author-blog') {
    return { status: 200, body: { title: 'T' } };
  }
  if (path.startsWith('/v1/blog/author-blog/post/acc?')) {
    return {
      status: 200,
      body: post('acc', true, [video([['hd', 'https://x/y']])]),
    };
  }
  if (path.startsWith('/v1/blog/author-blog/post/lock?')) {
    return { status: 200, body: post('lock', false, []) };
  }
  if (path.endsWith('/video_stream')) {
    return { status: 204 };
  }
  if (path.startsWith('/v1/notification/standalone/event/?offset=')) {
    return {
      status: 200,
      body: { data: { notificationStandalone: { events: [] } } },
    };
  }
  if (path === '/v1/notification/standalone/event/') {
    return {
      status: 200,
      body: {
        data: { notificationStandalone: { events: [{ type: 'post_new' }] } },
        extra: { offset: 'c1', isLast: false },
      },
    };
  }
  return { status: 404, body: { error: 'not_found' } };
};

test('runner: full matrix in order within the budget', async () => {
  const { caller, fetchImpl, paths } = fakeCaller(happyRoute);
  const lines: string[] = [];
  const report = await runContentShapes({
    caller,
    fetchImpl,
    log: l => lines.push(l),
  });
  expect(report.stopped).toBeUndefined();
  expect(
    paths.map(p => p.replace(/[0-9a-f-]{36}|spike-missing-[a-z]+/, '<rnd>')),
  ).toEqual([
    'auth E1 /v1/user/current',
    'auth E2 /v1/user/subscriptions?limit=30&with_follow=true',
    'auth E4 /v1/blog/b1/post/?limit=20&comments_limit=0&reply_limit=0',
    'auth E4 /v1/blog/b2/post/?limit=20&comments_limit=0&reply_limit=0',
    'auth E5 /v1/feed/post/?limit=10&comments_limit=0&reply_limit=0',
    'auth E3 /v1/blog/author-blog',
    'auth E8 /v1/blog/author-blog/post/acc?comments_limit=0&reply_limit=0',
    'auth E8 /v1/blog/author-blog/post/lock?comments_limit=0&reply_limit=0',
    'auth E15 /v1/blog/author-blog/video_stream',
    'noauth E1-noauth /v1/user/current',
    'noauth E1-noauth /v1/blog/author-blog/post/acc?comments_limit=0&reply_limit=0',
    'auth E8-missing /v1/blog/author-blog/post/<rnd>?comments_limit=0&reply_limit=0',
    'auth E3-missing /v1/blog/<rnd>',
    'auth E18 /v1/notification/standalone/event/',
    'auth E18-page2 /v1/notification/standalone/event/?offset=c1',
  ]);
  expect(report.requests).toBe(15);
  expect(report.requests).toBeLessThanOrEqual(REQUEST_BUDGET);
  expect(report.rows.map(r => r.id)).toEqual([
    'session',
    'accessible',
    'locked',
    'live',
    'no-token',
    'missing',
    'events',
    'unknown-block',
  ]);
  const byId = Object.fromEntries(report.rows.map(r => [r.id, r.summary]));
  expect(byId.accessible).toBe('E4 found=true, E5 found=false, E8 HTTP 200');
  expect(byId.locked).toBe('E4 found=true, E5 found=true, E8 HTTP 200');
  expect(byId.live).toBe('blog #1: HTTP 204');
  expect(byId['no-token']).toMatch(
    /^E1 HTTP 401 .*E8 \(accessible post\) HTTP 401/,
  );
  expect(byId.missing).toBe(
    'E8 random post id HTTP 404; E3 random slug HTTP 404',
  );
  expect(byId.events).toContain('EVT-01 shape verified');
  expect(byId.events).toContain('page 2 via extra.offset (inferred) HTTP 200');

  // Fixtures: no E1-with-token, every file passes the sanitizer contract.
  const files = buildFixtures(report.captures);
  const names = files.map(f => f.name);
  expect(names).not.toContain('e1-current-user.json');
  expect(names).toEqual(
    expect.arrayContaining([
      'e2-subscriptions.json',
      'e8-post-accessible.json',
      'e8-post-locked.json',
      'e15-video-stream-1.json',
      'e1-no-token.json',
      'e18-events-page2.json',
    ]),
  );
  const e15 = JSON.parse(
    files.find(f => f.name === 'e15-video-stream-1.json')!.text,
  );
  expect(e15).toEqual({ case: 'e15-video-stream-1', status: 204, body: null });
  const all = files.map(f => f.text).join('\n');
  expect(all).not.toMatch(/https:\/\/x\/|author-blog|"acc"|"lock"|c1/);
});

test('runner: no cursor → no page 2; stops when no post is found', async () => {
  const noCursor: Route = (path, auth) =>
    path === '/v1/notification/standalone/event/'
      ? {
          status: 200,
          body: { data: { notificationStandalone: { events: [] } } },
        }
      : happyRoute(path, auth);
  const a = fakeCaller(noCursor);
  const r1 = await runContentShapes({
    caller: a.caller,
    fetchImpl: a.fetchImpl,
    log: () => {},
  });
  expect(a.paths.some(p => p.includes('E18-page2'))).toBe(false);
  expect(r1.rows.find(r => r.id === 'events')?.summary).toContain(
    'no cursor offered',
  );

  const empty: Route = (path, auth) =>
    path.includes('/post/?')
      ? { status: 200, body: { data: [] } }
      : happyRoute(path, auth);
  const b = fakeCaller(empty);
  const r2 = await runContentShapes({
    caller: b.caller,
    fetchImpl: b.fetchImpl,
    log: () => {},
  });
  expect(r2.stopped).toBe('no accessible or locked post found');
  expect(b.paths).toHaveLength(4); // E1, E2, 2 × E4
});

test('runner: scans at most 5 blogs and never exceeds the budget', async () => {
  const many: Route = (path, auth) => {
    if (path.startsWith('/v1/user/subscriptions')) {
      return {
        status: 200,
        body: {
          data: Array.from({ length: 9 }, (_, i) => ({
            blog: { blogUrl: `b${i}` },
          })),
        },
      };
    }
    if (path.includes('/post/?')) {
      return { status: 200, body: { data: [post('acc', true, [])] } };
    }
    return happyRoute(path, auth);
  };
  const c = fakeCaller(many);
  const r = await runContentShapes({
    caller: c.caller,
    fetchImpl: c.fetchImpl,
    log: () => {},
  });
  expect(c.paths.filter(p => p.includes(' E4 '))).toHaveLength(5);
  expect(r.rows.find(x => x.id === 'locked')?.summary).toBe(
    'not found in 5 blogs',
  );
  expect(r.requests).toBeLessThanOrEqual(REQUEST_BUDGET);

  // A caller that already spent most of the budget stops before overrunning.
  const d = fakeCaller(happyRoute);
  const inner = d.caller.getCounts;
  let extra = 0;
  d.caller.getCounts = () => {
    const x = inner();
    return { refresh: x.refresh, api: x.api + extra };
  };
  const original = d.caller.callWithSession;
  d.caller.callWithSession = async build => {
    extra += 4; // each call costs 5 in this scenario
    return original(build);
  };
  const r3 = await runContentShapes({
    caller: d.caller,
    fetchImpl: d.fetchImpl,
    log: () => {},
  });
  expect(r3.stopped).toBe(`request budget (${REQUEST_BUDGET}) reached`);
  expect(r3.requests).toBeLessThanOrEqual(REQUEST_BUDGET);
});

test('runner: a failed session call stops the run', async () => {
  const caller: SessionCaller = {
    getCounts: () => ({ refresh: 0, api: 0 }),
    callWithSession: async () => ({ kind: 'signed-out' }),
  };
  const r = await runContentShapes({
    caller,
    fetchImpl: jest.fn() as unknown as FetchLike,
    log: () => {},
  });
  expect(r.stopped).toBe('session call failed (signed-out)');
  expect(r.rows.map(x => x.id)).toEqual(['unknown-block']);
});
