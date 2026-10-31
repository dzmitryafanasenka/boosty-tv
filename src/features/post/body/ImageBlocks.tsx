import { memo, useState } from 'react';
import { Image, StyleSheet, View, type ImageLoadEvent } from 'react-native';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { t } from '../../../shared/i18n';
import { FocusableSurface, Text, colors, rounded, spacing } from '../../../shared/ui';
import { DEFAULT_ASPECT, aspectOf, blockStyles } from './blockStyles';
import { BlockPlaceholder } from './TextBlocks';

/** The room below a teaser image (its bottom margin). */
export const TEASER_IMAGE_GAP = spacing['6'];

type TeaserImageProps = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  /** The tallest the image may be (the Post screen fits it in the viewport). */
  maxHeight: number;
  /** The column's measured inner width; null until measured. */
  columnWidth: number | null;
};

/**
 * A locked post's teaser image (Story 3.6): non-focusable, the column width
 * capped at the text measure and at `maxHeight` (owner decision 2026-10-27,
 * «Teaser fits the screen»: the box shrinks with its aspect). The aspect is
 * the loaded image's real one (the block's width/height can be wrong, e.g.
 * 4:3 for a 16:9 picture), until then the block's, else 16:9. Plain `{uri}`
 * source: no auth headers. No URL or a load failure → the neutral
 * «Изображение» placeholder.
 */
export function TeaserImage({ id, url, width, height, maxHeight, columnWidth }: TeaserImageProps) {
  // A failure and the loaded size are remembered per URL: a refetch with a
  // new URL starts over.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ url: string; aspect: number } | null>(null);
  if (failedUrl === url) {
    return <BlockPlaceholder id={id} kind="image" />;
  }
  const aspect =
    (loaded?.url === url ? loaded.aspect : null) ?? aspectOf(width, height) ?? DEFAULT_ASPECT;
  // An explicit box: with `width: '100%'` + `maxWidth` + `aspectRatio`, Yoga
  // takes the height from the unclamped width (seen on the device: a box
  // taller than its cap, with letterbox bars). The width is the smallest of
  // the column, the text measure and the height cap; the height follows it.
  const boxWidth = Math.min(
    columnWidth ?? spacing['text-measure'],
    spacing['text-measure'],
    maxHeight * aspect,
  );
  const boxHeight = boxWidth / aspect;
  const onLoad = (e: ImageLoadEvent) => {
    const real = aspectOf(e.nativeEvent.source?.width, e.nativeEvent.source?.height);
    if (real !== null) {
      setLoaded({ url, aspect: real });
    }
  };
  // The accessible element is a plain View: `focusable={false}` holds there,
  // while an accessible Image becomes a D-pad focus stop on Android (seen on
  // the device, Story 3.6). The Image itself is not accessible.
  return (
    <View
      testID={id}
      focusable={false}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('post.block.image')}
      style={[styles.image, { width: boxWidth, height: boxHeight }]}
    >
      <Image
        key={url}
        testID={`${id}/image`}
        source={{ uri: url }}
        resizeMode="contain"
        resizeMethod="resize"
        fadeDuration={0}
        onLoad={onLoad}
        onError={() => setFailedUrl(url)}
        accessibilityIgnoresInvertColors
        style={blockStyles.imageFill}
      />
    </View>
  );
}

/** DESIGN.md ImageBlock (Story 6.2): the tallest an inline image may be. */
export const IMAGE_STOP_MAX_HEIGHT = 300;
/** A failed image's smallest box, so «Изображение недоступно» always fits. */
const FAILED_MIN_WIDTH = 280;
const FAILED_MIN_HEIGHT = 96;

type ImageStopProps = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  /** The column's measured inner width; null until measured. */
  columnWidth: number | null;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
};

/**
 * An image inside an accessible post (Story 6.2, FR36): a focus stop (so
 * ↓ scrolls a tall image into view) with no OK action, as the reference's
 * focusable image box. The box is the column width capped at the text
 * measure and at `IMAGE_STOP_MAX_HEIGHT` (it shrinks with the aspect: the
 * loaded image's real one, until then the block's, else 16:9, as the
 * teaser image). The skeleton colour shows until it loads; a failure shows
 * «Изображение недоступно» in the same box and keeps the stop (focus is
 * never lost to a failure). Plain `{uri}` source: no auth headers. Loading
 * never moves focus.
 */
export const ImageStop = memo(function ImageStopView({
  id,
  url,
  width,
  height,
  columnWidth,
  onView,
  onFocus,
}: ImageStopProps) {
  const { ref, handleFocus } = useColumnStop(id, onView, onFocus);
  // Per URL, as the teaser image: a refetch with a new URL starts over.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ url: string; aspect: number } | null>(null);
  const failed = failedUrl === url;
  const aspect =
    (loaded?.url === url ? loaded.aspect : null) ?? aspectOf(width, height) ?? DEFAULT_ASPECT;
  const boxWidth = Math.min(
    columnWidth ?? spacing['text-measure'],
    spacing['text-measure'],
    IMAGE_STOP_MAX_HEIGHT * aspect,
  );
  const boxHeight = boxWidth / aspect;
  // A failure keeps a readable box: an extreme aspect (a thin banner or
  // strip) would clip the message.
  const failedWidth = Math.max(boxWidth, Math.min(columnWidth ?? spacing['text-measure'], FAILED_MIN_WIDTH));
  const failedHeight = Math.max(boxHeight, FAILED_MIN_HEIGHT);
  const onLoad = (e: ImageLoadEvent) => {
    const real = aspectOf(e.nativeEvent.source?.width, e.nativeEvent.source?.height);
    setLoaded({ url, aspect: real ?? aspect });
  };
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      radius={rounded.md}
      // No scale (not `focus.scale-row`): a 600 dp image scaled past the
      // column would overlap the text around it; the ring marks focus.
      // OK has no action, so no press feedback either.
      scaleFocus={1}
      scalePressed={1}
      accessibilityRole="image"
      accessibilityLabel={failed ? t('post.imageUnavailable') : t('post.block.image')}
      onFocus={handleFocus}
      style={styles.imageStop}
    >
      <View
        testID={`${id}/box`}
        style={[
          styles.imageStopBox,
          failed ? { width: failedWidth, height: failedHeight } : { width: boxWidth, height: boxHeight },
          failed || loaded?.url === url ? null : styles.imageStopLoading,
        ]}
      >
        {failed ? (
          <View testID={`${id}/failed`} style={styles.imageStopFailed}>
            <Text variant="body-s" color="text-secondary">
              {t('post.imageUnavailable')}
            </Text>
          </View>
        ) : (
          <Image
            key={url}
            testID={`${id}/image`}
            source={{ uri: url }}
            resizeMode="contain"
            resizeMethod="resize"
            fadeDuration={0}
            onLoad={onLoad}
            onError={() => setFailedUrl(url)}
            accessibilityIgnoresInvertColors
            style={blockStyles.imageFill}
          />
        )}
      </View>
    </FocusableSurface>
  );
});

const styles = StyleSheet.create({
  image: {
    marginBottom: TEASER_IMAGE_GAP,
    borderRadius: rounded.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  // Story 6.2 ImageBlock: the stop's box (the ring follows `rounded.md`).
  imageStop: {
    alignSelf: 'flex-start',
    marginBottom: spacing['6'],
  },
  imageStopBox: {
    borderRadius: rounded.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  imageStopLoading: {
    backgroundColor: colors.skeleton,
  },
  imageStopFailed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['6'],
  },
});
