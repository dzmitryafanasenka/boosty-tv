/**
 * Story 12.5: the launcher channel sync over a real progress store (an
 * in-memory KeyValueStore) and a fake port. Every sync row of the spec's
 * I/O matrix: first run, history, ticks, new/removed/finished/clear-all,
 * failure, the AccountScope wipe and the generation guard, demo off.
 */
import { createAccountScope } from '../../shared/account';
import type { LauncherCard, LauncherSyncOutcome } from '../../shared/platform/launcherChannel';
import type { KeyValueStore } from '../../shared/platform/keyValueStore';
import type { Logger } from '../../shared/services/logger';
import {
  MAX_CONTINUE_ENTRIES,
  createProgressStore,
  type ProgressEntry,
  type ProgressStore,
} from '../../shared/services/progress';
import { createLauncherChannel, launcherCards, type LauncherChannel } from '../launcherChannel';

jest.mock('../session', () => ({ DEMO_ACTIVE: false }));

function memoryKv(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    get: async key => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async key => {
      data.delete(key);
    },
    clear: async () => {
      data.clear();
    },
  };
}

function recordingLogger() {
  const lines: Array<{ level: string; message: string; fields?: unknown }> = [];
  const at =
    (level: string) =>
    (_scope: string, message: string, fields?: unknown) =>
      lines.push({ level, message, fields });
  const logger: Logger = {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    entries: () => [],
    clear: () => {},
    setSink: () => {},
  };
  return { logger, lines };
}

const NEUTRAL: LauncherCard[] = [{ kind: 'home', title: 'Откройте Boosty TV' }];
const DURATION = 3600;

function entry(n: number, positionSec: number, updatedAt: number, meta: Partial<ProgressEntry['meta']> = {}): ProgressEntry {
  return {
    ref: { blogUrl: 'synthetic-blog', postId: `post-${n}`, mediaId: `v${n}` },
    positionSec,
    durationSec: DURATION,
    updatedAt,
    meta: {
      title: `Lesson ${n}`,
      postTitle: `Post ${n}`,
      authorName: `Author ${n}`,
      previewUrl: `https://img.example.invalid/${n}.jpg`,
      durationSec: DURATION,
      ...meta,
    },
  };
}

