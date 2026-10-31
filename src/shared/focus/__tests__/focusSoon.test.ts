import { focusSoon, focusSoonRun } from '../focusSoon';
import { requestHostFocus } from '../../ui/requestHostFocus';
import type { HostView } from '../../ui/FocusableSurface';
// eslint-disable-next-line boundaries/dependencies -- test-only helpers
import { frame, installFrameQueue, queuedFrames } from '../../../test/frames';

jest.mock('../../ui/requestHostFocus', () => ({ requestHostFocus: jest.fn() }));
const focusMock = requestHostFocus as jest.Mock;


const viewA = { name: 'a' } as unknown as HostView;
const viewB = { name: 'b' } as unknown as HostView;

beforeEach(() => {
  focusMock.mockClear();
  installFrameQueue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('focusSoon', () => {
  test('default: focuses now and once more two frames later, resolving the target at each run', () => {
    let view: HostView | null = viewA;
    focusSoon(() => view);
    expect(focusMock.mock.calls).toEqual([[viewA]]);
    view = viewB;
    frame();
    expect(focusMock).toHaveBeenCalledTimes(1);
    frame();
    expect(focusMock.mock.calls).toEqual([[viewA], [viewB]]);
    frame();
    expect(focusMock).toHaveBeenCalledTimes(2);
  });

  test('a null view is still sent (a native no-op), as the sites did before', () => {
    focusSoon(() => null);
    frame();
    frame();
    expect(focusMock.mock.calls).toEqual([[null], [null]]);
  });

  test('`frames` sets the delay of the deferred run', () => {
    focusSoon(() => viewA, { frames: 3 });
    frame();
    frame();
    expect(focusMock).toHaveBeenCalledTimes(1);
    frame();
    expect(focusMock).toHaveBeenCalledTimes(2);
  });

  test('`now: false`: nothing now, one run two frames later', () => {
    focusSoon(() => viewA, { now: false });
    expect(focusMock).not.toHaveBeenCalled();
    frame();
    expect(focusMock).not.toHaveBeenCalled();
    frame();
    expect(focusMock.mock.calls).toEqual([[viewA]]);
  });

  test('`focusSoonRun`: an action that moves focus itself sends no request of its own', () => {
    const move = jest.fn();
    focusSoonRun(move);
    frame();
    frame();
    expect(move).toHaveBeenCalledTimes(2);
    expect(focusMock).not.toHaveBeenCalled();
  });

  test('`now: false` with a guard: nothing now; the guard decides two frames later', () => {
    const blocked = jest.fn();
    focusSoonRun(blocked, { now: false, guard: () => false });
    const allowed = jest.fn();
    focusSoonRun(allowed, { now: false, guard: () => true });
    frame();
    frame();
    expect(blocked).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledTimes(1);
  });

  test('`frames: 1`: the deferred run comes one frame later', () => {
    focusSoon(() => viewA, { frames: 1 });
    frame();
    expect(focusMock).toHaveBeenCalledTimes(2);
  });

  test('`frames` ≤ 0 or NaN is clamped to one frame; a fraction is floored', () => {
    for (const frames of [0, -3, Number.NaN]) {
      focusMock.mockClear();
      focusSoon(() => viewA, { frames });
      expect(focusMock).toHaveBeenCalledTimes(1);
      frame();
      expect(focusMock).toHaveBeenCalledTimes(2);
    }
    focusMock.mockClear();
    focusSoon(() => viewA, { frames: 2.9 });
    frame();
    expect(focusMock).toHaveBeenCalledTimes(1);
    frame();
    expect(focusMock).toHaveBeenCalledTimes(2);
  });

  test('cancel with `now: false`: nothing runs', () => {
    const action = jest.fn();
    const cancel = focusSoonRun(action, { now: false });
    frame();
    cancel();
    frame();
    frame();
    expect(action).not.toHaveBeenCalled();
    expect(queuedFrames()).toBe(0);
  });

  test('a requestAnimationFrame that calls back synchronously does not throw', () => {
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: (t: number) => void) => {
      callback(0);
      return 0;
    });
    const action = jest.fn();
    expect(() => focusSoonRun(action)).not.toThrow();
    expect(action).toHaveBeenCalledTimes(2);
  });

  test('the guard blocks the deferred run only, and is read in that frame', () => {
    let allow = false;
    const guard = jest.fn(() => allow);
    focusSoon(() => viewA, { guard });
    expect(focusMock).toHaveBeenCalledTimes(1);
    expect(guard).not.toHaveBeenCalled();
    frame();
    allow = true;
    frame();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(focusMock).toHaveBeenCalledTimes(2);
  });

  test('a false guard skips the deferred run', () => {
    focusSoon(() => viewA, { guard: () => false });
    frame();
    frame();
    expect(focusMock).toHaveBeenCalledTimes(1);
  });

  test('the cancel stops the later frames (after the first frame too)', () => {
    const cancelEarly = focusSoon(() => viewA);
    cancelEarly();
    frame();
    frame();
    expect(focusMock).toHaveBeenCalledTimes(1);

    focusMock.mockClear();
    const cancelLate = focusSoon(() => viewB);
    frame();
    cancelLate();
    frame();
    expect(focusMock.mock.calls).toEqual([[viewB]]);
    expect(queuedFrames()).toBe(0);
  });
});
