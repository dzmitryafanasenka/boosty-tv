/**
 * Story 12.3: the «в эфире» pass (`runLivePlaquePass`) and its TTL refresh
 * (`refreshLivePlaque`) over FixtureTransport and the real HttpClient: the
 * request count per pass, the sequential order, the cap of 10, the stop on
 * 429 / an expired session, the skip of a failed author, the playable filter
 * and the TTL rule.
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { AppError } from '../../../shared/api';
import { createFixtureTransport, type FixtureHandler, type FixtureRequest } from '../../../shared/api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../shared/api/httpClient';
import { queryKeys } from '../../../shared/api/queryKeys';
import { createLogger } from '../../../shared/services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e15None, e15Stream } from '../../../test/authorFixtures';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { E2_PATH, blogUrlOf, subscriptionsBody } from '../../../test/subscriptionFixtures';
import {
  LIVE_PLAQUE_MAX_AUTHORS,
  LIVE_PLAQUE_TTL_MS,
  refreshLivePlaque,
  runLivePlaquePass,
} from '../livePlaque';

type Reply = ReturnType<FixtureHandler>;

function setup(e15: (blogUrl: string, req: FixtureRequest) => Reply, subscriptions = 3) {
  const order: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const transport = createFixtureTransport(async req => {
    if (req.path === E2_PATH) {
      return { status: 200, body: subscriptionsBody(subscriptions) };
    }
    const stream = /^\/v1\/blog\/([^/]+)\/video_stream$/.exec(req.path);
    if (stream) {
      order.push(stream[1]);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return e15(stream[1], req);
    }
    return undefined;
  });
  const logger = createLogger();
  const http = createHttpClient({
    transport,
    tokens: fixedAccessToken('t'.repeat(64)),
    sleep: () => Promise.resolve(),
    logger,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return { transport, http, queryClient, logger, order, maxInFlight: () => maxInFlight };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const e15Calls = (t: ReturnType<typeof setup>) => t.transport.calls.filter(c => c.path.endsWith('/video_stream'));

describe('runLivePlaquePass', () => {
  it('nobody live (E15 204 each): E2 once, one E15 per author in E2 order, one at a time; no plaque', async () => {
    const t = setup(() => e15None());
    const items = await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger);
    expect(items).toEqual([]);
    expect(t.transport.callsTo(E2_PATH)).toHaveLength(1);
    expect(t.order).toEqual([blogUrlOf(1), blogUrlOf(2), blogUrlOf(3)]);
    expect(t.maxInFlight()).toBe(1);
  });

  it('one playable live author: one plaque with E2 name and avatar, E15 title', async () => {
    const t = setup(blog => (blog === blogUrlOf(2) ? e15Stream('live', { title: '  Stream two  ' }) : e15None()));
    const items = await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger);
    expect(items).toEqual([
      { blogUrl: blogUrlOf(2), name: 'Owner 2', avatarUrl: expect.anything(), title: 'Stream two' },
    ]);
  });

  it('several live authors keep the E2 order', async () => {
    const t = setup(blog => (blog === blogUrlOf(1) || blog === blogUrlOf(3) ? e15Stream('live') : e15None()));
    const items = await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger);
    expect(items.map(i => i.blogUrl)).toEqual([blogUrlOf(1), blogUrlOf(3)]);
  });

  it('not playable: locked, no live-edge source, scheduled → no plaque', async () => {
    const t = setup(blog =>
      blog === blogUrlOf(1)
        ? e15Stream('locked')
        : blog === blogUrlOf(2)
          ? e15Stream('live', { data: [] })
          : e15Stream('scheduled'),
    );
    expect(await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger)).toEqual([]);
    expect(e15Calls(t)).toHaveLength(3);
  });

  it(`cap: 15 subscriptions → E15 for the first ${LIVE_PLAQUE_MAX_AUTHORS} only, sequentially`, async () => {
    const t = setup(() => e15None(), 15);
    await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger);
    expect(LIVE_PLAQUE_MAX_AUTHORS).toBe(10);
    expect(t.order).toEqual(Array.from({ length: 10 }, (_, i) => blogUrlOf(i + 1)));
    expect(t.maxInFlight()).toBe(1);
  });

  it('a failed author (5xx, network) is skipped; the others are still checked', async () => {
    const t = setup(blog =>
      blog === blogUrlOf(1) ? { status: 500 } : blog === blogUrlOf(2) ? { network: true } : e15Stream('live'),
    );
    const items = await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger);
    expect(items.map(i => i.blogUrl)).toEqual([blogUrlOf(3)]);
    // No AD-6 retry for E15: exactly one request per author.
    expect(e15Calls(t)).toHaveLength(3);
  });

  it('429 stops the pass: no further E15 and no plaque from it (also a live author before it)', async () => {
    const t = setup(blog =>
      blog === blogUrlOf(1) ? e15Stream('live') : blog === blogUrlOf(2) ? { status: 429 } : e15Stream('live'),
    );
    expect(await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger)).toEqual([]);
    expect(t.order).toEqual([blogUrlOf(1), blogUrlOf(2)]);
  });

  it('an expired session stops the pass', async () => {
    const t = setup(() => e15None());
    jest
      .spyOn(t.http, 'request')
      .mockImplementationOnce(() => Promise.reject(new AppError('SessionExpired')))
      .mockImplementation(() => Promise.resolve({ status: 204, body: undefined }));
    // E2 goes through `get`, so the first `request` is the first E15.
    expect(await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger)).toEqual([]);
    expect(t.http.request).toHaveBeenCalledTimes(1);
  });

  it('E2 fails: nothing shown, no E15', async () => {
    const t = setup(() => e15Stream('live'));
    jest.spyOn(t.http, 'get').mockRejectedValue(new AppError('Server', 503));
    expect(await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger)).toEqual([]);
    expect(e15Calls(t)).toHaveLength(0);
  });

  it('reuses a fresh `subscriptions` cache (no E2)', async () => {
    const t = setup(() => e15None());
    await t.queryClient.fetchQuery({
      queryKey: queryKeys.subscriptions(),
      queryFn: async () => ({ authors: [{ blogUrl: blogUrlOf(7), title: 'B7', ownerName: null, avatarUrl: null }], received: 1, total: 1 }),
    });
    await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger);
    expect(t.transport.callsTo(E2_PATH)).toHaveLength(0);
    expect(t.order).toEqual([blogUrlOf(7)]);
  });

  it('an account reset mid-pass: the E15 in flight completes, no further E15, nothing shown', async () => {
    let current = true;
    const t = setup(blog => {
      if (blog === blogUrlOf(1)) {
        current = false;
      }
      return e15Stream('live');
    });
    expect(await runLivePlaquePass(t.queryClient, t.http, () => current, t.logger)).toEqual([]);
    expect(t.order).toEqual([blogUrlOf(1)]);
  });

  it('logs counts only (no blog, name or URL)', async () => {
    const t = setup(blog => (blog === blogUrlOf(2) ? { status: 500 } : e15Stream('live')));
    await runLivePlaquePass(t.queryClient, t.http, () => true, t.logger);
    const entries = t.logger.entries();
    const line = entries.find(e => e.message === 'plaque pass');
    expect(line?.fields).toEqual({ checked: '3', live: '2', failed: '1' });
    expect(JSON.stringify(entries)).not.toMatch(/synthetic-blog|Owner|example\.invalid/);
  });
});

describe('refreshLivePlaque (TTL)', () => {
  function observed(t: ReturnType<typeof setup>) {
    const observer = new QueryObserver(t.queryClient, {
      queryKey: queryKeys.livePlaque(),
      queryFn: () => runLivePlaquePass(t.queryClient, t.http, () => true, t.logger),
      staleTime: LIVE_PLAQUE_TTL_MS,
    });
    return observer.subscribe(() => {});
  }
  const settle = async () => {
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
  };

  it('no new pass within 5 min; one new pass after; none without an observer', async () => {
    const t = setup(() => e15None());
    const now = Date.now();
    const unsubscribe = observed(t);
    await settle();
    await t.queryClient.getQueryCache().find({ queryKey: queryKeys.livePlaque() })?.promise;
    await settle();
    expect(e15Calls(t)).toHaveLength(3);
    await refreshLivePlaque(t.queryClient, now + LIVE_PLAQUE_TTL_MS - 1_000);
    expect(e15Calls(t)).toHaveLength(3);
    await refreshLivePlaque(t.queryClient, now + LIVE_PLAQUE_TTL_MS + 1_000);
    await settle();
    expect(e15Calls(t)).toHaveLength(6);
    unsubscribe();
    await refreshLivePlaque(t.queryClient, now + 3 * LIVE_PLAQUE_TTL_MS);
    expect(e15Calls(t)).toHaveLength(6);
  });
});
