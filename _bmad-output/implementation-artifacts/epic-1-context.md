# Epic 1 Context: Prove it on the TV (P0)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Create the production React Native TV skeleton, prove the chosen libraries on the physical test device, and then use throwaway spike code (separate `spike/*` branches, never merged as features) to show against the real Boosty API that phone sign-in, token persistence and refresh, logout, entitled video playback with URL-expiry recovery, progress round-trip, audio/files and the entitlement/error/events response shapes behave as the plan assumes. The epic closes no product FR. It produces the evidence every later epic depends on: per-scenario results in `docs/testing.md`, `LIVE` entries in `docs/api-contract.md`, sanitized fixtures, an ADR for every fallback, an English `docs/focus-map.md`, and a go/no-go report. Stories 1.1 (skeleton) and 1.2 (library compatibility) are done; 1.3–1.8 remain. **Production work on Epic 2 starts only after the owner's explicit go on the Story 1.8 report.**

## Stories

- Story 1.1: Production project skeleton (done)
- Story 1.2: Library compatibility on the device (done)
- Story 1.3: Spike — phone sign-in and token persistence
- Story 1.4: Spike — refresh and logout behavior
- Story 1.5: Spike — entitlement, errors and events shapes
- Story 1.6: Spike — authorized playback, expiry and progress round-trip
- Story 1.7: Spike — audio and files
- Story 1.8: Focus map and spike decision

## Requirements & Constraints

- **Device facts:** Chromecast with Google TV 4K, Android TV 14 (API 34), 32-bit only (`armeabi-v7a`), about 350 MB free on `/data`, 960×540 dp window, wireless adb (port changes after reboot). Build with `-PreactNativeArchitectures=armeabi-v7a`; a 4-ABI APK fails to install. `screencap` does not capture the video surface; picture visibility needs an owner check.
- **Evidence honesty:** mark each scenario passed/failed on the physical device; label emulator results separately; distinguish "keys injected via adb" from "owner, physical remote". Record status codes and field shapes, never values. Never invent endpoints or flows.
- **Remaining scenarios:**
  - **S2 phone sign-in (1.3):** D-pad + system keyboard only; send → confirm → tokens → E1 (`GET /v1/user/current`) succeeds. Trigger wrong code, expired challenge, resend too soon and too many attempts **once each** (no abuse) and record status + sanitized body shape, where the code was delivered, `expiresIn`/`expires_in` units, and any captcha demand. An unpassable captcha is a release blocker reported to the owner; only then run S1 (website sign-in) as research.
  - **S3 persistence (1.3):** session survives kill, cold start and reboot. Also pass the ADR 0006 gate: after file-level corruption, helper + reset let the store save and read again in the same process (or record that a restart is needed); full matrix (kill, cold start, reboot, ciphertext corruption, file corruption) passes; a transient non-corruption error does not sign out. Gate failure → own Keystore module + new ADR.
  - **S4 refresh (1.4):** forced past expiry + 5 concurrent calls → exactly one `POST /oauth/token/`; corrupted access token → 401 → one refresh → one retry; corrupted refresh token → one failed refresh, no loop, its status/body recorded as the "refresh rejected" signal. Record network loss during refresh, refresh-token rotation and `device_id` dependency.
  - **S10 logout (1.4):** nothing account-scoped remains; second account isolated if available.
  - **S5/S11 (1.5):** accessible vs locked post across feed, author, single post (E8 with `comments_limit=0`) and E15: `hasAccess`, `data` vs `teaser`, `playerUrls`, video duration. Shapes for 401/404/403 (429 only if seen without abuse). E18 events shape, types, paging; mark EVT-01 verified or not (no UI).
  - **S6–S8 (1.6):** HLS → MP4 quality → DASH with position kept, D-pad seek, Select, media keys, time to first frame, no Boosty `Authorization` on CDN hosts; URL expiry after 30 min and ≥2 h, re-resolve via E8 by media id, at most one automatic attempt; E9 cadence (~10 s of movement + on exit), `timeCode` round-trip, website position, sleep/wake behavior.
  - **S9 (1.7):** `audio_file` (`url + signedQuery`) play/pause/seek/sleep and whether `signedQuery` expires; `file` link as QR scanned by a phone, link lifetime.
- **Secrets and logging:** never log or persist outside secure storage the phone, challenge, SMS code, tokens, cookies, Authorization headers, signed URLs or `signedQuery`. logcat, dev menu and crash output must stay clean. Verify the spike's debug log buffer redacts all of these before using it. Credentials never enter the repo.
- **Fixtures:** sanitized samples in `src/test/fixtures` (owner approved) contain no tokens, cookies, signed URLs, `signedQuery`, phones or personal data; a sanitization check script must pass.
- **Non-goals:** production screens, design-system work, tvOS builds, QR/companion sign-in, comments (never call the comments endpoint).

## Technical Decisions

