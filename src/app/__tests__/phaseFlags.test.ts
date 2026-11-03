import { SECTION_ORDER, enabledSections, phaseFlags } from '../phaseFlags';

test('Story 3.2 enables Главная, Подписки and Настройки (Story 4.1: the player; Story 5.2: «Мой блог»; Story 5.3: filters; Story 5.6: Поиск; Story 12.3: События removed)', () => {
  expect(phaseFlags).toEqual({
    home: true,
    search: true,
    subs: true,
    settings: true,
    player: true,
    myBlog: true,
    filters: true,
    live: true,
    livePlaque: true,
    speed: true,
    externalPlayer: true,
    diagnostics: true,
    updateCheck: true,
  });
  expect(enabledSections()).toEqual(['home', 'search', 'subs', 'settings']);
});

test('Story 4.1: the player capability is on and is not a sidebar section', () => {
  expect(phaseFlags.player).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('player');
});

test('enabled sections keep the DESIGN.md sidebar order', () => {
  expect(SECTION_ORDER).toEqual(['home', 'search', 'subs', 'settings']);
  expect(
    enabledSections({ home: true, search: false, subs: true, settings: true }),
  ).toEqual(['home', 'subs', 'settings']);
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

test('Story 12.3: События is removed (owner decision 2026-11-02): no section, no flag', () => {
  expect(Object.keys(phaseFlags)).not.toContain('events');
  expect(SECTION_ORDER as readonly string[]).not.toContain('events');
});

test('Story 12.3: the «в эфире» plaque is a capability, not a sidebar section; it ships on', () => {
  expect(phaseFlags.livePlaque).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('livePlaque');
});

test('Story 8.1: the playback speed is a capability, not a sidebar section; it ships on', () => {
  expect(phaseFlags.speed).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('speed');
});

test('Story 8.2: the system video player is a capability, not a sidebar section; it ships on', () => {
  expect(phaseFlags.externalPlayer).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('externalPlayer');
});

test('Story 8.3: the hidden diagnostics are a capability, not a sidebar section; they ship on', () => {
  expect(phaseFlags.diagnostics).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('diagnostics');
});

test('Story 9.2: the update check is a capability, not a sidebar section', () => {
  expect(phaseFlags.updateCheck).toBe(true);
  expect(SECTION_ORDER as readonly string[]).not.toContain('updateCheck');
});
