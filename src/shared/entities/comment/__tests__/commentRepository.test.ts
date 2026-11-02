/**
 * Story 11.1: CommentRepository (E19) over FixtureTransport and the real
 * HttpClient, and the one mapper (`mapComments`). Every row of the spec's
 * I/O matrix: first page, last page, replies, merge, malformed item,
 * unknown block, denied, not found, shape change and network.
 */
import { AppError } from '../../../api/appError';
import { createFixtureTransport, fixtureReply, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken, type AccessTokenSource, type HttpClient } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e19Page1 from '../../../../test/fixtures/boosty/e19-comments-1.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e19Page2 from '../../../../test/fixtures/boosty/e19-comments-2.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e19Repeat from '../../../../test/fixtures/boosty/e19-comments-repeat.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e19Replies from '../../../../test/fixtures/boosty/e19-replies.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e19Empty from '../../../../test/fixtures/boosty/e19-empty.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e19Locked from '../../../../test/fixtures/boosty/e19-locked.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e19Missing from '../../../../test/fixtures/boosty/e19-missing.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e19ShapeChange from '../../../../test/fixtures/boosty/e19-shape-change.json';
import {
  COMMENTS_PAGE_SIZE,
  COMMENT_INLINE_REPLY_LIMIT,
  CommentRepository,
  commentsPath,
} from '../commentRepository';
import { mapComments, mergeCommentPages, mergeComments } from '../mapComments';
import type { Comment, CommentPageResult } from '../types';

const TOKEN = 't'.repeat(64);

