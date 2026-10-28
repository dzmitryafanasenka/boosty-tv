/**
 * Story 4.2: ProgressRepository and its local store, with fake timers, an
 * in-memory KeyValueStore and a fake session (no network). Every row of the
 * spec's I/O matrix that the repository owns; the player-side rows (no
 * pre-seek t=0, hold-scrub) and the Post-side rows (multi-video) are also in
 * `__tests__/playerFlow.test.tsx` and `__tests__/postFlow.test.tsx`.
 */
import { AppError } from '../../../api/appError';
import type { HttpClient, HttpRequest, HttpResponse, SessionStatus } from '../../../api';
import type { MediaRef } from '../../../entities/post/types';
import type { KeyValueStore } from '../../../platform/keyValueStore';
import type { Logger } from '../../logger';
import { isFinished, progressStatus, remainingMinutes } from '../finished';
import {
  MAX_AUTO_RETRIES,
  WRITE_RETRY_MS,
  createProgressRepository,
  timecodePath,
  type ProgressRepository,
} from '../progressRepository';
import {
  DISK_DEBOUNCE_MS,
  MAX_PROGRESS_ENTRIES,
  PROGRESS_STORAGE_KEY,
  createProgressStore,
  persistablePreviewUrl,
  type ProgressMeta,
  type ProgressStore,
} from '../progressStore';

const REF: MediaRef = { blogUrl: 'synthetic-blog', postId: 'post-1', mediaId: 'v1' };
const REF2: MediaRef = { blogUrl: 'synthetic-blog', postId: 'post-1', mediaId: 'v2' };
const META: ProgressMeta = {
  title: 'Synthetic video',
  postTitle: 'Synthetic post',
  authorName: 'Synthetic author',
  previewUrl: 'https://example.invalid/preview',
  durationSec: 600,
};

