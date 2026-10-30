import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { t } from '../../i18n';

/**
 * SVG icons (ADR 0013, `react-native-svg` 15.15.5, owner decision
 * 2026-10-28: the Unicode «↺10»/«↻10» glyphs were unreadable on the TV).
 * Drawn on a 24-unit grid and sized for the 40 dp PlayerControl; `color` is
 * the control's ink (inverted when focused). Decorative: the control carries
 * the accessibility label, so the SVG is hidden from accessibility.
 */

export type IconProps = {
  color: string;
  /** Rendered size in dp (default 24). */
  size?: number;
  testID?: string;
};

/** The arc of a 300° circle (center 12,12, r 8) from the top, clockwise, ending upper left. */
const ARC = 'M12 4 A8 8 0 1 1 5.07 8';
/** The arrowhead at the top, pointing left (counter-clockwise travel ends here). */
const HEAD = 'M8.6 4 L12.6 1.2 L12.6 6.8 Z';

type SkipIconProps = IconProps & { direction: -1 | 1 };

/**
 * «−10 с» / «+10 с»: a circular arrow, counter-clockwise for back and
 * clockwise for forward (YouTube-like), with «10» centered inside.
 */
export function SkipIcon({ direction, color, size = 24, testID }: SkipIconProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <G transform={direction === 1 ? 'matrix(-1 0 0 1 24 0)' : undefined}>
        <Path d={ARC} stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" />
        <Path d={HEAD} fill={color} />
      </G>
      <SvgText
        x={12}
        y={15}
        fill={color}
        fontSize={7.5}
        fontWeight="700"
        textAnchor="middle"
      >
        {t('player.glyph.ten')}
      </SvgText>
    </Svg>
  );
}

const TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

/** «Настройки»: a gear (a ring with eight teeth and a hole). */
export function GearIcon({ color, size = 24, testID }: IconProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {TEETH.map(angle => (
        <Rect
          key={angle}
          x={10.4}
          y={2.2}
          width={3.2}
          height={4.2}
          rx={0.8}
          fill={color}
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <Circle cx={12} cy={12} r={6} stroke={color} strokeWidth={3.2} fill="none" />
    </Svg>
  );
}

/** A check mark (Story 5.5, SettingRow `check`): one stroked tick. */
export function CheckIcon({ color, size = 24, testID }: IconProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d="M5 12.5 L10 17.5 L19 7"
        stroke={color}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** A heart on the 24-unit grid (two lobes meeting in a point at the bottom). */
const HEART = 'M12 20.5 C11.6 20.2 3 14.6 3 8.7 C3 5.9 5.2 3.8 7.8 3.8 C9.6 3.8 11.1 4.8 12 6.3 C12.9 4.8 14.4 3.8 16.2 3.8 C18.8 3.8 21 5.9 21 8.7 C21 14.6 12.4 20.2 12 20.5 Z';

type HeartIconProps = IconProps & {
  /** Filled («♥», liked) or an outline («♡», not liked). */
  filled: boolean;
};

/** Story 7.4 «Нравится» (owner decision Q1 a): an outline heart, filled when liked. */
export function HeartIcon({ filled, color, size = 24, testID }: HeartIconProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d={HEART}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        fill={filled ? color : 'none'}
      />
    </Svg>
  );
}
