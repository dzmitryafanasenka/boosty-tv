/**
 * Story 7.5: EventRepository (E18) over FixtureTransport and the real
 * HttpClient, and the one mapper (`mapEvents`). Every mapper row of the
 * spec's I/O matrix: stream, post / promo, owner-side types, unknown type,
 * comment types, malformed, the blog fallback and the order.
 */
import { AppError } from '../../../api/appError';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e18Live from '../../../../test/fixtures/boosty/e18-events.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e18Synthetic from '../../../../test/fixtures/boosty/e18-events-synthetic.json';
import { EVENTS_PATH, EventRepository } from '../eventRepository';
import { isHiddenEventType, mapEvents } from '../mapEvents';

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

type Json = Record<string, unknown>;
let nextId = 2001;
/** One synthetic E18 event; `overrides` replace fields (undefined removes one). */
function event(overrides: Json = {}): Json {
  const id = nextId++;
  return {
    id,
    type: 'video_stream_start',
    eventTime: 1_700_000_000 + (id - 2000) * 3600,
    isRead: false,
    author: { id: 1001, name: 'Author', avatarUrl: 'https://example.invalid/avatar', hasAvatar: true },
    blog: { blogUrl: 'synthetic-blog-1' },
    aggregation: { id: 1002, type: 'x' },
    ...overrides,
  };
}
const map = (items: unknown[]) => mapEvents(items, createLogger());

describe('E18 list', () => {
  it('one GET of the path with no params, content profile; the live body (`target_new` only) shows no row', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e18Live.body }));
    expect(await EventRepository.list(http)).toEqual([]);
    expect(transport.calls.map(c => [c.method, c.url])).toEqual([
      ['GET', `https://api.boosty.to${EVENTS_PATH}`],
    ]);
    expect(transport.calls[0].headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
    expect(transport.calls[0].headers['X-App']).toBeUndefined();
  });

  it('the synthetic body: the stream row, the promo (blog from target) and the unknown type (no blog: target not used); comment hidden, no-id and bad-time dropped', async () => {
    const logger = createLogger();
    const { http } = client(() => ({ status: 200, body: e18Synthetic.body }));
    expect(await EventRepository.list(http, logger)).toEqual([
      {
        id: '1184',
        type: 'video_stream_start',
        kind: 'stream',
        time: 1_700_028_800,
        isRead: false,
        authorName: 'redacted',
        avatarUrl: 'https://example.invalid/avatar',
        blogUrl: 'synthetic-blog-1',
      },
      expect.objectContaining({ id: '1189', type: 'promo_new', kind: 'generic', blogUrl: 'synthetic-blog-4' }),
      expect.objectContaining({ id: '1191', type: 'synthetic_unknown_type', kind: 'generic', blogUrl: null }),
    ]);
    expect(logger.entries()).toEqual([
      expect.objectContaining({ level: 'warn', scope: 'event', message: 'dropped', fields: { count: '2' } }),
      expect.objectContaining({ level: 'info', scope: 'event', message: 'not shown', fields: { hidden: '1', repeated: '0' } }),
      expect.objectContaining({ level: 'info', scope: 'event', message: 'unknown types shown', fields: { count: '1' } }),
    ]);
  });

  it.each([
    ['no `data`', {}],
    ['no notificationStandalone', { data: {} }],
    ['events not an array', { data: { notificationStandalone: { events: {} } } }],
  ])('%s: `Parse` for the whole list', async (_name, body) => {
    const { http } = client(() => ({ status: 200, body }));
    expect(await kindOf(EventRepository.list(http))).toBe('Parse');
  });

  it('an empty list is an empty result', async () => {
    const { http } = client(() => ({ status: 200, body: { data: { notificationStandalone: { events: [] } } } }));
    expect(await EventRepository.list(http)).toEqual([]);
  });

  it.each([
    ['5xx', { status: 503 }, 'Server'],
    ['network', { network: true as const }, 'Network'],
    ['403', { status: 403 }, 'Client'],
  ])('a %s failure is sent once (no automatic retry) and rejects', async (_name, reply, kind) => {
    const { http, transport } = client(() => reply);
    expect(await kindOf(EventRepository.list(http))).toBe(kind);
    expect(transport.calls).toHaveLength(1);
  });
});

