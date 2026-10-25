# Epic 1 Context: Prove it on the TV (P0)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Create the production React Native TV project skeleton, then use throwaway spike code on a separate branch to prove on the physical test device (Chromecast with Google TV 4K) that the chosen stack works with the real Boosty API. The spike covers phone sign-in, token persistence and refresh, logout, entitled video playback with URL expiry recovery, progress round-trip, audio/files, and the response shapes for entitlement, errors and events. The epic closes no product FR by itself. It validates the assumptions behind sign-in, session, playback, progress and lifecycle, and it produces the evidence later epics depend on: `docs/testing.md` results, `LIVE` entries in `docs/api-contract.md`, sanitized fixtures, an ADR for every fallback, and an English `docs/focus-map.md`. Production feature work (Epic 2+) starts only after the owner gives an explicit go.

## Stories

- Story 1.1: Production project skeleton
- Story 1.2: Library compatibility on the device
- Story 1.3: Spike — phone sign-in and token persistence
- Story 1.4: Spike — refresh and logout behavior
- Story 1.5: Spike — entitlement, errors and events shapes
- Story 1.6: Spike — authorized playback, expiry and progress round-trip
- Story 1.7: Spike — audio and files
- Story 1.8: Focus map and spike decision

## Requirements & Constraints

- **Device and evidence:** The test device is the Chromecast with Google TV 4K. Record the OS version, security patch, WebView version, remote and reported window size in dp (960×540 expected) in `docs/testing.md`. Mark every scenario passed or failed **on the physical device**. Label emulator results separately and never present mock or emulator results as device verification.
- **Each spike scenario records:** device and build, steps, observed result, and sanitized evidence (status codes and field shapes, never values). Contract findings go to `docs/api-contract.md` at the `LIVE` evidence level. Never invent endpoints or flows.
- **Scenarios:**
  - **S1, website sign-in in a WebView:** research only. Run it only if S2 hits a blocker such as a captcha.
  - **S2, phone + code:** works with the TV keyboard and the D-pad only, and returns tokens; `GET /v1/user/current` must then succeed. Record the shapes for wrong code, expired challenge, resend too soon and too many attempts (trigger each once, no abuse), plus whether a captcha is demanded, `expires_in`, and where the code was delivered. A captcha that cannot be passed on TV is a release blocker and must be reported to the owner.
  - **S3, persistence:** the session survives a kill, a cold start and a reboot. logcat, the dev menu and crash output contain no token, phone, challenge or code.
  - **S4, refresh:**
    - forced expiry with 5 concurrent calls must send exactly one `POST /oauth/token/`, and all 5 calls succeed;
    - a corrupted access token gives 401 → one refresh → one retry → success;
    - a corrupted refresh token gives one failed refresh, with no loop. Record its status and body as the "refresh rejected" signal;
    - record what happens on network loss during refresh, whether the refresh token rotates, and whether refresh depends on `device_id`.
  - **S5, entitlement:**
    - for an accessible and a locked post, fetch the feed, author, single post (E8 with `comments_limit=0`) and E15. Record `hasAccess`, `data` vs `teaser`, whether `playerUrls` is present, and whether video duration is present;
    - record the 401, 404 and 403 shapes, plus 429 if seen without abuse.
  - **S6, playback:**
    - HLS → MP4 quality → DASH (if offered), keeping the position across each switch;
    - D-pad seek, Select and media keys, rate change, time to first frame;
    - no Boosty `Authorization` header on CDN hosts.
  - **S7, URL expiry:** pause for 30 min, then 2 h or longer. Record the CDN error and status and the URL lifetime. Re-resolve via E8, match by media id, and restore the position. Use at most one automatic attempt.
  - **S8, progress:** check the E9 cadence (about every 10 s of movement plus on exit). Record whether `timeCode` ≈ X on refetch and whether the website shows the same position. Record what was written during sleep and wake, and the player state after wake.
  - **S9, audio and files:**
    - `audio_file` (`url + signedQuery`): play, pause, seek, then sleep and wake. Record whether `signedQuery` expires;
    - `file`: show its link as a QR, scan it with a phone, and record the link lifetime.
  - **S10, logout:** nothing account-scoped remains afterwards. If a second account is available, its data is isolated from the first.
  - **S11, events:** record the shape, event types and paging of `GET /v1/notification/standalone/event/`, and mark EVT-01 verified or not. This is a contract check only; build no UI.
