import { StyleSheet } from 'react-native';
import { colors, components, rounded, spacing } from '../../shared/ui';

export const OPTION = components['poll-option'];
/** The accent check's box (DESIGN.md PollOption «chosen»). */
export const CHECK_SIZE = 16;
/** Story 6.7: a multiple-choice option's check box (before the vote) and its tick. */
const CHECK_BOX_SIZE = 20;
export const CHECK_BOX_ICON = 16;
/**
 * Story 6.6, DESIGN.md PollOption «Pending: pulsing accent outline». Local,
 * not tokens: `tokens.ts` must match the DESIGN.md frontmatter exactly, and
 * the frontmatter has no pending values. The color is the accent (as
 * `chosenMark`); one pulse is opacity 1 → `PENDING_PULSE_MIN` → 1 over
 * `PENDING_PULSE_MS`; reduced motion draws it steady.
 */
const PENDING_OUTLINE = colors.accent;
const PENDING_OUTLINE_WIDTH = 2;
export const PENDING_PULSE_MS = 1200;
export const PENDING_PULSE_MIN = 0.35;

/** The PollWidget's styles, shared by its display, single-choice and multiple-choice parts. */
export const pollStyles = StyleSheet.create({
  // Android scrolls a focused view flush with the column's edge (device,
  // Stories 6.4, 6.5): the vertical padding keeps the ring (offset 2 +
  // width 2) inside the scrolled rectangle, so a last-block poll's ring is
  // not cut off at the column's bottom.
  root: {
    alignSelf: 'stretch',
    maxWidth: spacing['text-measure'],
    paddingVertical: spacing['3'],
    marginBottom: spacing['3'],
  },
  surface: {
    padding: spacing['5'],
    borderRadius: rounded.md,
    backgroundColor: colors.surface,
  },
  title: {
    marginBottom: spacing['4'],
  },
  option: {
    minHeight: OPTION.height,
    borderRadius: OPTION.radius,
    backgroundColor: colors['surface-raised'],
    overflow: 'hidden',
    justifyContent: 'center',
    marginBottom: spacing['3'],
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: OPTION.resultBar,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing['5'],
    paddingVertical: spacing['2'],
  },
  check: {
    marginRight: spacing['3'],
  },
  optionText: {
    flex: 1,
  },
  percent: {
    marginLeft: spacing['5'],
  },
  meta: {
    marginTop: spacing['2'],
  },
  error: {
    marginTop: spacing['2'],
  },
  // Story 6.6: an option stop. The surface sets no overflow (the ring would
  // be clipped); the inner view clips the result bar.
  // The vertical padding (not a margin) keeps the ring (offset 2 + width 2)
  // inside the rectangle Android scrolls into view: with a margin the
  // focused option's ring was cut at the column's bottom (device, Story
  // 6.6), as the 6.5 stop's was.
  optionStop: {
    paddingVertical: spacing['3'],
  },
  optionSurface: {
    minHeight: OPTION.height,
    borderRadius: OPTION.radius,
    backgroundColor: colors['surface-raised'],
  },
  optionClip: {
    minHeight: OPTION.height,
    borderRadius: OPTION.radius,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  spinner: {
    marginLeft: spacing['3'],
  },
  // Story 6.7: the check box of a multiple-choice option before the vote.
  checkBox: {
    width: CHECK_BOX_SIZE,
    height: CHECK_BOX_SIZE,
    marginRight: spacing['3'],
    borderRadius: rounded.sm,
    borderWidth: 2,
    borderColor: colors['text-secondary'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxChecked: {
    borderColor: OPTION.chosenMark,
    backgroundColor: OPTION.chosenMark,
  },
  // Story 6.7: «Проголосовать» / «Отозвать голос», left-aligned under the
  // options; the padding keeps the ring inside the scrolled rectangle.
  actionStop: {
    alignSelf: 'flex-start',
    paddingVertical: spacing['3'],
  },
  actionSurface: {
    justifyContent: 'center',
  },
  actionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  outline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: OPTION.radius,
    borderWidth: PENDING_OUTLINE_WIDTH,
    borderColor: PENDING_OUTLINE,
  },
});