/** Lets the store's load and the sync chain settle. */
async function flush() {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

let store: ProgressStore;
let scope: ReturnType<typeof createAccountScope>;
let sync: jest.Mock<Promise<LauncherSyncOutcome>, [string, readonly LauncherCard[]]>;
let log: ReturnType<typeof recordingLogger>;
let channel: LauncherChannel;
let stop: () => void;
/** The app's return to the foreground (the injected subscription). */
let foreground: Array<() => void> = [];
const toForeground = () => foreground.forEach(listener => listener());

function setup({ disk, enabled = true }: { disk?: ProgressEntry[]; enabled?: boolean } = {}) {
  log = recordingLogger();
  scope = createAccountScope({ logger: () => log.logger });
  const kv = memoryKv(disk ? { 'progress.v1': JSON.stringify({ v: 1, entries: disk }) } : {});
  store = createProgressStore({ kv: () => kv, scope, logger: log.logger, debounceMs: 10 });
  sync = jest.fn(async (_name: string, _cards: readonly LauncherCard[]) => 'synced' as LauncherSyncOutcome);
  foreground = [];
  channel = createLauncherChannel({
    store,
    sync,
    enabled: () => enabled,
    scope,
    logger: log.logger,
    onForeground: listener => {
      foreground.push(listener);
      return () => {
        foreground = foreground.filter(l => l !== listener);
      };
    },
  });
  scope.register(
    { name: 'session', reset: () => {} },
    { name: 'progress', reset: () => store.reset() },
    { name: 'launcherChannel', reset: () => channel.reset() },
  );
  scope.seal();
}

/** The cards of the last sync. */
const lastCards = () => sync.mock.calls[sync.mock.calls.length - 1]?.[1];

afterEach(() => {
  stop?.();
});

describe('launcher channel sync (Story 12.5)', () => {
  it('matrix «First run»: no history → one sync with the neutral card, named «Продолжить просмотр»', async () => {
    setup();
    stop = channel.start();
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith('Продолжить просмотр', NEUTRAL);
  });

  it('waits for the disk: no sync of an empty list before the stored history is read', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    stop = channel.start();
    expect(sync).not.toHaveBeenCalled();
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(lastCards()).toHaveLength(1);
  });

  it('matrix «History»: 3 Continue entries → 3 cards, newest first, title + author + poster; finished and unstarted ones left out', async () => {
    setup({
      disk: [
        entry(1, 600, 1000),
        entry(2, 720, 2000, { title: 'Видео 2' }),
        entry(3, 1800, 3000, { authorName: '' }),
        entry(4, 3500, 4000), // ≥ 95 %: finished
        entry(5, 0, 5000), // never started
      ],
    });
    stop = channel.start();
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(lastCards()).toEqual([
      {
        kind: 'media',
        title: 'Lesson 3',
        description: '',
        posterUrl: 'https://img.example.invalid/3.jpg',
        ref: { blogUrl: 'synthetic-blog', postId: 'post-3', mediaId: 'v3' },
      },
      {
        kind: 'media',
        // A generic video title → the post title (the Continue card's rule).
        title: 'Post 2',
        description: 'Author 2',
        posterUrl: 'https://img.example.invalid/2.jpg',
        ref: { blogUrl: 'synthetic-blog', postId: 'post-2', mediaId: 'v2' },
      },
      {
        kind: 'media',
        title: 'Lesson 1',
        description: 'Author 1',
        posterUrl: 'https://img.example.invalid/1.jpg',
        ref: { blogUrl: 'synthetic-blog', postId: 'post-1', mediaId: 'v1' },
      },
    ]);
  });

  it('a poster with a query (a CDN token) is never sent: the banner (null) instead; untitled → «Без названия»', () => {
    const cards = launcherCards([
      entry(1, 600, 1000, { previewUrl: 'https://img.example.invalid/1.jpg?tkn=secret', title: '', postTitle: '' }),
    ]);
    expect(cards).toEqual([
      {
        kind: 'media',
        title: 'Без названия',
        description: 'Author 1',
        posterUrl: null,
        ref: { blogUrl: 'synthetic-blog', postId: 'post-1', mediaId: 'v1' },
      },
    ]);
    expect(JSON.stringify(cards)).not.toContain('tkn');
  });

  it(`at most ${MAX_CONTINUE_ENTRIES} cards`, () => {
    const many = Array.from({ length: 25 }, (_, i) => entry(i + 1, 100, 10_000 - i));
    expect(launcherCards(many)).toHaveLength(MAX_CONTINUE_ENTRIES);
  });

  it('matrix «Tick»: progress ticks on the top entry never sync', async () => {
    setup({ disk: [entry(1, 600, 1000), entry(2, 700, 2000)] });
    stop = channel.start();
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
    for (let sec = 710; sec < 800; sec += 10) {
      store.put(entry(2, sec, 2000 + sec));
    }
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('matrix «New»: a newly started video → one sync with it first', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    stop = channel.start();
    await flush();
    store.put(entry(2, 30, Date.now()));
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(lastCards()?.map(c => (c.kind === 'media' ? c.ref.mediaId : c.kind))).toEqual(['v2', 'v1']);
  });

  it('matrix «Order»: resuming an older video moves it first → one sync', async () => {
    setup({ disk: [entry(1, 600, 1000), entry(2, 700, 2000)] });
    stop = channel.start();
    await flush();
    store.put(entry(1, 610, 3000));
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(lastCards()?.map(c => (c.kind === 'media' ? c.ref.mediaId : c.kind))).toEqual(['v1', 'v2']);
  });

  it('matrix «Removed» / «Finished»: one sync each with the rest; the last one gone → the neutral card', async () => {
    setup({ disk: [entry(1, 600, 1000), entry(2, 700, 2000)] });
    stop = channel.start();
    await flush();
    store.removeLocal('v2');
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(lastCards()).toHaveLength(1);
    store.put(entry(1, 3590, 3000)); // finished (< 30 s left)
    await flush();
    expect(sync).toHaveBeenCalledTimes(3);
    expect(lastCards()).toEqual(NEUTRAL);
  });

  it('matrix «Clear-all»: «Очистить всё» → one sync with the neutral card', async () => {
    setup({ disk: [entry(1, 600, 1000), entry(2, 700, 2000)] });
    stop = channel.start();
    await flush();
    store.clearLocal(() => true);
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(lastCards()).toEqual(NEUTRAL);
  });

  it('a failure is logged (outcome and count only) and the next change retries', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    sync.mockResolvedValueOnce('failed');
    stop = channel.start();
    await flush();
    expect(log.lines).toContainEqual({ level: 'warn', message: 'sync', fields: { outcome: 'failed', count: 1 } });
    expect(JSON.stringify(log.lines)).not.toMatch(/Lesson|Author|v1|post-1|synthetic-blog|example/);
    store.put(entry(2, 30, 5000));
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(log.lines).toContainEqual({ level: 'info', message: 'sync', fields: { outcome: 'synced', count: 2 } });
  });

  it('a failed sync of an unchanged list is sent again on the return to the foreground (once it succeeds, no more)', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    sync.mockResolvedValueOnce('failed');
    stop = channel.start();
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
    toForeground();
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(lastCards()).toHaveLength(1);
    toForeground();
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('a failed wipe-time neutral sync: the next return to the foreground publishes the neutral card', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    stop = channel.start();
    await flush();
    sync.mockResolvedValueOnce('failed');
    await scope.reset();
    expect(sync).toHaveBeenCalledTimes(2);
    toForeground();
    await flush();
    expect(sync).toHaveBeenCalledTimes(3);
    expect(lastCards()).toEqual(NEUTRAL);
  });

  it('syncs run one at a time; only the latest wanted list follows a running one', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    let release: (o: LauncherSyncOutcome) => void = () => {};
    sync.mockImplementationOnce(
      () =>
        new Promise<LauncherSyncOutcome>(resolve => {
          release = resolve;
        }),
    );
    stop = channel.start();
    await flush();
    store.put(entry(2, 30, 5000));
    store.put(entry(3, 30, 6000));
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
    release('synced');
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(lastCards()).toHaveLength(3);
  });

  it('matrix «Sign-out / account switch»: the AccountScope wipe publishes the neutral card; an old account sync in flight is not republished', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    let release: (o: LauncherSyncOutcome) => void = () => {};
    stop = channel.start();
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
    // A change of the old account whose sync is held by a running one…
    sync.mockImplementationOnce(
      () =>
        new Promise<LauncherSyncOutcome>(resolve => {
          release = resolve;
        }),
    );
    store.put(entry(2, 30, 5000));
    await flush();
    store.put(entry(3, 30, 6000)); // queued behind the running sync, old generation
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    const reset = scope.reset();
    await flush();
    release('synced');
    await reset;
    await flush();
    // The queued old-account list was replaced by the neutral card; nothing after it.
    expect(sync).toHaveBeenCalledTimes(3);
    expect(lastCards()).toEqual(NEUTRAL);
    // The next account reads its (empty) disk: the same neutral card, no sync.
    await store.ready();
    await flush();
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it('a request made under an older generation is dropped (never sent)', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    let release: (o: LauncherSyncOutcome) => void = () => {};
    sync.mockImplementationOnce(
      () =>
        new Promise<LauncherSyncOutcome>(resolve => {
          release = resolve;
        }),
    );
    stop = channel.start();
    await flush();
    store.put(entry(2, 30, 5000)); // wanted under generation 0, held behind the running sync
    await flush();
    // A bump without this channel's own reset (another store's reset would do it).
    const generation = jest.spyOn(scope, 'generation').mockReturnValue(1);
    release('synced');
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(log.lines).toContainEqual({ level: 'info', message: 'stale sync dropped', fields: undefined });
    generation.mockRestore();
  });

  it('a sync failure does not fail the wipe', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    stop = channel.start();
    await flush();
    sync.mockResolvedValueOnce('failed');
    await expect(scope.reset()).resolves.toEqual({ failed: [] });
    expect(lastCards()).toEqual(NEUTRAL);
  });

  it('demo (disabled): the channel is never written, also not by the wipe', async () => {
    setup({ disk: [entry(1, 600, 1000)], enabled: false });
    stop = channel.start();
    await flush();
    store.put(entry(2, 30, 5000));
    await scope.reset();
    await flush();
    expect(sync).not.toHaveBeenCalled();
  });

  it('after stop, changes no longer sync', async () => {
    setup({ disk: [entry(1, 600, 1000)] });
    stop = channel.start();
    await flush();
    stop();
    store.put(entry(2, 30, 5000));
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