- **Stack as built** (pinned exactly, npm + committed lockfile, Node 24, JDK 17, New Architecture + Hermes): `react-native` aliased to `react-native-tvos@0.87.1-1` (React 19.2.3) with `overrides.react-native = "$react-native"`. Validated on the device in 1.2: `@react-navigation/native` 7.5.1 + `@react-navigation/stack` 7.12.1 + `react-native-gesture-handler` 3.4.0; `react-native-keychain` 10.0.0; `react-native-video` 6.19.3; `zod` 4.6.7; `react-native-qrcode-svg` 6.3.27 + `react-native-svg` 15.16.0. These deps live on spike branches; `main` so far carries only the skeleton and the ru plural selector (`src/shared/i18n/plural.ts`, Hermes has no `Intl.PluralRules`). Each library lands on `main` with its first production use.
- **Navigation (ADR 0007):** JS stack via `createStackNavigator` with `detachInactiveScreens={false}`, `headerShown: false`, `gestureEnabled: false`. native-stack is dropped (intermittent `MissingViewState` push defect in debug and release). `react-native-screens` stays only as a peer and is never rendered; no `RNScreensFragmentFactory` in production. Every screen is wrapped in a focus-trapping `TVFocusGuideView`, and return focus is restored explicitly (remember on blur, `hasTVPreferredFocus` on focus); Android's fallback focus is never relied on. Fallback: own minimal stack behind `app/routes.ts` + new ADR.
- **Secure storage (ADR 0006):** react-native-keychain behind the `SecureStore` port plus a native helper that deletes `RN_KEYCHAIN.preferences_pb`. Error classification: `CorruptionException` → helper deletes file → reset → signed-out; `CryptoFailedException`/`KeyPermanentlyInvalidatedException` → reset → signed-out; anything else → keep data, recoverable error, one retry, no sign-out. Pin the library; re-run the gate on every update.
- **Zod:** works under Hermes release bytecode, jitless not needed; requires `@babel/plugin-transform-export-namespace-from` in `babel.config.js` (Jest does not catch its absence; only the Metro release bundle does).
- **Release-like builds** for navigation and device checks: `assembleRelease` + `zipalign` + `apksigner` with the SDK debug key outside the repo.
- **Phone-auth API facts (`REF`, to be upgraded to `LIVE`):**
  - Base `https://api.boosty.to/`. Send: `POST /auth/phone/verification_code/send`, no Bearer, form-encoded `phone` (E.164), `device_os=web`, `device_id`, optional `transport` (omit first time, `gate` for resend). Response `data.phoneCode{code (challenge), sentTransport?, expiresIn? (presumably ms), phone?}`.
  - Confirm: `PUT /auth/phone/verification_code/confirm`, no Bearer, form `phone`, `code` (challenge), `sms_code`, `device_os=web`, `device_id`. Response snake_case `access_token`, `refresh_token`, `expires_in` (seconds).
  - Sign-in completes only after E1 succeeds.
  - Refresh: `POST /oauth/token/` form `grant_type=refresh_token`, `refresh_token`, `device_id`, `device_os=web`; store a new refresh token if returned.
  - Auth and refresh calls use web-style headers (`X-App: web`, `X-Locale: ru_RU`, `Referer`/`Origin: https://boosty.to`, `Accept: application/json, text/plain, */*`, desktop Chrome UA) and `X-From-Id: <device_id>`. Test the minimal header set.
  - `device_id` is a UUIDv4 generated once per install and is device-scoped (survives sign-out).
  - Auth headers go to api.boosty.to only. Logout makes no server call.
  - Error shapes and the server resend limit are unknown; the reference uses a 60 s client cooldown. `/auth/phone/mobile_captcha/send` exists only in the reverse-engineered spec, which hints that a captcha may be required.
- **Session rules the spike informs:** single-flight refresh, proactive when < 300 s remain and once after a 401 with one retry; `expired` only when the refresh endpoint rejects the refresh token (the exact 4xx comes from S4); on network/server errors keep tokens. Error kinds come from S5: `SessionExpired`, `NoAccess`, `MediaUrlExpired`, `NotFound`, `RateLimited`, `Client`, `Server`, `Network`, `Parse`. Never treat every 403 as an expired token.
- **Progress identity:** `ok_video.id` (media id), never the URL; positions cross the player port in integer seconds.

## UX & Interaction Patterns

- Spike screens use only D-pad, Select, Back and the system keyboard; no virtual cursor or touch.
- Story 1.8 writes `docs/focus-map.md` in English from the design focus map and EXPERIENCE.md: for every IA screen, initial focus, arrows, OK, Back and restoration, including the EXPERIENCE.md overrides, the per-screen focus trap and the explicit restoration rule from ADR 0007 (by content id, scrolling a virtualized card into view first, with the fallback chain).

## Cross-Story Dependencies

- 1.3 (working tokens) gates 1.4–1.7. 1.6 needs an accessible `ok_video` found in 1.5.
- Owner prerequisites: a Boosty account with a linked phone and a paid subscription covering `ok_video` (several per post if possible), `audio_file`, `file`, single- and multi-choice polls and a locked post; optionally a second account for S10. Owner-only checks: physical remote, phone (SMS code, QR scan), picture visibility.
- 1.8 compiles the 1.2–1.7 results (S2–S11, S1 if run), lists blockers and fallbacks with ADRs, and is presented to the owner. **Epic 2 is blocked until the owner's explicit go.** S4 (refresh-rejection signal, rotation), S7 (CDN expiry signal), S8 (server vs local resume) and S11 (whether События is enabled) feed the session, player, progress and events stories. Story 2.4 must re-verify focus restoration on a long virtualized list on the device; Story 9.3 measures memory with stacked mounted screens.
