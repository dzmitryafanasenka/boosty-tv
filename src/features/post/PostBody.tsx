import { memo, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Image,
  StyleSheet,
  TVFocusGuideView,
  Text as RNText,
  View,
  type ImageLoadEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { youtubeThumbnail } from '../../shared/entities/externalUrls';
import { AudioBlock, type ResolveAudioSource } from '../player';
import { PollWidget } from '../polls';
import type { HttpClient } from '../../shared/api';
import type {
  FileTargetResult,
  MediaRef,
  ParagraphLink,
  PlaceholderKind,
  PostBodyItem,
  Segment,
  VideoRow,
} from '../../shared/entities/post';
import { useZoneItem } from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
import { formatFileSize } from '../../shared/i18n/format';
import type { ProgressStatus } from '../../shared/services/progress';
import {
  Button,
  FocusableSurface,
  MediaRow,
  Spinner,
  Text,
  mediaRowLabel,
  colors,
  components,
  focus,
  fontFiles,
  rounded,
  spacing,
  typography,
  type HostView,
  type SurfaceState,
} from '../../shared/ui';

/** DESIGN.md ParagraphStop: the focused paragraph's accent bar. */
const BAR_WIDTH = 2;

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

type ParagraphStopProps = {
  id: string;
  /** The plain text: the accessibility label. */
  text: string;
  segments: readonly Segment[];
  /** The host view by focus id (initial focus, the column's guide). */
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
};

/**
 * DESIGN.md ParagraphStop: one paragraph, one focus stop (owner decision
 * 2026-10-27, option A; no collapse, owner decision 2026-10-29). Focused: a subtle
 * `surface` background and a 2 dp accent bar on the left; no scale and no
 * ring. The bar's width is always reserved, so focus never reflows the text.
 * OK does nothing. Story 6.1: styled runs (bold, italic, underline) and
 * inline emoji; the accessibility label stays the plain text.
 */
const ParagraphStop = memo(function ParagraphStopView({
  id,
  text,
  segments,
  onView,
  onFocus,
}: ParagraphStopProps) {
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
      <Text variant="body">
        <Segments id={id} segments={segments} />
      </Text>
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
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
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
const ImageStop = memo(function ImageStopView({
  id,
  url,
  width,
  height,
  columnWidth,
  onView,
  onFocus,
}: ImageStopProps) {
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
            style={styles.imageFill}
          />
        )}
      </View>
    </FocusableSurface>
  );
});

/**
 * Story 6.3: opens the QrDialog in the modal host for `value`, with
 * `initiator` (the chip) getting focus back when it closes.
 */
export type OpenQr = (
  title: string,
  value: string,
  initiator: RefObject<HostView | null>,
) => void;

/** Story 6.3: a file's QR target from a fresh E8 (`useFileTarget`). */
/** `title`: the shown (trimmed) title; an id-less file must still carry it. */
export type ResolveFileTarget = (fileKey: string, title: string) => Promise<FileTargetResult>;

const CHIP = components['link-chip'];

/**
 * A chip as a column stop: a content zone item, its host view reported by
 * focus id (the column guide, the refetch fallback) and kept for the modal
 * host (focus returns to it when the QrDialog closes).
 */
function useChipStop(
  id: string,
  onView: (id: string, view: HostView | null) => void,
  onFocus: (id: string) => void,
) {
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const viewRef = useRef<HostView | null>(null);
  const ref = useCallback(
    (view: HostView | null) => {
      viewRef.current = view;
      zoneRef?.(view);
      onView(id, view);
    },
    [zoneRef, onView, id],
  );
  const handleFocus = useCallback(() => {
    zone.onFocus();
    onFocus(id);
  }, [zone, onFocus, id]);
  return { ref, viewRef, handleFocus };
}

/**
 * A full-measure focus guide around chips (Story 6.3, device): Android's
 * focus search weighs the horizontal offset of centers, so ↓ from a wide
 * paragraph preferred the next wide paragraph over a narrow, left-aligned
 * chip right below it (the chip was skipped both ways). The guide spans the
 * column like a paragraph and hands focus to its last focused chip, else
 * the first (`autoFocus`, react-native-tvos).
 */
