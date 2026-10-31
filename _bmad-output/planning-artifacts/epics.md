---
status: final
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-boosty-tv-2026-10-25/prd.md
  - _bmad-output/planning-artifacts/prds/prd-boosty-tv-2026-10-25/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-boosty-tv-2026-10-25/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/EXPERIENCE.md
  - _bmad-output/planning-artifacts/design/claude-design-v1/docs/focus-map.md
  - _bmad-output/planning-artifacts/design/claude-design-v1/docs/handoff-rn-tv.md
  - docs/android-tv-auth-playback-spike.md
  - docs/testing.md
  - docs/api-contract.md
  - docs/feature-parity.md
  - docs/adr/0001-react-native-tvos-0-87-bootstrap.md
  - docs/adr/0002-secure-storage-keychain.md
  - docs/adr/0003-navigation-react-navigation.md
  - docs/adr/0004-progress-ownership-and-resume.md
---

# Boosty TV - Epic Breakdown

## Overview

This document breaks down the requirements from the PRD, the UX design contract (DESIGN.md and EXPERIENCE.md) and the architecture spine into implementable stories.

Phase tags follow CLAUDE.md:
- **P0** — spike;
- **P1** — vertical slice, which is the MVP;
- **P2** — full parity;
- **P3** — polish and release.

Production implementation does not start before P0 passes.

Apple TV (tvOS) is out of scope (owner decision 2026-10-27).

**As-built reconciliation (2026-10-31, Epic 7 retro A3 and Epic 3 retro A9; `_bmad-output/implementation-artifacts/spec-epic-7-retro-a3-planning-reconcile.md`).** Epics 3, 5, 6 and 7 are done. Where a later owner decision changed a story, the original text stays and an **As built** note follows it. Each note names its evidence: a story spec in `_bmad-output/implementation-artifacts/`, an ADR in `docs/adr/` or the code. The story specs, `docs/focus-map.md` and `docs/feature-parity.md` are the detailed record.

## Requirements Inventory

### Functional Requirements

The full text and testable consequences are in `prd.md` §4.

- FR1 [P1]: The user signs in with a phone number (editable country code, E.164) and a one-time code. Resend is available after 60 s and the number can be changed. A4, A7–A10 are distinct states. Sign-in completes only after E1 succeeds. The phone, challenge and code are never logged.
- FR2 [P1]: Captcha or extra verification is shown as a blocking state with one retry. There are no workarounds; this counts as a release blocker.
- FR3 [P1]: The session survives restart and reboot. Tokens live only in secure storage.
- FR4 [P1]: Token refresh is silent and single-flight: proactive when < 300 s remain, and once after a 401. There are no loops or storms.
- FR5 [P1]: After a 401 and a failed refresh, the app shows «Сессия истекла» with a best-effort progress write, then re-login, then Главная.
- FR6 [P1]: The last phone number is stored in secure storage to prefill re-login. It is wiped on sign-out or account switch.
- FR7 [P1]: Account switch (a different E1.id) wipes history, cache, filters and the stored phone before showing Главная.
- FR8 [P1]: Sign-out goes through a confirm dialog («Отмена» is the default focus) and clears every account-scoped item. There is no server revoke.
- FR9 [P1]: Sidebar sections open on OK only. Current and focused states are distinct. Only the sections for the current phase are shown, and События is hidden until E18 is verified. *As built: E18 was verified live in Story 7.5 and События is shown (`phaseFlags.events` on).*
- FR10 [P1]: Back hierarchy: layers (keyboard, dialog, sheet, overlay) first, then content → sidebar → Главная → exit. Errors appear as inline or screen states, not missable toasts.
- FR11 [P1]: Focus and scroll are restored by id after returning from a post or the player, with a documented fallback chain. Refetch never moves focus.
- FR12 [P1]: Initial focus is deterministic. Dialogs and sheets trap focus and return it to the initiator. There is no wrap-around.
- FR13 [P1]: The subscription feed uses opaque cursor pagination, dedups by post.id and shows an inline load-more retry. Smooth with hundreds of items.
- FR14 [P1]: Post-type cards show a type badge, a 2-line title, author, date, and duration/progress when known. No comment counts.
- FR15 [P1]: The «Продолжить просмотр» row: at most 20 entries, one per media id, newest first. An entry is removed when finished, on sign-out or on account switch. Labelled «на этом устройстве».
- FR16 [P2]: «Обновить» reloads the feed and subscriptions and keeps focus. *As built (Story 5.1, ADR 0010): a forced head refresh. One E5 page 1 is merged into the cached feed, and the subscriptions query is invalidated. The infinite query is never refetched.*
- FR17 [P2]: The feed can be filtered by access, period and tags.
- FR18 [P1]: Subscription grid that opens an Author. The empty state has no CTA. A «Показаны первые 30» note appears when needed.
- FR19 [P2]: «Мой блог» appears first if the account owns an Author with at least one post.
- FR20 [P1]: Author page with header (title, owner, avatar) and paginated posts.
- FR21 [P2]: Live stream card: live, scheduled (refreshed every 30 s) or needs a level (name only, no price). 204 means no card. *As built (Story 7.1, Q1 a): E15 is polled every 30 s for a live card and for a scheduled one, while the Author route is focused and the app is in the foreground.*
- FR22 [P2]: Watch a live stream: no seek, pause resumes at the live edge, 1× speed, «Стрим завершён». A QR is shown if the stream is not playable.
- FR23 [P2]: Live viewer heartbeat every 30 s, plus stop=true on exit.
- FR24 [P2]: Like or unlike a live stream optimistically, with rollback. One request in flight, no replay. *As built (Story 7.4, Q2 a): «Нравится» is shown only on a live card with access. «Поделиться» (FR25) is shown on every card.*
- FR25 [P2]: Share a live stream via QR.
- FR26 [P2]: Search in subscriptions with the system keyboard and the «по подпискам» label. The query and focus are restored.
- FR27 [P2]: Search within an Author.
- FR28 [P2]: Access filter: «Доступные мне» (default), «Все посты» or «Только купленные». *As built (Story 5.7, A a): Автор offers only «Доступные мне» and «Все посты», because E4 ignores `only_bought=true` (live).*
- FR29 [P2]: Period filter: presets, or a custom period set with D-pad steppers. Local day bounds become from_ts/to_ts.
- FR30 [P2]: Tag filter, multi-select. Feed tags are paginated (E13); Author tags come from E14.
- FR31 [P2]: Filters apply immediately. «Сбросить» resets them. The filter chip shows the active count.
- FR32 [P1]: Post screen: author (opens the Author), title, date, read-only likes, «Смотреть/Продолжить», and «С начала» when progress is > 0. Fetched with E8 and comments_limit=0.
- FR33 [P1]: Multiple Media per post, each with its own row, progress and status. The primary action targets the first unfinished Media.
- FR34 [P2]: Rich text (bold, italic, underline) and inline emoji. Long text collapses; expanded paragraphs are focus stops. *As built (Story 6.1, owner decision 2026-10-29 Q1 a): there is no collapse. Every paragraph is a focus stop, and a long paragraph is split into stops of at most 600 characters.*
- FR35 [P2]: Links, external video and files appear as chips that open a QR. Signed URLs are never logged. *As built (Story 6.3, owner decisions 2026-10-29; our improvements): a link to another Boosty post opens that post in the app («· Открыть»). A timestamp link to a video of the current post opens the player at that second («· Смотреть»).*
- FR36 [P2]: Images render inline as focus stops, with a placeholder on failure.
- FR37 [P1]: Locked post: teaser plus no-access copy (level name only). No price, payment or subscribe UI.
- FR38 [P1]: Unknown or malformed blocks show a placeholder or are skipped. They never crash a screen.
- FR39 [P2]: Inline audio: play, pause and seek (url + signedQuery). Only one track plays app-wide. Audio stops when leaving the post and pauses on focus loss. Position is not persisted.
- FR40 [P2]: Poll display: title, options with percent, voter count, chosen options and the finished state.
- FR41 [P2]: Single-choice vote and retract need two OK presses on the same option. The poll is re-fetched afterwards. On error the previous state is kept and nothing auto-retries.
- FR57 [P2]: Multiple-choice: toggle options, then «Проголосовать». «Отозвать голос» needs two OK presses.
- FR42 [P1]: Play HLS, DASH and MP4 from playerUrls without auth headers to the CDN. Source order: the preferred quality, otherwise HLS > DASH > highest progressive.
- FR43 [P1]: Resume from the local position if one exists, otherwise from the server timeCode. «С начала» starts from 0.
- FR44 [P1]: Progress writes (E9, integer seconds): every ≥ 10 s of movement and on pause, background, exit and end. The local copy goes to the Continue history.
- FR45 [P1]: Overlay shows the post title, video title, author, timeline and elapsed/remaining time. ←/→ seek 5 s with acceleration; media keys work; Menu opens the settings. The overlay never hides while paused, seeking, with a sheet open or in an error.
- FR46 [P1]: Quality list shows available variants only. Adaptive streams appear as «Авто» (a resolution suffix only if reported). Switching keeps the position, the preference is stored, and the settings live in a side sheet.
- FR47 [P2]: Speed presets 0.5–3× for VOD, stored globally.
- FR48 [P1]: Expired-URL recovery: re-fetch, match by media id, keep the same quality and position. One automatic attempt, then «Повторить/Назад».
- FR49 [P1]: Finished = ≥ 95 % or < 30 s left. A finished item is marked and removed from the Continue history without interrupting playback. At the actual end, write the progress and return to the origin. No autoplay.
- FR50 [P2]: «Системный видеоплеер» opens a quality pick, then the Android chooser. No progress is tracked in this mode. Falls back to the built-in player.
- FR51 [P1]: Lifecycle: on sleep or background, pause and write progress. On return, show the paused overlay and re-resolve the URL if needed. Release resources on exit.
- FR52 [P2, gated]: Events list after E18 is verified. «Начался эфир» opens the Author with the live card focused. *As built (Story 7.5): E18 was verified live, and the gate is on.*
- FR53 [P1 minimal / P2 full]: Настройки. P1: version and «Выйти из аккаунта». P2: «Системный видеоплеер».
- FR54 [P2]: Diagnostics opens after 7 OK presses on «Версия». Redacted log capture, retrieved via adb.
- FR55 [P3]: A signed release APK installs on Google TV with banner and launcher entry. It is published in a GitHub Release of the public repo. The key stays outside the repo.
- FR56 [P3]: Update check against GitHub Releases: at most daily, plus on «Версия» at most once per 60 s. Shows a notice and a QR. Never downloads or installs.

### NonFunctional Requirements