function client(handler: FixtureHandler, tokens: AccessTokenSource = fixedAccessToken(TOKEN)) {
  const transport = createFixtureTransport(handler);
  const http = createHttpClient({ transport, tokens, sleep: () => Promise.resolve(), logger: createLogger() });
  return { http, transport };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const BLOG = 'synthetic-blog-1';
const POST = 'synthetic-id-1001';
const PATH = `/v1/blog/${BLOG}/post/${POST}/comment/`;

function okPage(result: CommentPageResult) {
  if (result.kind !== 'ok') {
    throw new Error(`expected ok, got ${result.kind}`);
  }
  return result.page;
}

const ids = (comments: readonly Comment[]) => comments.map(c => c.id);

describe('E19 path', () => {
  it('the live request: limit, reply_limit, order=top; offset and parent_id when given', () => {
    expect(commentsPath(BLOG, POST, null)).toBe(`${PATH}?limit=20&reply_limit=2&order=top`);
    expect(commentsPath(BLOG, POST, '1201')).toBe(`${PATH}?limit=20&reply_limit=2&order=top&offset=1201`);
    expect(commentsPath(BLOG, POST, null, 1203)).toBe(`${PATH}?limit=20&reply_limit=2&order=top&parent_id=1203`);
    expect(COMMENTS_PAGE_SIZE).toBe(20);
    expect(COMMENT_INLINE_REPLY_LIMIT).toBe(2);
  });

  it.each([
    ['a bad blogUrl', 'a/b', POST, null],
    ['an empty postId', BLOG, '', null],
    ['a dot-dot postId', BLOG, '..', null],
    ['a non-integer cursor', BLOG, POST, 'abc'],
  ])('%s throws Client before a request', (_name, blog, post, cursor) => {
    expect(() => commentsPath(blog, post, cursor)).toThrow(AppError);
  });

  it('the parsed (trimmed) blogUrl is sent', () => {
    expect(commentsPath(` ${BLOG} `, POST, null)).toBe(`${PATH}?limit=20&reply_limit=2&order=top`);
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53])('parentIntId %s throws Client', parent => {
    expect(() => commentsPath(BLOG, POST, null, parent)).toThrow(AppError);
  });

  it.each(['0', '-1', '1.5', '9007199254740993', ''])('cursor %j throws Client', cursor => {
    expect(() => commentsPath(BLOG, POST, cursor)).toThrow(AppError);
  });

  it('replies with an invalid cursor or parent: an error outcome, nothing sent', async () => {
    const { http, transport } = client(() => fixtureReply(e19Replies));
    expect((await CommentRepository.replies(http, BLOG, POST, 1203, 'abc')).kind).toBe('error');
    expect((await CommentRepository.replies(http, BLOG, POST, 0, null)).kind).toBe('error');
    expect(transport.calls).toHaveLength(0);
  });

  it('an invalid path is an error outcome and sends nothing', async () => {
    const { http, transport } = client(() => fixtureReply(e19Empty));
    const result = await CommentRepository.page(http, 'a/b', POST, null);
    expect(result).toEqual({ kind: 'error', error: expect.objectContaining({ kind: 'Client' }) });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('E19 page', () => {
  it('first page: one GET, content profile; comments in server order with the entity shape; nextCursor = the smallest intId', async () => {
    const logger = createLogger();
    const { http, transport } = client(() => fixtureReply(e19Page1));
    const page = okPage(await CommentRepository.page(http, BLOG, POST, null, logger));
    expect(transport.calls.map(c => [c.method, c.path])).toEqual([['GET', PATH]]);
    expect(transport.calls[0].url).toBe(`https://api.boosty.to${PATH}?limit=20&reply_limit=2&order=top`);
    expect(transport.calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(transport.calls[0].headers['X-App']).toBeUndefined();
    // The malformed item (no id) is dropped; the others keep server order.
    expect(ids(page.comments)).toEqual(['synthetic-id-1201', 'synthetic-id-1202', 'synthetic-id-1203', 'synthetic-id-1204']);
    // The cursor advances past the dropped item too (its intId is the smallest).
    expect(page.nextCursor).toBe('1200');
    expect(page.comments[0]).toEqual({
      id: 'synthetic-id-1201',
      intId: 1201,
      author: { name: 'redacted', avatarUrl: 'https://example.invalid/avatar' },
      replyTo: null,
      blocks: [
        { type: 'text', text: 'Sample text', spans: [], paragraphEnd: false },
        { type: 'text', text: '', spans: [], paragraphEnd: true },
      ],
      createdAt: 1_700_000_000 + 2 * 3600,
      replyCount: 0,
      replies: [],
      hasMoreReplies: false,
    });
    expect(logger.entries()).toContainEqual(
      expect.objectContaining({ level: 'warn', scope: 'comment', message: 'dropped', fields: { count: '1' } }),
    );
    // Counts only: no text, name, id or URL in the log.
    expect(JSON.stringify(logger.entries())).not.toMatch(/Sample text|redacted|synthetic-id|example\.invalid/);
  });

  it('inline replies: mapped the same way, with replyTo; isLast false → hasMoreReplies', async () => {
    const { http } = client(() => fixtureReply(e19Page1));
    const page = okPage(await CommentRepository.page(http, BLOG, POST, null));
    const thread = page.comments.find(c => c.id === 'synthetic-id-1203');
    expect(thread?.replyCount).toBe(5);
    expect(thread?.hasMoreReplies).toBe(true);
    expect(ids(thread?.replies ?? [])).toEqual(['synthetic-id-1311', 'synthetic-id-1312']);
    expect(thread?.replies[0].replyTo).toEqual({ name: 'redacted' });
    expect(thread?.replies[0].replies).toEqual([]);
    expect(thread?.replies[0].hasMoreReplies).toBe(false);
  });

  it('unknown block: {type: unknown} through mapBlocks; the comment is kept', async () => {
    const { http } = client(() => fixtureReply(e19Page1));
    const page = okPage(await CommentRepository.page(http, BLOG, POST, null));
    const comment = page.comments.find(c => c.id === 'synthetic-id-1202');
    expect(comment?.blocks[0]).toEqual({ type: 'unknown', rawType: 'synthetic_new_block' });
    expect(comment?.blocks).toHaveLength(3);
  });

  it('last page (isLast true): nextCursor null; the cursor is sent as offset', async () => {
    const { http, transport } = client(() => fixtureReply(e19Page2));
    const page = okPage(await CommentRepository.page(http, BLOG, POST, '1200'));
    expect(ids(page.comments)).toEqual(['synthetic-id-1101', 'synthetic-id-1102']);
    expect(page.nextCursor).toBeNull();
    expect(transport.calls[0].url).toContain('&offset=1200');
  });

  it('no extra: the paging ends', async () => {
    const { http } = client(() => ({ status: 200, body: { data: e19Page1.body.data } }));
    expect(okPage(await CommentRepository.page(http, BLOG, POST, null)).nextCursor).toBeNull();
  });

  it('a malformed isLast (not false) ends the paging', async () => {
    const { http } = client(() => ({ status: 200, body: { ...e19Page1.body, extra: { isFirst: true, isLast: 'false' } } }));
    expect(okPage(await CommentRepository.page(http, BLOG, POST, null)).nextCursor).toBeNull();
  });

  it('a server that ignores offset (the same page again): the paging ends, no loop', async () => {
    const { http, transport } = client(() => fixtureReply(e19Page1));
    const first = okPage(await CommentRepository.page(http, BLOG, POST, null));
    expect(first.nextCursor).toBe('1200');
    const again = okPage(await CommentRepository.page(http, BLOG, POST, first.nextCursor));
    expect(again.nextCursor).toBeNull();
    expect(transport.calls).toHaveLength(2);
  });

  it('a next cursor strictly below the one sent continues', async () => {
    const { http } = client(() => fixtureReply(e19Page1));
    expect(okPage(await CommentRepository.page(http, BLOG, POST, '1300')).nextCursor).toBe('1200');
  });

  it('isLast false without a usable intId: the paging ends with a counts-only warning', async () => {
    const logger = createLogger();
    const items = [{ id: 'synthetic-id-1401' }, { id: 'synthetic-id-1402', intId: 'x' }];
    const { http } = client(() => ({ status: 200, body: { data: items, extra: { isFirst: true, isLast: false } } }));
    expect(okPage(await CommentRepository.page(http, BLOG, POST, null, logger)).nextCursor).toBeNull();
    expect(logger.entries()).toContainEqual(
      expect.objectContaining({ level: 'warn', scope: 'comment', message: 'no cursor', fields: { count: '2' } }),
    );
  });

  it('a non-AppError failure: error(Client) and a counts-only warning', async () => {
    const logger = createLogger();
    const http: HttpClient = {
      request: () => Promise.reject(new Error('boom')),
      get: () => Promise.reject(new Error('boom')),
    };
    expect(await CommentRepository.page(http, BLOG, POST, null, logger)).toEqual({
      kind: 'error',
      error: expect.objectContaining({ kind: 'Client' }),
    });
    expect(logger.entries()).toContainEqual(expect.objectContaining({ level: 'warn', scope: 'comment', message: 'unexpected' }));
    expect(JSON.stringify(logger.entries())).not.toContain('boom');
  });

  it('no comments (live: data [] with isLast true): an empty ok page', async () => {
    const { http } = client(() => fixtureReply(e19Empty));
    expect(await CommentRepository.page(http, BLOG, POST, null)).toEqual({
      kind: 'ok',
      page: { comments: [], nextCursor: null },
    });
  });

  it('merge: a repeated id is kept once (first occurrence)', async () => {
    const { http } = client(request => fixtureReply(request.url.includes('offset=') ? e19Repeat : e19Page1));
    const first = okPage(await CommentRepository.page(http, BLOG, POST, null));
    const second = okPage(await CommentRepository.page(http, BLOG, POST, first.nextCursor));
    const merged = mergeComments(first.comments, second.comments);
    expect(ids(merged)).toEqual([...ids(first.comments), 'synthetic-id-1103']);
    expect(merged.find(c => c.id === 'synthetic-id-1201')).toBe(first.comments[0]);
  });
});

describe('mergeCommentPages', () => {
  it('pages in load order → one list, oldest page first, each in server order; a repeated id kept once (first in the result)', () => {
    const newest = mapComments(e19Page1.body.data, 0, createLogger());
    const older = mapComments(e19Repeat.body.data, 0, createLogger());
    const merged = mergeCommentPages([{ comments: newest }, { comments: older }]);
    expect(ids(merged)).toEqual([
      'synthetic-id-1103',
      'synthetic-id-1201',
      'synthetic-id-1202',
      'synthetic-id-1203',
      'synthetic-id-1204',
    ]);
    expect(merged[1]).toBe(older[1]);
    expect(mergeCommentPages([])).toEqual([]);
  });
});

describe('E19 replies (parent_id)', () => {
  it('one GET with parent_id; replies mapped the same way, with their own cursor', async () => {
    const { http, transport } = client(() => fixtureReply(e19Replies));
    const page = okPage(await CommentRepository.replies(http, BLOG, POST, 1203, null));
    expect(transport.calls.map(c => c.method)).toEqual(['GET']);
    expect(transport.calls[0].url).toContain('&parent_id=1203');
    expect(transport.calls[0].url).not.toContain('offset=');
    expect(page.comments).toHaveLength(5);
    expect(page.comments.every(c => c.replyTo?.name === 'redacted' && c.replies.length === 0)).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it('a replies page that is not the last: its cursor is its smallest intId, sent back with parent_id', async () => {
    const { http, transport } = client(() => ({
      status: 200,
      body: { ...e19Replies.body, extra: { isFirst: true, isLast: false } },
    }));
    const page = okPage(await CommentRepository.replies(http, BLOG, POST, 1203, null));
    expect(page.nextCursor).toBe('1311');
    await CommentRepository.replies(http, BLOG, POST, 1203, page.nextCursor);
    expect(transport.calls[1].url).toContain('&offset=1311&parent_id=1203');
  });
});

describe('E19 outcomes', () => {
  it('denied: a 403 (live: a locked post); not retried, no refresh', async () => {
    const renew = jest.fn(() => Promise.resolve(null));
    const tokens: AccessTokenSource = {
      getAccessToken: () => Promise.resolve({ token: TOKEN, refreshed: false }),
      renewAfterUnauthorized: renew,
    };
    const { http, transport } = client(() => fixtureReply(e19Locked), tokens);
    expect(await CommentRepository.page(http, BLOG, POST, null)).toEqual({ kind: 'denied' });
    expect(transport.calls).toHaveLength(1);
    expect(renew).not.toHaveBeenCalled();
  });

  it('denied for replies too', async () => {
    const { http } = client(() => fixtureReply(e19Locked));
    expect(await CommentRepository.replies(http, BLOG, POST, 1203, null)).toEqual({ kind: 'denied' });
  });

  it('notFound: a 404, not retried', async () => {
    const { http, transport } = client(() => fixtureReply(e19Missing));
    expect(await CommentRepository.page(http, BLOG, POST, null)).toEqual({ kind: 'notFound' });
    expect(transport.calls).toHaveLength(1);
  });

  it('shape change: error(Parse), no retry', async () => {
    const { http, transport } = client(() => fixtureReply(e19ShapeChange));
    expect(await CommentRepository.page(http, BLOG, POST, null)).toEqual({
      kind: 'error',
      error: expect.objectContaining({ kind: 'Parse' }),
    });
    expect(transport.calls).toHaveLength(1);
  });

  it('network: error(Network) after the shared GET retries (bounded)', async () => {
    const { http, transport } = client(() => ({ network: true }));
    expect(await CommentRepository.page(http, BLOG, POST, null)).toEqual({
      kind: 'error',
      error: expect.objectContaining({ kind: 'Network' }),
    });
    expect(transport.calls).toHaveLength(3);
  });

  it('a 401 goes through the refresh: one renewal, one retry with the new token', async () => {
    const renew = jest.fn(() => Promise.resolve('n'.repeat(64)));
    const tokens: AccessTokenSource = {
      getAccessToken: () => Promise.resolve({ token: TOKEN, refreshed: false }),
      renewAfterUnauthorized: renew,
    };
    const { http, transport } = client(
      request => (request.headers.Authorization === `Bearer ${TOKEN}` ? { status: 401 } : fixtureReply(e19Empty)),
      tokens,
    );
    expect((await CommentRepository.page(http, BLOG, POST, null)).kind).toBe('ok');
    expect(renew).toHaveBeenCalledTimes(1);
    expect(transport.calls).toHaveLength(2);
  });

  it.each([
    ['500 after its one retry', { status: 500 }, 'Server', 2],
    ['429', { status: 429 }, 'RateLimited', 1],
    ['400', { status: 400 }, 'Client', 1],
  ])('%s: error with its kind', async (_name, reply, kind, calls) => {
    const { http, transport } = client(() => reply);
    expect(await CommentRepository.page(http, BLOG, POST, null)).toEqual({
      kind: 'error',
      error: expect.objectContaining({ kind }),
    });
    expect(transport.calls).toHaveLength(calls);
  });
});

describe('mapComments', () => {
  const base = e19Page2.body.data[0] as Record<string, unknown>;
  const map = (items: unknown[]) => mapComments(items, 0, createLogger());

  it.each([
    ['no id', { id: undefined }],
    ['an empty id', { id: '' }],
    ['no intId', { intId: undefined }],
    ['a string intId', { intId: '1101' }],
    ['no author', { author: undefined }],
    ['an author without a name', { author: { avatarUrl: 'https://example.invalid/avatar' } }],
    ['no createdAt', { createdAt: undefined }],
  ])('malformed (%s): dropped alone, never throws', (_name, overrides) => {
    expect(ids(map([{ ...base, ...overrides }, e19Page2.body.data[1]]))).toEqual(['synthetic-id-1102']);
  });

  it('a non-object item is dropped; a repeated id keeps its first occurrence', () => {
    expect(ids(map([null, 'x', base, { ...base, intId: 1199 }]))).toEqual(['synthetic-id-1101']);
    expect(map([base, { ...base, intId: 1199 }])[0].intId).toBe(1101);
  });

  it('hasAvatar false or a non-http avatar: no avatar', () => {
    const author = base.author as Record<string, unknown>;
    expect(map([{ ...base, author: { ...author, hasAvatar: false } }])[0].author.avatarUrl).toBeNull();
    expect(map([{ ...base, author: { ...author, avatarUrl: 'ftp://example.invalid/avatar' } }])[0].author.avatarUrl).toBeNull();
  });

  it('replyCount is never below the inline replies; without replies.extra the count decides hasMoreReplies', () => {
    const reply = e19Replies.body.data[0];
    const noExtra = map([{ ...base, replyCount: 5, replies: { data: [reply] } }])[0];
    expect(noExtra.hasMoreReplies).toBe(true);
    const undercounted = map([{ ...base, replyCount: 0, replies: { data: [reply] } }])[0];
    expect(undercounted.replyCount).toBe(1);
    expect(undercounted.hasMoreReplies).toBe(false);
    const missing = map([{ ...base, replyCount: undefined, replies: undefined, data: undefined }])[0];
    expect(missing).toMatchObject({ replyCount: 0, replies: [], hasMoreReplies: false, blocks: [] });
  });

  it('depth 1 (a parent_id page item, and an inline reply): no replies and no hasMoreReplies, whatever it carries', () => {
    const reply = e19Replies.body.data[0];
    const nested = { ...reply, replyCount: 3, replies: { data: [e19Replies.body.data[1]], extra: { isLast: false } } };
    const [item] = mapComments([nested], 1, createLogger());
    expect(item).toMatchObject({ replies: [], hasMoreReplies: false });
    const [parent] = map([{ ...base, replyCount: 5, replies: { data: [nested], extra: { isLast: false } } }]);
    expect(parent.replies[0]).toMatchObject({ replies: [], hasMoreReplies: false });
  });

  it('depth 0: replyCount 5, two inline replies and replies.extra.isLast true → no hasMoreReplies', () => {
    const [comment] = map([
      { ...base, replyCount: 5, replies: { data: e19Replies.body.data.slice(0, 2), extra: { isFirst: true, isLast: true } } },
    ]);
    expect(comment.replies).toHaveLength(2);
    expect(comment.replyCount).toBe(5);
    expect(comment.hasMoreReplies).toBe(false);
  });

  it('the domain carries no raw DTO field (reactions, flags, parent ids)', () => {
    const json = JSON.stringify(mapComments(e19Page1.body.data, 0, createLogger()));
    for (const field of ['reactions', 'reactionCounters', 'isBlocked', 'isDeleted', 'parentId', 'replyId', 'isOfficial', 'hasAvatar']) {
      expect(json).not.toContain(field);
    }
  });
});
