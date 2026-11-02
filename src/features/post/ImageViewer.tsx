import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Image, StyleSheet, View, useTVEventHandler } from 'react-native';
import { tf, t } from '../../shared/i18n';
import { seekKeysAvailable, subscribeSeekKeys, type SeekKeyEvent } from '../../shared/platform/seekKeys';
import {
  FocusableSurface,
  Spinner,
  Text,
  components,
  requestHostFocus,
  type HostView,
} from '../../shared/ui';

const TOKENS = components['image-viewer'];
/** React Native's TV key up (`eventKeyAction`). */
const KEY_UP = 1;

/** Focus id of the viewer's one stop (focus-map §4 F «Story 11.2»). */
export const IMAGE_VIEWER_ID = 'dialog/image-viewer';

/** One image the viewer can show: a plain `{uri}` (no auth headers). */
export type ViewerImage = { url: string };

/**
 * Opens the viewer on `images[index]`; Back returns focus to `initiator`
 * (the image stop or comment row that was pressed).
 */
export type OpenImages = (
  images: readonly ViewerImage[],
  index: number,
  initiator: RefObject<HostView | null>,
) => void;

export type ImageViewerProps = {
  images: readonly ViewerImage[];
  initialIndex: number;
};

/**
 * The full-screen image viewer (Story 11.2, owner decision 2026-11-02, our
 * improvement beyond parity). Shown in the modal host with `placement:
 * 'fill'`: the host traps focus on every side, closes on Back first and
 * returns focus to the initiator. One focus stop (the stage) holds the
 * image fitted to the screen with its aspect kept (no zoom or pan), a
 * spinner while it loads and «Изображение недоступно» on a failure; «N / M»
 * when there is more than one image. ← / → step through the images (← on
 * the first and → on the last stay put): the native key down from
 * `SeekKeys` while the stage has focus, else (no native module) React
 * Native's key up, as the AudioBlock (the only other non-player ← → owner
 * in a post). Read-only: no other control.
 */
export function ImageViewer({ images, initialIndex }: ImageViewerProps) {
  const count = images.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, count - 1)));
  const image = images[index];
  const url = image?.url ?? '';
  // Per URL, so stepping back to a loaded or failed image shows it at once.
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());

  const stageRef = useRef<HostView | null>(null);
  useEffect(() => {
    requestHostFocus(stageRef.current);
  }, []);
  const focusedRef = useRef(false);
  const [focused, setFocused] = useState(false);

  const step = useCallback(
    (direction: 1 | -1) => setIndex(current => Math.min(count - 1, Math.max(0, current + direction))),
    [count],
  );

  const swallowUp = useRef({ left: false, right: false });
  const onSeekKey = useCallback(
    (event: SeekKeyEvent) => {
      if ((event.key !== 'left' && event.key !== 'right') || !focusedRef.current) {
        return;
      }
      if (event.action === 'up') {
        return;
      }
      swallowUp.current[event.key] = true;
      // One step per press: a held key does not run through the images.
      if (event.repeat === 0) {
        step(event.key === 'right' ? 1 : -1);
      }
    },
    [step],
  );
  useEffect(() => (focused ? subscribeSeekKeys(onSeekKey) : undefined), [focused, onSeekKey]);

  const onTvEvent = useCallback(
    (event: { eventType: string; eventKeyAction?: number | string }) => {
      const type = event.eventType;
      if ((type !== 'left' && type !== 'right') || !focusedRef.current || Number(event.eventKeyAction) !== KEY_UP) {
        return;
      }
      if (swallowUp.current[type]) {
        swallowUp.current[type] = false;
        return;
      }
      if (seekKeysAvailable()) {
        return;
      }
      step(type === 'right' ? 1 : -1);
    },
    [step],
  );
  useTVEventHandler(onTvEvent);

  const onFocus = useCallback(() => {
    focusedRef.current = true;
    swallowUp.current = { left: false, right: false };
    setFocused(true);
  }, []);
  const onBlur = useCallback(() => {
    focusedRef.current = false;
    setFocused(false);
  }, []);

  const isFailed = failed.has(url);
  const isLoaded = loaded.has(url);
  const position = { n: String(index + 1), m: String(count) };
  const label = isFailed
    ? t('post.imageUnavailable')
    : count > 1
      ? tf('post.imageViewer.a11y', position)
      : t('post.imageViewer.a11ySingle');

  return (
    <View testID="post/image-viewer" style={styles.root}>
      <FocusableSurface
        ref={stageRef}
        testID={IMAGE_VIEWER_ID}
        radius={0}
        scaleFocus={1}
        scalePressed={1}
        ring={false}
        hasTVPreferredFocus
        accessibilityRole="image"
        accessibilityLabel={label}
        onFocus={onFocus}
        onBlur={onBlur}
        style={styles.stage}
        surfaceStyle={() => styles.stageSurface}
      >
        <View style={styles.frame}>
          {isFailed ? (
            <Text testID={`${IMAGE_VIEWER_ID}/failed`} variant="body" color="text-secondary">
              {t('post.imageUnavailable')}
            </Text>
          ) : (
            <>
              <Image
                key={url}
                testID={`${IMAGE_VIEWER_ID}/image`}
                source={{ uri: url }}
                resizeMode="contain"
                resizeMethod="resize"
                fadeDuration={0}
                onLoad={() => setLoaded(prev => new Set(prev).add(url))}
                onError={() => setFailed(prev => new Set(prev).add(url))}
                accessibilityIgnoresInvertColors
                style={styles.image}
              />
              {isLoaded ? null : (
                <View testID={`${IMAGE_VIEWER_ID}/loading`} style={styles.spinner} accessibilityLabel={t('post.imageViewer.loading')}>
                  <Spinner testID={`${IMAGE_VIEWER_ID}/spinner`} />
                </View>
              )}
            </>
          )}
        </View>
      </FocusableSurface>
      {count > 1 ? (
        <View testID={`${IMAGE_VIEWER_ID}/counter`} style={styles.counter} pointerEvents="none">
          <Text variant="badge">{tf('post.imageViewer.counter', position)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TOKENS.bg,
  },
  stage: {
    flex: 1,
  },
  stageSurface: {
    flex: 1,
  },
  frame: {
    flex: 1,
    padding: TOKENS.padding,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    ...StyleSheet.absoluteFill,
    margin: TOKENS.padding,
  },
  spinner: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    top: TOKENS.padding,
    right: TOKENS.padding,
    paddingHorizontal: TOKENS.padding / 2,
    paddingVertical: TOKENS.padding / 4,
    borderRadius: TOKENS.counterRadius,
    backgroundColor: TOKENS.counterBg,
  },
});
