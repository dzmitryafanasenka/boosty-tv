import { SECTION_ORDER, enabledSections, phaseFlags } from '../phaseFlags';

test('Story 3.2 enables Главная, Подписки and Настройки (Story 4.1: the player; Story 5.2: «Мой блог»; Story 5.3: filters; Story 5.6: Поиск; Story 7.5: События)', () => {
  expect(phaseFlags).toEqual({
    home: true,
    search: true,
    subs: true,
    events: true,
    settings: true,
    player: true,
    myBlog: true,
    filters: true,
    live: true,
    speed: true,
  });
  expect(enabledSections()).toEqual(['home', 'search', 'subs', 'events', 'settings']);
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

test('Story 5.3: the feed filters are a capability, not a sidebar section', () => {
  expect(phaseFlags.filters).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('filters');
});

test('Story 7.1: the live card is a capability, not a sidebar section; it ships on (owner decision Q3 a)', () => {
  expect(phaseFlags.live).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('live');
});

test('Story 7.5: События is a sidebar section between Подписки and Настройки, on after the live probe (owner decision Q1 a)', () => {
  expect(phaseFlags.events).toBe(true);
  expect(enabledSections()).toContain('events');
  expect(
    enabledSections({ home: true, search: true, subs: true, events: false, settings: true }),
  ).not.toContain('events');
});

test('Story 8.1: the playback speed is a capability, not a sidebar section; it ships on', () => {
  expect(phaseFlags.speed).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('speed');
});
