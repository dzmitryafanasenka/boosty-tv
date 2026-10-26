/**
 * Phase gating (AD-20, docs/focus-map.md §1.7): a capability → enabled map.
 * An entry point whose flag is off is not rendered, so it is never
 * focusable. Epic 2 enables only Главная and Настройки.
 */
export const phaseFlags = {
  home: true,
  search: false,
  subs: false,
  events: false,
  settings: true,
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
