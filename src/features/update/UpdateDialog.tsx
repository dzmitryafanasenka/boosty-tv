import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { focusSoon } from '../../shared/focus';
import { t, tf, type MessageKey } from '../../shared/i18n';
import { subscribeAppForeground } from '../../shared/platform/appLifecycle';
import {
  canRequestInstalls as nativeCanRequestInstalls,
  cancelDownload as nativeCancelDownload,
  downloadUpdate as nativeDownloadUpdate,
  installUpdate as nativeInstallUpdate,
  openInstallSettings as nativeOpenInstallSettings,
  supportedAbis as nativeSupportedAbis,
  type DownloadFailure,
  type InstallPermission,
} from '../../shared/platform/appUpdater';
import { logger as appLogger, type Logger } from '../../shared/services/logger';
import { Button, QrCodeBox, Text, colors, components, rounded, spacing, type HostView } from '../../shared/ui';
import { pickInstallAsset, type KnownRelease } from './releaseInfo';

/** Focus ids (docs/focus-map.md §5 K5). */
export const UPDATE_INSTALL_ID = 'dialog/update/install';
export const UPDATE_CLOSE_ID = 'dialog/update/close';
export const UPDATE_CANCEL_ID = 'dialog/update/cancel';
export const UPDATE_SETTINGS_ID = 'dialog/update/settings';

/** The AppUpdater port the dialog uses (the native one by default; tests pass fakes). */
export type UpdaterPort = {
  supportedAbis: typeof nativeSupportedAbis;
  canRequestInstalls: typeof nativeCanRequestInstalls;
  openInstallSettings: typeof nativeOpenInstallSettings;
  downloadUpdate: typeof nativeDownloadUpdate;
  cancelDownload: typeof nativeCancelDownload;
  installUpdate: typeof nativeInstallUpdate;
};

const nativeUpdater: UpdaterPort = {
  supportedAbis: nativeSupportedAbis,
  canRequestInstalls: nativeCanRequestInstalls,
  openInstallSettings: nativeOpenInstallSettings,
  downloadUpdate: nativeDownloadUpdate,
  cancelDownload: nativeCancelDownload,
  installUpdate: nativeInstallUpdate,
};

export type UpdateDialogPhase =
  /** The notes, «Скачать и установить», «Закрыть». */
  | { kind: 'info' }
  /** No usable asset or digest: the notes, the QR, «Закрыть». */
  | { kind: 'unavailable' }
  /** Installs from this app are not allowed: the explanation, «Открыть настройки», «Закрыть» (+ the QR once denied again). */
  | { kind: 'permission'; denied: boolean }
  | { kind: 'downloading'; percent: number }
  | { kind: 'verifying' }
  /** The system installer is open. */
  | { kind: 'installing' }
  /** A failed download, verification or install: the reason, the QR, «Закрыть». */
  | { kind: 'failed'; message: MessageKey };

export type UpdateDialogProps = {
  release: KnownRelease;
  /** «Закрыть» (and Back outside a download): the caller closes the modal; focus returns to «Версия». */
  onClose: () => void;
  updater?: UpdaterPort;
  logger?: Logger;
};

const FAILURE_MESSAGE: Readonly<Record<DownloadFailure, MessageKey>> = {
  // Handled before (back to the info phase); listed for the type only.
  cancelled: 'update.dialog.failed.network',
  busy: 'update.dialog.failed.network',
  network: 'update.dialog.failed.network',
  url: 'update.dialog.failed.network',
  unavailable: 'update.dialog.failed.network',
  digest: 'update.dialog.failed.digest',
  size: 'update.dialog.failed.digest',
  storage: 'update.dialog.failed.storage',
};

/** The element that takes focus in each phase. */
function focusTargetOf(phase: UpdateDialogPhase): 'install' | 'close' | 'cancel' | 'settings' {
  switch (phase.kind) {
    case 'permission':
      return 'settings';
    case 'downloading':
    case 'verifying':
      return 'cancel';
    default:
      return 'close';
  }
}

