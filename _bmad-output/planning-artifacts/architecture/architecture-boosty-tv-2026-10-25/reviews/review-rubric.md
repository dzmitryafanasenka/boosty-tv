---
review: rubric walk (good-spine checklist)
target: ../ARCHITECTURE-SPINE.md (status: draft, 2026-10-25)
inputs: ../.memlog.md, prd.md (FR-1..57, NFR-1..9), EXPERIENCE.md, docs/api-contract.md, CLAUDE.md
date: 2026-10-25
reviewer: rubric walker (review only, spine not edited)
---

# Rubric Review — Architecture Spine, Boosty TV

## Verdict

**Revise before epics/stories.** The paradigm, layering, ports, session and progress ownership, error taxonomy and identity rules are the right divergence points, and most rules are concrete. The spine does not contradict CLAUDE.md on stack, security or phasing. Six problems would still make independently built stories diverge or produce wrong behavior:

1. AD-3 turns any refresh failure, including a network failure, into `expired`.
2. AD-5 combined with AD-6 retries unverified 4xx responses, including 429.
3. AD-1 has no sanctioned way to compose features (polls in a post, the shared filter panel, live card plus player, player-to-post return).
4. The sidebar and section navigation model is undecided.
5. The sign-in flow has no error taxonomy and no token hand-off path.
6. AD-10's "newer of server and local" cannot be computed.

Several dimensions at this altitude are not yet decided, deferred or listed as open: list virtualization and image loading, the platform envelope, the diagnostics log sink, Android backup, and the integration-test seam. The Capability map has no NFR rows.

Counts: **critical 1 · high 5 · medium 12 · low 8**.

## Rubric summary