function ChipGuide({
  testID,
  children,
}: {
  testID: string;
  children: ReactNode;
}) {
  return (
    <TVFocusGuideView testID={testID} autoFocus style={styles.chipGuide}>
      {children}
    </TVFocusGuideView>
  );
}

/** The chip's visible «QR» suffix (`link-chip` token), or a spinner while busy. */
function QrSuffix({ busy, testID }: { busy?: boolean; testID: string }) {
  return busy ? (
    <View style={styles.suffix}>
      <Spinner testID={`${testID}/busy`} />
    </View>
  ) : (
    <Text variant="button-s" color="accent-text" style={styles.suffix}>
      {CHIP.suffix}
    </Text>
  );
}

const chipSurface = ({ focused }: SurfaceState) => [
  styles.chip,
  { backgroundColor: focused ? colors['surface-focus-button'] : CHIP.bg },
];

const videoChipSurface = ({ focused }: SurfaceState) => [
  styles.videoChip,
  { backgroundColor: focused ? colors['surface-focus-button'] : CHIP.bg },
];

/**
 * Story 6.3 (owner decision 2026-10-29): opens another Boosty post in the
 * app (a Пост pushed on top; Back returns to the chip).
 */
export type OpenPost = (blogUrl: string, postId: string) => void;

/**
 * Story 6.3 (owner decision 2026-10-29, option b): plays a video of this
 * post from `seconds`; `focusId` (the chip) gets focus back after the Player.
 */
export type PlayAt = (mediaId: string, seconds: number, focusId: string) => void;

type LinkChipProps = {
  id: string;
  link: ParagraphLink;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  onOpenQr?: OpenQr;
  onOpenPost?: OpenPost;
  onPlayAt?: PlayAt;
};

/** What OK on a link chip does: play at a time, open a post, else the QR. */
type LinkAction = 'play' | 'post' | 'qr';

/**
 * DESIGN.md LinkChip (Story 6.3, `link-chip` tokens): a 32 dp pill under its
 * paragraph with the link text and a «QR» suffix. OK opens the QrDialog for
 * the link (nothing opens on the TV); focus returns here when it closes. A
 * link to another Boosty post (owner decision 2026-10-29) reads «<text> ·
 * Открыть» with no QR suffix, and OK opens that post in the app instead. A
 * timestamp link to a video of this post (option b) reads «<text> ·
 * Смотреть» and OK plays that video from that time. Without the handler
 * (no route to push, the player off) a chip falls back to the QR.
 */
const LinkChip = memo(function LinkChipView({
  id,
  link,
  onView,
  onFocus,
  onOpenQr,
  onOpenPost,
  onPlayAt,
}: LinkChipProps) {
  const { ref, viewRef, handleFocus } = useChipStop(id, onView, onFocus);
  const { text, url, post, timestamp } = link;
  const action: LinkAction =
    timestamp !== null && onPlayAt !== undefined
      ? 'play'
      : post !== null && onOpenPost !== undefined
        ? 'post'
        : 'qr';
  const onPress = useCallback(() => {
    if (action === 'play' && timestamp !== null) {
      onPlayAt?.(timestamp.mediaId, timestamp.seconds, id);
    } else if (action === 'post' && post !== null) {
      onOpenPost?.(post.blogUrl, post.postId);
    } else {
      onOpenQr?.(text, url, viewRef);
    }
  }, [action, timestamp, post, onPlayAt, onOpenPost, onOpenQr, id, text, url, viewRef]);
  // The action word is its own text, so a long link text is cut before it,
  // never the action (device: «… · От…»).
  const suffix =
    action === 'play' ? t('post.chip.watchSuffix') : action === 'post' ? t('post.chip.openSuffix') : null;
  const a11yLabel =
    action === 'play'
      ? tf('post.chip.a11yWatchAt', { label: text })
      : action === 'post'
        ? tf('post.chip.a11yOpenPost', { label: text })
        : tf('post.chip.a11y', { label: text });
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      radius={CHIP.height / 2}
      scaleFocus={focus['scale-button']}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      onFocus={handleFocus}
      surfaceStyle={chipSurface}
      style={styles.chipGap}
    >
      <View style={styles.chipContent}>
        <Text variant="button-s" numberOfLines={1} style={styles.chipLabel}>
          {text}
        </Text>
        {suffix === null ? (
          <QrSuffix testID={id} />
        ) : (
          <Text testID={`${id}/action`} variant="button-s" style={styles.actionSuffix}>
            {suffix}
          </Text>
        )}
      </View>
    </FocusableSurface>
  );
});