- NFR1 Security: secrets only in secure storage. Redact cookies, auth headers, signed URLs and personal data. Never disable TLS validation. Never forward auth to third-party hosts.
- NFR2 Error semantics: distinguish session expired, no access, expired media URL, 404, 429 and network, using verified responses only. A 403 is never treated as session expiry.
- NFR3 Resilience: bounded GET retries with backoff. Mutations are never replayed blindly; E9 is sent with the latest position only.
- NFR4 Defensive parsing: boundary validation and graceful degradation. Sanitized fixtures cover feed, post, poll, stream, auth and errors.
- NFR5 Performance: smooth D-pad scrolling with hundreds of items. A time-to-first-frame target is set after the spike.
- NFR6 TV accessibility: remote-only. Russian accessibility labels. Contrast per DESIGN.md. Minimum text size 11 sp.
- NFR7 Localization: Russian copy with an i18n-ready structure. Code and docs in English.
- NFR8 Platform boundaries: domain and API layers do not call native modules or platform APIs directly. Android behind ports.
- NFR9 Verification: unit, component and integration tests per CLAUDE.md. Every P1 FR is verified on the physical device. Emulator and mock results are never reported as device verification.

### Additional Requirements

From the architecture spine, ADRs, spike plan and testing.md:

- **Bootstrap (Epic 1, Story 1):** use the community template `--version 0.87.1` with `react-native` aliased to `react-native-tvos@0.87.1-1` (ADR 0001). Pin exact versions and commit the npm lockfile. Use TypeScript strict from the template. Set up the TV manifest by hand: LEANBACK_LAUNCHER, banner, touchscreen required=false, allowBackup=false, no cleartext traffic. New Architecture only. Two variants: debug and release.
- **Phase 0 spike first:** scenarios S1–S11 from `docs/android-tv-auth-playback-spike.md`, step 1 compatibility checks, and the results in docs/testing.md and api-contract (`LIVE` evidence). Every fallback gets an ADR.
- **Structure and boundaries:** the `src/app`, `features/*` and `shared/*` layout from the spine. eslint-plugin-boundaries enforces AD-1, including the allowlisted edges post→polls and post→player via index.ts. CI fails on violations.
- **Platform ports** (AD-2): SecureStore, KeyValueStore (device/account scope), PlayerEngine (seconds), AppLifecycle, ExternalPlayer and QrRenderer, with Android adapters.
- **SessionManager** (AD-3): sole token owner with single-flight refresh. `expired` only when refresh is rejected. Recovery from SecureStore corruption.
- **AccountScope** (AD-4): eager registration in `app/bootstrap.ts`, a generation counter that drops stale async writes, and a device vs account scope split.
- **Errors and retries:** the AppError and AuthError taxonomies (AD-5) and the retry table (AD-6).
- **Server state** (AD-7): TanStack Query with the queryKeys factory, the poll single source through applyPoll, the stream key, staleTime 60 s, gcTime 10 min, and resume invalidation. *As built (ADR 0010, Stories 7.1, 7.5): on resume, paged lists get a head refresh and are never invalidated. The stream and events queries use `staleTime: 0` and are invalidated on resume. E15 is polled every 30 s.*
- **Shared entities** (AD-8): repositories and one mapper per DTO for Post, Media, Author, Poll and Stream. Zod 4 lives at the boundary only. Domain types never expose timeCode.
- **Media references** (AD-9): MediaRef and LiveRef. Signed URLs never go into routes or storage.
- **ProgressRepository** (AD-10): begin with meta, report, resumePoint (local wins), finished computation and the useProgress hook.
- **MediaResolver** (AD-11): one automatic recovery. Auth headers go to api.boosty.to only.
- **FocusRestoration** (AD-12): keyed by route and section, with a setReturnFocus API. An English `docs/focus-map.md` is written **before the first UI story**.
- **Navigation model** (AD-13): a root native-stack plus a Shell with in-place sections, and one modal host. *As built: a JS stack (`@react-navigation/stack`, ADR 0007, after the Story 1.2 native-stack defect), as the spine's AD-13 already says. Автор and Пост keep the Shell sidebar (ADR 0012).*
- **Logger and hardening** (AD-14): Logger with redaction and a ring buffer plus a capped file. A fixture sanitization check runs in CI.
- **FixtureTransport** (AD-15): serves the debug demo mode («ДЕМО» badge) and integration tests. A release build fails if the flag is on.
- **Release and CI** (AD-16): CI runs lint, typecheck, tests and a debug build only. Local release signing. Tag `v{versionName}`.
- **Routes** (AD-17): `app/routes.ts` with typed id-only params (Post, Player {ref, origin}, Author).
- **Filters** (AD-18): the Filter model with a symbolic period, and one filtersStore per scope (feed, search, author:<blogUrl>), in memory and account-scoped.
- **PlaybackArbiter** (AD-19): a single playback slot.
- **Phase flags** (AD-20): `app/phaseFlags.ts` gates sections and entry points.
- **i18n:** a typed ru catalog and a hand-written ru plural selector (Hermes has no Intl.PluralRules).
- **Lists and images:** FlatList with getItemLayout and RN Image. FlashList is only considered in P3. *As built (ADR 0011, owner decision 2026-10-26, from device profiling in Story 3.1): the post grids (Главная, Автор, Поиск), Подписки and События use FlashList 2.3.3. These are rows of 3 cards with a fixed row height; FlashList v2 has no `getItemLayout`. The tag list in the filter sheet stays a FlatList.*
- **Tests:** Jest with @react-native/jest-preset, plus RNTL 14 and test-renderer. Mapper fixture tests.
- **Device:** Chromecast with Google TV 4K. Record the OS, patch and WebView versions and the reported dp in docs/testing.md.

### UX Design Requirements

From DESIGN.md and EXPERIENCE.md:

