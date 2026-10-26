import { SECTION_ORDER, enabledSections, phaseFlags } from '../phaseFlags';

test('Epic 2 enables only Главная and Настройки', () => {
  expect(phaseFlags).toEqual({
    home: true,
    search: false,
    subs: false,
    events: false,
    settings: true,
  });
  expect(enabledSections()).toEqual(['home', 'settings']);
});

test('enabled sections keep the DESIGN.md sidebar order', () => {
  expect(SECTION_ORDER).toEqual(['home', 'search', 'subs', 'events', 'settings']);
  expect(
    enabledSections({ home: true, search: true, subs: true, events: false, settings: true }),
  ).toEqual(['home', 'search', 'subs', 'settings']);
});