type FileChipProps = {
  id: string;
  /** The file's block key (`file:<id>`, else `file@<index>`). */
  fileKey: string;
  title: string;
  sizeBytes: number | null;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  onOpenQr?: OpenQr;
  resolveFile?: ResolveFileTarget;
};

/**
 * DESIGN.md FileChip (Story 6.3): «{title} · {size}» and the «QR» suffix.
 * OK sends a fresh E8 (busy meanwhile: a spinner, a repeated OK ignored),
 * then opens the QrDialog with the file's signed target, which is held only
 * by the dialog (never in state here, a cache or a log). A failure shows
 * «Не удалось открыть файл» under the chip and opens no dialog; OK tries
 * again.
 */
const FileChip = memo(function FileChipView({
  id,
  fileKey,
  title,
  sizeBytes,
  onView,
  onFocus,
  onOpenQr,
  resolveFile,
}: FileChipProps) {
  const { ref, viewRef, handleFocus } = useChipStop(id, onView, onFocus);
  const [busy, setBusy] = useState(false);
  /** The last failure: `locked` («Нет доступа к файлу») or any other (`error`). */
  const [failed, setFailed] = useState<'locked' | 'error' | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const name = title.length > 0 ? title : t('post.chip.file');
  const label =
    sizeBytes === null
      ? name
      : tf('post.chip.fileWithSize', {
          title: name,
          size: formatFileSize(sizeBytes),
        });
  const onPress = useCallback(() => {
    if (inFlight.current || resolveFile === undefined) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFailed(null);
    const done = (result: FileTargetResult | null) => {
      inFlight.current = false;
      if (!mounted.current) {
        return;
      }
      setBusy(false);
      if (result?.kind === 'ok') {
        onOpenQr?.(name, result.target, viewRef);
      } else {
        setFailed(result?.kind === 'locked' ? 'locked' : 'error');
      }
    };
    resolveFile(fileKey, title).then(done, () => done(null));
  }, [resolveFile, fileKey, title, onOpenQr, name, viewRef]);
  return (
    <ChipGuide testID={`${id}/guide`}>
      <View style={styles.blockGap}>
        <FocusableSurface
          ref={ref}
          testID={id}
          radius={CHIP.height / 2}
          scaleFocus={focus['scale-button']}
          accessibilityRole="button"
          accessibilityLabel={
            busy
              ? tf('post.chip.a11yBusy', { label })
              : failed !== null
                ? // The failure is part of the label (TalkBack reads it on focus).
                  tf('post.chip.a11yFailed', {
                    label,
                    error: failed === 'locked' ? t('post.chip.fileLocked') : t('post.chip.fileError'),
                  })
                : tf('post.chip.a11y', { label })
          }
          accessibilityState={{ busy }}
          onPress={onPress}
          onFocus={handleFocus}
          surfaceStyle={chipSurface}
          style={styles.chipAlone}
        >
          <View style={styles.chipContent}>
            <Text variant="button-s" numberOfLines={1} style={styles.chipLabel}>
              {label}
            </Text>
            <QrSuffix busy={busy} testID={id} />
          </View>
        </FocusableSurface>
        {failed ? (
          <Text
            testID={`${id}/error`}
            accessibilityLiveRegion="polite"
            variant="body-s"
            color="error-text"
            style={styles.chipError}
          >
            {failed === 'locked' ? t('post.chip.fileLocked') : t('post.chip.fileError')}
          </Text>
        ) : null}
      </View>
    </ChipGuide>
  );
});

type ExternalVideoChipProps = {
  id: string;
  url: string;
  youtubeId: string | null;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  onOpenQr?: OpenQr;
};

/**
 * An external video (Story 6.3): never played in the app. A chip with the
 * YouTube thumbnail (a plain `{uri}`, no headers) when the host is YouTube,
 * «Видео на YouTube» / «Внешнее видео» and the «QR» suffix; a failed
 * thumbnail leaves the text. OK opens the QrDialog for the page.
 */
