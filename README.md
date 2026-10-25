# Boosty TV

Independent, unofficial Boosty client for Android TV / Google TV, built with
React Native ([react-native-tvos](https://github.com/react-native-tvos/react-native-tvos)).
"Boosty TV" is a working title, not approved branding. Apple TV is a later
phase and is **not implemented or validated**.

Project rules live in [`CLAUDE.md`](CLAUDE.md). Audit and planning documents
live in [`docs/`](docs) and [`_bmad-output/`](_bmad-output).

## Stack

- `react-native` aliased to `npm:react-native-tvos@0.87.1-1` (React 19.2.3), see
  [ADR 0001](docs/adr/0001-react-native-tvos-0-87-bootstrap.md).
- TypeScript (strict), Jest with `@react-native/jest-preset` and `test-renderer`,
  ESLint 8 with `@react-native/eslint-config` and `eslint-plugin-boundaries`.
- npm with exact pins and a committed `package-lock.json`. Node 24.
- Android only: `android/`. There is no `ios/` target; a tvOS target is added in
  phase 4.

## Prerequisites

Exact versions and the machine setup are recorded in
[`docs/testing.md`](docs/testing.md).

- Node 24 (`.nvmrc`), npm 11
- JDK 17 (`JAVA_HOME`)
- Android SDK with platform 36/37, build-tools 36/37, NDK 27.1.12297006
  (`ANDROID_HOME`)

## Commands

```sh
npm ci                # install exact versions from the lockfile
npm run lint          # ESLint, including architecture boundaries
npm run typecheck     # tsc --noEmit
npm test              # Jest
npm start             # Metro dev server
npm run android       # build and install the debug app on a connected device

cd android && ./gradlew assembleDebug   # debug APK
```

## Source layout

```text
src/app/          composition, providers, navigation
src/features/*    one folder per feature; cross-feature imports only via index.ts
                  and only along allowlisted edges (post -> polls, post -> player)
src/shared/*      api, entities, services, filters, platform, focus, ui, i18n, storage
src/test/fixtures sanitized API responses
```

`.eslintrc.js` enforces the boundaries; `__tests__/boundaries.test.js` proves
they reject forbidden imports.

## Security

No keystores, signing configs, tokens or `.env` files are committed. Debug
builds use the local Android SDK debug keystore; release builds are signed by
the owner locally.
