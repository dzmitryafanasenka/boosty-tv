import {
  HELD_TARGET_IDLE_MS,
  SEEK_COMMIT_MS,
  SEEK_IN_FLIGHT_TIMEOUT_MS,
  createSeekController,
} from '../seekController';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup() {
  const onCommit = jest.fn();
  const onChange = jest.fn();
  const seek = createSeekController({ onCommit, onChange });
  return { seek, onCommit, onChange };
}

describe('seekController (Story 4.1)', () => {
  it('the commit delay is the DESIGN.md seek-commit token (600 ms)', () => {
    expect(SEEK_COMMIT_MS).toBe(600);
  });

  it('one press: +5 s pending (the bubble), one commit 600 ms later', () => {
    const { seek, onCommit } = setup();
    expect(seek.press(1, 100, 1000)).toBe(105);
    expect(seek.target()).toBe(105);
    expect(seek.isSeeking()).toBe(true);
    jest.advanceTimersByTime(SEEK_COMMIT_MS - 1);
    expect(onCommit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledWith(105);
    // In flight until the engine reports it done.
    expect(seek.target()).toBe(105);
    seek.seekDone(105);
    expect(seek.isSeeking()).toBe(false);
    expect(seek.target()).toBeNull();
  });

  it('matrix «Seek»: → ×3 quickly → the accelerated steps (+5, +10, +20), one commit 600 ms after the last', () => {
    const { seek, onCommit } = setup();
    const targets = [seek.press(1, 100, 1000)];
    jest.advanceTimersByTime(300);
    targets.push(seek.press(1, 100, 1000));
    jest.advanceTimersByTime(300);
    targets.push(seek.press(1, 100, 1000));
    expect(targets).toEqual([105, 110, 120]);
    jest.advanceTimersByTime(SEEK_COMMIT_MS - 1);
    expect(onCommit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(120);
  });

  it('the step grows 5, 5, 10, 10, 20, 30, then stays at 30', () => {
    const { seek } = setup();
    const targets: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      targets.push(seek.press(1, 0, 10_000));
      jest.advanceTimersByTime(100);
    }
    expect(targets).toEqual([5, 10, 20, 30, 50, 80, 110, 140]);
  });

  it('presses during an in-flight seek build on its target, not on the stale position', () => {
    const { seek, onCommit } = setup();
    seek.press(1, 100, 1000);
    jest.advanceTimersByTime(SEEK_COMMIT_MS);
    expect(onCommit).toHaveBeenLastCalledWith(105);
    // The engine still reports 100 (the seek is running): the next press starts at 105.
    expect(seek.press(1, 100, 1000)).toBe(110);
    jest.advanceTimersByTime(SEEK_COMMIT_MS);
    expect(onCommit).toHaveBeenLastCalledWith(110);
  });

  it('a press after the bubble window starts over at 5 s; a direction change too', () => {
    const { seek } = setup();
    seek.press(1, 100, 1000);
    seek.press(1, 100, 1000); // +5 +5 → 110
    jest.advanceTimersByTime(SEEK_COMMIT_MS);
    seek.seekDone(110);
    expect(seek.press(1, 110, 1000)).toBe(115);
    expect(seek.press(-1, 110, 1000)).toBe(110);
    expect(seek.press(-1, 110, 1000)).toBe(105);
  });

  it('clamps to [0, duration − 1]; an unknown duration has no upper bound', () => {
    const { seek } = setup();
    expect(seek.press(-1, 3, 1000)).toBe(0);
    seek.reset();
    expect(seek.press(1, 997, 1000)).toBe(999);
    seek.reset();
    expect(seek.press(1, 997, null)).toBe(1002);
  });

  it('an in-flight seek that never reports done stops counting after the timeout', () => {
    const { seek } = setup();
    seek.press(1, 100, 1000);
    jest.advanceTimersByTime(SEEK_COMMIT_MS);
    expect(seek.isSeeking()).toBe(true);
    jest.advanceTimersByTime(SEEK_IN_FLIGHT_TIMEOUT_MS);
    expect(seek.isSeeking()).toBe(false);
  });

  it('reset drops a pending target without committing it', () => {
    const { seek, onCommit } = setup();
    seek.press(1, 100, 1000);
    seek.reset();
    jest.advanceTimersByTime(SEEK_COMMIT_MS * 2);
    expect(onCommit).not.toHaveBeenCalled();
    expect(seek.isSeeking()).toBe(false);
  });

  it('commitNow: a pending target is committed at once (once); nothing pending → false', () => {
    const { seek, onCommit } = setup();
    expect(seek.commitNow()).toBe(false);
    seek.press(1, 100, 1000);
    seek.press(1, 100, 1000);
    expect(seek.commitNow()).toBe(true);
    expect(onCommit).toHaveBeenCalledWith(110);
    jest.advanceTimersByTime(SEEK_COMMIT_MS * 2);
    expect(onCommit).toHaveBeenCalledTimes(1);
    // In flight now, not pending: OK would toggle again.
    expect(seek.commitNow()).toBe(false);
  });

  it('a late report of an earlier seek does not clear a newer in-flight target (±1 s match only)', () => {
    const { seek, onCommit } = setup();
    seek.press(1, 100, 1000);
    jest.advanceTimersByTime(SEEK_COMMIT_MS); // 105 in flight
    seek.seekDone(105);
    seek.press(1, 105, 1000);
    jest.advanceTimersByTime(SEEK_COMMIT_MS); // 110 in flight
    expect(onCommit).toHaveBeenLastCalledWith(110);
    seek.seekDone(105); // late, the earlier seek
    expect(seek.isSeeking()).toBe(true);
    expect(seek.target()).toBe(110);
    seek.seekDone(111); // within 1 s of 110
    expect(seek.isSeeking()).toBe(false);
  });

  it('a held target is never committed by a timer: OK commits it, cancel or 5 s idle drops it, a press restarts the 5 s', () => {
    const { seek, onCommit } = setup();
    seek.press(1, 100, 1000);
    seek.markHeld();
    expect(seek.isHeld()).toBe(true);
    jest.advanceTimersByTime(HELD_TARGET_IDLE_MS - 1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(seek.press(-1, 100, 1000)).toBe(100);
    jest.advanceTimersByTime(HELD_TARGET_IDLE_MS - 1);
    expect(seek.target()).toBe(100);
    jest.advanceTimersByTime(1);
    expect(seek.target()).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
    seek.press(1, 100, 1000);
    seek.markHeld();
    seek.cancel();
    expect(seek.isSeeking()).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
    seek.press(1, 100, 1000);
    seek.markHeld();
    expect(seek.commitNow()).toBe(true);
    expect(onCommit).toHaveBeenCalledWith(105);
    expect(seek.isHeld()).toBe(false);
  });

  it('onHeldStart / onHeldEnd: start on markHeld; end committed (commitNow) or cancelled (cancel, idle); not on quick presses or reset', () => {
    const onCommit = jest.fn();
    const onHeldStart = jest.fn();
    const onHeldEnd = jest.fn();
    const seek = createSeekController({ onCommit, onChange: () => {}, onHeldStart, onHeldEnd });
    seek.press(1, 100, 1000);
    jest.advanceTimersByTime(SEEK_COMMIT_MS);
    expect(onHeldStart).not.toHaveBeenCalled();
    expect(onHeldEnd).not.toHaveBeenCalled();
    seek.press(1, 100, 1000);
    seek.markHeld();
    seek.markHeld();
    expect(onHeldStart).toHaveBeenCalledTimes(1);
    seek.commitNow();
    expect(onHeldEnd).toHaveBeenLastCalledWith(true);
    seek.press(1, 100, 1000);
    seek.markHeld();
    seek.cancel();
    expect(onHeldEnd).toHaveBeenLastCalledWith(false);
    seek.press(1, 100, 1000);
    seek.markHeld();
    jest.advanceTimersByTime(HELD_TARGET_IDLE_MS);
    expect(onHeldEnd).toHaveBeenCalledTimes(3);
    seek.press(1, 100, 1000);
    seek.markHeld();
    seek.reset();
    expect(onHeldEnd).toHaveBeenCalledTimes(3);
  });
});