const ExternalVideoChip = memo(function ExternalVideoChipView({
  id,
  url,
  youtubeId,
  onView,
  onFocus,
  onOpenQr,
}: ExternalVideoChipProps) {
  const { ref, viewRef, handleFocus } = useChipStop(id, onView, onFocus);
  const thumb = youtubeId === null ? null : youtubeThumbnail(youtubeId);
  const [failedThumb, setFailedThumb] = useState<string | null>(null);
  const label =
    youtubeId === null ? t('post.chip.externalVideo') : t('post.chip.youtube');
  const onPress = useCallback(
    () => onOpenQr?.(label, url, viewRef),
    [onOpenQr, label, url, viewRef],
  );
  const showThumb = thumb !== null && failedThumb !== thumb;
  return (
    <ChipGuide testID={`${id}/guide`}>
      <FocusableSurface
        ref={ref}
        testID={id}
        radius={rounded.md}
        scaleFocus={focus['scale-button']}
        accessibilityRole="button"
        accessibilityLabel={tf('post.chip.a11y', { label })}
        onPress={onPress}
        onFocus={handleFocus}
        surfaceStyle={videoChipSurface}
        style={[styles.chipAlone, styles.blockGap]}
      >
        <View style={styles.chipContent}>
          {showThumb ? (
            <Image
              key={thumb}
              testID={`${id}/thumb`}
              source={{ uri: thumb }}
              resizeMode="cover"
              resizeMethod="resize"
              fadeDuration={0}
              onError={() => setFailedThumb(thumb)}
              accessible={false}
              focusable={false}
              style={styles.videoThumb}
            />
          ) : null}
          <Text variant="button-s" numberOfLines={1} style={styles.chipLabel}>
            {label}
          </Text>
          <QrSuffix testID={id} />
        </View>
      </FocusableSurface>
    </ChipGuide>
  );
});

/** A paragraph's link chips (Story 6.3), in one wrapping row under it: ← → move between them. */
function LinkChips({
  idPrefix,
  links,
  onView,
  onFocus,
  onOpenQr,
  onOpenPost,
  onPlayAt,
}: {
  idPrefix: string;
  links: readonly ParagraphLink[];
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  onOpenQr?: OpenQr;
  onOpenPost?: OpenPost;
  onPlayAt?: PlayAt;
}) {
  return (
    <ChipGuide testID={`${idPrefix}${links[0].key}/guide`}>
      <View style={styles.chipRow}>
        {links.map(link => (
          <LinkChip
            key={link.key}
            id={`${idPrefix}${link.key}`}
            link={link}
            onView={onView}
            onFocus={onFocus}
            onOpenQr={onOpenQr}
            onOpenPost={onOpenPost}
            onPlayAt={onPlayAt}
          />
        ))}
      </View>
    </ChipGuide>
  );
}

