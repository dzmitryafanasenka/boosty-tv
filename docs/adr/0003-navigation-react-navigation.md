# ADR 0003: Navigation with React Navigation native-stack and an in-place sidebar Shell

- Status: accepted, amended by [ADR 0007](0007-navigation-js-stack.md): the root navigator is the React Navigation JS stack (`@react-navigation/stack`), not native-stack
- Date: 2026-10-25

## Decision
- One root stack holds Auth, Shell, Author, Post, Player and SessionExpired (JS stack per ADR 0007; originally native-stack).
- Shell owns the sidebar and swaps section content in place, so sections are not stack entries.
- One modal host handles overlays and consumes Back first.
- Route params carry only ids and refs (no signed URLs).
- FocusRestoration is the single owner of the return focus, keyed by route key and section.

## Consequences
React Navigation and react-native-screens have no official TV support. If Back or focus misbehaves on the device, replace them with an own minimal stack behind the same `app/routes.ts` contract, and record that in a new ADR. The source is AD-12, AD-13 and AD-17 in the architecture spine.