type Call = {
  request: HttpRequest<unknown>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** A content client whose E9 calls the test answers (`auto`: 200 at once). */
function fakeHttp() {
  const calls: Call[] = [];
  let auto: 'ok' | 'network' | null = 'ok';
  const http = {
    request: (request: HttpRequest<unknown>) =>
      new Promise<HttpResponse<unknown>>((resolve, reject) => {
        const call: Call = {
          request,
          resolve: () => resolve({ status: 200, body: undefined }),
          reject,
        };
        calls.push(call);
        if (auto === 'ok') {
          call.resolve();
        } else if (auto === 'network') {
          call.reject(new AppError('Network'));
        }
      }),
    get: () => Promise.reject(new Error('no GET here')),
  } as unknown as HttpClient;
  return {
    http,
    calls,
    /** Positions sent, in order. */
    sent: () => calls.map(c => Number(new Map(c.request.form ?? []).get('time_code'))),
    setAuto(mode: 'ok' | 'network' | null) {
      auto = mode;
    },
  };
}

function fakeSession(http: HttpClient) {
  let status: SessionStatus = 'signedIn';
  const listeners = new Set<(s: SessionStatus) => void>();
  return {
    http,
    getStatus: () => status,
    subscribe(listener: (s: SessionStatus) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: SessionStatus) {
      status = next;
      for (const l of [...listeners]) {
        l(next);
      }
    },
  };
}

function memoryKv() {
  const data = new Map<string, string>();
  const kv: KeyValueStore & { data: Map<string, string>; failSet: boolean; setGate: Promise<void> | null } = {
    data,
    failSet: false,
    setGate: null,
    get: async key => data.get(key) ?? null,
    set: async (key, value) => {
      if (kv.setGate) {
        await kv.setGate;
      }
      if (kv.failSet) {
        throw new Error('disk');
      }
      data.set(key, value);
    },
    remove: async key => {
      data.delete(key);
    },
    clear: async () => {
      data.clear();
    },
  };
  return kv;
}

const silentLogger: Logger = {
  debug: () => {},
  info: jest.fn(),
  warn: jest.fn(),
  error: () => {},
  entries: () => [],
  clear: () => {},
};

type Harness = {
  repo: ProgressRepository;
  store: ProgressStore;
  kv: ReturnType<typeof memoryKv>;
  net: ReturnType<typeof fakeHttp>;
  session: ReturnType<typeof fakeSession>;
  /** AccountScope.reset(): the generation is bumped, then the store is reset. */
  accountReset(): Promise<void>;
};

let harness: Harness | null = null;

function setup(kv = memoryKv()): Harness {
  const net = fakeHttp();
  const session = fakeSession(net.http);
  let generation = 0;
  const scope = { generation: () => generation };
  const store = createProgressStore({ kv: () => kv, scope, logger: silentLogger });
  const repo = createProgressRepository({ session, store, scope, logger: silentLogger });
  harness = {
    repo,
    store,
    kv,
    net,
    session,
    async accountReset() {
      generation += 1;
      await store.reset();
    },
  };
  return harness;
}

/** Lets promise chains run (no timers). */
async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

async function advance(ms: number) {
  jest.advanceTimersByTime(ms);
  await flush();
}

/** Playing from `from` to `to` (inclusive), one tick a second. */
async function play(repo: ProgressRepository, from: number, to: number, ref = REF) {
  for (let sec = from; sec <= to; sec += 1) {
    repo.report(ref, sec, 'tick', 600);
    await advance(1000);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  harness?.repo.dispose();
  harness = null;
  jest.useRealTimers();
});

describe('finished rule (ADR 0004)', () => {
  it('≥ 95 % or < 30 s left; 0 and an unknown duration are never finished', () => {
    expect(isFinished(570, 600)).toBe(true); // 95 %
    expect(isFinished(569, 600)).toBe(false);
    expect(isFinished(171, 200)).toBe(true); // 29 s left (85.5 %)
    expect(isFinished(170, 200)).toBe(false); // 30 s left (85 %)
  });

  it('the ratio rule alone on a long video, the tail rule on a short one', () => {
    expect(isFinished(3420, 3600)).toBe(true); // 95 %, 180 s left
    expect(isFinished(3419, 3600)).toBe(false);
    expect(isFinished(21, 50)).toBe(true); // 29 s left of 50
    expect(isFinished(0, 20)).toBe(false);
    expect(isFinished(100, null)).toBe(false);
    expect(isFinished(100, 0)).toBe(false);
  });

  it('status: «Не начато», «Осталось N мин» rounded up, «Просмотрено», unknown without a duration', () => {
    expect(progressStatus(null, 600)).toEqual({ kind: 'notStarted' });
    expect(progressStatus(0, 600)).toEqual({ kind: 'notStarted' });
    expect(progressStatus(120, 600)).toEqual({ kind: 'inProgress', minutesLeft: 8, fraction: 0.2 });
    expect(progressStatus(121, 600)).toMatchObject({ minutesLeft: 8 });
    expect(progressStatus(590, 600)).toEqual({ kind: 'watched' });
    expect(progressStatus(120, null)).toEqual({ kind: 'unknown' });
    expect(remainingMinutes(599, 600)).toBe(1);
  });
});

describe('resume point (matrix «Local wins», «Server only», «Finished»)', () => {
  it('local 120, server 300 → 120', async () => {
    const { repo, store } = setup();
    await repo.ready();
    repo.onServerProgress('v1', 300);
    store.put({ ref: REF, positionSec: 120, durationSec: 600, updatedAt: 1, meta: META });
    expect(repo.resumePoint(REF, 600)).toBe(120);
    expect(store.snapshot('v1')).toEqual({ positionSec: 120, durationSec: 600, source: 'local' });
  });

  it('no local entry, server `timeCode` 300 → 300 (the Post reads it as progress)', async () => {
    const { repo, store } = setup();
    await repo.ready();
    repo.onServerProgress('v1', 300.7);
    expect(repo.resumePoint(REF, 600)).toBe(300);
    expect(store.snapshot('v1')).toEqual({ positionSec: 300, durationSec: null, source: 'server' });
  });

  it('local 590 of 600 → 0 (finished); a finished server value → 0; nothing → 0', async () => {
    const { repo, store } = setup();
    await repo.ready();
    store.put({ ref: REF, positionSec: 590, durationSec: 600, updatedAt: 1, meta: META });
    expect(repo.resumePoint(REF, 600)).toBe(0);
    // The local entry's own duration applies when the engine gives none.
    expect(repo.resumePoint(REF, null)).toBe(0);
    repo.onServerProgress('v2', 3900);
    expect(repo.resumePoint(REF2, 3960)).toBe(0);
    expect(repo.resumePoint({ ...REF, mediaId: 'none' }, 600)).toBe(0);
  });

  it('a local entry at 0 wins over the server value (a start over)', async () => {
    const { repo, store } = setup();
    await repo.ready();
    repo.onServerProgress('v1', 300);
    store.put({ ref: REF, positionSec: 0, durationSec: 600, updatedAt: 1, meta: META });
    expect(repo.resumePoint(REF, 600)).toBe(0);
  });
});

describe('writes (matrix «Cadence», «Start over», «Failure»)', () => {
  it('playing 0 → 35 s writes at 10, 20, 30 s (E9 PUT, form `time_code`, integer seconds)', async () => {
    const { repo, net, store } = setup();
    await repo.ready();
    repo.begin(REF, META);
    await play(repo, 0, 35);
    expect(net.sent()).toEqual([10, 20, 30]);
    expect(net.calls[0].request).toEqual({
      method: 'PUT',
      path: '/v1/viewstat/video/v1/timecode/',
      form: [['time_code', '10']],
    });
    // The local entry follows the same triggers.
    expect(store.get('v1')).toMatchObject({ positionSec: 30, durationSec: 600, meta: META, ref: REF });
  });

  it('one write in flight; a newer position replaces the queued one', async () => {
    const { repo, net } = setup();
    net.setAuto(null);
    await repo.ready();
    repo.begin(REF, META);
    await play(repo, 0, 35);
    // 10 is in flight; 20 and 30 were triggered meanwhile: nothing more sent.
    expect(net.sent()).toEqual([10]);
    net.calls[0].resolve();
    await flush();
    // Only the latest position.
    expect(net.sent()).toEqual([10, 35]);
    net.calls[1].resolve();
    await flush();
    expect(net.sent()).toEqual([10, 35]);
  });

  it('a forced write on pause, background, exit and end; none for an unchanged position', async () => {
    const { repo, net } = setup();
    await repo.ready();
    repo.begin(REF, META);
    repo.report(REF, 120, 'tick', 600);
    await flush();
    expect(net.sent()).toEqual([]);
    repo.report(REF, 123, 'pause', 600);
    await flush();
    repo.report(REF, 123, 'exit', 600);
    await flush();
    repo.report(REF, 125, 'background', 600);
    await flush();
    repo.report(REF, 600, 'end', 600);
    await flush();
    expect(net.sent()).toEqual([123, 125, 600]);
  });

  it('start over: the first write only after movement or a pause', async () => {
    const { repo, net, store } = setup();
    await repo.ready();
    repo.onServerProgress('v1', 300);
    repo.begin(REF, META);
    await play(repo, 0, 5);
    expect(net.sent()).toEqual([]);
    expect(store.get('v1')).toBeUndefined();
    repo.report(REF, 6, 'pause', 600);
    await flush();
    expect(net.sent()).toEqual([6]);
    expect(store.get('v1')?.positionSec).toBe(6);
  });

  it('a seek counts as movement (both directions), measured from the last trigger', async () => {
    const { repo, net } = setup();
    await repo.ready();
    repo.begin(REF, META);
    repo.report(REF, 100, 'tick', 600);
    repo.report(REF, 300, 'tick', 600);
    await flush();
    repo.report(REF, 301, 'tick', 600);
    repo.report(REF, 50, 'tick', 600);
    await flush();
    expect(net.sent()).toEqual([300, 50]);
  });

  it('no report before `begin` (nothing to write, no meta)', async () => {
    const { repo, net, store } = setup();
    await repo.ready();
    repo.report(REF, 100, 'pause', 600);
    await flush();
    expect(net.sent()).toEqual([]);
    expect(store.get('v1')).toBeUndefined();
  });

  it('E9 Network failure: the next attempt ≥ 10 s later, with the latest position; not shown to the user', async () => {
    const { repo, net } = setup();
    net.setAuto('network');
    await repo.ready();
    repo.begin(REF, META);
    await play(repo, 0, 10);
    expect(net.sent()).toEqual([10]);
    net.setAuto('ok');
    // 9 s after the failure: still nothing (the ticks are not faster retries).
    await play(repo, 11, 19);
    expect(net.sent()).toEqual([10]);
    await play(repo, 20, 20);
    // The retry carries the latest position, ≥ 10 s after the failure.
    expect(net.sent()).toEqual([10, 20]);
    await play(repo, 21, 25);
    expect(net.sent()).toEqual([10, 20]);
  });

  it('a failed pause write is re-sent by itself, at most MAX_AUTO_RETRIES times, never faster than 10 s', async () => {
    const { repo, net } = setup();
    net.setAuto('network');
    await repo.ready();
    repo.begin(REF, META);
    repo.report(REF, 42, 'pause', 600);
    await flush();
    expect(net.sent()).toEqual([42]);
    await advance(WRITE_RETRY_MS - 1);
    expect(net.sent()).toHaveLength(1);
    await advance(1);
    expect(net.sent()).toEqual([42, 42]);
    for (let i = 0; i < 20; i += 1) {
      await advance(WRITE_RETRY_MS);
    }
    expect(net.sent()).toHaveLength(1 + MAX_AUTO_RETRIES);
  });
});

describe('short visits (owner decision 2026-10-28)', () => {
  const watched = (store: ProgressStore) =>
    store.put({ ref: REF, positionSec: 600, durationSec: 600, updatedAt: 1, meta: META });

  it('a finished video reopened at 0: exit, background and end after < 10 s write nothing, locally or by E9', async () => {
    const { repo, net, store } = setup();
    await repo.ready();
    watched(store);
    repo.begin(REF, META);
    await play(repo, 0, 9);
    repo.report(REF, 9, 'background', 600);
    repo.report(REF, 9, 'exit', 600);
    repo.report(REF, 9, 'end', 600);
    await flush();
    expect(net.sent()).toEqual([]);
    expect(store.get('v1')?.positionSec).toBe(600);
  });

  it('«С начала» over a position: a short visit keeps it; ≥ 10 s of movement then writes normally', async () => {
    const { repo, net, store } = setup();
    await repo.ready();
    store.put({ ref: REF, positionSec: 300, durationSec: 600, updatedAt: 1, meta: META });
    repo.begin(REF, META);
    await play(repo, 0, 5);
    repo.report(REF, 5, 'exit', 600);
    await flush();
    expect(net.sent()).toEqual([]);
    expect(store.get('v1')?.positionSec).toBe(300);
    // A new session that moves 10 s: normal progress from there.
    repo.begin(REF, META);
    await play(repo, 0, 12);
    repo.report(REF, 12, 'exit', 600);
    await flush();
    expect(net.sent()).toEqual([10, 12]);
    expect(store.get('v1')?.positionSec).toBe(12);
  });

  it('a user pause arms the session at once', async () => {
    const { repo, net, store } = setup();
    await repo.ready();
    watched(store);
    repo.begin(REF, META);
    repo.report(REF, 0, 'tick', 600);
    repo.report(REF, 3, 'pause', 600);
    await flush();
    expect(net.sent()).toEqual([3]);
    expect(store.get('v1')?.positionSec).toBe(3);
  });

  it('a seek ≥ 10 s away from the start arms it (movement in either direction)', async () => {
    const { repo, net } = setup();
    await repo.ready();
    repo.begin(REF, META);
    repo.report(REF, 300, 'tick', 600);
    repo.report(REF, 295, 'exit', 600);
    await flush();
    expect(net.sent()).toEqual([]);
    repo.report(REF, 290, 'tick', 600);
    await flush();
    expect(net.sent()).toEqual([290]);
  });

  it('an earlier session\'s owed write still sends its own position, never the short visit\'s', async () => {
    const { repo, net } = setup();
    net.setAuto('network');
    await repo.ready();
    repo.begin(REF, META);
    repo.report(REF, 200, 'pause', 600);
    await flush();
    expect(net.sent()).toEqual([200]);
    net.setAuto('ok');
    repo.begin(REF, META);
    repo.report(REF, 0, 'tick', 600);
    repo.report(REF, 2, 'exit', 600);
    await advance(WRITE_RETRY_MS);
    expect(net.sent()).toEqual([200, 200]);
  });
});

describe('session (matrix «Expired», «Sign-out»)', () => {
  it('a write that fails while expired is held (latest only) and flushed after a same-account re-login', async () => {
    const { repo, net, session } = setup();
    net.setAuto(null);
    await repo.ready();
    repo.begin(REF, META);
    repo.report(REF, 100, 'tick', 600);
    repo.report(REF, 110, 'tick', 600);
    await flush();
    expect(net.sent()).toEqual([110]);
    session.set('expired');
    net.calls[0].reject(new AppError('SessionExpired'));
    await flush();
    // Held: no retry timer, nothing sent while expired.
    repo.report(REF, 125, 'exit', 600);
    await advance(WRITE_RETRY_MS * 3);
    expect(net.sent()).toEqual([110]);
    net.setAuto('ok');
    session.set('signedIn');
    await flush();
    expect(net.sent()).toEqual([110, 125]);
  });

  it('a write asked for while expired is never sent with the dead session', async () => {
    const { repo, net, session } = setup();
    await repo.ready();
    repo.begin(REF, META);
    session.set('expired');
    repo.report(REF, 70, 'pause', 600);
    await flush();
    expect(net.sent()).toEqual([]);
    session.set('signedIn');
    await flush();
    expect(net.sent()).toEqual([70]);
  });

  it('a held write is dropped when the generation changed (another account)', async () => {
    const h = setup();
    const { repo, net, session } = h;
    await repo.ready();
    repo.begin(REF, META);
    session.set('expired');
    repo.report(REF, 70, 'pause', 600);
    await flush();
    await h.accountReset();
    session.set('signedIn');
    await flush();
    expect(net.sent()).toEqual([]);
  });

  it('sign-out: entries, server values and the held write gone; the disk cleared', async () => {
    const h = setup();
    const { repo, net, session, store, kv } = h;
    await repo.ready();
    repo.onServerProgress('v2', 300);
    repo.begin(REF, META);
    repo.report(REF, 100, 'pause', 600);
    await flush();
    await store.flush();
    expect(kv.data.has(PROGRESS_STORAGE_KEY)).toBe(true);
    session.set('expired');
    repo.report(REF, 150, 'exit', 600);
    await flush();
    await h.accountReset();
    expect(store.entries()).toEqual([]);
    expect(store.snapshot('v1')).toBeNull();
    expect(store.snapshot('v2')).toBeNull();
    expect(kv.data.size).toBe(0);
    session.set('signedIn');
    await flush();
    expect(net.sent()).toEqual([100]);
  });

  it('a write that lands after a reset changes nothing', async () => {
    const h = setup();
    const { repo, net } = h;
    net.setAuto(null);
    await repo.ready();
    repo.begin(REF, META);
    repo.report(REF, 30, 'pause', 600);
    await flush();
    await h.accountReset();
    net.calls[0].reject(new AppError('Network'));
    await advance(WRITE_RETRY_MS * 2);
    expect(net.sent()).toEqual([30]);
  });

  it('E9 path encodes the media id as one segment', () => {
    expect(timecodePath('a/b?c')).toBe('/v1/viewstat/video/a%2Fb%3Fc/timecode/');
  });
});

describe('local store', () => {
  it('memory at once, the disk debounced; a forced event writes the disk at once', async () => {
    const { repo, store, kv } = setup();
    await repo.ready();
    repo.begin(REF, META);
    repo.report(REF, 100, 'tick', 600);
    repo.report(REF, 110, 'tick', 600);
    expect(store.get('v1')?.positionSec).toBe(110);
    await flush();
    expect(kv.data.has(PROGRESS_STORAGE_KEY)).toBe(false);
    await advance(DISK_DEBOUNCE_MS);
    expect(JSON.parse(kv.data.get(PROGRESS_STORAGE_KEY) ?? '{}').entries[0]).toMatchObject({
      ref: REF,
      positionSec: 110,
    });
    repo.report(REF, 115, 'background', 600);
    await flush();
    expect(JSON.parse(kv.data.get(PROGRESS_STORAGE_KEY) ?? '{}').entries[0].positionSec).toBe(115);
  });

  it('a cold start reads the persisted entries (never a URL but the preview); invalid entries are dropped', async () => {
    const kv = memoryKv();
    kv.data.set(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        entries: [
          { ref: REF, positionSec: 120, durationSec: 600, updatedAt: 5, meta: META },
          { ref: { blogUrl: 'b' }, positionSec: 'x' },
        ],
      }),
    );
    const { repo, store } = setup(kv);
    expect(store.isReady()).toBe(false);
    await repo.ready();
    expect(store.isReady()).toBe(true);
    expect(store.entries()).toHaveLength(1);
    expect(repo.resumePoint(REF, 600)).toBe(120);
  });

  it('Story 4.7: a preview URL with a query (a CDN token) never reaches the disk; memory keeps it', async () => {
    const { store, kv } = setup();
    await store.ready();
    const signed = 'https://example.invalid/videoPreview?id=1&tkn=secret';
    store.put({ ref: REF, positionSec: 10, durationSec: 600, updatedAt: 2, meta: { ...META, previewUrl: signed } });
    store.put({ ref: REF2, positionSec: 10, durationSec: 600, updatedAt: 1, meta: META }, { flush: true });
    await flush();
    const raw = kv.data.get(PROGRESS_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('tkn');
    const disk = JSON.parse(raw).entries;
    expect(disk.map((e: { meta: ProgressMeta }) => e.meta.previewUrl)).toEqual([null, META.previewUrl]);
    expect(store.get('v1')?.meta.previewUrl).toBe(signed);
  });

  it('Story 4.7: a stored preview URL with a query (written before 4.7) is dropped on load', async () => {
    const kv = memoryKv();
    kv.data.set(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        entries: [
          { ref: REF, positionSec: 120, durationSec: 600, updatedAt: 5, meta: { ...META, previewUrl: 'https://example.invalid/p?tkn=x' } },
        ],
      }),
    );
    const { store } = setup(kv);
    await store.ready();
    expect(store.get('v1')?.meta.previewUrl).toBeNull();
    // The disk is rewritten at once: the token does not stay there.
    await store.flush();
    expect(kv.data.get(PROGRESS_STORAGE_KEY)).not.toContain('tkn');
    expect(JSON.parse(kv.data.get(PROGRESS_STORAGE_KEY) ?? '{}').entries[0].positionSec).toBe(120);
  });

  it('Story 4.7: only a preview URL without a query or a fragment is persistable', () => {
    expect(persistablePreviewUrl('https://example.invalid/p.jpg')).toBe('https://example.invalid/p.jpg');
    expect(persistablePreviewUrl('https://example.invalid/p.jpg?tkn=x')).toBeNull();
    expect(persistablePreviewUrl('https://example.invalid/p.jpg#tkn=x')).toBeNull();
    expect(persistablePreviewUrl(null)).toBeNull();
  });

  it('Story 4.7: forget drops the local entry (memory and disk) and the server value; the session writes nothing more, no request', async () => {
    const { repo, store, kv, net } = setup();
    await repo.ready();
    repo.begin(REF, META);
    repo.onServerProgress('v1', 50);
    repo.report(REF, 100, 'tick', 600);
    repo.report(REF, 110, 'pause', 600);
    await flush();
    const sent = net.calls.length;
    const listener = jest.fn();
    store.subscribe(listener);
    repo.forget('v1');
    expect(store.get('v1')).toBeUndefined();
    expect(store.snapshot('v1')).toBeNull();
    expect(listener).toHaveBeenCalled();
    // The removal reaches the disk at once (no debounce): a kill cannot bring it back.
    await flush();
    expect(JSON.parse(kv.data.get(PROGRESS_STORAGE_KEY) ?? '{"entries":[]}').entries).toEqual([]);
    repo.report(REF, 130, 'exit', 600);
    await advance(DISK_DEBOUNCE_MS);
    expect(store.get('v1')).toBeUndefined();
    expect(JSON.parse(kv.data.get(PROGRESS_STORAGE_KEY) ?? '{"entries":[]}').entries).toEqual([]);
    expect(net.calls).toHaveLength(sent);
    // A later player session for the video starts over normally.
    repo.begin(REF, META);
    repo.report(REF, 0, 'tick', 600);
    repo.report(REF, 12, 'pause', 600);
    expect(store.get('v1')?.positionSec).toBe(12);
  });

  it('Story 4.7: subscribers are told when the disk was read, also when it was empty', async () => {
    const { store } = setup();
    const listener = jest.fn();
    store.subscribe(listener);
    await store.ready();
    expect(store.isReady()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a corrupt disk value loads nothing and never throws', async () => {
    const kv = memoryKv();
    kv.data.set(PROGRESS_STORAGE_KEY, '{not json');
    const { repo, store } = setup(kv);
    await expect(repo.ready()).resolves.toBeUndefined();
    expect(store.entries()).toEqual([]);
  });

  it('at most 200 entries; the oldest is dropped', async () => {
    const { store } = setup();
    await store.ready();
    for (let i = 0; i <= MAX_PROGRESS_ENTRIES; i += 1) {
      store.put({ ref: { ...REF, mediaId: `m${i}` }, positionSec: 10, durationSec: 600, updatedAt: 1000 + i, meta: META });
    }
    expect(store.entries()).toHaveLength(MAX_PROGRESS_ENTRIES);
    expect(store.get('m0')).toBeUndefined();
    expect(store.get(`m${MAX_PROGRESS_ENTRIES}`)).toBeDefined();
    expect(store.entries()[0].ref.mediaId).toBe(`m${MAX_PROGRESS_ENTRIES}`);
  });

  it('a disk write that lands after a reset undoes itself', async () => {
    const h = setup();
    const { store, kv } = h;
    await store.ready();
    let release!: () => void;
    kv.setGate = new Promise(resolve => {
      release = resolve;
    });
    store.put({ ref: REF, positionSec: 10, durationSec: 600, updatedAt: 1, meta: META }, { flush: true });
    await flush();
    await h.accountReset();
    kv.setGate = null;
    release();
    await flush();
    expect(kv.data.has(PROGRESS_STORAGE_KEY)).toBe(false);
  });

  it('a reset during a disk write, then a put: the new entry reaches the disk', async () => {
    const h = setup();
    const { store, kv } = h;
    await store.ready();
    let release!: () => void;
    kv.setGate = new Promise(resolve => {
      release = resolve;
    });
    store.put({ ref: REF, positionSec: 10, durationSec: 600, updatedAt: 1, meta: META }, { flush: true });
    await flush();
    await h.accountReset();
    store.put({ ref: REF2, positionSec: 20, durationSec: 600, updatedAt: 2, meta: META }, { flush: true });
    kv.setGate = null;
    release();
    await store.flush();
    const disk = JSON.parse(kv.data.get(PROGRESS_STORAGE_KEY) ?? '{"entries":[]}');
    expect(disk.entries.map((e: { ref: MediaRef }) => e.ref.mediaId)).toEqual(['v2']);
  });

  it('flush during a write waits for the follow-up write', async () => {
    const { store, kv } = setup();
    await store.ready();
    let release!: () => void;
    kv.setGate = new Promise(resolve => {
      release = resolve;
    });
    store.put({ ref: REF, positionSec: 10, durationSec: 600, updatedAt: 1, meta: META }, { flush: true });
    await flush();
    store.put({ ref: REF, positionSec: 30, durationSec: 600, updatedAt: 2, meta: META });
    const flushed = store.flush();
    kv.setGate = null;
    release();
    await flushed;
    expect(JSON.parse(kv.data.get(PROGRESS_STORAGE_KEY) ?? '{}').entries[0].positionSec).toBe(30);
  });

  it('a load that lands after a reset is dropped', async () => {
    const kv = memoryKv();
    kv.data.set(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({ v: 1, entries: [{ ref: REF, positionSec: 120, durationSec: 600, updatedAt: 5, meta: META }] }),
    );
    const h = setup(kv);
    const loading = h.store.ready();
    await h.accountReset();
    await loading;
    expect(h.store.get('v1')).toBeUndefined();
  });

  it('snapshots are stable until their video changes; subscribers are told', async () => {
    const { store, repo } = setup();
    await store.ready();
    const listener = jest.fn();
    store.subscribe(listener);
    repo.onServerProgress('v1', 300);
    const first = store.snapshot('v1');
    expect(store.snapshot('v1')).toBe(first);
    store.put({ ref: REF2, positionSec: 10, durationSec: 600, updatedAt: 1, meta: META });
    expect(store.snapshot('v1')).toBe(first);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a failed disk write is logged without data and keeps memory', async () => {
    const { store, kv } = setup();
    await store.ready();
    kv.failSet = true;
    store.put({ ref: REF, positionSec: 10, durationSec: 600, updatedAt: 1, meta: META }, { flush: true });
    await flush();
    expect(store.get('v1')?.positionSec).toBe(10);
    expect(silentLogger.warn).toHaveBeenCalledWith('progress', 'save', { outcome: 'failed' });
  });
});