/** A `header` block (Story 6.3, owner decision 2026-10-29 Q1 b): a bold line, never a focus stop. */
function Heading({ id, text }: { id: string; text: string }) {
  return (
    <View testID={id} focusable={false} style={[styles.heading, styles.text]}>
      <Text variant="section" accessibilityRole="header">
        {text}
      </Text>
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
  /** Story 6.3: OK on a chip opens the QrDialog. */
  onOpenQr?: OpenQr;
  /** Story 6.3: a file chip's QR target (a fresh E8). */
  resolveFile?: ResolveFileTarget;
  /** Story 6.3: OK on a link to another Boosty post opens it. */
  onOpenPost?: OpenPost;
  /** Story 6.3 (option b): OK on a timestamp link plays this post's video from that time. */
  onPlayAt?: PlayAt;
  /** Story 6.4: an audio block's source when playback starts (a fresh E8). */
  resolveAudio?: ResolveAudioSource;
  /** Story 6.4: false while Пост is not the focused route (a playing track pauses). */
  active?: boolean;
  /**
   * Story 6.6: voting in an open single-choice poll: the active session's
   * client, the post's identity (E10, the E8 query key) and the option focus
   * id prefix (`post/<postId>/poll/option/`). Absent: the poll is display only.
   */
  pollVote?: { http: HttpClient; blogUrl: string; postId: string; optionIdPrefix: string };
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
  onOpenQr,
  resolveFile,
  onOpenPost,
  onPlayAt,
  resolveAudio,
  active = true,
  pollVote,
}: PostBodyProps) {
  return (
    <>
      {items.map(item => {
        const id = `${idPrefix}${item.key}`;
        switch (item.kind) {
          case 'paragraph': {
            // Emoji only (no plain text): shown, never a focus stop.
            const paragraph =
              item.text.length === 0 ? (
                <View key={item.key} testID={id} focusable={false} style={[styles.paragraph, styles.text]}>
                  <Text variant="body">
                    <Segments id={id} segments={item.segments} />
                  </Text>
                </View>
              ) : (
                <ParagraphStop
                  key={item.key}
                  id={id}
                  text={item.text}
                  segments={item.segments}
                  onView={onParagraphView}
                  onFocus={onParagraphFocus}
                />
              );
            if (item.links.length === 0) {
              return paragraph;
            }
            // Story 6.3: the link chips right under their paragraph.
            return (
              <View key={item.key} testID={`${id}/links`}>
                {paragraph}
                <LinkChips
                  idPrefix={idPrefix}
                  links={item.links}
                  onView={onParagraphView}
                  onFocus={onParagraphFocus}
                  onOpenQr={onOpenQr}
                  onOpenPost={onOpenPost}
                  onPlayAt={onPlayAt}
                />
              </View>
            );
          }
          case 'file':
            return (
              <FileChip
                key={item.key}
                id={id}
                fileKey={item.key}
                title={item.title}
                sizeBytes={item.sizeBytes}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
                onOpenQr={onOpenQr}
                resolveFile={resolveFile}
              />
            );
          case 'audio':
            return (
              <AudioBlock
                key={item.key}
                id={id}
                audioKey={item.key}
                title={item.title}
                durationSec={item.durationSec}
                resolveSource={resolveAudio}
                active={active}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
              />
            );
          case 'externalVideo':
            return (
              <ExternalVideoChip
                key={item.key}
                id={id}
                url={item.url}
                youtubeId={item.youtubeId}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
                onOpenQr={onOpenQr}
              />
            );
          case 'heading':
            return <Heading key={item.key} id={id} text={item.text} />;
          case 'poll':
            // Story 6.5: results, one focus stop; Story 6.6: an open
            // single-choice poll's options are stops that take a vote.
            return (
              <PollWidget
                key={item.key}
                id={id}
                poll={item.poll}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
                http={pollVote?.http}
                blogUrl={pollVote?.blogUrl}
                postId={pollVote?.postId}
                optionIdPrefix={pollVote?.optionIdPrefix}
              />
            );
          case 'image':
            return item.stop ? (
              <ImageStop
                key={item.key}
                id={id}
                url={item.url}
                width={item.width}
                height={item.height}
                columnWidth={columnWidth}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
              />
            ) : (
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

/**
 * How the Player is opened (Story 4.2): `beginning` for «С начала»; Story
 * 6.3: `{atSec}` for a timestamp link chip.
 */
export type OpenPlayer = (ref: MediaRef, focusId: string, start?: 'beginning' | { atSec: number }) => void;

type VideoRowStopProps = {
  id: string;
  row: VideoRow;
  playable: boolean;
  /** Story 4.2: the row's progress status (only while playable). */
  status: ProgressStatus | null;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  /** OK (only while playable): the Player for `ref`, opened from the focus id `id`. */
  onOpen: OpenPlayer;
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
  status,
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
      status={status}
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
  /** Story 4.2: each row's progress status, by index (none while not playable). */
  statuses: readonly (ProgressStatus | null)[];
  onRowView: (id: string, view: HostView | null) => void;
  onRowFocus: (id: string) => void;
  /** OK on a row (while playable): the Player for that video. */
  onOpenPlayer: OpenPlayer;
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
  statuses,
  onRowView,
  onRowFocus,
  onOpenPlayer,
}: PostVideoRowsProps) {
  return (
    <>
      {rows.map((row, i) => (
        <VideoRowStop
          key={row.ref.mediaId}
          id={`${idPrefix}${row.ref.mediaId}`}
          row={row}
          playable={playable}
          status={playable ? statuses[i] ?? null : null}
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
  /** `post/<postId>/restart` */
  restartId: string;
  /** The post has several MediaRows: the label names the target («· Видео N»). */
  multi: boolean;
  /** The first unfinished video (all finished: the first one). */
  target: VideoRow;
  /** The target has progress > 0: «Продолжить» and «С начала». */
  resume: boolean;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  onOpenPlayer: OpenPlayer;
};

type ColumnButtonProps = {
  id: string;
  label: string;
  kind: 'primary' | 'secondary';
  onPress: () => void;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  style?: StyleProp<ViewStyle>;
};

/** A button that is a content zone item and a column stop (like the rows). */
function ColumnButton({ id, label, kind, onPress, onView, onFocus, style }: ColumnButtonProps) {
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
  return (
    <Button
      ref={ref}
      testID={id}
      kind={kind}
      label={label}
      onPress={onPress}
      onFocus={handleFocus}
      style={style}
    />
  );
}

/**
 * The primary action under the header (Story 4.1, owner decision
 * 2026-10-27, option A): a primary Button in its own row, before the
 * MediaRows. Story 4.2: it targets the first unfinished video; «Продолжить»
 * when that one has progress, else «Смотреть» (all finished: «Смотреть» on
 * the first video, which starts at 0); several videos name the target
 * («Продолжить · Видео 2»). «С начала» (owner decision 2026-10-28) sits in
 * the same row, to its right, only when the target has progress; it starts
 * that video at 0. ← → move between them, ↓ from either reaches the first
 * MediaRow, ↑ the author (native focus in the one column).
 */
export function PostPrimaryAction({
  id,
  restartId,
  multi,
  target,
  resume,
  onView,
  onFocus,
  onOpenPlayer,
}: PostPrimaryActionProps) {
  const targetRef = target.ref;
  const onPress = useCallback(() => onOpenPlayer(targetRef, id), [onOpenPlayer, targetRef, id]);
  const onRestart = useCallback(
    () => onOpenPlayer(targetRef, restartId, 'beginning'),
    [onOpenPlayer, targetRef, restartId],
  );
  const video = mediaRowLabel(target);
  const label = resume
    ? multi
      ? tf('post.continueVideo', { label: video })
      : t('post.continue')
    : multi
      ? tf('post.watchVideo', { label: video })
      : t('post.watch');
  return (
    <View testID={`${id}-row`} style={styles.primaryRow}>
      <ColumnButton id={id} kind="primary" label={label} onPress={onPress} onView={onView} onFocus={onFocus} />
      {resume ? (
        <ColumnButton
          id={restartId}
          kind="secondary"
          label={t('post.restart')}
          onPress={onRestart}
          onView={onView}
          onFocus={onFocus}
          style={styles.restart}
        />
      ) : null}
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
  // «С начала» to the right of the primary (owner decision 2026-10-28).
  restart: {
    marginLeft: spacing['6'],
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
  // Story 6.3 chips (`link-chip`: 32 dp pill on `surface-raised`).
  chipGuide: {
    alignSelf: 'stretch',
    maxWidth: spacing['text-measure'],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    maxWidth: spacing['text-measure'],
    marginTop: -spacing['3'],
    marginBottom: spacing['4'],
  },
  chipGap: {
    marginRight: spacing['4'],
    marginBottom: spacing['4'],
  },
  chipAlone: {
    alignSelf: 'flex-start',
  },
  blockGap: {
    marginBottom: spacing['6'],
  },
  chip: {
    height: CHIP.height,
    paddingHorizontal: components['button-small'].paddingX,
    justifyContent: 'center',
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipLabel: {
    maxWidth: 420,
  },
  suffix: {
    marginLeft: spacing['4'],
  },
  actionSuffix: {
    marginLeft: spacing['2'],
  },
  chipError: {
    marginTop: spacing['3'],
  },
  videoChip: {
    minHeight: CHIP.height,
    padding: spacing['3'],
    paddingRight: components['button-small'].paddingX,
    justifyContent: 'center',
  },
  videoThumb: {
    width: 96,
    height: 54,
    borderRadius: rounded.sm,
    marginRight: spacing['5'],
    backgroundColor: colors.skeleton,
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
