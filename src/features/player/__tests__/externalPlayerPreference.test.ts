import type { KeyValueStore } from '../../../shared/platform/keyValueStore';
import { logger } from '../../../shared/services/logger';
import {
  EXTERNAL_PLAYER_PREFERENCE_KEY,
  createExternalPlayerPreferenceStore,
  parseExternalPlayer,
  serializeExternalPlayer,
} from '../externalPlayerPreference';

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

describe('parse / serialize (Story 8.2)', () => {
  it('the key is `player.external.v1`; `on` / `off` round-trip', () => {
    expect(EXTERNAL_PLAYER_PREFERENCE_KEY).toBe('player.external.v1');
    expect(serializeExternalPlayer(true)).toBe('on');
    expect(serializeExternalPlayer(false)).toBe('off');
    expect(parseExternalPlayer('on')).toBe(true);
    expect(parseExternalPlayer('off')).toBe(false);
  });

  it.each([null, undefined, '', 'true', '1', 'ON', ' on'])('%p → null', raw => {
    expect(parseExternalPlayer(raw)).toBeNull();
  });
});

describe('createExternalPlayerPreferenceStore', () => {
  it('first run (nothing stored): off', async () => {
    const store = createExternalPlayerPreferenceStore(() => memoryKv());
    expect(store.peek()).toBeUndefined();
    await expect(store.read()).resolves.toBe(false);
    expect(store.peek()).toBe(false);
  });

  it('reads the device key once, then serves memory', async () => {
    const kv = memoryKv({ [EXTERNAL_PLAYER_PREFERENCE_KEY]: 'on' });
    const store = createExternalPlayerPreferenceStore(() => kv);
    await expect(store.read()).resolves.toBe(true);
    await expect(store.read()).resolves.toBe(true);
    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it('a bad stored value or a failed read → off', async () => {
    await expect(
      createExternalPlayerPreferenceStore(() => memoryKv({ [EXTERNAL_PLAYER_PREFERENCE_KEY]: 'yes' })).read(),
    ).resolves.toBe(false);
    const failing = memoryKv();
    (failing.get as jest.Mock).mockRejectedValueOnce(new Error('io'));
    await expect(createExternalPlayerPreferenceStore(() => failing).read()).resolves.toBe(false);
    expect(logger.entries().map(entry => entry.message)).toContain('external player preference not read');
  });

  it('a write updates memory at once and stores the string; a toggle during the read wins', async () => {
    const kv = memoryKv({ [EXTERNAL_PLAYER_PREFERENCE_KEY]: 'off' });
    const store = createExternalPlayerPreferenceStore(() => kv);
    const reading = store.read();
    store.write(true);
    await expect(reading).resolves.toBe(true);
    expect(kv.values.get(EXTERNAL_PLAYER_PREFERENCE_KEY)).toBe('on');
    store.write(false);
    expect(store.peek()).toBe(false);
    await Promise.resolve();
    expect(kv.values.get(EXTERNAL_PLAYER_PREFERENCE_KEY)).toBe('off');
  });

  it('a failed write keeps the memory value, does not throw, and is only logged', async () => {
    const kv = memoryKv();
    (kv.set as jest.Mock).mockRejectedValueOnce(new Error('io'));
    const store = createExternalPlayerPreferenceStore(() => kv);
    store.write(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.peek()).toBe(true);
    expect(logger.entries().map(entry => entry.message)).toContain('external player preference not stored');
  });

  it('a store that throws synchronously: read → off, write → logged, memory kept; nothing escapes', async () => {
    const store = createExternalPlayerPreferenceStore(() => {
      throw new Error('no native module');
    });
    await expect(store.read()).resolves.toBe(false);
    store.forget();
    expect(() => store.write(true)).not.toThrow();
    expect(store.peek()).toBe(true);
    expect(logger.entries().map(entry => entry.message)).toContain('external player preference not stored');
  });
});