| Check | Result |
| --- | --- |
| Fixes the real divergence points | Mostly. Gaps: cross-feature composition, navigation model, auth error and token path, list/image primitives, audio ownership, freshness policy |
| Each Rule enforceable and prevents its divergence | Partly. AD-3 and AD-5/6 have defects; AD-10 cannot be computed; AD-4 cannot be enforced as written; AD-1/2/7/12 do not name an enforcement mechanism |
| Nothing in Deferred can cause divergence | One exception: `docs/focus-map.md` deferred into P1 is a cross-story contract |
| Covers PRD capabilities | All FR groups are mapped. No NFR is mapped. Some FR details have no home (FR-39 single audio, FR-54 log capture, FR-55 manifest) |
| No contradiction with CLAUDE.md | Holds, with low notes (QrRenderer as a speculative port; the owner's custom-form exception is not cited) |
| Operational envelope | Deployment, environments and CI are decided. Platform envelope (minSdk/target, New Architecture/Hermes, variants), backup policy and diagnostics operations are missing |
| Testing strategy | Unit and component tests are decided. The integration seam and device-verification protocol are not |
| Security | Strong on secrets and redaction. Missing: Android backup policy; redaction relies on a denylist |
| i18n | Decided (typed `ru` catalog + `Intl.PluralRules`). Hermes Intl `ru` support is not verified |
| Performance | Only virtualization tuning is deferred. The list and image primitives are undecided |

## Findings

### Critical

#### C1 — A network failure during refresh signs the household out
- **Location:** AD-3, bullet "A failed refresh sets the status to `expired`."
- **Problem:** Every refresh failure is treated as session expiry. A TV that wakes before Wi-Fi is up, a 5xx, or a timeout on `POST /oauth/token/` would show «Сессия истекла». That contradicts EXPERIENCE.md › Global states › "Cold start offline … The session is kept; this is not A11", AD-5's own principle (a token is never expired without verified evidence) and SM-2 / the product promise "a session that does not drop". Implementers will follow the rule literally.
- **Suggested fix:** Classify refresh outcomes. Set `expired` and clear tokens only on a verified rejection of the refresh token (401/400 shape to be recorded in spike S4). Until S4 records it, use HTTP 401 from `/oauth/token/` only. A `Network`, `Server` or timeout failure keeps the tokens and the `signedIn` status, surfaces `AppError{kind: Network|Server}` to the caller, and allows the next request to try the single-flight refresh again, with a bounded backoff so it cannot loop. Add a unit test for each branch.

### High

#### H1 — AD-1 forbids feature-to-feature imports but provides no composition mechanism
- **Location:** AD-1; Structural Seed; Capability map.
- **Problem:** Several confirmed flows cross feature boundaries:
  - the post screen renders polls (`features/polls`) and an audio block;
  - the same filter panel serves Главная, Автор and Поиск (EXPERIENCE.md), yet the map places it under `features/search`;
  - the author page shows a live card, and `features/player` plays it;
  - `MediaResolver` in `features/player` must re-fetch E8 and E15, so it needs the post and author repositories;
  - the player must return "focus the next unfinished MediaRow" to the post screen;
  - Events opens an Author with the live card focused.

  "Move it to `shared/domain` or `shared/services`" does not fit UI components or repositories. Each story will solve this differently: duplicated repositories, deep imports, or moving whole features into `shared`.
- **Suggested fix:** Add one rule for cross-feature needs:
  - Each feature exposes a public `index.ts`. Other features may import only from it, and only in a declared direction (for example `post → polls`, `post → player` for navigation only). Lint enforces the allowed edges. Or forbid all feature imports and compose in `src/app` through injected slots.
  - Shared repositories (post by id, blog, live stream) live in a `shared/api/repositories` or `shared/content` module.
  - The filter panel lives in `shared/ui` with its state hook in a shared module.
  - Cross-screen results such as the player-exit focus target travel as typed navigation params, never as imports.

#### H2 — Unverified 4xx responses (including 429) map to `Server` and get retried
- **Location:** AD-5 ("Anything unverified maps to `Server` or `Network`") combined with AD-6 ("GET requests get bounded retries … for `Network` / `Server`").
- **Problem:** Until spike S5 and S11, 403, 404, 410 and 429 are unverified (api-contract §7). Under these rules they become `Server` and are retried with backoff. That is the request storm NFR-3 forbids, and a 403 for a locked post gets retried. EXPERIENCE.md also asks for "at most one delayed retry for GETs" on 429, which AD-6 never allows, even for a verified `RateLimited`.
- **Suggested fix:** Add an `Unknown` kind (or `Client`) for unverified 4xx, which is never retried and shows a generic error with «Повторить». Limit `Server` to 5xx. Spell out the retry table per kind: Network → bounded backoff; Server (5xx) → bounded backoff; RateLimited → at most one delayed retry (honor `Retry-After` if verified); everything else → no retry.

#### H3 — Sign-in errors and the token hand-off path are not specified
- **Location:** AD-3, AD-5; FR-1, FR-2; api-contract §1 and §2.2–2.3.
- **Problem:**
  - FR-1/FR-2 require distinct states for invalid number, wrong code, expired code, too many attempts and captcha (A4, A7–A10). The `AppError.kind` union has none of them, and AD-5 forbids screens from reading status codes. The auth story will invent a parallel taxonomy or will break AD-5.
  - The spine does not say who calls `/auth/phone/*`, how tokens from `confirm` reach `SessionManager` (AD-3 says only it writes tokens), or where the E1 check and the account-switch comparison (AD-4) run.
  - Refresh and phone-auth use a different header set and User-Agent plus `X-From-Id`/`device_id` (api-contract §1). The refresh call must not pass through the 401 interceptor, or it recurses.
  - `device_id` (a per-install UUID) has no owner or storage decision.
- **Suggested fix:**
  - Add an `AuthError` sub-union produced only in `shared/api` (`InvalidPhone | WrongCode | CodeExpired | TooManyAttempts | VerificationRequired | Unknown`), mapped only from verified shapes, with a generic fallback.
  - State that `SessionManager.signIn(tokenResponse)` is the only entry point for new tokens. It validates with E1, then performs the account-id comparison and `AccountScope.reset()` before reporting `signedIn`.
  - Name a separate `AuthHttpClient` (web headers, no Bearer, no refresh interceptor).
  - Decide on `device_id`: device-scoped, created once, stored in `KeyValueStore` or `SecureStore`, survives sign-out.

#### H4 — AD-10 "newer of server `timeCode` and local" cannot be computed
- **Location:** AD-10, `resumePoint(mediaId)`; FR-43 "the more recent one wins"; Deferred "AD-10 already covers both outcomes".
- **Problem:** E8 `timeCode` is a bare position with no timestamp (api-contract §3, E8/E9), so "newer" has no defined meaning. Two implementers will choose differently: max position, always local, or always server. Resume accuracy (SM-4) is a P1 acceptance metric.
- **Suggested fix:** Define the rule exactly. For example, each local entry stores `{positionSec, updatedAt, lastAckedServerSec}`:
  - if server `timeCode` equals `lastAckedServerSec`, local wins (this device wrote last);
  - if they differ, server wins (another client wrote);
  - if no local entry exists, use the server value.

  Re-confirm after S8. Add a table-driven unit test.

#### H5 — The sidebar and section navigation model is undecided
- **Location:** AD-13, AD-12; FR-9, FR-10; EXPERIENCE.md › Sidebar / NavItem.
- **Problem:** AD-13 names a native stack only. It does not say:
  - whether the five sections are one root stack whose base screen is replaced, nested stacks per section, or a custom tab container;
  - how "content → sidebar → Главная → exit" maps onto the stack;
  - whether section stacks are preserved when switching ("→ from the sidebar returns to the last content focus");
  - how a cross-section deep link (Events → Author with the live card focused) or a player-exit focus hint is passed.

  FocusRestoration is keyed by route key, so the model decides whether restoration works at all. Every section story will assume a different model.
- **Suggested fix:** Decide the shell model in AD-13. For example, a custom sidebar container holds one native-stack per section, keeps unvisited sections unmounted and visited ones mounted, and the root Back handler implements the FR-10 chain. Add a typed `RootParamList`, with focus hints passed as an optional `focusTarget: FocusId` param that FocusRestoration consumes. If the spike forces the fallback stack, record it in the same ADR.

### Medium

#### M1 — Filter state location is contradictory
- **Location:** Consistency Conventions › State ("Filters … live in Zustand"); Capability map ("filter state in `shared/storage`"); Structural Seed (`storage/ … filters`).
- **Problem:** One source says in-memory Zustand, the others say a persisted `KeyValueStore`. Whether filters survive an app restart is not decided, and the PRD does not require it. Stories will diverge.
- **Suggested fix:** Choose one. The likely choice is Zustand, in-memory, one slice per scope (`feed`, `author:{blogUrl}`, `search`), registered with AccountScope and not persisted. Fix the map and the seed to match.

#### M2 — AD-4 is not enforceable and leaves the scope of each store open
- **Location:** AD-4.
- **Problem:**
  - "Adding account-scoped data without registering it violates this AD" cannot be checked by lint or by a test.
  - The rule does not classify the remaining stores: quality preference (SET-04), global speed (FR-47), the external-player toggle, `device_id`, the update-check timestamp, the diagnostics log and FocusRestoration state.
  - In-flight requests and progress writes of the old account can repopulate the cache after `reset()`.
- **Suggested fix:**
  - Make the scope a required constructor argument: `createStore({scope: 'account' | 'device'})` auto-registers account stores. Add a test that, after `reset()`, every account-scoped store is empty.
  - List the classification explicitly.
  - Specify the reset order: cancel queries → flush or discard pending ProgressRepository writes → clear → set the new account id.

#### M3 — No freshness policy for server state
- **Location:** AD-7; FR-32 ("fetched fresh"), FR-43 (fresh E8 for `timeCode`), EXPERIENCE.md "Resume from sleep … lists refetch silently".
- **Problem:** The spine does not fix `staleTime` or `gcTime` defaults, whether playback reads a cached post (stale signed URLs or `timeCode`), whether the query cache is ever persisted (it contains signed URLs, which AD-9 forbids persisting), or how foreground refetch is wired (TanStack `focusManager` ↔ `AppLifecycle`).
- **Suggested fix:** Add the policy to AD-7:
  - in-memory cache only, never persisted;
  - `MediaResolver` and the post screen always fetch E8/E15 with `staleTime: 0`;
  - lists use one default `staleTime`;
  - `focusManager` and `onlineManager` are wired once in `src/app` from `AppLifecycle`.

#### M4 — AD-11 input and recovery budget are incomplete
- **Location:** AD-11; FR-15, FR-48, FR-51.
- **Problem:**
  - E8 needs both `blogUrl` and `postId`, but the resolver input is `{postId | blogUrl-stream, mediaId, …}`.
  - The «Продолжить» card opens the player directly (FR-15), so each Continue history entry must carry `blogUrl` and `postId`. The entry shape is not defined.
  - "Once automatically" is ambiguous over a two-hour video whose URL might expire twice.
  - The trigger for re-resolving on resume from sleep (FR-51) is undefined.
- **Suggested fix:**
  - Input `{kind: 'post', blogUrl, postId, mediaId} | {kind: 'stream', blogUrl}`.
  - Define `ContinueEntry` (`mediaId` key, `blogUrl`, `postId`, title, duration, position, `updatedAt`; no signed URLs).
  - Reset the automatic-recovery budget after N seconds of successful playback.
  - On foreground after background longer than T, or on the first play error, re-resolve through the same single path.

#### M5 — The app-wide single-audio rule has no owner
- **Location:** AD-2 (`PlayerEngine`); FR-39; EXPERIENCE.md › AudioBlock.
- **Problem:** "Only one track plays app-wide", "leaving the post stops audio" and "audio-focus loss pauses" need one coordinator. It is not specified whether the AudioBlock uses `PlayerEngine` (react-native-video) or something else, how audio interacts with opening the video player, or who handles audio focus. Each post-block story could mount its own player.
- **Suggested fix:** Add a `PlaybackCoordinator` (shared service) that owns the active audio session: one active source; it stops audio when the video player opens or the post unmounts; it handles audio focus through `PlayerEngine` events. AudioBlock uses `PlayerEngine` in audio-only mode.

#### M6 — List virtualization and image loading are not decided
- **Location:** Stack; Deferred ("Virtualization tuning"); NFR-5; FR-13, FR-36.
- **Problem:** Only tuning values are deferred. The primitive itself is not chosen: `FlatList`, FlashList, or a TV-specific list, and RN `Image` or a caching image library. Feed, grid, author, search and events stories will each pick one, and focus behavior with virtualization differs per primitive.
- **Suggested fix:** Pick one list primitive and one image primitive in `shared/ui` (for example a `FocusableList` wrapper over `FlatList` and RN `Image`), verify both in the spike, and require all lists and images to use them. Keep the numeric tuning deferred.

#### M7 — Diagnostics log storage and redaction strategy are undecided
- **Location:** AD-14; FR-54; SM-2 ("date-stamped local diagnostics entry for each forced re-login").
- **Problem:**
  - The `Logger` sink (logcat only, or a bounded on-device file?), retention and size cap are undecided.
  - Release vs debug behavior is undecided.
  - Whether logs are cleared on sign-out is undecided.
  - Whether the SM-2 re-login entries survive restarts is undecided.
  - Denylist redaction ("redacts tokens, … phone numbers, codes") is best-effort, and no test can prove it complete.
- **Suggested fix:**
  - Use structured logging with typed, allow-listed fields. Raw request or response bodies, headers and URLs are never logged; hosts and paths are logged only after query stripping.
  - Keep the regex redactor as a second line of defense.
  - Decide on a bounded ring-buffer file in app storage (device-scoped, cleared on sign-out except SM-2 entries), retrieved via `adb`.
  - Add a test that feeds known secrets through the Logger.

#### M8 — Testing strategy covers only unit and component tests
- **Location:** Consistency Conventions › Tests; NFR-9; CLAUDE.md › Tests.
- **Problem:** The spine does not choose:
  - the seam for integration tests (auth expiry, account isolation, source renewal, API shape change): a fixture transport behind `HttpClient`, MSW, or a mocked `fetch`;
  - how ADs are verified (lint for AD-1/2/12, tests for AD-3/4/6/10);
  - the reference to `docs/testing.md` for the device protocol and the rule that emulator results are not device verification.
- **Suggested fix:** Add a Testing row or AD:
  - integration tests run against an injectable `Transport` (the same seam as the AD-15 demo transport) with sanitized fixtures;
  - each AD lists its check (lint rule or named test);
  - device verification follows `docs/testing.md`, and P1 FRs are checked on the pinned device.

#### M9 — The platform and build envelope is missing
- **Location:** Stack; Structural Seed; Environments.
- **Problem:** The spine does not decide, defer or list as open:
  - `minSdkVersion` / `targetSdkVersion` (which Android TV OS versions are supported);
  - Hermes and the New Architecture (RN 0.87 is New-Architecture-only, so react-native-keychain 10, last published 2025-03, must work under it);
  - ABIs, `applicationId`, and build variants for debug, demo and release;
  - the Android Leanback/TV manifest requirements (FR-55).
- **Suggested fix:** Add an "Android envelope" row or AD with these decisions. Mark the library New Architecture compatibility as a spike-step-1 check.

#### M10 — Android auto-backup can copy account data off the device
- **Location:** AD-4, AD-14; NFR-1.
- **Problem:** With default `allowBackup=true`, AsyncStorage (Continue history, account id, filters if persisted) is backed up to the Google account and restored on another device. That is cross-device leakage of account-scoped data, and Keystore-backed secrets do not restore cleanly.
- **Suggested fix:** Add to AD-14: `android:allowBackup="false"` (or explicit data-extraction rules that exclude all app storage). Add a manifest check to the CI fixture/secret script.

#### M11 — Locked content vs the `NoAccess` error is ambiguous
- **Location:** AD-5; FR-37; api-contract §7.
- **Problem:** Entitlement is signaled in payloads (`hasAccess=false`, `teaser`, `subscriptionLevel`, E15 204 means no stream), not only through HTTP errors. Without a rule, some features will model a locked post as `AppError{NoAccess}` and others as a domain flag. The empty-state and error-state logic will then diverge.
- **Suggested fix:** State that payload entitlement is domain state (`Post.access: 'full' | 'locked'`, `LiveStream | null` for 204), mapped in repositories. `NoAccess` is reserved for a verified HTTP denial, for example the player's "media not entitled" case.

#### M12 — `docs/focus-map.md` is deferred into P1, but it is a cross-story contract
- **Location:** Deferred, `docs/focus-map.md`; AD-12; CLAUDE.md (explicit transitions in `docs/focus-map.md`).
- **Problem:** Zone transitions, initial focus and fallbacks are shared between the sidebar, sheets and every list screen. If the file is written "during P1", the first UI stories are built without it and diverge.
- **Suggested fix:** Make `docs/focus-map.md` a prerequisite of the first P1 UI story, or of the shell story, rather than a P1 deliverable.

### Low

#### L1 — The Capability map omits NFRs
- **Location:** Capability → Architecture Map.
- **Problem:** NFR-1…NFR-9 have no rows. NFR-5 (performance) and NFR-6 (Russian accessibility labels, 11 sp minimum) have no architectural home. NFR-6 should be built into the `shared/ui` primitives (a required `accessibilityLabel` prop).
- **Suggested fix:** Add NFR rows that point to the AD or convention governing each one. Make `accessibilityLabel` a required prop on focusable primitives.

#### L2 — `QrRenderer` as a platform port is speculative
- **Location:** AD-2.
- **Problem:** QR rendering via react-native-qrcode-svg is pure JS and SVG, not platform-specific. CLAUDE.md says "do not build speculative universal abstractions".
- **Suggested fix:** Make it a `shared/ui/QrCode` component. Keep ports for genuinely native behavior only.

#### L3 — Duplicated rules
- **Location:** AD-8 last bullet vs AD-9 (signed URLs never identity); AD-14 first bullet vs AD-3 (only SecureStore holds tokens); AD-11 auth-header rule, which is enforced in `HttpClient` (AD-3 territory).
- **Problem:** Duplicated rules drift when one copy is edited.
- **Suggested fix:** Keep each rule in one AD and cross-reference it from the others. Move the host allowlist into the `HttpClient` rule.

#### L4 — The enforcement mechanisms are not named
- **Location:** AD-1, AD-2, AD-7, AD-12; Stack.
- **Problem:** "ESLint import-boundary rule" names no plugin. AD-2 (no adapter imports), AD-7 (keys only from the factory) and AD-12 (the D-pad handler allowlist) state no enforcement.
- **Suggested fix:** Name the plugin, for example `eslint-plugin-boundaries` or `import/no-restricted-paths`, and add it to the Stack. Use `no-restricted-imports` with a file allowlist for `useTVEventHandler` and the adapters.

#### L5 — AD-3 status lacks a restoring state
- **Location:** AD-3 (`signedOut | signedIn | expired`).
- **Problem:** At cold start, `SecureStore` is read asynchronously. Without a `restoring` state the shell can flash Welcome or pick a non-deterministic initial focus (FR-12).
- **Suggested fix:** Add `restoring`. The shell renders a splash with no focusable elements until the status resolves.

#### L6 — AD-6 "one request in flight per entity" conflicts with E16 stop
- **Location:** AD-6; FR-23.
- **Problem:** The `stop=true` heartbeat on exit must be sent even if a periodic heartbeat is in flight. The rule's list of mutations also leaves E9's classification implicit.
- **Suggested fix:** Exempt the terminal `stop` heartbeat. State that E9 is governed by AD-10 (latest position wins, coalesced).

#### L7 — The owner exception and demo-mode auth are not recorded
- **Location:** AD-3, AD-15.
- **Problem:** The phone/code form is an owner-approved exception to the CLAUDE.md "no custom password form" rule (feature-parity §12 Q1), and the spine does not cite it. It also does not say how demo mode handles sign-in, whether it bypasses `SessionManager` or uses fake tokens.
- **Suggested fix:** Cite the exception in AD-3. State that demo mode runs a fixture-backed `SessionManager` with no real tokens and never touches `SecureStore`.

#### L8 — i18n runtime and release metadata are unverified
- **Location:** Consistency Conventions › i18n; AD-16.
- **Problem:** Hermes `Intl.PluralRules` and `Intl.DateTimeFormat` for `ru` on the target Android TV build are assumed, not verified. The `versionCode` increment rule is not stated next to `v{versionName}`.
- **Suggested fix:** Add the Hermes Intl `ru` check to spike step 1. State that `versionCode` increases monotonically with each release tag.
