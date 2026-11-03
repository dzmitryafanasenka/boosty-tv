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
 * Story 12.3 removed the События section and its `events` flag (owner
 * decision 2026-11-02). `livePlaque` (Story 12.3, IMP-03) is Главная's «в
 * эфире» plaque that replaces it: a bounded E2 + E15 pass (at most 10 E15,
 * sequential, 5 min TTL). It also needs `live` and `player`; while any of
 * them is off, there is no plaque and no pass. It ships on.
 *
 * `speed` (Story 8.1) is the player settings sheet's «Скорость» row for
 * recordings. While it is off, there is no row and every video plays at 1×
 * (the stored speed is not applied).
 *
 * `externalPlayer` (Story 8.2, PLAY-13) is Настройки' «Системный
 * видеоплеер» toggle and the hand-off it drives. While it is off, there is
 * no row and every recording plays in the built-in player (the stored
 * toggle is neither read nor applied). Live always uses the built-in player.
 *
 * `diagnostics` (Story 8.3, SET-05) is the hidden Diagnostics route, opened
 * by seven OK presses on Настройки' «Версия». It ships in release; only the
 * gesture reveals it. While it is off, «Версия» does nothing on any number
 * of presses, and the stored «Запись логов» toggle is neither read nor
 * applied (nothing is written to the log file).
 *
 * `updateCheck` (Story 9.2, FR-56) is the update check of GitHub Releases
 * (on start and return to the foreground at most once a day, and on a
 * single OK on «Версия» at most once per 60 s), the passive plaque, the
 * «Версия» hint and the update dialog with the in-app install. While it is
 * off, no request is sent, nothing is shown and «Версия» keeps only the
 * Diagnostics gesture. Always off in the demo.
 */
export const phaseFlags = {
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
} as const satisfies Record<string, boolean>;

export type Capability = keyof typeof phaseFlags;

/** Sidebar sections in DESIGN.md order (Sidebar / NavItem). */
export const SECTION_ORDER = ['home', 'search', 'subs', 'settings'] as const;

export type SectionId = (typeof SECTION_ORDER)[number];

/** The sidebar sections whose flag is on, in sidebar order. */
export function enabledSections(
  flags: Readonly<Record<SectionId, boolean>> = phaseFlags,
): SectionId[] {
  return SECTION_ORDER.filter(section => flags[section]);
}
