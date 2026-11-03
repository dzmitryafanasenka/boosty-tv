/**
 * Story 14.2: the sleep timer hook (deadline on the wall clock, fire,
 * cancel, «До конца видео»). The player wiring is in
 * `__tests__/playerSleepFlow.test.tsx`.
 */
import { act, createRef, type RefObject } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { sleepChoiceLabel, sleepChoices, sleepClockNow, sleepLeftSec, useSleepTimer, type SleepTimer } from '../useSleepTimer';

const T0 = Date.UTC(2026, 10, 3, 21, 0, 0);
let root: Root | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});

afterEach(async () => {
  if (root) {
    const current = root;
    root = null;
    await act(async () => current.unmount());
  }
  jest.useRealTimers();
});

type Harness = {
  timer: () => SleepTimer;
  onFire: jest.Mock;
  onWarn: jest.Mock;
  canWarn: jest.Mock;
  holdAtEnd: RefObject<(() => boolean) | null>;
  rerender: (resetKey: string, paused?: boolean) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
};

async function mount(resetKey = 'blog/post/v1'): Promise<Harness> {
  let latest: SleepTimer | null = null;
  const onFire = jest.fn(() => true);
  const onWarn = jest.fn();
  const canWarn = jest.fn(() => true);
  const holdAtEnd = createRef<(() => boolean) | null>() as RefObject<(() => boolean) | null>;
  function Probe({ id, paused }: { id: string; paused: boolean }) {
    latest = useSleepTimer({ resetKey: id, paused, onFire, canWarn, onWarn, holdAtEnd });
    return null;
  }
  root = createRoot();
  const current = root;
  let state = { id: resetKey, paused: false };
  const draw = async () => {
    await act(async () => current.render(<Probe id={state.id} paused={state.paused} />));
  };
  await draw();
  return {
    timer: () => latest as unknown as SleepTimer,
    onFire,
    onWarn,
    canWarn,
    holdAtEnd,
    rerender: async (id, paused = state.paused) => {
      state = { id, paused };
      await draw();
    },
    setPaused: async paused => {
      state = { ...state, paused };
      await draw();
    },
  };
}

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

test('labels and choices: «Выкл», «15 мин»…«90 мин», «До конца видео» only when offered', () => {
  expect(sleepChoices(true)).toEqual(['off', 15, 30, 60, 90, 'end']);
  expect(sleepChoices(false)).toEqual(['off', 15, 30, 60, 90]);
  expect(sleepChoices(true).map(sleepChoiceLabel)).toEqual(['Выкл', '15 мин', '30 мин', '60 мин', '90 мин', 'До конца видео']);
});

test('sleepLeftSec rounds up and never goes negative', () => {
  expect(sleepLeftSec(30 * 60_000, 0)).toBe(1800);
  expect(sleepLeftSec(1_500, 0)).toBe(2);
  expect(sleepLeftSec(0, 5_000)).toBe(0);
});

test('starts «Выкл» with no indicator', async () => {
  const h = await mount();
  expect(h.timer().choice).toBe('off');
  expect(h.timer().indicator).toBeNull();
});

test('a fixed pick sets a wall-clock deadline; it fires once at the deadline and goes back to «Выкл»', async () => {
  const h = await mount();
  const pickedAt = sleepClockNow();
  await act(async () => h.timer().pick(30));
  expect(h.timer().choice).toBe(30);
  expect(h.timer().indicator).toEqual({ kind: 'deadline', deadlineAt: pickedAt + 30 * 60_000 });
  await advance(30 * 60_000 - 1_000);
  expect(h.onFire).not.toHaveBeenCalled();
  await advance(1_000);
  expect(h.onFire).toHaveBeenCalledTimes(1);
  expect(h.timer().choice).toBe('off');
  expect(h.timer().indicator).toBeNull();
  await advance(60 * 60_000);
  expect(h.onFire).toHaveBeenCalledTimes(1);
});

