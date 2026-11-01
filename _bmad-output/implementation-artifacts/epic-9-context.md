# Epic 9 Context: Ready for the family (P3)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the Android build into something the family can run every evening and the owner can retire BoostBuddy for. Releases, in-app updates and performance are done. 0.9.0 and 0.9.1 are on GitHub Releases, and the TV installs updates after an explicit OK. Story 9.3 measured scrolling, time to first frame and memory on the pinned Chromecast with Google TV 4K against targets the owner set, and the owner accepted two exceptions. Two stories remain. Story 9.4 checks visual fidelity and accessibility against the agreed design. Story 9.5 is the full real-device regression and ends with the owner's explicit acceptance of the Android release. That acceptance starts the switch-over and session-longevity observation periods.

## Stories

- Story 9.1: Signed release on GitHub Releases (done)
- Story 9.2: Update notice and in-app install from GitHub Releases (done)
- Story 9.3: Performance on the device (done)
- Story 9.4: Visual fidelity and accessibility pass (next)
- Story 9.5: Full device regression and owner acceptance

## Requirements & Constraints

- **Settled owner decisions:**
  - «Boosty TV» is the final name. The banner and icon carry no Boosty marks.
  - The keystore and its passwords stay outside the repository. The passwords are in `~/.gradle/gradle.properties`. Never read, print or log them.
  - In-app update needs an explicit OK plus the system installer. It is never silent and never retried automatically. The QR is the fallback.
  - Publishing a release needs the owner's OK.
- **Performance (9.3, done, must not regress):**
  - Scroll target: no frame of 300 ms or longer, janky frames ≤ 10 % (gfxinfo), no focus lag.
  - TTFF target: median ≤ 2 s, worst ≤ 4 s. Both pass.
  - Memory: PSS shows no growth.
  - Exceptions the owner accepted on 2026-11-01: held-↓ jank on Главная (15–21 %) and the Graphics image-cache plateau (about 115 MB).
  - The untried fixes need the owner, because they change the PostCard design or the stale-image guard. Fewer views per PostCard is one of them, so 9.4 must not quietly add views to the card.
- **Fidelity (9.4):**
  - Compare every IA screen on the device at 1080p and 720p against the mocks and DESIGN.md.
  - Fix each deviation, or list it for the owner to accept.
  - Components use tokens only, with no raw colors or sizes.
- **Contrast (9.4):** check every pair in the DESIGN.md contrast table in the built app, including:
  - text-secondary on surface-focus-row, since all secondary and tertiary text switches to it inside a focused row or tile;
  - text on live (the LIVE badge and the «Эфир» chip);
  - accent-ink on accent / accent-focus;
  - the focus ring on bg and on surface-focus-button;
  - text on overlay-badge over video.
  - text-tertiary is allowed only on bg, bg-sidebar and surface.
- **Text size:** no text below 11 sp.
- **Font scale (deferred to 9.4):** pick a font-scale policy (cap `maxFontSizeMultiplier`, or let fixed-height controls grow). Check A1 and Button at the largest Android TV text size with a screenshot.
- **TalkBack (9.4):** every focusable element announces a meaningful Russian label, for example «Видео. {title}. {author}, {date}. Осталось {n} минут». Earlier stories left TalkBack unverified everywhere. Their deferred rows (player controls, MediaRows, cards, tiles, LiveCard, polls) close here.
- **Focus map (9.4):** walk every screen against `docs/focus-map.md`: initial focus, arrows, OK, Back and restoration. Fix any mismatch in code. Changing the doc instead needs the owner's approval.
  - Known open defect: with a «Продолжить» card as Главная's remembered focus, the path Настройки → ← ↑ to «Главная» → OK leaves Главная scrolled past its header with nothing focused.
- **Regression (9.5):**
  - Run the CLAUDE.md device checklist with the release build. Walk UJ-0 to UJ-7 with the remote only. UJ-1 takes 5 presses or fewer, with no autoplay shortcuts.
  - Record the results in `docs/testing.md`.
- **Evidence labels:** keep physical-device, emulator and mock results apart. A run by the agent over adb is never a physical-remote or TalkBack-by-owner check.

## Technical Decisions

