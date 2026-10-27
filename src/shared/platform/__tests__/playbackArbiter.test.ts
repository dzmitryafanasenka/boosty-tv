import { createPlaybackArbiter } from '../playbackArbiter';

describe('PlaybackArbiter (AD-19)', () => {
  it('one slot: a new holder stops the previous one', () => {
    const arbiter = createPlaybackArbiter();
    const a = { stop: jest.fn() };
    const b = { stop: jest.fn() };
    arbiter.claim(a);
    expect(arbiter.current()).toBe(a);
    arbiter.claim(b);
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(b.stop).not.toHaveBeenCalled();
    expect(arbiter.current()).toBe(b);
  });

  it('release frees the slot; a late release of a holder that lost it does nothing', () => {
    const arbiter = createPlaybackArbiter();
    const a = { stop: jest.fn() };
    const b = { stop: jest.fn() };
    const releaseA = arbiter.claim(a);
    const releaseB = arbiter.claim(b);
    releaseA();
    expect(arbiter.current()).toBe(b);
    releaseB();
    expect(arbiter.current()).toBeNull();
  });

  it('claiming again with the same holder does not stop it', () => {
    const arbiter = createPlaybackArbiter();
    const a = { stop: jest.fn() };
    arbiter.claim(a);
    arbiter.claim(a);
    expect(a.stop).not.toHaveBeenCalled();
  });
});
