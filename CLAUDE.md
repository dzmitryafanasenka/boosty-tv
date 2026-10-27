# CLAUDE.md

## Project and non-negotiable decisions
Build an independent, unofficial Boosty client for television. Working title: Boosty TV (placeholder, not approved branding). This is a new React Native application, not a Kotlin UI port and not a WebView wrapper.

- React Native + TypeScript strict + react-native-tvos.
- Android TV / Google TV only. Apple TV (tvOS) is out of scope (owner decision 2026-10-27): do not plan, build, test or keep code portable for it.
- Use the unofficial Boosty API. Access only content the signed-in user is entitled to access. No paywall or DRM circumvention.
- Product scope: feature parity with BoostBuddy, EXCEPT comments. No comment screens, comment actions, or comment API requests. Do not silently reduce parity to a video-only MVP.
- Do not copy BoostBuddy's interface. Its behavior/API implementation is a reference, not the UX target.
- Communicate with the owner in Russian. Code identifiers and technical documentation in English; initial application copy in Russian, with an i18n-ready structure.

## Sources and evidence
Reference repository: https://github.com/slartus/BoostBuddy
Reference discussion: https://4pda.to/forum/index.php?showtopic=1085976
TV framework: https://github.com/react-native-tvos/react-native-tvos

The repository README declares Apache-2.0; verify the relevant files and attribution requirements before reusing code. Do not import signing keys, credentials, analytics, branding, or unrelated assets from the reference repository.

Publicly described baseline features include subscriptions, posts feed, polls and voting, video quality selection, and saved playback progress. Repository structure also contains search, tags/filters, audio, settings, events and update-related code. File names alone do not prove that a feature is exposed or fully functional. Inspect actual behavior before defining exact parity.

## Mandatory first task: reference audit
Before implementing production screens:
1. Inspect the current reference branch/release and record commit SHA and audit date.
2. Trace screens, navigation, repositories, API methods, settings and player controls.
3. Create docs/feature-parity.md. For EVERY discovered user-facing capability record: feature, evidence (file/symbol or release reference), expected behavior, API dependency, Android status, tests.
4. Classify features as confirmed, inferred, or unverified. Distinguish reference parity from our improvements.
5. Explicitly inventory auth/session refresh/logout; subscriptions; feed; author pages; search scopes; pagination; filters/tags/sorting; text/images/attachments; audio/video; multiple media per post; polls/voting/results; events; settings; update behavior; player settings and progress persistence. Include only confirmed capabilities as parity obligations, and flag unknowns for investigation.
6. Mark comments as intentionally excluded. Do not omit other confirmed features without explicit owner approval. For platform-restricted behavior, preserve user intent and document the platform equivalent rather than blindly copying Android implementation.
7. Create docs/api-contract.md with verified endpoints, request/response shapes, auth, pagination, entitlement handling, expiry/error behavior and evidence. Never invent endpoints or a Boosty device-code authorization flow.
8. Report findings and a small implementation plan before large implementation work. An audit is not permission to expand scope to all Boosty website features.

## Stack and dependency policy
- Prefer the maintained React Native TV Community CLI template with native projects under version control. Do not use ordinary mobile React Native core in parallel with react-native-tvos. No Expo adoption without an explicit reason and owner approval.
- Resolve current compatible stable versions from primary documentation at initialization; record exact versions, package manager, runtime requirements and lockfile. Do not install everything at latest blindly.
- Prefer a TV-compatible native-backed video library (evaluate react-native-video first). Verify the chosen version supports the RN TV version on Android TV with a playback spike. Avoid writing a custom playback engine.
- Default candidates: TanStack Query for remote server state; Zod for boundary validation; Zustand only for truly shared UI/session state. Prefer local React state where adequate.
- Evaluate navigation and secure-storage libraries against the selected TV stack before adopting them. Do not assume mobile-only modules support Android TV.
- Prefer native focus facilities from react-native-tvos and TVFocusGuideView. Do not add a competing JS focus engine unless a reproducible problem justifies it and an ADR documents the decision.
- No backend required by default. Any auth companion service, proxy, analytics, or sync server requires a separate design and explicit approval.

## Architecture
Use a modular feature-based app, not an enterprise framework. Suggested layout:

src/app/                  # composition, providers, navigation
src/features/auth/
src/features/feed/
src/features/subscriptions/
src/features/author/
src/features/search/
src/features/post/
src/features/player/
src/features/polls/
src/features/settings/
src/shared/api/           # HTTP, DTO schemas, mapping, refresh coordinator
src/shared/domain/        # domain types and rules
src/shared/platform/      # secure session storage, player/lifecycle adapters
src/shared/focus/         # focus identity, restoration, shared focus components
src/shared/ui/            # TV controls and design tokens
src/shared/storage/       # non-secret preferences/progress
src/test/fixtures/        # sanitized responses

Adapt this layout to audited capabilities; avoid empty modules created just for appearance.

