import { memo, useState } from 'react';
import { Image, StyleSheet, Text as RNText, View } from 'react-native';
import type { PlaceholderKind, Segment } from '../../../shared/entities/post';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { t } from '../../../shared/i18n';
import {
  FocusableSurface,
  Text,
  colors,
  fontFiles,
  rounded,
  spacing,
  typography,
  type SurfaceState,
} from '../../../shared/ui';
import { BAR_WIDTH, blockStyles } from './blockStyles';

/** An inline emoji's box: the body text's line height (Story 6.1). */
const EMOJI_SIZE = typography.body.lineHeight;

/**
 * An inline emoji (Story 6.1): a plain `{uri}` image (no auth headers) at
 * the text's line height inside the paragraph's text. A failed image is
 * removed, so it takes no space and the text is unaffected.
 */
function InlineEmoji({ id, url }: { id: string; url: string }) {
  // Remembered per URL: a refetch with a new URL tries again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === url) {
    return null;
  }
  return (
    <Image
      testID={id}
      source={{ uri: url }}
      resizeMode="contain"
      resizeMethod="resize"
      fadeDuration={0}
      onError={() => setFailedUrl(url)}
      accessible={false}
      focusable={false}
      style={styles.emoji}
    />
  );
}

/** A paragraph's segments as nested `Text` runs and inline emoji (Story 6.1). */
function Segments({ id, segments }: { id: string; segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'emoji') {
          return <InlineEmoji key={segment.key} id={`${id}/emoji/${segment.key}`} url={segment.url} />;
        }
        if (!segment.bold && !segment.italic && !segment.underline) {
          return <RNText key={i}>{segment.text}</RNText>;
        }
        return (
          <RNText
            key={i}
            style={[
              segment.bold ? styles.bold : null,
              segment.italic ? styles.italic : null,
              segment.underline ? styles.underline : null,
            ]}
          >
            {segment.text}
          </RNText>
        );
      })}
    </>
  );
}

/** An emoji-only paragraph (no plain text): shown, never a focus stop. */
export function EmojiParagraph({ id, segments }: { id: string; segments: readonly Segment[] }) {
  return (
    <View testID={id} focusable={false} style={[blockStyles.paragraph, blockStyles.text]}>
      <Text variant="body">
        <Segments id={id} segments={segments} />
      </Text>
    </View>
  );
}

type ParagraphStopProps = {
  id: string;
  /** The plain text: the accessibility label. */
  text: string;
  segments: readonly Segment[];
  /** The host view by focus id (initial focus, the column's guide). */
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
};

/**
 * DESIGN.md ParagraphStop: one paragraph, one focus stop (owner decision
 * 2026-10-27, option A; no collapse, owner decision 2026-10-29). Focused: a subtle
 * `surface` background and a 2 dp accent bar on the left; no scale and no
 * ring. The bar's width is always reserved, so focus never reflows the text.
 * OK does nothing. Story 6.1: styled runs (bold, italic, underline) and
 * inline emoji; the accessibility label stays the plain text.
 */
export const ParagraphStop = memo(function ParagraphStopView({
  id,
  text,
  segments,
  onView,
  onFocus,
}: ParagraphStopProps) {
  const { ref, handleFocus } = useColumnStop(id, onView, onFocus);
  const surfaceStyle = ({ focused }: SurfaceState) => [
    blockStyles.paragraph,
    focused ? blockStyles.paragraphFocused : null,
  ];
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      radius={rounded.sm}
      scaleFocus={1}
      ring={false}
      accessibilityRole="text"
      accessibilityLabel={text}
      onFocus={handleFocus}
      surfaceStyle={surfaceStyle}
      style={blockStyles.text}
    >
      <Text variant="body">
        <Segments id={id} segments={segments} />
      </Text>
    </FocusableSurface>
  );
});

/** The neutral, non-focusable placeholder of a block shown in later stories. */
export function BlockPlaceholder({ id, kind }: { id: string; kind: PlaceholderKind }) {
  const label = t(`post.block.${kind}`);
  return (
    <View
      testID={id}
      focusable={false}
      accessible
      accessibilityLabel={label}
      style={[styles.placeholder, blockStyles.text]}
    >
      <Text variant="body-s" color="text-tertiary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A `header` block (Story 6.3, owner decision 2026-10-29 Q1 b): a bold line, never a focus stop. */
export function Heading({ id, text }: { id: string; text: string }) {
  return (
    <View testID={id} focusable={false} style={[styles.heading, blockStyles.text]}>
      <Text variant="section" accessibilityRole="header">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Story 6.1 text styles. Bold is the bundled SemiBold file (tokens: a
  // `fontWeight` would make Android synthesize bold); italic is synthesized
  // (no italic file is bundled, and no custom font loading).
  bold: {
    fontFamily: fontFiles[600],
  },
  italic: {
    fontStyle: 'italic',
  },
  underline: {
    textDecorationLine: 'underline',
  },
  emoji: {
    width: EMOJI_SIZE,
    height: EMOJI_SIZE,
  },
  heading: {
    paddingTop: spacing['4'],
    paddingLeft: spacing['4'] + BAR_WIDTH,
    paddingRight: spacing['4'],
  },
  placeholder: {
    paddingVertical: spacing['5'],
    paddingHorizontal: spacing['6'],
    borderRadius: rounded.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
