import { playerClockNow, playerOpenMark } from '../perfMark';

describe('playerOpenMark (Story 9.3)', () => {
  afterEach(() => {
    playerOpenMark.take();
  });

  it('is taken once: the second take is null', () => {
    playerOpenMark.mark('post', 1_000);
    expect(playerOpenMark.take()).toEqual({ origin: 'post', at: 1_000 });
    expect(playerOpenMark.take()).toBeNull();
  });

  it('is null when nothing was marked', () => {
    expect(playerOpenMark.take()).toBeNull();
  });

  it('a later press replaces an untaken mark', () => {
    playerOpenMark.mark('post', 1_000);
    playerOpenMark.mark('continue', 2_000);
    expect(playerOpenMark.take()).toEqual({ origin: 'continue', at: 2_000 });
  });

  it('defaults to the monotonic clock (`performance.now()`), not the wall clock', () => {
    const clock = (globalThis as unknown as { performance: { now(): number } }).performance;
    const now = jest.spyOn(clock, 'now').mockReturnValue(12_345.5);
    const wall = jest.spyOn(Date, 'now');
    try {
      playerOpenMark.mark('live');
      expect(playerClockNow()).toBe(12_345.5);
      expect(playerOpenMark.take()).toEqual({ origin: 'live', at: 12_345.5 });
      expect(wall).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
      wall.mockRestore();
    }
  });
});