/**
 * K5 update dialog (Story 9.2, FR-56, UPD-02; docs/focus-map.md §5 K5),
 * shown in the modal host from «Версия». Dialog tokens; the QR reuses
 * QrDialog's code box.
 *
 * - The title «Доступна версия X.Y.Z», the Russian changelog, «Скачать и
 *   установить» and «Закрыть». «Закрыть» takes the initial focus (the safe
 *   choice: quick OK presses on «Версия» never start a download).
 * - Nothing is downloaded before an OK on «Скачать и установить». Then: the
 *   permission check (`canRequestInstalls`; if not allowed, the explanation
 *   and «Открыть настройки», which opens the system screen; on the return
 *   to the foreground the dialog continues from there), the download with
 *   its progress (Back or «Отменить» cancels it and the file is deleted; the
 *   dialog stays), the verification, and the system installer. Its answer
 *   comes back here: a cancel or a failure shows the reason and the QR;
 *   a success closes the dialog (focus back on «Версия»). A failed
 *   permission check (not a «no») is an install failure, not the
 *   permission phase. A cancel after 100 % skips the installer.
 * - No usable asset or digest: the QR to the release page instead of the
 *   install button. Nothing is retried automatically.
 * - Logs status and reason fields only (never the URL, path or digest).
 */
