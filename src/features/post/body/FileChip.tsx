import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { FileTargetResult } from '../../../shared/entities/post';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { t, tf } from '../../../shared/i18n';
import { formatFileSize } from '../../../shared/i18n/format';
import { FocusableSurface, Text, focus, spacing } from '../../../shared/ui';
import { blockStyles } from './blockStyles';
import {
  CHIP,
  ChipGuide,
  QrSuffix,
  chipStyles,
  chipSurface,
  type OpenQr,
  type ResolveFileTarget,
} from './chipParts';

type FileChipProps = {
  id: string;
  /** The file's block key (`file:<id>`, else `file@<index>`). */
  fileKey: string;
  title: string;
  sizeBytes: number | null;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
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
export const FileChip = memo(function FileChipView({
  id,
  fileKey,
  title,
  sizeBytes,
  onView,
  onFocus,
  onOpenQr,
  resolveFile,
}: FileChipProps) {
  const { ref, viewRef, handleFocus } = useColumnStop(id, onView, onFocus);
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
      <View style={blockStyles.blockGap}>
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
          style={chipStyles.chipAlone}
        >
          <View style={chipStyles.chipContent}>
            <Text variant="button-s" numberOfLines={1} style={chipStyles.chipLabel}>
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

const styles = StyleSheet.create({
  chipError: {
    marginTop: spacing['3'],
  },
});
