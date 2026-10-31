import { StyleSheet } from 'react-native';
import { colors, spacing } from '../../../shared/ui';

/** DESIGN.md ParagraphStop: the focused paragraph's accent bar. */
export const BAR_WIDTH = 2;

/** The aspect of an image until its real size is known, when the block gives none. */
export const DEFAULT_ASPECT = 16 / 9;

export const aspectOf = (width: number | null | undefined, height: number | null | undefined) =>
  width && height && width > 0 && height > 0 ? width / height : null;

/** Styles shared by several block files. */
export const blockStyles = StyleSheet.create({
  // Body text: at most the text measure, left-aligned (≈ 75 characters a line).
  text: {
    marginBottom: spacing['6'],
    maxWidth: spacing['text-measure'],
  },
  paragraph: {
    paddingVertical: spacing['3'],
    paddingRight: spacing['4'],
    paddingLeft: spacing['4'],
    borderLeftWidth: BAR_WIDTH,
    borderLeftColor: 'transparent',
  },
  paragraphFocused: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.accent,
  },
  imageFill: {
    width: '100%',
    height: '100%',
  },
  blockGap: {
    marginBottom: spacing['6'],
  },
});
