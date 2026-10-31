/**
 * Epic 8 retro A3: the store contract once for every app device preference
 * (quality, speed, «Системный видеоплеер», «Запись логов»), their unchanged
 * keys, and the one demo setter. The factory itself is
 * `src/shared/storage/__tests__/devicePreference.test.tsx`.
 */
import {
  EXTERNAL_PLAYER_PREFERENCE_KEY,
  createExternalPlayerPreferenceStore,
  externalPlayerPreference,
} from '../src/features/player/externalPlayerPreference';
import { QUALITY_PREFERENCE_KEY, createQualityPreferenceStore, qualityPreference } from '../src/features/player/qualityPreference';
import { SPEED_PREFERENCE_KEY, createSpeedPreferenceStore, speedPreference } from '../src/features/player/speedPreference';
import type { KeyValueStore } from '../src/shared/platform/keyValueStore';
import { DIAGNOSTICS_CAPTURE_KEY, createDiagnosticsCapture, diagnosticsCapture } from '../src/shared/services/diagnosticsCapture';
import { logFileSink, type LogFileSink } from '../src/shared/services/logFileSink';
import { logger } from '../src/shared/services/logger';
import {
  resetDevicePreferenceKeyValueStore,
  setDevicePreferenceKeyValueStore,
  type DevicePreference,
} from '../src/shared/storage/devicePreference';

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

function stubSink() {
  return {
    enable: jest.fn(),
    disable: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  };
}

type Store = Omit<DevicePreference<unknown>, 'write'> & { write(value: unknown): void };

type Case = {
  name: string;
  key: string;
  create(kv: () => KeyValueStore): Store;
  fallback: unknown;
  /** A stored string and its value. */
  stored: [string, unknown];
  junk: string;
  /** Two picks and their stored strings. */
  picks: [[unknown, string], [unknown, string]];
  label: string;
};

const CASES: Case[] = [
  {
    name: 'quality',
    key: QUALITY_PREFERENCE_KEY,
    create: kv => createQualityPreferenceStore(kv) as Store,
    fallback: null,
    stored: ['720', 720],
    junk: 'junk',
    picks: [
      ['auto', 'auto'],
      [1080, '1080'],
    ],
    label: 'quality preference',
  },
  {
    name: 'speed',
    key: SPEED_PREFERENCE_KEY,
    create: kv => createSpeedPreferenceStore(kv) as Store,
    fallback: 1,
    stored: ['2', 2],
    junk: 'fast',
    picks: [
      [1.75, '1.75'],
      [3, '3'],
    ],
    label: 'speed preference',
  },
  {
    name: 'external player',
    key: EXTERNAL_PLAYER_PREFERENCE_KEY,
    create: kv => createExternalPlayerPreferenceStore(kv) as Store,
    fallback: false,
    stored: ['on', true],
    junk: 'yes',
    picks: [
      [true, 'on'],
      [false, 'off'],
    ],
    label: 'external player preference',
  },
  {
    name: 'diagnostics capture',
    key: DIAGNOSTICS_CAPTURE_KEY,
    create: kv => createDiagnosticsCapture(stubSink() as unknown as LogFileSink, { kv }) as Store,
    fallback: false,
    stored: ['on', true],
    junk: 'true',
    picks: [
      [true, 'on'],
      [false, 'off'],
    ],
    label: 'capture preference',
  },
];

const APP_STORES = [qualityPreference, speedPreference, externalPlayerPreference, diagnosticsCapture];

const messages = () => logger.entries().map(entry => entry.message);

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const store of APP_STORES) {
    store.forget();
  }
  resetDevicePreferenceKeyValueStore();
  logger.clear();
  jest.restoreAllMocks();
});