- **Library checks (Story 1.2):**
  - React Navigation native-stack: D-pad focus, Back pops, and focus survives push and pop;
  - react-native-keychain 10: survives kill and reboot; a simulated corruption goes through the wipe → signed-out path without crashing;
  - react-native-video 6.19: public HLS, DASH and MP4 each play, seek, change rate and report errors;
  - Zod 4 under Hermes in a release-like build: record whether jitless mode is needed. Also check the hand-written ru plural selector for 1/2/5/11/21;
  - react-native-qrcode-svg: renders a long URL offline and a phone scans it.
- **Data handling:** fixtures in `src/test/fixtures` contain no tokens, cookies, signed URLs, `signedQuery`, phone numbers or real personal data. A sanitization check script must pass on them. The owner approved storing sanitized samples. Before the spike's debug log buffer is used, verify that it redacts tokens, cookies, phones, codes and signed URLs.
- **Non-goals:** production screens, design-system work, tvOS builds, QR or companion sign-in, comments.
- **Exit:** every scenario S2–S11 (and S1 if it was run) is either passed with device evidence or failed with a written blocker and the alternatives tested. The report lists blockers and fallbacks with their ADRs. The owner's explicit go is required before Epic 2.

## Technical Decisions

- **Bootstrap:** run `@react-native-community/cli init --version 0.87.1`, then alias `react-native` to `npm:react-native-tvos@0.87.1-1` (React 19.2.3). If the alias fails on the device, fall back to the 0.83 TV template plus an upgrade, recorded in a new ADR. Record the exact commands and the Node, JDK and Android SDK versions in `docs/testing.md`. Preserve the existing `docs/`, `_bmad/` and planning artifacts.
- **Pinned stack:**

  | Package | Version |
  | --- | --- |
  | TypeScript | ^6.0.3 (template), strict |
  | Jest | ^29.6.3 |
  | @react-native/jest-preset | 0.87.x |
  | @testing-library/react-native | 14.1.x |
  | test-renderer | 1.3.x |
  | @react-navigation/native | 7.5.x |
  | @react-navigation/native-stack | 7.21.x |
  | react-native-screens | 4.30.x |
  | react-native-safe-area-context | 5.10.x |
  | react-native-video | 6.19.x |
  | react-native-keychain | 10.0.x |
  | @react-native-async-storage/async-storage | 3.1.x |
  | @tanstack/react-query | 5.104.x |
  | zod | 4.6.x |
  | zustand | 5.0.x |
  | react-native-qrcode-svg | 6.3.x |
  | react-native-svg | 15.16.x |
  | eslint-plugin-boundaries | 7.3.x |

  Use npm with a committed `package-lock.json`, Node 24, exact pins, and `npm ci` must pass.
- **Android:**
  - New Architecture only. `minSdk` stays as the template sets it. Two variants: `debug` (demo allowed) and `release`.
  - Configure the manifest by hand: `LEANBACK_LAUNCHER`, a placeholder TV banner, `touchscreen required=false`, `allowBackup=false`, cleartext traffic disabled. Never disable default TLS validation.
- **Layout:**
  - `src/app` holds bootstrap, routes, Shell, the modal host, appConfig and phaseFlags.
  - `src/features/*` holds auth, home, subscriptions, author, search, post, polls, player, events and settings.
  - `src/shared/{api, entities, services, filters, platform (+android/), focus, ui, i18n, storage}`.
  - `src/test/fixtures`.
  - Do not create empty modules just for appearance.