test('a device clock change (NTP, manual) neither fires it early nor delays it: elapsed time is monotonic', async () => {
  const h = await mount();
  await act(async () => h.timer().pick(15));
  // The clock jumps 2 h forward: no early fire.
  jest.setSystemTime(T0 + 2 * 60 * 60_000);
  await advance(1_000);
  expect(h.onFire).not.toHaveBeenCalled();
  // And back 2 h: it still fires after 15 real minutes.
  jest.setSystemTime(T0 - 2 * 60 * 60_000);
  await advance(15 * 60_000 - 1_000);
  expect(h.onFire).toHaveBeenCalledTimes(1);
  expect(h.timer().choice).toBe('off');
});

test('«Выкл» cancels a running timer; a new pick restarts the count from now', async () => {
  const h = await mount();
  await act(async () => h.timer().pick(15));
  await advance(10 * 60_000);
  await act(async () => h.timer().pick('off'));
  expect(h.timer().indicator).toBeNull();
  await advance(10 * 60_000);
  expect(h.onFire).not.toHaveBeenCalled();
  await act(async () => h.timer().pick(15));
  expect(h.timer().indicator).toEqual({ kind: 'deadline', deadlineAt: sleepClockNow() + 15 * 60_000 });
});

test('unmount cancels the timer', async () => {
  const h = await mount();
  await act(async () => h.timer().pick(15));
  const current = root as Root;
  root = null;
  await act(async () => current.unmount());
  expect(h.holdAtEnd.current).toBeNull();
  await advance(20 * 60_000);
  expect(h.onFire).not.toHaveBeenCalled();
});

test('another video (a new reset key) cancels the timer', async () => {
  const h = await mount('blog/post/v1');
  await act(async () => h.timer().pick(60));
  await h.rerender('blog/post/v2');
  expect(h.timer().choice).toBe('off');
  await advance(61 * 60_000);
  expect(h.onFire).not.toHaveBeenCalled();
});

test('«До конца видео»: no deadline, never fires; `holdAtEnd` is true once, then «Выкл»', async () => {
  const h = await mount();
  expect(h.holdAtEnd.current?.()).toBe(false);
  await act(async () => h.timer().pick('end'));
  expect(h.timer().indicator).toEqual({ kind: 'end' });
  await advance(3 * 60 * 60_000);
  expect(h.onFire).not.toHaveBeenCalled();
  let held = false;
  await act(async () => {
    held = h.holdAtEnd.current?.() ?? false;
  });
  expect(held).toBe(true);
  expect(h.timer().choice).toBe('off');
  expect(h.holdAtEnd.current?.()).toBe(false);
});

test('a fixed timer is not held at the end', async () => {
  const h = await mount();
  await act(async () => h.timer().pick(90));
  expect(h.holdAtEnd.current?.()).toBe(false);
  expect(h.timer().choice).toBe(90);
});