- **UX-DR1:** DESIGN.md tokens in `shared/ui/tokens.ts`: colors (including live #BE382F and qr-bg), typography with absolute lineHeights, rounded, spacing (safe area 48/27, sidebar 168, content 720, card 168), focus, motion. Bundle the Golos Text font.
- **UX-DR2:** FocusableSurface primitive: ring 2/offset 2, a surface lift and a per-component scale via transform (no reflow), pressed scale 0.98, disabled not focusable, «reduce motion» respected.
- **UX-DR3:** Sidebar/NavItem: always expanded; current state (accent bar) distinct from the focused state.
- **UX-DR4:** Button: primary, secondary, ghost and icon-only; normal and small sizes; optional sub-label and count; a spinner while busy that keeps focus.
- **UX-DR5:** TextField for phone, code and search: border-only focus with no scale; error state; an editable country code for phone.
- **UX-DR6:** PostCard with all type badges, the locked variant, optional duration and progress, a 2-line title and meta.
- **UX-DR7:** AuthorCard with the optional «Мой блог» label.
- **UX-DR8:** LiveCard in three states (live, scheduled, needs level), with «Нравится» and «Поделиться». *As built (Story 7.4, Q1 a, Q2 a): the buttons sit in a column to the right of the card. «Нравится» is a heart plus the count, shown only on a live card with access. «Поделиться» is shown on every card.*
- **UX-DR9:** MediaRow with status («Не начато», «Осталось N мин», «Просмотрено») and progress.
- **UX-DR10:** Post layout: a left column (author, title, date · likes, buttons) and a right column (media rows, blocks), scrolling independently. *Superseded (owner decision 2026-10-27, `spec-post-header-layout.md`): one vertically scrolling column. The header comes first (author row, title, date · likes, then the buttons or the locked copy) and scrolls away with the content. Then come the media rows at full content width, then the body, with text capped at `text-measure` (600 dp).*
- **UX-DR11:** Blocks: ParagraphStop, ImageBlock (max height 300, placeholder), LinkChip (QR), LikeCount (not focusable), and an unsupported-block placeholder.
- **UX-DR12:** AudioBlock as a single focus target: OK plays or pauses, ←/→ seek 10 s.
- **UX-DR13:** PollOption states: default, chosen, pending («Нажмите OK ещё раз»), sending, finished, inline error.
- **UX-DR14:** Player overlay: top band (avatar, author, titles) and bottom band (Timeline with bubble and elapsed/remaining, PlayerControls), a legibility gradient. Live variant with a LIVE badge and no track.
- **UX-DR15:** SideSheet in two widths (filters 320, player 340), trapping focus. Filter panel, PeriodStepper and TagRow sit inside it.
- **UX-DR16:** Dialog and QrDialog (QR on white, «Откроется на телефоне», the full URL never printed), plus the sign-out dialog with «Отмена» as the default.
- **UX-DR17:** StateView (icon, title, text, one action) for empty, error, no access, offline, unavailable and rate-limited states. Skeleton geometry matches the cards and rows.
- **UX-DR18:** Sign-in screens A1–A11, including the resend countdown, prefilled re-login and the captcha blocker.
- **UX-DR19:** Voice and tone: the copy catalog from EXPERIENCE › Voice and Tone, errors keyed by kind, and the locked-post copy with no CTA.
- **UX-DR20:** Focus map: an English `docs/focus-map.md` derived from the design focus-map and EXPERIENCE, normative per screen (initial focus, arrows, OK, Back, restoration).
- **UX-DR21:** Accessibility labels in Russian for every focusable element (e.g. «Видео. {title}. {author}, {date}. Осталось {n} минут»). Contrast pairs as in the DESIGN.md table.
- **UX-DR22:** The «ДЕМО» badge is visible whenever FixtureTransport demo mode is on.

### FR Coverage Map

- FR1: Epic 2
- FR2: Epic 2
- FR3: Epic 2
- FR4: Epic 2
- FR5: Epic 2
- FR6: Epic 2
- FR7: Epic 2
- FR8: Epic 2
- FR9: Epic 2
- FR10: Epic 2
- FR11: Epic 2
- FR12: Epic 2
- FR13: Epic 3
- FR14: Epic 3
- FR15: Epic 4
- FR16: Epic 5
- FR17: Epic 5
- FR18: Epic 3
- FR19: Epic 5
- FR20: Epic 3
- FR21: Epic 7
- FR22: Epic 7
- FR23: Epic 7
- FR24: Epic 7
- FR25: Epic 7
- FR26: Epic 5
- FR27: Epic 5
- FR28: Epic 5
- FR29: Epic 5
- FR30: Epic 5
- FR31: Epic 5
- FR32: Epic 3
- FR33: Epic 3
- FR34: Epic 6
- FR35: Epic 6
- FR36: Epic 6
- FR37: Epic 3
- FR38: Epic 3
- FR39: Epic 6
- FR40: Epic 6
- FR41: Epic 6
- FR42: Epic 4
- FR43: Epic 4
- FR44: Epic 4
- FR45: Epic 4
- FR46: Epic 4
- FR47: Epic 8
- FR48: Epic 4
- FR49: Epic 4
- FR50: Epic 8
- FR51: Epic 4
- FR52: Epic 7
- FR53: Epic 2 (P1 part), Epic 8 (P2 part)
- FR54: Epic 8
- FR55: Epic 9
- FR56: Epic 9
- FR57: Epic 6
- NFR1–4, NFR6–9: cross-cutting; they become acceptance criteria in every relevant story. NFR5: Epic 9 (with smoothness checks in Epics 3–4).
- Phase 0 spike (Epic 1) validates the assumptions behind FR1–4, FR42–44, FR48 and FR51. It closes no FR by itself.

## Epic List

### Epic 1: Prove it on the TV (P0)
Set up the production project skeleton, then run the throwaway spike on the Chromecast with Google TV 4K:
- phone sign-in;
- session persistence and refresh;
- entitled video playback and resume;
- library compatibility.

Results go to docs/testing.md, api-contract `LIVE` evidence, ADRs for any fallback, and an English docs/focus-map.md.
**FRs covered:** none directly. Validates FR1–4, FR42–44, FR48 and FR51; produces the inputs that every later epic needs.

### Epic 2: Sign in once and stay signed in (P1)
The family signs in by phone and code once, stays signed in across restarts and token expiry, and lands in a remote-friendly shell with sidebar, Back and focus behavior. They can sign out, or re-login when the session expires. Switching accounts never leaks data. Shared foundations land here first: tokens, focus primitive, SessionManager, AccountScope, errors and Logger.
**FRs covered:** FR1–FR12, FR53 (P1 part)

### Epic 3: Find and open a post (P1)
The family browses the subscription feed, the subscriptions grid and author pages, and opens a post. The post shows its media rows, handles locked content honestly and never breaks on unknown blocks.
**FRs covered:** FR13, FR14, FR18, FR20, FR32, FR33, FR37, FR38

### Epic 4: Watch and resume (P1)
The family plays a video with the remote: quality choice, seeking and media keys. Playback resumes exactly where anyone stopped, recovers silently from expired links and survives sleep. A finished video leaves «Продолжить просмотр».
**FRs covered:** FR15, FR42, FR43, FR44, FR45, FR46, FR48, FR49, FR51

### Epic 5: Search, filters and refresh (P2)
The family searches subscriptions or a single author, filters by access, period and tags, refreshes the feed, and sees «Мой блог».
**FRs covered:** FR16, FR17, FR19, FR26–FR31

### Epic 6: The complete post (P2)
Posts render rich text, emoji and images. Links, files and external video open via QR. Audio plays inline. Polls can be voted on and votes retracted.
**FRs covered:** FR34, FR35, FR36, FR39, FR40, FR41, FR57

### Epic 7: Live streams and events (P2)
The family sees an author's live or scheduled stream, watches it live, likes and shares it, and learns about new streams from События, which appears once E18 is verified.
**FRs covered:** FR21–FR25, FR52

### Epic 8: Viewing preferences and diagnostics (P2)
The family can change playback speed and use the system player. The owner gets full Настройки and hidden diagnostics for testing.
**FRs covered:** FR47, FR50, FR53 (P2 part), FR54

### Epic 9: Ready for the family (P3)
A signed release is installed from GitHub Releases, update notices work, performance is tuned and measured, visual fidelity is checked against the mocks, and the full device regression passes.
**FRs covered:** FR55, FR56 (plus NFR5)

## Epic 1: Prove it on the TV (P0)

Set up the production project skeleton. Then show, on the Chromecast with Google TV 4K, with throwaway spike code on a separate branch, that each of the following works with the real Boosty API:
- phone sign-in;
- session persistence and refresh;
- entitled playback and resume;
- the chosen libraries.

Record the evidence before any production feature work starts.

### Story 1.1: Production project skeleton

As the owner,
I want a buildable React Native TV project with the agreed structure and checks,
So that every later story starts from the same verified foundation.

**Acceptance Criteria:**

**Given** an empty repository folder (with the existing `docs/`, `_bmad/` and planning artifacts preserved)
**When** the project is created with the community CLI template `--version 0.87.1` and `react-native` is aliased to `npm:react-native-tvos@0.87.1-1` (ADR 0001)
**Then** `npm ci` and the Android debug build succeed with exact pinned versions and a committed `package-lock.json`
**And** the exact bootstrap commands, Node, JDK and Android SDK versions are recorded in `docs/testing.md`.

**Given** the Android manifest
**When** it is inspected
**Then** it has `LEANBACK_LAUNCHER`, a placeholder TV banner, `touchscreen required=false`, `allowBackup=false` and cleartext traffic disabled, and there are `debug` and `release` variants.

**Given** the `src/app`, `src/features`, `src/shared` and `src/test/fixtures` layout from the spine
**When** `npm run lint` runs
**Then** `eslint-plugin-boundaries` fails on a deliberately added forbidden import (feature→feature outside the allowlist, or shared→features), and the check passes once it is removed.

**Given** the TypeScript and test setup
**When** `npm run typecheck` and `npm test` run
**Then** strict TypeScript passes, and Jest (`@react-native/jest-preset`, RNTL 14 and `test-renderer`) runs one sample component test.

**Given** a GitHub Actions workflow
**When** it runs on a push
**Then** it executes lint, typecheck, tests and the debug build only, with no signing secrets, and fails on any error.

**Given** `.gitignore`
**When** it is checked
**Then** keystores, `*.jks`, `.env*`, local signing configs and spike credentials are excluded. (Initialising git and creating the public GitHub repository are done by the owner, or only with the owner's explicit approval.)

**Given** the debug APK is installed on the test device
**When** it launches from the Google TV home screen
**Then** a placeholder screen with one focusable button is shown and reachable with the D-pad, and the device's reported window size in dp is recorded in `docs/testing.md`.

### Story 1.2: Library compatibility on the device

As the owner,
I want the chosen libraries proven on the real TV before features depend on them,
So that incompatibilities surface now as ADRs, not mid-feature.

**Acceptance Criteria:**

**Given** the project skeleton from 1.1, on a spike branch
**When** a two-screen React Navigation native-stack demo runs on the device
**Then** D-pad focus moves predictably, Back pops the stack, and the focused element survives a push and pop, and the result (pass or fail with details) is recorded in `docs/testing.md`.

**Given** react-native-keychain 10
**When** a value is saved, the app is killed and the device rebooted
**Then** the value is read back
**And** a simulated read failure (corrupted store) goes through the wipe-and-sign-out recovery path without a crash.

**Given** react-native-video 6.19
**When** a public test HLS stream, a DASH stream and an MP4 are played
**Then** each plays, seeks, changes rate and reports errors, with the outcome recorded.

**Given** Hermes in a release-like build
**When** Zod 4 parses a fixture and the hand-written ru plural selector formats 1/2/5/11/21
**Then** both work, and the Zod jitless need is recorded.

**Given** react-native-qrcode-svg
**When** a QR for a long URL renders offline
**Then** a phone camera scans it correctly.

**Given** any check fails
**When** the fallback named in the spine is chosen
**Then** a new ADR in `docs/adr/` records the decision, and the spine's Stack row is updated.

### Story 1.3: Spike — phone sign-in and token persistence

As the owner,
I want to sign in on the TV with my phone number and a code and stay signed in after a restart,
So that we know the chosen sign-in method really works before building it.

**Acceptance Criteria:**

**Given** a spike-only screen on the spike branch
**When** I enter my `+375` number and the received code with the remote and the system keyboard
**Then** E-phone send and confirm return tokens, and `GET /v1/user/current` succeeds (scenario S2).

**Given** wrong-code, expired-code, too-soon-resend and repeated-attempt cases
**When** each is triggered once (no abuse)
**Then** the status code and sanitized body shape of each are recorded in `docs/api-contract.md` with `LIVE` evidence, and where the code was delivered is noted.

**Given** Boosty demands a captcha or extra verification
**When** it happens
**Then** it is reported to the owner as a release blocker with what was observed, and S1 (website sign-in) is run as research.

**Given** tokens stored via keychain
**When** the app is killed, cold-started and the device rebooted
**Then** the session is restored without signing in again (S3)
**And** logcat contains no token, phone, challenge or code.

**Given** the ADR 0006 storage-reset helper behind `SecureStore`
**When** the keychain storage file is overwritten with garbage, and separately a stored value is corrupted
**Then** the helper + reset leave the store able to save and read again **in the same process** (or the need for a restart is recorded), the full matrix (kill, cold start, reboot, ciphertext corruption, file corruption) passes, and a transient non-corruption error does not sign the user out. If the gate fails, switch to the own Keystore module with a new ADR.

### Story 1.4: Spike — refresh and logout behavior

As the owner,
I want to see that expired sessions refresh exactly once and that logout leaves nothing behind,
So that the "no more random logouts" promise rests on facts.

**Acceptance Criteria:**

**Given** a debug build with the stored expiry forced into the past
**When** 5 API calls start concurrently
**Then** exactly one `POST /oauth/token/` is sent and all 5 calls succeed (S4).

**Given** a corrupted access token
**When** an API is called
**Then** the sequence is 401 → one refresh → one retry → success.

**Given** a corrupted refresh token
**When** an API is called
**Then** a single failed refresh occurs and its status and body are recorded as the "refresh rejected" signal for AD-3
**And** there is no loop.

**Given** network loss during refresh
**When** it is simulated
**Then** the observed behavior is recorded, so the rule "tokens are kept on Network" can be implemented.

**Given** a logout
**When** the store and caches are inspected
**Then** nothing account-scoped remains (S10), and refresh-token rotation and `device_id` dependency are recorded.

### Story 1.5: Spike — entitlement, errors and events shapes

As the owner,
I want real response shapes for accessible, locked and missing content, and for events,
So that error states and fixtures match Boosty rather than guesses.

**Acceptance Criteria:**

**Given** an accessible post and a locked post
**When** feed, author, single post (with `comments_limit=0`) and E15 responses are fetched
**Then** `hasAccess`, `data` vs `teaser`, the presence of `playerUrls` and of video duration are recorded (S5).

**Given** a missing token, a nonexistent post and a locked resource
**When** they are requested
**Then** the statuses and body shapes for 401, 404 and 403, plus 429 if observed without abuse, are recorded, to finalize the AD-5 mapping.

**Given** `GET /v1/notification/standalone/event/`
**When** it is called
**Then** its shape, event types and paging are recorded (S11), and EVT-01 is marked verified or not.

**Given** the captured responses
**When** they are saved as fixtures in `src/test/fixtures`
**Then** they contain no tokens, cookies, signed URLs, `signedQuery`, phone numbers or real personal data, and a sanitization check script passes on them.

### Story 1.6: Spike — authorized playback, expiry and progress round-trip

As the owner,
I want a subscribed video to play on the TV, survive a long pause and resume at the saved place,
So that the core viewing promise is proven.

**Acceptance Criteria:**

**Given** an accessible `ok_video`
**When** it plays as HLS, then switches to an MP4 quality and to DASH if offered
**Then** each plays and the position is preserved across switches, D-pad seek, Select and the media keys work, the time to first frame is measured (S6)
**And** network logs show no Boosty Authorization header on CDN hosts.

**Given** a paused video
**When** the pause lasts 30 min, then 2 h (or longer)
**Then** the CDN error and status after expiry, and the observed URL lifetime, are recorded
**And** re-resolving through E8 by media id resumes at the same position (S7).

**Given** playback to position X, then exit
**When** E9 writes are observed and the post is fetched again
**Then** the write cadence is confirmed, whether `timeCode` ≈ X (round-trip) is recorded, and whether the website shows the same position is recorded (S8).

**Given** the device sleeps during playback
**When** it wakes
**Then** what was written and what the player state is are recorded.

### Story 1.7: Spike — audio and files

As the owner,
I want audio posts and file attachments checked on the TV,
So that their treatment in the full product is based on real behavior.

**Acceptance Criteria:**

**Given** an `audio_file` with `url + signedQuery`
**When** it is played, paused and seeked, and the device sleeps and wakes
**Then** the behavior is recorded, including whether `signedQuery` expires (S9).

**Given** a `file` block
**When** its link is shown as a QR and scanned with a phone
**Then** it opens, and the link lifetime is recorded.

### Story 1.8: Focus map and spike decision

As the owner,
I want the focus rules written down and a clear go / no-go after the spike,
So that UI stories start from one normative focus contract and known risks.

**Acceptance Criteria:**

**Given** the design focus map and EXPERIENCE.md
**When** `docs/focus-map.md` is written in English
**Then** for every screen in the IA it lists the initial focus, arrows, OK, Back and restoration rules, including the overrides recorded in EXPERIENCE.md (UX-DR20).

**Given** the results of stories 1.2–1.7
**When** the spike report is compiled in `docs/testing.md`
**Then** each scenario S2–S11 (and S1 if run) is marked passed or failed on the physical device, with emulator results labeled separately
**And** blockers and fallbacks are listed with their ADRs.

**Given** the report
**When** it is presented to the owner
**Then** production work on Epic 2 starts only after the owner's explicit go.

## Epic 2: Sign in once and stay signed in (P1)

The family signs in by phone and code once and stays signed in across restarts and token expiry. The app opens in a remote-friendly shell. They can sign out, or re-login when the session truly expires. Switching accounts never leaks data.

### Story 2.1: Welcome screen on the design foundation

As a family member,
I want a clear, readable Welcome screen with one obvious «Войти в Boosty» action,
So that starting the app on the TV is effortless.

**Acceptance Criteria:**

**Given** a fresh install with no session
**When** the app starts
**Then** Welcome (A1) is shown with initial focus on «Войти в Boosty», matching DESIGN.md
**And** Back exits the app.

**Given** `shared/ui/tokens.ts`
**When** it is reviewed
**Then** it contains every DESIGN.md token (colors including `live` and `qr-bg`, typography with absolute lineHeights in sp, rounded, spacing, focus, motion), with values in dp (UX-DR1)
**And** the Golos Text font is bundled and used.

**Given** the FocusableSurface and Button primitives
**When** a button is focused, pressed or disabled
**Then** it shows the ring, surface lift and scale via transform without moving its neighbors, pressed uses scale 0.98, disabled is not focusable, and «reduce motion» keeps the scale but drops the animated transitions (UX-DR2, UX-DR4).

**Given** the typed `ru` catalog and the plural selector
**When** the Welcome copy and a pluralized test string render
**Then** no literal strings are used in components, copy follows EXPERIENCE › Voice and Tone with errors keyed as `error.<kind>`, and plural forms for 1/2/5/21 are correct on the device (UX-DR19).

**Given** a focused element
**When** TalkBack is enabled
**Then** a Russian accessibility label is announced (UX-DR21).

### Story 2.2: Request a sign-in code by phone

As the owner,
I want to type my phone number with any country code and get a code,
So that I can start signing in on the TV.

**Acceptance Criteria:**

**Given** Welcome
**When** I press OK on «Войти в Boosty»
**Then** the phone screen (A2) shows an editable country code defaulting to `+7` and a number field, with focus per `docs/focus-map.md` (UX-DR18).

**Given** the number field is focused
**When** I press OK
**Then** the system keyboard opens, arrows are not intercepted while it is open, and after «Готово» focus moves to «Получить код» if the number is valid, or back to the field if not (UX-DR5).

**Given** `+375 29 …`
**When** I press «Получить код»
**Then** `AuthApiClient` (web headers, no Bearer, `X-From-Id` = device-scoped `device_id`) sends the E.164 number. On success the code screen opens. While the request runs, the button shows a spinner and ignores repeated OK.

**Given** an invalid number, too many attempts or a verification requirement
**When** the API responds
**Then** A4, A9 or A10 is shown from `AuthError.kind`, mapped only from shapes verified in Story 1.3, with generic copy for anything else (FR1, FR2).

**Given** any request or error
**When** logs are inspected
**Then** `Logger` has redacted the phone and challenge, and no auth data appears (AD-14).

### Story 2.3: Confirm the code and create the session

As the owner,
I want to enter the code and land in the app signed in,
So that the TV knows my Boosty account.

**Acceptance Criteria:**

**Given** the code screen (A5)
**When** it opens
**Then** it shows where the code may arrive, a 60 s resend countdown, then «Выслать повторно» (A6), plus «Изменить номер», which returns to A2 with the number kept.

**Given** the correct code
**When** I press «Готово»
**Then** confirm returns tokens, `SessionManager.signIn(tokens)` stores them only via the `SecureStore` keychain adapter, `GET /v1/user/current` succeeds, the account id is stored, the phone is stored in SecureStore (FR6), and the app opens a minimal signed-in screen (the Shell from Story 2.4 replaces it) (FR1).

**Given** a wrong or expired code
**When** I submit it
**Then** A7 or A8 is shown, with focus on «Выслать новый код» for an expired code. If E1 fails after confirm, the tokens are discarded and a generic error is shown.

**Given** a corrupted secure store
**When** the session is read
**Then** the store is wiped and the user sees sign-in with «Войдите снова», and the app does not crash (AD-3).

### Story 2.4: The app shell — sidebar, Back and focus

As a family member,
I want a sidebar I can always reach and predictable Back behavior,
So that I never get lost with the remote.

**Acceptance Criteria:**

**Given** a signed-in user
**When** the Shell opens
**Then** the sidebar shows only the sections enabled in `app/phaseFlags.ts` (in this epic: Главная and Настройки). Until Epic 3, Главная shows a neutral «Лента появится здесь» StateView with no action. This is an intended development state, not a release. The current section and the focused item are visually distinct (UX-DR3, FR9). Sections open only on OK.

**Given** focus in the content area
**When** I press Back
**Then** focus goes to the sidebar's current item. From another section, Back goes to Главная; from Главная, Back exits the app (FR10).

**Given** a dialog or side sheet opened from the modal host
**When** it is open
**Then** focus is trapped, Back closes it first, and focus returns to the initiator (FR12).

**Given** a route is pushed and popped
**When** I return
**Then** FocusRestoration restores focus and scroll by focus ID (`<screen>/<zone>/<id>`), per route key and section, using the fallback chain when the item is gone (FR11, AD-12).

**Given** list edges
**When** I press past the first or last item
**Then** nothing wraps around.

### Story 2.5: Stay signed in across restarts and expiry

As a family member,
I want the app to open already signed in and quietly renew the session,
So that nobody has to sign in again for weeks.

**Acceptance Criteria:**

**Given** a stored session
**When** the app cold-starts or the device reboots
**Then** the Shell opens without sign-in (FR3).

**Given** fewer than 300 s remain before expiry, or a 401 occurs
**When** requests run concurrently
**Then** `HttpClient` gets the token from `SessionManager`, exactly one refresh runs, and the original request is retried once (FR4).

**Given** refresh fails with `Network` or `Server`
**When** it happens
**Then** the tokens are kept, the status stays `signedIn`, and the request surfaces that kind. Only the refresh-rejection signal recorded in Story 1.4 sets `expired` (AD-3).

**Given** the `AppError` taxonomy and retry table
**When** errors are produced
**Then** only `shared/api` creates them, GET retries follow the AD-6 table, and mutations are never retried (unit-tested).

**Given** no network at cold start with a stored session
**When** the app starts
**Then** the «Нет подключения к интернету» StateView with «Повторить» is shown, not A11 (UX-DR17).

**Given** a debug build with the demo flag
**When** FixtureTransport is active
**Then** the «ДЕМО» badge is visible (UX-DR22), and the same transport drives the integration tests for refresh single-flight and the expiry paths
**And** the release build fails if the flag is on.

### Story 2.6: Session expired and quick re-login

As the owner,
I want a clear «Сессия истекла» screen and a fast re-login with my number prefilled,
So that the rare forced sign-in takes seconds.

**Acceptance Criteria:**

**Given** a 401 after a rejected refresh
**When** it occurs on any screen
**Then** A11 is shown with focus on «Войти снова» (FR5).

**Given** A11
**When** I press OK
**Then** A2 opens with the stored phone prefilled and focus on «Получить код» (the EXPERIENCE override, FR6).

**Given** a successful re-login with the same account id
**When** I land
**Then** I am on Главная, and account-scoped data is kept.

### Story 2.7: Minimal Settings and sign-out

As the owner,
I want to see the app version and sign out safely,
So that I can hand the TV over or test with another account.

**Acceptance Criteria:**

**Given** Настройки (P1 part)
**When** it opens
**Then** it shows the app version and «Выйти из аккаунта» (FR53 P1).

**Given** «Выйти из аккаунта»
**When** I press OK
**Then** a Dialog opens with focus on «Отмена» (UX-DR16). «Отмена» returns focus to the row.

**Given** I confirm
**When** sign-out runs
**Then** `AccountScope.reset()` clears tokens, the stored phone, the account id and every registered account-scoped store, increments the generation, and Welcome is shown (FR8, AD-4). No server revoke call is made.

**Given** account-scoped stores
**When** the app boots
**Then** they are all registered in `app/bootstrap.ts`, and a test fails if a store marked account-scoped is not registered.

### Story 2.8: Account switch never leaks data

As the owner,
I want a different account signing in to start clean,
So that one account's data never shows under another.

**Acceptance Criteria:**

**Given** account A was signed in (expired session)
**When** account B signs in from A11 or A2
**Then** the differing `E1.id` triggers `AccountScope.reset()` **before** B's phone and id are stored, and B lands on a fresh Главная (FR7).

**Given** an async write started under A (for example a pending cache set)
**When** it completes after the reset
**Then** it is dropped because the generation changed (an integration test with FixtureTransport).

**Given** the same account signs in again
**When** it lands
**Then** nothing is wiped.

## Epic 3: Find and open a post (P1)

The family browses the subscription feed, the subscriptions grid and author pages, and opens a post. The post shows its media rows, handles locked content honestly and never breaks on unknown blocks.

### Story 3.1: Subscription feed on the Home screen

As a family member,
I want Главная to show the newest posts from my subscriptions as clear cards,
So that I see what's new as soon as I open the app.

**Acceptance Criteria:**

**Given** a signed-in user
**When** Главная opens
**Then** the «Новое в подписках» grid loads via the shared Post entity repository (E5) and its single mapper (AD-8). A skeleton is shown while loading, and focus stays on the sidebar until the first item loads (FR13).

**Given** posts of every type
**When** cards render
**Then** each PostCard shows the preview, the type badge (Видео, N видео, Аудио, Текст и фото, Опрос, Файл, Нет доступа), a 2-line ellipsized title and the author · date. Duration is shown only when the API provides it. No comment count appears anywhere (FR14, UX-DR6).

**Given** focus nears the end of the list
**When** the next page loads (`useInfiniteQuery` with an opaque `offset`)
**Then** pages are merged and deduplicated by `post.id`, focus does not move, and paging stops when `isLast` is true.

**Given** a load-more failure
**When** it happens
**Then** an inline «Повторить» row is shown, and OK reloads that page only.

**Given** an empty feed or a full-load error
**When** it happens
**Then** the matching StateView is shown with one action (UX-DR17).

**Given** a fixture feed of 300+ posts
**When** I scroll with the D-pad on the device
**Then** scrolling stays smooth (FlatList with `getItemLayout`), and keys are `post.id`.

**Given** a malformed post or an unknown block type in the response
**When** the page is parsed
**Then** the bad item is dropped and logged, the rest render, and unknown blocks map to `Block.Unknown` (FR38).

**As built** (`spec-3-1-subscription-feed-on-the-home-screen.md`, ADR 0010, ADR 0011):
- The grid has **3 columns**, not 4 (owner device review 2026-10-26). Cards are 221 dp wide.
- The list is a **FlashList 2.3.3** (owner decision 2026-10-26), not a FlatList with `getItemLayout`. Its items are rows of 3 cards keyed by the first post id. A trailing partial row is held back while more pages may come. Cards stay keyed by `post.id` for focus and restoration.
- **Resume head refresh** (owner decision 2026-10-26, `spec-feed-refresh-on-resume.md`; extended by `spec-epic-3-retro-a3-home-head-refresh.md`): after a resume E1 `ok`, a feed at least 60 s old gets one E5 page-1 request, merged into the cached head. The feed query is never refetched in full.

### Story 3.2: Subscriptions grid

As a family member,
I want to see all the authors I follow and open one,
So that I can go straight to a favourite author.

**Acceptance Criteria:**

**Given** the Подписки section is enabled in `phaseFlags`
**When** I open it from the sidebar
**Then** an author grid (3 columns, AuthorCard with avatar, blog title and owner name) loads via the shared Author entity (E2), with initial focus on the first tile (FR18, UX-DR7).

**Given** no subscriptions
**When** the grid loads
**Then** «Подписок пока нет» is shown, with an explanation and no subscribe CTA.

**Given** exactly 30 subscriptions are returned
**When** the grid renders
**Then** a «Показаны первые 30» note is shown (until pagination is verified).

**Given** a fixture with 55 authors
**When** I scroll
**Then** the grid is virtualized and focus is keyed by `blogUrl`.

**As built** (`spec-3-2-subscriptions-grid.md`, `spec-pin-icon-and-author-name-first.md`): the grid is a FlashList of 3-tile rows (ADR 0011). The tile's main line is the owner's name and the second line is the blog title (owner decision 2026-10-27: the title is usually a tagline).

### Story 3.3: Author page

As a family member,
I want to open an author and browse their posts,
So that I can catch up on one creator.

**Acceptance Criteria:**

**Given** an AuthorCard, or an author link in a post
**When** I press OK
**Then** the Author route (`{blogUrl}`) opens with a header (avatar, title, owner name, no description or cover) and the author's posts paginated via E4, using the same PostCard (FR20).

**Given** I open a post from the author page and come back
**When** the stack pops
**Then** focus and scroll return to the same card (FR11).

**Given** an author with no posts
**When** the page loads
**Then** «Публикаций нет» is shown.

**As built** (`spec-3-3-author-page.md`, ADR 0010, ADR 0012, `spec-author-posts-refresh.md`, `spec-pinned-post-label.md`, `spec-pin-icon-and-author-name-first.md`):
- The post grid has 3 columns, as on Главная (owner decision 2026-10-26). It is the shared PostGrid, a FlashList.
- **Sidebar on stack screens** (owner decision 2026-10-27, option A; ADR 0012): Автор shows the Shell sidebar, with the origin section as the current item. OK on another section pops to the Shell and opens that section. Back pops.
- **Head refresh** (owner decision 2026-10-27): reopening Автор with posts at least 60 s old, or a resume while Автор is in the stack, sends one E4 page-1 request, merged into the cached head.
- **Pinned post** (owner decisions 2026-10-27): Boosty's order is kept. A pinned card on Автор shows a 📌 badge at the top right of its preview, and its accessibility label starts with «Закреплено.». Главная shows no mark.
- **Name first** (owner decision 2026-10-27): the header's main line is the owner's name, and the blog title is the second line.

### Story 3.4: Post screen

As a family member,
I want to open a post and read it on the big screen,
So that I can see what the author published.

**Acceptance Criteria:**

**Given** a PostCard
**When** I press OK
**Then** the Post route (`{blogUrl, postId}`) fetches the post via E8 with `comments_limit=0` and shows the two-column layout: on the left the author (OK opens the Author), title (max 6 lines), date and read-only like count; on the right the blocks (FR32, UX-DR10, UX-DR11).

**Given** text blocks
**When** they render in this phase
**Then** they show as plain readable paragraphs. Styles and emoji come in Epic 6.

**Given** block types that are not implemented yet in this phase (image, link, file, external video, audio, poll) or unknown types
**When** they render
**Then** a neutral placeholder is shown, and the screen never crashes (FR38).

**Given** a deleted or missing post
**When** E8 returns the verified not-found signal
**Then** «Пост недоступен» is shown with «Назад» and without «Повторить».

**Given** the post screen
**When** I press Back
**Then** I return to the origin, with focus restored.

**As built** (`spec-3-4-post-screen.md`, `spec-post-header-layout.md`, ADR 0012):
- **Header on top** (owner decision 2026-10-27; this supersedes «the two-column layout» above and UX-DR10): one vertically scrolling column. The header comes first (author row → Автор, title, date · likes) and is not pinned. Then come the media rows, then the body, with text capped at about 600 dp.
- **Sidebar** (owner decision 2026-10-27, ADR 0012): Пост shows the Shell sidebar, with the origin section as the current item.
- **Paragraph stops** (owner decision 2026-10-27, option A): every paragraph is a focus stop (ParagraphStop), with no collapse.
- **Inline links** (owner decision 2026-10-27): a link's text stays in its paragraph as plain text, with no placeholder. Story 6.3 added the chips.

### Story 3.5: Media rows in a post

As a family member,
I want to see every video a post contains as its own row,
So that I can tell which part to watch.

**Acceptance Criteria:**

**Given** a post with two `ok_video` blocks
**When** it renders
**Then** each video has a MediaRow (thumbnail, «Видео N», title, status) identified by `MediaRef {blogUrl, postId, mediaId}` (FR33, AD-9, UX-DR9).

**Given** the player is not enabled yet (the player phase flag is off)
**When** media rows render
**Then** no «Смотреть» action is shown, so there is no dead-end button. The rows are focusable for reading.

**Given** the post's data
**When** the domain model is checked
**Then** `timeCode` and signed `playerUrls` are not exposed to the UI or to route params.

### Story 3.6: Locked posts

As a family member,
I want locked posts to explain clearly that we don't have access,
So that I'm not confused or nudged toward payments.

**Acceptance Criteria:**

**Given** a post with `hasAccess=false`, or with empty `data`
**When** it appears in a list
**Then** its card is dimmed, with a lock glyph and the «Нет доступа» badge.

**Given** I open a locked post
**When** it renders
**Then** its teaser blocks and the no-access copy (subscription level name if known) are shown with initial focus on the author. There is no price, payment or subscribe button (FR37).

**As built** (`spec-3-6-locked-posts.md`, owner decisions 2026-10-27): a teaser `image` block renders as a non-focusable image under the copy, with no auth headers. It uses the loaded image's real aspect ratio, and its height is capped so that the header, the copy and one teaser image fit on screen. With no URL, or when loading fails, it shows the «Изображение» placeholder.

## Epic 4: Watch and resume (P1)

The family plays a video with the remote: quality choice, seeking and media keys. Playback resumes exactly where anyone stopped, recovers silently from expired links and survives sleep. A finished video leaves «Продолжить просмотр».

### Story 4.1: Play a video from a post

As a family member,
I want to press «Смотреть» and watch the video full screen with the remote,
So that I can actually watch my subscriptions on the TV.

**Acceptance Criteria:**

**Given** the player phase flag is enabled
**When** a post has video
**Then** the primary «Смотреть» button and OK on any MediaRow open the Player route `{ref: MediaRef, origin: {routeKey, focusId}}`. Route params contain no signed URLs (AD-9, AD-17).

**Given** the Player opens
**When** `MediaResolver` resolves the ref via a fresh E8
**Then** the source is chosen in this order: preferred quality, else HLS, else DASH, else the highest progressive (FR42). Playback starts through the `PlayerEngine` port (react-native-video), and the Authorization header is never sent to CDN hosts (verified with a debug network log, AD-11).

**Given** playback starts
**When** `PlaybackArbiter` grants the slot
**Then** any other playback (for example audio) is stopped (AD-19).

**Given** the overlay
**When** it is shown
**Then** it displays the author avatar and name, the post title (plus the video title if different), the timeline and elapsed / remaining time. Initial focus is on the timeline (FR45, UX-DR14).

**Given** remote input
**When** I press ← or → on the timeline (or hold them), FF/Next, Rew/Prev/Step-back, OK, Play/Pause or Stop
**Then** seeks are 5 s and accelerate while the key is held, a bubble shows the target and commits after 600 ms, OK and Play/Pause toggle playback, and Stop exits. The Menu key and the settings sheet arrive in Story 4.3.

**Given** the overlay is visible
**When** 5 s pass without input
**Then** it hides only while playing. It never hides while paused, seeking, with a sheet open or on an error.

**Given** the player
**When** I press Back
**Then** the visible overlay hides first, and then the player exits and focus returns to the origin element (FR10).

**Given** buffering lasts longer than 500 ms
**When** it happens
**Then** a spinner is shown.

### Story 4.2: Progress is saved and playback resumes

As a family member,
I want videos to continue where anyone in the family stopped,
So that we never hunt for the place again.

**Acceptance Criteria:**

**Given** playback starts
**When** the player calls `ProgressRepository.begin(ref, meta {title, postTitle, authorName, previewUrl, durationSec})`
**Then** this is the only place that writes to E9 and to the account-scoped Continue history (AD-10).

**Given** continuous playback
**When** the position moves 10 s or more since the last successful write
**Then** E9 receives the integer-second position. A write is also forced on pause, background, Stop/exit and at the end. Failed writes are retried only with the latest position (FR44, AD-6).

**Given** a local entry exists for the media
**When** the player opens
**Then** playback resumes from the local position; otherwise from the server `timeCode` (FR43, ADR 0004).

**Given** a post with progress > 0 on a media
**When** the post renders
**Then** the primary button reads «Продолжить» and names the first unfinished media, «С начала» is offered and starts from 0, and every MediaRow shows its status from `useProgress(ref)` (FR33).

**Given** the session expires during playback
**When** a write is pending
**Then** it is held and flushed after re-login only if the account generation is unchanged.

### Story 4.3: Choose video quality

As a family member,
I want to switch quality without losing my place,
So that I can fix a blurry or stuttering picture.

**Acceptance Criteria:**

**Given** the overlay
**When** I open «Настройки» (or press Menu/Info/Settings)
**Then** a 340 dp side sheet opens with focus on «Качество» and traps focus (UX-DR15)
**And** Back closes the submenu first, then the sheet (focus returns to «Настройки»), then the overlay, then exits the player.

**Given** the quality list
**When** it renders
**Then** it shows only variants that exist for this media. HLS and DASH appear as one «Авто» row, with the «· 1080p» suffix only if the engine reports the current resolution (FR46).

**Given** I pick a variant
**When** the source reloads
**Then** playback continues from the same second, the preference is stored device-scoped, and the sheet closes with focus back on «Настройки».

**Given** no quality can be auto-picked
**When** the player opens
**Then** the quality list is shown before playback starts.

### Story 4.4: Recover from expired links and playback errors

As a family member,
I want playback to fix itself after a long pause,
So that I don't have to restart the video.

**Acceptance Criteria:**

**Given** a player error (including an expired signed URL)
**When** it occurs for the first time
**Then** «Восстанавливаем воспроизведение…» is shown, and `MediaResolver` re-fetches E8, matches the media by id, keeps the same quality and resumes at the current position (FR48).

**Given** the recovery fails, or a second error occurs
**When** it happens
**Then** «Не удалось воспроизвести видео» is shown with «Повторить» and «Назад», and focus is on «Повторить».

**Given** the media is no longer entitled (verified `NoAccess`)
**When** recovery is attempted
**Then** the player exits with the no-access message instead of retrying.

**Given** an integration test with FixtureTransport
**When** the first source fails and the re-fetched source succeeds
**Then** exactly one automatic recovery happens and the position is preserved.

### Story 4.5: Finishing a video

As a family member,
I want finished videos marked as watched and the player to return me to the post,
So that «Продолжить» only lists what's really unfinished.

**Acceptance Criteria:**

**Given** playback crosses 95 % or has less than 30 s left
**When** this is detected
**Then** the media is marked finished and removed from the Continue history, and playback is **not** interrupted (FR49).

**Given** playback reaches the actual end
**When** the engine reports ended
**Then** the final position is written, and the player exits to the origin. In a post, focus moves to the next unfinished MediaRow (via `FocusRestoration.setReturnFocus`), otherwise to the primary button. Nothing autoplays.

**Given** a finished media
**When** its post renders
**Then** its MediaRow reads «Просмотрено».

### Story 4.6: Sleep, background and audio focus

As a family member,
I want the video to pause and keep its place when the TV sleeps or I switch apps,
So that coming back is seamless.

**Acceptance Criteria:**

**Given** playback is running
**When** the app goes to the background or the device sleeps
**Then** playback pauses and the position is written (FR51).

**Given** the app returns to the foreground
**When** the player is shown
**Then** it is paused with the overlay visible. Pressing play re-resolves the URL if it has expired, through the Story 4.4 path.

**Given** another app takes audio focus
**When** `AppLifecycle` reports the loss
**Then** playback pauses.

**Given** the player unmounts
**When** it exits
**Then** the engine resources and the playback slot are released.

### Story 4.7: Continue-watching row on the Home screen

As a family member,
I want unfinished videos at the top of Главная,
So that I continue in one press.

**Acceptance Criteria:**

**Given** the Continue history has entries
**When** Главная opens
**Then** a «Продолжить просмотр · на этом устройстве» row is shown above the feed: at most 20 entries, one per media id, newest first, each with preview, title, author and remaining time or progress. Initial focus is on its first card (FR15).

**Given** the history is empty
**When** Главная opens
**Then** the row is hidden and focus goes to the first feed card.

**Given** OK on a continue card
**When** the player opens
**Then** it starts at `resumePoint(ref)`. After exit, focus returns to the same card.

**Given** sign-out or an account switch
**When** `AccountScope.reset()` runs
**Then** the history is empty.

**Given** a cold start
**When** I count remote presses to a playing new video (UJ-1)
**Then** it takes at most 5 presses on the device, recorded in `docs/testing.md` (SM-3).

## Epic 5: Search, filters and refresh (P2)

The family searches subscriptions or a single author, filters by access, period and tags, refreshes the feed, and sees «Мой блог».

### Story 5.1: Refresh the feed

As a family member,
I want an «Обновить» action on Главная,
So that I can pull in brand-new posts without restarting.

**Acceptance Criteria:**

**Given** Главная
**When** I press «Обновить» (a secondary small Button above the feed)
**Then** the feed and subscriptions are refetched, the label reads «Обновляем…» while loading, and focus stays on the same card by `post.id`. If that card has disappeared, the fallback chain applies (FR16).

**Given** the refresh fails
**When** it happens
**Then** the existing items stay visible and an inline error is shown, with no full-screen error.

**As built** (`spec-5-1-refresh-the-feed.md`, ADR 0010; owner decision 2026-10-28):
- «Обновить» sits in the feed's title row, to the right of «Новое в подписках».
- OK runs a forced head refresh: one E5 page-1 request, merged into the cached feed, with loaded pages and positions kept. It also invalidates the subscriptions query (one E2). The infinite query is not refetched.
- Single-flight: a running resume refresh is joined. A failure shows «Не удалось обновить» next to the button.

### Story 5.2: My-blog tile in Subscriptions

As the owner,
I want my own blog listed first in Подписки,
So that I can check my published posts on the TV.

**Acceptance Criteria:**

**Given** the account's E1 has a `blogUrl`, and that Author has at least one post (E3, E4 with limit 1)
**When** Подписки loads
**Then** «Мой блог» is the first tile, with the tint label, and opens the Author page (FR19, UX-DR7).

**Given** no blog, or a blog with no posts
**When** Подписки loads
**Then** no «Мой блог» tile appears.

**As built** (`spec-5-2-my-blog-tile-in-subscriptions.md`): E3 and E4 reuse the Author page's queries (E4 page 1 with `limit=20`, not `limit=1`), so opening «Мой блог» needs no new request. Owner decision 2026-10-28: the first Подписки load waits for the check, so the tile arrives first and takes the initial focus. Any failure means no tile and no error.

### Story 5.3: Filter the feed by access

As a family member,
I want to switch the feed between posts available to me, all posts and only purchased,
So that I see exactly the kind of content I want.

**Acceptance Criteria:**

**Given** Главная
**When** I press the «Фильтры · Доступные мне» chip
**Then** the filter SideSheet (320 dp) opens with focus on the selected access value. Focus is trapped, and Back returns focus to the chip (UX-DR15).

**Given** the access options «Доступные мне» (default), «Все посты» and «Только купленные»
**When** I select one
**Then** the feed refetches immediately behind the sheet with the matching `only_allowed` / `only_bought` params, and focus stays in the sheet (FR17, FR28, FR31).

**Given** a non-default filter
**When** the sheet is open
**Then** «Сбросить» appears and restores the defaults. The chip shows the active-filter count.

**Given** the Filter model
**When** it is stored
**Then** it lives in `shared/filters` filtersStore under scope `feed`. It is in memory, account-scoped and registered in AccountScope (AD-18).

**Given** a filter that yields no posts
**When** the feed loads
**Then** «Ничего не найдено» is shown with a «Сбросить фильтры» action.

**As built** (`spec-5-3-filter-the-feed-by-access.md`; owner decisions 2026-10-28): the chip sits between «Новое в подписках» and «Обновить». «Доступные мне» is the default, so locked posts leave Главная by default. The all-locked session check runs only under «Доступные мне».

### Story 5.4: Filter by period

As a family member,
I want to limit posts to a recent period or specific dates using only the remote,
So that I can find something from last week or a particular month.

**Acceptance Criteria:**

**Given** the filter sheet
**When** I open «Период»
**Then** these presets are shown: «За всё время», «Последние 7 дней», «Последние 30 дней», «Последние 3 месяца» and «Свой период…» (FR29).

**Given** «Свой период…»
**When** the steppers open
**Then** ↑/↓ change day, month or year, ←/→ move between fields, and «Готово» returns to the sheet. An invalid range (from later than to) cannot be confirmed.

**Given** a selected period
**When** the feed refetches
**Then** the period is stored symbolically in state and in the query key. The repository resolves it to local start and end of day as `from_ts` / `to_ts` at request time, and the query key does not change every second (AD-18).

### Story 5.5: Filter by tags

As a family member,
I want to pick one or more tags,
So that I only see posts on topics I care about.

**Acceptance Criteria:**

**Given** the filter sheet for the feed scope
**When** I open «Теги»
**Then** feed tags load from E13 (limit 100) with a «Загрузить ещё» row while more pages exist, as TagRow checks (FR30, UX-DR15).

**Given** I check tags
**When** each check changes
**Then** the list refetches with comma-joined `tags_ids`. «Сбросить» in the tag list clears only the tags.

**Given** the tag request fails
**When** it happens
**Then** a «Повторить» row is shown inside the list.

### Story 5.6: Search in subscriptions

As a family member,
I want to search posts across my subscriptions,
So that I can find a specific video by name.

**Acceptance Criteria:**

**Given** the Поиск section is enabled in phaseFlags
**When** I open it from the sidebar
**Then** a search field labeled «по подпискам» has initial focus, and a hint is shown before any query (FR26).

**Given** I type a query in the system keyboard and press «Готово»
**When** results load from E6 (with the `search` scope Filter applied)
**Then** focus moves to the first result, or back to the field if there are none, and «Ничего не найдено» is shown with «Сбросить фильтры» when filters are active.

**Given** I open a result and press Back
**When** I return
**Then** the query, the filter and the focused result card are exactly as I left them (UJ-4).

**Given** the search and author scopes
**When** their query keys are compared
**Then** they never collide (AD-7).

**As built** (`spec-5-6-search-in-subscriptions.md`; owner decisions 2026-10-29):
- The search runs on «Готово» only, never per keystroke. This is our improvement over the reference's 1 s debounce. The query is trimmed, and a blank query sends nothing.
- The submitted query is kept in an in-memory, account-scoped store (Q1 a).
- Results get no background or resume head refresh (Q2 a). Pressing «Готово» on the same query refetches page 1.

### Story 5.7: Search and filters inside an author

As a family member,
I want to search and filter one author's posts,
So that I can dig through a large archive.

**Acceptance Criteria:**

**Given** an Author page
**When** I use «Поиск» there
**Then** E7 searches only that author with `blog_url`, and an active search shows a reset. Back first clears the search and returns focus to the field (FR27).

**Given** «Фильтры» on the Author page
**When** the sheet opens
**Then** it uses scope `author:<blogUrl>`. Tags come from E14 (a single page), and access and period behave as in Stories 5.3–5.4 (AUTH-PAGE-03).

**Given** filters set on one author
**When** I open another author or Главная
**Then** their filters are unaffected.

**As built** (`spec-5-7-search-and-filters-inside-an-author.md`; owner decisions 2026-10-29):
- **Scope per route** (Q3 b; this supersedes `author:<blogUrl>` above): the scope is `author:<routeKey>`. A fresh Author route starts with the default Filter and no query, and the Filter is dropped when the route unmounts. Two Author routes of one blog never share a Filter.
- **Default access** (Q2 a): «Доступные мне», as on Главная. Locked posts no longer show on Автор by default; «Все посты» shows them.
- **No «Только купленные»** (A a): Автор offers only «Доступные мне» and «Все посты», because E4 ignores `only_bought=true` (live). E4 and E7 always send `only_bought=false`.
- **Client-side drop** (B a): E7 ignores the access params (live), so blog search under «Доступные мне» drops `hasAccess: false` results on the client.
- Search follows Story 5.6: on «Готово» only, trimmed, and no head refresh of results.

## Epic 6: The complete post (P2)

Posts render rich text, emoji and images. Links, files and external video open via QR. Audio plays inline. Polls can be voted on and votes retracted.

### Story 6.1: Rich text, emoji and long posts

As a family member,
I want post text to keep its formatting and be scrollable with the remote,
So that long posts are pleasant to read on the TV.

**Acceptance Criteria:**

**Given** text blocks with style data (codes 0 = bold, 2 = italic, 4 = underline) and inline emoji blocks
**When** the post renders
**Then** a paragraph is merged until a `BLOCK_END`, styles are applied, emoji render inline at text size, and unknown style codes render as normal text (FR34).

**Given** a `content` value that is not a JSON array
**When** it is parsed
**Then** it is shown as plain text, without crashing (mapper fixture test).

**Given** long text
**When** the post opens
**Then** the text is collapsed with an expand action. Once expanded, every paragraph is a focus stop (ParagraphStop with accent bar), so ↓ scrolls through it (UX-DR11).

**As built** (`spec-6-1-rich-text-emoji-and-long-posts.md`; owner decision 2026-10-29 Q1 a): there is no collapse and no expand action. Every paragraph is a focus stop from the start, and a paragraph longer than 600 characters is split into several stops. Style ranges count from the paragraph start (verified live).

### Story 6.2: Images in posts

As a family member,
I want images in a post to show inline,
So that I see the post as the author intended.

**Acceptance Criteria:**

**Given** an `image` block
**When** the post renders
**Then** the image is shown at full right-column width, keeping its aspect ratio, with max height 300 dp. A skeleton is shown while it loads, and it is a focus stop, so tall content scrolls into view (FR36, UX-DR11).

**Given** the image fails to load
**When** it errors
**Then** the placeholder «Изображение недоступно» is shown, and the rest of the post is unaffected.

**As built** (`spec-6-2-images-in-posts.md`; owner decision 2026-10-27, one-column Post): «full right-column width» reads as the one column's width, capped at `text-measure` (600 dp) and 300 dp tall. A focused image gets the ring with no scale, because a scaled 600 dp image would overlap the text. OK does nothing.

### Story 6.3: Links, files and external videos via QR

As a family member,
I want to open links, files and YouTube videos from a post on my phone,
So that nothing in a post is a dead end on the TV.

**Acceptance Criteria:**

**Given** inline links inside a paragraph
**When** the post renders
**Then** each link appears as a LinkChip under its paragraph, with the link text and a «QR» suffix (FR35, UX-DR11).

**Given** an external `video` block, or a `file` block (title and size)
**When** it renders
**Then** it appears as a chip, with a YouTube thumbnail when the host is YouTube.

**Given** OK on any chip
**When** the QrDialog opens
**Then** the QR is generated on the device from a URL built by `externalUrls` (file URL + `signedQuery`), with the title and «Откроется на телефоне». The full URL is never printed or logged. Focus is trapped, and «Закрыть» or Back returns focus to the chip (UX-DR16).

**As built** (`spec-6-3-links-files-and-external-videos-via-qr.md`; owner decisions 2026-10-29, our improvements). Not every chip opens a QR:
- A link to another Boosty post reads «<text> · Открыть». OK opens that Пост in the app, and Back returns to the chip.
- A timestamp link to a video of the current post reads «<text> · Смотреть». OK opens the player at that second.
- `header` blocks render as bold, non-focusable headings (Q1 b).
- A file opens its QR from a fresh E8.

### Story 6.4: Inline audio

As a family member,
I want to play audio from a post right there,
So that I can listen to podcasts and music posts on the TV.

**Acceptance Criteria:**

**Given** an `audio_file` block
**When** the post renders
**Then** the AudioBlock (exported from `features/player/index.ts`, used through the allowed post→player edge) shows the title, position / duration and a thin progress bar, as a single focus target (FR39, UX-DR12, AD-1).

**Given** the AudioBlock is focused
**When** I press OK, or ← / →
**Then** OK plays or pauses, and ←/→ seek 10 s. The source is `url + signedQuery`, through `PlayerEngine`.

**Given** audio is playing
**When** I start another track or a video
**Then** `PlaybackArbiter` stops the first one (AD-19).

**Given** audio is playing
**When** I leave the post, or another app takes audio focus
**Then** audio stops or pauses. The audio position is not persisted.

**As built** (`docs/feature-parity.md` POST-06, `deferred-work.md`; owner decision 2026-10-29): the screen also stays on while a track is paused with its source kept. This is react-native-video's keep-screen-on; the owner chose to keep it for now, and it is in the backlog.

### Story 6.5: Poll display

As a family member,
I want to see a poll's question, options and current results,
So that I know what's being asked and how others voted.

**Acceptance Criteria:**

**Given** a post with a poll
**When** it renders
**Then** the PollWidget (from `features/polls/index.ts`) shows the title, options with result bars and percentages, the voter count and my chosen options, read from the `poll` inside the cached post (AD-7, FR40).

**Given** a finished poll
**When** it renders
**Then** «Опрос завершен» and the results are shown. The options are not focusable, and the poll is one focus stop.

**As built** (`spec-6-5-poll-display.md`): each option also shows its vote count next to the percent. An option without `id`, `counter` or `fraction` is dropped on its own (owner decision 2026-10-29, option a). Only a poll with no usable option becomes the «Опрос» placeholder.

### Story 6.6: Vote and retract in a single-choice poll

As a family member,
I want voting to need a deliberate confirmation,
So that a stray OK while scrolling doesn't cast a vote.

**Acceptance Criteria:**

**Given** a single-choice poll
**When** I press OK on an option
**Then** it enters the pending state («Нажмите OK ещё раз»). A second OK on the same option sends E11, and moving focus away cancels pending (FR41, UX-DR13).

**Given** OK twice on my already chosen option
**When** it is confirmed
**Then** E12 retracts the vote.

**Given** a vote or retract succeeds
**When** E10 returns the updated poll
**Then** `entities/poll.applyPoll` writes it into every cached post and page containing that poll, the results update, and focus stays on the option.

**Given** the request fails
**When** it errors
**Then** an inline error is shown and the previous state is kept. It is never retried automatically, and only one request per poll can be in flight (AD-6).

**As built** (`spec-6-6-vote-and-retract-in-a-single-choice-poll.md`, `src/features/polls/usePollVote.ts`):
- After a vote, two OK presses on a different option change the vote (owner decision 2026-10-29 Q1 a, reference parity).
- The two-OK confirmation is our improvement; the reference votes on one click.
- The inline error is one line per mutation (`vote` or `retract`) whatever the `AppErrorKind`. This was accepted in the Epic 6 retro and is recorded in AD-5.

### Story 6.7: Multiple-choice poll

As a family member,
I want to tick several options and then vote,
So that I can answer multi-select polls.

**Acceptance Criteria:**

**Given** a multiple-choice poll I haven't voted in
**When** I press OK on options
**Then** each option toggles a check, and «Проголосовать» is focusable only when at least one option is checked (FR57).

**Given** «Проголосовать»
**When** I press OK
**Then** E11 is sent with all the checked IDs, and the result is applied through `applyPoll`.

**Given** I have voted
**When** the poll renders
**Then** the results are shown with «Отозвать голос», which needs two OK presses (pending, then confirm) and sends E12.

## Epic 7: Live streams and events (P2)

The family sees an author's live or scheduled stream, watches it live, likes and shares it, and learns about new streams from События once E18 is verified.

### Story 7.1: Live stream card on the author page

As a family member,
I want to see on an author's page whether they're streaming or have a stream scheduled,
So that I don't miss live broadcasts.

**Acceptance Criteria:**

**Given** an Author page with the live phase flag on
**When** `entities/stream` fetches `['stream', blogUrl]` (E15)
**Then** a 204 response shows no card. Otherwise a LiveCard shows one of three states (FR21, UX-DR8):
- **live:** LIVE badge, title, viewers and likes;
- **scheduled:** refreshed every 30 s while the page is open;
- **needs subscription level:** level name only, never a price.

**Given** a stream is live
**When** the Author page opens
**Then** initial focus is on the LiveCard.

**Given** the stream ends while the page is open
**When** the next refresh shows no stream
**Then** the card disappears, and focus falls back to the first post.

**As built** (`spec-7-1-live-stream-card-on-the-author-page.md`, `src/features/author/useAuthorLive.tsx`, `src/app/App.tsx`; owner decisions 2026-10-30):
- **Polling** (Q1 a): E15 is fetched again every 30 s for a **live and a scheduled** card, not only a scheduled one. Polling runs only while the Author route is focused, the app is in the foreground and a card is shown.
- **Fresh on open:** the query uses `staleTime: 0`, so every Author open sends one E15, and a cached card is never trusted for the initial focus.
- **Resume:** a resume invalidates every observed stream query.
- **Failures:** a failed first E15 shows no card and no error, and is not retried. A failed poll keeps the last card.
- **Flag:** the `live` flag ships on (Q3 a).
- **No posts:** when the card goes away and there are no posts, focus goes to the nearest action above.

### Story 7.2: Watch a live stream

As a family member,
I want to watch a live stream with honest controls,
So that I can follow a broadcast on the TV.

**Acceptance Criteria:**

**Given** a live stream with `hasAccess` true and playable URLs
**When** I press OK on the LiveCard
**Then** the Player opens with `LiveRef {blogUrl}`, and `MediaResolver` uses E15 live-edge URLs only (no `live_playback_*`) (FR22, AD-11).

**Given** the live player
**When** the overlay shows
**Then** it has a LIVE badge and the elapsed time since the stream started, with no seek track and no speed option. Pause is allowed, and play resumes at the live edge (UX-DR14).

**Given** the stream ends
**When** the engine reports ended
**Then** «Стрим завершён» is shown with focus on «Назад», and on exit `['stream', blogUrl]` is invalidated.

**Given** a stream that is not live, not accessible or has no URLs
**When** I press OK on the card
**Then** a QR to the stream page is shown instead.

**Given** a live stream is playing
**When** I check progress
**Then** no progress is written.

**As built** (`spec-7-2-watch-a-live-stream.md`, `src/app/stackRoutes.tsx`):
- **Quality rule** (owner decision 2026-10-30): the settings gear is shown in the live player only when the live quality list has a real choice, that is more than one entry. A single adaptive «Авто» means no gear. Every live candidate is adaptive today, so the gear never shows. The live pick path, which replays the chosen source at the live edge, exists but cannot be reached.
- **Exit:** leaving the live player by any path, not only at the end, invalidates `['stream', blogUrl]`.
- **Playable card:** OK opens the player only when the card is live, has access and E15 listed a live-edge URL. Every other card shows the stream page's QR.

### Story 7.3: Live viewer heartbeat

As the owner,
I want the app to report that we're watching, like the website does,
So that Boosty counts us as viewers and the stream behaves normally.

**Acceptance Criteria:**

**Given** a live stream is playing
**When** 30 s pass
**Then** `PUT …/video_stream/heartbeat/viewer` is sent, and it repeats every 30 s while playing (FR23).

**Given** I exit, or the stream ends
**When** the player stops
**Then** exactly one `stop=true` heartbeat is sent, even if the screen unmounts.

**Given** a heartbeat fails
**When** it errors
**Then** it is not retried immediately (AD-6), and playback continues.

### Story 7.4: Like and share a live stream

As a family member,
I want to like a stream and share its link to my phone,
So that I can support the author and send the stream to others.

**Acceptance Criteria:**

**Given** a LiveCard
**When** I press OK on «Нравится»
**Then** the like toggles optimistically, E17 (`POST`/`DELETE`) is sent with one request in flight, and the state rolls back on failure, with no auto-retry (FR24).

**Given** «Поделиться»
**When** I press OK
**Then** a QrDialog shows `https://boosty.to/{blog}/streams/video_stream` (built via `externalUrls`), and focus returns to «Поделиться» on close (FR25).

**As built** (`spec-7-4-like-and-share-a-live-stream.md`, `src/features/author/LiveCard.tsx`, `useLiveLike.ts`; owner decisions 2026-10-30):
- **Visibility** (Q2 a): «Нравится» is shown **only on a live card with access**. «Поделиться» is shown on every card: live, scheduled and needs level. Without the like, «Поделиться» is the only button.
- **Look** (Q1 a): «Нравится» is a heart icon plus the count («♡ 357» / «♥ 358», accent when liked).
- **Details line:** where the like shows, the card's details line drops its likes figure (the viewer count alone). A scheduled card keeps «N лайков».
- **Focus:** both buttons sit in a column to the right of the card. → from the card goes to the first button, ↓ from «Нравится» goes to «Поделиться», ↓ from «Поделиться» goes to the grid, and ← goes back to the card.
- **Errors:** a like failure keeps its `AppErrorKind`.

### Story 7.5: Events list

As a family member,
I want a list of recent events such as «Начался эфир»,
So that I learn about streams without visiting each author.

**Acceptance Criteria:**

**Given** E18 has been verified in Story 1.5
**When** the События phase flag is enabled
**Then** the События section appears in the sidebar. If E18 is not verified, the flag stays off and nothing is shown (FR52, AD-20).

**Given** События opens
**When** E18 returns events
**Then** each EventRow shows the author avatar, the text, the author name, the time and an unread dot. `video_stream_start` reads «Начался эфир», and unknown types show generic text.

**Given** OK on a «Начался эфир» event
**When** the Author page opens
**Then** focus is on its LiveCard.

**Given** empty or error responses
**When** they occur
**Then** «Событий нет», or an error with «Повторить», is shown.

**As built** (`spec-7-5-events-list.md`, `src/features/events/useEvents.ts`; owner decisions 2026-10-30):
- **Flag** (Q1 a): the live probe confirmed E18's documented shape, with no cursor, so `phaseFlags.events` is on. Only the first page is shown, with no load-more.
- **Empty state** (Q2 a): «Событий нет» comes with «Обновить» (focused; it refetches).
- **Hidden types** (Q3 a): blog-owner event types are hidden (donations, new subscribers, stat reports, purchases, referrals, support tickets, level limits, `target_new`), and comment types are never shown. Shown: `video_stream_start` («Начался эфир»), `post_new` and `promo_new` with their own text, and unknown types with generic text.
- **Refetch:** the query uses `staleTime: 0`, so every open of the section fetches again, and a resume invalidates it.
- **Read marks:** OK marks a row read locally for the session. No read mutation is sent.

## Epic 8: Viewing preferences and diagnostics (P2)

The family can change playback speed and use the system player. The owner gets full Настройки and hidden diagnostics for testing.

### Story 8.1: Playback speed

As a family member,
I want to speed up or slow down a recorded video,
So that I can skim long videos or follow fast speech.

**Acceptance Criteria:**

**Given** a recorded video (not live)
**When** I open player settings
**Then** «Скорость» lists the presets 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2 and 3× with the current one checked (FR47).

**Given** I pick a speed
**When** it applies
**Then** playback continues at that rate from the same position, and the speed is stored device-scoped as the global preference for the next videos.

**Given** a live stream
**When** settings open
**Then** «Скорость» is not shown, and playback stays at 1×.

### Story 8.2: System video player option

As the owner,
I want to optionally hand videos to an installed Android player,
So that I can use a player I prefer for specific cases.

**Acceptance Criteria:**

**Given** full Настройки (P2 part)
**When** I open it
**Then** «Системный видеоплеер» appears as a toggle, with a description saying that progress is not tracked in this mode (FR53, FR50).

**Given** the toggle is on
**When** I start a video
**Then** the quality list opens first, then the `ExternalPlayer` port launches the Android chooser with the chosen URL and the title. No progress is written.

**Given** no external player is installed
**When** the chooser cannot resolve
**Then** the built-in player is used, with the hint «Внешний плеер не найден».

### Story 8.3: Hidden diagnostics for testing

As the owner,
I want a hidden diagnostics screen with safe logs,
So that I can debug problems on the TV without exposing secrets.

**Acceptance Criteria:**

**Given** Настройки
**When** I press OK seven times on «Версия»
**Then** Diagnostics opens. A single press does nothing visible in this epic (FR54).

**Given** Diagnostics
**When** I enable log capture
**Then** `Logger` writes to the in-memory ring and to a capped file in internal storage. The screen explains how to retrieve the file over adb.

**Given** captured logs
**When** a test feeds the Logger with tokens, cookies, Authorization headers, phone numbers, codes, signed URLs and `signedQuery`
**Then** all of them are redacted in the output (unit test, AD-14).

**Given** sign-out or an account switch
**When** `AccountScope.reset()` runs
**Then** the log buffer and the log file are cleared.

## Epic 9: Ready for the family (P3)

A signed release is installed from GitHub Releases, update notices work, performance is tuned and measured, visual fidelity is checked against the mocks, and the full device regression passes.

### Story 9.1: Signed release on GitHub Releases

As the owner,
I want a signed release APK I can install on the family TV from a GitHub Release,
So that the family runs a stable build, not a debug one.

**Acceptance Criteria:**

**Given** a release keystore that is kept outside the repository and CI
**When** the owner runs the documented local release build
**Then** a signed release APK is produced, with `versionName` and `versionCode` incremented, and the demo flag off (the build fails otherwise) (FR55, AD-15, AD-16).

**Given** the release APK
**When** it is installed on the test device via adb or a file manager
**Then** it appears in the Google TV launcher with the final TV banner and icon, runs without touch, and keeps the existing session when installed over a previous release signed with the same key.

**Given** a GitHub Release tagged `v{versionName}` in the public repository
**When** the APK and changelog are attached
**Then** the repository and the release contain no secrets, keystore, real account data or unsanitized fixtures, and the CI fixture check passes.

**Given** the banner and icon
**When** they are produced
**Then** they use the app's own neutral branding, not Boosty marks. The working title «Boosty TV» is used only if the owner approves it.

### Story 9.2: Update notice from GitHub Releases

As the owner,
I want the TV to tell me when a newer version is available,
So that I know when to sideload an update.

**Acceptance Criteria:**

**Given** `UpdateChecker` with its own unauthenticated client
**When** the app starts (at most once per day) or I press OK on «Версия» (at most once per 60 s, and never more than once during the 7-press gesture)
**Then** it fetches the latest release of the configured public repository (FR56).

**Given** the latest tag is newer than `versionName` by semantic comparison
**When** the check completes
**Then** a non-blocking notice shows the new version, the changelog and a QR to the release page. Nothing is downloaded or installed.

**Given** the check fails or is rate-limited
**When** it errors
**Then** nothing is shown to the user and a diagnostics log entry is written.

**Given** any check request
**When** it is inspected
**Then** it carries no account data, identifiers or Boosty auth.

### Story 9.3: Performance on the device

As a family member,
I want scrolling and playback start to feel instant,
So that the app is pleasant every evening.

**Acceptance Criteria:**

**Given** fixture lists of 300+ feed posts and 55 authors, and real data on the device
**When** I scroll with the D-pad held and in single steps
**Then** no visible frame drops or focus lag occur. The measurements (method and numbers) are recorded in `docs/testing.md` (NFR5).

**Given** the time-to-first-frame baseline from Story 1.6
**When** playback starts from a post and from «Продолжить»
**Then** the target set after the spike is met, or a documented exception is accepted by the owner.

**Given** FlatList cannot meet the target
**When** profiling confirms it
**Then** FlashList 2.x is adopted for that list only, with an ADR.

*Note (2026-10-31): this already happened in Story 3.1. FlashList 2.3.3 was adopted for the grids after device profiling (ADR 0011), and later lists (Подписки, События) reuse it.*

**Given** a 1-hour session of browsing and watching
**When** memory is observed
**Then** there is no steady growth that would indicate a leak in images, players or listeners.

### Story 9.4: Visual fidelity and accessibility pass

As the owner,
I want the app to match the agreed design and be readable for everyone,
So that it looks and behaves as designed.

**Acceptance Criteria:**

**Given** the Claude Design mocks and DESIGN.md
**When** each screen in the IA is compared on the device at 1080p and 720p
**Then** deviations are fixed or listed and accepted. Tokens are used everywhere, with no raw colors or sizes in components (UX-DR1).

**Given** the contrast table in DESIGN.md
**When** the pairs are checked in the built app
**Then** all pairs meet their targets, including focused rows and the LIVE badge (UX-DR21).

**Given** TalkBack is enabled
**When** I move through each screen
**Then** every focusable element announces a meaningful Russian label.

**Given** `docs/focus-map.md`
**When** every screen is walked
**Then** initial focus, arrows, OK, Back and restoration match it. Any mismatch is fixed in the code or the document is updated with the owner's approval.

### Story 9.5: Full device regression and owner acceptance

As the owner,
I want a complete check on the real TV before the family switches over,
So that I can retire BoostBuddy with confidence.

**Acceptance Criteria:**

**Given** the CLAUDE.md device checklist
**When** it is run on the Chromecast with Google TV 4K with the release build
**Then** each item passes and is recorded in `docs/testing.md`, with physical-device results kept separate from emulator results (NFR9). The checklist covers:
- D-pad-only sign-in and browsing;
- long lists;
- filter apply and reset;
- keyboard close;
- multiple media in a post;
- quality change;
- resume;
- poll vote;
- the Back hierarchy;
- sleep and resume;
- network interruption;
- logout and re-login.

**Given** UJ-0 to UJ-7
**When** each is walked with the remote only
**Then** all complete (SM-5), and the press count of UJ-1 is ≤ 5 (SM-3).

**Given** the results
**When** they are presented to the owner
**Then** the owner explicitly accepts the Android release. The SM-1 and SM-2 observation periods start.
