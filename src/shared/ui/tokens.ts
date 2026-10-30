/**
 * Design tokens from DESIGN.md frontmatter
 * (_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/DESIGN.md).
 *
 * Units: dp / sp (design px ÷ 2). lineHeight values are absolute sp.
 * Durations and delays are milliseconds.
 *
 * Typography sets `fontFamily` per weight and never `fontWeight`: the bundled
 * Golos Text static files (android/app/src/main/assets/fonts) are resolved by
 * file name, and a `fontWeight` would make Android synthesize bold.
 *
 * src/shared/ui/__tests__/tokens.test.js compares every group with DESIGN.md.
 * Change both together.
 */

export const colors = {
  bg: '#171615',
  'bg-sidebar': '#1D1B19',
  surface: '#221F1D',
  'surface-raised': '#2E2B28',
  'surface-focus-row': '#3A3632',
  'surface-focus-button': '#46413B',
  'surface-current': '#2A2724',
  skeleton: '#24221F',
  border: '#3A3632',
  text: '#F4EFE7',
  'text-card': '#E6E0D8',
  'text-secondary': '#B7B0A6',
  'text-meta': '#A9A299',
  'text-tertiary': '#8F887F',
  'text-disabled': '#6E6962',
  accent: '#E8914A',
  'accent-focus': '#F2A05A',
  'accent-text': '#F2A462',
  'accent-ink': '#1E140A',
  'accent-tint': '#3A2A1C',
  'focus-ring': '#F4EFE7',
  error: '#E0624F',
  'error-text': '#F29A8A',
  live: '#BE382F',
  'qr-bg': '#FFFFFF',
  scrim: '#0A0908D1',
  'overlay-badge': '#12100ED9',
} as const;

export type ColorToken = keyof typeof colors;

/** Bundled font files (asset basename = PostScript name), by design weight. */
export const fontFiles = {
  400: 'GolosText-Regular',
  600: 'GolosText-SemiBold',
} as const;

/** DESIGN.md `fontFamily` value that the bundled files implement. */
export const fontFamilyName = 'Golos Text';

export const typography = {
  hero: { fontFamily: fontFiles[600], fontSize: 64, lineHeight: 70 },
  'title-l': { fontFamily: fontFiles[600], fontSize: 28, lineHeight: 31 },
  'title-m': { fontFamily: fontFiles[600], fontSize: 24, lineHeight: 29 },
  'title-s': { fontFamily: fontFiles[600], fontSize: 22, lineHeight: 25 },
  section: { fontFamily: fontFiles[600], fontSize: 16, lineHeight: 19 },
  'player-title': { fontFamily: fontFiles[600], fontSize: 20, lineHeight: 24 },
  body: { fontFamily: fontFiles[400], fontSize: 14, lineHeight: 22 },
  'body-s': { fontFamily: fontFiles[400], fontSize: 13, lineHeight: 19 },
  button: { fontFamily: fontFiles[600], fontSize: 14, lineHeight: 17 },
  'button-s': { fontFamily: fontFiles[600], fontSize: 12, lineHeight: 15 },
  'card-title': { fontFamily: fontFiles[600], fontSize: 13, lineHeight: 16 },
  meta: { fontFamily: fontFiles[400], fontSize: 11, lineHeight: 15 },
  badge: { fontFamily: fontFiles[600], fontSize: 11, lineHeight: 13 },
} as const;

export type TypographyToken = keyof typeof typography;

