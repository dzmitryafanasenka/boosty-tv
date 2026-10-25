import { Text as RNText, type TextProps } from 'react-native';
import { colors, typography, type ColorToken, type TypographyToken } from './tokens';

export type AppTextProps = TextProps & {
  /** Typography token from DESIGN.md. */
  variant: TypographyToken;
  /** Color token; defaults to `text`. */
  color?: ColorToken;
};

/** Text styled only through design tokens. */
export function Text({ variant, color = 'text', style, ...rest }: AppTextProps) {
  return (
    <RNText
      {...rest}
      style={[typography[variant], { color: colors[color] }, style]}
    />
  );
}
