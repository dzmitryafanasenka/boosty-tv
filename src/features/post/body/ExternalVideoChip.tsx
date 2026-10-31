import { memo, useCallback, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { youtubeThumbnail } from '../../../shared/entities/externalUrls';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { t, tf } from '../../../shared/i18n';
import {
  FocusableSurface,
  Text,
  colors,
  components,
  focus,
  rounded,
  spacing,
  type SurfaceState,
} from '../../../shared/ui';
import { blockStyles } from './blockStyles';
import { CHIP, ChipGuide, QrSuffix, chipStyles, type OpenQr } from './chipParts';

type ExternalVideoChipProps = {
  id: string;
  url: string;
  youtubeId: string | null;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onOpenQr?: OpenQr;
};

const videoChipSurface = ({ focused }: SurfaceState) => [
  styles.videoChip,
  { backgroundColor: focused ? colors['surface-focus-button'] : CHIP.bg },
];

/**
 * An external video (Story 6.3): never played in the app. A chip with the
 * YouTube thumbnail (a plain `{uri}`, no headers) when the host is YouTube,
 * «Видео на YouTube» / «Внешнее видео» and the «QR» suffix; a failed
 * thumbnail leaves the text. OK opens the QrDialog for the page.
 */
export const ExternalVideoChip = memo(function ExternalVideoChipView({
  id,
  url,
  youtubeId,
  onView,
  onFocus,
  onOpenQr,
}: ExternalVideoChipProps) {
  const { ref, viewRef, handleFocus } = useColumnStop(id, onView, onFocus);
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
        style={[chipStyles.chipAlone, blockStyles.blockGap]}
      >
        <View style={chipStyles.chipContent}>
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
          <Text variant="button-s" numberOfLines={1} style={chipStyles.chipLabel}>
            {label}
          </Text>
          <QrSuffix testID={id} />
        </View>
      </FocusableSurface>
    </ChipGuide>
  );
});

const styles = StyleSheet.create({
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
});
