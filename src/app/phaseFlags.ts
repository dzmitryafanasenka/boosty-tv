/**
 * Phase gating (AD-20, docs/focus-map.md §1.7): a capability → enabled map.
 * An entry point whose flag is off is not rendered, so it is never
 * focusable. Epic 2 enabled Главная and Настройки; Story 3.2 enables
 * Подписки.
 *
 * `player` is a capability, not a sidebar section (`enabledSections` lists
 * sections only): while it is off, a MediaRow shows no «Смотреть» /
 * «Продолжить» / «С начала» and OK on it does nothing (Story 3.5). Story
 * 4.1 turns it on: «Смотреть» and OK on a MediaRow open the Player.
 *
 * `myBlog` (Story 5.2) is an in-screen entry point, not a section: while it
 * is off, Подписки sends no profile E1 and shows no «Мой блог» tile.
 *
 * `filters` (Story 5.3) is the «Фильтры» chip on Главная: while it is off,
 * there is no chip and the feed uses the default Filter (and so does Поиск).
 *
 * `search` gates both search scopes: the Поиск sidebar section («Поиск по
 * подпискам», E6, Story 5.6) and Автор's «Поиск в блоге» field (E7, Story
 * 5.7). While it is off, neither is rendered.
 *
 * `live` (Story 7.1) is an in-screen capability, not a section: the
 * Author page's LiveCard (E15). While it is off, Автор sends no E15 and
 * shows no card. Owner decision 2026-10-30 (Q3 a): it ships on.
 *
 * `events` (Story 7.5) is the События sidebar section (E18). Owner decision
 * 2026-10-30 (Q1 a): on after the live probe found E18 in the documented
 * shape (first page only, no load-more). While it is off, there is no
 * sidebar item and no E18.
 */
export const phaseFlags = {
  home: true,
  search: true,
  subs: true,
  events: true,
  settings: true,
  player: true,
  myBlog: true,
  filters: true,
  live: true,
} as const satisfies Record<string, boolean>;

export type Capability = keyof typeof phaseFlags;

/** Sidebar sections in DESIGN.md order (Sidebar / NavItem). */
export const SECTION_ORDER = ['home', 'search', 'subs', 'events', 'settings'] as const;

export type SectionId = (typeof SECTION_ORDER)[number];

/** The sidebar sections whose flag is on, in sidebar order. */
export function enabledSections(
  flags: Readonly<Record<SectionId, boolean>> = phaseFlags,
): SectionId[] {
  return SECTION_ORDER.filter(section => flags[section]);
}