describe('mapEvents', () => {
  it('stream: `video_stream_start` → kind `stream`', () => {
    expect(map([event()])[0]).toMatchObject({ type: 'video_stream_start', kind: 'stream' });
  });

  it.each(['post_new', 'promo_new'])('%s: shown, kind `generic`, its type kept for its own text', type => {
    expect(map([event({ type })])[0]).toMatchObject({ type, kind: 'generic' });
  });

  it('an unknown type is shown (generic)', () => {
    expect(map([event({ type: 'brand_new_type' })])[0]).toMatchObject({ type: 'brand_new_type', kind: 'generic' });
  });

  it.each([
    'donation_new',
    'subscriber_new',
    'blog_stat_report_ok',
    'blog_stat_report_failed',
    'blog_stat_report_future',
    'post_buy',
    'message_buy',
    'bundle_buy',
    'referal_new_blogger',
    'referal_new_user',
    'support_ticket_update',
    'level_subscribers_limit_reached',
    'target_new',
  ])('owner-side type %s is not shown (Q3 a)', type => {
    expect(isHiddenEventType(type)).toBe(true);
    expect(map([event({ type })])).toEqual([]);
  });

  it.each(['DONATION_NEW', 'Target_New', 'Blog_Stat_Report_OK', 'REFERAL_X'])('owner-side type %s is hidden case-insensitively', type => {
    expect(map([event({ type })])).toEqual([]);
  });

  it('an unknown shown type is counted in a counts-only info log; known types are not', () => {
    const logger = createLogger();
    mapEvents([event({ type: 'brand_new_type' }), event({ type: 'other_new' }), event({ type: 'post_new' })], logger);
    expect(logger.entries()).toEqual([
      expect.objectContaining({ level: 'info', message: 'unknown types shown', fields: { count: '2' } }),
    ]);
    expect(JSON.stringify(logger.entries())).not.toMatch(/brand_new|other_new/);
  });

  it.each(['post_comment_new', 'post_comment_new_reply', 'comment_reply_new', 'POST_COMMENT_NEW', 'blog_Comment_like'])('comment type %s is never shown', type => {
    expect(map([event({ type })])).toEqual([]);
  });

  it.each([
    ['no id', { id: undefined }],
    ['an empty id', { id: '' }],
    ['no type', { type: undefined }],
    ['a blank type', { type: '  ' }],
    ['no time', { eventTime: undefined }],
    ['a string time', { eventTime: '1700000000' }],
    ['a zero time', { eventTime: 0 }],
    ['a negative time', { eventTime: -5 }],
    ['a time in milliseconds', { eventTime: 1_700_000_000_000 }],
    ['an infinite time', { eventTime: Number.POSITIVE_INFINITY }],
  ])('malformed (%s): that event alone is dropped; a counts-only warning', (_name, overrides) => {
    const logger = createLogger();
    const good = event();
    const rows = mapEvents([event({ ...overrides, author: { name: 'Secret name' } }), good], logger);
    expect(rows.map(r => r.id)).toEqual([String(good.id)]);
    expect(logger.entries()).toEqual([
      expect.objectContaining({ level: 'warn', message: 'dropped', fields: { count: '1' } }),
    ]);
    expect(JSON.stringify(logger.entries())).not.toMatch(/Secret|example\.invalid|synthetic-blog/);
  });

  it.each([null, 'event', 5, []])('a non-object item (%p) is dropped', raw => {
    expect(map([raw, event()])).toHaveLength(1);
  });

  it('newest first; equal times keep the API order; a numeric id becomes a string', () => {
    const a = event({ id: 3001, eventTime: 1_700_003_600 });
    const b = event({ id: 3002, eventTime: 1_700_010_800 });
    const c = event({ id: 'x-3', eventTime: 1_700_003_600 });
    expect(map([a, b, c]).map(r => r.id)).toEqual(['3002', '3001', 'x-3']);
  });

  it('a repeated id keeps the first occurrence', () => {
    const rows = map([event({ id: 4001, type: 'post_new' }), event({ id: 4001, type: 'promo_new' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('post_new');
  });

  it('isRead: only `false` shows the dot; missing or a wrong type reads as read', () => {
    expect(map([event({ isRead: false })])[0].isRead).toBe(false);
    expect(map([event({ isRead: true })])[0].isRead).toBe(true);
    expect(map([event({ isRead: undefined })])[0].isRead).toBe(true);
    expect(map([event({ isRead: 'no' })])[0].isRead).toBe(true);
  });

  it.each(['video_stream_start', 'post_new', 'promo_new'])('the `target.bloggerUrl` fallback applies to the known type %s', type => {
    expect(map([event({ type, blog: undefined, target: { bloggerUrl: 'synthetic-blog-2' } })])[0].blogUrl).toBe(
      'synthetic-blog-2',
    );
  });

  it('an unknown type uses `blog.blogUrl` only (no `target` fallback)', () => {
    const type = 'brand_new_type';
    expect(map([event({ type, blog: undefined, target: { bloggerUrl: 'synthetic-blog-2' } })])[0].blogUrl).toBeNull();
    expect(map([event({ type, blog: { blogUrl: 'synthetic-blog-3' } })])[0].blogUrl).toBe('synthetic-blog-3');
  });

  it('the blog: `blog.blogUrl`, else `target.bloggerUrl`; an unsafe or missing value → null (the row is still shown)', () => {
    expect(map([event()])[0].blogUrl).toBe('synthetic-blog-1');
    expect(map([event({ blog: undefined, target: { bloggerUrl: 'synthetic-blog-2' } })])[0].blogUrl).toBe(
      'synthetic-blog-2',
    );
    expect(map([event({ blog: { blogUrl: 'a/b' }, target: { bloggerUrl: 'synthetic-blog-2' } })])[0].blogUrl).toBe(
      'synthetic-blog-2',
    );
    expect(map([event({ blog: { blogUrl: '..' } })])[0].blogUrl).toBeNull();
    expect(map([event({ blog: 'synthetic-blog-1' })])[0].blogUrl).toBeNull();
    expect(map([event({ blog: undefined })])).toHaveLength(1);
  });

  it('the author: trimmed name, else null; an http(s) avatar unless `hasAvatar: false`', () => {
    expect(map([event({ author: { name: '  Ann  ' } })])[0]).toMatchObject({ authorName: 'Ann', avatarUrl: null });
    expect(map([event({ author: { name: ' ' } })])[0].authorName).toBeNull();
    expect(map([event({ author: undefined })])[0]).toMatchObject({ authorName: null, avatarUrl: null });
    expect(map([event({ author: 'x' })])[0].authorName).toBeNull();
    expect(
      map([event({ author: { name: 'A', avatarUrl: 'https://example.invalid/avatar', hasAvatar: false } })])[0]
        .avatarUrl,
    ).toBeNull();
    expect(map([event({ author: { name: 'A', avatarUrl: 'ftp://example.invalid/avatar' } })])[0].avatarUrl).toBeNull();
  });

  it('no money, target or aggregation field in the entity', () => {
    const [row] = map([event({ target: { bloggerUrl: 'synthetic-blog-1', currentSum: 5 } })]);
    expect(Object.keys(row).sort()).toEqual(
      ['authorName', 'avatarUrl', 'blogUrl', 'id', 'isRead', 'kind', 'time', 'type'].sort(),
    );
  });
});
