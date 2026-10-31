/**
 * Epic 8 retro A3: the device-preference contract, once for every
 * definition (quality, speed, «Системный видеоплеер», «Запись логов»). The
 * store-specific parse / label cases stay next to each store.
 */
import { act } from 'react';
import { createRoot } from 'test-renderer';
/* eslint-disable boundaries/dependencies -- test-only: the contract runs over the player's definitions too */
import {
  EXTERNAL_PLAYER_PREFERENCE_KEY,
  createExternalPlayerPreferenceStore,
  externalPlayerPreference,
} from '../../../features/player/externalPlayerPreference';
import { QUALITY_PREFERENCE_KEY, createQualityPreferenceStore, qualityPreference } from '../../../features/player/qualityPreference';
import { SPEED_PREFERENCE_KEY, createSpeedPreferenceStore, speedPreference } from '../../../features/player/speedPreference';
/* eslint-enable boundaries/dependencies */
import type { KeyValueStore } from '../../platform/keyValueStore';
import { DIAGNOSTICS_CAPTURE_KEY, createDiagnosticsCapture, diagnosticsCapture } from '../../services/diagnosticsCapture';
import type { LogFileSink } from '../../services/logFileSink';
import { logger } from '../../services/logger';
import { setDevicePreferenceKeyValueStore, usePreference, type DevicePreference } from '../devicePreference';

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

/** The capture's sink, only counted here (its effects are covered in logFileSink.test.ts). */
const stubSink = {
  enable: jest.fn(),
  disable: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
} as unknown as LogFileSink;

type Store = Pick<DevicePreference<unknown, unknown>, 'peek' | 'read' | 'forget'> & { write(value: unknown): void };

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
    create: kv => createDiagnosticsCapture(kv, stubSink) as Store,
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

const messages = () => logger.entries().map(entry => entry.message);

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
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

  it('reads the device key once (single-flight), then serves memory', async () => {
    const kv = memoryKv({ [key]: stored[0] });
    const store = create(() => kv);
    const [a, b] = await Promise.all([store.read(), store.read()]);
    expect([a, b]).toEqual([stored[1], stored[1]]);
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
    expect(logger.entries()[0].level).toBe('warn');
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
    expect(kv.values.get(key)).toBe(picks[1][1]);
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

describe('remember (quality only)', () => {
  it('memory only, nothing stored', async () => {
    const kv = memoryKv();
    const store = createQualityPreferenceStore(() => kv);
    store.remember(1440);
    expect(store.peek()).toBe(1440);
    await Promise.resolve();
    expect(kv.set).not.toHaveBeenCalled();
  });
});

describe('setDevicePreferenceKeyValueStore (the demo)', () => {
  it('one setter moves every app device preference to the given store', async () => {
    const kv = memoryKv();
    setDevicePreferenceKeyValueStore(kv);
    qualityPreference.write(480);
    speedPreference.write(1.25);
    externalPlayerPreference.write(true);
    diagnosticsCapture.write(false);
    await Promise.resolve();
    expect(Object.fromEntries(kv.values)).toEqual({
      [QUALITY_PREFERENCE_KEY]: '480',
      [SPEED_PREFERENCE_KEY]: '1.25',
      [EXTERNAL_PLAYER_PREFERENCE_KEY]: 'on',
      [DIAGNOSTICS_CAPTURE_KEY]: 'off',
    });
    for (const store of [qualityPreference, speedPreference, externalPlayerPreference, diagnosticsCapture]) {
      store.forget();
    }
  });
});

describe('usePreference', () => {
  type Seen = { value: unknown; write: (next: boolean) => void };

  async function mount(store: Parameters<typeof usePreference<boolean, boolean>>[0], enabled: boolean) {
    const seen: Seen[] = [];
    function Probe() {
      seen.push(usePreference(store, enabled));
      return null;
    }
    const root = createRoot();
    await act(async () => root.render(<Probe />));
    return { seen, root };
  }

  it('undefined, then the read value; write stores it and updates at once', async () => {
    const kv = memoryKv({ [EXTERNAL_PLAYER_PREFERENCE_KEY]: 'on' });
    const store = createExternalPlayerPreferenceStore(() => kv);
    const { seen, root } = await mount(store, true);
    expect(seen[0].value).toBeUndefined();
    expect(seen[seen.length - 1].value).toBe(true);
    await act(async () => seen[seen.length - 1].write(false));
    expect(seen[seen.length - 1].value).toBe(false);
    expect(kv.values.get(EXTERNAL_PLAYER_PREFERENCE_KEY)).toBe('off');
    await act(async () => root.unmount());
  });

  it('a value already in memory: no read; disabled: never read', async () => {
    const kv = memoryKv();
    const warm = createExternalPlayerPreferenceStore(() => kv);
    warm.write(true);
    (kv.get as jest.Mock).mockClear();
    const first = await mount(warm, true);
    expect(first.seen[0].value).toBe(true);
    const cold = createExternalPlayerPreferenceStore(() => kv);
    const second = await mount(cold, false);
    expect(second.seen[second.seen.length - 1].value).toBeUndefined();
    expect(kv.get).not.toHaveBeenCalled();
    await act(async () => {
      first.root.unmount();
      second.root.unmount();
    });
  });

  it('a rejected read shows the fallback', async () => {
    const store = {
      fallback: false,
      peek: () => undefined,
      read: () => Promise.reject(new Error('apply failed')),
      write: () => {},
    };
    const { seen, root } = await mount(store, true);
    expect(seen[seen.length - 1].value).toBe(false);
    await act(async () => root.unmount());
  });
});
