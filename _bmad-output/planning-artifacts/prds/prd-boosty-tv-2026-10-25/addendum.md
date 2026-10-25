# PRD Addendum: Boosty TV

This file holds technical and downstream detail that belongs to architecture, not to the PRD. The binding rules live in `CLAUDE.md` and in the docs it references.

## Stack direction (from CLAUDE.md, to be confirmed in phase 0)

- React Native + TypeScript (strict) + react-native-tvos, using the TV Community CLI template, with native projects under version control. Versions are resolved and pinned when the project is initialized.
- Video: evaluate `react-native-video` (ExoPlayer/Media3 on Android) first. Verify that it works with the chosen RN TV version, and that it reports track and resolution information (needed for the «Авто · 1080p» suffix) and HTTP error details (needed for expired-URL detection).
- Secure storage: a Keystore-backed library. Evaluate `react-native-keychain` first, then others.
- Data and state: TanStack Query for server state, Zod at the API boundary, Zustand only for genuinely shared session/UI state.
- Focus: native react-native-tvos focus and `TVFocusGuideView`. No JS focus engine without an ADR.
- QR generation on the device: choose a library during architecture; verify it renders offline.
- Navigation library: evaluate it against react-native-tvos before adopting it.

## Distribution (owner decision 2026-10-25)

- A signed release APK is attached to a GitHub Release of the project repository and installed manually (adb or a file manager on the TV).
- The signing keystore and its credentials stay outside the repository and CI logs.
- Repository visibility: public (owner decision 2026-10-25). No secrets, signing material, real account data or unsanitized fixtures may ever be committed.
- Update check (FR-56): `GET https://api.github.com/repos/<owner>/<repo>/releases/latest`, unauthenticated, rate-limited by GitHub (60 requests/hour per IP), so at most daily. The release asset name and the tag format must match the `versionName` comparison.

## Source of truth for API details

All endpoint, parameter and response details are in `docs/api-contract.md`. FRs cite endpoint IDs (E1–E18) and do not restate them.
