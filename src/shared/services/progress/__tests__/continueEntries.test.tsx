/**
 * Story 4.7: the Continue view from the local entries (unit) and its hook
 * (stable snapshots over the store, readiness, reactivity).
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import type { MediaRef } from '../../../entities/post/types';
import type { KeyValueStore } from '../../../platform/keyValueStore';
import type { Logger } from '../../logger';
import {
  MAX_CONTINUE_ENTRIES,
  continueEntries,
  entryDurationSec,
  useContinueEntries,
  type ContinueView,
} from '../continueEntries';
import type { ProgressRepository } from '../progressRepository';
import { createProgressStore, type ProgressEntry, type ProgressStore } from '../progressStore';
import { ProgressContext } from '../useProgress';

const ref = (mediaId: string): MediaRef => ({ blogUrl: 'synthetic-blog', postId: `p-${mediaId}`, mediaId });
const entry = (
  mediaId: string,
  positionSec: number,
  updatedAt: number,
  durationSec: number | null = 600,
  metaDuration: number | null = null,
): ProgressEntry => ({
  ref: ref(mediaId),
  positionSec,
  durationSec,
  updatedAt,
  meta: { title: '', postTitle: 'Post', authorName: 'Author', previewUrl: null, durationSec: metaDuration },
});

describe('continueEntries', () => {
  it('unfinished entries with a position > 0, in the given (newest first) order', () => {
    const list = [entry('a', 100, 4), entry('b', 0, 3), entry('c', 590, 2), entry('d', 30, 1)];
    expect(continueEntries(list).map(e => e.ref.mediaId)).toEqual(['a', 'd']);
  });

  it('the finished rule: ≥ 95 % or < 30 s left leaves the view', () => {
    expect(continueEntries([entry('a', 570, 1)])).toEqual([]);
    expect(continueEntries([entry('a', 571, 1)])).toEqual([]);
    expect(continueEntries([entry('a', 569, 1)])).toHaveLength(1);
  });

  it('an unknown duration stays (unfinished); the post duration is used when the engine gave none', () => {
    expect(continueEntries([entry('a', 5000, 1, null)])).toHaveLength(1);
    expect(continueEntries([entry('a', 590, 1, null, 600)])).toEqual([]);
  });

  it('an engine duration of 0 is not known: the post duration decides', () => {
    expect(entryDurationSec(entry('a', 590, 1, 0, 600))).toBe(600);
    expect(continueEntries([entry('a', 590, 1, 0, 600)])).toEqual([]);
    expect(entryDurationSec(entry('a', 100, 1, 0, null))).toBeNull();
  });

  it(`at most ${MAX_CONTINUE_ENTRIES} cards, one per media id`, () => {
    const list = Array.from({ length: 25 }, (_, i) => entry(`m${i}`, 10, 100 - i));
    expect(continueEntries(list)).toHaveLength(MAX_CONTINUE_ENTRIES);
    expect(continueEntries([entry('a', 10, 2), entry('a', 20, 1)])).toHaveLength(1);
  });
});

function memoryKv(): KeyValueStore {
  const data = new Map<string, string>();
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

const silent: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  entries: () => [],
  clear: () => {},
  setSink: () => {},
};

describe('useContinueEntries', () => {
  let store: ProgressStore;
  let views: ContinueView[];
  let renderer: Root | null;

  function Probe() {
    views.push(useContinueEntries());
    return null;
  }

  async function mount(repository: ProgressRepository | null) {
    renderer = createRoot();
    await act(async () => {
      renderer!.render(
        <ProgressContext.Provider value={repository}>
          <Probe />
        </ProgressContext.Provider>,
      );
    });
  }

  beforeEach(() => {
    store = createProgressStore({ kv: memoryKv, scope: { generation: () => 0 }, logger: silent, debounceMs: 10 });
    views = [];
    renderer = null;
  });

  afterEach(async () => {
    const current = renderer;
    if (current) {
      await act(async () => current.unmount());
    }
  });

  it('without a repository: ready, empty', async () => {
    await mount(null);
    expect(views[views.length - 1]).toEqual({ ready: true, entries: [] });
  });

  it('loads the store, then follows it: a newer entry moves first, a finished one leaves', async () => {
    await mount({ store } as unknown as ProgressRepository);
    const last = () => views[views.length - 1];
    expect(last().ready).toBe(true);
    expect(last().entries).toEqual([]);
    await act(async () => {
      store.put(entry('a', 100, 1));
      store.put(entry('b', 100, 2));
    });
    expect(last().entries.map(e => e.ref.mediaId)).toEqual(['b', 'a']);
    await act(async () => {
      store.put(entry('a', 120, 3));
    });
    expect(last().entries.map(e => e.ref.mediaId)).toEqual(['a', 'b']);
    await act(async () => {
      store.put(entry('a', 599, 4));
    });
    expect(last().entries.map(e => e.ref.mediaId)).toEqual(['b']);
    // An unrelated change (a finished video saved again) keeps the same snapshot.
    const before = last();
    await act(async () => {
      store.put(entry('a', 600, 5));
    });
    expect(last()).toBe(before);
    await act(async () => {
      await store.reset();
    });
    expect(last().entries).toEqual([]);
  });
});
