import { SECTION_ORDER, enabledSections, phaseFlags } from '../phaseFlags';

test('Story 3.2 enables Главная, Подписки and Настройки (Story 4.1: and the player)', () => {
  expect(phaseFlags).toEqual({
    home: true,
    search: false,
    subs: true,
    events: false,
    settings: true,
    player: true,
  });
  expect(enabledSections()).toEqual(['home', 'subs', 'settings']);
});

test('Story 4.1: the player capability is on and is not a sidebar section', () => {
  expect(phaseFlags.player).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('player');
});

test('enabled sections keep the DESIGN.md sidebar order', () => {
  expect(SECTION_ORDER).toEqual(['home', 'search', 'subs', 'events', 'settings']);
  expect(
    enabledSections({ home: true, search: true, subs: true, events: false, settings: true }),
  ).toEqual(['home', 'search', 'subs', 'settings']);
});
