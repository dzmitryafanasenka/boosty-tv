# ADR 0012: The Shell sidebar on stack screens and the Shell return handshake

- Status: proposed
- Date: 2026-10-27
- Relates to: `_bmad-output/implementation-artifacts/spec-3-3-author-page.md` (owner decision 2026-10-27, option A), `docs/focus-map.md` §3 and §4 D, [ADR 0007](0007-navigation-js-stack.md)

## Context

Автор (Story 3.3) and Post (Story 3.4) are `@react-navigation/stack` screens above the Shell (ADR 0007). The JS stack keeps the Shell mounted below, with its own sidebar. The owner chose (2026-10-27, option A) that these screens show the same sidebar as the Shell, with the origin section as the current item, instead of a sidebar-less page. OK on a sidebar item there must pop back to the Shell and open that section as OK on it in the Shell would; Back pops. The Shell must then restore focus explicitly (Android's post-pop fallback focus is never relied on, focus-map §1.6).

## Decision

- **One sidebar component:** `src/app/Sidebar.tsx` (`Sidebar`, `useSidebarNav`, `NAV_ID`, `sidebarLayout`) is used by the Shell and by `AuthorRoute`. Same enabled sections (`phaseFlags`), the same guide (traps ↑ ↓ ←, destination = the current item).
- **testIDs on stack screens:** items are `author/nav/<section>` (an `idPrefix`), because the Shell's `nav/<section>` items stay mounted below and ids must be unique.
- **Pop to a section (handshake):** a module-level `pendingShellSection` in `App.tsx` is set right before the pop, only while the stack screen is focused (a second OK during the pop is ignored), and only for a section other than the origin (OK on the origin is a plain pop). Back, «Назад» and the screen's unmount clear it. The Shell reads it once (`takePendingSection`) when it is the focused route again: it focuses that item, marks it as the last focus and opens the section with `focusContent` (as OK in the Shell).
- **Section return focus:** a Shell section can register its own restore (`SubscriptionsFocusInfo.setReturnFocus`). On a plain return with focus in content, the Shell calls it first (Подписки: the tile by `blogUrl` with the fallback chain at the same scroll), else the content zone's target.

## Consequences

- Story 3.4 Post reuses the component, the prefix pattern (`post/nav/<section>` or a shared prefix) and the handshake; nothing new in the Shell.
- The pending section is global mutable state with one writer per pop; the clearing rules above keep a stale value from opening a section on a later plain Back. A navigation param (`popTo('Shell', {open})`) was not used: the Shell would refocus its old content in its focus effect before a param effect could switch the section.
- Главная still returns through the content zone's target; routing it through `useFocusRestoration.restore()` is the open item from Story 3.1 (epic-3 context, before 3.4).
- tvOS (phase 4): not validated.