export function UpdateDialog({ release, onClose, updater = nativeUpdater, logger = appLogger }: UpdateDialogProps) {
  const plan = useMemo(() => pickInstallAsset(release, updater.supportedAbis()), [release, updater]);
  const [phase, setPhase] = useState<UpdateDialogPhase>(() =>
    plan.kind === 'ready' ? { kind: 'info' } : { kind: 'unavailable' },
  );
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const mounted = useRef(true);
  /** «Открыть настройки» was pressed: the next return to the foreground continues. */
  const awaitingSettings = useRef(false);
  const installRef = useRef<HostView>(null);
  const closeRef = useRef<HostView>(null);
  const cancelRef = useRef<HostView>(null);
  const settingsRef = useRef<HostView>(null);

  /** The install flow runs (permission check, download, installer): a second OK is ignored. */
  const busy = useRef(false);
  /** A native download is running: an unmount cancels it. */
  const downloadActive = useRef(false);
  /** Back or «Отменить» during the download or the verification: no installer afterwards. */
  const cancelRequested = useRef(false);

  const update = useCallback((next: UpdateDialogPhase) => {
    if (mounted.current) {
      setPhase(next);
    }
  }, []);

  const cancel = useCallback(() => {
    cancelRequested.current = true;
    updater.cancelDownload();
  }, [updater]);

  useEffect(() => {
    mounted.current = true;
    if (plan.kind !== 'ready') {
      logger.info('update', 'update install unavailable', { reason: plan.reason });
    }
    return () => {
      mounted.current = false;
      if (downloadActive.current) {
        cancelRequested.current = true;
        updater.cancelDownload();
      }
    };
    // Mount only: the plan of this dialog's release.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each phase's preferred element (the buttons change between phases).
  // Now and two frames later: the modal host focuses its container after
  // this child effect on open, and a removed button's focus is lost.
  const target = focusTargetOf(phase);
  useEffect(() => {
    const refs = { install: installRef, close: closeRef, cancel: cancelRef, settings: settingsRef };
    return focusSoon(() => refs[target].current, { guard: () => mounted.current });
  }, [target]);

  // Registered after the modal host's listener, so it sees Back first: a
  // running download is cancelled and the dialog stays; otherwise the host
  // closes the dialog.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const kind = phaseRef.current.kind;
      if (downloadActive.current || kind === 'downloading' || kind === 'verifying') {
        cancel();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [cancel]);

  const download = useCallback(async () => {
    if (plan.kind !== 'ready' || !mounted.current) {
      return;
    }
    cancelRequested.current = false;
    downloadActive.current = true;
    update({ kind: 'downloading', percent: 0 });
    let result: Awaited<ReturnType<UpdaterPort['downloadUpdate']>>;
    try {
      result = await updater.downloadUpdate(plan.asset, ({ received, total }) => {
        if (!mounted.current || total <= 0) {
          return;
        }
        const percent = Math.min(100, Math.floor((received * 100) / total));
        if (percent >= 100) {
          update({ kind: 'verifying' });
        } else if (phaseRef.current.kind === 'downloading') {
          update({ kind: 'downloading', percent });
        }
      });
    } finally {
      downloadActive.current = false;
    }
    if (cancelRequested.current || (result.kind === 'failed' && result.reason === 'cancelled')) {
      // A cancel after 100 % still wins: the installer is not opened (the
      // file is deleted on the next start).
      logger.info('update', 'update download cancelled', { status: 'cancelled' });
      update({ kind: 'info' });
      return;
    }
    if (result.kind === 'failed') {
      logger.warn('update', 'update download failed', { reason: result.reason });
      update({ kind: 'failed', message: FAILURE_MESSAGE[result.reason] });
      return;
    }
    logger.info('update', 'update download verified', { status: 'verified', abi: plan.abi ?? 'universal' });
    if (!mounted.current) {
      return;
    }
    update({ kind: 'installing' });
    const outcome = await updater.installUpdate(result.fileRef);
    logger.info('update', 'update install result', { status: outcome });
    if (outcome === 'installed') {
      if (mounted.current) {
        onClose();
      }
      return;
    }
    update({
      kind: 'failed',
      message: outcome === 'cancelled' ? 'update.dialog.failed.installCancelled' : 'update.dialog.failed.install',
    });
  }, [plan, update, updater, logger, onClose]);

  /** The permission answer → the download, the permission phase, or the install failure. */
  const proceed = useCallback(
    async (permission: InstallPermission, denied: boolean) => {
      if (!mounted.current) {
        return;
      }
      if (permission === 'allowed') {
        await download();
      } else if (permission === 'denied') {
        update({ kind: 'permission', denied });
      } else {
        logger.warn('update', 'update install permission', { status: 'check_failed' });
        update({ kind: 'failed', message: 'update.dialog.failed.install' });
      }
    },
    [download, update, logger],
  );

  const onInstall = useCallback(async () => {
    // A synchronous guard: a quick second OK (before the phase re-renders) is ignored.
    if (busy.current || phaseRef.current.kind !== 'info') {
      return;
    }
    busy.current = true;
    try {
      const permission = await updater.canRequestInstalls();
      if (permission === 'denied') {
        logger.info('update', 'update install permission', { status: 'needed' });
      }
      await proceed(permission, false);
    } finally {
      busy.current = false;
    }
  }, [proceed, updater, logger]);

  const onOpenSettings = useCallback(async () => {
    awaitingSettings.current = true;
    if (!(await updater.openInstallSettings())) {
      awaitingSettings.current = false;
      logger.warn('update', 'update install permission', { status: 'settings_unavailable' });
      update({ kind: 'permission', denied: true });
    }
  }, [update, updater, logger]);

  // Back from the system screen: continue from the same state.
  useEffect(
    () =>
      subscribeAppForeground(() => {
        if (!awaitingSettings.current || busy.current || phaseRef.current.kind !== 'permission') {
          return;
        }
        awaitingSettings.current = false;
        busy.current = true;
        updater
          .canRequestInstalls()
          .then(permission => {
            if (!mounted.current || phaseRef.current.kind !== 'permission') {
              return undefined;
            }
            logger.info('update', 'update install permission', {
              status: permission === 'allowed' ? 'granted' : permission,
            });
            return proceed(permission, true);
          })
          .catch(() => {})
          .finally(() => {
            busy.current = false;
          });
      }),
    [proceed, updater, logger],
  );

  const showQr =
    phase.kind === 'unavailable' || phase.kind === 'failed' || (phase.kind === 'permission' && phase.denied);
  const showNotes = phase.kind === 'info' || phase.kind === 'unavailable';

  return (
    <View testID="dialog/update" style={styles.dialog}>
      <Text variant="title-s" accessibilityRole="header" numberOfLines={2}>
        {tf('update.dialog.title', { version: release.version })}
      </Text>
      {showNotes ? (
        <Text
          testID="dialog/update/notes"
          variant="body-s"
          color="text-secondary"
          numberOfLines={showQr ? 5 : 12}
          style={styles.body}
        >
          {release.notes.length > 0 ? release.notes : t('update.dialog.noNotes')}
        </Text>
      ) : null}
      <StatusLine phase={phase} />
      {showQr ? (
        <View style={styles.qr}>
          <QrCodeBox value={release.pageUrl} testID="dialog/update/qr" />
          <Text variant="body-s" color="text-secondary" style={styles.qrHint}>
            {t('update.dialog.qrHint')}
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        {phase.kind === 'info' ? (
          <Button
            ref={installRef}
            testID={UPDATE_INSTALL_ID}
            kind="secondary"
            label={t('update.dialog.install')}
            onPress={() => {
              onInstall().catch(() => {});
            }}
            style={styles.actionGap}
          />
        ) : null}
        {phase.kind === 'permission' ? (
          <Button
            ref={settingsRef}
            testID={UPDATE_SETTINGS_ID}
            kind="secondary"
            label={t('update.dialog.openSettings')}
            onPress={() => {
              onOpenSettings().catch(() => {});
            }}
            hasTVPreferredFocus
            style={styles.actionGap}
          />
        ) : null}
        {phase.kind === 'downloading' || phase.kind === 'verifying' ? (
          <Button
            ref={cancelRef}
            testID={UPDATE_CANCEL_ID}
            kind="secondary"
            label={t('update.dialog.cancel')}
            onPress={cancel}
            hasTVPreferredFocus
          />
        ) : (
          <Button
            ref={closeRef}
            testID={UPDATE_CLOSE_ID}
            kind="secondary"
            label={t('update.dialog.close')}
            onPress={onClose}
            hasTVPreferredFocus={target === 'close'}
          />
        )}
      </View>
    </View>
  );
}

/** The phase's status text and, while downloading, the progress bar. */
function StatusLine({ phase }: { phase: UpdateDialogPhase }) {
  let message: string | null = null;
  switch (phase.kind) {
    case 'unavailable':
      message = t('update.dialog.unavailable');
      break;
    case 'permission':
      message = phase.denied ? t('update.dialog.permissionDenied') : t('update.dialog.permission');
      break;
    case 'downloading':
      message = tf('update.dialog.downloading', { percent: String(phase.percent) });
      break;
    case 'verifying':
      message = t('update.dialog.verifying');
      break;
    case 'installing':
      message = t('update.dialog.installing');
      break;
    case 'failed':
      message = t(phase.message);
      break;
    case 'info':
      break;
  }
  if (message === null) {
    return null;
  }
  const percent = phase.kind === 'downloading' ? phase.percent : phase.kind === 'verifying' ? 100 : null;
  return (
    <View style={styles.status}>
      <Text
        testID="dialog/update/status"
        accessibilityLiveRegion="polite"
        variant="body-s"
        color={phase.kind === 'failed' ? 'error-text' : 'text'}
      >
        {message}
      </Text>
      {percent !== null ? (
        <View testID="dialog/update/progress" style={styles.track}>
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dialog: {
    maxWidth: components.dialog.maxWidth,
    borderRadius: components.dialog.radius,
    backgroundColor: components.dialog.bg,
    padding: spacing['11'],
  },
  body: {
    marginTop: spacing['5'],
  },
  status: {
    marginTop: spacing['5'],
  },
  track: {
    marginTop: spacing['4'],
    height: spacing['2'],
    borderRadius: rounded.full,
    backgroundColor: colors['surface-raised'],
    overflow: 'hidden',
  },
  fill: {
    height: spacing['2'],
    backgroundColor: colors.accent,
  },
  qr: {
    marginTop: spacing['8'],
    alignItems: 'center',
  },
  qrHint: {
    marginTop: spacing['6'],
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing['9'],
  },
  actionGap: {
    marginRight: spacing['5'],
  },
});
