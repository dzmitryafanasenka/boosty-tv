/**
 * Story 11.2: `useComments` (the block's infinite query, newest first) and
 * `useCommentReplies` (one comment's replies, local state) over the real
 * CommentRepository, HttpClient and FixtureTransport. Synthetic items only.
 */
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { createFixtureTransport, type FixtureReply, type FixtureRequest } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken, type HttpClient } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
import { mapComments } from '../mapComments';
import type { Comment } from '../types';
import { useCommentReplies, useComments, type CommentsState, type RepliesState } from '../useComments';

const BLOG = 'synthetic-blog-1';
const POST = 'synthetic-id-1001';
const BASE = 5000;

/** Synthetic E19 item `k` (intId BASE + k), the live shape. */
function item(k: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `c-${k}`,
    intId: BASE + k,
    author: { id: 1, name: 'redacted', avatarUrl: '', hasAvatar: false, isOfficial: false },
    createdAt: 1_700_000_000 + k,
    data: [{ type: 'text', content: '["Sample text","unstyled",[]]', modificator: '' }],
    isBlocked: false,
    isDeleted: false,
    replyCount: 0,
    replies: { data: [], extra: { isFirst: true, isLast: true } },
    ...extra,
  };
}

/** The live paging rule: the newest 20 below `offset`, ascending; `isLast` when none older remains. */
function pageOf(all: ReadonlyArray<Record<string, unknown>>, url: string): FixtureReply {
  const offset = Number(new URL(url).searchParams.get('offset') ?? Infinity);
  const below = all.filter(i => (i.intId as number) < offset);
  const start = Math.max(0, below.length - 20);
  return { status: 200, body: { data: below.slice(start), extra: { isFirst: offset === Infinity, isLast: start === 0 } } };
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

let handler: (req: FixtureRequest) => FixtureReply | Promise<FixtureReply> | undefined;
let calls: FixtureRequest[];
let http: HttpClient;
let client: QueryClient;
let root: ReturnType<typeof createRoot>;
let comments: CommentsState;
let replies: RepliesState;

function CommentsProbe({ enabled }: { enabled: boolean }) {
  comments = useComments(http, BLOG, POST, enabled);
  return null;
}

function RepliesProbe({ comment }: { comment: Comment }) {
  replies = useCommentReplies(http, BLOG, POST, comment);
  return null;
}

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderComments(enabled = true) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CommentsProbe enabled={enabled} />
      </QueryClientProvider>,
    );
  });
  await flush();
}

async function renderReplies(comment: Comment) {
  await act(async () => {
    root.render(<RepliesProbe comment={comment} />);
  });
  await flush();
}

const ready = () => {
  if (comments.view.kind !== 'ready') {
    throw new Error(`expected ready, got ${comments.view.kind}`);
  }
  return comments.view;
};
const ids = (list: readonly Comment[]) => list.map(c => c.id);

beforeAll(() => {
  notifyManager.setScheduler(callback => {
    Promise.resolve().then(callback);
  });
});

afterAll(() => {
  notifyManager.setScheduler(callback => setTimeout(callback, 0));
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  calls = [];
  const transport = createFixtureTransport(req => {
    calls.push(req);
    return handler(req);
  });
  http = createHttpClient({ transport, tokens: fixedAccessToken('t'.repeat(64)), sleep: () => Promise.resolve(), logger: createLogger() });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  root = createRoot();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  client.clear();
  jest.restoreAllMocks();
});