describe.each(CASES)('the $name preference', ({ key, create, fallback, stored, junk, picks, label }) => {
  it('first run (nothing stored): the fallback', async () => {
    const store = create(() => memoryKv());
    expect(store.peek()).toBeUndefined();
    await expect(store.read()).resolves.toBe(fallback);
    expect(store.peek()).toBe(fallback);
  });

  it('reads its device key once (single-flight), then serves memory', async () => {
    const kv = memoryKv({ [key]: stored[0] });
    const store = create(() => kv);
    await expect(Promise.all([store.read(), store.read()])).resolves.toEqual([stored[1], stored[1]]);
    await expect(store.read()).resolves.toBe(stored[1]);
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(kv.get).toHaveBeenCalledWith(key);
  });

  it('a junk value or a failed read → the fallback; the failure is only logged', async () => {
    await expect(create(() => memoryKv({ [key]: junk })).read()).resolves.toBe(fallback);
    const failing = memoryKv();
    (failing.get as jest.Mock).mockRejectedValueOnce(new Error('io'));
    await expect(create(() => failing).read()).resolves.toBe(fallback);
    expect(messages()).toEqual([`${label} not read`]);
    expect(logger.entries()[0].fields).toBeUndefined();
  });

  it('a write updates memory at once and stores the string; a pick during the read wins', async () => {
    const kv = memoryKv({ [key]: stored[0] });
    const store = create(() => kv);
    const reading = store.read();
    store.write(picks[0][0]);
    await expect(reading).resolves.toBe(picks[0][0]);
    expect(kv.values.get(key)).toBe(picks[0][1]);
    store.write(picks[1][0]);
    expect(store.peek()).toBe(picks[1][0]);
    await Promise.resolve();
    expect(kv.values.get(key)).toBe(picks[1][1]);
  });

  it('a failed write keeps the memory value, does not throw, and is only logged (no value)', async () => {
    const kv = memoryKv();
    (kv.set as jest.Mock).mockRejectedValueOnce(new Error('io'));
    const store = create(() => kv);
    store.write(picks[0][0]);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.peek()).toBe(picks[0][0]);
    expect(messages()).toEqual([`${label} not stored`]);
    expect(logger.entries()[0].fields).toBeUndefined();
  });

  it('forget drops memory only: the next read comes from the store', async () => {
    const kv = memoryKv();
    const store = create(() => kv);
    store.write(picks[1][0]);
    await Promise.resolve();
    store.forget();
    expect(store.peek()).toBeUndefined();
    await expect(store.read()).resolves.toBe(picks[1][0]);
  });

  it('a store that throws synchronously: read → the fallback, write → logged, memory kept; nothing escapes', async () => {
    const store = create(() => {
      throw new Error('no native module');
    });
    await expect(store.read()).resolves.toBe(fallback);
    store.forget();
    expect(() => store.write(picks[0][0])).not.toThrow();
    expect(store.peek()).toBe(picks[0][0]);
    expect(messages()).toEqual([`${label} not read`, `${label} not stored`]);
  });
});

it('the stored keys are unchanged (no migration)', () => {
  expect([QUALITY_PREFERENCE_KEY, SPEED_PREFERENCE_KEY, EXTERNAL_PLAYER_PREFERENCE_KEY, DIAGNOSTICS_CAPTURE_KEY]).toEqual([
    'player.quality.v1',
    'player.speed.v1',
    'player.external.v1',
    'diagnostics.capture.v1',
  ]);
});

it('only quality has remember, also at runtime', () => {
  expect(APP_STORES.map(store => 'remember' in store)).toEqual([true, false, false, false]);
});

describe('the capture applies each value to the sink', () => {
  it('first run (nothing stored): one disable (the file deleted), never enable', async () => {
    const sink = stubSink();
    const capture = createDiagnosticsCapture(sink as unknown as LogFileSink, { kv: () => memoryKv() });
    await capture.read();
    await capture.read();
    expect(sink.disable).toHaveBeenCalledTimes(1);
    expect(sink.enable).not.toHaveBeenCalled();
  });

  it('a pick during the read is applied once, the read result never', async () => {
    const sink = stubSink();
    const capture = createDiagnosticsCapture(sink as unknown as LogFileSink, {
      kv: () => memoryKv({ [DIAGNOSTICS_CAPTURE_KEY]: 'off' }),
    });
    const reading = capture.read();
    capture.write(true);
    await reading;
    expect(sink.enable).toHaveBeenCalledTimes(1);
    expect(sink.disable).not.toHaveBeenCalled();
  });
});

describe('setDevicePreferenceKeyValueStore (the demo)', () => {
  it('one setter moves every app device preference to the given store, for reads and writes', async () => {
    const enable = jest.spyOn(logFileSink, 'enable').mockImplementation(() => {});
    const disable = jest.spyOn(logFileSink, 'disable').mockResolvedValue();
    const kv = memoryKv({
      [QUALITY_PREFERENCE_KEY]: '360',
      [SPEED_PREFERENCE_KEY]: '0.5',
      [EXTERNAL_PLAYER_PREFERENCE_KEY]: 'on',
      [DIAGNOSTICS_CAPTURE_KEY]: 'on',
    });
    setDevicePreferenceKeyValueStore(kv);
    await expect(Promise.all(APP_STORES.map(store => store.read()))).resolves.toEqual([360, 0.5, true, true]);
    expect(kv.get).toHaveBeenCalledTimes(4);
    expect(enable).toHaveBeenCalledTimes(1);

    qualityPreference.write(480);
    speedPreference.write(1.25);
    externalPlayerPreference.write(false);
    diagnosticsCapture.write(false);
    await Promise.resolve();
    expect(disable).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(kv.values)).toEqual({
      [QUALITY_PREFERENCE_KEY]: '480',
      [SPEED_PREFERENCE_KEY]: '1.25',
      [EXTERNAL_PLAYER_PREFERENCE_KEY]: 'off',
      [DIAGNOSTICS_CAPTURE_KEY]: 'off',
    });
  });
});
