---
name: Boosty TV
description: Unofficial, remote-first Boosty client for Android TV. Dark, calm, warm-accented, readable from the sofa.
title: "Boosty TV — Design"
status: final
created: 2026-10-25
updated: 2026-10-25
sources:
  - ../../briefs/brief-boosty-tv-2026-10-25/brief.md
  - ../../design/claude-design-v1/docs/tokens.md
  - ../../design/claude-design-v1/docs/handoff-rn-tv.md
  - ../../../../docs/feature-parity.md
  - ../../../../docs/api-contract.md
  - ../../../../docs/android-tv-auth-playback-spike.md
  - ../../../../docs/testing.md
units: >
  All sizes are Android dp, assuming the device UI is 960x540 dp (Chromecast
  with Google TV 4K at 1080p UI). Each value is the Claude Design 1920x1080 px
  value divided by 2. [ASSUMPTION] Verify on the device at spike start
  (docs/testing.md). Font sizes are in sp at default font scale.
  lineHeight values are ABSOLUTE sp (React Native semantics). They were
  computed as fontSize x design multiplier and rounded.
colors:
  bg: '#171615'
  bg-sidebar: '#1D1B19'
  surface: '#221F1D'
  surface-raised: '#2E2B28'
  surface-focus-row: '#3A3632'
  surface-focus-button: '#46413B'
  surface-current: '#2A2724'
  skeleton: '#24221F'
  border: '#3A3632'
  text: '#F4EFE7'
  text-card: '#E6E0D8'
  text-secondary: '#B7B0A6'
  text-meta: '#A9A299'
  text-tertiary: '#8F887F'
  text-disabled: '#6E6962'
  accent: '#E8914A'
  accent-focus: '#F2A05A'
  accent-text: '#F2A462'
  accent-ink: '#1E140A'
  accent-tint: '#3A2A1C'
  focus-ring: '#F4EFE7'
  error: '#E0624F'
  error-text: '#F29A8A'
  live: '#BE382F'
  qr-bg: '#FFFFFF'
  scrim: '#0A0908D1'
  overlay-badge: '#12100ED9'
typography:
  hero:         { fontFamily: Golos Text, fontSize: 64, lineHeight: 70, fontWeight: 600 }
  title-l:      { fontFamily: Golos Text, fontSize: 28, lineHeight: 31, fontWeight: 600 }
  title-m:      { fontFamily: Golos Text, fontSize: 24, lineHeight: 29, fontWeight: 600 }
  title-s:      { fontFamily: Golos Text, fontSize: 22, lineHeight: 25, fontWeight: 600 }
  section:      { fontFamily: Golos Text, fontSize: 16, lineHeight: 19, fontWeight: 600 }
  player-title: { fontFamily: Golos Text, fontSize: 20, lineHeight: 24, fontWeight: 600 }
  body:         { fontFamily: Golos Text, fontSize: 14, lineHeight: 22, fontWeight: 400 }
  body-s:       { fontFamily: Golos Text, fontSize: 13, lineHeight: 19, fontWeight: 400 }
  button:       { fontFamily: Golos Text, fontSize: 14, lineHeight: 17, fontWeight: 600 }
  button-s:     { fontFamily: Golos Text, fontSize: 12, lineHeight: 15, fontWeight: 600 }
  card-title:   { fontFamily: Golos Text, fontSize: 13, lineHeight: 16, fontWeight: 600 }
  meta:         { fontFamily: Golos Text, fontSize: 11, lineHeight: 15, fontWeight: 400 }
  badge:        { fontFamily: Golos Text, fontSize: 11, lineHeight: 13, fontWeight: 600 }
rounded:
  sm: 4
  md: 7
  lg: 8
  xl: 12
  full: 9999
spacing:
  '1': 2
  '2': 4
  '3': 6
  '4': 8
  '5': 10
  '6': 12
  '7': 14
  '8': 16
  '9': 20
  '10': 24
  '11': 28
  '12': 32
  safe-x: 48
  safe-y: 27
  sidebar-width: 168
  content-x: 192
  content-width: 720
  card-width: 168
  card-gap-x: 16
  card-gap-y: 22
  author-tile-width: 232
  author-tile-gap: 12
  focus-headroom: 12
  text-measure: 600
