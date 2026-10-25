# ADR 0001: react-native-tvos 0.87 with the community template

- Status: accepted (pending verification in spike step 1)
- Date: 2026-10-25

## Context
`react-native-tvos` latest is 0.88.0-0, published about a week before this decision. The official TV template (`@react-native-tvos/template-tv`) stops at 0.83, and react-native-screens 4.26+ requires RN ≥ 0.84.

## Decision
Use react-native-tvos **0.87.1-1** (core 0.87.1, React 19.2.3). Create the project with the community CLI template `--version 0.87.1` and alias `react-native` to `npm:react-native-tvos@0.87.1-1`. Configure the Android TV manifest manually: `LEANBACK_LAUNCHER`, banner, `touchscreen required=false`, `allowBackup=false`.

## Consequences
- TypeScript, Jest and ESLint versions come from the 0.87.1 template.
- If the alias approach fails on device, fall back to the 0.83 TV template followed by an upgrade, and record that in a new ADR.
- Source: `_bmad-output/planning-artifacts/architecture/architecture-boosty-tv-2026-10-25/ARCHITECTURE-SPINE.md` (Stack, AD-2), `reviews/review-versions.md`.