- **Builds:** agent device builds are owner-signed `assembleRelease`, installed with `adb install -r` over the family build. Nothing is uninstalled or cleared. Debug builds cannot install over the family build. The release build fails if the demo flag is on, so demo-only states need a debug build with Metro.
- **Before each adb key batch:** confirm the app is in the foreground. The device runs the owner's «Button Mapper» accessibility service. Leave it enabled; it affects frame numbers and may interact with TalkBack.
- **Tokens:** `src/shared/ui/tokens.ts` mirrors the DESIGN.md frontmatter. `src/shared/ui/__tests__/tokens.test.js` compares the two, so change both together.
  - Typography sets `fontFamily` per weight and never `fontWeight` (bundled Golos Text).
  - Shared primitives live in `src/shared/ui/`. FocusableSurface supplies the ring, the surface lift and the scale as a transform, so focus never reflows the layout.
- **Lists:** FlashList 2.3.3 (ADR 0011). The post grid's `drawDistance` is 2 rows (ADR 0015, pinned in `homeFeedFlow.test.tsx`). Any further list change needs profiling evidence and an ADR.
- **Focus:** native only (react-native-tvos, `TVFocusGuideView`). There is no JS focus engine. Focus IDs follow `<screen>/<zone>/<id>`.
- **Logging:** use structured fields; `loggerFieldKeys` covers new call sites. Redact signed URLs and personal data. The TTFF `first frame` line carries no URL, id or title.
- **Update path:** `features/update`, `app/update.ts` and the `AppUpdater` port must not regress.
- **Copy:** Russian strings in `ru` (i18n-ready). Code and docs are in English.

## UX & Interaction Patterns

- **Where the 9.4 inputs live:**
  - `_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md`: tokens frontmatter, Colors with the contrast table, Typography, Layout & Spacing, the Components anatomy and states table, and Do's and Don'ts.
  - `EXPERIENCE.md` (same folder): IA screen list A–K, Interaction Primitives, Accessibility Floor, Key Flows 0–7, and «Overrides of the mocks and focus-map».
  - `review-rubric.md` (same folder): an earlier review of the DESIGN.md / EXPERIENCE.md pair.
  - Mocks: `_bmad-output/planning-artifacts/design/claude-design-v1/`. The overviews are `Boosty TV - A B C.dc.html` and `Boosty TV - D-L.dc.html`, the state matrix is `Boosty TV - Компоненты.dc.html`, and per-screen and per-component `*.dc.html` files sit alongside. `docs/tokens.md`, `docs/focus-map.md` and `docs/handoff-rn-tv.md` are in that package. `screenshots/` is non-normative.
  - Normative focus contract: `docs/focus-map.md`.
- **Precedence:** EXPERIENCE.md > DESIGN.md / `docs/focus-map.md` > the design package's focus map > the mocks. As-built and superseded notes in DESIGN.md are the target, not the mocks:
  - post grids have 3 columns of 221 dp, not 4;
  - Пост is one column with the header on top;
  - Автор and Пост show the Shell sidebar;
  - ImageBlock focus has no scale;
  - the PostCard placeholder without a preview, the LiveCard and EventRow layouts, and the «Показаны первые 30» copy.
  - `TV Keyboard.dc.html` only illustrates the system IME. Never implement it.
- **Layout:** one logical layout of 960×540 dp at 720p, 1080p and 4K. This is still marked as an assumption to verify on the device, and 9.4 can settle it. Text and focusable elements stay inside the safe area. The fifth card of a row is cut by the edge as a scroll hint.
- **Focus visuals:**
  - One clear target: the ring plus the surface lift plus the scale, never color alone.
  - «Current» (surface-current plus an accent bar) is distinct from «focused».
  - Disabled elements are not focusable.
  - With the system "reduce motion" setting, the scale stays and scrolling becomes instant.
- **Anti-patterns:** no comment counts, prices, sort controls or light theme, and no gradients except the player legibility band. Never offer quality, speed or track options the stream lacks.

## Cross-Story Dependencies

- 9.4 feeds fixes back into earlier epics' screens. Its focus-map and TalkBack pass should land before 9.5, so the regression runs on the final UI.
- 9.4 changes to PostCard or the grids must keep the 9.3 numbers. Re-measure, or note the risk, if the card's view count grows.
- 9.5 runs on the next published release after 0.9.1. It should also exercise the in-app update from the previous release, including the per-ABI asset path, which has not run on the device yet.
- 9.5 can close open owner device passes from earlier retros:
  - a second account;
  - physical-remote passes;
  - live at 1×;
  - the chooser with 2+ players;
  - the 55-author grid, measured only on the emulator so far.
