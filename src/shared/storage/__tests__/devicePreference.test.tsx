/**
 * Epic 8 retro A3: the factory and `usePreference` on generic definitions.
 * The four app definitions (keys, singletons, the demo setter) are
 * `__tests__/devicePreferences.test.tsx`; each store keeps its parse / label
 * cases next to it.
 */
import { act } from 'react';
import { createRoot } from 'test-renderer';
import type { KeyValueStore } from '../../platform/keyValueStore';
import { logger } from '../../services/logger';
import {
  createDevicePreference,
  usePreference,
  type DevicePreference,
  type DevicePreferenceDefinition,
} from '../devicePreference';

const KEY = 'test.level.v1';

function memoryKv(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const kv: KeyValueStore & { values: Map<string, string> } = {
    values,
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    remove: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    clear: jest.fn(async () => values.clear()),
  };
  return kv;
}

/** A generic definition: `1`–`9` as a number, fallback 0. */
function level(kv: () => KeyValueStore, extra: Partial<DevicePreferenceDefinition<number, number>> = {}) {
  return createDevicePreference<number>({
    key: KEY,
    parse: raw => (raw !== null && /^[1-9]$/.test(raw) ? Number(raw) : null),
    serialize: String,
    fallback: 0,
    scope: 'test',
    label: 'level preference',
    kv,
    ...extra,
  });
}

const messages = () => logger.entries().map(entry => entry.message);

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  logger.clear();
  jest.restoreAllMocks();
});