describe('the last-minute warning (owner decision 2026-11-03, after review)', () => {
  test('starts at T−60 s (not before), once; `onWarn` runs; without «Ещё 15 мин» it fires at T', async () => {
    const h = await mount();
    await act(async () => h.timer().pick(15));
    await advance(14 * 60_000 - 1_000);
    expect(h.timer().warning).toBe(false);
    expect(h.onWarn).not.toHaveBeenCalled();
    await advance(1_000);
    expect(h.timer().warning).toBe(true);
    expect(h.onWarn).toHaveBeenCalledTimes(1);
    await advance(59_000);
    expect(h.onWarn).toHaveBeenCalledTimes(1);
    expect(h.onFire).not.toHaveBeenCalled();
    await advance(1_000);
    expect(h.onFire).toHaveBeenCalledTimes(1);
    expect(h.timer().warning).toBe(false);
    expect(h.timer().pausedByTimer).toBe(true);
  });

  test('«Ещё 15 мин»: the deadline moves 15 min, the warning ends; a new warning 1 min before the new deadline', async () => {
    const h = await mount();
    const pickedAt = sleepClockNow();
    await act(async () => h.timer().pick(15));
    await advance(14 * 60_000 + 30_000);
    expect(h.timer().warning).toBe(true);
    await act(async () => h.timer().extend());
    expect(h.timer().warning).toBe(false);
    expect(h.timer().indicator).toEqual({ kind: 'deadline', deadlineAt: pickedAt + 30 * 60_000 });
    expect(h.timer().choice).toBe(15);
    await advance(14 * 60_000 + 29_000);
    expect(h.onWarn).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(h.onWarn).toHaveBeenCalledTimes(2);
    expect(h.onFire).not.toHaveBeenCalled();
    await advance(60_000);
    expect(h.onFire).toHaveBeenCalledTimes(1);
  });

  test('`canWarn` false at T−60 s (paused, the sheet or the strip open): re-checked each second; it starts once `canWarn` holds', async () => {
    const h = await mount();
    h.canWarn.mockReturnValue(false);
    await act(async () => h.timer().pick(15));
    await advance(14 * 60_000);
    expect(h.timer().warning).toBe(false);
    await advance(20_000);
    expect(h.onWarn).not.toHaveBeenCalled();
    h.canWarn.mockReturnValue(true);
    await advance(1_000);
    expect(h.timer().warning).toBe(true);
    expect(h.onWarn).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(h.onWarn).toHaveBeenCalledTimes(1);
    await advance(29_000);
    expect(h.onFire).toHaveBeenCalledTimes(1);
  });

  test('`canWarn` only in the last 10 s: no warning; it still fires', async () => {
    const h = await mount();
    h.canWarn.mockReturnValue(false);
    await act(async () => h.timer().pick(15));
    await advance(14 * 60_000 + 50_000);
    h.canWarn.mockReturnValue(true);
    await advance(9_000);
    expect(h.onWarn).not.toHaveBeenCalled();
    expect(h.timer().warning).toBe(false);
    await advance(1_000);
    expect(h.onFire).toHaveBeenCalledTimes(1);
  });

  test('a manual pause ends the warning; the timer keeps running', async () => {
    const h = await mount();
    await act(async () => h.timer().pick(15));
    await advance(14 * 60_000);
    expect(h.timer().warning).toBe(true);
    await h.setPaused(true);
    expect(h.timer().warning).toBe(false);
    expect(h.timer().choice).toBe(15);
    await advance(60_000);
    expect(h.onFire).toHaveBeenCalledTimes(1);
  });

  test('«До конца видео» has no warning', async () => {
    const h = await mount();
    await act(async () => h.timer().pick('end'));
    await advance(3 * 60 * 60_000);
    expect(h.onWarn).not.toHaveBeenCalled();
    expect(h.timer().warning).toBe(false);
  });

  test('`pausedByTimer`: set by a fire that paused (not by one that did nothing) and by the end hold; cleared when playing again', async () => {
    const h = await mount();
    h.onFire.mockReturnValueOnce(false);
    await act(async () => h.timer().pick(15));
    await advance(15 * 60_000);
    expect(h.timer().pausedByTimer).toBe(false);
    await act(async () => h.timer().pick(15));
    await advance(15 * 60_000);
    expect(h.timer().pausedByTimer).toBe(true);
    await h.setPaused(true);
    expect(h.timer().pausedByTimer).toBe(true);
    await h.setPaused(false);
    expect(h.timer().pausedByTimer).toBe(false);
    await act(async () => h.timer().pick('end'));
    await act(async () => {
      h.holdAtEnd.current?.();
    });
    await h.setPaused(true);
    expect(h.timer().pausedByTimer).toBe(true);
    await h.setPaused(false);
    expect(h.timer().pausedByTimer).toBe(false);
  });
});
