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
 */
export const phaseFlags = {
  home: true,
  search: false,
  subs: true,
  events: false,
  settings: true,
  player: true,
  myBlog: true,
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