export const rounded = {
  sm: 4,
  md: 7,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

export const spacing = {
  '1': 2,
  '2': 4,
  '3': 6,
  '4': 8,
  '5': 10,
  '6': 12,
  '7': 14,
  '8': 16,
  '9': 20,
  '10': 24,
  '11': 28,
  '12': 32,
  'safe-x': 48,
  'safe-y': 27,
  'sidebar-width': 168,
  'content-x': 192,
  'content-width': 720,
  'card-width': 168,
  'card-gap-x': 16,
  'card-gap-y': 22,
  'author-tile-width': 232,
  'author-tile-gap': 12,
  'focus-headroom': 12,
  /** The longest line of body text (Post screen paragraphs, ≈ 75 Cyrillic characters at `body`). */
  'text-measure': 600,
} as const;

export const focus = {
  'ring-width': 2,
  'ring-offset': 2,
  'scale-post-card': 1.06,
  'scale-author-card': 1.05,
  'scale-live-card': 1.03,
  'scale-button': 1.04,
  'scale-row': 1.02,
  'scale-field': 1.0,
  'pressed-scale': 0.98,
  'card-shadow': { offsetY: 9, blur: 20, color: '#00000080' },
} as const;

/** Cubic-bezier control points [x1, y1, x2, y2], or 'linear'. */
export type MotionEasing = 'linear' | readonly [number, number, number, number];

const standardEasing = [0.2, 0, 0, 1] as const;

export const motion = {
  focus: { duration: 160, easing: standardEasing },
  press: { duration: 80, easing: 'linear' },
  scroll: { duration: 240, easing: standardEasing },
  panel: { duration: 200, easing: standardEasing },
  'overlay-fade': { duration: 200, easing: 'linear' },
  'overlay-hide': { delay: 5000 },
  'seek-commit': { delay: 600 },
  'buffer-delay': { delay: 500 },
  spinner: { duration: 900, easing: 'linear' },
} as const satisfies Record<
  string,
  { duration: number; easing: MotionEasing } | { delay: number }
>;

/**
 * Component tokens with every `{group.key}` reference resolved to its value.
 * Values that are not dimensions (aspect, cover size, suffix) stay strings.
 */
export const components = {
  'focusable-surface': {
    ringColor: colors['focus-ring'],
    ringWidth: focus['ring-width'],
    ringOffset: focus['ring-offset'],
    transition: motion.focus,
  },
  'nav-item': {
    /**
     * Owner decision 2026-10-28 (option B): the item spans the sidebar with
     * equal side insets (`sidebar-width` − 2 × `insetX`); its label starts at
     * `safe-x` (`insetX` + `paddingLeft`), aligned with the wordmark. The
     * item's background and focus ring enter the safe area; the text does not.
     */
    width: 136,
    insetX: 16,
    paddingLeft: 32,
    height: 36,
    radius: rounded.md,
    currentBg: colors['surface-current'],
    currentMark: colors.accent,
    focusBg: colors['surface-focus-row'],
    text: typography.button,
  },
  'button-primary': {
    height: 40,
    paddingX: 20,
    radius: rounded.lg,
    bg: colors.accent,
    bgFocus: colors['accent-focus'],
    text: colors['accent-ink'],
    scaleFocus: focus['scale-button'],
  },
  'button-secondary': {
    height: 40,
    paddingX: 20,
    radius: rounded.lg,
    bg: colors['surface-raised'],
    bgFocus: colors['surface-focus-button'],
    text: colors.text,
  },
  'button-small': { height: 32, paddingX: 14, text: typography['button-s'] },
  'filter-chip': {
    height: 32,
    radius: rounded.full,
    bg: colors['surface-raised'],
    countBg: colors['accent-tint'],
  },
  'text-field': {
    height: 50,
    borderWidth: 1.5,
    radius: rounded.lg,
    bg: colors.surface,
    border: colors.border,
    borderFocus: colors['focus-ring'],
    borderError: colors.error,
    scaleFocus: focus['scale-field'],
  },
  'post-card': {
    width: spacing['card-width'],
    thumbAspect: '16:9',
    radius: rounded.md,
    titleLines: 2,
    title: typography['card-title'],
    meta: typography.meta,
    scaleFocus: focus['scale-post-card'],
  },
  'author-card': {
    width: spacing['author-tile-width'],
    height: 76,
    avatar: 52,
    radius: rounded.md,
    scaleFocus: focus['scale-author-card'],
  },
  'live-card': {
    width: 520,
    height: 120,
    cover: '192x108',
    badge: colors.live,
    scaleFocus: focus['scale-live-card'],
  },
  'setting-row': {
    minHeight: 44,
    compactHeight: 38,
    radius: rounded.md,
    bgFocus: colors['surface-focus-row'],
    scaleFocus: focus['scale-row'],
  },
  'poll-option': {
    height: 42,
    radius: rounded.md,
    resultBar: colors['accent-tint'],
    chosenMark: colors.accent,
    scaleFocus: focus['scale-row'],
  },
  'media-row': {
    height: 64,
    thumb: '96x54',
    radius: rounded.md,
    progress: colors.accent,
    scaleFocus: focus['scale-row'],
  },
  /**
   * Story 7.5 (События): the row spans the 720 dp content minus the focus
   * headroom on both sides (720 − 2 × 12), so the 1.02 scale and the ring
   * stay inside the content.
   */
  'event-row': {
    width: 696,
    height: 56,
    avatar: 32,
    dot: 6,
    radius: rounded.lg,
    bg: colors.surface,
    bgFocus: colors['surface-focus-row'],
    chip: colors.live,
    scaleFocus: focus['scale-row'],
  },
  'link-chip': {
    height: 32,
    radius: rounded.full,
    bg: colors['surface-raised'],
    suffix: 'QR',
  },
  'player-control': {
    size: 40,
    radius: rounded.full,
    bg: colors['overlay-badge'],
    bgFocus: colors.text,
    iconFocus: colors.bg,
  },
  timeline: {
    trackHeight: 3,
    trackHeightFocus: 5,
    progress: colors.accent,
    thumb: colors.text,
    bubble: colors['overlay-badge'],
  },
  'side-sheet': {
    widthFilters: 320,
    widthPlayer: 340,
    bg: colors['bg-sidebar'],
    radius: 0,
    enter: motion.panel,
  },
  dialog: {
    maxWidth: 560,
    radius: rounded.xl,
    bg: colors.surface,
    scrim: colors.scrim,
  },
  'qr-dialog': { qrSize: 200, radius: rounded.xl, qrBg: colors['qr-bg'] },
  'state-view': {
    iconSize: 48,
    title: typography['title-s'],
    body: typography['body-s'],
  },
  badge: {
    height: 20,
    radius: rounded.sm,
    bg: colors['overlay-badge'],
    text: typography.badge,
  },
  avatar: { meta: 16, player: 22, post: 28, authorHeader: 56 },
} as const;
