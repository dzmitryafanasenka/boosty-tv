import { ADAPTIVE_MAX_HEIGHT, adaptiveBitrateCap, wholeSeconds } from '../playerEngine';

describe('PlayerEngine port helpers (Story 4.1)', () => {
  it('integer seconds across the port', () => {
    expect(wholeSeconds(12.9)).toBe(12);
    expect(wholeSeconds(0.4)).toBe(0);
    expect(wholeSeconds(-3)).toBe(0);
    expect(wholeSeconds(Number.NaN)).toBe(0);
    expect(wholeSeconds(null)).toBe(0);
  });

  it('the adaptive cap: the highest declared bitrate at or below 1080p when a taller variant exists', () => {
    expect(ADAPTIVE_MAX_HEIGHT).toBe(1080);
    const tracks = [
      { height: 360, bitrate: 800_000 },
      { height: 720, bitrate: 2_500_000 },
      { height: 1080, bitrate: 4_500_000 },
      { height: 1440, bitrate: 8_000_000 },
    ];
    expect(adaptiveBitrateCap(tracks)).toBe(4_500_000);
  });

  it('no cap (0) when nothing is above 1080p, or the tracks give no height or bitrate', () => {
    expect(adaptiveBitrateCap([{ height: 720, bitrate: 2_000_000 }, { height: 1080, bitrate: 4_000_000 }])).toBe(0);
    expect(adaptiveBitrateCap([])).toBe(0);
    expect(adaptiveBitrateCap(undefined)).toBe(0);
    expect(adaptiveBitrateCap([{ height: 1440 }, { bitrate: 5 }])).toBe(0);
    // Only variants above the cap: no cap (playing something beats nothing).
    expect(adaptiveBitrateCap([{ height: 1440, bitrate: 8_000_000 }])).toBe(0);
  });
});
