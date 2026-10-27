# ADR 0012: The Shell sidebar on stack screens and the Shell return handshake

- Status: proposed
- Date: 2026-10-27
- Relates to: `_bmad-output/implementation-artifacts/spec-3-3-author-page.md` (owner decision 2026-10-27, option A), `docs/focus-map.md` §3 and §4 D, [ADR 0007](0007-navigation-js-stack.md)

## Context

Автор (Story 3.3) and Post (Story 3.4) are `@react-navigation/stack` screens above the Shell (ADR 0007). The JS stack keeps the Shell mounted below, with its own sidebar. The owner chose (2026-10-27, option A) that these screens show the same sidebar as the Shell, with the origin section as the current item, instead of a sidebar-less page. OK on a sidebar item there must pop back to the Shell and open that section as OK on it in the Shell would; Back pops. The Shell must then restore focus explicitly (Android's post-pop fallback focus is never relied on, focus-map §1.6).

## Decision

- **One sidebar component:** `src/app/Sidebar.tsx` (`Sidebar`, `useSidebarNav`, `NAV_ID`, `sidebarLayout`) is used by the Shell and by the stack routes (`StackSidebarRoute` in `src/app/stackRoutes.tsx`). Same enabled sections (`phaseFlags`), the same guide (traps ↑ ↓ ←, destination = the current item).
- **testIDs on stack screens:** items are `author/nav/<section>` (an `idPrefix`), because the Shell's `nav/<section>` items stay mounted below and ids must be unique.
- **Pop to a section (handshake):** a module-level `pendingShellSection` in `src/app/stackRoutes.tsx` is set right before the pop, only while the stack screen is focused (a second OK during the pop is ignored), and only for a section other than the origin (OK on the origin is a plain pop). Back, «Назад» and the screen's unmount clear it. The Shell reads it once (`takePendingSection`, wired to `takePendingShellSection` by `ShellRoute` in `App.tsx`) when it is the focused route again: it focuses that item, marks it as the last focus and opens the section with `focusContent` (as OK in the Shell).
- **Section return focus:** a Shell section can register its own restore (`SubscriptionsFocusInfo.setReturnFocus`). On a plain return with focus in content, the Shell calls it first (Подписки: the tile by `blogUrl` with the fallback chain at the same scroll), else the content zone's target.

## Consequences

- Story 3.4 Post reuses the component, the prefix pattern and the handshake (implemented 2026-10-27: `PostRoute` and `AuthorRoute` share `useStackSidebar`; items `post/nav/<section>`; current item = the `section` route param, the origin Shell section). Amendments from 3.4:
  - A sidebar OK pops with `popTo('Shell')`, not `goBack()`: Пост can sit above Автор (and Автор above Пост, from the author row), and the Shell must be reached in one step. OK on the origin item is still a return without a pending section.
  - `pendingShellSection` records its owner route; only that route's unmount clears it. `popTo` through an Автор below unmounts that Автор at once, before the Shell reads the value.
  - Автор takes an optional `section` param (default Подписки), so an Автор opened from a feed post shows Главная as its current item.
  - Главная registers its own return restore with the Shell (the card by id through `useFocusRestoration.restore()`, card-only memory), which closes the Story 3.1 open item below.
- The pending section is global mutable state with one writer per pop; the clearing rules above keep a stale value from opening a section on a later plain Back. A navigation param (`popTo('Shell', {open})`) was not used: the Shell would refocus its old content in its focus effect before a param effect could switch the section.
- Главная returned through the content zone's target until Story 3.4, which routes it through `useFocusRestoration.restore()` (see above).
- Where it lives (Epic 3 retro A7, 2026-10-27): `src/app/stackRoutes.tsx` holds the handshake (`pendingShellSection`, `takePendingShellSection`), `useStackSidebar` and one wrapper, `StackSidebarRoute`, for the stack routes that keep the Shell sidebar (`name`: `'author' | 'post'`): the shared screen wrapper → `Sidebar` with the `<name>/` prefix → content `FocusZone` under the route key + `main`, Back, sidebar OK, FocusRestoration forget on unmount. `AuthorRoute` and `PostRoute` are thin users of it. A route may override Back with `onBackPress` (called first; true = handled, e.g. a layer of its own to close first); without it, or when it returns false, Back pops one route. A later stack route that keeps the sidebar adds its name to the union and uses the same wrapper; a route without the sidebar (e.g. a full-screen player) does not use it. `App.tsx` keeps the navigator, boot, resume orchestration, the auth routes and `ShellRoute`. A Shell section registers its return restore through one Shell callback (`setReturnFocus` in `src/app/Shell.tsx`, shared by Главная and Подписки). Пост keeps its own column focus memory instead of `useFocusRestoration` (a deliberate AD-12 deviation, reason in `docs/focus-map.md` §1.6); its route-level return goes through the content zone's FocusRestoration as above.
- tvOS (phase 4): not validated.
