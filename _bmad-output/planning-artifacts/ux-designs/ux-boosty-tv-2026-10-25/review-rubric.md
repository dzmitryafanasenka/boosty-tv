# Spine Pair Review — Boosty TV

Reviewed: `DESIGN.md`, `EXPERIENCE.md` (both `status: draft`, 2026-10-25) against the brief, `docs/feature-parity.md`, `docs/api-contract.md`, the Claude Design package (`imports/claude-design-v1`, including `docs/tokens.md`, `focus-map.md`, `handoff-rn-tv.md` and `assumptions.md`) and `CLAUDE.md`. Owner decisions recorded in `.memlog.md` are treated as settled. They include the fast path, px/2 → dp, the LIVE card removed from Home, the conditional «Авто · 1080p» suffix, the account-scoped continue history, hidden Events and role-named protagonists.

## Overall verdict

**Adequate.** The pair is a usable contract for the phase-1 vertical slice. Every `{token}` reference resolves, the px/2 conversion is exact, the DESIGN.md section order is canonical, and the EXPERIENCE.md behavior tables are concrete and traceable to feature IDs. No invented endpoints, comments, payment or download appear in the UI. The gaps that matter downstream are:
- typography line heights that cannot be copied into React Native as written;
- no defined end-of-playback state and no rule for an account change on re-login;
- no Key Flow for search and filters;
- two parity items silently missing: the read-only like counter (POST-10) and the refresh action (FEED-03);
- a handful of patterns that have behavior rules but no visual spec.

None of these is critical. All can be fixed in one Update pass.

## 1. Flow coverage — thin

Checked: the brief's success criteria (cold start ≤ 5 presses, session longevity, resume after sleep or reboot, remote-only) and solution bullets, plus the feature-parity `P` rows that are user journeys. Four Key Flows exist (evening episode, interrupted cooking video, session-expired re-login, poll vote). Each has numbered steps, a bold climax and a failure path. They cover the phase-1 slice well. Most phase-2 parity journeys have no flow.

### Findings
- **[high]** There is no Key Flow for **search or filters**. This covers FEED-04, AUTH-PAGE-02 and AUTH-PAGE-03, SEARCH-SCOPES and FILTER-01..04. This is the most compositionally complex path: system keyboard → «Готово» focus rule → results → filter SideSheet with immediate refetch → period steppers → open a post → return with the same query and card. Today its rules are spread across Component Patterns (FilterChip, Period picker, Tag list, TextField), Interaction Primitives (Keyboard) and focus-map rows D and E. No single walkthrough proves they compose (EXPERIENCE.md › Key Flows). *Fix:* add a flow, for example "the owner searches an author's archive for a topic from last month". Steps: Поиск or author «Поиск» → keyboard → «Готово» → Фильтры → Период → Свой период → back to results → post → Back restores the query and card. Failure paths: «Ничего не найдено» + «Сбросить фильтры», and a load-more error.
- **[medium]** There is no flow for **watching a live stream** (LIVE-01..05). Its rules are scattered: LiveCard OK branching on `hasAccess`, the heartbeat, pause → live edge, «Стрим завершён», scheduled refresh every 30 s, and like rollback. The state where a live stream ends while the user is in the player has no end-to-end path (EXPERIENCE.md › Component Patterns › LiveCard; Interaction Primitives › Live player). *Fix:* add a short flow: author page → live card → player → stream ends → «Назад» → focus on the first post. Failure path: needs a subscription level → QR.
- **[medium]** The **first sign-in** (A1 Welcome → A2 phone → A5 code → Главная, AUTH-03 and AUTH-04) has no flow. Flow 3 covers only re-login with a prefilled number. The code delivery hint, the 60 s resend countdown and the first landing on Главная with an empty continue row are not walked through. This is the entry point of phase 0 and phase 1 (EXPERIENCE.md › Key Flows › Flow 3). *Fix:* add Flow 0, "first-time setup by the owner", or extend Flow 3 with a first-run variant.
- **[low]** There are no flows for audio playback (POST-06), opening a file or link via QR (POST-02, POST-05, POST-07), sign-out (AUTH-07) or the system player toggle (SET-02, PLAY-13). The component rules are adequate. Flows are optional here, but sign-out deserves one because it is shared-impact and clears data. *Fix:* add a one-paragraph sign-out flow, or accept the component rules as enough.
- **[low]** The brief's "≤ 5 remote presses from cold start" target is not shown as counted anywhere. Flow 1 implies 3–4 presses but does not say so (EXPERIENCE.md › Flow 1). *Fix:* annotate Flow 1 with the press count.
- **[low]** "Resume after sleep or a reboot" (brief › Success Criteria) is not walked through. Flow 2 covers resuming hours later, but not sleep or reboot. *Fix:* add one failure or variant line to Flow 2.
- **[low]** Protagonists are role-named ("the owner", "a family member"). This is an owner decision and has no downstream impact.

