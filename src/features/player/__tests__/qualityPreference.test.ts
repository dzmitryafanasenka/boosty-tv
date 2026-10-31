import type { KeyValueStore } from '../../../shared/platform/keyValueStore';
import {
  QUALITY_PREFERENCE_KEY,
  createQualityPreferenceStore,
  parseQualityPreference,
  serializeQualityPreference,
} from '../qualityPreference';
import { logger } from '../../../shared/services/logger';

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

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  logger.clear();
  jest.restoreAllMocks();
});

describe('parseQualityPreference (tolerant)', () => {
  it.each([
    ['auto', 'auto'],
    ['720', 720],
    ['2160', 2160],
    ['144', 144],
  ] as const)('%p → %p', (raw, expected) => {
    expect(parseQualityPreference(raw)).toBe(expected);
  });

  it.each([null, undefined, '', 'AUTO', '0', '-720', '720.5', '720p', '99999', '5000', 'https://example.invalid/x', ' 720', '{"q":720}'])(
    '%p → null',
    raw => {
      expect(parseQualityPreference(raw)).toBeNull();
    },
  );

  it('serializes auto or the height, never anything else', () => {
    expect(serializeQualityPreference('auto')).toBe('auto');
    expect(serializeQualityPreference(1080)).toBe('1080');
  });
});

describe('createQualityPreferenceStore', () => {
  it('reads the device key once, then serves memory', async () => {
    const kv = memoryKv({ [QUALITY_PREFERENCE_KEY]: '720' });
    const store = createQualityPreferenceStore(() => kv);
    expect(store.peek()).toBeUndefined();
    await expect(store.read()).resolves.toBe(720);
    await expect(store.read()).resolves.toBe(720);
    expect(store.peek()).toBe(720);
    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it('junk or a failed read → no preference (null)', async () => {
    await expect(createQualityPreferenceStore(() => memoryKv({ [QUALITY_PREFERENCE_KEY]: 'junk' })).read()).resolves.toBeNull();
    const failing = memoryKv();
    (failing.get as jest.Mock).mockRejectedValueOnce(new Error('io'));
    await expect(createQualityPreferenceStore(() => failing).read()).resolves.toBeNull();
  });

  it('a write updates memory at once and stores the string; a pick during the read wins', async () => {
    const kv = memoryKv({ [QUALITY_PREFERENCE_KEY]: '360' });
    const store = createQualityPreferenceStore(() => kv);
    const reading = store.read();
    store.write('auto');
    await expect(reading).resolves.toBe('auto');
    expect(kv.values.get(QUALITY_PREFERENCE_KEY)).toBe('auto');
    store.write(1080);
    expect(store.peek()).toBe(1080);
    await Promise.resolve();
    expect(kv.values.get(QUALITY_PREFERENCE_KEY)).toBe('1080');
  });

  it('remember: memory only, nothing stored', async () => {
    const kv = memoryKv();
    const store = createQualityPreferenceStore(() => kv);
    store.remember(1440);
    expect(store.peek()).toBe(1440);
    await Promise.resolve();
    expect(kv.set).not.toHaveBeenCalled();
  });

  it('a failed write keeps the memory value and does not throw', async () => {
    const kv = memoryKv();
    (kv.set as jest.Mock).mockRejectedValueOnce(new Error('io'));
    const store = createQualityPreferenceStore(() => kv);
    store.write(720);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.peek()).toBe(720);
  });

  it('a store that throws synchronously (Story 8.1 review): read → null, write → logged, memory kept; nothing escapes', async () => {
    const store = createQualityPreferenceStore(() => {
      throw new Error('no native module');
    });
    await expect(store.read()).resolves.toBeNull();
    store.forget();
    expect(() => store.write(720)).not.toThrow();
    expect(store.peek()).toBe(720);
    const messages = logger.entries().map(entry => entry.message);
    expect(messages).toContain('quality preference not read');
    expect(messages).toContain('quality preference not stored');
  });
});
