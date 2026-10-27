import { memo, useCallback, useState } from 'react';
import { Image, StyleSheet, View, type ImageLoadEvent } from 'react-native';
import type { MediaRef, PlaceholderKind, PostBodyItem, VideoRow } from '../../shared/entities/post';
import { useZoneItem } from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
import {
  Button,
  FocusableSurface,
  MediaRow,
  Text,
  mediaRowLabel,
  colors,
  rounded,
  spacing,
  type HostView,
  type SurfaceState,
} from '../../shared/ui';

/** DESIGN.md ParagraphStop: the focused paragraph's accent bar. */
const BAR_WIDTH = 2;

type ParagraphStopProps = {
  id: string;
  text: string;
  /** The host view by focus id (initial focus, the column's guide). */
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
};

/**
 * DESIGN.md ParagraphStop: one paragraph, one focus stop (owner decision
 * 2026-10-27, option A, before Story 6.1's collapse). Focused: a subtle
 * `surface` background and a 2 dp accent bar on the left; no scale and no
 * ring. The bar's width is always reserved, so focus never reflows the text.
 * OK does nothing.
 */
const ParagraphStop = memo(function ParagraphStopView({ id, text, onView, onFocus }: ParagraphStopProps) {
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      onView(id, view);
    },
    [zoneRef, onView, id],
  );
  const handleFocus = useCallback(() => {
    zone.onFocus();
    onFocus(id);
  }, [zone, onFocus, id]);
  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.paragraph,
    focused ? styles.paragraphFocused : null,
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
      style={styles.text}
    >
      <Text variant="body">{text}</Text>
    </FocusableSurface>
  );
});

/** The neutral, non-focusable placeholder of a block shown in later stories. */
function BlockPlaceholder({ id, kind }: { id: string; kind: PlaceholderKind }) {
  const label = t(`post.block.${kind}`);
  return (
    <View
      testID={id}
      focusable={false}
      accessible
      accessibilityLabel={label}
      style={[styles.placeholder, styles.text]}
    >
      <Text variant="body-s" color="text-tertiary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The aspect of a teaser image until its real size is known, when the block gives none. */
const DEFAULT_ASPECT = 16 / 9;
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

const aspectOf = (width: number | null | undefined, height: number | null | undefined) =>
  width && height && width > 0 && height > 0 ? width / height : null;

/**
 * A locked post's teaser image (Story 3.6): non-focusable, the column width
 * capped at the text measure and at `maxHeight` (owner decision 2026-10-27,
 * «Teaser fits the screen»: the box shrinks with its aspect). The aspect is
 * the loaded image's real one (the block's width/height can be wrong, e.g.
 * 4:3 for a 16:9 picture), until then the block's, else 16:9. Plain `{uri}`
 * source: no auth headers. No URL or a load failure → the neutral
 * «Изображение» placeholder.
 */
function TeaserImage({ id, url, width, height, maxHeight, columnWidth }: TeaserImageProps) {
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
        style={styles.imageFill}
      />
    </View>
  );
}

export type PostBodyProps = {
  items: readonly PostBodyItem[];
  /** `post/<postId>/block/` */
  idPrefix: string;
  onParagraphView: (id: string, view: HostView | null) => void;
  onParagraphFocus: (id: string) => void;
  /** The tallest a teaser image may be (Story 3.6, fits the viewport). */
  imageMaxHeight: number;
  /** The column's measured inner width (teaser images); null until measured. */
  columnWidth: number | null;
};

/**
 * The post's blocks below the rows, in order (ids
 * `post/<postId>/block/<blockKey>`). Paragraphs, placeholders and a locked
 * post's teaser images are capped at the text measure, left-aligned (owner
 * decision 2026-10-27).
 */
export function PostBody({
  items,
  idPrefix,
  onParagraphView,
  onParagraphFocus,
  imageMaxHeight,
  columnWidth,
}: PostBodyProps) {
  return (
    <>
      {items.map(item => {
        const id = `${idPrefix}${item.key}`;
        switch (item.kind) {
          case 'paragraph':
            return (
              <ParagraphStop
                key={item.key}
                id={id}
                text={item.text}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
              />
            );
          case 'image':
            return (
              <TeaserImage
                key={item.key}
                id={id}
                url={item.url}
                width={item.width}
                height={item.height}
                maxHeight={imageMaxHeight}
                columnWidth={columnWidth}
              />
            );
          default:
            return <BlockPlaceholder key={item.key} id={id} kind={item.block} />;
        }
      })}
    </>
  );
}

type VideoRowStopProps = {
  id: string;
  row: VideoRow;
  playable: boolean;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  /** OK (only while playable): the Player for `ref`, opened from the focus id `id`. */
  onOpen: (ref: MediaRef, focusId: string) => void;
};

/**
 * One MediaRow as a focus stop of the Post column (Story 3.5): a content
 * zone item, its host view reported by focus id. OK opens the Player for
 * this video (Story 4.1) while `phaseFlags.player` is on; otherwise it does
 * nothing.
 */
const VideoRowStop = memo(function VideoRowStopView({
  id,
  row,
  playable,
  onView,
  onFocus,
  onOpen,
}: VideoRowStopProps) {
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      onView(id, view);
    },
    [zoneRef, onView, id],
  );
  const handleFocus = useCallback(() => {
    zone.onFocus();
    onFocus(id);
  }, [zone, onFocus, id]);
  const mediaRef = row.ref;
  const handlePress = useCallback(() => onOpen(mediaRef, id), [onOpen, mediaRef, id]);
  return (
    <MediaRow
      ref={ref}
      testID={id}
      row={row}
      playable={playable}
      onPress={handlePress}
      onFocus={handleFocus}
      style={styles.gap}
    />
  );
});

