# ADR 0014: QR codes with react-native-qrcode-svg

- Status: accepted (Story 6.3)
- Date: 2026-10-29
- Relates to: `_bmad-output/implementation-artifacts/spec-6-3-links-files-and-external-videos-via-qr.md`, `docs/feature-parity.md` §12 (owner decision 2026-10-25: QR for links, files and external videos), ADR 0013 (react-native-svg), `docs/focus-map.md` §4 F7

## Context

Links, files and external videos in a post open nothing on the TV: each is shown as a QR code that the viewer scans with a phone. A file's QR carries `url + Post.signedQuery`, a personal signed link (the account's user id and a 24 h signature), so the code must be generated on the device: no QR web service may see it. The Story 1.7 spike proved `react-native-qrcode-svg` 6.3.27 on the pinned device (200 dp, `ecl="M"`, white quiet zone). Stories 7.4 (stream share) and 9.2 (release page) reuse the same dialog.

## Decision

- Add `react-native-qrcode-svg` **6.3.26** (licence MIT), exact pin (`package.json` + `package-lock.json`). 6.3.27, the spiked version, was published 2026-10-21, less than 14 days before this story (project policy, as with zustand in Story 5.3); 6.3.26 was published 2026-09-22. Its peer `react-native-svg` (≥ 14) is the pinned 15.15.5 (ADR 0013). New lockfile entries: `qrcode` 1.5.4 (and its `dijkstrajs`, `pngjs`, `yargs` 15 tree), `prop-types`, `text-encoding`; no other package version changed. JS only: no new native module.
- The library sits behind the `QrRenderer` platform port, `src/shared/platform/qrRenderer.tsx` (`QrCode({value, size, background, onError})`): `ecl="M"`, black modules on the `background` the caller passes (`QrDialog`: the `qr-bg` white token, so the port does not import `shared/ui`), a 16 dp quiet zone inside the 200 dp box. Features use `QrDialog` (`src/shared/ui/QrDialog.tsx`), never the library. A value that does not fit a QR code shows «Не удалось показать QR-код» instead of throwing.
- The library imports `react-native-svg/css` for logo support, which requires `@react-native/assets-registry/registry`. react-native-tvos 0.87.1 has no such package; it ships the same registry as `react-native/asset-registry` (Metro's default `assetRegistryPath`). `metro.config.js` resolves that one module name to it. Jest maps `react-native-svg/css` to `__mocks__/react-native-svg-css.js`, and the react-native-svg manual mock gained the elements the library draws (`Defs`, `LinearGradient`, `Stop`, `ClipPath`, `Image`, `SvgUri`, `SvgXml`). The app never passes a logo.

## Transitive dependencies

| Package | Version | Licence | In the app bundle | Maintenance |
|---|---|---|---|---|
| `qrcode` | 1.5.4 | MIT | yes (`lib/core`: matrix generation) | maintained (last publish 2025-11) |
| `dijkstrajs` | 1.0.3 | MIT | yes (`qrcode` segment optimisation) | small, stable (last publish 2023-04) |
| `prop-types` | 15.8.1 | MIT | no (only the library's own test mock imports it) | maintained by the React team, frozen API |
| `text-encoding` | 0.7.0 | Unlicense OR Apache-2.0 | no (only the library's optional Babel `textEncodingTransformation` polyfill uses it; the app does not enable it — Hermes on react-native-tvos 0.87 has `TextEncoder`, which `qrcode` calls) | **unmaintained** (npm: «no longer maintained»); a removal candidate if a later library version drops it |
| `pngjs`, `yargs` 15 tree | 5.0.0, 15.4.1 | MIT | no (`qrcode`'s Node file/CLI output) | — |

How the lockfile change was checked: `npm install --save-exact react-native-qrcode-svg@6.3.26`, then `git diff package-lock.json` reviewed for version changes: only new entries for the packages above (and `dev: true` dropped from packages that are now also production dependencies); no existing package changed version. The release Hermes bundle was searched for `pngjs`, `yargs` and `text-encoding` (no match; indicative only, as bytecode need not keep module names). `npm audit --omit=dev` reports nothing for these packages.

## Compatibility check

`./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` (react-native-tvos 0.87.1-1) BUILD SUCCESSFUL on 2026-10-29. The `releaseBundle` Jest test bundles both the debug and the release JS with the Metro alias. On the pinned Chromecast with Google TV, a release-like build rendered the QrDialog with a readable code for a link and for an external video (agent over adb, screenshots kept out of the repo). Scanning with a phone is the owner's check (`docs/testing.md` «Story 6.3»).

## Consequences

- One more JS dependency tree (`qrcode` and its CLI-only deps in the lockfile; Metro bundles only what the app imports).
- Upgrades follow the same rule: exact pin, a release older than two weeks, a release build and a device check. If a later react-native-svg or react-native-qrcode-svg stops importing the old registry path, the Metro alias can go.
- The signed file target lives only in the dialog's props while it is open. It is never logged, cached, persisted or shown as text (`__tests__/postFlow.test.tsx` «Story 6.3»).