Rules:
- UI -> feature hooks/use cases -> repositories -> API/platform adapters.
- No HTTP calls, raw API DTO parsing or token handling in screen components.
- Stable content IDs and media IDs, not list indices, identify cards and playback progress.
- Separate server state, navigation state, focus state, session secrets and local preferences.
- Keep native modules and platform APIs behind narrow adapters in `src/shared/platform`. Do not build speculative universal abstractions.
- Model unavailable content, unsupported media, expired sessions and empty responses explicitly.
- Document significant choices in concise ADRs. Update docs when behavior changes.

## Authentication, API resilience and security
- First prove real sign-in, token persistence, session refresh and authorized video playback on Android TV.
- Investigate the reference implementation. Do not assume OAuth device authorization, QR sign-in, token refresh semantics or browser callbacks exist.
- Login via an official authentication page may require a dedicated Android adapter; the content UI must stay native. Never build a custom third-party-password collection form.
- The final login experience must work without a mouse. If current Boosty auth prevents this, report it as a release blocker with tested alternatives, not as a completed feature.
- QR/phone login is a RESEARCH OPTION, not a committed capability. Never show a working-looking QR/code screen without an implemented secure transfer flow. Document expiry, pairing, replay protection and secret handling before implementing a companion flow.
- Owner decision (2026-10-25, `docs/feature-parity.md` §12 Q1): the selected sign-in method is a native TV form for phone number + one-time code via Boosty's phone-auth API (AUTH-03, `docs/api-contract.md` §2.2). This is an explicit, approved exception to the "custom form" rule above, for this flow only. Never log the phone number, challenge or code, and never persist the challenge or code. The phone number may be persisted only in Keystore-backed secure storage to prefill re-login, and is wiped on logout (owner decision 2026-10-25). Phone input accepts any country code (E.164); `+7` is only a default. Captcha or rate limits that cannot be handled on TV are a release blocker. The website/WebView sign-in is fallback research only. The bans on password collection forms and on QR/companion sign-in still apply.
- Store session secrets using a verified secure native solution backed by Android Keystore. Never store tokens in plain AsyncStorage, URLs, logs, crash reports, screenshots, fixtures or git.
- Redact cookies, authorization headers, signed media URLs and personal data from diagnostics. Signing credentials remain outside the repository.
- Single-flight refresh; bounded retries; prevent refresh loops and request storms. Retry automatically only where safe. Voting and other mutations must not be blindly replayed.
- Differentiate unauthorized session, insufficient entitlement, expired media URL, unavailable content, rate limits and network failures based on verified responses. Never treat every 403 as an expired token.
- If media URLs expire, re-resolve media through verified API behavior and restore playback position with bounded recovery. Do not hardcode CDN URLs or blindly forward auth headers to third-party hosts.
- Parse defensively. Unknown post blocks must not crash the feed. Use sanitized contract fixtures.
- Isolate account-scoped cache/progress; logout clears credentials and sensitive caches. No cross-account leakage.

## TV experience: release requirements
Everything must work with D-pad, Select/OK, Back and available media keys. No hover-only actions, swipe-only interactions, mouse dependency or touch-sized controls.

- Every interactive component has default, focused, pressed, disabled and selected states where applicable. Selected navigation tab and current keyboard/remote focus are distinct.
- Show one clear focus target. Scaling must not reflow layouts or clip focus rings.
- Initial focus is deterministic; keep focus stable during refetch, pagination, image loading and background updates.
- Restore route, scroll position and focused content ID after leaving a post/player. If the item disappeared, choose a documented nearby fallback.
- Restore focus after modal close; background controls cannot receive focus behind a modal. No accidental focus traps.
- Explicit transitions between sidebar, filters, rows, grids and dialogs. Describe them in docs/focus-map.md.
- Long lists are virtualized, with stable keys and focus-safe loading. Test hundreds of entries.
- Back closes the current transient overlay first, then navigates; define behavior at each layer and at the root. No invisible overlays consuming input.
- Search can use the TV system keyboard. Voice search is not required unless audited and deliberately scoped.
- All screens include loading, empty, recoverable-error and authorization/entitlement states where relevant.
- No autoplaying promotional hero. Make accessing subscribed content fast.

## Media and posts
- Support confirmed reference media/content capabilities, not only video. Audit audio, text, images, attachments, embedded/external sources and polls explicitly.
- A post can contain multiple media items. Keep the selected media and progress separate.
- Player minimum: play/pause, seek, elapsed/remaining time, quality selection when offered, resume/start over, buffering/error/retry, title/author, remote media keys.
- Audit speed selection, subtitles, audio tracks, aspect ratio, autoplay and external players; implement confirmed parity and expose options only when supported. Do not invent unavailable track/quality options.
- Persist progress periodically (throttled), on pause, exit and lifecycle changes; avoid continuous storage writes. Store content/media identity and position, never a signed media URL as the identity.
- Quality changes and media URL recovery preserve position where the stream supports it. Live/non-seekable sources must have honest controls.
- Overlay auto-hide must not dismiss active settings, scrub interactions, accessibility use or error dialogs. Define Back behavior for settings -> controls -> player exit.
- Handle sleep/resume, network loss, decoder errors and audio focus using the native player's supported APIs. Release resources when playback ends or the player unmounts.
- Polls include loading, selection, submitting, success, failure, already-voted and closed states, subject to verified API rules.
- Comments are excluded everywhere. Do not add comment counters as dead-end navigation.

