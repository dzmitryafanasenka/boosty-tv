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
  'button-small': { height: 32, paddingX: 14, text: typography['button-s'], iconSize: 16 },
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
    placeholder: colors['text-tertiary'],
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
    /** Story 9.4: the Диагностика rows' column. */
    listMaxWidth: 640,
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
   * Story 13.1 (our improvement, mockup «Пост — новый макет», px ÷ 2): the
   * video post's header: a 16:9 preview (not focusable; a `plate` with the
   * `glyph` when it has none) left of the title, meta, media line and the
   * action row; `gap` between the preview and the text column, `buttonGap`
   * between the buttons (also between wrapped rows).
   */
  'post-hero': {
    previewWidth: 320,
    previewHeight: 180,
    radius: rounded.xl,
    gap: 28,
    buttonGap: 12,
    /** The QR glyph on the icon-only «На телефоне». */
    buttonIcon: 20,
    /** The focused-only label under the icon-only «На телефоне». */
    hintWidth: 120,
    glyph: 48,
    titleLines: 4,
    plate: colors['surface-raised'],
    glyphInk: colors['text-disabled'],
    progress: colors.accent,
  },
  /** Story 13.1: one compact video tile of a multi-video post («Видео в посте · N»). */
  'media-tile': {
    width: 168,
    thumbHeight: 95,
    gap: 16,
    radius: rounded.md,
    scaleFocus: focus['scale-post-card'],
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
    skeletonLine: 12,
  },
  /**
   * Story 11.2 CommentRow (read-only): `indent` shifts a reply right by one
   * level (the avatar plus its gap, so the reply's avatar sits under the
   * parent's text); `gap` is the avatar–text gap; `rowGap` the room between
   * rows; `imageMaxHeight` caps an image in a comment.
   */
  'comment-row': {
    avatar: 28,
    gap: 8,
    indent: 36,
    rowGap: 6,
    imageMaxHeight: 200,
    radius: rounded.md,
    bgFocus: colors['surface-focus-row'],
  },
  /**
   * Story 11.2 image viewer (our improvement): a full-screen modal on `bg`;
   * `padding` keeps the fitted image off the screen edges; the «N / M»
   * counter sits on an `overlay-badge` pill.
   */
  'image-viewer': {
    bg: colors.bg,
    padding: 24,
    counterBg: colors['overlay-badge'],
    counterRadius: rounded.full,
  },
  'link-chip': {
    height: 32,
    radius: rounded.full,
    bg: colors['surface-raised'],
    suffix: 'QR',
    labelMaxWidth: 420,
    /** The external-video chip's preview. */
    thumbWidth: 96,
    thumbHeight: 54,
    /**
     * Story 13.2, the timestamp chip «▶ time title» (mockup `Chapters`):
     * left/right padding, the gap between the glyph, time and title, the
     * play glyph, the time's minimum width in a chapter list, the gap
     * between chips of a list and above a paragraph's chips; focused, the
     * chip inverts (light fill, dark ink).
     */
    timePadLeft: 12,
    timePadRight: 16,
    timeGap: 8,
    playSize: 11,
    timeMinWidth: 32,
    listGap: 6,
    bgFocusTime: colors.text,
    inkFocusTime: colors.bg,
  },
  'player-control': {
    size: 40,
    radius: rounded.full,
    bg: colors['overlay-badge'],
    bgFocus: colors.text,
    iconFocus: colors.bg,
    /** The play triangle (a bordered view) and the pause bars. */
    playWidth: 13,
    playHeight: 16,
    pauseBarWidth: 4,
    pauseBarHeight: 16,
    pauseGap: 4,
    /** The triangle's optical centering nudge to the right. */
    glyphNudge: 3,
    barRadius: 1,
  },
  timeline: {
    trackHeight: 3,
    trackHeightFocus: 5,
    progress: colors.accent,
    thumb: colors.text,
    bubble: colors['overlay-badge'],
    bubbleMinWidth: 56,
    /** Story 10.1: a chapter mark (a tick as tall as the track), over the track and over the fill. */
    markWidth: 2,
    mark: colors.text,
    markPlayed: colors['accent-ink'],
    /** Story 10.1: the chapter name's widest box next to the elapsed time (one line, truncated). */
    chapterMaxWidth: 480,
  },
  /** Story 10.1: the chapter strip above the timeline (time and name per chapter). */
  'chapter-strip': {
    itemWidth: 200,
    radius: rounded.md,
    bg: colors['overlay-badge'],
    bgFocus: colors.text,
    textFocus: colors.bg,
    current: colors['accent-text'],
  },
  /** DESIGN.md AudioBlock: the round glyph box, its play/pause glyph and the 2 dp progress line. */
  'audio-block': {
    glyphBox: 32,
    playWidth: 11,
    playHeight: 14,
    pauseBarWidth: 3,
    pauseBarHeight: 13,
    pauseGap: 3,
    glyphNudge: 3,
    barRadius: 1,
    progressHeight: 2,
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
  /**
   * Story 9.4: `mark` outlines the glyphs drawn with views (radio, check
   * box, spinner, StateView glyph, lock shackle); `hairline` is the text
   * placeholder's border.
   */
  stroke: { mark: 2, hairline: 1 },
  /** Invisible TVFocusGuideView strips: the post grid's end guide and the period stepper's band. */
  'focus-guide': { endHeight: 1, bandWidth: 2 },
  avatar: { meta: 16, player: 22, post: 28, authorHeader: 56 },
} as const;