describe('createDevicePreference', () => {
  it('nothing stored, junk or a failed read: the fallback, a failure logged once without fields', async () => {
    await expect(level(() => memoryKv()).read()).resolves.toBe(0);
    await expect(level(() => memoryKv({ [KEY]: 'x' })).read()).resolves.toBe(0);
    const failing = memoryKv();
    (failing.get as jest.Mock).mockRejectedValueOnce(new Error('io'));
    await expect(level(() => failing).read()).resolves.toBe(0);
    expect(messages()).toEqual(['level preference not read']);
    expect(logger.entries()[0].fields).toBeUndefined();
  });

  it('one single-flight read, then memory', async () => {
    const kv = memoryKv({ [KEY]: '4' });
    const store = level(() => kv);
    await expect(Promise.all([store.read(), store.read()])).resolves.toEqual([4, 4]);
    await expect(store.read()).resolves.toBe(4);
    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it('a pick during the read wins; a write is in memory at once and stored', async () => {
    const kv = memoryKv({ [KEY]: '4' });
    const store = level(() => kv);
    const reading = store.read();
    store.write(7);
    expect(store.peek()).toBe(7);
    await expect(reading).resolves.toBe(7);
    expect(kv.values.get(KEY)).toBe('7');
  });

  it('a failed or synchronously throwing store: memory kept, only logged, nothing escapes', async () => {
    const kv = memoryKv();
    (kv.set as jest.Mock).mockRejectedValueOnce(new Error('io'));
    level(() => kv).write(3);
    await Promise.resolve();
    await Promise.resolve();
    const throwing = level(() => {
      throw new Error('no native module');
    });
    await expect(throwing.read()).resolves.toBe(0);
    throwing.forget();
    expect(() => throwing.write(2)).not.toThrow();
    expect(throwing.peek()).toBe(2);
    expect(messages()).toEqual(['level preference not stored', 'level preference not read', 'level preference not stored']);
  });

  it('forget drops memory only', async () => {
    const kv = memoryKv();
    const store = level(() => kv);
    store.write(5);
    store.forget();
    expect(store.peek()).toBeUndefined();
    await expect(store.read()).resolves.toBe(5);
  });

  it('onValue: once per finished read, once per write, not again when a pick won the read', async () => {
    const onValue = jest.fn();
    const store = level(() => memoryKv({ [KEY]: '4' }), { onValue });
    await store.read();
    expect(onValue.mock.calls).toEqual([[4]]);
    store.write(6);
    expect(onValue.mock.calls).toEqual([[4], [6]]);

    const raced = jest.fn();
    const other = level(() => memoryKv({ [KEY]: '4' }), { onValue: raced });
    const reading = other.read();
    other.write(8);
    await reading;
    expect(raced.mock.calls).toEqual([[8]]);
  });

  it('a throwing onValue: logged once per call (no value), the read is not stuck, write does not throw', async () => {
    const kv = memoryKv({ [KEY]: '4' });
    const store = level(() => kv, {
      onValue: () => {
        throw new Error('apply failed');
      },
    });
    await expect(store.read()).resolves.toBe(4);
    store.forget();
    await expect(store.read()).resolves.toBe(4);
    expect(kv.get).toHaveBeenCalledTimes(2);
    expect(() => store.write(5)).not.toThrow();
    expect(store.peek()).toBe(5);
    await Promise.resolve();
    expect(kv.values.get(KEY)).toBe('5');
    expect(messages()).toEqual(['level preference not applied', 'level preference not applied', 'level preference not applied']);
    expect(logger.entries().every(entry => entry.fields === undefined)).toBe(true);
  });

  it('remember only with `rememberable`: memory only, nothing stored, no onValue', async () => {
    expect('remember' in level(() => memoryKv())).toBe(false);
    const kv = memoryKv();
    const onValue = jest.fn();
    const store = createDevicePreference<number>({
      key: KEY,
      parse: () => null,
      serialize: String,
      fallback: 0,
      scope: 'test',
      label: 'level preference',
      kv: () => kv,
      onValue,
      rememberable: true,
    });
    store.remember(9);
    expect(store.peek()).toBe(9);
    await Promise.resolve();
    expect(kv.set).not.toHaveBeenCalled();
    expect(onValue).not.toHaveBeenCalled();
  });
});

describe('usePreference', () => {
  type Seen = { value: unknown; write: (next: number) => void };
  type Store = Pick<DevicePreference<number>, 'fallback' | 'peek' | 'read' | 'write'>;

  function Probe({ store, enabled, seen }: { store: Store; enabled: boolean; seen: Seen[] }) {
    seen.push(usePreference(store, enabled));
    return null;
  }

  async function mount(store: Store, enabled: boolean) {
    const seen: Seen[] = [];
    const root = createRoot();
    await act(async () => root.render(<Probe store={store} enabled={enabled} seen={seen} />));
    return { seen, root, last: () => seen[seen.length - 1] };
  }

  it('undefined, then the read value; write stores it and updates at once', async () => {
    const kv = memoryKv({ [KEY]: '4' });
    const { seen, root, last } = await mount(level(() => kv), true);
    expect(seen[0].value).toBeUndefined();
    expect(last().value).toBe(4);
    await act(async () => last().write(6));
    expect(last().value).toBe(6);
    expect(kv.values.get(KEY)).toBe('6');
    await act(async () => root.unmount());
  });

  it('a value already in memory: no read; disabled: never read', async () => {
    const kv = memoryKv();
    const warm = level(() => kv);
    warm.write(3);
    (kv.get as jest.Mock).mockClear();
    const first = await mount(warm, true);
    expect(first.seen[0].value).toBe(3);
    const second = await mount(level(() => kv), false);
    expect(second.last().value).toBeUndefined();
    expect(kv.get).not.toHaveBeenCalled();
    await act(async () => {
      first.root.unmount();
      second.root.unmount();
    });
  });

  it('a rejected read shows the fallback', async () => {
    const store: Store = {
      fallback: 0,
      peek: () => undefined,
      read: () => Promise.reject(new Error('apply failed')),
      write: () => {},
    };
    const { last, root } = await mount(store, true);
    expect(last().value).toBe(0);
    await act(async () => root.unmount());
  });

  it('another store: starts again from its snapshot, then its read', async () => {
    const a = level(() => memoryKv());
    a.write(2);
    const b = level(() => memoryKv({ [KEY]: '8' }));
    const seen: Seen[] = [];
    const root = createRoot();
    await act(async () => root.render(<Probe store={a} enabled seen={seen} />));
    expect(seen[seen.length - 1].value).toBe(2);
    await act(async () => root.render(<Probe store={b} enabled seen={seen} />));
    expect(seen[seen.length - 1].value).toBe(8);
    await act(async () => root.unmount());
  });
});
