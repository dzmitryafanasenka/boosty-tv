/**
 * Story 7.2: the MediaResolver's live branch (`useLiveSource`): a fresh E15
 * through `StreamRepository.liveSources` mapped to the player's state
 * union. Rows: ok, none (204 / not live), no URLs (and no access), a failure,
 * the kept quality row, a disabled hook (a video).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { AppError, queryKeys, type HttpClient } from '../../../shared/api';
import type { HttpRequest, HttpResponse } from '../../../shared/api/httpClient';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15Live from '../../../test/fixtures/boosty/e15-video-stream-live.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15Scheduled from '../../../test/fixtures/boosty/e15-video-stream-scheduled.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e15Locked from '../../../test/fixtures/boosty/e15-video-stream-locked.json';
import { useLiveSource, type MediaSource, type QualityKey } from '../mediaResolver';

type Reply = HttpResponse<unknown> | Error;

const BLOG = 'synthetic-blog';
const live = e15Live.body as Record<string, unknown>;

let client: QueryClient;
let replies: Reply[];
let requests: HttpRequest<unknown>[];
let http: HttpClient;
let latest: MediaSource | null;
const roots: Root[] = [];

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  replies = [];
  requests = [];
  latest = null;
  http = {
    request: (request: HttpRequest<unknown>) => {
      requests.push(request);
      const reply = replies.shift() ?? { status: 204, body: undefined };
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  } as unknown as HttpClient;
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  client.clear();
  jest.restoreAllMocks();
});

function Harness({ enabled = true, keep = null }: { enabled?: boolean; keep?: QualityKey | null }) {
  latest = useLiveSource(http, enabled ? { kind: 'live', blogUrl: BLOG } : null, { keep });
  return null;
}

async function settle() {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 5));
  });
}

async function render(props: { enabled?: boolean; keep?: QualityKey | null } = {}) {
  const root = createRoot();
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness {...props} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return root;
}

const state = () => latest?.state;

describe('useLiveSource (Story 7.2)', () => {
  it('ok: the live-edge HLS source, the stream title, no progress meta, the start time; one E15', async () => {
    client.setQueryData(queryKeys.author(BLOG), {
      kind: 'ok',
      author: { blogUrl: BLOG, title: 'Блог', ownerName: 'Автор', avatarUrl: null },
    });
    replies.push({ status: 200, body: live });
    await render();
    const s = state();
    expect(s?.kind).toBe('ready');
    if (s?.kind === 'ready') {
      expect(s.source).toMatchObject({ format: 'hls', type: 'live_hls' });
      expect(s.sources.map(source => source.type)).toEqual(['live_hls', 'live_dash']);
      expect(s.progress).toBeNull();
      expect(s.live).toEqual({ startTime: 1_700_018_000 });
      expect(s.meta).toMatchObject({ authorName: 'Автор', postTitle: 'redacted', videoTitle: '' });
      expect(s.byQuality).toBe(false);
    }
    expect(requests.map(r => r.path)).toEqual([`/v1/blog/${BLOG}/video_stream`]);
  });

  it('a kept quality row picks that candidate', async () => {
    replies.push({ status: 200, body: live });
    await render({ keep: 'auto' });
    expect(state()).toMatchObject({ kind: 'ready', source: { type: 'live_hls' } });
  });

  it('none: a 204 is `unavailable` («Стрим завершён»)', async () => {
    replies.push({ status: 204, body: undefined });
    await render();
    expect(state()).toEqual({ kind: 'unavailable' });
  });

  it('none: a scheduled or no longer online stream is `unavailable`', async () => {
    replies.push({ status: 200, body: e15Scheduled.body });
    await render();
    expect(state()).toEqual({ kind: 'unavailable' });
  });

  it('no live-edge URL: `noSource` (the QR path)', async () => {
    replies.push({ status: 200, body: { ...live, data: [{ type: 'ok_stream', playerUrls: [{ type: 'live_playback_hls', url: 'https://example.invalid/x' }] }] } });
    await render();
    expect(state()).toEqual({ kind: 'noSource' });
  });

  it('`hasAccess: false`: `noSource` (never locked, no session check)', async () => {
    replies.push({ status: 200, body: e15Locked.body });
    await render();
    expect(state()).toEqual({ kind: 'noSource' });
    expect(requests).toHaveLength(1);
  });

  it('a failure: the error state with its kind; `retry` sends one more E15', async () => {
    replies.push(new AppError('Network'));
    await render();
    expect(state()).toEqual({ kind: 'error', error: 'Network' });
    replies.push({ status: 200, body: live });
    await act(async () => latest?.retry());
    await settle();
    expect(state()?.kind).toBe('ready');
    expect(requests).toHaveLength(2);
  });

  it('disabled (a video): no request, loading', async () => {
    await render({ enabled: false });
    expect(state()).toEqual({ kind: 'loading' });
    expect(requests).toHaveLength(0);
  });
});