focus:
  ring-width: 2
  ring-offset: 2
  scale-post-card: 1.06
  scale-author-card: 1.05
  scale-live-card: 1.03
  scale-button: 1.04
  scale-row: 1.02
  scale-field: 1.0
  pressed-scale: 0.98
  card-shadow: { offsetY: 9, blur: 20, color: '#00000080', note: 'boxShadow with the New Architecture; elevation fallback otherwise [ASSUMPTION: verify with the chosen RN version]' }
motion:
  focus:        { duration: 160ms, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
  press:        { duration: 80ms, easing: linear }
  scroll:       { duration: 240ms, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
  panel:        { duration: 200ms, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
  overlay-fade: { duration: 200ms, easing: linear }
  overlay-hide: { delay: 5000ms }
  seek-commit:  { delay: 600ms }
  buffer-delay: { delay: 500ms }
  spinner:      { duration: 900ms, easing: linear }
components:
  focusable-surface: { ringColor: '{colors.focus-ring}', ringWidth: '{focus.ring-width}', ringOffset: '{focus.ring-offset}', transition: '{motion.focus}' }
  nav-item: { width: 136, insetX: 16, paddingLeft: 32, height: 36, radius: '{rounded.md}', currentBg: '{colors.surface-current}', currentMark: '{colors.accent}', focusBg: '{colors.surface-focus-row}', text: '{typography.button}' }
  button-primary: { height: 40, paddingX: 20, radius: '{rounded.lg}', bg: '{colors.accent}', bgFocus: '{colors.accent-focus}', text: '{colors.accent-ink}', scaleFocus: '{focus.scale-button}' }
  button-secondary: { height: 40, paddingX: 20, radius: '{rounded.lg}', bg: '{colors.surface-raised}', bgFocus: '{colors.surface-focus-button}', text: '{colors.text}' }
  button-small: { height: 32, paddingX: 14, text: '{typography.button-s}' }
  filter-chip: { height: 32, radius: '{rounded.full}', bg: '{colors.surface-raised}', countBg: '{colors.accent-tint}' }
  text-field: { height: 50, borderWidth: 1.5, radius: '{rounded.lg}', bg: '{colors.surface}', border: '{colors.border}', borderFocus: '{colors.focus-ring}', borderError: '{colors.error}', scaleFocus: '{focus.scale-field}' }
  post-card: { width: '{spacing.card-width}', thumbAspect: '16:9', radius: '{rounded.md}', titleLines: 2, title: '{typography.card-title}', meta: '{typography.meta}', scaleFocus: '{focus.scale-post-card}' }
  author-card: { width: '{spacing.author-tile-width}', height: 76, avatar: 52, radius: '{rounded.md}', scaleFocus: '{focus.scale-author-card}' }
  live-card: { width: 520, height: 120, cover: '192x108', badge: '{colors.live}', scaleFocus: '{focus.scale-live-card}' }
  setting-row: { minHeight: 44, compactHeight: 38, radius: '{rounded.md}', bgFocus: '{colors.surface-focus-row}', scaleFocus: '{focus.scale-row}' }
  poll-option: { height: 42, radius: '{rounded.md}', resultBar: '{colors.accent-tint}', chosenMark: '{colors.accent}', scaleFocus: '{focus.scale-row}' }
  media-row: { height: 64, thumb: '96x54', radius: '{rounded.md}', progress: '{colors.accent}', scaleFocus: '{focus.scale-row}' }
  event-row: { width: 696, height: 56, avatar: 32, dot: 6, radius: '{rounded.lg}', bg: '{colors.surface}', bgFocus: '{colors.surface-focus-row}', chip: '{colors.live}', scaleFocus: '{focus.scale-row}' }
  link-chip: { height: 32, radius: '{rounded.full}', bg: '{colors.surface-raised}', suffix: 'QR' }
  player-control: { size: 40, radius: '{rounded.full}', bg: '{colors.overlay-badge}', bgFocus: '{colors.text}', iconFocus: '{colors.bg}' }
  timeline: { trackHeight: 3, trackHeightFocus: 5, progress: '{colors.accent}', thumb: '{colors.text}', bubble: '{colors.overlay-badge}' }
  side-sheet: { widthFilters: 320, widthPlayer: 340, bg: '{colors.bg-sidebar}', radius: 0, enter: '{motion.panel}' }
  dialog: { maxWidth: 560, radius: '{rounded.xl}', bg: '{colors.surface}', scrim: '{colors.scrim}' }
  qr-dialog: { qrSize: 200, radius: '{rounded.xl}', qrBg: '{colors.qr-bg}' }
  state-view: { iconSize: 48, title: '{typography.title-s}', body: '{typography.body-s}' }
  badge: { height: 20, radius: '{rounded.sm}', bg: '{colors.overlay-badge}', text: '{typography.badge}' }
  avatar: { meta: 16, player: 22, post: 28, authorHeader: 56 }
---

## Brand & Style

Boosty TV is a personal, household tool, not a storefront. It should feel like a calm living-room appliance: switched on, already signed in, showing what is new from the authors the family supports. It is independent and unofficial, and never borrows Boosty's brand marks or colors.

Dark graphite, quiet warm surfaces, one restrained warm orange accent. Content (previews, titles, author faces) carries the color; chrome stays neutral. No autoplay on Home, no oversized hero, no decorative motion.

Visual reference: the Claude Design package (`../../design/claude-design-v1/`, also linked as `imports/claude-design-v1`). The overview screens are `Boosty TV - A B C.dc.html` and `Boosty TV - D-L.dc.html`. The component sheet is `Boosty TV - Компоненты.dc.html`. Screenshots in `screenshots/` are non-normative. **This file and EXPERIENCE.md win over the mocks on any conflict.**

Frontmatter note: the `focus`, `motion` and `units` groups are project extensions of the DESIGN.md spec. Component tokens reference them, so they must be kept.

## Colors

- **Graphite canvas (`{colors.bg}`)** sits behind every screen. **`{colors.bg-sidebar}`** separates the sidebar and side sheets by tone only, with no borders.
- **Surfaces (`{colors.surface}`, `{colors.surface-raised}`)** are for rows, tiles, fields and secondary buttons. Focus lifts them to `{colors.surface-focus-row}` (rows, tiles) or `{colors.surface-focus-button}` (buttons).
- **Current vs focused.** Current section or selected option: `{colors.surface-current}` plus an accent mark. This is never used to show focus. Focus is always `{colors.focus-ring}`, a surface lift and scale.
- **Accent (`{colors.accent}`)** is used only for the primary action, progress, the current-section mark and selected radio/check marks. It is never decorative. `{colors.accent-text}` is for accent text on dark. `{colors.accent-tint}` is the background for «Мой блог», «по подпискам» and filter counts.
- **Text ramp:** `{colors.text}` › `{colors.text-card}` › `{colors.text-secondary}` › `{colors.text-meta}` › `{colors.text-tertiary}` › `{colors.text-disabled}`. `{colors.text-tertiary}` is allowed only on `{colors.bg}`, `{colors.bg-sidebar}` and `{colors.surface}`. **Inside a focused row or tile, all secondary and tertiary text switches to `{colors.text-secondary}`.** `{colors.text-disabled}` is for non-focusable elements only.
- **Error (`{colors.error}`, `{colors.error-text}`):** field border and icon, and error copy. Never used as a full-screen fill.
- **Live (`{colors.live}`):** LIVE badge only.
- **Scrim (`{colors.scrim}`)** goes behind dialogs and QR. **`{colors.overlay-badge}`** is for badges, durations and player controls over video. **`{colors.qr-bg}`** is the QR quiet zone only.

Contrast (WCAG 2.x, checked):

| Pair | Ratio | Target |
|---|---|---|
| `{colors.text}` on `{colors.bg}` | 15.8 | ≥ 7 |
| `{colors.text-tertiary}` on `{colors.bg}` | 5.2 | ≥ 4.5 |
| `{colors.text-secondary}` on `{colors.surface-focus-row}` | 5.6 | ≥ 4.5 |
| `{colors.accent-ink}` on `{colors.accent}` / `{colors.accent-focus}` | 7.4 / 8.6 | ≥ 4.5 |
| `{colors.text}` on `{colors.live}` | 4.8 | ≥ 4.5 |
| `{colors.text}` on `{colors.overlay-badge}` | ≈ 16 | ≥ 4.5 over any video |
| `{colors.focus-ring}` on `{colors.bg}` / `{colors.surface-focus-button}` | 15.8 / 8.8 | ≥ 3 (non-text) |

## Typography

Golos Text, bundled with the app, full Cyrillic. The UI reads from 2–3 m, so nothing is smaller than `{typography.meta}` / `{typography.badge}` (11 sp). Line heights are absolute (see `units`).

- **Titles:** screen and section `{typography.title-s}`; row headers `{typography.section}`; post title `{typography.title-m}`, max 6 lines; sign-in and full-screen states `{typography.title-l}`; Welcome only `{typography.hero}`; player overlay title `{typography.player-title}`, max 2 lines.
- **Reading:** post text `{typography.body}`; explanations `{typography.body-s}`.
- **Cards:** `{typography.card-title}`, max 2 lines, ellipsized. A card never grows.
- **Numbers:** tabular numerals for time and counters.
- **Copy:** Russian, designed for long titles.

## Layout & Spacing

- **Frame and safe area.** Frame 960×540 dp. Safe area `{spacing.safe-x}` / `{spacing.safe-y}` (≈ 5%). This is a design decision justified by the composition. Sidebar background and previews may bleed. Text and focusable elements never cross the safe area.
- **Screens other than the player.** Fixed sidebar `{spacing.sidebar-width}`. Content starts at `{spacing.content-x}` and is `{spacing.content-width}` wide.
- **Grids use fixed columns.**
  - Posts: 4 × `{spacing.card-width}`, gaps `{spacing.card-gap-x}` / `{spacing.card-gap-y}`.
  - Authors: 3 × `{spacing.author-tile-width}`, gap `{spacing.author-tile-gap}`.
- **Fifth card.** The fifth card of a horizontal row is cut by the edge as a scroll hint. The focused card is always fully inside the safe area. Rows keep `{spacing.focus-headroom}` inner padding so scaling is never clipped.
- **Post screen.** One vertically scrolling column in the content area, header on top (owner decision 2026-10-27; supersedes the two columns of `Post Screen.dc.html`).
  - Header: author row (`{components.avatar.post}`), title, date · like count (read-only); the primary and secondary buttons (Epic 4) and the locked copy go in or right under it. Not pinned: it scrolls away with the content.
  - Then the media rows (full content width), then text, images, link chips, files and the poll.
  - Body text (paragraphs, placeholders) is capped at `{spacing.text-measure}` (≈ 75 Cyrillic characters at `body`), left-aligned; the header and the rows may use the full `{spacing.content-width}`.
  - The column scrolls natively to the focused element.
  - → `Post Screen.dc.html` still shows the earlier two-column layout; the order of elements is unchanged.
- **Player overlay.**
  - Top band: avatar `{components.avatar.player}` · author, post title `{typography.player-title}`, video title if different.
  - Bottom band: Timeline, then elapsed / remaining time, then PlayerControls (play/pause, «Настройки»).
  - Both bands sit on a bottom/top darkening gradient over the video. This is the only gradient in the app and it exists for legibility.
  - → Illustrated in `Player Screen.dc.html`.
- **Resolution.** A 1280×720 output gives the same 960×540 dp. [ASSUMPTION, verify on the device]

## Elevation & Depth

Hierarchy comes from tone, not shadow. The only shadow is `{focus.card-shadow}` under a focused card. Dialogs and side sheets sit above the scrim.

## Shapes

| Radius | Used for |
|---|---|
| `{rounded.sm}` | Badges |
| `{rounded.md}` | Cards, rows, small buttons |
| `{rounded.lg}` | Buttons, fields, panels |
| `{rounded.xl}` | Dialogs |
| `{rounded.full}` | Chips, player controls, avatars |

The focus ring follows the shape at `{focus.ring-offset}`.

## Components

Names: tables use PascalCase; frontmatter keys use kebab-case (`PostCard` = `post-card`). The component sheet's "VideoCard" is PostCard, and "PrimaryButton" is Button primary. Sizes live in the frontmatter `components`. The rows below describe anatomy and states only. [ASSUMPTION] Sizes for player-control, timeline, media-row, dialog, qr-dialog and state-view, the post left-column width (≈ 260 dp) and the image max height (300 dp) were estimated from the mocks, not taken from `tokens.md`. Confirm them against the mocks when implementing.

Every focusable component is built on **FocusableSurface**. In focus it gets the ring, a surface lift and a component-specific scale applied as a transform, so layout never changes. Pressed adds `{focus.pressed-scale}` for `{motion.press}`. Disabled components are not focusable and use `{colors.text-disabled}`.

| Component | Anatomy and visual states |
|---|---|
| **Sidebar / NavItem** | Wordmark «Boosty TV» and 5 labeled items: Главная, Поиск, Подписки, События, Настройки. Always expanded. **Current:** `{colors.surface-current}` plus an accent bar. **Focused:** ring plus `{colors.surface-focus-row}`. «События» is hidden until E18 (EVT-01) is verified (shown since Story 7.5, `events` flag on). |
| **Button** | Kinds: primary, secondary, ghost, icon-only. Sizes: normal, small. Primary uses `{colors.accent}`; secondary uses `{colors.surface-raised}`. Optional sub-label (for example «видео 2») and count. The refresh button «Обновить» is a secondary small Button. |
| **FilterChip** | Pill with label and current value («Фильтры · Доступные мне») or an active-filter count. Implemented (Story 5.3, `src/shared/ui/FilterChip.tsx`): 32 dp on `{colors.surface-raised}`, label and value, plus a count badge on `{colors.accent-tint}` (`{colors.accent-text}` digits) when filters are active; focused: ring, `{colors.surface-focus-button}` and the button scale. |
| **TextField** | Kinds: phone, code, search. **Focused:** `{colors.focus-ring}` border, no scale. **Error:** `{colors.error}` border plus `{colors.error-text}` message. **Phone:** an editable country code (default `+7`) followed by the number field. **Code:** a single field, because the code length is unknown. |
| **PostCard** | 16:9 preview. Type badge at top-left: Видео, N видео, Аудио, Текст и фото, Опрос, Файл, Нет доступа (LIVE only if conditional). Bottom-right: duration, when known. Bottom edge: accent progress, when duration is known. Below the preview: 2-line title, then avatar · author · date. **Locked:** dimmed preview, lock glyph, «Нет доступа» badge. **No preview** (any kind; none given, or it failed to load; owner decision 2026-10-30): the author's round avatar (0.5 of the thumb height) centred on a `{colors.surface-raised}` plate, never the `{colors.skeleton}` loading colour, so «no picture» differs from «still loading». Without an avatar, or when it fails: a post-type outline icon (0.3 of the thumb height; video, several videos, audio, text and photo, poll, file) in `{colors.text-secondary}`. Locked without a preview: the plate, the avatar dimmed and the lock glyph on top, no type icon; with no avatar, the plate and the lock only. **Feed and Author grids: 3 columns** (owner decision 2026-10-26, device review; supersedes 4); card width 221 dp in the 720 dp content with `focus-headroom` on both sides. |
| **AuthorCard** | Avatar, owner name (2 lines), blog title (1 line, meta; the title is usually a tagline — owner decision 2026-10-27; no owner name → the title alone). The Author page header uses the same order. Optional «Мой блог» tint label. |
| **LiveCard** | Cover with LIVE badge, title, viewers · likes, required level name (never a price), «Нравится» and «Поделиться». States: live, scheduled, needs level. |
| **MediaRow** | One row per video or audio in a post. Contents: thumbnail (or an audio glyph), «Видео N» label, title, status («Не начато» / «Осталось N мин» / «Просмотрено»), and a progress line when known. |
| **ImageBlock** | Full right-column width. Aspect is preserved, max height 300 dp. **Loading:** `{colors.skeleton}`. **Failed:** a neutral placeholder with «Изображение недоступно». **Focused:** ring plus `{focus.scale-row}`. |
| **ParagraphStop** | A paragraph of expanded text. **Focused:** a subtle `{colors.surface}` background behind the paragraph with a 2 dp accent bar on the left. No scale. |
| **LinkChip** | Pill with the link text and a «QR» suffix. Placed under the paragraph it comes from. |
| **LikeCount** | Meta text «N лайков» in the post header. Never focusable. There is no comment count anywhere. |
| **SettingRow** | Kinds: nav, toggle, radio, check, info. Label, optional description and value. Marks and the "on" toggle track use `{colors.accent}`. |
| **QualityOption** | SettingRow radio. «Авто» (with «· 1080p» only if the player reports it), then 2160p…144p. |
| **PeriodStepper** | Three value boxes (day, month, year) with ▲/▼ hints. The focused box gets the ring. Then «Готово». |
| **TagRow** | SettingRow check with the tag title. A «Загрузить ещё» row at the end while more pages exist. |
| **PollOption** | Text plus a result bar (`{colors.accent-tint}`) with percent. **Chosen:** accent check. **Pending:** pulsing accent outline plus the hint «Нажмите OK ещё раз». **Sending:** spinner. **Finished:** results only. |
| **PlayerControl** | Round control on `{colors.overlay-badge}`. **Focused:** inverted (`{colors.text}` fill, `{colors.bg}` icon) plus ring. |
| **Timeline** | Track with accent progress and a thumb. Thicker when focused. While seeking, a bubble shows the target time. Below: elapsed and remaining, tabular. **Live:** no track; LIVE badge plus elapsed time since start. |
| **AudioBlock** | An inline row: play/pause glyph, title, position / duration, thin progress. A single focus target. |
| **EventRow** *(conditional)* | Author avatar, text («Начался эфир»), author name, time. Unread events show an accent dot. Implemented (Story 7.5, `src/features/events/EventRow.tsx`, `event-row` tokens): a 696 × 56 dp row (the 720 dp content minus the focus headroom on both sides) on `{colors.surface}`; a 6 dp `{colors.accent}` dot (unread only; the slot stays when read), a 32 dp avatar, the author name (semibold) and the text on one ellipsized line, a «Эфир» chip on `{colors.live}` for a stream start, and the time (`meta`). Focused: ring, `{colors.surface-focus-row}` and the row scale. |
| **SideSheet** | Right panel (filters `widthFilters`, player settings `widthPlayer`), `{colors.bg-sidebar}`, enters with `{motion.panel}`. |
| **Dialog** | Centered, `{rounded.xl}`, above the scrim. Title, body, 2 actions. |
| **QrDialog** | Dialog with a QR on `{colors.qr-bg}`, a title, the target description («Откроется на телефоне») and «Закрыть». The URL is never printed in full. |
| **StateView** | Icon, `{typography.title-s}` title, `{typography.body-s}` explanation, one action. |
| **Skeleton** | `{colors.skeleton}` blocks that match the card and row geometry. Spinner: `{motion.spinner}`. |
| **Badge** | `{colors.overlay-badge}` with `{typography.badge}`. LIVE uses `{colors.live}`. |

## Do's and Don'ts

- **Do** show focus with the ring, the surface lift and scale together. **Don't** rely on color alone, reflow neighbors or clip.
- **Do** use a single accent. **Don't** use gradients (except the player legibility band), glass, neon or the Boosty palette.
- **Do** ellipsize long Russian titles to fixed line counts. **Don't** let cards change height.
- **Do** keep all text ≥ 11 sp and inside the safe area.
- **Don't** show prices, payment, subscribe buttons, comment counts, download, sort controls or a light theme.
- **Don't** show quality, speed or track options the stream does not provide. Subtitles and audio tracks are never shown.
- **Don't** implement the on-screen keyboard drawn in `TV Keyboard.dc.html`. It only illustrates the system IME.
