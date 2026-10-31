import type { KeyValueStore } from '../../../shared/platform/keyValueStore';
import { logger } from '../../../shared/services/logger';
import {
  PLAYBACK_SPEEDS,
  SPEED_PREFERENCE_KEY,
  createSpeedPreferenceStore,
  parseSpeed,
  serializeSpeed,
  speedLabel,
} from '../speedPreference';

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

describe('the presets (PLAY-07)', () => {
  it('exactly 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2 and 3, in menu order', () => {
    expect(PLAYBACK_SPEEDS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3]);
  });

  it('labels: «N×» for every preset, 1× included (owner decision Q2 a)', () => {
    expect(PLAYBACK_SPEEDS.map(speedLabel)).toEqual(['0.5×', '0.75×', '1×', '1.25×', '1.5×', '1.75×', '2×', '3×']);
  });
});

describe('parseSpeed (tolerant)', () => {
  it.each(PLAYBACK_SPEEDS.map(speed => [serializeSpeed(speed), speed] as const))('%p → %p', (raw, expected) => {
    expect(parseSpeed(raw)).toBe(expected);
  });

  it.each([null, undefined, '', 'fast', '9', '0', '-1', '1.0', '2.5', ' 1.5', '1.5x', '1,5', '{"speed":2}', 'NaN'])(
    '%p → null',
    raw => {
      expect(parseSpeed(raw)).toBeNull();
    },
  );

  it('serialize then parse is the identity for every preset', () => {
    for (const speed of PLAYBACK_SPEEDS) {
      expect(parseSpeed(serializeSpeed(speed))).toBe(speed);
    }
  });
});

describe('createSpeedPreferenceStore', () => {
  it('first run (nothing stored): 1×', async () => {
    const store = createSpeedPreferenceStore(() => memoryKv());
    expect(store.peek()).toBeUndefined();
    await expect(store.read()).resolves.toBe(1);
    expect(store.peek()).toBe(1);
  });

  it('reads the device key once, then serves memory', async () => {
    const kv = memoryKv({ [SPEED_PREFERENCE_KEY]: '2' });
    const store = createSpeedPreferenceStore(() => kv);
    await expect(store.read()).resolves.toBe(2);
    await expect(store.read()).resolves.toBe(2);
    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it.each(['fast', '9'])('a bad stored value (%p) or a failed read → 1×', async raw => {
    await expect(createSpeedPreferenceStore(() => memoryKv({ [SPEED_PREFERENCE_KEY]: raw })).read()).resolves.toBe(1);
    const failing = memoryKv();
    (failing.get as jest.Mock).mockRejectedValueOnce(new Error('io'));
    await expect(createSpeedPreferenceStore(() => failing).read()).resolves.toBe(1);
  });

  it('a write updates memory at once and stores the string; a pick during the read wins', async () => {
    const kv = memoryKv({ [SPEED_PREFERENCE_KEY]: '0.5' });
    const store = createSpeedPreferenceStore(() => kv);
    const reading = store.read();
    store.write(1.75);
    await expect(reading).resolves.toBe(1.75);
    expect(kv.values.get(SPEED_PREFERENCE_KEY)).toBe('1.75');
    store.write(3);
    expect(store.peek()).toBe(3);
    await Promise.resolve();
    expect(kv.values.get(SPEED_PREFERENCE_KEY)).toBe('3');
  });

  it('a failed write keeps the memory value, does not throw, and is only logged', async () => {
    const kv = memoryKv();
    (kv.set as jest.Mock).mockRejectedValueOnce(new Error('io'));
    const store = createSpeedPreferenceStore(() => kv);
    store.write(1.5);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.peek()).toBe(1.5);
    expect(logger.entries().map(entry => entry.message)).toContain('speed preference not stored');
  });

  it('forget drops memory only: the next read comes from the store', async () => {
    const kv = memoryKv();
    const store = createSpeedPreferenceStore(() => kv);
    store.write(2);
    await Promise.resolve();
    store.forget();
    expect(store.peek()).toBeUndefined();
    await expect(store.read()).resolves.toBe(2);
  });
});