describe('useComments (Story 11.2)', () => {
  const all = range(1, 45).map(k => item(k));

  it('page 1: the newest 20, newest first; more while a cursor exists', async () => {
    handler = req => pageOf(all, req.url);
    await renderComments();
    const view = ready();
    expect(ids(view.comments)).toEqual(range(26, 45).reverse().map(k => `c-${k}`));
    expect(view.hasMore).toBe(true);
    expect(view.loadingMore).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
  });

  it('«Показать ещё»: the next older page appended below (no duplicates), then the last page ends the paging', async () => {
    handler = req => pageOf(all, req.url);
    await renderComments();
    await act(async () => comments.loadMore());
    await flush();
    expect(ids(ready().comments)).toEqual(range(6, 45).reverse().map(k => `c-${k}`));
    expect(new URL(calls[1].url).searchParams.get('offset')).toBe(String(BASE + 26));
    await act(async () => comments.loadMore());
    await flush();
    const view = ready();
    expect(ids(view.comments)).toEqual(range(1, 45).reverse().map(k => `c-${k}`));
    expect(view.hasMore).toBe(false);
    // No cursor left: another press sends nothing.
    await act(async () => comments.loadMore());
    await flush();
    expect(calls).toHaveLength(3);
  });

  it('a failed «Показать ещё» keeps the list (moreFailed); the retry loads that page', async () => {
    let fail = true;
    handler = req => (req.url.includes('offset') && fail ? { status: 500, body: {} } : pageOf(all, req.url));
    await renderComments();
    await act(async () => comments.loadMore());
    await flush();
    expect(ready()).toMatchObject({ moreFailed: true, hasMore: true, loadingMore: false });
    expect(ready().comments).toHaveLength(20);
    fail = false;
    await act(async () => comments.loadMore());
    await flush();
    expect(ready()).toMatchObject({ moreFailed: false });
    expect(ready().comments).toHaveLength(40);
  });

  it('the last page at once: no more; an empty post: an empty ready list', async () => {
    handler = () => ({ status: 200, body: { data: [], extra: { isFirst: true, isLast: true } } });
    await renderComments();
    expect(ready()).toMatchObject({ comments: [], hasMore: false });
  });

  it('error: page 1 failed → error; «Повторить» refetches page 1 (held while it runs)', async () => {
    let reply: FixtureReply = { status: 400, body: { error: 'bad_request' } };
    handler = () => reply;
    await renderComments();
    expect(comments.view).toEqual({ kind: 'error', retrying: false });
    reply = { status: 200, body: { data: [item(1)], extra: { isFirst: true, isLast: true } } };
    await act(async () => comments.retry());
    await flush();
    expect(ids(ready().comments)).toEqual(['c-1']);
    expect(calls).toHaveLength(2);
  });

  it('denied (403) and notFound (404): their own states, never an error', async () => {
    handler = () => ({ status: 403 });
    await renderComments();
    expect(comments.view).toEqual({ kind: 'denied' });
    client.clear();
    handler = () => ({ status: 404, body: { error: 'not_found' } });
    await act(async () => root.unmount());
    root = createRoot();
    await renderComments();
    expect(comments.view).toEqual({ kind: 'notFound' });
  });

  it('an older page answering denied (403) or notFound (404) ends the paging: the list kept, no more, no failure', async () => {
    for (const reply of [{ status: 403 }, { status: 404, body: { error: 'not_found' } }] as FixtureReply[]) {
      client.clear();
      handler = req => (new URL(req.url).searchParams.has('offset') ? reply : pageOf(all, req.url));
      await act(async () => root.unmount());
      root = createRoot();
      await renderComments();
      let started = false;
      await act(async () => {
        started = comments.loadMore();
      });
      expect(started).toBe(true);
      await flush();
      expect(ready()).toMatchObject({ hasMore: false, moreFailed: false, loadingMore: false });
      expect(ready().comments).toHaveLength(20);
      let again = true;
      await act(async () => {
        again = comments.loadMore();
      });
      expect(again).toBe(false);
    }
  });

  it('disabled (a locked post, comments off): no request', async () => {
    handler = req => pageOf(all, req.url);
    await renderComments(false);
    expect(calls).toHaveLength(0);
    expect(comments.view.kind).toBe('loading');
  });
});

describe('useCommentReplies (Story 11.2)', () => {
  const replyItems = range(1, 5).map(r => item(100 + r, { replyToUser: { name: 'redacted' }, replies: undefined }));
  const parent = () =>
    mapComments(
      [item(1, { replyCount: 5, replies: { data: replyItems.slice(3, 5), extra: { isFirst: false, isLast: false } } })],
      0,
      createLogger(),
    )[0];

  it('inline replies first; «Ещё ответы» merges every reply, deduped, oldest first; no more after the last page', async () => {
    handler = req => pageOf(replyItems, req.url);
    await renderReplies(parent());
    expect(ids(replies.replies)).toEqual(['c-104', 'c-105']);
    expect(replies.hasMore).toBe(true);
    await act(async () => replies.loadMore());
    await flush();
    expect(ids(replies.replies)).toEqual(['c-101', 'c-102', 'c-103', 'c-104', 'c-105']);
    expect(replies).toMatchObject({ hasMore: false, loading: false, failed: false });
    expect(new URL(calls[0].url).searchParams.get('parent_id')).toBe(String(BASE + 1));
    expect(calls[0].method).toBe('GET');
  });

  it('a failure keeps the inline replies and «Ещё ответы» (failed); the retry loads them', async () => {
    let fail = true;
    handler = req => (fail ? { status: 500, body: {} } : pageOf(replyItems, req.url));
    await renderReplies(parent());
    await act(async () => replies.loadMore());
    await flush();
    expect(replies).toMatchObject({ failed: true, hasMore: true, loading: false });
    expect(ids(replies.replies)).toEqual(['c-104', 'c-105']);
    fail = false;
    await act(async () => replies.loadMore());
    await flush();
    expect(replies.replies).toHaveLength(5);
    expect(replies.failed).toBe(false);
  });

  it.each([
    ['denied (403)', { status: 403 }],
    ['notFound (404)', { status: 404, body: { error: 'not_found' } }],
  ])('%s ends the replies paging: no «Ещё ответы», no failure; the inline replies kept', async (_name, reply) => {
    handler = () => reply as FixtureReply;
    await renderReplies(parent());
    await act(async () => {
      replies.loadMore();
    });
    await flush();
    expect(replies).toMatchObject({ hasMore: false, failed: false, loading: false });
    expect(ids(replies.replies)).toEqual(['c-104', 'c-105']);
    let again = true;
    await act(async () => {
      again = replies.loadMore();
    });
    expect(again).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('a press while one runs is ignored', async () => {
    let resolve: (reply: FixtureReply) => void = () => {};
    handler = () => new Promise<FixtureReply>(r => (resolve = r));
    await renderReplies(parent());
    await act(async () => replies.loadMore());
    expect(replies.loading).toBe(true);
    await act(async () => replies.loadMore());
    expect(calls).toHaveLength(1);
    resolve(pageOf(replyItems, calls[0].url));
    await flush();
    expect(replies.replies).toHaveLength(5);
  });
});