export type PostVideoRowsProps = {
  rows: readonly VideoRow[];
  /** `post/<postId>/video/` */
  idPrefix: string;
  /** `phaseFlags.player`, from the route (features cannot import `app`). */
  playable: boolean;
  onRowView: (id: string, view: HostView | null) => void;
  onRowFocus: (id: string) => void;
  /** OK on a row (while playable): the Player for that video. */
  onOpenPlayer: (ref: MediaRef, focusId: string) => void;
};

/**
 * The post's MediaRows, in block order, under the header, full content
 * width (DESIGN.md Post screen). Keys and ids use the media id
 * (`post/<postId>/video/<mediaId>`), never the index or a URL.
 */
export function PostVideoRows({
  rows,
  idPrefix,
  playable,
  onRowView,
  onRowFocus,
  onOpenPlayer,
}: PostVideoRowsProps) {
  return (
    <>
      {rows.map(row => (
        <VideoRowStop
          key={row.ref.mediaId}
          id={`${idPrefix}${row.ref.mediaId}`}
          row={row}
          playable={playable}
          onView={onRowView}
          onFocus={onRowFocus}
          onOpen={onOpenPlayer}
        />
      ))}
    </>
  );
}

export type PostPrimaryActionProps = {
  /** `post/<postId>/primary` */
  id: string;
  /** The post's MediaRows; the button targets the first (Story 4.1). */
  rows: readonly VideoRow[];
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  onOpenPlayer: (ref: MediaRef, focusId: string) => void;
};

/**
 * The primary «Смотреть» under the header (Story 4.1, owner decision
 * 2026-10-27, option A): a primary Button in its own row, before the
 * MediaRows. It opens the first video (Story 4.2 makes it target the first
 * unfinished one and adds «Продолжить» / «С начала»); a post with several
 * videos names it («Смотреть · Видео 1»). A content zone item and a column
 * stop like the rows.
 */
export function PostPrimaryAction({ id, rows, onView, onFocus, onOpenPlayer }: PostPrimaryActionProps) {
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      onView(id, view);
    },
    [zoneRef, onView, id],
  );
  const handleFocus = useCallback(() => {
    zone.onFocus();
    onFocus(id);
  }, [zone, onFocus, id]);
  const target = rows[0];
  const onPress = useCallback(() => {
    if (target) {
      onOpenPlayer(target.ref, id);
    }
  }, [target, onOpenPlayer, id]);
  if (!target) {
    return null;
  }
  const label =
    rows.length > 1 ? tf('post.watchVideo', { label: mediaRowLabel(target) }) : t('post.watch');
  return (
    <View testID={`${id}-row`} style={styles.primaryRow}>
      <Button ref={ref} testID={id} kind="primary" label={label} onPress={onPress} onFocus={handleFocus} />
    </View>
  );
}

/** The body's skeleton: a few non-focusable text lines, capped at the text measure. */
export function PostBodySkeleton() {
  return (
    <View testID="post/body-skeleton" focusable={false} style={styles.measure}>
      {[100, 92, 96, 60, 0, 100, 88, 70].map((width, i) =>
        width === 0 ? (
          <View key={i} style={styles.skeletonBreak} />
        ) : (
          <View key={i} style={[styles.skeletonLine, { width: `${width}%` }]} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The primary button's own row, left-aligned, above the MediaRows.
  primaryRow: {
    flexDirection: 'row',
    marginBottom: spacing['8'],
  },
  gap: {
    marginBottom: spacing['6'],
  },
  // Body text: at most the text measure, left-aligned (≈ 75 characters a line).
  measure: {
    maxWidth: spacing['text-measure'],
  },
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
  image: {
    marginBottom: TEASER_IMAGE_GAP,
    borderRadius: rounded.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  imageFill: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    paddingVertical: spacing['5'],
    paddingHorizontal: spacing['6'],
    borderRadius: rounded.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skeletonLine: {
    height: spacing['6'],
    borderRadius: rounded.sm,
    backgroundColor: colors.skeleton,
    marginBottom: spacing['4'],
  },
  skeletonBreak: {
    height: spacing['6'],
  },
});