- **Boundaries (enforced by eslint-plugin-boundaries in CI):**
  - `shared` never imports `features` or `app`, and features never import `app`.
  - Screens use only hooks, `shared/ui`, `shared/focus` and `shared/filters`. Only repositories call API clients.
  - Feature → feature imports go only through `index.ts` and only along the allowlisted edges `post → polls` and `post → player`.
  - Navigation between features goes through typed routes, never imports.
  - The lint rule must fail on a deliberately added forbidden import and pass once it is removed.
- **Ports:** `SecureStore`, `KeyValueStore`, `PlayerEngine` (integer seconds), `AppLifecycle`, `ExternalPlayer` and `QrRenderer`, with adapters in `shared/platform/android`. Features never import native modules directly.
- **Session rules the spike must inform:**
  - single-flight refresh, proactive when fewer than 300 s remain, and once after a 401;
  - `expired` only when the refresh endpoint rejects the refresh token. On network or server errors, keep the tokens;
  - SecureStore corruption → wipe → `signedOut`.
- **API facts:**
  - Base URL is `https://api.boosty.to/` with a Bearer token. Refresh and phone auth use web-style headers and `X-From-Id: <device_id>` (a UUIDv4 persisted once per install). Test the minimal header set.
  - Mutations are form-encoded. Auth headers go to api.boosty.to only.
  - Logout makes no server call.
- **Secrets and gitignore:**
  - The repository will be public. Exclude keystores, `*.jks`, `.env*`, local signing configs and spike credentials.
  - Tokens and the phone live only in SecureStore. The logger redacts tokens, cookies, Authorization headers, phones, codes, signed URLs and `signedQuery`.
  - Git init and creating the public GitHub repo are done by the owner, or only with the owner's explicit approval.
- **CI (GitHub Actions):** runs lint, typecheck, tests and the debug build only. No signing secrets; release signing is done locally by the owner. Fails on any error.
- **Tests:** Jest with `@react-native/jest-preset`, RNTL 14 and `test-renderer`. Story 1.1 needs `npm run lint`, `npm run typecheck` and `npm test`, with one sample component test.
- **Fallbacks:**
  - own minimal stack behind the same routes contract (replaces React Navigation);
  - own Keystore module (replaces react-native-keychain);
  - Zod jitless mode.

  Each fallback gets an ADR in `docs/adr/` and an update to the spine's Stack row.

## UX & Interaction Patterns

- The Story 1.1 placeholder screen has one focusable button, reachable with the D-pad, and launches from the Google TV home screen.
- Spike screens use only the D-pad, Select, Back and the system keyboard, with no virtual cursor or touch.
- Story 1.8 writes `docs/focus-map.md` in English, derived from the design focus map (`design/claude-design-v1/docs/focus-map.md`) and EXPERIENCE.md. For every IA screen it lists the initial focus, arrows, OK, Back and restoration rules, including the overrides recorded in EXPERIENCE.md. It must exist before the first UI story.

## Cross-Story Dependencies

- Story 1.1 comes first, then 1.2. Spikes 1.3 to 1.7 run on the spike branch on top of that skeleton.
- Story 1.3 (tokens) gates 1.4 to 1.7.
- Story 1.6 needs the accessible `ok_video` found in 1.5.
- Story 1.8 compiles the results of 1.2 to 1.7.
- Owner prerequisites:
  - a Boosty account with a linked phone and a paid subscription, covering `ok_video` (multiple per post if possible), `audio_file`, `file`, single- and multi-choice polls, and at least one locked post;
  - optionally, a second account for S10.
- Epic 2 is blocked until the owner signs off on the 1.8 report. Results from S4 (refresh-rejection status and refresh-token lifetime), S7 (CDN expiry signal), S8 (server vs local resume) and S11 (whether the Events section is enabled) feed directly into the session, player, progress and events stories.
