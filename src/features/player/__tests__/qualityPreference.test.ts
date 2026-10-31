// The store contract (read once, a pick wins, remember, failures logged) is
// src/shared/storage/__tests__/devicePreference.test.tsx.
import { parseQualityPreference, serializeQualityPreference } from '../qualityPreference';

describe('parseQualityPreference (tolerant)', () => {
  it.each([
    ['auto', 'auto'],
    ['720', 720],
    ['2160', 2160],
    ['144', 144],
  ] as const)('%p → %p', (raw, expected) => {
    expect(parseQualityPreference(raw)).toBe(expected);
  });

  it.each([null, undefined, '', 'AUTO', '0', '-720', '720.5', '720p', '99999', '5000', 'https://example.invalid/x', ' 720', '{"q":720}'])(
    '%p → null',
    raw => {
      expect(parseQualityPreference(raw)).toBeNull();
    },
  );

  it('serializes auto or the height, never anything else', () => {
    expect(serializeQualityPreference('auto')).toBe('auto');
    expect(serializeQualityPreference(1080)).toBe('1080');
  });
});
