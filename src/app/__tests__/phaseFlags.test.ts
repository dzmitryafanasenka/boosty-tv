import { SECTION_ORDER, enabledSections, phaseFlags } from '../phaseFlags';

test('Story 3.2 enables Главная, Подписки and Настройки (Story 4.1: the player; Story 5.2: «Мой блог»)', () => {
  expect(phaseFlags).toEqual({
    home: true,
    search: false,
    subs: true,
    events: false,
    settings: true,
    player: true,
    myBlog: true,
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

test('Story 5.2: «Мой блог» is a capability, not a sidebar section', () => {
  expect(phaseFlags.myBlog).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('myBlog');
});
