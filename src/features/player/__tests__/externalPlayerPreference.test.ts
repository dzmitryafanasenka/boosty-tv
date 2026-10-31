// The store contract (read once, a pick wins, failures logged) is
// src/shared/storage/__tests__/devicePreference.test.tsx.
import { EXTERNAL_PLAYER_PREFERENCE_KEY, parseExternalPlayer, serializeExternalPlayer } from '../externalPlayerPreference';

describe('parse / serialize (Story 8.2)', () => {
  it('the key is `player.external.v1`; `on` / `off` round-trip', () => {
    expect(EXTERNAL_PLAYER_PREFERENCE_KEY).toBe('player.external.v1');
    expect(serializeExternalPlayer(true)).toBe('on');
    expect(serializeExternalPlayer(false)).toBe('off');
    expect(parseExternalPlayer('on')).toBe(true);
    expect(parseExternalPlayer('off')).toBe(false);
  });

  it.each([null, undefined, '', 'true', '1', 'ON', ' on'])('%p → null', raw => {
    expect(parseExternalPlayer(raw)).toBeNull();
  });
});