## 2. Token completeness — adequate

Checked: every frontmatter group (`colors` 26, `typography` 13, `rounded` 5, `spacing` 24, `focus` 9, `motion` 9, `components` 21) and every `{path}` in both files. **Every referenced token is defined, and no reference is broken.** Every value was spot-checked against `tokens.md` px / 2: type sizes, radii, the spacing ramp, safe area, sidebar and content widths, grid gaps, focus ring and offset, shadow, and the button, field, row, poll, card, author, live and avatar sizes. All match exactly. Every color token has a value. Contrast was computed (WCAG 2.x). Results: `text`/`bg` 15.8, `text-tertiary`/`bg` 5.2, `text-meta`/`bg` 7.2, `accent-ink`/`accent` 7.4, `accent-ink`/`accent-focus` 8.6, `accent-text`/`accent-tint` 6.7, `error-text`/`bg` 8.4.

### Findings
- **[high]** **`typography.*.lineHeight` mixes unitless multipliers (`1.1`, `1.55`, `1.0`) with absolute values (`29`, `24`, `16`).** React Native `lineHeight` is absolute (dp). A consumer that copies `lineHeight: 1.55` or `lineHeight: 1` gets text that overlaps or is clipped on every screen. The `units` note does not cover this (DESIGN.md frontmatter lines 46–58). *Fix:* express every lineHeight in sp (for example body 14 × 1.55 → `22`, button 14 × 1 → `14`, or state the rounding rule), or add `lineHeightMode: multiplier` and an explicit "multiply by fontSize at build time" rule in the `units` block.
- **[medium]** The contrast targets list only three pairs (DESIGN.md › Colors, line 152). Two load-bearing combinations fail or are borderline:
  - `text-tertiary` (#8F887F) on `surface-focus-row` (#3A3632) is **3.42:1**. Setting-row descriptions and hints inside a focused row would drop below the 4.5:1 floor the spine itself states.
  - The LIVE badge, `text` on `live` (#C93C32), is **4.39:1** at 11 sp.
  
  The spine states no target for the focus ring (non-text, ≥ 3:1) or for text on `overlay-badge` over arbitrary video. *Fix:* state that focused rows lift secondary text to `text-secondary` (5.6:1 on the focus row). Darken `live` slightly, or allow `badge` at 600 weight as large text and say so. Add the ring and overlay targets.
- **[low]** `colors.scrim` and `colors.overlay-badge` are `rgba()` strings, not hex as the spec requires (DESIGN.md lines 43–44). *Fix:* use 8-digit hex (`#0A0908D1`, `#12100ED9`) or note the deviation.
- **[low]** `components.qr-dialog.qrBg: '#FFFFFF'` and `post-card.thumb: '168x94.5 (16:9)'` are literals, not tokens. `author-card.width: 232` duplicates `{spacing.author-tile-width}`. *Fix:* reference the tokens, or add a `qr-bg` color.
- **[low]** The handoff gives SideSheet as 640/680 px (→ 320/340 dp). DESIGN.md has only 320, and when 340 applies is lost (DESIGN.md line 125; handoff-rn-tv.md › Компоненты). *Fix:* add a second width or state that 320 is the only width.
- **[low]** `typography.player-title`, `motion.scroll` and `motion.spinner` are defined but never referenced in either spine. The player-overlay title has no component that uses it. *Fix:* reference them in the Timeline, Player overlay and Skeleton or spinner rows.
- **[low]** `focus.card-shadow: '0 9 20 rgba(0,0,0,0.5)'` is a CSS-style string. Android RN shadow support depends on the RN version and architecture. *Fix:* note the RN mapping (`boxShadow` with the New Architecture, or `elevation` fallback) or mark it [ASSUMPTION].

## 3. Component coverage — thin

Checked: the union of the DESIGN.md Components table, the frontmatter `components`, the EXPERIENCE.md Component Patterns, the handoff component list (18 components) and the component sheet sections.

| Component | DESIGN visual | EXPERIENCE behavior |
|---|---|---|
| FocusableSurface | prose only (line 193) | — (implicit) |
| Sidebar / NavItem | ✓ | ✓ |
| Button | ✓ | only the «Смотреть/Продолжить» + «С начала» instance |
| FilterChip | ✓ | ✓ |
| TextField | ✓ | ✓ |
| PostCard (sheet: "VideoCard") | ✓ | ✓ |
| AuthorCard | ✓ | ✓ |
| LiveCard | ✓ | ✓ |
| SettingRow | ✓ | only the Speed, system player and Diagnostics instances |
| QualityOption | ✓ | ✓ |
| PollOption | ✓ | ✓ |
| PlayerControl | ✓ | — (Interaction Primitives only) |
| Timeline | ✓ | — (Interaction Primitives only) |
| AudioBlock | ✓ | ✓ |
| SideSheet | ✓ | partial (via FilterChip, primitives) |
| Dialog | ✓ | only as «Sign-out Dialog» |
| QrDialog | ✓ | ✓ |
| StateView | ✓ | — (State Patterns only) |
| Skeleton | ✓ | — |
| Badge | ✓ | — |
| Period picker (steppers) | — | ✓ |
| Tag list | — | ✓ |
| Media row (video/audio row in post) | — | ✓ |
| Link chips | — | ✓ |
| Paragraph stops | — | ✓ |
| Event row (События) | — | — |
| Image block (POST-03) | — | — |
| Refresh «Обновить» (FEED-03) | — | — |
| Like counter (POST-10) | — | — |

### Findings
- **[medium]** **Patterns that are new in this design have behavior but no visual spec:** Media row, Link chips, the Paragraph stop focused appearance, Period picker steppers and Tag list. The post screen's two-column layout (focus-map row F, "левая/правая колонка") and the player overlay anatomy are also not described. That anatomy is the title in `player-title`, the author avatar 22 and the button row. A developer must reverse-engineer all of these from `Post Screen.dc.html` and `Player Screen.dc.html` (DESIGN.md › Components; DESIGN.md › Layout & Spacing). *Fix:* add rows for MediaRow, LinkChip, ParagraphStop, PeriodStepper and TagRow, and a short "Post screen" and "Player overlay" layout paragraph.
- **[medium]** **Shared components with no behavior row:** Button (generic), SettingRow (nav/toggle/radio/check/info semantics), PlayerControl, Timeline, SideSheet (generic initial focus and close), Dialog (generic) and StateView. Some behavior exists in Interaction Primitives and State Patterns, but a consumer looking up "Timeline" in Component Patterns finds nothing (EXPERIENCE.md › Component Patterns). *Fix:* add one-line rows that point to the relevant primitive, for example "Timeline — see Player overlay; ←→ 5 s accelerating; bubble commits after `{motion.seek-commit}`".
- **[medium]** **Two confirmed parity items have no component in either spine.** These are the **refresh action** (FEED-03 `P`; focus-map row B has «Обновить») and the **read-only like count** (POST-10 `P`; `Post Screen.dc.html` renders "N лайков"). CLAUDE.md forbids silently dropping confirmed features (EXPERIENCE.md › IA claims FEED-01..03 but never specifies the refresh). *Fix:* add «Обновить» (where it sits; it reloads the feed and subscriptions; focus is kept by id) and a like-count meta in the post header (read-only, never focusable, no comment count).
- **[medium]** **Image blocks (POST-03)** are not covered. The spines do not say whether an image is a focus stop. Paragraph stops exist "so the remote can scroll text", but without image stops a tall image between paragraphs may be skipped or never scrolled into view. Aspect, max height and loading or failed placeholders are also undefined (EXPERIENCE.md › Component Patterns › Paragraph stops). *Fix:* add an Image block rule covering focus stop yes/no, fit and placeholder.
- **[low]** The **Event row** (События, J1–J3) has no spec in either file. The surface is hidden until E18 is verified, so impact is deferred. *Fix:* add a placeholder row marked conditional.
- **[low]** Naming drift. The component sheet says "VideoCard" and "PrimaryButton", the frontmatter uses kebab-case (`nav-item`, `button-primary`, `focusable-surface`), the tables use PascalCase, and EXPERIENCE.md says "Sign-out Dialog" and "FilterChip → filter SideSheet". *Fix:* state the kebab ↔ Pascal mapping once, and note that VideoCard = PostCard (continue variant).

## 4. State coverage — adequate

Checked: every IA surface against loading, empty, error, offline, entitlement, session-expired and focus, plus the CLAUDE.md "TV experience" and "Media and posts" requirements and every focus-map row. Strong points:
- an explicit error-class separation (line 98);
- the global rule that refetch does not move focus;
- the overlay auto-hide exclusions;
- the Back hierarchy in the player;
- progress write triggers;
- the locked-post state;
- the unsupported-block placeholder.

### Findings
- **[high]** **The VOD end-of-playback state is undefined.** The spines do not say what happens when a video reaches its end. This covers: does the player exit or stay on a "ended" frame? Where does focus land? Is the item removed from «Продолжить просмотр»? What counts as "finished" for «the first unfinished video» in a multi-video post (EXPERIENCE.md › Component Patterns › Primary)? PLAY-14 (autoplay next) is unverified, so the spine must say "no autoplay next". Every story that touches the player, the continue row or the multi-video post depends on this (EXPERIENCE.md › State Patterns › Плеер). *Fix:* add an "Ended" state with:
  - a finished threshold, for example ≥ 95% or < 30 s remaining, marked [ASSUMPTION];
  - the final E9 write;
  - exit to the post with focus on the next unfinished media row;
  - removal from or a "просмотрено" mark in the continue row;
  - no autoplay.
- **[high]** **Account change after session expiry is not handled.** Flow 3 promises "the continue-watching history survives (the same account)", and A11 prefills the number. Nothing says what happens if a *different* phone or account signs in from A11 or A2. CLAUDE.md requires no cross-account leakage and an account-scoped cache and progress (EXPERIENCE.md › Flow 3 step 4; State Patterns › Sign-in). *Fix:* add the rule "after sign-in, compare `E1.id` with the stored account id. If it differs, wipe the continue history, the query cache, filters and preferences that are account-scoped, then land on Главная fresh."
- **[medium]** The session-expired column is inconsistent. Only Главная lists "Session expired → A11". Every other surface shows "—", but the IA says "any 401 after a failed refresh". It is also undefined whether the player saves its position before showing A11, and where the user returns after re-login. Flow 3 says Главная; the alternative is the originating screen (EXPERIENCE.md › State Patterns). *Fix:* add a single global row: "401 after refresh failure on any surface → best-effort E9 write if in the player → A11 → after re-login, Главная".
- **[medium]** Rate limit (429), content unavailable (404 or deleted post) and generic server errors are named as distinct classes (line 98), but none has copy or a treatment. The table uses a single "Error + «Повторить»". For 404 a «Повторить» is a dead end (EXPERIENCE.md › State Patterns › Пост; Voice and Tone). *Fix:* add rows: unavailable → «Пост недоступен» + «Назад»; rate limit → wait copy, with no automatic retry storm.
- **[medium]** Device lifecycle is under-specified. The spines do not cover sleep or resume in the player (re-resolve the URL? stay paused?), loss of audio focus (another app takes audio), or a cold start with no network while a session is stored (does the app show A11, an error, or a cached Главная?). The brief's success criterion explicitly includes "after sleep or a reboot" (EXPERIENCE.md › State Patterns › Плеер; Interaction Primitives › Progress writes). *Fix:* add "Resumed from sleep" and "Cold start offline" rows. Audio focus loss → pause and show the overlay.
- **[medium]** Initial focus during loading is not specified. The intro claims "Every surface defines its initial focus for each state", but the table has no focus column. During a skeleton, for example, it is not said whether focus goes to the sidebar's current item or is held (EXPERIENCE.md line 84). focus-map row L covers only states that have an action. *Fix:* add a column, or one rule such as "while a skeleton is shown, focus stays on the sidebar current item; when the first item loads, move focus only if the user has not moved it".
- **[medium]** The **Back hierarchy is ambiguous against focus-map.md**. The spine says "Back from any section goes to Главная. Back on Главная exits the app". focus-map says Back from content goes to the sidebar first (rows B, C, J, K: "→ сайдбар"), then Back on the sidebar on a non-Home section → Главная, and on Home → exit. A consumer cannot tell whether Back from the Главная content exits directly or goes through the sidebar (EXPERIENCE.md › Component Patterns › Sidebar / NavItem). *Fix:* write out the stack explicitly: content → sidebar → (Главная | exit).
- **[medium]** Retracting a vote is ambiguous. "OK on the already chosen option (with pending → confirm) retracts the vote" can be read two ways. It could mean one OK enters pending and a second OK retracts. Or it could mean retracting needs no confirm. The Accessibility Floor says voting needs an explicit confirm, and «Отозвать голос» (multiple choice) has no stated confirm (EXPERIENCE.md › PollOption — single choice; Accessibility Floor). *Fix:* state the retract key sequence for both poll types, and say whether retracting needs confirmation.
- **[medium]** Phone number persistence. A11 needs the phone number stored after the session is lost, but no storage class is named. The phone number is personal data under CLAUDE.md, and logs already redact it (EXPERIENCE.md › IA › Session expired; Diagnostics). *Fix:* state where it is stored (secure storage), and that it is cleared on sign-out.
- **[medium]** The TextField hardcodes the phone prefix as "`+7`". The API takes E.164 (`api-contract.md` §2.2), and nothing in the sources limits the household to Russian numbers. A wrong assumption here blocks sign-in completely (DESIGN.md › Components › TextField). *Fix:* confirm the country with the owner, or make the prefix a visible, editable default.
- **[low]** PLAY-02 fallback: when no quality can be picked automatically, the reference shows a quality dialog before playback. This is not covered. *Fix:* add one row under QualityOption.
- **[low]** «Системный видеоплеер» is on but no external player app is installed, so the chooser is empty. This is not covered. *Fix:* fall back to the built-in player with a hint.
- **[low]** For more than 30 subscriptions, `assumptions.md` lists the "28 из 55" counter (C2) as a client improvement, but the spine keeps only «Показаны первые 30». It is not said which one wins (EXPERIENCE.md › State Patterns › Подписки). *Fix:* pick one.

## 5. Visual reference coverage — adequate

Files in `imports/claude-design-v1/` (the symlink resolves to `planning-artifacts/design/claude-design-v1`):
- 4 overview `.dc.html` files;
- 19 per-screen and per-component `.dc.html` files (Auth Screen, Author Card, Author Page, Events Screen, Home Feed, Live Card, Player Screen, Poll Option, Post Card, Post Screen, QR Dialog, Search Screen, Setting Row, Settings Screen, State Screen, Subscriptions, TV Button, TV Keyboard, TV Sidebar);
- `support.js` and `tv-data.js` (runtime);
- 4 docs;
- 12 screenshots.

Linked:
- DESIGN.md › Brand & Style links the A B C, D-L and Компоненты files.
- EXPERIENCE.md › Visual references links the 4 overview files plus focus-map and handoff.
- tokens.md and assumptions.md appear only in frontmatter `sources`.

Each file states spines-win-on-conflict once (DESIGN.md line 139; EXPERIENCE.md line 22). The overrides are listed (EXPERIENCE.md line 182).

### Findings
- **[medium]** **`TV Keyboard.dc.html` is an orphan.** It draws a custom on-screen Cyrillic keyboard. CLAUDE.md and the spines require the *system* keyboard, and `assumptions.md` says the keyboard is "нарисована условно". With no statement, a consumer may build it as a component. *Fix:* add one line under Visual references: "TV Keyboard.dc.html is an illustration of the system IME. Do not implement it."
- **[low]** 18 other per-screen and per-component files and all 12 screenshots are not referenced. The overview files embed them, so the content is covered, but the most useful references for a story developer are not linked where they apply. These are `Player Screen.dc.html` from Interaction Primitives › Player overlay, `Post Screen.dc.html` from the Media row and Link chips, and `State Screen.dc.html` from State Patterns. *Fix:* add inline "→ illustrated in …" pointers at those sections, and state that the screenshots are non-normative.
- **[low]** References are collected in a table at the end of EXPERIENCE.md rather than placed inline at the relevant sections. The examples place them inline (the "→ Composition reference" line under IA). *Fix:* add a one-line pointer under IA, Component Patterns and the player primitives.
- **[low]** The spines link `../../design/claude-design-v1/...` rather than the `imports/claude-design-v1` symlink recorded in `.memlog.md`. Both resolve. *Fix:* use one form consistently.

## 6. Bloat & overspecification — strong

Both files are lean. Tables carry the load, and the DESIGN.md prose holds decisions, not decoration. The source restatement is minimal and purposeful: the error-class line and the live-on-Home rationale both anchor decisions.

### Findings
- **[low]** The DESIGN.md Components table repeats some numbers that already live in frontmatter, for example "Height 50, 1.5 border", "round 40 dp", "200 dp QR" and "320 dp". Two copies will drift. *Fix:* reference `{components.text-field.height}` etc., or drop the numbers from prose.
- **[low]** The Accessibility Floor restates several CLAUDE.md rules nearly verbatim (one focus target, no hover or touch, auto-hide exclusions). This is harmless, but those lines add no new decision. *Fix:* optional. Keep only the TalkBack label pattern and the confirm rule, and cite CLAUDE.md for the rest.

## 7. Inheritance discipline — adequate

Checked: every `sources` path resolves (brief, tokens, handoff, feature-parity, api-contract, focus-map, assumptions). Feature IDs are used verbatim, with no invented IDs (SEARCH-SCOPES, AUTH-PAGE-*, EVT-01 all exist). EXPERIENCE token references (`{motion.buffer-delay}`, `{motion.overlay-fade}`, `{motion.overlay-hide}`, `{motion.seek-commit}`) resolve to DESIGN tokens by name. No invented endpoints, comments, payment, price or download appear in the UI. QR for links, files and share matches owner decision Q6, and «Нет доступа» shows the level name but never a price (LIVE-01 decision).

### Findings
- **[medium]** The IA maps Плеер to "**PLAY-01..13**". That range includes **PLAY-09 (video download, `X`, owner decision Q2)**. A story generator that expands ranges would pull an excluded feature into scope (EXPERIENCE.md › IA, Плеер row). The same problem affects Настройки → "SET-*", which includes SET-03 (light theme, not required). *Fix:* list the IDs explicitly (PLAY-01..08, 10..13; SET-01, 02, 04, 05, 06) or add "excluding PLAY-09".
- **[medium]** CLAUDE.md marks `docs/android-tv-auth-playback-spike.md` and `docs/testing.md` as mandatory inputs to every BMAD planning step. Neither spine lists them in `sources`, although EXPERIENCE.md › Open items cites "spike S2, S5, S7, S11" and DESIGN.md `units` cites testing.md. *Fix:* add both to the frontmatter `sources` of each file. Add `api-contract.md` to DESIGN.md too.
- **[low]** Flow 3 step 2 puts initial focus on «Получить код». focus-map row A2–A4 says the initial focus is «Поле». This is a reasonable change for a prefilled number, but it is not listed in the override line (EXPERIENCE.md line 182). *Fix:* add it to the overrides.
- **[low]** The Events gate is named inconsistently: "until EVT-01 is verified" (DESIGN.md line 197) and "until E18 is verified" (EXPERIENCE.md line 38). *Fix:* use "E18 (EVT-01)" in both.
- **[low]** The spine maps «Rew/Prev = −seek». PLAY-06 notes that MEDIA_REWIND is not handled in the reference, so mapping it is our improvement, and that is not marked. STOP (handled in the reference) is not mapped (EXPERIENCE.md › Interaction Primitives › Keys). *Fix:* mark Rew as an improvement, and define STOP.

## 8. Shape fit — strong

DESIGN.md follows the canonical order exactly (Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts). EXPERIENCE.md has all eight required defaults. The required-when-applicable sections are present: Inspiration is triggered by BoostBuddy, and Responsive & Platform by the 720p/1080p/4K outputs and the later tvOS target. The invented sections earn their place: Visual references holds the override list, and Open items links back to api-contract §8.

### Findings
- **[low]** The DESIGN.md frontmatter adds non-spec top-level groups (`focus`, `motion`, `units`, `title`, `status`, `created`, `sources`). They are useful, but generic DESIGN.md tooling may drop `focus` and `motion`, which component tokens reference. *Fix:* keep them, and add one line in the body noting that they are project extensions.
- **[low]** The EXPERIENCE.md frontmatter lacks `name`, which both examples carry. *Fix:* add `name: Boosty TV`.
- **[low]** Key Flows comes before Responsive & Platform and Inspiration. The examples put Key Flows last. The order is not locked, so this has no real impact.

## Mechanical notes

- **Token references:** 0 undefined. Defined but unreferenced: `typography.player-title`, `motion.scroll`, `motion.spinner` and the numeric `spacing.1–12` ramp (the ramp is fine as a scale).
- **px/2 parity with tokens.md:** exact for every token checked. The only gap is SideSheet 340 dp (from 680 px), which is missing.
- **Color format:** 24 hex and 2 rgba (`scrim`, `overlay-badge`). There is also a literal `#FFFFFF` in `components.qr-dialog`.
- **Contrast below target:** `text-tertiary` on `surface-focus-row` is 3.42:1, and `text` on `live` is 4.39:1.
- **Units:** RN lineHeight mixes multipliers and absolute values (see §2, high).
- **Names:** "VideoCard" (component sheet) = PostCard. Frontmatter component keys are kebab-case and the tables are PascalCase. "Sign-out Dialog" is an instance of Dialog. "Sidebar / NavItem" is one row in both files, but the handoff has two components.
- **Feature-ID ranges** that include excluded items: `PLAY-01..13` (PLAY-09) and `SET-*` (SET-03).
- **Paths:** all `sources` and visual-reference paths resolve. The `imports/claude-design-v1` symlink resolves to `planning-artifacts/design/claude-design-v1`.
- **Mermaid:** none present.
- **Severity counts:** critical 0 · high 4 · medium 18 · low 25.
