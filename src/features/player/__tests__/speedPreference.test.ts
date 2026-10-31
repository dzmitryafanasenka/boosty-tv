// The store contract (read once, a pick wins, failures logged) is
// src/shared/storage/__tests__/devicePreference.test.tsx.
import { PLAYBACK_SPEEDS, parseSpeed, serializeSpeed, speedLabel } from '../speedPreference';

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
