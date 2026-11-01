import { Text as RNText, type TextProps } from 'react-native';
import { colors, typography, type ColorToken, type TypographyToken } from './tokens';

export type AppTextProps = TextProps & {
  /** Typography token from DESIGN.md. */
  variant: TypographyToken;
  /** Color token; defaults to `text`. */
  color?: ColorToken;
};

/**
 * The largest growth of text with the system font size (owner decision
 * 2026-11-01, Story 9.4): 1.3×. Controls keep their fixed heights
 * (DESIGN.md: a card never grows), so a bigger scale would clip or
 * overflow them. Every Text (and so every Button label) and TextField
 * input uses it.
 */
export const MAX_FONT_SIZE_MULTIPLIER = 1.3;

/** Text styled only through design tokens; its growth with the system font size is capped. */
export function Text({ variant, color = 'text', style, ...rest }: AppTextProps) {
  return (
    <RNText
      maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
      {...rest}
      style={[typography[variant], { color: colors[color] }, style]}
    />
  );
}