## Design implementation
Use design artifacts from Claude Design as visual/interaction specifications, not as a production web codebase. React DOM, CSS and browser focus are not React Native TV implementations.

- Implement tokens and shared TV primitives first; translate design coordinates to logical layout units. A 1920x1080 design frame is NOT a requirement to hardcode 1920x1080 RN units.
- Initial visual direction: dark, calm, high contrast, restrained warm accent; readable Russian typography, generous spacing and 16:9 media cards.
- Keep artwork legible, avoid busy glassmorphism, tiny text, excessive motion and full-screen empty decoration.
- Do not represent speculative capabilities as implemented. Design can label conditional patterns, but production UI must reflect real capabilities.

## Delivery phases
0. Audit/reference matrix, API contract, dependency compatibility and real-device auth/playback spike.
1. Android vertical slice: sign in -> subscriptions/feed -> post -> authorized video -> resume -> return with restored focus.
2. Complete Android parity except comments: implement all confirmed remaining capabilities and settings from the matrix.
3. Android polish: error/lifecycle cases, performance, accessibility, visual fidelity, release build and real-device regression.

Do not call phase 1 a feature-complete release.

## Tests and definition of done
- Unit tests: DTO/domain mapping, refresh coordination, pagination merge, filter state, progress identity/persistence and poll mutation rules.
- Component tests: visible focus state, locked cards, empty/error UI, modal lifecycle and relevant accessibility labels.
- Integration tests: auth expiry, API shape changes, playback source renewal and account isolation using sanitized mocks.
- Real Android TV device/emulator checks: D-pad-only login and browsing, long lists, filter apply/reset, keyboard close, multiple media, quality change, resume, poll vote, Back hierarchy, sleep/resume, network interruption, logout/relogin.
- JS component tests do not prove native focus or decoder behavior. Never claim physical-device verification if only mocks or an emulator were used.
- Android release build must install and appear in the TV launcher with correct TV manifest/banner assets and no mandatory touchscreen requirement.
- Pin a test device and build configuration in docs/testing.md. Chromecast with Google TV 4K is a candidate; confirm the available hardware with the owner.
- The template's tvOS target is unused and unsupported; never report Apple TV status as implemented or validated.

For every completed task report: changes, checks actually run, results, unresolved risks and next smallest step. If a toolchain/device is unavailable, report that explicitly.

## Agent working rules
- Read existing files and project instructions before editing. Keep changes small and verifiable.
- Do not invent API endpoints, package compatibility, CLI commands, feature support, screenshots or successful test results.
- Do not replace real integration with permanent mocks and call the task done. Keep an explicit development-only demo mode if useful.
- Do not add comments functionality, billing, donations, account registration, content creation, multi-profile support, cloud sync or tracking unless reference parity requires it or the owner explicitly approves it.
- If a confirmed parity feature conflicts with a proposed exclusion or platform limit, document and ask; do not silently drop it.
- Do not download/install app updates silently. Audit reference update behavior; document a safe Android distribution approach.
- No publishing, credential export, destructive changes or unrelated refactoring without approval.

## Spec-driven workflow (BMAD)
BMAD Method v6.12.4 (modules: bmm, bmb) is installed in `_bmad/`, with Claude Code skills in `.claude/skills/bmad-*`. Development follows spec-driven flow through BMAD: product brief -> PRD -> UX -> architecture -> epics/stories -> build -> review.

- This file overrides BMAD defaults and agent personas whenever they conflict (scope, exclusions, security, TV requirements, phases).
- Existing audit docs are mandatory inputs to every BMAD planning step: `docs/feature-parity.md` (including owner decisions in §12), `docs/api-contract.md`, `docs/android-tv-auth-playback-spike.md`, `docs/testing.md`. PRD requirements must trace to feature-parity IDs or be marked as our improvements.
- Planning and implementation artifacts go to `_bmad-output/`; long-term project knowledge stays in `docs/`. Artifacts are written in English.
- Claude Design output feeds the BMAD UX step as a visual specification, not as code.
- BMAD stories must not start production implementation before phase 0 (the auth and playback spike) passes, unless the owner says otherwise.
- `_bmad/config.toml` and `_bmad/config.user.toml` are installer-managed; put durable overrides in `_bmad/custom/config.toml`. `_bmad/custom/config.user.toml` is personal and must not be committed.
